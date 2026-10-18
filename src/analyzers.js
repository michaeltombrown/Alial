import { PROMPTS } from './generated/prompts.js';

// Shown at the top of each tab so students can tell the feedback apart by where it is coming from.
export const SUMMARY_ANGLE =
  'A synthesis of all four reviewers. It works only from their reports: it weighs where they agree and differ, resolves conflicts, and sets priorities. It does not review the essay itself.';
export const INLINE_ANGLE =
  'A continuity editor. It reads the whole essay as one continuous piece, paragraph by paragraph, and shows how each paragraph carries the thought forward and how to give the reader more context and interest. It does not score the essay or edit line by line.';

// The four independent essay analysis prompts, in the order the Intelligence Engine numbers its reviewers.
// Each runs against every essay.
export const ANALYZERS = [
  {
    id: 'rubric',
    reviewer: 1,
    name: 'Rubric Reader',
    tagline: 'Scores personal perspective, examples, and ideas out of 18',
    angle:
      'An experienced college writing instructor. Scores Personal Perspective, Examples, and Substantive Ideas from 0 to 6 each (18 total), judging voice, specificity, and how well the ideas are developed and organized.',
    system: PROMPTS['rubric-rater'],
  },
  {
    id: 'evaluator',
    reviewer: 2,
    name: 'Selective-College Evaluator',
    tagline: '18-category score out of 180 with paragraph-level feedback',
    angle:
      'A rigorous evaluator and writing coach reading as a critical admissions reader. Scores 18 craft categories (out of 180), reviews the essay paragraph by paragraph, and simulates how a committee might discuss it.',
    system: PROMPTS['writer-grader-master'],
  },
  {
    id: 'coach',
    reviewer: 3,
    name: 'Story Coach',
    tagline: 'Voice, memorability, and narrative craft coaching',
    angle:
      'A storytelling mentor. Qualitative only, with no scores. Focuses on authentic voice, originality, narrative craft, and keeping the essay unmistakably the student\'s own.',
    system: PROMPTS['common-app-master'],
  },
  {
    id: 'admissions',
    reviewer: 4,
    name: 'Admissions Grader',
    tagline: '18 categories scored 1 to 10 with an admissions-officer view',
    angle:
      'A critical admissions reader. Scores 18 categories from 1 to 10 plus a holistic score, asking what the essay reveals about the student and what a reader would remember.',
    system: PROMPTS['admissions-grader'],
  },
];

// Pulls whole numbered sections out of the Intelligence Engine specification.
export function engineSections(text, numbers) {
  const heads = [...text.matchAll(/^SECTION (\d+) \u2014 /gm)].map((m) => ({ n: Number(m[1]), at: m.index }));
  return heads
    .map((h, i) => ({ n: h.n, body: text.slice(h.at, i + 1 < heads.length ? heads[i + 1].at : undefined).trim() }))
    .filter((h) => numbers.includes(h.n))
    .map((h) => h.body)
    .join('\n\n');
}

// Final step: the Summary Generator role, plus the Engine's synthesis sections, with an application note on how they fit.
// Engine sections used: 1 reviewers, 3 school-neutral governance, 5 rubric applicability, 7 synthesis, 8 scoring,
// 9 improvement plan, 10 student-facing output, 11 validation.
export const SUMMARIZER = {
  system: [PROMPTS.summarizer, PROMPTS['synthesis-integration'], engineSections(PROMPTS['intelligence-engine'], [1, 3, 5, 7, 8, 9, 10, 11])].join('\n\n---\n\n'),
};

// In-line, paragraph-by-paragraph review. Runs alongside the four analyses and is not an input to the summary.
export const INLINE_REVIEW = { system: PROMPTS['inline-review'] };
