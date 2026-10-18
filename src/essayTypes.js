// Essay types students currently encounter when applying to college.
// `limit` is the commonly published word limit; the student can override it.
export const ESSAY_TYPES = [
  {
    id: 'common-app',
    label: 'Common App Personal Statement',
    limit: 650,
    hint: 'The main essay sent to every school. 250 to 650 words.',
    focus:
      'Common App personal statement: prioritize insight, individuality, and a meaningful understanding of the student beyond grades and activities.',
  },
  {
    id: 'coalition',
    label: 'Coalition / Scoir Essay',
    limit: 650,
    hint: 'The Coalition with Scoir application personal essay.',
    focus:
      'Coalition application personal essay: treat as a general personal statement; prioritize insight, individuality, and voice.',
  },
  {
    id: 'uc-piq',
    label: 'UC Personal Insight Question',
    limit: 350,
    hint: 'University of California short responses, 350 words each.',
    focus:
      'UC Personal Insight Question: prioritize a direct answer to the question, concrete examples, personal contribution, and reflection within the word limit.',
  },
  {
    id: 'why-college',
    label: 'Supplemental: Why This College',
    limit: 250,
    hint: 'School-specific "Why us?" or "Why this major?" essays.',
    focus:
      'School-specific supplemental essay: prioritize direct responsiveness to the prompt, personal motivation, and concrete fit with the institution. Distinguish substantive fit from name-dropping.',
  },
  {
    id: 'community',
    label: 'Supplemental: Community or Identity',
    limit: 300,
    hint: 'Diversity, community, background, or perspective prompts.',
    focus:
      'Supplemental essay on community, identity, or perspective: prioritize authenticity, specific lived detail, and what the student would bring to a campus community.',
  },
  {
    id: 'activity',
    label: 'Supplemental: Activity or Extracurricular',
    limit: 150,
    hint: 'Short responses about an activity, job, or commitment.',
    focus:
      'Very short activity essay: prioritize a single memorable idea and what the activity reveals about the student, over a crowded list of accomplishments.',
  },
  {
    id: 'short-answer',
    label: 'Supplemental: Short Answer / Quirky',
    limit: 100,
    hint: 'One-paragraph or "fun" prompts, 50 to 150 words.',
    focus:
      'Short-answer supplemental: prioritize personality, specificity, and a single memorable idea within a tight word limit.',
  },
  {
    id: 'scholarship',
    label: 'Scholarship Essay',
    limit: 500,
    hint: 'Essays for scholarship or honors program applications.',
    focus:
      'Scholarship essay: prioritize responsiveness to the scholarship prompt, demonstrated values and impact, and clear reflection.',
  },
  {
    id: 'transfer',
    label: 'Transfer Essay',
    limit: 650,
    hint: 'Why you are transferring and what you will bring.',
    focus:
      'Transfer essay: prioritize a clear, honest account of motivation for transferring, growth since starting college, and specific fit with the new institution.',
  },
  {
    id: 'other',
    label: 'Other Application Essay',
    limit: 500,
    hint: 'Anything else, such as an optional or additional-info essay.',
    focus: 'General application essay: evaluate against the supplied prompt, if any.',
  },
];

const byId = new Map(ESSAY_TYPES.map((t) => [t.id, t]));

export const getEssayType = (id) => byId.get(id);
