import {
  CanonicalAoiInspectionResult,
  QualityDispositionType,
  CadCoordinateDefinition
} from '@mes/shared';

export interface SentinelEvaluationResult {
  interlockTripped: boolean;
  trippedSignatures: Array<{
    signature: string;
    refDes: string;
    defectType: string;
    consecutiveCount: number;
    slidingWindowCount: number;
    reason: string;
  }>;
}

export interface IngestionResult {
  idempotentDuplicate: boolean;
  inspectionId: string;
  result: 'PASS' | 'FAIL';
  totalDefects: number;
  qualityHoldApplied: boolean;
  interlockTripped: boolean;
  sentinelEvaluation: SentinelEvaluationResult;
}

export interface ReplacementVerificationResult {
  valid: boolean;
  errors: string[];
  expectedMpn: string;
  replacementMpn?: string;
  reelLot?: string;
  supplierName?: string;
  currentCycle: number;
  maxReworkCycles: number;
}

export interface ExecuteReplacementParams {
  defectId: string;
  panelBarcode: string;
  unitPosition: number;
  refDes: string;
  technicianId: string;
  stationId?: string;
  replacementReelId: string;
  reworkMethod?: string;
  temperatureProfileId?: string;
}

export interface PostReworkInspectionParams {
  panelBarcode: string;
  unitPosition: number;
  defectId: string;
  result: 'PASS' | 'FAIL';
  inspectorId: string;
  notes?: string;
}

export interface DefectCorrelationReport {
  panelBarcode: string;
  unitPosition: number;
  refDes: string;
  defectType?: string;
  partNumber: string;
  packageType: string;
  cadCoordinates: {
    xMm: number;
    yMm: number;
    rotationDeg: number;
    boardSide: string;
  };
  feederSlot?: {
    moduleNo: number;
    slotNo: number;
    feederId: string;
    feederType: string;
  };
  componentReel?: {
    reelId: string;
    lotNumber: string;
    supplierName: string;
    dateCode: string;
    mslClass: string;
    mslRemainingMinutes: number;
  };
  nozzleTelemetry?: {
    nozzleId: string;
    recentErrorCount: number;
    lastErrorType: string;
  };
  solderPaste?: {
    jarId: string;
    lotNumber: string;
    partNumber: string;
    alloyType: string;
    status: string;
  };
  stencil?: {
    stencilId: string;
    serialNumber: string;
    revision: string;
  };
  rootCauseHypothesis: string;
}

export interface IDefectLifecycleModule {
  ingestInspection(canonical: CanonicalAoiInspectionResult): Promise<IngestionResult>;
  recordDisposition(params: {
    defectId: string;
    panelBarcode: string;
    unitPosition: number;
    disposition: QualityDispositionType;
    reason: string;
    authorizedBy: string;
  }): Promise<{ success: boolean; dispositionId: string; status: string }>;
  verifyReplacement(
    panelBarcode: string,
    unitPosition: number,
    refDes: string,
    replacementReelId: string
  ): Promise<ReplacementVerificationResult>;
  executeReplacement(params: ExecuteReplacementParams): Promise<{
    success: boolean;
    reworkEventId: string;
    reworkCycle: number;
    message: string;
  }>;
  verifyPostRework(params: PostReworkInspectionParams): Promise<{
    success: boolean;
    panelStatus: string;
    message: string;
  }>;
  evaluateRepeatDefects(
    canonical: CanonicalAoiInspectionResult,
    programId?: string,
    programRevision?: number
  ): Promise<SentinelEvaluationResult>;
  correlate(
    panelBarcode: string,
    unitPosition?: number,
    refDes?: string
  ): Promise<DefectCorrelationReport>;
  getPanelQuality(panelBarcode: string): Promise<any>;
  getCadDefinitions(
    programId?: string,
    revision?: number,
    boardSide?: string
  ): Promise<CadCoordinateDefinition[]>;
  getDefectHeatmap(programId?: string, revision?: number): Promise<any[]>;
}
