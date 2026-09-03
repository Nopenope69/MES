import { v4 as uuidv4 } from 'uuid';
import {
  MesEventEnvelope,
  MesEventEnvelopeSchema,
  BatchStartedPayloadSchema,
  StateChangedPayloadSchema,
  DowntimeRecordedPayloadSchema,
  MaterialConsumedPayloadSchema,
  OutputRecordedPayloadSchema,
  BatchCompletedPayloadSchema,
  PanelCheckoutPayloadSchema,
  ReelSplicedPayloadSchema,
  PickErrorPayloadSchema
} from '@mes/shared';
import { getDatabase, IDatabase } from '../db/database';
import { IEventProjector } from './projectors/projector.interface';
import { CoreProjector } from './projectors/core.projector';
import { SmtProjector } from './projectors/smt.projector';

export class EventIngestionService {
  private static projectors: IEventProjector[] = [
    new CoreProjector(),
    new SmtProjector()
  ];

  /**
   * Register an additional vertical pack projector (e.g. Pharma, Chemicals, F&B).
   */
  public static registerProjector(projector: IEventProjector): void {
    this.projectors.push(projector);
  }

  /**
   * Primary ingestion gateway.
   * Validates, saves to immutable event log, and projects state inside an atomic transaction.
   * If any projection fails, the entire transaction rolls back cleanly.
   */
  public static async ingest(rawEnvelope: Partial<MesEventEnvelope>): Promise<{ success: boolean; eventId: string; message: string }> {
    const db = getDatabase();
    const now = new Date().toISOString();

    let assetPath = rawEnvelope.assetPath;
    let batchId = rawEnvelope.batchId;
    if (rawEnvelope.workCenterId) {
      const wc = await db.query('SELECT asset_path, current_batch_id FROM work_centers WHERE id = ?', [rawEnvelope.workCenterId]);
      if (wc.length > 0) {
        if (!assetPath && wc[0].asset_path) assetPath = wc[0].asset_path;
        if (!batchId && rawEnvelope.eventType !== 'BATCH_STARTED' && wc[0].current_batch_id) {
          batchId = wc[0].current_batch_id;
        }
      }
    }

    const envelope: MesEventEnvelope = {
      eventId: rawEnvelope.eventId || uuidv4(),
      eventType: rawEnvelope.eventType!,
      eventTime: rawEnvelope.eventTime || now,
      receivedTime: now,
      sourceType: rawEnvelope.sourceType || 'MANUAL_UI',
      sourceId: rawEnvelope.sourceId || 'system-ui',
      siteId: rawEnvelope.siteId || 'SITE-NOIDA-P4',
      workCenterId: rawEnvelope.workCenterId!,
      assetPath,
      ingressEventId: rawEnvelope.ingressEventId,
      batchId,
      workOrderId: rawEnvelope.workOrderId,
      operatorId: rawEnvelope.operatorId,
      sequenceId: rawEnvelope.sequenceId,
      correlationId: rawEnvelope.correlationId,
      payload: rawEnvelope.payload || {}
    };

    // 1. Validate envelope structure
    const validatedEnvelope = MesEventEnvelopeSchema.parse(envelope);

    // 2. Validate payload based on event type
    switch (validatedEnvelope.eventType) {
      case 'BATCH_STARTED':
        BatchStartedPayloadSchema.parse(validatedEnvelope.payload);
        break;
      case 'STATE_CHANGED':
        StateChangedPayloadSchema.parse(validatedEnvelope.payload);
        break;
      case 'DOWNTIME_RECORDED':
        DowntimeRecordedPayloadSchema.parse(validatedEnvelope.payload);
        break;
      case 'MATERIAL_CONSUMED':
        MaterialConsumedPayloadSchema.parse(validatedEnvelope.payload);
        break;
      case 'REEL_SPLICED':
        ReelSplicedPayloadSchema.parse(validatedEnvelope.payload);
        break;
      case 'PANEL_CHECKOUT':
        PanelCheckoutPayloadSchema.parse(validatedEnvelope.payload);
        break;
      case 'PICK_ERROR_RECORDED':
        PickErrorPayloadSchema.parse(validatedEnvelope.payload);
        break;
      case 'OUTPUT_RECORDED':
        OutputRecordedPayloadSchema.parse(validatedEnvelope.payload);
        break;
      case 'BATCH_COMPLETED':
        BatchCompletedPayloadSchema.parse(validatedEnvelope.payload);
        break;
    }

    // 3. Atomically write to Event Log (Tier 2) and execute State Projections (Tier 3)
    await db.withTransaction(async (tx: IDatabase) => {
      // Append to immutable Event Log
      await tx.execute(`
        INSERT INTO production_events (
          id, event_id, event_type, event_time, received_time, source_type,
          source_id, sequence_id, site_id, work_center_id, asset_path, ingress_event_id, batch_id,
          work_order_id, operator_id, correlation_id, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        uuidv4(),
        validatedEnvelope.eventId,
        validatedEnvelope.eventType,
        validatedEnvelope.eventTime,
        validatedEnvelope.receivedTime,
        validatedEnvelope.sourceType,
        validatedEnvelope.sourceId,
        validatedEnvelope.sequenceId ?? null,
        validatedEnvelope.siteId,
        validatedEnvelope.workCenterId,
        validatedEnvelope.assetPath ?? null,
        validatedEnvelope.ingressEventId ?? null,
        validatedEnvelope.batchId ?? null,
        validatedEnvelope.workOrderId ?? null,
        validatedEnvelope.operatorId ?? null,
        validatedEnvelope.correlationId ?? null,
        JSON.stringify(validatedEnvelope.payload)
      ]);

      // Project state changes to query read models across registered projectors
      for (const projector of EventIngestionService.projectors) {
        if (projector.supports(validatedEnvelope.eventType)) {
          await projector.project(validatedEnvelope, tx);
        }
      }
    });

    return {
      success: true,
      eventId: validatedEnvelope.eventId,
      message: `Event [${validatedEnvelope.eventType}] successfully ingested and projected atomically.`
    };
  }
}
