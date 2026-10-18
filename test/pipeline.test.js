import test from 'node:test';
import assert from 'node:assert';
import { runPipeline, analyzerMessage, summarizerMessage } from '../src/pipeline.js';
import { ANALYZERS, SUMMARIZER, INLINE_REVIEW, engineSections } from '../src/analyzers.js';
import { getEssayType, ESSAY_TYPES } from '../src/essayTypes.js';
import { splitParagraphs, parseInlineReview, inlineMessage } from '../src/inline.js';
import { runSummary, inlineForSummary } from '../src/pipeline.js';
import { findUnverifiedQuotes } from '../src/quotes.js';
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
    if (c.system === INLINE_REVIEW.system) return inlineJson ?? JSON.stringify({ arc: 'the arc', paragraphs: [{ n: 1, role: 'r', flow: 'f', issues: ['i'], suggestions: ['s'], focus: 'word word' }] });
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
  assert.ok(calls.at(-1).user.includes(essay), 'the summarizer reads the essay');
  assert.ok(calls.at(-1).user.includes('<inline_review>') && calls.at(-1).user.includes('the arc'), 'and the in-line review');
  assert.deepStrictEqual(events.map((e) => e.type).filter((t) => t !== 'analyzer'), ['start', 'inline', 'summary_start', 'summary', 'done']);
  assert.ok(events.some((e) => e.type === 'inline' && e.status === 'done'));
  const start = events[0];
  assert.ok(start.summaryAngle && start.inlineAngle && start.analyzers.every((a) => a.angle && a.reviewer));
});

test('the four analyses and the in-line review never see each other\'s output', async () => {
  const { calls, complete } = fakeModel();
  await runPipeline({ complete, summarizer: { system: 'SUM' }, input: input(), emit: () => {} });
  const firstFive = calls.slice(0, 5);
  assert.ok(firstFive.every((c) => !c.user.includes('out-') && !c.user.includes('the arc')), 'first-pass calls contain no model output');
  assert.ok(calls.at(-1).user.includes('the arc'), 'the summary does read the in-line review');
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

test('the summarizer reads the essay and context first, then the analyses and the in-line review, and nothing else', async () => {
  const { KB } = await import('../src/generated/kb.js');
  const reports = [
    { reviewer: 1, name: 'A', text: 'analysis-a' },
    { reviewer: 2, name: 'B', error: 'e' },
    { reviewer: 3, name: 'C', text: 'analysis-c' },
  ];
  const facts = { ...input(), type: getEssayType('uc-piq'), prompt: 'Describe your leadership.', wordCount: 400, wordLimit: 350 };
  const inline = { status: 'done', arc: 'the arc', synthetic: false, paragraphs: [{ n: 1, reviewed: true, role: 'sets up', flow: 'leads on', issues: ['thin'], suggestions: ['add detail'], focus: 'word word' }] };
  const msg = summarizerMessage(reports, 'short', facts, inline);
  // order: facts, essay, in-line review, then the four analyses
  const at = (t) => msg.indexOf(t);
  assert.ok(at('<submission_facts>') < at('<essay>') && at('<essay>') < at('<inline_review>') && at('<inline_review>') < at('<text>'));
  assert.ok(msg.includes(essay), 'the essay is included');
  assert.match(msg, /<submission_facts>[\s\S]*UC Personal Insight Question[\s\S]*400 against[\s\S]*50 over[\s\S]*Describe your leadership\./);
  assert.match(msg, /College named by the student: Brown/);
  assert.ok(msg.includes('Reviewer 1 (A) analysis:') && msg.includes('analysis-a') && msg.includes('analysis-c'));
  assert.match(msg, /Reviewer 2 \(B\): no report is available/);
  assert.match(msg, /Requested length: Short/);
  assert.match(msg, /Passage it points to: "word word"/);
  assert.match(msg, /Issue: thin/);
  assert.match(msg, /These four sources are the only information you may use/);
  // nothing from outside the four sources
  assert.ok(!msg.includes('essay_type_guidance') && !msg.includes('requirement_notes') && !msg.includes(KB['uc-piq'].slice(0, 80)));
  assert.ok(!/https?:\/\//.test(msg));
  assert.match(summarizerMessage(reports, 'medium', facts, null), /The In-Line Review is not available/);
});

test('the summary prompt states the hard sourcing rule and the read-the-essay-first rule', () => {
  const t = SUMMARIZER.system;
  assert.match(t, /SOURCES: A HARD RULE/);
  assert.match(t, /exactly four sources, and from nothing else/);
  for (const k of ['<essay>', '<submission_facts>', '<text>', '<inline_review>']) assert.ok(t.includes(k), k);
  assert.match(t, /Not stated in the essay, the context, or the reviews\./);
  assert.match(t, /copied exactly from the essay and must appear there/);
  assert.match(t, /READ THE ESSAY FIRST/);
  assert.match(t, /read the whole essay and the context/);
  assert.match(t, /Where a claim is not supported by the essay, say so plainly/);
  assert.doesNotMatch(t, /You do not receive the essay itself/);
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

test('results appear in order: the four analyses, then the in-line review, then the summary last', async () => {
  const { complete } = fakeModel();
  const events = [];
  await runPipeline({ complete, summarizer: { system: 'SUM' }, input: input(), emit: (e) => events.push(e) });
  const at = (pred) => events.findIndex(pred);
  const lastAnalyzer = events.map((e, i) => (e.type === 'analyzer' ? i : -1)).filter((i) => i >= 0).at(-1);
  assert.ok(at((e) => e.type === 'inline') > lastAnalyzer, 'in-line review is shown after all four analyses');
  assert.ok(at((e) => e.type === 'summary_start') > at((e) => e.type === 'inline'), 'summary starts after the in-line review');
  assert.ok(at((e) => e.type === 'summary') > at((e) => e.type === 'summary_start'));
  assert.strictEqual(events.at(-1).type, 'done');
});

test('in-line review waits to be shown even when it finishes first', async () => {
  const order = [];
  const { complete } = fakeModel();
  const slow = async (c) => {
    if (analyzerSystems.has(c.system)) await new Promise((r) => setTimeout(r, 30));
    return complete(c);
  };
  await runPipeline({ complete: slow, summarizer: { system: 'S' }, input: input(), emit: (e) => order.push(e.type + (e.id ? `:${e.id}` : '')) });
  assert.ok(order.indexOf('inline') > order.lastIndexOf('analyzer:admissions'));
});

test('a failed summary does not hang or throw: it reports a reason and the analyses are kept', async () => {
  const { calls, complete } = fakeModel({ failOn: (c) => c.system === 'SUM' });
  const events = [];
  const result = await runPipeline({ complete, summarizer: { system: 'SUM' }, input: input(), emit: (e) => events.push(e) });
  assert.strictEqual(result.summary, null);
  assert.strictEqual(result.reports.length, 4);
  const err = events.find((e) => e.type === 'summary_error');
  assert.ok(err && /summary could not be written/i.test(err.error));
  assert.ok(!JSON.stringify(events).includes('boom'));
  assert.strictEqual(events.at(-1).type, 'done');
  assert.strictEqual(calls.at(-1).retries, 5, 'the summary is retried patiently');
});

test('a rate-limited summary gives a friendly reason', async () => {
  const complete = async (c) => {
    if (c.system === 'SUM') throw new Error('Anthropic API 429: rate_limit_error');
    return c.system === INLINE_REVIEW.system ? '{"arc":"a","paragraphs":[]}' : 'ok';
  };
  const events = [];
  await runPipeline({ complete, summarizer: { system: 'SUM' }, input: input(), emit: (e) => events.push(e) });
  assert.match(events.find((e) => e.type === 'summary_error').error, /rate limiting/);
});

test('runSummary alone writes a summary from supplied analyses (the retry path)', async () => {
  const { calls, complete } = fakeModel();
  const events = [];
  const reports = ANALYZERS.map((a) => ({ id: a.id, name: a.name, reviewer: a.reviewer, text: `analysis ${a.id}` }));
  const text = await runSummary({ complete, summarizer: { system: 'SUM' }, reports, input: { ...input(), wordCount: 60 }, inline: null, emit: (e) => events.push(e) });
  assert.ok(text);
  assert.deepStrictEqual(events.map((e) => e.type), ['summary_start', 'summary']);
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].user.includes('analysis rubric') && calls[0].user.includes(essay));
});

// ---- in-line review
const sample = 'I grew up folding dumplings with my grandmother.\n\nShe never measured anything. I learned to listen instead.\n\nThat is why I want to study linguistics.';
const longSentence = 'The summer my grandmother taught me to fold dumplings changed how I listen to the people around me. ';

test('splitParagraphs splits on blank lines, falls back to single newlines, and caps the count', () => {
  assert.strictEqual(splitParagraphs(sample).paragraphs.length, 3);
  assert.strictEqual(splitParagraphs(sample).synthetic, false);
  assert.deepStrictEqual(splitParagraphs('one\ntwo\nthree').paragraphs, ['one', 'two', 'three']);
  assert.deepStrictEqual(splitParagraphs('  one short block  ').paragraphs, ['one short block']);
  assert.strictEqual(splitParagraphs(Array.from({ length: 60 }, (_, i) => `p${i}`).join('\n\n')).paragraphs.length, 40);
});

test('a single long block is divided into sections so the review covers the whole essay', () => {
  const block = longSentence.repeat(30).trim(); // one paragraph, about 500 words
  const { paragraphs, synthetic } = splitParagraphs(block);
  assert.ok(synthetic);
  assert.ok(paragraphs.length >= 4 && paragraphs.length <= 6, `sections: ${paragraphs.length}`);
  assert.strictEqual(paragraphs.join(' ').replace(/\s+/g, ' '), block.replace(/\s+/g, ' '), 'sections add back up to the original text');
  assert.ok(paragraphs.every((p) => p.split(/\s+/).length >= 30), 'no tiny sections');
  const msg = inlineMessage({ describe: 'd', paragraphs, synthetic });
  assert.match(msg, /divided into consecutive sections/);
  assert.ok(msg.includes(`[P${paragraphs.length}]`));
});

test('in-line review parsing: keeps original text, verifies the focus quote, and marks skipped parts as not reviewed', () => {
  const paras = splitParagraphs(sample).paragraphs;
  const raw = '```json\n' + JSON.stringify({
    arc: 'A grandmother scene becomes a reason to study language.',
    paragraphs: [
      { n: 1, role: 'Opens with a scene', flow: 'Sets up the next paragraph', issues: ['Stays at surface level'], suggestions: ['Add one detail of the kitchen', 'Ask what you noticed'], focus: 'folding dumplings with my grandmother' },
      { n: 2, role: 'Turns the scene into an idea', issues: ['Vague'], suggestions: ['Name a moment'], focus: 'a quote the model invented' },
    ],
  }) + '\n```';
  const out = parseInlineReview(raw, paras);
  assert.strictEqual(out.arc, 'A grandmother scene becomes a reason to study language.');
  assert.deepStrictEqual(out.paragraphs.map((p) => p.text), paras);
  assert.strictEqual(out.paragraphs[0].focus, 'folding dumplings with my grandmother');
  assert.strictEqual(out.paragraphs[0].suggestions.length, 2);
  assert.strictEqual(out.paragraphs[1].focus, '', 'an unverifiable quote is never shown as original text');
  assert.strictEqual(out.paragraphs[2].reviewed, false, 'a skipped part is flagged, not shown as having no issues');
  assert.strictEqual(parseInlineReview(JSON.stringify({ paragraphs: [{ n: 1, focus: 'It\u2019s   fine', issues: [], suggestions: ['s'] }] }), ["it's fine and plain"]).paragraphs[0].focus, 'It\u2019s   fine');
  assert.throws(() => parseInlineReview('no json here', paras), /not valid JSON/);
  assert.throws(() => parseInlineReview('{"x":1}', paras), /no paragraphs/);
});

test('when the model skips part of the essay, the pipeline asks once more and uses the more complete answer', async () => {
  const essay3 = sample;
  let inlineCalls = 0;
  const full = (n) => ({ n, role: 'r', flow: 'f', issues: ['i'], suggestions: ['s'], focus: '' });
  const users = [];
  const complete = async (c) => {
    if (c.system !== INLINE_REVIEW.system) return 'ok';
    users.push(c.user);
    return JSON.stringify({ arc: 'a', paragraphs: ++inlineCalls === 1 ? [full(1)] : [full(1), full(2), full(3)] });
  };
  const events = [];
  await runPipeline({ complete, summarizer: { system: 'S' }, input: { ...input(), essay: essay3 + ' ' + 'filler '.repeat(20) }, emit: (e) => events.push(e) });
  const inline = events.find((e) => e.type === 'inline');
  assert.strictEqual(inlineCalls, 2);
  assert.match(users[1], /left out part 2, 3/);
  assert.ok(inline.paragraphs.every((p) => p.reviewed));
});

test('in-line review prompt reads the essay as one piece, stays at paragraph level, and forbids rewriting and invented details', () => {
  const t = INLINE_REVIEW.system;
  assert.match(t, /one continuous piece/);
  assert.match(t, /Do not comment sentence by sentence/);
  assert.match(t, /Do not skip any part, and do not stop early/);
  assert.match(t, /Never write a replacement paragraph/);
  assert.match(t, /Never invent events, dialogue, emotions/);
  assert.match(t, /copied character for character/);
});

test('summarizer is the Summary Generator prompt', () => assert.match(SUMMARIZER.system, /Summary Generator/));

test('requirement notes reach the analyses and the in-line review for the matching type only, and never name or link a source', async () => {
  const { RULES } = await import('../src/generated/kb.js');
  const { calls, complete } = fakeModel();
  await runPipeline({ complete, summarizer: { system: 'S' }, input: { ...input(), type: getEssayType('activity') }, emit: () => {} });
  const first = calls.filter((c) => analyzerSystems.has(c.system) || c.system === INLINE_REVIEW.system);
  assert.strictEqual(first.length, 5);
  for (const c of first) {
    assert.match(c.user, /<requirement_notes>[\s\S]*50 characters[\s\S]*<\/requirement_notes>/);
    assert.match(c.user, /not yet approved for production/);
    assert.ok(!/https?:\/\//.test(c.user), 'no URLs in prompts');
    assert.ok(!/SRC-[0-9A-F]{12}/.test(c.user), 'no source ids in prompts');
    for (const r of RULES.activity) assert.ok(!c.user.includes(r.source.title), 'no source titles in prompts');
  }
  const summaryCall = calls.at(-1);
  assert.ok(!summaryCall.user.includes('requirement_notes') && !summaryCall.user.includes('50 characters'));

  // a different type gets different notes
  const uc = analyzerMessage({ ...input(), type: getEssayType('uc-piq'), wordCount: 60 });
  assert.match(uc, /four of eight Personal Insight Questions/);
  assert.match(uc, /Historical source: confirm against the current instructions/);
  assert.ok(!uc.includes('50 characters'));
  const coalition = analyzerMessage({ ...input(), type: getEssayType('coalition'), wordCount: 60 });
  assert.match(coalition, /six broad essay options/);
});

test('the common app entry does not assert current prompt wording', async () => {
  const { KB } = await import('../src/generated/kb.js');
  assert.match(KB['common-app'], /never assert the text of a current prompt/);
  assert.match(analyzerMessage({ ...input(), wordCount: 60 }), /Do not assert the text of any current prompt/);
});

test('quoted passages in the summary are checked against the essay and the other sources', async () => {
  const sources = ['The summer my grandmother taught me to fold dumplings changed how I listen.', 'Reviewer note: the opening is concrete and specific.'];
  const text = 'It opens with \u201cThe summer my grandmother taught me to fold dumplings changed how I listen\u201d, and the phrase \u201ca line that the model invented without any source at all\u201d. Short quote \u201cchanged how\u201d is ignored. With ellipsis: \u201cthe summer my grandmother taught me ... changed how I listen\u201d.';
  assert.deepStrictEqual(findUnverifiedQuotes(text, sources), ['a line that the model invented without any source at all']);
  assert.deepStrictEqual(findUnverifiedQuotes('No quotes here.', sources), []);
  assert.deepStrictEqual(findUnverifiedQuotes('\u201cTHE SUMMER MY GRANDMOTHER taught me to fold dumplings\u201d', sources), [], 'case and punctuation do not matter');

  const events = [];
  const complete = async () => 'Strength: \u201cthis passage does not exist anywhere in the essay or reports\u201d.';
  await runSummary({ complete, summarizer: { system: 'S' }, reports: [{ id: 'rubric', name: 'A', reviewer: 1, text: 'fine' }], input: { ...input(), wordCount: 60 }, inline: null, emit: (e) => events.push(e) });
  assert.deepStrictEqual(events.find((e) => e.type === 'summary').unverifiedQuotes, ['this passage does not exist anywhere in the essay or reports']);
});

test('inlineForSummary leaves out paragraph text, flags unreviewed parts, and handles a missing review', () => {
  assert.match(inlineForSummary(null), /not available/);
  assert.match(inlineForSummary({ status: 'error' }), /not available/);
  const text = inlineForSummary({ status: 'done', arc: 'A', synthetic: true, paragraphs: [{ n: 1, reviewed: false }, { n: 2, reviewed: true, role: 'r', flow: 'f', issues: [], suggestions: ['s'], focus: '', text: 'SECRET PARAGRAPH TEXT' }] });
  assert.match(text, /Section 1: not reviewed/);
  assert.match(text, /Section 2:\n- Role: r/);
  assert.ok(!text.includes('SECRET PARAGRAPH TEXT'));
});

test('the summary streams as summary_delta events, which add up to the final text', async () => {
  const events = [];
  const reports = ANALYZERS.map((a) => ({ id: a.id, name: a.name, reviewer: a.reviewer, text: `analysis ${a.id}` }));
  const complete = async ({ onText, onRestart }) => {
    onRestart?.();
    for (const part of ['Overall ', 'Evaluation ', 'text.']) onText(part);
    return 'Overall Evaluation text.';
  };
  await runSummary({ complete, summarizer: { system: 'SUM' }, reports, input: { ...input(), wordCount: 60 }, inline: null, emit: (e) => events.push(e) });
  const deltas = events.filter((e) => e.type === 'summary_delta').map((e) => e.text).join('');
  assert.strictEqual(deltas, 'Overall Evaluation text.');
  const types = events.map((e) => e.type);
  assert.ok(types.indexOf('summary_delta') < types.indexOf('summary'));
});
