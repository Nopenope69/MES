import { z, ZodTypeAny } from 'zod';
import {
  MesEventType,
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

export class EventSchemaRegistry {
  private static registry: Map<MesEventType, ZodTypeAny> = new Map<MesEventType, ZodTypeAny>([
    ['BATCH_STARTED', BatchStartedPayloadSchema],
    ['STATE_CHANGED', StateChangedPayloadSchema],
    ['DOWNTIME_RECORDED', DowntimeRecordedPayloadSchema],
    ['MATERIAL_CONSUMED', MaterialConsumedPayloadSchema],
    ['OUTPUT_RECORDED', OutputRecordedPayloadSchema],
    ['BATCH_COMPLETED', BatchCompletedPayloadSchema],
    ['PANEL_CHECKOUT', PanelCheckoutPayloadSchema],
    ['REEL_SPLICED', ReelSplicedPayloadSchema],
    ['PICK_ERROR_RECORDED', PickErrorPayloadSchema],
    ['REEL_UNSEALED', ReelUnsealedPayloadSchema],
    ['REEL_DRY_STORAGE_ENTERED', ReelDryStorageEnteredPayloadSchema],
    ['REEL_DRY_STORAGE_EXITED', ReelDryStorageExitedPayloadSchema],
    ['REEL_BAKE_STARTED', ReelBakeStartedPayloadSchema],
    ['REEL_BAKE_COMPLETED', ReelBakeCompletedPayloadSchema],
    ['REEL_RESEALED', ReelResealedPayloadSchema],
    ['QUALITY_GATE_BLOCKED', QualityGateBlockedPayloadSchema],
    ['QUALITY_GATE_PASSED', QualityGatePassedPayloadSchema],
    ['PASTE_REMOVED_FROM_COLD', PasteRemovedFromColdPayloadSchema],
    ['PASTE_THAW_VERIFIED', PasteThawVerifiedPayloadSchema],
    ['PASTE_MIXED', PasteMixedPayloadSchema],
    ['PASTE_AUTHORIZED', PasteAuthorizedPayloadSchema],
    ['PASTE_LOADED_ON_STENCIL', PasteLoadedOnStencilPayloadSchema],
    ['PASTE_REMOVED_FROM_STENCIL', PasteRemovedFromStencilPayloadSchema],
    ['PASTE_DISCARDED', PasteDiscardedPayloadSchema],
    ['STENCIL_SESSION_STARTED', StencilSessionStartedPayloadSchema],
    ['STENCIL_SESSION_ENDED', StencilSessionEndedPayloadSchema],
    ['AOI_INSPECTION_COMPLETED', AoiInspectionCompletedPayloadSchema],
    ['SPI_INSPECTION_COMPLETED', SpiInspectionCompletedPayloadSchema],
    ['DEFECT_RECORDED', DefectRecordedPayloadSchema],
    ['QUALITY_HOLD_APPLIED', QualityHoldAppliedPayloadSchema],
    ['QUALITY_DISPOSITION_DECIDED', QualityDispositionDecidedPayloadSchema],
    ['REWORK_STARTED', ReworkStartedPayloadSchema],
    ['COMPONENT_REPLACED', ComponentReplacedPayloadSchema],
    ['POST_REWORK_INSPECTION_COMPLETED', PostReworkInspectionCompletedPayloadSchema],
    ['REWORK_COMPLETED', ReworkCompletedPayloadSchema],
    ['REPEAT_DEFECT_INTERLOCK_TRIPPED', RepeatDefectInterlockTrippedPayloadSchema],
    ['PANEL_SCRAPPED', PanelScrappedPayloadSchema],
    ['SPI_INSPECTION_RECORDED', SpiInspectionRecordedPayloadSchema],
    ['PRINTER_CLEANING_COMMANDED', PrinterCleaningCommandedPayloadSchema],
    ['PRINTER_PARAMETERS_MODIFIED', PrinterParametersModifiedPayloadSchema],
    ['PRINTER_COMMAND_ACKNOWLEDGED', PrinterCommandAcknowledgedPayloadSchema],
    ['CLOSED_LOOP_CORRECTION_VERIFIED', ClosedLoopCorrectionVerifiedPayloadSchema],
    ['PRE_REFLOW_PANEL_DIVERTED', PreReflowPanelDivertedPayloadSchema]
  ]);

  public static registerSchema(eventType: MesEventType, schema: ZodTypeAny): void {
    this.registry.set(eventType, schema);
  }

  public static getSchema(eventType: MesEventType): ZodTypeAny | undefined {
    return this.registry.get(eventType);
  }

  public static validate(eventType: MesEventType, payload: any): any {
    const schema = this.registry.get(eventType);
    if (!schema) {
      // If no specific payload schema registered, allow arbitrary object
      return payload;
    }
    return schema.parse(payload);
  }
}
