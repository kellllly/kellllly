type RoleOperation = 'directory' | 'archive' | 'assignment' | 'attestation';

export function roleServiceIds(role: string, selectedIds: readonly string[]): string[] {
  if (role !== 'N3' && role !== 'N4') return [];
  return [...new Set(selectedIds.map(id => id.trim()).filter(Boolean))];
}

export function roleRequestError(error: unknown, operation: RoleOperation): string {
  const message = error instanceof Error ? error.message : '';
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  if (operation === 'assignment' && status === 401) {
    return 'Votre session a expiré. Reconnectez-vous; le rôle n’a pas été modifié.';
  }
  if (operation === 'assignment' && status === 400
    && /services? autorisés? sont introuvables/iu.test(message)) {
    return 'Un service sélectionné n’est plus présent dans le pilote. Le rôle n’a pas été modifié. Actualisez la liste des services, vérifiez le périmètre, puis réessayez.';
  }
  if (operation === 'assignment' && status === 403) {
    const data = error && typeof error === 'object' && 'data' in error ? error.data : undefined;
    const detail = data && typeof data === 'object' && 'error' in data
      && typeof data.error === 'string'
      ? data.error.trim()
      : '';
    if (detail) return `${detail} Le rôle n’a pas été modifié.`;
    return 'Cette modification a été refusée. Le rôle n’a pas été modifié; vérifiez votre accès N1 et actualisez le répertoire.';
  }
  if (operation === 'directory' && status === 503) {
    return 'Le répertoire des comptes est temporairement indisponible. Le compte ne peut pas être vérifié et aucune attribution ne peut être envoyée. Réessayez lorsque le service est rétabli.';
  }
  // An HTTP refusal is not a transport failure; keep the server's explanation.
  if (typeof status === 'number' && message) return message;
  const aborted = error && typeof error === 'object' && 'name' in error && error.name === 'AbortError';
  if (aborted || /network|failed to fetch|fetch resource|load failed/i.test(message)) {
    if (operation === 'assignment' || operation === 'attestation') {
      return 'La réponse du serveur n’a pas été reçue. Le résultat de l’opération est incertain : actualisez le répertoire et vérifiez le rôle du compte et le journal avant toute nouvelle tentative. Aucune relance automatique n’est effectuée.';
    }
    if (operation === 'archive') {
      return 'Connexion au serveur interrompue : le contrôle de l’archive n’a pas pu être confirmé. Ce contrôle ne modifie aucune habilitation. Réessayez lorsque la connexion est rétablie.';
    }
    return 'Connexion au serveur interrompue : impossible de vérifier le compte. Aucune attribution ne peut être envoyée. Réessayez lorsque la connexion est rétablie.';
  }
  return message || 'Le service des habilitations n’a pas pu terminer cette opération.';
}
