# Antigravity SMT MES — Customer-Site Readiness, Security Hardening & Enterprise Appliance Specification
**Document ID:** SPEC-MES-2026-01  
**Target Release:** Antigravity SMT MES v1.0.0 (Production Customer Release)  
**Status:** APPROVED & FROZEN  
**Date:** 2026-09-09  

---

## 1. Executive Summary & Appliance Baseline

This specification establishes the production customer release architecture for the **Antigravity SMT MES Engine** as a dedicated single-tenant, single-plant edge appliance targeting Fuji NXT / EMS surface-mount electronics manufacturing lines.

### Appliance Scope & Architecture Invariant
The scope of this product is strictly the **Antigravity SMT MES edge appliance**. It encompasses:
* Deep SMT manufacturing intelligence: JEDEC J-STD-033D MSL floor-life tracking, closed-loop splicing BOM interlocks, IPC-CFX printer auto-tuning, high-frequency reflow oven telemetry/PWI calculation, and defensive Fuji TCP socket framing.
* Enterprise appliance hardening: server-derived security contexts, classified repository persistence (`GLOBAL`, `ORGANIZATION_SCOPED`, `SITE_SCOPED`), Argon2id/Bcrypt operator credential hygiene, short-lived JWTs with serialized refresh rotation, capability-based RBAC with non-delegable Segregation of Duties, attributable 21 CFR Part 11 e-signatures with non-owner append-only ledger privileges, edge perimeter TLS with modular `SafeConnector` egress pinning, point-in-time recovery packages with persistent DR drill verification, and an automated release readiness CLI (`mes doctor`).

This document serves as the authoritative technical baseline for customer deployment readiness. Target readiness score is $\ge 9.0\text{ / }10$, verified through independent post-implementation re-audit.

---

## 2. Canonical Audit Traceability Matrix

| Audit Item | Category | Description | Severity | Implementing Section | Verification Test File |
|---|---|---|---|---|---|
| **D.1** | Security | No authentication on API (complete route inventory unprotected) | **Blocker** | Section 2 | `tests/auth-pipeline.test.ts` |
| **D.2** | Security | Inert JWT infrastructure (validated in config, never used) | **High** | Section 2 | `tests/auth-pipeline.test.ts` |
| **D.3** | Security | E-signature actor identity client-supplied (Part 11 forgery) | **Blocker** | Section 3 | `tests/compliance-ledger.test.ts` |
| **D.4** | Security | Unenforced operator roles / no RBAC | **Blocker** | Section 2 | `tests/rbac-capabilities.test.ts` |
| **D.5** | Security | Plaintext operator PINs in database | **High** | Section 2 | `tests/auth-pin-security.test.ts` |
| **D.6** | Security | Unenforced multi-site / organization isolation | **Blocker** | Section 1 | `tests/tenant-isolation.test.ts` |
| **D.7** | DevSecOps | Cosmetic `npm audit --audit-level=high \|\| true` gate | **High** | Section 6 | CI Pipeline Execution |
| **D.8** | DevSecOps | No SAST, secret scanning, or container scanning in CI | **High** | Section 6 | CI Pipeline Execution |
| **D.9** | Deployment | Default credentials & open Adminer in `docker-compose.yml` | **High** | Section 4 | `tests/deployment-compose.test.ts` |
| **D.10** | Security | Unauthenticated `/api/v1/security/audit` network disclosure | **Medium** | Section 4 | `tests/auth-pipeline.test.ts` |
| **D.11** | OT Security | Fuji gateway lacks transport/device authentication | **Medium** | Section 4 | `tests/ot-fuji-security.test.ts` |
| **D.12** | API Design | Unbounded result sets on list endpoints | **Low** | Section 1 | `tests/api-pagination.test.ts` |
| **D.13** | Reliability | Silent error swallowing (`catch {}`) on MSL enrichment | **Low** | Section 1 | `tests/msl-reliability.test.ts` |
| **D.14** | Security | Single shared static API key, no revocation or rotation | **Medium** | Section 2 | `tests/service-credentials.test.ts` |
| **E.5** | Reliability | Zero backup/restore/disaster recovery mechanism (RPO/RTO) | **Blocker** | Section 5 | `tests/disaster-recovery.test.ts` |
| **E.8** | Integration | Outbound SSRF risks on webhooks and external integrations | **Medium** | Section 4 | `tests/ssrf-socket-pinning.test.ts` |
| **E.18** | Product | Hardcoded demo tenant seed ("Dixon Noida Line 01") | **Medium** | Section 6 | `scripts/mes-doctor.ts` |

---

## 3. Section 1: Architecture Invariants, Deployment Model & RequestContext Scoping

### 3.1 The Core Persistence Invariant
> **"No application-level database access occurs without an explicit authenticated human or service security context, and no context can originate tenant, site, role, or operator identity from client-controlled request data."**

### 3.2 Single-Tenant Edge Appliance Deployment Model
* **Appliance Boundary**: Antigravity SMT MES is packaged and deployed as a dedicated single-tenant, single-plant edge appliance per customer factory.
* **ISA-95 Hierarchy**:
  $$\text{Organization (1)} \longrightarrow \text{Site (1+)} \longrightarrow \text{Area (1+)} \longrightarrow \text{Production Line (1+)} \longrightarrow \text{Work Center} \longrightarrow \text{Equipment Unit}$$
* **Deterministic Active Site Scope**: While an enterprise may own multiple sites, **each authenticated human session is bound strictly to exactly one active `siteId`**.

### 3.3 Explicit Persistence Scope Classification
To prevent query corruption from blindly appending site filters to installation-level or global metadata, all data models are strictly categorized into three scopes:

1. **`GLOBAL`**:
   - Entities that exist at the software/installation level: `organizations`, `sites`, `system_config`, `permission_catalog`, `event_schemas`.
   - Access: Requires authenticated context, but queries execute without tenant/site predicates.
2. **`ORGANIZATION_SCOPED`**:
   - Entities belonging to the customer organization across all sites: `organization_settings`, `operator_directory`, `global_part_catalog`.
   - Access: Filtered strictly by `organization_id = ?`.
3. **`SITE_SCOPED`**:
   - Factory floor execution entities: `batches`, `lots`, `work_centers`, `production_lines`, `equipment_units`, `reflow_profiles`, `dhr_records`, `compliance_signatures`, `telemetry_samples`, `feeder_setups`.
   - Access: Filtered strictly by `organization_id = ? AND site_id = ?`.

### 3.4 Principal & Scope Type Separation
Internal services and background workers must **never** masquerade as human operators or manufacture synthetic `operatorId`s. Furthermore, background infrastructure tasks (e.g. backup, restore, DR verification) operate at defined administrative scopes without inventing fake site IDs:

```typescript
export type OperatorRole = 
  | 'OPERATOR' 
  | 'SUPERVISOR' 
  | 'PROCESS_ENGINEER' 
  | 'QA_DIRECTOR' 
  | 'SYSTEM_ADMIN';

export type ServiceScope =
  | { readonly kind: 'SITE'; readonly organizationId: string; readonly siteId: string }
  | { readonly kind: 'ORGANIZATION'; readonly organizationId: string }
  | { readonly kind: 'SYSTEM'; readonly organizationId: string };

export type SecurityPrincipal =
  | {
      readonly kind: 'HUMAN';
      readonly operatorId: string;
      readonly operatorCode: string;
      readonly role: OperatorRole;
      readonly permissions: ReadonlySet<Permission>;
      readonly organizationId: string;
      readonly siteId: string;
      readonly sessionId: string;
    }
  | {
      readonly kind: 'SERVICE';
      readonly serviceId: string;
      readonly serviceName: string;
      readonly scope: ServiceScope;
      readonly permissions: ReadonlySet<Permission>;
      readonly credentialId: string;
    };

export interface RequestContext {
  readonly principal: SecurityPrincipal;
  readonly correlationId: string; // Validated client correlation ID or server UUID
  readonly requestId: string;     // Strictly server-generated UUID v4
  readonly ipAddress: string;     // Derived strictly from trusted reverse-proxy hop
}

export interface ServiceContext {
  readonly principal: Extract<SecurityPrincipal, { kind: 'SERVICE' }>;
  readonly correlationId: string;
  readonly taskId: string;
  readonly jobName: string; // e.g. 'backup-runner', 'dr-verifier', 'retention-worker'
}

export type ExecutionContext = RequestContext | ServiceContext;
```

### 3.5 Scoped Repository Factory Pattern
Application services never receive raw database clients. All persistence access passes through a scoped repository factory that enforces table classification:

```typescript
export interface ScopedDataRepository {
  // Site-Scoped Repositories
  readonly batches: ScopedBatchRepository;
  readonly genealogy: ScopedGenealogyRepository;
  readonly compliance: ScopedComplianceRepository;
  readonly smt: ScopedSmtRepository;
  readonly reflow: ScopedReflowRepository;

  // Organization-Scoped Repositories
  readonly organizationSettings: ScopedOrgSettingsRepository;

  // Global Repositories
  readonly permissionCatalog: GlobalPermissionCatalog;
  readonly sites: GlobalSiteRepository;
}

export class MasterRepository {
  public forContext(ctx: ExecutionContext): ScopedDataRepository {
    if (!ctx || !ctx.principal) {
      throw new SecurityContextMissingError('Attempted database access without valid ExecutionContext');
    }
    return new ScopedDataRepositoryImpl(this.db, ctx);
  }

  // Raw database execution methods are protected and inaccessible to domain services
  protected executeRaw(...) { ... }
}
```

Queries enforce appropriate scope based on entity classification:
```sql
-- Site-scoped entity
SELECT * FROM batches 
WHERE id = ? AND organization_id = ? AND site_id = ?;

-- Organization-scoped entity
SELECT * FROM organization_settings 
WHERE key = ? AND organization_id = ?;

-- Global entity
SELECT * FROM sites WHERE id = ?;
```

### 3.6 HTTP Status Semantics
- **`401 UNAUTHORIZED`**: Missing, invalid, expired, or revoked token.
- **`404 NOT FOUND`**: Entity exists in DB but belongs to another `siteId` or `organizationId` (existence defense).
- **`403 FORBIDDEN`**: Entity is within caller's authorized scope, but caller lacks the required `Permission`.

---

## 4. Section 2: Identity, Session Lifecycle & Capability-Based RBAC Pipeline

### 4.1 The Core Identity & Revocation Invariant
> **"Every high-consequence authorization decision is validated against authoritative authorization state. Client-held tokens with stale roles, revoked sessions, or expired authorization versions are rejected immediately on the next request. System Administration is strictly decoupled from manufacturing quality authority."**

### 4.2 Credential Standards & Controlled Backfill Migration
1. **Password & PIN Hashing Algorithm**:
   - **Baseline Standard**: **Argon2id** (memory cost $\ge 64\,\text{MB}$, time cost $\ge 3$, parallelism $\ge 1$).
   - **Supported Fallback**: **Bcrypt** with work factor cost $\ge 12$.
   - Plaintext PINs/passwords are strictly forbidden in production storage.
2. **Controlled Backfill Migration Strategy**:
   - Existing databases with plaintext PINs undergo a verified one-time migration (`scripts/migrate-pins.ts`):
     ```text
     1. Add nullable pin_hash VARCHAR(255) if not present
     2. Iterate all existing operator rows in batches (safely handling populated production tables)
     3. For rows where pin_hash is null, hash plaintext PIN using Argon2id/Bcrypt
     4. Cryptographically verify each generated hash against source PIN
     5. Update pin_hash
     6. Hard Invariant: Assert COUNT(*) WHERE pin_hash IS NULL == 0 before proceeding
     7. Alter column pin_hash SET NOT NULL
     8. Drop plaintext pin column
     ```
   - **Idempotency & Resilience**: `migrate-pins.ts` is strictly idempotent and resumable across process interruptions.
   - **Zero Compatibility Compromise**: Plaintext columns are **never** retained permanently for backwards compatibility. Plaintext `pin` is dropped only after 100% of rows have verified hashes.
3. **PIN Complexity Policy**:
   - `OPERATOR`: 4 to 8 numeric digits (leading zeros permitted, e.g. `"0429"`). Validated server-side via `^\d{4,8}$`.
   - Privileged Roles (`SUPERVISOR`, `PROCESS_ENGINEER`, `QA_DIRECTOR`, `SYSTEM_ADMIN`): Minimum **6 to 8 numeric digits** for kiosk PINs, or high-entropy passwords ($\ge 10$ chars with mixed case, numbers, and symbols).
4. **Anti-User-Enumeration Invariant**:
   - Unknown `operatorCode` executes constant-time dummy verification against a pre-computed constant `DUMMY_PIN_HASH`.
   - Returns identical `401 {"error": "INVALID_CREDENTIALS"}` payload and statistically bounded timing distribution as an invalid PIN for an existing operator.
5. **Atomic Concurrency-Safe Lockout**:
   - Max 10 attempts/min per IP on `/api/v1/auth/login`.
   - 5 consecutive failures triggers an atomic SQL update:
     ```sql
     UPDATE operators 
     SET failed_login_attempts = failed_login_attempts + 1,
         status = CASE WHEN failed_login_attempts + 1 >= 5 THEN 'LOCKED' ELSE status END,
         locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN datetime('now', '+15 minutes') ELSE locked_until END
     WHERE id = ? AND status = 'ACTIVE';
     ```
   - Early unlock requires a supervisor with `Permission.OPERATOR_MANAGE`, logging a mandatory audit reason.

### 4.3 Dual-Token Architecture & Token-Family Refresh Rotation
* **Access JWT**: 15-minute short-lived access JWT. **Browser stores access tokens only in volatile application memory** (never in `localStorage` or `sessionStorage`).
* **Refresh Token**: 12-hour TTL. Stored **strictly in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie** (`__Host-mes-refresh`). Never accessible to JavaScript.
* **Strict Cryptographic Contract**:
  - `alg`: Pinned strictly to `HS256`. Rejects `none` or asymmetric algorithm headers.
  - `iss`: `"Antigravity-MES"`, `aud`: `"mes-api"`.
  - Claims: `sub`, `kind: 'HUMAN'`, `code`, `name`, `role`, `permissions`, `org`, `site`, `sid`, `authzVersion`, `iat`, `exp`.

```sql
CREATE TABLE IF NOT EXISTS operator_sessions (
  id VARCHAR(64) PRIMARY KEY,
  operator_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  site_id VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, REVOKED, EXPIRED
  created_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  revoked_reason VARCHAR(128)
);

CREATE TABLE IF NOT EXISTS operator_refresh_tokens (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(64) NOT NULL, -- SHA-256(raw_refresh_token)
  issued_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP,
  replaced_by_token_id VARCHAR(64),
  revoked_at TIMESTAMP
);

CREATE INDEX idx_refresh_lookup ON operator_refresh_tokens(session_id, token_hash);
```

#### The Transactional Refresh Protocol
1. Refresh requests execute in an exclusive write transaction (`SELECT ... FOR UPDATE` or SQLite serialized lock).
2. If token is active and unconsumed (`consumed_at IS NULL`), mark `consumed_at = now()`, issue fresh refresh token and fresh 15-minute JWT.
3. If token was previously consumed (`consumed_at IS NOT NULL`), **Token Replay / Theft Detected**:
   - Immediately sets `operator_sessions.status = 'REVOKED'`.
   - Adds `sid` to in-memory `revokedSessionCache`.
   - Emits high-priority audit alert: `SECURITY_ALERT_REFRESH_TOKEN_REUSE`.
   - Returns `401 UNAUTHORIZED`.

### 4.4 Anti-Stale Permission Invalidation (`authzVersion`)
- Every operator record maintains an integer `authz_version`.
- An in-memory cache (`activeAuthzVersionCache: Map<operatorId, number>`) tracks active versions.
- On any role, status, or site change, `authz_version` increments in DB and cache updates atomically.
- **Fail-Closed Cache Hydration**: On cache miss (e.g. after container restart), securely reads `authz_version` from database and populates cache. If database read fails, request fails closed.
- If `claims.authzVersion !== currentVersion`, request returns `401 TOKEN_STALE`.

### 4.5 Dynamic Route Inventory Coverage & Capability-Based RBAC
* **Dynamic Route Inventory Test**: Rather than freezing an arbitrary endpoint count, an automated route inventory test enumerates Express routes at test time and verifies that **every route not explicitly in the public allowlist** (`/health`, `/api/v1/auth/login`, `/api/v1/auth/refresh`) is protected by authentication middleware and permission checks.
* **Non-Delegable Segregation of Duties (SoD)**:
  `SYSTEM_ADMIN` administers system configuration, operator credentials, and backups, but is **strictly barred from manufacturing quality approvals** (`REFLOW_PROFILE_APPROVE`, `QUALITY_GATE_OVERRIDE`, `DHR_RELEASE`, `LEDGER_SIGN`, `INTERLOCK_OVERRIDE`).
* **Domain-Level SoD Check**: In addition to role permissions, `ReflowProfileService` and `EdhrService` enforce:
  $$\text{creatorOperatorId} \neq \text{approverOperatorId}$$

---

## 5. Section 3: Attributable 21 CFR Part 11 E-Signature & Audit Ledger Engine

### 5.1 Regulatory Scope Statement
> "Antigravity SMT MES implements technical controls designed to support applicable **21 CFR Part 11** electronic-record and electronic-signature requirements (specifically §11.10 controls for closed systems, §11.50 signature manifestations, §11.70 record linkage, §11.100 signature uniqueness, and §11.200 electronic signature components). Operational compliance remains a shared responsibility requiring customer-specific validation (IQ/OQ/PQ), standard operating procedures (SOPs), training, and formal certification under §11.100(c)."

### 5.2 Two-Component Electronic Signature Protocol
In accordance with 21 CFR §11.200:
1. **Component 1**: Active, authenticated session (Bearer JWT + Operator Code).
2. **Component 2**: Re-entry of operator PIN within the electronic signature modal.

#### Strict Request Schema (`.strict()`)
```typescript
export const SignLedgerRequestSchema = z.object({
  entityType: z.enum(['DHR', 'BATCH', 'REFLOW_PROFILE', 'DISPOSITION', 'INTERLOCK_OVERRIDE']),
  entityId: z.string().min(1),
  entityRevision: z.number().int().nonnegative(),
  actionType: z.string().min(1),
  meaning: z.enum([
    'AUTHOR_CONFIRMATION',
    'TECHNICAL_REVIEW',
    'QUALITY_APPROVAL',
    'REGULATORY_RELEASE',
    'SAFETY_OVERRIDE'
  ]),
  reason: z.string().min(5).max(500),
  signingPin: z.string().min(4).max(8),
  metadata: z.record(z.any()).default({})
}).strict(); // Any client-supplied actorId, actorRole, or timestamp fails validation with HTTP 400
```

### 5.3 §11.70 Record Linkage & Canonical Signed Envelope
Signatures are bound to an exact **immutable record version** and state hash:

```typescript
export interface SignedEnvelope {
  readonly schemaVersion: 1;
  readonly blockIndex: number;
  readonly entityType: string;
  readonly entityId: string;
  readonly entityRevision: number;
  readonly signedRecordHash: string; // SHA-256 of canonical entity state
  readonly actionType: string;
  readonly meaning: string;
  readonly reason: string;
  readonly metadata: Record<string, any>;
  
  // Authoritative Server-Derived Identity
  readonly operatorId: string;
  readonly operatorCode: string;
  readonly operatorName: string;
  readonly operatorRole: string;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly siteId: string;
  
  // Authoritative Server-Derived UTC Timestamp
  readonly executedAt: string; // ISO 8601 UTC string
}
```

#### RFC 8785 JSON Canonicalization & Hash Chaining
$$S_{\text{record}} = \text{SHA-256}(\text{canonicalize}(\text{SignedEnvelope}))$$
$$H_{\text{block}}[N] = \text{SHA-256}\Big(N \parallel H_{\text{block}}[N-1] \parallel S_{\text{record}}\Big)$$

### 5.4 Database Role Segregation & Append-Only Guarantees
To prevent database administrators or runtime injection from mutating compliance records:
1. **Schema Ownership**: The migration/schema owner role (`mes_migrator`) owns tables.
2. **Runtime Role**: The application runtime role (`mes_runtime`) is granted **only `SELECT` and `INSERT`** on compliance ledger tables:
   ```sql
   GRANT SELECT, INSERT ON compliance_signatures TO mes_runtime;
   -- Explicitly denied:
   REVOKE UPDATE, DELETE, TRUNCATE ON compliance_signatures FROM mes_runtime;
   ```
3. Because `mes_runtime` is **not the owner** of `compliance_signatures`, PostgreSQL owner-override privileges cannot be abused to circumvent table permissions.

---

## 6. Section 4: Edge Appliance Perimeter, Secrets & OT Hardening

### 6.1 Perimeter Architecture & Docker Hardening
* **Adminer Excised**: The open database management tool is permanently removed from all Docker Compose templates.
* **PostgreSQL Port Publishing Removed**: Port `5432:5432` is removed from host publishing. PostgreSQL is reachable only by internal Docker containers on `mes_network`.
* **Zero Default Passwords**: Docker Compose enforces mandatory environment variables (`${POSTGRES_USER:?error}`, `${POSTGRES_PASSWORD:?error}`).
* **Caddy Gateway**: TLS 1.3 preferred, TLS 1.2 minimum where required, HSTS, strict CSP, automated HTTP $\rightarrow$ HTTPS redirect (port 80 issues 301 to 443). `/metrics` blocked from external LAN.

### 6.2 Transactional Appliance Onboarding & Bootstrap State Machine
To eliminate persistent setup backdoors while preventing partially initialized appliances:
$$\text{UNINITIALIZED} \xrightarrow{\text{start}} \text{PROVISIONING} \xrightarrow{\text{success}} \text{PRODUCTION\_ACTIVE} \longrightarrow \text{BOOTSTRAP\_UNMOUNTED}$$
$$\text{PROVISIONING} \xrightarrow{\text{failure}} \text{PROVISIONING\_FAILED} \xrightarrow{\text{rollback}} \text{UNINITIALIZED}$$

- Provisioning executes in a single database transaction:
  1. Create organization and initial site.
  2. Create first `SYSTEM_ADMIN` credentials ($\ge 12$ chars).
  3. Initialize ISA-95 asset hierarchy baseline.
  4. Generate and store runtime secrets.
- **Rollback Guarantee**: Any failure during provisioning rolls back the entire transaction to `UNINITIALIZED`. No partially configured state is ever left exposed.
- Once in `PRODUCTION_ACTIVE`, the `/api/v1/auth/bootstrap` route is **completely unmounted** from the Express router in production code.

### 6.3 OT/IIoT Perimeter Defense: Fuji Nexim Gateway
To secure Fuji NXT III machine line communications without breaking OEM wire format compatibility:
1. **Physical & Network Segmentation**: The Fuji TCP socket (port 30040) is bound strictly to a dedicated physical network interface / isolated machine VLAN. Port 30040 is physically inaccessible from office and business LANs.
2. **Protocol Compatibility & Device Authentication**:
   - If the installed Fuji Nexim software/hardware supports transport-level device authentication, enable native device credentials.
   - If standard OEM machine controllers do not support custom cryptographic handshakes, apply **documented compensating controls**: dedicated OT VLAN + hardware firewall + monitored MAC/IP allowlist + physical machine port lockdown.
3. **Defensive Socket Framing & DoS Protections**:
   - Strict 64KB max buffer cap on incoming frame accumulator.
   - 4-byte sync header validation.
   - Immediate disconnect and connection purge upon corrupt length or malformed frame headers.
   - 30-second idle socket timeout.

### 6.4 Modular Egress Security: `SafeConnector`
Outbound networking is segregated into modular policies built on top of a low-level, pinned connector:
- **`SafeConnector`**: Handles DNS resolution, RFC1918/loopback/link-local/IPv4-mapped-IPv6 validation, socket IP pinning (defeating DNS rebinding), strict 5-second connection timeout, and redirect prohibition (`redirect: 'manual'`).
- **`InternalServiceTargetPolicy`**: Verifies outbound destinations against known internal service identities.
- **`WebhookTargetPolicy`**: Verifies outbound destinations against customer-configured, approved external HTTPS endpoints (e.g. enterprise ERP/PLM exports).

---

## 7. Section 5: Data Protection, Backup & Disaster Recovery Drill Pipeline

### 7.1 Recovery Objectives & SLA Definition
* **Measured RPO Target**: **$\le 15\text{ minutes}$** (Continuous WAL archiving in Postgres / 15-minute online SQLite backup snapshots).
* **Demonstrated RTO Target**: **$\le 2\text{ hours}$** (Demonstrated during automated restore drills).

### 7.2 Point-in-Time Recovery Package Architecture
Backups bundle four synchronized tiers into an encrypted package (`mes-recovery-YYYYMMDD-HHMMSS.tar.gz`):
1. **Relational Core**: Consistent DB snapshot with recorded `databaseRecoveryLSN`.
2. **EventStore**: Append log and projection state up to recorded sequence number.
3. **Physical Evidence Scope**: 
   - Managed artifact directories: `/var/data/dhr` (signed PDFs), `/var/data/reflow` (raw profiler data), `/var/data/inspection` (AOI/SPI images).
   - Accompanied by signed `evidence-manifest.json` listing relative path, size, SHA-256 checksum, and corresponding database record ID.
   - **The Strict Integrity Invariant**: 100% of artifacts registered in the backup manifest are verified, and every database record expected to reference a managed artifact has a corresponding manifest entry.
4. **Configuration & Keystore**: Site configuration and encrypted credentials.

### 7.3 Scheduled DR Drills & Persistent Evidence Retention
1. **Automated Destructive Drill (`scripts/dr-drill.sh`)**:
   - Restores recovery package into an isolated verification sandbox.
   - Verifies schema, EventStore monotonicity, compliance hash chain (`verifyIntegrity()`), and 100% evidence file hashes.
   - Boots application and runs production smoke tests.
   - Calculates and records actual `RPOSeconds` and `RTOSeconds`.
2. **Persistent Drill History Table**:
   ```sql
   CREATE TABLE IF NOT EXISTS dr_drill_history (
     drill_id VARCHAR(64) PRIMARY KEY,
     software_version VARCHAR(32) NOT NULL,
     backup_id VARCHAR(64) NOT NULL,
     backup_timestamp TIMESTAMP NOT NULL,
     executed_at TIMESTAMP NOT NULL,
     rpo_seconds INTEGER NOT NULL,
     rto_seconds INTEGER NOT NULL,
     status VARCHAR(24) NOT NULL, -- PASS, FAIL
     evidence_summary TEXT NOT NULL
   );
   ```
3. **Freshness Enforcement**: `mes doctor` verifies that the latest drill record exists, has status `PASS`, and has an age $\le 30$ days (or customer-configured maximum).

---

## 8. Section 6: DevSecOps CI Gates, Release Provenance & MES Doctor CLI

### 8.1 CI Gates & Signed Release Provenance
1. **Blocking CI Gates**:
   - `npm audit` fails on High/Critical vulnerabilities unless covered by an unexpired, schema-validated entry in `.audit-exceptions.json`:
     ```json
     {
       "cve": "CVE-2026-XXXX",
       "package": "example-pkg",
       "rationale": "Vulnerable code path is not reachable in runtime execution path",
       "owner": "security-lead@mes-appliance.local",
       "mitigation": "Network-level ingress restrictions and strict input parsing prevent exploitation",
       "expiresAt": "2026-10-15"
     }
     ```
   - Unapproved, missing fields, or expired exceptions fail the build.
   - Semgrep SAST, Gitleaks, Trivy container scans, and CycloneDX SBOM generation execute on every build.
2. **Signed Release Manifest (`release-manifest.json`)**:
   CI produces a cryptographically signed manifest linking:
   $$\text{Git Commit SHA} \longrightarrow \text{Container Image Digest} \longrightarrow \text{SBOM Digest} \longrightarrow \text{CI Scan Attestations}$$

### 8.2 Automated Release Readiness CLI: `mes doctor`
The `mes doctor` CLI (`scripts/mes-doctor.ts` / `npm run doctor`) executes 12 structured diagnostic modules on the appliance:

```typescript
export interface DoctorResult {
  status: 'PASS' | 'FAIL' | 'NOT_VERIFIED';
  severity: 'BLOCKER' | 'WARNING' | 'INFO';
  evidence: string[];
  checkedAt: string;
}
```

* **Attestation Verification (Not CI Simulation)**: Rather than claiming the deployed appliance ran Semgrep or Gitleaks locally, Doctor verifies the cryptographically signed release attestations and SBOM integrity:
  `[12] DEVSECOPS RELEASE ATTESTATION ...... [ PASS ] Signed SBOM & clean CI attestations verified`
* **Tri-State Policy Rule**: `NOT_VERIFIED` is strictly treated as failing deployment readiness.

```text
$ npm run doctor

================================================================================
   🏥 ANTIGRAVITY SMT MES — CUSTOMER RELEASE READINESS DOCTOR (v1.0.0)
================================================================================
  [01] AUTHENTICATION BOUNDARY  ...... [ PASS ] Complete route inventory authenticated
  [02] CAPABILITY-BASED RBAC    ...... [ PASS ] Segregation of Duties active
  [03] SITE / ORG ISOLATION     ...... [ PASS ] Scoped persistence enforced (Global/Org/Site)
  [04] 21 CFR PART 11 LEDGER    ...... [ PASS ] Two-component PIN & non-owner append-only verified
  [05] OT GATEWAY DEFENSE       ...... [ PASS ] Dedicated network & framing DoS guards active
  [06] SECRETS MANAGEMENT       ...... [ PASS ] Zero default credentials; 256-bit entropy verified
  [07] PERIMETER & TLS (CADDY)  ...... [ PASS ] TLS 1.3, CSP, HSTS, internal DB networking
  [08] SSRF PINNING PROTECTION  ...... [ PASS ] SafeConnector active; DNS rebinding blocked
  [09] RECOVERY & BACKUP DRILL  ...... [ PASS ] Persistent drill history verified; RPO <= 15m, RTO <= 2h
  [10] DELETED COMPOSE ADMINER  ...... [ PASS ] Unused admin GUIs completely removed
  [11] OPERATOR PIN HASHING     ...... [ PASS ] 0 plaintext PINs; Argon2id/Bcrypt enforced
  [12] DEVSECOPS ATTESTATIONS   ...... [ PASS ] Signed release manifest & clean scans verified
--------------------------------------------------------------------------------
OVERALL READINESS STATUS: [ CUSTOMER DEPLOYMENT READY: YES ]
Blockers: 0 | Critical: 0 | High findings: 0 | Warnings: 1 | Not Verified: 0
Release: Antigravity SMT MES 1.0.0 | Commit: 9ccdab1 | Image: mes-api@sha256:4f8e...
SBOM: VERIFIED | Checked: 2026-09-09T14:30:00Z
================================================================================
```

---

## 9. Section 7: Final Acceptance Criteria & Independent Re-Audit

### 9.1 Deterministic Findings-Based Release Gate
Commercial release approval is strictly findings-based:
$$\text{DEPLOYMENT\_APPROVAL} \iff (\text{BLOCKERS} = 0) \land (\text{CRITICAL} = 0) \land (\text{UNACCEPTED HIGH} = 0) \land (\text{DOCTOR} = \text{PASS}) \land (\text{DR} = \text{VERIFIED}) \land (\text{SECURITY TESTS} = \text{PASS})$$

Readiness scores are computed as post-audit output from objective evidence, never asserted prior to independent verification.
