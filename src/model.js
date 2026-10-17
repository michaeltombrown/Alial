const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = 'claude-sonnet-5-5';
const DEFAULT_MAX_TOKENS = 12000;

// Returns async ({ system, user, signal }) => string
function createCompleter({ apiKey, model = DEFAULT_MODEL, maxTokens = DEFAULT_MAX_TOKENS }) {
  const client = new Anthropic({ apiKey });
  return async ({ system, user, signal }) => {
    const stream = client.messages.stream(
      { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] },
      { signal },
    );
    const message = await stream.finalMessage();
    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (message.stop_reason === 'max_tokens') {
      console.warn('[alial] a response hit max_tokens and was truncated');
    }
    return text;
  };
}

// Offline stand-in used when ALIAL_MOCK=1 so the UI and pipeline can be exercised without an API key.
function createMockCompleter() {
  return async ({ system, user, signal }) => {
    const delay = 800 + Math.random() * 2200;
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, delay);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      });
    });
    if (user.startsWith('Requested length:')) {
      return [
        '## Summary',
        'This is **mock output** for testing Alial without an API key. Set `ANTHROPIC_API_KEY` to get real analysis.',
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

module.exports = { createCompleter, createMockCompleter, DEFAULT_MODEL };
