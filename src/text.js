export const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);

// Case, quote, dash, and whitespace insensitive form used to match quoted passages against their source.
export const loose = (s) =>
  s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
