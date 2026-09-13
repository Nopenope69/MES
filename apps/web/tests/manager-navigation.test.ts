import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  CANONICAL_STATION_ORDER, 
  STATIONS, 
  DOMAINS, 
  getStationsForDomain, 
  isTabAllowed, 
  getInitialOrPermittedTab,
  NavTab,
  DomainId
} from '../src/config/navigation';
import { 
  fetchManagerKpis, 
  createInitialKpiState, 
  generateShiftBriefingText, 
  ManagerKpisState 
} from '../src/services/kpi-adapter';
import { authService, OperatorProfile } from '../src/services/auth.service';
import * as traceabilityApi from '../src/services/traceability.api';

describe('Manager Navigation & Executive Cockpit Acceptance Suite', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    authService.resetForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('1. Navigation Configuration & Completeness', () => {
    it('contains all 12 legacy cleanroom stations in canonical order exactly once', () => {
      expect(CANONICAL_STATION_ORDER).toHaveLength(12);
      const uniqueTabs = new Set(CANONICAL_STATION_ORDER);
      expect(uniqueTabs.size).toBe(12);

      const expectedTabs: NavTab[] = [
        'FLEET', 'SUPERVISOR', 'OPERATOR', 'SPI', 'SOLDER_PASTE',
        'REFLOW', 'AGV_LOGISTICS', 'COMPLIANCE', 'GENEALOGY',
        'REWORK', 'PREDICTIVE', 'AUDIT_TRAIL'
      ];
      expect(CANONICAL_STATION_ORDER).toEqual(expectedTabs);
    });

    it('maps all stations into exactly 4 operational domains without orphans', () => {
      expect(DOMAINS).toHaveLength(4);
      const domainIds: DomainId[] = ['EXECUTIVE', 'OPERATIONS', 'QUALITY', 'DIAGNOSTICS'];
      expect(DOMAINS.map(d => d.id)).toEqual(domainIds);

      CANONICAL_STATION_ORDER.forEach(tab => {
        const station = STATIONS[tab];
        expect(station).toBeDefined();
        expect(domainIds).toContain(station.domainId);
      });

      // Verify domain groupings
      const execStations = getStationsForDomain('EXECUTIVE').map(s => s.id);
      expect(execStations).toEqual(['FLEET', 'SUPERVISOR']);

      const opsStations = getStationsForDomain('OPERATIONS').map(s => s.id);
      expect(opsStations).toEqual(['OPERATOR', 'SPI', 'SOLDER_PASTE', 'REFLOW', 'AGV_LOGISTICS']);

      const qualityStations = getStationsForDomain('QUALITY').map(s => s.id);
      expect(qualityStations).toEqual(['COMPLIANCE', 'GENEALOGY', 'REWORK', 'PREDICTIVE']);

      const diagStations = getStationsForDomain('DIAGNOSTICS').map(s => s.id);
      expect(diagStations).toEqual(['AUDIT_TRAIL']);
    });

    it('ensures every station has human-readable label, station code, and shortcut', () => {
      CANONICAL_STATION_ORDER.forEach(tab => {
        const station = STATIONS[tab];
        expect(station.label.length).toBeGreaterThan(3);
        expect(station.shortLabel.length).toBeGreaterThan(2);
        expect(station.code).toMatch(/^[A-Z]{3}-\d{2}$/);
        expect(station.shortcut).toBeDefined();
        expect(station.requiredRoles.length).toBeGreaterThan(0);
      });
    });
  });

  describe('2. Role-Permission Enforcement & Deterministic Fallbacks', () => {
    it('correctly gates privileged stations for unauthenticated guests', () => {
      // Unauthenticated guests should only access non-privileged stations
      expect(isTabAllowed('FLEET', null)).toBe(false);
      expect(isTabAllowed('SUPERVISOR', null)).toBe(false);
      expect(isTabAllowed('COMPLIANCE', null)).toBe(false);
      expect(isTabAllowed('AUDIT_TRAIL', null)).toBe(false);

      // Read-only station monitoring is allowed for unauthenticated guests
      expect(isTabAllowed('OPERATOR', null)).toBe(true);
      expect(isTabAllowed('SPI', null)).toBe(true);
      expect(isTabAllowed('SOLDER_PASTE', null)).toBe(true);
      expect(isTabAllowed('REFLOW', null)).toBe(true);
      expect(isTabAllowed('GENEALOGY', null)).toBe(true);
    });

    it('deterministically falls back to first permitted tab when guest accesses FLEET', () => {
      const resolved = getInitialOrPermittedTab('FLEET', null);
      expect(resolved).toBe('OPERATOR');
      expect(isTabAllowed(resolved, null)).toBe(true);
    });

    it('enforces OPERATOR role restrictions and falls back away from FLEET', () => {
      const operatorUser: OperatorProfile = {
        id: 'op-01',
        code: 'OP-01',
        name: 'Operator 1',
        role: 'OPERATOR'
      };

      authService.setSessionForTesting('token-op', operatorUser);

      expect(isTabAllowed('FLEET', operatorUser)).toBe(false);
      expect(isTabAllowed('SUPERVISOR', operatorUser)).toBe(false);
      expect(isTabAllowed('COMPLIANCE', operatorUser)).toBe(false);
      expect(isTabAllowed('AUDIT_TRAIL', operatorUser)).toBe(false);

      expect(isTabAllowed('OPERATOR', operatorUser)).toBe(true);
      expect(isTabAllowed('SPI', operatorUser)).toBe(true);
      expect(isTabAllowed('REFLOW', operatorUser)).toBe(true);

      // Deterministic fallback from unauthorized FLEET must route to OPERATOR (Feeder Bay)
      const fallbackTab = getInitialOrPermittedTab('FLEET', operatorUser);
      expect(fallbackTab).toBe('OPERATOR');
    });

    it('enforces QUALITY_LEAD role capabilities and allows FLEET and COMPLIANCE', () => {
      const qualityLead: OperatorProfile = {
        id: 'qc-01',
        code: 'QC-01',
        name: 'Quality Lead 1',
        role: 'QUALITY_LEAD'
      };

      authService.setSessionForTesting('token-qc', qualityLead);

      expect(isTabAllowed('FLEET', qualityLead)).toBe(true);
      expect(isTabAllowed('SUPERVISOR', qualityLead)).toBe(true);
      expect(isTabAllowed('COMPLIANCE', qualityLead)).toBe(true);
      expect(isTabAllowed('GENEALOGY', qualityLead)).toBe(true);
      expect(isTabAllowed('AUDIT_TRAIL', qualityLead)).toBe(true);

      // When requesting FLEET, quality lead remains on FLEET
      const resolved = getInitialOrPermittedTab('FLEET', qualityLead);
      expect(resolved).toBe('FLEET');
    });

    it('enforces SYSTEM_ADMIN superuser access across all 12 stations', () => {
      const admin: OperatorProfile = {
        id: 'admin-01',
        code: 'SYS-ADMIN',
        name: 'System Administrator',
        role: 'SYSTEM_ADMIN'
      };

      authService.setSessionForTesting('token-admin', admin);

      CANONICAL_STATION_ORDER.forEach(tab => {
        expect(isTabAllowed(tab, admin)).toBe(true);
        expect(getInitialOrPermittedTab(tab, admin)).toBe(tab);
      });
    });
  });

  describe('3. Anti-Fake-Success & Live KPI Data Contract', () => {
    it('parses live backend data when API endpoints succeed', async () => {
      const mockFleetOverview = {
        bayName: 'SMT Bay Alpha',
        facilityName: 'Apex Noida P4',
        totalLines: 2,
        runningLines: 2,
        averageOee: 86.4,
        lines: [
          {
            id: 'line-01',
            status: 'RUNNING',
            activeQualityHolds: 0,
            oee: {
              oee: 0.864,
              availability: 0.92,
              performance: 0.96,
              quality: 0.98
            }
          }
        ]
      };

      const mockShiftSummary = {
        shiftCode: 'Shift A - Morning',
        date: '2026-09-14',
        operatingMinutes: 180,
        downtimeMinutes: 12,
        goodQuantity: 150,
        rejectedQuantity: 3,
        qualityPercentage: 98.0,
        topDowntimeReasons: [
          { reasonLabel: 'Feeder Reel Splicing', durationMinutes: 8, occurrences: 2 }
        ]
      };

      const mockTaktBalancing = {
        lines: [
          {
            lineId: 'line-01',
            actualCycleTimeSeconds: 18.2,
            targetTaktSeconds: 18.0,
            taktVariancePercent: 1.1,
            status: 'ON_PACE'
          }
        ]
      };

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/fleet/overview')) {
          return { ok: true, status: 200, json: async () => ({ success: true, data: mockFleetOverview }) };
        }
        if (url.includes('/api/v1/reports/shift-summary')) {
          return { ok: true, status: 200, json: async () => mockShiftSummary };
        }
        if (url.includes('/api/v1/fleet/takt-balancing')) {
          return { ok: true, status: 200, json: async () => ({ success: true, data: mockTaktBalancing }) };
        }
        return { ok: false, status: 404 };
      });

      const kpis = await fetchManagerKpis();

      expect(kpis.overallStatus).toBe('LIVE');
      expect(kpis.plantOee.status).toBe('LIVE');
      expect(kpis.plantOee.value?.oee).toBe(86.4);
      expect(kpis.activeQualityHolds.value).toBe(0);

      // Verify CPH calculation: (150 good panels * 74 components) / (180 min / 60 min) = 11,100 / 3 = 3,700 CPH
      expect(kpis.placementSpeedCph.value?.actualCph).toBe(3700);

      // Verify FPY: 150 / 153 = 98.04%
      expect(kpis.firstPassYield.value?.goodPanels).toBe(150);
      expect(kpis.firstPassYield.value?.rejectedPanels).toBe(3);

      // Verify Takt
      expect(kpis.taktStatus.value?.status).toBe('ON_PACE');
      expect(kpis.taktStatus.value?.actualTaktSeconds).toBe(18.2);
    });

    it('sets status to UNAVAILABLE and value to null when backend fails — NEVER fabricates fake literals', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Database connection failed' })
      });

      const kpis = await fetchManagerKpis();

      expect(kpis.overallStatus).toBe('UNAVAILABLE');
      expect(kpis.plantOee.status).toBe('UNAVAILABLE');
      expect(kpis.plantOee.value).toBeNull();
      expect(kpis.placementSpeedCph.status).toBe('UNAVAILABLE');
      expect(kpis.placementSpeedCph.value).toBeNull();
      expect(kpis.firstPassYield.status).toBe('UNAVAILABLE');
      expect(kpis.firstPassYield.value).toBeNull();
      expect(kpis.activeQualityHolds.status).toBe('UNAVAILABLE');
      expect(kpis.activeQualityHolds.value).toBeNull();
    });

    it('flags SAMPLE_DATA when fixture mode is active to prevent confusing executives', async () => {
      vi.spyOn(traceabilityApi, 'isFixtureModeEnabled').mockReturnValue(true);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ averageOee: 84.6, lines: [] })
      });

      const kpis = await fetchManagerKpis();
      expect(kpis.isSampleData).toBe(true);
      expect(kpis.overallStatus).toBe('SAMPLE_DATA');
      expect(kpis.plantOee.status).toBe('SAMPLE_DATA');
    });
  });

  describe('4. Standardized Markdown Shift Handover Briefing', () => {
    it('formats a complete briefing with live metrics and downtime Pareto', () => {
      const kpis: ManagerKpisState = {
        plantOee: {
          value: { oee: 85.2, availability: 92.0, performance: 95.0, quality: 97.4, lineCount: 2, runningCount: 2 },
          status: 'LIVE',
          lastUpdated: Date.now(),
          sourceEndpoint: '/api/v1/fleet/overview'
        },
        placementSpeedCph: {
          value: { actualCph: 44200, targetCph: 45000, cycleTimeSeconds: 18.2 },
          status: 'LIVE',
          lastUpdated: Date.now(),
          sourceEndpoint: '/api/v1/reports/shift-summary'
        },
        firstPassYield: {
          value: { fpyPct: 98.4, goodPanels: 140, rejectedPanels: 2, totalPanels: 142 },
          status: 'LIVE',
          lastUpdated: Date.now(),
          sourceEndpoint: '/api/v1/reports/shift-summary'
        },
        activeQualityHolds: {
          value: 0,
          status: 'LIVE',
          lastUpdated: Date.now(),
          sourceEndpoint: '/api/v1/fleet/overview'
        },
        taktStatus: {
          value: { actualTaktSeconds: 18.2, targetTaktSeconds: 18.0, variancePct: 1.1, status: 'ON_PACE' },
          status: 'LIVE',
          lastUpdated: Date.now(),
          sourceEndpoint: '/api/v1/fleet/takt-balancing'
        },
        shiftInfo: {
          value: {
            shiftCode: 'Shift A - Day',
            date: '2026-09-14',
            operatingMinutes: 420,
            downtimeMinutes: 18,
            topDowntimeReasons: [
              { reasonLabel: 'Feeder Reel Splicing (Slot 02)', durationMinutes: 12, occurrences: 3 },
              { reasonLabel: 'Stencil Clean Cycle', durationMinutes: 6, occurrences: 2 }
            ]
          },
          status: 'LIVE',
          lastUpdated: Date.now(),
          sourceEndpoint: '/api/v1/reports/shift-summary'
        },
        isSampleData: false,
        overallStatus: 'LIVE'
      };

      const markdown = generateShiftBriefingText(kpis);

      expect(markdown).toContain('APEX ELECTRONICS • NOIDA CLUSTER P4');
      expect(markdown).toContain('Shift: Shift A - Day');
      expect(markdown).toContain('85.2%');
      expect(markdown).toContain('44,200 CPH');
      expect(markdown).toContain('140 Good Panels');
      expect(markdown).toContain('0 Active Line Holds');
      expect(markdown).toContain('Feeder Reel Splicing (Slot 02)');
      expect(markdown).toContain('Stencil Clean Cycle');
    });

    it('gracefully handles missing telemetry in shift handover briefing with explicit unavailable tags', () => {
      const emptyKpis = createInitialKpiState();
      const markdown = generateShiftBriefingText(emptyKpis);

      expect(markdown).toContain('[Telemetry Unavailable]');
      expect(markdown).toContain('[Output Data Unavailable]');
      expect(markdown).toContain('[Speed Sensor Offline]');
      expect(markdown).toContain('[Hold Status Offline]');
      expect(markdown).toContain('Zero line stoppages recorded');
    });
  });
});
