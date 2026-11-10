import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useReverification, useUser } from '@clerk/react';
import { BadgeCheck, ChevronLeft, ChevronRight, Moon, RefreshCw, Search, ShieldCheck, Sun, UserCog } from 'lucide-react';
import {
  attestItsmRole,
  assignItsmRole,
  checkItsmRoleArchive,
  getItsmWorkspace,
  getItsmUserDirectory,
  getGetItsmUserDirectoryQueryKey,
  getItsmRoleReconciliation,
} from '@workspace/api-client-react';
import { usePeople } from '@/hooks/use-people';
import { useStore } from '@/lib/store';
import { useDisplayName } from '@/hooks/use-display-name';
import { roleRequestError, roleServiceIds } from '@/lib/role-administration';
import { isStepUpHint, stepUpMessage, withStepUpHint } from '@/lib/step-up';
import { Button, Field, inputCls, SectionTitle, Warning } from '@/components/kit';

type PilotServiceOption = { id: string; name: string };

function pilotServiceOptions(value: unknown): PilotServiceOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(service => {
    if (!service || typeof service !== 'object' || Array.isArray(service)) return [];
    const { id, name } = service as Record<string, unknown>;
    return typeof id === 'string' && typeof name === 'string' ? [{ id, name }] : [];
  });
}

export default function SettingsPage() {
  const { store, setStore, log } = useStore();
  const { name: displayName } = useDisplayName();
  const { user: currentUser } = useUser();
  const [targetUserId, setTargetUserId] = useState('');
  const [directorySearch, setDirectorySearch] = useState('');
  const [directoryPage, setDirectoryPage] = useState(0);
  const [role, setRole] = useState<'N1' | 'N2' | 'N3' | 'N4' | 'N5' | 'REVOKE'>('N2');
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [pilotServices, setPilotServices] = useState<PilotServiceOption[]>(() => pilotServiceOptions(store.services));
  const [roleMessage, setRoleMessage] = useState('');
  const [roleError, setRoleError] = useState('');
  const [rolePending, setRolePending] = useState(false);
  const [archiveCheckPending, setArchiveCheckPending] = useState(false);
  const [archiveCheckMessage, setArchiveCheckMessage] = useState('');
  const [archiveCheckError, setArchiveCheckError] = useState('');
  const [lastArchiveCheck, setLastArchiveCheck] = useState<{
    checkedAt: string;
    status: 'available' | 'unavailable';
  } | null>(null);
  const [attestationMessage, setAttestationMessage] = useState('');
  const [attestationError, setAttestationError] = useState('');
  const [attestationPending, setAttestationPending] = useState(false);
  const [directoryAccessDeniedFor, setDirectoryAccessDeniedFor] = useState<string | null>(null);
  const [directoryStreamStatus, setDirectoryStreamStatus] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const isRoleAdmin = store.profile.clearance.startsWith('N1 ·');
  const queryClient = useQueryClient();
  const directoryPageSize = 10;
  const directoryParams = {
    q: directorySearch,
    limit: directoryPageSize,
    offset: directoryPage * directoryPageSize,
  };
  const directory = useQuery({
    // Losing N1 moves the observer to a separate, disabled key, so the cached
    // directory becomes inactive and can be cleared (see the effect below).
    queryKey: [...getGetItsmUserDirectoryQueryKey(directoryParams), currentUser?.id, directoryAccessDeniedFor === currentUser?.id ? 'denied' : 'allowed'],
    queryFn: async ({ signal }) => {
      try {
        return await getItsmUserDirectory(directoryParams, { signal });
      } catch (error) {
        const status = typeof error === 'object' && error !== null && 'status' in error
          ? error.status
          : undefined;
        setTargetUserId('');
        if (status === 401 || status === 403) {
          setDirectoryAccessDeniedFor(currentUser?.id ?? null);
        }
        throw error;
      }
    },
    enabled: isRoleAdmin && Boolean(currentUser?.id) && directoryAccessDeniedFor !== currentUser?.id,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    setPilotServices(pilotServiceOptions(store.services));
  }, [store.services]);
  // Once access is refused, clear the cached directory, never the entry the page
  // still observes: removing it (from its own fetch, or while
  // mounted) made React Query rebuild it at once, in a loop that froze the page.
  useEffect(() => {
    // "inactive" in React Query includes a query whose only observer is disabled:
    // keep to entries nobody observes any more.
    if (directoryAccessDeniedFor) queryClient.removeQueries({ queryKey: getGetItsmUserDirectoryQueryKey(), exact: false, predicate: query => query.getObserversCount() === 0 });
  }, [directoryAccessDeniedFor, queryClient]);
  useEffect(() => {
    if (!isRoleAdmin || !currentUser?.id || directoryAccessDeniedFor === currentUser.id) return;

    const source = new EventSource('/api/itsm/users/events', { withCredentials: true });
    let lastErrorRefreshAt = 0;
    const refreshDirectory = () => {
      void queryClient.invalidateQueries({ queryKey: getGetItsmUserDirectoryQueryKey() });
    };
    const handleRevocation = () => {
      source.close();
      setTargetUserId('');
      setDirectoryAccessDeniedFor(currentUser.id);
    };
    source.onopen = () => {
      setDirectoryStreamStatus('connected');
      refreshDirectory();
    };
    source.addEventListener('directory-refresh', refreshDirectory);
    source.addEventListener('access-revoked', handleRevocation);
    source.onerror = () => {
      setDirectoryStreamStatus('reconnecting');
      // Revalidate through the protected directory endpoint if the stream drops.
      // This also clears cached directory data if the account has lost N1.
      if (Date.now() - lastErrorRefreshAt >= 5_000) {
        lastErrorRefreshAt = Date.now();
        refreshDirectory();
      }
    };
    return () => source.close();
  }, [currentUser?.id, directoryAccessDeniedFor, isRoleAdmin, queryClient]);
  const selectedAccount = directory.data?.accounts.find(account => account.userId === targetUserId);
  // Accounts whose Clerk role differs from the authorization journal (N1 only).
  const reconciliation = useQuery({
    queryKey: ['itsm-role-reconciliation'],
    queryFn: ({ signal }) => getItsmRoleReconciliation({ signal }),
    enabled: isRoleAdmin,
  });
  const { person } = usePeople(reconciliation.data?.findings.map(finding => finding.userId) ?? []);
  const reviewFinding = (userId: string) => {
    setDirectorySearch(userId);
    setDirectoryPage(0);
    setTargetUserId(userId);
    setRoleError(''); setRoleMessage(''); setAttestationError(''); setAttestationMessage('');
  };
  const availableServiceIds = new Set(pilotServices.map(service => service.id));
  const unavailableAccountServiceIds = selectedAccount?.unavailableServiceIds ?? [];

  // Role changes and attestations need a recent verification: Clerk's dialog opens, then the call is retried.
  const assignWithStepUp = useReverification(withStepUpHint(assignItsmRole));
  const attestWithStepUp = useReverification(withStepUpHint(attestItsmRole));
  const assignRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRoleMessage('');
    setRoleError('');
    if (!isRoleAdmin || directory.isError || directory.isFetching || !selectedAccount) {
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
    if (unavailableAccountServiceIds.length > 0 && role !== 'REVOKE') {
      const requestedServiceIds = roleServiceIds(role, selectedServiceIds);
      const roleScope = role === 'N1' || role === 'N2' || role === 'N5'
        ? 'tous les services selon le rôle'
        : requestedServiceIds.length
          ? requestedServiceIds.join(', ')
          : role === 'N3' ? 'tous les services' : 'aucun service';
      const roleChange = selectedAccount.role !== role;
      const roleConfirmation = roleChange
        ? `Le rôle passera de ${selectedAccount.role ?? 'aucun accès'} à ${role}.`
        : `Le rôle ${role} restera inchangé.`;
      const confirmed = window.confirm(
        `Confirmez-vous la correction du périmètre de ${selectedAccount.email ?? targetUserId} ? Les identifiants absents du pilote (${unavailableAccountServiceIds.join(', ')}) seront retirés. ${roleConfirmation} Les accès des autres comptes ne seront pas modifiés. Périmètre retenu : ${roleScope}.`,
      );
      if (!confirmed) return;
    }
    setRolePending(true);
    try {
      const requestedServiceIds = roleServiceIds(role, selectedServiceIds);
      if (role === 'N3' || role === 'N4') {
        let latestWorkspace;
        try {
          latestWorkspace = await getItsmWorkspace();
        } catch {
          setRoleError('Impossible d’actualiser le catalogue des services. Aucune attribution n’a été envoyée; réessayez lorsque la connexion sera rétablie.');
          return;
        }
        const currentServices = pilotServiceOptions(latestWorkspace.store.services);
        const currentIds = new Set(currentServices.map(service => service.id));
        const disappearedIds = requestedServiceIds.filter(id => !currentIds.has(id));
        setPilotServices(currentServices);
        if (disappearedIds.length) {
          const disappearedNames = disappearedIds.map(id => pilotServices.find(service => service.id === id)?.name ?? id);
          setSelectedServiceIds(current => current.filter(id => currentIds.has(id)));
          const plural = disappearedIds.length > 1;
          setRoleError(`${plural ? 'Les services' : 'Le service'} ${disappearedNames.join(', ')} ${plural ? 'ne sont plus présents' : 'n’est plus présent'} dans le pilote. La liste a été actualisée; vérifiez le périmètre avant de renvoyer l’habilitation.`);
          return;
        }
      }
      const result = await assignWithStepUp(targetUserId.trim(), {
        role: role === 'REVOKE' ? null : role,
        serviceIds: requestedServiceIds,
      });
      if (isStepUpHint(result)) throw Object.assign(new Error('La vérification d’identité n’a pas abouti : le rôle n’a pas été modifié.'), { status: 403 });
      setRoleMessage(result.role
        ? `Rôle ${result.role} attribué au compte ${result.userId}.`
        : `Accès ITSM retiré pour le compte ${result.userId}.`);
      setTargetUserId('');
      setSelectedServiceIds([]);
      await queryClient.invalidateQueries({ queryKey: getGetItsmUserDirectoryQueryKey() });
    } catch (error) {
      const message = stepUpMessage(error) ?? roleRequestError(error, 'assignment');
      setRoleError(message);
      if (typeof error === 'object' && error !== null && 'status' in error && error.status === 400
        && /services? autorisés? sont introuvables/iu.test(error instanceof Error ? error.message : '')) {
        try {
          const latestWorkspace = await getItsmWorkspace();
          const currentServices = pilotServiceOptions(latestWorkspace.store.services);
          const currentIds = new Set(currentServices.map(service => service.id));
          setPilotServices(currentServices);
          setSelectedServiceIds(current => current.filter(id => currentIds.has(id)));
        } catch {
          setRoleError(`${message} Impossible d’actualiser automatiquement la liste; actualisez la page avant de réessayer.`);
        }
      }
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
      const result = await attestWithStepUp(targetUserId, {
        role: selectedAccount.role,
        serviceIds: selectedAccount.serviceIds,
      });
      if (isStepUpHint(result)) throw new Error('La vérification d’identité n’a pas abouti : l’attestation n’a pas été enregistrée.');
      setAttestationMessage(
        `Attestation actuelle du rôle ${result.role} enregistrée pour le compte ${result.userId}.`,
      );
      void reconciliation.refetch();
    } catch (error) {
      setAttestationError(stepUpMessage(error) ?? roleRequestError(error, 'attestation'));
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
      setLastArchiveCheck({ checkedAt: result.checkedAt, status: 'available' });
    } catch (error) {
      setArchiveCheckError(roleRequestError(error, 'archive'));
      const data = error && typeof error === 'object' && 'data' in error
        ? error.data
        : null;
      const checkedAt = data && typeof data === 'object' && !Array.isArray(data)
        && 'checkedAt' in data && typeof data.checkedAt === 'string'
        ? data.checkedAt
        : null;
      if (checkedAt && !Number.isNaN(Date.parse(checkedAt))) {
        setLastArchiveCheck({ checkedAt, status: 'unavailable' });
      }
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
                 <p className="mt-1 text-[10px] text-muted-foreground">Contrôle ponctuel non destructif, sans modifier de compte ni créer d’événement; il ne s’agit pas d’une surveillance continue.</p>
              </div>
              <Button type="button" variant="outline" className="h-8 shrink-0 px-3" disabled={archiveCheckPending} onClick={() => void checkRoleArchive()}>
                <RefreshCw size={13} className={archiveCheckPending ? 'animate-spin' : ''} />
                {archiveCheckPending ? 'Vérification…' : 'Tester la connexion'}
              </Button>
            </div>
            {archiveCheckError && <p role="alert" className="mt-3 text-xs text-destructive">{archiveCheckError}</p>}
            {archiveCheckMessage && <p role="status" className="mt-3 text-xs text-primary">{archiveCheckMessage}</p>}
            {lastArchiveCheck && <p className="mt-3 text-[10px] text-muted-foreground">
              Dernier contrôle ponctuel : {new Intl.DateTimeFormat('fr-FR', {
                dateStyle: 'medium',
                timeStyle: 'medium',
                timeZone: 'Africa/Libreville',
              }).format(new Date(lastArchiveCheck.checkedAt))}
              {' — résultat : '}{lastArchiveCheck.status === 'available' ? 'archive accessible.' : 'archive indisponible.'}
            </p>}
          </div>
          {isRoleAdmin && <div data-testid="panel-role-reconciliation" className="mb-5 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-[11px] font-semibold">Contrôle des habilitations</div><Button type="button" variant="outline" className="h-8 px-2" disabled={reconciliation.isFetching} onClick={() => void reconciliation.refetch()}><RefreshCw size={13} className={reconciliation.isFetching ? 'animate-spin' : ''} />Vérifier</Button></div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Comptes dont le rôle ou les services enregistrés dans Clerk ne correspondent pas au dernier changement inscrit au journal (rôle attribué hors de l’application, ou modifié directement dans Clerk). Vérifiez chaque compte auprès de son responsable, puis corrigez son rôle ou attestez l’état actuel.</p>
            {reconciliation.isLoading ? <p role="status" className="mt-2 text-[11px] text-muted-foreground">Comparaison en cours…</p>
              : reconciliation.isError ? <p role="alert" className="mt-2 text-[11px] text-destructive">Comparaison indisponible pour le moment.</p>
              : reconciliation.data?.findings.length ? <ul className="mt-2 divide-y divide-border/70 rounded-md border border-border">{reconciliation.data.findings.map(finding => <li key={finding.userId} data-testid={`row-reconciliation-${finding.userId}`} className="flex flex-wrap items-center gap-2 p-2.5 text-[11px]">
                  <span className="min-w-0 flex-1"><span className="font-semibold">{person(finding.userId) === finding.userId ? 'Compte sans nom' : person(finding.userId)}</span> <span className="mono text-[9px] text-muted-foreground">{finding.userId}</span><span className="block text-[10px] text-muted-foreground">{finding.reason === 'missing_audit' ? `Rôle ${finding.clerkRole} sans trace au journal` : finding.reason === 'role_mismatch' ? `Clerk : ${finding.clerkRole} · journal : ${finding.auditRole ?? 'aucun'}` : `Services différents : Clerk [${finding.clerkServiceIds.join(', ') || 'aucun'}] · journal [${finding.auditServiceIds.join(', ') || 'aucun'}]`}</span></span>
                  <Button type="button" variant="outline" className="h-8 px-2" testId={`button-review-${finding.userId}`} onClick={() => reviewFinding(finding.userId)}>Examiner</Button>
                </li>)}</ul>
              : <p role="status" data-testid="text-reconciliation-ok" className="mt-2 text-[11px] text-primary">Tous les rôles Clerk correspondent au journal.</p>}
          </div>}
          <div className="grid min-w-0 gap-5 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-3">
              <Field label="Rechercher un compte pilote">
                <div className="relative"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={directorySearch} onChange={event => { setDirectorySearch(event.target.value); setDirectoryPage(0); }} className={`${inputCls} pl-9`} placeholder="E-mail ou identifiant de compte" /></div>
              </Field>
              <div className="overflow-hidden rounded-lg border border-border" aria-label="Comptes du pilote">
                {directory.isLoading ? <p role="status" className="p-4 text-xs text-muted-foreground">Chargement des comptes…</p>
                  : directory.isError ? <p role="alert" className="p-4 text-xs text-destructive">{roleRequestError(directory.error, 'directory')}</p>
                  : directory.data?.accounts.length ? <div className="divide-y divide-border/70">
                      {directory.data.accounts.map(account => <button key={account.userId} type="button" disabled={rolePending || attestationPending} aria-pressed={targetUserId === account.userId} onClick={() => { setTargetUserId(account.userId); setRole(account.role ?? 'N2'); setSelectedServiceIds(account.serviceIds.filter(id => availableServiceIds.has(id))); setRoleError(''); setRoleMessage(''); setAttestationError(''); setAttestationMessage(''); }} className={`block w-full p-3 text-left transition hover:bg-muted/50 disabled:opacity-50 ${targetUserId === account.userId ? 'bg-primary/5 ring-1 ring-inset ring-primary/40' : ''}`}>
                        <span className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 truncate text-[11px] font-semibold">{account.email ?? 'Adresse e-mail indisponible'}</span><span className="rounded-md bg-muted px-2 py-1 text-[9px] font-semibold">{account.role ?? 'Aucun accès'}</span></span>
                        <span className="mono mt-1 block break-all text-[9px] text-muted-foreground">{account.userId}</span>
                        {account.unavailableServiceIds.length > 0 && <span data-testid={`status-directory-unavailable-services-${account.userId}`} className="mt-2 block break-words rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-800 dark:text-amber-200">Périmètre à corriger — services absents : {account.unavailableServiceIds.join(', ')}</span>}
                      </button>)}
                    </div> : <p role="status" className="p-4 text-xs text-muted-foreground">{directorySearch.trim() ? 'Aucun compte ne correspond à cette recherche.' : 'Aucun compte trouvé.'}</p>}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p role="status" className="text-[10px] text-muted-foreground">{directory.isFetching ? 'Actualisation du répertoire…' : directoryStreamStatus === 'connected' ? 'Répertoire actualisé en direct lors des changements de rôle.' : 'Connexion au flux de mises à jour du répertoire…'}</p>
                <Button type="button" variant="outline" className="h-8 px-2" disabled={directory.isFetching} onClick={() => void directory.refetch()}><RefreshCw size={13} className={directory.isFetching ? 'animate-spin' : ''} />Actualiser</Button>
              </div>
              {directory.data && !directory.isError && <div className="flex items-center justify-between gap-2">
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
              {unavailableAccountServiceIds.length > 0 && <p role="status" data-testid="status-unavailable-account-services" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-800 dark:text-amber-200">Ce compte comporte des identifiants de services absents du catalogue : {unavailableAccountServiceIds.join(', ')}. Ils ne seront retirés qu’après confirmation de l’enregistrement.</p>}
              <Field label="Nouvelle habilitation"><select value={role} onChange={e => setRole(e.target.value as typeof role)} className={inputCls}>{['N1', 'N2', 'N3', 'N4', 'N5', 'REVOKE'].map(value => <option key={value} value={value}>{value === 'REVOKE' ? 'Retirer entièrement l’accès' : value}</option>)}</select></Field>
              {(role === 'N3' || role === 'N4') && <Field label="Services autorisés pour N3 / N4" hint="Cochez les services à autoriser. Sans sélection : N3 accède à tous les services; N4 n’en reçoit aucun.">
                <div role="group" aria-label="Services disponibles dans le pilote" className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                  {pilotServices.length > 0 ? pilotServices.map(service => <label key={service.id} className="flex cursor-pointer items-start gap-2 rounded-md p-2 text-[11px] hover:bg-muted/50">
                    <input data-testid={`input-role-service-${service.id}`} type="checkbox" checked={selectedServiceIds.includes(service.id)} onChange={event => setSelectedServiceIds(current => event.target.checked
                      ? [...new Set([...current, service.id])]
                      : current.filter(id => id !== service.id))} className="mt-0.5 accent-primary" />
                    <span className="min-w-0"><span className="block font-medium">{service.name}</span><span className="mono text-[9px] text-muted-foreground">{service.id}</span></span>
                  </label>) : <p role="status" data-testid="status-no-pilot-services" className="p-2 text-[10px] text-muted-foreground">Aucun service n’est disponible dans le catalogue du pilote.</p>}
                </div>
              </Field>}
              {roleError && <p role="alert" data-testid="status-role-assignment-error" className="text-xs text-destructive">{roleError}</p>}
              {roleMessage && <p role="status" className="text-xs text-primary">{roleMessage}</p>}
              <div className="flex justify-end"><Button type="submit" disabled={rolePending || attestationPending || directory.isFetching || directory.isError || !selectedAccount}><UserCog size={14} />{rolePending ? 'Enregistrement…' : role === 'REVOKE' ? 'Révoquer l’accès' : role === 'N1' ? 'Nommer ce compte N1' : 'Attribuer le rôle'}</Button></div>
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
