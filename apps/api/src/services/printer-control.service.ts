import { v4 as uuidv4 } from 'uuid';
import {
  RecipeProcessWindow,
  PrinterTuningRecord
} from '@mes/shared';
import { getDatabase } from '../db/database';
import { PrinterCapabilityService } from './printer-capability.service';
import { CfxAmqpAdapter } from '../adapters/cfx/cfx-amqp.adapter';
import { EventIngestionService } from './event-ingestion.service';

export interface ModifyParameterRequest {
  recipeId?: string;
  equipmentId?: string;
  workCenterId?: string;
  parameterName: 'SQUEEGEE_PRESSURE' | 'SEPARATION_SPEED' | 'PRINT_SPEED';
  currentValue: number;
  proposedValue: number;
  unit?: string;
  triggerCondition: string;
}

export interface ExecuteCleaningRequest {
  recipeId?: string;
  equipmentId?: string;
  workCenterId?: string;
  cleaningMode: 'DRY' | 'VACUUM' | 'SOLVENT' | 'VACUUM_SOLVENT';
  triggerCondition: string;
  affectedApertures?: string[];
}

export class PrinterControlService {
  private static cfxAdapter = new CfxAmqpAdapter();

  /**
   * Retrieves the recipe-specific process window from DB, falling back to conservative limits.
   */
  public static async getProcessWindow(recipeId: string = 'PROG-SM-METER-TOP-REV4'): Promise<RecipeProcessWindow> {
    const db = getDatabase();
    const rows = await db.query<{
      id: string;
      recipe_id: string;
      recipe_revision: number;
      stencil_id: string;
      stencil_revision: string;
      nominal_stencil_thickness_um: number;
      volume_lower_limit_pct: number;
      volume_upper_limit_pct: number;
      volume_warning_lower_pct: number;
      volume_warning_upper_pct: number;
      height_lower_limit_um: number;
      height_upper_limit_um: number;
      area_lower_limit_pct: number;
      max_offset_um: number;
      nominal_pressure_kgf: number;
      nominal_separation_speed_mm_s: number;
      min_pressure_kgf: number;
      max_pressure_kgf: number;
      max_abs_delta_pressure: number;
      max_pct_delta_pressure: number;
      min_separation_speed_mm_s: number;
      max_separation_speed_mm_s: number;
      max_abs_delta_separation_speed: number;
      min_time_between_changes_sec: number;
      max_changes_per_hour: number;
      cooldown_after_cleaning_sec: number;
    }>(
      `SELECT * FROM recipe_process_windows WHERE recipe_id = ? ORDER BY recipe_revision DESC LIMIT 1`,
      [recipeId]
    );

    if (rows.length === 0) {
      return {
        id: `RPW-DEFAULT`,
        recipeId,
        recipeRevision: 1,
        stencilId: 'STN-METER-2026-A',
        stencilRevision: 'A',
        nominalStencilThicknessUm: 120.0,
        volumeLowerLimitPct: 75.0,
        volumeUpperLimitPct: 135.0,
        volumeWarningLowerPct: 85.0,
        volumeWarningUpperPct: 120.0,
        heightLowerLimitUm: 90.0,
        heightUpperLimitUm: 160.0,
        areaLowerLimitPct: 80.0,
        maxOffsetUm: 50.0,
        nominalPressureKgf: 8.5,
        nominalSeparationSpeedMmS: 1.2,
        limits: {
          minPressureKgf: 6.0,
          maxPressureKgf: 12.0,
          maxAbsoluteDeltaPressure: 0.5,
          maxPercentageDeltaPressure: 5.0,
          minSeparationSpeedMmS: 0.5,
          maxSeparationSpeedMmS: 3.0,
          maxAbsoluteDeltaSeparationSpeed: 0.2,
          minTimeBetweenChangesSec: 180,
          maxChangesPerHour: 4,
          cooldownAfterCleaningSec: 60
        }
      };
    }

    const r = rows[0];
    return {
      id: r.id,
      recipeId: r.recipe_id,
      recipeRevision: r.recipe_revision,
      stencilId: r.stencil_id,
      stencilRevision: r.stencil_revision,
      nominalStencilThicknessUm: Number(r.nominal_stencil_thickness_um),
      volumeLowerLimitPct: Number(r.volume_lower_limit_pct),
      volumeUpperLimitPct: Number(r.volume_upper_limit_pct),
      volumeWarningLowerPct: Number(r.volume_warning_lower_pct),
      volumeWarningUpperPct: Number(r.volume_warning_upper_pct),
      heightLowerLimitUm: Number(r.height_lower_limit_um),
      heightUpperLimitUm: Number(r.height_upper_limit_um),
      areaLowerLimitPct: Number(r.area_lower_limit_pct),
      maxOffsetUm: Number(r.max_offset_um),
      nominalPressureKgf: Number(r.nominal_pressure_kgf),
      nominalSeparationSpeedMmS: Number(r.nominal_separation_speed_mm_s),
      limits: {
        minPressureKgf: Number(r.min_pressure_kgf),
        maxPressureKgf: Number(r.max_pressure_kgf),
        maxAbsoluteDeltaPressure: Number(r.max_abs_delta_pressure),
        maxPercentageDeltaPressure: Number(r.max_pct_delta_pressure),
        minSeparationSpeedMmS: Number(r.min_separation_speed_mm_s),
        maxSeparationSpeedMmS: Number(r.max_separation_speed_mm_s),
        maxAbsoluteDeltaSeparationSpeed: Number(r.max_abs_delta_separation_speed),
        minTimeBetweenChangesSec: Number(r.min_time_between_changes_sec),
        maxChangesPerHour: Number(r.max_changes_per_hour),
        cooldownAfterCleaningSec: Number(r.cooldown_after_cleaning_sec)
      }
    };
  }

  /**
   * Request an automated stencil underside cleaning cycle with validation.
   */
  public static async executeCleaning(req: ExecuteCleaningRequest): Promise<{
    success: boolean;
    correctionId: string;
    message: string;
  }> {
    const equipmentId = req.equipmentId || 'wc-spg-01';
    const workCenterId = req.workCenterId || 'wc-spg-01';
    const recipeId = req.recipeId || 'PROG-SM-METER-TOP-REV4';
    const correctionId = `CORR-CLN-${Date.now()}-${uuidv4().substring(0, 8)}`;

    // 1. Check capability
    const isSupported = await PrinterCapabilityService.isActionSupported(equipmentId, 'CLEANING');
    if (!isSupported) {
      return {
        success: false,
        correctionId,
        message: `Printer ${equipmentId} does not declare capability for automated stencil cleaning.`
      };
    }

    // 2. Map mode to CFX
    const cfxModeMap: Record<string, 'Dry' | 'Vacuum' | 'Solvent' | 'VacuumSolvent'> = {
      DRY: 'Dry',
      VACUUM: 'Vacuum',
      SOLVENT: 'Solvent',
      VACUUM_SOLVENT: 'VacuumSolvent'
    };
    const cfxMode = cfxModeMap[req.cleaningMode] || 'VacuumSolvent';

    // 3. Command via CFX AMQP Adapter
    await this.cfxAdapter.sendCleaningCommand({
      printerEquipmentId: equipmentId,
      cleaningMode: cfxMode,
      triggerReason: req.triggerCondition
    });

    // 4. Ingest PRINTER_CLEANING_COMMANDED
    await EventIngestionService.ingest({
      eventType: 'PRINTER_CLEANING_COMMANDED',
      workCenterId,
      sourceType: 'IPC_CFX_BROKER',
      sourceId: 'spi-closed-loop-engine',
      payload: {
        correctionId,
        workCenterId,
        cleaningMode: req.cleaningMode,
        triggerCondition: req.triggerCondition,
        affectedApertures: req.affectedApertures || [],
        recipeId
      }
    });

    // 5. Ingest PRINTER_COMMAND_ACKNOWLEDGED
    await EventIngestionService.ingest({
      eventType: 'PRINTER_COMMAND_ACKNOWLEDGED',
      workCenterId,
      sourceType: 'PRINTER_CONTROLLER',
      sourceId: equipmentId,
      payload: {
        correctionId,
        workCenterId,
        status: 'ACKNOWLEDGED',
        printerMessage: `Cleaning (${req.cleaningMode}) executed on ${equipmentId}`
      }
    });

    return {
      success: true,
      correctionId,
      message: `Stencil cleaning cycle commanded and acknowledged.`
    };
  }

  /**
   * Request parameter micro-tuning (e.g. Squeegee Pressure, Separation Speed) with strict safety bounds.
   */
  public static async modifyParameter(req: ModifyParameterRequest): Promise<{
    success: boolean;
    correctionId: string;
    message: string;
    appliedValue?: number;
  }> {
    const equipmentId = req.equipmentId || 'wc-spg-01';
    const workCenterId = req.workCenterId || 'wc-spg-01';
    const recipeId = req.recipeId || 'PROG-SM-METER-TOP-REV4';
    const correctionId = `CORR-PARAM-${Date.now()}-${uuidv4().substring(0, 8)}`;
    const db = getDatabase();

    // 1. Check capability
    const actionKey = req.parameterName === 'SQUEEGEE_PRESSURE' ? 'PRESSURE' :
                      req.parameterName === 'SEPARATION_SPEED' ? 'SEPARATION_SPEED' : 'PRINT_SPEED';
    const isSupported = await PrinterCapabilityService.isActionSupported(equipmentId, actionKey);
    if (!isSupported) {
      return {
        success: false,
        correctionId,
        message: `Action ${req.parameterName} not supported by printer ${equipmentId}.`
      };
    }

    // 2. Fetch recipe limits
    const processWindow = await this.getProcessWindow(recipeId);
    const limits = processWindow.limits;
    const delta = Number((req.proposedValue - req.currentValue).toFixed(3));
    const absDelta = Math.abs(delta);
    const pctDelta = Math.abs((delta / (req.currentValue || 1.0)) * 100);

    // 3. Enforce Safety Invariants (Pillar 3)
    if (req.parameterName === 'SQUEEGEE_PRESSURE') {
      if (req.proposedValue < limits.minPressureKgf || req.proposedValue > limits.maxPressureKgf) {
        return {
          success: false,
          correctionId,
          message: `REJECTED: Proposed pressure ${req.proposedValue} kgf is outside approved process window [${limits.minPressureKgf}, ${limits.maxPressureKgf}] kgf.`
        };
      }
      if (absDelta > limits.maxAbsoluteDeltaPressure) {
        return {
          success: false,
          correctionId,
          message: `REJECTED: Pressure delta ${absDelta} kgf exceeds max absolute delta limit of ${limits.maxAbsoluteDeltaPressure} kgf.`
        };
      }
      if (pctDelta > limits.maxPercentageDeltaPressure) {
        return {
          success: false,
          correctionId,
          message: `REJECTED: Pressure percentage delta ${pctDelta.toFixed(1)}% exceeds max allowable ${limits.maxPercentageDeltaPressure}%.`
        };
      }
    } else if (req.parameterName === 'SEPARATION_SPEED') {
      if (req.proposedValue < limits.minSeparationSpeedMmS || req.proposedValue > limits.maxSeparationSpeedMmS) {
        return {
          success: false,
          correctionId,
          message: `REJECTED: Proposed separation speed ${req.proposedValue} mm/s is outside approved window [${limits.minSeparationSpeedMmS}, ${limits.maxSeparationSpeedMmS}] mm/s.`
        };
      }
      if (absDelta > limits.maxAbsoluteDeltaSeparationSpeed) {
        return {
          success: false,
          correctionId,
          message: `REJECTED: Separation speed delta ${absDelta} mm/s exceeds max allowable ${limits.maxAbsoluteDeltaSeparationSpeed} mm/s.`
        };
      }
    }

    // 4. Rate-of-Change & Cooldown Enforcement
    const recentModifications = await db.query<{
      commanded_at: string;
      action_type: string;
    }>(
      `SELECT commanded_at, action_type FROM printer_tuning_events
       WHERE work_center_id = ? AND action_type = 'PARAMETER_MODIFY' AND commanded_at >= datetime('now', '-1 hour')
       ORDER BY commanded_at DESC`,
      [workCenterId]
    );

    if (recentModifications.length >= limits.maxChangesPerHour) {
      return {
        success: false,
        correctionId,
        message: `REJECTED: Maximum changes per hour (${limits.maxChangesPerHour}) exceeded for ${workCenterId}.`
      };
    }

    if (recentModifications.length > 0) {
      const lastCmdTime = new Date(recentModifications[0].commanded_at).getTime();
      const nowTime = Date.now();
      const elapsedSec = (nowTime - lastCmdTime) / 1000;
      if (elapsedSec < limits.minTimeBetweenChangesSec) {
        return {
          success: false,
          correctionId,
          message: `REJECTED: Cooldown active. Minimum time between modifications is ${limits.minTimeBetweenChangesSec}s (elapsed: ${Math.round(elapsedSec)}s).`
        };
      }
    }

    // 5. Dispatch command via CFX AMQP Adapter
    const cfxParamMap: Record<string, 'SqueegeePressure' | 'SeparationSpeed' | 'PrintSpeed'> = {
      SQUEEGEE_PRESSURE: 'SqueegeePressure',
      SEPARATION_SPEED: 'SeparationSpeed',
      PRINT_SPEED: 'PrintSpeed'
    };
    const cfxParam = cfxParamMap[req.parameterName] || 'SqueegeePressure';

    await this.cfxAdapter.sendParameterModification({
      printerEquipmentId: equipmentId,
      parameterName: cfxParam,
      targetValue: req.proposedValue,
      unit: req.unit || 'kgf',
      triggerReason: req.triggerCondition
    });

    // 6. Ingest PRINTER_PARAMETERS_MODIFIED
    await EventIngestionService.ingest({
      eventType: 'PRINTER_PARAMETERS_MODIFIED',
      workCenterId,
      sourceType: 'IPC_CFX_BROKER',
      sourceId: 'spi-closed-loop-engine',
      payload: {
        correctionId,
        workCenterId,
        parameterName: req.parameterName,
        oldValue: req.currentValue,
        proposedValue: req.proposedValue,
        delta,
        unit: req.unit || 'kgf',
        triggerCondition: req.triggerCondition,
        recipeId
      }
    });

    // 7. Ingest PRINTER_COMMAND_ACKNOWLEDGED
    await EventIngestionService.ingest({
      eventType: 'PRINTER_COMMAND_ACKNOWLEDGED',
      workCenterId,
      sourceType: 'PRINTER_CONTROLLER',
      sourceId: equipmentId,
      payload: {
        correctionId,
        workCenterId,
        status: 'ACKNOWLEDGED',
        printerMessage: `Parameter ${req.parameterName} updated to ${req.proposedValue}`
      }
    });

    return {
      success: true,
      correctionId,
      appliedValue: req.proposedValue,
      message: `Parameter ${req.parameterName} modified to ${req.proposedValue} ${req.unit || 'kgf'}.`
    };
  }

  /**
   * Retrieves tuning audit history.
   */
  public static async getTuningHistory(limit: number = 50): Promise<PrinterTuningRecord[]> {
    const db = getDatabase();
    const rows = await db.query<{
      id: string;
      correction_id: string;
      recipe_id: string;
      work_center_id: string;
      action_type: string;
      cleaning_mode?: string;
      parameter_name?: string;
      old_value?: number;
      proposed_value?: number;
      delta?: number;
      unit?: string;
      trigger_condition: string;
      status: string;
      commanded_at: string;
      acknowledged_at?: string;
      verified_at?: string;
      verified_by_panel_barcode?: string;
      rejection_reason?: string;
    }>(
      `SELECT * FROM printer_tuning_events ORDER BY commanded_at DESC LIMIT ?`,
      [limit]
    );

    return rows.map((r) => ({
      id: r.id,
      correctionId: r.correction_id,
      recipeId: r.recipe_id,
      workCenterId: r.work_center_id,
      printerModel: 'Fuji GPX-C',
      actionType: r.action_type as any,
      cleaningMode: r.cleaning_mode as any,
      parameterName: r.parameter_name as any,
      oldValue: r.old_value !== null ? Number(r.old_value) : undefined,
      proposedValue: r.proposed_value !== null ? Number(r.proposed_value) : undefined,
      delta: r.delta !== null ? Number(r.delta) : undefined,
      unit: r.unit,
      triggerCondition: r.trigger_condition,
      status: r.status as any,
      commandedAt: r.commanded_at,
      acknowledgedAt: r.acknowledged_at,
      verifiedAt: r.verified_at,
      verifiedByPanelBarcode: r.verified_by_panel_barcode,
      rejectionReason: r.rejection_reason
    }));
  }
}
