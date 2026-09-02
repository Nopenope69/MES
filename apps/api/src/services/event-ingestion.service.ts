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
import { getDatabase } from '../db/database';

export class EventIngestionService {
  /**
   * Primary ingestion gateway.
   * Validates, saves to immutable event log, and projects state in a single transaction flow.
   */
  public static async ingest(rawEnvelope: Partial<MesEventEnvelope>): Promise<{ success: boolean; eventId: string; message: string }> {
    const db = getDatabase();
    const now = new Date().toISOString();

    let assetPath = rawEnvelope.assetPath;
    if (!assetPath && rawEnvelope.workCenterId) {
      const wc = await db.query('SELECT asset_path FROM work_centers WHERE id = ?', [rawEnvelope.workCenterId]);
      if (wc.length > 0 && wc[0].asset_path) {
        assetPath = wc[0].asset_path;
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
      batchId: rawEnvelope.batchId,
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

    // 3. Append to immutable Event Log (Tier 2 Canonical Event Store)
    await db.execute(`
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

    // 4. Project state changes to query tables (Tier 3 Read Model Projections)
    await this.projectState(validatedEnvelope);

    return {
      success: true,
      eventId: validatedEnvelope.eventId,
      message: `Event [${validatedEnvelope.eventType}] successfully ingested and projected.`
    };
  }

  private static async projectState(event: MesEventEnvelope): Promise<void> {
    const db = getDatabase();
    const eventTime = event.eventTime;

    switch (event.eventType) {
      case 'BATCH_STARTED': {
        const payload = event.payload;
        const batchId = event.batchId || uuidv4();

        const existing = await db.query('SELECT id FROM batches WHERE batch_number = ?', [payload.batchNumber]);
        if (existing.length === 0) {
          await db.execute(`
            INSERT INTO batches (
              id, batch_number, work_order_number, product_code, recipe_code,
              work_center_id, status, planned_quantity, unit, started_at, operator_id
            ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', ?, ?, ?, ?)
          `, [
            batchId,
            payload.batchNumber,
            payload.workOrderNumber,
            payload.productCode,
            payload.recipeCode,
            event.workCenterId,
            payload.plannedQuantity,
            payload.unit || 'PANEL',
            eventTime,
            event.operatorId ?? null
          ]);
        } else {
          await db.execute(`
            UPDATE batches 
            SET status = 'RUNNING', started_at = ?, operator_id = ?
            WHERE id = ?
          `, [eventTime, event.operatorId ?? null, existing[0].id]);
        }

        await db.execute(`
          UPDATE work_centers 
          SET current_program_name = ?
          WHERE id = ?
        `, [payload.recipeCode, event.workCenterId]);

        await this.handleStateTransition(event.workCenterId, 'RUNNING', batchId, eventTime);
        break;
      }

      case 'PANEL_CHECKOUT': {
        const payload = event.payload;
        const effectiveBatchId = event.batchId || 'ACTIVE-JOB';

        await db.execute(`
          INSERT INTO panel_checkouts (
            id, panel_barcode, work_center_id, batch_id, program_name,
            cycle_time_seconds, block_count, block_skip_count, skip_bitmask, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          uuidv4(),
          payload.panelBarcode,
          event.workCenterId,
          effectiveBatchId,
          payload.programName,
          payload.cycleTimeSeconds,
          payload.blockCount,
          payload.blockSkipCount,
          payload.skipBitmask ?? null,
          eventTime
        ]);

        // Increment active batch output
        if (event.batchId) {
          await db.execute(`
            UPDATE batches 
            SET actual_quantity = actual_quantity + 1,
                rejected_quantity = rejected_quantity + ?
            WHERE id = ? OR batch_number = ?
          `, [payload.blockSkipCount > 0 ? 1 : 0, event.batchId, event.batchId]);
        }
        break;
      }

      case 'REEL_SPLICED': {
        const payload = event.payload;
        const effectiveBatchId = event.batchId || 'ACTIVE-JOB';

        // Update feeder slot with new reel
        await db.execute(`
          UPDATE smt_feeder_slots 
          SET current_reel_id = ?, status = 'OK'
          WHERE work_center_id = ? AND slot_no = ? AND module_no = ?
        `, [payload.newReelId, event.workCenterId, payload.slotNo, payload.moduleNo]);

        // Record material genealogy consumption
        await db.execute(`
          INSERT INTO material_consumptions (
            id, batch_id, material_lot_number, material_code,
            material_name, quantity_consumed, unit, container_id,
            operator_id, consumed_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'PCS', ?, ?, ?)
        `, [
          uuidv4(),
          effectiveBatchId,
          payload.newReelId,
          payload.partNumber,
          payload.partNumber,
          payload.newReelQuantity,
          `Feeder ${payload.feederId} (Slot ${payload.slotNo})`,
          event.operatorId ?? null,
          eventTime
        ]);
        break;
      }

      case 'PICK_ERROR_RECORDED': {
        const payload = event.payload;
        await db.execute(`
          INSERT INTO feeder_error_logs (
            id, work_center_id, module_no, slot_no, feeder_id, part_number, nozzle_id, error_type, occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          uuidv4(),
          event.workCenterId,
          payload.moduleNo,
          payload.slotNo,
          payload.feederId,
          payload.partNumber,
          payload.nozzleId ?? 'NOZZLE-01',
          payload.errorType,
          eventTime
        ]);
        break;
      }

      case 'STATE_CHANGED': {
        const payload = event.payload;
        await this.handleStateTransition(
          event.workCenterId,
          payload.currentState,
          event.batchId,
          eventTime,
          payload.reasonCategory,
          payload.reasonCode,
          payload.comment,
          event.operatorId
        );
        break;
      }

      case 'DOWNTIME_RECORDED': {
        const payload = event.payload;
        await db.execute(`
          INSERT INTO downtime_attributions (
            id, state_log_id, work_center_id, batch_id,
            reason_category, reason_code, comment, operator_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          uuidv4(),
          payload.stateLogId || 'manual-entry',
          event.workCenterId,
          event.batchId ?? null,
          payload.reasonCategory,
          payload.reasonCode,
          payload.comment ?? '',
          event.operatorId ?? null,
          eventTime
        ]);
        break;
      }

      case 'MATERIAL_CONSUMED': {
        const payload = event.payload;
        await db.execute(`
          INSERT INTO material_consumptions (
            id, batch_id, material_lot_number, material_code,
            material_name, quantity_consumed, unit, container_id,
            operator_id, consumed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          uuidv4(),
          event.batchId || 'UNASSIGNED',
          payload.materialLotNumber,
          payload.materialCode,
          payload.materialName || payload.materialCode,
          payload.quantityConsumed,
          payload.unit || 'PCS',
          payload.containerOrDrumId ?? null,
          event.operatorId ?? null,
          eventTime
        ]);
        break;
      }

      case 'OUTPUT_RECORDED': {
        const payload = event.payload;
        if (event.batchId) {
          await db.execute(`
            UPDATE batches 
            SET actual_quantity = actual_quantity + ?,
                rejected_quantity = rejected_quantity + ?
            WHERE id = ? OR batch_number = ?
          `, [payload.goodQuantity, payload.rejectedQuantity, event.batchId, event.batchId]);
        }
        break;
      }

      case 'BATCH_COMPLETED': {
        const payload = event.payload;
        const finalStatus = payload.finalStatus === 'TERMINATED_EARLY' ? 'QUARANTINED' : 'COMPLETED';

        if (event.batchId) {
          await db.execute(`
            UPDATE batches 
            SET status = ?, completed_at = ?,
                actual_quantity = COALESCE(?, actual_quantity),
                rejected_quantity = COALESCE(?, rejected_quantity)
            WHERE id = ? OR batch_number = ?
          `, [finalStatus, eventTime, payload.totalGoodQuantity, payload.totalRejectedQuantity, event.batchId, event.batchId]);
        }

        await this.handleStateTransition(event.workCenterId, 'IDLE', undefined, eventTime);
        await db.execute(`
          UPDATE work_centers 
          SET current_batch_id = NULL
          WHERE id = ?
        `, [event.workCenterId]);
        break;
      }
    }
  }

  private static async handleStateTransition(
    workCenterId: string,
    nextState: string,
    batchId?: string,
    timestamp?: string,
    reasonCategory?: string,
    reasonCode?: string,
    comment?: string,
    operatorId?: string
  ): Promise<void> {
    const db = getDatabase();
    const now = timestamp || new Date().toISOString();

    const wcRows = await db.query('SELECT current_state, current_batch_id FROM work_centers WHERE id = ?', [workCenterId]);
    const prevState = wcRows.length > 0 ? wcRows[0].current_state : 'IDLE';
    const effectiveBatchId = batchId || (wcRows.length > 0 ? wcRows[0].current_batch_id : null);

    const openLogs = await db.query(
      'SELECT id, started_at FROM equipment_state_logs WHERE work_center_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
      [workCenterId]
    );

    if (openLogs.length > 0) {
      const openLog = openLogs[0];
      const startMs = new Date(openLog.started_at).getTime();
      const endMs = new Date(now).getTime();
      const durationSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));

      await db.execute(`
        UPDATE equipment_state_logs 
        SET ended_at = ?, duration_seconds = ?
        WHERE id = ?
      `, [now, durationSeconds, openLog.id]);
    }

    const newLogId = uuidv4();
    await db.execute(`
      INSERT INTO equipment_state_logs (
        id, work_center_id, batch_id, previous_state, current_state, started_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [newLogId, workCenterId, effectiveBatchId, prevState, nextState, now]);

    if (reasonCode || reasonCategory) {
      await db.execute(`
        INSERT INTO downtime_attributions (
          id, state_log_id, work_center_id, batch_id,
          reason_category, reason_code, comment, operator_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        uuidv4(),
        newLogId,
        workCenterId,
        effectiveBatchId,
        reasonCategory || 'OTHER',
        reasonCode || 'UNSPECIFIED',
        comment ?? null,
        operatorId ?? null,
        now
      ]);
    }

    await db.execute(`
      UPDATE work_centers 
      SET current_state = ?, 
          current_batch_id = COALESCE(?, current_batch_id),
          current_operator_id = COALESCE(?, current_operator_id),
          last_state_change_time = ?
      WHERE id = ?
    `, [nextState, batchId ?? null, operatorId ?? null, now, workCenterId]);
  }
}
