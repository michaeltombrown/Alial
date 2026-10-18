import { ANALYZERS } from './analyzers.js';
import { countWords } from './text.js';

function describeContext({ type, prompt, college, wordLimit, wordCount }) {
  const lines = [
    `Essay type: ${type.label}`,
    `Evaluation focus: ${type.focus}`,
    `Word limit: ${wordLimit}. This essay is ${wordCount} words${wordCount > wordLimit ? ` (${wordCount - wordLimit} OVER the limit)` : ''}.`,
    `Application prompt and context from the student: ${prompt || 'Not supplied. Proceed with reasonable assumptions and state them.'}`,
  ];
  if (college) lines.push(`Target college: ${college}`);
  return lines.join('\n');
}

export function analyzerMessage(input) {
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

// Summary length is the user's choice; the Summary Generator prompt adapts to it.
export const SUMMARY_LENGTHS = {
  short: 'Short: a Summary of 2 to 3 sentences, 3 Key Takeaways, and a one-sentence Conclusion.',
  medium: 'Medium: a Summary of one short paragraph, 4 to 6 Key Takeaways, and a brief Conclusion.',
  detailed:
    'Detailed: a Summary of 2 to 3 paragraphs, 6 to 10 Key Takeaways grouped logically with every important score, number, and name, and a Conclusion.',
};

// The summarizer sees only the four analyses, never the essay itself.
export function summarizerMessage(reports, length = 'medium') {
  const text = reports
    .filter((r) => !r.error)
    .map((r) => `${r.name} analysis:\n\n${r.text}`)
    .join('\n\n---\n\n');
  return `Requested length: ${SUMMARY_LENGTHS[length] || SUMMARY_LENGTHS.medium}\n\n<text>\n${text}\n</text>`;
}

/**
 * Runs every analyzer in parallel, then the summarizer over their results.
 * `emit` receives progress events so a UI can stream them.
 */
export async function runPipeline({ complete, summarizer, input, emit = () => {}, signal }) {
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
  const summary = await complete({ system: summarizer.system, user: summarizerMessage(reports, input.length), signal });
  emit({ type: 'summary', text: summary });
  emit({ type: 'done' });
  return { reports, summary };
}

