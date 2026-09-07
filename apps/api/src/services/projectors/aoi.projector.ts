import { MesEventEnvelope, MesEventType } from '@mes/shared';
import { v4 as uuidv4 } from 'uuid';
import { IDatabase } from '../../db/database';
import { IEventProjector } from './projector.interface';

export class AoiProjector implements IEventProjector {
  readonly name = 'AoiProjector';

  private static readonly SUPPORTED_EVENTS: Set<MesEventType> = new Set<MesEventType>([
    'AOI_INSPECTION_COMPLETED',
    'SPI_INSPECTION_COMPLETED',
    'DEFECT_RECORDED',
    'QUALITY_HOLD_APPLIED',
    'QUALITY_DISPOSITION_DECIDED',
    'REWORK_STARTED',
    'COMPONENT_REPLACED',
    'REWORK_COMPLETED',
    'POST_REWORK_INSPECTION_COMPLETED',
    'PANEL_SCRAPPED'
  ]);

  supports(eventType: MesEventType): boolean {
    return AoiProjector.SUPPORTED_EVENTS.has(eventType);
  }

  async project(event: MesEventEnvelope, tx: IDatabase): Promise<void> {
    const p = event.payload;

    switch (event.eventType) {
      case 'AOI_INSPECTION_COMPLETED': {
        const inspectionId = p.inspectionId || uuidv4();
        await tx.execute(`
          INSERT INTO aoi_inspections (
            id, source_system, source_inspection_id, source_file_hash,
            panel_barcode, batch_id, work_center_id, optical_machine_id,
            inspection_phase, result, total_defects, duration_seconds, inspected_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_system, source_inspection_id, source_file_hash) DO UPDATE SET
            result = excluded.result,
            total_defects = excluded.total_defects,
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
          p.inspectionPhase,
          p.result,
          p.totalDefects,
          p.durationSeconds || null,
          event.eventTime
        ]);

        if (p.result === 'PASS') {
          const existingUnits = await tx.query<any>(
            'SELECT id, unit_position FROM panel_units WHERE panel_barcode = ?',
            [p.panelBarcode]
          );

          if (existingUnits.length > 0) {
            await tx.execute(`
              UPDATE panel_units
              SET status = 'PASSED', updated_at = CURRENT_TIMESTAMP
              WHERE panel_barcode = ? AND status != 'SCRAPPED'
            `, [p.panelBarcode]);
          } else {
            await tx.execute(`
              INSERT INTO panel_units (id, panel_barcode, unit_position, status)
              VALUES (?, ?, 1, 'PASSED')
              ON CONFLICT(panel_barcode, unit_position) DO UPDATE SET
                status = 'PASSED',
                updated_at = CURRENT_TIMESTAMP
            `, [uuidv4(), p.panelBarcode]);
          }
        }

        if (Array.isArray(p.defects)) {
          for (const d of p.defects) {
            const defectId = d.defectId || uuidv4();
            await tx.execute(`
              INSERT INTO aoi_defects (
                id, inspection_id, panel_barcode, unit_position, ref_des,
                defect_category, defect_type, defect_signature,
                offset_x_um, offset_y_um, rotation_deg, board_side, status, image_ref
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
            `, [
              defectId,
              inspectionId,
              p.panelBarcode,
              d.unitPosition || 1,
              d.refDes,
              d.category || 'SOLDER',
              d.defectType,
              d.defectSignature || `${p.workCenterId}:${p.opticalMachineId}:${d.refDes}:${d.defectType}`,
              d.offsetXUm !== undefined ? d.offsetXUm : null,
              d.offsetYUm !== undefined ? d.offsetYUm : null,
              d.rotationDeg !== undefined ? d.rotationDeg : null,
              d.boardSide || 'TOP',
              d.imageRef || null
            ]);

            // Place affected unit on QUALITY_HOLD
            await tx.execute(`
              INSERT INTO panel_units (id, panel_barcode, unit_position, status)
              VALUES (?, ?, ?, 'QUALITY_HOLD')
              ON CONFLICT(panel_barcode, unit_position) DO UPDATE SET
                status = 'QUALITY_HOLD',
                updated_at = CURRENT_TIMESTAMP
            `, [uuidv4(), p.panelBarcode, d.unitPosition || 1]);
          }
        }
        break;
      }

      case 'QUALITY_HOLD_APPLIED': {
        const unitPos = p.unitPosition || 1;
        await tx.execute(`
          INSERT INTO panel_units (id, panel_barcode, unit_position, status)
          VALUES (?, ?, ?, 'QUALITY_HOLD')
          ON CONFLICT(panel_barcode, unit_position) DO UPDATE SET
            status = 'QUALITY_HOLD',
            updated_at = CURRENT_TIMESTAMP
        `, [uuidv4(), p.panelBarcode, unitPos]);
        break;
      }

      case 'QUALITY_DISPOSITION_DECIDED': {
        const dispId = uuidv4();
        await tx.execute(`
          INSERT INTO rework_dispositions (
            id, defect_id, panel_barcode, unit_position,
            disposition, reason, authorized_by, disposition_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          dispId,
          p.defectId,
          p.panelBarcode,
          p.unitPosition || 1,
          p.disposition,
          p.reason,
          p.authorizedBy,
          event.eventTime
        ]);

        let nextStatus = 'REWORK_PENDING';
        if (p.disposition === 'SCRAP') nextStatus = 'SCRAPPED';
        else if (p.disposition === 'ACCEPT_AS_IS') nextStatus = 'RELEASED';
        else if (p.disposition === 'REWORK') nextStatus = 'REWORK_PENDING';
        else if (p.disposition === 'REINSPECT') nextStatus = 'REWORK_PENDING';

        await tx.execute(`
          UPDATE panel_units
          SET status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE panel_barcode = ? AND unit_position = ?
        `, [nextStatus, p.panelBarcode, p.unitPosition || 1]);
        break;
      }

      case 'REWORK_STARTED': {
        await tx.execute(`
          UPDATE panel_units
          SET status = 'REWORK_IN_PROGRESS', updated_at = CURRENT_TIMESTAMP
          WHERE panel_barcode = ? AND unit_position = ?
        `, [p.panelBarcode, p.unitPosition || 1]);
        break;
      }

      case 'COMPONENT_REPLACED': {
        await tx.execute(`
          INSERT INTO rework_events (
            id, defect_id, panel_barcode, unit_position, ref_des,
            technician_id, station_id, old_mpn, old_reel_id,
            replacement_mpn, replacement_reel_id, rework_method,
            temperature_profile_id, rework_cycle, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          uuidv4(),
          p.defectId,
          p.panelBarcode,
          p.unitPosition || 1,
          p.refDes,
          p.technicianId,
          p.stationId || 'STATION-REWORK-01',
          p.oldMpn,
          p.oldReelId || null,
          p.replacementMpn,
          p.replacementReelId,
          p.reworkMethod || 'HOT_AIR_DESOLDER_SOLDERING_IRON',
          p.temperatureProfileId || null,
          p.reworkCycle || 1,
          event.eventTime
        ]);
        break;
      }

      case 'REWORK_COMPLETED': {
        await tx.execute(`
          UPDATE panel_units
          SET status = 'REWORK_PASSED', updated_at = CURRENT_TIMESTAMP
          WHERE panel_barcode = ? AND unit_position = ?
        `, [p.panelBarcode, p.unitPosition || 1]);

        await tx.execute(`
          UPDATE aoi_defects
          SET status = 'REWORKED'
          WHERE id = ?
        `, [p.defectId]);
        break;
      }

      case 'POST_REWORK_INSPECTION_COMPLETED': {
        const nextStatus = p.result === 'PASS' ? 'RELEASED' : 'REWORK_FAILED';
        await tx.execute(`
          UPDATE panel_units
          SET status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE panel_barcode = ? AND unit_position = ?
        `, [nextStatus, p.panelBarcode, p.unitPosition || 1]);

        if (p.result === 'PASS') {
          await tx.execute(`
            UPDATE aoi_defects
            SET status = 'RESOLVED'
            WHERE id = ?
          `, [p.defectId]);
        }
        break;
      }

      case 'PANEL_SCRAPPED': {
        await tx.execute(`
          UPDATE panel_units
          SET status = 'SCRAPPED', updated_at = CURRENT_TIMESTAMP
          WHERE panel_barcode = ?
        `, [p.panelBarcode]);
        break;
      }
    }
  }
}
