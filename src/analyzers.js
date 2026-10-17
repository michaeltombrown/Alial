const fs = require('node:fs');
const path = require('node:path');

const PROMPT_DIR = path.join(__dirname, '..', 'prompts');
const read = (file) => fs.readFileSync(path.join(PROMPT_DIR, file), 'utf8').trim();

// The four independent essay analysis prompts. Each runs against every essay.
const ANALYZERS = [
  {
    id: 'rubric',
    name: 'Rubric Reader',
    tagline: 'Scores personal perspective, examples, and ideas out of 18',
    system: read('rubric-rater.txt'),
  },
  {
    id: 'admissions',
    name: 'Admissions Grader',
    tagline: '18 categories scored 1 to 10 with an admissions-officer view',
    system: read('admissions-grader.txt'),
  },
  {
    id: 'evaluator',
    name: 'Selective-College Evaluator',
    tagline: '18-category score out of 180 with paragraph-level feedback',
    system: read('writer-grader-master.txt'),
  },
  {
    id: 'coach',
    name: 'Story Coach',
    tagline: 'Voice, memorability, and narrative craft coaching',
    system: read('common-app-master.txt'),
  },
];

// A user-supplied prompts/summarizer.txt takes precedence over the built-in placeholder.
function loadSummarizer() {
  const custom = path.join(PROMPT_DIR, 'summarizer.txt');
  if (fs.existsSync(custom)) return { system: read('summarizer.txt'), isPlaceholder: false };
  return { system: read('summarizer.placeholder.txt'), isPlaceholder: true };
}

module.exports = { ANALYZERS, loadSummarizer };
