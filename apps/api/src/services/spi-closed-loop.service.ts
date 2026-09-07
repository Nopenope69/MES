import { v4 as uuidv4 } from 'uuid';
import {
  CanonicalSpiInspectionResult,
  SpiPadMeasurement
} from '@mes/shared';
import { getDatabase } from '../db/database';
import { EventIngestionService } from './event-ingestion.service';
import { PrinterControlService } from './printer-control.service';

export interface SpiClosedLoopDiagnosis {
  panelBarcode: string;
  overallResult: 'PASS' | 'WARNING' | 'FAIL';
  actionTaken:
    | 'CLEANING_COMMANDED'
    | 'PARAMETER_TUNED'
    | 'PANEL_DIVERTED'
    | 'VERIFICATION_CONFIRMED'
    | 'LINE_INTERLOCKED'
    | 'NONE';
  verificationStatus?: 'VERIFIED_RECOVERED' | 'VERIFIED_FAILED';
  tuningRecord?: any;
  message: string;
}

export class SpiClosedLoopService {
  /**
   * Primary diagnostic and closed-loop orchestration loop.
   * Pure evaluation of inspection data -> commands execution through PrinterControlService.
   */
  public static async processInspection(
    inspection: CanonicalSpiInspectionResult,
    recipeId: string = 'PROG-SM-METER-TOP-REV4'
  ): Promise<SpiClosedLoopDiagnosis> {
    const db = getDatabase();
    const processWindow = await PrinterControlService.getProcessWindow(recipeId);

    // 1. Calculate stats if not already provided
    const measurements = inspection.measurements || [];
    let meanVolume = inspection.meanVolumePct;
    let sigmaVolume = inspection.sigmaVolumePct;

    if (measurements.length > 0 && (!meanVolume || meanVolume === 100.0)) {
      const sum = measurements.reduce((acc, m) => acc + m.volumeRatioPct, 0);
      meanVolume = Number((sum / measurements.length).toFixed(2));
      if (measurements.length > 1) {
        const variance = measurements.reduce((acc, m) => acc + Math.pow(m.volumeRatioPct - meanVolume, 2), 0) / (measurements.length - 1);
        sigmaVolume = Number(Math.sqrt(variance).toFixed(2));
      }
    }

    const defectivePads = measurements.filter((m) => {
      return (
        m.defectType ||
        m.volumeRatioPct < processWindow.volumeLowerLimitPct ||
        m.volumeRatioPct > processWindow.volumeUpperLimitPct ||
        m.heightUm < processWindow.heightLowerLimitUm ||
        m.heightUm > processWindow.heightUpperLimitUm
      );
    });

    let overallResult: 'PASS' | 'WARNING' | 'FAIL' = inspection.result;
    if (defectivePads.length > 0) {
      overallResult = defectivePads.some((p) => p.isCriticalPad || p.volumeRatioPct < 60 || p.volumeRatioPct > 140)
        ? 'FAIL'
        : 'WARNING';
    }

    // 2. Ingest SPI_INSPECTION_RECORDED event
    await EventIngestionService.ingest({
      eventType: 'SPI_INSPECTION_RECORDED',
      workCenterId: inspection.workCenterId || 'wc-spi-01',
      sourceType: 'SPI_GATEWAY',
      sourceId: inspection.opticalMachineId,
      batchId: inspection.batchId,
      payload: {
        inspectionId: inspection.sourceInspectionId || uuidv4(),
        sourceSystem: inspection.sourceSystem,
        sourceInspectionId: inspection.sourceInspectionId,
        sourceFileHash: inspection.sourceFileHash,
        panelBarcode: inspection.panelBarcode,
        batchId: inspection.batchId,
        workCenterId: inspection.workCenterId,
        opticalMachineId: inspection.opticalMachineId,
        result: overallResult,
        totalPadsInspected: measurements.length,
        defectivePadsCount: defectivePads.length,
        meanVolumePct: meanVolume,
        sigmaVolumePct: sigmaVolume,
        measurements,
        durationSeconds: inspection.durationSeconds || 14.5
      }
    });

    // 3. Pillar 4: Mandatory Closed-Loop Verification Check
    const pendingVerifications = await db.query<{
      correction_id: string;
      parameter_name?: string;
      action_type: string;
      old_value?: number;
      proposed_value?: number;
    }>(
      `SELECT correction_id, parameter_name, action_type, old_value, proposed_value
       FROM printer_tuning_events
       WHERE status = 'ACKNOWLEDGED' AND work_center_id = 'wc-spg-01'
       ORDER BY commanded_at DESC
       LIMIT 1`
    );

    if (pendingVerifications.length > 0) {
      const activeTuning = pendingVerifications[0];
      const isRecovered =
        meanVolume >= processWindow.volumeWarningLowerPct &&
        meanVolume <= processWindow.volumeWarningUpperPct &&
        defectivePads.length === 0;

      if (isRecovered) {
        await EventIngestionService.ingest({
          eventType: 'CLOSED_LOOP_CORRECTION_VERIFIED',
          workCenterId: 'wc-spg-01',
          sourceType: 'SPI_GATEWAY',
          sourceId: inspection.opticalMachineId,
          payload: {
            correctionId: activeTuning.correction_id,
            verificationPanelBarcode: inspection.panelBarcode,
            status: 'VERIFIED_RECOVERED',
            observedDeltaVolumePct: Number((meanVolume - 100.0).toFixed(2)),
            notes: `Subsequent board ${inspection.panelBarcode} verified nominal volume recovery (${meanVolume}%). Closed-loop complete.`
          }
        });

        return {
          panelBarcode: inspection.panelBarcode,
          overallResult: 'PASS',
          actionTaken: 'VERIFICATION_CONFIRMED',
          verificationStatus: 'VERIFIED_RECOVERED',
          message: `Closed-loop correction [${activeTuning.correction_id}] successfully verified by panel ${inspection.panelBarcode}. Board released.`
        };
      } else {
        // Verification failed! Persistent drift or defects after machine adjustment
        await EventIngestionService.ingest({
          eventType: 'CLOSED_LOOP_CORRECTION_VERIFIED',
          workCenterId: 'wc-spg-01',
          sourceType: 'SPI_GATEWAY',
          sourceId: inspection.opticalMachineId,
          payload: {
            correctionId: activeTuning.correction_id,
            verificationPanelBarcode: inspection.panelBarcode,
            status: 'VERIFIED_FAILED',
            observedDeltaVolumePct: Number((meanVolume - 100.0).toFixed(2)),
            notes: `Drift persisted on verification board ${inspection.panelBarcode} (mean volume: ${meanVolume}%, defects: ${defectivePads.length}).`
          }
        });

        // Interlock line
        await EventIngestionService.ingest({
          eventType: 'REPEAT_DEFECT_INTERLOCK_TRIPPED',
          workCenterId: 'wc-spg-01',
          sourceType: 'QUALITY_SENTINEL',
          sourceId: 'spi-closed-loop-engine',
          payload: {
            programId: recipeId,
            workCenterId: 'wc-spg-01',
            machineId: 'wc-spg-01',
            refDes: defectivePads[0]?.refDes || 'GLOBAL',
            defectType: defectivePads[0]?.defectType || 'PERSISTENT_VOLUME_DRIFT',
            consecutiveCount: 2,
            actionTaken: 'PRODUCTION_HOLD_COMMANDED',
            reason: `Automated printer correction ${activeTuning.correction_id} failed verification on subsequent panel ${inspection.panelBarcode}. Production hold commanded.`
          }
        });

        return {
          panelBarcode: inspection.panelBarcode,
          overallResult: 'FAIL',
          actionTaken: 'LINE_INTERLOCKED',
          verificationStatus: 'VERIFIED_FAILED',
          message: `Correction failed verification on ${inspection.panelBarcode}. SMT line interlocked to prevent defective batch run.`
        };
      }
    }

    // 4. Critical Pad Collapse Check (Pillar 11: Decoupled MES Divert)
    const criticalCollapses = measurements.filter(
      (m) => m.isCriticalPad && (m.volumeRatioPct < 50.0 || m.defectType === 'MISSING_PASTE')
    );

    if (criticalCollapses.length > 0) {
      await EventIngestionService.ingest({
        eventType: 'PRE_REFLOW_PANEL_DIVERTED',
        workCenterId: inspection.workCenterId || 'wc-spi-01',
        sourceType: 'SPI_GATEWAY',
        sourceId: inspection.opticalMachineId,
        payload: {
          panelBarcode: inspection.panelBarcode,
          reason: `Critical pad collapse detected on ${criticalCollapses.map((c) => c.refDes).join(', ')} (volume < 50%). Diverting before reflow.`,
          divertConveyorId: 'CONVEYOR-WASH-BUF-01',
          criticalDefectsCount: criticalCollapses.length
        }
      });

      return {
        panelBarcode: inspection.panelBarcode,
        overallResult: 'FAIL',
        actionTaken: 'PANEL_DIVERTED',
        message: `Board diverted to wash buffer conveyor CONVEYOR-WASH-BUF-01 due to critical pad collapse. Diverting before reflow.`
      };
    }

    // 5. Stencil Underside Smear Detection (Trigger Cleaning)
    const smearDefects = measurements.filter(
      (m) => m.defectType === 'SMEARING' || m.defectType === 'BRIDGING' || m.volumeRatioPct > 135.0
    );

    if (smearDefects.length >= 2 || (smearDefects.length === 1 && smearDefects[0].isCriticalPad)) {
      const cleanRes = await PrinterControlService.executeCleaning({
        recipeId,
        equipmentId: 'wc-spg-01',
        workCenterId: 'wc-spg-01',
        cleaningMode: 'VACUUM_SOLVENT',
        triggerCondition: `Aperture smear detected on ${smearDefects.length} apertures (${smearDefects.map((s) => s.refDes).slice(0, 3).join(', ')})`,
        affectedApertures: smearDefects.map((s) => s.refDes)
      });

      return {
        panelBarcode: inspection.panelBarcode,
        overallResult: 'WARNING',
        actionTaken: 'CLEANING_COMMANDED',
        tuningRecord: cleanRes,
        message: `Aperture smearing detected. Automated stencil underside wipe (VACUUM_SOLVENT) dispatched via IPC-CFX.`
      };
    }

    // 6. Volume Drift Micro-Tuning (Trigger Squeegee Pressure Adjustment)
    if (meanVolume < processWindow.volumeWarningLowerPct) {
      // Volume low -> increase squeegee pressure
      const tuneRes = await PrinterControlService.modifyParameter({
        recipeId,
        equipmentId: 'wc-spg-01',
        workCenterId: 'wc-spg-01',
        parameterName: 'SQUEEGEE_PRESSURE',
        currentValue: 8.5,
        proposedValue: 8.8,
        unit: 'kgf',
        triggerCondition: `Average aperture volume drifted low (${meanVolume}% < ${processWindow.volumeWarningLowerPct}%)`
      });

      if (!tuneRes.success) {
        return {
          panelBarcode: inspection.panelBarcode,
          overallResult: 'WARNING',
          actionTaken: 'NONE',
          tuningRecord: tuneRes,
          message: `Volume drifted low (${meanVolume}%), but tuning was inhibited: ${tuneRes.message}`
        };
      }

      return {
        panelBarcode: inspection.panelBarcode,
        overallResult: 'WARNING',
        actionTaken: 'PARAMETER_TUNED',
        tuningRecord: tuneRes,
        message: `Volume drifted low (${meanVolume}%). Micro-tuned squeegee pressure +0.3 kgf via IPC-CFX.`
      };
    } else if (meanVolume > processWindow.volumeWarningUpperPct) {
      // Volume high -> decrease squeegee pressure
      const tuneRes = await PrinterControlService.modifyParameter({
        recipeId,
        equipmentId: 'wc-spg-01',
        workCenterId: 'wc-spg-01',
        parameterName: 'SQUEEGEE_PRESSURE',
        currentValue: 8.5,
        proposedValue: 8.2,
        unit: 'kgf',
        triggerCondition: `Average aperture volume drifted high (${meanVolume}% > ${processWindow.volumeWarningUpperPct}%)`
      });

      if (!tuneRes.success) {
        return {
          panelBarcode: inspection.panelBarcode,
          overallResult: 'WARNING',
          actionTaken: 'NONE',
          tuningRecord: tuneRes,
          message: `Volume drifted high (${meanVolume}%), but tuning was inhibited: ${tuneRes.message}`
        };
      }

      return {
        panelBarcode: inspection.panelBarcode,
        overallResult: 'WARNING',
        actionTaken: 'PARAMETER_TUNED',
        tuningRecord: tuneRes,
        message: `Volume drifted high (${meanVolume}%). Micro-tuned squeegee pressure -0.3 kgf via IPC-CFX.`
      };
    }

    return {
      panelBarcode: inspection.panelBarcode,
      overallResult,
      actionTaken: 'NONE',
      message: `Inspection passed nominal process window (${meanVolume}% mean volume).`
    };
  }
}
