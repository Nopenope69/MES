# Antigravity SMT MES — Customer-Site Readiness, Security Hardening & Enterprise Appliance Specification
**Document ID:** SPEC-MES-2026-01  
**Target Release:** Antigravity SMT MES v1.0.0 (Production Customer Release)  
**Status:** APPROVED & FROZEN  
**Date:** 2026-09-09  

---

## 1. Executive Summary & Audit Baseline

An exhaustive, independent static code and architecture audit of the **Antigravity SMT MES Engine** evaluated its readiness for commercial customer deployment on Fuji NXT / EMS surface-mount lines.

### The Audit Verdict
* **Domain Engine**: **VERIFIED & STRONG (~7.0–8.5/10)**. Genuine SMT domain depth: JEDEC J-STD-033D MSL floor-life tracking, closed-loop splicing BOM interlocks, IPC-CFX printer auto-tuning, high-frequency reflow oven telemetry/PWI calculation, and defensive Fuji TCP socket framing.
* **Security & Enterprise Readiness**: **CRITICAL DEFICIENCIES (1.5/10)**. No authentication on 54/55 endpoints; unauthenticated, forgeable 21 CFR Part 11 e-signatures; unenforced tenant/site isolation; plaintext operator PINs; unauthenticated `/security/audit` disclosure; default Compose credentials and exposed Adminer; bypassed CI security gates (`npm audit || true`); and zero backup/disaster recovery mechanism.
* **Composite Baseline Score**: **~4.3 / 10** (Disqualified from commercial sale or deployment without remediation).

### The Strategic Directive
> **"Do not rewrite the SMT manufacturing core or convert the Antigravity SMT MES into a multi-million-line generic ERP/MES like Siemens Opcenter. Harden the perimeter, establish trustworthy identity, make recovery real, prove it under test, and productize deployment as a dedicated single-tenant, single-plant edge appliance."**

This specification establishes the technical architecture, security invariants, data schemas, API contracts, and verification gates required to systematically elevate every audit dimension to a **Target Readiness Score of $\ge 9.0\text{ / }10$**, subject to independent post-implementation re-audit.

---

## 2. Canonical Audit Traceability Matrix

To eliminate ambiguity between numbered security findings and broader architectural gaps, this canonical matrix maps every audit item to its implementing section and verification test:

| Audit Item | Category | Description | Severity | Implementing Section | Verification Test File |
|---|---|---|---|---|---|
| **D.1** | Security | No authentication on API (54/55 endpoints unprotected) | **Blocker** | Section 2 | `tests/auth-pipeline.test.ts` |
| **D.2** | Security | Inert JWT infrastructure (validated in config, never used) | **High** | Section 2 | `tests/auth-pipeline.test.ts` |
| **D.3** | Security | E-signature actor identity client-supplied (Part 11 forgery) | **Blocker** | Section 3 | `tests/compliance-ledger.test.ts` |
| **D.4** | Security | Unenforced operator roles / no RBAC | **Blocker** | Section 2 | `tests/rbac-capabilities.test.ts` |
| **D.5** | Security | Plaintext operator PINs in database | **High** | Section 2 | `tests/auth-pipeline.test.ts` |
| **D.6** | Security | Unenforced multi-site / organization isolation | **Blocker** | Section 1 | `tests/tenant-isolation.test.ts` |
| **D.7** | DevSecOps | Cosmetic `npm audit --audit-level=high \|\| true` gate | **High** | Section 6 | CI Pipeline Execution |
| **D.8** | DevSecOps | No SAST, secret scanning, or container scanning in CI | **High** | Section 6 | CI Pipeline Execution |
| **D.9** | Deployment | Default credentials & open Adminer in `docker-compose.yml` | **High** | Section 4 | `tests/deployment-compose.test.ts` |
| **D.10** | Security | Unauthenticated `/api/v1/security/audit` network disclosure | **Medium** | Section 4 | `tests/auth-pipeline.test.ts` |
| **D.11** | OT Security | Fuji gateway lacks device identity beyond source IP | **Medium** | Section 4 | `tests/ot-fuji-security.test.ts` |
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

### 3.2 Single-Tenant Edge Appliance Deployment Model (Gate 0)
* **Appliance Boundary**: Antigravity SMT MES is packaged and deployed as a dedicated single-tenant, single-plant edge appliance per customer factory.
* **ISA-95 Hierarchy**:
  $$\text{Organization (1)} \longrightarrow \text{Site (1+)} \longrightarrow \text{Area (1+)} \longrightarrow \text{Production Line (1+)} \longrightarrow \text{Work Center} \longrightarrow \text{Equipment Unit}$$
* **Deterministic Active Site Scope**: While an enterprise may own multiple sites, **each authenticated session is bound strictly to exactly one active `siteId`**.
* **Zero Client-Controlled Scope**: No route, handler, or query accepts `organization_id`, `site_id`, `actor_id`, or `role` from HTTP request bodies or query parameters. All contextual parameters are derived exclusively from the verified token.

### 3.3 Principal & Context Type Separation
Internal services and background workers must **never** masquerade as human operators or manufacture synthetic `operatorId`s:

```typescript
export type OperatorRole = 
  | 'OPERATOR' 
  | 'SUPERVISOR' 
  | 'PROCESS_ENGINEER' 
  | 'QA_DIRECTOR' 
  | 'SYSTEM_ADMIN';

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
      readonly permissions: ReadonlySet<Permission>;
      readonly organizationId: string;
      readonly siteId: string;
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
  readonly jobName: string; // e.g. 'event-projector', 'backup-runner', 'retention-worker'
}

export type ExecutionContext = RequestContext | ServiceContext;
```

### 3.4 Authority Trichotomy & Reverse Proxy Trust
1. **Authority Separation**: Strict invariant:
   $$\text{correlationId (tracing)} \neq \text{requestId (server operation)} \neq \text{operatorId / serviceId (security identity)}$$
   - Client `X-Correlation-ID` is preserved for distributed tracing only if matching `^[a-zA-Z0-9_-]{8,64}$`.
   - `requestId` is **always** server-generated via `crypto.randomUUID()`.
2. **Trusted Proxy Source IP Resolution**:
   - Express `trust proxy` is configured strictly to the known Caddy container/bridge subnet via `TRUSTED_PROXIES` environment variable (never blindly `loopback` inside Docker bridge networks).
   - Injected `X-Forwarded-For` headers from untrusted hops are discarded.
3. **Fail-Closed Missing Context Invariant**:
   - Any database query, event append, or ledger write attempted without an active `ExecutionContext` immediately throws `SecurityContextMissingError`.
   - **Zero Defaulting Rule**: The system **never** silently defaults missing contexts to a "system" or "admin" tenant.

### 3.5 Scoped Repository Factory Pattern
Application services never receive raw database clients. All persistence access passes through a scoped repository factory:

```typescript
export interface ScopedDataRepository {
  readonly batches: ScopedBatchRepository;
  readonly genealogy: ScopedGenealogyRepository;
  readonly compliance: ScopedComplianceRepository;
  readonly smt: ScopedSmtRepository;
  readonly reflow: ScopedReflowRepository;
}

export class MasterRepository {
  public forContext(ctx: ExecutionContext): ScopedDataRepository {
    if (!ctx || !ctx.principal || !ctx.principal.organizationId || !ctx.principal.siteId) {
      throw new SecurityContextMissingError('Attempted database access without valid ExecutionContext');
    }
    return new ScopedDataRepositoryImpl(this.db, ctx);
  }

  // Raw database execution methods are protected and inaccessible to domain services
  protected executeRaw(...) { ... }
}
```

Every query generated by `ScopedDataRepositoryImpl` automatically injects tenant and site predicates:
```sql
SELECT * FROM batches 
WHERE id = ? 
  AND organization_id = ? 
  AND site_id = ?
```

### 3.6 HTTP Status Semantics
- **`401 UNAUTHORIZED`**: Missing, invalid, expired, or revoked token.
- **`404 NOT FOUND`**: Entity exists in DB but belongs to another `siteId` or `organizationId` (strictly eliminates cross-site existence disclosure).
- **`403 FORBIDDEN`**: Entity is within caller's authorized scope, but caller lacks the required `Permission`.

---

## 4. Section 2: Identity, Session Lifecycle & Capability-Based RBAC Pipeline

### 4.1 The Core Identity & Revocation Invariant
> **"Every high-consequence authorization decision is validated against authoritative authorization state. Client-held tokens with stale roles, revoked sessions, or expired authorization versions are rejected immediately on the next request. System Administration is strictly decoupled from manufacturing quality authority."**

### 4.2 Credential Standards & Anti-Enumeration
1. **Credential Hashing Algorithms**:
   - Human PINs & Passwords: **Argon2id / Bcrypt** (cost $\ge 12$, `VARCHAR(255)`).
   - Machine Refresh Tokens & Service Keys: **SHA-256** (`VARCHAR(64)`). High entropy avoids bcrypt 72-byte truncation limits.
2. **PIN Complexity Policy**:
   - `OPERATOR`: 4 to 8 numeric digits (leading zeros permitted, e.g. `"0429"`). Validated server-side via `^\d{4,8}$`.
   - Privileged Roles (`SUPERVISOR`, `PROCESS_ENGINEER`, `QA_DIRECTOR`, `SYSTEM_ADMIN`): Minimum **6 to 8 numeric digits** for kiosk PINs, or high-entropy passwords ($\ge 10$ chars with mixed case, numbers, and symbols).
3. **Anti-User-Enumeration Invariant**:
   - Unknown `operatorCode` executes `bcrypt.compare` against a pre-computed constant `DUMMY_PIN_HASH`.
   - Returns identical `401 {"error": "INVALID_CREDENTIALS"}` payload and statistically bounded timing distribution as an invalid PIN for an existing operator.
4. **Atomic Concurrency-Safe Lockout**:
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
* **Access JWT**: 15-minute TTL. Stored **strictly in memory** in the React application state.
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

### 4.5 Non-Delegable Segregation of Duties (SoD)
> **Invariant**: `SYSTEM_ADMIN` administers system configuration, operator credentials, and backups, but is **strictly barred from manufacturing quality approvals** (`REFLOW_PROFILE_APPROVE`, `QUALITY_GATE_OVERRIDE`, `DHR_RELEASE`, `LEDGER_SIGN`, `INTERLOCK_OVERRIDE`). High-consequence manufacturing capabilities are non-delegable to `SYSTEM_ADMIN`.

#### Production SoD Matrix
| Capability | `OPERATOR` | `SUPERVISOR` | `PROCESS_ENGINEER` | `QA_DIRECTOR` | `SYSTEM_ADMIN` |
|---|:---:|:---:|:---:|:---:|:---:|
| `REFLOW_PROFILE_UPLOAD` | NO | NO | **YES** | NO | NO |
| `REFLOW_PROFILE_APPROVE` | NO | NO | NO | **YES** | **BLOCKED** |
| `REFLOW_PROFILE_ACTIVATE` | NO | **YES** | NO | NO | **BLOCKED** |
| `INTERLOCK_OVERRIDE` | NO | **YES** | NO | NO | **BLOCKED** |
| `QUALITY_GATE_OVERRIDE` | NO | NO | NO | **YES** | **BLOCKED** |
| `DHR_RELEASE` | NO | NO | NO | **YES** | **BLOCKED** |
| `LEDGER_SIGN` | NO | NO | NO | **YES** | **BLOCKED** |
| `OPERATOR_MANAGE` | NO | NO | NO | NO | **YES** |
| `SYSTEM_CONFIG` | NO | NO | NO | NO | **YES** |
| `CHAOS_EXECUTE` | NO | NO | NO | NO | **YES** |

* **Domain-Level SoD Check**: In addition to role permissions, `ReflowProfileService` and `EdhrService` enforce:
  $$\text{creatorOperatorId} \neq \text{approverOperatorId}$$

### 4.6 Service Credential Lifecycle with Multiple Active Keys
```sql
CREATE TABLE IF NOT EXISTS service_credentials (
  id VARCHAR(64) PRIMARY KEY,
  service_id VARCHAR(64) NOT NULL,
  service_name VARCHAR(128) NOT NULL,
  key_hash VARCHAR(64) NOT NULL, -- SHA-256(raw_key)
  organization_id VARCHAR(64) NOT NULL,
  site_id VARCHAR(64) NOT NULL,
  permissions TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  last_used_at TIMESTAMP,
  created_by VARCHAR(64) NOT NULL,
  revoked_by VARCHAR(64),
  revoked_at TIMESTAMP
);

CREATE INDEX idx_service_cred_lookup ON service_credentials(key_hash, status);
CREATE INDEX idx_service_cred_service ON service_credentials(service_id, status);
```
Supports multiple concurrent active keys per service for seamless zero-downtime key rotation.

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

### 5.4 Database Privilege Segregation & Transactional Outbox
1. **Atomic Transaction**:
   ```sql
   BEGIN TRANSACTION;
     -- Append compliance_signatures block
     -- Append event_outbox (COMPLIANCE_SIGNATURE_RECORDED)
   COMMIT;
   ```
2. **Database Engine Hardening**:
   ```sql
   GRANT SELECT, INSERT ON compliance_signatures TO mes_user;
   REVOKE UPDATE, DELETE ON compliance_signatures FROM mes_user;
   ```
   The ledger is strictly append-only at the database engine level.

### 5.5 §11.50 Signature Manifestation
Displays and exports (PDF/eDHR) must render:
1. Printed full name of signer (`operator_name`).
2. Authoritative UTC date and time (`executedAt`).
3. Meaning of signature (`meaning`).

---

## 6. Section 4: Edge Appliance Perimeter, Secrets & OT Hardening

### 6.1 Perimeter Architecture & Docker Hardening (Gate 5)
* **Adminer Excised**: The open database management tool is permanently removed from all Docker Compose templates.
* **PostgreSQL Port Publishing Removed**: Port `5432:5432` is removed from host publishing. PostgreSQL is reachable only by internal Docker containers on `mes_network`.
* **Zero Default Passwords**: Docker Compose enforces mandatory environment variables (`${POSTGRES_USER:?error}`, `${POSTGRES_PASSWORD:?error}`).
* **Caddy Gateway**: TLS 1.3 preferred, HSTS, strict CSP, automated HTTP $\rightarrow$ HTTPS redirect. `/metrics` blocked from external LAN.

### 6.2 Irreversible Appliance Bootstrap Lifecycle
To eliminate persistent setup backdoors, appliance bootstrap is governed by a state machine backed by persistent database state:
$$\text{UNINITIALIZED} \longrightarrow \text{BOOTSTRAPPING} \longrightarrow \text{INITIALIZED} \longrightarrow \text{BOOTSTRAP\_UNMOUNTED}$$
- When `operators` table contains $\ge 1$ administrator, the appliance is in `INITIALIZED` state.
- The `POST /api/v1/auth/bootstrap` route is **completely unmounted** from the Express router in production code. Any incoming request hits the 404/410 terminal gate.

### 6.3 Replay-Resistant Internal Callbacks with Persistent Idempotency
Internal asynchronous callbacks (e.g. background batch processing or async job completion) require cryptographic authentication:
- `X-Timestamp`: Validated against server time within a $\pm 30\text{s}$ drift window.
- `X-Nonce`: Validated against a database-backed idempotency table (`internal_callback_nonces`) to prevent replay attacks across process or container restarts:
  ```sql
  CREATE TABLE IF NOT EXISTS internal_callback_nonces (
    nonce VARCHAR(64) PRIMARY KEY,
    endpoint VARCHAR(128) NOT NULL,
    received_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL
  );
  ```
- `X-Signature`: $\text{HMAC-SHA256}(\text{internalSecret}, \text{timestamp} + \text{nonce} + \text{bodyHash})$.

### 6.4 Same-Origin Routing, Strict CSP & Appliance CA Onboarding
1. **Zero-CORS Same-Origin Architecture**: Caddy serves the Cleanroom Operator HUD / Web UI and `/api/*` under a single origin (`https://mes.local/`). CORS headers are eliminated for internal application traffic.
2. **Strict Content Security Policy (CSP)**:
   ```text
   default-src 'self';
   script-src 'self';
   connect-src 'self';
   img-src 'self' data:;
   font-src 'self';
   object-src 'none';
   base-uri 'self';
   frame-ancestors 'none';
   form-action 'self';
   ```
3. **Strict HTTPS (No Port 80 Fallback)**: Port 80 issues an unconditional `301 Moved Permanently` to port 443. Plaintext HTTP traffic is banned.
4. **Appliance CA Onboarding**:
   - Appliance exposes its internal CA root certificate for download (`GET /api/v1/security/ca.crt`).
   - The Cockpit settings screen displays the CA SHA-256 fingerprint for manual verification.
   - Enterprise deployments support uploading customer PKI certificates.

### 6.5 Secrets Management & Startup Entropy Enforcement (Gate 6)
* Production startup enforces $\ge 32$ cryptographically secure random bytes for `JWT_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `INTERNAL_API_SECRET`, and `POSTGRES_PASSWORD`.
* Startup halts with exit code 1 if default or known patterns (`"admin"`, `"secret"`, `"12345"`) are detected.
* `/api/v1/security/audit` is gated behind `requirePermission(Permission.AUDIT_VIEW)`.

### 6.6 OT/IIoT Perimeter Defense: Fuji Nexim Gateway (Gate 9)
1. **Physical & Network Segmentation**: OT interface bound strictly to dedicated machine network. Port 30040 is physically inaccessible from plant office LAN.
2. **Dynamic Challenge-Response Handshake**:
   - Gateway sends random 256-bit nonce upon connection.
   - Machine controller proves possession of per-device key via `HMAC(nonce || deviceId || protocolVersion)`.
   - Legacy machines without cryptographic firmware fall back strictly to documented compensating controls (isolated OT VLAN + hardware firewall + monitored IP allowlist).
3. **Defensive Protocol Framing**: 64KB max buffer cap, sync header validation, corrupt length disconnect, 30s idle timeout.

### 6.7 Egress Security & Socket Connection Pinning (Gate 8)
- **Class-Based Egress Policy**:
  - Internal service calls: restricted to registered service identities.
  - External webhooks & enterprise integrations (ERP/PLM export): restricted to approved public HTTPS destinations.
- **Socket-Level Connection Pinning**:
  1. Resolves all A/AAAA records.
  2. Validates against loopback, RFC1918, link-local (`169.254.0.0/16`), CGNAT, and IPv4-mapped IPv6.
  3. Binds socket directly to the validated IP address, eliminating DNS rebinding attacks.
  4. HTTP redirects disabled (`redirect: 'manual'`).

---

## 7. Section 5: Data Protection, Backup & Disaster Recovery Drill Pipeline

### 7.1 Recovery Objectives & SLA Definition (Gate 10)
* **Measured RPO Target**: **$\le 15\text{ minutes}$** (Continuous WAL archiving in Postgres / 15-minute online SQLite backup snapshots).
* **Demonstrated RTO Target**: **$\le 2\text{ hours}$** (Demonstrated during automated restore drills).

### 7.2 Point-in-Time Recovery Package Architecture
Backups bundle four synchronized tiers into an encrypted package (`mes-recovery-YYYYMMDD-HHMMSS.tar.gz`):
1. **Relational Core**: Consistent DB snapshot with recorded `databaseRecoveryLSN`.
2. **EventStore**: Append log and projection state up to recorded sequence number.
3. **Physical Evidence**: Raw profiler runs, AOI inspection images, signed eDHR PDFs with signed `evidence-manifest.json` (listing path, size, SHA-256, source record ID).
4. **Configuration & Keystore**: Site configuration and encrypted credentials.

#### Offline Key Escrow & Segregated Restore Classes
- `BACKUP_ENCRYPTION_KEY`: AES-256-GCM. Stored off-appliance with a formal offline key custodian recovery procedure.
- Restores separate `--restore-data`, `--restore-config`, and `--restore-secrets` to prevent accidental credential overwrites.

### 7.3 Automated DR Drill Pipeline (`scripts/dr-drill.sh`)
Executes an automated destructive drill in an isolated environment:
1. Destroys test database.
2. Restores recovery package.
3. Verifies schema, EventStore monotonicity, compliance hash chain (`verifyIntegrity()`), and genealogy parity.
4. Verifies 100% of evidence file hashes match manifest.
5. Verifies cross-system integrity: missing evidence or orphaned DB references fail closed.
6. Boots appliance and executes production smoke tests.
7. Records `RPOSeconds` and `RTOSeconds`.
8. **Incident Quarantine Rule**: Any ledger hash mismatch triggers automatic record quarantine and audit alert; automated "hash repairs" are strictly prohibited.

---

## 8. Section 6: DevSecOps CI Gates, Rigorous Security Testing & MES Doctor CLI

### 8.1 Hardened DevSecOps Pipeline (Gate 11)
- **`npm audit` Gate with Governed Exceptions**:
  - Fails on High or Critical vulnerabilities.
  - Exception path requires schema-validated `.audit-exceptions.json`:
    ```json
    {
      "cve": "CVE-2026-XXXX",
      "package": "example-pkg",
      "rationale": "Vulnerable code path is not reachable in runtime execution path",
      "expiresAt": "2026-10-15",
      "approvedBy": "security-lead@mes-appliance.local"
    }
    ```
  - Unapproved or expired exceptions fail the build.
- **SAST & Secret Scanning**: Semgrep (OWASP Top 10) and Gitleaks active in CI. Any detected historical credential ever usable in production must be revoked/rotated, not merely deleted from Git.
- **Container Scanning & SBOM**: Trivy base-image scan and CycloneDX SBOM generated on every build.
- **Supply Chain Provenance**: Signed release manifest links:
  $$\text{Git Commit SHA} \longrightarrow \text{Container Image Digest} \longrightarrow \text{SBOM Digest} \longrightarrow \text{Scan Attestations}$$

### 8.2 Architectural Telemetry Separation Test
Verifies that 100 Hz reflow telemetry enters `ITelemetryStore`, rolling statistics compute locally, and only derived discrete events enter `EventStore`. Asserts:
$$\text{EventStore Event Count} \ll \text{Telemetry Sample Count}$$

### 8.3 Productized Appliance Onboarding & Bootstrap Wizard (Gate 13)
- First boot on empty database enters `PROVISIONING_MODE`.
- Prompts for organization info, initial site context, and first `SYSTEM_ADMIN` password ($\ge 12$ chars).
- Configures lines, equipment units, and backup targets.
- Runs `mes doctor`. Upon PASS, seals `PROVISIONING_MODE` permanently.

### 8.4 Automated Release Readiness CLI: `mes doctor` (Gate 14)
CLI utility (`scripts/mes-doctor.ts` / `npm run doctor`) executes 12 structured diagnostic modules:

```typescript
interface DoctorResult {
  status: 'PASS' | 'FAIL' | 'NOT_VERIFIED';
  severity: 'BLOCKER' | 'WARNING' | 'INFO';
  evidence: string[];
  checkedAt: string;
}
```

* **Core Rule**: `NOT_VERIFIED` is **never** equivalent to `PASS`.
* **Deterministic Readiness Policy**:
  $$\text{CUSTOMER\_DEPLOYMENT\_READY} = (\text{Blockers} = 0) \land (\text{High Findings} = 0) \land (\text{Not Verified} = 0) \land (\text{DR Drill Recency} \le 30\text{d}) \land (\text{Secrets Valid}) \land (\text{TLS Valid}) \land (\text{Release Digest Verified})$$

```text
$ npm run doctor

================================================================================
   🏥 ANTIGRAVITY SMT MES — CUSTOMER RELEASE READINESS DOCTOR (v1.0.0)
================================================================================
  [01] AUTHENTICATION BOUNDARY  ...... [ PASS ] Global auth on 55/55 endpoints
  [02] CAPABILITY-BASED RBAC    ...... [ PASS ] Segregation of Duties active
  [03] SITE / ORG ISOLATION     ...... [ PASS ] Mandatory RequestContext enforced
  [04] 21 CFR PART 11 LEDGER    ...... [ PASS ] Two-component PIN & hash chain verified
  [05] OT GATEWAY DEFENSE       ...... [ PASS ] Dedicated network & challenge-response
  [06] SECRETS MANAGEMENT       ...... [ PASS ] Zero default credentials; 256-bit entropy
  [07] PERIMETER & TLS (CADDY)  ...... [ PASS ] TLS 1.3, CSP, HSTS, no exposed DB ports
  [08] SSRF PINNING PROTECTION  ...... [ PASS ] Egress policy active; DNS rebinding blocked
  [09] RECOVERY & BACKUP DRILL  ...... [ PASS ] Restore verified; RPO <= 15m, RTO <= 2h
  [10] DELETED COMPOSE ADMINER  ...... [ PASS ] Unused admin GUIs completely removed
  [11] OPERATOR PIN HASHING     ...... [ PASS ] 0 plaintext PINs; Argon2id/Bcrypt enforced
  [12] DEVSECOPS CI GATES       ...... [ PASS ] npm audit, Semgrep, Gitleaks, Trivy active
--------------------------------------------------------------------------------
OVERALL READINESS STATUS: [ CUSTOMER DEPLOYMENT READY: YES ]
Blockers: 0 | High findings: 0 | Warnings: 1 | Not Verified: 0
Release: Antigravity SMT MES 1.0.0 | Commit: 9ccdab1 | Image: mes-api@sha256:4f8e...
SBOM: VERIFIED | Policy: v1 | Checked: 2026-09-09T14:30:00Z
Target Readiness Score: >= 9.0 / 10 (Subject to post-implementation re-audit)
================================================================================
```

---

## 9. Projected Readiness Transformation

| Dimension | Initial Audit Score | Target Release Score | Justification & Verification Evidence |
|---|:---:|:---:|---|
| **Authentication** | 0.5 / 10 | **$\ge 9.0$ / 10** | Default-deny on 55/55 endpoints; dual-token JWT; anti-stale `authzVersion`; instant revocation. |
| **RBAC / Authorization** | 0.5 / 10 | **$\ge 9.0$ / 10** | Capability-based permissions; strict SoD (System Admin decoupled from Quality). |
| **Session & Credentials** | 1.0 / 10 | **$\ge 9.0$ / 10** | Argon2id/Bcrypt for PINs; SHA-256 for tokens; token-family refresh rotation; anti-enumeration. |
| **Part 11 / E-Signatures** | 4.0 / 10 | **$\ge 9.0$ / 10** | Server-derived identity; two-component PIN re-auth; canonical envelope hash; version linkage. |
| **Tenant / Site Isolation** | 1.0 / 10 | **$\ge 9.0$ / 10** | Mandatory `RequestContext`; scoped repository factory; 404 existence defense. |
| **Perimeter & Deployment** | 5.0 / 10 | **$\ge 9.0$ / 10** | Caddy TLS 1.3; Adminer excised; internal DB networking; zero default Compose passwords. |
| **OT / IIoT Security** | 5.0 / 10 | **$\ge 8.5$ / 10** | Challenge-response handshake; dedicated host firewall routing; 64KB buffer defense. |
| **DevSecOps** | 3.0 / 10 | **$\ge 9.0$ / 10** | Blocking `npm audit` with governed exceptions; Semgrep SAST; Gitleaks; Trivy; CycloneDX SBOM. |
| **Reliability & DR** | 0.0 / 10 | **$\ge 9.0$ / 10** | Point-in-time recovery packages; automated restore drill script; measured RPO $\le 15$m, RTO $\le 2$h. |
| **Testing** | 5.0 / 10 | **$\ge 9.0$ / 10** | Expanded security test suites; cross-site isolation; concurrency races; benchmark budgets. |
| **Productization** | 3.0 / 10 | **$\ge 8.5$ / 10** | Appliance onboarding bootstrap wizard; removal of hardcoded demo seed; `mes doctor`. |
| **Data Integrity** | 6.0 / 10 | **$\ge 9.0$ / 10** | Hash chain backed by authenticated identity and database-level append-only privileges. |
| **Traceability** | 7.0 / 10 | **$\ge 8.5$ / 10** | Forward/backward trace preserved across backup/restore drills and site-scoped boundaries. |
| **Architecture** | 7.0 / 10 | **$\ge 8.5$ / 10** | Clean 3-tier event-sourcing with strict persistence scoping and telemetry separation. |
| **Overall Target** | **~4.3 / 10** | **$\ge 9.0\text{ / }10$** | **Production-ready, edge-native SMT quality & compliance appliance.** |

---
*End of Specification — Frozen for Implementation Planning.*
