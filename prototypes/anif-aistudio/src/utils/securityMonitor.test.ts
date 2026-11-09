import { test } from 'node:test';
import assert from 'node:assert';
import {
  categorizeAuditSecurityAction,
  detectSecurityAnomalies,
  createSecurityAlertTicket,
  SecurityMonitorWorker
} from './securityMonitor';
import { AuditEntry, ItsmTicket } from '../types';

const baseLog: AuditEntry = {
  index: 1,
  id: 'AUD-001',
  timestampRFC3161: '2026-11-08 15:00:00 UTC [RFC 3161]',
  action: 'MESSAGE_CHIFFRE_TRANSMIS',
  acteur: 'AGT-AN-042',
  roleNiveau: 2,
  details: 'Normal communication',
  hachagePrecedent: '0000',
  hachageActuel: '1111',
  estValide: true
};

test('categorizeAuditSecurityAction recognizes Rate Limit and Unauthorized Access actions accurately', () => {
  assert.strictEqual(categorizeAuditSecurityAction('RATE_LIMIT_BLOCKED'), 'RATE_LIMIT');
  assert.strictEqual(categorizeAuditSecurityAction('WAF_HTTP_429_TOO_MANY_REQUESTS'), 'RATE_LIMIT');
  assert.strictEqual(categorizeAuditSecurityAction('DDOS_BURST_ATTACK'), 'RATE_LIMIT');

  assert.strictEqual(categorizeAuditSecurityAction('UNAUTHORIZED_ACCESS_FIDO2'), 'UNAUTHORIZED_ACCESS');
  assert.strictEqual(categorizeAuditSecurityAction('ACCES_REFUSE_ZERO_KNOWLEDGE'), 'UNAUTHORIZED_ACCESS');
  assert.strictEqual(categorizeAuditSecurityAction('WAF_XSS_SQLI_BLOCKED'), 'UNAUTHORIZED_ACCESS');
  assert.strictEqual(categorizeAuditSecurityAction('AUTH_ECHEC_PIN_INVALID'), 'UNAUTHORIZED_ACCESS');

  assert.strictEqual(categorizeAuditSecurityAction('MESSAGE_CHIFFRE_TRANSMIS'), null);
  assert.strictEqual(categorizeAuditSecurityAction('INITIALISATION_REGISTRE'), null);
});

test('detectSecurityAnomalies detects repetitive Rate Limit events exceeding threshold', () => {
  const rateLimitLogs: AuditEntry[] = [
    { ...baseLog, id: 'L-1', action: 'RATE_LIMIT_BLOCKED', details: 'Token bucket 0/10' },
    { ...baseLog, id: 'L-2', action: 'RATE_LIMIT_BLOCKED', details: 'Token bucket 0/10' },
    { ...baseLog, id: 'L-3', action: 'RATE_LIMIT_BLOCKED', details: 'Token bucket 0/10' },
    { ...baseLog, id: 'L-4', action: 'MESSAGE_CHIFFRE_TRANSMIS' }
  ];

  const detection = detectSecurityAnomalies(rateLimitLogs, { repetitionThreshold: 3 });
  assert.ok(detection);
  assert.strictEqual(detection.detected, true);
  assert.strictEqual(detection.type, 'RATE_LIMIT');
  assert.strictEqual(detection.count, 3);
  assert.ok(detection.summary.includes('Token Bucket'));
});

test('detectSecurityAnomalies detects repetitive Unauthorized Access events', () => {
  const unauthLogs: AuditEntry[] = [
    { ...baseLog, id: 'U-1', action: 'ACCES_REFUSE_ZERO_KNOWLEDGE', details: 'Agent non accrédité canal DOS' },
    { ...baseLog, id: 'U-2', action: 'UNAUTHORIZED_ACCESS_FIDO2', details: 'PIN erroné' },
    { ...baseLog, id: 'U-3', action: 'WAF_XSS_SQLI_BLOCKED', details: 'Injection bloquée' }
  ];

  const detection = detectSecurityAnomalies(unauthLogs, { repetitionThreshold: 3 });
  assert.ok(detection);
  assert.strictEqual(detection.detected, true);
  assert.strictEqual(detection.type, 'UNAUTHORIZED_ACCESS');
  assert.strictEqual(detection.count, 3);
});

test('detectSecurityAnomalies returns null when events are below threshold', () => {
  const harmlessLogs: AuditEntry[] = [
    { ...baseLog, id: 'H-1', action: 'RATE_LIMIT_BLOCKED' },
    { ...baseLog, id: 'H-2', action: 'MESSAGE_CHIFFRE_TRANSMIS' },
    { ...baseLog, id: 'H-3', action: 'MESSAGE_CHIFFRE_TRANSMIS' }
  ];

  const detection = detectSecurityAnomalies(harmlessLogs, { repetitionThreshold: 3 });
  assert.strictEqual(detection, null);
});

test('createSecurityAlertTicket builds a high-priority P1 flag ticket with 48h constraint', () => {
  const anomalyLogs: AuditEntry[] = [
    { ...baseLog, id: 'A-1', action: 'RATE_LIMIT_BLOCKED', details: 'Seuil 10 req/s dépassé' },
    { ...baseLog, id: 'A-2', action: 'RATE_LIMIT_BLOCKED', details: 'Seuil 10 req/s dépassé' },
    { ...baseLog, id: 'A-3', action: 'RATE_LIMIT_BLOCKED', details: 'Seuil 10 req/s dépassé' }
  ];

  const detection = detectSecurityAnomalies(anomalyLogs, { repetitionThreshold: 3 });
  assert.ok(detection);

  const ticket = createSecurityAlertTicket(detection, 4);
  assert.strictEqual(ticket.priorite, 'P1');
  assert.strictEqual(ticket.estSousContrainte48h, true);
  assert.strictEqual(ticket.estEnEscalade, true);
  assert.strictEqual(ticket.demandeurMatricule, 'SYSTEM-SENTINEL-WAF');
  assert.strictEqual(ticket.slaSecondesRestantes, 7200);
  assert.ok(ticket.titre.includes('[ALERTE SÉCURITÉ WAF]'));
  assert.ok(ticket.descriptionAnonymisee.includes('DÉTECTION AUTOMATISÉE'));
});

test('SecurityMonitorWorker deduplicates and prevents multiple ticket spamming', () => {
  const worker = new SecurityMonitorWorker({ repetitionThreshold: 2, cooldownMs: 10000 });
  const logs: AuditEntry[] = [
    { ...baseLog, id: 'REP-1', action: 'RATE_LIMIT_BLOCKED' },
    { ...baseLog, id: 'REP-2', action: 'RATE_LIMIT_BLOCKED' }
  ];

  const existingTickets: ItsmTicket[] = [];

  // First inspection detects anomaly and generates ticket
  const ticket1 = worker.inspectLogs(logs, existingTickets);
  assert.ok(ticket1);
  assert.strictEqual(ticket1.priorite, 'P1');

  // Second immediate inspection on same logs returns null (deduplicated!)
  existingTickets.push(ticket1);
  const ticket2 = worker.inspectLogs(logs, existingTickets);
  assert.strictEqual(ticket2, null);
});
