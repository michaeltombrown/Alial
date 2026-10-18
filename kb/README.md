# Essay type knowledge base

Guidance for each of the ten essay types, injected into the four analyses and the In-Line Review. The summary never sees it.

## Two tiers, never mixed up

| Tier | What it is | Status | Where it lives |
|---|---|---|---|
| **Editorial guidance** | Alial's own guidance per essay type: what readers look for, common weaknesses, how to calibrate the rubrics, and exercises to offer. Includes the 10 distinct exercises and guardrails from the GroundWRK teaching guides. | Editorial draft. Not sourced from, and not attributed to, any publisher page. | `kb/<essay-type-id>.md` |
| **Requirement notes** | Short facts and guardrails taken from source pages the audit opened (for example, UC's four of eight questions at 350 words, Coalition's six options, the Common App activity-list character limits). | Quarantined. Each note cites a source record, and none is approved for production. The prompts call them pointers to verify, never authority. | `kb/rules.json` |

The analyses are told never to quote, cite, or name any source, and to send students to the official site to confirm requirements. No URL, source id, or source title ever appears in a prompt (a test enforces this).

## The source register (`kb/data/`)

Imported from the audit package and kept unmodified:

| File | Contents |
|---|---|
| `sources.jsonl` | 38 unique sources with verification status, scope, and a short summary. Not shipped in the Worker. |
| `source_assignments.csv` | 50 assignments (5 per essay type) with allowed use, guardrails, and approval flags. The spreadsheet in the package has identical content. |
| `teaching_guides.jsonl` | 50 guides. They contain only 10 distinct texts (one per essay type, repeated across each type's sources). The distinct texts are folded into the editorial guidance. |
| `INTEGRATION_SPEC.md` | The integration specification that came with the package. |

State of the data: 45 assignments point to pages that opened, 2 to historical resources, 3 to pages that failed to open (`FETCH_FAILED_OR_404`, allowed use "none pending reverification"). 18 of the 38 source summaries are templated and carry no source-specific detail. Nothing is approved for production and nothing has passed three-pass vetting. This is not 50 vetted sources.

`npm run build` validates the register and fails on: duplicate ids or URLs, non-https URLs, summaries long enough to be third-party full text, a missing "full text not embedded" rights note, instruction-like text inside records, a source or guide marked approved, an assignment approved without three-pass vetting, a failed source marked usable, a school-specific source marked as official requirements, and any rule that cites a failed source, a school-specific source, or an unmarked historical source.

## What was adopted from the integration spec, and what was not

Adopted: quarantine by default; verification and approval flags preserved; rule-setting facts kept apart from coaching text (`rules.json`); school-specific material kept out of general analysis; summaries and original commentary only, never third-party full text; validation tests for duplicates, failed links, historical sources, rights, and prompt injection; no unapproved material presented as verified.

Not built: the SQL schema with ten normalized entities, the three sequential audit stages, the review-queue UI, periodic link rechecks, claim-level evidence tables, and clickable publisher attribution. That is a content-management product. With nothing approved it would return nothing to the analyses today, and showing publisher attribution would overstate what these entries are. If a reviewer workflow is wanted, it is a separate project (for example, Cloudflare D1 plus an admin page).

## Promoting a note to approved

1. Open the cited source page and confirm the note against it, for the current application cycle.
2. Record who reviewed it and when (outside this repo for now, until a review workflow exists).
3. Only then change the flags in `kb/data`, and rerun `npm run build` and `npm test`.

## Updating the editorial guidance

Edit the `.md` file for the essay type, then run `npm run build` (it regenerates `src/generated/kb.js`, which is committed because the Cloudflare build runs only `wrangler deploy`).
