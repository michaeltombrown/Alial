// Loads and validates the essay knowledge base source register (kb/data) and the requirement notes (kb/rules.json).
// Used by the build (which fails on any problem) and by the tests.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ESSAY_TYPES } from '../src/essayTypes.js';

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); if (row.some((v) => v.trim())) rows.push(row); }
  return rows;
}

const jsonl = (file) => readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const bool = (v) => String(v).trim().toLowerCase() === 'true';

export function loadRegistry(root) {
  const dir = path.join(root, 'kb/data');
  const sources = jsonl(path.join(dir, 'sources.jsonl'));
  const guides = jsonl(path.join(dir, 'teaching_guides.jsonl'));
  const [header, ...rest] = parseCsv(readFileSync(path.join(dir, 'source_assignments.csv'), 'utf8').replace(/^﻿/, ''));
  const assignments = rest.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
  const rules = JSON.parse(readFileSync(path.join(root, 'kb/rules.json'), 'utf8')).rules;
  return { sources, guides, assignments, rules };
}

const INJECTION = /ignore (all |any )?(previous|prior|above) (instructions|rules)|disregard (the )?(system|previous)|you are now|reveal (the |your )?system prompt/i;
const MAX_SUMMARY_CHARS = 1500; // summaries and commentary only; never third-party full text

// Returns a list of problems. An empty list means the register is consistent.
export function validateRegistry({ sources, guides, assignments, rules }) {
  const problems = [];
  const labels = new Map(ESSAY_TYPES.map((t) => [t.label, t.id]));
  const ids = new Set(sources.map((s) => s.resource_id));
  const byId = new Map(sources.map((s) => [s.resource_id, s]));

  if (ids.size !== sources.length) problems.push('duplicate resource_id in sources.jsonl');
  if (new Set(sources.map((s) => s.canonical_url)).size !== sources.length) problems.push('duplicate canonical_url in sources.jsonl');

  for (const s of sources) {
    if (!/^https:\/\//.test(s.canonical_url)) problems.push(`${s.resource_id}: URL is not https`);
    if (!s.verification_status) problems.push(`${s.resource_id}: missing verification_status`);
    if (s.approved_for_production === true) problems.push(`${s.resource_id}: sources start quarantined; approval needs the three-pass review workflow`);
    if (String(s.detailed_summary).length > MAX_SUMMARY_CHARS) problems.push(`${s.resource_id}: summary too long, may contain third-party full text`);
    if (INJECTION.test(JSON.stringify(s))) problems.push(`${s.resource_id}: instruction-like text in a record`);
    if (!/full-text not embedded/i.test(s.rights || '')) problems.push(`${s.resource_id}: rights note must state that full text is not embedded`);
  }

  const perType = {};
  for (const a of assignments) {
    const type = labels.get(a.essay_type);
    if (!type) { problems.push(`${a.assignment_id}: unknown essay type "${a.essay_type}"`); continue; }
    perType[type] = (perType[type] || 0) + 1;
    const src = byId.get(a.resource_id);
    if (!src) { problems.push(`${a.assignment_id}: unknown resource ${a.resource_id}`); continue; }
    if (src.canonical_url !== a.url) problems.push(`${a.assignment_id}: URL differs from source record`);
    if (src.verification_status !== a.verification_status) problems.push(`${a.assignment_id}: status differs from source record`);
    if (bool(a.approved_for_production) && !bool(a.three_pass_vetting_complete)) problems.push(`${a.assignment_id}: approved without three-pass vetting`);
    if (a.verification_status === 'FETCH_FAILED_OR_404' && a.allowed_use !== 'NONE_PENDING_REVERIFICATION') problems.push(`${a.assignment_id}: failed source must not be usable`);
    if (a.source_scope === 'SCHOOL_SPECIFIC' && a.allowed_use === 'OFFICIAL_REQUIREMENTS_IF_CURRENT; OTHER_PRINCIPLES_CONTEXTUAL') problems.push(`${a.assignment_id}: school-specific source marked as official requirements`);
    for (const f of ['detailed_summary', 'transferable_principle', 'coaching_exercise', 'guardrails']) {
      if (String(a[f]).length > MAX_SUMMARY_CHARS) problems.push(`${a.assignment_id}: ${f} too long`);
      if (INJECTION.test(a[f])) problems.push(`${a.assignment_id}: instruction-like text in ${f}`);
    }
  }
  for (const t of ESSAY_TYPES) if (!perType[t.id]) problems.push(`no source assignments for ${t.id}`);

  for (const g of guides) {
    if (!ids.has(g.source_id)) problems.push(`${g.id}: unknown source ${g.source_id}`);
    if (!labels.has(g.essay_type)) problems.push(`${g.id}: unknown essay type`);
    if (g.production_approved === true) problems.push(`${g.id}: guides start quarantined`);
    if (!/not a quotation/i.test(g.origin || '')) problems.push(`${g.id}: origin must state it is not a quotation`);
    if (INJECTION.test(JSON.stringify(g))) problems.push(`${g.id}: instruction-like text`);
  }

  const ruleIds = new Set();
  for (const r of rules) {
    if (ruleIds.has(r.id)) problems.push(`${r.id}: duplicate rule id`);
    ruleIds.add(r.id);
    const src = byId.get(r.resourceId);
    if (!src) { problems.push(`${r.id}: unknown source ${r.resourceId}`); continue; }
    if (src.verification_status === 'FETCH_FAILED_OR_404') problems.push(`${r.id}: cites a source that could not be opened`);
    if (src.source_scope === 'SCHOOL_SPECIFIC') problems.push(`${r.id}: rules must be school-neutral`);
    if (/HISTORICAL/.test(src.verification_status) && !r.requiresCurrentCheck) problems.push(`${r.id}: historical source needs requiresCurrentCheck`);
    for (const t of r.essayTypes) if (!ESSAY_TYPES.some((e) => e.id === t)) problems.push(`${r.id}: unknown essay type ${t}`);
    if (INJECTION.test(r.text)) problems.push(`${r.id}: instruction-like text`);
  }
  return problems;
}
