import { ESSAY_TYPES } from './essayTypes.js';
import { runPipeline, runSummary, SUMMARY_LENGTHS } from './pipeline.js';
import { SUMMARIZER } from './analyzers.js';
import { createCompleter, createMockCompleter, DEFAULT_MODEL } from './model.js';
import { MAX_CHARS, UserError, parseInput, parseSummaryRequest } from './validate.js';

const MAX_BODY_BYTES = 200_000;
const MAX_SUMMARY_BODY_BYTES = 400_000;
const PING_MS = 10_000;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

function config(env) {
  return {
    mock: env.ALIAL_MOCK === '1',
    maxChars: MAX_CHARS,
    lengths: Object.keys(SUMMARY_LENGTHS),
    types: ESSAY_TYPES.map(({ id, label, limit, hint, promptHint }) => ({ id, label, limit, hint, promptHint })),
  };
}

// Shared checks for the two POST endpoints. Returns { response } to stop, or { complete, body }.
async function prepare(request, env, maxBytes, parse) {
  if (env.LIMITER) {
    const key = request.headers.get('cf-connecting-ip') || 'unknown';
    const { success } = await env.LIMITER.limit({ key });
    if (!success) return { response: json({ error: 'Too many requests. Please wait a minute and try again.' }, 429, { 'retry-after': '60' }) };
  }

  let parsed;
  try {
    if (Number(request.headers.get('content-length')) > maxBytes) throw new UserError('That request is too large.', 413);
    let body;
    try {
      body = await request.json();
    } catch {
      throw new UserError('Send the request as JSON.');
    }
    parsed = parse(body);
  } catch (err) {
    if (err instanceof UserError) return { response: json({ error: err.message }, err.status) };
    throw err;
  }

  const mock = env.ALIAL_MOCK === '1';
  if (!mock && !env.ANTHROPIC_API_KEY) {
    console.error('[alial] ANTHROPIC_API_KEY is not set');
    return { response: json({ error: 'Alial is not fully set up yet. Please try again later.' }, 503) };
  }
  const complete = mock
    ? createMockCompleter({ failSummaryOnce: env.ALIAL_MOCK_FAIL_SUMMARY_ONCE === '1' })
    : createCompleter({ apiKey: env.ANTHROPIC_API_KEY, model: env.ALIAL_MODEL || DEFAULT_MODEL });
  return { complete, parsed };
}

// Streams newline-delimited JSON events while `run` works, with a keepalive so long runs are not cut off.
function streamRun(request, ctx, run) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const emit = (event) => writer.write(encoder.encode(JSON.stringify(event) + '\n')).catch(() => {});

  const controller = new AbortController();
  request.signal?.addEventListener('abort', () => controller.abort());
  writer.closed.catch(() => controller.abort());
  const ping = setInterval(() => emit({ type: 'ping' }), PING_MS);

  ctx.waitUntil(
    (async () => {
      try {
        await run({ emit, signal: controller.signal });
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error('[alial] run failed:', err.message);
          emit({ type: 'error', error: 'Something went wrong while analyzing your essay. Please try again.' });
        }
      } finally {
        clearInterval(ping);
        await writer.close().catch(() => {});
      }
    })(),
  );

  return new Response(readable, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
}

async function analyze(request, env, ctx) {
  const { response, complete, parsed } = await prepare(request, env, MAX_BODY_BYTES, parseInput);
  if (response) return response;
  return streamRun(request, ctx, ({ emit, signal }) => runPipeline({ complete, summarizer: SUMMARIZER, input: parsed, emit, signal }));
}

// Rewrites only the summary from analyses the student already has, so a summary failure never forces a full rerun.
async function summarize(request, env, ctx) {
  const { response, complete, parsed } = await prepare(request, env, MAX_SUMMARY_BODY_BYTES, parseSummaryRequest);
  if (response) return response;
  return streamRun(request, ctx, async ({ emit, signal }) => {
    await runSummary({ complete, summarizer: SUMMARIZER, reports: parsed.reports, input: parsed.input, emit, signal });
    emit({ type: 'done' });
  });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/config') return json(config(env));
    // Lets anyone confirm which version is live (for example after a deploy).
    if (pathname === '/api/health') {
      return json({ ok: true, app: 'alial', features: ['knowledge-base', 'in-line-review', 'viewpoints', 'engine-summary', 'summary-retry', 'requirement-notes', 'tabbed-layout'] });
    }
    if (pathname === '/api/analyze' || pathname === '/api/summarize') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, { allow: 'POST' });
      return pathname === '/api/analyze' ? analyze(request, env, ctx) : summarize(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
