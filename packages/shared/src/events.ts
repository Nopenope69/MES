import { z } from 'zod';
import { EquipmentStateEnum, DowntimeCategoryEnum } from './state-machine';

export const CanonicalEventTypeEnum = z.enum([
  'WORK_ORDER_CREATED',
  'BATCH_CREATED',
  'BATCH_STARTED',
  'OPERATION_STARTED',
  'OPERATION_COMPLETED',
  'STATE_CHANGED',
  'ALARM_RAISED',
  'ALARM_CLEARED',
  'PANEL_CHECKIN',
  'PANEL_CHECKOUT',
  'REEL_LOADED',
  'REEL_SPLICED',
  'REEL_UNLOADED',
  'REEL_UNSEALED',
  'REEL_DRY_STORAGE_ENTERED',
  'REEL_DRY_STORAGE_EXITED',
  'REEL_BAKE_STARTED',
  'REEL_BAKE_COMPLETED',
  'REEL_RESEALED',
  'QUALITY_GATE_BLOCKED',
  'QUALITY_GATE_PASSED',
  'PASTE_REMOVED_FROM_COLD',
  'PASTE_THAW_VERIFIED',
  'PASTE_MIXED',
  'PASTE_AUTHORIZED',
  'PASTE_LOADED_ON_STENCIL',
  'PASTE_REMOVED_FROM_STENCIL',
  'PASTE_DISCARDED',
  'STENCIL_SESSION_STARTED',
  'STENCIL_SESSION_ENDED',
  'PICK_ERROR_RECORDED',
  'MATERIAL_CONSUMED',
  'OUTPUT_RECORDED',
  'DOWNTIME_RECORDED',
  'PRODUCTION_STOPPED',
  'BATCH_COMPLETED'
]);
export type CanonicalEventType = z.infer<typeof CanonicalEventTypeEnum>;
export type MesEventType = CanonicalEventType;

export const SourceTypeEnum = z.enum([
  'MANUAL_UI',
  'INTEGRATION_SOCKET',
  'SYSTEM',
  'CSV_IMPORT'
]);
export type SourceType = z.infer<typeof SourceTypeEnum>;

// Event specific payload schemas
export const BatchStartedPayloadSchema = z.object({
  batchNumber: z.string(),
  workOrderNumber: z.string(),
  productCode: z.string(),
  recipeCode: z.string(),
  recipeRevision: z.number().default(1),
  plannedQuantity: z.number().positive(),
  unit: z.string().default('PANEL'),
  notes: z.string().optional()
});

export const StateChangedPayloadSchema = z.object({
  previousState: EquipmentStateEnum,
  currentState: EquipmentStateEnum,
  reasonCategory: DowntimeCategoryEnum.optional(),
  reasonCode: z.string().optional(),
  comment: z.string().optional()
});

export const DowntimeRecordedPayloadSchema = z.object({
  stateLogId: z.string().optional(),
  reasonCategory: DowntimeCategoryEnum,
  reasonCode: z.string(),
  comment: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  durationMinutes: z.number().nonnegative().optional()
});

export const MaterialConsumedPayloadSchema = z.object({
  materialCode: z.string(), // Part Number
  materialName: z.string().optional(),
  materialLotNumber: z.string(), // Lot No
  supplierName: z.string().optional(),
  supplierLotNumber: z.string().optional(),
  quantityConsumed: z.number().positive(),
  unit: z.string().default('PCS'),
  containerOrDrumId: z.string().optional(), // Feeder ID or Reel ID
  expiryDate: z.string().optional(),
  recipeItemId: z.string().optional()
});

export const ReelSplicedPayloadSchema = z.object({
  slotNo: z.number(),
  moduleNo: z.number().default(1),
  stageNo: z.number().default(1),
  feederId: z.string(),
  partNumber: z.string(),
  oldReelId: z.string(),
  newReelId: z.string(),
  newReelLotNumber: z.string().optional(),
  newReelVendor: z.string().optional(),
  newReelQuantity: z.number().positive(),
  mslRemainingMinutes: z.number().nonnegative().optional(),
  operatorId: z.string().optional()
});

export const PanelCheckoutPayloadSchema = z.object({
  panelBarcode: z.string(),
  programName: z.string(),
  moduleNo: z.number().default(1),
  laneNo: z.number().default(1),
  cycleTimeSeconds: z.number().nonnegative(),
  blockCount: z.number().int().nonnegative().default(1),
  blockSkipCount: z.number().int().nonnegative().default(0),
  skipBitmask: z.string().optional(),
  criticalMslRemainingTime: z.number().optional()
});

export const PickErrorPayloadSchema = z.object({
  moduleNo: z.number(),
  stageNo: z.number().default(1),
  slotNo: z.number(),
  partNumber: z.string(),
  feederId: z.string(),
  nozzleId: z.string().optional(),
  headId: z.string().optional(),
  errorType: z.enum(['VISION_ERROR', 'DROPPED_PART', 'EMPTY_PICKUP', 'REJECT_PART']),
  errorCode: z.string().optional(),
  subErrorCode: z.string().optional()
});

export const OutputRecordedPayloadSchema = z.object({
  goodQuantity: z.number().nonnegative(),
  rejectedQuantity: z.number().nonnegative().default(0),
  reworkQuantity: z.number().nonnegative().default(0),
  unit: z.string().default('PANEL'),
  rejectReasonCode: z.string().optional(),
  cycleTimeSeconds: z.number().nonnegative().optional()
});

export const BatchCompletedPayloadSchema = z.object({
  totalGoodQuantity: z.number().nonnegative(),
  totalRejectedQuantity: z.number().nonnegative().default(0),
  unit: z.string().default('PANEL'),
  finalStatus: z.enum(['COMPLETED_NORMAL', 'COMPLETED_DEVIATION', 'TERMINATED_EARLY']),
  notes: z.string().optional()
});

export const AlarmRaisedPayloadSchema = z.object({
  alarmCode: z.string(),
  subCode: z.string().optional(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL', 'FATAL']).default('WARNING'),
  message: z.string()
});

export const AlarmClearedPayloadSchema = z.object({
  alarmCode: z.string(),
  clearedByOperatorId: z.string().optional()
});

// Phase 2: MSL Lifecycle Schemas (JEDEC J-STD-033D)
export const ReelUnsealedPayloadSchema = z.object({
  reelId: z.string(),
  partNumber: z.string(),
  mslClass: z.string(),
  nominalFloorLifeMinutes: z.number().int().positive(),
  hicStatus: z.string().default('OK'),
  operatorId: z.string().optional()
});

export const ReelDryStorageEnteredPayloadSchema = z.object({
  reelId: z.string(),
  cabinetId: z.string(),
  ambientExposureSeconds: z.number().int().nonnegative().optional(),
  operatorId: z.string().optional()
});

export const ReelDryStorageExitedPayloadSchema = z.object({
  reelId: z.string(),
  cabinetId: z.string(),
  dryDurationSeconds: z.number().int().nonnegative().optional(),
  operatorId: z.string().optional()
});

export const ReelBakeStartedPayloadSchema = z.object({
  reelId: z.string(),
  ovenId: z.string(),
  bakeProfileId: z.string(),
  temperatureC: z.number(),
  targetDurationMinutes: z.number().int().positive(),
  operatorId: z.string().optional()
});

export const ReelBakeCompletedPayloadSchema = z.object({
  reelId: z.string(),
  ovenId: z.string(),
  bakeProfileId: z.string(),
  actualDurationMinutes: z.number().int().positive(),
  actualTemperatureC: z.number(),
  bakeSufficient: z.boolean(),
  operatorId: z.string().optional()
});

export const ReelResealedPayloadSchema = z.object({
  reelId: z.string(),
  desiccantAdded: z.boolean().default(true),
  hicStatus: z.string().default('OK'),
  operatorId: z.string().optional()
});

// Universal Quality Gate Schemas
export const QualityGateBlockedPayloadSchema = z.object({
  gateType: z.enum(['MSL', 'BOM', 'PASTE', 'STENCIL', 'CALIBRATION']),
  gateCode: z.string(),
  materialId: z.string(),
  reason: z.string(),
  workCenterId: z.string(),
  operatorId: z.string().optional()
});

export const QualityGatePassedPayloadSchema = z.object({
  gateType: z.enum(['MSL', 'BOM', 'PASTE', 'STENCIL', 'CALIBRATION']),
  gateCode: z.string(),
  materialId: z.string(),
  workCenterId: z.string(),
  operatorId: z.string().optional()
});

// Phase 2: Solder Paste & Stencil Lifecycle Schemas
export const PasteRemovedFromColdPayloadSchema = z.object({
  jarId: z.string(),
  partNumber: z.string(),
  lotNumber: z.string(),
  thawRequiredMinutes: z.number().int().positive().default(240),
  operatorId: z.string().optional()
});

export const PasteThawVerifiedPayloadSchema = z.object({
  jarId: z.string(),
  temperatureVerifiedC: z.number(),
  actualThawMinutes: z.number().int().nonnegative(),
  thawSufficient: z.boolean(),
  operatorId: z.string().optional()
});

export const PasteMixedPayloadSchema = z.object({
  jarId: z.string(),
  durationSeconds: z.number().int().positive(),
  mixingMethod: z.string().default('CENTRIFUGAL_PLANETARY'),
  mixSufficient: z.boolean(),
  operatorId: z.string().optional()
});

export const PasteAuthorizedPayloadSchema = z.object({
  jarId: z.string(),
  workCenterId: z.string(),
  batchId: z.string().optional(),
  operatorId: z.string().optional()
});

export const PasteLoadedOnStencilPayloadSchema = z.object({
  jarId: z.string(),
  stencilId: z.string(),
  stencilSessionId: z.string(),
  workCenterId: z.string(),
  batchId: z.string().optional(),
  stencilLifeMinutes: z.number().int().positive().default(480),
  operatorId: z.string().optional()
});

export const PasteRemovedFromStencilPayloadSchema = z.object({
  jarId: z.string(),
  stencilId: z.string(),
  stencilSessionId: z.string(),
  reason: z.enum(['BATCH_FINISHED', 'STENCIL_CLEANING', 'EXPIRED_SCRAP', 'REPLACED']),
  operatorId: z.string().optional()
});

export const PasteDiscardedPayloadSchema = z.object({
  jarId: z.string(),
  reason: z.string(),
  operatorId: z.string().optional()
});

export const StencilSessionStartedPayloadSchema = z.object({
  stencilSessionId: z.string(),
  stencilId: z.string(),
  workCenterId: z.string(),
  batchId: z.string().optional(),
  operatorId: z.string().optional()
});

export const StencilSessionEndedPayloadSchema = z.object({
  stencilSessionId: z.string(),
  stencilId: z.string(),
  totalPanelsPrinted: z.number().int().nonnegative().optional(),
  operatorId: z.string().optional()
});

/**
 * Universal Event Envelope Schema.
 */
export const MesEventEnvelopeSchema = z.object({
  eventId: z.string(),
  eventType: CanonicalEventTypeEnum,
  eventTime: z.string(),
  receivedTime: z.string(),
  sourceType: SourceTypeEnum,
  sourceId: z.string(),      // e.g. "fuji-nxt-line1", "tablet-splicing-kiosk"
  sequenceId: z.number().int().nonnegative().optional(),
  siteId: z.string().default('SITE-01'),
  workCenterId: z.string(),
  assetPath: z.string().optional(),
  ingressEventId: z.string().optional(),
  workOrderId: z.string().optional(),
  batchId: z.string().optional(),
  operatorId: z.string().optional(),
  correlationId: z.string().optional(),
  payload: z.record(z.any())
});

export type MesEventEnvelope = z.infer<typeof MesEventEnvelopeSchema>;
