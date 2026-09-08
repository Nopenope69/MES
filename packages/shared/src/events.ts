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
  'BATCH_COMPLETED',
  'SPI_INSPECTION_COMPLETED',
  'AOI_INSPECTION_COMPLETED',
  'DEFECT_RECORDED',
  'QUALITY_HOLD_APPLIED',
  'QUALITY_DISPOSITION_DECIDED',
  'REWORK_STARTED',
  'COMPONENT_REPLACED',
  'POST_REWORK_INSPECTION_COMPLETED',
  'REWORK_COMPLETED',
  'REPEAT_DEFECT_INTERLOCK_TRIPPED',
  'PANEL_SCRAPPED',
  'SPI_INSPECTION_RECORDED',
  'PRINTER_CLEANING_COMMANDED',
  'PRINTER_PARAMETERS_MODIFIED',
  'PRINTER_COMMAND_ACKNOWLEDGED',
  'CLOSED_LOOP_CORRECTION_VERIFIED',
  'PRE_REFLOW_PANEL_DIVERTED',
  'AGV_MISSION_DISPATCHED',
  'AGV_MISSION_STATE_CHANGED',
  'AGV_MISSION_BLOCKED',
  'AGV_MISSION_FAILED',
  'AGV_MISSION_COMPLETED',
  'MATERIAL_REPLENISHMENT_REQUESTED',
  'MATERIAL_RESERVED',
  'MATERIAL_DELIVERED',
  'PREDICTIVE_ANOMALY_DETECTED',
  'PREDICTIVE_ACTION_RECOMMENDED',
  'PREDICTIVE_ACTION_AUTHORIZED',
  'PREDICTIVE_ACTION_EXECUTED',
  'PREDICTIVE_ACTION_FAILED',
  // Phase 6: Closed-Loop Reflow Thermal Profiling & Drift
  'REFLOW_PROFILE_UPLOADED',
  'REFLOW_PROFILE_VALIDATED',
  'REFLOW_PROFILE_COMPLIANCE_EVALUATED',
  'REFLOW_PROFILE_APPROVED',
  'REFLOW_PROFILE_REJECTED',
  'REFLOW_PROFILE_ACTIVATED',
  'REFLOW_PROFILE_RETIRED',
  'REFLOW_DRIFT_DETECTED',
  'REFLOW_PROCESS_STATE_CHANGED',
  'REFLOW_INTERLOCK_REQUESTED',
  'REFLOW_INTERLOCK_CONFIRMED',
  'REFLOW_INTERLOCK_FAILED',
  'REFLOW_REVALIDATION_REQUESTED'
]);
export type CanonicalEventType = z.infer<typeof CanonicalEventTypeEnum>;
export type MesEventType = CanonicalEventType;

export const SourceTypeEnum = z.enum([
  'MANUAL_UI',
  'INTEGRATION_SOCKET',
  'SYSTEM',
  'CSV_IMPORT',
  'AOI_GATEWAY',
  'QUALITY_ENGINE',
  'QUALITY_SENTINEL',
  'REWORK_KIOSK',
  'AOI_POST_REWORK',
  'SPI_GATEWAY',
  'PRINTER_CONTROLLER',
  'IPC_CFX_BROKER',
  'AGV_FLEET',
  'LOGISTICS_MANAGER',
  'PREDICTIVE_ENGINE',
  'PROFILER_GATEWAY',
  'REFLOW_CONTROLLER'
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

export const AoiInspectionCompletedPayloadSchema = z.object({
  panelBarcode: z.string(),
  batchId: z.string().optional(),
  inspectionPhase: z.enum(['POST_REFLOW', 'PRE_REFLOW', 'POST_REWORK']).default('POST_REFLOW'),
  result: z.enum(['PASS', 'FAIL']),
  totalDefects: z.number().int().nonnegative(),
  inspectionDurationSeconds: z.number().optional(),
  opticalMachineId: z.string(),
  sourceSystem: z.string(),
  sourceInspectionId: z.string(),
  sourceFileHash: z.string()
});

export const DefectRecordedPayloadSchema = z.object({
  defectId: z.string(),
  panelBarcode: z.string(),
  unitPosition: z.number().int().positive().default(1),
  refDes: z.string(),
  defectCategory: z.enum(['COMPONENT', 'SOLDER']),
  defectType: z.string(),
  defectSignature: z.string(),
  offsetXUm: z.number().optional(),
  offsetYUm: z.number().optional(),
  rotationDeg: z.number().optional(),
  boardSide: z.enum(['TOP', 'BOTTOM']).default('TOP')
});

export const QualityHoldAppliedPayloadSchema = z.object({
  panelBarcode: z.string(),
  holdReason: z.string(),
  defectCount: z.number().int().positive(),
  workCenterId: z.string(),
  appliedBy: z.string().default('QUALITY_ENGINE')
});

export const QualityDispositionPayloadSchema = z.object({
  panelBarcode: z.string(),
  unitPosition: z.number().int().positive().optional(),
  defectId: z.string().optional(),
  disposition: z.enum(['REWORK', 'SCRAP', 'ACCEPT_AS_IS', 'REINSPECT']),
  reason: z.string(),
  authorizedBy: z.string()
});

export const ComponentReplacedPayloadSchema = z.object({
  panelBarcode: z.string(),
  unitPosition: z.number().int().positive().default(1),
  refDes: z.string(),
  defectId: z.string(),
  technicianId: z.string(),
  oldMpn: z.string(),
  oldReelId: z.string().optional(),
  replacementMpn: z.string(),
  replacementReelId: z.string(),
  reworkMethod: z.string().default('HOT_AIR_DESOLDER_SOLDERING_IRON'),
  temperatureProfileId: z.string().optional(),
  reworkCycle: z.number().int().positive()
});

export const PostReworkInspectionPayloadSchema = z.object({
  panelBarcode: z.string(),
  defectId: z.string().optional(),
  inspectorId: z.string(),
  result: z.enum(['PASS', 'FAIL']),
  comments: z.string().optional()
});

export const SpiInspectionCompletedPayloadSchema = AoiInspectionCompletedPayloadSchema;

export const QualityDispositionDecidedPayloadSchema = QualityDispositionPayloadSchema;

export const ReworkStartedPayloadSchema = z.object({
  panelBarcode: z.string(),
  unitPosition: z.number().int().positive().default(1),
  technicianId: z.string(),
  defectId: z.string().optional()
});

export const PostReworkInspectionCompletedPayloadSchema = PostReworkInspectionPayloadSchema;

export const ReworkCompletedPayloadSchema = z.object({
  panelBarcode: z.string(),
  unitPosition: z.number().int().positive().default(1),
  defectId: z.string().optional(),
  technicianId: z.string(),
  reworkCycle: z.number().int().positive().optional(),
  notes: z.string().optional()
});

export const RepeatDefectInterlockTrippedPayloadSchema = z.object({
  programId: z.string().optional(),
  programRevision: z.number().optional(),
  workCenterId: z.string(),
  machineId: z.string().optional(),
  refDes: z.string().optional(),
  defectType: z.string().optional(),
  consecutiveCount: z.number().optional(),
  slidingWindowFailures: z.number().optional(),
  thresholdLimit: z.number().optional(),
  actionTaken: z.string().optional(),
  reason: z.string().optional()
});

export const PanelScrappedPayloadSchema = z.object({
  panelBarcode: z.string(),
  unitPosition: z.number().int().positive().optional(),
  reason: z.string(),
  authorizedBy: z.string()
});

// Phase 4: Solder Paste Inspection & Printer Closed-Loop Schemas
export const SpiInspectionRecordedPayloadSchema = z.object({
  inspectionId: z.string(),
  sourceSystem: z.string(),
  sourceInspectionId: z.string(),
  sourceFileHash: z.string(),
  panelBarcode: z.string(),
  batchId: z.string().optional(),
  workCenterId: z.string(),
  opticalMachineId: z.string(),
  result: z.enum(['PASS', 'WARNING', 'FAIL']),
  totalPadsInspected: z.number().int().nonnegative(),
  defectivePadsCount: z.number().int().nonnegative(),
  meanVolumePct: z.number(),
  sigmaVolumePct: z.number(),
  measurements: z.array(z.any()).optional(),
  durationSeconds: z.number().optional()
});

export const PrinterCleaningCommandedPayloadSchema = z.object({
  correctionId: z.string(),
  workCenterId: z.string(),
  cleaningMode: z.enum(['DRY', 'VACUUM', 'SOLVENT', 'VACUUM_SOLVENT']),
  triggerCondition: z.string(),
  affectedApertures: z.array(z.string()).optional()
});

export const PrinterParametersModifiedPayloadSchema = z.object({
  correctionId: z.string(),
  workCenterId: z.string(),
  parameterName: z.enum(['SQUEEGEE_PRESSURE', 'SEPARATION_SPEED', 'PRINT_SPEED']),
  oldValue: z.number(),
  proposedValue: z.number(),
  delta: z.number(),
  unit: z.string().default('kgf'),
  triggerCondition: z.string(),
  recipeId: z.string()
});

export const PrinterCommandAcknowledgedPayloadSchema = z.object({
  correctionId: z.string(),
  workCenterId: z.string(),
  status: z.enum(['ACKNOWLEDGED', 'REJECTED', 'EXECUTED']),
  printerMessage: z.string().optional()
});

export const ClosedLoopCorrectionVerifiedPayloadSchema = z.object({
  correctionId: z.string(),
  verificationPanelBarcode: z.string(),
  status: z.enum(['VERIFIED_RECOVERED', 'VERIFIED_FAILED']),
  observedDeltaVolumePct: z.number(),
  notes: z.string().optional()
});

export const PreReflowPanelDivertedPayloadSchema = z.object({
  panelBarcode: z.string(),
  reason: z.string(),
  divertConveyorId: z.string().default('CONVEYOR-WASH-BUF-01'),
  criticalDefectsCount: z.number()
});

// Phase 5: Logistics & AGV Event Payloads
export const AgvMissionDispatchedPayloadSchema = z.object({
  missionId: z.string(),
  agvId: z.string(),
  missionType: z.enum(['REEL_DELIVERY', 'PASTE_DELIVERY', 'EMPTY_RETURN', 'MAGAZINE_TRANSFER']),
  materialType: z.enum(['COMPONENT_REEL', 'SOLDER_PASTE_JAR', 'STENCIL', 'PCB_MAGAZINE']),
  materialId: z.string(),
  sourceLocation: z.string(),
  targetLineId: z.string(),
  targetWorkCenterId: z.string(),
  priority: z.enum(['CRITICAL', 'HIGH', 'STANDARD']).default('STANDARD')
});

export const AgvMissionStateChangedPayloadSchema = z.object({
  missionId: z.string(),
  agvId: z.string(),
  previousState: z.string(),
  newState: z.enum([
    'CREATED',
    'QUEUED',
    'DISPATCHED',
    'EN_ROUTE_PICKUP',
    'PICKING_UP',
    'EN_ROUTE_DELIVERY',
    'DELIVERING',
    'COMPLETED',
    'CANCELLED',
    'FAILED',
    'BLOCKED',
    'RETURN_TO_BASE'
  ]),
  location: z.string().optional(),
  batteryPercent: z.number().optional(),
  reason: z.string().optional()
});

export const AgvMissionBlockedPayloadSchema = z.object({
  missionId: z.string(),
  agvId: z.string(),
  reason: z.string(),
  location: z.string().optional()
});

export const AgvMissionFailedPayloadSchema = z.object({
  missionId: z.string(),
  agvId: z.string(),
  failureCode: z.string(),
  reason: z.string()
});

export const AgvMissionCompletedPayloadSchema = z.object({
  missionId: z.string(),
  agvId: z.string(),
  targetLineId: z.string(),
  materialId: z.string(),
  completedAt: z.string()
});

export const MaterialReplenishmentRequestedPayloadSchema = z.object({
  requestId: z.string(),
  lineId: z.string(),
  workCenterId: z.string(),
  slotNo: z.number().int().positive(),
  partNumber: z.string(),
  currentReelId: z.string().optional(),
  remainingQuantity: z.number().int().nonnegative(),
  estimatedMinutesRemaining: z.number(),
  confidence: z.enum(['ACTUAL_PLACEMENT_TELEMETRY', 'MACHINE_REPORTED', 'THEORETICAL_FALLBACK'])
});

export const MaterialReservedPayloadSchema = z.object({
  reservationId: z.string(),
  reelId: z.string(),
  lineId: z.string(),
  slotNo: z.number().int().positive(),
  partNumber: z.string(),
  reservedForRequestId: z.string().optional()
});

export const MaterialDeliveredPayloadSchema = z.object({
  requestId: z.string().optional(),
  reservationId: z.string().optional(),
  reelId: z.string(),
  lineId: z.string(),
  workCenterId: z.string(),
  slotNo: z.number().int().positive(),
  deliveryConfirmedBy: z.string()
});

// Phase 5: Predictive Quality Intelligence Payloads
export const PredictiveAnomalyDetectedPayloadSchema = z.object({
  anomalyId: z.string(),
  anomalyType: z.enum(['NOZZLE_PICKUP_DEGRADATION', 'APERTURE_CLOGGING_TREND', 'FEEDER_INDEXING_JITTER']),
  lineId: z.string(),
  workCenterId: z.string(),
  assetId: z.string(),
  metric: z.string(),
  score: z.number(),
  confidence: z.number(),
  baselineValue: z.number(),
  observedValue: z.number(),
  details: z.record(z.any()).optional()
});

export const PredictiveActionRecommendedPayloadSchema = z.object({
  actionId: z.string(),
  anomalyId: z.string(),
  actionType: z.enum(['CLEAN_STENCIL', 'INSPECT_NOZZLE', 'REPLACE_FEEDER', 'MICRO_TUNE_PRESSURE']),
  targetWorkCenterId: z.string(),
  parameters: z.record(z.any()).optional(),
  reason: z.string(),
  priority: z.enum(['CRITICAL', 'HIGH', 'STANDARD']).default('STANDARD')
});

export const PredictiveActionAuthorizedPayloadSchema = z.object({
  actionId: z.string(),
  authorizedBy: z.string(),
  authorizationMode: z.enum(['MANUAL_OVERRIDE', 'POLICY_AUTO']),
  authorizedAt: z.string()
});

export const PredictiveActionExecutedPayloadSchema = z.object({
  actionId: z.string(),
  executedAt: z.string(),
  success: z.boolean(),
  commandResult: z.record(z.any()).optional()
});

export const PredictiveActionFailedPayloadSchema = z.object({
  actionId: z.string(),
  failedAt: z.string(),
  errorCode: z.string(),
  reason: z.string()
});

// Phase 6: Closed-Loop Reflow Thermal Profiling & Drift Payloads
export const ReflowProfileUploadedPayloadSchema = z.object({
  profileRunId: z.string(),
  fileName: z.string(),
  fileSha256: z.string(),
  fileSizeBytes: z.number().int().positive(),
  vendorFormat: z.enum(['KIC', 'DATAPAQ', 'MOLE', 'GENERIC_CSV', 'UNKNOWN']),
  lineId: z.string(),
  equipmentId: z.string(),
  recipeId: z.string(),
  boardPartNumber: z.string(),
  boardRevision: z.string(),
  uploadedBy: z.string(),
  uploadedAt: z.string()
});

export const ReflowProfileValidatedPayloadSchema = z.object({
  profileRunId: z.string(),
  vendorFormat: z.string(),
  probeCount: z.number().int().positive(),
  sampleCount: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  status: z.enum(['SUCCESS', 'VALIDATION_FAILED']),
  validationErrors: z.array(z.string()).optional()
});

export const ReflowProfileComplianceEvaluatedPayloadSchema = z.object({
  profileRunId: z.string(),
  specificationId: z.string(),
  specificationVersion: z.number().int().positive(),
  overallPwi: z.number(),
  complianceResult: z.enum(['PASS', 'WARNING', 'FAIL']),
  evaluatedAt: z.string(),
  worstProbeIndex: z.number().int(),
  worstCharacteristic: z.enum(['RAMP', 'SOAK', 'TAL', 'PEAK', 'COOLING']),
  probeResults: z.array(z.object({
    probeIndex: z.number().int(),
    label: z.string(),
    pwi: z.object({
      overall: z.number(),
      ramp: z.number(),
      soak: z.number(),
      tal: z.number(),
      peak: z.number(),
      cooling: z.number()
    })
  })).optional()
});

export const ReflowProfileApprovedPayloadSchema = z.object({
  profileRunId: z.string(),
  approvedBy: z.string(),
  approvedAt: z.string(),
  overallPwi: z.number(),
  complianceResult: z.enum(['PASS', 'WARNING']),
  comments: z.string().optional(),
  electronicSignature: z.object({
    signerName: z.string(),
    signerRole: z.string(),
    meaning: z.string(),
    timestamp: z.string()
  }).optional()
});

export const ReflowProfileRejectedPayloadSchema = z.object({
  profileRunId: z.string(),
  rejectedBy: z.string(),
  rejectedAt: z.string(),
  reason: z.string(),
  overallPwi: z.number().optional()
});

export const ReflowProfileActivatedPayloadSchema = z.object({
  profileRunId: z.string(),
  supersededProfileRunId: z.string().optional(),
  lineId: z.string(),
  equipmentId: z.string(),
  recipeId: z.string(),
  boardPartNumber: z.string(),
  boardRevision: z.string(),
  activatedBy: z.string(),
  activatedAt: z.string()
});

export const ReflowProfileRetiredPayloadSchema = z.object({
  profileRunId: z.string(),
  retiredBy: z.string(),
  retiredAt: z.string(),
  reason: z.string()
});

export const ReflowDriftDetectedPayloadSchema = z.object({
  lineId: z.string(),
  equipmentId: z.string(),
  recipeId: z.string(),
  boardPartNumber: z.string(),
  boardRevision: z.string(),
  activeProfileRunId: z.string(),
  driftType: z.enum(['MEAN_SHIFT', 'VARIANCE_INSTABILITY', 'CONVEYOR_SPEED_DRIFT', 'OXYGEN_EXCURSION', 'MULTI_ZONE_COLLAPSE']),
  severity: z.enum(['MINOR', 'MODERATE', 'CRITICAL']),
  compositeSeverityScore: z.number(),
  consecutiveDriftSeconds: z.number(),
  driftingZones: z.array(z.object({
    zoneIndex: z.number().int(),
    zoneName: z.string(),
    meanDeviationC: z.number(),
    meanZScore: z.number(),
    variabilityZScore: z.number(),
    windowMeanC: z.number(),
    baselineMeanC: z.number()
  })),
  speedDeviationCmPerMin: z.number().optional(),
  oxygenDeviationPpm: z.number().optional()
});

export const ReflowProcessStateChangedPayloadSchema = z.object({
  lineId: z.string(),
  equipmentId: z.string(),
  recipeId: z.string(),
  boardPartNumber: z.string(),
  boardRevision: z.string(),
  activeProfileRunId: z.string().optional(),
  previousState: z.enum(['COMPLIANT', 'DRIFT_SUSPECTED', 'DRIFT_CONFIRMED', 'REVALIDATION_REQUIRED', 'DATA_INSUFFICIENT']),
  newState: z.enum(['COMPLIANT', 'DRIFT_SUSPECTED', 'DRIFT_CONFIRMED', 'REVALIDATION_REQUIRED', 'DATA_INSUFFICIENT']),
  reason: z.string(),
  changedAt: z.string()
});

export const ReflowInterlockRequestedPayloadSchema = z.object({
  interlockId: z.string(),
  lineId: z.string(),
  equipmentId: z.string(),
  triggerType: z.enum(['CRITICAL_TEMPERATURE_DROP', 'CONVEYOR_STOP', 'EXTREME_DRIFT_CONFIRMED', 'OXYGEN_CONTAMINATION']),
  requestedAction: z.enum(['EMERGENCY_HOLD', 'LINE_STOP', 'INLET_GATE_CLOSE']),
  reason: z.string(),
  requestedAt: z.string(),
  sourceService: z.string().default('ReflowProfilingModule')
});

export const ReflowInterlockConfirmedPayloadSchema = z.object({
  interlockId: z.string(),
  lineId: z.string(),
  equipmentId: z.string(),
  hardwareLatchState: z.string(),
  confirmedAt: z.string(),
  executionDurationMs: z.number().nonnegative()
});

export const ReflowInterlockFailedPayloadSchema = z.object({
  interlockId: z.string(),
  lineId: z.string(),
  equipmentId: z.string(),
  errorCode: z.string(),
  errorMessage: z.string(),
  failedAt: z.string()
});

export const ReflowRevalidationRequestedPayloadSchema = z.object({
  lineId: z.string(),
  equipmentId: z.string(),
  recipeId: z.string(),
  boardPartNumber: z.string(),
  boardRevision: z.string(),
  activeProfileRunId: z.string(),
  reason: z.string(),
  marginDepletedPct: z.number().optional(),
  requestedAt: z.string()
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
  lineId: z.string().optional(),
  workCenterId: z.string(),
  assetPath: z.string().optional(),
  ingressEventId: z.string().optional(),
  workOrderId: z.string().optional(),
  batchId: z.string().optional(),
  operatorId: z.string().optional(),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
  schemaVersion: z.string().optional(),
  payload: z.record(z.any())
});

export type MesEventEnvelope = z.infer<typeof MesEventEnvelopeSchema>;

// Phase 6 Inferred Payload Types
export type ReflowProfileUploadedPayload = z.infer<typeof ReflowProfileUploadedPayloadSchema>;
export type ReflowProfileValidatedPayload = z.infer<typeof ReflowProfileValidatedPayloadSchema>;
export type ReflowProfileComplianceEvaluatedPayload = z.infer<typeof ReflowProfileComplianceEvaluatedPayloadSchema>;
export type ReflowProfileApprovedPayload = z.infer<typeof ReflowProfileApprovedPayloadSchema>;
export type ReflowProfileRejectedPayload = z.infer<typeof ReflowProfileRejectedPayloadSchema>;
export type ReflowProfileActivatedPayload = z.infer<typeof ReflowProfileActivatedPayloadSchema>;
export type ReflowProfileRetiredPayload = z.infer<typeof ReflowProfileRetiredPayloadSchema>;
export type ReflowDriftDetectedPayload = z.infer<typeof ReflowDriftDetectedPayloadSchema>;
export type ReflowProcessStateChangedPayload = z.infer<typeof ReflowProcessStateChangedPayloadSchema>;
export type ReflowInterlockRequestedPayload = z.infer<typeof ReflowInterlockRequestedPayloadSchema>;
export type ReflowInterlockConfirmedPayload = z.infer<typeof ReflowInterlockConfirmedPayloadSchema>;
export type ReflowInterlockFailedPayload = z.infer<typeof ReflowInterlockFailedPayloadSchema>;
export type ReflowRevalidationRequestedPayload = z.infer<typeof ReflowRevalidationRequestedPayloadSchema>;
