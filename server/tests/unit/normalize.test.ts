import { describe, expect, it } from 'vitest';
import { fingerprint, htmlToText, inferWorkMode, normalizeJob, parseSalary } from '../../src/jobs/normalize';

describe('parseSalary', () => {
  it('converts INR lakh ranges to annual rupees', () => {
    expect(parseSalary('₹24-33 LPA')).toEqual({ min: 2400000, max: 3300000, currency: 'INR' });
    expect(parseSalary('₹24L - ₹33L')).toEqual({ min: 2400000, max: 3300000, currency: 'INR' });
  });

  it('expands k-suffixed USD ranges', () => {
    expect(parseSalary('$90k-120k')).toEqual({ min: 90000, max: 120000, currency: 'USD' });
  });

  it('keeps euro amounts with separators as-is', () => {
    expect(parseSalary('€60,000 - €80,000')).toEqual({ min: 60000, max: 80000, currency: 'EUR' });
  });

  it('returns nulls when nothing is stated', () => {
    expect(parseSalary('Competitive')).toEqual({ min: null, max: null, currency: null });
    expect(parseSalary(null)).toEqual({ min: null, max: null, currency: null });
  });
});

describe('inferWorkMode', () => {
  it('detects remote, hybrid and onsite wording', () => {
    expect(inferWorkMode('Hybrid role in Pune')).toBe('hybrid');
    expect(inferWorkMode('Fully remote within India')).toBe('remote');
    expect(inferWorkMode('On-site at our office')).toBe('onsite');
    expect(inferWorkMode('Bengaluru')).toBeNull();
  });
});

describe('fingerprint', () => {
  it('is stable across case, punctuation and legal suffixes', () => {
    expect(fingerprint('Acme Fintech Pvt. Ltd.', 'Frontend Engineer', 'Pune, India')).toBe(
      fingerprint('acme fintech', 'frontend   engineer', 'pune india'),
    );
  });

  it('differs when the role or place differs', () => {
    expect(fingerprint('Acme', 'Frontend Engineer', 'Pune')).not.toBe(fingerprint('Acme', 'Backend Engineer', 'Pune'));
    expect(fingerprint('Acme', 'Frontend Engineer', 'Pune')).not.toBe(fingerprint('Acme', 'Frontend Engineer', 'Chennai'));
  });
});

describe('htmlToText', () => {
  it('strips tags, decodes entity-escaped HTML and keeps paragraph breaks', () => {
    const text = htmlToText('&lt;p&gt;Build &amp;amp; ship&lt;/p&gt;&lt;ul&gt;&lt;li&gt;React&lt;/li&gt;&lt;/ul&gt;');
    expect(text).toContain('Build & ship');
    expect(text).toContain('React');
    expect(text).not.toMatch(/<[^>]+>/);
  });
});

describe('normalizeJob', () => {
  it('rejects postings without a title, company or http(s) URL', () => {
    const base = { externalId: '1', source: 'x', title: 'Engineer', company: 'Acme', url: 'https://example.com/1' };
    expect(normalizeJob({ ...base, title: '  ' })).toBeNull();
    expect(normalizeJob({ ...base, company: '' })).toBeNull();
    expect(normalizeJob({ ...base, url: 'javascript:alert(1)' })).toBeNull();
  });

  it('fills salary and work mode from text when not given explicitly', () => {
    const job = normalizeJob({
      externalId: '2',
      source: 'rss',
      title: 'Engineer',
      company: 'Acme',
      url: 'https://example.com/2',
      salaryText: '₹20-28 LPA',
      description: '<p>Hybrid team</p>',
    });
    expect(job).toMatchObject({ salaryMin: 2000000, salaryMax: 2800000, salaryCurrency: 'INR', workMode: 'hybrid' });
    expect(job?.description).toBe('Hybrid team');
  });
});
