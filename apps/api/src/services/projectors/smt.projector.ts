import { MesEventEnvelope, MesEventType } from '@mes/shared';
import { v4 as uuidv4 } from 'uuid';
import { IDatabase } from '../../db/database';
import { IEventProjector } from './projector.interface';

/**
 * SMT Vertical Pack Projector.
 * Handles high-speed SMT assembly line domain projections:
 * Component reels, feeder cassette slots, board checkins/checkouts, and optical pick errors.
 */
export class SmtProjector implements IEventProjector {
  readonly name = 'SmtVerticalProjector';

  private static readonly SUPPORTED_EVENTS: Set<MesEventType> = new Set<MesEventType>([
    'PANEL_CHECKIN',
    'PANEL_CHECKOUT',
    'REEL_SPLICED',
    'PICK_ERROR_RECORDED'
  ]);

  supports(eventType: MesEventType): boolean {
    return SmtProjector.SUPPORTED_EVENTS.has(eventType);
  }

  async project(event: MesEventEnvelope, tx: IDatabase): Promise<void> {
    const eventTime = event.eventTime;

    switch (event.eventType) {
      case 'PANEL_CHECKIN': {
        // Log board arrival into machine stage
        break;
      }

      case 'PANEL_CHECKOUT': {
        const payload = event.payload;
        const effectiveBatchId = event.batchId || 'ACTIVE-JOB';

        await tx.execute(`
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
          await tx.execute(`
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
        const newQty = Number(payload.newReelQuantity) || 10000;

        // 1. Ensure the spliced reel exists in component_reels inventory
        const existingReels = await tx.query(
          'SELECT id FROM component_reels WHERE reel_id = ?',
          [payload.newReelId]
        );

        if (existingReels.length === 0) {
          await tx.execute(`
            INSERT INTO component_reels (
              id, reel_id, part_number, part_name, supplier_name,
              lot_number, date_code, initial_quantity, current_quantity,
              status, msl_level, msl_remaining_minutes
            ) VALUES (?, ?, ?, ?, 'Approved Vendor', 'LOT-SPLICED', '2635', ?, ?, 'MOUNTED', 1, 999999)
          `, [
            uuidv4(),
            payload.newReelId,
            payload.partNumber,
            `${payload.partNumber} SMT Reel`,
            newQty,
            newQty
          ]);
        } else {
          await tx.execute(`
            UPDATE component_reels 
            SET current_quantity = ?, status = 'MOUNTED'
            WHERE reel_id = ?
          `, [newQty, payload.newReelId]);
        }

        // 2. Update feeder slot with new reel
        await tx.execute(`
          UPDATE smt_feeder_slots 
          SET current_reel_id = ?, status = 'OK'
          WHERE work_center_id = ? AND slot_no = ? AND module_no = ?
        `, [payload.newReelId, event.workCenterId, payload.slotNo, payload.moduleNo || 1]);

        // 3. Record material genealogy consumption
        await tx.execute(`
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
          newQty,
          `Feeder ${payload.feederId} (Slot ${payload.slotNo})`,
          event.operatorId ?? null,
          eventTime
        ]);
        break;
      }

      case 'PICK_ERROR_RECORDED': {
        const payload = event.payload;
        await tx.execute(`
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
    }
  }
}
