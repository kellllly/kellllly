import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import { BadgeCheck, ChevronLeft, ChevronRight, Moon, RefreshCw, Search, ShieldCheck, Sun, UserCog } from 'lucide-react';
import {
  attestItsmRole,
  assignItsmRole,
  checkItsmRoleArchive,
  getItsmUserDirectory,
  getGetItsmUserDirectoryQueryKey,
} from '@workspace/api-client-react';
import { useStore } from '@/lib/store';
import { useDisplayName } from '@/hooks/use-display-name';
import { roleRequestError, roleServiceIds } from '@/lib/role-administration';
import { Button, Field, inputCls, SectionTitle, Warning } from '@/components/kit';

export default function SettingsPage() {
  const { store, setStore, log } = useStore();
  const { name: displayName } = useDisplayName();
  const { user: currentUser } = useUser();
  const [targetUserId, setTargetUserId] = useState('');
  const [directorySearch, setDirectorySearch] = useState('');
  const [directoryPage, setDirectoryPage] = useState(0);
  const [role, setRole] = useState<'N1' | 'N2' | 'N3' | 'N4' | 'N5' | 'REVOKE'>('N2');
  const [serviceIds, setServiceIds] = useState('');
  const [roleMessage, setRoleMessage] = useState('');
  const [roleError, setRoleError] = useState('');
  const [rolePending, setRolePending] = useState(false);
  const [archiveCheckPending, setArchiveCheckPending] = useState(false);
  const [archiveCheckMessage, setArchiveCheckMessage] = useState('');
  const [archiveCheckError, setArchiveCheckError] = useState('');
  const [attestationMessage, setAttestationMessage] = useState('');
  const [attestationError, setAttestationError] = useState('');
  const [attestationPending, setAttestationPending] = useState(false);
  const [directoryAccessDeniedFor, setDirectoryAccessDeniedFor] = useState<string | null>(null);
  const isRoleAdmin = store.profile.clearance.startsWith('N1 ·');
  const queryClient = useQueryClient();
  const directoryPageSize = 10;
  const directoryParams = {
    q: directorySearch,
    limit: directoryPageSize,
    offset: directoryPage * directoryPageSize,
  };
  const directory = useQuery({
    queryKey: [...getGetItsmUserDirectoryQueryKey(directoryParams), currentUser?.id],
    queryFn: async ({ signal }) => {
      try {
        return await getItsmUserDirectory(directoryParams, { signal });
      } catch (error) {
        const status = typeof error === 'object' && error !== null && 'status' in error
          ? error.status
          : undefined;
        if (status === 401 || status === 403) {
          setDirectoryAccessDeniedFor(currentUser?.id ?? null);
          setTargetUserId('');
          queryClient.removeQueries({ queryKey: getGetItsmUserDirectoryQueryKey(), exact: false });
        }
        throw error;
      }
    },
    enabled: isRoleAdmin && Boolean(currentUser?.id) && directoryAccessDeniedFor !== currentUser?.id,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const selectedAccount = directory.data?.accounts.find(account => account.userId === targetUserId);

  const assignRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRoleMessage('');
    setRoleError('');
    if (!isRoleAdmin || directory.isError || !selectedAccount) {
      setRoleError('Actualisez le répertoire et sélectionnez un compte avant de modifier une habilitation.');
      return;
    }
    if (role === 'REVOKE') {
      const self = targetUserId.trim() === currentUser?.id;
      const confirmed = window.confirm(self
        ? 'Retirer votre propre accès ITSM ? Cette opération est définitive pour cette session et exige qu’un autre compte N1 reste actif.'
        : 'Retirer entièrement l’accès ITSM de ce compte ? Il ne pourra plus consulter ni modifier l’espace.');
      if (!confirmed) return;
    }
    setRolePending(true);
    try {
      const result = await assignItsmRole(targetUserId.trim(), {
        role: role === 'REVOKE' ? null : role,
        serviceIds: roleServiceIds(role, serviceIds),
      });
      setRoleMessage(result.role
        ? `Rôle ${result.role} attribué au compte ${result.userId}.`
        : `Accès ITSM retiré pour le compte ${result.userId}.`);
      setTargetUserId('');
      setServiceIds('');
      await queryClient.invalidateQueries({ queryKey: getGetItsmUserDirectoryQueryKey() });
    } catch (error) {
      setRoleError(roleRequestError(error, 'assignment'));
      void queryClient.invalidateQueries({ queryKey: getGetItsmUserDirectoryQueryKey() });
    } finally {
      setRolePending(false);
    }
  };
  const attestCurrentRole = async () => {
    if (!isRoleAdmin || directory.isError || !targetUserId || !selectedAccount?.role) return;
    const confirmed = window.confirm(
      `Confirmez-vous avoir vérifié le rôle ${selectedAccount.role} et les services [${selectedAccount.serviceIds.join(', ') || 'aucun périmètre partiel'}] de ce compte ? L’attestation sera horodatée maintenant; elle ne reconstitue pas l’historique manquant et ne modifie pas le rôle.`,
    );
    if (!confirmed) return;
    setAttestationMessage('');
    setAttestationError('');
    setAttestationPending(true);
    try {
      const result = await attestItsmRole(targetUserId, {
        role: selectedAccount.role,
        serviceIds: selectedAccount.serviceIds,
      });
      setAttestationMessage(
        `Attestation actuelle du rôle ${result.role} enregistrée pour le compte ${result.userId}.`,
      );
    } catch (error) {
      setAttestationError(roleRequestError(error, 'attestation'));
      void queryClient.invalidateQueries({ queryKey: getGetItsmUserDirectoryQueryKey() });
    } finally {
      setAttestationPending(false);
    }
  };
  const checkRoleArchive = async () => {
    setArchiveCheckMessage('');
    setArchiveCheckError('');
    setArchiveCheckPending(true);
    try {
      const result = await checkItsmRoleArchive();
      setArchiveCheckMessage(result.message);
    } catch (error) {
      setArchiveCheckError(roleRequestError(error, 'archive'));
    } finally {
      setArchiveCheckPending(false);
    }
  };
  return <div className="page-enter min-w-0"><Warning /><div className="mb-5"><div className="eyebrow">COMPTE & CONFIGURATION</div><h2 className="serif mt-1 text-[27px]">Préférences</h2><p className="mt-1 text-[12px] text-muted-foreground">Le compte authentifié accède à l’espace ITSM fictif partagé.</p></div>
    <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_.8fr]"><div className="min-w-0 space-y-5">
      <section className="panel p-5 md:p-6"><SectionTitle kicker="COMPTE AUTHENTIFIÉ" title="Identité de la session" />
        <div className="rounded-lg bg-muted/60 p-4"><div className="eyebrow">COMPTE</div><div className="mt-2 text-[13px] font-semibold">{displayName}</div><div className="eyebrow mt-3">IDENTIFIANT DE COMPTE</div><div className="mono mt-2 break-all text-[12px] font-semibold">{store.profile.name}</div><div className="mt-2 text-[11px] text-muted-foreground">{store.profile.role} · {store.profile.clearance}</div></div>
        <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">L’identité affichée provient de la session authentifiée. Les rôles de démonstration sélectionnables ont été retirés; les commandes et transitions de tickets sont contrôlées par l’API.</p>
      </section>
        {isRoleAdmin && directoryAccessDeniedFor === currentUser?.id && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">Votre accès N1 a changé. Le répertoire a été effacé de cette session; reconnectez-vous pour vérifier vos droits.</p>}
        {isRoleAdmin && directoryAccessDeniedFor !== currentUser?.id && <section className="panel p-5 md:p-6"><SectionTitle kicker="ADMINISTRATION DES HABILITATIONS" title="Attribuer un rôle au pilote" />
          <p className="mb-4 text-[11px] leading-relaxed text-muted-foreground">Le rôle est enregistré dans les métadonnées Clerk et vérifié par l’API. Pour une relève, attribuez d’abord N1 au remplaçant, puis retirez l’ancien accès. L’API bloque la révocation du dernier N1 actif, les modifications concurrentes et toute tentative d’un rôle inférieur d’obtenir N1. Le bootstrap initial reste limité aux adresses vérifiées configurées par l’administrateur système; une révocation manuelle ne peut pas être réactivée automatiquement par ce mécanisme.</p>
          <div className="mb-5 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold">Connexion à l’archive des habilitations</div>
                <p className="mt-1 text-[10px] text-muted-foreground">Vérification non destructive, sans modifier de compte ni créer d’événement.</p>
              </div>
              <Button type="button" variant="outline" className="h-8 shrink-0 px-3" disabled={archiveCheckPending} onClick={() => void checkRoleArchive()}>
                <RefreshCw size={13} className={archiveCheckPending ? 'animate-spin' : ''} />
                {archiveCheckPending ? 'Vérification…' : 'Tester la connexion'}
              </Button>
            </div>
            {archiveCheckError && <p role="alert" className="mt-3 text-xs text-destructive">{archiveCheckError}</p>}
            {archiveCheckMessage && <p role="status" className="mt-3 text-xs text-primary">{archiveCheckMessage}</p>}
          </div>
          <div className="grid min-w-0 gap-5 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-3">
              <Field label="Rechercher un compte pilote">
                <div className="relative"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={directorySearch} onChange={event => { setDirectorySearch(event.target.value); setDirectoryPage(0); }} className={`${inputCls} pl-9`} placeholder="E-mail ou identifiant de compte" /></div>
              </Field>
              <div className="overflow-hidden rounded-lg border border-border" aria-label="Comptes du pilote">
                {directory.isLoading ? <p role="status" className="p-4 text-xs text-muted-foreground">Chargement des comptes…</p>
                  : directory.data?.accounts.length ? <div className="divide-y divide-border/70">
                      {directory.data.accounts.map(account => <button key={account.userId} type="button" disabled={rolePending || attestationPending} aria-pressed={targetUserId === account.userId} onClick={() => { setTargetUserId(account.userId); setRole(account.role ?? 'N2'); setServiceIds(account.serviceIds.join(', ')); setRoleError(''); setRoleMessage(''); setAttestationError(''); setAttestationMessage(''); }} className={`block w-full p-3 text-left transition hover:bg-muted/50 disabled:opacity-50 ${targetUserId === account.userId ? 'bg-primary/5 ring-1 ring-inset ring-primary/40' : ''}`}>
                        <span className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 truncate text-[11px] font-semibold">{account.email ?? 'Adresse e-mail indisponible'}</span><span className="rounded-md bg-muted px-2 py-1 text-[9px] font-semibold">{account.role ?? 'Aucun accès'}</span></span>
                        <span className="mono mt-1 block break-all text-[9px] text-muted-foreground">{account.userId}</span>
                      </button>)}
                    </div> : directory.isError ? <p role="alert" className="p-4 text-xs text-destructive">{roleRequestError(directory.error, 'directory')}</p>
                      : <p role="status" className="p-4 text-xs text-muted-foreground">{directorySearch.trim() ? 'Aucun compte ne correspond à cette recherche.' : 'Aucun compte trouvé.'}</p>}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p role="status" className="text-[10px] text-muted-foreground">{directory.isFetching ? 'Actualisation du répertoire…' : 'Actualisation automatique toutes les 15 secondes.'}</p>
                <Button type="button" variant="outline" className="h-8 px-2" disabled={directory.isFetching} onClick={() => void directory.refetch()}><RefreshCw size={13} className={directory.isFetching ? 'animate-spin' : ''} />Actualiser</Button>
              </div>
              {directory.isError && directory.data && <p role="alert" className="text-[10px] text-destructive">Les résultats précédents restent visibles, mais les modifications sont désactivées. {roleRequestError(directory.error, 'directory')}</p>}
              {directory.data && <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">{directory.data.totalCount ? `${directory.data.offset + 1}–${Math.min(directory.data.offset + directory.data.accounts.length, directory.data.totalCount)} sur ${directory.data.totalCount}` : '0 compte'}</span>
                <div className="flex gap-1">
                  <Button type="button" variant="outline" className="h-8 px-2" aria-label="Page précédente" disabled={directoryPage === 0 || directory.isFetching} onClick={() => setDirectoryPage(page => Math.max(0, page - 1))}><ChevronLeft size={14} /></Button>
                  <Button type="button" variant="outline" className="h-8 px-2" aria-label="Page suivante" disabled={directoryPage + 1 >= Math.ceil(directory.data.totalCount / directoryPageSize) || directory.isFetching} onClick={() => setDirectoryPage(page => page + 1)}><ChevronRight size={14} /></Button>
                </div>
              </div>}
            </div>
            <form onSubmit={assignRole} className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-[11px] font-semibold">Régulariser une trace d’habilitation manquante</div>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Choisissez un compte pour attester son rôle Clerk actuel. Cette opération ne modifie pas ses métadonnées et ne prétend pas reconstituer l’historique antérieur.</p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 h-8 px-3"
                  testId="button-attest-current-role"
                  disabled={attestationPending || rolePending || directory.isFetching || directory.isError || !targetUserId || !selectedAccount?.role}
                  onClick={() => void attestCurrentRole()}
                >
                  <BadgeCheck size={14} />
                  {attestationPending ? 'Enregistrement…' : selectedAccount?.role
                    ? `Attester le rôle ${selectedAccount.role}`
                    : 'Sélectionnez un compte avec rôle'}
                </Button>
                {selectedAccount?.role && <p data-testid="text-attestation-scope" className="mt-2 break-words text-[10px] text-muted-foreground">Services consultés : {selectedAccount.serviceIds.join(', ') || (selectedAccount.role === 'N4' ? 'aucun service attribué' : 'tous les services')}.</p>}
                {targetUserId === currentUser?.id && <p className="mt-2 text-[10px] text-muted-foreground">Vous attestez votre propre compte; cette trace n’est pas une validation indépendante.</p>}
                {attestationError && <p role="alert" data-testid="status-role-attestation-error" className="mt-2 text-xs text-destructive">{attestationError}</p>}
                {attestationMessage && <p role="status" data-testid="status-role-attestation-success" className="mt-2 text-xs text-primary">{attestationMessage}</p>}
              </div>
              <div className="rounded-lg bg-muted/60 p-3">
                <div className="eyebrow">COMPTE CIBLE</div>
                {targetUserId ? <div className="mono mt-1 break-all text-[11px] font-semibold">{targetUserId}</div> : <p className="mt-1 text-[11px] text-muted-foreground">Choisissez un compte dans le répertoire.</p>}
              </div>
              <Field label="Nouvelle habilitation"><select value={role} onChange={e => setRole(e.target.value as typeof role)} className={inputCls}>{['N1', 'N2', 'N3', 'N4', 'N5', 'REVOKE'].map(value => <option key={value} value={value}>{value === 'REVOKE' ? 'Retirer entièrement l’accès' : value}</option>)}</select></Field>
              {(role === 'N3' || role === 'N4') && <Field label="Services autorisés pour N3 / N4" hint="Identifiants de services existants, séparés par des virgules. Vide : tous les services pour N3, aucun pour N4."><input value={serviceIds} onChange={e => setServiceIds(e.target.value)} className={inputCls} placeholder="Identifiants des services du pilote" /></Field>}
              {roleError && <p role="alert" className="text-xs text-destructive">{roleError}</p>}
              {roleMessage && <p role="status" className="text-xs text-primary">{roleMessage}</p>}
              <div className="flex justify-end"><Button type="submit" disabled={rolePending || attestationPending || directory.isError || !selectedAccount}><UserCog size={14} />{rolePending ? 'Enregistrement…' : role === 'REVOKE' ? 'Révoquer l’accès' : role === 'N1' ? 'Nommer ce compte N1' : 'Attribuer le rôle'}</Button></div>
            </form>
          </div>
       </section>}
      <section className="panel min-w-0 p-5 md:p-6"><SectionTitle kicker="APPARENCE" title="Thème de l’interface" /><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{([{ value: 'light', label: 'Clair', Icon: Sun }, { value: 'dark', label: 'Sombre', Icon: Moon }]).map(({ value, label, Icon }) => <button key={value} data-testid={`button-theme-${value}`} onClick={() => { setStore(s => ({ ...s, theme: value })); log(`Thème ${label} activé`, 'Préférences'); }} className={`flex min-w-0 items-center gap-3 rounded-xl border p-4 text-left ${store.theme === value ? 'border-primary bg-muted/60' : 'border-border hover:bg-muted/50'}`}><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-primary"><Icon size={17} /></span><span className="min-w-0"><span className="block text-[12px] font-semibold">{label}</span><span className="mt-1 block text-[10px] text-muted-foreground">{store.theme === value ? 'Thème actif' : 'Sélectionner'}</span></span></button>)}</div></section>
    </div><div className="min-w-0 space-y-5">
      <section className="panel p-5 md:p-6"><SectionTitle kicker="PERSISTANCE" title="Espace ITSM partagé" /><div className="flex items-start gap-3 rounded-lg bg-muted/60 p-4"><div className="grid h-9 w-9 place-items-center rounded-lg bg-card text-primary"><ShieldCheck size={17} /></div><div><div className="text-[12px] font-semibold">Données fictives partagées entre comptes</div><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Les tickets, historiques, décisions CAB simulées et articles KEDB sont enregistrés côté serveur pour l’espace pilote. Les changements d’autres sessions apparaissent automatiquement. Les exemples précédemment enregistrés dans ce navigateur sont conservés et importés sans écraser les données partagées.</p></div></div></section>
      <section className="overflow-hidden rounded-xl bg-[#213b42] p-5 text-[#eef3eb]"><div className="flex items-center gap-2 text-[12px] font-semibold"><ShieldCheck size={16} className="text-[#9ac6ad]" />Limites du pilote</div><p className="mt-3 text-[11px] leading-relaxed text-[#c1d1cc]">Prototype non homologué, réservé aux données fictives non sensibles. Aucune promesse de chiffrement de bout en bout, WORM, conformité, certification ou hébergement souverain. La messagerie et la confirmation du demandeur sont simulées.</p><div className="mt-4 border-t border-[#476065] pt-3 text-[10px] text-[#a9c2b8]">ANIF Gabon <span className="mx-1">·</span> Pilote d’évaluation</div></section>
    </div></div>
  </div>;
}
