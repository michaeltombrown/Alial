# Alial

College essay analysis, review, and suggestions. Upload or paste an application essay, pick its type, and Alial has four independent reviewers analyze it, then a summarizer combines their reports into one final report.

## How it works

```
essay + type (+ optional prompt, college, word limit)
        │
        ├─► Rubric Reader                 prompts/rubric-rater.txt        (A/B/C, 0 to 18)
        ├─► Admissions Grader             prompts/admissions-grader.txt   (18 categories, 1 to 10)
        ├─► Selective-College Evaluator   prompts/writer-grader-master.txt(18 categories, /180)
        └─► Story Coach                   prompts/common-app-master.txt   (voice and narrative craft)
                     │  (run in parallel)
                     ▼
              Summarizer  ──►  final report  (+ the four full reviews)
```

If one reviewer fails, the summarizer works with the rest. If all fail, the user sees an error.

Supported essay types: Common App, Coalition, UC Personal Insight Questions, several supplemental types (why this college, community, activity, short answer), scholarship, transfer, and other. Each sets a default word limit and tells the reviewers what to focus on (`src/essayTypes.js`). Uploads accept `.docx`, `.pdf`, `.txt`, `.rtf`, `.md`, or paste text.

## Run it

```bash
npm install
cp .env.example .env     # add your ANTHROPIC_API_KEY
npm start                # http://localhost:3000
```

No key yet? `npm run dev` starts in mock mode with placeholder output so you can try the interface.

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Required unless `ALIAL_MOCK=1` |
| `ALIAL_MODEL` | `claude-sonnet-5-5` | Model used for reviewers and summarizer |
| `PORT` | `3000` | |
| `ALIAL_MAX_CONCURRENT` | `4` | Max simultaneous analyses before returning "busy" |

## The summarizer prompt

`prompts/summarizer.placeholder.txt` is a working placeholder. To use your own, save it as **`prompts/summarizer.txt`**; it takes precedence automatically and the startup warning goes away. The summarizer receives the essay context plus the four reports, each wrapped in `<report reviewer="...">` tags.

## Layout

```
server.js            Express app: /api/config, /api/analyze (streams progress as NDJSON)
src/pipeline.js      Runs the four reviewers in parallel, then the summarizer
src/analyzers.js     Loads prompts; defines the four reviewers
src/model.js         Anthropic client (and the offline mock)
src/extract.js       Text extraction from uploads (docx, pdf, rtf, txt)
public/              The single-page interface
prompts/             The system prompts
test/                npm test
```

## Notes

- Essays are processed in memory and never written to disk or a database.
- There is no login or rate limiting beyond the concurrency cap. Add both before exposing this publicly, since each essay triggers five model calls.
