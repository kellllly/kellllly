import { useState } from 'react';
import { Download, LoaderCircle, RadioTower } from 'lucide-react';
import { Button } from '@/components/kit';

const PAGE = 1000;
const MAX_PAGES = 50;

/** Collector connection notes and a one-off NDJSON download of the SIEM feed (N1, N3, N5). */
export function AuditSiemPanel() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const download = async () => {
    setBusy(true); setError(''); setStatus('');
    try {
      const chunks: string[] = [];
      let after = 0; let chain = '';
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await fetch(`/api/itsm/audit/siem?after=${after}&limit=${PAGE}`, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(response.status === 403 ? 'Votre rôle ne permet pas d’exporter le journal.' : 'Flux SIEM indisponible pour le moment. Réessayez plus tard.');
        const body = await response.text();
        if (body) chunks.push(body);
        chain = response.headers.get('X-ANIF-Chain-Status') ?? chain;
        const next = Number(response.headers.get('X-ANIF-Next-After'));
        const head = Number(response.headers.get('X-ANIF-Journal-Head'));
        if (!Number.isFinite(next) || next <= after || next >= head) break;
        after = next;
      }
      const lines = chunks.join('').split('\n').filter(Boolean).length;
      const url = URL.createObjectURL(new Blob(chunks, { type: 'application/x-ndjson' }));
      const link = document.createElement('a');
      link.href = url; link.download = `journal-anif-siem-${new Date().toISOString().slice(0, 10)}.ndjson`;
      link.click(); URL.revokeObjectURL(url);
      setStatus(`${lines} événement(s) exporté(s). Chaîne : ${chain === 'intact' ? 'intacte' : chain === 'broken' ? 'ROMPUE, prévenez l’administrateur' : chain}.`);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Flux SIEM indisponible pour le moment.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="panel p-5" data-testid="panel-audit-siem">
    <div className="eyebrow">RACCORDEMENT SIEM</div>
    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Un collecteur (Elastic, Splunk, Wazuh…) interroge <code className="mono text-[10px]">GET /api/itsm/audit/siem?after=…</code> avec un compte N1, N3 ou N5. Réponse : un événement JSON par ligne (champs ECS), du plus ancien au plus récent, avec son sceau. L’en-tête <code className="mono text-[10px]">X-ANIF-Next-After</code> donne le curseur du prochain appel ; <code className="mono text-[10px]">X-ANIF-Chain-Status</code> signale une chaîne rompue. Aucun SIEM n’est raccordé dans ce pilote.</p>
    <Button variant="outline" className="mt-3 w-full" testId="button-download-siem" disabled={busy} onClick={() => void download()}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />}{busy ? 'Export…' : 'Télécharger le flux (NDJSON)'}</Button>
    {status && <p role="status" data-testid="status-siem" className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground"><RadioTower size={12} className="mt-0.5 shrink-0" />{status}</p>}
    {error && <p role="alert" className="mt-2 text-[11px] text-destructive">{error}</p>}
  </div>;
}
