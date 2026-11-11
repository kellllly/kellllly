// Ctrl+N and Ctrl+T (§ 8.3) belong to the browser and cannot be taken over: Alt+Maj is used instead.
export const SHORTCUTS = [
  { keys: 'Ctrl + K', label: 'Aller au champ de recherche de la page' },
  { keys: 'Alt + Maj + T', label: 'Créer un ticket' },
  { keys: 'Alt + Maj + M', label: 'Ouvrir la messagerie' },
  { keys: 'Alt + Maj + D', label: 'Revenir au tableau de bord' },
] as const;

type Key = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'preventDefault'>;

/** Runs the shortcut matching a keydown; returns whether one ran. N5 auditors cannot create tickets. */
export function runShortcut(e: Key, roleCode: string, navigate: (href: string) => void, focusSearch: () => boolean): boolean {
  // Option on macOS changes `key`, so fall back to the physical key.
  const letter = /^[a-z]$/iu.test(e.key) ? e.key.toLowerCase() : e.code.replace(/^Key/u, '').toLowerCase();
  let done = false;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && letter === 'k') done = focusSearch();
  else if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
    const href = letter === 't' && roleCode !== 'N5' ? '/tickets?new=1' : letter === 'm' ? '/messages' : letter === 'd' ? '/' : null;
    if (href) { navigate(href); done = true; }
  }
  if (done) e.preventDefault();
  return done;
}
