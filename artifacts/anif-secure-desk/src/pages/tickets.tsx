import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { Activity, ArrowDownWideNarrow, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, CheckCheck, ChevronDown, ChevronRight, CircleCheck, Clock3, Filter, Gavel, Hand, Headphones, Inbox, MessageSquare, Pause, Pencil, Play, Plus, RotateCcw, Search, Send, Server, ShieldAlert, Timer, UserRound } from 'lucide-react';
import { SLA_POLICIES, formatWAT, priorityFor } from '@/lib/itsm';
import { useNow, useStore } from '@/lib/store';
import { KINDS, LEVEL_LABEL, PRIORITIES, STATUSES, closeResolvedTicket, isOpen, nextTicketId, nowIso, priorityTone, resolveTicket, statusTone, ticketSla, uid, withTicketEvent } from '@/lib/domain';
import { consumeDiagnosticTicketHandoff, diagnosticTicketPrefill } from '@/lib/diagnostic-assistant';
import type { Level, Ticket } from '@/lib/types';
import { Badge, Button, dialogStickyActionsCls, EmptyState, Field, Modal, pad2, SearchBox, Warning, textareaCls } from '@/components/kit';
import { SlaBar, TicketForm, emptyDraft, fmtMinutes, type TicketDraft } from '@/components/ticket-parts';
import { usePeople } from '@/hooks/use-people';
import './tickets.css';

type Dialog = null | 'create' | 'edit' | 'resolve' | 'confirm' | 'cab';

export default function TicketsPage() { const { person } = usePeople();
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
  const [mobileQueueOpen, setMobileQueueOpen] = useState(true);
  const [diagnosticNotice, setDiagnosticNotice] = useState('');

  useEffect(() => {
    const p = new URLSearchParams(search);
    if (![...p.keys()].length) return;
    const tk = p.get('ticket');
    if (tk) { setActive(tk); setStatusF('Tous'); setKindF('Tous'); setPrioF('Toutes'); setQuery(''); setMobileQueueOpen(false); }
    if (p.get('new')) {
      const svc = store.services.find(s => s.id === p.get('service'));
      const asset = store.assets.find(a => a.id === p.get('asset'));
      const initial = emptyDraft({
        kind: svc ? 'Demande' : 'Incident',
        title: svc ? `Demande — ${svc.name}` : asset ? `Incident — ${asset.name} (${asset.id})` : '',
        category: svc ? (svc.category === 'Infrastructure' ? 'Réseau' : svc.category === 'Équipement' ? 'Équipement' : 'Applications') : asset ? (asset.type === 'Réseau' ? 'Réseau' : asset.type === 'Poste de travail' ? 'Poste de travail' : 'Équipement') : 'Applications',
        serviceId: svc?.id ?? '', assetId: asset?.id ?? '',
        description: asset ? `Équipement ${asset.id} · ${asset.type} · ${asset.location}. Symptôme observé : ` : '',
      });
      if (p.get('diagnostic') === '1') {
        let handoff = null;
        try {
          handoff = consumeDiagnosticTicketHandoff(window.sessionStorage);
        } catch {
          handoff = null;
        }
        const handoffService = handoff && store.services.find(s => s.id === handoff.serviceId);
        if (handoff && handoffService && handoffService.id === p.get('service')) {
          setPrefill(emptyDraft({ ...initial, ...diagnosticTicketPrefill(handoff, handoffService) }));
          setDiagnosticNotice('Résumé du diagnostic repris. Vérifiez le service, l’impact, l’urgence et le texte avant de créer le ticket.');
        } else {
          setPrefill(initial);
          setDiagnosticNotice('Le résumé temporaire du diagnostic est absent ou expiré. Vérifiez et complétez le ticket manuellement.');
        }
      } else {
        setPrefill(initial);
        setDiagnosticNotice('');
      }
      setDialog('create');
    }
    setLocation('/tickets', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const filtered = useMemo(() => store.tickets.filter(t =>
    (kindF === 'Tous' || t.kind === kindF) &&
    (statusF === 'Tous' || (statusF === 'Ouverts' ? isOpen(t) : t.status === statusF)) &&
    (prioF === 'Toutes' || t.priority === prioF) &&
    `${t.id} ${t.title} ${t.category} ${person(t.requester)} ${t.assignee} ${t.kind}`.toLowerCase().includes(query.toLowerCase())
  ).sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || a.priority.localeCompare(b.priority) || b.openedAt.localeCompare(a.openedAt)), [store.tickets, kindF, statusF, prioF, query]);
  const ticket: Ticket | null = filtered.find(t => t.id === active) ?? filtered[0] ?? null;
  const hiddenActive = active && !filtered.some(t => t.id === active) && store.tickets.some(t => t.id === active);
  const openCount = store.tickets.filter(t => isOpen(t) && t.status !== 'Résolu').length;
  const toHandleCount = store.tickets.filter(t => t.status === 'Nouveau').length;
  const slaWatchCount = store.tickets.filter(t => {
    if (!isOpen(t) || t.status === 'Résolu') return false;
    const { ack, res } = ticketSla(t, now);
    const states = [!t.acknowledgedAt ? ack.state : 'met', !t.resolvedAt ? res.state : 'met'];
    return states.includes('warning') || states.includes('breach');
  }).length;
  const currentTime = formatWAT(new Date(now).toISOString(), 'time');
  const quickStatus = statusF === 'Nouveau' ? 'À traiter' : statusF === 'En cours' ? 'En cours' : statusF === 'Ouverts' ? 'Ouverts' : statusF === 'Tous' ? 'Tous' : '';
  const clearFilters = () => { setKindF('Tous'); setStatusF('Ouverts'); setPrioF('Toutes'); setQuery(''); };

  const event = (id: string, body: string, patch: Partial<Ticket> = {}, audit?: string) => { setStore(s => withTicketEvent(s, id, body, patch)); log(audit ?? `${id} · ${body}`, `Ticket ${id}`); };
  const notify = (ticketId: string, title: string, body: string) => setStore(s => ({ ...s, notifications: [{ id: uid(), ticketId, title, body, at: nowIso() }, ...s.notifications] }));

  const create = (d: TicketDraft) => {
    const id = nextTicketId(d.kind, store.tickets);
    const openedAt = nowIso();
    const t: Ticket = { id, title: d.title, kind: d.kind, category: d.category, impact: d.impact, urgency: d.urgency, priority: priorityFor(d.impact, d.urgency), supportLevel: d.supportLevel, status: 'Nouveau', assignee: d.assignee, requester: store.profile.name, serviceId: d.serviceId || null, assetId: d.assetId || null, openedAt, acknowledgedAt: null, resolvedAt: null, closedAt: null, description: d.description || 'Demande de support de démonstration.', cab: null, updates: [{ author: store.profile.name, body: `${d.kind} ouvert en ${priorityFor(d.impact, d.urgency)} (impact ${d.impact}, urgence ${d.urgency}).`, time: formatWAT(openedAt, 'datetime'), at: openedAt }] };
    setStore(s => ({ ...s, tickets: [t, ...s.tickets] }));
    setActive(id); setStatusF('Ouverts'); setKindF('Tous'); setPrioF('Toutes'); setQuery(''); setDialog(null);
    setDiagnosticNotice('');
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

  return <div className={`page-enter min-w-0 td-triage ${mobileQueueOpen ? 'queue-open' : 'detail-open'}`}>
    <div className="td-warning"><Warning /></div>
    <div className="td-heading">
      <div>
        <div className="td-eyebrow"><span />CENTRE DE TRIAGE <i>/</i> LIBREVILLE</div>
        <h2>File d’intervention</h2>
        <p>Priorisez le signal, puis ouvrez le contexte utile.</p>
      </div>
      <Button testId="button-create-ticket" className="td-create-btn" onClick={() => { setPrefill(emptyDraft()); setDialog('create'); }}><Plus size={15} />Créer un ticket</Button>
    </div>
    <div className="td-sla-note"><Timer size={15} /><div><strong>Minuteurs SLA de démonstration.</strong> Les délais courent en continu depuis l’ouverture (24 h sur 24, sans calendrier ouvré ni jours fériés) et sont recalculés chaque seconde. Un changement de priorité modifie les échéances mais ne remet jamais le temps écoulé à zéro. Ces indicateurs ne mesurent aucune performance contractuelle.</div></div>
    <div className="td-summary" aria-label="Résumé de la file">
      <button type="button" onClick={() => { setStatusF('Nouveau'); setMobileQueueOpen(true); }} className="td-summary-card"><Inbox size={15} /><strong>{pad2(toHandleCount)} à traiter</strong><span>dans la file</span></button>
      <button type="button" onClick={() => { setStatusF('Ouverts'); setMobileQueueOpen(true); }} className="td-summary-card td-summary-warn"><Clock3 size={15} /><strong>{pad2(slaWatchCount)} échéance(s)</strong><span>SLA à surveiller</span></button>
      <span className="td-summary-time"><Activity size={14} />Mis à jour à {currentTime}<i />WAT</span>
    </div>

    <div className="td-workspace">
      <section className="td-queue" aria-label="File des tickets">
        <div className="td-queue-head">
          <div><h3>À examiner</h3><span>{filtered.length} élément(s) visible(s)</span></div>
          <div className="td-sort-note"><ArrowDownWideNarrow size={13} />Priorité</div>
        </div>
        <div className="td-queue-filters">
          <SearchBox testId="input-search-tickets" value={query} onChange={setQuery} placeholder="N° de ticket, demandeur, sujet…" />
          <div className="td-quick-tabs" role="group" aria-label="Filtres rapides par état">
            {(['Ouverts', 'Nouveau', 'En cours'] as const).map((status, index) => {
              const label = index === 0 ? 'Ouverts' : index === 1 ? 'À traiter' : 'En cours';
              const count = status === 'Ouverts' ? openCount : status === 'Nouveau' ? toHandleCount : store.tickets.filter(t => t.status === 'En cours').length;
              return <button key={status} type="button" aria-pressed={quickStatus === label} onClick={() => setStatusF(status)}>{label}<span>{pad2(count)}</span></button>;
            })}
          </div>
          <details className="td-advanced-filters" open>
            <summary><Filter size={12} />Filtres détaillés<ChevronDown size={12} /></summary>
            <div className="td-filter-grid"><FilterSel label="Type" value={kindF} onChange={setKindF} opts={['Tous', ...KINDS]} /><FilterSel label="État" value={statusF} onChange={setStatusF} opts={['Ouverts', 'Tous', ...STATUSES]} /><FilterSel label="Priorité" value={prioF} onChange={setPrioF} opts={['Toutes', ...PRIORITIES]} /></div>
          </details>
          <div className="td-result-line"><span><Filter size={12} />{filtered.length} résultat(s)</span>{(kindF !== 'Tous' || statusF !== 'Ouverts' || prioF !== 'Toutes' || query) && <button data-testid="button-reset-filters" onClick={clearFilters}>Réinitialiser les filtres</button>}</div>
          {hiddenActive && <div className="td-hidden-active" role="status">Le ticket {active} est masqué par les filtres actuels.</div>}
        </div>
        <div className="td-ticket-list">
          {filtered.map(t => {
            const sla = ticketSla(t, now);
            const hot = isOpen(t) && t.status !== 'Résolu' && [!t.acknowledgedAt && sla.ack.state, !t.resolvedAt && sla.res.state].find(x => x === 'breach' || x === 'warning');
            const pendingAck = !t.acknowledgedAt;
            const remaining = pendingAck ? sla.ack.remainingMs : sla.res.remainingMs;
            const completedLate = !!t.resolvedAt && new Date(t.resolvedAt).getTime() > new Date(sla.deadlines.resolveBy).getTime();
            const slaText = t.resolvedAt ? (completedLate ? 'Résolution hors délai' : 'Résolution tenue') : remaining >= 0 ? `SLA dans ${fmtMinutes(Math.max(1, Math.ceil(remaining / 60_000)))}` : `SLA dépassé de ${fmtMinutes(Math.max(1, Math.ceil(Math.abs(remaining) / 60_000)))}`;
            const service = store.services.find(item => item.id === t.serviceId);
            return <button key={t.id} data-testid={`row-ticket-${t.id}`} aria-pressed={ticket?.id === t.id} onClick={() => { setActive(t.id); setMobileQueueOpen(false); }} className={`td-ticket-row ${ticket?.id === t.id ? 'is-selected' : ''}`}>
              <span className="td-ticket-top"><span className="td-ticket-id">{t.id} <i>·</i> {t.kind} · L{t.supportLevel}</span><span className="td-ticket-priority"><Badge tone={priorityTone(t.priority)}>{t.priority}</Badge>{hot && <span title={hot === 'breach' ? 'Délai dépassé' : 'Seuil d’alerte'} className={`td-hot-dot ${hot === 'breach' ? 'breach' : 'warning'}`} />}</span></span>
              <strong className="td-ticket-title">{t.title}</strong>
              <span className="td-ticket-meta"><span>{service?.name || t.category} <i>/</i> {person(t.requester)}</span><Badge tone={statusTone(t.status)}>{t.status === 'Nouveau' ? 'À prendre' : t.status}</Badge></span>
              <span className={`td-ticket-sla ${hot === 'breach' ? 'is-breach' : hot ? 'is-warning' : ''}`}><span><Clock3 size={11} />{slaText}</span><small>{t.assignee}</small></span>
            </button>;
          })}
          {!filtered.length && <div className="td-empty-list"><EmptyState title="Aucun ticket pour cette sélection" text="Aucun ticket ne correspond aux filtres. Aucun détail n’est affiché." /></div>}
        </div>
        <div className="td-queue-footer"><strong>Règle de tri</strong><span>·</span>Criticité puis ancienneté</div>
      </section>

      <section className="td-detail-shell" aria-label="Détail du ticket sélectionné">
        {ticket ? <TicketDetail key={ticket.id} ticket={ticket} now={now} onDialog={setDialog} event={event} notify={notify} comment={comment} setComment={setComment} onBack={() => setMobileQueueOpen(true)} />
          : <div className="td-no-selection"><Search size={18} /><strong>Aucune sélection</strong><p>Ajustez les filtres pour afficher un ticket.</p></div>}
      </section>
    </div>
    <footer className="td-footer"><ShieldAlert size={12} />Espace ITSM partagé · données fictives de démonstration · aucun indicateur SLA n’est contractuel.</footer>
     {dialog === 'create' && <Modal wide title="Créer un ticket" description={diagnosticNotice || "Ticket fictif de démonstration. La priorité découle de l’impact et de l’urgence."} onClose={() => setDialog(null)}><TicketForm initial={prefill} services={store.services} assets={store.assets} submitLabel="Créer le ticket" onSubmit={create} onCancel={() => { setDialog(null); setDiagnosticNotice(''); }} /></Modal>}
    {dialog === 'edit' && ticket && <Modal wide title={`Modifier ${ticket.id}`} description="L’heure d’ouverture est conservée : les échéances SLA sont recalculées sans remettre le temps écoulé à zéro." onClose={() => setDialog(null)}><TicketForm lockKind={ticket.status !== 'Nouveau' || !!ticket.cab} initial={emptyDraft({ kind: ticket.kind, title: ticket.title, description: ticket.description, category: ticket.category, impact: ticket.impact, urgency: ticket.urgency, supportLevel: ticket.supportLevel, assignee: ticket.assignee, serviceId: ticket.serviceId ?? '', assetId: ticket.assetId ?? '' })} services={store.services} assets={store.assets} submitLabel="Enregistrer" onSubmit={edit} onCancel={() => setDialog(null)} /></Modal>}
    {dialog === 'resolve' && ticket && <ResolveDialog ticket={ticket} onClose={() => setDialog(null)} onDone={(rootCause, resolution) => { setStore(s => resolveTicket(s, ticket.id, rootCause, resolution)); log(`Ticket ${ticket.id} résolu (en attente de confirmation)`, `Ticket ${ticket.id}`); setDialog(null); }} />}
    {dialog === 'confirm' && ticket && <ConfirmDialog ticket={ticket} onClose={() => setDialog(null)} onDone={satisfaction => {
      setStore(s => closeResolvedTicket(s, ticket.id, satisfaction));
      log(`Ticket ${ticket.id} clos après confirmation simulée${satisfaction ? ` (satisfaction ${satisfaction}/5)` : ''} ; article KEDB créé`, `Ticket ${ticket.id}`);
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

function TicketDetail({ ticket, now, onDialog, event, notify, comment, setComment, onBack }: { ticket: Ticket; now: number; onDialog: (d: Dialog) => void; event: (id: string, body: string, patch?: Partial<Ticket>, audit?: string) => void; notify: (id: string, title: string, body: string) => void; comment: string; setComment: (v: string) => void; onBack: () => void }) { const { person } = usePeople();
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
  const currentSla = ticket.acknowledgedAt ? sla.res : sla.ack;
  const slaDeadline = ticket.acknowledgedAt ? sla.deadlines.resolveBy : sla.deadlines.acknowledgeBy;
  const slaComplete = ticket.acknowledgedAt ? ticket.resolvedAt : ticket.acknowledgedAt;
  const slaAttention = !slaComplete && (currentSla.state === 'warning' || currentSla.state === 'breach');
  const slaBreached = currentSla.state === 'breach';
  const slaPhase = ticket.acknowledgedAt ? 'Résolution' : 'Prise en charge';
  const canStart = (ticket.status === 'Pris en compte' || ticket.status === 'En attente') && (!isChange || cabOk);
  const canResolve = ['Pris en compte', 'En cours', 'En attente'].includes(ticket.status) && (!isChange || cabOk);
  const ack = () => event(ticket.id, 'Prise en charge enregistrée.', { status: 'Pris en compte', acknowledgedAt: nowIso() }, `Ticket ${ticket.id} pris en charge`);
  const escalate = () => {
    const lv = (ticket.supportLevel + 1) as Level;
    event(ticket.id, `Escalade fonctionnelle de L${ticket.supportLevel} vers L${lv}. Politique ${ticket.priority} : ${policy.escalation}`, { supportLevel: lv }, `Ticket ${ticket.id} escaladé vers L${lv}`);
    notify(ticket.id, `Escalade L${lv} · ${ticket.id}`, `${ticket.priority} · ${ticket.title}`);
  };
  return <section className="td-ticket-detail min-w-0 p-5 md:p-7" data-testid="panel-ticket-detail">
    <div className="td-detail-crumb">
      <button type="button" className="td-back-button" onClick={onBack}><ArrowLeft size={13} />File d’intervention</button>
      <span>{ticket.id}</span><ChevronRight size={12} /><span>{ticket.kind} · L{ticket.supportLevel}</span>
      <Link href="/audit" className="td-journal-link">Voir le journal <ArrowRight size={11} /></Link>
    </div>
    <div className="td-detail-header">
      <div className="td-detail-headline">
        <div className="td-ticket-badges"><Badge tone={priorityTone(ticket.priority)} testId="status-priority">{ticket.priority} · {policy.label}</Badge><Badge tone="neutral">L{ticket.supportLevel}</Badge><Badge tone={statusTone(ticket.status)} testId="status-ticket">{ticket.status}</Badge><span className="td-open-age"><Clock3 size={11} />Ouvert le {formatWAT(ticket.openedAt, 'datetime')}</span></div>
        <h3>{ticket.title}</h3>
        <p>{ticket.description}</p>
      </div>
    </div>
    {slaAttention && <div className={`td-priority-callout ${slaBreached ? 'is-breach' : ''}`} role="status"><ShieldAlert size={15} /><div><strong>{slaBreached ? `${slaPhase} SLA dépassée` : `${slaPhase} SLA à surveiller`}</strong><span>Échéance {formatWAT(slaDeadline, 'datetime')}. Les délais du pilote sont continus et ne représentent pas un engagement contractuel.</span></div></div>}
    <div className="td-fact-grid">
      <div><span>SERVICE</span><strong><Server size={12} />{service?.name || ticket.category}</strong></div>
      <div><span>RESPONSABLE</span><strong><UserRound size={12} />{person(ticket.assignee)}</strong></div>
      <div><span>ÉCHÉANCE SLA</span><strong className={slaAttention ? (slaBreached ? 'is-breach' : 'is-warning') : ''}><Clock3 size={12} />{slaPhase} · {formatWAT(slaDeadline, 'datetime')}</strong></div>
      <div><span>NIVEAU</span><strong><Headphones size={12} />Support L{ticket.supportLevel}</strong></div>
    </div>

    <div className="td-ticket-actions mt-4 flex flex-wrap gap-2">
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

    <div className="td-sla-bars mt-5 grid gap-3 md:grid-cols-2">
      <SlaBar testId="sla-ack" label={`Prise en charge · ${fmtMinutes(policy.acknowledgeMinutes)}`} openedAt={ticket.openedAt} deadline={sla.deadlines.acknowledgeBy} completedAt={ticket.acknowledgedAt} now={now} />
      <SlaBar testId="sla-resolve" label={`Résolution · ${fmtMinutes(policy.resolveMinutes)}`} openedAt={ticket.openedAt} deadline={sla.deadlines.resolveBy} completedAt={ticket.resolvedAt} now={now} />
    </div>
    <p className="mt-2 text-[10px] text-muted-foreground">Escalade prévue : {policy.escalation}</p>

    <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">{[['Ouverture', ticket.openedAt], ['Prise en charge', ticket.acknowledgedAt], ['Résolution', ticket.resolvedAt], ['Clôture', ticket.closedAt]].map(([l, v]) => <div key={l} className="min-w-0 rounded-lg bg-muted/65 p-3"><div className="eyebrow">{l}</div><div className="mono mt-1 truncate text-[10px] font-semibold" title={v ?? ''}>{v ? formatWAT(v, 'datetime') : '—'}</div></div>)}</div>
    <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">{[['Impact / urgence', `${LEVEL_LABEL[ticket.impact]} / ${LEVEL_LABEL[ticket.urgency]}`], ['Catégorie', ticket.category], ['Demandeur', ticket.requester], ['Assignation', ticket.assignee]].map(([l, v]) => <div key={l} className="min-w-0 rounded-lg border border-border/70 p-3"><div className="eyebrow">{l}</div><div className="mt-1 truncate text-[11px] font-semibold">{v}</div></div>)}</div>
    {(service || asset || conv || ticket.sourceMessageId || ticket.legacyPriority) && <div className="mt-3 flex flex-wrap gap-2 text-[10px]">{service && <Link href="/services" className="rounded-full border border-border px-2.5 py-1 font-semibold hover:bg-muted">Service : {service.name}</Link>}{asset && <Link href="/assets" className="rounded-full border border-border px-2.5 py-1 font-semibold hover:bg-muted">Équipement : {asset.id}</Link>}{conv && <Link href={`/messages?c=${encodeURIComponent(conv.id)}`} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 font-semibold hover:bg-muted"><MessageSquare size={11} />Discussion liée : {conv.title}</Link>}{ticket.sourceMessageId && (conv && conv.messages.some(message => message.id === ticket.sourceMessageId) ? <Link href={`/messages?c=${encodeURIComponent(conv.id)}&m=${encodeURIComponent(ticket.sourceMessageId)}`} data-testid={`link-source-message-${ticket.id}`} aria-label={`Ouvrir le message source ${ticket.sourceMessageId} dans ${conv.title}`} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 font-semibold text-primary hover:bg-primary/10"><MessageSquare size={11} />Message source : {ticket.sourceMessageId}</Link> : conv ? <span role="status" data-testid={`text-source-message-unavailable-${ticket.id}`} className="inline-flex items-center gap-1 rounded-full border border-[#d8b875]/70 bg-[#f4ecd9] px-2.5 py-1 font-semibold text-[#654e27] dark:bg-[#413720] dark:text-[#ebd8aa]">Message source indisponible : {ticket.sourceMessageId}</span> : <span data-testid={`text-source-message-${ticket.id}`} className="rounded-full border border-border px-2.5 py-1 font-semibold text-muted-foreground">Message source : {ticket.sourceMessageId}</span>)}{ticket.legacyPriority && <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">Priorité historique : {ticket.legacyPriority}</span>}</div>}

    {ticket.cab && <div className={`mt-4 rounded-lg border p-3 text-[11px] ${ticket.cab.decision === 'Approuvé' ? 'border-[#9fc7b3] bg-[#e1efe7]/60 dark:bg-[#214238]/50' : 'border-[#d39b90] bg-[#f5e2df]/60 dark:bg-[#4c302d]/50'}`}><div className="font-semibold">CAB : {ticket.cab.decision} <span className="font-normal text-muted-foreground">· {person(ticket.cab.by)} · {formatWAT(ticket.cab.at, 'datetime')}</span></div>{ticket.cab.reason && <p className="mt-1 text-muted-foreground">{ticket.cab.reason}</p>}</div>}

    {(ticket.rootCause || ticket.resolution) && <div className="mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-lg border border-border/70 p-3"><div className="eyebrow">CAUSE RACINE</div><p className="mt-1 text-[11px] leading-relaxed">{ticket.rootCause}</p></div><div className="rounded-lg border border-border/70 p-3"><div className="eyebrow">RÉSOLUTION</div><p className="mt-1 text-[11px] leading-relaxed">{ticket.resolution}</p></div></div>}
    {kedb && <Link href={`/services?kedb=${encodeURIComponent(kedb.id)}`} data-testid="link-kedb" className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"><BookOpen size={13} />Article {kedb.id} dans la base d’erreurs connues</Link>}

    <div className="td-activity-layout mt-7">
      <section className="td-activity-card">
        <div className="td-activity-head"><div><div className="eyebrow">HISTORIQUE DU SIGNALEMENT</div><p>{ticket.updates.length} entrée(s) · ordre antéchronologique</p></div><Link href="/audit" className="td-journal-link">Voir le journal <ArrowRight size={11} /></Link></div>
        {open && <form onSubmit={e => { e.preventDefault(); if (!comment.trim()) return; event(ticket.id, comment.trim(), {}, `Commentaire ajouté au ticket ${ticket.id}`); setComment(''); }} className="td-comment-form"><input data-testid="input-ticket-comment" value={comment} onChange={e => setComment(e.target.value)} placeholder="Ajouter une note de suivi technique…" className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-[12px]" /><Button type="submit" disabled={!comment.trim()} testId="button-ticket-comment"><Send size={13} /></Button></form>}
        {ticket.updates.length ? <ol className="td-update-list">{[...ticket.updates].reverse().map((u, i) => <li key={i}><span className="td-update-dot" /><div><div className="td-update-meta"><strong>{person(u.author)}</strong><span>{u.at ? formatWAT(u.at, 'datetime') : u.time}</span></div><p>{u.body}</p></div></li>)}</ol> : <div className="td-update-empty">Aucune activité enregistrée.</div>}
      </section>
      <aside className="td-coordination-card">
        <div className="td-coordination-title"><MessageSquare size={13} />Notes de coordination</div>
        <p>Échangez uniquement des éléments techniques utiles à la résolution.</p>
        {conv ? <Link href={`/messages?c=${encodeURIComponent(conv.id)}`} className="td-conversation-link">Ouvrir la conversation <ChevronRight size={12} /></Link> : <span className="td-conversation-empty">Aucune conversation liée à ce ticket.</span>}
      </aside>
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
       <div data-dialog-sticky-actions className={dialogStickyActionsCls}><Button className="w-full sm:w-auto" variant="outline" onClick={onClose}>Annuler</Button><Button className="w-full sm:w-auto" type="submit" disabled={!ok} testId="button-submit-resolve"><CircleCheck size={14} />Marquer résolu</Button></div>
    </form>
  </Modal>;
}

const SATISFACTION_LABEL = ['', 'Très insatisfait', 'Insatisfait', 'Correct', 'Satisfait', 'Très satisfait'];

function ConfirmDialog({ ticket, onClose, onDone }: { ticket: Ticket; onClose: () => void; onDone: (satisfaction: number | null) => void }) { const { person } = usePeople();
  const [checked, setChecked] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  return <Modal title={`Clôturer ${ticket.id}`} description="Confirmation du demandeur simulée : aucun message n’est réellement envoyé ou reçu." onClose={onClose}>
    <div className="space-y-3 text-[11px]"><div className="rounded-lg bg-muted/70 p-3"><div className="eyebrow">DEMANDEUR</div><div className="mt-1 font-semibold">{person(ticket.requester)}</div></div><div className="rounded-lg border border-border p-3"><div className="eyebrow">RÉSOLUTION</div><p className="mt-1 leading-relaxed text-muted-foreground">{ticket.resolution}</p></div>
      <label className="flex items-start gap-2.5 rounded-lg border border-border p-3"><input data-testid="checkbox-confirm-requester" type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="mt-0.5 accent-[hsl(var(--primary))]" /><span>Je simule l’accord explicite de {person(ticket.requester)} sur la résolution. Un seul article sera ajouté à la base d’erreurs connues, lié à ce ticket.</span></label>
      <fieldset className="rounded-lg border border-border p-3"><legend className="eyebrow px-1">SATISFACTION DU DEMANDEUR · FACULTATIF</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">{[1, 2, 3, 4, 5].map(n => <label key={n} className={`inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md border px-2 font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[hsl(var(--primary))] ${rating === n ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-primary-foreground' : 'border-border'}`}>
          <input type="radio" name="satisfaction" value={n} checked={rating === n} onChange={() => setRating(n)} className="sr-only" data-testid={`radio-satisfaction-${n}`} aria-label={`${n} sur 5 · ${SATISFACTION_LABEL[n]}`} />{n}</label>)}
          {rating !== null && <button type="button" className="text-muted-foreground underline" onClick={() => setRating(null)}>Ne pas noter</button>}</div>
        <p className="mt-1.5 text-muted-foreground" aria-live="polite">{rating ? `${rating}/5 · ${SATISFACTION_LABEL[rating]}` : 'Aucune note : la clôture reste possible.'}</p></fieldset>
      <div className="flex justify-end gap-2 pt-1"><Button variant="outline" onClick={onClose}>Annuler</Button><Button disabled={!checked} onClick={() => onDone(rating)} testId="button-submit-close"><CheckCheck size={14} />Clore et publier dans la KEDB</Button></div></div>
  </Modal>;
}

function CabDialog({ ticket, onClose, onDecision }: { ticket: Ticket; onClose: () => void; onDecision: (d: 'Approuvé' | 'Rejeté', reason: string) => void }) {
  const [reason, setReason] = useState('');
  return <Modal title={`Décision CAB · ${ticket.id}`} description="Comité consultatif des changements simulé. La décision est partagée; auteur et horodatage sont attribués par le serveur." onClose={onClose}>
    <div className="space-y-3"><Field label="Motif ou note de décision" hint="Obligatoire pour un rejet."><textarea data-testid="input-cab-reason" rows={3} value={reason} onChange={e => setReason(e.target.value)} className={textareaCls} placeholder="Ex. fenêtre validée, plan de retour arrière vérifié." /></Field>
      <div className="flex flex-wrap justify-end gap-2 pt-1"><Button variant="outline" onClick={onClose}>Annuler</Button><Button variant="danger" disabled={!reason.trim()} onClick={() => onDecision('Rejeté', reason.trim())} testId="button-cab-reject">Rejeter</Button><Button onClick={() => onDecision('Approuvé', reason.trim())} testId="button-cab-approve"><Gavel size={14} />Approuver (simulation)</Button></div></div>
  </Modal>;
}
