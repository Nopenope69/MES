// apps/api/src/modules/traceability/traceability.interface.ts
import {
  QualityState,
  QualityDispositionType,
  DefectCategory,
  ComponentDefectType,
  SolderDefectType,
  MslClass,
  SmtJobStatus,
  CadCoordinateDefinition
} from '@mes/shared';

// Provenance & Confidence metadata
export type LinkageSource =
  | 'DIRECT_FK'
  | 'HISTORICAL_ASSIGNMENT'
  | 'TEMPORAL_CORRELATION'
  | 'EVENT_CORRELATION'
  | 'CURRENT_STATE_FALLBACK';

export type LinkageConfidence =
  | 'EXACT'
  | 'INFERRED'
  | 'AMBIGUOUS'
  | 'UNVERIFIED';

export interface LinkageMetadata {
  source: LinkageSource;
  confidence: LinkageConfidence;
  detail?: string;
}

// Strict domain type definitions
export type ReworkMethod =
  | 'HOT_AIR_DESOLDER_SOLDERING_IRON'
  | 'MANUAL_RESOLDER'
  | 'COMPONENT_REPLACEMENT'
  | 'CLEAN';

export type DhrStatus =
  | 'DRAFT'
  | 'PENDING_QA_REVIEW'
  | 'RELEASED'
  | 'REJECTED'
  | 'QUARANTINED'
  | 'UNISSUED';

export type DefectStatus =
  | 'OPEN'
  | 'IN_REWORK'
  | 'REWORKED'
  | 'CLOSED'
  | 'SCRAPPED';

export type RecallTargetType =
  | 'COMPONENT_REEL'
  | 'COMPONENT_LOT'
  | 'PASTE_LOT'
  | 'STENCIL_SERIAL';

// Unit-Level Placement Item
export interface UnitPlacementItem {
  refDes: string;
  partNumber: string;
  packageType: string;
  cadCoordinates: {
    xMm: number;
    yMm: number;
    rotationDeg: number;
    boardSide: 'TOP' | 'BOTTOM';
  };
  feederSlot: {
    moduleNo: number;
    slotNo: number;
    feederId: string;
    feederType: string;
  };
  componentReel: {
    reelId: string;
    lotNumber: string;
    supplierName: string;
    dateCode: string;
    mslClass: MslClass;
    mslRemainingMinutes: number;
  };
  linkage: LinkageMetadata;
}

// Unit-Level As-Built Record
export interface UnitGenealogyRecord {
  panelBarcode: string;
  unitPosition: number;
  unitSerialNumber: string | null;
  unitStatus: QualityState;

  batch: {
    batchId: string;
    batchNumber: string;
    productCode: string;
    recipeCode: string;
    workOrderNumber: string;
    workCenterId: string;
    operatorId: string | null;
    status: SmtJobStatus;
    startedAt: string | null;
    completedAt: string | null;
  };

  placementChain: UnitPlacementItem[];

  solderPaste: Array<{
    jarId: string;
    lotNumber: string;
    alloyType: string;
    thawVerifiedAt?: string;
    mixedAt?: string;
    temperatureVerifiedC?: number | null;
    linkage: LinkageMetadata;
  }>;

  stencil: {
    stencilId: string;
    serialNumber: string;
    revision: string;
    sessionStartedAt: string;
    linkage: LinkageMetadata;
  } | null;

  spiInspection: {
    inspectionId: string;
    result: 'PASS' | 'WARNING' | 'FAIL';
    totalPads: number;
    defectivePads: number;
    meanVolumePct?: number;
    sigmaVolumePct?: number;
    inspectedAt: string;
    opticalMachineId: string;
    unitCriticalPads: Array<{
      padId: string;
      refDes: string;
      volumeRatioPct: number;
      heightUm: number;
      areaRatioPct: number;
      offsetXUm: number;
      offsetYUm: number;
      defectType?: string;
    }>;
  } | null;

  reflowProfile: {
    profileRunId: string;
    overallPwi: number;
    complianceResult: 'PASS' | 'WARNING' | 'FAIL';
    worstCharacteristic?: string;
    recipeId: string;
    equipmentId: string;
    lineId: string;
    approvedBy?: string;
    approvedAt?: string;
    linkage: LinkageMetadata;
  } | null;

  aoiInspections: Array<{
    inspectionId: string;
    phase: 'PRE_REFLOW' | 'POST_REFLOW' | 'POST_REWORK';
    result: 'PASS' | 'FAIL';
    totalDefects: number;
    inspectedAt: string;
    opticalMachineId: string;
    unitDefects: Array<{
      defectId: string;
      refDes: string;
      defectCategory: DefectCategory;
      defectType: ComponentDefectType | SolderDefectType;
      defectSignature: string;
      boardSide: 'TOP' | 'BOTTOM';
      status: DefectStatus;
      imageRef?: string;
    }>;
  }>;

  reworkHistory: Array<{
    defectId: string;
    refDes: string;
    disposition: QualityDispositionType;
    dispositionReason: string;
    authorizedBy: string;
    dispositionAt: string;
    execution?: {
      technicianId: string;
      stationId: string;
      oldMpn: string;
      oldReelId?: string;
      replacementMpn: string;
      replacementReelId: string;
      reworkMethod: ReworkMethod;
      reworkCycle: number;
      reworkedAt: string;
    };
    postReworkInspection?: {
      result: 'PASS' | 'FAIL';
      inspectorId: string;
      inspectedAt: string;
    };
  }>;

  dhr: {
    dhrNumber: string;
    status: DhrStatus;
    sha256Checksum: string;
    qaReviewerId: string | null;
    qaReleasedAt: string | null;
  } | null;

  complianceLedger: {
    dhrSignatures: Array<{
      sequenceNumber: number;
      currentHash: string;
      actorId: string;
      actorRole: string;
      actionType: string;
      signedAt: string;
    }>;
  } | null;
}

// Panel-Level Record
export interface PanelGenealogyRecord {
  panelBarcode: string;
  checkout: {
    workCenterId: string;
    programName: string;
    cycleTimeSeconds: number;
    blockCount: number;
    blockSkipCount: number;
    completedAt: string;
    profileRunId?: string | null;
  };
  batch: UnitGenealogyRecord['batch'];
  units: UnitGenealogyRecord[];
}

// Batch-Level Summary Record (Set-Based)
export interface BatchGenealogyRecord {
  batch: UnitGenealogyRecord['batch'];
  dhr: UnitGenealogyRecord['dhr'];
  summary: {
    totalPanels: number;
    totalUnits: number;
    passedUnits: number;
    heldUnits: number;
    scrappedUnits: number;
    totalDefects: number;
    reworkCount: number;
  };
  panels: Array<{
    panelBarcode: string;
    completedAt: string;
    unitCount: number;
    hasDefects: boolean;
  }>;
  materialsConsumed: Array<{
    partNumber: string;
    reelId: string;
    lotNumber: string;
    supplierName: string;
    quantityConsumed: number;
  }>;
}

// Recall & Containment Report (Set-Based)
export interface RecallContainmentReport {
  queryTarget: string;
  targetType: RecallTargetType;
  status: 'CONTAINED' | 'AMBIGUOUS_IDENTIFIER' | 'NOT_FOUND';
  ambiguityDetail?: string;
  containmentRecommendation: 'QUARANTINE_REQUIRED' | 'INVESTIGATION_REQUIRED' | 'NO_ACTION';
  affectedBatches: Array<{
    batchId: string;
    batchNumber: string;
    productCode: string;
    workOrderNumber: string;
    dhrStatus: string;
  }>;
  affectedPanels: Array<{
    panelBarcode: string;
    batchNumber: string;
    completedAt: string;
  }>;
  affectedUnits: Array<{
    panelBarcode: string;
    unitPosition: number;
    unitSerialNumber: string | null;
    unitStatus: QualityState;
    affectedRefDes: string[];
    mountedReelId?: string;
  }>;
  summary: {
    totalBatchesAffected: number;
    totalPanelsAffected: number;
    totalUnitsAffected: number;
    quarantineScope: string;
  };
}

// Module Service Seam
export interface ITraceabilityModule {
  getUnitGenealogy(panelBarcode: string, unitPosition: number): Promise<UnitGenealogyRecord>;
  getPanelGenealogy(panelBarcode: string): Promise<PanelGenealogyRecord>;
  getBatchGenealogy(batchNumberOrId: string): Promise<BatchGenealogyRecord>;
  recallByIdentifier(identifier: string): Promise<RecallContainmentReport>;
  lookupBySerialNumber(serialNumber: string): Promise<UnitGenealogyRecord>;
}
