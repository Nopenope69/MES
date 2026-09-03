import { MesEventEnvelope, MesEventType } from '@mes/shared';
import { v4 as uuidv4 } from 'uuid';
import { IDatabase } from '../../db/database';
import { IEventProjector } from './projector.interface';

/**
 * Core MES Projector.
 * Handles generic ISA-95 state models: Batches, Work Orders, Operations, Downtime, and Asset States.
 */
export class CoreProjector implements IEventProjector {
  readonly name = 'CoreMesProjector';

  private static readonly SUPPORTED_EVENTS: Set<MesEventType> = new Set<MesEventType>([
    'BATCH_STARTED',
    'BATCH_COMPLETED',
    'OPERATION_STARTED',
    'OPERATION_COMPLETED',
    'MATERIAL_CONSUMED',
    'OUTPUT_RECORDED',
    'DOWNTIME_RECORDED',
    'STATE_CHANGED'
  ]);

  supports(eventType: MesEventType): boolean {
    return CoreProjector.SUPPORTED_EVENTS.has(eventType);
  }

  async project(event: MesEventEnvelope, tx: IDatabase): Promise<void> {
    const eventTime = event.eventTime;

    switch (event.eventType) {
      case 'BATCH_STARTED': {
        const payload = event.payload;
        const batchId = event.batchId || uuidv4();

        const existing = await tx.query('SELECT id FROM batches WHERE batch_number = ?', [payload.batchNumber]);
        if (existing.length === 0) {
          await tx.execute(`
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
          await tx.execute(`
            UPDATE batches 
            SET status = 'RUNNING', started_at = ?, operator_id = ?
            WHERE id = ?
          `, [eventTime, event.operatorId ?? null, existing[0].id]);
        }

        await tx.execute(`
          UPDATE work_centers 
          SET current_program_name = ?
          WHERE id = ?
        `, [payload.recipeCode, event.workCenterId]);

        await this.handleStateTransition(tx, event.workCenterId, 'RUNNING', batchId, eventTime);
        break;
      }

      case 'BATCH_COMPLETED': {
        const payload = event.payload;
        const finalStatus = payload.disposition === 'REJECTED' ? 'REJECTED' : 'COMPLETED';

        if (event.batchId) {
          await tx.execute(`
            UPDATE batches 
            SET status = ?, completed_at = ?,
                actual_quantity = COALESCE(?, actual_quantity),
                rejected_quantity = COALESCE(?, rejected_quantity)
            WHERE id = ? OR batch_number = ?
          `, [finalStatus, eventTime, payload.totalGoodQuantity, payload.totalRejectedQuantity, event.batchId, event.batchId]);
        }

        await this.handleStateTransition(tx, event.workCenterId, 'IDLE', undefined, eventTime);
        await tx.execute(`
          UPDATE work_centers 
          SET current_batch_id = NULL
          WHERE id = ?
        `, [event.workCenterId]);
        break;
      }

      case 'OPERATION_STARTED': {
        const payload = event.payload;
        await this.handleStateTransition(tx, event.workCenterId, 'RUNNING', event.batchId, eventTime);
        break;
      }

      case 'OPERATION_COMPLETED': {
        const payload = event.payload;
        await this.handleStateTransition(tx, event.workCenterId, 'IDLE', event.batchId, eventTime);
        break;
      }

      case 'STATE_CHANGED': {
        const payload = event.payload;
        await this.handleStateTransition(
          tx,
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
        await tx.execute(`
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
        await tx.execute(`
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
          await tx.execute(`
            UPDATE batches 
            SET actual_quantity = actual_quantity + ?,
                rejected_quantity = rejected_quantity + ?
            WHERE id = ? OR batch_number = ?
          `, [payload.goodQuantity, payload.rejectedQuantity, event.batchId, event.batchId]);
        }
        break;
      }
    }
  }

  private async handleStateTransition(
    tx: IDatabase,
    workCenterId: string,
    nextState: string,
    batchId?: string,
    timestamp?: string,
    reasonCategory?: string,
    reasonCode?: string,
    comment?: string,
    operatorId?: string
  ): Promise<void> {
    const now = timestamp || new Date().toISOString();

    const wcRows = await tx.query('SELECT current_state, current_batch_id FROM work_centers WHERE id = ?', [workCenterId]);
    const prevState = wcRows.length > 0 ? wcRows[0].current_state : 'IDLE';
    const effectiveBatchId = batchId || (wcRows.length > 0 ? wcRows[0].current_batch_id : null);

    const openLogs = await tx.query(
      'SELECT id, started_at FROM equipment_state_logs WHERE work_center_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
      [workCenterId]
    );

    if (openLogs.length > 0) {
      const openLog = openLogs[0];
      const startMs = new Date(openLog.started_at).getTime();
      const endMs = new Date(now).getTime();
      const durationSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));

      await tx.execute(`
        UPDATE equipment_state_logs 
        SET ended_at = ?, duration_seconds = ?
        WHERE id = ?
      `, [now, durationSeconds, openLog.id]);
    }

    const newLogId = uuidv4();
    await tx.execute(`
      INSERT INTO equipment_state_logs (
        id, work_center_id, batch_id, previous_state, current_state, started_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [newLogId, workCenterId, effectiveBatchId, prevState, nextState, now]);

    if (reasonCode || reasonCategory) {
      await tx.execute(`
        INSERT INTO downtime_attributions (
          id, state_log_id, work_center_id, batch_id, reason_category, reason_code, comment, operator_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        uuidv4(),
        newLogId,
        workCenterId,
        effectiveBatchId,
        reasonCategory || 'UNPLANNED_STOPPAGE',
        reasonCode || 'GENERIC_STOPPAGE',
        comment ?? '',
        operatorId ?? null,
        now
      ]);
    }

    await tx.execute(`
      UPDATE work_centers 
      SET current_state = ?,
          current_batch_id = COALESCE(?, current_batch_id),
          current_operator_id = COALESCE(?, current_operator_id),
          last_state_change_time = ?
      WHERE id = ?
    `, [nextState, effectiveBatchId, operatorId ?? null, now, workCenterId]);
  }
}
