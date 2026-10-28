import type { ApplicationStatus } from '../types';

export function scoreTone(score: number | null | undefined): 'high' | 'medium' | 'low' | 'none' {
  if (score === null || score === undefined) return 'none';
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

export function statusTone(status: ApplicationStatus): string {
  switch (status) {
    case 'Offer':
      return 'success';
    case 'Interview':
    case 'Applied':
      return 'info';
    case 'Ready to Apply':
    case 'CV Customized':
      return 'accent';
    case 'Shortlisted':
      return 'warning';
    case 'Rejected':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function formatSalary(min: number | null, max: number | null, currency: string | null): string {
  if (min === null && max === null) return 'Not disclosed';
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₹';
  const fmt = (value: number) => {
    if (currency === 'INR' || currency === null) {
      return value >= 100000 ? `${(value / 100000).toFixed(value % 100000 === 0 ? 0 : 1)}L` : value.toLocaleString('en-IN');
    }
    return value >= 1000 ? `${Math.round(value / 1000)}k` : value.toString();
  };
  if (min !== null && max !== null && min !== max) return `${symbol}${fmt(min)} – ${symbol}${fmt(max)}`;
  return `${symbol}${fmt(min ?? max ?? 0)}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function relativeDate(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const diffMs = now.getTime() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(iso);
}

export function isOverdue(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < now.getTime();
}

export function toDateInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}
