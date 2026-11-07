const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)$/i;

/**
 * Without a configured key, Clerk derives one from the hostname
 * (`clerk.<host>`), which is correct for production custom domains but cannot
 * exist for a local host: the page would stay blank. Detect that case so the
 * app can explain how to configure a development instance instead.
 */
export function missingLocalClerkKey(hostname: string, configuredKey: string | undefined): boolean {
  return !configuredKey?.trim() && LOCAL_HOST.test(hostname.trim());
}
