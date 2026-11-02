# ITSM role archive monitoring

## Development receiver

An explicitly enabled **same-environment test receiver** is available at
`https://<current-development-host>/api/itsm/development-role-archive`.
It is not the Governance page, an independent external archive, WORM storage,
or a production retention/compliance guarantee.

Configure **development only**:

- `ITSM_DEV_ROLE_ARCHIVE_ENABLED=true`
- `ITSM_DEV_ROLE_ARCHIVE_URL=auto` to follow the runtime `REPLIT_DEV_DOMAIN`.
  Alternatively supply the exact HTTPS receiver URL above.

The existing `SESSION_SECRET` is used at runtime as an HMAC key with a dedicated
development-archive label. Its raw value is never sent, logged, or exposed to the
browser. No new shared/default password is needed. The derived machine credential
authenticates both `HEAD` health checks and `POST` events; unauthenticated browser
visits return 401, not an HTML archive viewer. Automatic URL mode follows the
active workspace/branch host without retaining a task's temporary preview URL.
Missing runtime host configuration fails explicitly. If the session secret
changes, restart the API.

Startup creates only the additive `anif_itsm_development_role_archive` table.
Events are persisted before acknowledgement in PostgreSQL, separately from the
workspace snapshot and its truncated audit array. Identical retries are accepted
without another row; the same event ID with different content returns 409.
There is no HTTP read/update/delete interface. Database administrators can still
alter this table; development does not promise independent or immutable storage.
The receiver is not mounted in production, even if its development opt-in flag
is present. Production continues using `ITSM_ROLE_ARCHIVE_URL` and the optional
`ITSM_ROLE_ARCHIVE_TOKEN` for an actual external archive.

Use the N1 **Préférences → Tester la connexion** button to check the authenticated
HTTPS round trip and database readiness. Never configure `/governance` as an
archive: an HTML 200 response does not prove that a role event was persisted.

## External archive monitoring

The API server checks the configured external role archive once at startup and
every 60 seconds while it is running. It sends a `HEAD` request using the
configured archive connection settings. A failed health check emits one
structured error event when the archive becomes unavailable; repeated failures
do not flood the logs. When a later check succeeds, the server emits a recovery
event.

An unsuccessful archive write during a role change emits the same unavailable
event immediately. Search or configure log-based alerting for:

- `alert=itsm_role_archive_unavailable` — the archive destination cannot be
  reached, is misconfigured, or did not acknowledge a role-change event.
- `alert=itsm_role_archive_recovered` — the periodic check detected recovery.

These events include only the alert name, component, status, and source
(`periodic_health_check` or `role_change`). They do not include authentication
tokens, raw errors, account identifiers, email addresses, roles, or service
assignments. In particular, archive alert events use the process logger rather
than the request logger, so they do not inherit the target account's request
path.

A role-assignment refusal for another reason is not an archive outage. For
example, a non-N1 actor, an attempt to remove the last N1, or an invalid request
does not emit `itsm_role_archive_unavailable`. Treat the HTTP refusal and the
archive destination alert as separate operational signals.
