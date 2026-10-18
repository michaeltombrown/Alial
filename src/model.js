const API_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const DEFAULT_MAX_TOKENS = 12000;
const RETRYABLE = new Set([429, 500, 502, 503, 529]);
const RETRYABLE_STREAM_ERRORS = new Set(['overloaded_error', 'rate_limit_error', 'api_error']);
const MAX_WAIT_MS = 30000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reads an Anthropic Messages SSE stream and returns the concatenated text.
export async function readTextStream(body, info = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let stopReason = null;
  let started = false;
  let stopped = false;

  const handle = (block) => {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const data = JSON.parse(line.slice(5).trim());
      if (data.type === 'message_start') started = true;
      else if (data.type === 'message_stop') stopped = true;
      else if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') text += data.delta.text;
      else if (data.type === 'message_delta' && data.delta?.stop_reason) stopReason = data.delta.stop_reason;
      else if (data.type === 'error') {
        const err = new Error(`Anthropic stream error (${data.error?.type}): ${data.error?.message || 'unknown'}`);
        err.retryable = RETRYABLE_STREAM_ERRORS.has(data.error?.type);
        throw err;
      }
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
  }
  if (buf.trim()) handle(buf);
  if (started && !stopped) {
    const err = new Error('Anthropic stream ended before the response was complete');
    err.retryable = true;
    throw err;
  }
  info.stopReason = stopReason;
  if (stopReason === 'max_tokens') console.warn('[alial] a response hit max_tokens and was truncated');
  return text;
}

// Turns an internal error into a short reason that is safe to show a student.
export function describeFailure(err) {
  const m = String(err?.message || err);
  if (/\b429\b|rate.?limit/i.test(m)) return 'The model service is rate limiting requests right now.';
  if (/\b529\b|overloaded|\b50[023]\b/i.test(m)) return 'The model service is busy right now.';
  return '';
}

// Returns async ({ system, user, signal, retries = 2 }) => string.
// Retries rate limits and overloads, honoring Retry-After (capped), including overloads that arrive mid-stream.
export function createCompleter({ apiKey, model = DEFAULT_MODEL, maxTokens = DEFAULT_MAX_TOKENS, fetchFn = fetch, sleepFn = sleep }) {
  return async ({ system, user, signal, retries = 2, maxTokens: callMax, onStop }) => {
    for (let attempt = 0; ; attempt++) {
      let retryAfter = 0;
      try {
        const res = await fetchFn(API_URL, {
          method: 'POST',
          signal,
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: callMax || maxTokens, stream: true, system, messages: [{ role: 'user', content: user }] }),
        });
        if (res.ok) {
          const info = {};
          const text = await readTextStream(res.body, info);
          onStop?.(info.stopReason);
          return text;
        }
        const detail = (await res.text()).slice(0, 300);
        const err = new Error(`Anthropic API ${res.status}: ${detail}`);
        err.retryable = RETRYABLE.has(res.status);
        retryAfter = Number(res.headers.get('retry-after')) || 0;
        throw err;
      } catch (err) {
        if (signal?.aborted || !err.retryable || attempt >= retries) throw err;
        await sleepFn(Math.min(MAX_WAIT_MS, retryAfter ? retryAfter * 1000 : 1000 * 2 ** attempt));
      }
    }
  };
}

// Offline stand-in used when ALIAL_MOCK=1 so the app can be exercised without an API key.
let mockSummaryFailed = false; // test switch state, shared across requests in one isolate
export function createMockCompleter({ failSummaryOnce = false } = {}) {
  return async ({ system, user, signal }) => {
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 800 + Math.random() * 2200);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      });
    });
    if (system.startsWith("You are Alial's In-Line Review editor")) {
      const paras = [...user.matchAll(/^\[P(\d+)\]\n(.+)$/gm)];
      return JSON.stringify({
        arc: 'Mock: the essay opens with a scene, builds toward a realization, and closes on a goal. The main opportunity is to give the reader more context early.',
        paragraphs: paras.map((m) => ({
          n: Number(m[1]),
          role: 'Mock: carries the thought forward.',
          flow: 'Mock: connects to the previous paragraph through the grandmother and sets up the next.',
          issues: ['Mock issue: the reader is not told why this moment matters yet.'],
          suggestions: ['Add one sentence of context that shows what is at stake.', 'Ask yourself what you noticed here that the reader cannot see.'],
          focus: m[2].split(/\s+/).slice(0, 8).join(' '),
        })),
      });
    }
    if (user.startsWith('Requested length:')) {
      if (failSummaryOnce && !mockSummaryFailed) {
        mockSummaryFailed = true;
        throw new Error('Anthropic API 429: mock rate limit');
      }
      return [
        '## Summary',
        'This is **mock output** for testing Alial without an API key.',
        '',
        '## Key Takeaways',
        '- Mock strength',
        '- Mock weakness',
        '- Mock revision',
        '',
        '## Conclusion',
        'Mock conclusion.',
      ].join('\n');
    }
    return `# Mock review\n\nPrompt starts with: _${system.slice(0, 60).replace(/\n/g, ' ')}..._\n\n| Category | Score |\n|---|---|\n| Voice | 7 |\n| Imagery | 6 |\n\n**Total:** 13/20`;
  };
}
