import { useMemo, useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { SLA_POLICIES, formatWAT, priorityFor, slaProgress } from '@/lib/itsm';
import { ASSIGNEES, CATEGORIES, KINDS, LEVEL_LABEL, fmtDuration, fmtMinutes, isOpen } from '@/lib/domain';
import { findKedbSuggestionsForDraft } from '@/lib/diagnostic-assistant';
import { businessSlaProgress } from '@/lib/sla-calendar';
import type { Asset, KedbArticle, Level, Service, SlaCalendar, SlaPause, Ticket, TicketKind } from '@/lib/types';
import { Badge, Button, dialogStickyActionsCls, Field, inputCls, textareaCls } from './kit';

export type TicketDraft = { kind: TicketKind; title: string; description: string; category: string; impact: Level; urgency: Level; supportLevel: Level; assignee: string; serviceId: string; assetId: string };
export const emptyDraft = (p: Partial<TicketDraft> = {}): TicketDraft => ({ kind: 'Incident', title: '', description: '', category: 'Applications', impact: 2, urgency: 2, supportLevel: 1, assignee: 'Équipe support', serviceId: '', assetId: '', ...p });

function assignmentSuggestion(draft: TicketDraft, services: Service[]) {
  const priority = priorityFor(draft.impact, draft.urgency);
  const service = services.find(item => item.id === draft.serviceId);
  const serviceOwner = service?.owner.trim() ?? '';
  const specialistServiceCategory = draft.category === 'Applications' ? 'Applications'
    : draft.category === 'Réseau' ? 'Infrastructure'
      : draft.category === 'Poste de travail' || draft.category === 'Équipement' ? 'Équipement'
        : null;
  const specialist = specialistServiceCategory
    ? services.find(item => item.category === specialistServiceCategory)?.owner.trim()
    : null;
  const categoryTeam = draft.category === 'Accès' ? 'Équipe support' : specialist || 'Équipe support';
  const priorityRouting = priority === 'P1' || priority === 'P2';
  const assignee = priorityRouting || !serviceOwner ? categoryTeam : serviceOwner;
  const reason = priorityRouting
    ? `${priority} · spécialité ${draft.category}`
    : serviceOwner
      ? `${priority} · propriétaire du service ${service?.name ?? ''}`
      : `${priority} · catégorie ${draft.category}`;
  return { assignee, reason, priority };
}

const STATE_LABEL = { ok: 'Dans le délai', warning: 'Seuil d’alerte atteint', breach: 'Délai dépassé', met: 'Délai tenu' } as const;

export function SlaBar({ label, openedAt, deadline, completedAt, now, testId, calendar, targetMinutes, pauses = [] }: {
  label: string; openedAt: string; deadline: string; completedAt: string | null; now: number; testId?: string;
  calendar?: SlaCalendar; targetMinutes?: number; pauses?: SlaPause[];
}) {
  const p = calendar && targetMinutes
    ? businessSlaProgress(openedAt, completedAt, now, targetMinutes, calendar, pauses)
    : slaProgress(openedAt, deadline, completedAt, now);
  const late = completedAt ? p.state === 'breach' : false;
  const state = completedAt && late ? 'breach' : p.state;
  const color = state === 'breach' ? 'bg-[#c0574a]' : state === 'warning' ? 'bg-[#c88e43]' : state === 'met' ? 'bg-[#4f9d80]' : 'bg-[#537b8d]';
  const frac = Math.max(0, Math.min(1, p.fraction));
  return <div data-testid={testId} className="rounded-lg border border-border/80 p-3">
    <div className="flex items-center justify-between gap-2"><div className="eyebrow">{label}</div><Badge tone={state === 'breach' ? 'red' : state === 'warning' ? 'amber' : state === 'met' ? 'green' : 'blue'}>{completedAt ? (late ? 'Réalisé hors délai' : STATE_LABEL.met) : STATE_LABEL[p.state]}</Badge></div>
    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full w-full origin-left rounded-full transition-transform duration-700 ${color}`} style={{ transform: `scaleX(${frac})` }} /></div>
    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-[10px] text-muted-foreground">
      <span>Échéance <span className="mono text-foreground">{formatWAT(deadline, 'datetime')}</span></span>
      <span className="mono font-semibold text-foreground">{completedAt ? `réalisé ${formatWAT(completedAt, 'datetime')}` : p.remainingMs >= 0 ? `reste ${fmtDuration(p.remainingMs)}` : `dépassé de ${fmtDuration(p.remainingMs)}`}</span>
    </div>
  </div>;
}

export function PriorityPreview({ impact, urgency }: { impact: Level; urgency: Level }) {
  const p = priorityFor(impact, urgency); const pol = SLA_POLICIES[p];
  return <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/70 px-3 py-2.5 text-[10px] text-muted-foreground"><Badge tone={p === 'P1' ? 'red' : p === 'P2' ? 'amber' : p === 'P3' ? 'blue' : 'neutral'}>{p} · {pol.label}</Badge><span>Prise en charge {fmtMinutes(pol.acknowledgeMinutes)} · résolution {fmtMinutes(pol.resolveMinutes)}</span></div>;
}

export function TicketForm({ initial, services, assets, tickets, submitLabel, onSubmit, onCancel, lockKind = false, articles, autoAssignByService = false }: { initial: TicketDraft; services: Service[]; assets: Asset[]; tickets: readonly Ticket[]; submitLabel: string; onSubmit: (d: TicketDraft) => void; onCancel: () => void; lockKind?: boolean; articles?: readonly KedbArticle[]; autoAssignByService?: boolean }) {
  const [d, setD] = useState<TicketDraft>(() => {
    const suggestion = assignmentSuggestion(initial, services);
    return autoAssignByService ? { ...initial, assignee: suggestion.assignee } : initial;
  });
  const [automaticAssignment, setAutomaticAssignment] = useState(autoAssignByService);
  const suggestions = useMemo(() => (articles ? findKedbSuggestionsForDraft(articles, d) : []), [articles, d]);
  const set = <K extends keyof TicketDraft>(k: K, v: TicketDraft[K]) => setD(current => {
    const next = { ...current, [k]: v };
    if (autoAssignByService && automaticAssignment && (k === 'serviceId' || k === 'category' || k === 'impact' || k === 'urgency')) {
      next.assignee = assignmentSuggestion(next, services).assignee;
    }
    return next;
  });
  const suggestion = assignmentSuggestion(d, services);
  const assigneeOptions = [...new Set([...ASSIGNEES, ...services.map(service => service.owner.trim()).filter(Boolean), ...tickets.map(ticket => ticket.assignee.trim()).filter(Boolean)])];
  const assignmentLoads = assigneeOptions.map(assignee => ({
    assignee,
    count: tickets.filter(ticket => ticket.assignee === assignee && isOpen(ticket) && ticket.status !== 'Résolu').length,
  }));
  const submit = (e: FormEvent) => { e.preventDefault(); if (!d.title.trim()) return; onSubmit({ ...d, title: d.title.trim(), description: d.description.trim() }); };
  const lvlSel = (k: 'impact' | 'urgency' | 'supportLevel', label: string, opts: [Level, string][]) => <Field label={label}><select data-testid={`select-${k}`} value={d[k]} onChange={e => set(k, Number(e.target.value) as Level)} className={inputCls}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>;
  return <form onSubmit={submit} className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Type ITIL" hint={lockKind ? 'Le type ne peut plus changer après la prise en charge.' : undefined}><select data-testid="select-kind" disabled={lockKind} value={d.kind} onChange={e => set('kind', e.target.value as TicketKind)} className={inputCls}>{KINDS.map(k => <option key={k}>{k}</option>)}</select></Field>
      <Field label="Catégorie"><select data-testid="select-category" value={d.category} onChange={e => set('category', e.target.value)} className={inputCls}>{CATEGORIES.map(x => <option key={x}>{x}</option>)}</select></Field>
    </div>
    <Field label="Sujet"><input data-testid="input-title" required autoFocus value={d.title} onChange={e => set('title', e.target.value)} className={inputCls} placeholder="Symptôme technique en quelques mots" /></Field>
    <div aria-live="polite">{suggestions.length > 0 && <div data-testid="kedb-suggestions" className="rounded-lg border border-border bg-muted/40 p-3"><div className="eyebrow">ERREURS CONNUES PROCHES · KEDB</div><p className="mt-1 text-[10px] text-muted-foreground">Une résolution validée existe peut-être déjà : vérifiez-la avant de créer le ticket.</p><div className="mt-2 space-y-1.5">{suggestions.map(a => <details key={a.id} data-testid={`kedb-suggestion-${a.id}`} className="rounded-md bg-card px-2.5 py-2 text-[11px]"><summary className="cursor-pointer font-semibold"><span className="mono text-muted-foreground">{a.id}</span> · {a.title}</summary><p className="mt-1.5 whitespace-pre-wrap leading-relaxed text-muted-foreground"><strong className="text-foreground">Résolution :</strong> {a.resolution}</p></details>)}</div></div>}</div>
    <Field label="Description technique"><textarea data-testid="input-description" rows={3} value={d.description} onChange={e => set('description', e.target.value)} className={textareaCls} placeholder="N’incluez aucune information sensible, personnelle ou d’enquête." /></Field>
    <div className="grid gap-3 sm:grid-cols-3">
      {lvlSel('impact', 'Impact', [[1, LEVEL_LABEL[1]], [2, LEVEL_LABEL[2]], [3, LEVEL_LABEL[3]]])}
      {lvlSel('urgency', 'Urgence', [[1, LEVEL_LABEL[1]], [2, LEVEL_LABEL[2]], [3, LEVEL_LABEL[3]]])}
      {lvlSel('supportLevel', 'Niveau de support', [[1, 'L1 · accueil'], [2, 'L2 · spécialiste'], [3, 'L3 · expert']])}
    </div>
    <PriorityPreview impact={d.impact} urgency={d.urgency} />
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Service concerné (optionnel)"><select data-testid="select-service" value={d.serviceId} onChange={e => set('serviceId', e.target.value)} className={inputCls}><option value="">Aucun</option>{services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Équipement (optionnel)"><select data-testid="select-asset" value={d.assetId} onChange={e => set('assetId', e.target.value)} className={inputCls}><option value="">Aucun</option>{assets.map(a => <option key={a.id} value={a.id}>{a.id} · {a.name}</option>)}</select></Field>
    </div>
    <Field label="Assignation"><select data-testid="select-assignee" value={d.assignee} onChange={e => {
      setAutomaticAssignment(false);
      set('assignee', e.target.value);
    }} className={inputCls}>{assignmentLoads.map(({ assignee, count }) => <option key={assignee} value={assignee}>{assignee} · {count} actif{count === 1 ? '' : 's'}</option>)}</select></Field>
    <section data-testid="assignment-workload" aria-label="Charge actuelle des équipes" className="rounded-lg border border-border/80 bg-muted/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <strong className="text-[10px]">Charge actuelle des équipes</strong>
        <span className="text-[9px] text-muted-foreground">Tickets actifs assignés · priorité {suggestion.priority}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {assignmentLoads.map(({ assignee, count }, index) => <div key={assignee} data-testid={`assignment-load-${index}`} data-assignee={assignee} className={`flex min-w-0 items-center justify-between gap-1.5 rounded-md border px-2 py-1.5 ${suggestion.assignee === assignee ? 'border-primary/50 bg-primary/5' : 'border-border/70 bg-card/60'}`}>
          <span className="truncate text-[9px]">{assignee}{suggestion.assignee === assignee ? ' · suggérée' : ''}</span>
          <Badge tone={count > 3 ? 'amber' : 'neutral'}>{count}</Badge>
        </div>)}
      </div>
      <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground">Les tickets résolus, clos et rejetés ne sont pas comptés. Cette indication aide au choix et ne remplace pas le routage suggéré.</p>
    </section>
    {autoAssignByService && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 bg-muted/40 px-3 py-2 text-[10px] text-muted-foreground">
      <p data-testid="service-assignment-hint" role="status" aria-live="polite">
        {automaticAssignment
          ? `Routage automatique actif · ${suggestion.assignee} (${suggestion.reason}).`
          : `Affectation manuelle · suggestion actuelle : ${suggestion.assignee} (${suggestion.reason}).`}
      </p>
      {!automaticAssignment && <Button type="button" testId="button-apply-assignment-suggestion" variant="outline" className="h-7 px-2.5" onClick={() => {
        set('assignee', suggestion.assignee);
        setAutomaticAssignment(true);
      }}>Appliquer la suggestion</Button>}
    </div>}
    {d.kind === 'Changement' && <p className="rounded-lg border border-border bg-muted/50 p-3 text-[10px] leading-relaxed text-muted-foreground">Un changement ne peut démarrer qu’après une décision CAB enregistrée (approbation simulée ou rejet motivé).</p>}
     <div data-dialog-sticky-actions className={`${dialogStickyActionsCls} pt-3`}><Button className="w-full sm:w-auto" variant="outline" onClick={onCancel} testId="button-cancel-ticket">Annuler</Button><Button className="w-full sm:w-auto" type="submit" testId="button-submit-ticket"><Check size={14} />{submitLabel}</Button></div>
  </form>;
}
