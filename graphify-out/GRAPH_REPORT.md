# Graph Report - kellllly  (2026-11-04)

## Corpus Check
- 149 files · ~69,723 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: (none) 4, .example 1, .css 1)

## Summary
- 1424 nodes · 2764 edges · 105 communities (62 shown, 43 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 50 edges (avg confidence: 0.85)
- Token cost: 129,377 input · 0 output

## Community Hubs (Navigation)
- Lockfile Overrides
- Role Archive Envelope Types
- Docs: Ops & Governance
- React Query Mutations
- shadcn UI Primitives
- ITSM Workspace Core
- Zod API Validators
- Desk UI Kit
- App Routing & Auth
- Shell & Notifications
- Custom Fetch Client
- CI Workflow
- ITSM Routes & Role Archive
- Ticket Form Parts
- Audit Filters & Export
- API Schema Types
- pnpm Workspace Catalog
- HTTP Hardening & App
- Ticket Lifecycle Domain
- Store & Sync Recovery State
- Seed Data & Migration
- API Server Dependencies
- ITSM RBAC
- Base TS Config
- Desk Dev Dependencies
- Desk Package Manifest
- Sync Conflict Merge
- Build & Dev Archive Config
- Root Package Manifest
- Recovery Draft Guard
- shadcn Components Config
- Workspace & Audit Queries
- Desk TS Config
- API Server Dev Deps
- DB Package Manifest
- Role Admin & Save Refusal
- Dev Role Archive Storage
- Scripts Package
- Vite Config
- API Server TS Config
- API Client Package
- Settings & Directory Queries
- API Client TS Config
- DB Schema
- DB TS Config
- API Zod TS Config
- Server Startup & Logger
- ITSM User Directory
- Role Archive Health Monitor
- API Spec Codegen
- API Zod Package
- DB Dependencies
- Health Route
- Scripts TS Config
- Clerk Frontend Deps
- Codegen & Drizzle Config
- Desk Scripts
- API Server Scripts
- Root TS Config
- Assign Role Mutation
- Attest Role Mutation
- Recovery Flight Guard
- DB Push Scripts
- Dep: clsx
- Dep: cmdk
- Dep: date-fns
- Dep: embla-carousel-react
- Dep: @hookform/resolvers
- Dep: input-otp
- Dep: next-themes
- Dep: @radix-ui/react-accordion
- Dep: @radix-ui/react-alert-dialog
- Dep: @radix-ui/react-aspect-ratio
- Dep: @radix-ui/react-context-menu
- Dep: @radix-ui/react-dropdown-menu
- Dep: @radix-ui/react-label
- Dep: @radix-ui/react-menubar
- Dep: @radix-ui/react-navigation-menu
- Dep: @radix-ui/react-popover
- Dep: @radix-ui/react-progress
- Dep: @radix-ui/react-scroll-area
- Dep: @radix-ui/react-separator
- Dep: @radix-ui/react-slider
- Dep: @radix-ui/react-slot
- Dep: @radix-ui/react-switch
- Dep: @radix-ui/react-toast
- Dep: @radix-ui/react-toggle-group
- Dep: react-day-picker
- Dep: react-hook-form
- Dep: react-icons
- Dep: react-resizable-panels
- Dep: recharts
- Dep: @replit/vite-plugin-cartographer
- Dep: sonner
- Dep: tailwind-merge
- Dep: tailwindcss
- Dep: @tailwindcss/typography
- Dep: tw-animate-css
- Dep: @types/react
- Dep: @types/react-dom
- Dep: @workspace/api-client-react
- API Codegen Check
- Post-merge Script

## God Nodes (most connected - your core abstractions)
1. `overrides` - 87 edges
2. `cn()` - 30 edges
3. `StoreProvider()` - 29 edges
4. `TicketsPage()` - 29 edges
5. `useStore()` - 26 edges
6. `formatWAT()` - 24 edges
7. `catalog` - 23 edges
8. `compilerOptions` - 23 edges
9. `Button()` - 22 edges
10. `customFetch()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `No certified encryption/E2EE/immutable log claimed` --semantically_similar_to--> `Unrealized requirements (E2EE, WORM, SIEM, replication, homologation)`  [INFERRED] [semantically similar]
  replit.md → docs/specification-coverage.md
- `Save-rejection reload / Resynchroniser behavior` --conceptually_related_to--> `Browser acceptance paths (conversion, SLA, CAB, KEDB, export, theme)`  [INFERRED]
  replit.md → docs/recette-pilote-anif.md
- `StoreProvider()` --calls--> `getItsmWorkspace()`  [EXTRACTED]
  artifacts/anif-secure-desk/src/lib/store.tsx → lib/api-client-react/src/generated/api.ts
- `StoreProvider()` --calls--> `importItsmExamples()`  [EXTRACTED]
  artifacts/anif-secure-desk/src/lib/store.tsx → lib/api-client-react/src/generated/api.ts
- `StoreProvider()` --calls--> `saveItsmWorkspace()`  [EXTRACTED]
  artifacts/anif-secure-desk/src/lib/store.tsx → lib/api-client-react/src/generated/api.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **ITSM role governance flow (bootstrap, assignment, attestation, archive, alerting)** — docs_itsm_role_administration_n1_bootstrap, docs_itsm_role_administration_role_assignment, docs_itsm_role_administration_role_attestation, docs_itsm_role_administration_role_change_archive, artifacts_api_server_operations_external_role_archive, artifacts_api_server_operations_archive_alerts [INFERRED 0.85]
- **ITSM ticket lifecycle (qualification, SLA, CAB, conversion, KEDB closure)** — docs_specification_coverage_impact_urgency_matrix, docs_specification_coverage_continuous_time_sla_clock, docs_specification_coverage_cab_approval, docs_specification_coverage_messaging_ticketing_gateway, docs_specification_coverage_kedb_closure, docs_recette_pilote_anif_acceptance_paths [INFERRED 0.85]

## Communities (105 total, 43 thin omitted)

### Community 0 - "Lockfile Overrides"
Cohesion: 0.02
Nodes (87): overrides, brace-expansion@^5, esbuild, esbuild>@esbuild/aix-ppc64, esbuild>@esbuild/android-arm, esbuild>@esbuild/android-arm64, esbuild>@esbuild/android-x64, esbuild>@esbuild/darwin-arm64 (+79 more)

### Community 1 - "Role Archive Envelope Types"
Cohesion: 0.06
Nodes (28): DevelopmentRoleArchiveEnvelope, DevelopmentRoleArchiveEnvelopeEvent, DevelopmentRoleArchiveEnvelopeEventOrigin, DevelopmentRoleArchiveEnvelopeEventType, DevelopmentRoleArchiveEnvelopeSchemaVersion, DevelopmentRoleArchiveEnvelopeSource, DevelopmentRoleArchiveReceipt, ExportItsmAuditParams (+20 more)

### Community 2 - "Docs: Ops & Governance"
Cohesion: 0.05
Nodes (56): ANIF Gabon — Poste de pilotage (index.html), /src/main.tsx module entry, robots noindex,nofollow meta (non-homologated demo), Favicon (ANIF green shield, same as logo), ANIF logo (green shield with checkmark), robots.txt (Disallow all), Alerts itsm_role_archive_unavailable / itsm_role_archive_recovered, Development role-archive receiver (/api/itsm/development-role-archive) (+48 more)

### Community 3 - "React Query Mutations"
Cohesion: 0.05
Nodes (55): appendDevelopmentRoleArchive(), AppendDevelopmentRoleArchiveMutationBody, AppendDevelopmentRoleArchiveMutationError, AppendDevelopmentRoleArchiveMutationResult, AppendDevelopmentRoleArchiveMutationVariables, AssignItsmRoleMutationBody, AssignItsmRoleMutationError, AssignItsmRoleMutationResult (+47 more)

### Community 4 - "shadcn UI Primitives"
Cohesion: 0.07
Nodes (44): class-variance-authority@catalog:, Badge(), BadgeProps, badgeVariants, Button, ButtonProps, buttonVariants, Card (+36 more)

### Community 5 - "ITSM Workspace Core"
Cohesion: 0.09
Nodes (37): ItsmActor, ALLOWED_TRANSITIONS, applyWorkspaceUpdate(), canonicalJson(), eventFor(), findItsmRoleReconciliationIssues(), importMerge(), isRecord() (+29 more)

### Community 6 - "Zod API Validators"
Cohesion: 0.05
Nodes (41): appendDevelopmentRoleArchiveBodyEventActionMax, appendDevelopmentRoleArchiveBodyEventActorMax, appendDevelopmentRoleArchiveBodyEventAtMax, appendDevelopmentRoleArchiveBodyEventIdMax, appendDevelopmentRoleArchiveBodyEventNextRoleMax, appendDevelopmentRoleArchiveBodyEventPreviousRoleMax, appendDevelopmentRoleArchiveBodyEventPreviousServiceIdsItemMax, appendDevelopmentRoleArchiveBodyEventPreviousServiceIdsMax (+33 more)

### Community 7 - "Desk UI Kit"
Cohesion: 0.15
Nodes (26): Badge(), EmptyState(), inputCls, keepFocusedFieldVisible(), MiniStat(), Modal(), pad2(), SearchBox() (+18 more)

### Community 8 - "App Routing & Auth"
Cohesion: 0.08
Nodes (19): App(), AuthenticatedDesk(), AuthSetupPage(), basePath, clerkAppearance, clerkKeyMissing, ClerkRouter(), HomeRedirect() (+11 more)

### Community 9 - "Shell & Notifications"
Cohesion: 0.16
Nodes (27): Metric(), initials(), meta, navItems, NotificationBell(), Shell(), SyncRecoveryActions(), SlaBar() (+19 more)

### Community 10 - "Custom Fetch Client"
Cohesion: 0.12
Nodes (29): ApiError, applyBaseUrl(), AuthTokenGetter, BodyType, buildErrorMessage(), customFetch(), CustomFetchOptions, ErrorType (+21 more)

### Community 11 - "CI Workflow"
Cohesion: 0.06
Nodes (32): BASE_PATH, DATABASE_URL, PORT, POSTGRES_DB, POSTGRES_PASSWORD, jobs, verify, name (+24 more)

### Community 12 - "ITSM Routes & Role Archive"
Cohesion: 0.11
Nodes (29): itsmRoleName(), checkItsmRoleArchiveConnection(), getItsmRoleArchiveConfig(), isDevelopmentDatabaseRoleArchiveEnabled(), ItsmRoleArchiveUnavailableError, publishItsmRoleChangeToArchive(), activeN1Ids(), actorOrReply() (+21 more)

### Community 13 - "Ticket Form Parts"
Cohesion: 0.11
Nodes (25): textareaCls, STATE_LABEL, TicketDraft, ASSIGNEES, CATEGORIES, KINDS, LEVEL_LABEL, Priority (+17 more)

### Community 14 - "Audit Filters & Export"
Cohesion: 0.14
Nodes (22): Avatar(), AUDIT_EMPTY_STATE_MESSAGE, auditEventsToCsv(), AuditFilterResult, AuditFilters, createAuditExportRunner(), csvCell(), filterAuditEvents() (+14 more)

### Community 15 - "API Schema Types"
Cohesion: 0.07
Nodes (28): DevelopmentRoleArchiveEnvelope, DevelopmentRoleArchiveEnvelopeEvent, DevelopmentRoleArchiveEnvelopeEventOrigin, DevelopmentRoleArchiveEnvelopeEventType, DevelopmentRoleArchiveEnvelopeSchemaVersion, DevelopmentRoleArchiveEnvelopeSource, DevelopmentRoleArchiveReceipt, ExportItsmAuditParams (+20 more)

### Community 16 - "pnpm Workspace Catalog"
Cohesion: 0.07
Nodes (28): autoInstallPeers, catalog, class-variance-authority, clsx, drizzle-orm, framer-motion, lucide-react, react (+20 more)

### Community 17 - "HTTP Hardening & App"
Cohesion: 0.13
Nodes (17): cors@^2.8.6, allowedCorsOrigins(), AUTH_NOT_CONFIGURED_MESSAGE, authNotConfigured(), corsOptions(), Environment, ErrorLogger, isAuthConfigured() (+9 more)

### Community 18 - "Ticket Lifecycle Domain"
Cohesion: 0.20
Nodes (24): Button(), Field(), emptyDraft(), fmtMinutes(), PriorityPreview(), TicketForm(), closeResolvedTicket(), nextKedbId() (+16 more)

### Community 19 - "Store & Sync Recovery State"
Cohesion: 0.14
Nodes (23): recoveryKey(), changedSectionNames(), clearSyncRecoveryDraft(), Ctx, fieldLabels, formatChangedPaths(), isSharedData(), isVersionConflict() (+15 more)

### Community 20 - "Seed Data & Migration"
Cohesion: 0.13
Nodes (23): baseStore(), extraTickets(), iso(), LEGACY_CONVERSATIONS, LEGACY_PRIORITY, LEGACY_TICKETS, lvl(), migrate() (+15 more)

### Community 21 - "API Server Dependencies"
Cohesion: 0.11
Nodes (24): dependencies, @clerk/express@^2.1.85, @clerk/shared@^4.43.0, cookie-parser@^1.4.7, drizzle-orm@catalog:, express@^5.3.0, http-proxy-middleware@^4.2.1, pino@^9.14.0 (+16 more)

### Community 22 - "ITSM RBAC"
Cohesion: 0.15
Nodes (19): canChangeItsmRole(), canPerform(), isBootstrapAdmin(), isItsmRole(), ITSM_ROLES, ItsmAuthorizationError, ItsmPermission, metadataForItsmBootstrap() (+11 more)

### Community 23 - "Base TS Config"
Cohesion: 0.08
Nodes (23): compilerOptions, alwaysStrict, customConditions, incremental, isolatedModules, lib, module, moduleResolution (+15 more)

### Community 24 - "Desk Dev Dependencies"
Cohesion: 0.09
Nodes (23): devDependencies, lucide-react@catalog:, @radix-ui/react-dialog@^1.1.7, @radix-ui/react-hover-card@^1.1.7, @radix-ui/react-radio-group@^1.2.4, @radix-ui/react-select@^2.1.7, @radix-ui/react-tooltip@^1.2.0, react@19.1.4 (+15 more)

### Community 25 - "Desk Package Manifest"
Cohesion: 0.10
Nodes (20): framer-motion@catalog:, @radix-ui/react-avatar@^1.1.4, @radix-ui/react-checkbox@^1.1.5, @radix-ui/react-collapsible@^1.1.4, @radix-ui/react-tabs@^1.1.4, @radix-ui/react-toggle@^1.1.3, @replit/vite-plugin-dev-banner@catalog:, @types/node@catalog: (+12 more)

### Community 26 - "Sync Conflict Merge"
Cohesion: 0.19
Nodes (18): changedPaths(), choicesForRecoveryVersion(), confirmSharedRecovery(), ConflictChoices, conflictDetails(), equal(), isRecord(), keyedArray() (+10 more)

### Community 27 - "Build & Dev Archive Config"
Cohesion: 0.17
Nodes (7): artifactDir, esbuild@0.28.2, DEVELOPMENT_ROLE_ARCHIVE_PATH, developmentRoleArchiveConfig(), developmentRoleArchiveEnabled(), Environment, esbuild

### Community 28 - "Root Package Manifest"
Cohesion: 0.12
Nodes (18): dependencies, @replit/connectors-sdk@^0.4.3, devDependencies, prettier@^3.9.10, typescript@~5.9.3, license, name, private (+10 more)

### Community 29 - "Recovery Draft Guard"
Cohesion: 0.16
Nodes (6): Draft, identity(), RecoveryDraftGuard, watchRecoveryDraft(), MemoryStorage, setup()

### Community 30 - "shadcn Components Config"
Cohesion: 0.12
Nodes (16): aliases, components, hooks, lib, ui, utils, rsc, $schema (+8 more)

### Community 31 - "Workspace & Audit Queries"
Cohesion: 0.12
Nodes (16): exportItsmAudit(), getExportItsmAuditQueryKey(), getExportItsmAuditQueryOptions(), getExportItsmAuditUrl(), getGetItsmWorkspaceQueryKey(), getGetItsmWorkspaceQueryOptions(), getGetItsmWorkspaceUrl(), getHealthCheckQueryKey() (+8 more)

### Community 32 - "Desk TS Config"
Cohesion: 0.13
Nodes (14): compilerOptions, allowImportingTsExtensions, jsx, lib, moduleResolution, noEmit, paths, resolveJsonModule (+6 more)

### Community 33 - "API Server Dev Deps"
Cohesion: 0.13
Nodes (15): devDependencies, esbuild-plugin-pino@^2.3.3, pino-pretty@^13.2.0, thread-stream@3.1.0, @types/cookie-parser@^1.4.10, @types/cors@^2.8.19, @types/express@^5.0.6, @types/node@catalog: (+7 more)

### Community 34 - "DB Package Manifest"
Cohesion: 0.18
Nodes (13): devDependencies, drizzle-kit@^0.31.11, @types/node@catalog:, @types/pg@^8.23.1, exports, ./schema, @types/node, name (+5 more)

### Community 35 - "Role Admin & Save Refusal"
Cohesion: 0.24
Nodes (7): RoleOperation, roleRequestError(), roleServiceIds(), refusalReason(), SaveRefusalOutcome, saveRefusalOutcome(), SUSPENDED_EDIT_MESSAGE

### Community 36 - "Dev Role Archive Storage"
Cohesion: 0.18
Nodes (7): canonical(), developmentArchiveRepository, createDevelopmentRoleArchiveRouter(), DevelopmentArchiveRepository, envelopeSchema, AppendDevelopmentRoleArchiveBody, AppendDevelopmentRoleArchiveResponse

### Community 37 - "Scripts Package"
Cohesion: 0.18
Nodes (12): tsx, devDependencies, tsx@catalog:, @types/node@catalog:, @types/node, name, private, scripts (+4 more)

### Community 38 - "Vite Config"
Cohesion: 0.17
Nodes (9): @replit/vite-plugin-runtime-error-modal@catalog:, @tailwindcss/vite@catalog:, vite@catalog:, @vitejs/plugin-react@catalog:, port, @replit/vite-plugin-runtime-error-modal, @tailwindcss/vite, vite (+1 more)

### Community 39 - "API Server TS Config"
Cohesion: 0.17
Nodes (11): compilerOptions, allowImportingTsExtensions, incremental, outDir, rootDir, tsBuildInfoFile, types, extends (+3 more)

### Community 40 - "API Client Package"
Cohesion: 0.20
Nodes (11): dependencies, @tanstack/react-query@catalog:, exports, react, @tanstack/react-query, name, peerDependencies, react@>=18 (+3 more)

### Community 41 - "Settings & Directory Queries"
Cohesion: 0.20
Nodes (11): SettingsPage(), checkItsmRoleArchive(), getCheckItsmRoleArchiveMutationKey(), getCheckItsmRoleArchiveMutationOptions(), getCheckItsmRoleArchiveUrl(), getGetItsmUserDirectoryQueryKey(), getGetItsmUserDirectoryQueryOptions(), getGetItsmUserDirectoryUrl() (+3 more)

### Community 42 - "API Client TS Config"
Cohesion: 0.18
Nodes (10): compilerOptions, composite, declarationMap, emitDeclarationOnly, lib, outDir, rootDir, extends (+2 more)

### Community 43 - "DB Schema"
Cohesion: 0.22
Nodes (6): db, pool, insertItsmDevelopmentRoleArchiveSchema, ItsmDevelopmentRoleArchive, itsmDevelopmentRoleArchiveTable, itsmWorkspaceTable

### Community 44 - "DB TS Config"
Cohesion: 0.18
Nodes (10): compilerOptions, composite, declarationMap, emitDeclarationOnly, outDir, rootDir, types, extends (+2 more)

### Community 45 - "API Zod TS Config"
Cohesion: 0.20
Nodes (9): compilerOptions, composite, declarationMap, emitDeclarationOnly, outDir, rootDir, extends, include (+1 more)

### Community 46 - "Server Startup & Logger"
Cohesion: 0.33
Nodes (7): app, port, start(), initializeDevelopmentRoleArchive(), createItsmRoleReconciliationMonitor(), logger, scanItsmRoleReconciliation()

### Community 47 - "ITSM User Directory"
Cohesion: 0.31
Nodes (7): ItsmRole, ClerkDirectoryUser, ItsmDirectoryAccount, ItsmDirectoryQuery, parseInteger(), parseItsmDirectoryQuery(), toItsmDirectoryAccount()

### Community 48 - "Role Archive Health Monitor"
Cohesion: 0.31
Nodes (7): createItsmRoleArchiveHealthMonitor(), ITSM_ROLE_ARCHIVE_RECOVERED_ALERT, ITSM_ROLE_ARCHIVE_UNAVAILABLE_ALERT, ItsmRoleArchiveSignalSource, OperationalLogger, reportItsmRoleArchiveUnavailable(), bootstrapItsmAdmin

### Community 49 - "API Spec Codegen"
Cohesion: 0.25
Nodes (8): devDependencies, orval@^8.41.0, name, private, scripts, codegen, version, orval

### Community 50 - "API Zod Package"
Cohesion: 0.25
Nodes (8): dependencies, zod@catalog:, exports, zod, name, private, type, version

### Community 51 - "DB Dependencies"
Cohesion: 0.22
Nodes (9): dependencies, drizzle-orm@catalog:, drizzle-zod@^0.8.3, pg@^8.23.1, zod@catalog:, drizzle-orm, zod, drizzle-zod (+1 more)

### Community 52 - "Health Route"
Cohesion: 0.32
Nodes (5): router, router, router, HealthCheckResponse, express

### Community 53 - "Scripts TS Config"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, types, extends, include, ../tsconfig.base.json

### Community 54 - "Clerk Frontend Deps"
Cohesion: 0.29
Nodes (7): dependencies, @clerk/localizations@^4.24.3, @clerk/react@^6.18.3, @clerk/themes@^2.4.57, @clerk/localizations, @clerk/react, @clerk/themes

### Community 55 - "Codegen & Drizzle Config"
Cohesion: 0.29
Nodes (3): apiClientReactSrc, apiZodSrc, root

### Community 56 - "Desk Scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, serve, test, typecheck

### Community 57 - "API Server Scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, start, test, typecheck

### Community 58 - "Root TS Config"
Cohesion: 0.33
Nodes (5): compileOnSave, extends, files, ./tsconfig.base.json, references

### Community 59 - "Assign Role Mutation"
Cohesion: 0.40
Nodes (5): assignItsmRole(), getAssignItsmRoleMutationKey(), getAssignItsmRoleMutationOptions(), getAssignItsmRoleUrl(), useAssignItsmRole()

### Community 60 - "Attest Role Mutation"
Cohesion: 0.40
Nodes (5): attestItsmRole(), getAttestItsmRoleMutationKey(), getAttestItsmRoleMutationOptions(), getAttestItsmRoleUrl(), useAttestItsmRole()

### Community 62 - "DB Push Scripts"
Cohesion: 0.67
Nodes (3): scripts, push, push-force

## Ambiguous Edges - Review These
- `robots noindex,nofollow meta (non-homologated demo)` → `robots.txt (Disallow all)`  [AMBIGUOUS]
  artifacts/anif-secure-desk/index.html · relation: conceptually_related_to
- `Favicon (ANIF green shield, same as logo)` → `ANIF logo (green shield with checkmark)`  [AMBIGUOUS]
  artifacts/anif-secure-desk/public/logo.svg · relation: conceptually_related_to

## Knowledge Gaps
- **22 isolated node(s):** `../../tsconfig.base.json`, `RFC-7230`, `../../tsconfig.base.json`, `../../tsconfig.base.json`, `../../tsconfig.base.json` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 549 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **43 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@clerk/react` connect `Clerk Frontend Deps` to `Desk UI Kit`, `App Routing & Auth`, `Shell & Notifications`, `Store & Sync Recovery State`, `Desk Package Manifest`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **What connects `../../tsconfig.base.json`, `RFC-7230`, `../../tsconfig.base.json` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Lockfile Overrides` be split into smaller, more focused modules?**
  _Cohesion score 0.022988505747126436 - nodes in this community are weakly interconnected._
- **Why does `express` connect `Health Route` to `Dev Role Archive Storage`, `ITSM Workspace Core`, `Zod API Validators`, `ITSM Routes & Role Archive`, `HTTP Hardening & App`, `API Server Dependencies`, `ITSM RBAC`, `Build & Dev Archive Config`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Should `Role Archive Envelope Types` be split into smaller, more focused modules?**
  _Cohesion score 0.06390977443609022 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_None remaining: the robots.txt/noindex conflict and the favicon/logo mismatch were fixed in the source._
