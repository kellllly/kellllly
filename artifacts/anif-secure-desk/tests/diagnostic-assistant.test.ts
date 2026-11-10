import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIAGNOSTIC_HANDOFF_KEY,
  DIAGNOSTIC_HANDOFF_TTL_MS,
  consumeDiagnosticTicketHandoff,
  diagnosticTicketPrefill,
  findDiagnosticKedbSuggestions,
  saveDiagnosticTicketHandoff,
  ticketCategoryForService,
  type DiagnosticStorage,
} from '../src/lib/diagnostic-assistant.ts';
import type { KedbArticle, Service } from '../src/lib/types.ts';

class MemoryStorage implements DiagnosticStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const service: Service = {
  id: 'SVC-03',
  name: 'Réseau des bureaux',
  category: 'Infrastructure',
  status: 'Vigilance',
  owner: 'Équipe infrastructure',
  sla: 'Continu',
  description: 'Connexion réseau des postes de démonstration.',
};

const article = (id: string, serviceId: string | null, category: string, title: string): KedbArticle => ({
  id,
  title,
  symptom: 'Connexion intermittente',
  rootCause: 'Lien réseau instable',
  resolution: 'Vérifier le câble et le point d’accès',
  ticketId: `INC-${id}`,
  serviceId,
  category,
  createdAt: '2026-11-01T08:00:00.000Z',
  author: 'agent',
});

test('diagnostic KEDB suggestions rank the selected service before broad matches', () => {
  const serviceArticle = article('KEDB-0001', 'SVC-03', 'Infrastructure', 'Contrôle du lien');
  const categoryArticle = article('KEDB-0002', null, 'Infrastructure', 'Connexion instable');
  const unrelatedArticle = {
    ...article('KEDB-0003', null, 'Comptabilité', 'Écart de facture'),
    symptom: 'Montant de facture incorrect',
    rootCause: 'Donnée comptable à vérifier',
    resolution: 'Transmettre au service comptable',
  };
  assert.deepEqual(
    findDiagnosticKedbSuggestions(
      [categoryArticle, unrelatedArticle, serviceArticle],
      service,
      'connectivity',
    ).map((item) => item.id),
    ['KEDB-0001', 'KEDB-0002'],
  );
});

test('diagnostic service categories map to supported ticket categories', () => {
  assert.equal(ticketCategoryForService('Infrastructure'), 'Réseau');
  assert.equal(ticketCategoryForService('Accès et identité'), 'Accès');
  assert.equal(ticketCategoryForService('Poste de travail'), 'Poste de travail');
  assert.equal(ticketCategoryForService('Équipement'), 'Équipement');
  assert.equal(ticketCategoryForService('Collaboration'), 'Applications');
});

test('diagnostic handoff is consumed once and produces a reviewable ticket prefill', () => {
  const storage = new MemoryStorage();
  const handoff = {
    serviceId: service.id,
    symptomId: 'connectivity' as const,
    impact: 2 as const,
    urgency: 1 as const,
    apiProbe: 'healthy' as const,
  };
  assert.equal(saveDiagnosticTicketHandoff(storage, handoff, 1_000), true);
  assert.ok(storage.getItem(DIAGNOSTIC_HANDOFF_KEY));
  assert.deepEqual(consumeDiagnosticTicketHandoff(storage, 1_001), handoff);
  assert.equal(storage.getItem(DIAGNOSTIC_HANDOFF_KEY), null);
  assert.equal(consumeDiagnosticTicketHandoff(storage, 1_002), null);

  const prefill = diagnosticTicketPrefill(handoff, service);
  assert.equal(prefill.kind, 'Incident');
  assert.equal(prefill.serviceId, service.id);
  assert.equal(prefill.category, 'Réseau');
  assert.match(prefill.description, /API du pilote accessible/u);
  assert.match(prefill.description, /Aucune sonde vers Nkok ou Keycloak/u);
});

test('expired or invalid diagnostic handoffs are discarded', () => {
  const storage = new MemoryStorage();
  assert.equal(saveDiagnosticTicketHandoff(storage, {
    serviceId: 'SVC-03',
    symptomId: 'access',
    impact: 3,
    urgency: 2,
    apiProbe: 'unavailable',
  }, 10_000), true);
  assert.equal(consumeDiagnosticTicketHandoff(storage, 10_000 + DIAGNOSTIC_HANDOFF_TTL_MS + 1), null);
  assert.equal(storage.getItem(DIAGNOSTIC_HANDOFF_KEY), null);

  assert.equal(saveDiagnosticTicketHandoff(storage, {
    serviceId: 'SVC-03?new=1',
    symptomId: 'connectivity',
    impact: 1,
    urgency: 1,
    apiProbe: 'healthy',
  }, 20_000), false);
  assert.equal(storage.getItem(DIAGNOSTIC_HANDOFF_KEY), null);
});

test('handoff is not accepted if its timestamp is in the future', () => {
  const storage = new MemoryStorage();
  assert.equal(saveDiagnosticTicketHandoff(storage, {
    serviceId: 'SVC-03',
    symptomId: 'other',
    impact: 2,
    urgency: 2,
    apiProbe: 'not-run',
  }, 5_000), true);
  assert.equal(consumeDiagnosticTicketHandoff(storage, 4_999), null);
});
