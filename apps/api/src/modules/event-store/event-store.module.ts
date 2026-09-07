import { v4 as uuidv4 } from 'uuid';
import { MesEventEnvelope, MesEventEnvelopeSchema } from '@mes/shared';
import { getDatabase, IDatabase } from '../../db/database';
import { IEventProjector } from '../../services/projectors/projector.interface';
import { CoreProjector } from '../../services/projectors/core.projector';
import { SmtProjector } from '../../services/projectors/smt.projector';
import { AoiProjector } from '../../services/projectors/aoi.projector';
import { SpiProjector } from '../../services/projectors/spi.projector';
import { EventUpcasterService } from '../../services/event-upcaster.service';
import { EventSchemaRegistry } from './event-schema.registry';
import {
  IEventStoreModule,
  EventAppendResult,
  EventReplayOptions,
  EventReplayResult,
  ProjectionCheckpoint,
  AggregateSnapshot
} from './event-store.interface';

export class EventStoreModule implements IEventStoreModule {
  private static instance: EventStoreModule | null = null;

  private projectors: IEventProjector[] = [
    new CoreProjector(),
    new SmtProjector(),
    new AoiProjector(),
    new SpiProjector()
  ];

  constructor(private dbProvider: () => IDatabase = getDatabase) {}

  public static getInstance(): EventStoreModule {
    if (!EventStoreModule.instance) {
      EventStoreModule.instance = new EventStoreModule();
    }
    return EventStoreModule.instance;
  }

  public registerProjector(projector: IEventProjector): void {
    this.projectors.push(projector);
  }

  public getProjectors(): IEventProjector[] {
    return [...this.projectors];
  }

  /**
   * Appends an event to the immutable canonical event log, upcasts it,
   * validates its schema, runs projections, and updates checkpoints atomically.
   */
  public async append(rawEvent: Partial<MesEventEnvelope>): Promise<EventAppendResult> {
    const db = this.dbProvider();
    const now = new Date().toISOString();

    let assetPath = rawEvent.assetPath;
    let batchId = rawEvent.batchId;
    if (rawEvent.workCenterId) {
      const wc = await db.query<any>('SELECT asset_path, current_batch_id FROM work_centers WHERE id = ?', [rawEvent.workCenterId]);
      if (wc.length > 0) {
        if (!assetPath && wc[0].asset_path) assetPath = wc[0].asset_path;
        if (!batchId && rawEvent.eventType !== 'BATCH_STARTED' && wc[0].current_batch_id) {
          batchId = wc[0].current_batch_id;
        }
      }
    }

    const envelope: MesEventEnvelope = {
      eventId: rawEvent.eventId || uuidv4(),
      eventType: rawEvent.eventType!,
      schemaVersion: rawEvent.schemaVersion || '1.0.0',
      eventTime: rawEvent.eventTime || now,
      receivedTime: now,
      sourceType: rawEvent.sourceType || 'MANUAL_UI',
      sourceId: rawEvent.sourceId || 'system-ui',
      sequenceId: rawEvent.sequenceId || Date.now(),
      siteId: rawEvent.siteId || 'SITE-NOIDA-P4',
      workCenterId: rawEvent.workCenterId || 'wc-line1',
      assetPath,
      ingressEventId: rawEvent.ingressEventId,
      batchId,
      workOrderId: rawEvent.workOrderId,
      operatorId: rawEvent.operatorId,
      correlationId: rawEvent.correlationId,
      payload: rawEvent.payload || {}
    };

    const validatedEnvelope = MesEventEnvelopeSchema.parse(envelope);

    // 1. Idempotency verification
    const existing = await db.query<any>(
      'SELECT id FROM production_events WHERE event_id = ? LIMIT 1',
      [validatedEnvelope.eventId]
    );
    if (existing.length > 0) {
      return {
        success: true,
        eventId: validatedEnvelope.eventId,
        message: `Event [${validatedEnvelope.eventId}] already processed (idempotent duplicate skipped).`
      };
    }

    // 2. Upcast to current schema version
    const upcastedEnvelope = EventUpcasterService.upcast(validatedEnvelope);

    // 3. Declarative payload validation
    EventSchemaRegistry.validate(upcastedEnvelope.eventType, upcastedEnvelope.payload);

    // 4. Atomically persist, project, and checkpoint
    await db.withTransaction(async (tx: IDatabase) => {
      await tx.execute(`
        INSERT INTO production_events (
          id, event_id, event_type, schema_version, event_time, received_time, source_type,
          source_id, sequence_id, site_id, work_center_id, asset_path, ingress_event_id,
          batch_id, work_order_id, operator_id, correlation_id, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        uuidv4(),
        upcastedEnvelope.eventId,
        upcastedEnvelope.eventType,
        upcastedEnvelope.schemaVersion,
        upcastedEnvelope.eventTime,
        upcastedEnvelope.receivedTime,
        upcastedEnvelope.sourceType,
        upcastedEnvelope.sourceId,
        upcastedEnvelope.sequenceId,
        upcastedEnvelope.siteId,
        upcastedEnvelope.workCenterId,
        upcastedEnvelope.assetPath || null,
        upcastedEnvelope.ingressEventId || null,
        upcastedEnvelope.batchId || null,
        upcastedEnvelope.workOrderId || null,
        upcastedEnvelope.operatorId || null,
        upcastedEnvelope.correlationId || null,
        JSON.stringify(upcastedEnvelope.payload)
      ]);

      // Project state changes across registered projectors
      for (const projector of this.projectors) {
        if (projector.supports(upcastedEnvelope.eventType)) {
          await projector.project(upcastedEnvelope, tx);

          await tx.execute(`
            INSERT INTO projection_checkpoints (
              projection_name, last_event_id, last_event_time, events_processed, updated_at
            ) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(projection_name) DO UPDATE SET
              last_event_id = excluded.last_event_id,
              last_event_time = excluded.last_event_time,
              events_processed = projection_checkpoints.events_processed + 1,
              updated_at = CURRENT_TIMESTAMP
          `, [projector.constructor.name, upcastedEnvelope.eventId, upcastedEnvelope.eventTime]);
        }
      }
    });

    return {
      success: true,
      eventId: upcastedEnvelope.eventId
    };
  }

  /**
   * Catches up read-models from the immutable event log with synchronized checkpoint updates.
   */
  public async replay(options?: EventReplayOptions): Promise<EventReplayResult> {
    const db = this.dbProvider();
    const activeProjectors = options?.projectors || this.projectors;

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

            // Synchronize projection checkpoints on replay
            await tx.execute(`
              INSERT INTO projection_checkpoints (
                projection_name, last_event_id, last_event_time, events_processed, updated_at
              ) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
              ON CONFLICT(projection_name) DO UPDATE SET
                last_event_id = excluded.last_event_id,
                last_event_time = excluded.last_event_time,
                events_processed = projection_checkpoints.events_processed + 1,
                updated_at = CURRENT_TIMESTAMP
            `, [projector.constructor.name, upcastedEnvelope.eventId, upcastedEnvelope.eventTime]);
          }
        }
      }
    });

    return {
      eventsReplayed: eventRows.length,
      status: 'SUCCESS'
    };
  }

  public async getCheckpoints(): Promise<ProjectionCheckpoint[]> {
    const db = this.dbProvider();
    const rows = await db.query<any>('SELECT * FROM projection_checkpoints');
    return rows.map((r) => ({
      projectionName: r.projection_name,
      lastEventId: r.last_event_id,
      lastEventTime: r.last_event_time,
      eventsProcessed: Number(r.events_processed),
      updatedAt: r.updated_at
    }));
  }

  public async saveSnapshot<T = any>(
    aggregateType: string,
    aggregateId: string,
    snapshotVersion: number,
    state: T
  ): Promise<string> {
    const db = this.dbProvider();
    const snapshotId = uuidv4();
    await db.execute(`
      INSERT INTO projection_snapshots (id, aggregate_type, aggregate_id, snapshot_version, state_json, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [snapshotId, aggregateType, aggregateId, snapshotVersion, JSON.stringify(state)]);
    return snapshotId;
  }

  public async getLatestSnapshot<T = any>(
    aggregateType: string,
    aggregateId: string
  ): Promise<AggregateSnapshot<T> | null> {
    const db = this.dbProvider();
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
}
