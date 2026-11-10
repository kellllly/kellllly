import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Append-only copy of the journal seals. Its triggers (UPDATE, DELETE and
 * TRUNCATE refused) are created by artifacts/api-server/src/lib/itsm-audit-worm.ts
 * at startup; declared here so that drizzle-kit push keeps the table.
 */
export const itsmAuditSealArchiveTable = pgTable("anif_itsm_audit_seal_archive", {
  workspaceId: text("workspace_id").notNull(),
  seq: integer("seq").notNull(),
  hash: text("hash").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.seq] })]);
