export type SaveRefusalOutcome = {
  /** True once the canonical server state replaced the refused local change. */
  resumeWrites: boolean;
  message: string;
};

function refusalReason(error: unknown): string {
  const data = error && typeof error === 'object' ? (error as { data?: { error?: unknown } }).data : undefined;
  if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
  return error instanceof Error && error.message ? error.message : 'le serveur n’a pas confirmé l’enregistrement';
}

/**
 * A non-conflict refusal (validation, permission, payload, network) cannot be
 * resent as is. When the canonical snapshot was reloaded, nothing unconfirmed
 * remains in the tab, so writes resume. Otherwise the tab stays suspended and
 * the person is offered an explicit resynchronization.
 */
export function saveRefusalOutcome(error: unknown, refreshed: boolean): SaveRefusalOutcome {
  const reason = refusalReason(error);
  if (refreshed) {
    return {
      resumeWrites: true,
      message: `Modification non enregistrée : ${reason}. L’état partagé a été rechargé depuis le serveur ; vous pouvez reprendre votre travail.`,
    };
  }
  return {
    resumeWrites: false,
    message: `Modification non enregistrée : ${reason}. L’état partagé n’a pas pu être rechargé ; l’enregistrement est suspendu dans cet onglet. Utilisez « Resynchroniser » lorsque la connexion est rétablie.`,
  };
}

export const SUSPENDED_EDIT_MESSAGE =
  'L’enregistrement est suspendu dans cet onglet : cette modification n’a pas été appliquée. Utilisez « Resynchroniser » ou traitez la modification conservée avant de continuer.';
