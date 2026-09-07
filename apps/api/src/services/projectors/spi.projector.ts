import { MesEventEnvelope, MesEventType } from '@mes/shared';
import { v4 as uuidv4 } from 'uuid';
import { IDatabase } from '../../db/database';
import { IEventProjector } from './projector.interface';

export class SpiProjector implements IEventProjector {
  readonly name = 'SpiProjector';

  private static readonly SUPPORTED_EVENTS: Set<MesEventType> = new Set<MesEventType>([
    'SPI_INSPECTION_RECORDED',
    'PRINTER_CLEANING_COMMANDED',
    'PRINTER_PARAMETERS_MODIFIED',
    'PRINTER_COMMAND_ACKNOWLEDGED',
    'CLOSED_LOOP_CORRECTION_VERIFIED',
    'PRE_REFLOW_PANEL_DIVERTED'
  ]);

  supports(eventType: MesEventType): boolean {
    return SpiProjector.SUPPORTED_EVENTS.has(eventType);
  }

  async project(event: MesEventEnvelope, tx: IDatabase): Promise<void> {
    const p = event.payload;

    switch (event.eventType) {
      case 'SPI_INSPECTION_RECORDED': {
        const inspectionId = p.inspectionId || uuidv4();
        await tx.execute(`
          INSERT INTO spi_inspections (
            id, source_system, source_inspection_id, source_file_hash,
            panel_barcode, batch_id, work_center_id, optical_machine_id,
            result, total_pads_inspected, defective_pads_count,
            mean_volume_pct, sigma_volume_pct, duration_seconds, inspected_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_system, source_inspection_id, source_file_hash) DO UPDATE SET
            result = excluded.result,
            total_pads_inspected = excluded.total_pads_inspected,
            defective_pads_count = excluded.defective_pads_count,
            mean_volume_pct = excluded.mean_volume_pct,
            sigma_volume_pct = excluded.sigma_volume_pct,
            duration_seconds = excluded.duration_seconds
        `, [
          inspectionId,
          p.sourceSystem,
          p.sourceInspectionId,
          p.sourceFileHash,
          p.panelBarcode,
          p.batchId || null,
          p.workCenterId,
          p.opticalMachineId,
          p.result,
          p.totalPadsInspected || 0,
          p.defectivePadsCount || 0,
          p.meanVolumePct !== undefined ? p.meanVolumePct : null,
          p.sigmaVolumePct !== undefined ? p.sigmaVolumePct : null,
          p.durationSeconds || null,
          event.eventTime
        ]);

        if (Array.isArray(p.measurements)) {
          for (const m of p.measurements) {
            const padMeasId = uuidv4();
            await tx.execute(`
              INSERT INTO spi_pad_measurements (
                id, inspection_id, panel_barcode, pad_id, unit_position,
                ref_des, pin_no, volume_ratio_pct, height_um, area_ratio_pct,
                offset_x_um, offset_y_um, is_critical_pad, defect_type
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              padMeasId,
              inspectionId,
              p.panelBarcode,
              m.padId,
              m.unitPosition || 1,
              m.refDes,
              m.pinNo !== undefined ? m.pinNo : null,
              m.volumeRatioPct,
              m.heightUm,
              m.areaRatioPct,
              m.offsetXUm,
              m.offsetYUm,
              m.isCriticalPad ? 1 : 0,
              m.defectType || null
            ]);
          }
        }

        // Update panel quality state
        const targetState = p.result === 'PASS' ? 'SPI_PASSED' : p.result === 'WARNING' ? 'SPI_WARNING' : 'QUALITY_HOLD';
        await tx.execute(`
          INSERT INTO panel_units (id, panel_barcode, unit_position, status)
          VALUES (?, ?, 1, ?)
          ON CONFLICT(panel_barcode, unit_position) DO UPDATE SET
            status = excluded.status,
            updated_at = CURRENT_TIMESTAMP
        `, [uuidv4(), p.panelBarcode, targetState]);
        break;
      }

      case 'PRINTER_CLEANING_COMMANDED': {
        const tuningId = uuidv4();
        await tx.execute(`
          INSERT INTO printer_tuning_events (
            id, correction_id, recipe_id, work_center_id, action_type,
            cleaning_mode, trigger_condition, status, commanded_at
          ) VALUES (?, ?, ?, ?, 'STENCIL_CLEAN', ?, ?, 'COMMANDED', ?)
          ON CONFLICT(correction_id) DO UPDATE SET
            status = 'COMMANDED',
            commanded_at = excluded.commanded_at
        `, [
          tuningId,
          p.correctionId,
          p.recipeId || 'PROG-SM-METER-TOP-REV4',
          p.workCenterId,
          p.cleaningMode,
          p.triggerCondition,
          event.eventTime
        ]);
        break;
      }

      case 'PRINTER_PARAMETERS_MODIFIED': {
        const tuningId = uuidv4();
        await tx.execute(`
          INSERT INTO printer_tuning_events (
            id, correction_id, recipe_id, work_center_id, action_type,
            parameter_name, old_value, proposed_value, delta, unit,
            trigger_condition, status, commanded_at
          ) VALUES (?, ?, ?, ?, 'PARAMETER_MODIFY', ?, ?, ?, ?, ?, ?, 'COMMANDED', ?)
          ON CONFLICT(correction_id) DO UPDATE SET
            status = 'COMMANDED',
            commanded_at = excluded.commanded_at
        `, [
          tuningId,
          p.correctionId,
          p.recipeId,
          p.workCenterId,
          p.parameterName,
          p.oldValue,
          p.proposedValue,
          p.delta,
          p.unit || 'kgf',
          p.triggerCondition,
          event.eventTime
        ]);
        break;
      }

      case 'PRINTER_COMMAND_ACKNOWLEDGED': {
        await tx.execute(`
          UPDATE printer_tuning_events
          SET status = ?, acknowledged_at = ?
          WHERE correction_id = ?
        `, [
          p.status === 'REJECTED' ? 'REJECTED' : 'ACKNOWLEDGED',
          event.eventTime,
          p.correctionId
        ]);
        break;
      }

      case 'CLOSED_LOOP_CORRECTION_VERIFIED': {
        await tx.execute(`
          UPDATE printer_tuning_events
          SET status = ?,
              verified_at = ?,
              verified_by_panel_barcode = ?
          WHERE correction_id = ?
        `, [
          p.status,
          event.eventTime,
          p.verificationPanelBarcode,
          p.correctionId
        ]);

        if (p.status === 'VERIFIED_RECOVERED') {
          await tx.execute(`
            UPDATE panel_units
            SET status = 'RELEASED', updated_at = CURRENT_TIMESTAMP
            WHERE panel_barcode = ?
          `, [p.verificationPanelBarcode]);
        }
        break;
      }

      case 'PRE_REFLOW_PANEL_DIVERTED': {
        await tx.execute(`
          INSERT INTO panel_units (id, panel_barcode, unit_position, status)
          VALUES (?, ?, 1, 'REPRINT_REQUIRED')
          ON CONFLICT(panel_barcode, unit_position) DO UPDATE SET
            status = 'REPRINT_REQUIRED',
            updated_at = CURRENT_TIMESTAMP
        `, [uuidv4(), p.panelBarcode]);
        break;
      }
    }
  }
}
