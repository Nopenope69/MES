import { v4 as uuidv4 } from 'uuid';
import { getDatabase, IDatabase } from '../db/database';
import { Clock, SystemClock } from '../utils/clock';

export interface TelemetryPoint {
  id?: string;
  timestamp?: string;
  factoryId?: string;
  bayId?: string;
  lineId: string;
  workCenterId?: string;
  equipmentId?: string;
  assetId: string; // e.g. "nozzle-head-1-nz-04", "aperture-U3-P1", "feeder-slot-12"
  metric: string;  // e.g. "vacuum_pressure_kpa", "paste_volume_pct", "pickup_errors"
  value: number;
  unit: string;
  metadata?: Record<string, any>;
}

export interface ITelemetryStore {
  recordPoint(point: TelemetryPoint): Promise<string>;
  recordBatch(points: TelemetryPoint[]): Promise<number>;
  getWindow(assetId: string, metric: string, windowMinutes?: number): Promise<TelemetryPoint[]>;
  getLineTelemetry(lineId: string, metric: string, windowMinutes?: number): Promise<TelemetryPoint[]>;
}

/**
 * TelemetryStore: Dedicated High-Frequency Time-Series Store.
 *
 * ARCHITECTURAL INVARIANT:
 * This store is completely isolated from EventStoreModule.
 * High-speed machine measurements (kilohertz vacuum logs, paste heights, pickup telemetry)
 * never pass through EventStore schemas, append locks, or projection checkpoints.
 */
export class TelemetryStore implements ITelemetryStore {
  private static instance: TelemetryStore | null = null;

  constructor(
    private dbProvider: () => IDatabase = () => getDatabase(),
    private clock: Clock = new SystemClock()
  ) {}

  public static getInstance(): TelemetryStore {
    if (!TelemetryStore.instance) {
      TelemetryStore.instance = new TelemetryStore();
    }
    return TelemetryStore.instance;
  }

  public static resetInstance(): void {
    TelemetryStore.instance = null;
  }

  /**
   * Records a single telemetry observation.
   */
  public async recordPoint(point: TelemetryPoint): Promise<string> {
    const db = this.dbProvider();
    const id = point.id || uuidv4();
    const ts = point.timestamp || this.clock.now().toISOString();

    await db.execute(`
      INSERT INTO telemetry_points (
        id, timestamp, factory_id, bay_id, line_id, work_center_id, equipment_id,
        asset_id, metric, value, unit, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, ts,
      point.factoryId || 'site-noida-p4',
      point.bayId || 'area-smt-01',
      point.lineId,
      point.workCenterId || null,
      point.equipmentId || null,
      point.assetId,
      point.metric,
      point.value,
      point.unit,
      point.metadata ? JSON.stringify(point.metadata) : null
    ]);

    return id;
  }

  /**
   * Batch records telemetry points with high throughput.
   */
  public async recordBatch(points: TelemetryPoint[]): Promise<number> {
    if (points.length === 0) return 0;
    const db = this.dbProvider();
    const now = this.clock.now().toISOString();

    await db.withTransaction(async (tx) => {
      for (const p of points) {
        await tx.execute(`
          INSERT INTO telemetry_points (
            id, timestamp, factory_id, bay_id, line_id, work_center_id, equipment_id,
            asset_id, metric, value, unit, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          p.id || uuidv4(),
          p.timestamp || now,
          p.factoryId || 'site-noida-p4',
          p.bayId || 'area-smt-01',
          p.lineId,
          p.workCenterId || null,
          p.equipmentId || null,
          p.assetId,
          p.metric,
          p.value,
          p.unit,
          p.metadata ? JSON.stringify(p.metadata) : null
        ]);
      }
    });

    return points.length;
  }

  /**
   * Fetches observations for a specific asset and metric in a sliding time window.
   */
  public async getWindow(assetId: string, metric: string, windowMinutes: number = 60): Promise<TelemetryPoint[]> {
    const db = this.dbProvider();
    const cutoff = new Date(Date.now() - windowMinutes * 60000).toISOString();

    const rows = await db.query<any>(`
      SELECT 
        id, timestamp, factory_id as factoryId, bay_id as bayId,
        line_id as lineId, work_center_id as workCenterId, equipment_id as equipmentId,
        asset_id as assetId, metric, value, unit, metadata_json as metadataJson
      FROM telemetry_points
      WHERE asset_id = ? AND metric = ? AND timestamp >= ?
      ORDER BY timestamp ASC
    `, [assetId, metric, cutoff]);

    return rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      factoryId: r.factoryId,
      bayId: r.bayId,
      lineId: r.lineId,
      workCenterId: r.workCenterId,
      equipmentId: r.equipmentId,
      assetId: r.assetId,
      metric: r.metric,
      value: Number(r.value),
      unit: r.unit,
      metadata: r.metadataJson ? JSON.parse(r.metadataJson) : undefined
    }));
  }

  /**
   * Fetches observations across a line for a metric.
   */
  public async getLineTelemetry(lineId: string, metric: string, windowMinutes: number = 60): Promise<TelemetryPoint[]> {
    const db = this.dbProvider();
    const cutoff = new Date(Date.now() - windowMinutes * 60000).toISOString();

    const rows = await db.query<any>(`
      SELECT 
        id, timestamp, factory_id as factoryId, bay_id as bayId,
        line_id as lineId, work_center_id as workCenterId, equipment_id as equipmentId,
        asset_id as assetId, metric, value, unit, metadata_json as metadataJson
      FROM telemetry_points
      WHERE line_id = ? AND metric = ? AND timestamp >= ?
      ORDER BY timestamp ASC
    `, [lineId, metric, cutoff]);

    return rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      factoryId: r.factoryId,
      bayId: r.bayId,
      lineId: r.lineId,
      workCenterId: r.workCenterId,
      equipmentId: r.equipmentId,
      assetId: r.assetId,
      metric: r.metric,
      value: Number(r.value),
      unit: r.unit,
      metadata: r.metadataJson ? JSON.parse(r.metadataJson) : undefined
    }));
  }
}
