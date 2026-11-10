import { useState } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, Landmark, ShieldCheck, Target } from 'lucide-react';
import { useStore } from '@/lib/store';
import { ROLES } from '@/lib/seed';
import { Badge, SectionTitle, Warning } from '@/components/kit';

type Cap = 'Oui' | 'Partiel' | 'Lecture' | 'Non';
const MATRIX: { cap: string; domain: string; v: [Cap, Cap, Cap, Cap, Cap] }[] = [
  { cap: 'Consulter le tableau de continuité', domain: 'Pilotage', v: ['Oui', 'Oui', 'Oui', 'Partiel', 'Lecture'] },
  { cap: 'Créer un ticket (incident, demande)', domain: 'Support', v: ['Oui', 'Oui', 'Oui', 'Oui', 'Non'] },
  { cap: 'Prendre en charge, escalader L1 à L3', domain: 'Support', v: ['Non', 'Non', 'Oui', 'Partiel', 'Non'] },
  { cap: 'Résoudre et documenter la cause racine', domain: 'Support', v: ['Non', 'Non', 'Oui', 'Partiel', 'Non'] },
  { cap: 'Ouvrir un problème', domain: 'Support', v: ['Non', 'Partiel', 'Oui', 'Non', 'Non'] },
  { cap: 'Approuver ou rejeter un changement (CAB)', domain: 'Changements', v: ['Oui', 'Non', 'Partiel', 'Non', 'Lecture'] },
  { cap: 'Convertir un message du canal support', domain: 'Messagerie', v: ['Non', 'Partiel', 'Oui', 'Non', 'Non'] },
  { cap: 'Participer aux conversations de travail', domain: 'Messagerie', v: ['Oui', 'Oui', 'Oui', 'Partiel', 'Non'] },
  { cap: 'Consulter la base d’erreurs connues', domain: 'Connaissance', v: ['Oui', 'Oui', 'Oui', 'Oui', 'Lecture'] },
  { cap: 'Exporter le journal d’activité', domain: 'Traçabilité', v: ['Oui', 'Non', 'Oui', 'Non', 'Oui'] },
  { cap: 'Administrer rôles et habilitations', domain: 'Gouvernance', v: ['Partiel', 'Non', 'Partiel', 'Non', 'Non'] },
  { cap: 'Utiliser l’assistant de diagnostic guidé', domain: 'Support', v: ['Oui', 'Oui', 'Oui', 'Partiel', 'Non'] },
];
const tone = (c: Cap) => (c === 'Oui' ? 'green' : c === 'Partiel' ? 'amber' : c === 'Lecture' ? 'blue' : 'neutral');

const CONTROLS: { domain: string; target: string; status: 'À réaliser' | 'À valider'; note: string }[] = [
  { domain: 'Chiffrement de bout en bout', target: 'E2EE des échanges, cycle de vie des clés (génération, rotation, révocation, séquestre)', status: 'À réaliser', note: 'Aucun chiffrement de bout en bout dans ce pilote; les données fictives sont partagées via le serveur.' },
  { domain: 'Identité forte', target: 'Authentification FIDO2 / clés matérielles, fédération et revue des habilitations', status: 'À réaliser', note: 'Les rôles N1 à N5 sont lus depuis les métadonnées Clerk côté serveur; les premiers N1 proviennent d’une liste d’adresses vérifiées configurée par un administrateur système. Attribuer, retirer ou attester un rôle exige une vérification d’identité Clerk de moins de 10 minutes, et un second facteur si l’option est activée. FIDO2 et la fédération restent à mettre en place.' },
  { domain: 'Journalisation', target: 'Stockage WORM, collecte SIEM, horodatage qualifié', status: 'À réaliser', note: 'Livré : journal scellé (chaîne SHA-256, points de contrôle Merkle vérifiables dans le navigateur), horodatage RFC 3161 par une autorité externe, archive des sceaux en ajout seul protégée par PostgreSQL et flux SIEM au format ECS. Reste : stockage WORM matériel (un administrateur de la base peut lever la protection), raccordement d’un SIEM et autorité qualifiée eIDAS.' },
  { domain: 'Pièces jointes', target: 'Chiffrement par fichier, nettoyage EXIF, analyse, prévisualisation isolée et rétention maîtrisée', status: 'À réaliser', note: 'Le pilote ne transporte pas de pièces jointes et ne fournit pas de nettoyage ou chiffrement documentaire.' },
  { domain: 'Sondes opérationnelles', target: 'Contrôles autorisés vers Nkok, annuaire IAM et dépendances réseau', status: 'À réaliser', note: 'Le Bot SI du pilote vérifie seulement /api/healthz et lit le catalogue de démonstration; aucune sonde Nkok ou Keycloak n’est configurée.' },
  { domain: 'Hébergement', target: 'Hébergement souverain Nkok / Libreville, sites actif et secours', status: 'À valider', note: 'Hypothèse d’architecture, aucun site qualifié à ce stade.' },
  { domain: 'Disponibilité', target: 'Objectif 99,99 % annuel', status: 'À valider', note: 'Cible de conception, non mesurée.' },
  { domain: 'Reprise d’activité', target: 'RTO < 15 min · RPO 0', status: 'À valider', note: 'À démontrer par exercices de bascule documentés.' },
  { domain: 'Sauvegardes', target: 'Règle 3-2-1-1-0 (copie hors ligne immuable, zéro erreur de restauration)', status: 'À réaliser', note: 'Aucune garantie de sauvegarde ou de restauration pour ce pilote.' },
  { domain: 'Assurance', target: 'Audit indépendant, tests d’intrusion, homologation', status: 'À réaliser', note: 'Prototype non homologué.' },
  { domain: 'Accompagnement', target: 'Formation des utilisateurs N1 à N5 et des équipes support', status: 'À réaliser', note: 'Supports de formation à produire.' },
];

const PHASES = [
  ['M1', 'Cadrage, analyse de risques et classification des données'],
  ['M2', 'Architecture cible et choix d’hébergement'],
  ['M3', 'Socle d’identité forte FIDO2'],
  ['M4', 'Messagerie chiffrée et gestion des clés'],
  ['M5', 'Centre ITIL, Bot SI, sondes autorisées et engagements de service'],
  ['M6', 'Journalisation WORM et raccordement SIEM'],
  ['M7', 'Sauvegardes 3-2-1-1-0 et plan de reprise'],
  ['M8', 'Tests d’intrusion et audit indépendant'],
  ['M9', 'Pilote encadré et formation'],
  ['M10', 'Homologation et décision de mise en production'],
];

export default function GovernancePage() {
  const { store, log } = useStore();
  const initial = Math.max(0, ROLES.findIndex(r => r.role === store.profile.role));
  const [view, setView] = useState(initial);
  const r = ROLES[view];
  return <div className="page-enter min-w-0"><Warning />
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><div className="eyebrow">GOUVERNANCE · RÉFÉRENTIEL</div><h2 className="serif mt-1 text-[27px]">Qui fait quoi, et ce qui reste à prouver.</h2><p className="mt-1 max-w-2xl text-[12px] text-muted-foreground">Matrice de capacités et état de préparation à la production. Les droits de chaque compte attribué sont contrôlés par l’API; les périmètres partiels N3/N4 dépendent des services associés au compte.</p></div><Link href="/settings" className="text-[11px] font-semibold text-primary hover:underline">Compte authentifié</Link></div>

    <div role="note" className="mb-5 flex items-start gap-3 rounded-xl border border-[#bfd0d1] bg-[#e8f0ef] px-4 py-3 text-[11px] leading-relaxed text-[#365456] dark:bg-[#24383b] dark:text-[#bdd3d1]"><ShieldCheck size={15} className="mt-0.5 shrink-0" /><div><strong>Les rôles sont appliqués côté serveur.</strong> L’API relit les métadonnées Clerk à chaque requête; un compte sans attribution reçoit un refus d’accès. L’interface ne peut ni choisir ni modifier le rôle de sa propre session.</div></div>

    <section className="panel p-5 md:p-6"><SectionTitle kicker="MATRICE DE CAPACITÉS N1 À N5" title="Vue contextuelle par rôle" />
      <div className="mb-4 flex flex-wrap gap-2">{ROLES.map((x, i) => <button key={x.role} data-testid={`button-role-view-${x.level}`} onClick={() => { setView(i); log(`Vue de gouvernance ${x.level} consultée`, 'Gouvernance'); }} className={`rounded-lg border px-3 py-2 text-left text-[11px] transition ${view === i ? 'border-primary bg-[#edf3ed] dark:bg-[#263b36]' : 'border-border hover:bg-muted/50'}`}><span className="mono mr-1.5 text-muted-foreground">{x.level}</span><span className="font-semibold">{x.role}</span></button>)}</div>
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-left"><thead><tr className="text-[9px] uppercase tracking-[.12em] text-muted-foreground"><th className="py-2 pr-3 font-medium">Capacité</th>{ROLES.map((x, i) => <th key={x.level} className={`px-2 py-2 text-center font-medium ${view === i ? 'rounded-t-lg bg-[#edf3ed] text-foreground dark:bg-[#263b36]' : ''}`}>{x.level}<div className="mt-0.5 normal-case tracking-normal">{x.role}</div></th>)}</tr></thead><tbody>{MATRIX.map(m => <tr key={m.cap} className="border-t border-border/70"><td className="py-2.5 pr-3"><div className="text-[11px] font-semibold">{m.cap}</div><div className="text-[10px] text-muted-foreground">{m.domain}</div></td>{m.v.map((c, i) => <td key={i} className={`px-2 py-2.5 text-center ${view === i ? 'bg-[#edf3ed] dark:bg-[#263b36]' : ''}`}><Badge tone={tone(c)}>{c}</Badge></td>)}</tr>)}</tbody></table></div>
      <div className="space-y-1.5 md:hidden">{MATRIX.map(m => <div key={m.cap} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"><div className="min-w-0 flex-1 break-words"><div className="text-[11px] font-semibold">{m.cap}</div><div className="text-[10px] text-muted-foreground">{m.domain}</div></div><Badge tone={tone(m.v[view])}>{m.v[view]}</Badge></div>)}</div>
      <p className="mt-4 rounded-lg bg-muted/60 p-3 text-[10px] leading-relaxed text-muted-foreground"><strong className="text-foreground">{r.level} · {r.role}</strong> — {r.text}. « Partiel » signifie limité au périmètre ou soumis à validation ; « Lecture » signifie consultation sans modification.</p>
    </section>

    <section className="panel mt-5 p-5 md:p-6"><SectionTitle kicker="PRÉPARATION À LA PRODUCTION" title="Contrôles requis" action={<Badge tone="amber">0 / {CONTROLS.length} contrôle(s) démontré(s)</Badge>} />
      <div className="divide-y divide-border/70">{CONTROLS.map(c => <div key={c.domain} className="grid min-w-0 gap-2 py-3.5 md:grid-cols-[180px_1fr_110px] md:items-start"><div className="flex items-center gap-2 text-[12px] font-semibold"><Target size={14} className="shrink-0 text-primary" />{c.domain}</div><div className="min-w-0 break-words"><div className="text-[11px]">{c.target}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{c.note}</div></div><div className="md:text-right"><Badge tone={c.status === 'À réaliser' ? 'red' : 'amber'} testId={`status-control-${c.domain}`}>{c.status}</Badge></div></div>)}</div>
    </section>

    <section className="panel mt-5 overflow-hidden"><div className="flex items-center gap-2 bg-[#213b42] px-5 py-4 text-[#eef3eb]"><Landmark size={16} className="text-[#9ac6ad]" /><div><div className="eyebrow text-[#a9c2b8]">FEUILLE DE ROUTE INDICATIVE</div><div className="text-[14px] font-semibold">Phases M1 à M10</div></div></div>
      <ol className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-5">{PHASES.map(([k, v]) => <li key={k} className="bg-card p-4"><div className="flex items-center justify-between"><span className="mono text-[11px] font-semibold text-primary">{k}</span><Badge>À réaliser</Badge></div><p className="mt-2 text-[11px] leading-relaxed">{v}</p></li>)}</ol>
      <div className="border-t border-border px-5 py-3 text-[10px] text-muted-foreground">Séquencement indicatif sans calendrier engagé. Aucune phase n’est démarrée dans le cadre de ce prototype.</div>
    </section>
  </div>;
}
