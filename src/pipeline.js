import { ANALYZERS, INLINE_REVIEW, SUMMARY_ANGLE, INLINE_ANGLE } from './analyzers.js';
import { countWords } from './text.js';
import { KB, RULES } from './generated/kb.js';
import { splitParagraphs, inlineMessage, parseInlineReview, missingParts } from './inline.js';
import { describeFailure } from './model.js';
import { findUnverifiedQuotes } from './quotes.js';

const SUMMARY_MAX_TOKENS = 32000; // the detailed report is long; the default cap cut it off
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
  if (college) lines.push(`College named by the student: ${college}`);
  return lines.join('\n');
}

// The in-line review as the summarizer reads it. Original paragraph text is left out: the summarizer has the essay itself.
export function inlineForSummary(inline) {
  if (!inline || inline.status !== 'done') return 'The In-Line Review is not available for this essay.';
  const unit = inline.synthetic ? 'Section' : 'Paragraph';
  const lines = [`How the essay reads as one piece: ${inline.arc || 'not stated'}`];
  for (const p of inline.paragraphs) {
    if (!p.reviewed) {
      lines.push('', `${unit} ${p.n}: not reviewed.`);
      continue;
    }
    lines.push(
      '',
      `${unit} ${p.n}:`,
      `- Role: ${p.role || 'not stated'}`,
      `- How it connects: ${p.flow || 'not stated'}`,
      ...(p.focus ? [`- Passage it points to: "${p.focus}"`] : []),
      ...p.issues.map((i) => `- Issue: ${i}`),
      ...p.suggestions.map((i) => `- Suggestion: ${i}`),
    );
  }
  return lines.join('\n');
}

// The summarizer reads the essay and context first, then the four analyses and the in-line review. These are its only sources.
export function summarizerMessage(reports, length = 'medium', input, inline) {
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
    'Read the essay and the context first, then the reviewer reports and the In-Line Review. These four sources are the only information you may use.',
    '',
    ...(input ? ['<submission_facts>', submissionFacts(input), '</submission_facts>', '', '<essay>', input.essay, '</essay>', ''] : []),
    '<inline_review>',
    inlineForSummary(inline),
    '</inline_review>',
    '',
    '<text>',
    text,
    '</text>',
  ].join('\n');
}

const withReason = (base, err) => {
  const reason = describeFailure(err);
  return reason ? `${base} ${reason}` : base;
};

// Reads the whole essay as one piece and returns the in-line review (or an error result). Never emits.
async function runInline({ complete, inline, input, paragraphs, synthetic, signal }) {
  const describe = describeContext(input);
  const knowledge = knowledgeLines(input.type.id);
  const ask = (missing = []) =>
    complete({ system: inline.system, user: inlineMessage({ describe, knowledge, paragraphs, synthetic, missing }), signal });
  try {
    let result = parseInlineReview(await ask(), paragraphs);
    const missing = missingParts(result);
    if (missing.length) {
      // The model skipped part of the essay: ask once more for the complete review.
      try {
        const retry = parseInlineReview(await ask(missing), paragraphs);
        if (missingParts(retry).length < missing.length) result = retry;
      } catch (err) {
        if (signal?.aborted) throw err;
      }
    }
    return { status: 'done', arc: result.arc, paragraphs: result.paragraphs, synthetic };
  } catch (err) {
    if (signal?.aborted) throw err;
    console.error('[alial] in-line review failed:', err.message);
    return { status: 'error', error: withReason('The in-line review could not be completed.', err) };
  }
}

/**
 * Writes the summary from the essay, the context, the four analyses, and the in-line review: its only sources.
 * Emits summary_start, then summary (with any long quoted passages that match none of the sources) or summary_error.
 * Never throws except on abort. Rate limits and overloads are retried patiently because this is the largest request of the run.
 */
export async function runSummary({ complete, summarizer, reports, input, inline, emit = () => {}, signal }) {
  emit({ type: 'summary_start', reviewersUsed: reports.filter((r) => !r.error).length });
  try {
    let truncated = false;
    const text = await complete({
      system: summarizer.system,
      user: summarizerMessage(reports, input.length, input, inline),
      signal,
      retries: 5,
      maxTokens: SUMMARY_MAX_TOKENS,
      onStop: (reason) => { truncated = reason === 'max_tokens'; },
    });
    const sources = [input.essay, input.prompt || '', ...reports.filter((r) => !r.error).map((r) => r.text), inlineForSummary(inline)];
    emit({ type: 'summary', text, truncated, unverifiedQuotes: findUnverifiedQuotes(text, sources) });
    return text;
  } catch (err) {
    if (signal?.aborted) throw err;
    console.error('[alial] summary failed:', err.message);
    emit({ type: 'summary_error', error: withReason('The summary could not be written.', err) });
    return null;
  }
}

/**
 * Runs the four analyses and the in-line review in parallel. Results are shown in this order: the four analyses as they
 * finish, then the in-line review, then the summary, which waits for everything and is written from the essay, the context,
 * the four analyses, and the in-line review only.
 * `emit` receives progress events so a UI can stream them.
 */
export async function runPipeline({ complete, summarizer, input, emit = () => {}, signal, inline = INLINE_REVIEW }) {
  const { paragraphs, synthetic } = splitParagraphs(input.essay);
  input = { ...input, wordCount: countWords(input.essay) };
  emit({
    type: 'start',
    analyzers: ANALYZERS.map(({ id, name, tagline, angle, reviewer }) => ({ id, name, tagline, angle, reviewer })),
    summaryAngle: SUMMARY_ANGLE,
    inlineAngle: INLINE_ANGLE,
  });

  // Independent of the four analyses and of the summary. It starts now but is shown after the analyses.
  const inlinePromise = runInline({ complete, inline, input, paragraphs, synthetic, signal });
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
        emit({ type: 'analyzer', id, status: 'error', error: withReason('This reviewer could not complete its analysis.', err) });
        return { id, name, reviewer, error: err.message };
      }
    }),
  );

  const inlineResult = await inlinePromise;
  emit({ type: 'inline', ...inlineResult });

  const ok = reports.filter((r) => !r.error);
  if (ok.length === 0) throw new Error('All reviewers failed. Please try again.');

  const summary = await runSummary({ complete, summarizer, reports, input, inline: inlineResult, emit, signal });
  emit({ type: 'done' });
  return { reports, summary };
}
