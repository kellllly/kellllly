import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { sealAuditEvents } from "../src/lib/itsm-audit-chain.ts";
import { installAuditWorm, loadArchivedSeals } from "../src/lib/itsm-audit-worm.ts";

const event = (id: string) => ({ id, action: `Action ${id}`, actor: "user_a", scope: "Pilote", time: "10:00" });

test("PostgreSQL keeps the journal seals append-only, whatever writes the workspace row", {
  skip: !process.env.DATABASE_URL && "Requires the PostgreSQL integration database",
}, async (t) => {
  // pg is a dependency of lib/db, not of the API package.
  const pg = createRequire(import.meta.url)(fileURLToPath(new URL("../../../lib/db/node_modules/pg", import.meta.url))) as typeof import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const workspaceId = `itsm-worm-test-${randomUUID()}`;
  t.after(async () => {
    await pool.query("DELETE FROM anif_itsm_workspace WHERE id = $1", [workspaceId]).catch(() => undefined);
    await pool.end();
  });
  await pool.query(`CREATE TABLE IF NOT EXISTS anif_itsm_workspace (
    id text PRIMARY KEY, version integer NOT NULL DEFAULT 1, store jsonb NOT NULL,
    imported_users text[] NOT NULL DEFAULT ARRAY[]::text[], updated_at timestamptz NOT NULL DEFAULT now())`);

  // Installing twice is harmless.
  await installAuditWorm(pool);
  assert.equal(await installAuditWorm(pool), 0);

  const insert = (store: unknown) => pool.query(
    "INSERT INTO anif_itsm_workspace (id, version, store) VALUES ($1, 0, $2) ON CONFLICT DO NOTHING", [workspaceId, store]);
  const save = (store: unknown) => pool.query("UPDATE anif_itsm_workspace SET store = $2 WHERE id = $1", [workspaceId, store]);
  const refusal = { code: "23000", message: /anif_audit_worm/u };

  const three = sealAuditEvents([event("c"), event("b"), event("a")]);
  await insert({ audit: three });
  assert.deepEqual((await loadArchivedSeals(pool, workspaceId))?.map((seal) => seal.seq), [1, 2, 3]);

  // The application's INSERT ... ON CONFLICT DO NOTHING with an empty store still passes.
  await insert({});
  // Appending is allowed and archives the new seal; untouched journal is fine too.
  const four = sealAuditEvents([event("d"), ...three]);
  await save({ audit: four, tickets: [] });
  await pool.query("UPDATE anif_itsm_workspace SET version = version + 1 WHERE id = $1", [workspaceId]);
  assert.equal((await loadArchivedSeals(pool, workspaceId))?.length, 4);

  // Rewriting an event and recomputing the chain, dropping one, or emptying the journal is refused.
  const resealed = sealAuditEvents(four.map(({ seq, prevHash, hash, ...rest }) => (rest.id === "b" ? { ...rest, action: "réécrit" } : rest)));
  await assert.rejects(save({ audit: resealed }), refusal);
  await assert.rejects(save({ audit: four.filter((item) => item.seq !== 2) }), refusal);
  await assert.rejects(save({}), refusal);
  // A pruned stub keeps its seal, so pruning stays possible.
  await save({ audit: four.map((item) => (item.seq === 1 ? { id: item.id, seq: item.seq, prevHash: item.prevHash, hash: item.hash, pruned: true } : item)) });

  // The archive itself refuses changes.
  await assert.rejects(pool.query("UPDATE anif_itsm_audit_seal_archive SET hash = $2 WHERE workspace_id = $1", [workspaceId, "0".repeat(64)]), { code: "42501" });
  await assert.rejects(pool.query("DELETE FROM anif_itsm_audit_seal_archive WHERE workspace_id = $1", [workspaceId]), { code: "42501" });
  await assert.rejects(pool.query("TRUNCATE anif_itsm_audit_seal_archive"), { code: "42501" });

  // Deleting the row is possible but leaves the seals, and a new journal under that id is refused.
  await pool.query("DELETE FROM anif_itsm_workspace WHERE id = $1", [workspaceId]);
  assert.equal((await loadArchivedSeals(pool, workspaceId))?.length, 4);
  await assert.rejects(insert({ audit: sealAuditEvents([event("x")]) }), refusal);
  await insert({ audit: four });
});
