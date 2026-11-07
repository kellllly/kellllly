import type { ItsmAuditIntegrity } from '@workspace/api-client-react';

export type AuditIntegrityView = {
  tone: 'green' | 'red' | 'neutral';
  title: string;
  detail: string;
  /** Seal to note outside the pilot: proves later that nothing before it was rewritten. */
  seal: string | null;
};

const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;

export function describeAuditIntegrity(report: ItsmAuditIntegrity): AuditIntegrityView {
  if (report.status === 'empty') {
    return { tone: 'neutral', title: 'Journal vide', detail: 'Aucun événement à vérifier.', seal: null };
  }
  if (report.status === 'unsealed') {
    return {
      tone: 'neutral',
      title: 'Journal pas encore scellé',
      detail: 'Ce journal a été écrit avant l’activation du scellement. Il sera scellé au prochain démarrage du serveur ou à la prochaine modification de l’espace ; relancez ensuite la vérification.',
      seal: null,
    };
  }
  if (report.status === 'broken') {
    const where = report.firstBreak?.seq ? ` à l’événement n° ${report.firstBreak.seq}` : '';
    return {
      tone: 'red',
      title: 'Chaîne d’empreintes rompue',
      detail: `${report.firstBreak?.reason ?? 'Incohérence détectée'}${where}. Le journal a pu être modifié hors de l’application : prévenez l’administrateur.`,
      seal: null,
    };
  }
  const pruned = report.pruned === 1
    ? ' 1 ancien événement archivé ne garde que son empreinte.'
    : report.pruned > 1 ? ` ${report.pruned} anciens événements archivés ne gardent que leur empreinte.` : '';
  return {
    tone: 'green',
    title: 'Chaîne d’empreintes intacte',
    detail: `${plural(report.verified, 'événement vérifié', 'événements vérifiés')}.${pruned}`,
    seal: report.head ? `n° ${report.head.seq} · ${report.head.hash}` : null,
  };
}
