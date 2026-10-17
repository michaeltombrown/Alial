const path = require('node:path');
const express = require('express');
const multer = require('multer');

const { ESSAY_TYPES, getEssayType } = require('./src/essayTypes');
const { extractText, countWords, UserError, MAX_CHARS } = require('./src/extract');
const { runPipeline } = require('./src/pipeline');
const { SUMMARIZER } = require('./src/analyzers');
const { createCompleter, createMockCompleter, DEFAULT_MODEL } = require('./src/model');

const PORT = process.env.PORT || 3000;
const MOCK = process.env.ALIAL_MOCK === '1';
const MAX_CONCURRENT = Number(process.env.ALIAL_MAX_CONCURRENT || 4);

if (!MOCK && !process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. Copy .env.example, set your key, or run with ALIAL_MOCK=1 to try the UI.');
  process.exit(1);
}

const complete = MOCK
  ? createMockCompleter()
  : createCompleter({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ALIAL_MODEL || DEFAULT_MODEL });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const app = express();
let running = 0;

app.use(express.static(path.join(__dirname, 'public')));
// Browser libraries are served from node_modules so the app has no CDN dependency.
const markedDir = path.dirname(require.resolve('marked/package.json'));
const purifyDir = path.dirname(require.resolve('dompurify')); // resolves to dompurify/dist
app.get('/vendor/marked.js', (_req, res) => res.sendFile(path.join(markedDir, 'lib', 'marked.umd.js')));
app.get('/vendor/purify.js', (_req, res) => res.sendFile(path.join(purifyDir, 'purify.min.js')));

app.get('/api/config', (_req, res) => {
  res.json({
    mock: MOCK,
    maxChars: MAX_CHARS,
    types: ESSAY_TYPES.map(({ id, label, limit, hint }) => ({ id, label, limit, hint })),
  });
});

app.post('/api/analyze', upload.single('file'), async (req, res) => {
  let input;
  try {
    const type = getEssayType(req.body.type);
    if (!type) throw new UserError('Choose an essay type.');

    const essay = req.file ? await extractText(req.file) : (req.body.essay || '').trim();
    const words = countWords(essay);
    if (words < 25) throw new UserError('That looks too short to analyze. Upload or paste the full essay (at least 25 words).');
    if (essay.length > MAX_CHARS) throw new UserError(`Essay is too long (limit ${MAX_CHARS.toLocaleString()} characters).`);

    const wordLimit = Math.min(Math.max(parseInt(req.body.wordLimit, 10) || type.limit, 1), 5000);
    input = {
      type,
      essay,
      wordLimit,
      prompt: (req.body.prompt || '').trim().slice(0, 2000),
      college: (req.body.college || '').trim().slice(0, 200),
    };
  } catch (err) {
    const status = err instanceof UserError ? err.status : err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message });
  }

  if (running >= MAX_CONCURRENT) {
    return res.status(429).json({ error: 'Alial is busy right now. Please try again in a minute.' });
  }

  // Stream newline-delimited JSON events so the UI can show each reviewer finishing.
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.flushHeaders();

  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const emit = (event) => {
    if (!res.writableEnded) res.write(JSON.stringify(event) + '\n');
  };

  running++;
  try {
    await runPipeline({ complete, summarizer: SUMMARIZER, input, emit, signal: controller.signal });
  } catch (err) {
    if (!controller.signal.aborted) {
      console.error('[alial] pipeline failed:', err.message);
      emit({ type: 'error', error: 'Something went wrong while analyzing your essay. Please try again.' });
    }
  } finally {
    running--;
    res.end();
  }
});

app.use((err, _req, res, _next) => {
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (5 MB max).' : 'Unexpected error.' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Alial running at http://localhost:${PORT}${MOCK ? ' (mock mode)' : ''}`));
}

module.exports = app;
