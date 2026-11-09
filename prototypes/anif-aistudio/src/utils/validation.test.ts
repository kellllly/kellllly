import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSecurePayload, SafeTextSchema, MessageInputSchema } from './validation';
import { TokenBucketRateLimiter } from './rateLimiter';

test('SafeTextSchema accepts valid legitimate plain text', () => {
  const input = 'Transmission sécurisée conforme au décret ANINF 2026.';
  const res = validateSecurePayload(SafeTextSchema, input);
  assert.equal(res.success, true);
});

test('SafeTextSchema blocks malicious XSS script injections', () => {
  const xssPayload = 'Bonjour <script>alert("hacked")</script>';
  const res = validateSecurePayload(SafeTextSchema, xssPayload);
  assert.equal(res.success, false);
  if (!res.success) {
    assert.equal(res.errors[0].includes('XSS'), true);
  }
});

test('SafeTextSchema blocks malicious SQL injection payloads', () => {
  const sqliPayload = "admin' OR '1'='1' --";
  const res = validateSecurePayload(SafeTextSchema, sqliPayload);
  assert.equal(res.success, false);
  if (!res.success) {
    assert.equal(res.errors[0].includes('SQL'), true);
  }
});

test('TokenBucketRateLimiter allows burst up to capacity and rejects overflow with 429', () => {
  const limiter = new TokenBucketRateLimiter(3, 1); // 3 tokens max, 1 refilled per sec
  // Consume 3 tokens
  assert.equal(limiter.consume().allowed, true);
  assert.equal(limiter.consume().allowed, true);
  assert.equal(limiter.consume().allowed, true);

  // 4th request must be blocked
  const blocked = limiter.consume();
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds! >= 1, true);
  assert.equal(blocked.totalBlockedRequests, 1);
});
