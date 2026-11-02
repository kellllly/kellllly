type RoleOperation = 'directory' | 'archive' | 'assignment' | 'attestation';

export function roleServiceIds(role: string, value: string): string[] {
  if (role !== 'N3' && role !== 'N4') return [];
  return [...new Set(value.split(',').map(id => id.trim()).filter(Boolean))];
}

export function roleRequestError(error: unknown, operation: RoleOperation): string {
  const message = error instanceof Error ? error.message : '';
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
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
    return 'Connexion au serveur interrompue : impossible d’actualiser les comptes. Les données précédemment affichées peuvent être anciennes. Cliquez sur Actualiser lorsque la connexion est rétablie.';
  }
  return message || 'Le service des habilitations n’a pas pu terminer cette opération.';
}
