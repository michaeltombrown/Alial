import test from 'node:test';
import assert from 'node:assert';
import { runPipeline, analyzerMessage, summarizerMessage } from '../src/pipeline.js';
import { ANALYZERS, SUMMARIZER, INLINE_REVIEW, engineSections } from '../src/analyzers.js';
import { getEssayType, ESSAY_TYPES } from '../src/essayTypes.js';
import { splitParagraphs, parseInlineReview } from '../src/inline.js';
import { PROMPTS } from '../src/generated/prompts.js';

const essay = 'word '.repeat(60).trim();
const input = () => ({ type: getEssayType('common-app'), essay, wordLimit: 650, prompt: '', college: 'Brown', length: 'medium' });
const analyzerSystems = new Set(ANALYZERS.map((a) => a.system));

// A fake model that answers each kind of call appropriately and records every call.
function fakeModel({ failOn = () => false, inlineJson } = {}) {
  const calls = [];
  const complete = async (c) => {
    calls.push(c);
    if (failOn(c)) throw new Error('boom');
    if (c.system === INLINE_REVIEW.system) return inlineJson ?? JSON.stringify({ paragraphs: [{ n: 1, purpose: 'p', works: 'w', comments: [{ quote: 'word word', issues: ['i'], suggestions: ['s'] }] }] });
    return `out-${calls.length}`;
  };
  return { calls, complete };
}

test('there are four analyzers numbered as the Engine numbers its reviewers, each with a viewpoint', () => {
  assert.deepStrictEqual(ANALYZERS.map((a) => a.reviewer), [1, 2, 3, 4]);
  assert.deepStrictEqual(ANALYZERS.map((a) => a.id), ['rubric', 'evaluator', 'coach', 'admissions']);
  assert.strictEqual(new Set(ANALYZERS.map((a) => a.system)).size, 4);
  ANALYZERS.forEach((a) => {
    assert.ok(a.system.length > 1000, a.id);
    assert.ok(a.angle && a.angle.length > 60, `${a.id} angle`);
  });
  assert.strictEqual(new Set(ANALYZERS.map((a) => a.angle)).size, 4, 'viewpoints must differ');
});

test('every essay type has a positive word limit', () => {
  ESSAY_TYPES.forEach((t) => assert.ok(t.limit > 0 && t.focus && t.label));
});

test('runs four analyses and the in-line review, then the summarizer last', async () => {
  const { calls, complete } = fakeModel();
  const events = [];
  const { summary, reports } = await runPipeline({ complete, summarizer: { system: 'SUM' }, input: input(), emit: (e) => events.push(e) });

  assert.strictEqual(calls.length, 6);
  assert.strictEqual(calls.filter((c) => analyzerSystems.has(c.system)).length, 4);
  assert.strictEqual(calls.filter((c) => c.system === INLINE_REVIEW.system).length, 1);
  assert.strictEqual(calls.at(-1).system, 'SUM');
  assert.strictEqual(reports.length, 4);
  assert.ok(summary.startsWith('out-'));
  reports.forEach((r) => assert.ok(calls.at(-1).user.includes(r.text)));
  assert.ok(!calls.at(-1).user.includes(essay), 'summarizer never sees the essay');
  assert.deepStrictEqual(events.map((e) => e.type).filter((t) => !['analyzer', 'inline'].includes(t)), ['start', 'summary_start', 'summary', 'done']);
  assert.strictEqual(events.at(-1).type, 'done', 'done comes after everything, including the in-line review');
  assert.ok(events.some((e) => e.type === 'inline' && e.status === 'done'));
  const start = events[0];
  assert.ok(start.summaryAngle && start.inlineAngle && start.analyzers.every((a) => a.angle && a.reviewer));
});

test('the four analyses and the in-line review never see each other\'s output', async () => {
  const { calls, complete } = fakeModel();
  await runPipeline({ complete, summarizer: { system: 'SUM' }, input: input(), emit: () => {} });
  const firstFive = calls.slice(0, 5);
  assert.ok(firstFive.every((c) => !c.user.includes('out-')), 'first-pass calls contain no model output');
  assert.ok(!calls.at(-1).user.includes('"paragraphs"'), 'the in-line review is not an input to the summary');
});

test('continues with remaining reviewers when one fails, and discloses the missing reviewer to the summarizer', async () => {
  const { calls, complete } = fakeModel({ failOn: (c) => c.system === ANALYZERS[1].system });
  const events = [];
  const { reports } = await runPipeline({ complete, summarizer: { system: 'SUM' }, input: input(), emit: (e) => events.push(e) });
  assert.strictEqual(reports.filter((r) => r.error).length, 1);
  assert.ok(events.some((e) => e.type === 'analyzer' && e.status === 'error' && e.id === ANALYZERS[1].id));
  assert.ok(!JSON.stringify(events).includes('boom'), 'internal error text must not reach the client');
  assert.match(calls.at(-1).user, /Reviewer 2 \(Selective-College Evaluator\): no report is available/);
});

test('fails when every reviewer fails', async () => {
  const { complete } = fakeModel({ failOn: (c) => analyzerSystems.has(c.system) });
  await assert.rejects(runPipeline({ complete, summarizer: { system: 'S' }, input: input() }), /All reviewers failed/);
});

test('a failed in-line review does not stop the report', async () => {
  const { complete } = fakeModel({ inlineJson: 'not json at all' });
  const events = [];
  await runPipeline({ complete, summarizer: { system: 'S' }, input: input(), emit: (e) => events.push(e) });
  assert.ok(events.some((e) => e.type === 'inline' && e.status === 'error'));
  assert.strictEqual(events.at(-1).type, 'done');
});

test('flags essays over the word limit', () => {
  assert.match(analyzerMessage({ ...input(), wordLimit: 20, wordCount: 60 }), /40 OVER the limit/);
});

test('the student\'s prompt and context reach every reviewer', () => {
  const msg = analyzerMessage({ ...input(), prompt: 'Why do you want to attend Brown?', wordCount: 60 });
  assert.match(msg, /Application prompt and context from the student: Why do you want to attend Brown\?/);
});

test('summarizer gets the analyses, the length, and submission facts, never the essay', () => {
  const reports = [
    { reviewer: 1, name: 'A', text: 'analysis-a' },
    { reviewer: 2, name: 'B', error: 'e' },
    { reviewer: 3, name: 'C', text: 'analysis-c' },
  ];
  const facts = { ...input(), prompt: 'Q?', wordCount: 700 };
  const msg = summarizerMessage(reports, 'short', facts);
  assert.ok(msg.includes('Reviewer 1 (A) analysis:') && msg.includes('analysis-a') && msg.includes('analysis-c'));
  assert.match(msg, /Reviewer 2 \(B\): no report is available/);
  assert.match(msg, /Requested length: Short/);
  assert.match(msg, /<submission_facts>[\s\S]*Common App Personal Statement[\s\S]*700 against[\s\S]*50 over[\s\S]*Q\?/);
  assert.ok(!msg.includes(essay));
  assert.ok(!msg.includes('Brown'), 'college is only passed for the Why This College type');
  const why = summarizerMessage(reports, 'medium', { ...facts, type: getEssayType('why-college') });
  assert.ok(why.includes('College named by the student: Brown'));
});

test('summary prompt combines the Summary Generator role, the app note, and the Engine synthesis sections', () => {
  const sys = SUMMARIZER.system;
  assert.ok(sys.startsWith(PROMPTS.summarizer), 'Summary Generator prompt comes first and is unaltered');
  assert.ok(sys.includes('APPLICATION-SPECIFIC INSTRUCTIONS FOR THIS SYNTHESIS'));
  for (const n of [1, 3, 5, 7, 8, 9, 10, 11]) assert.match(sys, new RegExp(`^SECTION ${n} \\u2014 `, 'm'), `section ${n} included`);
  for (const n of [2, 4, 6, 12, 13, 14]) assert.doesNotMatch(sys, new RegExp(`^SECTION ${n} \\u2014 `, 'm'), `section ${n} excluded`);
  assert.match(sys, /Do not output a single overall essay quality score/);
  assert.match(sys, /reference only, not an admissions prediction/);
});

test('engineSections extracts whole numbered sections verbatim', () => {
  const text = 'preamble\nSECTION 1 — A\nbody one\nSECTION 2 — B\nbody two\nSECTION 3 — C\nbody three';
  assert.strictEqual(engineSections(text, [1, 3]), 'SECTION 1 — A\nbody one\n\nSECTION 3 — C\nbody three');
  const full = engineSections(PROMPTS['intelligence-engine'], [7]);
  assert.ok(full.startsWith('SECTION 7') && full.includes('Do not simply concatenate the four reports.') && !full.includes('SECTION 8'));
});

test('each analysis gets only the chosen essay type\'s guidance, the summarizer gets none', async () => {
  const { KB } = await import('../src/generated/kb.js');
  const uc = { ...input(), type: getEssayType('uc-piq') };
  const msg = analyzerMessage({ ...uc, wordCount: 60 });
  assert.ok(msg.includes('<essay_type_guidance>') && msg.includes(KB['uc-piq']));
  assert.ok(!msg.includes(KB['common-app']) && !msg.includes(KB['why-college']));
  assert.match(msg, /do not quote it, cite it, or mention it/);

  const { calls, complete } = fakeModel();
  await runPipeline({ complete, summarizer: { system: 'S' }, input: uc, emit: () => {} });
  const first = calls.filter((c) => analyzerSystems.has(c.system) || c.system === INLINE_REVIEW.system);
  assert.strictEqual(first.length, 5);
  assert.ok(first.every((c) => c.user.includes(KB['uc-piq'])));
  assert.ok(!calls.at(-1).user.includes('essay_type_guidance') && !calls.at(-1).user.includes(KB['uc-piq']));
});

test('every essay type has a prompt hint and a guidance entry', async () => {
  const { KB } = await import('../src/generated/kb.js');
  for (const t of ESSAY_TYPES) {
    assert.ok(t.promptHint && t.promptHint.length > 20, `${t.id} promptHint`);
    assert.ok(KB[t.id] && KB[t.id].length > 1200 && KB[t.id].length < 4000, `${t.id} guidance size ${KB[t.id]?.length}`);
    for (const h of ['## The essay', '## What strong', '## Common weaknesses', '## How to calibrate', '## Suggestions worth offering']) {
      assert.ok(KB[t.id].includes(h), `${t.id} missing "${h}"`);
    }
    assert.ok(!/[–—]/.test(KB[t.id]), `${t.id} contains a dash character`);
  }
});

// ---- in-line review
const sample = 'I grew up folding dumplings with my grandmother.\n\nShe never measured anything. I learned to listen instead.\n\nThat is why I want to study linguistics.';

test('splitParagraphs splits on blank lines, falls back to single newlines, and caps the count', () => {
  assert.strictEqual(splitParagraphs(sample).length, 3);
  assert.deepStrictEqual(splitParagraphs('one\ntwo\nthree'), ['one', 'two', 'three']);
  assert.deepStrictEqual(splitParagraphs('  one long block  '), ['one long block']);
  assert.strictEqual(splitParagraphs(Array.from({ length: 60 }, (_, i) => `p${i}`).join('\n\n')).length, 40);
});

test('in-line review keeps the original text from the server, drops quotes that are not in the paragraph, and fills gaps', () => {
  const paras = splitParagraphs(sample);
  const raw = '```json\n' + JSON.stringify({
    paragraphs: [
      { n: 1, purpose: 'Opens with a scene', works: 'Concrete', comments: [{ quote: 'folding dumplings with my grandmother', issues: ['Stays at surface level'], suggestions: ['Add one detail of the kitchen', 'Ask what you noticed'] }] },
      { n: 2, comments: [{ quote: 'this quote was invented by the model', issues: ['Vague'], suggestions: ['Name a moment'] }, { quote: 'x', issues: [], suggestions: [] }] },
    ],
  }) + '\n```';
  const out = parseInlineReview(raw, paras);
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out.map((p) => p.text), paras);
  assert.strictEqual(out[0].comments[0].quote, 'folding dumplings with my grandmother');
  assert.strictEqual(out[0].comments[0].suggestions.length, 2);
  assert.strictEqual(out[1].comments.length, 1, 'comments with no issues or suggestions are dropped');
  assert.strictEqual(out[1].comments[0].quote, '', 'an unverifiable quote is never shown as original text');
  assert.deepStrictEqual(out[2].comments, [], 'a paragraph the model skipped still appears');
  // curly quotes and spacing differences still match
  const curly = parseInlineReview(JSON.stringify({ paragraphs: [{ n: 1, comments: [{ quote: 'It’s   fine', issues: ['i'], suggestions: ['s'] }] }] }), ["it's fine and plain"]);
  assert.strictEqual(curly[0].comments[0].quote, 'It’s   fine');
  assert.throws(() => parseInlineReview('no json here', paras), /not valid JSON/);
  assert.throws(() => parseInlineReview('{"x":1}', paras), /no paragraphs/);
});

test('in-line review prompt forbids rewriting and invented details', () => {
  assert.match(INLINE_REVIEW.system, /Never write a replacement paragraph/);
  assert.match(INLINE_REVIEW.system, /Never invent events, dialogue, emotions/);
  assert.match(INLINE_REVIEW.system, /exact, contiguous sentence or phrase/);
});

test('summarizer is the Summary Generator prompt', () => assert.match(SUMMARIZER.system, /Summary Generator/));
