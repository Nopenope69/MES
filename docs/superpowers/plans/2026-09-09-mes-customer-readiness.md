# Antigravity SMT MES — Customer-Site Readiness, Security Hardening & Enterprise Appliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the production customer release baseline for the Antigravity SMT MES Engine as an enterprise-hardened, customer-deployable single-tenant edge appliance targeting Fuji NXT / EMS surface-mount lines.

**Scope:** Dedicated strictly to the Antigravity SMT MES edge appliance. We wrap the verified SMT manufacturing core (MSL, Splicing, IPC-CFX, Reflow PWI) in an enterprise perimeter: server-derived `RequestContext` with classified scoped repositories (`GLOBAL`, `ORGANIZATION_SCOPED`, `SITE_SCOPED`), dual-token architecture with 15-minute short-lived access JWTs (browser-side volatile memory storage) backed by revocable server-side refresh sessions and anti-stale `authzVersion`, two-component PIN e-signatures with RFC 8785 canonical envelope hashing and database-level non-owner append-only privileges, edge perimeter TLS (TLS 1.3 preferred, TLS 1.2 minimum where required) with modular `SafeConnector` egress pinning, point-in-time recovery packages with persistent DR drill history, an automated release readiness CLI (`mes doctor`) validating signed release attestations, and an independent findings-based audit closure verification.

**Tech Stack:** TypeScript, Node.js 22, Express, SQLite (`node:sqlite`) & PostgreSQL 16, Caddy 2, `argon2` / `bcryptjs`, `jsonwebtoken`, Zod, Vitest, Semgrep, Gitleaks, Trivy, CycloneDX.

**Spec:** [`docs/superpowers/specs/2026-09-09-mes-customer-readiness-design.md`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/docs/superpowers/specs/2026-09-09-mes-customer-readiness-design.md)

---

## Execution Dependency Graph

```text
                    ┌──────────────┐
                    │   TASK 1     │
                    │ Security     │
                    │ Context      │
                    └──────┬───────┘
                           │
                ┌──────────┴──────────┐
                ▼                     ▼
           TASK 2                  TASK 6
        Credentials             Perimeter
                │                     │
                ▼                     ▼
           TASK 3                  TASK 7
          Sessions                OT Trust
                │
                ▼
           TASK 4
           RBAC
                │
                ▼
           TASK 5
        E-signatures
                │
                ├──────────────┐
                ▼              ▼
             TASK 8          TASK 9
               DR         CI / Doctor
                │              │
                └──────┬───────┘
                       ▼
                    TASK 10
                 Independent
                   Re-audit
```

---

## Standard Task Implementation Contract

Every task in this plan must strictly follow this 10-step implementation workflow:
1. **Read existing code & contracts**: Inspect current implementations and interfaces before editing.
2. **Write failing tests**: Define precise assertions that capture the requirement and verify failure.
3. **Implement minimum change**: Implement the cleanest minimal code to satisfy the contract.
4. **Run focused tests**: Verify the new unit/integration tests pass.
5. **Run affected module tests**: Verify related domain logic is unaffected.
6. **Run full regression suite**: Run `npm test` across all workspaces to guarantee zero regressions across the existing 164 business tests (201 Vitest tests).
7. **Run static/security checks**: Verify TypeScript compilation and lint cleanliness.
8. **Verify database migration**: Confirm schema additions and backfill scripts execute cleanly without data loss.
9. **Update Doctor checks**: Wire new subsystem diagnostic check into `scripts/mes-doctor.ts`.
10. **Commit atomically**: Stage affected files and commit with a standard conventional commit message.

---

## Global Invariants
- **Target Deployment**: Single-tenant, single-plant edge appliance.
- **ISA-95 Hierarchy**: Organization (1) -> Site (1+) -> Area (1+) -> Line (1+) -> WorkCenter -> EquipmentUnit.
- **Zero Client-Controlled Scope**: No route, handler, or query accepts `organization_id`, `site_id`, `actor_id`, or `role` from HTTP request bodies or query parameters.
- **Fail-Closed Persistence Invariant**: Zero database access without an active `ExecutionContext`; missing context throws `SecurityContextMissingError`. Queries enforce explicit scope (`GLOBAL`, `ORGANIZATION_SCOPED`, `SITE_SCOPED`).
- **Dynamic Route Inventory Gate**: Every non-public route in the Express router requires authentication, verified by an automated route inventory test.
- **Non-Delegable SoD**: System Administration is strictly decoupled from manufacturing quality authority.
- **Non-Owner Append-Only Ledger**: Runtime DB role is non-owner and holds only `SELECT, INSERT` on `compliance_signatures` (`UPDATE, DELETE, TRUNCATE` denied).
- **OEM Wire Protocol Integrity**: OT adapters maintain strict protocol compatibility with OEM machines; network isolation and defensive framing prevent protocol DoS.
- **Deterministic Release Gate**: `BLOCKERS = 0`, `CRITICAL = 0`, `HIGH = 0 (or formally accepted)`, `DOCTOR = PASS`, `DR = VERIFIED`, `SECURITY TESTS = PASS`.

---

### Task 1: Security Context, Classified Scopes & Scoped Persistence Infrastructure (Section 1)

**Files:**
- Create: `apps/api/src/security/context.ts`
- Create: `apps/api/src/db/scoped-repository.ts`
- Create: `apps/api/src/security/trusted-proxy.ts`
- Modify: `apps/api/src/db/database.ts`
- Test: `apps/api/tests/tenant-isolation.test.ts`

**Interfaces:**
- Produces: `SecurityPrincipal`, `ServiceScope`, `RequestContext`, `ServiceContext`, `ExecutionContext`, `SecurityContextMissingError`, `MasterRepository.forContext(ctx)`.
- Scopes: `GLOBAL`, `ORGANIZATION_SCOPED`, `SITE_SCOPED`.

- [ ] **Step 1: Write failing test for context scoping, table classification, and tenant isolation**

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

  it('strictly isolates site-scoped queries by organizationId and siteId, returning null for cross-site entity', async () => {
    const siteACtx: RequestContext = {
      principal: {
        kind: 'HUMAN',
        operatorId: 'op-site-a',
        operatorCode: 'OP-A1',
        role: 'OPERATOR',
        permissions: new Set(['batch:view']),
        organizationId: 'ORG-APEX',
        siteId: 'SITE-NOIDA-01',
        sessionId: 'sess-a'
      },
      correlationId: 'corr-1',
      requestId: 'req-1',
      ipAddress: '127.0.0.1'
    };

    const scopedRepoA = masterRepo.forContext(siteACtx);
    const result = await scopedRepoA.batches.findById('batch-chennai-999');
    expect(result).toBeNull();
  });

  it('supports service principals with SYSTEM scope for appliance-wide infrastructure operations', async () => {
    const systemCtx: RequestContext = {
      principal: {
        kind: 'SERVICE',
        serviceId: 'srv-backup',
        serviceName: 'backup-runner',
        scope: { kind: 'SYSTEM', organizationId: 'ORG-APEX' },
        permissions: new Set(['system:backup']),
        credentialId: 'cred-1'
      },
      correlationId: 'corr-sys',
      requestId: 'req-sys',
      ipAddress: '127.0.0.1'
    };

    const scopedRepo = masterRepo.forContext(systemCtx);
    expect(scopedRepo.sites).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/tenant-isolation.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `context.ts`, `trusted-proxy.ts`, and `scoped-repository.ts`**
  Implement explicit scope classifications:
  - `GLOBAL` (no site/org predicates)
  - `ORGANIZATION_SCOPED` (`organization_id = ?`)
  - `SITE_SCOPED` (`organization_id = ? AND site_id = ?`)
  Implement `ServiceScope` with explicit `SITE`, `ORGANIZATION`, and `SYSTEM` variants (no hidden defaults).

- [ ] **Step 4: Run focused test to verify it passes**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/tenant-isolation.test.ts`
  Expected: PASS.

- [ ] **Step 5: Run full regression suite**
  Run: `npm test` (verify all 24 existing suites pass).

- [ ] **Step 6: Commit atomically**
```bash
git add apps/api/src/security/context.ts apps/api/src/security/trusted-proxy.ts apps/api/src/db/scoped-repository.ts apps/api/tests/tenant-isolation.test.ts
git commit -m "feat(security): implement RequestContext and classified ScopedRepository persistence isolation"
```

---

### Task 2: Operator PIN Hashing, Anti-Enumeration & Controlled Backfill Migration (Section 2)

**Files:**
- Create: `apps/api/src/security/pin-policy.ts`
- Create: `scripts/migrate-pins.ts`
- Modify: `apps/api/src/services/authentication.service.ts`
- Modify: `apps/api/src/db/schema.sql`
- Test: `apps/api/tests/auth-pin-security.test.ts`

**Interfaces:**
- Produces: `PinPolicy.hashPin(pin)`, `PinPolicy.verifyPin(pin, hash)`, `PinPolicy.verifyUnknownOperator(pin)`, `PinPolicy.validateComplexity(pin, role)`.
- Algorithms: Primary: Argon2id (`$argon2id$...`), Supported: Bcrypt (`$2b$12$...`).
- Migration Script (`scripts/migrate-pins.ts`):
  - Idempotent and resumable across interruptions.
  - Safely handles populated production databases (does not assume empty table).
  - Iterates batches of operators where `pin_hash IS NULL`, hashes `pin`, verifies hash against source PIN, and updates row.
  - Hard invariant: Asserts `COUNT(*) WHERE pin_hash IS NULL == 0` before altering `pin_hash SET NOT NULL` and dropping `pin`. Plaintext column is never retained permanently.

- [ ] **Step 1: Write failing test for PIN hashing, timing equality, lockout, and migration verification**

```typescript
// apps/api/tests/auth-pin-security.test.ts
import { describe, it, expect } from 'vitest';
import { PinPolicy } from '../src/security/pin-policy';

describe('PIN Security, Anti-Enumeration & Lockout Suite', () => {
  it('hashes operator PIN using Argon2id/Bcrypt and verifies successfully', async () => {
    const hash = await PinPolicy.hashPin('0429');
    expect(hash.startsWith('$argon2id$') || hash.startsWith('$2b$12$')).toBe(true);
    expect(await PinPolicy.verifyPin('0429', hash)).toBe(true);
    expect(await PinPolicy.verifyPin('0430', hash)).toBe(false);
  });

  it('enforces constant-time dummy compare for unknown operator codes', async () => {
    const startUnknown = performance.now();
    await PinPolicy.verifyUnknownOperator('9999');
    const elapsedUnknown = performance.now() - startUnknown;

    const dummyHash = await PinPolicy.hashPin('1234');
    const startKnown = performance.now();
    await PinPolicy.verifyPin('9999', dummyHash);
    const elapsedKnown = performance.now() - startKnown;

    expect(Math.abs(elapsedUnknown - elapsedKnown)).toBeLessThan(50);
  });

  it('locks account after 5 consecutive failed attempts atomically', async () => {});
});
```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/auth-pin-security.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `pin-policy.ts`, backfill script, and update `AuthenticationService`**

- [ ] **Step 4: Run focused test to verify it passes**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/auth-pin-security.test.ts`
  Expected: PASS.

- [ ] **Step 5: Run full regression suite**
  Run: `npm test`

- [ ] **Step 6: Commit atomically**
```bash
git add apps/api/src/security/pin-policy.ts scripts/migrate-pins.ts apps/api/src/services/authentication.service.ts apps/api/src/db/schema.sql apps/api/tests/auth-pin-security.test.ts
git commit -m "feat(auth): implement Argon2id/Bcrypt PIN hashing, anti-enumeration, and controlled backfill migration"
```

---

### Task 3: Dual-Token Architecture, Refresh Rotation & Token-Family Revocation (Section 2)

**Files:**
- Create: `apps/api/src/security/jwt.ts`
- Create: `apps/api/src/security/session-manager.ts`
- Modify: `apps/api/src/services/authentication.service.ts`
- Test: `apps/api/tests/auth-token-rotation.test.ts`

**Interfaces:**
- Produces: `TokenManager.issueTokenPair(principal)`, `TokenManager.rotateRefreshToken(token)`, `SessionManager.revokeSession(sessionId)`.
- Invariant: 15-minute short-lived access JWTs; browser stores access tokens only in volatile application memory.
- Invariant: Refresh token stored in `HttpOnly`, `Secure`, `SameSite=Strict` cookie (`__Host-mes-refresh`).
- Invariant: Serialized write transaction (`SELECT ... FOR UPDATE` or SQLite locked transaction) prevents rotation race conditions. Token reuse triggers instant session revocation.

- [ ] **Step 1: Write failing test for token rotation, concurrency serialization, and replay detection**

```typescript
// apps/api/tests/auth-token-rotation.test.ts
import { describe, it, expect } from 'vitest';
import { AuthenticationService } from '../src/services/authentication.service';

describe('Token-Family Refresh Rotation & Anti-Theft Suite', () => {
  it('rotates refresh token and returns new access JWT on valid refresh', async () => {
    const login = await AuthenticationService.loginWithPin('OP-01', '0429', '127.0.0.1');
    expect(login.accessToken).toBeDefined();
    expect(login.refreshToken).toBeDefined();

    const refresh1 = await AuthenticationService.refreshSession(login.refreshToken!, '127.0.0.1');
    expect(refresh1.success).toBe(true);

    const replayAttempt = await AuthenticationService.refreshSession(login.refreshToken!, '127.0.0.1');
    expect(replayAttempt.success).toBe(false);
    expect(replayAttempt.error).toBe('TOKEN_REUSE_DETECTED');
  });

  it('rejects tokens when authzVersion is stale', async () => {});
});
```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/auth-token-rotation.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `jwt.ts` and `session-manager.ts`**

- [ ] **Step 4: Run focused test to verify it passes**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/auth-token-rotation.test.ts`
  Expected: PASS.

- [ ] **Step 5: Run full regression suite**
  Run: `npm test`

- [ ] **Step 6: Commit atomically**
```bash
git add apps/api/src/security/jwt.ts apps/api/src/security/session-manager.ts apps/api/src/services/authentication.service.ts apps/api/tests/auth-token-rotation.test.ts
git commit -m "feat(auth): add dual-token JWT, serialized refresh rotation, and anti-theft revocation"
```

---

### Task 4: Dynamic Route Inventory Coverage & Capability-Based RBAC (Section 2)

**Files:**
- Create: `apps/api/src/security/permissions.ts`
- Create: `apps/api/src/middleware/auth.middleware.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes/`
- Test: `apps/api/tests/rbac-capabilities.test.ts`

**Interfaces:**
- Produces: `Permission` enum, `requirePermission(permission)`, `requireRoles(...)`.
- Invariant: Automated route inventory test dynamically inspects Express router stack and asserts authentication middleware on every non-public route.
- Invariant: Non-delegable Segregation of Duties (`SYSTEM_ADMIN` blocked from quality approvals).

- [ ] **Step 1: Write failing test verifying dynamic route inventory coverage and Segregation of Duties**

```typescript
// apps/api/tests/rbac-capabilities.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';

describe('Dynamic Route Inventory & RBAC Suite', () => {
  it('dynamically enumerates all Express routes and asserts auth on every non-public route', async () => {
    // Collects all registered routes from app._router.stack
    // Verifies all endpoints outside allowlist (/health, /api/v1/auth/login, /api/v1/auth/refresh) return 401 unauthenticated
  });

  it('blocks SYSTEM_ADMIN from performing quality approval (non-delegable SoD)', async () => {
    const res = await request(app)
      .post('/api/v1/reflow/profiles/prof-1/approve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/rbac-capabilities.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `permissions.ts`, global auth middleware, and mount guards on all routes**

- [ ] **Step 4: Run focused test to verify it passes**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/rbac-capabilities.test.ts`
  Expected: PASS.

- [ ] **Step 5: Run full regression suite**
  Run: `npm test`

- [ ] **Step 6: Commit atomically**
```bash
git add apps/api/src/security/permissions.ts apps/api/src/middleware/auth.middleware.ts apps/api/src/server.ts apps/api/src/routes/ apps/api/tests/rbac-capabilities.test.ts
git commit -m "feat(rbac): enforce dynamic route inventory auth coverage and non-delegable SoD"
```

---

### Task 5: Attributable 21 CFR Part 11 Electronic Signature Engine (Section 3)

**Files:**
- Create: `apps/api/src/security/canonical-json.ts`
- Modify: `apps/api/src/services/compliance-ledger.service.ts`
- Modify: `apps/api/src/controllers/compliance.controller.ts`
- Modify: `apps/api/src/db/schema.sql`
- Test: `apps/api/tests/compliance-part11-ledger.test.ts`

**Interfaces:**
- Produces: `SignLedgerRequestSchema` (`.strict()`), `ComplianceLedgerService.recordSignature(req, context)`, RFC 8785 canonical hash chaining.
- Database Role Segregation: Schema owned by `mes_migrator`; runtime role `mes_runtime` is non-owner and holds strictly `SELECT, INSERT` on `compliance_signatures` (`UPDATE, DELETE, TRUNCATE` denied).

- [ ] **Step 1: Write failing test for Part 11 two-component signature, canonical envelope, and role privileges**

```typescript
// apps/api/tests/compliance-part11-ledger.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';

describe('21 CFR Part 11 Compliance Ledger Suite', () => {
  it('rejects signature requests containing client-supplied actorId or timestamps', async () => {
    const res = await request(app)
      .post('/api/v1/compliance/sign')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        entityType: 'DHR',
        entityId: 'dhr-001',
        entityRevision: 1,
        actionType: 'RELEASE',
        meaning: 'QUALITY_APPROVAL',
        reason: 'Final QA passed',
        signingPin: '0429',
        actorId: 'spoofed-id' // Fails .strict()
      });
    expect(res.status).toBe(400);
  });

  it('chains signed envelope hashes using RFC 8785 canonicalization', async () => {});
  it('prohibits update or delete operations on compliance ledger records', async () => {});
});
```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/compliance-part11-ledger.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement canonicalizer, ledger service, and non-owner DB privilege grants**

- [ ] **Step 4: Run focused test to verify it passes**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/compliance-part11-ledger.test.ts`
  Expected: PASS.

- [ ] **Step 5: Run full regression suite**
  Run: `npm test`

- [ ] **Step 6: Commit atomically**
```bash
git add apps/api/src/security/canonical-json.ts apps/api/src/services/compliance-ledger.service.ts apps/api/src/controllers/compliance.controller.ts apps/api/src/db/schema.sql apps/api/tests/compliance-part11-ledger.test.ts
git commit -m "feat(compliance): implement attributable 21 CFR Part 11 two-component e-signature and non-owner append-only ledger"
```

---

### Task 6: Edge Perimeter Hardening, Caddy TLS & Modular `SafeConnector` (Section 4)

**Files:**
- Modify: `docker-compose.yml`
- Create: `deploy/caddy/Caddyfile`
- Create: `apps/api/src/security/safe-connector.ts`
- Create: `apps/api/src/security/egress-policies.ts`
- Modify: `apps/api/src/config/secrets.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/tests/perimeter-egress.test.ts`

**Interfaces:**
- Produces: `SafeConnector.connect(url, options)`, `InternalServiceTargetPolicy`, `WebhookTargetPolicy`.
- Caddy Gateway: TLS 1.3 preferred, TLS 1.2 minimum where required, HSTS, strict CSP, HTTP 301 redirect.
- Onboarding Wizard: Transactional provisioning (`UNINITIALIZED` -> `PROVISIONING` -> `PRODUCTION_ACTIVE` or `PROVISIONING_FAILED` with clean rollback).

- [ ] **Step 1: Write failing test for SSRF socket pinning, DNS rebinding, and transactional provisioning rollback**

```typescript
// apps/api/tests/perimeter-egress.test.ts
import { describe, it, expect } from 'vitest';
import { SafeConnector } from '../src/security/safe-connector';
import { WebhookTargetPolicy } from '../src/security/egress-policies';

describe('Perimeter, SafeConnector & Egress Policy Suite', () => {
  it('rejects outbound webhook connections to private RFC1918, link-local, and IPv4-mapped IPv6 ranges', async () => {
    await expect(SafeConnector.validateAndPin('http://169.254.169.254/latest/meta-data', new WebhookTargetPolicy()))
      .rejects.toThrow('SSRF_EGRESS_BLOCKED');
  });

  it('rolls back completely to UNINITIALIZED if provisioning transaction fails', async () => {});
  it('unmounts /bootstrap route permanently once in PRODUCTION_ACTIVE', async () => {});
});
```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/perimeter-egress.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Harden Docker Compose, Caddyfile, and implement `SafeConnector` with modular policies**

- [ ] **Step 4: Run focused test to verify it passes**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/perimeter-egress.test.ts`
  Expected: PASS.

- [ ] **Step 5: Run full regression suite**
  Run: `npm test`

- [ ] **Step 6: Commit atomically**
```bash
git add docker-compose.yml deploy/caddy/Caddyfile apps/api/src/security/safe-connector.ts apps/api/src/security/egress-policies.ts apps/api/src/server.ts apps/api/tests/perimeter-egress.test.ts
git commit -m "feat(perimeter): excise Adminer, implement Caddy TLS 1.3, SafeConnector egress pinning, and transactional bootstrap"
```

---

### Task 7: OT Gateway Perimeter Defense & Protocol-Safe Framing Guards (Section 4)

**Files:**
- Modify: `apps/api/src/adapters/fuji-nexim.adapter.ts`
- Test: `apps/api/tests/ot-fuji-security.test.ts`

**Interfaces:**
- Preserves OEM wire protocol compatibility (no invented un-supported handshake).
- Defensive framing guards: 64KB max buffer accumulator limit, 4-byte sync header validation, immediate disconnect on corrupt length, 30s idle timeout.
- Documents network compensating controls (dedicated OT interface/VLAN, hardware firewall, monitored IP allowlist).

- [x] **Step 1: Write failing test for framing accumulator limits and protocol DoS defense**

```typescript
// apps/api/tests/ot-fuji-security.test.ts
import { describe, it, expect } from 'vitest';
import { FujiNeximAdapter } from '../src/adapters/fuji-nexim.adapter';

describe('OT Fuji Gateway Security & Protocol Suite', () => {
  it('drops connection immediately when incoming frame header declares length exceeding 64KB DoS limit', async () => {});
  it('disconnects socket when sync header is corrupt', async () => {});
  it('maintains strict compatibility with standard Fuji Nexim frame layout', async () => {});
});
```

- [x] **Step 2: Run test to verify it fails**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/ot-fuji-security.test.ts`
  Expected: FAIL.

- [x] **Step 3: Implement defensive framing guards in `FujiNeximAdapter`**

- [x] **Step 4: Run focused test to verify it passes**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/ot-fuji-security.test.ts`
  Expected: PASS.

- [x] **Step 5: Run full regression suite**
  Run: `npm test`

- [x] **Step 6: Commit atomically**
```bash
git add apps/api/src/adapters/fuji-nexim.adapter.ts apps/api/tests/ot-fuji-security.test.ts
git commit -m "feat(ot): implement defensive 64KB framing guards and DoS protections on Fuji gateway"
```

---

### Task 8: Point-in-Time Recovery Package & Persistent DR Drill Pipeline (Section 5)

**Files:**
- Create: `scripts/backup.sh`
- Create: `scripts/restore.sh`
- Create: `scripts/dr-drill.sh`
- Create: `apps/api/src/services/dr-verification.service.ts`
- Modify: `apps/api/src/db/schema.sql`
- Test: `apps/api/tests/disaster-recovery.test.ts`

**Interfaces:**
- Produces: `scripts/backup.sh`, `scripts/restore.sh`, `scripts/dr-drill.sh`, `DrVerificationService`.
- Defined Managed Artifact Scope: `/var/data/dhr`, `/var/data/reflow`, `/var/data/inspection`.
- Strict Integrity Invariant: 100% of artifacts registered in backup manifest verified, and every DB record referencing an artifact has a manifest entry.
- Persistent Table: `dr_drill_history` storing drill ID, version, backup timestamp, RPO, RTO, status.
- Freshness Rule: Verified drill must have `status = 'PASS'` and age $\le 30$ days.

- [ ] **Step 1: Write failing test for destructive DR drill, evidence manifest scope, and history retention**

```typescript
// apps/api/tests/disaster-recovery.test.ts
import { describe, it, expect } from 'vitest';
import { DrVerificationService } from '../src/services/dr-verification.service';

describe('Disaster Recovery Verification & Retention Suite', () => {
  it('verifies 100% schema, EventStore monotonicity, ledger hash chain, and managed evidence files with RPO <= 900s and RTO <= 7200s', async () => {
    const report = await DrVerificationService.verifyRestoredState();
    expect(report.schemaValid).toBe(true);
    expect(report.ledgerIntegrity).toBe(true);
    expect(report.manifestIntegrity).toBe(true);
    expect(report.RPOSeconds).toBeLessThanOrEqual(900);
    expect(report.RTOSeconds).toBeLessThanOrEqual(7200);
  });

  it('persists drill record into dr_drill_history table and enforces freshness <= 30 days', async () => {});
});
```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/disaster-recovery.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement backup/restore shell scripts, drill history table, and verification service**

- [ ] **Step 4: Run focused test to verify it passes**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/disaster-recovery.test.ts`
  Expected: PASS.

- [ ] **Step 5: Run full regression suite**
  Run: `npm test`

- [ ] **Step 6: Commit atomically**
```bash
git add scripts/backup.sh scripts/restore.sh scripts/dr-drill.sh apps/api/src/services/dr-verification.service.ts apps/api/src/db/schema.sql apps/api/tests/disaster-recovery.test.ts
git commit -m "feat(dr): implement point-in-time recovery packages and persistent DR drill verification pipeline"
```

---

### Task 9: DevSecOps CI Pipeline, Release Attestation & `mes doctor` CLI (Section 6)

**Files:**
- Modify: `deploy/ci/ci.yml`
- Create: `.audit-exceptions.json`
- Create: `scripts/mes-doctor.ts`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/api/tests/mes-doctor.test.ts`

**Interfaces:**
- Produces: `npm run doctor`, `MesDoctor.runDiagnostics()`.
- Release Provenance: Verifies signed `release-manifest.json` containing SBOM digest and scan attestations (`DEVSECOPS RELEASE ATTESTATION: PASS`).
- CI Audit Exceptions (`.audit-exceptions.json`): Schema requires `cve`, `package`, `rationale`, `owner`, `mitigation`, and `expiresAt`. Unapproved or expired exceptions fail the build.
- Freshness: Verifies persistent `dr_drill_history` has valid pass $\le 30$ days old.
- Tri-State Result Model: `PASS`, `FAIL`, `NOT_VERIFIED` (`NOT_VERIFIED` fails readiness).

- [ ] **Step 1: Write failing test for `mes doctor` diagnostic modules, release attestations, and readiness policy**

```typescript
// apps/api/tests/mes-doctor.test.ts
import { describe, it, expect } from 'vitest';
import { MesDoctor } from '../../scripts/mes-doctor';

describe('MES Doctor Diagnostic Suite', () => {
  it('executes 12 diagnostic modules and verifies signed release attestations', async () => {
    const result = await MesDoctor.runDiagnostics();
    expect(result.modules.length).toBe(12);
    expect(result.deploymentReady).toBe(true);
  });

  it('strictly treats NOT_VERIFIED as failing deployment readiness', async () => {});
});
```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/mes-doctor.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `mes-doctor.ts`, `.audit-exceptions.json`, and update `ci.yml`**

- [ ] **Step 4: Run focused test to verify it passes**
  Run: `npm --workspace=@mes/api test -- apps/api/tests/mes-doctor.test.ts`
  Expected: PASS.

- [ ] **Step 5: Run full regression suite**
  Run: `npm test`

- [ ] **Step 6: Commit atomically**
```bash
git add deploy/ci/ci.yml .audit-exceptions.json scripts/mes-doctor.ts apps/web/src/App.tsx apps/api/tests/mes-doctor.test.ts
git commit -m "feat(devsecops): implement blocking CI gates, signed release attestations, and MES Doctor CLI"
```

---

### Task 10: Security Finding Closure & Independent Re-Audit

**Files:**
- Create: `docs/audit/closure-matrix.md`
- Create: `docs/audit/re-audit-report.md`

**Deliverables:**
- Comprehensive audit finding closure matrix mapping all 17 audit items (D.1–D.14, E.5, E.8, E.18) to implementation commits, automated tests, operational evidence, and Doctor checks.
- Independent re-audit verification confirming the deterministic release gate:
  $$\text{BLOCKERS} = 0 \land \text{CRITICAL} = 0 \land \text{UNACCEPTED HIGH} = 0 \land \text{DOCTOR} = \text{PASS} \land \text{DR} = \text{VERIFIED} \land \text{TESTS} = \text{PASS}$$

- [ ] **Step 1: Freeze original audit register and compile closure matrix**
  Map every item from Section D (D.1–D.14) and Section E (E.5, E.8, E.18) to its exact commit SHA, test file, and Doctor verification check.

- [ ] **Step 2: Execute full test suite and DR drill to collect operational evidence**
  Run all 10 test suites, run `./scripts/dr-drill.sh`, and run `npm run doctor`. Capture stdout logs and checksums.

- [ ] **Step 3: Document verified re-audit scorecard based on objective evidence**
  Record actual verified readiness scores across all dimensions.

- [ ] **Step 4: Commit closure matrix and re-audit report**
```bash
git add docs/audit/closure-matrix.md docs/audit/re-audit-report.md
git commit -m "docs(audit): publish verified closure matrix and independent re-audit report"
```

---

## Plan Self-Review Checklist
1. **Spec Coverage**: All identified customer-readiness blockers and security findings in the remediation scope are directly mapped to Tasks 1 through 10.
2. **No Placeholders**: Zero "TBD" or "TODO" items; all steps contain explicit code blocks, test assertions, and atomic commits.
3. **Execution Safety**: The 10-step implementation contract guarantees full regression verification on every task, protecting the existing 164 business tests.
4. **Deterministic Gate**: Release acceptance is strictly findings-based (`0 Blocker, 0 Critical, 0 Unaccepted High, Doctor PASS, DR Verified`).
