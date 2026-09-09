// apps/api/tests/tenant-isolation.test.ts
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { MasterRepository } from '../src/db/scoped-repository';
import { RequestContext, SecurityContextMissingError } from '../src/security/context';
import { DatabaseManager, initDatabase } from '../src/db/database';

describe('Tenant & Site Persistence Scoping Suite (Section 1)', () => {
  let masterRepo: MasterRepository;
  const db = DatabaseManager.getInstance();

  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(async () => {
    masterRepo = new MasterRepository(db);

    // Clean test records
    await db.execute("DELETE FROM batches WHERE id LIKE 'test-batch-%'");
    await db.execute("DELETE FROM organizations WHERE id IN ('org-test-a', 'org-test-b')");
    await db.execute("DELETE FROM sites WHERE id IN ('site-test-a1', 'site-test-b1')");

    // Seed test organizations and sites
    await db.execute("INSERT INTO organizations (id, code, name) VALUES ('org-test-a', 'ORG-TEST-A', 'Org Test A')");
    await db.execute("INSERT INTO organizations (id, code, name) VALUES ('org-test-b', 'ORG-TEST-B', 'Org Test B')");
    await db.execute("INSERT INTO sites (id, organization_id, code, name) VALUES ('site-test-a1', 'org-test-a', 'SITE-A1', 'Site A1')");
    await db.execute("INSERT INTO sites (id, organization_id, code, name) VALUES ('site-test-b1', 'org-test-b', 'SITE-B1', 'Site B1')");

    // Insert batches for Site A1 and Site B1
    await db.execute(`
      INSERT INTO batches (id, organization_id, site_id, batch_number, work_order_number, product_code, recipe_code, work_center_id, status, planned_quantity)
      VALUES 
        ('test-batch-a1', 'org-test-a', 'site-test-a1', 'JOB-TEST-A1', 'WO-A1', 'PRD-1', 'RCP-1', 'wc-1', 'READY', 100.0),
        ('test-batch-b1', 'org-test-b', 'site-test-b1', 'JOB-TEST-B1', 'WO-B1', 'PRD-1', 'RCP-1', 'wc-1', 'READY', 100.0)
    `);
  });

  it('throws SecurityContextMissingError when database access is attempted without a valid context', () => {
    expect(() => masterRepo.forContext(null as any)).toThrow(SecurityContextMissingError);
    expect(() => masterRepo.forContext({} as any)).toThrow(SecurityContextMissingError);
    expect(() => masterRepo.forContext({ principal: null } as any)).toThrow(SecurityContextMissingError);
  });

  it('strictly isolates site-scoped queries by organizationId and siteId, returning null for cross-site entity (existence defense)', async () => {
    const siteA1Ctx: RequestContext = {
      principal: {
        kind: 'HUMAN',
        operatorId: 'op-site-a',
        operatorCode: 'OP-A1',
        role: 'OPERATOR',
        permissions: new Set(['batch:view']),
        organizationId: 'org-test-a',
        siteId: 'site-test-a1',
        sessionId: 'sess-a1'
      },
      correlationId: 'corr-1',
      requestId: 'req-1',
      ipAddress: '127.0.0.1'
    };

    const scopedRepoA = masterRepo.forContext(siteA1Ctx);

    // Can find Site A1 batch
    const batchA = await scopedRepoA.batches.findById('test-batch-a1');
    expect(batchA).not.toBeNull();
    expect(batchA?.id).toBe('test-batch-a1');
    expect(batchA?.organization_id).toBe('org-test-a');
    expect(batchA?.site_id).toBe('site-test-a1');

    // CANNOT find Site B1 batch -> returns null (404 existence defense, not 403 disclosure)
    const crossSiteBatch = await scopedRepoA.batches.findById('test-batch-b1');
    expect(crossSiteBatch).toBeNull();
  });

  it('supports service principals with SYSTEM scope for appliance-wide infrastructure operations', async () => {
    const systemCtx: RequestContext = {
      principal: {
        kind: 'SERVICE',
        serviceId: 'srv-backup-01',
        serviceName: 'backup-runner',
        scope: { kind: 'SYSTEM', organizationId: 'org-test-a' },
        permissions: new Set(['system:backup', 'system:restore']),
        credentialId: 'cred-sys-01'
      },
      correlationId: 'corr-sys',
      requestId: 'req-sys-1',
      ipAddress: '127.0.0.1'
    };

    const scopedRepo = masterRepo.forContext(systemCtx);
    const sites = await scopedRepo.sites.listAll();
    expect(sites.length).toBeGreaterThanOrEqual(2);
    expect(sites.some((s: any) => s.id === 'site-test-a1')).toBe(true);
    expect(sites.some((s: any) => s.id === 'site-test-b1')).toBe(true);
  });

  it('supports ORGANIZATION_SCOPED access for organization settings without requiring a siteId', async () => {
    await db.execute("INSERT OR REPLACE INTO organization_settings (organization_id, setting_key, setting_value) VALUES ('org-test-a', 'msl_grace_period_mins', '30')");

    const orgServiceCtx: RequestContext = {
      principal: {
        kind: 'SERVICE',
        serviceId: 'srv-org-sync',
        serviceName: 'org-sync-service',
        scope: { kind: 'ORGANIZATION', organizationId: 'org-test-a' },
        permissions: new Set(['org:settings:read']),
        credentialId: 'cred-org-01'
      },
      correlationId: 'corr-org',
      requestId: 'req-org-1',
      ipAddress: '127.0.0.1'
    };

    const scopedRepo = masterRepo.forContext(orgServiceCtx);
    const setting = await scopedRepo.organizationSettings.get('msl_grace_period_mins');
    expect(setting).toBe('30');
  });

  it('prevents site-scoped operations when a service principal lacks site scope', async () => {
    const orgOnlyServiceCtx: RequestContext = {
      principal: {
        kind: 'SERVICE',
        serviceId: 'srv-org-only',
        serviceName: 'org-service',
        scope: { kind: 'ORGANIZATION', organizationId: 'org-test-a' },
        permissions: new Set(['batch:view']),
        credentialId: 'cred-org-02'
      },
      correlationId: 'corr-org-2',
      requestId: 'req-org-2',
      ipAddress: '127.0.0.1'
    };

    const scopedRepo = masterRepo.forContext(orgOnlyServiceCtx);
    await expect(scopedRepo.batches.findById('test-batch-a1')).rejects.toThrow(SecurityContextMissingError);
  });
});
