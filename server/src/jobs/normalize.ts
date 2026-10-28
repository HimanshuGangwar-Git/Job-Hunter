import { createHash } from 'node:crypto';
import type { WorkMode } from '../domain/types';

export interface NormalizedJob {
  externalId: string;
  source: string;
  title: string;
  company: string;
  location: string;
  workMode: WorkMode | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryText: string | null;
  description: string;
  url: string;
  postedAt: string | null;
}

export interface RawJobInput {
  externalId: string;
  source: string;
  title: string;
  company: string;
  location?: string | null;
  workModeHint?: string | null;
  salaryText?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  description?: string | null;
  url: string;
  postedAt?: string | number | Date | null;
}

const MAX_DESCRIPTION = 20_000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  bull: '•',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Converts HTML (possibly entity-escaped, as some job APIs return it) into readable plain text. */
export function htmlToText(html: string): string {
  const decoded = decodeEntities(decodeEntities(html));
  return decoded
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
    .slice(0, MAX_DESCRIPTION);
}

const LAKH_UNIT = /(lpa|lakhs?|lacs?|\bl\b)/i;

/**
 * Parses common salary strings into annual amounts:
 * "₹24-33 LPA", "₹24L - ₹33L", "$90k-120k", "€60,000 - €80,000". Returns nulls when it cannot be sure.
 */
export function parseSalary(text: string | null | undefined): {
  min: number | null;
  max: number | null;
  currency: string | null;
} {
  const empty = { min: null, max: null, currency: null };
  if (!text) return empty;

  const currency = /₹|\binr\b|rs\.?\s/i.test(text)
    ? 'INR'
    : /\$|\busd\b/i.test(text)
      ? 'USD'
      : /€|\beur\b/i.test(text)
        ? 'EUR'
        : /£|\bgbp\b/i.test(text)
          ? 'GBP'
          : null;

  const range = /([\d][\d,.]*)\s*(k|l|lpa|lakhs?|lacs?)?\s*(?:-|–|—|to)\s*₹?\$?€?£?\s*([\d][\d,.]*)\s*(k|l|lpa|lakhs?|lacs?)?/i.exec(text);
  if (!range) return { ...empty, currency };

  const toNumber = (raw: string) => Number(raw.replace(/,/g, ''));
  const scale = (value: number, unit: string | undefined, otherUnit: string | undefined): number => {
    const u = (unit ?? otherUnit ?? '').toLowerCase();
    if (u === 'k') return value * 1000;
    if (currency === 'INR' && (LAKH_UNIT.test(u) || (!u && value < 1000))) return value * 100000;
    return value;
  };

  const low = toNumber(range[1]);
  const high = toNumber(range[3]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return { ...empty, currency };

  const min = scale(low, range[2], range[4]);
  const max = scale(high, range[4], range[2]);
  return { min: Math.min(min, max), max: Math.max(min, max), currency };
}

export function inferWorkMode(text: string | null | undefined): WorkMode | null {
  if (!text) return null;
  if (/\bhybrid\b/i.test(text)) return 'hybrid';
  if (/\bremote\b|\bwork from home\b|\bwfh\b/i.test(text)) return 'remote';
  if (/\bon[- ]?site\b|\bin[- ]office\b|\bwork from office\b/i.test(text)) return 'onsite';
  return null;
}

const LEGAL_SUFFIXES = /\b(inc|incorporated|ltd|limited|llc|pvt|private|corp|corporation|co|gmbh|plc)\b\.?/gi;

/** Stable key for cross-source deduplication: the same role at the same company in the same place. */
export function fingerprint(company: string, title: string, location: string): string {
  const clean = (value: string) =>
    value
      .toLowerCase()
      .replace(LEGAL_SUFFIXES, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  const key = [clean(company), clean(title), clean(location)].join('|');
  return createHash('sha256').update(key).digest('hex');
}

export function parseDate(value: string | number | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Validates and normalises a raw job from any connector. Returns null when required fields are missing. */
export function normalizeJob(raw: RawJobInput): NormalizedJob | null {
  const title = raw.title?.replace(/\s+/g, ' ').trim();
  const company = raw.company?.replace(/\s+/g, ' ').trim();
  const url = raw.url?.trim();
  if (!title || !company || !url || !/^https?:\/\//i.test(url)) return null;

  const description = htmlToText(raw.description ?? '');
  const location = (raw.location ?? '').replace(/\s+/g, ' ').trim();
  const parsed = parseSalary(raw.salaryText);
  const salaryMin = raw.salaryMin ?? parsed.min;
  const salaryMax = raw.salaryMax ?? parsed.max;

  const workMode = inferWorkMode(raw.workModeHint) ?? inferWorkMode(`${location} ${title} ${description.slice(0, 400)}`);

  return {
    externalId: String(raw.externalId),
    source: raw.source,
    title: title.slice(0, 200),
    company: company.slice(0, 160),
    location: location.slice(0, 160),
    workMode,
    salaryMin: salaryMin ?? null,
    salaryMax: salaryMax ?? null,
    salaryCurrency: raw.salaryCurrency ?? parsed.currency,
    salaryText: raw.salaryText ?? null,
    description,
    url,
    postedAt: parseDate(raw.postedAt),
  };
}
