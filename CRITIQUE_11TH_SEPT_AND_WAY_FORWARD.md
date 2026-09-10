# Critique (11th Sept 2026) and Way Forward

**Repository:** github.com/Nopenope69/MES
**Audited commit:** `9531c65` (docs(memory): update PROJECT_MEMORY to v9.1.0)
**Date:** 11 September 2026

---

## Verdict

Don't sell this or deploy it to a paying customer yet. Commercialization readiness is about **25/100** and engineering completion is about **35%**.

**First move:** get CI running on GitHub so every later fix gets verified (see the Next Step section at the end).

---

## How this audit was done

I cloned the repo (71 commits, 3 to 11 Sep 2026, one author), installed it, type-checked it and ran the full test suite. Then I booted the server against a real PostgreSQL 16 instance and probed it with curl.

**Inspected in depth:**
- Database layer, schema and migrations
- `server.ts`, auth middleware, secrets config and onboarding
- Compliance router and controller
- Route authorization coverage across all 15 routers
- Fuji Nexim adapter, CFX adapter, the KIC importer and its fixtures
- Frontend API calls
- Dockerfiles, docker-compose, Caddy, nginx, CI file, backup script and release artifacts

**Not inspected line by line:**
- Correctness of the MSL, solder paste, SPI, predictive, AGV and traceability module internals
- Helm templates and the K8s CRD
- `jwt.ts` and `session-manager.ts`
- Accuracy of `openapi.json`
- Rendering of the web components
- Runbooks and the internals of `mes-doctor.ts`

Scores for those areas lean on test presence rather than full review.

---

## Executive Verdict

**What's built.** A large, well-typed TypeScript monorepo for an SMT-line MES:
- Express API
- React 19 cockpit with about 10 stations
- Zod shared schemas
- A Fuji Nexim TCP gateway
- Domain logic for splicing verification, JEDEC MSL, solder paste, AOI/SPI, rework, reflow profiling, AGV, predictive quality, genealogy/recall, eDHR and a hash-chained audit ledger

It compiles under strict mode with zero errors, and 276 of 277 tests pass.

**What's mature.** Domain modeling and vocabulary (`CONTEXT.md`, ADRs), service-level unit tests, the Fuji frame parser's defensive guards, and the authentication primitives (Argon2 PINs, refresh rotation, lockout).

**What's immature.** Nearly everything between the code and a real factory:
- The shipped Docker image crashes on boot.
- The compose Postgres init fails.
- A fresh Postgres deployment can't be provisioned.
- The UI has no login, so it gets 401 on every call.
- Roughly 88% of route handlers have no authorization check.
- Every machine integration is either unverified against real equipment or mocked.

**Biggest risks:**
1. Quality and compliance actions record whoever the request body says did them.
2. The "production hold" never touches the machine.
3. The traceability screen shows fixture data by default.

**Would I deploy this to a paying customer today?** No. It's a strong demo and simulator, not a product. It's also further from a supervised pilot than the in-repo audit claims. `PROJECT_MEMORY.md` and `docs/audit/re-audit-report.md` claim a 9.3/10 audit score, and this review contradicts that.

---

## 1. What Actually Exists

The product is "Antigravity SMT MES Engine": an on-prem, edge MES for Indian EMS SMT lines, built around Fuji NXT pick-and-place machines. The seed data is a real-named "Dixon Technologies Noida Line 01".

**Architecture:**
- `packages/shared` holds Zod schemas and domain types.
- `apps/api` is Express 4 with a dual database driver (`node:sqlite` by default, `pg` optional). It has 15 routers, about 40 services, CQRS-style projectors, and a TCP listener on port 30040.
- `apps/web` is React 19, Vite and Tailwind.
- `deploy/` holds Caddy, Helm, a K8s CRD, SRE runbooks and a CI file.
- `release/` holds a Windows simulator: a roughly 60 MB unsigned `.exe` committed as 12 git chunks.

**Scale:** about 48.6k lines of TS, SQL and YAML, tests included. There are 62 tables in `schema.sql`.

**How it was built:** the commit cadence (entire subsystems in minutes) and the vendored `.agent/skills/` directory (about 50 generic agent skills, including `slack-gif-creator` and `algorithmic-art`) show it was written largely by an AI coding agent in about 8 days. That isn't a problem in itself. It does explain the pattern throughout: broad, confident surface area with thin end-to-end wiring.

**Not present at all:**
- Licensing
- Billing
- Per-customer configuration
- A working first-run provisioning path
- Any real machine vendor SDK or broker client (no AMQP dependency exists)

---

## 2. Feature-by-Feature Status

| Feature | State | Evidence | What remains | Impact |
|---|---|---|---|---|
| Fuji Nexim TCP gateway | 🟠 Prototype | `adapters/fuji-nexim.adapter.ts` has 64 KB guards, an IP allowlist and idle timeout. Tested only against its own `fuji-simulator.ts`. | Validate against a real NXT and the vendor spec. Per-machine mapping. | Critical |
| Multi-line support at the gateway | 🔴 | `startListener(port, workCenterId = 'wc-nxt-01')` at line 488. Handshake replies hardcode `'NXT01'`. | Map connections to machines by source or machine ID. | Critical |
| Splicing interlock (BOM check → NG ACK) | 🟡 Partial | `processSingleFrame` writes an NG ACK on a mismatch (around line 472). This is the only real physical control path. | Hardware validation. Operator UI can't reach `/smt/splice-verify` (401). | Critical |
| Production hold / repeat-defect halt | 🔴 Stub (physically) | `tripProductionHold()` (lines 635–648) sets an in-memory flag and updates a DB row. No command is sent to the machine. | Real inhibit command, or relabel as advisory only. | Critical |
| MSL floor-life (JEDEC) | 🟡 | `msl.service.ts` plus `msl-lifecycle.test.ts` | Validate bake and floor-life tables. Authz on routes. | High |
| Solder paste lifecycle | 🟡 | `solder-paste.service.ts` plus tests | Authz. Real barcode and scale flow. | High |
| AOI ingestion, rework, disposition | 🟠 | Koh Young adapter uses `JSON.parse` but advertises XML. Vendor formats are self-authored. `authorizedBy` comes from the request body (`aoi.router.ts:83`). | Real vendor files. Identity from the session. | High |
| SPI and printer closed-loop tuning | 🔴 Mock actuation | `cfx-amqp.adapter.ts:16–24` uses `MockCfxAmqpBroker`. No AMQP client dependency. | Real CFX broker, or defer the feature. | Medium |
| Reflow profiling (KIC/Datapaq/MOLE, PWI, drift) | 🟠 | KIC parser reads an invented INI-style text format (`fixtures/reflow/kic-golden.kic`). Drift accepts `simulatedTelemetry` from the API. | Real profiler exports and an oven telemetry source. | Medium |
| Traceability, genealogy, recall | 🟡 backend / 🟠 UI | Best-guarded router (7/7 routes with `REPORTS_VIEW`). UI `traceability.api.ts` has `fixtureModeEnabled = true` and falls back to fixtures. | Fixtures off by default in production builds. | Critical |
| eDHR and compliance ledger | 🟠 | Hash chain exists, but see Security S2. Append-only DB grants are commented out in `schema.sql`. | Identity binding, DB-level immutability, validation. | High |
| Authentication | 🟢 needs hardening | Argon2/bcrypt PIN, JWT plus refresh rotation, lockout; tests `auth-pin-security`, `auth-token-rotation` | Constant-time key compare. Session review. | High |
| Authorization / RBAC | 🟠 | About 12 of about 99 route handlers carry `requirePermission` or `apiKeyAuth` | Guard every mutating route. | Critical |
| Provisioning / onboarding | 🔴 Unreachable | `server.ts` bootstrap calls `OnboardingService.setState('PRODUCTION_ACTIVE')` unconditionally. State is in memory only. | Persisted state and a first-run flow. | Critical |
| Web cockpit (about 10 stations) | 🟠 | No login screen. Nothing sets `mes_access_token`. IDs like `JOB-SM-260901` and `PROG-SM-METER-TOP-REV4` are hardcoded. | Login, token handling, remove demo IDs. | Critical |
| AGV logistics | 🟠 | State machine only. No vendor fleet integration. | Defer. | Low |
| Predictive quality | 🟠 | Statistics over seeded or synthetic telemetry. No live data source. | Defer. | Low |
| OEE and reports | 🟡 | `oee-report.service.ts` (not deep-verified) | Validate against real shift data. | Medium |
| PostgreSQL mode | 🔴 | See Section 6. Fresh boot skips the seed and leaves no users. | Fix types. Single schema source. | Critical |
| Docker, compose, Helm | 🔴 / unverified | API image crashes at boot. Compose Postgres init fails. Helm not inspected. | Rebuild on Node 22. Fix init. | Critical |
| CI/CD | 🔴 Not running | File is at `deploy/ci/ci.yml`, not `.github/workflows/` | Move it and make the gates real. | Critical |
| Backup and DR | 🟠 | `scripts/backup.sh` falls back to `cp` of a live WAL-mode SQLite file. It's a snapshot, not point-in-time recovery. No encryption. | Postgres-native backups and a tested restore. | High |
| Observability | 🟡 | Prometheus `/metrics` exists but is unauthenticated. No alert rules verified. | Alerting and log shipping. | Medium |
| Licensing and billing | ❌ | Nothing in the repo | Minimal license key per site. | Medium |
| Windows simulator `.exe` | 🟠 Demo | Built 9 Sep at 14:23, before all security commits (17:17 onward). Unsigned. | Rebuild from CI and sign, or remove from git. | Low |

---

## 3. Architecture Assessment

**Strengths:**
- The three-tier ingress → canonical event → projection design is right for an MES.
- The ISA-95 hierarchy is correct.
- Deep-module seams (`event-store`, `machine-control`, `material-gate`, `defect-lifecycle`) are sensible.
- Strict TypeScript and a shared schema package cut down on drift.

**Weaknesses that will cause rework:**

1. **Dual-dialect database with SQLite as the default.** `NodeSqliteDatabase.withTransaction` uses one connection and a `transactionDepth` counter (`database.ts`). A second async request that arrives mid-transaction sees depth > 0, joins the first request's transaction, and gets rolled back with it. This comes from reading the code; it wasn't load-tested. For a multi-station plant this is a data-integrity bug waiting to happen. Postgres should be the product and SQLite only the simulator.

2. **Three schema sources plus silent patching.** The schema lives in three places:
   - `schema.sql` (62 tables, zero foreign keys)
   - `schema-sql.ts` (an embedded copy for the `.exe`)
   - `migrations/001–005`

   On top of that, `initDatabase()` runs about 40 `ALTER TABLE` statements wrapped in `try {} catch {}`, with defaults `'org-dixon'` and `'site-noida-p4'`. Any failure is swallowed. This is the single most expensive thing to fix after the first customer has data.

3. **The Postgres adapter rewrites SQL with a regex.** `sql.replace(/\?/g, ...)` also rewrites `?` inside string literals. Postgres also returns `COUNT(*)` as a string, which already breaks auto-seed (verified). Expect more type-coercion bugs anywhere numeric results are compared.

4. **Critical state lives in process memory.** Onboarding state and production holds live in static fields and are lost on restart. There's no HA story, and the Fuji listener is a single point of failure per line.

5. **Scope sprawl.** AGV, predictive, chaos engineering, printer auto-tuning and reflow closed loop are each shallow. They multiply the security and test surface without making the core sellable.

---

## 4. Security Assessment

**Known vulnerabilities (evidenced in code or reproduced):**

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| S1 | Critical | Roughly 87 of about 99 handlers only check that you're logged in. Any OPERATOR can modify printer parameters, clear interlocks, execute predictive actions and replay projections. | `spi.router.ts:209`, `aoi.router.ts:211`, `predictive.router.ts:101`, `smt.router.ts:378` |
| S2 | Critical | Actor identity is taken from the request body. This makes Part 11 attribution forgeable by any logged-in user. | `aoi/disposition` (`authorizedBy`); `aoi/interlocks/clear`; `predictive/actions/:id/authorize` (defaults to `'sys-quality-lead'`); `compliance.router.ts:45` legacy `/ledger/sign` (arbitrary `actorId` and `actorRole`); DHR release `qaReviewerId` (line 175) |
| S3 | Critical outside production mode | Default JWT secret and API key are hardcoded in a public repo and used whenever `NODE_ENV` isn't `production`. That includes the simulator. Anyone can forge an admin token. | `config/secrets.ts` (`jwtSecret`, `apiKeySecret` defaults) |
| S4 | High | A single shared API key grants SYSTEM_ADMIN with a hardcoded `org-dixon` scope. The comparison isn't constant-time. It bypasses the code's own separation-of-duties rule, because DHR release uses `apiKeyAuth` instead of `QUALITY_APPROVE`. The dev key also ships in the frontend bundle. | `auth.middleware.ts` API-key branch; `CleanroomComplianceStation.tsx:113` |
| S5 | High | Compose publishes API port 4000 and OT port 30040 directly on the host, bypassing Caddy. `/metrics` is public on the API. Adminer is still in compose under the `debug` profile, despite the commit that says it was removed. The Postgres password is hardcoded. | `docker-compose.yml` |
| S6 | High | The OT socket has no authentication. Any host in the allowlist (default includes `192.168.10.0/24`) can inject production events and splice approvals. | `fuji-nexim.adapter.ts` `startListener` |
| S7 | Medium | Wide-open CORS (`cors()`), a 20 MB JSON limit, and a CSP that allows `unsafe-inline` and `unpkg`. | `server.ts`, `Caddyfile` |
| S8 | Medium | 5 moderate npm advisories (`qs` via express; vitest mocker). | `npm audit` |
| S9 | Medium | Ledger append-only is enforced only by HTTP 405 routes. The DB `GRANT`/`REVOKE` lines are commented out. | `schema.sql` compliance section |

**Architectural security risks:**
- There's no per-service credential model.
- Tenant scoping defaults to a hardcoded org.
- The shared-transaction SQLite bug can cause cross-request data corruption.

**Hardening recommendations:**
- Constant-time comparisons for keys
- Per-machine OT allowlisting
- Signed release artifacts (the "signed attestations" commit only echoes a banner)
- Rate limits on login (only `splice-verify` is rate-limited in `server.ts`)

---

## 5. Testing & QA Assessment

**Measured results:**
- 34 files and 277 tests.
- 276 pass. One fails in the full run (`security-track-g.test.ts:277`, expected 200 but got 500) and passes in isolation, so the tests share state.
- Type-check is clean for both apps.

**What's covered:** service-level domain logic across every phase, the auth primitives, frame parsing, ledger hash verification, and some HTTP endpoints.

**What's not covered:**
- Postgres (every test runs on SQLite)
- UI-to-API integration (would have caught the missing login immediately)
- End-to-end browser flows (the web app has one test file)
- Concurrency
- Migrations and upgrades
- Real vendor files
- Real hardware
- Authorization per role per route. The "route inventory auth coverage" test checks authentication only.

**Would CI catch a regression?** No. CI doesn't run (see Section 6). Even if it did, its Node 20 leg would fail on `node:sqlite`, and the SAST step ends in `|| true`.

---

## 6. Deployment & Operations Assessment

**Could a competent engineer deploy this to a customer tomorrow without fixing the application?** No. Three blockers, each reproduced:

1. **The API container crashes at boot.** The Dockerfile uses `node:20-alpine`, and `database.ts:3` statically imports `node:sqlite`. On Node 20.20.2 that throws `ERR_UNKNOWN_BUILTIN_MODULE` before any code runs, even in Postgres mode.

2. **Compose Postgres init fails.** `schema.sql:357` uses `BLOB`. Running it on Postgres 16 gives `ERROR: type "blob" does not exist`.

3. **A fresh Postgres deployment has no users and no way to create one.** Migrations applied cleanly (58 tables) and the server booted. What happened next:
   - Auto-seed was skipped because `"0" !== 0`.
   - `POST /api/v1/auth/bootstrap` returned `410 ENDPOINT_GONE`.
   - The operators table was empty.

**Other operational gaps:**
- CI isn't wired up.
- Rollback exists only as a script with no tested restore.
- The health check is a static JSON response that doesn't check the database or the Fuji socket.
- No alerting.
- No log shipping.
- No upgrade path.

**Positives:** the Helm chart, NetworkPolicy and runbooks exist as useful skeletons.

---

## 7. Commercial / Product Readiness

**What actually matters for this product:** it's a single-plant edge appliance sold to an EMS factory. What matters is:
- Correct machine integration
- Trustworthy traceability
- Operator login and roles
- Install and upgrade
- Backup and restore
- Remote diagnostics
- A site license

Multi-tenant SaaS, SSO and billing integration can wait.

**Compliance claims need to shrink.** 21 CFR Part 11 applies only to medical-device customers. It would also require computer system validation (IQ/OQ/PQ) that no code can supply. Most Indian EMS lines selling meters or consumer electronics need ISO 9001 or IATF 16949 traceability. Remove the Part 11 and ISO 13485 claims from customer-facing material until S2 and S9 are fixed and a validation package exists.

**Legal hygiene.** Seed data, the README, the K8s sample (`smtline-dixon-01.yaml`) and API defaults use a real company's name and realistic personal names. If Dixon isn't a signed partner, this is a reputational and legal risk in sales demos.

---

## 8. Technical Debt

**Critical (must fix before launch):**
- **Schema triplication and swallowed ALTERs.** Created by speed. Risks silent drift and corrupt upgrades. Fix: one migration chain with foreign keys.
- **Identity taken from request bodies.** Makes audit records forgeable. Fix: always use `req.context.principal`.
- **Missing authorization.** Any operator can move physical process parameters. Fix: a permission on every route.
- **Dialect bugs on Postgres.** Fix: a Postgres-only product path, with a test suite on Postgres.

**High (before launch or immediately after):**
- In-memory onboarding and hold state
- UI fixtures and hardcoded IDs
- Shared API key
- Unsafe backup fallback
- Unwired CI

**Medium:**
- Scope sprawl (AGV, predictive, chaos engineering)
- CORS and CSP settings
- `.agent/skills` noise in the repo
- A 60 MB binary committed in git

**Low:** banner text and docs that contradict reality, such as README test instructions and the "signed attestations" wording.

---

## 9. Completion Score

**What "100%" means here:** a factory can install it from a documented package, provision an admin, and connect real Fuji lines with at least one AOI/SPI vendor. Operators work under enforced roles. The system survives restarts, concurrent use and upgrades without data loss. It passes a multi-week supervised pilot. It can be supported remotely and licensed per site.

| Dimension | Weight | Why this weight | Completion | Weighted |
|---|---:|---|---:|---:|
| Core workflows, end to end | 25% | This is what the factory pays for | 35% | 8.75 |
| Real equipment integration | 15% | An MES without validated machine I/O isn't an MES | 10% | 1.50 |
| Security and access control | 12% | Plant LAN, quality records | 25% | 3.00 |
| Data integrity | 12% | Traceability is the product | 25% | 3.00 |
| Deployment and operations | 10% | Edge install, upgrade, restore | 15% | 1.50 |
| Reliability and concurrency | 8% | Multiple stations, 24/7 shifts | 20% | 1.60 |
| Testing and QA | 6% | Regression safety | 40% | 2.40 |
| Operator UX | 5% | Adoption on the floor | 35% | 1.75 |
| Docs and supportability | 4% | Remote support cost | 30% | 1.20 |
| Commercial infrastructure | 3% | Site license is enough at first | 5% | 0.15 |
| **Total** | **100%** | | | **≈25%** |

**Commercialization readiness: 25%.** This measures how close the product is to being safely sellable.

**Engineering completion: about 35%.** This is the share of required implementation effort already done. The breadth of domain code is real. Much of it survives, but the database layer, authorization and all integrations need rework, and hardware validation hasn't started.

**Scorecard (0–100):**

| Area | Score |
|---|---:|
| Functional completeness | 40 |
| Architecture | 45 |
| Security | 25 |
| Reliability | 20 |
| Testing | 40 |
| DevOps | 15 |
| Data layer | 25 |
| UX / product maturity | 35 |
| Documentation | 30 |
| Supportability | 20 |
| Commercial infrastructure | 5 |
| **Commercialization readiness** | **25 / 100** |

---

## 10. Remaining Work

Effort is in engineer-weeks (ew). Priorities run from P0 (launch blocker) to P3 (post-launch).

**Platform and data:**

| ID | Work item | Pri | Depends on | Effort | Blocks launch? |
|---|---|---|---|---|---|
| D-01 | Postgres as the product database. Single migration chain with foreign keys. Delete the `schema.sql`/`schema-sql.ts` split and the try/catch ALTERs. | P0 | — | 2–3 ew | Yes |
| D-02 | Replace the regex placeholder rewrite. Fix numeric and bigint coercion across services. | P0 | D-01 | 1–2 ew | Yes |
| D-03 | Lazy-load `node:sqlite` (simulator only). Move Dockerfile and CI to Node 22. | P0 | — | 0.5 ew | Yes |
| D-04 | Persist onboarding state. No auto-seed in production. Working first-run admin flow. | P0 | D-01 | 1 ew | Yes |
| D-05 | DB-level ledger immutability (a non-owner runtime role). | P1 | D-01 | 0.5 ew | Yes for medical customers |

**Security:**

| ID | Work item | Pri | Depends on | Effort | Blocks launch? |
|---|---|---|---|---|---|
| S-01 | Permission on every route, plus a role×route test matrix | P0 | — | 2 ew | Yes |
| S-02 | Identity from the principal only. Delete `/ledger/sign`. DHR release under `QUALITY_APPROVE` plus e-signature. | P0 | S-01 | 1 ew | Yes |
| S-03 | Per-service scoped credentials in place of the shared key. Remove the key from the frontend. Constant-time compare. | P0 | S-01 | 1 ew | Yes |
| S-04 | Compose and perimeter: unpublish 4000/30040, remove Adminer, secrets from env/Vault, tighten CORS/CSP | P1 | — | 0.5 ew | Yes |

**Equipment integration:**

| ID | Work item | Pri | Depends on | Effort | Blocks launch? |
|---|---|---|---|---|---|
| I-01 | Fuji Nexim validation on a real NXT line or test bench against the vendor spec | P0 | Hardware access | 3–6 ew | Yes |
| I-02 | Multi-machine listener mapping (by IP or machine ID) | P0 | I-01 | 1 ew | Yes |
| I-03 | Real line inhibit on hold, or relabel as advisory with an operator acknowledgement | P0 | I-01 | 1–2 ew | Yes |
| I-04 | One AOI vendor and one SPI vendor, parsed from real exported files | P1 | Customer samples | 2–3 ew | Yes |

**UX, QA, operations and commercial:**

| ID | Work item | Pri | Depends on | Effort | Blocks launch? |
|---|---|---|---|---|---|
| U-01 | Login screen, token refresh, role-aware navigation | P0 | S-01 | 1–1.5 ew | Yes |
| U-02 | Fixtures off in production builds. Replace hardcoded job/program/work-center IDs with selectors. | P0 | U-01 | 1 ew | Yes |
| Q-01 | CI wired and green on Postgres. Fix the order-dependent test. | P0 | D-01 | 1 ew | Yes |
| Q-02 | Browser end-to-end tests for splice → trace → recall. Concurrency tests. | P1 | U-01, Q-01 | 2 ew | Yes |
| O-01 | Postgres backup and restore with a tested restore drill. Real health checks covering the DB and socket. | P1 | D-01 | 1.5 ew | Yes |
| O-02 | Versioned upgrade procedure with migration tests | P1 | D-01 | 1 ew | Yes |
| O-03 | Alerting, log shipping, remote diagnostics bundle | P2 | O-01 | 1.5 ew | No |
| C-01 | Site license key, install guide, admin guide | P2 | D-04 | 1.5 ew | For GA |
| C-02 | Replace Dixon branding and names in seed and demo data | P1 | — | 0.5 ew | Yes |
| X-01 | Park AGV, predictive, chaos engineering and printer auto-tune behind flags | P1 | — | 0.5 ew | No |

**Total to a supervised pilot:** about 22–30 engineer-weeks. **Total to general availability:** about 35–45 engineer-weeks, plus pilot time.

---

## 11. Critical Path

```
D-03 Node 22 → D-01 single Postgres schema → D-02 dialect fixes → Q-01 CI green on Postgres
   → S-01 authz everywhere → S-02 identity from principal → U-01 login → U-02 no fixtures
   → I-01 real Fuji validation → I-02 multi-machine → I-03 real hold
   → O-01 backup/restore tested → supervised pilot on one line → GA
```

**The must-happen list (10 items):**
1. D-01 through D-04: single Postgres schema, dialect fixes, Node 22, working provisioning
2. S-01 through S-03: authorization, identity binding, scoped credentials
3. U-01 and U-02: login, and no fixtures in production
4. I-01 through I-03: real Fuji validation, multi-machine mapping, real hold
5. O-01: backup and restore proven
6. A 4–8 week pilot on one real line

Everything else is secondary.

**The long pole is I-01.** It depends on access to Fuji documentation and a live NXT line, not on coding speed. Start that conversation with the design-partner factory now, in parallel with everything else.

---

## 12. Roadmap to 100%

Durations assume 2–3 engineers.

| Stage | Work | Exit criteria | Duration | Readiness after |
|---|---|---|---|---|
| 1. Boot and log in | D-03, D-01, D-02, D-04, Q-01, U-01 | Fresh `docker compose up` on Postgres works. An admin is provisioned. The UI logs in. CI is green. | 3–4 wks | ~38% |
| 2. Lock it down | S-01 to S-04, U-02, X-01, C-02 | The role×route matrix passes. No identity is taken from request bodies. No fixtures or demo names ship. | 3–4 wks | ~50% |
| 3. Real machines | I-01 to I-04 | Splice NG verified on a real NXT. Hold verified. One AOI and one SPI vendor ingested from real files. | 6–10 wks (hardware-gated) | ~65% |
| 4. Validate | Q-02, concurrency and load on Postgres, migration tests | 24-hour soak with multiple stations. No data loss on a mid-transaction kill. | 3 wks | ~74% |
| 5. Operationalize | O-01 to O-03 | Restore drill passes on Postgres. Alerts fire. Upgrade from N-1 works. | 3 wks | ~82% |
| 6. Supervised pilot | One line at a design partner | 4–8 weeks. Traceability audit matches floor reality. No P0 incidents. | 6–8 wks | ~92% |
| 7. Commercialize | C-01, signed builds, support process, pricing | Launch gate (Section 13) is all green. | 3 wks | 100% |

**Totals:** about 3–4 months to a supervised pilot and about 7–10 months to GA.

---

## 13. Commercial Launch Gate

Every item below must be Go. Any single No-Go blocks launch.

- [ ] Fresh install from the documented package works on a clean host, with no manual code edits
- [ ] First-run provisioning creates an admin. Demo seed is impossible in production mode.
- [ ] Every mutating route has a permission check, proven by an automated role×route test
- [ ] Every signature, disposition and release is attributed to the authenticated principal only
- [ ] No shared admin credential. No secrets in the repo or frontend bundle.
- [ ] OT and API ports reachable only through the documented network design
- [ ] Splice interlock and hold verified on real Fuji equipment, with a signed test record
- [ ] Traceability UI cannot display fixture data in production builds
- [ ] Full test suite green in CI on Postgres, with no order-dependent tests
- [ ] 24-hour multi-station soak with zero data inconsistencies
- [ ] Postgres backup restored successfully within the stated RTO
- [ ] Upgrade from the previous version tested with real data
- [ ] Pilot line ran 4 or more weeks with no open P0 incidents
- [ ] Compliance claims in sales material match what's implemented and validated

---

## 14. Bottom Line

1. **What percentage is built?** About 35% of the engineering, and about 25% of commercial readiness.

2. **What remains?** About 65% of the engineering. Most of it is the unglamorous part: data layer, authorization, real integrations, operations and the pilot.

3. **Biggest gaps.**
   - Nothing has touched a real machine.
   - The deployment doesn't boot.
   - The UI can't authenticate.
   - Authorization is mostly absent.

4. **Biggest hidden risks.**
   - The "production hold" doesn't stop the line.
   - The traceability screen shows fake data by default.
   - Quality records can be signed in anyone's name.
   - SQLite transactions bleed across concurrent requests.
   - The in-repo audit's 9.3/10 score gives false confidence.

5. **What could cause major rework?**
   - The triplicated, FK-less schema.
   - Real Fuji, AOI or profiler formats differing from what was assumed. The KIC and AOI formats here are self-authored.
   - Retrofitting identity binding across every quality workflow.

6. **What must happen before the first paying customer?** Stages 1 through 6. At minimum: the must-happen list in Section 11 plus a supervised pilot.

7. **What can safely be deferred?**
   - AGV logistics
   - Predictive quality
   - Chaos engineering
   - Printer auto-tuning and reflow closed loop
   - Multi-tenancy
   - SSO and billing

   Park them behind feature flags.

8. **Most efficient path.** Narrow the product to the wedge that's closest to real: splice verification, MSL and paste control, and traceability/recall on Fuji lines. Make that bulletproof on Postgres with real authorization and a login. Validate it on one partner line. Everything else is roadmap.

---

## Next Step (about 30 minutes)

Get CI running so every fix from here is verified:

1. `git mv deploy/ci/ci.yml .github/workflows/ci.yml`
2. In `.github/workflows/ci.yml`, change `node-version: [20.x, 22.x]` to `[22.x]`.
3. In `apps/api/Dockerfile` and `apps/web/Dockerfile`, change `FROM node:20-alpine` to `node:22-alpine`.
4. Commit and push. Once the first run reports, start D-01: consolidating the schema onto one Postgres migration chain.
