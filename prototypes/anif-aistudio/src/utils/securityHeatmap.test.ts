import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSecurityEvents,
  computeSecurityHeatmapMetrics,
  getHourSlotFromDate
} from './securityHeatmap';
import { AuditEntry } from '../types';

test('getHourSlotFromDate maps hours to proper 4-hour slots', () => {
  assert.equal(getHourSlotFromDate(new Date('2026-11-08T02:00:00Z')), '00h-04h');
  assert.equal(getHourSlotFromDate(new Date('2026-11-08T07:30:00Z')), '04h-08h');
  assert.equal(getHourSlotFromDate(new Date('2026-11-08T10:15:00Z')), '08h-12h');
  assert.equal(getHourSlotFromDate(new Date('2026-11-08T14:45:00Z')), '12h-16h');
  assert.equal(getHourSlotFromDate(new Date('2026-11-08T19:00:00Z')), '16h-20h');
  assert.equal(getHourSlotFromDate(new Date('2026-11-08T22:00:00Z')), '20h-24h');
});

test('extractSecurityEvents filters only security blocked events', () => {
  const sampleLogs: AuditEntry[] = [
    {
      index: 1,
      id: 'AUD-1',
      timestampRFC3161: '2026-11-08 09:15:00 UTC [RFC 3161]',
      action: 'RATE_LIMIT_BLOCKED',
      acteur: '185.220.101.42',
      roleNiveau: 4,
      details: '45 req/s rejeté par Token Bucket',
      hachagePrecedent: '00',
      hachageActuel: '11',
      estValide: true
    },
    {
      index: 2,
      id: 'AUD-2',
      timestampRFC3161: '2026-11-08 10:30:00 UTC [RFC 3161]',
      action: 'UNAUTHORIZED_ACCESS_FIDO2',
      acteur: 'AGT-AP-204',
      roleNiveau: 4,
      details: 'PIN erroné',
      hachagePrecedent: '11',
      hachageActuel: '22',
      estValide: true
    },
    {
      index: 3,
      id: 'AUD-3',
      timestampRFC3161: '2026-11-08 11:00:00 UTC [RFC 3161]',
      action: 'MESSAGE_CHIFFRE_CANAL_SCELLÉ',
      acteur: 'AGT-DG-001',
      roleNiveau: 1,
      details: 'Envoi message légitime',
      hachagePrecedent: '22',
      hachageActuel: '33',
      estValide: true
    }
  ];

  const events = extractSecurityEvents(sampleLogs);
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'RATE_LIMIT');
  assert.equal(events[0].hourSlot, '08h-12h');
  assert.equal(events[1].type, 'UNAUTHORIZED_ACCESS');
  assert.equal(events[1].hourSlot, '08h-12h');
});

test('computeSecurityHeatmapMetrics aggregates buckets and computes intensities', () => {
  const sampleLogs: AuditEntry[] = [
    {
      index: 1,
      id: 'AUD-1',
      timestampRFC3161: '2026-11-08 13:00:00 UTC [RFC 3161]',
      action: 'RATE_LIMIT_BLOCKED',
      acteur: 'IP-1',
      roleNiveau: 4,
      details: 'Débit dépassé',
      hachagePrecedent: '00',
      hachageActuel: '11',
      estValide: true
    },
    {
      index: 2,
      id: 'AUD-2',
      timestampRFC3161: '2026-11-08 13:10:00 UTC [RFC 3161]',
      action: 'RATE_LIMIT_BLOCKED',
      acteur: 'IP-2',
      roleNiveau: 4,
      details: 'Débit dépassé',
      hachagePrecedent: '11',
      hachageActuel: '22',
      estValide: true
    },
    {
      index: 3,
      id: 'AUD-3',
      timestampRFC3161: '2026-11-08 14:00:00 UTC [RFC 3161]',
      action: 'UNAUTHORIZED_ACCESS_FIDO2',
      acteur: 'IP-3',
      roleNiveau: 4,
      details: 'Non autorisé',
      hachagePrecedent: '22',
      hachageActuel: '33',
      estValide: true
    }
  ];

  const metrics = computeSecurityHeatmapMetrics(sampleLogs, 0);
  assert.equal(metrics.totalEvents, 3);
  assert.equal(metrics.rateLimitTotal, 2);
  assert.equal(metrics.unauthorizedTotal, 1);
  assert.equal(metrics.peakSlot, '12h-16h');
  assert.equal(metrics.peakCount, 3);

  const slot12to16 = metrics.buckets.find((b) => b.timeSlot === '12h-16h');
  assert.ok(slot12to16);
  assert.equal(slot12to16.totalBlocked, 3);
  assert.equal(slot12to16.intensity, 100);
});
