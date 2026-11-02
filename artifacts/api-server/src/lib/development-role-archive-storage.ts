import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import type { DevelopmentRoleArchiveEnvelope } from "@workspace/api-zod";
import type { DevelopmentArchiveRepository } from "../routes/development-role-archive";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

// Only called at startup when the explicit development receiver is enabled.
// This additive DDL never alters existing workspace tables or production data.
export async function initializeDevelopmentRoleArchive(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS anif_itsm_development_role_archive (
      event_id text PRIMARY KEY,
      digest text NOT NULL,
      envelope jsonb NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export const developmentArchiveRepository: DevelopmentArchiveRepository = {
  async check() {
    await pool.query("SELECT event_id FROM anif_itsm_development_role_archive LIMIT 1");
  },
  async append(envelope: DevelopmentRoleArchiveEnvelope) {
    const digest = createHash("sha256").update(JSON.stringify(canonical(envelope))).digest("hex");
    const inserted = await pool.query(
      `INSERT INTO anif_itsm_development_role_archive (event_id, digest, envelope)
       VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [envelope.event.id, digest, JSON.stringify(envelope)],
    );
    if (inserted.rowCount === 1) return "created";
    const existing = await pool.query<{ digest: string }>(
      "SELECT digest FROM anif_itsm_development_role_archive WHERE event_id = $1",
      [envelope.event.id],
    );
    if (!existing.rows[0]) throw new Error("Réception de l’événement non vérifiable.");
    return existing.rows[0].digest === digest ? "duplicate" : "conflict";
  },
};
