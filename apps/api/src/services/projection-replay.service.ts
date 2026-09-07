import { v4 as uuidv4 } from 'uuid';
import { MesEventEnvelope } from '@mes/shared';
import { getDatabase, IDatabase } from '../db/database';
import { IEventProjector } from './projectors/projector.interface';
import { CoreProjector } from './projectors/core.projector';
import { SmtProjector } from './projectors/smt.projector';
import { AoiProjector } from './projectors/aoi.projector';
import { SpiProjector } from './projectors/spi.projector';
import { EventUpcasterService } from './event-upcaster.service';

export interface ProjectionCheckpoint {
  projectionName: string;
  lastEventId: string | null;
  lastEventTime: string | null;
  eventsProcessed: number;
  updatedAt: string;
}

export interface AggregateSnapshot<T = any> {
  id: string;
  aggregateType: string;
  aggregateId: string;
  snapshotVersion: number;
  state: T;
  createdAt: string;
}

/**
 * ProjectionReplayService (Track A: Architecture & Event Sourcing)
 *
 * Implements the Catchup Projector & Snapshot patterns:
 * 1. Read-model rebuilding: Replay historical events from `production_events` through projectors.
 * 2. High-water mark checkpoint tracking via `projection_checkpoints`.
 * 3. Aggregate state snapshotting via `projection_snapshots` to enable O(1) state restoration.
 */
export class ProjectionReplayService {
  private static defaultProjectors: IEventProjector[] = [
    new CoreProjector(),
    new SmtProjector(),
    new AoiProjector(),
    new SpiProjector()
  ];

  /**
   * Save a point-in-time aggregate snapshot (e.g. FEEDER_BANK, WORK_CENTER, SOLDER_PASTE_JAR).
   */
  public static async saveSnapshot<T = any>(
    aggregateType: string,
    aggregateId: string,
    snapshotVersion: number,
    state: T
  ): Promise<string> {
    const db = getDatabase();
    const snapshotId = uuidv4();
    await db.execute(`
      INSERT INTO projection_snapshots (id, aggregate_type, aggregate_id, snapshot_version, state_json, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [snapshotId, aggregateType, aggregateId, snapshotVersion, JSON.stringify(state)]);
    return snapshotId;
  }

  /**
   * Retrieve the latest aggregate snapshot for fast catch-up.
   */
  public static async getLatestSnapshot<T = any>(
    aggregateType: string,
    aggregateId: string
  ): Promise<AggregateSnapshot<T> | null> {
    const db = getDatabase();
    const rows = await db.query<any>(`
      SELECT * FROM projection_snapshots 
      WHERE aggregate_type = ? AND aggregate_id = ? 
      ORDER BY snapshot_version DESC, created_at DESC 
      LIMIT 1
    `, [aggregateType, aggregateId]);

    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      snapshotVersion: Number(row.snapshot_version),
      state: JSON.parse(row.state_json),
      createdAt: row.created_at
    };
  }

  /**
   * Get all active projection checkpoints.
   */
  public static async getCheckpoints(): Promise<ProjectionCheckpoint[]> {
    const db = getDatabase();
    const rows = await db.query<any>('SELECT * FROM projection_checkpoints');
    return rows.map(r => ({
      projectionName: r.projection_name,
      lastEventId: r.last_event_id,
      lastEventTime: r.last_event_time,
      eventsProcessed: Number(r.events_processed),
      updatedAt: r.updated_at
    }));
  }

  /**
   * Catchup Projection Replay:
   * Replays historical events from the immutable event store through registered projectors.
   * If `fromTimestamp` is provided, replays only events occurring after that timestamp.
   */
  public static async replayCatchup(options?: {
    fromTimestamp?: string;
    projectors?: IEventProjector[];
  }): Promise<{ eventsReplayed: number; status: 'SUCCESS' | 'ERROR' }> {
    const db = getDatabase();
    const activeProjectors = options?.projectors || this.defaultProjectors;

    let querySql = 'SELECT * FROM production_events ORDER BY event_time ASC, created_at ASC';
    const queryParams: any[] = [];

    if (options?.fromTimestamp) {
      querySql = 'SELECT * FROM production_events WHERE event_time >= ? ORDER BY event_time ASC, created_at ASC';
      queryParams.push(options.fromTimestamp);
    }

    const eventRows = await db.query<any>(querySql, queryParams);

    await db.withTransaction(async (tx: IDatabase) => {
      for (const row of eventRows) {
        const envelope: MesEventEnvelope = {
          eventId: row.event_id,
          eventType: row.event_type,
          schemaVersion: row.schema_version || '1.0.0',
          eventTime: row.event_time,
          receivedTime: row.received_time,
          sourceType: row.source_type,
          sourceId: row.source_id,
          sequenceId: row.sequence_id,
          siteId: row.site_id,
          workCenterId: row.work_center_id,
          assetPath: row.asset_path,
          ingressEventId: row.ingress_event_id,
          batchId: row.batch_id,
          workOrderId: row.work_order_id,
          operatorId: row.operator_id,
          correlationId: row.correlation_id,
          payload: JSON.parse(row.payload_json)
        };

        const upcastedEnvelope = EventUpcasterService.upcast(envelope);

        for (const projector of activeProjectors) {
          if (projector.supports(upcastedEnvelope.eventType)) {
            await projector.project(upcastedEnvelope, tx);
          }
        }
      }
    });

    return {
      eventsReplayed: eventRows.length,
      status: 'SUCCESS'
    };
  }
}
