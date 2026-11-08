import { useState } from 'react';
import { Bot, CheckCircle2, ChevronDown, LoaderCircle, XCircle } from 'lucide-react';
import { getItsmSessionMarker, getItsmWorkspaceVersion } from '@workspace/api-client-react';
import { useStore } from '@/lib/store';
import { ASSISTANT_TOPICS, assistantReport, suggestArticles, type AssistantTopic, type IntegrityCheck } from '@/lib/support-assistant';
import { Button } from '@/components/kit';

async function timed<T>(run: () => Promise<T>): Promise<{ ok: boolean; ms: number }> {
  const start = performance.now();
  try { await run(); return { ok: true, ms: Math.round(performance.now() - start) }; } catch { return { ok: false, ms: Math.round(performance.now() - start) }; }
}

/** Guided diagnosis in the support channel; hands a structured report to the message box. */
export function SupportAssistant({ onReport }: { onReport: (text: string) => void }) {
  const { store } = useStore();
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState<AssistantTopic | null>(null);
  const [checks, setChecks] = useState<IntegrityCheck[] | null>(null);
  const [running, setRunning] = useState(false);

  const runChecks = async () => {
    setRunning(true);
    const api = await timed(() => getItsmWorkspaceVersion());
    const session = await timed(() => getItsmSessionMarker());
    setChecks([
      { label: 'Liaison avec le serveur', ok: api.ok, detail: api.ok ? `${api.ms} ms` : 'injoignable' },
      { label: 'Session et annuaire d’identité', ok: session.ok, detail: session.ok ? 'session valide' : 'session refusée' },
      { label: 'Réseau du poste', ok: navigator.onLine, detail: navigator.onLine ? 'en ligne' : 'hors ligne' },
    ]);
    setRunning(false);
  };
  const choose = (next: AssistantTopic) => { setTopic(next); setChecks(null); void runChecks(); };
  const articles = topic ? suggestArticles(topic, store.kedb) : [];

  return <div className="border-b border-border px-5 py-2.5" data-testid="support-assistant">
    <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="focus-ring flex w-full items-center gap-2 text-left text-[11px] font-semibold text-primary"><Bot size={14} />Assistant SI — diagnostic guidé<ChevronDown size={13} className={`ml-auto transition ${open ? 'rotate-180' : ''}`} /></button>
    {open && <div className="mt-2 space-y-3 text-[11px]">
      <p className="text-[10px] text-muted-foreground">Arbre de diagnostic fixe (pas d’intelligence artificielle). Choisissez le domaine de la difficulté.</p>
      <div className="flex flex-wrap gap-1.5">{ASSISTANT_TOPICS.map(t => <button key={t.id} type="button" data-testid={`assistant-topic-${t.id}`} onClick={() => choose(t)} className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${topic?.id === t.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}>{t.label}</button>)}</div>
      {topic && <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border p-3"><div className="eyebrow mb-1">TESTS PRÉLIMINAIRES</div>{running || !checks ? <p role="status" className="flex items-center gap-1.5 text-muted-foreground"><LoaderCircle size={12} className="animate-spin" />Tests en cours…</p> : <ul className="space-y-1" data-testid="assistant-checks">{checks.map(c => <li key={c.label} className="flex items-center gap-1.5">{c.ok ? <CheckCircle2 size={12} className="text-[#4f9d80]" /> : <XCircle size={12} className="text-destructive" />}{c.label} · <span className="text-muted-foreground">{c.detail}</span></li>)}</ul>}
          <div className="eyebrow mb-1 mt-3">À ESSAYER</div><ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">{topic.steps.map(step => <li key={step}>{step}</li>)}</ol></div>
        <div className="rounded-lg border border-border p-3"><div className="eyebrow mb-1">FICHES DE RÉSOLUTION (KEDB)</div>{articles.length ? <ul className="space-y-2" data-testid="assistant-articles">{articles.map(a => <li key={a.id}><div className="font-semibold">{a.id} · {a.title}</div><div className="text-[10px] text-muted-foreground">{a.resolution}</div></li>)}</ul> : <p className="text-muted-foreground">Aucune fiche connue pour ce domaine.</p>}</div>
      </div>}
      {topic && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="h-8 px-3" testId="assistant-solved" onClick={() => { setTopic(null); setChecks(null); setOpen(false); }}>Problème résolu</Button><Button type="button" className="h-8 px-3" testId="assistant-report" disabled={!checks} onClick={() => { if (topic && checks) { onReport(assistantReport(topic, checks)); setOpen(false); } }}>Préparer un signalement</Button></div>}
    </div>}
  </div>;
}
