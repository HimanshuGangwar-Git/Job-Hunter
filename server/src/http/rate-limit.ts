import { HttpError } from './errors';

/**
 * Fixed-window limiter for sensitive endpoints such as login. Kept in memory, which is fine for a single
 * instance. Replace with a shared store before running multiple instances.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  consume(key: string): void {
    const current = this.clock();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= current) {
      this.hits.set(key, { count: 1, resetAt: current + this.windowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > this.limit) {
      throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
    }
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private clock(): number {
    return this.now();
  }
}
