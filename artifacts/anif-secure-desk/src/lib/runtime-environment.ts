/**
 * Execution environment attached to a ticket converted from a message (cahier
 * des charges : version du client, identifiant du poste, mémoire, latence).
 * Only technical values; no personal data.
 */
export type RuntimeEnvironment = {
  client: string;
  browser: string;
  workstationId: string;
  memory: string;
  cores: string;
  screen: string;
  online: boolean;
  latencyMs: number | null;
};

const WORKSTATION_KEY = 'anif-workstation-id';

export function workstationId(storage: Pick<Storage, 'getItem' | 'setItem'> | null): string {
  try {
    const existing = storage?.getItem(WORKSTATION_KEY);
    if (existing) return existing;
    const created = `POSTE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    storage?.setItem(WORKSTATION_KEY, created);
    return created;
  } catch {
    return 'POSTE-INCONNU';
  }
}

export function browserLabel(userAgent: string): string {
  const browser = /Edg\/(\d+)/.exec(userAgent) ? `Edge ${/Edg\/(\d+)/.exec(userAgent)![1]}`
    : /Firefox\/(\d+)/.exec(userAgent) ? `Firefox ${/Firefox\/(\d+)/.exec(userAgent)![1]}`
      : /Chrome\/(\d+)/.exec(userAgent) ? `Chrome ${/Chrome\/(\d+)/.exec(userAgent)![1]}`
        : /Version\/(\d+).*Safari/.exec(userAgent) ? `Safari ${/Version\/(\d+)/.exec(userAgent)![1]}` : 'Navigateur inconnu';
  const os = /Windows/.test(userAgent) ? 'Windows' : /Android/.test(userAgent) ? 'Android'
    : /iPhone|iPad/.test(userAgent) ? 'iOS' : /Mac OS X/.test(userAgent) ? 'macOS' : /Linux/.test(userAgent) ? 'Linux' : 'Système inconnu';
  return `${browser} · ${os}`;
}

export function formatEnvironment(env: RuntimeEnvironment): string {
  return [
    'Environnement d’exécution (relevé automatiquement) :',
    `- Client : ${env.client}`,
    `- Navigateur : ${env.browser}`,
    `- Poste : ${env.workstationId}`,
    `- Mémoire de l’appareil : ${env.memory} · Processeurs : ${env.cores}`,
    `- Écran : ${env.screen}`,
    `- Réseau : ${env.online ? 'en ligne' : 'hors ligne'} · latence API ${env.latencyMs === null ? 'non mesurée' : `${env.latencyMs} ms`}`,
  ].join('\n');
}

export async function captureEnvironment(measure: () => Promise<unknown>): Promise<RuntimeEnvironment> {
  let latencyMs: number | null = null;
  try {
    const start = performance.now();
    await measure();
    latencyMs = Math.round(performance.now() - start);
  } catch { /* unreachable server: reported as not measured */ }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    client: `ANIF Secure Desk (${import.meta.env.MODE})`,
    browser: browserLabel(nav.userAgent),
    workstationId: workstationId(typeof localStorage === 'undefined' ? null : localStorage),
    memory: nav.deviceMemory ? `${nav.deviceMemory} Go` : 'non communiquée',
    cores: nav.hardwareConcurrency ? String(nav.hardwareConcurrency) : 'non communiqué',
    screen: typeof screen === 'undefined' ? 'inconnu' : `${screen.width}×${screen.height}`,
    online: nav.onLine,
    latencyMs,
  };
}
