import { isIP } from "node:net";

type Environment = Record<string, string | undefined>;

export const FIRECRAWL_DEFAULT_API_URL = "https://api.firecrawl.dev";
export const WEB_REFERENCE_URL_MAX_LENGTH = 2048;
const FIRECRAWL_REQUEST_TIMEOUT_MS = 45_000;
const FIRECRAWL_PAGE_TIMEOUT_MS = 30_000;

export type FirecrawlConfig = {
  apiUrl: string;
  apiKey: string | null;
};

export type ScrapedPage = {
  url: string;
  title: string | null;
  markdown: string;
};

export type ScrapePage = (url: string) => Promise<ScrapedPage>;

/** The scrape failed for a reason the user can act on (bad page, quota, timeout). */
export class WebReferenceScrapeError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "WebReferenceScrapeError";
    this.status = status;
  }
}

/**
 * Hosted Firecrawl needs FIRECRAWL_API_KEY. A self-hosted instance
 * (FIRECRAWL_API_URL) may run without a key. Returns null when neither is set:
 * the feature is then disabled and the route answers 503.
 */
export function firecrawlConfig(env: Environment = process.env): FirecrawlConfig | null {
  const apiKey = env.FIRECRAWL_API_KEY?.trim() || null;
  const customUrl = env.FIRECRAWL_API_URL?.trim() || null;
  if (!apiKey && !customUrl) return null;
  let apiUrl: URL;
  try {
    apiUrl = new URL(customUrl ?? FIRECRAWL_DEFAULT_API_URL);
  } catch {
    return null;
  }
  if (apiUrl.protocol !== "https:" && apiUrl.protocol !== "http:") return null;
  return { apiUrl: apiUrl.origin + apiUrl.pathname.replace(/\/+$/u, ""), apiKey };
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa"];

/**
 * Accepts only public https pages. The pilot must never use the scraper to
 * reach internal hosts (SSRF), and credentials in a URL would leave our
 * infrastructure with the request.
 */
export function normalizeWebReferenceUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > WEB_REFERENCE_URL_MAX_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  if (!host || isIP(host) !== 0) return null;
  if (!host.includes(".")) return null;
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
  url.hash = "";
  return url.toString();
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function createFirecrawlScraper(
  config: FirecrawlConfig,
  fetchImpl: typeof fetch = fetch,
): ScrapePage {
  return async (url) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FIRECRAWL_REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(`${config.apiUrl}/v2/scrape`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          url,
          formats: ["markdown"],
          onlyMainContent: true,
          timeout: FIRECRAWL_PAGE_TIMEOUT_MS,
        }),
        signal: controller.signal,
      });
    } catch {
      throw new WebReferenceScrapeError(
        "Le service de récupération de pages n’a pas répondu. Réessayez plus tard.",
        504,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 402 || response.status === 429) {
      throw new WebReferenceScrapeError(
        "Le quota du service de récupération de pages est atteint. Réessayez plus tard.",
        503,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new WebReferenceScrapeError(
        "Le service de récupération de pages refuse la clé configurée. Contactez l’administrateur du pilote.",
        503,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const data = body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : {};
    const metadata = data.metadata && typeof data.metadata === "object"
      ? data.metadata as Record<string, unknown>
      : {};
    const markdown = stringOrNull(data.markdown);
    const pageStatus = typeof metadata.statusCode === "number" ? metadata.statusCode : null;

    if (!response.ok || body.success === false || !markdown || (pageStatus !== null && pageStatus >= 400)) {
      throw new WebReferenceScrapeError(
        "La page n’a pas pu être récupérée. Vérifiez qu’elle est publique et accessible.",
      );
    }
    // Record the URL the agent submitted and we validated, not one reported by the scraper.
    return {
      url,
      title: stringOrNull(metadata.title),
      markdown,
    };
  };
}
