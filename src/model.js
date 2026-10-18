const API_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const DEFAULT_MAX_TOKENS = 12000;
const RETRYABLE = new Set([429, 500, 502, 503, 529]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reads an Anthropic Messages SSE stream and returns the concatenated text.
export async function readTextStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let stopReason = null;

  const handle = (block) => {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const data = JSON.parse(line.slice(5).trim());
      if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') text += data.delta.text;
      else if (data.type === 'message_delta' && data.delta?.stop_reason) stopReason = data.delta.stop_reason;
      else if (data.type === 'error') throw new Error(data.error?.message || 'Anthropic stream error');
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
  if (stopReason === 'max_tokens') console.warn('[alial] a response hit max_tokens and was truncated');
  return text;
}

// Returns async ({ system, user, signal }) => string
export function createCompleter({ apiKey, model = DEFAULT_MODEL, maxTokens = DEFAULT_MAX_TOKENS, fetchFn = fetch }) {
  return async ({ system, user, signal }) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchFn(API_URL, {
        method: 'POST',
        signal,
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: maxTokens, stream: true, system, messages: [{ role: 'user', content: user }] }),
      });
      if (res.ok) return readTextStream(res.body);
      const detail = (await res.text()).slice(0, 300);
      if (RETRYABLE.has(res.status) && attempt < 2) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new Error(`Anthropic API ${res.status}: ${detail}`);
    }
  };
}

// Offline stand-in used when ALIAL_MOCK=1 so the app can be exercised without an API key.
export function createMockCompleter() {
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
        paragraphs: paras.map((m) => ({
          n: Number(m[1]),
          purpose: 'Mock: sets up the idea.',
          works: 'Mock: a clear, personal opening.',
          comments: [{ quote: m[2].split(/\s+/).slice(0, 8).join(' '), issues: ['Mock issue: the claim is stated without a concrete example.'], suggestions: ['Add one specific moment that shows it.', 'Ask yourself what you noticed in that moment.'] }],
        })),
      });
    }
    if (user.startsWith('Requested length:')) {
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
