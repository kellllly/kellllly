import { useEffect, useMemo, useState } from 'react';
import { getHealthCheckQueryKey, useHealthCheck } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { Activity, AlertCircle, ArrowRight, BookOpen, CheckCircle2, CircleHelp, LoaderCircle, Network, ShieldCheck, TicketPlus, WifiOff } from 'lucide-react';
import { priorityFor } from '@/lib/itsm';
import {
  findDiagnosticKedbSuggestions,
  saveDiagnosticTicketHandoff,
  type DiagnosticApiProbe,
  type DiagnosticSymptomId,
} from '@/lib/diagnostic-assistant';
import type { KedbArticle, Level, Service } from '@/lib/types';
import { Badge, Button } from './kit';
import { PriorityPreview } from './ticket-parts';

const symptoms: { id: DiagnosticSymptomId; label: string; icon: typeof Network }[] = [
  { id: 'connectivity', label: 'Connexion ou réseau indisponible', icon: Network },
  { id: 'access', label: 'Accès ou authentification refusé', icon: ShieldCheck },
  { id: 'performance', label: 'Service lent ou instable', icon: Activity },
  { id: 'application', label: 'Erreur dans une application', icon: AlertCircle },
  { id: 'other', label: 'Autre symptôme technique', icon: CircleHelp },
];

const levels: { value: Level; label: string }[] = [
  { value: 1, label: 'Fort' },
  { value: 2, label: 'Moyen' },
  { value: 3, label: 'Faible' },
];

export function DiagnosticAssistant({
  services,
  articles,
  onOpenArticle,
  onLog,
}: {
  services: Service[];
  articles: KedbArticle[];
  onOpenArticle: (article: KedbArticle) => void;
  onLog: (action: string, scope: string) => void;
}) {
  const [, setLocation] = useLocation();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [symptomId, setSymptomId] = useState<DiagnosticSymptomId>('connectivity');
  const [impact, setImpact] = useState<Level>(2);
  const [urgency, setUrgency] = useState<Level>(2);
  const [hasRun, setHasRun] = useState(false);
  const [handoffError, setHandoffError] = useState('');
  const [browserOnline, setBrowserOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  );
  const health = useHealthCheck({
    query: {
      enabled: false,
      retry: false,
      queryKey: getHealthCheckQueryKey(),
    },
  });

  const service = services.find((item) => item.id === serviceId);
  const suggestions = useMemo(
    () => findDiagnosticKedbSuggestions(articles, service, symptomId),
    [articles, service, symptomId],
  );

  useEffect(() => {
    if (!services.some((item) => item.id === serviceId)) {
      setServiceId(services[0]?.id ?? '');
      setHasRun(false);
    }
  }, [serviceId, services]);

  useEffect(() => {
    const update = () => setBrowserOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const runChecks = async () => {
    setHasRun(true);
    setHandoffError('');
    setBrowserOnline(navigator.onLine);
    onLog('Contrôle d’autodiagnostic lancé', 'Assistant de support');
    await health.refetch();
  };

  const createTicket = () => {
    if (!service) return;
    const apiProbe: DiagnosticApiProbe = !hasRun
      ? 'not-run'
      : health.data?.status === 'ok' ? 'healthy'
        : health.isError ? 'unavailable' : 'not-run';
    let saved = false;
    try {
      saved = saveDiagnosticTicketHandoff(window.sessionStorage, {
        serviceId: service.id,
        symptomId,
        impact,
        urgency,
        apiProbe,
      });
    } catch {
      saved = false;
    }
    if (!saved) {
      setHandoffError('Le résumé temporaire n’a pas pu être conservé dans cet onglet. Aucun ticket n’a été créé.');
      return;
    }
    onLog(`Préparation d’un ticket guidé pour ${service.id}`, 'Assistant de support');
    setLocation(`/tickets?new=1&diagnostic=1&service=${encodeURIComponent(service.id)}`);
  };

  const apiState = health.isFetching
    ? { label: 'Contrôle en cours', tone: 'blue' }
    : !hasRun
      ? { label: 'À vérifier', tone: 'neutral' }
      : health.data?.status === 'ok'
        ? { label: 'Accessible', tone: 'green' }
        : { label: 'Indisponible', tone: 'red' };
  const priority = priorityFor(impact, urgency);

  return <section className="panel mb-5 min-w-0 p-5 md:p-6" aria-labelledby="diagnostic-assistant-title" data-testid="section-diagnostic-assistant">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="eyebrow flex items-center gap-1.5"><Activity size={12} />BOT SI · GUIDAGE INTERACTIF</div>
        <h2 id="diagnostic-assistant-title" className="serif mt-1 text-[22px]">Commencer par vérifier.</h2>
        <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">Un parcours déterministe, sans génération de texte. Il consulte l’API du pilote, le catalogue fictif et la KEDB; aucune information personnelle n’est demandée.</p>
      </div>
      <Badge tone="blue">Assistance de démonstration</Badge>
    </div>

    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,.9fr)]">
      <div className="min-w-0 space-y-4">
        <label className="block min-w-0 text-[10px] font-semibold uppercase tracking-[.1em] text-muted-foreground">
          1 · Service concerné
          <select
            data-testid="select-diagnostic-service"
            aria-label="Service concerné par le diagnostic"
            value={serviceId}
            onChange={(event) => { setServiceId(event.target.value); setHasRun(false); setHandoffError(''); }}
            disabled={!services.length}
            className="mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-3 text-[12px] font-normal normal-case tracking-normal text-foreground"
          >
            {services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            {!services.length && <option value="">Aucun service autorisé</option>}
          </select>
        </label>

        <fieldset className="min-w-0">
          <legend className="mb-2 text-[10px] font-semibold uppercase tracking-[.1em] text-muted-foreground">2 · Symptôme technique</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {symptoms.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                data-testid={`button-diagnostic-symptom-${id}`}
                aria-pressed={symptomId === id}
                onClick={() => { setSymptomId(id); setHasRun(false); setHandoffError(''); }}
                className={`focus-ring flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-left text-[11px] transition ${symptomId === id ? 'border-primary/60 bg-primary/5 text-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted/50'}`}
              >
                <Icon size={14} className="shrink-0 text-primary" /><span>{label}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ['Impact', impact, setImpact],
            ['Urgence', urgency, setUrgency],
          ] as const).map(([label, value, setValue]) => (
            <label key={label} className="block min-w-0 text-[10px] font-semibold uppercase tracking-[.1em] text-muted-foreground">
              3 · {label}
              <select
                data-testid={`select-diagnostic-${label.toLowerCase()}`}
                aria-label={`Niveau de ${label.toLowerCase()}`}
                value={value}
                onChange={(event) => { setValue(Number(event.target.value) as Level); setHasRun(false); }}
                className="mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-3 text-[12px] font-normal normal-case tracking-normal text-foreground"
              >
                {levels.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
              </select>
            </label>
          ))}
        </div>
        <PriorityPreview impact={impact} urgency={urgency} />
      </div>

      <div className="min-w-0 rounded-xl border border-border bg-muted/30 p-4">
        <div className="eyebrow">4 · Vérifications du pilote</div>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Le contrôle réseau du navigateur est indicatif. L’API est interrogée réellement; l’état du service provient du catalogue de démonstration.</p>
        <Button
          testId="button-run-diagnostic"
          className="mt-3 w-full sm:w-auto"
          disabled={!service || health.isFetching}
          onClick={() => void runChecks()}
        >
          {health.isFetching ? <LoaderCircle size={14} className="animate-spin" /> : <Activity size={14} />}
          {health.isFetching ? 'Vérification…' : 'Lancer les vérifications'}
        </Button>

        {hasRun && <div className="mt-4 space-y-2" aria-live="polite" data-testid="diagnostic-results">
          <DiagnosticResult
            testId="status-diagnostic-network"
            icon={browserOnline ? CheckCircle2 : WifiOff}
            label="Connexion du navigateur"
            value={browserOnline ? 'En ligne (indication locale)' : 'Hors ligne'}
            tone={browserOnline ? 'green' : 'amber'}
          />
          <DiagnosticResult
            testId="status-diagnostic-api"
            icon={health.isFetching ? LoaderCircle : health.data?.status === 'ok' ? CheckCircle2 : AlertCircle}
            label="API du pilote"
            value={apiState.label}
            tone={apiState.tone}
            loading={health.isFetching}
          />
          <DiagnosticResult
            testId="status-diagnostic-catalog"
            icon={service?.status === 'Opérationnel' ? CheckCircle2 : AlertCircle}
            label="État dans le catalogue fictif"
            value={service?.status ?? 'Service indisponible'}
            tone={service?.status === 'Opérationnel' ? 'green' : 'amber'}
          />
          <DiagnosticResult
            testId="status-diagnostic-nkok"
            icon={CircleHelp}
            label="Sondes Nkok et Keycloak"
            value="Non configurées · aucun test effectué"
            tone="neutral"
          />
          {health.isError && <p role="status" data-testid="text-diagnostic-api-error" className="rounded-lg border border-[#d39b90]/60 bg-[#f5e2df]/70 p-2 text-[10px] leading-relaxed text-[#7d3a31] dark:bg-[#4c302d]/60 dark:text-[#f0c1b9]">La vérification de l’API a échoué. Vous pouvez toujours préparer un ticket; son enregistrement dépendra de la reconnexion au service.</p>}
        </div>}
      </div>
    </div>

    {hasRun && <div className="mt-4 rounded-xl border border-border/80 p-4" data-testid="diagnostic-kedb-suggestions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><div className="eyebrow">KEDB · RÉSOLUTION EN LIBRE-SERVICE</div><h3 className="mt-1 text-[13px] font-semibold">Fiches à consulter</h3></div>
        <Badge tone={suggestions.length ? 'green' : 'neutral'}>{suggestions.length} suggestion(s)</Badge>
      </div>
      {suggestions.length ? <div className="mt-2 divide-y divide-border/70">
        {suggestions.map((article) => <button
          key={article.id}
          type="button"
          data-testid={`button-diagnostic-kedb-${article.id}`}
          onClick={() => { onOpenArticle(article); onLog(`Article ${article.id} proposé par l’autodiagnostic`, 'Base d’erreurs connues'); }}
          className="flex w-full min-w-0 items-center gap-3 py-3 text-left hover:bg-muted/30"
        >
          <BookOpen size={15} className="shrink-0 text-primary" />
          <span className="min-w-0 flex-1"><strong className="block truncate text-[11px]">{article.title}</strong><span className="mono text-[9px] text-muted-foreground">{article.id} · {article.ticketId}</span></span>
          <ArrowRight size={13} className="shrink-0 text-muted-foreground" />
        </button>)}
      </div> : <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">Aucune résolution correspondante dans la KEDB. Le parcours n’invente pas de procédure; vous pouvez préparer un ticket.</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
        <p className="max-w-xl text-[10px] leading-relaxed text-muted-foreground">Le résumé prérempli ne contient que les choix ci-dessus et les résultats du pilote. Vérifiez et complétez le ticket avant de l’envoyer.</p>
        <Button testId="button-diagnostic-create-ticket" disabled={!service} onClick={createTicket}><TicketPlus size={14} />Préparer un ticket <ArrowRight size={13} /></Button>
      </div>
      {handoffError && <p role="alert" data-testid="text-diagnostic-handoff-error" className="mt-3 text-[10px] text-destructive">{handoffError}</p>}
    </div>}

    <p className="mt-3 flex items-start gap-2 text-[9px] leading-relaxed text-muted-foreground"><ShieldCheck size={12} className="mt-0.5 shrink-0" />Ne saisissez aucun nom, e-mail, numéro de poste, détail d’enquête ou élément classifié. Ce parcours ne lance pas de test sur le réseau ANIF, le Data Center de Nkok ou Keycloak.</p>
  </section>;
}

function DiagnosticResult({
  testId,
  icon: Icon,
  label,
  value,
  tone,
  loading = false,
}: {
  testId: string;
  icon: typeof CheckCircle2;
  label: string;
  value: string;
  tone: string;
  loading?: boolean;
}) {
  const toneClass = tone === 'green'
    ? 'text-[#28674f] dark:text-[#b7dfc7]'
    : tone === 'red'
      ? 'text-[#98483d] dark:text-[#e7aaa1]'
      : tone === 'amber'
        ? 'text-[#805a20] dark:text-[#e5c78e]'
        : 'text-muted-foreground';
  return <div data-testid={testId} className="flex min-w-0 items-start gap-2 rounded-lg border border-border/70 bg-card px-3 py-2">
    <Icon size={13} className={`mt-0.5 shrink-0 ${toneClass} ${loading ? 'animate-spin' : ''}`} />
    <span className="min-w-0 flex-1"><span className="block text-[9px] text-muted-foreground">{label}</span><strong className={`block break-words text-[10px] font-semibold ${toneClass}`}>{value}</strong></span>
  </div>;
}
