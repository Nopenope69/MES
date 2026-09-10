import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  traceabilityApi,
  getPanelGenealogy,
  getUnitGenealogy,
  lookupBySerialNumber,
  recallByIdentifier,
  getBatchGenealogy,
  isFixtureModeEnabled,
  setFixtureModeEnabled
} from '../src/services/traceability.api';
import {
  FIXTURE_PANEL_0042,
  FIXTURE_PANEL_CLEAN,
  FIXTURE_RECALL_REEL,
  FIXTURE_BATCH_SUMMARY
} from '../src/fixtures/traceability.fixtures';
import { formatMslFloorLife } from '../src/components/traceability/PlacementChainTable';

describe('SMT Cleanroom Cockpit Traceability & Recall Station (Web)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setFixtureModeEnabled(true);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('1. API Status Code Mapping & Security Invariants', () => {
    it('maps HTTP 401 Unauthorized to AUTH_ERROR and NEVER falls back to demo fixtures', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'JWT expired or missing' })
      });

      const res = await getPanelGenealogy('PNL-260901-0042');
      expect(res.source).toBe('AUTH_ERROR');
      expect(res.statusCode).toBe(401);
      expect(res.data).toBeNull();
      expect(res.error).toContain('JWT expired');
    });

    it('maps HTTP 403 Forbidden to AUTH_ERROR and NEVER falls back to demo fixtures', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: 'Insufficient permissions' })
      });

      const res = await getBatchGenealogy('JOB-SM-260901');
      expect(res.source).toBe('AUTH_ERROR');
      expect(res.statusCode).toBe(403);
      expect(res.data).toBeNull();
    });

    it('maps HTTP 404 Not Found to NOT_FOUND and NEVER falls back to demo fixtures', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Panel not found' })
      });

      const res = await getPanelGenealogy('PNL-NONEXISTENT-999');
      expect(res.source).toBe('NOT_FOUND');
      expect(res.statusCode).toBe(404);
      expect(res.data).toBeNull();
    });

    it('maps HTTP 500 Server Error to ERROR and NEVER falls back to demo fixtures', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Database connection failed' })
      });

      const res = await recallByIdentifier('REEL-MUR-98124');
      expect(res.source).toBe('ERROR');
      expect(res.statusCode).toBe(500);
      expect(res.data).toBeNull();
    });

    it('returns LIVE data when HTTP 200 succeeds', async () => {
      const mockLivePanel = {
        panelBarcode: 'PNL-LIVE-001',
        units: [{ unitPosition: 1, unitStatus: 'PASSED' }]
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockLivePanel
      });

      const res = await getPanelGenealogy('PNL-LIVE-001');
      expect(res.source).toBe('LIVE');
      expect(res.statusCode).toBe(200);
      expect(res.data).toEqual(mockLivePanel);
    });
  });

  describe('2. Offline Fallback & Fixture Mode Governance', () => {
    it('falls back to OFFLINE_FIXTURE on network failure when fixture mode is ENABLED', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch (Network Offline)'));
      setFixtureModeEnabled(true);

      const res = await getPanelGenealogy('PNL-260901-0042');
      expect(res.source).toBe('OFFLINE_FIXTURE');
      expect(res.data).toBeDefined();
      expect(res.data.panelBarcode).toBe('PNL-260901-0042');
      expect(res.fixtureId).toBe('PNL-260901-0042');
    });

    it('returns OFFLINE_NO_DATA and suppresses fixtures on network failure when fixture mode is DISABLED', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch (Network Offline)'));
      setFixtureModeEnabled(false);

      const res = await getPanelGenealogy('PNL-260901-0042');
      expect(res.source).toBe('OFFLINE_NO_DATA');
      expect(res.data).toBeNull();
      expect(res.error).toContain('offline fixture mode is disabled');
    });

    it('toggle and read fixture mode state correctly', () => {
      setFixtureModeEnabled(false);
      expect(isFixtureModeEnabled()).toBe(false);
      setFixtureModeEnabled(true);
      expect(isFixtureModeEnabled()).toBe(true);
    });
  });

  describe('3. Canonical Seed Truth & Fixture Fidelity', () => {
    it('ensures PNL-260901-0042 has 6 units with Unit 3 exclusively on QUALITY_HOLD with defects', () => {
      expect(FIXTURE_PANEL_0042.units).toHaveLength(6);

      const unit3 = FIXTURE_PANEL_0042.units.find((u: any) => u.unitPosition === 3);
      expect(unit3).toBeDefined();
      expect(unit3.unitStatus).toBe('QUALITY_HOLD');
      expect(unit3.unitSerialNumber).toBe('SN-MTR-0042-U3');
      expect(unit3.aoiInspections).toHaveLength(1);
      expect(unit3.aoiInspections[0].unitDefects).toHaveLength(1);
      expect(unit3.aoiInspections[0].unitDefects[0].defectType).toBe('TOMBSTONE');
      expect(unit3.aoiInspections[0].unitDefects[0].refDes).toBe('C12');
      expect(unit3.reworkHistory).toHaveLength(1);

      // Verify all other units (1, 2, 4, 5, 6) are PASSED with zero defects
      const passedUnits = FIXTURE_PANEL_0042.units.filter((u: any) => u.unitPosition !== 3);
      expect(passedUnits).toHaveLength(5);
      passedUnits.forEach((u: any) => {
        expect(u.unitStatus).toBe('PASSED');
        expect(u.aoiInspections[0].unitDefects).toHaveLength(0);
        expect(u.reworkHistory).toHaveLength(0);
      });
    });

    it('ensures clean panel PNL-SM-00140 has all 4 units in PASSED state with DHR released', () => {
      expect(FIXTURE_PANEL_CLEAN.units).toHaveLength(4);
      FIXTURE_PANEL_CLEAN.units.forEach((u: any) => {
        expect(u.unitStatus).toBe('PASSED');
        expect(u.dhr.status).toBe('RELEASED');
      });
    });

    it('ensures reflow thermal profile linkage provenance is DIRECT_FK and EXACT', () => {
      const u1 = FIXTURE_PANEL_0042.units[0];
      expect(u1.reflowProfile.profileRunId).toBe('run-prf-20260908-01');
      expect(u1.reflowProfile.linkage.source).toBe('DIRECT_FK');
      expect(u1.reflowProfile.linkage.confidence).toBe('EXACT');
    });

    it('ensures REEL-MUR-98124 recall fixture contains affected batches, panels, and units', () => {
      expect(FIXTURE_RECALL_REEL.queryTarget).toBe('REEL-MUR-98124');
      expect(FIXTURE_RECALL_REEL.targetType).toBe('COMPONENT_REEL');
      expect(FIXTURE_RECALL_REEL.containmentRecommendation).toBe('QUARANTINE_REQUIRED');
      expect(FIXTURE_RECALL_REEL.affectedBatches).toHaveLength(1);
      expect(FIXTURE_RECALL_REEL.affectedPanels).toHaveLength(4);
      expect(FIXTURE_RECALL_REEL.affectedUnits.length).toBeGreaterThanOrEqual(10);
      expect(FIXTURE_RECALL_REEL.summary.totalUnitsAffected).toBe(17);
    });

    it('ensures JOB-SM-260901 batch summary fixture provides yield rollup and materials consumed', () => {
      expect(FIXTURE_BATCH_SUMMARY.summary.totalPanels).toBe(4);
      expect(FIXTURE_BATCH_SUMMARY.summary.totalUnits).toBe(17);
      expect(FIXTURE_BATCH_SUMMARY.summary.passedUnits).toBe(16);
      expect(FIXTURE_BATCH_SUMMARY.summary.heldUnits).toBe(1);
      expect(FIXTURE_BATCH_SUMMARY.panels).toHaveLength(4);
      expect(FIXTURE_BATCH_SUMMARY.materialsConsumed.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('4. JEDEC MSL Presentation Rule (No 999999m Sentinels)', () => {
    it('formats untracked / MSL 1 / 999999m as em-dash "—" with UNLIMITED status', () => {
      const res1 = formatMslFloorLife('MSL_1', 999999);
      expect(res1.text).toBe('—');
      expect(res1.status).toBe('UNLIMITED');

      const res2 = formatMslFloorLife('MSL_2', 950000);
      expect(res2.text).toBe('—');
      expect(res2.status).toBe('UNLIMITED');

      const res3 = formatMslFloorLife('', 999999);
      expect(res3.text).toBe('—');
      expect(res3.status).toBe('UNLIMITED');
    });

    it('formats expired floor life (<= 0m) as EXPIRED', () => {
      const res = formatMslFloorLife('MSL_3', 0);
      expect(res.text).toBe('0m (EXPIRED)');
      expect(res.status).toBe('EXPIRED');
    });

    it('formats active floor life (> 48h) in days and hours', () => {
      // 9,600 minutes = 160 hours = 6 days 16 hours
      const res = formatMslFloorLife('MSL_3', 9600);
      expect(res.text).toBe('6d 16h');
      expect(res.status).toBe('ACTIVE');
    });

    it('formats active floor life (< 48h) in hours and minutes', () => {
      // 150 minutes = 2 hours 30 minutes
      const res = formatMslFloorLife('MSL_3', 150);
      expect(res.text).toBe('2h 30m');
      expect(res.status).toBe('ACTIVE');
    });
  });

  describe('5. Recall Disambiguation & API Surface', () => {
    it('appends namespace query parameter when disambiguation is provided', async () => {
      let calledUrl = '';
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        calledUrl = url;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ target: 'LOT-MUR-2601', resolvedNamespace: 'MATERIAL_LOT' })
        });
      });

      await recallByIdentifier('LOT-MUR-2601', 'MATERIAL_LOT');
      expect(calledUrl).toBe('/api/v1/genealogy/recall/LOT-MUR-2601?namespace=MATERIAL_LOT');
    });

    it('exports all 5 core traceability endpoints via traceabilityApi object', () => {
      expect(traceabilityApi.getPanelGenealogy).toBeDefined();
      expect(traceabilityApi.getUnitGenealogy).toBeDefined();
      expect(traceabilityApi.lookupBySerialNumber).toBeDefined();
      expect(traceabilityApi.recallByIdentifier).toBeDefined();
      expect(traceabilityApi.getBatchGenealogy).toBeDefined();
    });
  });
});
