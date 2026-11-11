import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketKpis } from '../src/lib/domain';
import { normalizeTicket } from '../src/lib/seed';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const ticket = (fields: Record<string, unknown>) => normalizeTicket({ impact: 1, urgency: 1, updates: [], ...fields });

test('ITIL indicators: MTTR, resolution SLA rate and volumes', () => {
  const kpis = ticketKpis([
    // P1 (2 h): resolved in 1 h, on time.
    ticket({ id: 'INC-1', category: 'Réseau', assignee: 'Olivier Nguema', status: 'Résolu', openedAt: ago(300), resolvedAt: ago(240) }),
    // P1 closed without resolvedAt, 3 h after opening: late; closedAt ends the resolution.
    ticket({ id: 'INC-2', category: 'Réseau', assignee: 'Olivier Nguema', status: 'Clos', openedAt: ago(600), resolvedAt: null, closedAt: ago(420) }),
    // P1 open past its deadline: a breach without a resolution time.
    ticket({ id: 'INC-3', category: 'Accès', assignee: '', status: 'En cours', openedAt: ago(200) }),
    // P1 open, deadline not reached: outcome unknown, left out of the rate.
    ticket({ id: 'INC-4', category: 'Accès', assignee: 'Olivier Nguema', status: 'Nouveau', openedAt: ago(30) }),
    // Rejected: not support work.
    ticket({ id: 'INC-5', category: 'Réseau', assignee: 'Olivier Nguema', status: 'Rejeté', openedAt: ago(30) }),
  ], NOW);
  assert.equal(kpis.total, 4);
  assert.equal(kpis.resolved, 2);
  assert.equal(kpis.mttrMs, 120 * 60_000, 'mean of 60 and 180 minutes');
  assert.equal(kpis.slaMet, 1);
  assert.equal(kpis.slaDecided, 3);
  assert.equal(kpis.slaRate, 1 / 3);
  assert.deepEqual(kpis.byCategory, [{ label: 'Accès', count: 2 }, { label: 'Réseau', count: 2 }]);
  assert.deepEqual(kpis.byAssignee, [{ label: 'Olivier Nguema', count: 3 }, { label: 'Non renseigné', count: 1 }]);
});

test('satisfaction average counts only valid 1–5 ratings', () => {
  const closed = (id: string, satisfaction: unknown) => ticket({ id, status: 'Clos', openedAt: ago(60), closedAt: ago(30), satisfaction });
  // 9 and 3.5 can only come from a tampered store: ignored.
  const kpis = ticketKpis([closed('INC-1', 2), closed('INC-2', 5), closed('INC-3', 9), closed('INC-4', 3.5), closed('INC-5', null)], NOW);
  assert.equal(kpis.satisfactionAvg, 3.5);
  assert.equal(kpis.satisfactionCount, 2);
});

test('ITIL indicators stay empty without data', () => {
  const kpis = ticketKpis([ticket({ id: 'INC-1', status: 'Nouveau', openedAt: ago(5) })], NOW);
  assert.equal(kpis.mttrMs, null);
  assert.equal(kpis.slaRate, null);
  assert.deepEqual(ticketKpis([], NOW).byCategory, []);
});
