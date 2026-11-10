/**
 * Append-only copy of the journal seals, enforced by PostgreSQL (partial WORM).
 *
 * The journal lives in the `store` JSON of anif_itsm_workspace: anyone able to
 * write that row could rewrite events and recompute the whole hash chain. Two
 * triggers close that gap for every write path, the application's or direct SQL:
 * - on anif_itsm_workspace, each INSERT or UPDATE of `store` is refused when a
 *   seal already archived (seq, hash) is missing or different in the new
 *   journal; then the new seals are archived;
 * - anif_itsm_audit_seal_archive refuses UPDATE, DELETE and TRUNCATE.
 * Deleting a workspace row stays possible (tests clean up their own rows), but
 * its archived seals remain: the integrity check reports the missing journal,
 * and recreating that workspace with another journal is refused.
 *
 * Limit: the table owner or a superuser can still disable triggers or drop the
 * table. The external anchors (RFC 3161 timestamps, SIEM feed) cover that case.
 */

export const AUDIT_SEAL_ARCHIVE_TABLE = "anif_itsm_audit_seal_archive";
const WORM_LOCK_KEY = 4_216_031_777;

/** Idempotent DDL, run at startup in one transaction under an advisory lock. */
export const AUDIT_WORM_DDL = `
CREATE TABLE IF NOT EXISTS anif_itsm_audit_seal_archive (
  workspace_id text NOT NULL,
  seq integer NOT NULL CHECK (seq > 0),
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, seq)
);

CREATE OR REPLACE FUNCTION anif_itsm_audit_seal_archive_refuse() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'anif_audit_worm: les sceaux archivés ne peuvent être ni modifiés ni supprimés'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS anif_itsm_audit_seal_archive_no_change ON anif_itsm_audit_seal_archive;
CREATE TRIGGER anif_itsm_audit_seal_archive_no_change
  BEFORE UPDATE OR DELETE ON anif_itsm_audit_seal_archive
  FOR EACH ROW EXECUTE FUNCTION anif_itsm_audit_seal_archive_refuse();

DROP TRIGGER IF EXISTS anif_itsm_audit_seal_archive_no_truncate ON anif_itsm_audit_seal_archive;
CREATE TRIGGER anif_itsm_audit_seal_archive_no_truncate
  BEFORE TRUNCATE ON anif_itsm_audit_seal_archive
  FOR EACH STATEMENT EXECUTE FUNCTION anif_itsm_audit_seal_archive_refuse();

CREATE OR REPLACE FUNCTION anif_itsm_audit_worm() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  journal jsonb := CASE WHEN jsonb_typeof(NEW.store -> 'audit') = 'array' THEN NEW.store -> 'audit' ELSE '[]'::jsonb END;
  lost integer;
BEGIN
  -- INSERT ... ON CONFLICT runs this trigger before the conflict: when the row
  -- exists, the insert is dropped, so its (empty) store is neither checked nor archived.
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM anif_itsm_workspace WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;
  SELECT archive.seq INTO lost
  FROM anif_itsm_audit_seal_archive AS archive
  LEFT JOIN (
    SELECT event ->> 'seq' AS seq, event ->> 'hash' AS hash FROM jsonb_array_elements(journal) AS event
  ) AS current ON current.seq = archive.seq::text AND current.hash = archive.hash
  WHERE archive.workspace_id = NEW.id AND current.seq IS NULL
  ORDER BY archive.seq
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'anif_audit_worm: le sceau archivé % est absent ou modifié dans le journal', lost
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  INSERT INTO anif_itsm_audit_seal_archive (workspace_id, seq, hash)
  SELECT NEW.id, (event ->> 'seq')::integer, event ->> 'hash'
  FROM jsonb_array_elements(journal) AS event
  WHERE jsonb_typeof(event -> 'seq') = 'number'
    AND (event ->> 'seq') ~ '^[1-9][0-9]{0,8}$'
    AND (event ->> 'hash') ~ '^[0-9a-f]{64}$'
  ON CONFLICT (workspace_id, seq) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS anif_itsm_audit_worm ON anif_itsm_workspace;
CREATE TRIGGER anif_itsm_audit_worm
  BEFORE INSERT OR UPDATE OF store ON anif_itsm_workspace
  FOR EACH ROW EXECUTE FUNCTION anif_itsm_audit_worm();
`;

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
};
type Pool = Queryable & { connect: () => Promise<Queryable & { release: () => void }> };

/**
 * Install the tables and triggers, then archive the seals already in the
 * journals (an UPDATE of `store` onto itself runs the trigger). Returns the
 * number of seals archived by this call.
 */
export async function installAuditWorm(pool: Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [WORM_LOCK_KEY]);
    const before = await client.query(`SELECT to_regclass('${AUDIT_SEAL_ARCHIVE_TABLE}') IS NOT NULL AS present`);
    const countBefore = before.rows[0]?.present
      ? Number((await client.query(`SELECT count(*)::int AS n FROM ${AUDIT_SEAL_ARCHIVE_TABLE}`)).rows[0]?.n ?? 0)
      : 0;
    await client.query(AUDIT_WORM_DDL);
    await client.query("UPDATE anif_itsm_workspace SET store = store");
    const after = await client.query(`SELECT count(*)::int AS n FROM ${AUDIT_SEAL_ARCHIVE_TABLE}`);
    await client.query("COMMIT");
    return Number(after.rows[0]?.n ?? 0) - countBefore;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export type ArchivedSeal = { seq: number; hash: string };

/** Archived seals of one workspace, or null when the archive is not installed. */
export async function loadArchivedSeals(pool: Queryable, workspaceId: string): Promise<ArchivedSeal[] | null> {
  const present = await pool.query(`SELECT to_regclass('${AUDIT_SEAL_ARCHIVE_TABLE}') IS NOT NULL AS present`);
  if (!present.rows[0]?.present) return null;
  const { rows } = await pool.query(
    `SELECT seq, hash FROM ${AUDIT_SEAL_ARCHIVE_TABLE} WHERE workspace_id = $1 ORDER BY seq`,
    [workspaceId],
  );
  return rows.map((row) => ({ seq: Number(row.seq), hash: String(row.hash) }));
}

export type ArchiveComparison = {
  /** consistent: every archived seal is in the journal; diverged: one is missing or different. */
  status: "consistent" | "diverged" | "not_installed";
  archived: number;
  /** Journal seals not archived yet (written while the triggers were off, or never installed). */
  unarchived: number;
  firstMismatch: { seq: number; reason: "missing" | "changed" } | null;
};

/** Compare the journal with the archived seals (pure; the route reports it). */
export function compareWithArchive(events: readonly unknown[], archived: readonly ArchivedSeal[] | null): ArchiveComparison {
  const journal = new Map<number, unknown>();
  for (const event of events) {
    if (event && typeof event === "object" && !Array.isArray(event)) {
      const { seq, hash } = event as Record<string, unknown>;
      if (typeof seq === "number" && Number.isInteger(seq) && seq > 0) journal.set(seq, hash);
    }
  }
  if (archived === null) return { status: "not_installed", archived: 0, unarchived: journal.size, firstMismatch: null };
  const archivedSeqs = new Set<number>();
  let firstMismatch: ArchiveComparison["firstMismatch"] = null;
  for (const seal of [...archived].sort((left, right) => left.seq - right.seq)) {
    archivedSeqs.add(seal.seq);
    if (firstMismatch) continue;
    if (!journal.has(seal.seq)) firstMismatch = { seq: seal.seq, reason: "missing" };
    else if (journal.get(seal.seq) !== seal.hash) firstMismatch = { seq: seal.seq, reason: "changed" };
  }
  const unarchived = [...journal.keys()].filter((seq) => !archivedSeqs.has(seq)).length;
  return { status: firstMismatch ? "diverged" : "consistent", archived: archived.length, unarchived, firstMismatch };
}
