# Alial

College essay analysis, review, and suggestions. A student pastes or uploads an application essay, picks its type, and adds the question being answered. Four independent analyses review the essay, then the Summary Generator summarizes those four analyses at the length the student chooses (Short, Medium, or Detailed).

```
essay + type + question/context (+ optional college, word limit)
        |
        |-- Rubric Reader                 prompts/rubric-rater.txt          (A/B/C, 0 to 18)
        |-- Admissions Grader             prompts/admissions-grader.txt     (18 categories, 1 to 10)
        |-- Selective-College Evaluator   prompts/writer-grader-master.txt  (18 categories, /180)
        `-- Story Coach                   prompts/common-app-master.txt     (voice and narrative craft)
                     |  (run in parallel)
                     v
        Summary Generator  prompts/summarizer.txt  ->  Summary tab
        (the four full analyses are tabs beside it)
```

The summarizer receives only the four analyses and the chosen length, never the essay. If one analysis fails, the summary is built from the rest. If all fail, the student sees an error.

## Essay type knowledge base

`kb/` holds guidance for each of the ten essay types plus the audited source register (`kb/sources.csv`). The guidance for the student's chosen type is added to all four analyses so they calibrate their rubrics and suggestions to that kind of essay (for example, a 100-word short answer is not judged like a 650-word personal statement). See `kb/README.md` for its status and how to upgrade it with sourced content.

## How it is built

A Cloudflare Worker (`src/worker.js`) with static assets (`public/`). The Worker only handles `/api/*`; everything else is served as a static file.

| Path | Purpose |
|---|---|
| `src/worker.js` | `GET /api/config`, `POST /api/analyze` (streams progress as NDJSON), per-visitor rate limit |
| `src/pipeline.js` | Runs the four analyses in parallel, then the summarizer |
| `src/model.js` | Anthropic Messages API client (streaming, retries) and an offline mock |
| `src/validate.js`, `src/essayTypes.js` | Input checks and the essay type presets |
| `src/generated/prompts.js`, `src/generated/kb.js` | Generated from `prompts/*.txt` and `kb/` |
| `public/` | The interface. Word and RTF uploads are read in the browser; PDFs are not supported (paste the text) |
| `wrangler.jsonc` | Worker name `alial`, assets, rate limit (4 analyses per minute per visitor) |

Uploaded files are read in the browser and the essay text is sent to the Worker. Nothing is stored.

## Deploy (Cloudflare)

The `alial` Worker is connected to this repository with Workers Builds, so a push to `main` runs `npx wrangler deploy`.

**One-time setup:** in the Cloudflare dashboard open Workers & Pages > `alial` > Settings > Variables and Secrets > Add, choose type **Secret**, name `ANTHROPIC_API_KEY`, paste your key, and deploy. Optional: add `ALIAL_MODEL` (default `claude-sonnet-5-5`).

Each essay makes five paid model calls. The rate limit in `wrangler.jsonc` is per location and per visitor; for stronger protection, put the Worker behind Cloudflare Access.

## Develop

```bash
npm install
cp .dev.vars.example .dev.vars   # ALIAL_MOCK=1 gives placeholder output without an API key
npm run dev                      # http://localhost:8787
npm test
```

After editing anything in `prompts/` or `kb/`, or upgrading `marked`, `dompurify`, or `mammoth`, run `npm run build` and commit the result. The Worker build runs only `wrangler deploy`, so generated files (`src/generated/`, `public/vendor/`) are committed.
