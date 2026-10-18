// Essay types students currently encounter when applying to college.
// `limit` is the commonly published word limit; the student can override it.
export const ESSAY_TYPES = [
  {
    id: 'common-app',
    promptHint: 'Paste the Common App prompt you chose, or write "any topic". You can also add context, such as what you most want the essay to show.',
    label: 'Common App Personal Statement',
    limit: 650,
    hint: 'The main essay sent to every school. 250 to 650 words.',
    focus:
      'Common App personal statement: prioritize insight, individuality, and a meaningful understanding of the student beyond grades and activities.',
  },
  {
    id: 'coalition',
    promptHint: 'Paste the Coalition prompt you chose, or write "any topic". You can also add context about what you want the essay to show.',
    label: 'Coalition / Scoir Essay',
    limit: 650,
    hint: 'The Coalition with Scoir application personal essay.',
    focus:
      'Coalition application personal essay: treat as a general personal statement; prioritize insight, individuality, and voice.',
  },
  {
    id: 'uc-piq',
    promptHint: 'Paste the Personal Insight Question you are answering (for example, the leadership or challenge question), plus any context.',
    label: 'UC Personal Insight Question',
    limit: 350,
    hint: 'University of California short responses, 350 words each.',
    focus:
      'UC Personal Insight Question: prioritize a direct answer to the question, concrete examples, personal contribution, and reflection within the word limit.',
  },
  {
    id: 'why-college',
    promptHint: "Paste the school's question here. Put the college name and major under \"College and word limit\" below.",
    label: 'Supplemental: Why This College',
    limit: 250,
    hint: 'School-specific "Why us?" or "Why this major?" essays.',
    focus:
      'School-specific supplemental essay: prioritize direct responsiveness to the prompt, personal motivation, and concrete fit with the institution. Distinguish substantive fit from name-dropping.',
  },
  {
    id: 'community',
    promptHint: "Paste the school's community, identity, or perspective question, and any context about what you want to convey.",
    label: 'Supplemental: Community or Identity',
    limit: 300,
    hint: 'Diversity, community, background, or perspective prompts.',
    focus:
      'Supplemental essay on community, identity, or perspective: prioritize authenticity, specific lived detail, and what the student would bring to a campus community.',
  },
  {
    id: 'activity',
    promptHint: 'Paste the activity question, and name the activity and your role if the question does not.',
    label: 'Supplemental: Activity or Extracurricular',
    limit: 150,
    hint: 'Short responses about an activity, job, or commitment.',
    focus:
      'Very short activity essay: prioritize a single memorable idea and what the activity reveals about the student, over a crowded list of accomplishments.',
  },
  {
    id: 'short-answer',
    promptHint: 'Paste the exact short-answer question. Short responses are judged against it closely.',
    label: 'Supplemental: Short Answer / Quirky',
    limit: 100,
    hint: 'One-paragraph or "fun" prompts, 50 to 150 words.',
    focus:
      'Short-answer supplemental: prioritize personality, specificity, and a single memorable idea within a tight word limit.',
  },
  {
    id: 'scholarship',
    promptHint: "Paste the scholarship's prompt and, if you have them, its selection criteria or mission statement.",
    label: 'Scholarship Essay',
    limit: 500,
    hint: 'Essays for scholarship or honors program applications.',
    focus:
      'Scholarship essay: prioritize responsiveness to the scholarship prompt, demonstrated values and impact, and clear reflection.',
  },
  {
    id: 'transfer',
    promptHint: 'Paste the transfer prompt, and add your current school, intended major, and target school if helpful.',
    label: 'Transfer Essay',
    limit: 650,
    hint: 'Why you are transferring and what you will bring.',
    focus:
      'Transfer essay: prioritize a clear, honest account of motivation for transferring, growth since starting college, and specific fit with the new institution.',
  },
  {
    id: 'other',
    promptHint: 'Paste the prompt or box description (for example, \"Additional information\"), plus any context.',
    label: 'Other Application Essay',
    limit: 500,
    hint: 'Anything else, such as an optional or additional-info essay.',
    focus: 'General application essay: evaluate against the supplied prompt, if any.',
  },
];

const byId = new Map(ESSAY_TYPES.map((t) => [t.id, t]));

export const getEssayType = (id) => byId.get(id);
