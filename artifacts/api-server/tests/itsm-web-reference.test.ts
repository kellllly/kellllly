import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import express from "express";
import { build } from "esbuild";
import {
  createFirecrawlScraper,
  firecrawlConfig,
  normalizeWebReferenceUrl,
  WebReferenceScrapeError,
} from "../src/lib/firecrawl.ts";
import {
  appendTicketWebReference,
  excerptFromMarkdown,
  ITSM_TICKET_WEB_REFERENCE_AUDIT_TYPE,
  WEB_REFERENCE_MAX_PER_TICKET,
  WEB_REFERENCE_UPDATE_MAX_LENGTH,
  webReferenceUpdateBody,
} from "../src/lib/itsm-web-reference.ts";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
type Role = "N1" | "N2" | "N3" | "N4" | "N5";
const actor = (role: Role, serviceIds: string[] = []) => ({ id: `account-${role}`, role, serviceIds });
const ticket = (overrides: Record<string, unknown> = {}) => ({
  id: "INC-2401",
  status: "En cours",
  serviceId: "svc-mail",
  updates: [{ author: "account-N3", body: "Incident ouvert.", time: "09:00", at: "2026-11-04T08:00:00.000Z" }],
  ...overrides,
});

test("only public https pages are accepted as web references", () => {
  assert.equal(normalizeWebReferenceUrl(" https://support.example.com/kb/42#section "), "https://support.example.com/kb/42");
  for (const rejected of [
    "http://support.example.com/kb",
    "https://user:secret@support.example.com/kb",
    "https://127.0.0.1/admin",
    "https://[::1]/",
    "https://10.0.0.8/",
    "https://localhost/",
    "https://intranet/",
    "https://db.internal/",
    "https://printer.local/",
    "https://support.example.com:8443/",
    "ftp://support.example.com/",
    "javascript:alert(1)",
    `https://example.com/${"a".repeat(2050)}`,
    42,
  ]) {
    assert.equal(normalizeWebReferenceUrl(rejected), null, String(rejected));
  }
});

test("Firecrawl stays disabled without a key or a self-hosted address", () => {
  assert.equal(firecrawlConfig({}), null);
  assert.deepEqual(firecrawlConfig({ FIRECRAWL_API_KEY: "fc-test" }), { apiUrl: "https://api.firecrawl.dev", apiKey: "fc-test" });
  assert.deepEqual(firecrawlConfig({ FIRECRAWL_API_URL: "http://firecrawl:3002/" }), { apiUrl: "http://firecrawl:3002", apiKey: null });
});

test("the scraper calls Firecrawl v2 with the key and keeps the submitted URL", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const scrape = createFirecrawlScraper({ apiUrl: "https://api.firecrawl.dev", apiKey: "fc-test" }, (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      success: true,
      data: { markdown: "# Avis\nCorrectif disponible.", metadata: { title: "Avis de sécurité", sourceURL: "https://elsewhere.example/", statusCode: 200 } },
    }), { status: 200 });
  }) as typeof fetch);
  const page = await scrape("https://support.example.com/kb/42");
  assert.deepEqual(page, { url: "https://support.example.com/kb/42", title: "Avis de sécurité", markdown: "# Avis\nCorrectif disponible." });
  assert.equal(calls[0]?.url, "https://api.firecrawl.dev/v2/scrape");
  assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, "Bearer fc-test");
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    url: "https://support.example.com/kb/42", formats: ["markdown"], onlyMainContent: true, timeout: 30_000,
  });
});

test("scraper failures map to actionable statuses", async () => {
  const respond = (status: number, body: unknown) => createFirecrawlScraper(
    { apiUrl: "https://api.firecrawl.dev", apiKey: "fc-test" },
    (async () => new Response(JSON.stringify(body), { status })) as typeof fetch,
  );
  const statusOf = async (scrape: ReturnType<typeof respond>) => {
    try {
      await scrape("https://support.example.com/");
      return null;
    } catch (error) {
      assert.ok(error instanceof WebReferenceScrapeError);
      return error.status;
    }
  };
  assert.equal(await statusOf(respond(402, {})), 503);
  assert.equal(await statusOf(respond(429, {})), 503);
  assert.equal(await statusOf(respond(401, {})), 503);
  assert.equal(await statusOf(respond(500, { success: false })), 502);
  assert.equal(await statusOf(respond(200, { success: true, data: { markdown: "Not found", metadata: { statusCode: 404 } } })), 502);
  assert.equal(await statusOf(respond(200, { success: true, data: { markdown: "   " } })), 502);
  const offline = createFirecrawlScraper({ apiUrl: "https://api.firecrawl.dev", apiKey: null }, (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch);
  assert.equal(await statusOf(offline), 504);
});

test("the ticket update names its source, flags external content and fits the update limit", () => {
  const body = webReferenceUpdateBody({
    url: "https://support.example.com/kb/42",
    title: "Avis\nsur deux lignes",
    note: "À vérifier\npar le N3",
    markdown: `![logo](data:image/png;base64,AAAA)\n<script>x</script>Texte utile\n\n\n\n${"x".repeat(9000)}`,
  });
  assert.ok(body.startsWith("Référence web ajoutée : Avis sur deux lignes\nSource : https://support.example.com/kb/42\nNote : À vérifier par le N3\n"));
  assert.match(body, /contenu externe, non vérifié/u);
  assert.ok(!body.includes("data:image"));
  assert.ok(!body.includes("<script>"));
  assert.ok(!body.includes("\n\n\n"));
  assert.ok(body.length <= WEB_REFERENCE_UPDATE_MAX_LENGTH);
  assert.ok(body.endsWith("…"));
  assert.equal(excerptFromMarkdown("court", 100), "court");
});

test("appending a reference adds one ticket update and one journal event", () => {
  const store = { tickets: [ticket(), ticket({ id: "INC-2402" })], audit: [{ id: "old", action: "Ancien" }] };
  const now = new Date("2026-11-04T10:15:00.000Z");
  const { store: next, update } = appendTicketWebReference(store, "INC-2401", {
    url: "https://support.example.com/kb/42", title: "Avis", markdown: "Correctif.", note: null,
  }, actor("N3"), now);
  const tickets = next.tickets as ReturnType<typeof ticket>[];
  assert.equal(tickets[0]!.updates.length, 2);
  assert.deepEqual(tickets[0]!.updates[1], update);
  assert.equal(update.author, "account-N3");
  assert.equal(update.at, "2026-11-04T10:15:00.000Z");
  assert.equal(tickets[1]!.updates.length, 1);
  const audit = next.audit as Record<string, unknown>[];
  assert.equal(audit.length, 2);
  assert.equal(audit[0]!.type, ITSM_TICKET_WEB_REFERENCE_AUDIT_TYPE);
  assert.equal(audit[0]!.url, "https://support.example.com/kb/42");
  assert.equal(audit[0]!.scope, "Ticket INC-2401");
  assert.equal((store.tickets[0]!.updates as unknown[]).length, 1, "the input store is not mutated");
});

test("references follow ticket roles, scopes and lifecycle", () => {
  const reference = { url: "https://support.example.com/", title: null, markdown: "Texte.", note: null };
  const attempt = (store: Record<string, unknown>, who: ReturnType<typeof actor>) => {
    try {
      appendTicketWebReference(store, "INC-2401", reference, who);
      return 200;
    } catch (error) {
      return (error as { status: number }).status;
    }
  };
  const open = { tickets: [ticket()] };
  assert.equal(attempt(open, actor("N3")), 200);
  assert.equal(attempt(open, actor("N4", ["svc-mail"])), 200);
  assert.equal(attempt(open, actor("N4", ["svc-other"])), 404);
  assert.equal(attempt(open, actor("N5")), 404);
  assert.equal(attempt(open, actor("N1")), 403);
  assert.equal(attempt(open, actor("N2")), 403);
  assert.equal(attempt({ tickets: [] }, actor("N3")), 404);
  assert.equal(attempt({ tickets: [ticket({ status: "Clos" })] }, actor("N3")), 409);
  assert.equal(attempt({ tickets: [ticket({ status: "Rejeté" })] }, actor("N3")), 409);
  const full = { tickets: [ticket({
    updates: Array.from({ length: WEB_REFERENCE_MAX_PER_TICKET }, () => ({ author: "a", body: "Référence web ajoutée : X", time: "10:00" })),
  })] };
  assert.equal(attempt(full, actor("N3")), 409);
});

test("the web-reference route validates, authorizes before scraping and persists under the lock", async (t) => {
  const tempBuildDir = await mkdtemp(path.join(packageDir, "node_modules", ".itsm-web-reference-"));
  t.after(() => rm(tempBuildDir, { recursive: true, force: true }));
  const bundlePath = path.join(tempBuildDir, "itsm-web-reference.mjs");
  await build({
    entryPoints: [path.join(packageDir, "src/routes/itsm-web-reference.ts")],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["express"],
    logLevel: "silent",
  });
  const { createItsmWebReferenceRouter } = await import(bundlePath);

  let store: Record<string, unknown> = { tickets: [ticket()], audit: [] };
  let version = 7;
  let currentActor = actor("N3");
  const scraped: string[] = [];
  let scrapeEnabled = true;
  const makeApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.log = { warn: () => undefined, error: () => undefined };
      next();
    });
    app.use("/api", createItsmWebReferenceRouter({
      resolveActor: async () => currentActor,
      scrapePage: scrapeEnabled
        ? async (url: string) => {
          scraped.push(url);
          return { url, title: "Avis éditeur", markdown: "Appliquer le correctif 1.2.3." };
        }
        : null,
      loadStore: async () => store,
      withLock: async (operation: any) => operation(store, async (next: Record<string, unknown>) => {
        store = next;
        version += 1;
        return version;
      }),
    }, (_req: unknown, _res: unknown, next: () => void) => next()));
    return app;
  };
  const server = makeApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/itsm/tickets`;
  const post = (ticketId: string, body: unknown) => fetch(`${base}/${ticketId}/web-reference`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const ok = await post("INC-2401", { url: "https://support.example.com/kb/42", note: "Lien fourni par l’éditeur" });
  assert.equal(ok.status, 200);
  const payload = await ok.json();
  assert.equal(payload.ticketId, "INC-2401");
  assert.equal(payload.title, "Avis éditeur");
  assert.equal(payload.version, 8);
  assert.match(payload.update.body, /^Référence web ajoutée : Avis éditeur\nSource : https:\/\/support\.example\.com\/kb\/42\nNote : Lien fourni/u);
  assert.equal(((store.tickets as any[])[0].updates as unknown[]).length, 2);
  assert.equal((store.audit as any[])[0].type, ITSM_TICKET_WEB_REFERENCE_AUDIT_TYPE);

  assert.equal((await post("INC-2401", { url: "http://support.example.com/" })).status, 400);
  assert.equal((await post("INC-2401", { url: "https://192.168.1.1/" })).status, 400);
  assert.equal((await post("INC-2401", {})).status, 400);
  assert.equal((await post("INC-9999", { url: "https://support.example.com/" })).status, 404);
  currentActor = actor("N5");
  assert.equal((await post("INC-2401", { url: "https://support.example.com/" })).status, 404);
  currentActor = actor("N2");
  assert.equal((await post("INC-2401", { url: "https://support.example.com/" })).status, 403);
  assert.deepEqual(scraped, ["https://support.example.com/kb/42"], "refused requests never reach Firecrawl");

  currentActor = actor("N3");
  for (let i = 1; i < 10; i += 1) {
    assert.equal((await post("INC-2401", { url: `https://support.example.com/kb/${i}` })).status, 200);
  }
  assert.equal((await post("INC-2401", { url: "https://support.example.com/kb/11" })).status, 429);

  scrapeEnabled = false;
  const disabled = makeApp().listen(0, "127.0.0.1");
  await once(disabled, "listening");
  t.after(() => disabled.close());
  const response = await fetch(`http://127.0.0.1:${(disabled.address() as AddressInfo).port}/api/itsm/tickets/INC-2401/web-reference`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://support.example.com/" }),
  });
  assert.equal(response.status, 503);
});
