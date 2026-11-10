# ITSM pilot role administration

## Role source and enforcement

The API reads `publicMetadata.itsmRole` from the authenticated user's Clerk record on each request. The browser cannot set or override this value. Missing or invalid roles are denied access. Scoped N3/N4 actions also read `publicMetadata.itsmServiceIds`.

## Bootstrap the first N1 account

1. Configure `ITSM_BOOTSTRAP_ADMIN_EMAILS` with the verified email address or comma-separated addresses approved to be the initial N1 administrators.
2. Each approved person signs in to the matching Clerk environment once. Under the pilot workspace lock, the API checks that the primary email is verified, writes N1 to Clerk metadata, and sets a one-time bootstrap marker.
3. Remove the allowlist after the intended initial N1 accounts have signed in. Manual role changes, including revocation, also set the marker; they cannot silently restore N1 through bootstrap.

Do not add unapproved addresses to the allowlist. Development and production have separate Clerk users and must be bootstrapped independently.

The initial N1 grant is now archived and journaled as a server-owned bootstrap event (`system:itsm-bootstrap`), with the actual current timestamp. Archive or journal failures do not silently leave an unaudited grant: the API verifies uncertain persistence and restores the previous metadata when no event was committed.

## Assign pilot roles

An N1 administrator opens **Préférences → Attribuer un rôle au pilote**, enters the target Clerk user ID, and chooses N1–N5 or complete access removal. To replace an administrator, first grant N1 to the designated successor, verify that the change succeeded, then remove the old account's access. The API refuses to remove or demote the last active N1. A N1 may revoke their own access only if another N1 remains active; the UI asks for explicit confirmation. N1 cannot self-assign a lower role. Assign service IDs for scoped N3/N4 access.

Role changes are serialized under a database row lock. The API re-reads the acting N1 and the target's current Clerk metadata inside that lock, so a role change cannot use an out-of-date administrator assignment. The API counts distinct N1 accounts from Clerk before allowing an N1 removal. A role below N1 cannot grant N1. A deliberate change marks bootstrap complete, including when access is removed.

These guardrails apply to changes made through the pilot API. Direct edits of `publicMetadata.itsmRole` in Clerk bypass the API lock and last-admin check and should be restricted to trusted system operators. Clerk role changes take effect on subsequent API requests.

## Attest an existing role with no journal trace

An existing N1 opens **Préférences**, selects the account, reviews its current role and service scope, then uses **Attester le rôle**. The API rechecks the acting administrator and the target metadata under the role-management lock. A role or scope changed since review is rejected with HTTP 409 and must be reviewed again.

This creates a distinct `itsm.role.attested` event at the current time, identifying the acting N1 and target account. It does not write Clerk metadata, assign access, invent an earlier grant date, or establish how the old role was originally granted. The reconciliation monitor accepts this current-state evidence, but detects later role/scope differences as usual. A self-attestation is identified transparently because actor and target IDs are identical; it is not an independent approval.

## Investigate an N1 role with no journal entry

A startup reconciliation finding establishes that the current Clerk role or scope has no matching ITSM role event. It does **not** establish how that access was granted. The pilot's earlier implementation wrote both allowlisted bootstrap grants and administrator role assignments directly to Clerk without a corresponding journal event. A direct edit in Clerk can also bypass the API journal. The `itsmBootstrapCompleted` metadata flag is only a guard against bootstrap re-granting access; bootstrap and manual role changes both set it, so it is not proof of origin.

To investigate a specific account, compare the Clerk role and service scope with Clerk's activity history, the external role archive, and approved change records. Check the deployed version and relevant bootstrap/role-change timing as supporting context. A matching `itsm.role.changed` event with `origin: "bootstrap"` is evidence of an archived bootstrap; an event naming an administrator is evidence of an API role change. If none of these records identify the grant, record the origin as **undetermined** rather than treating the missing entry or metadata flag as proof. The current code and reconciliation finding alone cannot identify the origin of a particular account.

Do not remove or rewrite the current Clerk role to clear the finding, and do not backdate or fabricate an `itsm.role.changed` event. If an authorized N1 verifies that the current access and scope are correct, use **Attester le rôle** to record that present-day verification. This preserves Clerk authentication and access, while giving the journal and archive a truthful timestamped event. Future assignments must continue through the API so the existing last-N1 protection and audit requirements apply.

## Role-change archive

The default mode requires an external HTTPS archive. Configure `ITSM_ROLE_ARCHIVE_URL`; configure `ITSM_ROLE_ARCHIVE_TOKEN` as a secret when the archive requires bearer authentication. The archive must accept `HEAD` for its health check and acknowledge `POST` events, including both `itsm.role.changed` and `itsm.role.attested`. Attestation remains a distinct current-state assertion, not evidence of an earlier grant.

For development-only testing without an external archive, set `ITSM_ROLE_ARCHIVE_MODE=development-db` while `NODE_ENV=development`. Role events are then kept in the workspace audit in the same PostgreSQL transaction as the role change. This is not an independent archive or a production configuration. The API rejects this mode outside development; production must continue using the external archive.

## Capability summary

| Role | Main permissions |
| --- | --- |
| N1 | Read, create incident/request tickets, decide CAB, export audit, manage N1 succession, assign N2–N5 or revoke access |
| N2 | Read, create incident/request tickets, participate in conversations |
| N3 | Read, manage and resolve tickets, create problems/changes, export audit; CAB only for assigned service scope |
| N4 | Read, create incident/request tickets, manage tickets in assigned service scope |
| N5 | Read-only consultation and audit export |

All ticket transitions and CAB rules remain subject to the existing workflow validation. Role checks are enforced by the API even when a client bypasses or alters the interface.
