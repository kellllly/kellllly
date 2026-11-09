import { test } from 'node:test';
import assert from 'node:assert';
import {
  parseBiometricRecord,
  extractBiometricEvents,
  calculateBiometricStats,
  filterBiometricEvents,
  BiometricAuditRecord
} from './biometricAudit';
import { AuditEntry } from '../types';

test('parseBiometricRecord uses structured log.biometrie metadata when present', () => {
  const log: AuditEntry = {
    index: 10,
    id: 'AUD-BIO-001',
    timestampRFC3161: '2026-11-09 10:00:00 UTC [RFC 3161]',
    action: 'EXPORT_AUDIT_WORM_CSV_SIGNE',
    acteur: 'AGT-AN-042',
    roleNiveau: 2,
    details: 'Export CSV WORM signé via WebAuthn Platform',
    hachagePrecedent: '0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff',
    hachageActuel: 'aaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999',
    estValide: true,
    biometrie: {
      status: 'SUCCESS',
      actionType: 'EXPORT_AUDIT_WORM',
      actionTitle: 'Download WORM Audit (Export CSV Signé)',
      targetResource: 'Registre WORM (3 blocs scellés)',
      severity: 'CRITIQUE',
      biometricMethod: 'WebAuthn Platform (Touch ID)',
      authenticatorType: 'PLATFORM',
      userVerification: 'VERIFIED',
      credentialId: 'cred_anif_441_touch_id',
      challengeHex: 'deadbeef12345678',
      flags: {
        userPresent: true,
        userVerified: true,
        backupEligible: true,
        backupState: false
      }
    }
  };

  const parsed = parseBiometricRecord(log);
  assert.ok(parsed);
  assert.strictEqual(parsed?.status, 'SUCCESS');
  assert.strictEqual(parsed?.actionType, 'EXPORT_AUDIT_WORM');
  assert.strictEqual(parsed?.credentialId, 'cred_anif_441_touch_id');
  assert.strictEqual(parsed?.flags.userVerified, true);
  assert.strictEqual(parsed?.authenticatorType, 'PLATFORM');
});

test('parseBiometricRecord infers failed assertion details from UNAUTHORIZED_ACCESS_FIDO2', () => {
  const log: AuditEntry = {
    index: 12,
    id: 'AUD-BIO-FAIL',
    timestampRFC3161: '2026-11-09 10:05:00 UTC [RFC 3161]',
    action: 'UNAUTHORIZED_ACCESS_FIDO2',
    acteur: 'AGT-AN-042',
    roleNiveau: 2,
    details: 'Échec d\'authentification biométrique pour Purge Mémoire Vive : Annulation utilisateur',
    hachagePrecedent: '111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000',
    hachageActuel: '22223333444455556666777788889999aaaabbbbccccddddeeeeffff00001111',
    estValide: true
  };

  const parsed = parseBiometricRecord(log);
  assert.ok(parsed);
  assert.strictEqual(parsed?.status, 'FAILURE');
  assert.strictEqual(parsed?.userVerification, 'FAILED');
  assert.ok(parsed?.failureReason);
});

test('parseBiometricRecord returns null for non-biometric events', () => {
  const log: AuditEntry = {
    index: 1,
    id: 'AUD-CHAT',
    timestampRFC3161: '2026-11-09 10:10:00 UTC [RFC 3161]',
    action: 'MESSAGE_CHIFFRE_TRANSMIS',
    acteur: 'AGT-DG-001',
    roleNiveau: 1,
    details: 'Payload AES-GCM acheminé',
    hachagePrecedent: '0000',
    hachageActuel: '1111'
  };

  assert.strictEqual(parseBiometricRecord(log), null);
});

test('extractBiometricEvents and calculateBiometricStats compute correct metrics', () => {
  const logs: AuditEntry[] = [
    {
      index: 1,
      id: 'L1',
      timestampRFC3161: '2026-11-09 10:00:00 UTC',
      action: 'COMMUTATION_PRIVILEGE_WEBAUTHN',
      acteur: 'AGT-DG-001',
      roleNiveau: 1,
      details: 'Accréditation Niveau 1 débloquée via biométrie WebAuthn (Touch ID)',
      hachagePrecedent: '00',
      hachageActuel: '11'
    },
    {
      index: 2,
      id: 'L2',
      timestampRFC3161: '2026-11-09 10:01:00 UTC',
      action: 'UNAUTHORIZED_ACCESS_FIDO2',
      acteur: 'AGT-AN-042',
      roleNiveau: 2,
      details: 'Tentative de signature avec jeton FIDO2 révoqué',
      hachagePrecedent: '11',
      hachageActuel: '22'
    },
    {
      index: 3,
      id: 'L3',
      timestampRFC3161: '2026-11-09 10:02:00 UTC',
      action: 'MESSAGE_CHIFFRE_TRANSMIS',
      acteur: 'AGT-AN-042',
      roleNiveau: 2,
      details: 'Ignored chat message',
      hachagePrecedent: '22',
      hachageActuel: '33'
    }
  ];

  const events = extractBiometricEvents(logs);
  assert.strictEqual(events.length, 2);

  const stats = calculateBiometricStats(events);
  assert.strictEqual(stats.total, 2);
  assert.strictEqual(stats.success, 1);
  assert.strictEqual(stats.failure, 1);
  assert.strictEqual(stats.successRate, '50%');
});

test('filterBiometricEvents applies status, action, and keyword filters properly', () => {
  const events: BiometricAuditRecord[] = [
    {
      auditId: 'AUD-1',
      index: 1,
      timestampRFC3161: '2026-11-09 10:00:00 UTC',
      actorMatricule: 'AGT-DG-001',
      actorRoleNiveau: 1,
      merkleLeafHash: 'abc',
      rawDetails: 'Export test',
      status: 'SUCCESS',
      actionType: 'EXPORT_AUDIT_WORM',
      actionTitle: 'Download WORM Audit',
      targetResource: 'Registre WORM',
      severity: 'CRITIQUE',
      biometricMethod: 'Touch ID',
      authenticatorType: 'PLATFORM',
      userVerification: 'VERIFIED',
      credentialId: 'cred_touch_1',
      challengeHex: '0102',
      flags: { userPresent: true, userVerified: true, backupEligible: true, backupState: false },
      signaturePreview: 'sig1'
    },
    {
      auditId: 'AUD-2',
      index: 2,
      timestampRFC3161: '2026-11-09 10:05:00 UTC',
      actorMatricule: 'AGT-AN-042',
      actorRoleNiveau: 2,
      merkleLeafHash: 'def',
      rawDetails: 'Purge fail',
      status: 'FAILURE',
      actionType: 'SHRED_SESSION_KEYS',
      actionTitle: 'Purge Mémoire Vive',
      targetResource: 'Buffer RAM',
      severity: 'CRITIQUE',
      biometricMethod: 'YubiKey',
      authenticatorType: 'SECURITY_KEY',
      userVerification: 'FAILED',
      credentialId: 'cred_yubi_2',
      challengeHex: '0304',
      flags: { userPresent: true, userVerified: false, backupEligible: true, backupState: false },
      signaturePreview: 'sig2',
      failureReason: 'User canceled'
    }
  ];

  const onlySuccess = filterBiometricEvents(events, 'SUCCESS', 'ALL', '');
  assert.strictEqual(onlySuccess.length, 1);
  assert.strictEqual(onlySuccess[0].auditId, 'AUD-1');

  const onlyFailure = filterBiometricEvents(events, 'FAILURE', 'ALL', '');
  assert.strictEqual(onlyFailure.length, 1);
  assert.strictEqual(onlyFailure[0].auditId, 'AUD-2');

  const keywordFilter = filterBiometricEvents(events, 'ALL', 'ALL', 'YubiKey');
  assert.strictEqual(keywordFilter.length, 1);
  assert.strictEqual(keywordFilter[0].auditId, 'AUD-2');
});
