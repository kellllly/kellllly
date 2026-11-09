import { useEffect, useState } from 'react';
import { Clock, Download, LoaderCircle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { createItsmAuditTimestamp, getItsmAuditTimestamps, type ItsmAuditTimestamps } from '@workspace/api-client-react';
import { formatWAT } from '@/lib/itsm';
import { Button } from '@/components/kit';

/**
 * RFC 3161 timestamps of the journal checkpoint (read: N1, N3, N5; request: N1, N3).
 * The server re-verifies each token at every display; the token can be
 * downloaded to check it independently with openssl.
 */
export function AuditTimestampsPanel({ canRequest }: { canRequest: boolean }) {
  const [data, setData] = useState<ItsmAuditTimestamps | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => {
    try { setData(await getItsmAuditTimestamps()); } catch { setError('Horodatages indisponibles pour le moment.'); }
  };
  useEffect(() => { void load(); }, []);
  const request = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const created = await createItsmAuditTimestamp();
      setNotice(`Point de contrôle de ${created.size} événements horodaté le ${created.genTime ? formatWAT(created.genTime, 'datetime') : '—'}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Horodatage impossible pour le moment.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="panel p-5" data-testid="panel-audit-timestamps">
    <div className="eyebrow">HORODATAGE RFC 3161</div>
    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Une autorité d’horodatage externe signe l’empreinte du point de contrôle Merkle. Le jeton prouve, indépendamment du pilote, que les événements horodatés existaient à cette date sous cette forme : s’ils sont réécrits, leur racine ne correspond plus. La valeur probante dépend de l’autorité configurée (qualifiée eIDAS ou non).</p>
    {data && !data.configured && <p role="status" className="mt-2 text-[11px] text-muted-foreground">Aucune autorité n’est configurée sur ce serveur (variable ITSM_TSA_URL).</p>}
    {data?.configured && data.trustedRoots === 0 && <p role="status" className="mt-2 text-[10px] text-[#9a6a1c]">Aucune racine de confiance n’est configurée : la signature est vérifiée, mais pas la chaîne de certificats de l’autorité.</p>}
    {canRequest && data?.configured && <Button variant="outline" className="mt-3 w-full" testId="button-request-timestamp" disabled={busy} onClick={() => void request()}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Clock size={14} />}{busy ? 'Demande à l’autorité…' : 'Faire horodater le point de contrôle'}</Button>}
    {notice && <p role="status" data-testid="status-timestamp-created" className="mt-2 text-[11px] text-[#2f6b4f] dark:text-[#9fd2b6]">{notice}</p>}
    {error && <p role="alert" className="mt-2 text-[11px] text-destructive">{error}</p>}
    {data && data.timestamps.length > 0 && <ol className="mt-3 space-y-2" data-testid="list-audit-timestamps">{data.timestamps.map(stamp => {
      const ok = stamp.valid && stamp.journalUnchanged;
      return <li key={stamp.id} data-testid={`timestamp-${stamp.id}`} data-valid={ok} className={`rounded-lg border p-2.5 text-[10px] leading-relaxed ${ok ? 'border-[#9fc7b3] bg-[#e1efe7]/40 dark:bg-[#214238]/40' : 'border-[#d39b90] bg-[#f5e2df]/50 dark:bg-[#4c302d]/50'}`}>
        <div className="flex items-center gap-1.5 font-semibold text-foreground">{ok ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}{stamp.size} événements · {stamp.genTime ? formatWAT(stamp.genTime, 'datetime') : 'date inconnue'}</div>
        <div className="text-muted-foreground">{stamp.tsaSubject ?? stamp.tsaUrl ?? 'Autorité inconnue'}{stamp.serial ? ` · n° ${stamp.serial}` : ''}</div>
        <div className={ok ? 'text-[#2f6b4f] dark:text-[#9fd2b6]' : 'text-destructive'}>{ok ? `Jeton valide${stamp.chainVerified ? ', chaîne de l’autorité vérifiée' : ''} ; les événements horodatés sont inchangés.` : stamp.problem}</div>
        <a href={`/api/itsm/audit/timestamps/${encodeURIComponent(stamp.id)}/token`} data-testid={`link-timestamp-token-${stamp.id}`} className="mt-1 inline-flex items-center gap-1 font-semibold text-primary hover:underline"><Download size={11} />Jeton (.tsr)</a>
        <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">Vérifier avec openssl</summary><code className="mono mt-1 block break-all text-[9px]">printf '%s' '{stamp.statement}' &gt; donnees.txt ; openssl ts -verify -data donnees.txt -in jeton.tsr -CAfile racine-autorite.pem</code></details>
      </li>;
    })}</ol>}
    {data?.configured && data.timestamps.length === 0 && <p className="mt-2 text-[11px] text-muted-foreground">Aucun horodatage pour l’instant.</p>}
  </div>;
}
