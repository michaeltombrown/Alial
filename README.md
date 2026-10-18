# Alial

College essay analysis, review, and suggestions. A student pastes or uploads an application essay, picks its type, and adds the question being answered. Four independent analyses and a paragraph-by-paragraph In-Line Review examine the essay, then a summary built from the four analyses is written at the length the student chooses (Short, Medium, or Detailed).

```
essay + type + question/context (+ optional college, word limit) + the essay type's knowledge base entry
        |
        |-- Rubric Reader (Reviewer 1)                 prompts/rubric-rater.txt          (A/B/C, 0 to 18)
        |-- Selective-College Evaluator (Reviewer 2)   prompts/writer-grader-master.txt  (18 categories, /180)
        |-- Story Coach (Reviewer 3)                   prompts/common-app-master.txt     (voice and narrative craft)
        |-- Admissions Grader (Reviewer 4)             prompts/admissions-grader.txt     (18 categories, 1 to 10)
        `-- In-Line Review                             prompts/inline-review.txt         (paragraph by paragraph)
                     |  (all five run in parallel and never see each other's output)
                     v
        Summary: Summary Generator + Intelligence Engine synthesis, over the four analyses only
```

The report has six tabs: **Summary**, **In-Line Review**, and one tab per reviewer. Each tab opens with a **Viewpoint** line saying what angle that feedback comes from, so the feedback is easy to tell apart (`angle` in `src/analyzers.js`).

**In-Line Review** reads the whole essay from beginning to end as one continuous piece. It opens with how the essay reads as one piece, then takes each paragraph as part of that thought: its role, how it connects to the paragraphs around it, the issues that leave the reader short of context or interest, and one or more suggestions. It works at the paragraph level, not line by line. Each card shows the original words (the most telling sentence, with the full paragraph one click away). An essay with no paragraph breaks, or with very long paragraphs, is divided into sections of about 100 words at sentence boundaries so the review covers all of it. Quotes are checked against the real text, the original text always comes from the server, and any part the model skips is asked for once more and otherwise flagged as not reviewed. Suggestions describe what to do and never rewrite the essay.

**Order of results:** the four analyses appear as they finish, then the In-Line Review, then the Summary, which waits for everything and shows what it is waiting on. If the summary fails (for example a rate limit), the Summary tab says why and offers **Retry the summary**, which calls `POST /api/summarize` to rewrite only the summary from the analyses already on screen. Rate limits and overloads are retried patiently, honoring the service's Retry-After.

**Summary** is built from three parts, in `src/analyzers.js`: the Summary Generator role (`prompts/summarizer.txt`, unaltered), an application note (`prompts/synthesis-integration.txt`, written for Alial), and Sections 1, 3, 5, and 7 to 11 of the College Essay Intelligence Engine specification (`prompts/intelligence-engine.txt`, stored in full). The summarizer receives only the four analyses, the essay type, the prompt the student supplied, the word count against the limit, and the chosen length (Short, Medium, or Detailed), never the essay. If a reviewer fails, the summary says so and is labeled partial.

Not implemented from the Engine specification: a single overall X/10 essay score (the essay-type scoring rubric it requires has not been supplied; the summary shows each reviewer's native score and a 0 to 100 reference score instead), school-neutral instructions for the four reviewers, source-eligibility retrieval, version comparison for revisions, and recorded three-pass validation (the summarizer self-checks silently).

## Essay type knowledge base

`kb/` holds guidance for each of the ten essay types and short requirement notes taken from an audited source register (`kb/data`). The student's chosen type's guidance and notes are added to the four analyses and the In-Line Review so they calibrate their rubrics and suggestions to that kind of essay (for example, a 100-word short answer is not judged like a 650-word personal statement). The notes are quarantined (not approved for production), are presented to the model as pointers to verify, and no source is ever named or linked in a prompt. See `kb/README.md` for the two tiers, the state of the data, and what was and was not adopted from the integration spec.

## How it is built

A Cloudflare Worker (`src/worker.js`) with static assets (`public/`). The Worker only handles `/api/*`; everything else is served as a static file.

| Path | Purpose |
|---|---|
| `src/worker.js` | `GET /api/config`, `POST /api/analyze` (streams progress as NDJSON), per-visitor rate limit |
| `src/pipeline.js` | Runs the four analyses in parallel, then the summarizer |
| `src/model.js` | Anthropic Messages API client (streaming, retries) and an offline mock |
| `src/validate.js`, `src/essayTypes.js` | Input checks and the essay type presets |
| `src/generated/prompts.js`, `src/generated/kb.js` | Generated from `prompts/*.txt`, `kb/*.md` and `kb/rules.json` |
| `public/` | The interface. Word and RTF uploads are read in the browser; PDFs are not supported (paste the text) |
| `wrangler.jsonc` | Worker name `alial`, assets, rate limit (4 analyses per minute per visitor) |

Uploaded files are read in the browser and the essay text is sent to the Worker. Nothing is stored.

## Deploy (Cloudflare)

The `alial` Worker is connected to this repository with Workers Builds, so a push to `main` runs `npx wrangler deploy`.

**One-time setup:** in the Cloudflare dashboard open Workers & Pages > `alial` > Settings > Variables and Secrets > Add, choose type **Secret**, name `ANTHROPIC_API_KEY`, paste your key, and deploy. Optional: add `ALIAL_MODEL` (default `claude-sonnet-5-5`).

After a deploy, open `/api/health` on the site. It lists the features of the running version (for example `in-line-review` and `knowledge-base`), so you can tell whether the new code is live.

Each essay makes six paid model calls (four analyses, the in-line review, and the summary). The rate limit in `wrangler.jsonc` is per location and per visitor; for stronger protection, put the Worker behind Cloudflare Access.

## Develop

```bash
npm install
cp .dev.vars.example .dev.vars   # ALIAL_MOCK=1 gives placeholder output without an API key
npm run dev                      # http://localhost:8787
npm test
```

After editing anything in `prompts/` or `kb/`, or upgrading `marked`, `dompurify`, or `mammoth`, run `npm run build` and commit the result. The Worker build runs only `wrangler deploy`, so generated files (`src/generated/`, `public/vendor/`) are committed.
