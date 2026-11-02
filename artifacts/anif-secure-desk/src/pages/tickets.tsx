import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { ArrowUpRight, BookOpen, CheckCheck, CircleCheck, Filter, Gavel, Hand, MessageSquare, Pause, Pencil, Play, Plus, RotateCcw, Search, Send, Timer } from 'lucide-react';
import { SLA_POLICIES, formatWAT, priorityFor } from '@/lib/itsm';
import { useNow, useStore } from '@/lib/store';
import { KINDS, LEVEL_LABEL, PRIORITIES, STATUSES, closeResolvedTicket, isOpen, nextTicketId, nowIso, priorityTone, resolveTicket, statusTone, ticketSla, uid, withTicketEvent } from '@/lib/domain';
import type { Level, Ticket } from '@/lib/types';
import { Badge, Button, EmptyState, Field, Modal, SearchBox, Warning, textareaCls } from '@/components/kit';
import { SlaBar, TicketForm, emptyDraft, fmtMinutes, type TicketDraft } from '@/components/ticket-parts';

type Dialog = null | 'create' | 'edit' | 'resolve' | 'confirm' | 'cab';

export default function TicketsPage() {
  const { store, setStore, log } = useStore();
  const now = useNow(1000);
  const search = useSearch();
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState('');
  const [kindF, setKindF] = useState('Tous');
  const [statusF, setStatusF] = useState('Ouverts');
  const [prioF, setPrioF] = useState('Toutes');
  const [active, setActive] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [prefill, setPrefill] = useState<TicketDraft>(emptyDraft());
  const [comment, setComment] = useState('');

  useEffect(() => {
    const p = new URLSearchParams(search);
    if (![...p.keys()].length) return;
    const tk = p.get('ticket');
    if (tk) { setActive(tk); setStatusF('Tous'); setKindF('Tous'); setPrioF('Toutes'); setQuery(''); }
    if (p.get('new')) {
      const svc = store.services.find(s => s.id === p.get('service'));
      const asset = store.assets.find(a => a.id === p.get('asset'));
      setPrefill(emptyDraft({
        kind: svc ? 'Demande' : 'Incident',
        title: svc ? `Demande — ${svc.name}` : asset ? `Incident — ${asset.name} (${asset.id})` : '',
        category: svc ? (svc.category === 'Infrastructure' ? 'Réseau' : svc.category === 'Équipement' ? 'Équipement' : 'Applications') : asset ? (asset.type === 'Réseau' ? 'Réseau' : asset.type === 'Poste de travail' ? 'Poste de travail' : 'Équipement') : 'Applications',
        serviceId: svc?.id ?? '', assetId: asset?.id ?? '',
        description: asset ? `Équipement ${asset.id} · ${asset.type} · ${asset.location}. Symptôme observé : ` : '',
      }));
      setDialog('create');
    }
    setLocation('/tickets', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const filtered = useMemo(() => store.tickets.filter(t =>
    (kindF === 'Tous' || t.kind === kindF) &&
    (statusF === 'Tous' || (statusF === 'Ouverts' ? isOpen(t) : t.status === statusF)) &&
    (prioF === 'Toutes' || t.priority === prioF) &&
    `${t.id} ${t.title} ${t.category} ${t.requester} ${t.assignee} ${t.kind}`.toLowerCase().includes(query.toLowerCase())
  ).sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || a.priority.localeCompare(b.priority) || b.openedAt.localeCompare(a.openedAt)), [store.tickets, kindF, statusF, prioF, query]);
  const ticket: Ticket | null = filtered.find(t => t.id === active) ?? filtered[0] ?? null;
  const hiddenActive = active && !filtered.some(t => t.id === active) && store.tickets.some(t => t.id === active);

  const event = (id: string, body: string, patch: Partial<Ticket> = {}, audit?: string) => { setStore(s => withTicketEvent(s, id, body, patch)); log(audit ?? `${id} · ${body}`, `Ticket ${id}`); };
  const notify = (ticketId: string, title: string, body: string) => setStore(s => ({ ...s, notifications: [{ id: uid(), ticketId, title, body, at: nowIso() }, ...s.notifications] }));

  const create = (d: TicketDraft) => {
    const id = nextTicketId(d.kind, store.tickets);
    const openedAt = nowIso();
    const t: Ticket = { id, title: d.title, kind: d.kind, category: d.category, impact: d.impact, urgency: d.urgency, priority: priorityFor(d.impact, d.urgency), supportLevel: d.supportLevel, status: 'Nouveau', assignee: d.assignee, requester: store.profile.name, serviceId: d.serviceId || null, assetId: d.assetId || null, openedAt, acknowledgedAt: null, resolvedAt: null, closedAt: null, description: d.description || 'Demande de support de démonstration.', cab: null, updates: [{ author: store.profile.name, body: `${d.kind} ouvert en ${priorityFor(d.impact, d.urgency)} (impact ${d.impact}, urgence ${d.urgency}).`, time: formatWAT(openedAt, 'datetime'), at: openedAt }] };
    setStore(s => ({ ...s, tickets: [t, ...s.tickets] }));
    setActive(id); setStatusF('Ouverts'); setKindF('Tous'); setPrioF('Toutes'); setQuery(''); setDialog(null);
    log(`Ticket ${id} créé (${t.kind}, ${t.priority})`, 'Support informatique');
  };
  const edit = (d: TicketDraft) => {
    if (!ticket) return;
    const p = priorityFor(d.impact, d.urgency);
    const changes: string[] = [];
    if (p !== ticket.priority) changes.push(`priorité recalculée ${ticket.priority} vers ${p} ; horloges SLA conservées depuis l’ouverture`);
    if (d.supportLevel !== ticket.supportLevel) changes.push(`niveau L${ticket.supportLevel} vers L${d.supportLevel}`);
    if (d.assignee !== ticket.assignee) changes.push(`assignation : ${d.assignee}`);
    event(ticket.id, changes.length ? `Ticket modifié : ${changes.join(' · ')}.` : 'Ticket modifié (sujet, description ou rattachements).', { title: d.title, description: d.description, kind: d.kind, category: d.category, impact: d.impact, urgency: d.urgency, priority: p, supportLevel: d.supportLevel, assignee: d.assignee, serviceId: d.serviceId || null, assetId: d.assetId || null }, `Ticket ${ticket.id} modifié`);
    setDialog(null);
  };

  return <div className="page-enter min-w-0"><Warning />
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><div className="eyebrow">CENTRE DE SERVICES · ITIL</div><h2 className="mt-1 text-[20px] font-semibold">File des demandes</h2></div><Button testId="button-create-ticket" onClick={() => { setPrefill(emptyDraft()); setDialog('create'); }}><Plus size={15} />Créer un ticket</Button></div>
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-[11px] leading-relaxed text-muted-foreground"><Timer size={15} className="mt-0.5 shrink-0 text-primary" /><div><strong className="text-foreground">Minuteurs SLA de démonstration.</strong> Les délais courent en continu depuis l’ouverture (24 h sur 24, sans calendrier ouvré ni jours fériés) et sont recalculés chaque seconde. Un changement de priorité modifie les échéances mais ne remet jamais le temps écoulé à zéro. Ces indicateurs ne mesurent aucune performance contractuelle.</div></div>
    <div className="panel grid min-w-0 min-h-[640px] overflow-hidden xl:grid-cols-[minmax(330px,.85fr)_minmax(0,1.5fr)]">
      <section className="min-w-0 border-b border-border xl:border-b-0 xl:border-r">
        <div className="space-y-3 p-4"><SearchBox testId="input-search-tickets" value={query} onChange={setQuery} placeholder="N° ticket, demandeur, sujet…" />
          <div className="grid grid-cols-3 gap-2"><FilterSel label="Type" value={kindF} onChange={setKindF} opts={['Tous', ...KINDS]} /><FilterSel label="État" value={statusF} onChange={setStatusF} opts={['Ouverts', 'Tous', ...STATUSES]} /><FilterSel label="Priorité" value={prioF} onChange={setPrioF} opts={['Toutes', ...PRIORITIES]} /></div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground"><span className="flex items-center gap-1.5"><Filter size={12} />{filtered.length} résultat(s)</span>{(kindF !== 'Tous' || statusF !== 'Ouverts' || prioF !== 'Toutes' || query) && <button data-testid="button-reset-filters" onClick={() => { setKindF('Tous'); setStatusF('Ouverts'); setPrioF('Toutes'); setQuery(''); }} className="font-semibold text-primary hover:underline">Réinitialiser les filtres</button>}</div>
          {hiddenActive && <div className="rounded-lg bg-muted/70 p-2.5 text-[10px] text-muted-foreground">Le ticket {active} est masqué par les filtres actuels.</div>}
        </div>
        <div className="max-h-[560px] overflow-y-auto">{filtered.map(t => { const sla = ticketSla(t, now); const hot = isOpen(t) && t.status !== 'Résolu' && [!t.acknowledgedAt && sla.ack.state, !t.resolvedAt && sla.res.state].find(x => x === 'breach' || x === 'warning'); return <button key={t.id} data-testid={`row-ticket-${t.id}`} onClick={() => setActive(t.id)} className={`w-full border-t border-border/70 px-4 py-3.5 text-left hover:bg-muted/50 ${ticket?.id === t.id ? 'bg-[#edf3ed] dark:bg-[#263b36]' : ''}`}>
          <div className="flex items-center justify-between gap-2"><span className="mono text-[10px] text-muted-foreground">{t.id} · {t.kind} · L{t.supportLevel}</span><div className="flex items-center gap-1.5">{hot && <span title={hot === 'breach' ? 'Délai dépassé' : 'Seuil d’alerte'} className={`h-2 w-2 rounded-full ${hot === 'breach' ? 'bg-[#c0574a]' : 'bg-[#c88e43]'}`} />}<Badge tone={priorityTone(t.priority)}>{t.priority}</Badge></div></div>
          <div className="mt-1.5 break-words text-[12px] font-semibold leading-snug">{t.title}</div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground"><span className="truncate">{t.category} · {t.requester}</span><Badge tone={statusTone(t.status)}>{t.status}</Badge></div>
        </button>; })}
          {!filtered.length && <div className="p-6"><EmptyState title="Aucun ticket pour cette sélection" text="Aucun ticket ne correspond aux filtres. Aucun détail n’est affiché." /></div>}
        </div>
      </section>
      {ticket ? <TicketDetail key={ticket.id} ticket={ticket} now={now} onDialog={setDialog} event={event} notify={notify} comment={comment} setComment={setComment} />
        : <div className="grid min-h-[300px] place-items-center p-8 text-center"><div><Search size={18} className="mx-auto text-muted-foreground" /><div className="mt-2 text-[13px] font-semibold">Aucune sélection</div><p className="mt-1 text-[11px] text-muted-foreground">Ajustez les filtres pour afficher un ticket.</p></div></div>}
    </div>
    {dialog === 'create' && <Modal wide title="Créer un ticket" description="Ticket fictif de démonstration. La priorité découle de l’impact et de l’urgence." onClose={() => setDialog(null)}><TicketForm initial={prefill} services={store.services} assets={store.assets} submitLabel="Créer le ticket" onSubmit={create} onCancel={() => setDialog(null)} /></Modal>}
    {dialog === 'edit' && ticket && <Modal wide title={`Modifier ${ticket.id}`} description="L’heure d’ouverture est conservée : les échéances SLA sont recalculées sans remettre le temps écoulé à zéro." onClose={() => setDialog(null)}><TicketForm lockKind={ticket.status !== 'Nouveau' || !!ticket.cab} initial={emptyDraft({ kind: ticket.kind, title: ticket.title, description: ticket.description, category: ticket.category, impact: ticket.impact, urgency: ticket.urgency, supportLevel: ticket.supportLevel, assignee: ticket.assignee, serviceId: ticket.serviceId ?? '', assetId: ticket.assetId ?? '' })} services={store.services} assets={store.assets} submitLabel="Enregistrer" onSubmit={edit} onCancel={() => setDialog(null)} /></Modal>}
    {dialog === 'resolve' && ticket && <ResolveDialog ticket={ticket} onClose={() => setDialog(null)} onDone={(rootCause, resolution) => { setStore(s => resolveTicket(s, ticket.id, rootCause, resolution)); log(`Ticket ${ticket.id} résolu (en attente de confirmation)`, `Ticket ${ticket.id}`); setDialog(null); }} />}
    {dialog === 'confirm' && ticket && <ConfirmDialog ticket={ticket} onClose={() => setDialog(null)} onDone={() => {
      setStore(s => closeResolvedTicket(s, ticket.id));
      log(`Ticket ${ticket.id} clos après confirmation simulée ; article KEDB créé`, `Ticket ${ticket.id}`);
      setDialog(null);
    }} />}
    {dialog === 'cab' && ticket && <CabDialog ticket={ticket} onClose={() => setDialog(null)} onDecision={(decision, reason) => {
      const at = nowIso();
      const cab = { decision, by: `CAB simulé · ${store.profile.name}`, at, reason };
      if (decision === 'Approuvé') event(ticket.id, `Décision CAB enregistrée : approuvé (simulation).${reason ? ` Note : ${reason}` : ''}`, { cab, acknowledgedAt: ticket.acknowledgedAt ?? at, status: ticket.status === 'Nouveau' ? 'Pris en compte' : ticket.status }, `Changement ${ticket.id} approuvé par le CAB simulé`);
      else event(ticket.id, `Décision CAB enregistrée : rejeté. Motif : ${reason}`, { cab, status: 'Rejeté', closedAt: at, acknowledgedAt: ticket.acknowledgedAt ?? at }, `Changement ${ticket.id} rejeté par le CAB simulé`);
      setDialog(null);
    }} />}
  </div>;
}

function FilterSel({ label, value, onChange, opts }: { label: string; value: string; onChange: (v: string) => void; opts: string[] }) {
  return <label className="min-w-0 text-[9px] font-semibold uppercase tracking-[.1em] text-muted-foreground">{label}<select data-testid={`filter-${label.toLowerCase()}`} aria-label={`Filtrer par ${label.toLowerCase()}`} value={value} onChange={e => onChange(e.target.value)} className="mt-1 h-9 w-full min-w-0 max-w-full rounded-lg border border-border bg-card px-2 text-[11px] font-normal normal-case tracking-normal text-foreground">{opts.map(o => <option key={o}>{o}</option>)}</select></label>;
}

function TicketDetail({ ticket, now, onDialog, event, notify, comment, setComment }: { ticket: Ticket; now: number; onDialog: (d: Dialog) => void; event: (id: string, body: string, patch?: Partial<Ticket>, audit?: string) => void; notify: (id: string, title: string, body: string) => void; comment: string; setComment: (v: string) => void }) {
  const { store } = useStore();
  const sla = ticketSla(ticket, now);
  const policy = SLA_POLICIES[ticket.priority];
  const service = store.services.find(s => s.id === ticket.serviceId);
  const asset = store.assets.find(a => a.id === ticket.assetId);
  const kedb = store.kedb.find(a => a.ticketId === ticket.id);
  const conv = store.conversations.find(c => c.id === ticket.conversationId);
  const open = isOpen(ticket);
  const isChange = ticket.kind === 'Changement';
  const cabOk = ticket.cab?.decision === 'Approuvé';
  const canStart = (ticket.status === 'Pris en compte' || ticket.status === 'En attente') && (!isChange || cabOk);
  const canResolve = ['Pris en compte', 'En cours', 'En attente'].includes(ticket.status) && (!isChange || cabOk);
  const ack = () => event(ticket.id, 'Prise en charge enregistrée.', { status: 'Pris en compte', acknowledgedAt: nowIso() }, `Ticket ${ticket.id} pris en charge`);
  const escalate = () => {
    const lv = (ticket.supportLevel + 1) as Level;
    event(ticket.id, `Escalade fonctionnelle de L${ticket.supportLevel} vers L${lv}. Politique ${ticket.priority} : ${policy.escalation}`, { supportLevel: lv }, `Ticket ${ticket.id} escaladé vers L${lv}`);
    notify(ticket.id, `Escalade L${lv} · ${ticket.id}`, `${ticket.priority} · ${ticket.title}`);
  };
  return <section className="min-w-0 p-5 md:p-7" data-testid="panel-ticket-detail">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="break-words text-[10px] text-muted-foreground mono">{ticket.id} <span className="mx-1">·</span> {ticket.kind} <span className="mx-1">·</span> ouvert {formatWAT(ticket.openedAt, 'datetime')}</div><h3 className="mt-2 max-w-2xl break-words text-[20px] font-semibold leading-tight">{ticket.title}</h3></div><div className="flex flex-wrap items-center gap-1.5"><Badge tone={priorityTone(ticket.priority)} testId="status-priority">{ticket.priority} · {policy.label}</Badge><Badge tone="neutral">L{ticket.supportLevel}</Badge><Badge tone={statusTone(ticket.status)} testId="status-ticket">{ticket.status}</Badge></div></div>

    <div className="mt-4 flex flex-wrap gap-2">
      {ticket.status === 'Nouveau' && <Button testId="button-ack" onClick={ack}><Hand size={14} />Prendre en charge</Button>}
      {isChange && open && !ticket.cab && <Button testId="button-cab" variant={ticket.status === 'Nouveau' ? 'outline' : 'primary'} onClick={() => onDialog('cab')}><Gavel size={14} />Décision CAB</Button>}
      {(ticket.status === 'Pris en compte' || ticket.status === 'En attente') && <Button testId="button-start" variant="outline" disabled={!canStart} title={isChange && !cabOk ? 'Décision CAB requise' : undefined} onClick={() => event(ticket.id, ticket.status === 'En attente' ? 'Traitement repris.' : 'Traitement démarré.', { status: 'En cours' }, `Ticket ${ticket.id} en cours`)}><Play size={14} />{ticket.status === 'En attente' ? 'Reprendre' : 'Démarrer le traitement'}</Button>}
      {ticket.status === 'En cours' && <Button testId="button-hold" variant="outline" onClick={() => event(ticket.id, 'Ticket mis en attente (le minuteur SLA continue de courir).', { status: 'En attente' }, `Ticket ${ticket.id} mis en attente`)}><Pause size={14} />Mettre en attente</Button>}
      {open && ticket.status !== 'Résolu' && ticket.supportLevel < 3 && <Button testId="button-escalate" variant="outline" onClick={escalate}><ArrowUpRight size={14} />Escalader vers L{ticket.supportLevel + 1}</Button>}
      {canResolve && <Button testId="button-resolve" variant="outline" onClick={() => onDialog('resolve')}><CircleCheck size={14} />Résoudre</Button>}
      {ticket.status === 'Résolu' && (ticket.rootCause && ticket.resolution
        ? <Button testId="button-confirm-close" onClick={() => onDialog('confirm')}><CheckCheck size={14} />Confirmation du demandeur</Button>
        : <Button testId="button-complete-resolution" onClick={() => onDialog('resolve')}><CircleCheck size={14} />Documenter la résolution</Button>)}
      {ticket.status === 'Résolu' && <Button testId="button-reopen" variant="outline" onClick={() => event(ticket.id, 'Résolution refusée, ticket rouvert. Le minuteur de résolution reprend depuis l’ouverture.', { status: 'En cours', resolvedAt: null }, `Ticket ${ticket.id} rouvert`)}><RotateCcw size={14} />Rouvrir</Button>}
      {open && <Button testId="button-edit-ticket" variant="quiet" onClick={() => onDialog('edit')}><Pencil size={13} />Modifier</Button>}
    </div>
    {isChange && open && !cabOk && ticket.status !== 'Nouveau' && <p className="mt-2 text-[10px] text-muted-foreground">Démarrage et résolution bloqués tant qu’aucune approbation CAB n’est enregistrée.</p>}
    {ticket.status === 'Nouveau' && !isChange && <p className="mt-2 text-[10px] text-muted-foreground">La résolution n’est possible qu’après la prise en charge.</p>}

    <div className="mt-5 grid gap-3 md:grid-cols-2">
      <SlaBar testId="sla-ack" label={`Prise en charge · ${fmtMinutes(policy.acknowledgeMinutes)}`} openedAt={ticket.openedAt} deadline={sla.deadlines.acknowledgeBy} completedAt={ticket.acknowledgedAt} now={now} />
      <SlaBar testId="sla-resolve" label={`Résolution · ${fmtMinutes(policy.resolveMinutes)}`} openedAt={ticket.openedAt} deadline={sla.deadlines.resolveBy} completedAt={ticket.resolvedAt} now={now} />
    </div>
    <p className="mt-2 text-[10px] text-muted-foreground">Escalade prévue : {policy.escalation}</p>

    <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">{[['Ouverture', ticket.openedAt], ['Prise en charge', ticket.acknowledgedAt], ['Résolution', ticket.resolvedAt], ['Clôture', ticket.closedAt]].map(([l, v]) => <div key={l} className="min-w-0 rounded-lg bg-muted/65 p-3"><div className="eyebrow">{l}</div><div className="mono mt-1 truncate text-[10px] font-semibold" title={v ?? ''}>{v ? formatWAT(v, 'datetime') : '—'}</div></div>)}</div>
    <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">{[['Impact / urgence', `${LEVEL_LABEL[ticket.impact]} / ${LEVEL_LABEL[ticket.urgency]}`], ['Catégorie', ticket.category], ['Demandeur', ticket.requester], ['Assignation', ticket.assignee]].map(([l, v]) => <div key={l} className="min-w-0 rounded-lg border border-border/70 p-3"><div className="eyebrow">{l}</div><div className="mt-1 truncate text-[11px] font-semibold">{v}</div></div>)}</div>
    {(service || asset || conv || ticket.sourceMessageId || ticket.legacyPriority) && <div className="mt-3 flex flex-wrap gap-2 text-[10px]">{service && <Link href="/services" className="rounded-full border border-border px-2.5 py-1 font-semibold hover:bg-muted">Service : {service.name}</Link>}{asset && <Link href="/assets" className="rounded-full border border-border px-2.5 py-1 font-semibold hover:bg-muted">Équipement : {asset.id}</Link>}{conv && <Link href={`/messages?c=${encodeURIComponent(conv.id)}`} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 font-semibold hover:bg-muted"><MessageSquare size={11} />Discussion liée : {conv.title}</Link>}{ticket.sourceMessageId && (conv ? <Link href={`/messages?c=${encodeURIComponent(conv.id)}&m=${encodeURIComponent(ticket.sourceMessageId)}`} data-testid={`link-source-message-${ticket.id}`} aria-label={`Ouvrir le message source ${ticket.sourceMessageId} dans ${conv.title}`} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 font-semibold text-primary hover:bg-primary/10"><MessageSquare size={11} />Message source : {ticket.sourceMessageId}</Link> : <span data-testid={`text-source-message-${ticket.id}`} className="rounded-full border border-border px-2.5 py-1 font-semibold text-muted-foreground">Message source : {ticket.sourceMessageId}</span>)}{ticket.legacyPriority && <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">Priorité historique : {ticket.legacyPriority}</span>}</div>}

    {ticket.cab && <div className={`mt-4 rounded-lg border p-3 text-[11px] ${ticket.cab.decision === 'Approuvé' ? 'border-[#9fc7b3] bg-[#e1efe7]/60 dark:bg-[#214238]/50' : 'border-[#d39b90] bg-[#f5e2df]/60 dark:bg-[#4c302d]/50'}`}><div className="font-semibold">CAB : {ticket.cab.decision} <span className="font-normal text-muted-foreground">· {ticket.cab.by} · {formatWAT(ticket.cab.at, 'datetime')}</span></div>{ticket.cab.reason && <p className="mt-1 text-muted-foreground">{ticket.cab.reason}</p>}</div>}

    <div className="mt-5 min-w-0"><div className="eyebrow mb-2">DESCRIPTION</div><p className="break-words whitespace-pre-wrap rounded-lg border border-border/70 bg-[#f8f7f2] p-4 text-[12px] leading-relaxed text-foreground/85 dark:bg-[#1b2a2e]">{ticket.description}</p></div>
    {(ticket.rootCause || ticket.resolution) && <div className="mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-lg border border-border/70 p-3"><div className="eyebrow">CAUSE RACINE</div><p className="mt-1 text-[11px] leading-relaxed">{ticket.rootCause}</p></div><div className="rounded-lg border border-border/70 p-3"><div className="eyebrow">RÉSOLUTION</div><p className="mt-1 text-[11px] leading-relaxed">{ticket.resolution}</p></div></div>}
    {kedb && <Link href={`/services?kedb=${encodeURIComponent(kedb.id)}`} data-testid="link-kedb" className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"><BookOpen size={13} />Article {kedb.id} dans la base d’erreurs connues</Link>}

    <div className="mt-6"><div className="flex items-center justify-between"><div className="eyebrow">HISTORIQUE D’ACTIVITÉ</div><Badge>{ticket.updates.length} entrée(s)</Badge></div>
      {open && <form onSubmit={e => { e.preventDefault(); if (!comment.trim()) return; event(ticket.id, comment.trim(), {}, `Commentaire ajouté au ticket ${ticket.id}`); setComment(''); }} className="mt-3 flex gap-2"><input data-testid="input-ticket-comment" value={comment} onChange={e => setComment(e.target.value)} placeholder="Ajouter une note de suivi technique…" className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-[12px]" /><Button type="submit" disabled={!comment.trim()} testId="button-ticket-comment"><Send size={13} /></Button></form>}
      {ticket.updates.length ? <ol className="mt-4 space-y-3">{[...ticket.updates].reverse().map((u, i) => <li key={i} className="flex gap-3"><div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" /><div><div className="text-[11px] font-semibold">{u.author}<span className="mono ml-2 text-[10px] font-normal text-muted-foreground">{u.at ? formatWAT(u.at, 'datetime') : u.time}</span></div><p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{u.body}</p></div></li>)}</ol> : <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-5 text-center text-[11px] text-muted-foreground">Aucune activité enregistrée.</div>}
    </div>
  </section>;
}

function ResolveDialog({ ticket, onClose, onDone }: { ticket: Ticket; onClose: () => void; onDone: (rootCause: string, resolution: string) => void }) {
  const [rc, setRc] = useState(ticket.rootCause ?? ''); const [res, setRes] = useState(ticket.resolution ?? '');
  const ok = rc.trim().length >= 10 && res.trim().length >= 10;
  return <Modal title={`Résoudre ${ticket.id}`} description="La cause racine et la solution sont obligatoires. La clôture exigera ensuite la confirmation du demandeur." onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); if (ok) onDone(rc.trim(), res.trim()); }} className="space-y-3">
      <Field label="Cause racine" hint="10 caractères minimum, contenu strictement technique."><textarea data-testid="input-root-cause" required rows={3} value={rc} onChange={e => setRc(e.target.value)} className={textareaCls} /></Field>
      <Field label="Résolution appliquée" hint="Réutilisée dans l’article KEDB après clôture."><textarea data-testid="input-resolution" required rows={3} value={res} onChange={e => setRes(e.target.value)} className={textareaCls} /></Field>
      <div className="flex justify-end gap-2 pt-1"><Button variant="outline" onClick={onClose}>Annuler</Button><Button type="submit" disabled={!ok} testId="button-submit-resolve"><CircleCheck size={14} />Marquer résolu</Button></div>
    </form>
  </Modal>;
}

function ConfirmDialog({ ticket, onClose, onDone }: { ticket: Ticket; onClose: () => void; onDone: () => void }) {
  const [checked, setChecked] = useState(false);
  return <Modal title={`Clôturer ${ticket.id}`} description="Confirmation du demandeur simulée : aucun message n’est réellement envoyé ou reçu." onClose={onClose}>
    <div className="space-y-3 text-[11px]"><div className="rounded-lg bg-muted/70 p-3"><div className="eyebrow">DEMANDEUR</div><div className="mt-1 font-semibold">{ticket.requester}</div></div><div className="rounded-lg border border-border p-3"><div className="eyebrow">RÉSOLUTION</div><p className="mt-1 leading-relaxed text-muted-foreground">{ticket.resolution}</p></div>
      <label className="flex items-start gap-2.5 rounded-lg border border-border p-3"><input data-testid="checkbox-confirm-requester" type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="mt-0.5 accent-[hsl(var(--primary))]" /><span>Je simule l’accord explicite de {ticket.requester} sur la résolution. Un seul article sera ajouté à la base d’erreurs connues, lié à ce ticket.</span></label>
      <div className="flex justify-end gap-2 pt-1"><Button variant="outline" onClick={onClose}>Annuler</Button><Button disabled={!checked} onClick={onDone} testId="button-submit-close"><CheckCheck size={14} />Clore et publier dans la KEDB</Button></div></div>
  </Modal>;
}

function CabDialog({ ticket, onClose, onDecision }: { ticket: Ticket; onClose: () => void; onDecision: (d: 'Approuvé' | 'Rejeté', reason: string) => void }) {
  const [reason, setReason] = useState('');
  return <Modal title={`Décision CAB · ${ticket.id}`} description="Comité consultatif des changements simulé. La décision est partagée; auteur et horodatage sont attribués par le serveur." onClose={onClose}>
    <div className="space-y-3"><Field label="Motif ou note de décision" hint="Obligatoire pour un rejet."><textarea data-testid="input-cab-reason" rows={3} value={reason} onChange={e => setReason(e.target.value)} className={textareaCls} placeholder="Ex. fenêtre validée, plan de retour arrière vérifié." /></Field>
      <div className="flex flex-wrap justify-end gap-2 pt-1"><Button variant="outline" onClick={onClose}>Annuler</Button><Button variant="danger" disabled={!reason.trim()} onClick={() => onDecision('Rejeté', reason.trim())} testId="button-cab-reject">Rejeter</Button><Button onClick={() => onDecision('Approuvé', reason.trim())} testId="button-cab-approve"><Gavel size={14} />Approuver (simulation)</Button></div></div>
  </Modal>;
}
