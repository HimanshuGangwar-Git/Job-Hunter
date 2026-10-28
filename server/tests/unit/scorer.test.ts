import { describe, expect, it } from 'vitest';
import { EMPTY_PREFERENCES, emptyProfile, type Preferences, type Profile } from '../../src/domain/types';
import { requiredYears, scoreJob, WEIGHTS, type JobForScoring } from '../../src/matching/scorer';
import { SAMPLE_JOB_DESCRIPTION } from '../fixtures/sample-cv';

const profile: Profile = {
  ...emptyProfile('Priya Raman'),
  headline: 'Frontend Engineer',
  skills: ['React', 'TypeScript', 'JavaScript', 'Node.js', 'PostgreSQL', 'Jest', 'Git', 'Docker'],
  totalYearsExperience: 6,
  education: [{ institution: 'Anna University', degree: 'B.E', field: 'Computer Science', year: '2019' }],
};

const preferences: Preferences = {
  ...EMPTY_PREFERENCES,
  targetRoles: ['Frontend Engineer'],
  locations: ['Bengaluru'],
  workModes: ['hybrid'],
  minSalary: 2000000,
  maxSalary: 3500000,
  currency: 'INR',
  industries: ['Fintech'],
  preferredCompanies: ['Northwind Payments'],
};

const strongJob: JobForScoring = {
  title: 'Senior Frontend Engineer',
  company: 'Northwind Payments',
  location: 'Bengaluru, India',
  workMode: 'hybrid',
  salaryMin: 2400000,
  salaryMax: 3200000,
  salaryCurrency: 'INR',
  description: `${SAMPLE_JOB_DESCRIPTION} Fintech product team.`,
};

const weakJob: JobForScoring = {
  title: 'Data Engineer',
  company: 'Orbit Logistics',
  location: 'Gurugram, India',
  workMode: 'onsite',
  salaryMin: 1000000,
  salaryMax: 1400000,
  salaryCurrency: 'INR',
  description: 'Own ETL pipelines using Airflow, Spark and Snowflake. Python and SQL required. 10+ years of experience.',
};

describe('scoreJob', () => {
  it('scores a well-aligned job high and explains the score', () => {
    const result = scoreJob({ profile, preferences }, strongJob);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.matchedSkills).toEqual(expect.arrayContaining(['React', 'TypeScript', 'Jest']));
    expect(result.missingSkills).toContain('GraphQL');
    expect(result.reasons.some((r) => r.includes('Title matches your target role'))).toBe(true);
  });

  it('scores a poorly aligned job low', () => {
    const result = scoreJob({ profile, preferences }, weakJob);
    expect(result.score).toBeLessThan(40);
    expect(result.missingSkills).toEqual(expect.arrayContaining(['Airflow', 'Snowflake']));
    expect(result.matchedSkills).toEqual([]);
  });

  it('keeps every breakdown component within its weight and sums to the score', () => {
    const result = scoreJob({ profile, preferences }, strongJob);
    for (const key of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) {
      expect(result.breakdown[key]).toBeGreaterThanOrEqual(0);
      expect(result.breakdown[key]).toBeLessThanOrEqual(WEIGHTS[key]);
    }
    const sum = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
    expect(result.score).toBe(sum);
  });

  it('is deterministic for the same input', () => {
    expect(scoreJob({ profile, preferences }, strongJob)).toEqual(scoreJob({ profile, preferences }, strongJob));
  });

  it('never scores above 100 or below 0', () => {
    const best = scoreJob({ profile, preferences }, strongJob);
    const worst = scoreJob({ profile: emptyProfile(), preferences: EMPTY_PREFERENCES }, weakJob);
    expect(best.score).toBeLessThanOrEqual(100);
    expect(worst.score).toBeGreaterThanOrEqual(0);
  });

  it('penalises a stated experience requirement the candidate does not meet', () => {
    const junior = { ...profile, totalYearsExperience: 1 };
    const seniorRequirement = scoreJob({ profile: junior, preferences }, { ...strongJob, description: 'Requires 8+ years of React experience.' });
    const met = scoreJob({ profile, preferences }, { ...strongJob, description: 'Requires 3+ years of React experience.' });
    expect(seniorRequirement.breakdown.experience).toBeLessThan(met.breakdown.experience);
  });

  it('gives a preferred company a bonus', () => {
    const preferred = scoreJob({ profile, preferences }, strongJob);
    const other = scoreJob({ profile, preferences }, { ...strongJob, company: 'Someone Else Ltd' });
    expect(preferred.breakdown.preferences).toBeGreaterThanOrEqual(other.breakdown.preferences);
    expect(preferred.reasons.some((r) => r.includes('preferred companies'))).toBe(true);
  });
});

describe('requiredYears', () => {
  it('reads single values, ranges (upper bound) and plus signs', () => {
    expect(requiredYears('3+ years of experience')).toBe(3);
    expect(requiredYears('3-5 years of experience')).toBe(5);
    expect(requiredYears('no requirement here')).toBeNull();
  });
});
