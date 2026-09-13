# Independent Re-Audit (14th Sept 2026): Verifying the Rev3 Attestation

**Repository:** github.com/Nopenope69/MES
**Baseline documents reviewed:** `CRITIQUE_11TH_SEPT_AND_WAY_FORWARD.md` (25/100, 11 Sept), `docs/audit/commercial-release-attestation-rev3.md` (claims 100/100, 13 Sept)
**Method:** Cloned the repo, installed dependencies, type-checked both apps, installed a real PostgreSQL 16 instance, ran `initDatabase()` against it directly, ran the full Vitest suite, and read the source for every claim in the Rev3 attestation's gate table (G-01 through G-13).

---

## Verdict

**Not ready for a paying client.** Commercialization readiness is approximately **45–50/100**, not the claimed 100/100. Real, substantial engineering happened between 11 and 13 Sept — authorization coverage, CI hardening, licensing, and brand hygiene are genuinely fixed. But two of the three hardest problems from the 11th Sept critique are still open, and the attestation grades them GO anyway:

1. A fresh PostgreSQL install **crashes during initialization** — reproduced live, not inferred from reading code.
2. **Identity is still forgeable** in several routers, and a master-API-key holder can escalate to impersonate a `QUALITY_LEAD` reviewer.
3. Real machine/vendor validation (the item the 11th Sept critique called "the long pole," gated on hardware access rather than coding speed) is still at **zero** and is marked `[BLOCKED: artifact]` in the attestation's own evidence column — yet the gate is graded **GO**.

The pattern worth naming explicitly: this is the second time a self-produced audit in this repo has graded itself far higher than an independent check finds (the pre-11th-Sept `re-audit-report.md` claimed 9.3/10 and was debunked the same way). Self-attestation should not be treated as a release gate here without external verification.

---

## 1. What's genuinely fixed (verified, not just read)

| Item | Evidence |
|---|---|
| Route authorization | Sampled `smt.router.ts` (24 routes) line by line — every route individually carries `requirePermission(...)`, not a blanket middleware claimed after the fact. Aggregate: ~92 route handlers across 16 routers, ~96 `requirePermission`/`apiKeyAuth` occurrences. |
| SQLite transaction bleed | `database.ts`'s `withTransaction` now uses `AsyncLocalStorage` (`activeTxStorage`) plus a promise-chained lock (`transactionQueue`) to serialize transactions and give nested calls real savepoints. This is a correct fix for the cross-request corruption bug the 11th Sept critique flagged. |
| `node:sqlite` on Node 20 | Import is now `import type` (erased at compile time) plus a lazy `require('node:sqlite')` inside the constructor, wrapped in try/catch. Won't crash module load on Node 20 anymore. |
| Multi-machine Fuji gateway | Real `machineRegistry` keyed by machine ID, work-center ID, and IP address, with `resolveMachineContext(clientIp, machineName)` doing actual lookup instead of a single hardcoded work center. A `wc-nxt-01` default still exists as the last-resort fallback, which is reasonable, not a smell. |
| CI/CD | Moved to `.github/workflows/ci.yml`. The `npm audit` step's `\|\| true` is only there to stop the shell dying on npm's own exit code — the actual gate is a real Node script that parses the JSON and exits 1 on unwaived high/critical vulnerabilities. A real `eslint-plugin-security` SAST step now runs. This is a legitimate fix, not cosmetic. |
| Licensing | `licensing.service.ts` (475 lines) and `scripts/mes-admin.ts` implement real Ed25519 keypair generation, signing, and verification (`crypto.generateKeyPairSync('ed25519')`), not stubs. |
| Brand/entity hygiene | `scripts/check-entity-hygiene.sh` does a genuine grep-based scan for "dixon" and specific personal names. Confirmed clean across all live code (only the historical critique/audit docs still mention Dixon, correctly excluded as a dated record). |
| `HOLD_ACKNOWLEDGE` permission | Real, specific permission gate on `/hold/acknowledge`, not just "any authenticated user." |
| Production hold framing | Honestly described. The attestation claims a persisted DB lock and WebSocket broadcast — it does **not** claim the hold physically stops the machine, and the code matches that (still no command sent to the Fuji equipment). This is an accurate claim, unlike the others below. |

---

## 2. What's still broken, despite being graded GO

### 2.1 Fresh PostgreSQL install crashes (contradicts G-01, G-02)

The attestation claims: *"PostgreSQL 16 verified; zero BLOB references... Numbered migrations 001–006 apply deterministically... 28 foreign key constraints verified."*

**Reproduced independently:** installed PostgreSQL 16 via apt, pointed `DATABASE_URL` at a brand-new database, and called `initDatabase()` directly.

```
[DB] Connecting to PostgreSQL database...
INIT_DATABASE_FAILED: error: column "area_id" does not exist
    at .../database.ts:302:11 (execScript)
    at .../migration-runner.ts:117:9
    at .../migration-runner.ts:116:7 (runPendingMigrations)
    at .../database.ts:391:7 (initDatabase)
```

**Root cause, traced to source:**

`initDatabase()` unconditionally runs the legacy `schema.sql` first (65 tables, zero foreign keys — unchanged from the 11th Sept critique), and *only for Postgres* additionally runs migrations 001–007 afterward. Migration 001 uses `CREATE TABLE IF NOT EXISTS` for 41 tables, 32 of which share a name with a table `schema.sql` already created. Since the table already exists, `IF NOT EXISTS` silently skips creation — so the migration's foreign-key-bearing table definitions never actually apply. Two concrete, structurally different `work_centers` tables exist across the two files:

```sql
-- schema.sql (runs first, wins)
CREATE TABLE IF NOT EXISTS work_centers (
  ...
  area VARCHAR(64) NOT NULL,   -- note: "area", not "area_id"
  ...
);

-- migrations/001_enterprise_schema.sql (silently skipped — table already exists)
CREATE TABLE IF NOT EXISTS work_centers (
  ...
  area_id TEXT REFERENCES areas(id) ON DELETE CASCADE,
  ...
);
```

Migration 001 then tries `CREATE INDEX IF NOT EXISTS idx_work_centers_area_id ON work_centers(area_id)` against the live (schema.sql) table, which has no `area_id` column — hence the crash. This is not a one-off: it's a structural collision between two schema sources describing the same tables differently, which is exactly the "three schema sources plus silent patching" problem the 11th Sept critique flagged, minus one of the three sources (`schema-sql.ts` is genuinely gone). **This is not fixed — a factory IT team running `docker compose up` against a clean database today gets the exact failure the original critique reproduced.**

Also worth noting for accuracy: the attestation says migrations "001–006"; there are seven (001–007), and the FK count in the migrations is closer to 14 real `REFERENCES` clauses than the claimed 28 — moot anyway, since most never take effect on a fresh install for the reason above.

### 2.2 Identity is still forgeable (contradicts G-05, G-06)

The attestation claims: *"Zero client-supplied identity fields (authorizedBy, actorId, qaReviewerId) accepted in request bodies. Identity bound strictly to authenticated JWT req.context.principal."*

`req.context.principal` does not exist anywhere in the codebase (`grep` returns zero matches). The actual pattern, present in three routers:

```ts
// aoi.router.ts, predictive.router.ts, logistics.router.ts
const authorizedBy = req.user?.code || req.user?.id || req.body.authorizedBy || 'sys-quality-lead';
```

If `req.user` is ever falsy for any reason, this still falls back to a client-controlled request body field, and ultimately to a hardcoded fake identity. Worse, in `auth.middleware.ts`, a request authenticated with the shared master API key can set an `x-service-role` header or a `req.body.qaReviewerId` field to elevate its effective role to `QUALITY_LEAD` and set its recorded actor ID to whatever the client supplies:

```ts
if (isMasterKey) {
  const headerRole = req.headers['x-service-role'];
  if (typeof headerRole === 'string' && headerRole.trim()) {
    role = headerRole.trim();
  } else if (req.body?.qaReviewerId) {
    role = 'QUALITY_LEAD';
    actorId = String(req.body.qaReviewerId);   // client-supplied identity
    serviceName = 'QA Reviewer Service';
  }
}
```

This directly undermines the attestation's own claimed architectural invariant ("Hard Non-Delegable Separation of Duties: SYSTEM_ADMIN is strictly barred from QUALITY_APPROVE") — a SYSTEM_ADMIN-scoped key can act as an arbitrary QUALITY_LEAD identity through this path. For a system whose entire pitch is trustworthy quality attribution and 21 CFR Part 11-style traceability, this is a critical, not cosmetic, gap.

### 2.3 The test suite is not actually green (contradicts the "326/326, 0 failures" claim)

Ran `npm --workspace=@mes/api test` fresh:

```
Test Files  1 failed | 41 passed (42)
     Tests  1 failed | 325 passed (326)
```

`security-track-g.test.ts` fails in the full run (expects HTTP 200, gets 500) and would pass in isolation — the same order-dependent, shared-state test bug the 11th Sept critique identified, just moved to a different line number. Not fixed; still present.

### 2.4 Machine validation is still zero, graded GO anyway

G-09's own evidence column says `I-01` (Fuji hardware) and `I-04` (AOI/SPI vendor files) are `[BLOCKED: artifact]` — awaiting physical partner access. The gate is nonetheless marked **GO (Provisionally Tagged)**. There is no such thing as a provisional GO on the one item that determines whether this is an MES or a very well-built simulator. The 11th Sept critique called this "the long pole" specifically because it depends on hardware access, not development time — that has not changed, and grading it GO obscures the single most important remaining risk from anyone reading the summary table.

### 2.5 Minor, unchanged from before

- The 58 MB unsigned Windows simulator binary is still committed to git — split into ~12 `.partXX` chunks with a reassembly script instead of one file. Same repo-bloat and provenance problem, just less visible in a directory listing.

---

## 3. Updated scorecard

| Dimension | 11 Sept score | 14 Sept verified score | Notes |
|---|---:|---:|---|
| Route authorization | 25 | **80** | Real, sampled and confirmed |
| Identity binding / attribution | — | **30** | Still forgeable via body fallback + master-key role elevation |
| Database / schema integrity | 25 | **20** | Actively crashes on fresh Postgres — arguably worse to discover this late |
| Concurrency (SQLite) | — | **75** | Legitimate AsyncLocalStorage + queue fix |
| CI/CD | 15 | **70** | Real blocking gates now |
| Testing | 40 | **55** | Coverage grew; the one flagged flaky test is still flaky |
| Machine/vendor integration | 10 | **10** | No change — still zero real hardware contact |
| Licensing / commercial infra | 5 | **60** | Real Ed25519 licensing now exists |
| Brand/legal hygiene | — | **95** | Genuinely clean, with enforcement |
| **Overall commercialization readiness** | **25** | **~45–50** | Real progress, overstated by the self-attestation |

---

## 4. Prioritized remaining work

| Pri | Item | Effort | Why it's first |
|---|---|---:|---|
| P0 | Resolve the `schema.sql` vs. migrations collision. Pick one source of truth (recommend: delete `schema.sql`, make migration 001 authoritative for all 32 overlapping tables, renumber `schema.sql`-only tables into the migration chain). | 1–2 ew | Currently the literal first thing a fresh install does is crash. |
| P0 | Remove every `\|\| req.body.authorizedBy` / `\|\| 'sys-...'` fallback. Remove the master-key `x-service-role` / `qaReviewerId` role-elevation branch entirely. Identity should come from the verified JWT principal or the request should be rejected. | 0.5–1 ew | Undermines every compliance/traceability claim otherwise. |
| P0 | Fix or isolate the order-dependent test in `security-track-g.test.ts` so CI is actually green on a full run, not just in isolation. | <0.5 ew | Cheap, and "tests pass" is a foundational claim that's currently false. |
| P0 | Re-word or remove the G-09 "GO (Provisionally Tagged)" grading. State plainly in customer-facing material that machine integration is unverified against real equipment until it is. | Trivial (documentation), but the underlying validation is 3–6 ew and hardware-gated | Prevents a sales conversation from overpromising what's actually been proven. |
| P1 | Get in front of a real Fuji NXT line or vendor test bench for I-01, and get one real AOI/SPI export file for I-04. | 3–6 ew, hardware-access-gated | This is the actual product, not the surrounding scaffolding. |
| P2 | Fix the migration count/FK count discrepancies in the attestation doc itself (says "001–006," there are 7; says "28 FKs," closer to 14 that would even apply) so the document is trustworthy going forward. | Trivial | Small thing, but self-attestation credibility matters given the pattern here. |

---

## 5. Bottom line

Two days of work produced real fixes in authorization, concurrency, CI, licensing, and hygiene — that's not nothing, and it's a meaningfully better codebase than the one reviewed on 11 Sept. But the release-readiness claim jumped from 25/100 to a self-graded 100/100 while the two hardest, most customer-visible problems (a database that survives a clean install, and identity that can't be forged) remain open, and the one problem that was always going to take the longest (real hardware validation) is still at zero and was graded as passing anyway. Treat this attestation as a status update, not a launch decision, and get an independent set of eyes — human or otherwise — on the actual go/no-go call before this goes anywhere near a paying customer's factory floor.
