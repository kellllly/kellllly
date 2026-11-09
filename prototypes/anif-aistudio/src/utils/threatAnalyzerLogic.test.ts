import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAuditThreatsHeuristic } from './threatAnalyzerLogic';
import { AuditEntry } from '../types';

test('analyzeAuditThreatsHeuristic returns NOMINALE for empty logs', () => {
  const result = analyzeAuditThreatsHeuristic([]);
  assert.equal(result.threatLevel, 'NOMINALE');
  assert.equal(result.lateralPivotDetected, false);
  assert.equal(result.detectedPatterns.length, 0);
});

test('analyzeAuditThreatsHeuristic detects lateral pivot when failed auth is followed by sensitive action', () => {
  const sampleLogs: AuditEntry[] = [
    {
      index: 1,
      id: 'AUD-001',
      timestampRFC3161: '2026-11-08 11:42:10 UTC [RFC 3161]',
      action: 'UNAUTHORIZED_ACCESS_FIDO2',
      acteur: 'AGT-AP-204',
      roleNiveau: 4,
      details: 'Code PIN FIDO2 erroné (3 tentatives infructueuses)',
      hachagePrecedent: '00',
      hachageActuel: '11',
      estValide: true
    },
    {
      index: 2,
      id: 'AUD-002',
      timestampRFC3161: '2026-11-08 14:05:48 UTC [RFC 3161]',
      action: 'COMMUTATION_PRIVILEGE_WEBAUTHN',
      acteur: 'AGT-DG-001',
      roleNiveau: 1,
      details: 'Élévation de privilège demandée vers Niveau 1',
      hachagePrecedent: '11',
      hachageActuel: '22',
      estValide: true
    }
  ];

  const report = analyzeAuditThreatsHeuristic(sampleLogs);
  assert.equal(report.threatLevel, 'CRITIQUE');
  assert.equal(report.lateralPivotDetected, true);
  assert.ok(report.detectedPatterns.some((p) => p.category === 'LATERAL_PIVOT'));
  assert.ok(report.mitreCoverage.includes('T1078 (Valid Accounts)'));
});

test('analyzeAuditThreatsHeuristic detects repetitive rate limit attacks', () => {
  const rateLimitLogs: AuditEntry[] = [
    {
      index: 1,
      id: 'AUD-101',
      timestampRFC3161: '2026-11-08 13:00:00 UTC [RFC 3161]',
      action: 'RATE_LIMIT_BLOCKED',
      acteur: '185.220.101.42',
      roleNiveau: 4,
      details: 'Token Bucket 0/10 jetons',
      hachagePrecedent: '00',
      hachageActuel: '11',
      estValide: true
    },
    {
      index: 2,
      id: 'AUD-102',
      timestampRFC3161: '2026-11-08 13:01:00 UTC [RFC 3161]',
      action: 'RATE_LIMIT_BLOCKED',
      acteur: '185.220.101.42',
      roleNiveau: 4,
      details: 'Token Bucket 0/10 jetons',
      hachagePrecedent: '11',
      hachageActuel: '22',
      estValide: true
    }
  ];

  const report = analyzeAuditThreatsHeuristic(rateLimitLogs);
  assert.ok(report.detectedPatterns.some((p) => p.category === 'REPETITIVE_DDOS'));
  assert.ok(report.mitreCoverage.includes('T1499 (Endpoint Denial of Service)'));
});
