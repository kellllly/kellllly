import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../src/lib/seed';
import { createIncidentFromMessage, isConvertibleSupportMessage } from '../src/lib/message-conversion';

test('support instructions cannot be converted and reports stay linked to their source message', () => {
  const store = migrate(null);
  const conversation = store.conversations.find(c => c.id === 'C-SUP')!;
  const instruction = conversation.messages.find(message => message.id === 'sup-1')!;
  const report = conversation.messages.find(message => message.id === 'sup-2')!;

  assert.equal(isConvertibleSupportMessage(instruction), false);
  assert.equal(isConvertibleSupportMessage(report), true);

  const reloadedConversation = migrate({
    seeded: ['support-channel', 'itil-tickets'],
    conversations: [{
      id: 'C-SUP',
      title: conversation.title,
      kind: 'Support',
      classification: conversation.classification,
      participants: conversation.participants,
      readCount: conversation.readCount,
      messages: conversation.messages.map(({ isInstruction: _isInstruction, ...message }) => message),
    }],
  }).conversations.find(c => c.id === 'C-SUP')!;
  assert.equal(isConvertibleSupportMessage(reloadedConversation.messages.find(message => message.id === 'sup-1')!), false);

  const incident = createIncidentFromMessage({
    message: report,
    conversationId: conversation.id,
    ticketId: 'INC-TEST',
    title: 'Échec d’impression',
    summary: 'Erreur de file d’attente.',
    impact: 2,
    urgency: 2,
    serviceId: '',
    openedAt: '2026-11-01T10:00:00.000Z',
    actor: store.profile.name,
  });
  assert.equal(incident.sourceMessageId, 'sup-2');
  assert.equal(incident.conversationId, 'C-SUP');
  assert.notEqual(incident.sourceMessageId, instruction.id);
});

test('a newly sent support instruction keeps its type after reload and is not convertible', () => {
  const store = migrate(null);
  const conversation = store.conversations.find(c => c.id === 'C-SUP')!;
  const instruction = {
    id: 'user-instruction', author: store.profile.name, body: 'Suivez la procédure de redémarrage.', time: '',
    isInstruction: true,
  };
  const report = {
    id: 'user-report', author: store.profile.name, body: 'Le portail affiche une erreur.', time: '',
    isInstruction: false,
  };
  const saved = {
    ...store,
    conversations: store.conversations.map(c => c.id === conversation.id
      ? { ...c, messages: [...c.messages, instruction, report] }
      : c),
  };

  const reloaded = migrate(JSON.parse(JSON.stringify(saved)));
  const reloadedMessages = reloaded.conversations.find(c => c.id === conversation.id)!.messages;
  const reloadedInstruction = reloadedMessages.find(message => message.id === instruction.id)!;
  const reloadedReport = reloadedMessages.find(message => message.id === report.id)!;

  assert.equal(reloadedInstruction.isInstruction, true);
  assert.equal(isConvertibleSupportMessage(reloadedInstruction), false);
  assert.equal(reloadedReport.isInstruction, false);
  assert.equal(isConvertibleSupportMessage(reloadedReport), true);
});
