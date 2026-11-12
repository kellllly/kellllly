import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Watermark } from '@/components/watermark';
import { Link, useLocation } from 'wouter';
import { Activity, AlertTriangle, Bell, BellOff, Check, ClipboardList, Cpu, Landmark, LayoutDashboard, LifeBuoy, LockKeyhole, LogOut, Menu, MessageSquare, Settings, ShieldCheck, WifiOff, X } from 'lucide-react';
import { useClerk } from '@clerk/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useNow, useStore } from '@/lib/store';
import { useDisplayName } from '@/hooks/use-display-name';
import { usePeople } from '@/hooks/use-people';
import { deriveNotifications, unreadOf } from '@/lib/domain';
import { formatWAT } from '@/lib/itsm';
import { SyncRecoveryActions } from './sync-recovery-actions';
import { offlineMessage } from '@/lib/offline';
import { runShortcut } from '@/lib/shortcuts';
import { isQuietTime, useQuietHours } from '@/lib/quiet-hours';


const navItems = [
  { href: '/', label: 'Vue générale', icon: LayoutDashboard },
  { href: '/messages', label: 'Messagerie', icon: MessageSquare },
  { href: '/tickets', label: 'Tickets IT', icon: ClipboardList },
  { href: '/services', label: 'Services & aide', icon: LifeBuoy },
  { href: '/assets', label: 'Parc matériel', icon: Cpu },
  { href: '/audit', label: 'Journal d’activité', icon: Activity },
  { href: '/governance', label: 'Gouvernance', icon: Landmark },
];
const meta: Record<string, { title: string; sub: string }> = {
  '/': { title: 'Vue générale', sub: 'État des opérations et continuité des services' },
  '/user-portal': { title: 'Vue générale', sub: 'État des opérations et continuité des services' },
  '/messages': { title: 'Messagerie', sub: 'Échanges professionnels de démonstration' },
  '/tickets': { title: 'Tickets IT', sub: 'Incidents, demandes, problèmes et changements' },
  '/services': { title: 'Services & aide', sub: 'Catalogue, disponibilité et base d’erreurs connues' },
  '/assets': { title: 'Parc matériel', sub: 'Inventaire fictif des équipements' },
  '/audit': { title: 'Journal d’activité', sub: 'Historique fictif partagé, non probant' },
  '/governance': { title: 'Gouvernance', sub: 'Rôles N1 à N5 et référentiel de mise en production' },
  '/settings': { title: 'Préférences', sub: 'Profil de démonstration et apparence' },
};
const initials = (n: string) => n.split(' ').filter(Boolean).map(x => x[0]).join('').slice(0, 3);

export function Shell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { store, storageIssue, dismissIssue, unreadableRecoveryDraftCount, recovery, writesSuspended, resync, offlineSince } = useStore();
  const { name: displayName } = useDisplayName();
  const { signOut } = useClerk();
  const [mobileNav, setMobileNav] = useState(false);
  const now = useNow(15_000);
  const page = meta[location] || { title: 'Page introuvable', sub: 'Destination inconnue' };
  const isDashboard = location === '/' || location === '/user-portal';
  const unread = useMemo(() => store.conversations.reduce((n, c) => n + unreadOf(c), 0), [store.conversations]);
  const roleCode = store.profile.clearance.slice(0, 2);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => runShortcut(e, roleCode, setLocation, () => {
      const box = document.querySelector<HTMLInputElement>('main input[type="search"]');
      box?.focus();
      box?.select();
      return !!box;
    });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [roleCode, setLocation]);
  return <div className={`app-shell flex min-h-[100dvh] ${isDashboard ? 'anif-dashboard-shell' : ''}`}><Watermark name={displayName} />
    <aside className={`sidebar fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col overflow-y-auto px-4 py-5 transition-transform lg:sticky lg:top-0 lg:h-[100dvh] lg:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="mb-8 flex items-center gap-3 px-2">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#4e9d83] text-[#102c28]"><ShieldCheck size={21} strokeWidth={2.2} /></div>
        <div><div className="text-[13px] font-bold tracking-[.08em]">ANIF <span className="font-medium text-[#a9c9bc]">GABON</span></div><div className="mt-0.5 text-[10px] tracking-[.15em] text-[#aab9c2]">POSTE DE PILOTAGE</div></div>
      </div>
      <div className="eyebrow px-3 pb-2 text-[#9aabb6]">Espace de travail</div>
      <nav className="space-y-1">
        {navItems.filter(({ href }) => roleCode === 'N5'
          ? ['/', '/messages', '/services', '/audit', '/governance'].includes(href)
          : true
        ).map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileNav(false)} className={`nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] ${location === href ? 'bg-[#2b4d4d] font-semibold text-[#eff8f2]' : 'text-[#c3cdd0] hover:bg-[#243e43] hover:text-white'}`} data-testid={`link-nav-${href === '/' ? 'home' : href.slice(1)}`}><Icon size={17} /><span>{label}</span>{href === '/messages' && unread > 0 && <span data-testid="badge-unread-nav" className="ml-auto rounded-full bg-[#d5a45d] px-1.5 py-0.5 text-[10px] font-semibold text-[#24313b]">{unread}</span>}</Link>)}
      </nav>
      <div className="eyebrow mb-2 mt-8 px-3 text-[#9aabb6]">Configuration</div>
      <Link href="/settings" data-testid="link-nav-settings" onClick={() => setMobileNav(false)} className={`nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] ${location === '/settings' ? 'bg-[#2b4d4d] text-white' : 'text-[#c3cdd0] hover:bg-[#243e43]'}`}><Settings size={17} />Préférences</Link>
      <div className="mt-auto rounded-xl border border-[#3b5659] bg-[#1d383d] p-3.5">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-[#d2e6db]"><LockKeyhole size={14} />Espace ITSM partagé</div>
        <p className="mt-2 text-[11px] leading-relaxed text-[#a9bdbe]">Données fictives du pilote, visibles aux comptes authentifiés. Prototype non homologué.</p>
        <div className="mt-3 flex items-center gap-2 border-t border-[#3b5659] pt-3"><div className="grid h-8 w-8 place-items-center rounded-full bg-[#d8c6a1] text-[11px] font-bold text-[#24313b]">{initials(displayName)}</div><div className="min-w-0"><div className="truncate text-xs font-semibold">{displayName}</div><div className="text-[10px] text-[#adc1c1]">{store.profile.role} · {store.profile.clearance}</div></div></div>
      </div>
    </aside>
    {mobileNav && <button aria-label="Fermer la navigation" onClick={() => setMobileNav(false)} className="fixed inset-0 z-30 bg-black/30 lg:hidden" />}
    <main className="min-w-0 flex-1">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 px-4 backdrop-blur md:px-8">
        <div className="flex h-[70px] items-center gap-3">
          <button onClick={() => setMobileNav(v => !v)} className="focus-ring rounded-lg p-2 lg:hidden" aria-label="Ouvrir le menu" data-testid="button-mobile-nav"><Menu size={19} /></button>
          <div className="min-w-0 flex-1"><div className="eyebrow hidden sm:block">ANIF / GABON <span className="mx-1">·</span> DÉMONSTRATEUR NON HOMOLOGUÉ</div><h1 className="mt-0.5 truncate text-[18px] font-semibold tracking-[-.02em]">Poste de pilotage</h1></div>
          <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground md:flex"><span className="h-2 w-2 rounded-full bg-[#4f9d80]" /><span>Environnement simulé</span></div>
          <NotificationBell />
          <Link href="/settings" className="grid h-9 w-9 place-items-center rounded-full bg-[#d7c7a6] text-[11px] font-bold text-[#24313b]" aria-label="Profil" data-testid="link-profile">{initials(displayName)}</Link>
          <button onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL })} aria-label="Se déconnecter" title="Se déconnecter" className="focus-ring grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"><LogOut size={15} /></button>
        </div>
      </header>
      {unreadableRecoveryDraftCount > 0 && <div role="alert" data-testid="alert-recovery-draft-unreadable" className="flex items-start gap-3 border-b border-[#d39b90] bg-[#f5e2df] px-4 py-3 text-[11px] leading-relaxed text-[#7d3a31] dark:bg-[#4c302d] dark:text-[#f0c1b9] md:px-8">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
        <p><strong>Reprise locale illisible :</strong> {unreadableRecoveryDraftCount === 1 ? 'Un brouillon ne peut pas être relu' : `${unreadableRecoveryDraftCount} brouillons ne peuvent pas être relus`} (JSON ou structure invalide). Le contenu brut est conservé dans ce navigateur et n’a pas été chargé. Évitez de réinitialiser le stockage local avant sa récupération.</p>
      </div>}
      {offlineSince && <div role="status" data-testid="banner-offline" className="flex items-start gap-3 border-b border-[#d8b875]/70 bg-[#f4ecd9] px-4 py-3 text-[11px] leading-relaxed text-[#654e27] dark:bg-[#413720] dark:text-[#ebd8aa] md:px-8"><WifiOff size={15} className="mt-0.5 shrink-0" /><p>{offlineMessage(offlineSince, now)}</p></div>}
      {storageIssue && <div role="alert" data-testid="alert-storage" className="flex items-start gap-3 border-b border-[#d39b90] bg-[#f5e2df] px-4 py-3 text-[11px] leading-relaxed text-[#7d3a31] dark:bg-[#4c302d] dark:text-[#f0c1b9] md:px-8">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
        <div className="flex-1">
          <strong>Synchronisation :</strong> {storageIssue.message}
          {recovery && <div className="mt-3 space-y-2">
            <p><strong>Modification conservée :</strong> {recovery.changed.join(' ; ') || 'Espace partagé'}.</p>
            <p><strong>Version distante affichée :</strong> {recovery.remoteVersion}.</p>
            {recovery.localEdits.length > 0 && <details className="rounded-lg border border-[#d39b90]/70 bg-white/40 p-2 dark:bg-black/10">
              <summary className="cursor-pointer font-semibold">Voir ou copier ma modification conservée</summary>
              <div className="mt-2 space-y-2">
                {recovery.localEdits.map((edit, index) => <div key={`${edit.path}-${index}`}>
                  <div className="font-semibold">{edit.path}</div>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-white/60 p-2 text-[10px] dark:bg-black/15">{edit.value}</pre>
                </div>)}
              </div>
            </details>}
            <SyncRecoveryActions key={`${recovery.draftId}-${recovery.remoteVersion}`} />
          </div>}
          {!recovery && writesSuspended && <div className="mt-2"><button data-testid="button-resync" onClick={resync} className="focus-ring rounded-lg border border-[#9e655d] bg-white/70 px-3 py-1.5 font-semibold dark:bg-black/10">Resynchroniser</button></div>}
        </div>
        {!recovery && <button onClick={dismissIssue} aria-label="Masquer l’alerte de synchronisation" className="focus-ring rounded p-1 hover:bg-black/5"><X size={14} /></button>}
      </div>}
      <div className="px-4 pb-10 pt-5 md:px-8 md:pt-7">
        <div className="mb-6 flex items-start justify-between gap-3"><div className="eyebrow">{page.sub}</div><div className="hidden items-center gap-2 text-[11px] text-muted-foreground sm:flex"><span className="mono">LIBREVILLE</span><span className="h-1 w-1 rounded-full bg-[#bc965f]" /><span>Fuseau WAT</span></div></div>
        {children}
      </div>
    </main>
  </div>;
}

function NotificationBell() {
  const { store, setStore, log } = useStore();
  const now = useNow(15_000);
  const [open, setOpen] = useState(false);
  const { name: displayName } = useDisplayName();
  const { person } = usePeople();
  const items = useMemo(() => deriveNotifications(store, now, [store.profile.name, displayName], person), [store, now, displayName, person]);
  const quiet = useQuietHours();
  const quietNow = isQuietTime(quiet, now);
  // During quiet hours only SLA breaches (red) are counted; the others stay listed.
  const unread = items.filter(n => !n.read && (!quietNow || n.tone === 'red')).length;
  const markRead = (ids: string[]) => setStore(s => ({ ...s, notifRead: Array.from(new Set([...s.notifRead, ...ids])) }));
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button className="focus-ring relative grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground" aria-label={`Notifications (${unread} non lues)`} data-testid="button-notifications"><Bell size={16} />{unread > 0 && <span data-testid="badge-notifications" className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#c88e43] px-1 text-[9px] font-bold text-[#24313b]">{unread}</span>}</button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-[340px] max-w-[calc(100vw-1.5rem)] rounded-[14px] border-border bg-card p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3"><div><div className="eyebrow">NOTIFICATIONS DU PILOTE</div><div className="mt-0.5 text-[13px] font-semibold">{unread} à consulter</div></div>{unread > 0 && <button data-testid="button-notifications-read-all" onClick={() => { markRead(items.map(n => n.id)); log('Notifications marquées comme lues', 'Notifications'); }} className="focus-ring rounded-lg px-2 py-1 text-[10px] font-semibold text-primary hover:bg-muted">Tout marquer lu</button>}</div>
      {quietNow && <div data-testid="notifications-quiet" className="border-b border-border bg-muted/50 px-4 py-2 text-[10px] text-muted-foreground">Heures silencieuses jusqu’à {quiet.end} : seuls les délais dépassés sont comptés.</div>}
      <div className="max-h-[360px] overflow-y-auto">
        {items.length === 0 && <div className="grid place-items-center px-6 py-10 text-center"><BellOff size={18} className="text-muted-foreground" /><div className="mt-2 text-[12px] font-semibold">Aucune notification</div><div className="mt-1 text-[11px] text-muted-foreground">Les seuils SLA, escalades et mentions apparaîtront ici.</div></div>}
        {items.map(n => <div key={n.id} className={`flex gap-3 border-b border-border/60 px-4 py-3 ${n.read ? 'opacity-60' : ''}`}>
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.tone === 'red' ? 'bg-[#c0574a]' : n.tone === 'amber' ? 'bg-[#c88e43]' : 'bg-[#537b8d]'}`} />
          <div className="min-w-0 flex-1">
            <Link href={n.href ?? `/tickets?ticket=${encodeURIComponent(n.ticketId)}`} onClick={() => { markRead([n.id]); setOpen(false); }} data-testid={`link-notification-${n.id}`} className="block text-[12px] font-semibold hover:underline">{n.title}</Link>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{n.body}</div>
            <div className="mono mt-1 text-[9px] text-muted-foreground">{formatWAT(n.at, 'datetime')}</div>
          </div>
          {!n.read && <button onClick={() => markRead([n.id])} aria-label="Marquer comme lue" data-testid={`button-notification-read-${n.id}`} className="focus-ring h-7 w-7 shrink-0 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><Check size={13} className="mx-auto" /></button>}
        </div>)}
      </div>
      <div className="px-4 py-2.5 text-[10px] leading-relaxed text-muted-foreground">Calculées à partir des tickets fictifs partagés. Aucun envoi externe.</div>
    </PopoverContent>
  </Popover>;
}
