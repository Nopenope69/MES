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
  PickErrorPayloadSchema,
  ReelUnsealedPayloadSchema,
  ReelDryStorageEnteredPayloadSchema,
  ReelDryStorageExitedPayloadSchema,
  ReelBakeStartedPayloadSchema,
  ReelBakeCompletedPayloadSchema,
  ReelResealedPayloadSchema,
  QualityGateBlockedPayloadSchema,
  QualityGatePassedPayloadSchema,
  PasteRemovedFromColdPayloadSchema,
  PasteThawVerifiedPayloadSchema,
  PasteMixedPayloadSchema,
  PasteAuthorizedPayloadSchema,
  PasteLoadedOnStencilPayloadSchema,
  PasteRemovedFromStencilPayloadSchema,
  PasteDiscardedPayloadSchema,
  StencilSessionStartedPayloadSchema,
  StencilSessionEndedPayloadSchema,
  AoiInspectionCompletedPayloadSchema,
  SpiInspectionCompletedPayloadSchema,
  DefectRecordedPayloadSchema,
  QualityHoldAppliedPayloadSchema,
  QualityDispositionDecidedPayloadSchema,
  ReworkStartedPayloadSchema,
  ComponentReplacedPayloadSchema,
  PostReworkInspectionCompletedPayloadSchema,
  ReworkCompletedPayloadSchema,
  RepeatDefectInterlockTrippedPayloadSchema,
  PanelScrappedPayloadSchema,
  SpiInspectionRecordedPayloadSchema,
  PrinterCleaningCommandedPayloadSchema,
  PrinterParametersModifiedPayloadSchema,
  PrinterCommandAcknowledgedPayloadSchema,
  ClosedLoopCorrectionVerifiedPayloadSchema,
  PreReflowPanelDivertedPayloadSchema
} from '@mes/shared';
import { getDatabase, IDatabase } from '../db/database';
import { IEventProjector } from './projectors/projector.interface';
import { CoreProjector } from './projectors/core.projector';
import { SmtProjector } from './projectors/smt.projector';
import { AoiProjector } from './projectors/aoi.projector';
import { SpiProjector } from './projectors/spi.projector';
import { EventUpcasterService } from './event-upcaster.service';

export class EventIngestionService {
  private static projectors: IEventProjector[] = [
    new CoreProjector(),
    new SmtProjector(),
    new AoiProjector(),
    new SpiProjector()
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
      schemaVersion: rawEnvelope.schemaVersion || '1.0.0',
      payload: rawEnvelope.payload || {}
    };

    // 1. Validate envelope structure
    const validatedEnvelope = MesEventEnvelopeSchema.parse(envelope);

    // Track A: Idempotency Gate (Skip duplicate event ingestion without re-projecting)
    const existing = await db.query<{ id: string }>(
      'SELECT id FROM production_events WHERE event_id = ?',
      [validatedEnvelope.eventId]
    );
    if (existing.length > 0) {
      return {
        success: true,
        eventId: validatedEnvelope.eventId,
        message: `Event [${validatedEnvelope.eventId}] already processed (idempotent duplicate skipped).`
      };
    }

    // Track A: Event Upcaster (Transforms legacy event schemas to current version)
    const upcastedEnvelope = EventUpcasterService.upcast(validatedEnvelope);

    // 2. Validate payload based on event type
    switch (upcastedEnvelope.eventType) {
      case 'BATCH_STARTED':
        BatchStartedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'STATE_CHANGED':
        StateChangedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'DOWNTIME_RECORDED':
        DowntimeRecordedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'MATERIAL_CONSUMED':
        MaterialConsumedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'REEL_SPLICED':
        ReelSplicedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'PANEL_CHECKOUT':
        PanelCheckoutPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'PICK_ERROR_RECORDED':
        PickErrorPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'OUTPUT_RECORDED':
        OutputRecordedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'BATCH_COMPLETED':
        BatchCompletedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'REEL_UNSEALED':
        ReelUnsealedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'REEL_DRY_STORAGE_ENTERED':
        ReelDryStorageEnteredPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'REEL_DRY_STORAGE_EXITED':
        ReelDryStorageExitedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'REEL_BAKE_STARTED':
        ReelBakeStartedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'REEL_BAKE_COMPLETED':
        ReelBakeCompletedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'REEL_RESEALED':
        ReelResealedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'QUALITY_GATE_BLOCKED':
        QualityGateBlockedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'QUALITY_GATE_PASSED':
        QualityGatePassedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'PASTE_REMOVED_FROM_COLD':
        PasteRemovedFromColdPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'PASTE_THAW_VERIFIED':
        PasteThawVerifiedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'PASTE_MIXED':
        PasteMixedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'PASTE_AUTHORIZED':
        PasteAuthorizedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'PASTE_LOADED_ON_STENCIL':
        PasteLoadedOnStencilPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'PASTE_REMOVED_FROM_STENCIL':
        PasteRemovedFromStencilPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'PASTE_DISCARDED':
        PasteDiscardedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'STENCIL_SESSION_STARTED':
        StencilSessionStartedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'STENCIL_SESSION_ENDED':
        StencilSessionEndedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'AOI_INSPECTION_COMPLETED':
        AoiInspectionCompletedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'SPI_INSPECTION_COMPLETED':
        SpiInspectionCompletedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'DEFECT_RECORDED':
        DefectRecordedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'QUALITY_HOLD_APPLIED':
        QualityHoldAppliedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'QUALITY_DISPOSITION_DECIDED':
        QualityDispositionDecidedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'REWORK_STARTED':
        ReworkStartedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'COMPONENT_REPLACED':
        ComponentReplacedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'POST_REWORK_INSPECTION_COMPLETED':
        PostReworkInspectionCompletedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'REWORK_COMPLETED':
        ReworkCompletedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'REPEAT_DEFECT_INTERLOCK_TRIPPED':
        RepeatDefectInterlockTrippedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'PANEL_SCRAPPED':
        PanelScrappedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'SPI_INSPECTION_RECORDED':
        SpiInspectionRecordedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'PRINTER_CLEANING_COMMANDED':
        PrinterCleaningCommandedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'PRINTER_PARAMETERS_MODIFIED':
        PrinterParametersModifiedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'PRINTER_COMMAND_ACKNOWLEDGED':
        PrinterCommandAcknowledgedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'CLOSED_LOOP_CORRECTION_VERIFIED':
        ClosedLoopCorrectionVerifiedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
      case 'PRE_REFLOW_PANEL_DIVERTED':
        PreReflowPanelDivertedPayloadSchema.parse(upcastedEnvelope.payload);
        break;
    }

    // 3. Atomically write to Event Log (Tier 2) and execute State Projections (Tier 3)
    await db.withTransaction(async (tx: IDatabase) => {
      // Append to immutable Event Log
      await tx.execute(`
        INSERT INTO production_events (
          id, event_id, event_type, schema_version, event_time, received_time, source_type,
          source_id, sequence_id, site_id, work_center_id, asset_path, ingress_event_id, batch_id,
          work_order_id, operator_id, correlation_id, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        uuidv4(),
        upcastedEnvelope.eventId,
        upcastedEnvelope.eventType,
        upcastedEnvelope.schemaVersion || '1.0.0',
        upcastedEnvelope.eventTime,
        upcastedEnvelope.receivedTime,
        upcastedEnvelope.sourceType,
        upcastedEnvelope.sourceId,
        upcastedEnvelope.sequenceId ?? null,
        upcastedEnvelope.siteId,
        upcastedEnvelope.workCenterId,
        upcastedEnvelope.assetPath ?? null,
        upcastedEnvelope.ingressEventId ?? null,
        upcastedEnvelope.batchId ?? null,
        upcastedEnvelope.workOrderId ?? null,
        upcastedEnvelope.operatorId ?? null,
        upcastedEnvelope.correlationId ?? null,
        JSON.stringify(upcastedEnvelope.payload)
      ]);

      // Project state changes to query read models across registered projectors
      for (const projector of EventIngestionService.projectors) {
        if (projector.supports(upcastedEnvelope.eventType)) {
          await projector.project(upcastedEnvelope, tx);

          // Track A: Update High-Water Mark Projection Checkpoint
          await tx.execute(`
            INSERT INTO projection_checkpoints (projection_name, last_event_id, last_event_time, events_processed, updated_at)
            VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
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
      eventId: upcastedEnvelope.eventId,
      message: `Event [${upcastedEnvelope.eventType}] successfully ingested and projected atomically.`
    };
  }
}
