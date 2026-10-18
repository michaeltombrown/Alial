# Claude Code Implementation Prompt: GroundWRK College Essay Knowledge Base

Implement a verification-gated essay guidance KB from the accompanying JSONL/CSV files.

1. Import `college_essay_kb_records.jsonl` as unique SOURCE records by canonical URL/resource_id; import `college_essay_teaching_guides.jsonl` as derived guidance records linked by source_id. One source can relate to multiple essay types without inflating source count.
2. Preserve `verification_status`, `approved_for_production`, `three_pass_vetting_complete`, and `source_scope`. All imported entries are **quarantined seed data**; NEVER flip approval solely because a URL loads or old CSV relevance score >=9.
3. Model normalized entities: sources, source_versions, source_checks, claims, source_claim_evidence, coaching_guides, application_requirements, review_decisions, retrieval_policy, audit_events. Include publication_cycle, reviewer identity/time, content hash, claim provenance, source location, and licensing/permissions.
4. Implement 3 sequential audits: (1) URL/publisher and page-level content and check timestamp; (2) individual claim-to-source support, relevance scoring >=9 and content fidelity; (3) school neutrality, current-cycle application requirements, copyright, safety, reviewer approval. Mark `approved_for_production=true` only when ALL gates pass.
5. Prefer original summaries and independently written teaching examples, exercises, checklists, and question banks. Do NOT scrape, ingest or redistribute full third-party copyrighted page text without a valid license or other lawful basis. Publisher URL and attributable fact snippets are sufficient; limit quotation.
6. Retrieve with hard server-side SQL filters (NOT prompt-only): approved_for_production=true; essay_type match; source claim scope appropriate; application cycle valid for requirement; and school-specific material limited to explicit user authorization. Avoid giving university-specific preferences in generic analysis.
7. For UC PIQ, Common App, Coalition and other rule-setting platforms, keep verified requirement claims in a separate high-priority rules table and never derive current limits solely from historical PDFs. Student-supplied prompts must be matched to current official rules when available.
8. Support four independent existing evaluation prompts and a synthesis reviewer; use knowledge retrieval as supporting evidence, not as an invisible substitution for original rubrics. Store claim IDs with coaching conclusions and expose clickable publisher attribution.
9. Add ingestion tests for duplicates, broken URLs, expired cycles, unlicensed full text, source conflicts, and prompt injection; unit-test that no unapproved guidance is returned; institute ongoing periodic link rechecks.
10. Build a `review_queue` UI that exposes page claims, their pinpoint passages or evidence locations, conflicting statements, review rationale, and explicit approval; require human review before publication of sensitive or application-specific requirements.

## Quality transparency
This seed dataset contains 50 assignments, fewer unique URLs, and a mixture of accessible and failed source links. The generated teaching guides are original editorial extrapolations, not verified source extracts. Do not represent this package as 50 fully vetted and approved sources or 500 distinct resources.
