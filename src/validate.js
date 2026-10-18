import { getEssayType } from './essayTypes.js';
import { SUMMARY_LENGTHS } from './pipeline.js';
import { ANALYZERS } from './analyzers.js';
import { countWords } from './text.js';

export const MAX_CHARS = 30000;

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Validates the JSON body of POST /api/analyze and returns the pipeline input.
export function parseInput(body) {
  if (!body || typeof body !== 'object') throw new UserError('Send the essay as JSON.');
  const type = getEssayType(body.type);
  if (!type) throw new UserError('Choose an essay type.');

  const essay = typeof body.essay === 'string' ? body.essay.trim() : '';
  if (countWords(essay) < 25) throw new UserError('That looks too short to analyze. Add the full essay (at least 25 words).');
  if (essay.length > MAX_CHARS) throw new UserError(`Essay is too long (limit ${MAX_CHARS.toLocaleString('en-US')} characters).`);

  const wordLimit = Math.min(Math.max(parseInt(body.wordLimit, 10) || type.limit, 1), 5000);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    type,
    essay,
    wordLimit,
    length: SUMMARY_LENGTHS[body.length] ? body.length : 'medium',
    prompt: str(body.prompt, 3000),
    college: str(body.college, 200),
  };
}

const MAX_REPORT_CHARS = 80000;

// Validates POST /api/summarize: the facts about the submission plus the analyses already shown to the student.
export function parseSummaryRequest(body) {
  if (!body || typeof body !== 'object') throw new UserError('Send the analyses as JSON.');
  const type = getEssayType(body.type);
  if (!type) throw new UserError('Choose an essay type.');
  if (!Array.isArray(body.reports) || body.reports.length > ANALYZERS.length) throw new UserError('Send the analyses to summarize.');

  const seen = new Set();
  const reports = ANALYZERS.map(({ id, name, reviewer }) => ({ id, name, reviewer, error: 'missing' }));
  for (const r of body.reports) {
    const slot = reports.find((x) => x.id === r?.id);
    if (!slot || seen.has(r.id)) throw new UserError('Unknown or repeated analysis.');
    seen.add(r.id);
    if (typeof r.text !== 'string' || !r.text.trim()) continue;
    if (r.text.length > MAX_REPORT_CHARS) throw new UserError('An analysis is too long to summarize.', 413);
    delete slot.error;
    slot.text = r.text;
  }
  if (!reports.some((r) => !r.error)) throw new UserError('Send at least one completed analysis.');

  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    input: {
      type,
      wordLimit: Math.min(Math.max(parseInt(body.wordLimit, 10) || type.limit, 1), 5000),
      wordCount: Math.min(Math.max(parseInt(body.wordCount, 10) || 0, 0), 100000),
      length: SUMMARY_LENGTHS[body.length] ? body.length : 'medium',
      prompt: str(body.prompt, 3000),
      college: str(body.college, 200),
    },
    reports,
  };
}
