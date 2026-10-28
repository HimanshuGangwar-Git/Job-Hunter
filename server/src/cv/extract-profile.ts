import { emptyProfile, type EducationItem, type ExperienceItem, type Profile } from '../domain/types';
import { canonicalSkill, findSkills, isKnownSkill } from './skills';

export interface ParsedCv {
  profile: Profile;
  skills: string[];
}

type SectionKey = 'summary' | 'skills' | 'experience' | 'education' | 'certifications' | 'languages';

const HEADINGS: [SectionKey, RegExp][] = [
  ['summary', /^(professional\s+)?(summary|profile|about( me)?|objective|career objective)$/i],
  ['skills', /^(technical\s+|core\s+|key\s+)?(skills|competencies|technologies|tech stack|tools)(\s*(&|and)\s*\w+)?$/i],
  ['experience', /^(work\s+|professional\s+)?(experience|employment( history)?|work history|career history)$/i],
  ['education', /^(education|academic( background)?|qualifications)$/i],
  ['certifications', /^(certifications?|licen[cs]es?|courses|training)$/i],
  ['languages', /^languages?$/i],
];

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const RANGE = new RegExp(
  `(?:${MONTH}\\s+)?((?:19|20)\\d{2})\\s*(?:–|—|-|to)\\s*(?:${MONTH}\\s+)?((?:19|20)\\d{2}|present|current|now)`,
  'i',
);
const BULLET = /^[•●▪◦\-*–]\s*/;
const DEGREE = /\b(B\.?\s?Tech|B\.?\s?E\.?|B\.?\s?Sc\.?|B\.?\s?A\.?|B\.?\s?Com\.?|BCA|MCA|M\.?\s?Tech|M\.?\s?E\.?|M\.?\s?Sc\.?|MBA|M\.?\s?A\.?|M\.?\s?S\.?|Ph\.?\s?D|Bachelor|Master|Diploma|Associate|High School)\b/i;
const INSTITUTION = /(university|college|institute|school|academy|iit|nit|bits)/i;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(\+?\d[\d\s().-]{8,}\d)/;

function sectionOf(line: string): SectionKey | null {
  if (line.length > 45) return null;
  const cleaned = line.replace(/[:\s]+$/, '').trim();
  for (const [key, pattern] of HEADINGS) {
    if (pattern.test(cleaned)) return key;
  }
  return null;
}

function stripBullet(line: string): string {
  return line.replace(BULLET, '').trim();
}

function parseYear(value: string, fallback: string | null): string | null {
  if (/^(present|current|now)$/i.test(value)) return null;
  return value || fallback;
}

function parseExperience(lines: string[]): ExperienceItem[] {
  const entries: ExperienceItem[] = [];
  let current: ExperienceItem | null = null;
  let pendingHeader = '';

  for (const line of lines) {
    const range = RANGE.exec(line);
    if (range) {
      const headerText = line.replace(RANGE, '').replace(/[|,—–-]+\s*$/, '').replace(/^\s*[|,—–-]+/, '').trim();
      const header = headerText || pendingHeader;
      const [title, company] = splitHeader(header);
      current = {
        title,
        company,
        start: range[1],
        end: parseYear(range[2], null),
        bullets: [],
      };
      entries.push(current);
      pendingHeader = '';
      continue;
    }
    if (BULLET.test(line)) {
      current?.bullets.push(stripBullet(line));
      continue;
    }
    if (line.length > 60 && current) {
      current.bullets.push(line);
      continue;
    }
    pendingHeader = line.length <= 90 ? line : '';
  }
  return entries.filter((entry) => entry.title.length > 0);
}

function splitHeader(header: string): [string, string] {
  const byAt = header.split(/\s+(?:at|@)\s+/i);
  if (byAt.length === 2) return [byAt[0].trim(), byAt[1].trim()];
  const byPipe = header.split(/\s+[|—–]\s+|\s+-\s+|,\s+/);
  if (byPipe.length >= 2) return [byPipe[0].trim(), byPipe[1].trim()];
  return [header.trim(), ''];
}

function parseEducation(lines: string[]): EducationItem[] {
  const items: EducationItem[] = [];
  lines.forEach((line, index) => {
    const degreeMatch = DEGREE.exec(line);
    if (!degreeMatch) return;
    const segments = line
      .split(/[|,–—]/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    const neighbour = [lines[index - 1] ?? '', lines[index + 1] ?? ''].find((candidate) => INSTITUTION.test(candidate) && !DEGREE.test(candidate));
    const institution = segments.find((segment) => INSTITUTION.test(segment)) ?? neighbour?.split(/[|,–—]/)[0].trim() ?? '';
    const degreeSegment = segments.find((segment) => DEGREE.test(segment)) ?? line;
    const field = degreeSegment
      .replace(DEGREE, '')
      .replace(/\bin\b/i, '')
      .replace(/^[\s.,-]+|[\s.,-]+$/g, '')
      .replace(/\b(19|20)\d{2}\b.*$/, '')
      .trim();
    items.push({
      institution,
      degree: degreeMatch[0],
      field,
      year: /\b((?:19|20)\d{2})\b/.exec(line)?.[1] ?? null,
    });
  });
  return items;
}

function splitList(lines: string[]): string[] {
  return lines
    .flatMap((line) => stripBullet(line).split(/[,;|•·]/))
    .map((item) => item.trim())
    .filter((item) => item.length > 1 && item.length <= 60);
}

function estimateYears(experience: ExperienceItem[], rawText: string, now: number): number {
  let total = 0;
  for (const entry of experience) {
    const start = Number(entry.start);
    const end = entry.end ? Number(entry.end) : now;
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) total += end - start;
  }
  const stated = /(\d{1,2})\+?\s+years?\s+(?:of\s+)?(?:professional\s+|industry\s+)?experience/i.exec(rawText);
  const statedYears = stated ? Number(stated[1]) : 0;
  return Math.max(total, statedYears);
}

/**
 * Rule-based extraction of a structured profile from CV text. Deliberately conservative: it only returns
 * what appears in the text, so a user can review and correct it on the Profile page.
 */
export function extractProfile(text: string, now: number = new Date().getFullYear()): ParsedCv {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const sections = new Map<SectionKey, string[]>();
  const header: string[] = [];
  let active: SectionKey | null = null;

  for (const line of lines) {
    const heading = sectionOf(line);
    if (heading) {
      active = heading;
      if (!sections.has(heading)) sections.set(heading, []);
      continue;
    }
    if (active) sections.get(active)?.push(line);
    else header.push(line);
  }

  const get = (key: SectionKey) => sections.get(key) ?? [];

  const email = EMAIL.exec(text)?.[0] ?? null;
  const phone = PHONE.exec(text)?.[0].trim() ?? null;
  const locationLine = /^(location|based in|address)\s*[:-]\s*(.+)$/im.exec(text);

  const contactFree = (line: string) => !EMAIL.test(line) && !PHONE.test(line) && !sectionOf(line);
  const nameIndex = header.findIndex(
    (line) => /^[A-Z][A-Za-z.'-]+(\s[A-Z][A-Za-z.'-]+){1,3}$/.test(line) && contactFree(line),
  );
  const fullName = nameIndex >= 0 ? header[nameIndex] : '';
  const headlineCandidate = nameIndex >= 0 ? header[nameIndex + 1] : undefined;
  const headline = headlineCandidate && headlineCandidate.length <= 90 && contactFree(headlineCandidate) ? headlineCandidate : '';

  const experience = parseExperience(get('experience'));
  const skillSection = splitList(get('skills'));
  const skillsFromSection = skillSection
    .filter((item) => isKnownSkill(canonicalSkill(item)) || (item.length <= 25 && item.split(' ').length <= 3))
    .map(canonicalSkill);
  const skills = [...new Set([...skillsFromSection, ...findSkills(text)])];

  const profile: Profile = {
    ...emptyProfile(fullName),
    headline,
    email,
    phone,
    location: locationLine ? locationLine[2].trim() : null,
    summary: get('summary').join(' ').slice(0, 600),
    skills,
    experience,
    education: parseEducation(get('education')),
    certifications: splitList(get('certifications')).slice(0, 15),
    languages: splitList(get('languages')).slice(0, 10),
    totalYearsExperience: estimateYears(experience, text, now),
  };
  return { profile, skills };
}
