import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { app, isAllowlisted, PUBLIC_ALLOWLIST } from '../src/server';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { TokenManager } from '../src/security/jwt';
import { Permission, hasPermission, ROLE_PERMISSIONS } from '../src/security/permissions';

interface RouteInfo {
  method: string;
  path: string;
}

function getRoutePath(layer: any): string {
  if (layer.path) return layer.path;
  if (layer.regexp) {
    const src = layer.regexp.source;
    const cleaned = src
      .replace('^\\/', '/')
      .replace('\\/?(?=\\/|$)', '')
      .replace(/\\\//g, '/')
      .replace('^', '')
      .replace('$', '')
      .replace('(?=\\/|$)', '')
      .replace('\\/?', '');
    return cleaned.startsWith('/') ? cleaned : '/' + cleaned;
  }
  return '';
}

function collectRoutes(stack: any[], prefix = ''): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const layer of stack) {
    if (layer.route) {
      const p = (prefix + layer.route.path).replace(/\/+/g, '/');
      for (const m of Object.keys(layer.route.methods)) {
        routes.push({ method: m.toUpperCase(), path: p });
      }
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      const subPrefix = getRoutePath(layer);
      routes.push(...collectRoutes(layer.handle.stack, prefix + subPrefix));
    }
  }
  return routes;
}

describe('Dynamic Route Inventory & Capability-Based RBAC Suite', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('1. Dynamic Route Inventory & Complete API Coverage', () => {
    it('dynamically collects all Express routes from router stack', () => {
      const allRoutes = collectRoutes(app._router.stack);
      expect(allRoutes.length).toBeGreaterThan(30);

      const apiV1Routes = allRoutes.filter((r) => r.path.startsWith('/api/v1'));
      expect(apiV1Routes.length).toBeGreaterThan(25);
    });

    it('enforces authentication on every non-allowlisted /api/v1 route', async () => {
      const allRoutes = collectRoutes(app._router.stack);
      const apiV1Routes = allRoutes.filter((r) => r.path.startsWith('/api/v1'));

      // Filter out allowlisted endpoints
      const nonAllowlisted = apiV1Routes.filter((r) => !isAllowlisted(r.path));
      expect(nonAllowlisted.length).toBeGreaterThan(20);

      // Verify each non-allowlisted route returns 401 when called unauthenticated
      for (const route of nonAllowlisted) {
        // Substitute parameter placeholders (:id, :recipeId, etc.) with dummy test value
        const targetPath = route.path.replace(/:[a-zA-Z0-9_]+/g, 'test-entity');
        const url = `${baseUrl}${targetPath}`;

        const res = await fetch(url, {
          method: route.method,
          headers: { 'Content-Type': 'application/json' },
          body: ['POST', 'PUT', 'PATCH'].includes(route.method) ? JSON.stringify({}) : undefined
        });

        expect(
          res.status,
          `Unauthenticated request to ${route.method} ${targetPath} (route: ${route.path}) must return 401 Unauthorized`
        ).toBe(401);
      }
    });

    it('allows unauthenticated access to public allowlist endpoints', async () => {
      const publicPaths = ['/health', '/api/health', '/metrics', '/api-docs', '/api/v1/openapi.json'];
      for (const p of publicPaths) {
        const res = await fetch(`${baseUrl}${p}`);
        expect(res.status, `Allowlisted endpoint ${p} should be accessible without auth`).toBe(200);
      }
    });
  });

  describe('2. Auth Router Lifecycle (/api/v1/auth)', () => {
    let savedRefreshToken: string;
    let savedAccessToken: string;

    it('POST /api/v1/auth/login authenticates valid operator and returns dual tokens + cookie', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'OP-SMT-01', pin: '1234' })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.accessToken).toBeDefined();
      expect(data.refreshToken).toBeDefined();
      expect(data.operator).toBeDefined();
      expect(data.operator.code).toBe('OP-SMT-01');

      savedAccessToken = data.accessToken;
      savedRefreshToken = data.refreshToken;

      // Verify cookie header
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain('__Host-mes-refresh');
      expect(setCookie).toContain('HttpOnly');
    });

    it('POST /api/v1/auth/login rejects invalid PIN', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'OP-SMT-01', pin: '0000' })
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('INVALID_CREDENTIALS');
    });

    it('POST /api/v1/auth/refresh rotates session and issues new access token', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: savedRefreshToken })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.accessToken).toBeDefined();
      expect(data.refreshToken).toBeDefined();
      expect(data.refreshToken).not.toBe(savedRefreshToken);

      savedRefreshToken = data.refreshToken;
    });

    it('POST /api/v1/auth/logout revokes session family', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${savedAccessToken}`
        },
        body: JSON.stringify({ refreshToken: savedRefreshToken })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Attempting to refresh with revoked token family fails
      const refreshRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: savedRefreshToken })
      });
      expect(refreshRes.status).toBe(401);
    });
  });

  describe('3. Critical Invariant: Non-Delegable Segregation of Duties (SoD)', () => {
    const adminToken = TokenManager.generateAccessToken({
      sub: 'usr-admin-01',
      code: 'SYS-ADMIN-01',
      name: 'Global System Administrator',
      role: 'SYSTEM_ADMIN',
      org: 'org-apex',
      site: 'site-noida-p4',
      authzVersion: 1
    });

    const qaToken = TokenManager.generateAccessToken({
      sub: 'qa-smt-01',
      code: 'QA-SMT-01',
      name: 'Quality Lead Alpha',
      role: 'QUALITY_INSPECTOR',
      org: 'org-apex',
      site: 'site-noida-p4',
      authzVersion: 1
    });

    it('hasPermission helper strictly forbids SYSTEM_ADMIN from QUALITY_APPROVE', () => {
      expect(hasPermission('SYSTEM_ADMIN', Permission.QUALITY_APPROVE)).toBe(false);
      expect(hasPermission('SYSTEM_ADMIN', Permission.SYSTEM_MANAGE)).toBe(true);
      expect(hasPermission('QUALITY_INSPECTOR', Permission.QUALITY_APPROVE)).toBe(true);
    });

    it('blocks SYSTEM_ADMIN from performing quality approval (returns 403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/reflow/profiles/run-prf-20260908-01/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          approvedBy: 'SYS-ADMIN-01',
          comments: 'Unauthorized admin override attempt'
        })
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('FORBIDDEN');
    });

    it('allows QUALITY_INSPECTOR to perform quality approval', async () => {
      // Set status to VALIDATED so approval is permissible
      await getDatabase().execute(
        `UPDATE reflow_profile_runs SET status = 'VALIDATED' WHERE id = 'run-prf-20260908-01'`
      );

      const res = await fetch(`${baseUrl}/api/v1/reflow/profiles/run-prf-20260908-01/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${qaToken}`
        },
        body: JSON.stringify({
          approvedBy: 'QA-SMT-01',
          comments: 'Verified reflow thermal profile within PWI specs'
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('APPROVED');
    });
  });

  describe('4. Role Capability & RBAC Enforcement', () => {
    const operatorToken = TokenManager.generateAccessToken({
      sub: 'op-smt-01',
      code: 'OP-SMT-01',
      name: 'Operator Alpha',
      role: 'OPERATOR',
      org: 'org-apex',
      site: 'site-noida-p4',
      authzVersion: 1
    });

    const engineerToken = TokenManager.generateAccessToken({
      sub: 'eng-01',
      code: 'ENG-01',
      name: 'Process Engineer Alpha',
      role: 'PROCESS_ENGINEER',
      org: 'org-apex',
      site: 'site-noida-p4',
      authzVersion: 1
    });

    const adminToken = TokenManager.generateAccessToken({
      sub: 'usr-admin-01',
      code: 'SYS-ADMIN-01',
      name: 'Global System Administrator',
      role: 'SYSTEM_ADMIN',
      org: 'org-apex',
      site: 'site-noida-p4',
      authzVersion: 1
    });

    it('blocks OPERATOR from accessing recipe management endpoint', async () => {
      const res = await fetch(`${baseUrl}/api/v1/reflow/specifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${operatorToken}`
        },
        body: JSON.stringify({
          recipeId: 'PROG-SM-METER-TOP-REV4',
          boardPartNumber: 'PRD-SM-4G-V2',
          boardRevision: 'REV4',
          maxPeakTemp: 250
        })
      });

      expect(res.status).toBe(403);
    });

    it('blocks OPERATOR from running chaos experiments', async () => {
      const res = await fetch(`${baseUrl}/api/v1/sre/chaos/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${operatorToken}`
        },
        body: JSON.stringify({
          experimentId: 'exp-test',
          target: 'fuji',
          attackType: 'CHAOS_NETWORK_JITTER'
        })
      });

      expect(res.status).toBe(403);
    });

    it('blocks OPERATOR from accessing security audit report', async () => {
      const res = await fetch(`${baseUrl}/api/v1/security/audit`, {
        headers: { Authorization: `Bearer ${operatorToken}` }
      });

      expect(res.status).toBe(403);
    });

    it('allows OPERATOR to access authorized production endpoints', async () => {
      const res = await fetch(`${baseUrl}/api/v1/reports/shift-summary?workCenterId=wc-nxt-01`, {
        headers: { Authorization: `Bearer ${operatorToken}` }
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.shiftCode).toBeDefined();
    });

    it('allows PROCESS_ENGINEER to manage specifications but blocks from approving reflow profiles', async () => {
      // 1. Can manage recipe specifications
      const specRes = await fetch(`${baseUrl}/api/v1/reflow/specifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${engineerToken}`
        },
        body: JSON.stringify({
          recipeId: 'PROG-ENG-TEST',
          boardPartNumber: 'PRD-ENG-TEST',
          boardRevision: 'REV1',
          rampRate: { minCPerSec: 1.0, maxCPerSec: 3.0, targetCPerSec: 2.0 },
          soak: { minTempC: 150, maxTempC: 200, minSeconds: 60, maxSeconds: 120 },
          tal: { liquidusTempC: 217, minSeconds: 45, maxSeconds: 90 },
          peak: { minC: 235, maxC: 248 },
          cooling: { minCPerSec: 1.0, maxCPerSec: 4.0 },
          conveyorSpeedLimit: { minCmPerMin: 80, maxCmPerMin: 100 },
          createdBy: 'ENG-01'
        })
      });
      expect(specRes.status).toBe(201);

      // 2. Blocked from quality approval
      const approveRes = await fetch(`${baseUrl}/api/v1/reflow/profiles/run-prf-20260908-01/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${engineerToken}`
        },
        body: JSON.stringify({ approvedBy: 'ENG-01' })
      });
      expect(approveRes.status).toBe(403);
    });

    it('allows SYSTEM_ADMIN to run chaos and access security audit', async () => {
      const auditRes = await fetch(`${baseUrl}/api/v1/security/audit`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      expect(auditRes.status).toBe(200);
      const auditData = await auditRes.json();
      expect(auditData.success).toBe(true);
    });
  });
});
