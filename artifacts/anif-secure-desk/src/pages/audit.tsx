import { useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useDisplayName } from '@/hooks/use-display-name';
import { Activity, AlertTriangle, ArrowRight, Download, LoaderCircle } from 'lucide-react';
import { AUDIT_EMPTY_STATE_MESSAGE, createAuditExportRunner, formatWAT, getAuditCalendarDayRange, getAuditExportFilename, getAuditFilterResult, getRecentAuditDateRange, hasAuditExportSelection, readAuditCsvResponse } from '@/lib/itsm';
import { useStore } from '@/lib/store';
import { Avatar, Button, SearchBox, Warning } from '@/components/kit';
import { usePeople } from '@/hooks/use-people';

const AUDIT_PAGE_SIZE = 50;

export default function AuditPage() {
  const { person } = usePeople();
  const { store, log } = useStore();
  const { name: displayName } = useDisplayName();
  const [query, setQuery] = useState(''); const [scope, setScope] = useState('Tous');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [exportError, setExportError] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const exportRunner = useRef(createAuditExportRunner());
  const canExport = ['N1', 'N3', 'N5'].includes(store.profile.clearance.slice(0, 2));
  const scopes = useMemo(() => Array.from(new Set(store.audit.map(e => e.scope))).sort((a, b) => a.localeCompare(b, 'fr')), [store.audit]);
  const dated = !!(from || to);
  const { events, filterError } = useMemo(
    () => getAuditFilterResult(store.audit, { scope, query, from, to }, person),
    [store.audit, scope, query, from, to, person],
  );
  const pageCount = Math.max(1, Math.ceil(events.length / AUDIT_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const firstVisibleIndex = currentPage * AUDIT_PAGE_SIZE;
  const visibleEvents = events.slice(firstVisibleIndex, firstVisibleIndex + AUDIT_PAGE_SIZE);
  const lastVisibleIndex = firstVisibleIndex + visibleEvents.length;
  const legacyCount = store.audit.filter(e => !e.at).length;

  const exportCsv = async () => {
    const exportTask = exportRunner.current.run(events, async (signal) => {
      const params = new URLSearchParams({ q: query, scope, from, to });
      const response = await fetch(`/api/itsm/audit/export?${params}`, { credentials: 'same-origin', signal });
      const blob = await readAuditCsvResponse(response);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      let revokeAfterDownloadStarts = false;
      try {
        a.href = url;
        a.download = getAuditExportFilename();
        document.body.appendChild(a);
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        revokeAfterDownloadStarts = true;
      } finally {
        try {
          a.remove();
        } finally {
          if (!revokeAfterDownloadStarts) URL.revokeObjectURL(url);
        }
      }
    }, (running, error) => {
      setIsExporting(running);
      if (error !== undefined) setExportError(error);
    });
    if (!exportTask) return;
    try { await exportTask; } catch { /* The runner already surfaced the error to the page. */ }
  };

  return <div className="page-enter min-w-0"><Warning />
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><div className="eyebrow">JOURNAL ITSM · HABILITATIONS CÔTÉ SERVEUR</div><h2 className="serif mt-1 text-[27px]">Journal d’activité</h2><p className="mt-1 text-[12px] text-muted-foreground">Les changements d’habilitation sont enregistrés par le serveur à partir du compte authentifié. Les autres événements restent des traces de démonstration; ce journal ne remplace pas une archive WORM / SIEM. Les contenus de messages n’y sont pas copiés.</p></div>{canExport && <div className="flex items-center gap-2"><Button testId="button-export-csv" onClick={() => void exportCsv()} disabled={isExporting || !hasAuditExportSelection(events)}>{isExporting ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />}{isExporting ? 'Export en cours…' : `Exporter la sélection (${events.length})`}</Button>{isExporting && <button type="button" data-testid="button-cancel-export" onClick={() => exportRunner.current.cancel()} className="focus-ring h-9 rounded-lg border border-border bg-card px-3 text-[11px] font-semibold text-foreground hover:bg-muted">Annuler</button>}</div>}</div>
    {exportError && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{exportError}</p>}
     {filterError && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{filterError}</p>}
     <div className="grid min-w-0 gap-5 lg:grid-cols-[1.35fr_.65fr]">
       <section className="panel min-w-0 overflow-hidden">
        <div className="space-y-3 border-b border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><div className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-primary"><Activity size={16} /></div><div className="text-[12px] font-semibold">Événements <span className="ml-1 font-normal text-muted-foreground" data-testid="text-audit-count" role="status" aria-live="polite" aria-atomic="true">({events.length} / {store.audit.length})</span></div></div><div className="w-full sm:w-64"><SearchBox testId="input-search-audit" value={query} onChange={value => { setQuery(value); setPage(0); }} placeholder="Filtrer le journal" /></div></div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-[9px] font-semibold uppercase tracking-[.1em] text-muted-foreground">Périmètre<select data-testid="filter-scope" value={scope} onChange={e => { setScope(e.target.value); setPage(0); }} className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-[11px] font-normal normal-case tracking-normal text-foreground"><option>Tous</option>{scopes.map(s => <option key={s}>{s}</option>)}</select></label>
             <label className="text-[9px] font-semibold uppercase tracking-[.1em] text-muted-foreground">Du (WAT)<input data-testid="input-date-from" type="date" value={from} aria-invalid={!!filterError} onChange={e => { setFrom(e.target.value); setPage(0); }} className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-[11px] font-normal text-foreground" /></label>
             <label className="text-[9px] font-semibold uppercase tracking-[.1em] text-muted-foreground">Au (WAT)<input data-testid="input-date-to" type="date" value={to} aria-invalid={!!filterError} onChange={e => { setTo(e.target.value); setPage(0); }} className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-[11px] font-normal text-foreground" /></label>
          </div>
           <div role="group" aria-label="Périodes récentes du journal" className="flex flex-wrap items-center gap-2">
             <span className="text-[9px] font-semibold uppercase tracking-[.1em] text-muted-foreground">Période rapide</span>
             {[
               { label: 'Aujourd’hui', testId: 'button-audit-today', range: () => getAuditCalendarDayRange(0) },
               { label: 'Hier', testId: 'button-audit-yesterday', range: () => getAuditCalendarDayRange(1) },
               { label: '7 derniers jours', testId: 'button-audit-last-7-days', range: () => getRecentAuditDateRange(7) },
               { label: '30 derniers jours', testId: 'button-audit-last-30-days', range: () => getRecentAuditDateRange(30) },
             ].map(({ label, testId, range }) => <button
               key={testId}
               type="button"
               data-testid={testId}
               onClick={() => {
                 const selectedRange = range();
                 setFrom(selectedRange.from);
                 setTo(selectedRange.to);
                 setPage(0);
               }}
                className="focus-ring h-8 rounded-lg border border-border bg-card px-3 text-[10px] font-semibold text-foreground transition-colors hover:bg-muted"
             >{label}</button>)}
           </div>
          {(scope !== 'Tous' || query || dated) && <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>{dated && legacyCount > 0 ? `${legacyCount} événement(s) historique(s) sans horodatage ISO exclu(s) du filtre de date.` : 'Filtres actifs.'}</span><button data-testid="button-clear-audit-filters" onClick={() => { setScope('Tous'); setQuery(''); setFrom(''); setTo(''); setPage(0); }} className="font-semibold text-primary hover:underline">Effacer les filtres</button></div>}
        </div>
         <div className="max-h-[680px] divide-y divide-border/70 overflow-y-auto">{visibleEvents.map((ev, i) => {
           const linkedTicketId = ev.type === 'itsm.ticket.converted' && ev.ticketId && store.tickets.some(ticket => ticket.id === ev.ticketId)
             ? ev.ticketId
             : null;
             return <div key={ev.id} className="flex min-w-0 gap-3 px-5 py-4"><div className="relative flex flex-col items-center"><div className={`mt-1 h-2.5 w-2.5 rounded-full ${firstVisibleIndex + i === 0 ? 'bg-primary' : 'bg-[#b4b7aa]'}`} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><div className="break-words text-[12px] font-semibold">{ev.action}</div><time dateTime={ev.at} className="mono text-[9px] text-muted-foreground">{ev.at ? formatWAT(ev.at, 'datetime') : `${ev.time} · historique`}</time></div><div className="mt-1 break-words text-[10px] text-muted-foreground">{person(ev.actor)} <span className="mx-1">·</span> {ev.scope}</div>{ev.type === 'itsm.ticket.converted' && ev.ticketId && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-[10px]"><span><span className="font-semibold">Incident associé :</span> <span className="mono break-all">{ev.ticketId}</span></span>{linkedTicketId && <Link data-testid={`link-audit-ticket-${ev.ticketId}`} href={`/tickets?ticket=${encodeURIComponent(ev.ticketId)}`} className="focus-ring inline-flex items-center gap-1 font-semibold text-primary hover:underline">Ouvrir le ticket <ArrowRight size={12} /></Link>}</div>}{(ev.type === 'itsm.role.changed' || ev.type === 'itsm.role.attested') && <div className="mt-2 break-words rounded-md bg-muted/60 px-2.5 py-2 text-[10px] leading-relaxed"><div><span className="font-semibold">Compte cible :</span> <span className="break-all">{ev.targetUserId}</span></div><div><span className="font-semibold">{ev.type === 'itsm.role.attested' ? 'Rôle attesté :' : 'Rôle :'}</span> {ev.previousRole || 'Aucun accès'} → {ev.nextRole || 'Aucun accès'}</div><div><span className="font-semibold">Services :</span> {ev.previousServiceIds?.join(', ') || '—'} → {ev.serviceIds?.join(', ') || '—'}</div></div>}</div></div>;
         })}{!events.length && <div role="status" data-testid="empty-audit-state" className="p-8 text-center text-xs text-muted-foreground">{AUDIT_EMPTY_STATE_MESSAGE}</div>}</div>
        {events.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <span data-testid="text-audit-page-range" className="text-[10px] text-muted-foreground">Affichage de {firstVisibleIndex + 1} à {lastVisibleIndex} sur {events.length} événements</span>
          {pageCount > 1 && <nav aria-label="Pagination du journal" className="flex items-center gap-2">
            <button type="button" data-testid="button-audit-previous-page" aria-label="Page précédente du journal" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="focus-ring h-8 rounded-lg border border-border bg-card px-3 text-[10px] font-semibold text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50">Précédent</button>
            <span data-testid="text-audit-current-page" aria-live="polite" className="min-w-14 text-center text-[10px] text-muted-foreground">Page {currentPage + 1} / {pageCount}</span>
            <button type="button" data-testid="button-audit-next-page" aria-label="Page suivante du journal" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} className="focus-ring h-8 rounded-lg border border-border bg-card px-3 text-[10px] font-semibold text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50">Suivant</button>
          </nav>}
        </div>}
      </section>
      <aside className="space-y-4"><div className="panel p-5"><div className="eyebrow">PORTÉE DU JOURNAL</div><div className="mt-2 text-[14px] font-semibold">Trace d’habilitation côté serveur</div><p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Le serveur conserve l’administrateur, le compte cible, les rôles avant et après, les périmètres et l’horodatage. Les autres événements du prototype ne constituent pas une archive inviolable ni une preuve de conformité; une chaîne WORM / SIEM reste à réaliser pour la production.</p><div className="mt-4 flex items-center gap-2 rounded-lg bg-[#f4ecd9] p-3 text-[10px] leading-relaxed text-[#654e27] dark:bg-[#413720] dark:text-[#ebd8aa]"><AlertTriangle size={14} className="shrink-0" />La réinitialisation locale ne supprime pas les changements d’habilitation enregistrés côté serveur.</div></div>
        <div className="panel p-5"><div className="eyebrow">EXPORT CSV</div><p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">L’export reprend uniquement les événements filtrés, en UTF-8 avec cellules protégées contre l’interprétation de formules par les tableurs.</p></div>
        <div className="panel p-5"><div className="eyebrow">SESSION ACTIVE</div><div className="mt-3 flex items-center gap-3"><Avatar name={displayName} /><div><div className="text-[12px] font-semibold">{displayName}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{store.profile.role} · {store.profile.clearance}</div></div></div>{['N1', 'N3'].includes(store.profile.clearance.slice(0, 2)) && <Button variant="outline" className="mt-4 w-full" testId="button-add-control" onClick={() => log('Contrôle de session consulté', 'Journal d’activité')}><Activity size={14} />Ajouter un événement de contrôle</Button>}</div></aside>
    </div></div>;
}
