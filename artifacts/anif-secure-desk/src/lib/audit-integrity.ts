import type { ItsmAuditIntegrity } from '@workspace/api-client-react';

export type AuditIntegrityView = {
  tone: 'green' | 'red' | 'neutral';
  title: string;
  detail: string;
  /** Seal to note outside the pilot: proves later that nothing before it was rewritten. */
  seal: string | null;
  /** State of the append-only seal archive kept by PostgreSQL. */
  archive: string | null;
};

const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;

function describeArchive(archive: ItsmAuditIntegrity['archive'] | undefined): string | null {
  if (!archive) return null;
  if (archive.status === 'not_installed') return 'Archive des sceaux en ajout seul non installée sur la base : seule la chaîne est vérifiée.';
  const pending = archive.unarchived > 0 ? ` ${plural(archive.unarchived, 'sceau récent n’est', 'sceaux récents ne sont')} pas encore archivé${archive.unarchived > 1 ? 's' : ''}.` : '';
  return `${plural(archive.archived, 'sceau archivé', 'sceaux archivés')} par la base en ajout seul, tous retrouvés dans le journal.${pending}`;
}

export function describeAuditIntegrity(report: ItsmAuditIntegrity): AuditIntegrityView {
  const view = describeChain(report);
  if (report.archive?.status === 'diverged' && report.status !== 'broken') {
    const mismatch = report.archive.firstMismatch;
    const what = mismatch?.reason === 'missing' ? 'a disparu du journal' : 'a été modifié dans le journal';
    return {
      tone: 'red',
      title: 'Journal différent de son archive',
      detail: `Le sceau n° ${mismatch?.seq ?? '?'} conservé par la base en ajout seul ${what}. Le journal a pu être réécrit puis rescellé hors de l’application : prévenez l’administrateur.`,
      seal: null,
      archive: null,
    };
  }
  return { ...view, archive: report.status === 'broken' ? null : describeArchive(report.archive) };
}

function describeChain(report: ItsmAuditIntegrity): Omit<AuditIntegrityView, 'archive'> {
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
