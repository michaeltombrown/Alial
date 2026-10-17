// Minimal RTF to plain text. Skips destination groups (font/color/list tables, \* groups)
// and decodes \par, \tab, \'xx (cp1252) and \uN escapes. Enough for essays saved from
// TextEdit, Pages, Word, or Google Docs.
const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'listtable', 'listoverridetable', 'info', 'pict', 'header', 'footer', 'expandedcolortbl']);
const CP1252 = { 128: '€', 130: '‚', 131: 'ƒ', 132: '„', 133: '…', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—' };

function rtfToText(src) {
  let out = '';
  const stack = [];
  let skipDepth = 0;
  let uc = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') {
      stack.push({ skip: skipDepth > 0, uc });
      if (skipDepth > 0) skipDepth++;
      else {
        const m = /^\\\*|^\\([a-z]+)/i.exec(src.slice(i + 1, i + 40));
        if (m && (m[0] === '\\*' || SKIP.has(m[1]))) skipDepth = 1;
      }
    } else if (c === '}') {
      const top = stack.pop();
      if (top) uc = top.uc;
      if (skipDepth > 0) skipDepth--;
    } else if (c === '\\') {
      const next = src[i + 1];
      if (next === "'") {
        const code = parseInt(src.slice(i + 2, i + 4), 16);
        if (!skipDepth) out += CP1252[code] || String.fromCharCode(code);
        i += 3;
      } else if (/[a-z]/i.test(next)) {
        const m = /^([a-z]+)(-?\d+)? ?/i.exec(src.slice(i + 1));
        const [full, word, arg] = m;
        i += full.length;
        if (word === 'uc') uc = Number(arg);
        else if (word === 'u') {
          if (!skipDepth) out += String.fromCharCode(Number(arg) < 0 ? Number(arg) + 65536 : Number(arg));
          i += uc; // skip fallback characters
          // fallback is usually one char like "?"; step back if it was actually "\" or group
          if (src[i - uc + 1] === '\\' || src[i - uc + 1] === '{' || src[i - uc + 1] === '}') i -= uc;
        } else if (!skipDepth) {
          if (word === 'par' || word === 'line') out += '\n';
          else if (word === 'tab') out += '\t';
        }
      } else if (next === '\\' || next === '{' || next === '}') {
        if (!skipDepth) out += next;
        i += 1;
      } else if (next === '\n' || next === '\r') {
        if (!skipDepth) out += '\n';
        i += 1;
      } else if (next === '~') {
        if (!skipDepth) out += ' ';
        i += 1;
      } else {
        i += 1;
      }
    } else if (!skipDepth && c !== '\n' && c !== '\r') {
      out += c;
    }
  }
  return out;
}

module.exports = { rtfToText };
