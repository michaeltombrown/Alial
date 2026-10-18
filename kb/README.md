# Essay type knowledge base

One guidance file per essay type (`<essay-type-id>.md`), injected into all four analyses for that type. The summarizer never sees it.

## Status: editorial draft

The entries are Alial's own synthesis of widely shared admissions guidance, written for this app. They are **not** distilled from the pages in `sources.csv`: those pages were not readable when this was written. Per the audit sheet, no source is approved for production, no source has had the three-pass review, and only 7 official publisher pages were opened. The analyses are told to treat the guidance as editorial calibration, never to quote it or cite it, and to tell students to verify school-specific details on official sites.

Facts stated in the entries are limited to well-established rules (for example, the UC format of four of eight questions at 350 words, and the Common App length range). Everything else is guidance about what readers look for.

## Files

| File | Purpose |
|---|---|
| `common-app.md`, `coalition.md`, `uc-piq.md`, `why-college.md`, `community.md`, `activity.md`, `short-answer.md`, `scholarship.md`, `transfer.md`, `other.md` | Guidance for each essay type. Sections: The essay, What strong essays do, Common weaknesses, How to calibrate the analysis, Suggestions worth offering. |
| `sources.csv` | The resource audit sheet: 74 rows, 48 unique URLs, with verification and approval status. It is the register of sources to ground the entries in. |

`npm run build` turns these into `src/generated/kb.js` (committed, because the Cloudflare build runs only `wrangler deploy`).

## How the analyses use it

`analyzerMessage()` in `src/pipeline.js` adds the chosen type's entry as `<essay_type_guidance>`. The "How to calibrate the analysis" section matters most: it tells the reviewers how to apply 18-category rubrics built for a 650-word statement to a 100-word answer, a context box, or a directness-first UC response.

## Upgrading to sourced content

1. Allow the sources' domains in the environment's network settings (commonapp.org, universityofcalifornia.edu, admission.universityofcalifornia.edu, admission.ucla.edu, admissions.tufts.edu, admissions.cornell.edu, admissions.dartmouth.edu, admissions.yale.edu, coalitionforcollegeaccess.org, questbridge.org, scholarships.com, collegeessayguy.com).
2. Read each source, paraphrase its guidance into the matching entry, and note which sources informed it.
3. Update the `Official page checked`, `Three-pass reviewed`, and `Approved for production` columns in `sources.csv` as each source is verified.
4. Run `npm run build` and `npm test`.
