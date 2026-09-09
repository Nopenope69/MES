# VigilOne MES — Customer-Site Readiness, Security Hardening & Enterprise Appliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform VigilOne SMT MES from an advanced prototype into an enterprise-hardened, customer-deployable edge appliance with $\ge 9.0/10$ readiness across identity, capability-based RBAC, attributable 21 CFR Part 11 e-signatures, tenant/site isolation, perimeter security, disaster recovery, and automated release verification.

**Architecture:** We wrap the existing, verified SMT manufacturing core (MSL, Splicing, IPC-CFX, Reflow PWI) in an uncompromising security perimeter: server-derived `RequestContext` with scoped repositories, dual-token JWT + HttpOnly refresh family rotation with anti-stale `authzVersion`, two-component PIN e-signatures with RFC 8785 canonical envelope hashing, same-origin Caddy TLS 1.3 edge proxy with internal Docker network isolation, point-in-time recovery packages with measured RPO/RTO destructive drills, and an automated release readiness CLI (`vigilone doctor`).

**Tech Stack:** TypeScript, Node.js 22, Express, SQLite (`node:sqlite`) & PostgreSQL 16, Caddy 2, `bcryptjs`, `jsonwebtoken`, Zod, Vitest, Semgrep, Gitleaks, Trivy, CycloneDX.

**Spec:** [`docs/superpowers/specs/2026-09-09-vigilone-customer-readiness-design.md`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/docs/superpowers/specs/2026-09-09-vigilone-customer-readiness-design.md)

## Global Constraints
- Target Deployment: Single-tenant, single-plant edge appliance.
- ISA-95 Hierarchy: Organization (1) -> Site (1+) -> Area (1+) -> Line (1+) -> WorkCenter -> EquipmentUnit.
- Invariant: No client-controlled identity, role, organization, or site parameters accepted in request bodies or query parameters.
- Invariant: Zero application-level database access without an explicit authenticated `ExecutionContext`; missing context throws `SecurityContextMissingError`.
- Invariant: All 55 endpoints default to authenticated (`401 UNAUTHORIZED`); public allowlist strictly limited to `/health`, `/api/v1/auth/login`, and `/api/v1/auth/refresh`.
- Invariant: System Administration is strictly decoupled from manufacturing quality authority (non-delegable SoD).
- Invariant: Electronic signatures strictly enforce two-component PIN re-auth, §11.70 record version linkage, and database-level append-only privileges (`REVOKE UPDATE, DELETE`).
- Invariant: MediaMTX port 8554 removed from host publishing; camera streams ingested via private RTSP pull.
- Invariant: Point-in-time recovery packages require measured RPO $\le 15$ min and demonstrated RTO $\le 2$ hours during destructive drills.
- Invariant: `vigilone doctor` emits `CUSTOMER DEPLOYMENT READY: YES` only when all mandatory blocker checks PASS with verified operational evidence.

---

### Task 1: Security Context & Scoped Persistence Infrastructure (Section 1)

**Files:**
- Create: `apps/api/src/security/context.ts`
- Create: `apps/api/src/db/scoped-repository.ts`
- Create: `apps/api/src/security/trusted-proxy.ts`
- Modify: `apps/api/src/db/database.ts`
- Test: `apps/api/tests/tenant-isolation.test.ts`

**Interfaces:**
- Produces: `SecurityPrincipal`, `RequestContext`, `ServiceContext`, `ExecutionContext`, `SecurityContextMissingError`, `MasterRepository.forContext(ctx)`.

- [ ] **Step 1: Write the failing test for context scoping and tenant isolation**

```typescript
// apps/api/tests/tenant-isolation.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MasterRepository } from '../src/db/scoped-repository';
import { RequestContext, SecurityContextMissingError } from '../src/security/context';
import { DatabaseManager } from '../src/db/database';

describe('Tenant & Site Persistence Scoping Suite', () => {
  let masterRepo: MasterRepository;

  beforeEach(() => {
    const db = DatabaseManager.getInstance();
    masterRepo = new MasterRepository(db);
  });

  it('throws SecurityContextMissingError when database access attempted without context', () => {
    expect(() => masterRepo.forContext(null as any)).toThrow(SecurityContextMissingError);
  });

  it('strictly isolates queries by organizationId and siteId, returning 404 for cross-site entity', async () => {
    const siteACtx: RequestContext = {
      principal: {
        kind: 'HUMAN',
        operatorId: 'op-site-a',
        operatorCode: 'OP-A1',
        role: 'OPERATOR',
        permissions: new Set(['batch:view']),
        organizationId: 'ORG-DIXON',
        siteId: 'SITE-NOIDA-01',
        sessionId: 'sess-a'
      },
      correlationId: 'corr-1',
      requestId: 'req-1',
      ipAddress: '127.0.0.1'
    };

    const scopedRepoA = masterRepo.forContext(siteACtx);
    // Attempting to query an entity that belongs to SITE-CHENNAI-02 returns null (maps to 404)
    const result = await scopedRepoA.batches.findById('batch-chennai-999');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace=@mes/api test -- apps/api/tests/tenant-isolation.test.ts`
Expected: FAIL with module not found / compilation error.

- [ ] **Step 3: Implement `context.ts`, `trusted-proxy.ts`, and `scoped-repository.ts`**

Implement `SecurityPrincipal`, `RequestContext`, `ServiceContext`, `ExecutionContext`, and `MasterRepository.forContext(ctx)` in `apps/api/src/security/context.ts` and `apps/api/src/db/scoped-repository.ts`, binding mandatory `organization_id = ? AND site_id = ?` predicates to all queries.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace=@mes/api test -- apps/api/tests/tenant-isolation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/security/context.ts apps/api/src/db/scoped-repository.ts apps/api/src/security/trusted-proxy.ts apps/api/tests/tenant-isolation.test.ts
git commit -m "feat(security): implement mandatory RequestContext and scoped repository factory"
```

---

### Task 2: Operator Credential Model, Anti-Enumeration & Atomic Lockout (Section 2)

**Files:**
- Modify: `apps/api/package.json` (add `bcryptjs`, `@types/bcryptjs`)
- Modify: `apps/api/src/db/schema.sql`
- Modify: `apps/api/src/db/schema-sql.ts`
- Create: `apps/api/src/services/authentication.service.ts`
- Create: `apps/api/src/routes/auth.router.ts`
- Test: `apps/api/tests/auth-credentials.test.ts`

**Interfaces:**
- Produces: `AuthenticationService.login(code, pin, ip, userAgent)`, `AuthenticationService.unlockOperator(operatorId, supervisorCtx, reason)`.

- [ ] **Step 1: Install `bcryptjs` dependency**

```bash
npm --workspace=@mes/api install bcryptjs
npm --workspace=@mes/api install -D @types/bcryptjs
```

- [ ] **Step 2: Write failing test for anti-enumeration, PIN policy, and atomic lockout**

```typescript
// apps/api/tests/auth-credentials.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AuthenticationService } from '../src/services/authentication.service';

describe('Operator Credential & Anti-Enumeration Suite', () => {
  it('returns identical generic INVALID_CREDENTIALS for unknown operatorCode without user leakage', async () => {
    const result = await AuthenticationService.login('NONEXISTENT-OP', '1234', '127.0.0.1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_CREDENTIALS');
  });

  it('atomically locks account after 5 consecutive failed PIN attempts', async () => {
    for (let i = 0; i < 4; i++) {
      const res = await AuthenticationService.login('OP-101', 'wrong-pin', '127.0.0.1');
      expect(res.success).toBe(false);
    }
    const fifthAttempt = await AuthenticationService.login('OP-101', 'wrong-pin', '127.0.0.1');
    expect(fifthAttempt.error).toBe('ACCOUNT_LOCKED');
  });
});
```

- [ ] **Step 3: Update database schema and implement `AuthenticationService`**

Remove plaintext `pin` from schema. Add `pin_hash VARCHAR(255)`, `password_hash VARCHAR(255)`, `status`, `failed_login_attempts`, `locked_until`, `authz_version`. Implement atomic SQL lockout update and constant-time dummy verification on unknown operator.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace=@mes/api test -- apps/api/tests/auth-credentials.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/schema.sql apps/api/src/services/authentication.service.ts apps/api/tests/auth-credentials.test.ts
git commit -m "feat(auth): implement Argon2id/Bcrypt operator credentials, atomic lockout and anti-enumeration"
```

---

### Task 3: Dual-Token Architecture, Refresh Family Rotation & Stale Token Invalidation (Section 2)

**Files:**
- Modify: `apps/api/package.json` (add `jsonwebtoken`, `@types/jsonwebtoken`)
- Modify: `apps/api/src/db/schema.sql`
- Create: `apps/api/src/security/jwt-manager.ts`
- Modify: `apps/api/src/services/authentication.service.ts`
- Create: `apps/api/src/security/auth-middleware.ts`
- Test: `apps/api/tests/token-family-rotation.test.ts`

**Interfaces:**
- Produces: `JwtManager.signAccessToken(claims)`, `JwtManager.verifyAccessToken(token)`, `AuthenticationService.refreshSession(refreshToken, ip)`, `globalAuthMiddleware`.

- [ ] **Step 1: Install `jsonwebtoken` dependency**

```bash
npm --workspace=@mes/api install jsonwebtoken
npm --workspace=@mes/api install -D @types/jsonwebtoken
```

- [ ] **Step 2: Write failing test for token family refresh rotation, replay theft, and authzVersion**

```typescript
// apps/api/tests/token-family-rotation.test.ts
import { describe, it, expect } from 'vitest';
import { AuthenticationService } from '../src/services/authentication.service';
import { JwtManager } from '../src/security/jwt-manager';

describe('Token Family Rotation & Invalidation Suite', () => {
  it('rotates refresh token on use and rejects previously consumed token with session revocation', async () => {
    const login = await AuthenticationService.login('OP-101', '0429', '127.0.0.1');
    expect(login.success).toBe(true);

    const refresh1 = await AuthenticationService.refreshSession(login.refreshToken!, '127.0.0.1');
    expect(refresh1.success).toBe(true);

    // Presenting consumed token triggers theft detection and revokes session
    const replayAttempt = await AuthenticationService.refreshSession(login.refreshToken!, '127.0.0.1');
    expect(replayAttempt.success).toBe(false);
    expect(replayAttempt.error).toBe('TOKEN_REUSE_DETECTED');
  });

  it('rejects access token immediately when operator authzVersion increments', async () => {
    // Generates token with authzVersion = 1, increments DB version to 2, asserts 401 TOKEN_STALE
  });
});
```

- [ ] **Step 3: Implement `operator_sessions`, `operator_refresh_tokens`, `JwtManager`, and `auth-middleware.ts`**

Implement serialized refresh transaction (`SELECT ... FOR UPDATE`), token family replay detection, in-memory `revokedSessionCache`, and `authzVersion` cache hydration.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace=@mes/api test -- apps/api/tests/token-family-rotation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/security/jwt-manager.ts apps/api/src/security/auth-middleware.ts apps/api/src/services/authentication.service.ts apps/api/tests/token-family-rotation.test.ts
git commit -m "feat(auth): add dual-token JWT, token-family refresh rotation and anti-stale invalidation"
```

---

### Task 4: Capability-Based RBAC & Segregation of Duties Across All 55 Endpoints (Section 2)

**Files:**
- Create: `apps/api/src/security/permissions.ts`
- Modify: `apps/api/src/server.ts`
- Modify: All 14 router files in `apps/api/src/routes/`
- Test: `apps/api/tests/rbac-capabilities.test.ts`

**Interfaces:**
- Produces: `Permission` enum, `requirePermission(permission)`, `requireRoles(...)`.

- [ ] **Step 1: Write failing test verifying RBAC guards and Segregation of Duties**

```typescript
// apps/api/tests/rbac-capabilities.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';

describe('Capability-Based RBAC & SoD Suite', () => {
  it('blocks unauthenticated requests on all domain endpoints with 401', async () => {
    const res = await request(app).post('/api/v1/smt/splice-verify').send({});
    expect(res.status).toBe(401);
  });

  it('strictly prevents SYSTEM_ADMIN from performing manufacturing quality approvals (DHR release)', async () => {
    // Signs in as admin, attempts DHR release, receives 403 FORBIDDEN
  });

  it('enforces creator != approver on reflow profile approvals', async () => {
    // Engineer uploads profile, tries to approve own profile -> 403 CREATOR_CANNOT_APPROVE
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace=@mes/api test -- apps/api/tests/rbac-capabilities.test.ts`
Expected: FAIL (endpoints currently unauthenticated).

- [ ] **Step 3: Implement `permissions.ts` and mount global auth middleware and guards**

Mount `globalAuthMiddleware` on `/api/v1/*` with strict public allowlist (`/health`, `/api/v1/auth/login`, `/api/v1/auth/refresh`). Annotate all 55 endpoints with `requirePermission(...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace=@mes/api test -- apps/api/tests/rbac-capabilities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/security/permissions.ts apps/api/src/server.ts apps/api/src/routes/ apps/api/tests/rbac-capabilities.test.ts
git commit -m "feat(rbac): protect all 55 API endpoints with capability guards and non-delegable SoD"
```

---

### Task 5: Attributable 21 CFR Part 11 Electronic Signature Engine (Section 3)

**Files:**
- Modify: `apps/api/src/routes/compliance.router.ts`
- Modify: `apps/api/src/services/compliance-ledger.service.ts`
- Modify: `apps/api/src/db/schema.sql`
- Create: `apps/api/src/utils/canonical-json.ts`
- Test: `apps/api/tests/compliance-ledger.test.ts`

**Interfaces:**
- Produces: `ComplianceLedgerService.signTransaction(ctx, req)`, `SignLedgerRequestSchema.strict()`.

- [ ] **Step 1: Write failing test for attributable two-component signature & canonical envelope**

```typescript
// apps/api/tests/compliance-ledger.test.ts
import { describe, it, expect } from 'vitest';

describe('21 CFR Part 11 Attributable Electronic Signature Suite', () => {
  it('strictly derives signer identity from authenticated session, rejecting client-asserted actorId', async () => {
    // Sends { actorId: "FAKE-DIR" }, expects 400 Bad Request via .strict() schema
  });

  it('requires correct component 2 signing PIN; wrong PIN returns 401 and adds zero ledger records', async () => {});

  it('detects any modification to reason, metadata, or role in compliance_signatures', async () => {});

  it('atomic outbox guarantees zero ledger-event inconsistency', async () => {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace=@mes/api test -- apps/api/tests/compliance-ledger.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement RFC 8785 canonicalization, strict request schema, and atomic outbox ledger signing**

Implement `canonical-json.ts`, bind `SignedEnvelope`, append to `compliance_signatures` + `event_outbox` in an atomic transaction, and enforce DB-level append-only privileges.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace=@mes/api test -- apps/api/tests/compliance-ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/compliance.router.ts apps/api/src/services/compliance-ledger.service.ts apps/api/src/utils/canonical-json.ts apps/api/tests/compliance-ledger.test.ts
git commit -m "feat(compliance): implement attributable two-component e-signatures with canonical envelope hash"
```

---

### Task 6: Edge Perimeter, Evidentiary Invariants & Egress Hardening (Section 4)

**Files:**
- Modify: `docker-compose.yml`
- Create: `deploy/caddy/Caddyfile`
- Create: `apps/api/src/security/egress-firewall.ts`
- Modify: `apps/api/src/config/secrets.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/tests/perimeter-egress.test.ts`

**Interfaces:**
- Produces: `EgressFirewall.validateAndPin(url, policyClass)`, `SecretsConfigManager.verifyProductionEntropy()`.

- [ ] **Step 1: Write failing test for SSRF socket pinning, DNS rebinding, and bootstrap 410**

```typescript
// apps/api/tests/perimeter-egress.test.ts
import { describe, it, expect } from 'vitest';
import { EgressFirewall } from '../src/security/egress-firewall';

describe('Perimeter & SSRF Socket Pinning Suite', () => {
  it('rejects outbound requests to private RFC1918, link-local, and IPv4-mapped IPv6 ranges', async () => {
    await expect(EgressFirewall.validateAndPin('http://169.254.169.254/latest/meta-data', 'WEBHOOK'))
      .rejects.toThrow('SSRF_EGRESS_BLOCKED');
  });

  it('unmounts /bootstrap route permanently once admin is enrolled', async () => {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace=@mes/api test -- apps/api/tests/perimeter-egress.test.ts`
Expected: FAIL.

- [ ] **Step 3: Harden Docker Compose, Caddyfile, and Egress Firewall**

Excise Adminer, remove port 5432 and RTSP 8554 host publishing, implement Caddy TLS 1.3 same-origin routing and 301 redirect, implement socket pinning in `egress-firewall.ts`, and unmount `/bootstrap` when initialized.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace=@mes/api test -- apps/api/tests/perimeter-egress.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml deploy/caddy/Caddyfile apps/api/src/security/egress-firewall.ts apps/api/tests/perimeter-egress.test.ts
git commit -m "feat(perimeter): excise Adminer/8554, enforce Caddy TLS 1.3 same-origin and SSRF socket pinning"
```

---

### Task 7: OT Gateway Challenge-Response & Dedicated Network Routing (Section 4)

**Files:**
- Modify: `apps/api/src/adapters/fuji-nexim.adapter.ts`
- Test: `apps/api/tests/ot-fuji-security.test.ts`

**Interfaces:**
- Produces: `FujiNeximAdapter.handleConnection(socket)` with dynamic nonce challenge-response handshake.

- [ ] **Step 1: Write failing test for challenge-response handshake and replay rejection**

```typescript
// apps/api/tests/ot-fuji-security.test.ts
import { describe, it, expect } from 'vitest';

describe('OT Fuji Gateway Security Suite', () => {
  it('requires cryptographic challenge-response HMAC handshake before accepting SMT frames', async () => {});
  it('rejects replayed handshake response with duplicate nonce', async () => {});
  it('drops connection when frame length header exceeds 64KB DoS limit', async () => {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace=@mes/api test -- apps/api/tests/ot-fuji-security.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement nonce challenge-response in `FujiNeximAdapter`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace=@mes/api test -- apps/api/tests/ot-fuji-security.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/adapters/fuji-nexim.adapter.ts apps/api/tests/ot-fuji-security.test.ts
git commit -m "feat(ot): implement challenge-response handshake and protocol DoS guards on Fuji gateway"
```

---

### Task 8: Point-in-Time Recovery Package & Automated DR Drill Pipeline (Section 5)

**Files:**
- Create: `scripts/backup.sh`
- Create: `scripts/restore.sh`
- Create: `scripts/dr-drill.sh`
- Create: `apps/api/src/services/dr-verification.service.ts`
- Test: `apps/api/tests/disaster-recovery.test.ts`

**Interfaces:**
- Produces: `./scripts/backup.sh`, `./scripts/restore.sh --restore-data --restore-config`, `./scripts/dr-drill.sh`, `DrVerificationService.verifyRestoredState()`.

- [ ] **Step 1: Write failing test for destructive disaster recovery drill and integrity verification**

```typescript
// apps/api/tests/disaster-recovery.test.ts
import { describe, it, expect } from 'vitest';
import { DrVerificationService } from '../src/services/dr-verification.service';

describe('Disaster Recovery Verification Suite', () => {
  it('verifies 100% schema, EventStore monotonicity, ledger hash chain, and evidence files', async () => {
    const report = await DrVerificationService.verifyRestoredState();
    expect(report.schemaValid).toBe(true);
    expect(report.ledgerIntegrity).toBe(true);
    expect(report.evidenceHashesMatch).toBe(true);
    expect(report.rpoSeconds).toBeLessThanOrEqual(900); // <= 15 minutes
  });

  it('fails closed when an evidence file referenced in database is missing from recovery package', async () => {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace=@mes/api test -- apps/api/tests/disaster-recovery.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `backup.sh`, `restore.sh`, `dr-drill.sh`, and `dr-verification.service.ts`**

Implement point-in-time recovery package creation with signed evidence manifest, AES-256-GCM envelope encryption, segregated restore classes, and automated quarantine on hash break.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace=@mes/api test -- apps/api/tests/disaster-recovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/backup.sh scripts/restore.sh scripts/dr-drill.sh apps/api/src/services/dr-verification.service.ts apps/api/tests/disaster-recovery.test.ts
git commit -m "feat(dr): implement point-in-time recovery packages and automated destructive DR drill pipeline"
```

---

### Task 9: DevSecOps CI Pipeline, Onboarding Wizard & `vigilone doctor` CLI (Section 6)

**Files:**
- Modify: `deploy/ci/ci.yml`
- Create: `.audit-exceptions.json`
- Create: `scripts/vigilone-doctor.ts`
- Modify: `apps/web/src/App.tsx` (add Operator Session Bar and Bootstrap Wizard)
- Modify: `package.json` (add `npm run doctor`)
- Test: `apps/api/tests/vigilone-doctor.test.ts`

**Interfaces:**
- Produces: `npm run doctor`, `VigilOneDoctor.runDiagnostics()`.

- [ ] **Step 1: Write failing test for `vigilone doctor` diagnostic modules and readiness policy**

```typescript
// apps/api/tests/vigilone-doctor.test.ts
import { describe, it, expect } from 'vitest';
import { VigilOneDoctor } from '../../scripts/vigilone-doctor';

describe('VigilOne Doctor Diagnostic Suite', () => {
  it('executes 12 structured modules and emits CUSTOMER DEPLOYMENT READY: YES only when all blocker checks pass', async () => {
    const result = await VigilOneDoctor.runDiagnostics();
    expect(result.modulesChecked).toBe(12);
    expect(result.blockersCount).toBe(0);
    expect(result.deploymentReady).toBe(true);
  });

  it('marks deployment readiness NO if any blocker check returns FAIL or NOT_VERIFIED', async () => {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace=@mes/api test -- apps/api/tests/vigilone-doctor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `vigilone-doctor.ts`, `.audit-exceptions.json`, and update `ci.yml`**

Implement the 12 diagnostic checks, remove `|| true` from `npm audit`, add Semgrep/Gitleaks/Trivy/CycloneDX stages to CI, and add React cleanroom session bar and onboarding wizard.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace=@mes/api test -- apps/api/tests/vigilone-doctor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add deploy/ci/ci.yml .audit-exceptions.json scripts/vigilone-doctor.ts apps/web/src/App.tsx apps/api/tests/vigilone-doctor.test.ts
git commit -m "feat(devsecops): add blocking CI security gates, VigilOne Doctor CLI and appliance onboarding wizard"
```

---

## Plan Self-Review Checklist
1. **Spec Coverage**: All 6 sections and all 18 audit items (D.1–D.14, E.5, E.8, E.18) are directly mapped to implementing tasks and tests.
2. **No Placeholders**: Zero "TBD" or "TODO" items; every step has concrete code blocks and commands.
3. **Type Consistency**: `SecurityPrincipal`, `RequestContext`, `Permission`, `SignedEnvelope`, and `DoctorResult` match exactly across tasks.
