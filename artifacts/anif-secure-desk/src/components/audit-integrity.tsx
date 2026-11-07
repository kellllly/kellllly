import { useState } from 'react';
import { ShieldCheck, ShieldAlert, LoaderCircle, Copy } from 'lucide-react';
import { getItsmAuditIntegrity, type ItsmAuditIntegrity } from '@workspace/api-client-react';
import { describeAuditIntegrity } from '@/lib/audit-integrity';
import { formatWAT } from '@/lib/itsm';
import { Button } from '@/components/kit';

/** On-demand check of the journal hash chain (N1, N3, N5). */
export function AuditIntegrityPanel() {
  const [report, setReport] = useState<ItsmAuditIntegrity | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const view = report ? describeAuditIntegrity(report) : null;

  const check = async () => {
    setBusy(true); setError(''); setCopied(false);
    try {
      setReport(await getItsmAuditIntegrity());
    } catch {
      setError('Vérification impossible pour le moment. Réessayez plus tard.');
    } finally {
      setBusy(false);
    }
  };
  const copySeal = async () => {
    if (!view?.seal) return;
    try { await navigator.clipboard.writeText(view.seal); setCopied(true); } catch { setCopied(false); }
  };

  return <div className="panel p-5" data-testid="panel-audit-integrity">
    <div className="eyebrow">INTÉGRITÉ DU JOURNAL</div>
    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Chaque événement est scellé par une empreinte SHA-256 liée à la précédente. Toute modification faite hors de l’application rompt la chaîne. Notez le dernier sceau en dehors du pilote pour pouvoir prouver plus tard que rien d’antérieur n’a été réécrit. Ce n’est ni une archive WORM ni un horodatage qualifié.</p>
    <Button variant="outline" className="mt-3 w-full" testId="button-check-integrity" disabled={busy} onClick={() => void check()}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <ShieldCheck size={14} />}{busy ? 'Vérification…' : 'Vérifier la chaîne'}</Button>
    {error && <p role="alert" className="mt-3 text-[11px] text-destructive">{error}</p>}
    {view && report && <div role="status" data-testid="status-audit-integrity" data-status={report.status} className={`mt-3 rounded-lg border p-3 text-[11px] ${view.tone === 'green' ? 'border-[#9fc7b3] bg-[#e1efe7]/60 dark:bg-[#214238]/50' : view.tone === 'red' ? 'border-[#d39b90] bg-[#f5e2df]/60 dark:bg-[#4c302d]/50' : 'border-border bg-muted/50'}`}>
      <div className="flex items-center gap-1.5 font-semibold">{view.tone === 'red' ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}{view.title}</div>
      <p className="mt-1 leading-relaxed text-muted-foreground">{view.detail}</p>
      {view.seal && <div className="mt-2"><div className="eyebrow">DERNIER SCEAU</div><div className="mt-1 flex items-start gap-2"><code data-testid="text-audit-seal" className="mono min-w-0 flex-1 break-all text-[10px]">{view.seal}</code><button type="button" aria-label="Copier le sceau" onClick={() => void copySeal()} className="focus-ring shrink-0 rounded-md border border-border p-1.5 hover:bg-muted"><Copy size={12} /></button></div>{copied && <span className="text-[10px] text-primary">Sceau copié.</span>}</div>}
      <div className="mt-2 text-[10px] text-muted-foreground">Vérifié le {formatWAT(report.checkedAt, 'datetime')}</div>
    </div>}
  </div>;
}
