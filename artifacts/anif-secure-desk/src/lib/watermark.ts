/** Text of the on-screen watermark: who, from where, when (to the second, WAT). */
export function watermarkText(name: string, accountId: string, ip: string | null, now: number): string {
  const stamp = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Africa/Libreville', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(now);
  const shortId = accountId.length > 10 ? `…${accountId.slice(-8)}` : accountId;
  return [name, shortId, ip ? `IP ${ip}` : null, stamp].filter(Boolean).join(' · ');
}
