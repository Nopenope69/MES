import { MesEventEnvelope, MesEventType } from '@mes/shared';
import { v4 as uuidv4 } from 'uuid';
import { IDatabase } from '../../db/database';
import { IEventProjector } from './projector.interface';

/**
 * SMT Vertical Pack Projector (Phase 2 Quality-Enforcing Engine).
 * Handles:
 * - High-speed placement: Panel checkins/checkouts, reel splicing, pick errors.
 * - JEDEC J-STD-033D MSL Floor-Life lifecycle projections (exposure logs, dry storage, bake resets).
 * - Solder Paste & Stencil lifecycle projections (thaw, mixing, stencil loads, sessions).
 */
export class SmtProjector implements IEventProjector {
  readonly name = 'SmtVerticalProjector';

  private static readonly SUPPORTED_EVENTS: Set<MesEventType> = new Set<MesEventType>([
    'PANEL_CHECKIN',
    'PANEL_CHECKOUT',
    'REEL_SPLICED',
    'PICK_ERROR_RECORDED',
    'REEL_UNSEALED',
    'REEL_DRY_STORAGE_ENTERED',
    'REEL_DRY_STORAGE_EXITED',
    'REEL_BAKE_STARTED',
    'REEL_BAKE_COMPLETED',
    'REEL_RESEALED',
    'PASTE_REMOVED_FROM_COLD',
    'PASTE_THAW_VERIFIED',
    'PASTE_MIXED',
    'PASTE_AUTHORIZED',
    'PASTE_LOADED_ON_STENCIL',
    'PASTE_REMOVED_FROM_STENCIL',
    'PASTE_DISCARDED',
    'STENCIL_SESSION_STARTED',
    'STENCIL_SESSION_ENDED'
  ]);

  supports(eventType: MesEventType): boolean {
    return SmtProjector.SUPPORTED_EVENTS.has(eventType);
  }

  async project(event: MesEventEnvelope, tx: IDatabase): Promise<void> {
    const eventTime = event.eventTime;

    switch (event.eventType) {
      case 'PANEL_CHECKIN': {
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

        const existingReels = await tx.query(
          'SELECT id FROM component_reels WHERE reel_id = ?',
          [payload.newReelId]
        );

        if (existingReels.length === 0) {
          await tx.execute(`
            INSERT INTO component_reels (
              id, reel_id, part_number, part_name, supplier_name,
              lot_number, date_code, initial_quantity, current_quantity,
              status, msl_level, msl_class, msl_remaining_minutes, floor_clock_state
            ) VALUES (?, ?, ?, ?, 'Approved Vendor', 'LOT-SPLICED', '2635', ?, ?, 'MOUNTED', 1, 'MSL_1', 999999, 'FLOOR_EXPOSURE')
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

        await tx.execute(`
          UPDATE smt_feeder_slots 
          SET current_reel_id = ?, status = 'OK'
          WHERE work_center_id = ? AND slot_no = ? AND module_no = ?
        `, [payload.newReelId, event.workCenterId, payload.slotNo, payload.moduleNo || 1]);

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

      // ======================================================================
      // PHASE 2B: MSL LIFECYCLE PROJECTIONS (JEDEC J-STD-033D)
      // ======================================================================
      case 'REEL_UNSEALED': {
        const payload = event.payload;
        await tx.execute(`
          UPDATE component_reels 
          SET mbb_opened_at = ?,
              storage_state = 'AMBIENT_EXPOSURE',
              floor_clock_state = 'FLOOR_EXPOSURE',
              floor_life_nominal_minutes = ?,
              hic_status = ?,
              hic_verified_at = ?,
              hic_verified_by = ?,
              status = 'READY'
          WHERE reel_id = ?
        `, [
          eventTime,
          payload.nominalFloorLifeMinutes,
          payload.hicStatus || 'OK',
          eventTime,
          event.operatorId ?? null,
          payload.reelId
        ]);

        await tx.execute(`
          INSERT INTO msl_exposure_logs (
            id, reel_id, state, started_at, source_event_id
          ) VALUES (?, ?, 'AMBIENT_EXPOSURE', ?, ?)
        `, [uuidv4(), payload.reelId, eventTime, event.eventId]);
        break;
      }

      case 'REEL_DRY_STORAGE_ENTERED': {
        const payload = event.payload;
        // Close open ambient exposure interval
        const openLogs = await tx.query<any>(
          `SELECT id, started_at FROM msl_exposure_logs 
           WHERE reel_id = ? AND state = 'AMBIENT_EXPOSURE' AND ended_at IS NULL`,
          [payload.reelId]
        );

        if (openLogs.length > 0) {
          const log = openLogs[0];
          const dur = Math.max(0, Math.floor((new Date(eventTime).getTime() - new Date(log.started_at).getTime()) / 1000));
          await tx.execute(`
            UPDATE msl_exposure_logs 
            SET ended_at = ?, duration_seconds = ? 
            WHERE id = ?
          `, [eventTime, dur, log.id]);
        }

        // Open dry storage interval
        await tx.execute(`
          INSERT INTO msl_exposure_logs (
            id, reel_id, state, started_at, cabinet_id, source_event_id
          ) VALUES (?, ?, 'DRY_STORAGE', ?, ?, ?)
        `, [uuidv4(), payload.reelId, eventTime, payload.cabinetId, event.eventId]);

        await tx.execute(`
          UPDATE component_reels 
          SET storage_state = 'DRY_STORAGE',
              floor_clock_state = 'DRY_STORAGE',
              storage_location = ?
          WHERE reel_id = ?
        `, [payload.cabinetId, payload.reelId]);
        break;
      }

      case 'REEL_DRY_STORAGE_EXITED': {
        const payload = event.payload;
        // Close dry storage interval
        const openLogs = await tx.query<any>(
          `SELECT id, started_at FROM msl_exposure_logs 
           WHERE reel_id = ? AND state = 'DRY_STORAGE' AND ended_at IS NULL`,
          [payload.reelId]
        );

        if (openLogs.length > 0) {
          const log = openLogs[0];
          const dur = Math.max(0, Math.floor((new Date(eventTime).getTime() - new Date(log.started_at).getTime()) / 1000));
          await tx.execute(`
            UPDATE msl_exposure_logs 
            SET ended_at = ?, duration_seconds = ? 
            WHERE id = ?
          `, [eventTime, dur, log.id]);
        }

        // Re-open ambient exposure interval
        await tx.execute(`
          INSERT INTO msl_exposure_logs (
            id, reel_id, state, started_at, source_event_id
          ) VALUES (?, ?, 'AMBIENT_EXPOSURE', ?, ?)
        `, [uuidv4(), payload.reelId, eventTime, event.eventId]);

        await tx.execute(`
          UPDATE component_reels 
          SET storage_state = 'AMBIENT_EXPOSURE',
              floor_clock_state = 'FLOOR_EXPOSURE',
              storage_location = 'FACTORY_FLOOR'
          WHERE reel_id = ?
        `, [payload.reelId]);
        break;
      }

      case 'REEL_BAKE_STARTED': {
        const payload = event.payload;
        // Close any open log
        const openLogs = await tx.query<any>(
          `SELECT id, started_at, state FROM msl_exposure_logs 
           WHERE reel_id = ? AND ended_at IS NULL`,
          [payload.reelId]
        );

        for (const log of openLogs) {
          const dur = Math.max(0, Math.floor((new Date(eventTime).getTime() - new Date(log.started_at).getTime()) / 1000));
          await tx.execute(`
            UPDATE msl_exposure_logs 
            SET ended_at = ?, duration_seconds = ? 
            WHERE id = ?
          `, [eventTime, dur, log.id]);
        }

        // Open baking interval
        await tx.execute(`
          INSERT INTO msl_exposure_logs (
            id, reel_id, state, started_at, source_event_id
          ) VALUES (?, ?, 'BAKING', ?, ?)
        `, [uuidv4(), payload.reelId, eventTime, event.eventId]);

        await tx.execute(`
          UPDATE component_reels 
          SET storage_state = 'BAKING',
              floor_clock_state = 'BAKING',
              bake_status = 'IN_PROGRESS',
              bake_started_at = ?,
              last_bake_profile_id = ?
          WHERE reel_id = ?
        `, [eventTime, payload.bakeProfileId, payload.reelId]);
        break;
      }

      case 'REEL_BAKE_COMPLETED': {
        const payload = event.payload;
        // Close baking interval
        const openLogs = await tx.query<any>(
          `SELECT id, started_at FROM msl_exposure_logs 
           WHERE reel_id = ? AND state = 'BAKING' AND ended_at IS NULL`,
          [payload.reelId]
        );

        if (openLogs.length > 0) {
          const log = openLogs[0];
          const dur = Math.max(0, Math.floor((new Date(eventTime).getTime() - new Date(log.started_at).getTime()) / 1000));
          await tx.execute(`
            UPDATE msl_exposure_logs 
            SET ended_at = ?, duration_seconds = ? 
            WHERE id = ?
          `, [eventTime, dur, log.id]);
        }

        if (payload.bakeSufficient) {
          // Reset exposure history upon successful compliant bake
          await tx.execute(`
            DELETE FROM msl_exposure_logs 
            WHERE reel_id = ? AND state = 'AMBIENT_EXPOSURE'
          `, [payload.reelId]);

          await tx.execute(`
            UPDATE component_reels 
            SET storage_state = 'AMBIENT_EXPOSURE',
                floor_clock_state = 'FLOOR_EXPOSURE',
                bake_status = 'COMPLETED_VALID',
                status = 'READY',
                bake_started_at = NULL,
                last_bake_completed_at = ?,
                msl_remaining_minutes = floor_life_nominal_minutes
            WHERE reel_id = ?
          `, [eventTime, payload.reelId]);

          // Re-open fresh exposure log
          await tx.execute(`
            INSERT INTO msl_exposure_logs (
              id, reel_id, state, started_at, source_event_id
            ) VALUES (?, ?, 'AMBIENT_EXPOSURE', ?, ?)
          `, [uuidv4(), payload.reelId, eventTime, event.eventId]);
        } else {
          await tx.execute(`
            UPDATE component_reels 
            SET storage_state = 'AMBIENT_EXPOSURE',
                floor_clock_state = 'BAKE_REQUIRED',
                bake_status = 'FAILED_INSUFFICIENT_DURATION',
                bake_started_at = NULL
            WHERE reel_id = ?
          `, [payload.reelId]);
        }
        break;
      }

      case 'REEL_RESEALED': {
        const payload = event.payload;
        await tx.execute(`
          UPDATE component_reels 
          SET mbb_resealed_at = ?,
              storage_state = 'SEALED_MBB',
              floor_clock_state = 'SEALED'
          WHERE reel_id = ?
        `, [eventTime, payload.reelId]);
        break;
      }

      // ======================================================================
      // PHASE 2D: SOLDER PASTE & STENCIL PROJECTIONS
      // ======================================================================
      case 'PASTE_REMOVED_FROM_COLD': {
        const payload = event.payload;
        await tx.execute(`
          UPDATE solder_paste_jars 
          SET status = 'THAWING',
              removed_from_cold_at = ?
          WHERE jar_id = ?
        `, [eventTime, payload.jarId]);
        break;
      }

      case 'PASTE_THAW_VERIFIED': {
        const payload = event.payload;
        await tx.execute(`
          UPDATE solder_paste_jars 
          SET status = ?,
              thaw_verified_at = ?,
              temperature_verified_at = ?,
              temperature_verified_c = ?
          WHERE jar_id = ?
        `, [
          payload.thawSufficient ? 'THAWED' : 'THAWING',
          eventTime,
          eventTime,
          payload.temperatureVerifiedC,
          payload.jarId
        ]);
        break;
      }

      case 'PASTE_MIXED': {
        const payload = event.payload;
        await tx.execute(`
          UPDATE solder_paste_jars 
          SET status = ?,
              mixed_at = ?,
              mixed_duration_seconds = ?,
              mixing_method = ?
          WHERE jar_id = ?
        `, [
          payload.mixSufficient ? 'MIXED' : 'THAWED',
          eventTime,
          payload.durationSeconds,
          payload.mixingMethod,
          payload.jarId
        ]);
        break;
      }

      case 'PASTE_AUTHORIZED': {
        const payload = event.payload;
        await tx.execute(`
          UPDATE solder_paste_jars 
          SET status = 'AUTHORIZED'
          WHERE jar_id = ?
        `, [payload.jarId]);
        break;
      }

      case 'PASTE_LOADED_ON_STENCIL': {
        const payload = event.payload;
        await tx.execute(`
          UPDATE solder_paste_jars 
          SET status = 'ON_STENCIL',
              current_stencil_session_id = ?
          WHERE jar_id = ?
        `, [payload.stencilSessionId, payload.jarId]);

        await tx.execute(`
          INSERT INTO stencil_paste_loads (
            id, stencil_session_id, paste_jar_id, loaded_at, status
          ) VALUES (?, ?, ?, ?, 'ACTIVE')
        `, [uuidv4(), payload.stencilSessionId, payload.jarId, eventTime]);
        break;
      }

      case 'PASTE_REMOVED_FROM_STENCIL': {
        const payload = event.payload;
        const newStatus = payload.reason === 'EXPIRED_SCRAP' ? 'EXPIRED' : 'DEPLETED';
        await tx.execute(`
          UPDATE solder_paste_jars 
          SET status = ?,
              depleted_at = ?
          WHERE jar_id = ?
        `, [newStatus, eventTime, payload.jarId]);

        await tx.execute(`
          UPDATE stencil_paste_loads 
          SET removed_at = ?, status = ?
          WHERE paste_jar_id = ? AND stencil_session_id = ?
        `, [eventTime, newStatus, payload.jarId, payload.stencilSessionId]);
        break;
      }

      case 'PASTE_DISCARDED': {
        const payload = event.payload;
        await tx.execute(`
          UPDATE solder_paste_jars 
          SET status = 'DISCARDED',
              discarded_at = ?
          WHERE jar_id = ?
        `, [eventTime, payload.jarId]);
        break;
      }

      case 'STENCIL_SESSION_STARTED': {
        const payload = event.payload;
        await tx.execute(`
          INSERT INTO stencil_sessions (
            id, stencil_id, work_center_id, batch_id, started_at, status
          ) VALUES (?, ?, ?, ?, ?, 'ACTIVE')
        `, [
          payload.stencilSessionId,
          payload.stencilId,
          payload.workCenterId,
          payload.batchId ?? null,
          eventTime
        ]);

        await tx.execute(`
          UPDATE stencils 
          SET status = 'IN_USE'
          WHERE stencil_id = ?
        `, [payload.stencilId]);
        break;
      }

      case 'STENCIL_SESSION_ENDED': {
        const payload = event.payload;
        await tx.execute(`
          UPDATE stencil_sessions 
          SET ended_at = ?, status = 'COMPLETED'
          WHERE id = ?
        `, [eventTime, payload.stencilSessionId]);

        await tx.execute(`
          UPDATE stencils 
          SET status = 'CLEANING_REQUIRED'
          WHERE stencil_id = ?
        `, [payload.stencilId]);
        break;
      }
    }
  }
}
