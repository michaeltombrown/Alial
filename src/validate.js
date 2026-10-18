import { getEssayType } from './essayTypes.js';
import { SUMMARY_LENGTHS } from './pipeline.js';
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
