const path = require('node:path');
const { rtfToText } = require('./rtf');

const MAX_CHARS = 30000;

const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);

function normalize(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractText(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  switch (ext) {
    case '.txt':
    case '.md':
      return normalize(file.buffer.toString('utf8'));
    case '.rtf':
      return normalize(rtfToText(file.buffer.toString('latin1')));
    case '.docx': {
      const mammoth = require('mammoth');
      const { value } = await mammoth.extractRawText({ buffer: file.buffer });
      return normalize(value);
    }
    case '.pdf': {
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
      try {
        const { text } = await parser.getText();
        return normalize(text);
      } finally {
        await parser.destroy();
      }
    }
    default:
      throw new UserError(`Unsupported file type "${ext || 'unknown'}". Upload a .docx, .pdf, .txt, or .rtf file, or paste your essay.`);
  }
}

class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

module.exports = { extractText, normalize, countWords, UserError, MAX_CHARS };
