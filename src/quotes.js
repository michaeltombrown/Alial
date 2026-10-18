import { loose } from './text.js';

// Quoted passages of at least this many words are checked against the sources the summary is allowed to use.
const MIN_QUOTE_WORDS = 7;
const MIN_SEGMENT_WORDS = 4;

const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const norm = (s) => loose(s).replace(/[*_`#>]/g, '');
const trimEdges = (s) => s.replace(/^[\s.,;:!?'"‘’“”-]+|[\s.,;:!?'"‘’“”-]+$/g, '');

/**
 * Finds long quoted passages in `text` that do not appear in any of `sources`. The summary is only allowed to quote the essay,
 * so a passage that matches nothing is flagged to the student rather than silently trusted. Passages with ellipses are checked
 * piece by piece. Returns up to five distinct passages.
 */
export function findUnverifiedQuotes(text, sources) {
  const haystack = norm(sources.join('\n'));
  const found = [];
  for (const m of text.matchAll(/[“"]([^”"\n]{25,500})[”"]/g)) {
    const quote = m[1].trim();
    if (words(quote) < MIN_QUOTE_WORDS) continue;
    const pieces = quote
      .split(/\.{3}|…|\[\s*\.\.\.\s*\]/)
      .map(trimEdges)
      .filter((p) => words(p) >= MIN_SEGMENT_WORDS);
    if (pieces.length && !pieces.every((p) => haystack.includes(norm(p)))) found.push(quote);
  }
  return [...new Set(found)].slice(0, 5);
}
