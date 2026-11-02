import { useMemo } from 'react';
import { Link } from 'wouter';
import { Activity, ArrowRight, ClipboardList, Clock3, MessageSquare, Plus, Server, ShieldCheck } from 'lucide-react';
import { useNow, useStore } from '@/lib/store';
import { isOpen, messageTime, priorityTone, statusTone, ticketSla, unreadOf } from '@/lib/domain';
import { Avatar, Badge, Metric, SectionTitle, Warning, pad2 } from '@/components/kit';

export default function Dashboard() {
  const { store, log } = useStore();
  const now = useNow(30_000);
  const isAuditor = store.profile.clearance.startsWith('N5 ·');
  const stats = useMemo(() => {
    const open = store.tickets.filter(t => isOpen(t) && t.status !== 'Résolu');
    const p1p2 = open.filter(t => t.priority === 'P1' || t.priority === 'P2').length;
    let warn = 0, breach = 0;
    const due = open.filter(t => {
      const { ack, res } = ticketSla(t, now);
      const states = [!t.acknowledgedAt ? ack.state : 'met', !t.resolvedAt ? res.state : 'met'];
      if (states.includes('breach')) breach++; else if (states.includes('warning')) warn++;
      return states.includes('breach') || states.includes('warning');
    });
    const unread = store.conversations.reduce((n, c) => n + unreadOf(c), 0);
    const unreadConvs = store.conversations.filter(c => unreadOf(c) > 0).length;
    const ops = store.services.filter(s => s.status === 'Opérationnel').length;
    const watch = store.services.length - ops;
    const ranked = [...open].sort((a, b) => a.priority.localeCompare(b.priority) || a.openedAt.localeCompare(b.openedAt));
    return { open, p1p2, due, warn, breach, unread, unreadConvs, ops, watch, ranked };
  }, [store, now]);
  return <div className="page-enter"><Warning />
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div className="eyebrow">{new Date(now).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Libreville' }).toLocaleUpperCase('fr-FR')} <span className="mx-1">·</span> POINT DE SITUATION</div><h2 className="serif mt-1 text-[30px] leading-tight">Bonjour, {store.profile.name.split(' ')[0]}.</h2><p className="mt-1 text-[13px] text-muted-foreground">Voici les repères opérationnels de votre espace de travail.</p></div><div className="flex gap-2">{!isAuditor && <Link href="/tickets?new=1" data-testid="link-new-request" className="focus-ring inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-[12px] font-semibold hover:bg-muted"><Plus size={15} />Nouvelle demande</Link>}<Link href="/audit" className="focus-ring inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2.5 text-[12px] font-semibold text-primary-foreground"><Activity size={15} />Journal d’activité</Link></div></div>
    {isAuditor ? <div className="mt-5 max-w-3xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><Metric label="Articles KEDB consultables" value={pad2(store.kedb.length)} delta="Consultation en lecture seule" icon={ShieldCheck} tone="blue" /><Metric label="Événements du journal" value={pad2(store.audit.length)} delta="Export disponible selon les filtres" icon={Activity} tone="neutral" /></div>
      <section className="panel p-5"><SectionTitle kicker="ACCÈS N5 · LECTURE" title="Consultation limitée" /><p className="text-[12px] leading-relaxed text-muted-foreground">Les détails des tickets et les conversations ne font pas partie de votre périmètre. Vous pouvez consulter la base d’erreurs connues et exporter le journal d’activité.</p><div className="mt-4 flex flex-wrap gap-3"><Link href="/services" className="text-[11px] font-semibold text-primary hover:underline">Consulter la base KEDB</Link><Link href="/audit" className="text-[11px] font-semibold text-primary hover:underline">Ouvrir le journal</Link></div></section>
    </div> : <>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric testId="metric-services" label="Services opérationnels" value={`${stats.ops} / ${store.services.length}`} delta={stats.watch ? `${stats.watch} en vigilance` : 'Aucune vigilance'} icon={ShieldCheck} tone="green" />
      <Metric testId="metric-open" label="Tickets ouverts" value={pad2(stats.open.length)} delta={`${stats.p1p2} en priorité P1 ou P2`} icon={ClipboardList} tone="amber" />
      <Metric testId="metric-due" label="Échéances SLA à surveiller" value={pad2(stats.due.length)} delta={`${stats.breach} dépassée(s) · ${stats.warn} proche(s)`} icon={Clock3} tone={stats.breach ? 'red' : 'blue'} />
      <Metric testId="metric-unread" label="Messages non lus" value={pad2(stats.unread)} delta={stats.unreadConvs ? `Dans ${stats.unreadConvs} conversation(s)` : 'Tout est lu'} icon={MessageSquare} tone="neutral" />
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
      <section className="panel p-5 md:p-6"><SectionTitle kicker="CONTINUITÉ DE SERVICE" title="État des services" action={<Link className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline" href="/services">Catalogue complet <ArrowRight size={13} /></Link>} />
        <div className="space-y-1">{store.services.map(s => { const linked = stats.open.filter(t => t.serviceId === s.id).length; return <div key={s.id} className="flex items-center gap-3 border-t border-border/70 py-3.5"><div className={`grid h-9 w-9 place-items-center rounded-lg ${s.status === 'Vigilance' ? 'bg-[#f5ecd8] text-[#977033]' : 'bg-[#e3eee7] text-[#36745a] dark:bg-[#25443a] dark:text-[#aed9c2]'}`}><Server size={16} /></div><div className="min-w-0 flex-1"><div className="text-[13px] font-semibold">{s.name}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{s.owner} <span className="mx-1">·</span> {linked} ticket(s) ouvert(s)</div></div><Badge tone={s.status === 'Vigilance' ? 'amber' : 'green'}><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />{s.status}</Badge></div>; })}</div>
      </section>
      <section className="panel p-5 md:p-6"><SectionTitle kicker="SUIVI DU SUPPORT" title="Tickets à surveiller" action={<Link className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline" href="/tickets">Tous les tickets <ArrowRight size={13} /></Link>} />
        <div className="space-y-2">{stats.ranked.slice(0, 4).map(t => <Link href={`/tickets?ticket=${encodeURIComponent(t.id)}`} onClick={() => log(`Ticket ${t.id} ouvert depuis la vue générale`, 'Support informatique')} key={t.id} data-testid={`link-dashboard-ticket-${t.id}`} className="focus-ring block w-full rounded-lg border border-border/80 px-3.5 py-3 text-left transition hover:border-primary/40 hover:bg-muted/50"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="mono text-[10px] text-muted-foreground">{t.id} <span className="mx-1">·</span> {t.kind} · L{t.supportLevel}</div><div className="mt-1 truncate text-[12px] font-semibold">{t.title}</div></div><Badge tone={priorityTone(t.priority)}>{t.priority}</Badge></div><div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground"><span>{t.assignee}</span><Badge tone={statusTone(t.status)}>{t.status}</Badge></div></Link>)}{!stats.ranked.length && <div className="rounded-lg border border-dashed border-border p-6 text-center text-[11px] text-muted-foreground">Aucun ticket ouvert.</div>}</div>
      </section>
    </div>
    <div className="mt-5 grid gap-5 lg:grid-cols-[1.3fr_1fr]">
      <section className="panel p-5 md:p-6"><SectionTitle kicker="ESPACE COLLABORATIF" title="Conversations récentes" action={<Link className="text-[11px] font-semibold text-primary hover:underline" href="/messages">Ouvrir la messagerie <ArrowRight className="inline" size={12} /></Link>} /><div className="divide-y divide-border/70">{store.conversations.slice(0, 4).map(c => { const last = c.messages.at(-1); return <Link href={`/messages?c=${encodeURIComponent(c.id)}`} key={c.id} className="flex items-center gap-3 py-3"><Avatar name={c.participants[1] || c.title} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-[12px] font-semibold"><span className="truncate">{c.title}</span>{unreadOf(c) > 0 && <span className="rounded-full bg-primary px-1.5 text-[9px] text-primary-foreground">{unreadOf(c)}</span>}</div><div className="mt-1 truncate text-[11px] text-muted-foreground">{last?.body}</div></div><span className="text-[10px] text-muted-foreground">{last ? messageTime(last) : ''}</span></Link>; })}</div></section>
      <section className="panel overflow-hidden"><div className="bg-[#213b42] px-5 py-4 text-[#eef3eb]"><div className="eyebrow text-[#a9c2b8]">REPÈRE SSI</div><div className="mt-1 text-[15px] font-semibold">Une séparation claire des usages</div><p className="mt-2 text-[11px] leading-relaxed text-[#c1d1cc]">Les informations de support portent uniquement sur la continuité technique. Aucun contenu d’enquête n’est nécessaire à la gestion d’un incident.</p></div><div className="grid grid-cols-2 divide-x divide-border"><div className="p-4"><div className="eyebrow">COMPTE</div><div className="mt-1 text-[13px] font-semibold">{store.profile.role}</div></div><div className="p-4"><div className="eyebrow">ARTICLES KEDB</div><div className="mt-1 text-[13px] font-semibold">{store.kedb.length} validé(s)</div></div></div><div className="border-t border-border px-4 py-3"><Link href="/governance" className="text-[11px] font-semibold text-primary hover:underline">Référentiel de gouvernance <ArrowRight className="inline" size={12} /></Link></div></section>
    </div>
    </>}
  </div>;
}
