import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUser, ClerkProvider, Show, SignIn, SignUp } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { frFR } from '@clerk/localizations';
import { shadcn } from '@clerk/themes';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Link, Redirect, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { clearSyncRecoveryDraft, StoreProvider } from '@/lib/store';
import { missingLocalClerkKey } from '@/lib/clerk-config';
import { Shell } from '@/components/shell';
// Each page is its own chunk: the first load only fetches the shell and the
// page being opened; the others download when the user navigates to them.
const Dashboard = lazy(() => import('@/pages/dashboard'));
const MessagesPage = lazy(() => import('@/pages/messages'));
const TicketsPage = lazy(() => import('@/pages/tickets'));
const ServicesPage = lazy(() => import('@/pages/services'));
const AssetsPage = lazy(() => import('@/pages/assets'));
const AuditPage = lazy(() => import('@/pages/audit'));
const GovernancePage = lazy(() => import('@/pages/governance'));
const SettingsPage = lazy(() => import('@/pages/settings'));

function PageLoading() {
  return <div role="status" aria-live="polite" className="grid min-h-64 place-items-center text-sm text-muted-foreground">Chargement de la page…</div>;
}

const clerkKeyMissing = missingLocalClerkKey(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkPubKey = clerkKeyMissing ? '' : publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#58d8b2',
    colorForeground: '#e5f0ef',
    colorMutedForeground: '#9aafb0',
    colorDanger: '#e47d75',
    colorBackground: '#101923',
    colorInput: '#182630',
    colorInputForeground: '#e5f0ef',
    colorNeutral: '#3a4d57',
    fontFamily: '"DM Sans", sans-serif',
    borderRadius: '0.85rem',
  },
  elements: {
    rootBox: 'w-full min-w-0 flex justify-center',
    cardBox: 'bg-card rounded-2xl w-full max-w-[440px] min-w-0 overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none max-[239px]:!px-2',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-foreground font-semibold',
    headerSubtitle: 'text-muted-foreground',
    socialButtonsBlockButtonText: 'text-foreground font-medium',
    formFieldLabel: 'text-foreground font-medium',
    footerActionLink: 'text-primary font-semibold',
    footerActionText: 'text-muted-foreground',
    dividerText: 'text-muted-foreground',
    formButtonPrimary: 'bg-primary text-primary-foreground hover:brightness-95',
    formFieldInput: 'text-foreground border-border',
    alertText: 'text-destructive',
  },
};

function LandingPage() {
  return <main className="auth-stage dark grid min-h-[100dvh] place-items-center px-5 py-12 text-foreground">
    <section className="auth-card w-full max-w-3xl rounded-[24px] border border-border bg-card p-7 shadow-xl md:p-12">
      <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck size={22} /></span><div><div className="text-sm font-bold tracking-[.08em]">ANIF GABON</div><div className="eyebrow mt-1">POSTE DE PILOTAGE · ITSM</div></div></div>
      <p className="eyebrow mt-10">ESPACE DE DÉMONSTRATION PARTAGÉ</p>
      <h1 className="serif mt-3 max-w-2xl text-4xl leading-tight md:text-5xl">Un suivi commun des demandes informatiques.</h1>
      <p className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground">Connectez-vous pour consulter les tickets fictifs partagés, qualifier les incidents, suivre leur prise en charge et documenter leur résolution.</p>
      <div className="mt-8 flex flex-wrap gap-3"><Link href="/sign-in" className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:brightness-95">Se connecter <ArrowRight size={15} /></Link><Link href="/sign-up" className="inline-flex items-center rounded-lg border border-border px-5 py-3 text-sm font-semibold text-primary hover:bg-muted">Créer un compte</Link></div>
      <div className="mt-9 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-900 dark:text-amber-100"><strong>Pilote non homologué.</strong> Données fictives uniquement. Ne saisissez aucune donnée réelle, personnelle ou classifiée. Messagerie simulée; aucune promesse de chiffrement de bout en bout, d’immuabilité, de conformité ou d’hébergement souverain.</div>
    </section>
  </main>;
}

function HomeRedirect() {
  return <>
    <Show when="signed-in"><Redirect to="/user-portal" /></Show>
    <Show when="signed-out"><LandingPage /></Show>
  </>;
}

function SignInPage() {
  return <div className="auth-stage dark grid min-h-[100dvh] w-full min-w-0 place-items-center px-0 py-8 min-[240px]:px-4">
    <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
  </div>;
}

function SignUpPage() {
  return <div className="auth-stage dark grid min-h-[100dvh] w-full min-w-0 place-items-center px-0 py-8 min-[240px]:px-4">
    <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
  </div>;
}

function NotFoundPage() {
  return <div className="panel grid min-h-64 place-items-center text-center"><div><div className="serif text-3xl">Page introuvable</div><p className="mt-2 text-sm text-muted-foreground">Cette destination n’existe pas dans le prototype.</p><Link href="/" className="mt-4 inline-flex text-sm font-semibold text-primary">Retour à l’accueil</Link></div></div>;
}

function AuthenticatedDesk() {
  const { user, isLoaded } = useUser();
  const queryClient = useMemo(() => new QueryClient(), [user?.id]);
  useEffect(() => () => queryClient.clear(), [queryClient]);
  if (!isLoaded || !user) return <main className="grid min-h-[100dvh] place-items-center text-sm text-muted-foreground">Chargement du compte…</main>;
  return <QueryClientProvider client={queryClient}><StoreProvider key={user.id} userId={user.id}>
    <Shell>
      <Suspense fallback={<PageLoading />}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/user-portal" component={Dashboard} />
        <Route path="/messages" component={MessagesPage} />
        <Route path="/tickets" component={TicketsPage} />
        <Route path="/services" component={ServicesPage} />
        <Route path="/assets" component={AssetsPage} />
        <Route path="/audit" component={AuditPage} />
        <Route path="/governance" component={GovernancePage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFoundPage} />
      </Switch>
      </Suspense>
    </Shell>
  </StoreProvider></QueryClientProvider>;
}

function RecoverySessionCleanup() {
  const { user, isLoaded } = useUser();
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (user?.id) {
      if (previousUserId.current && previousUserId.current !== user.id) {
        clearSyncRecoveryDraft(previousUserId.current);
      }
      previousUserId.current = user.id;
      return;
    }
    if (previousUserId.current) {
      clearSyncRecoveryDraft(previousUserId.current);
      previousUserId.current = null;
    }
  }, [isLoaded, user?.id]);

  return null;
}

function UserPortal() {
  return <>
    <Show when="signed-in"><AuthenticatedDesk /></Show>
    <Show when="signed-out"><Redirect to="/" /></Show>
  </>;
}

function ClerkRouter() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{
      ...frFR,
      signIn: {
        ...frFR.signIn,
        start: { ...frFR.signIn?.start, title: 'Bienvenue', subtitle: 'Connectez-vous à votre espace de pilotage' },
      },
      signUp: {
        ...frFR.signUp,
        start: { ...frFR.signUp?.start, title: 'Créer un compte', subtitle: 'Accédez au pilote ITSM fictif' },
      },
    }}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  >
    <RecoverySessionCleanup />
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/user-portal" component={UserPortal} />
      <Route path="/messages" component={UserPortal} />
      <Route path="/tickets" component={UserPortal} />
      <Route path="/services" component={UserPortal} />
      <Route path="/assets" component={UserPortal} />
      <Route path="/audit" component={UserPortal} />
      <Route path="/governance" component={UserPortal} />
      <Route path="/settings" component={UserPortal} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route component={HomeRedirect} />
    </Switch>
  </ClerkProvider>;
}

function AuthSetupPage() {
  return <main className="auth-stage dark grid min-h-[100dvh] place-items-center px-5 py-12 text-foreground">
    <section role="alert" className="auth-card w-full max-w-2xl rounded-[24px] border border-border bg-card p-7 shadow-xl md:p-10">
      <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck size={22} /></span><div><div className="text-sm font-bold tracking-[.08em]">ANIF GABON</div><div className="eyebrow mt-1">CONFIGURATION LOCALE</div></div></div>
      <h1 className="serif mt-8 text-3xl leading-tight">Authentification non configurée</h1>
      <p className="mt-4 text-sm leading-7 text-muted-foreground">Ce poste local n’a pas de clé Clerk. Créez une instance de développement sur dashboard.clerk.com, puis renseignez dans le fichier <code>.env</code> :</p>
      <ul className="mt-3 list-disc space-y-1 pl-5 font-mono text-xs text-foreground"><li>VITE_CLERK_PUBLISHABLE_KEY et CLERK_PUBLISHABLE_KEY (pk_test_…)</li><li>CLERK_SECRET_KEY (sk_test_…), côté API uniquement</li></ul>
      <p className="mt-4 text-sm leading-7 text-muted-foreground">Redémarrez ensuite le serveur de développement. Voir <code>DEVELOPPEMENT.md</code>.</p>
    </section>
  </main>;
}

function App() {
  if (clerkKeyMissing) return <AuthSetupPage />;
  return <WouterRouter base={basePath}><ClerkRouter /></WouterRouter>;
}

export default App;
