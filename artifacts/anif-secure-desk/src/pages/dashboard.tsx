import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  CircleAlert,
  Clock3,
  Download,
  Filter,
  MessageSquare,
  Plus,
  Server,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useNow, useStore } from '@/lib/store';
import { useDisplayName } from '@/hooks/use-display-name';
import { usePeople } from '@/hooks/use-people';
import { formatWAT } from '@/lib/itsm';
import { isOpen, messageTime, priorityTone, statusTone, ticketKpis, ticketKpisToCsv, ticketSla, unreadOf } from '@/lib/domain';
import { Badge, Warning, pad2 } from '@/components/kit';
import type { Store, Ticket } from '@/lib/types';
import './dashboard.css';

type QueueFilter = 'Tous' | 'P1' | 'P2' | 'À prendre' | 'En cours' | 'Garde';

function OpsMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone: 'mint' | 'amber' | 'rose' | 'blue';
  testId?: string;
}) {
  return <article className={`ops-metric ops-${tone}`} data-testid={testId}>
    <div className="ops-metric-top"><span className="ops-kicker">{label}</span><span className="ops-metric-icon"><Icon size={17} /></span></div>
    <div className="ops-metric-value">{value}</div>
    <div className="ops-metric-detail"><span className="ops-dot" />{detail}</div>
  </article>;
}

function OpsSectionHeading({ kicker, title, action }: { kicker: string; title: string; action: ReactNode }) {
  return <div className="ops-section-head">
    <div><div className="ops-kicker">{kicker}</div><h3>{title}</h3></div>
    {action}
  </div>;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toLocaleUpperCase('fr-FR');
}

function shortDuration(milliseconds: number) {
  const minutes = Math.max(1, Math.ceil(Math.abs(milliseconds) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  const days = Math.floor(hours / 24);
  return `${days} j${hours % 24 ? ` ${hours % 24} h` : ''}`;
}

function slaSummary(ticket: Ticket, now: number, calendar: Store['slaCalendar']) {
  const sla = ticketSla(ticket, now, calendar);
  const waitingForAcknowledgement = !ticket.acknowledgedAt;
  const progress = waitingForAcknowledgement ? sla.ack : sla.res;
  const completedAt = waitingForAcknowledgement ? ticket.acknowledgedAt : ticket.resolvedAt;
  const phase = waitingForAcknowledgement ? 'prise en charge' : 'résolution';
  if (completedAt) {
    const late = new Date(completedAt).getTime() > new Date(waitingForAcknowledgement ? sla.deadlines.acknowledgeBy : sla.deadlines.resolveBy).getTime();
    return { label: late ? `${phase} hors délai` : `${phase} tenue`, tone: late ? 'red' : 'green', remaining: '' };
  }
  if (progress.remainingMs < 0) return { label: `${phase} dépassée`, tone: 'red', remaining: `de ${shortDuration(progress.remainingMs)}` };
  if (progress.state === 'warning') return { label: `${phase} à surveiller`, tone: 'amber', remaining: `dans ${shortDuration(progress.remainingMs)}` };
  return { label: `SLA · ${phase}`, tone: 'blue', remaining: `dans ${shortDuration(progress.remainingMs)}` };
}

export default function Dashboard() {
  const { store, log } = useStore();
  const { firstName } = useDisplayName();
  const { person } = usePeople();
  const now = useNow(30_000);
  const isAuditor = store.profile.clearance.startsWith('N5 ·');
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('Tous');
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const stats = useMemo(() => {
    const open = store.tickets.filter(t => isOpen(t) && t.status !== 'Résolu');
    const p1p2 = open.filter(t => t.priority === 'P1' || t.priority === 'P2').length;
    let warn = 0, breach = 0;
    const due = open.filter(t => {
      const { ack, res } = ticketSla(t, now, store.slaCalendar);
      const states = [!t.acknowledgedAt ? ack.state : 'met', !t.resolvedAt ? res.state : 'met'];
      if (states.includes('breach')) breach++; else if (states.includes('warning')) warn++;
      return states.includes('breach') || states.includes('warning');
    });
    const unread = store.conversations.reduce((n, c) => n + unreadOf(c), 0);
    const unreadConvs = store.conversations.filter(c => unreadOf(c) > 0).length;
    const ops = store.services.filter(s => s.status === 'Opérationnel').length;
    const watch = store.services.length - ops;
    const ranked = [...open].sort((a, b) => a.priority.localeCompare(b.priority) || a.openedAt.localeCompare(b.openedAt));
    const recentActivity = [...store.audit].sort((a, b) => {
      const aTime = a.at ? Date.parse(a.at) : 0;
      const bTime = b.at ? Date.parse(b.at) : 0;
      return bTime - aTime;
    }).slice(0, 4);
    return { open, p1p2, due, warn, breach, unread, unreadConvs, ops, watch, ranked, recentActivity };
  }, [store, now]);
  const kpis = useMemo(() => ticketKpis(store.tickets, now, store.slaCalendar), [store.tickets, store.slaCalendar, now]);
  const exportKpis = () => {
    const generatedAt = new Date(now).toISOString();
    const url = URL.createObjectURL(new Blob([ticketKpisToCsv(kpis, generatedAt, person)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `indicateurs-itil-${generatedAt.slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    log('Rapport des indicateurs ITIL exporté (CSV)', 'Tableau de bord');
  };

  const date = new Date(now).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Libreville',
  }).toLocaleUpperCase('fr-FR');
  const time = formatWAT(new Date(now).toISOString(), 'time');
  const filteredQueue = stats.ranked.filter(ticket => {
    if (queueFilter === 'Garde') return ticket.priority === 'P1' || ticket.priority === 'P2';
    if (queueFilter === 'À prendre') return ticket.status === 'Nouveau';
    if (queueFilter === 'En cours') return ticket.status === 'En cours';
    if (queueFilter === 'P1' || queueFilter === 'P2') return ticket.priority === queueFilter;
    return true;
  });
  const focusTicket = filteredQueue.find(ticket => ticket.id === selectedId) ?? filteredQueue[0] ?? null;
  const visibleQueue = showAll ? filteredQueue : filteredQueue.slice(0, 1);
  const guardMode = queueFilter === 'Garde';

  return <div className="page-enter dashboard-ops min-w-0">
    <div className="ops-warning"><Warning /></div>
    <section className="ops-welcome" aria-labelledby="dashboard-greeting">
      <div className="min-w-0">
        <div className="ops-date"><span>LIBREVILLE</span><i />{date}<i />WAT · {time}</div>
        <h2 id="dashboard-greeting">Le point de situation<span className="ops-title-dot">.</span></h2>
        <p>Bonjour {firstName} — voici ce qui mérite votre attention aujourd’hui.</p>
      </div>
      {!isAuditor && <div className="ops-actions">
        <Link href="/tickets?new=1" data-testid="link-new-request" className="ops-action ops-action-secondary focus-ring"><Plus size={15} />Nouvelle demande</Link>
        <button type="button" className={`ops-action ops-action-primary focus-ring ${guardMode ? 'is-active' : ''}`} aria-pressed={guardMode} title={`${stats.p1p2} ticket(s) P1/P2 · ${stats.due.length} échéance(s) SLA à surveiller`} onClick={() => setQueueFilter(guardMode ? 'Tous' : 'Garde')}><Activity size={15} />{guardMode ? 'Quitter la vue de garde' : 'Vue de garde'}<ArrowDownRight size={14} /></button>
      </div>}
    </section>

    {isAuditor ? <div className="ops-auditor">
      <section className="ops-metrics ops-metrics-limited" aria-label="Repères de consultation">
        <OpsMetric label="Articles KEDB consultables" value={pad2(store.kedb.length)} detail="Consultation en lecture seule" icon={ShieldCheck} tone="blue" />
        <OpsMetric label="Événements du journal" value={pad2(store.audit.length)} detail="Export selon les filtres autorisés" icon={Activity} tone="mint" />
      </section>
      <section className="ops-panel ops-limited-panel">
        <div className="ops-kicker">ACCÈS N5 · LECTURE</div>
        <h3>Consultation limitée</h3>
        <p>Les détails des tickets et les conversations ne font pas partie de votre périmètre. Vous pouvez consulter la base d’erreurs connues et le journal d’activité.</p>
        <div className="ops-inline-links"><Link href="/services">Consulter la base KEDB <ArrowRight size={13} /></Link><Link href="/audit">Ouvrir le journal <ArrowRight size={13} /></Link></div>
      </section>
    </div> : <>
      <div className="ops-brief-grid">
        <section className="ops-brief-main">
          <div className="ops-queue-head">
            <div><div className="ops-kicker">À TRAITER EN PREMIER</div><h3>File de travail <span>{pad2(stats.open.length)} ouverts</span></h3></div>
            <span className="ops-sort-indicator"><ArrowRight size={12} />Priorité puis ancienneté</span>
          </div>
          <div className="ops-filter-row" role="group" aria-label="Filtrer la file de travail">
            {(['Tous', 'P1', 'P2', 'À prendre', 'En cours'] as const).map(filter => {
              const count = filter === 'Tous' ? stats.ranked.length
                : filter === 'À prendre' ? stats.ranked.filter(ticket => ticket.status === 'Nouveau').length
                : filter === 'En cours' ? stats.ranked.filter(ticket => ticket.status === 'En cours').length
                : stats.ranked.filter(ticket => ticket.priority === filter).length;
              return <button key={filter} type="button" aria-pressed={queueFilter === filter} onClick={() => { setQueueFilter(filter); setSelectedId(''); setShowAll(false); }} className="ops-filter-chip">{filter}{filter === 'Tous' && <span>{pad2(count)}</span>}</button>;
            })}
          </div>
          <div className="ops-queue-list">
            {visibleQueue.map((ticket, index) => {
              const service = store.services.find(item => item.id === ticket.serviceId);
              const sla = slaSummary(ticket, now, store.slaCalendar);
              const selected = focusTicket?.id === ticket.id;
              return <Link
                href={`/tickets?ticket=${encodeURIComponent(ticket.id)}`}
                onClick={() => { setSelectedId(ticket.id); log(`Ticket ${ticket.id} ouvert depuis la vue générale`, 'Support informatique'); }}
                key={ticket.id}
                data-testid={`link-dashboard-ticket-${ticket.id}`}
                className={`ops-queue-row focus-ring ${selected ? 'is-selected' : ''}`}
              >
                <span className="ops-queue-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="ops-queue-copy">
                  <span className="ops-queue-meta">{ticket.id}<Badge tone={priorityTone(ticket.priority)}>{ticket.priority}</Badge><span>{ticket.kind} · {formatWAT(ticket.openedAt, 'time')}</span></span>
                  <strong>{ticket.title}</strong>
                  <small>{service?.name || ticket.category} <i>/</i> {person(ticket.assignee)}</small>
                </span>
                <span className="ops-queue-state"><small>ÉTAT</small><strong>{ticket.status === 'Nouveau' ? 'À prendre' : ticket.status}</strong></span>
                <span className={`ops-queue-sla is-${sla.tone}`}><small>SLA</small><strong><Clock3 size={11} />{sla.remaining || sla.label}</strong></span>
              </Link>;
            })}
            {!visibleQueue.length && <div className="ops-empty">Aucun ticket dans ce filtre.</div>}
          </div>
          <button type="button" className="ops-show-all" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? 'Réduire la file' : 'Afficher la file complète'}<ChevronDown size={13} className={showAll ? 'is-expanded' : ''} /></button>

          <div className="ops-brief-cards">
            {focusTicket ? <section className="ops-focus-card">
              <div className="ops-focus-decoration" />
              <div className="ops-focus-top"><div><div className="ops-kicker">FOCUS DU MOMENT</div><h4>{focusTicket.title}</h4></div><CircleAlert size={17} /></div>
              <div className="ops-focus-foot"><span>{focusTicket.id}</span><span>Responsable : {person(focusTicket.assignee)}</span><Link href={`/tickets?ticket=${encodeURIComponent(focusTicket.id)}`}>Ouvrir le ticket <ArrowUpRight size={12} /></Link></div>
            </section> : <section className="ops-focus-card ops-focus-empty"><div><div className="ops-kicker">FOCUS DU MOMENT</div><h4>Aucun ticket ouvert à traiter</h4><p>Les nouvelles demandes apparaîtront dans cette file.</p></div></section>}
            <section className="ops-coordination-card">
              <div><div className="ops-kicker">DANS L’ESPACE</div><h4>Coordination active <span aria-label={stats.unreadConvs ? 'Messages non lus' : 'Aucun message non lu'} /></h4><p>{store.conversations.length} conversation(s) · {stats.unread} message(s) non lu(s)</p></div>
              <Link href="/messages"><MessageSquare size={14} />Ouvrir la messagerie <ArrowUpRight size={13} /></Link>
            </section>
          </div>
        </section>

        <aside className="ops-brief-side">
          <section className="ops-service-section">
            <OpsSectionHeading kicker="CONTINUITÉ" title="Santé des services" action={<span className="ops-period-label">{stats.ops}/{store.services.length} opérationnel(s) · {stats.watch} vigilance</span>} />
            <div className="ops-service-list">{store.services.map(service => {
              const linked = stats.open.filter(ticket => ticket.serviceId === service.id).length;
              const onWatch = service.status !== 'Opérationnel';
              return <Link href="/services" key={service.id} className={`ops-service ${onWatch ? 'is-vigilance' : ''}`}>
                <span className="ops-service-dot" />
                <span className="ops-service-copy"><strong>{service.name}</strong><small>{service.id} · {service.status} · {linked} ticket(s) ouvert(s)</small></span>
                <span className={`ops-service-status ${onWatch ? 'watch' : 'good'}`}>{service.status}</span>
                <span className="ops-service-rule"><i /></span>
              </Link>;
            })}</div>
            <Link href="/services" className="ops-text-action"><Server size={13} />Catalogue des services <ArrowUpRight size={12} /></Link>
          </section>

          <section className="ops-activity-section">
            <div className="ops-section-head"><div><div className="ops-kicker">RYTHME DE LA JOURNÉE</div><h3>Activité récente</h3></div><Link href="/audit" aria-label="Ouvrir le journal d’activité" className="ops-filter-icon"><Filter size={12} /></Link></div>
            {stats.recentActivity.length ? <ol className="ops-activity-list">{stats.recentActivity.map((event, index) => <li key={event.id} className={`ops-activity tone-${event.type === 'itsm.sla.breached' ? 'rose' : index === 0 ? 'amber' : 'mint'}`}>
              <span className="ops-activity-time">{event.at ? formatWAT(event.at, 'time') : event.time}</span>
              {event.ticketId ? <Link href={`/tickets?ticket=${encodeURIComponent(event.ticketId)}`}><strong>{event.action}</strong><span>{event.scope} · {person(event.actor)}</span></Link>
                : <div><strong>{event.action}</strong><span>{event.scope} · {person(event.actor)}</span></div>}
            </li>)}</ol> : <div className="ops-empty ops-activity-empty">Aucun événement récent.</div>}
          </section>

          <section className="ops-ssi">
            <div className="ops-ssi-top"><div className="ops-kicker">REPÈRE SSI</div><h3>Une séparation claire des usages</h3><p>Les informations de support portent uniquement sur la continuité technique. Aucun contenu d’enquête n’est nécessaire à la gestion d’un incident.</p></div>
            <div className="ops-ssi-grid"><div><div className="ops-kicker">COMPTE</div><strong>{store.profile.role}</strong></div><div><div className="ops-kicker">ARTICLES KEDB</div><strong>{store.kedb.length} validé(s)</strong></div></div>
            <Link className="ops-ssi-link" href="/governance">Référentiel de gouvernance <ArrowRight size={12} /></Link>
          </section>
        </aside>
      </div>
      <section className="ops-kpis" aria-label="Indicateurs ITIL" data-testid="dashboard-kpis">
        <div className="ops-kpis-head"><div><div className="ops-kicker">INDICATEURS ITIL</div><h3>Rapport de performance du support</h3></div><button type="button" data-testid="button-export-kpis" onClick={exportKpis} className="focus-ring inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[11px] font-semibold hover:bg-muted"><Download size={14} />Exporter (CSV)</button></div>
        <div className="ops-metrics ops-metrics-kpi">
          <OpsMetric testId="kpi-mttr" label="MTTR · temps moyen de résolution" value={kpis.mttrMs === null ? '—' : shortDuration(kpis.mttrMs)} detail={`${kpis.resolved} ticket(s) résolu(s) sur ${kpis.total}`} icon={Clock3} tone="blue" />
          <OpsMetric testId="kpi-mtbf" label="MTBF · temps moyen entre pannes" value={kpis.mtbfMs === null ? '—' : shortDuration(kpis.mtbfMs)} detail={kpis.mtbfIntervals ? `${kpis.mtbfIntervals} intervalle(s) entre incidents d’un même service` : 'Pas encore deux incidents sur un même service'} icon={Activity} tone="mint" />
          <OpsMetric testId="kpi-sla" label="Taux de respect du SLA de résolution" value={kpis.slaRate === null ? '—' : `${Math.round(kpis.slaRate * 100)} %`} detail={`${kpis.slaMet}/${kpis.slaDecided} dans le délai · échéances passées seulement`} icon={ShieldCheck} tone={kpis.slaRate === null || kpis.slaRate >= 0.9 ? 'mint' : kpis.slaRate >= 0.7 ? 'amber' : 'rose'} />
          <OpsMetric testId="kpi-satisfaction" label="Satisfaction des demandeurs" value={kpis.satisfactionAvg === null ? '—' : `${kpis.satisfactionAvg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} / 5`} detail={kpis.satisfactionCount ? `${kpis.satisfactionCount} note(s) à la clôture` : 'Aucune note pour l’instant'} icon={Sparkles} tone={kpis.satisfactionAvg === null || kpis.satisfactionAvg >= 4 ? 'mint' : kpis.satisfactionAvg >= 3 ? 'amber' : 'rose'} />
        </div>
        <div className="ops-kpi-lists">
          {([['Volume par catégorie', kpis.byCategory, 'kpi-category'], ['Volume par technicien', kpis.byAssignee, 'kpi-assignee']] as const).map(([title, rows, testId]) => <section key={testId} className="ops-panel ops-panel-pad" data-testid={testId}>
            <div className="ops-kicker">INDICATEUR ITIL</div><h3>{title}</h3>
            {rows.length ? <ol className="ops-kpi-list">{rows.map(row => <li key={row.label}><span>{testId === 'kpi-assignee' ? person(row.label) : row.label}</span><strong>{row.count}</strong></li>)}</ol> : <div className="ops-empty">Aucun ticket.</div>}
          </section>)}
        </div>
      </section>
    </>}
    <footer className="ops-footer"><Sparkles size={12} />Démonstrateur non homologué · Données fictives de l’espace pilote</footer>
  </div>;
}
