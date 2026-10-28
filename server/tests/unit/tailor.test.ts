import { describe, expect, it } from 'vitest';
import { extractProfile } from '../../src/cv/extract-profile';
import { buildCoverLetter, buildRecruiterMessage, checkNoFabrication, tailorCv } from '../../src/applications/tailor';
import { SAMPLE_CV_TEXT } from '../fixtures/sample-cv';

const cv = extractProfile(SAMPLE_CV_TEXT, 2026);
const job = {
  title: 'Senior Frontend Engineer',
  company: 'Northwind Payments',
  description: 'Build payment dashboards in React and TypeScript. Strong Jest and GraphQL skills. Kubernetes is a bonus.',
};

const tailored = tailorCv({ cv, cvText: SAMPLE_CV_TEXT, job, candidateName: 'Priya Raman' });

describe('tailorCv', () => {
  it('only lists skills that exist on the CV', () => {
    for (const skill of tailored.skills) {
      expect(cv.skills).toContain(skill);
    }
  });

  it('never adds posting skills the CV lacks; they are reported as gaps instead', () => {
    expect(tailored.skills).not.toContain('GraphQL');
    expect(tailored.skills).not.toContain('Kubernetes');
    expect(tailored.gaps).toEqual(expect.arrayContaining(['GraphQL', 'Kubernetes']));
  });

  it('leads with ATS keywords that appear in both the posting and the CV', () => {
    expect(tailored.atsKeywords).toEqual(expect.arrayContaining(['React', 'TypeScript', 'Jest']));
    expect(tailored.skills.slice(0, tailored.atsKeywords.length)).toEqual(tailored.atsKeywords);
  });

  it('keeps experience roles and bullets verbatim, only reordering bullets', () => {
    const sourceBullets = cv.profile.experience.flatMap((e) => e.bullets).sort();
    const outputBullets = tailored.experience.flatMap((e) => e.bullets).sort();
    expect(outputBullets).toEqual(sourceBullets);
    expect(tailored.experience.map((e) => e.company)).toEqual(cv.profile.experience.map((e) => e.company));
  });

  it('does not print the estimated years figure unless the CV states it', () => {
    // Experience is estimated from date ranges (6 here). The CV text never says "6 years", so it must not appear.
    expect(cv.profile.totalYearsExperience).toBe(6);
    expect(tailored.summary).not.toContain('6 years');
  });

  it('passes the fabrication check', () => {
    const { violations } = checkNoFabrication(
      { tailored, texts: [buildCoverLetter(tailored, job), buildRecruiterMessage(tailored, job)] },
      { cv, cvText: SAMPLE_CV_TEXT },
    );
    expect(violations).toEqual([]);
  });
});

describe('cover letter and recruiter message', () => {
  it('stick to CV facts and never mention missing skills as if held', () => {
    const letter = buildCoverLetter(tailored, job);
    expect(letter).toContain('Northwind Payments');
    expect(letter).not.toMatch(/GraphQL|Kubernetes/);
    expect(letter).toContain('Priya Raman');
  });

  it('keeps the recruiter message short and personal', () => {
    const message = buildRecruiterMessage(tailored, job);
    expect(message).toContain('Senior Frontend Engineer');
    expect(message.length).toBeLessThan(400);
  });
});

describe('checkNoFabrication', () => {
  it('flags a skill the CV does not contain', () => {
    const bad = { ...tailored, skills: [...tailored.skills, 'Kubernetes'] };
    const { violations } = checkNoFabrication({ tailored: bad, texts: [] }, { cv, cvText: SAMPLE_CV_TEXT });
    expect(violations.some((v) => v.includes('Kubernetes'))).toBe(true);
  });

  it('flags a skill named only in generated prose', () => {
    const { violations } = checkNoFabrication(
      { tailored, texts: ['I have deep experience with Kubernetes clusters.'] },
      { cv, cvText: SAMPLE_CV_TEXT },
    );
    expect(violations.some((v) => v.includes('Kubernetes'))).toBe(true);
  });

  it('flags an invented metric', () => {
    const { violations } = checkNoFabrication(
      { tailored, texts: ['I cut costs by 85% in my last role.'] },
      { cv, cvText: SAMPLE_CV_TEXT },
    );
    expect(violations.some((v) => v.includes('85%'))).toBe(true);
  });

  it('flags an invented employer or bullet', () => {
    const bad = {
      ...tailored,
      experience: [{ title: 'Principal Engineer', company: 'Globex', start: '2015', end: null, bullets: ['Led a 40-person team.'] }],
    };
    const { violations } = checkNoFabrication({ tailored: bad, texts: [] }, { cv, cvText: SAMPLE_CV_TEXT });
    expect(violations).toEqual(expect.arrayContaining([expect.stringContaining('Globex'), expect.stringContaining('Led a 40-person')]));
  });
});
