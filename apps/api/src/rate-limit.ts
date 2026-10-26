import { ApiError } from './errors.js';

/** Per-instance bounded abuse control. Use an edge/shared limiter for multi-instance production. */
export class RateLimiter {
  private readonly entries = new Map<string, { count: number; reset: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  take(key: string, maximum: number, windowMs: number): void {
    const now = this.now();
    if (this.entries.size >= 10_000) {
      for (const [entry, value] of this.entries) if (value.reset <= now) this.entries.delete(entry);
      if (this.entries.size >= 10_000 && !this.entries.has(key)) {
        throw new ApiError(429, 'RATE_LIMIT', 'Terlalu banyak permintaan. Coba lagi nanti.');
      }
    }
    const entry = this.entries.get(key);
    if (!entry || entry.reset <= now) this.entries.set(key, { count: 1, reset: now + windowMs });
    else {
      if (entry.count >= maximum) throw new ApiError(429, 'RATE_LIMIT', 'Terlalu banyak permintaan. Coba lagi nanti.');
      entry.count += 1;
    }
  }
}
