import { config } from './config.js';

/**
 * Sliding-Window Rate Limiter
 * Tracks requests in a rolling 60-second window to strictly respect Groq RPM limits.
 */
export class AIRateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number = 60_000; // 60 seconds

  constructor(maxRequestsPerMinute: number = config.groqRpmLimit) {
    this.maxRequests = maxRequestsPerMinute;
  }

  /**
   * Acquires a rate-limit slot before sending a request to the AI model.
   * If the number of requests in the last 60 seconds has reached the limit,
   * automatically delays until the oldest request exits the rolling window.
   */
  public async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      // Prune timestamps older than 60 seconds
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }

      // Calculate wait time until the earliest request expires from the window
      const oldestTimestamp = this.timestamps[0] ?? now;
      const waitTime = Math.max(100, this.windowMs - (now - oldestTimestamp) + 100);

      console.warn(
        `[AI Rate Limiter] ⏳ Groq RPM limit reached (${this.timestamps.length}/${this.maxRequests} req/min). Throttling next AI request for ${(waitTime / 1000).toFixed(1)}s...`
      );

      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  /**
   * Returns current active requests in the 60s rolling window.
   */
  public getCurrentRpm(): number {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    return this.timestamps.length;
  }
}

export const aiRateLimiter = new AIRateLimiter(config.groqRpmLimit);
