import { useEffect, useState, type FormEvent } from 'react';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowUpRight, Check, Clock3, FilePlus2, LockKeyhole, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import {
  getGetItsmMyRequestsQueryKey,
  useCreateItsmMyRequest,
  useGetItsmMyRequests,
  type ItsmMyRequestInput,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, Field, PageIntro, inputCls, textareaCls } from '@/components/kit';

const categories: ItsmMyRequestInput['category'][] = [
  'Applications',
  'Poste de travail',
  'Équipement',
  'Réseau',
  'Accès',
];

type Draft = {
  kind: ItsmMyRequestInput['kind'];
  title: string;
  category: ItsmMyRequestInput['category'];
  description: string;
  serviceId: string;
};

const initialDraft: Draft = {
  kind: 'Incident',
  title: '',
  category: 'Applications',
  description: '',
  serviceId: '',
};

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown }; cause?: unknown };
  if (typeof value.status === 'number') return value.status;
  if (typeof value.statusCode === 'number') return value.statusCode;
  if (typeof value.response?.status === 'number') return value.response.status;
  return value.cause ? statusOf(value.cause) : undefined;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Libreville',
  }).format(date);
}

function statusTone(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes('résolu') || normalized.includes('clos') || normalized.includes('termin')) return 'green';
  if (normalized.includes('attente') || normalized.includes('nouveau')) return 'amber';
  if (normalized.includes('cours') || normalized.includes('pris')) return 'blue';
  return 'neutral';
}

export default function RequesterPortalPage() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const requestsQuery = useGetItsmMyRequests();
  const createRequest = useCreateItsmMyRequest();
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [submitMessage, setSubmitMessage] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: getGetItsmMyRequestsQueryKey() });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [queryClient]);

  const services = requestsQuery.data?.services ?? [];
  const ownRequests = [...(requestsQuery.data?.requests ?? [])].sort(
    (a, b) => b.openedAt.localeCompare(a.openedAt),
  );
  const denied = statusOf(requestsQuery.error) === 403 || statusOf(createRequest.error) === 403;

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(current => ({ ...current, [key]: value }));
    setFieldErrors(current => ({ ...current, [key]: undefined }));
    setSubmitMessage('');
  }

  function validate(): boolean {
    const next: Partial<Record<keyof Draft, string>> = {};
    const title = draft.title.trim();
    const description = draft.description.trim();
    if (!title) next.title = 'Saisissez un sujet pour votre demande.';
    else if (title.length > 180) next.title = 'Le sujet ne peut pas dépasser 180 caractères.';
    if (!description) next.description = 'Décrivez le problème ou le besoin.';
    else if (description.length > 12000) next.description = 'La description ne peut pas dépasser 12 000 caractères.';
    if (draft.serviceId && !services.some(service => service.id === draft.serviceId)) {
      next.serviceId = 'Choisissez un service disponible dans le catalogue.';
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate() || createRequest.isPending) return;
    setSubmitMessage('');
    const payload: ItsmMyRequestInput = {
      kind: draft.kind,
      title: draft.title.trim(),
      category: draft.category,
      description: draft.description.trim(),
      serviceId: draft.serviceId || null,
    };
    try {
      const result = await createRequest.mutateAsync({ data: payload });
      await queryClient.invalidateQueries({ queryKey: getGetItsmMyRequestsQueryKey() });
      setDraft(initialDraft);
      setFieldErrors({});
      setSubmitMessage(`Votre demande « ${result.request.title} » a été transmise sous la référence ${result.request.id}.`);
    } catch {
      // Mutation errors are presented below; a 403 receives a dedicated access-denied state.
    }
  }

  if (denied) {
    return <main className="page-enter mx-auto max-w-3xl">
      <section role="alert" className="panel overflow-hidden">
        <div className="border-b border-border bg-[#f5e2df]/70 px-5 py-4 dark:bg-[#4c302d]/35 md:px-7">
          <div className="eyebrow">ESPACE DEMANDEUR · ACCÈS</div>
          <h2 className="mt-2 text-xl font-semibold tracking-[-.03em]">Accès non autorisé</h2>
        </div>
        <div className="flex items-start gap-4 p-5 md:p-7">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#f5e2df] text-[#98483d] dark:bg-[#4c302d] dark:text-[#e7aaa1]"><LockKeyhole size={20} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-6">Votre compte ne dispose pas de l’autorisation nécessaire pour consulter cet espace demandeur.</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Aucune demande n’est affichée. Si cet accès vous semble incorrect, contactez le support informatique.</p>
            <Button variant="outline" className="mt-5" onClick={() => { void requestsQuery.refetch(); }}>Réessayer</Button>
          </div>
        </div>
      </section>
    </main>;
  }

  return <div className="page-enter min-w-0">
    <PageIntro
      kicker="ESPACE DEMANDEUR · ANIF GABON"
      title={user?.firstName ? `Bonjour ${user.firstName}. Comment pouvons-nous vous aider ?` : 'Comment pouvons-nous vous aider ?'}
      description="Déclarez un incident ou adressez une demande au support, puis retrouvez ici vos propres soumissions."
    />

    <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#b8d4c7]/80 bg-[#e7f0ea]/75 px-4 py-3 text-[#345d4b] dark:border-[#3d6253] dark:bg-[#18382f]/65 dark:text-[#c5e1d1]">
      <ShieldCheck size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="text-[11px] leading-relaxed"><strong className="font-semibold">Un espace personnel.</strong> La liste ci-dessous est réservée à vos soumissions. Le support qualifiera la priorité et l’affectation après réception.</p>
    </div>

    {submitMessage && <div role="status" aria-live="polite" className="mb-5 flex items-start gap-3 rounded-xl border border-[#b8d4c7] bg-[#e7f0ea] px-4 py-3 text-[#345d4b] dark:border-[#3d6253] dark:bg-[#18382f] dark:text-[#c5e1d1]">
      <Check size={16} className="mt-0.5 shrink-0" /><p className="text-xs leading-relaxed">{submitMessage}</p>
    </div>}

    {createRequest.isError && <div role="alert" className="mb-5 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-destructive">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <p className="text-xs leading-relaxed">La demande n’a pas pu être transmise. Vérifiez les informations ou réessayez dans un instant.</p>
    </div>}

    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)]">
      <section className="panel min-w-0 overflow-hidden" aria-labelledby="new-request-heading">
        <div className="flex items-start gap-3 border-b border-border/80 px-5 py-4 md:px-6">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><FilePlus2 size={17} /></span>
          <div><div className="eyebrow">NOUVELLE SOUMISSION</div><h3 id="new-request-heading" className="mt-1 text-[15px] font-semibold">Décrire votre besoin</h3></div>
        </div>
        <form onSubmit={submit} noValidate className="space-y-4 p-5 md:p-6">
          <fieldset className="min-w-0">
            <legend className="mb-2 text-[11px] font-semibold">Type de soumission</legend>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Type de soumission">
              {(['Incident', 'Demande'] as const).map(kind => <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={draft.kind === kind}
                onClick={() => updateDraft('kind', kind)}
                className={`focus-ring min-h-11 rounded-lg border px-3 text-left text-xs font-semibold ${draft.kind === kind ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}
              >
                <span className="block">{kind}</span>
                <span className="mt-0.5 block text-[10px] font-normal">{kind === 'Incident' ? 'Un service ou équipement ne fonctionne pas' : 'Un accès, équipement ou service est nécessaire'}</span>
              </button>)}
            </div>
          </fieldset>

          <Field label="Sujet">
            <input
              className={inputCls}
              data-testid="input-request-title"
              value={draft.title}
              onChange={event => updateDraft('title', event.target.value)}
              maxLength={180}
              aria-invalid={!!fieldErrors.title}
              aria-describedby={fieldErrors.title ? 'request-title-error' : 'request-title-hint'}
              placeholder="Ex. Impossible d’ouvrir l’application de paie"
            />
            <span id={fieldErrors.title ? 'request-title-error' : 'request-title-hint'} className={`mt-1 block text-[10px] ${fieldErrors.title ? 'text-destructive' : 'font-normal text-muted-foreground'}`}>
              {fieldErrors.title ?? `${draft.title.length} / 180 caractères`}
            </span>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Catégorie">
              <select className={inputCls} data-testid="select-request-category" value={draft.category} onChange={event => updateDraft('category', event.target.value as Draft['category'])}>
                {categories.map(category => <option key={category} value={category}>{category}</option>)}
              </select>
            </Field>
            <Field label="Service concerné" hint="Facultatif · choix limité au catalogue disponible">
              <select
                className={`${inputCls} ${fieldErrors.serviceId ? 'border-destructive' : ''}`}
                data-testid="select-request-service"
                value={draft.serviceId}
                onChange={event => updateDraft('serviceId', event.target.value)}
                aria-invalid={!!fieldErrors.serviceId}
                aria-describedby={fieldErrors.serviceId ? 'request-service-error' : undefined}
              >
                <option value="">Aucun service sélectionné</option>
                {services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}
              </select>
              {fieldErrors.serviceId && <span id="request-service-error" className="mt-1 block text-[10px] text-destructive">{fieldErrors.serviceId}</span>}
            </Field>
          </div>

          <Field label="Description">
            <textarea
              className={`${textareaCls} min-h-36 resize-y`}
              data-testid="textarea-request-description"
              value={draft.description}
              onChange={event => updateDraft('description', event.target.value)}
              maxLength={12000}
              rows={6}
              aria-invalid={!!fieldErrors.description}
              aria-describedby={fieldErrors.description ? 'request-description-error' : 'request-description-hint'}
              placeholder="Indiquez ce qui se passe, depuis quand et les étapes déjà essayées."
            />
            <span id={fieldErrors.description ? 'request-description-error' : 'request-description-hint'} className={`mt-1 block text-[10px] ${fieldErrors.description ? 'text-destructive' : 'font-normal text-muted-foreground'}`}>
              {fieldErrors.description ?? `${draft.description.length.toLocaleString('fr-FR')} / 12 000 caractères`}
            </span>
          </Field>

          <div className="flex flex-col-reverse gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-sm text-[10px] leading-relaxed text-muted-foreground">Les incidents vont directement au support. Les demandes de service attendent une décision N1 ou N3 du service. Ne saisissez pas d’informations personnelles sensibles.</p>
            <Button type="submit" disabled={createRequest.isPending} testId="button-submit-request" className="shrink-0">
              {createRequest.isPending ? <><RefreshCw size={14} className="animate-spin" />Transmission…</> : <><Send size={14} />Transmettre au support</>}
            </Button>
          </div>
        </form>
      </section>

      <section className="panel min-w-0 overflow-hidden" aria-labelledby="my-requests-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 px-5 py-4 md:px-6">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#e5ecee] text-[#426678] dark:bg-[#263c46] dark:text-[#b0cad3]"><Clock3 size={17} /></span>
            <div><div className="eyebrow">SUIVI PERSONNEL</div><h3 id="my-requests-heading" className="mt-1 text-[15px] font-semibold">Mes soumissions</h3></div>
          </div>
          {!requestsQuery.isLoading && requestsQuery.data && <span className="mono rounded-full bg-muted px-2.5 py-1 text-[10px] text-muted-foreground">{ownRequests.length} {ownRequests.length === 1 ? 'demande' : 'demandes'}</span>}
        </div>

        {requestsQuery.isLoading && <div role="status" aria-live="polite" className="space-y-3 p-5 md:p-6">
          <span className="sr-only">Chargement de vos soumissions</span>
          {[0, 1, 2].map(item => <div key={item} className="animate-pulse rounded-xl border border-border/80 p-4">
            <div className="flex justify-between gap-4"><div className="h-3 w-20 rounded bg-muted" /><div className="h-5 w-16 rounded-full bg-muted" /></div>
            <div className="mt-4 h-4 w-3/4 rounded bg-muted" /><div className="mt-3 h-3 w-1/2 rounded bg-muted" />
          </div>)}
        </div>}

        {requestsQuery.isError && statusOf(requestsQuery.error) !== 403 && <div className="p-5 md:p-6">
          <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-4">
            <div className="flex items-start gap-3 text-destructive"><AlertCircle size={16} className="mt-0.5 shrink-0" /><div><strong className="text-xs">Impossible de charger vos soumissions</strong><p className="mt-1 text-[11px] leading-relaxed">La liste n’est pas disponible pour le moment. Vous pouvez réessayer.</p></div></div>
            <Button variant="outline" className="mt-4" onClick={() => { void requestsQuery.refetch(); }}>Réessayer</Button>
          </div>
        </div>}

        {!requestsQuery.isLoading && !requestsQuery.isError && ownRequests.length === 0 && <div className="p-5 md:p-6">
          <EmptyState title="Aucune soumission pour le moment" text="Après l’envoi d’une demande, son état et ses informations de suivi apparaîtront ici." />
        </div>}

        {!requestsQuery.isLoading && !requestsQuery.isError && ownRequests.length > 0 && <ul className="divide-y divide-border/70">
          {ownRequests.map(request => <li key={request.id} className="px-5 py-4 transition-colors hover:bg-muted/30 md:px-6">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mono text-[10px] font-medium text-muted-foreground">{request.id}</span>
                  <Badge tone={request.kind === 'Incident' ? 'amber' : 'blue'}>{request.kind}</Badge>
                  {request.requestApproval?.status === 'pending' && <Badge tone="amber">À valider</Badge>}
                  {request.requestApproval?.status === 'approved' && <Badge tone="green">Approuvée</Badge>}
                </div>
                <h4 className="mt-2 break-words text-[13px] font-semibold leading-snug">{request.title}</h4>
              </div>
              <Badge tone={statusTone(request.status)}>{request.status}</Badge>
            </div>
            <p className="mt-2 line-clamp-2 break-words text-[11px] leading-relaxed text-muted-foreground">{request.description}</p>
            {request.requestApproval?.status === 'rejected' && request.requestApproval.reason && <p className="mt-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-[11px] leading-relaxed text-destructive"><strong>Motif du rejet :</strong> {request.requestApproval.reason}</p>}
            {request.requestApproval?.status === 'approved' && request.requestApproval.decidedAt && <p className="mt-2 text-[10px] text-muted-foreground">Décision le {formatDate(request.requestApproval.decidedAt)} · la demande rejoint la file de traitement.</p>}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              <span>{request.category}</span>
              {request.serviceName && <><span aria-hidden="true">·</span><span>{request.serviceName}</span></>}
              <span aria-hidden="true">·</span><time dateTime={request.openedAt}>{formatDate(request.openedAt)}</time>
              <span className="ml-auto inline-flex items-center gap-1 font-medium"><span>{request.priority}</span><ArrowUpRight size={11} aria-hidden="true" /></span>
            </div>
          </li>)}
        </ul>}

        <div className="border-t border-border/70 bg-muted/25 px-5 py-3 md:px-6">
          <p className="text-[10px] leading-relaxed text-muted-foreground">Le support détermine la priorité et l’équipe de prise en charge. Les mises à jour peuvent nécessiter un rafraîchissement de la liste.</p>
        </div>
      </section>
    </div>
  </div>;
}
