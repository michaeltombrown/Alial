const MAX_PARAGRAPHS = 40;
const MAX_ITEMS = 4;

// Deterministic paragraph split. The model only comments on paragraphs; the original text always comes from here.
export function splitParagraphs(essay) {
  const text = essay.replace(/\r\n?/g, '\n').trim();
  let parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1 && text.includes('\n')) parts = text.split('\n').map((p) => p.trim()).filter(Boolean);
  return parts.slice(0, MAX_PARAGRAPHS);
}

const loose = (s) =>
  s
    .toLowerCase()
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();

export function inlineMessage({ describe, guidance, paragraphs }) {
  return [
    'Review the essay below paragraph by paragraph, following your instructions in full.',
    '',
    ...(guidance ? ['<essay_type_guidance>', guidance, '</essay_type_guidance>', ''] : []),
    '<context>',
    describe,
    '</context>',
    '',
    '<essay>',
    ...paragraphs.flatMap((p, i) => [`[P${i + 1}]`, p]),
    '</essay>',
  ].join('\n');
}

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v, max) => (Array.isArray(v) ? v.map((x) => clean(x, max)).filter(Boolean).slice(0, MAX_ITEMS) : []);

// Turns the model's JSON into display data. Quotes that are not found in the paragraph are dropped, never shown as original text.
export function parseInlineReview(raw, paragraphs) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('In-line review was not valid JSON');
  const data = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(data.paragraphs)) throw new Error('In-line review had no paragraphs');

  const byN = new Map(data.paragraphs.map((p) => [Number(p?.n), p]));
  return paragraphs.map((text, i) => {
    const entry = byN.get(i + 1) || {};
    const haystack = loose(text);
    const comments = (Array.isArray(entry.comments) ? entry.comments : [])
      .slice(0, MAX_ITEMS)
      .map((c) => {
        const quote = clean(c?.quote, 600);
        return {
          quote: quote && haystack.includes(loose(quote)) ? quote : '',
          issues: list(c?.issues, 400),
          suggestions: list(c?.suggestions, 500),
        };
      })
      .filter((c) => c.issues.length || c.suggestions.length);
    return { n: i + 1, text, purpose: clean(entry.purpose, 300), works: clean(entry.works, 300), comments };
  });
}
