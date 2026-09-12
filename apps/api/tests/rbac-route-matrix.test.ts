import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { app, isAllowlisted } from '../src/server';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { TokenManager } from '../src/security/jwt';
import { Permission, hasPermission, ROLE_PERMISSIONS } from '../src/security/permissions';
import { DEFAULT_FEATURE_FLAGS } from '@mes/shared';

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

describe('Complete RBAC Route Matrix & Launch Gate G-04 Enforcement', () => {
  let server: http.Server;
  let baseUrl: string;

  // Canonical 5 Roles Tokens
  const tokens: Record<string, string> = {
    OPERATOR: TokenManager.generateAccessToken({
      sub: 'usr-op-01',
      code: 'OP-01',
      name: 'Line Operator',
      role: 'OPERATOR',
      org: 'org-apex',
      site: 'site-apex-01',
      authzVersion: 1
    }),
    MAINTENANCE: TokenManager.generateAccessToken({
      sub: 'usr-maint-01',
      code: 'MAINT-01',
      name: 'Maintenance Tech',
      role: 'MAINTENANCE',
      org: 'org-apex',
      site: 'site-apex-01',
      authzVersion: 1
    }),
    QUALITY_LEAD: TokenManager.generateAccessToken({
      sub: 'usr-ql-01',
      code: 'QL-01',
      name: 'Quality Lead Specialist',
      role: 'QUALITY_LEAD',
      org: 'org-apex',
      site: 'site-apex-01',
      authzVersion: 1
    }),
    LINE_LEAD: TokenManager.generateAccessToken({
      sub: 'usr-ll-01',
      code: 'LL-01',
      name: 'SMT Line Lead',
      role: 'LINE_LEAD',
      org: 'org-apex',
      site: 'site-apex-01',
      authzVersion: 1
    }),
    SYSTEM_ADMIN: TokenManager.generateAccessToken({
      sub: 'usr-admin-01',
      code: 'ADMIN-01',
      name: 'System Administrator',
      role: 'SYSTEM_ADMIN',
      org: 'org-apex',
      site: 'site-apex-01',
      authzVersion: 1
    })
  };

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

  describe('1. Unauthenticated Perimeter Defense (All non-allowlisted routes reject with 401)', () => {
    it('verifies every registered API route rejects unauthenticated requests', async () => {
      const allRoutes = collectRoutes(app._router.stack);
      const apiV1Routes = allRoutes.filter((r) => r.path.startsWith('/api/v1'));
      const nonAllowlisted = apiV1Routes.filter((r) => !isAllowlisted(r.path));

      expect(nonAllowlisted.length).toBeGreaterThanOrEqual(40);

      for (const route of nonAllowlisted) {
        const targetPath = route.path
          .replace(/:[a-zA-Z0-9_]+/g, 'test-entity');
        const url = `${baseUrl}${targetPath}`;

        const res = await fetch(url, {
          method: route.method,
          headers: { 'Content-Type': 'application/json' },
          body: ['POST', 'PUT', 'PATCH'].includes(route.method) ? JSON.stringify({}) : undefined
        });

        expect(
          res.status,
          `Route ${route.method} ${targetPath} must return 401 when called without credentials`
        ).toBe(401);
      }
    });
  });

  describe('2. Canonical 5-Role Segregation of Duties (SoD) & QUALITY_APPROVE Lockdown', () => {
    // Quality approval endpoints where SYSTEM_ADMIN is strictly prohibited
    const qualityApproveRoutes = [
      { method: 'POST', path: '/api/v1/compliance/dhr/generate' },
      { method: 'POST', path: '/api/v1/compliance/dhr/DHR-JOB-SM-260901/release' },
      { method: 'POST', path: '/api/v1/aoi/disposition' },
      { method: 'POST', path: '/api/v1/aoi/post-rework-inspect' },
      { method: 'POST', path: '/api/v1/aoi/interlocks/clear' },
      { method: 'POST', path: '/api/v1/reflow/profiles/run-prf-20260908-01/approve' },
      { method: 'POST', path: '/api/v1/reflow/profiles/run-prf-20260908-01/reject' },
      { method: 'POST', path: '/api/v1/smt/paste/authorize' },
      { method: 'POST', path: '/api/v1/predictive/actions/act-test-01/authorize' },
      { method: 'POST', path: '/api/v1/smt/hold/acknowledge' }
    ];

    it('asserts SYSTEM_ADMIN receives 403 on ALL QUALITY_APPROVE routes (SoD enforcement)', async () => {
      for (const route of qualityApproveRoutes) {
        const url = `${baseUrl}${route.path}`;
        const res = await fetch(url, {
          method: route.method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.SYSTEM_ADMIN}`
          },
          body: JSON.stringify({
            panelBarcode: 'PANEL-0042',
            disposition: 'REWORK',
            qaReviewerId: 'ADMIN-01',
            reason: 'SoD test'
          })
        });

        expect(
          res.status,
          `SYSTEM_ADMIN must be barred with 403 on ${route.method} ${route.path}`
        ).toBe(403);
      }
    });

    it('asserts OPERATOR receives 403 on ALL QUALITY_APPROVE routes', async () => {
      for (const route of qualityApproveRoutes) {
        const url = `${baseUrl}${route.path}`;
        const res = await fetch(url, {
          method: route.method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.OPERATOR}`
          },
          body: JSON.stringify({})
        });

        expect(
          res.status,
          `OPERATOR must be barred with 403 on ${route.method} ${route.path}`
        ).toBe(403);
      }
    });

    it('asserts MAINTENANCE receives 403 on ALL QUALITY_APPROVE routes', async () => {
      for (const route of qualityApproveRoutes) {
        const url = `${baseUrl}${route.path}`;
        const res = await fetch(url, {
          method: route.method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.MAINTENANCE}`
          },
          body: JSON.stringify({})
        });

        expect(
          res.status,
          `MAINTENANCE must be barred with 403 on ${route.method} ${route.path}`
        ).toBe(403);
      }
    });

    it('allows QUALITY_LEAD to access QUALITY_APPROVE routes without 403', async () => {
      for (const route of qualityApproveRoutes) {
        const url = `${baseUrl}${route.path}`;
        const res = await fetch(url, {
          method: route.method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.QUALITY_LEAD}`
          },
          body: JSON.stringify({
            panelBarcode: 'PANEL-0042',
            defectId: 'DEF-01',
            disposition: 'SCRAP',
            reason: 'Audit verification'
          })
        });

        // Must NOT be 401 or 403 (authorization succeeded; may return 200, 201, 400, or 404 based on payload/state)
        expect(res.status, `QUALITY_LEAD should not receive 403 on ${route.method} ${route.path}`).not.toBe(403);
        expect(res.status, `QUALITY_LEAD should not receive 401 on ${route.method} ${route.path}`).not.toBe(401);
      }
    });
  });

  describe('3. Production Execution & Maintenance Scopes', () => {
    it('allows OPERATOR to access PRODUCTION_EXECUTE endpoints', async () => {
      const res = await fetch(`${baseUrl}/api/v1/smt/splice-verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.OPERATOR}`
        },
        body: JSON.stringify({
          workCenterId: 'wc-nxt-01',
          slotNumber: 1,
          scannedReelBarcode: 'REEL-PASS-01',
          feederBarcode: 'FDR-8MM-01'
        })
      });

      // Authorization must pass (not 401/403)
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('blocks OPERATOR from MAINTENANCE endpoints (e.g. printer clean)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/spi/printer/clean`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.OPERATOR}`
        },
        body: JSON.stringify({
          printerId: 'PRN-01',
          mode: 'VACUUM_WIPE'
        })
      });

      expect(res.status).toBe(403);
    });

    it('allows MAINTENANCE to execute maintenance operations', async () => {
      const res = await fetch(`${baseUrl}/api/v1/spi/printer/clean`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.MAINTENANCE}`
        },
        body: JSON.stringify({
          printerId: 'PRN-01',
          mode: 'VACUUM_WIPE'
        })
      });

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('blocks MAINTENANCE from RECIPE_MANAGE endpoints (e.g. reflow specifications)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/reflow/specifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.MAINTENANCE}`
        },
        body: JSON.stringify({})
      });

      expect(res.status).toBe(403);
    });

    it('allows LINE_LEAD to access RECIPE_MANAGE endpoints', async () => {
      const res = await fetch(`${baseUrl}/api/v1/reflow/specifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.LINE_LEAD}`
        },
        body: JSON.stringify({
          recipeId: 'RECIPE-LL-TEST',
          boardPartNumber: 'BRD-TEST',
          boardRevision: 'REV1',
          rampRate: { minCPerSec: 1.0, maxCPerSec: 3.0, targetCPerSec: 2.0 },
          soak: { minTempC: 150, maxTempC: 200, minSeconds: 60, maxSeconds: 120 },
          tal: { liquidusTempC: 217, minSeconds: 45, maxSeconds: 90 },
          peak: { minC: 235, maxC: 248 },
          cooling: { minCPerSec: 1.0, maxCPerSec: 4.0 },
          conveyorSpeedLimit: { minCmPerMin: 80, maxCmPerMin: 100 },
          createdBy: 'LL-01'
        })
      });

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });

  describe('4. Scoped Service Key Authentication (Gate G-06)', () => {
    it('authenticates gateway-fuji-01 token and grants OPERATOR permissions', async () => {
      const res = await fetch(`${baseUrl}/api/v1/smt/feeders`, {
        headers: { 'X-API-Key': 'dev-mes-api-key-secret-2026-strict-hygiene-fuji' }
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it('blocks gateway-fuji-01 service token from MAINTENANCE operations', async () => {
      const res = await fetch(`${baseUrl}/api/v1/spi/printer/clean`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'dev-mes-api-key-secret-2026-strict-hygiene-fuji'
        },
        body: JSON.stringify({})
      });

      expect(res.status).toBe(403);
    });

    it('authenticates station-spi-01 token and allows MAINTENANCE operations', async () => {
      const res = await fetch(`${baseUrl}/api/v1/spi/printer/clean`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'dev-mes-api-key-secret-2026-strict-hygiene-spi'
        },
        body: JSON.stringify({
          printerId: 'PRN-01',
          mode: 'VACUUM_WIPE'
        })
      });

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });
});
