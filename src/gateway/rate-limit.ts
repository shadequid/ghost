/** Sliding window rate limiter tracking request timestamps per IP. */
export class RateLimiter {
  /** Map from IP to array of request timestamps (ms). */
  private readonly windows = new Map<string, number[]>();
  /** Count of check() calls; used to trigger periodic eviction. */
  private checkCount = 0;

  constructor(private readonly maxPerMinute: number) {}

  /**
   * Record a request for the given IP.
   * Returns true if the request is allowed, false if the limit is exceeded.
   * Calls evict() every 100 checks to prevent unbounded memory growth.
   */
  check(ip: string): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;

    const timestamps = this.windows.get(ip) ?? [];
    // Evict timestamps outside the sliding window
    const recent = timestamps.filter((t) => t > windowStart);

    if (recent.length >= this.maxPerMinute) {
      // Update with cleaned list (no new entry)
      this.windows.set(ip, recent);
      this.maybeEvict();
      return false;
    }

    recent.push(now);
    this.windows.set(ip, recent);
    this.maybeEvict();
    return true;
  }

  /** Call evict() every 100 checks to keep memory bounded. */
  private maybeEvict(): void {
    this.checkCount++;
    if (this.checkCount % 100 === 0) {
      this.evict();
    }
  }

  /** Remove stale IP entries to prevent unbounded memory growth. */
  evict(): void {
    const windowStart = Date.now() - 60_000;
    for (const [ip, timestamps] of this.windows) {
      const recent = timestamps.filter((t) => t > windowStart);
      if (recent.length === 0) {
        this.windows.delete(ip);
      } else {
        this.windows.set(ip, recent);
      }
    }
  }
}
