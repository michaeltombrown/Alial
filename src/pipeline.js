const { ANALYZERS } = require('./analyzers');
const { countWords } = require('./extract');

function describeContext({ type, prompt, college, wordLimit, wordCount }) {
  const lines = [
    `Essay type: ${type.label}`,
    `Evaluation focus: ${type.focus}`,
    `Word limit: ${wordLimit}. This essay is ${wordCount} words${wordCount > wordLimit ? ` (${wordCount - wordLimit} OVER the limit)` : ''}.`,
    `Application prompt: ${prompt || 'Not supplied. Proceed with reasonable assumptions and state them.'}`,
  ];
  if (college) lines.push(`Target college: ${college}`);
  return lines.join('\n');
}

function analyzerMessage(input) {
  return [
    'A student has submitted the essay below. Evaluate it now, following your instructions in full. Do not ask for more information first.',
    '',
    '<context>',
    describeContext(input),
    '</context>',
    '',
    '<essay>',
    input.essay,
    '</essay>',
  ].join('\n');
}

function summarizerMessage(input, reports) {
  const blocks = reports.map(
    (r) => `<report reviewer="${r.name}" status="${r.error ? 'failed' : 'ok'}">\n${r.error ? '(This reviewer failed to produce a report.)' : r.text}\n</report>`,
  );
  return [
    'Synthesize the reviewers\' reports below into the final report for the student.',
    '',
    '<context>',
    describeContext(input),
    '</context>',
    '',
    '<essay>',
    input.essay,
    '</essay>',
    '',
    ...blocks,
  ].join('\n');
}

/**
 * Runs every analyzer in parallel, then the summarizer over their results.
 * `emit` receives progress events so a UI can stream them.
 */
async function runPipeline({ complete, summarizer, input, emit = () => {}, signal }) {
  input = { ...input, wordCount: countWords(input.essay) };
  emit({ type: 'start', analyzers: ANALYZERS.map(({ id, name, tagline }) => ({ id, name, tagline })) });

  const user = analyzerMessage(input);
  const reports = await Promise.all(
    ANALYZERS.map(async ({ id, name, system }) => {
      try {
        const text = await complete({ system, user, signal });
        emit({ type: 'analyzer', id, status: 'done', text });
        return { id, name, text };
      } catch (err) {
        if (signal?.aborted) throw err;
        console.error(`[alial] analyzer ${id} failed:`, err.message);
        emit({ type: 'analyzer', id, status: 'error', error: 'This reviewer could not complete its analysis.' });
        return { id, name, error: err.message };
      }
    }),
  );

  const ok = reports.filter((r) => !r.error);
  if (ok.length === 0) throw new Error('All reviewers failed. Please try again.');

  emit({ type: 'summary_start', reviewersUsed: ok.length });
  const summary = await complete({ system: summarizer.system, user: summarizerMessage(input, reports), signal });
  emit({ type: 'summary', text: summary });
  emit({ type: 'done' });
  return { reports, summary };
}

module.exports = { runPipeline, analyzerMessage, summarizerMessage };
