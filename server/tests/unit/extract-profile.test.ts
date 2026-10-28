import { describe, expect, it } from 'vitest';
import { extractProfile } from '../../src/cv/extract-profile';
import { SAMPLE_CV_TEXT } from '../fixtures/sample-cv';

describe('extractProfile', () => {
  const { profile, skills } = extractProfile(SAMPLE_CV_TEXT, 2026);

  it('extracts contact details and name from the header', () => {
    expect(profile.fullName).toBe('Priya Raman');
    expect(profile.headline).toBe('Frontend Engineer');
    expect(profile.email).toBe('priya.raman@example.com');
    expect(profile.phone).toContain('98450');
    expect(profile.location).toBe('Bengaluru, India');
  });

  it('extracts the summary', () => {
    expect(profile.summary).toContain('4 years of experience');
  });

  it('extracts skills from the skills section using canonical names', () => {
    expect(skills).toEqual(expect.arrayContaining(['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Jest', 'Git', 'Docker']));
    expect(new Set(skills).size).toBe(skills.length);
  });

  it('extracts experience entries with title, company, dates and bullets', () => {
    expect(profile.experience).toHaveLength(2);
    expect(profile.experience[0]).toMatchObject({
      title: 'Frontend Engineer',
      company: 'Orbit Analytics',
      start: '2022',
      end: null,
    });
    expect(profile.experience[0].bullets[0]).toBe('Built a React and TypeScript analytics dashboard used by 900 analysts.');
    expect(profile.experience[1]).toMatchObject({ title: 'Software Engineer', company: 'Kiteline Labs', start: '2019', end: '2021' });
  });

  it('estimates total years from date ranges', () => {
    // 2022 to 2026 (4 years) plus 2019 to 2021 (2 years).
    expect(profile.totalYearsExperience).toBe(6);
  });

  it('extracts education with institution, degree, field and year', () => {
    expect(profile.education).toEqual([
      { institution: 'Anna University', degree: 'B.E', field: 'Computer Science', year: '2019' },
    ]);
  });

  it('extracts certifications and languages', () => {
    expect(profile.certifications).toEqual(['AWS Certified Cloud Practitioner']);
    expect(profile.languages).toEqual(['English', 'Tamil']);
  });

  it('does not invent fields that are absent', () => {
    const minimal = extractProfile('Just Some Text\nNothing else useful is here at all, sorry.', 2026);
    expect(minimal.profile.experience).toEqual([]);
    expect(minimal.profile.education).toEqual([]);
    expect(minimal.profile.email).toBeNull();
  });
});
