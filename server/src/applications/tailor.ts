import type { EducationItem, ExperienceItem } from '../domain/types';
import type { ParsedCv } from '../cv/extract-profile';
import { canonicalSkill, findSkills } from '../cv/skills';

export interface JobText {
  title: string;
  company: string;
  description: string;
}

export interface TailoredExperience {
  title: string;
  company: string;
  start: string;
  end: string | null;
  bullets: string[];
}

export interface TailoredCvData {
  name: string;
  headline: string;
  contact: { email: string | null; phone: string | null; location: string | null };
  summary: string;
  skills: string[];
  experience: TailoredExperience[];
  education: EducationItem[];
  certifications: string[];
  languages: string[];
  /** CV skills that also appear in the posting. These are the ATS keywords the CV now leads with. */
  atsKeywords: string[];
  /** Skills the posting asks for that the CV does not show. They are reported, never added. */
  gaps: string[];
}

export interface TailorInput {
  cv: ParsedCv;
  cvText: string;
  job: JobText;
  candidateName: string;
}

const STOP = new Set(['and', 'the', 'with', 'for', 'our', 'you', 'will', 'team', 'role', 'work', 'years', 'experience']);

const words = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );

/** Reorders bullets so those overlapping the posting come first. Bullets are never rewritten. */
function rankBullets(bullets: string[], jobWords: Set<string>): string[] {
  return bullets
    .map((bullet, index) => {
      const overlap = [...words(bullet)].filter((w) => jobWords.has(w)).length;
      return { bullet, index, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap || a.index - b.index)
    .map((item) => item.bullet);
}

export function tailorCv(input: TailorInput): TailoredCvData {
  const { cv, job } = input;
  const postingText = `${job.title}\n${job.description}`;
  const postingSkills = findSkills(postingText);
  const cvSkills = [...new Set(cv.skills.map(canonicalSkill))];
  const cvSkillSet = new Set(cvSkills.map((s) => s.toLowerCase()));

  const atsKeywords = postingSkills.filter((s) => cvSkillSet.has(s.toLowerCase()));
  const gaps = postingSkills.filter((s) => !cvSkillSet.has(s.toLowerCase()));

  // Skills shown first are the ones the posting asks for. The rest of the CV's skills follow unchanged.
  const orderedSkills = [...atsKeywords, ...cvSkills.filter((s) => !atsKeywords.includes(s))];

  const jobWords = words(postingText);
  const experience: TailoredExperience[] = cv.profile.experience.map((item: ExperienceItem) => ({
    title: item.title,
    company: item.company,
    start: item.start,
    end: item.end,
    bullets: rankBullets(item.bullets, jobWords),
  }));

  // Only state a years figure when the CV itself states it. Estimates from date ranges are never printed.
  const years = cv.profile.totalYearsExperience;
  const yearsStated = years > 0 && new RegExp(`\\b${years}\\+?\\s+years?`, 'i').test(input.cvText);
  const leadSkills = (atsKeywords.length ? atsKeywords : cvSkills).slice(0, 4);
  const firstSentence = cv.profile.summary.split(/(?<=[.!?])\s+/)[0] ?? '';
  // The CV's own opening sentence leads when it exists, so the summary never repeats the headline.
  const opening = yearsStated
    ? `${cv.profile.headline || 'Professional'} with ${years} years of experience.`
    : firstSentence || (cv.profile.headline ? `${cv.profile.headline}.` : '');
  const summaryParts = [opening, leadSkills.length ? `Core strengths: ${leadSkills.join(', ')}.` : ''];

  return {
    name: input.candidateName || cv.profile.fullName,
    headline: cv.profile.headline,
    contact: { email: cv.profile.email, phone: cv.profile.phone, location: cv.profile.location },
    summary: summaryParts.filter(Boolean).join(' ').trim(),
    skills: orderedSkills,
    experience,
    education: cv.profile.education,
    certifications: cv.profile.certifications,
    languages: cv.profile.languages,
    atsKeywords,
    gaps,
  };
}

/** Deterministic cover letter. Every claim comes from the CV; the posting only chooses what to emphasise. */
export function buildCoverLetter(tailored: TailoredCvData, job: JobText): string {
  const lead = (tailored.atsKeywords.length ? tailored.atsKeywords : tailored.skills).slice(0, 3);
  const current = tailored.experience[0];
  const highlights = current?.bullets.slice(0, 2) ?? [];

  const article = tailored.headline && /^[aeiou]/i.test(tailored.headline) ? 'an' : 'a';
  const about = tailored.headline
    ? `I work as ${article} ${tailored.headline}${lead.length ? `, with experience in ${lead.join(', ')}` : ''}.`
    : lead.length
      ? `My experience includes ${lead.join(', ')}.`
      : '';

  const paragraphs = [
    `Dear ${job.company} Hiring Team,`,
    `I am applying for the ${job.title} role at ${job.company}. ${about}`.trim(),
    current && highlights.length
      ? `Highlights from my time as ${current.title}${current.company ? ` at ${current.company}` : ''}:\n${highlights.map((b) => `• ${b}`).join('\n')}`
      : '',
    'I would welcome the opportunity to discuss how my experience fits your team.',
    `Kind regards,\n${tailored.name}`,
  ];
  return paragraphs.filter(Boolean).join('\n\n');
}

export function buildRecruiterMessage(tailored: TailoredCvData, job: JobText): string {
  const lead = tailored.atsKeywords.slice(0, 3);
  const skillClause = lead.length ? ` It lines up with my work in ${lead.join(', ')}.` : '';
  return `Hi, I came across the ${job.title} role at ${job.company} and wanted to connect.${skillClause} Would you be open to a short conversation? Thank you, ${tailored.name}`;
}

export interface GenerationCheck {
  violations: string[];
}

/**
 * Guards against fabrication. Any output that names a skill, employer, role, bullet or number that is not
 * present in the source CV is reported. Used to validate AI drafts and in tests of the deterministic path.
 */
export function checkNoFabrication(
  output: { tailored: TailoredCvData; texts: string[] },
  source: { cv: ParsedCv; cvText: string },
): GenerationCheck {
  const violations: string[] = [];
  const sourceSkills = new Set(source.cv.skills.map((s) => canonicalSkill(s).toLowerCase()));
  const sourceBullets = new Set(source.cv.profile.experience.flatMap((e) => e.bullets));
  const sourceRoles = new Set(source.cv.profile.experience.map((e) => `${e.title}|${e.company}`));
  const sourceNumbers = new Set(source.cvText.match(/\d+(?:\.\d+)?/g) ?? []);

  for (const skill of output.tailored.skills) {
    if (!sourceSkills.has(skill.toLowerCase())) violations.push(`skill not in CV: ${skill}`);
  }
  for (const role of output.tailored.experience) {
    if (!sourceRoles.has(`${role.title}|${role.company}`)) violations.push(`role not in CV: ${role.title} at ${role.company}`);
    for (const bullet of role.bullets) {
      if (!sourceBullets.has(bullet)) violations.push(`bullet not in CV: ${bullet.slice(0, 60)}`);
    }
  }
  for (const text of [output.tailored.summary, ...output.texts]) {
    for (const skill of findSkills(text)) {
      if (!sourceSkills.has(skill.toLowerCase())) violations.push(`text names a skill not in CV: ${skill}`);
    }
    for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(%|\+?\s*years?)/gi)) {
      if (!sourceNumbers.has(match[1])) violations.push(`text states a figure not in CV: ${match[0]}`);
    }
  }
  return { violations };
}
