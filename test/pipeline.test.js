import test from 'node:test';
import assert from 'node:assert';
import { runPipeline, analyzerMessage, summarizerMessage } from '../src/pipeline.js';
import { ANALYZERS, SUMMARIZER } from '../src/analyzers.js';
import { getEssayType, ESSAY_TYPES } from '../src/essayTypes.js';

const essay = 'word '.repeat(60).trim();
const input = () => ({ type: getEssayType('common-app'), essay, wordLimit: 650, prompt: '', college: 'Brown', length: 'medium' });

test('there are four analyzers with distinct, non-empty prompts', () => {
  assert.strictEqual(ANALYZERS.length, 4);
  assert.strictEqual(new Set(ANALYZERS.map((a) => a.system)).size, 4);
  ANALYZERS.forEach((a) => assert.ok(a.system.length > 1000, a.id));
});

test('every essay type has a positive word limit', () => {
  ESSAY_TYPES.forEach((t) => assert.ok(t.limit > 0 && t.focus && t.label));
});

test('runs all four analyzers then the summarizer, in that order', async () => {
  const calls = [];
  const complete = async ({ system, user }) => {
    calls.push({ system, user });
    return `out-${calls.length}`;
  };
  const events = [];
  const { summary, reports } = await runPipeline({ complete, summarizer: { system: 'SUM' }, input: input(), emit: (e) => events.push(e) });

  assert.strictEqual(calls.length, 5);
  assert.strictEqual(calls[4].system, 'SUM');
  assert.strictEqual(reports.length, 4);
  assert.strictEqual(summary, 'out-5');
  reports.forEach((r) => assert.ok(calls[4].user.includes(r.text)));
  assert.ok(!calls[4].user.includes(essay));
  assert.deepStrictEqual(events.map((e) => e.type).filter((t) => t !== 'analyzer'), ['start', 'summary_start', 'summary', 'done']);
  assert.ok(calls[0].user.includes('<essay>') && calls[0].user.includes('Target college: Brown'));
});

test('continues with remaining reviewers when one fails', async () => {
  let n = 0;
  const complete = async ({ system }) => {
    if (system === ANALYZERS[1].system) throw new Error('boom');
    return `ok-${++n}`;
  };
  const events = [];
  const { reports } = await runPipeline({ complete, summarizer: { system: 'SUM' }, input: input(), emit: (e) => events.push(e) });
  assert.strictEqual(reports.filter((r) => r.error).length, 1);
  assert.ok(events.some((e) => e.type === 'analyzer' && e.status === 'error' && e.id === ANALYZERS[1].id));
  assert.ok(!JSON.stringify(events).includes('boom'), 'internal error text must not reach the client');
});

test('fails when every reviewer fails', async () => {
  await assert.rejects(
    runPipeline({ complete: async () => { throw new Error('x'); }, summarizer: { system: 'S' }, input: input() }),
    /All reviewers failed/,
  );
});

test('flags essays over the word limit', () => {
  assert.match(analyzerMessage({ ...input(), wordLimit: 20, wordCount: 60 }), /40 OVER the limit/);
});

test('the student\'s prompt and context reach every reviewer', () => {
  const msg = analyzerMessage({ ...input(), prompt: 'Why do you want to attend Brown?', wordCount: 60 });
  assert.match(msg, /Application prompt and context from the student: Why do you want to attend Brown\?/);
});

test('summarizer receives only the analyses and the length choice, never the essay', () => {
  const reports = [{ name: 'A', text: 'analysis-a' }, { name: 'B', error: 'e' }, { name: 'C', text: 'analysis-c' }];
  const msg = summarizerMessage(reports, 'short');
  assert.ok(msg.includes('analysis-a') && msg.includes('analysis-c'));
  assert.ok(!msg.includes('B analysis'), 'failed reviewers are left out');
  assert.match(msg, /Requested length: Short/);
  assert.ok(!msg.includes(essay) && !msg.includes('Brown'));
});

test('summarizer is the Summary Generator prompt', () => assert.match(SUMMARIZER.system, /Summary Generator/));
