import { ESSAY_TYPES } from './essayTypes.js';
import { runPipeline, SUMMARY_LENGTHS } from './pipeline.js';
import { SUMMARIZER } from './analyzers.js';
import { createCompleter, createMockCompleter, DEFAULT_MODEL } from './model.js';
import { MAX_CHARS, UserError, parseInput } from './validate.js';

const MAX_BODY_BYTES = 200_000;
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

async function analyze(request, env, ctx) {
  if (env.LIMITER) {
    const key = request.headers.get('cf-connecting-ip') || 'unknown';
    const { success } = await env.LIMITER.limit({ key });
    if (!success) return json({ error: 'Too many requests. Please wait a minute and try again.' }, 429, { 'retry-after': '60' });
  }

  let input;
  try {
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new UserError('That request is too large.', 413);
    let body;
    try {
      body = await request.json();
    } catch {
      throw new UserError('Send the essay as JSON.');
    }
    input = parseInput(body);
  } catch (err) {
    if (err instanceof UserError) return json({ error: err.message }, err.status);
    throw err;
  }

  const mock = env.ALIAL_MOCK === '1';
  if (!mock && !env.ANTHROPIC_API_KEY) {
    console.error('[alial] ANTHROPIC_API_KEY is not set');
    return json({ error: 'Alial is not fully set up yet. Please try again later.' }, 503);
  }
  const complete = mock
    ? createMockCompleter()
    : createCompleter({ apiKey: env.ANTHROPIC_API_KEY, model: env.ALIAL_MODEL || DEFAULT_MODEL });

  // Stream newline-delimited JSON so the UI can show each analysis as it finishes.
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
        await runPipeline({ complete, summarizer: SUMMARIZER, input, emit, signal: controller.signal });
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error('[alial] pipeline failed:', err.message);
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

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/config') return json(config(env));
    if (pathname === '/api/analyze') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, { allow: 'POST' });
      return analyze(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
