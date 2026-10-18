import { loose } from './text.js';

const MAX_PARAGRAPHS = 40;
const MAX_ITEMS = 3;
const LONG_PARAGRAPH_WORDS = 200; // a paragraph longer than this is divided so the review can cover the whole piece
const SECTION_WORDS = 100; // target size of a section when dividing

const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

// Divides text into consecutive sections of about SECTION_WORDS words, at sentence boundaries. The sections concatenate back to the original.
function toSections(text) {
  const sentences = text.match(/[^.!?]+(?:[.!?]+["')\]”’]*|$)\s*/g) || [text];
  const sections = [];
  let current = '';
  for (const s of sentences) {
    current += s;
    if (words(current) >= SECTION_WORDS) {
      sections.push(current);
      current = '';
    }
  }
  if (current.trim()) {
    if (sections.length && words(current) < SECTION_WORDS / 2) sections[sections.length - 1] += current;
    else sections.push(current);
  }
  return sections.map((s) => s.trim()).filter(Boolean);
}

// Deterministic split. The model only comments on parts; the original text always comes from here.
// Returns { paragraphs, synthetic }, where synthetic is true if any long paragraph was divided into sections.
export function splitParagraphs(essay) {
  const text = essay.replace(/\r\n?/g, '\n').trim();
  let parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1 && text.includes('\n')) parts = text.split('\n').map((p) => p.trim()).filter(Boolean);

  let synthetic = false;
  const out = parts.flatMap((p) => {
    if (words(p) <= LONG_PARAGRAPH_WORDS) return [p];
    const sections = toSections(p);
    if (sections.length > 1) synthetic = true;
    return sections;
  });
  return { paragraphs: out.slice(0, MAX_PARAGRAPHS), synthetic };
}

export function inlineMessage({ describe, knowledge = [], paragraphs, synthetic = false, missing = [] }) {
  return [
    'Review the whole essay below as one continuous piece, following your instructions in full.',
    ...(synthetic
      ? ['The essay has no paragraph breaks or has very long paragraphs, so it was divided into consecutive sections of roughly 100 words. Treat the sections as consecutive parts of one continuous essay.']
      : []),
    '',
    ...knowledge,
    '<context>',
    describe,
    '</context>',
    '',
    '<essay>',
    ...paragraphs.flatMap((p, i) => [`[P${i + 1}]`, p]),
    '</essay>',
    ...(missing.length ? ['', `Your previous answer left out part ${missing.join(', ')}. Return the complete JSON again with an entry for every part from 1 to ${paragraphs.length}.`] : []),
  ].join('\n');
}

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v, max) => (Array.isArray(v) ? v.map((x) => clean(x, max)).filter(Boolean).slice(0, MAX_ITEMS) : []);

// Turns the model's JSON into display data. A focus quote that is not found in the paragraph is dropped, never shown as original text.
// A part the model skipped is marked reviewed: false rather than shown as having no issues.
export function parseInlineReview(raw, paragraphs) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('In-line review was not valid JSON');
  const data = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(data.paragraphs)) throw new Error('In-line review had no paragraphs');

  const byN = new Map(data.paragraphs.map((p) => [Number(p?.n), p]));
  return {
    arc: clean(data.arc, 1200),
    paragraphs: paragraphs.map((text, i) => {
      const entry = byN.get(i + 1);
      const focus = clean(entry?.focus, 600);
      return {
        n: i + 1,
        text,
        reviewed: Boolean(entry),
        role: clean(entry?.role, 400),
        flow: clean(entry?.flow, 600),
        issues: list(entry?.issues, 500),
        suggestions: list(entry?.suggestions, 600),
        focus: focus && loose(text).includes(loose(focus)) ? focus : '',
      };
    }),
  };
}

export const missingParts = (result) => result.paragraphs.filter((p) => !p.reviewed).map((p) => p.n);

// Sanitizes an in-line review sent back by the browser (for the summary retry). Returns the same shape as a finished review, or null.
export function sanitizeInline(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.paragraphs)) return null;
  const paragraphs = data.paragraphs.slice(0, MAX_PARAGRAPHS).map((p, i) => ({
    n: Number.isInteger(p?.n) ? p.n : i + 1,
    reviewed: p?.reviewed !== false,
    role: clean(p?.role, 400),
    flow: clean(p?.flow, 600),
    issues: list(p?.issues, 500),
    suggestions: list(p?.suggestions, 600),
    focus: clean(p?.focus, 600),
  }));
  return { status: 'done', arc: clean(data.arc, 1200), paragraphs, synthetic: Boolean(data.synthetic) };
}
