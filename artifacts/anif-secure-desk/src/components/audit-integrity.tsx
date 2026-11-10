import { useState, type FormEvent } from 'react';
import { ShieldCheck, ShieldAlert, LoaderCircle, Copy, GitBranch } from 'lucide-react';
import { getItsmAuditIntegrity, getItsmAuditProof, type ItsmAuditIntegrity } from '@workspace/api-client-react';
import { describeAuditIntegrity } from '@/lib/audit-integrity';
import { formatCheckpoint, parseCheckpoint, verifyMerkleInclusion } from '@/lib/audit-merkle';
import { formatWAT } from '@/lib/itsm';
import { Button, inputCls } from '@/components/kit';

type ProofResult = { ok: boolean; text: string };

/** Proves in the browser that one event belongs to a checkpoint kept outside the pilot. */
function InclusionProof({ current }: { current: { size: number; root: string } }) {
  const [reference, setReference] = useState('');
  const [kept, setKept] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProofResult | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const checkpoint = kept.trim() ? parseCheckpoint(kept) : current;
    if (!checkpoint) { setResult({ ok: false, text: 'Point de contrôle illisible : collez-le tel que copié, sous la forme « taille:racine ».' }); return; }
    setBusy(true); setResult(null);
    try {
      const proof = await getItsmAuditProof({ event: reference.trim(), treeSize: checkpoint.size });
      const valid = proof.root === checkpoint.root
        && await verifyMerkleInclusion(proof.seal, proof.seq - 1, proof.treeSize, proof.proof, checkpoint.root);
      setResult(valid
        ? { ok: true, text: `L’événement n° ${proof.seq} figure, inchangé, dans le point de contrôle de ${checkpoint.size} événements. Preuve recalculée dans votre navigateur (${proof.proof.length} empreintes).` }
        : { ok: false, text: `Preuve invalide : l’événement n° ${proof.seq} ne correspond pas à la racine de ce point de contrôle. Le journal a pu être réécrit depuis : prévenez l’administrateur.` });
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error && error.message ? error.message : 'Preuve indisponible pour le moment.' });
    } finally {
      setBusy(false);
    }
  };
  return <form onSubmit={e => void submit(e)} className="mt-3 space-y-2 border-t border-border pt-3" data-testid="form-inclusion-proof">
    <div className="eyebrow">PROUVER L’INCLUSION D’UN ÉVÉNEMENT</div>
    <input data-testid="input-proof-event" required maxLength={120} value={reference} onChange={e => setReference(e.target.value)} className={inputCls} placeholder="Identifiant ou n° de séquence" aria-label="Événement à prouver" />
    <input data-testid="input-proof-checkpoint" value={kept} onChange={e => setKept(e.target.value)} className={`${inputCls} mono text-[10px]`} placeholder="Point de contrôle noté (vide : celui affiché)" aria-label="Point de contrôle noté" />
    <Button type="submit" variant="outline" className="w-full" testId="button-check-proof" disabled={busy || !reference.trim()}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <GitBranch size={14} />}{busy ? 'Calcul…' : 'Vérifier la preuve'}</Button>
    {result && <p role="status" data-testid="status-inclusion-proof" data-valid={result.ok} className={`text-[11px] leading-relaxed ${result.ok ? 'text-[#2f6b4f] dark:text-[#9fd2b6]' : 'text-destructive'}`}>{result.text}</p>}
  </form>;
}

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
  const [copiedCheckpoint, setCopiedCheckpoint] = useState(false);
  const copySeal = async () => {
    if (!view?.seal) return;
    try { await navigator.clipboard.writeText(view.seal); setCopied(true); } catch { setCopied(false); }
  };
  const checkpoint = report?.merkle ? formatCheckpoint(report.merkle) : '';
  const copyCheckpoint = async () => {
    try { await navigator.clipboard.writeText(checkpoint); setCopiedCheckpoint(true); } catch { setCopiedCheckpoint(false); }
  };

  return <div className="panel p-5" data-testid="panel-audit-integrity">
    <div className="eyebrow">INTÉGRITÉ DU JOURNAL</div>
    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Chaque événement est scellé par une empreinte SHA-256 liée à la précédente. Toute modification faite hors de l’application rompt la chaîne. Notez le dernier sceau et le point de contrôle Merkle en dehors du pilote pour pouvoir prouver plus tard que rien d’antérieur n’a été réécrit. La base conserve aussi une copie des sceaux qu’elle refuse de modifier ou d’effacer (ajout seul) : un journal réécrit puis rescellé est repéré. Un administrateur de la base peut toutefois lever cette protection ; les horodatages RFC 3161 et le flux SIEM gardent une preuve hors du pilote.</p>
    <Button variant="outline" className="mt-3 w-full" testId="button-check-integrity" disabled={busy} onClick={() => void check()}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <ShieldCheck size={14} />}{busy ? 'Vérification…' : 'Vérifier la chaîne'}</Button>
    {error && <p role="alert" className="mt-3 text-[11px] text-destructive">{error}</p>}
    {view && report && <div role="status" data-testid="status-audit-integrity" data-status={report.status} className={`mt-3 rounded-lg border p-3 text-[11px] ${view.tone === 'green' ? 'border-[#9fc7b3] bg-[#e1efe7]/60 dark:bg-[#214238]/50' : view.tone === 'red' ? 'border-[#d39b90] bg-[#f5e2df]/60 dark:bg-[#4c302d]/50' : 'border-border bg-muted/50'}`}>
      <div className="flex items-center gap-1.5 font-semibold">{view.tone === 'red' ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}{view.title}</div>
      <p className="mt-1 leading-relaxed text-muted-foreground">{view.detail}</p>
      {view.archive && <p data-testid="text-audit-archive" data-archive={report.archive?.status} className="mt-1 leading-relaxed text-muted-foreground">{view.archive}</p>}
      {view.seal && <div className="mt-2"><div className="eyebrow">DERNIER SCEAU</div><div className="mt-1 flex items-start gap-2"><code data-testid="text-audit-seal" className="mono min-w-0 flex-1 break-all text-[10px]">{view.seal}</code><button type="button" aria-label="Copier le sceau" onClick={() => void copySeal()} className="focus-ring shrink-0 rounded-md border border-border p-1.5 hover:bg-muted"><Copy size={12} /></button></div>{copied && <span className="text-[10px] text-primary">Sceau copié.</span>}</div>}
      {report.merkle && <div className="mt-2"><div className="eyebrow">POINT DE CONTRÔLE MERKLE</div><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Racine de l’arbre de Merkle (RFC 6962) des {report.merkle.size} événements. Notez-la hors du pilote : vous pourrez prouver plus tard qu’un événement y figurait sans avoir été modifié.</p><div className="mt-1 flex items-start gap-2"><code data-testid="text-audit-checkpoint" className="mono min-w-0 flex-1 break-all text-[10px]">{checkpoint}</code><button type="button" aria-label="Copier le point de contrôle" onClick={() => void copyCheckpoint()} className="focus-ring shrink-0 rounded-md border border-border p-1.5 hover:bg-muted"><Copy size={12} /></button></div>{copiedCheckpoint && <span className="text-[10px] text-primary">Point de contrôle copié.</span>}<InclusionProof current={report.merkle} /></div>}
      <div className="mt-2 text-[10px] text-muted-foreground">Vérifié le {formatWAT(report.checkedAt, 'datetime')}</div>
    </div>}
  </div>;
}
