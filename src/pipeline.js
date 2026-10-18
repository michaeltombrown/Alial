import { ANALYZERS, INLINE_REVIEW, SUMMARY_ANGLE, INLINE_ANGLE } from './analyzers.js';
import { countWords } from './text.js';
import { KB, RULES } from './generated/kb.js';
import { splitParagraphs, inlineMessage, parseInlineReview } from './inline.js';

const NO_PROMPT = 'Not supplied. Proceed with reasonable assumptions and state them.';

function describeContext({ type, prompt, college, wordLimit, wordCount }) {
  const lines = [
    `Essay type: ${type.label}`,
    `Evaluation focus: ${type.focus}`,
    `Word limit: ${wordLimit}. This essay is ${wordCount} words${wordCount > wordLimit ? ` (${wordCount - wordLimit} OVER the limit)` : ''}.`,
    `Application prompt and context from the student: ${prompt || NO_PROMPT}`,
  ];
  if (college) lines.push(`Target college: ${college}`);
  return lines.join('\n');
}

const RULES_NOTE =
  'Requirement notes for this essay type are in <requirement_notes>. They come from a source audit that is not yet approved for production, so treat them as pointers to verify, never as authority. Never cite or name the sources, and tell the student to confirm requirements on the official site. If the student supplied a prompt or limit that differs, say so and follow what the student supplied.';

// Guidance and requirement notes for an essay type, as prompt lines. Used by the analyses and the in-line review only.
export function knowledgeLines(typeId) {
  const guidance = KB[typeId];
  const rules = RULES[typeId] || [];
  return [
    ...(guidance ? [GUIDANCE_NOTE, '', '<essay_type_guidance>', guidance, '</essay_type_guidance>', ''] : []),
    ...(rules.length
      ? [
          RULES_NOTE,
          '',
          '<requirement_notes>',
          ...rules.map((r) => `- ${r.text}${r.requiresCurrentCheck ? ' (Historical source: confirm against the current instructions.)' : ''}`),
          '</requirement_notes>',
          '',
        ]
      : []),
  ];
}

const GUIDANCE_NOTE =
  'Reference guidance for this essay type is in <essay_type_guidance>. Use it to calibrate how you apply your instructions to this kind of essay and to tailor your suggestions. It supplements your instructions and never overrides them. It is editorial guidance, not official fact: do not quote it, cite it, or mention it, and tell the student to verify school-specific details and deadlines on the official sites.';

export function analyzerMessage(input) {
  return [
    'A student has submitted the essay below. Evaluate it now, following your instructions in full. Do not ask for more information first.',
    '',
    ...knowledgeLines(input.type.id),
    '<context>',
    describeContext(input),
    '</context>',
    '',
    '<essay>',
    input.essay,
    '</essay>',
  ].join('\n');
}

// Summary length is the user's choice. The sections it refers to are defined in prompts/synthesis-integration.txt.
export const SUMMARY_LENGTHS = {
  short: 'Short: the compact report. Overall Evaluation in at most three sentences, Scores at a Glance, one line per strength and per improvement, a three-step Revision Sequence, and the Writing Integrity Reminder.',
  medium: 'Medium: every section of the report, concise.',
  detailed:
    'Detailed: every section of the report in full, with the finding category, agreement status, impact, confidence, and authenticity risk for each improvement, and every conflict and minority finding.',
};

// What the summarizer is told about the submission. It never receives the essay text.
function submissionFacts({ type, prompt, college, wordLimit, wordCount }) {
  const lines = [
    `Essay type: ${type.label}`,
    `Word count: ${wordCount} against an application default limit of ${wordLimit}${wordCount > wordLimit ? ` (${wordCount - wordLimit} over)` : ''}`,
    `Prompt or context supplied by the student: ${prompt || 'None supplied'}`,
  ];
  // School-specific analysis is enabled only for the Why This College type.
  if (college && type.id === 'why-college') lines.push(`College named by the student: ${college}`);
  return lines.join('\n');
}

// The summarizer sees only the four analyses and the submission facts, never the essay itself.
export function summarizerMessage(reports, length = 'medium', input) {
  const text = reports
    .map((r) =>
      r.error
        ? `Reviewer ${r.reviewer} (${r.name}): no report is available because this reviewer failed.`
        : `Reviewer ${r.reviewer} (${r.name}) analysis:\n\n${r.text}`,
    )
    .join('\n\n---\n\n');
  return [
    `Requested length: ${SUMMARY_LENGTHS[length] || SUMMARY_LENGTHS.medium}`,
    '',
    ...(input ? ['<submission_facts>', submissionFacts(input), '</submission_facts>', ''] : []),
    '<text>',
    text,
    '</text>',
  ].join('\n');
}

/**
 * Runs the four analyses and the in-line review in parallel, then the summarizer over the four analyses.
 * `emit` receives progress events so a UI can stream them.
 */
export async function runPipeline({ complete, summarizer, input, emit = () => {}, signal, inline = INLINE_REVIEW }) {
  const paragraphs = splitParagraphs(input.essay);
  input = { ...input, wordCount: countWords(input.essay) };
  emit({
    type: 'start',
    analyzers: ANALYZERS.map(({ id, name, tagline, angle, reviewer }) => ({ id, name, tagline, angle, reviewer })),
    summaryAngle: SUMMARY_ANGLE,
    inlineAngle: INLINE_ANGLE,
  });

  // The in-line review is independent of the four analyses and of the summary.
  const inlinePromise = (async () => {
    try {
      const raw = await complete({
        system: inline.system,
        user: inlineMessage({ describe: describeContext(input), knowledge: knowledgeLines(input.type.id), paragraphs }),
        signal,
      });
      emit({ type: 'inline', status: 'done', paragraphs: parseInlineReview(raw, paragraphs) });
    } catch (err) {
      if (signal?.aborted) throw err;
      console.error('[alial] in-line review failed:', err.message);
      emit({ type: 'inline', status: 'error', error: 'The in-line review could not be completed.' });
    }
  })();

  inlinePromise.catch(() => {}); // handled again where it is awaited below

  const user = analyzerMessage(input);
  const reports = await Promise.all(
    ANALYZERS.map(async ({ id, name, reviewer, system }) => {
      try {
        const text = await complete({ system, user, signal });
        emit({ type: 'analyzer', id, status: 'done', text });
        return { id, name, reviewer, text };
      } catch (err) {
        if (signal?.aborted) throw err;
        console.error(`[alial] analyzer ${id} failed:`, err.message);
        emit({ type: 'analyzer', id, status: 'error', error: 'This reviewer could not complete its analysis.' });
        return { id, name, reviewer, error: err.message };
      }
    }),
  );

  const ok = reports.filter((r) => !r.error);
  if (ok.length === 0) {
    await inlinePromise;
    throw new Error('All reviewers failed. Please try again.');
  }

  emit({ type: 'summary_start', reviewersUsed: ok.length });
  const summary = await complete({ system: summarizer.system, user: summarizerMessage(reports, input.length, input), signal });
  emit({ type: 'summary', text: summary });
  await inlinePromise;
  emit({ type: 'done' });
  return { reports, summary };
}
