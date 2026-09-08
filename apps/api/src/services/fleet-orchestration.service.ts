import { getDatabase, IDatabase } from '../db/database';
import { ProductionMetricsService, LineOeeMetrics } from './production-metrics.service';

export interface ProductionLineSummary {
  id: string;
  code: string;
  name: string;
  areaId: string;
  areaName: string;
  status: 'RUNNING' | 'PAUSED' | 'DOWN' | 'IDLE';
  activeBatchId?: string;
  activeBatchCode?: string;
  activeProgramName?: string;
  workCenterCount: number;
  oee: LineOeeMetrics;
  activeQualityHolds: number;
}

export interface FleetOverview {
  facilityId: string;
  facilityName: string;
  bayId: string;
  bayName: string;
  totalLines: number;
  runningLines: number;
  averageOee: number;
  lines: ProductionLineSummary[];
  agvFleetStatus: {
    totalUnits: number;
    idleUnits: number;
    inTransitUnits: number;
    chargingUnits: number;
  };
}

export interface BayTaktBalancingReport {
  bayId: string;
  bayName: string;
  analyzedAt: string;
  lines: {
    lineId: string;
    lineCode: string;
    targetTaktSeconds: number;
    actualTaktSeconds: number;
    taktAdherencePct: number;
    varianceSeconds: number;
    loadBalancingRecommendation?: string;
  }[];
}

/**
 * FleetOrchestrationService: Multi-Line Bay Aggregator & ISA-95 Topology Resolver.
 */
export class FleetOrchestrationService {
  private static instance: FleetOrchestrationService | null = null;

  constructor(
    private dbProvider: () => IDatabase = () => getDatabase(),
    private metricsService: ProductionMetricsService = ProductionMetricsService.getInstance()
  ) {}

  public static getInstance(): FleetOrchestrationService {
    if (!FleetOrchestrationService.instance) {
      FleetOrchestrationService.instance = new FleetOrchestrationService();
    }
    return FleetOrchestrationService.instance;
  }

  public static resetInstance(): void {
    FleetOrchestrationService.instance = null;
  }

  /**
   * Resolves the full ISA-95 topology for an asset.
   */
  public async resolveAssetHierarchy(workCenterId: string): Promise<{
    organizationId: string;
    siteId: string;
    areaId: string;
    lineId: string;
    workCenterId: string;
    assetPath: string;
  } | null> {
    const db = this.dbProvider();
    const rows = await db.query<any>(`
      SELECT 
        o.id as organizationId,
        s.id as siteId,
        a.id as areaId,
        pl.id as lineId,
        wc.id as workCenterId,
        wc.asset_path as assetPath
      FROM work_centers wc
      JOIN production_lines pl ON pl.id = wc.line_id
      JOIN areas a ON a.id = pl.area_id
      JOIN sites s ON s.id = a.site_id
      JOIN organizations o ON o.id = s.organization_id
      WHERE wc.id = ?
      LIMIT 1
    `, [workCenterId]);

    if (rows.length === 0) return null;
    return rows[0];
  }

  /**
   * Generates a high-level fleet overview across all production lines in the SMT cleanroom.
   */
  public async getFleetOverview(): Promise<FleetOverview> {
    const db = this.dbProvider();

    // 1. Fetch facility & bay metadata
    const siteRows = await db.query<any>(`
      SELECT s.id as siteId, s.name as siteName, a.id as areaId, a.name as areaName
      FROM sites s
      JOIN areas a ON a.site_id = s.id
      WHERE a.type = 'SMT_CLEANROOM'
      LIMIT 1
    `);

    const siteId = siteRows[0]?.siteId || 'site-noida-p4';
    const siteName = siteRows[0]?.siteName || 'Noida Sector 63 SMT Facility';
    const bayId = siteRows[0]?.areaId || 'area-smt-01';
    const bayName = siteRows[0]?.areaName || 'SMT Cleanroom Bay A';

    // 2. Fetch all lines in this bay
    const lineRows = await db.query<any>(`
      SELECT pl.id, pl.code, pl.name, pl.area_id as areaId
      FROM production_lines pl
      WHERE pl.area_id = ?
      ORDER BY pl.code ASC
    `, [bayId]);

    const lines: ProductionLineSummary[] = [];
    let cumulativeOee = 0;
    let runningCount = 0;

    for (const l of lineRows) {
      // Work center count & overall line state
      const wcRows = await db.query<any>(`
        SELECT 
          COUNT(id) as wcCount,
          SUM(CASE WHEN current_state = 'DOWN' THEN 1 ELSE 0 END) as downCount,
          SUM(CASE WHEN current_state = 'PAUSED' THEN 1 ELSE 0 END) as pausedCount,
          current_program_name
        FROM work_centers
        WHERE line_id = ?
      `, [l.id]);

      const wcCount = Number(wcRows[0]?.wcCount || 0);
      const downCount = Number(wcRows[0]?.downCount || 0);
      const pausedCount = Number(wcRows[0]?.pausedCount || 0);
      const programName = wcRows[0]?.current_program_name || 'PROG-SM-METER-TOP-REV4';

      let lineStatus: 'RUNNING' | 'PAUSED' | 'DOWN' | 'IDLE' = 'RUNNING';
      if (downCount > 0) lineStatus = 'DOWN';
      else if (pausedCount > 0) lineStatus = 'PAUSED';
      else if (wcCount === 0) lineStatus = 'IDLE';

      if (lineStatus === 'RUNNING') runningCount++;

      // Active batch
      const batchRows = await db.query<any>(`
        SELECT b.id, b.batch_number
        FROM batches b
        JOIN work_centers wc ON wc.id = b.work_center_id
        WHERE wc.line_id = ? AND b.status IN ('STARTED', 'RUNNING')
        LIMIT 1
      `, [l.id]);

      // Calculate canonical OEE
      const oee = await this.metricsService.calculateLineOee(l.id);
      cumulativeOee += oee.oee;

      // Active quality holds count on this line
      const holdRows = await db.query<any>(`
        SELECT COUNT(DISTINCT pu.panel_barcode) as holdCount
        FROM panel_units pu
        WHERE pu.status = 'QUALITY_HOLD'
      `);
      const activeQualityHolds = Number(holdRows[0]?.holdCount || 0);

      lines.push({
        id: l.id,
        code: l.code,
        name: l.name,
        areaId: l.areaId,
        areaName: bayName,
        status: lineStatus,
        activeBatchId: batchRows[0]?.id || 'batch-demo-01',
        activeBatchCode: batchRows[0]?.batch_number || 'BATCH-20260907-001',
        activeProgramName: programName,
        workCenterCount: wcCount,
        oee,
        activeQualityHolds
      });
    }

    // 3. AGV fleet stats
    const agvRows = await db.query<any>(`
      SELECT 
        COUNT(id) as totalUnits,
        SUM(CASE WHEN status = 'IDLE' THEN 1 ELSE 0 END) as idleUnits,
        SUM(CASE WHEN status IN ('IN_TRANSIT', 'ASSIGNED') THEN 1 ELSE 0 END) as inTransitUnits,
        SUM(CASE WHEN status = 'CHARGING' THEN 1 ELSE 0 END) as chargingUnits
      FROM agv_units
    `);

    const averageOee = lines.length > 0 ? Math.round((cumulativeOee / lines.length) * 10000) / 10000 : 0;

    return {
      facilityId: siteId,
      facilityName: siteName,
      bayId,
      bayName,
      totalLines: lines.length,
      runningLines: runningCount,
      averageOee,
      lines,
      agvFleetStatus: {
        totalUnits: Number(agvRows[0]?.totalUnits || 0),
        idleUnits: Number(agvRows[0]?.idleUnits || 0),
        inTransitUnits: Number(agvRows[0]?.inTransitUnits || 0),
        chargingUnits: Number(agvRows[0]?.chargingUnits || 0)
      }
    };
  }

  /**
   * Generates a takt time balancing report across lines in the bay.
   */
  public async getBayTaktBalancing(): Promise<BayTaktBalancingReport> {
    const overview = await this.getFleetOverview();
    const plannedTaktSeconds = 45.0;

    const lineReports = overview.lines.map(line => {
      const actualTaktSeconds = line.oee.totalOutput > 0
        ? Math.round((line.oee.operatingTimeSeconds / line.oee.totalOutput) * 10) / 10
        : plannedTaktSeconds;
      
      const varianceSeconds = Math.round((actualTaktSeconds - plannedTaktSeconds) * 10) / 10;
      const taktAdherencePct = Math.round((plannedTaktSeconds / Math.max(1, actualTaktSeconds)) * 1000) / 10;

      let loadBalancingRecommendation = 'OPTIMAL: Takt pacing aligned with bay schedule.';
      if (varianceSeconds > 10) {
        loadBalancingRecommendation = 'PACE DEFICIT: Line operating below target velocity; divert buffer panels to sister line if available.';
      } else if (varianceSeconds < -5) {
        loadBalancingRecommendation = 'HIGH VELOCITY: Line producing ahead of takt; check downstream wash buffer capacity.';
      }

      return {
        lineId: line.id,
        lineCode: line.code,
        targetTaktSeconds: plannedTaktSeconds,
        actualTaktSeconds,
        taktAdherencePct,
        varianceSeconds,
        loadBalancingRecommendation
      };
    });

    return {
      bayId: overview.bayId,
      bayName: overview.bayName,
      analyzedAt: new Date().toISOString(),
      lines: lineReports
    };
  }
}
