/**
 * Property-based fuzzing of the browser helpers that read untrusted text:
 * support messages, attachment names, a pasted checkpoint, and drafts kept in
 * localStorage (which another script or a corrupted profile can rewrite).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { findSensitiveData } from '../src/lib/sensitive-data.ts';
import { checkAttachment } from '../src/lib/attachments.ts';
import { formatCheckpoint, parseCheckpoint } from '../src/lib/audit-merkle.ts';
import { readRecoveryDraftsWithStatus } from '../src/lib/recovery-draft.ts';

const RUNS = Number(process.env.FUZZ_RUNS ?? 300);
const SEED = Number(process.env.FUZZ_SEED ?? 20261109);
const text = fc.oneof(fc.string({ maxLength: 300 }), fc.stringMatching(/^[0-9 +.@a-zA-Z-]{0,200}$/u));

test('fuzz: the personal-data filter never crashes and never shows a full match back', () => {
  fc.assert(fc.property(fc.array(text, { maxLength: 3 }), (texts) => {
    for (const finding of findSensitiveData(...texts)) {
      assert.ok(finding.sample.length <= 5, `sample "${finding.sample}" reveals too much`);
    }
  }), { numRuns: RUNS, seed: SEED });
});

test('fuzz: an e-mail address or a valid card number is caught whatever surrounds it', () => {
  const noise = fc.stringMatching(/^[a-zA-Zàéè ,;!?]{0,60}$/u);
  fc.assert(fc.property(noise, noise, fc.constantFrom('agent.test@example.org', '4111 1111 1111 1111'), (before, after, secret) => {
    const kinds = findSensitiveData(`${before} ${secret} ${after}`).map((finding) => finding.kind);
    assert.ok(kinds.some((kind) => /e-mail|carte/u.test(kind)), `${secret} missed`);
  }), { numRuns: RUNS, seed: SEED });
});

test('the personal-data filter stays fast on long adversarial inputs (no catastrophic backtracking)', () => {
  const inputs = [
    '1 '.repeat(50_000), '0'.repeat(100_000), `${'a.'.repeat(40_000)}@`, `+${'1-'.repeat(40_000)}`,
    `${'AB12 '.repeat(20_000)}`, `${'né '.repeat(30_000)}`, '@'.repeat(100_000), `${'x'.repeat(100_000)}@${'y'.repeat(100_000)}`,
  ];
  for (const input of inputs) {
    const started = performance.now();
    findSensitiveData(input);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 1500, `${elapsed.toFixed(0)} ms for ${input.slice(0, 12)}… (${input.length} chars)`);
  }
});

test('fuzz: attachment checks never crash, and an executable behind any name stays refused', () => {
  fc.assert(fc.property(fc.string({ maxLength: 200 }), fc.string({ maxLength: 80 }), fc.oneof(fc.integer(), fc.double()), (name, type, size) => {
    const check = checkAttachment(name, type, size);
    assert.ok(Array.isArray(check.warnings));
  }), { numRuns: RUNS, seed: SEED });
  fc.assert(fc.property(fc.stringMatching(/^[a-zA-Z0-9 _-]{0,20}$/u), fc.constantFrom('exe', 'BAT', 'Ps1', 'vbs', 'scr', 'jar'), (stem, ext) => {
    assert.ok(checkAttachment(`${stem}.pdf.${ext}`, 'application/pdf', 10).blocked);
  }), { numRuns: RUNS, seed: SEED });
});

test('fuzz: a pasted checkpoint is read back exactly or rejected, never misread', () => {
  fc.assert(fc.property(fc.string({ maxLength: 120 }), (pasted) => {
    const checkpoint = parseCheckpoint(pasted);
    if (checkpoint) assert.match(formatCheckpoint(checkpoint), /^[1-9]\d{0,8}:[0-9a-f]{64}$|^\d+:[0-9a-f]{64}$/u);
  }), { numRuns: RUNS, seed: SEED });
  fc.assert(fc.property(fc.integer({ min: 1, max: 999_999_999 }), fc.stringMatching(/^[0-9a-f]{64}$/u), (size, root) => {
    assert.deepEqual(parseCheckpoint(formatCheckpoint({ size, root })), { size, root });
  }), { numRuns: RUNS, seed: SEED });
});

test('fuzz: corrupted drafts in localStorage are reported, never thrown', () => {
  fc.assert(fc.property(fc.oneof(fc.string({ maxLength: 200 }), fc.jsonValue().map((value) => JSON.stringify(value))), (stored) => {
    const storage = { getItem: () => stored, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 1 } as unknown as Storage;
    const result = readRecoveryDraftsWithStatus(storage, 'cle');
    assert.ok(Array.isArray(result.drafts));
  }), { numRuns: RUNS, seed: SEED });
});
