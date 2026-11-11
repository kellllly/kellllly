import test from 'node:test';
import assert from 'node:assert/strict';
import { recurringIncidents } from '../src/lib/domain';
import { normalizeTicket } from '../src/lib/seed';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const inc = (id: string, fields: Record<string, unknown> = {}) =>
  normalizeTicket({ id, kind: 'Incident', status: 'En cours', category: 'Réseau', serviceId: 'SVC-A', impact: 2, urgency: 2, openedAt: daysAgo(1), updates: [], ...fields });

test('recurrence: 3 incidents of one service and category within 7 days, not yet attached', () => {
  const tickets = [
    inc('INC-3'), inc('INC-1'), inc('INC-2', { status: 'Clos', closedAt: daysAgo(0.5) }),
    inc('INC-4', { openedAt: daysAgo(8) }), // outside the window
    inc('INC-5', { status: 'Rejeté' }), // not an incident to investigate
    inc('INC-6', { category: 'Accès' }), inc('INC-7', { category: 'Accès' }), // only two
    inc('INC-8', { serviceId: null }), inc('INC-9', { serviceId: null }), inc('INC-10', { serviceId: null }),
    normalizeTicket({ id: 'REQ-11', kind: 'Demande', category: 'Réseau', serviceId: 'SVC-A', openedAt: daysAgo(1), updates: [] }),
  ];
  assert.deepEqual(recurringIncidents(tickets, NOW), [{ serviceId: 'SVC-A', category: 'Réseau', incidentIds: ['INC-1', 'INC-2', 'INC-3'] }]);

  const problem = (status: string) => normalizeTicket({ id: 'PRB-12', kind: 'Problème', status, incidentIds: ['INC-1', 'INC-2'], openedAt: daysAgo(0), updates: [] });
  assert.deepEqual(recurringIncidents([...tickets, problem('Nouveau')], NOW), [], 'two attached: one left, below the threshold');
  assert.equal(recurringIncidents([...tickets, problem('Rejeté')], NOW).length, 1, 'a rejected problem frees its incidents');
});
