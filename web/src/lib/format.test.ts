import { describe, expect, it } from 'vitest';
import { formatSalary, isOverdue, relativeDate, scoreTone } from './format';

describe('scoreTone', () => {
  it('maps scores to tones', () => {
    expect(scoreTone(91)).toBe('high');
    expect(scoreTone(80)).toBe('high');
    expect(scoreTone(65)).toBe('medium');
    expect(scoreTone(12)).toBe('low');
    expect(scoreTone(null)).toBe('none');
  });
});

describe('formatSalary', () => {
  it('formats INR lakhs', () => {
    expect(formatSalary(2400000, 3300000, 'INR')).toBe('₹24L – ₹33L');
  });
  it('handles missing salary', () => {
    expect(formatSalary(null, null, 'INR')).toBe('Not disclosed');
  });
  it('formats USD thousands', () => {
    expect(formatSalary(90000, 120000, 'USD')).toBe('$90k – $120k');
  });
});

describe('relativeDate', () => {
  it('describes recent dates', () => {
    const now = new Date('2026-10-29T12:00:00Z');
    expect(relativeDate('2026-10-29T06:00:00Z', now)).toBe('Today');
    expect(relativeDate('2026-10-28T06:00:00Z', now)).toBe('Yesterday');
    expect(relativeDate('2026-10-25T06:00:00Z', now)).toBe('4 days ago');
  });
});

describe('isOverdue', () => {
  it('flags past follow-ups only', () => {
    const now = new Date('2026-10-29T12:00:00Z');
    expect(isOverdue('2026-10-28T00:00:00Z', now)).toBe(true);
    expect(isOverdue('2026-10-30T00:00:00Z', now)).toBe(false);
    expect(isOverdue(null, now)).toBe(false);
  });
});
