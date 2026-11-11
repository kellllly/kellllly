import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { SLA_POLICIES, formatWAT, priorityFor, slaProgress } from '@/lib/itsm';
import { ASSIGNEES, CATEGORIES, KINDS, LEVEL_LABEL, fmtDuration, fmtMinutes } from '@/lib/domain';
import type { Asset, Level, Service, TicketKind } from '@/lib/types';
import { Badge, Button, dialogStickyActionsCls, Field, inputCls, textareaCls } from './kit';

export type TicketDraft = { kind: TicketKind; title: string; description: string; category: string; impact: Level; urgency: Level; supportLevel: Level; assignee: string; serviceId: string; assetId: string };
export const emptyDraft = (p: Partial<TicketDraft> = {}): TicketDraft => ({ kind: 'Incident', title: '', description: '', category: 'Applications', impact: 2, urgency: 2, supportLevel: 1, assignee: 'Équipe support', serviceId: '', assetId: '', ...p });

const STATE_LABEL = { ok: 'Dans le délai', warning: 'Seuil d’alerte atteint', breach: 'Délai dépassé', met: 'Délai tenu' } as const;

export function SlaBar({ label, openedAt, deadline, completedAt, now, testId }: { label: string; openedAt: string; deadline: string; completedAt: string | null; now: number; testId?: string }) {
  const p = slaProgress(openedAt, deadline, completedAt, now);
  const late = completedAt ? new Date(completedAt).getTime() > new Date(deadline).getTime() : false;
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

export function TicketForm({ initial, services, assets, submitLabel, onSubmit, onCancel, lockKind = false }: { initial: TicketDraft; services: Service[]; assets: Asset[]; submitLabel: string; onSubmit: (d: TicketDraft) => void; onCancel: () => void; lockKind?: boolean }) {
  const [d, setD] = useState(initial);
  const set = <K extends keyof TicketDraft>(k: K, v: TicketDraft[K]) => setD(x => ({ ...x, [k]: v }));
  const submit = (e: FormEvent) => { e.preventDefault(); if (!d.title.trim()) return; onSubmit({ ...d, title: d.title.trim(), description: d.description.trim() }); };
  const lvlSel = (k: 'impact' | 'urgency' | 'supportLevel', label: string, opts: [Level, string][]) => <Field label={label}><select data-testid={`select-${k}`} value={d[k]} onChange={e => set(k, Number(e.target.value) as Level)} className={inputCls}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>;
  return <form onSubmit={submit} className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Type ITIL" hint={lockKind ? 'Le type ne peut plus changer après la prise en charge.' : undefined}><select data-testid="select-kind" disabled={lockKind} value={d.kind} onChange={e => set('kind', e.target.value as TicketKind)} className={inputCls}>{KINDS.map(k => <option key={k}>{k}</option>)}</select></Field>
      <Field label="Catégorie"><select data-testid="select-category" value={d.category} onChange={e => set('category', e.target.value)} className={inputCls}>{CATEGORIES.map(x => <option key={x}>{x}</option>)}</select></Field>
    </div>
    <Field label="Sujet"><input data-testid="input-title" required autoFocus value={d.title} onChange={e => set('title', e.target.value)} className={inputCls} placeholder="Symptôme technique en quelques mots" /></Field>
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
    <Field label="Assignation"><select data-testid="select-assignee" value={d.assignee} onChange={e => set('assignee', e.target.value)} className={inputCls}>{ASSIGNEES.map(x => <option key={x}>{x}</option>)}</select></Field>
    {d.kind === 'Changement' && <p className="rounded-lg border border-border bg-muted/50 p-3 text-[10px] leading-relaxed text-muted-foreground">Un changement ne peut démarrer qu’après une décision CAB enregistrée (approbation simulée ou rejet motivé).</p>}
     <div data-dialog-sticky-actions className={`${dialogStickyActionsCls} pt-3`}><Button className="w-full sm:w-auto" variant="outline" onClick={onCancel} testId="button-cancel-ticket">Annuler</Button><Button className="w-full sm:w-auto" type="submit" testId="button-submit-ticket"><Check size={14} />{submitLabel}</Button></div>
  </form>;
}
