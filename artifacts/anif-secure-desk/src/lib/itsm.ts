import type { AuditEvent } from './types';

/**
 * Demonstration rules derived from the ANIF specification, pages 8–10.
 * Timers count continuous elapsed time. They are not a contractual
 * business-hours calendar, monitoring service, or security guarantee.
 */
export type Priority = 'P1' | 'P2' | 'P3' | 'P4';
export type Level = 1 | 2 | 3;

type SlaPolicy = {
  label: string;
  acknowledgeMinutes: number;
  resolveMinutes: number;
  escalation: string;
};

export const SLA_POLICIES: Readonly<Record<Priority, SlaPolicy>> = {
  P1: { label: 'Critique', acknowledgeMinutes: 15, resolveMinutes: 120, escalation: 'DSI, RSSI et Direction — cellule de crise' },
  P2: { label: 'Majeure', acknowledgeMinutes: 30, resolveMinutes: 240, escalation: 'Superviseur L2 — ingénieur senior après 45 minutes sans prise en charge' },
  P3: { label: 'Normale', acknowledgeMinutes: 120, resolveMinutes: 480, escalation: 'Coordinateur L1 après 4 heures sans intervention' },
  P4: { label: 'Mineure / Demande', acknowledgeMinutes: 240, resolveMinutes: 2880, escalation: 'Suivi de la file standard et relance du demandeur' },
};

/** 1 = fort, 2 = moyen, 3 = faible. Explicit demo matrix, not an ITIL mandate. */
export function priorityFor(impact: Level, urgency: Level): Priority {
  if (![1, 2, 3].includes(impact) || ![1, 2, 3].includes(urgency)) {
    throw new RangeError('Impact et urgence doivent être compris entre 1 et 3.');
  }
  const matrix: Priority[][] = [
    ['P1', 'P2', 'P3'],
    ['P2', 'P3', 'P3'],
    ['P3', 'P3', 'P4'],
  ];
  return matrix[impact - 1]![urgency - 1]!;
}

function timestamp(value: string | number | Date): number {
  const milliseconds = value instanceof Date ? value.getTime()
    : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new RangeError('Horodatage invalide.');
  return milliseconds;
}

/** Always recalculate from original opening, never from the priority-change time. */
export function getDeadlines(openedAt: string, priority: Priority) {
  const opened = timestamp(openedAt);
  const policy = SLA_POLICIES[priority];
  if (!policy) throw new RangeError('Priorité inconnue.');
  return {
    acknowledgeBy: new Date(opened + policy.acknowledgeMinutes * 60_000).toISOString(),
    resolveBy: new Date(opened + policy.resolveMinutes * 60_000).toISOString(),
  };
}

export type SlaProgress = {
  state: 'ok' | 'warning' | 'breach' | 'met';
  fraction: number;
  remainingMs: number;
};

/** Warning at 80%; paused/waiting tickets do not pause this continuous demo clock. */
export function slaProgress(
  openedAt: string,
  deadline: string,
  completedAt?: string | null,
  now = Date.now(),
): SlaProgress {
  const opened = timestamp(openedAt);
  const end = timestamp(deadline);
  if (end <= opened) throw new RangeError('L’échéance doit suivre l’ouverture.');
  const evaluatedAt = completedAt ? timestamp(completedAt) : timestamp(now);
  if (completedAt && evaluatedAt < opened) {
    throw new RangeError('La prise en charge ne peut pas précéder l’ouverture.');
  }
  const fraction = Math.min(1, Math.max(0, (evaluatedAt - opened) / (end - opened)));
  const remainingMs = end - evaluatedAt;
  const state = completedAt
    ? (remainingMs > 0 ? 'met' : 'breach')
    : remainingMs <= 0 ? 'breach' : fraction >= 0.8 ? 'warning' : 'ok';
  return { state, fraction, remainingMs };
}

export function formatWAT(
  date: string | number | Date,
  mode: 'date' | 'time' | 'datetime' = 'datetime',
): string {
  try {
    const options: Intl.DateTimeFormatOptions = { timeZone: 'Africa/Libreville' };
    if (mode !== 'time') options.dateStyle = 'medium';
    if (mode !== 'date') options.timeStyle = 'short';
    return new Intl.DateTimeFormat('fr-FR', options).format(timestamp(date));
  } catch {
    return 'Date invalide';
  }
}

const watDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Libreville',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Return a stable, filename-safe export name using the Libreville calendar date. */
export function getAuditExportFilename(now: Date = new Date()): string {
  const parts = watDateFormatter.formatToParts(timestamp(now));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  return `journal-anif-${part('year')}-${part('month')}-${part('day')}.csv`;
}

/** Build an inclusive range ending today on the Libreville calendar. */
export function getRecentAuditDateRange(days: number, now: Date = new Date()): { from: string; to: string } {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError('La période doit contenir au moins un jour.');
  }
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError('La date de référence est invalide.');
  }

  const parts = watDateFormatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  const to = `${part('year')}-${part('month')}-${part('day')}`;
  const firstDay = new Date(`${to}T00:00:00.000Z`);
  firstDay.setUTCDate(firstDay.getUTCDate() - days + 1);

  return { from: firstDay.toISOString().slice(0, 10), to };
}

/** Return the inclusive WAT range for one calendar day before today (0 = today). */
export function getAuditCalendarDayRange(dayOffset: number, now: Date = new Date()): { from: string; to: string } {
  if (!Number.isInteger(dayOffset) || dayOffset < 0) {
    throw new RangeError('Le décalage de jour doit être un entier positif ou nul.');
  }
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError('La date de référence est invalide.');
  }

  const parts = watDateFormatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  const date = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - dayOffset);
  const calendarDay = date.toISOString().slice(0, 10);
  return { from: calendarDay, to: calendarDay };
}

export type AuditFilters = {
  scope: string;
  query: string;
  from: string;
  to: string;
};

export type AuditFilterResult = {
  events: AuditEvent[];
  filterError: string;
};

/** Return the journal's renderable state without exposing partial matches on invalid filters. */
export function getAuditFilterResult(
  events: readonly AuditEvent[],
  filters: AuditFilters,
  label?: (text: string | undefined) => string,
): AuditFilterResult {
  try {
    return { events: filterAuditEvents(events, filters, label), filterError: '' };
  } catch (error) {
    return {
      events: [],
      filterError: error instanceof Error ? error.message : 'Les dates du filtre sont invalides.',
    };
  }
}

export const AUDIT_EMPTY_STATE_MESSAGE = 'Aucun événement ne correspond à ces filtres.';

export function hasAuditExportSelection(events: readonly AuditEvent[]): boolean {
  return events.length > 0;
}

const DEFAULT_AUDIT_EXPORT_TIMEOUT_MS = 30_000;
const AUDIT_EXPORT_TIMEOUT_MESSAGE = 'Le serveur ne répond pas. Réessayez.';
const AUDIT_EXPORT_CANCELLED_MESSAGE = 'Export annulé.';

export function createAuditExportRunner(timeoutMs = DEFAULT_AUDIT_EXPORT_TIMEOUT_MS) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('Le délai maximal de l’export doit être positif.');
  }
  let inProgress = false;
  let activeController: AbortController | null = null;

  return {
    get isRunning(): boolean {
      return inProgress;
    },
    cancel(): void {
      activeController?.abort(new Error(AUDIT_EXPORT_CANCELLED_MESSAGE));
    },
    run<T>(
      events: readonly AuditEvent[],
      exportSelection: (signal: AbortSignal) => T | Promise<T>,
      onStateChange?: (isRunning: boolean, error?: string) => void,
    ): Promise<T> | undefined {
      if (inProgress || !hasAuditExportSelection(events)) return undefined;
      inProgress = true;
      const controller = new AbortController();
      activeController = controller;
      return (async () => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          onStateChange?.(true, '');
          const cancelled = new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => {
              const reason = controller.signal.reason;
              reject(reason instanceof Error ? reason : new Error(AUDIT_EXPORT_CANCELLED_MESSAGE));
            }, { once: true });
          });
          timeout = setTimeout(() => {
            controller.abort(new Error(AUDIT_EXPORT_TIMEOUT_MESSAGE));
          }, timeoutMs);
          const request = Promise.resolve(exportSelection(controller.signal));
          return await Promise.race([request, cancelled]);
        } catch (error) {
          onStateChange?.(true, getAuditExportErrorMessage(error));
          throw error;
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
          if (activeController === controller) activeController = null;
          inProgress = false;
          onStateChange?.(false);
        }
      })();
    },
  };
}

export function getAuditExportErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Échec de l’export.';
}

export async function readAuditCsvResponse(
  response: Pick<Response, 'ok' | 'json' | 'blob'>,
): Promise<Blob> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? 'Export refusé par le serveur.');
  }
  return response.blob();
}

export function runAuditExport<T>(
  events: readonly AuditEvent[],
  exportSelection: () => T,
): T | undefined {
  if (!hasAuditExportSelection(events)) return undefined;
  return exportSelection();
}

/** Libreville uses WAT (UTC+01:00) year-round. */
const WAT_OFFSET = '+01:00';

function validateAuditDate(date: string, label: 'début' | 'fin'): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new RangeError(`La date de ${label} est invalide.`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new RangeError(`La date de ${label} est invalide.`);
  }
}

function watDayBoundary(date: string, endOfDay = false): number {
  const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
  return new Date(`${date}T${time}${WAT_OFFSET}`).getTime();
}

function normalizeAuditSearchText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Apply the journal's scope, text and inclusive WAT calendar-day filters together.
 * `label` turns stored account IDs into the names shown on screen, so they can be searched too.
 */
export function filterAuditEvents(
  events: readonly AuditEvent[],
  filters: AuditFilters,
  label?: (text: string | undefined) => string,
): AuditEvent[] {
  const { scope, query, from, to } = filters;
  if (from) validateAuditDate(from, 'début');
  if (to) validateAuditDate(to, 'fin');
  if (from && to && from > to) {
    throw new RangeError('La date de début doit être antérieure ou égale à la date de fin.');
  }
  const normalizedQuery = normalizeAuditSearchText(query.trim());
  const dated = !!(from || to);

  return events.filter(event => {
    if (scope !== 'Tous' && event.scope !== scope) return false;
    const searchable = [
      event.action, event.actor, label?.(event.actor), event.scope, event.time,
      event.targetUserId, label?.(event.targetUserId), event.previousRole, event.nextRole, ...(event.previousServiceIds ?? []), ...(event.serviceIds ?? []),
    ].filter(Boolean).join(' ');
    const normalizedSearchable = normalizeAuditSearchText(searchable);
    if (normalizedQuery && !normalizedSearchable.includes(normalizedQuery)) return false;
    if (dated) {
      if (!event.at) return false;
      const eventTime = new Date(event.at).getTime();
      if (!Number.isFinite(eventTime)) return false;
      if (from && eventTime < watDayBoundary(from)) return false;
      if (to && eventTime > watDayBoundary(to, true)) return false;
    }
    return true;
  });
}

export function auditEventsToCsv(events: readonly AuditEvent[]): string {
  return toCsv(
    [
      'horodatage_iso', 'horodatage_affiche', 'action', 'acteur', 'compte_cible',
      'ancien_role', 'nouveau_role', 'ancien_perimetre', 'nouveau_perimetre', 'perimetre',
    ],
    events.map(event => [
      event.at ?? '',
      event.at ? formatWAT(event.at, 'datetime') : event.time,
      event.action,
      event.actor,
      event.targetUserId ?? '',
      event.previousRole ?? '',
      event.nextRole ?? '',
      event.previousServiceIds?.join(', ') ?? '',
      event.serviceIds?.join(', ') ?? '',
      event.scope,
    ]),
  );
}

/** Neutralize spreadsheet formula injection, then quote and escape CSV content. */
export function csvCell(value: string | number | null | undefined): string {
  let text = value == null ? '' : String(value);
  if (typeof value === 'string' && (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text))) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

/** Semicolon delimiter for French spreadsheet defaults; preserve UTF-8 accents. */
export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  if (rows.some(row => row.length !== headers.length)) {
    throw new RangeError('Le nombre de colonnes CSV est incohérent.');
  }
  return '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
