/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Algorithme de Rate Limiting Souverain (Token Bucket / Seau à Jetons)
 * Conforme aux exigences OWASP de mitigation des attaques DDoS et Brute Force
 */

export interface RateLimitStatus {
  allowed: boolean;
  remainingTokens: number;
  maxTokens: number;
  retryAfterSeconds?: number;
  totalRequestsHandled: number;
  totalBlockedRequests: number;
}

export class TokenBucketRateLimiter {
  private capacity: number;
  private tokens: number;
  private refillRatePerSec: number;
  private lastRefillTimestamp: number;
  private totalRequests: number = 0;
  private totalBlocked: number = 0;

  constructor(capacity: number = 10, refillRatePerSec: number = 2) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRatePerSec = refillRatePerSec;
    this.lastRefillTimestamp = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillTimestamp) / 1000;
    const tokensToAdd = elapsedSeconds * this.refillRatePerSec;

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefillTimestamp = now;
    }
  }

  public consume(cost: number = 1): RateLimitStatus {
    this.refill();
    this.totalRequests++;

    if (this.tokens >= cost) {
      this.tokens -= cost;
      return {
        allowed: true,
        remainingTokens: Math.floor(this.tokens),
        maxTokens: this.capacity,
        totalRequestsHandled: this.totalRequests,
        totalBlockedRequests: this.totalBlocked
      };
    }

    this.totalBlocked++;
    const missingTokens = cost - this.tokens;
    const retryAfter = Math.ceil(missingTokens / this.refillRatePerSec);

    return {
      allowed: false,
      remainingTokens: 0,
      maxTokens: this.capacity,
      retryAfterSeconds: retryAfter,
      totalRequestsHandled: this.totalRequests,
      totalBlockedRequests: this.totalBlocked
    };
  }

  public getStatus(): RateLimitStatus {
    this.refill();
    return {
      allowed: this.tokens >= 1,
      remainingTokens: Math.floor(this.tokens),
      maxTokens: this.capacity,
      totalRequestsHandled: this.totalRequests,
      totalBlockedRequests: this.totalBlocked
    };
  }

  public reset(): void {
    this.tokens = this.capacity;
    this.lastRefillTimestamp = Date.now();
  }
}
