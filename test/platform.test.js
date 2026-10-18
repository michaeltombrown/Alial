import test from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { PROMPTS } from '../src/generated/prompts.js';
import { readTextStream, createCompleter } from '../src/model.js';
import { parseInput, UserError } from '../src/validate.js';
import worker from '../src/worker.js';
import { ESSAY_TYPES } from '../src/essayTypes.js';

const essay = 'The summer my grandmother taught me to fold dumplings changed how I listen. '.repeat(5);

test('generated prompts match prompts/*.txt (run `npm run build` if this fails)', () => {
  const files = readdirSync(new URL('../prompts/', import.meta.url)).filter((f) => f.endsWith('.txt'));
  assert.strictEqual(files.length, 5);
  for (const f of files) {
    assert.strictEqual(PROMPTS[f.replace('.txt', '')], readFileSync(new URL(`../prompts/${f}`, import.meta.url), 'utf8').trim(), f);
  }
});

const sse = (events) =>
  new ReadableStream({
    start(c) {
      const enc = new TextEncoder();
      for (const e of events) c.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      c.close();
    },
  });

test('parses an Anthropic SSE stream, including events split across chunks', async () => {
  const body = sse([
    { type: 'message_start' },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  ]);
  assert.strictEqual(await readTextStream(body), 'Hello');

  const raw = 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ab"}}\n\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"cd"}}\n\n';
  const split = new ReadableStream({ start(c) { const e = new TextEncoder().encode(raw); c.enqueue(e.slice(0, 40)); c.enqueue(e.slice(40)); c.close(); } });
  assert.strictEqual(await readTextStream(split), 'abcd');
});

test('an Anthropic error event rejects', async () => {
  await assert.rejects(readTextStream(sse([{ type: 'error', error: { message: 'overloaded' } }])), /overloaded/);
});

test('completer sends the key, model and prompts, and retries on 529', async () => {
  const seen = [];
  let n = 0;
  const fetchFn = async (url, init) => {
    seen.push({ url, init });
    if (++n === 1) return new Response('busy', { status: 529 });
    return new Response(sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }]), { status: 200 });
  };
  const text = await createCompleter({ apiKey: 'k', model: 'm', fetchFn })({ system: 'SYS', user: 'USR' });
  assert.strictEqual(text, 'ok');
  assert.strictEqual(seen.length, 2);
  const body = JSON.parse(seen[1].init.body);
  assert.deepStrictEqual([body.model, body.system, body.stream, body.messages[0].content], ['m', 'SYS', true, 'USR']);
  assert.strictEqual(seen[1].init.headers['x-api-key'], 'k');
});

test('input validation', () => {
  const ok = parseInput({ type: 'uc-piq', essay, length: 'short', prompt: ' Q ', college: 'X', wordLimit: '300' });
  assert.deepStrictEqual([ok.type.id, ok.length, ok.prompt, ok.wordLimit], ['uc-piq', 'short', 'Q', 300]);
  assert.strictEqual(parseInput({ type: 'common-app', essay, length: 'bogus' }).length, 'medium');
  assert.strictEqual(parseInput({ type: 'common-app', essay }).wordLimit, 650);
  for (const bad of [null, { type: 'nope', essay }, { type: 'common-app', essay: 'too short' }, { type: 'common-app', essay: 'w '.repeat(20000) }]) {
    assert.throws(() => parseInput(bad), UserError);
  }
});

// ---- the Worker itself
const ctx = () => { const p = []; return { waitUntil: (x) => p.push(x), done: () => Promise.all(p) }; };
const env = (extra = {}) => ({ ALIAL_MOCK: '1', ASSETS: { fetch: async () => new Response('asset') }, ...extra });
const post = (body, headers = {}) => new Request('https://alial.test/api/analyze', { method: 'POST', body: JSON.stringify(body), headers });

test('worker: config, assets, and method handling', async () => {
  const cfg = await (await worker.fetch(new Request('https://alial.test/api/config'), env(), ctx())).json();
  assert.strictEqual(cfg.types.length, ESSAY_TYPES.length);
  assert.deepStrictEqual(cfg.lengths, ['short', 'medium', 'detailed']);
  assert.strictEqual(await (await worker.fetch(new Request('https://alial.test/'), env(), ctx())).text(), 'asset');
  assert.strictEqual((await worker.fetch(new Request('https://alial.test/api/analyze'), env(), ctx())).status, 405);
});

test('worker: streams the five-step analysis as NDJSON', async () => {
  const c = ctx();
  const res = await worker.fetch(post({ type: 'common-app', essay, length: 'detailed', prompt: 'Why Brown?' }), env(), c);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /ndjson/);
  const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  await c.done();
  assert.strictEqual(events[0].type, 'start');
  assert.strictEqual(events.filter((e) => e.type === 'analyzer' && e.status === 'done').length, 4);
  assert.ok(events.find((e) => e.type === 'summary').text.includes('## Summary'));
  assert.strictEqual(events.at(-1).type, 'done');
});

test('worker: rejects bad input, rate-limited callers, and a missing API key', async () => {
  assert.strictEqual((await worker.fetch(post({ type: 'common-app', essay: 'short' }), env(), ctx())).status, 400);
  assert.strictEqual((await worker.fetch(new Request('https://alial.test/api/analyze', { method: 'POST', body: 'not json' }), env(), ctx())).status, 400);
  const limited = env({ LIMITER: { limit: async () => ({ success: false }) } });
  assert.strictEqual((await worker.fetch(post({ type: 'common-app', essay }), limited, ctx())).status, 429);
  const noKey = env({ ALIAL_MOCK: '0' });
  const res = await worker.fetch(post({ type: 'common-app', essay }), noKey, ctx());
  assert.strictEqual(res.status, 503);
  assert.ok(!JSON.stringify(await res.json()).includes('ANTHROPIC'), 'must not leak config details to the client');
});

test('browser rtf reader skips tables and keeps paragraphs and unicode', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(new URL('../public/rtf.js', import.meta.url), 'utf8'), sandbox);
  const rtf = "{\\rtf1\\ansi{\\fonttbl\\f0 Times;}{\\colortbl;\\red0;}\\f0 Hello \\u8212? world\\par It\\'92s me\\\nNext}";
  assert.strictEqual(sandbox.window.rtfToText(rtf).replace(/\n+/g, '|'), 'Hello — world|It’s me|Next');
});

test('generated knowledge base matches kb/*.md and the source register matches kb/sources.csv', async () => {
  const { KB, KB_SOURCES } = await import('../src/generated/kb.js');
  for (const t of ESSAY_TYPES) {
    assert.strictEqual(KB[t.id], readFileSync(new URL(`../kb/${t.id}.md`, import.meta.url), 'utf8').trim(), t.id);
  }
  const all = Object.values(KB_SOURCES).flat();
  assert.strictEqual(all.length, 74);
  assert.deepStrictEqual(Object.fromEntries(Object.entries(KB_SOURCES).map(([k, v]) => [k, v.length])), {
    'common-app': 7, coalition: 7, 'uc-piq': 9, 'why-college': 9, community: 7, activity: 7, 'short-answer': 8, scholarship: 7, transfer: 6, other: 7,
  });
  assert.ok(all.every((s) => s.url.startsWith('https://') && s.title && s.score >= 1));
  // The audit marks nothing approved for production; the register must not claim otherwise.
  assert.ok(all.every((s) => s.approvedForProduction === false && s.threePassReviewed === false));
  assert.strictEqual(all.filter((s) => s.pageChecked).length, 7);
});

test('worker config exposes each type\'s prompt hint', async () => {
  const cfg = await (await worker.fetch(new Request('https://alial.test/api/config'), env(), ctx())).json();
  assert.ok(cfg.types.every((t) => t.promptHint));
  assert.ok(!JSON.stringify(cfg).includes('essay_type_guidance'), 'guidance text is server-side only');
});
