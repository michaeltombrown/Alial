import { PROMPTS } from './generated/prompts.js';

// The four independent essay analysis prompts. Each runs against every essay.
export const ANALYZERS = [
  {
    id: 'rubric',
    name: 'Rubric Reader',
    tagline: 'Scores personal perspective, examples, and ideas out of 18',
    system: PROMPTS['rubric-rater'],
  },
  {
    id: 'admissions',
    name: 'Admissions Grader',
    tagline: '18 categories scored 1 to 10 with an admissions-officer view',
    system: PROMPTS['admissions-grader'],
  },
  {
    id: 'evaluator',
    name: 'Selective-College Evaluator',
    tagline: '18-category score out of 180 with paragraph-level feedback',
    system: PROMPTS['writer-grader-master'],
  },
  {
    id: 'coach',
    name: 'Story Coach',
    tagline: 'Voice, memorability, and narrative craft coaching',
    system: PROMPTS['common-app-master'],
  },
];

// Final step: "Summary Generator - AI Text Summarizer" runs over the four analyses.
export const SUMMARIZER = { system: PROMPTS.summarizer };
