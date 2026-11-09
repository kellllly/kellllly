import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFinancialAndPII, formatSecondsToSla } from './sanitizer';

test('sanitizeFinancialAndPII redacts IBAN and bank account numbers', () => {
  const input = 'Virement suspect vers le compte GA2100010002000300040005001 au Gabon';
  const result = sanitizeFinancialAndPII(input);
  assert.equal(result.itemsRedactedCount > 0, true);
  assert.equal(result.sanitizedText.includes('GA2100010002000300040005001'), false);
  assert.equal(result.sanitizedText.includes('[COMPTE BANCAIRE MASQUÉ'), true);
  assert.equal(result.detectedCategories.includes('Comptes Bancaires & IBAN'), true);
});

test('sanitizeFinancialAndPII redacts financial amounts in FCFA and EUR', () => {
  const input = 'Transaction non déclarée de 450 000 000 FCFA et 120 000 EUR détectée';
  const result = sanitizeFinancialAndPII(input);
  assert.equal(result.itemsRedactedCount >= 2, true);
  assert.equal(result.sanitizedText.includes('450 000 000 FCFA'), false);
  assert.equal(result.sanitizedText.includes('120 000 EUR'), false);
  assert.equal(result.detectedCategories.includes('Flux Financiers & Montants'), true);
});

test('sanitizeFinancialAndPII redacts fiscal and passport numbers', () => {
  const input = 'Identité liée au NIF: 994821-GA et PASSPORT: A12984501';
  const result = sanitizeFinancialAndPII(input);
  assert.equal(result.itemsRedactedCount >= 2, true);
  assert.equal(result.sanitizedText.includes('994821-GA'), false);
  assert.equal(result.sanitizedText.includes('A12984501'), false);
});

test('formatSecondsToSla formats positive, urgent and overdue countdowns', () => {
  // 1 hour 30 min 15 sec
  const normal = formatSecondsToSla(5415);
  assert.equal(normal.formatted, '01:30:15');
  assert.equal(normal.isUrgent, false);
  assert.equal(normal.isOverdue, false);

  // Urgent: 15 min remaining (< 30 min)
  const urgent = formatSecondsToSla(900);
  assert.equal(urgent.formatted, '00:15:00');
  assert.equal(urgent.isUrgent, true);
  assert.equal(urgent.isOverdue, false);

  // Overdue
  const overdue = formatSecondsToSla(-125);
  assert.equal(overdue.formatted, '-00:02:05');
  assert.equal(overdue.isOverdue, true);
});
