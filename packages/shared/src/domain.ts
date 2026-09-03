import { EquipmentState } from './state-machine';

/**
 * ISA-95 Part 3 Physical Asset Hierarchy Interfaces for EMS / SMT.
 * Organization -> Site -> Area -> ProductionLine -> WorkCenter -> EquipmentUnit
 */
export interface Organization {
  id: string;
  code: string;
  name: string;
}

export interface Site {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  location: string;
  timezone: string;
}

export interface Area {
  id: string;
  siteId: string;
  code: string;
  name: string;
  type: 'SMT_CLEANROOM' | 'THROUGH_HOLE' | 'TESTING_AOI' | 'BOX_BUILD_ASSEMBLY' | 'WAREHOUSE';
}

export interface ProductionLine {
  id: string;
  areaId: string;
  code: string;
  name: string;
}

export interface WorkCenter {
  id: string;
  lineId?: string;
  code: string;
  name: string;
  area: string;
  type: 'SMT_LINE' | 'SCREEN_PRINTER' | 'PICK_AND_PLACE' | 'REFLOW_OVEN' | 'AOI_INSPECTION' | 'WAVE_SOLDERING';
  assetPath: string; // e.g. "DIXON.NOIDA-P4.SMT-A.LINE-01.WC-NXT-01"
  currentState: EquipmentState;
  currentBatchId?: string;       // Active Job / Work Order
  currentProgramName?: string;  // Active Fuji setup program (e.g. "PROG-SM-METER-TOP-REV4")
  currentOperatorId?: string;
  moduleCount?: number;         // e.g. 4 modules for Fuji NXT III M6
  lastStateChangeTime: string;
}

export interface EquipmentUnit {
  id: string;
  workCenterId: string;
  code: string;
  name: string;
  type: 'MODULE' | 'STAGE' | 'FEEDER' | 'NOZZLE_HEAD' | 'SQUEEGEE' | 'CONVEYOR';
}

export interface Product {
  id: string;
  code: string;
  name: string;
  description?: string;
  uom: string; // "PANEL" or "BOARD"
  category: 'SMART_METER' | 'AUTOMOTIVE_ECU' | 'CONSUMER_IOT' | 'TELECOM_5G' | 'INDUSTRIAL_CONTROLLER';
}

export interface SmtBomItem {
  id: string;
  programId: string;
  moduleNo: number;
  stageNo: number;
  slotNo: number;
  subSlotNo: number;
  partNumber: string;
  description: string;
  packageType: string; // "0402", "0603", "0805", "QFN-32", "LQFP-64", "BGA-144"
  referenceDesignators: string; // "C12, C14, C18, R22"
  pointsPerBoard: number;
}

export interface SmtProgram {
  id: string;
  code: string;
  productCode: string;
  revision: number;
  name: string;
  targetCycleTimeSeconds: number; // e.g. 18.5 seconds per panel
  panelsPerJob: number;
  items: SmtBomItem[];
}

export interface Shift {
  id: string;
  code: 'SHIFT_A' | 'SHIFT_B' | 'SHIFT_C' | 'GENERAL';
  name: string;
  startTime: string; // "06:00"
  endTime: string;   // "14:00"
}

export interface Operator {
  id: string;
  code: string;
  name: string;
  role: 'OPERATOR' | 'LINE_LEADER' | 'SMT_SUPERVISOR' | 'QUALITY_INSPECTOR';
  pin: string;
}

export type SmtJobStatus = 'PLANNED' | 'READY' | 'RUNNING' | 'STOPPED' | 'COMPLETED' | 'QUARANTINED';

export interface SmtJob {
  id: string;
  batchNumber: string;         // Job Run Number e.g. "JOB-SM-260901"
  workOrderNumber: string;     // Work Order e.g. "WO-2026-DIXON-01"
  productCode: string;
  productName: string;
  recipeCode: string;          // Program Code e.g. "PROG-SM-METER-TOP-REV4"
  workCenterId: string;
  workCenterName: string;
  status: SmtJobStatus;
  startedAt?: string;
  completedAt?: string;
  plannedQuantity: number;     // Target Panels
  actualQuantity: number;      // Produced Panels
  rejectedQuantity: number;    // Skipped / Rejected Panels
  unit: string;
  operatorId?: string;
  operatorName?: string;
}

export interface ComponentReel {
  id: string;
  reelId: string;              // Barcode UID on reel
  partNumber: string;          // Manufacturer Part No (MPN)
  partName: string;
  supplierName: string;        // e.g. "Murata Electronics", "Vishay", "STMicroelectronics"
  lotNumber: string;           // Vendor Lot Number
  dateCode: string;            // e.g. "202612"
  initialQuantity: number;     // e.g. 5000 or 10000
  currentQuantity: number;
  unit: string;                // "PCS"
  mslLevel: number;            // Moisture Sensitivity Level: 1 (unlimited) to 6
  mslClass?: MslClass;         // JEDEC Standard MSL Classification
  mslRemainingMinutes: number; // Floor life remaining in minutes (derived read projection)
  mbbOpenedAt?: string;
  mbbResealedAt?: string;
  storageLocation?: string;
  storageState?: 'SEALED_MBB' | 'AMBIENT_EXPOSURE' | 'DRY_STORAGE' | 'BAKING';
  floorClockState?: 'SEALED' | 'FLOOR_EXPOSURE' | 'DRY_STORAGE' | 'BAKE_REQUIRED' | 'BAKING';
  floorLifeNominalMinutes?: number;
  floorLifeExpiresAt?: string;
  status: 'READY' | 'MOUNTED' | 'SPLICED' | 'DEPLETED' | 'EXPIRED_MSL' | 'QUARANTINED';
}

export type MslClass = 'MSL_1' | 'MSL_2' | 'MSL_2A' | 'MSL_3' | 'MSL_4' | 'MSL_5' | 'MSL_5A' | 'MSL_6';

export const JEDEC_NOMINAL_FLOOR_LIFE_MINUTES: Record<MslClass, number> = {
  MSL_1: 999999, // Unlimited (<= 30C / 85% RH)
  MSL_2: 525600, // 1 Year
  MSL_2A: 40320, // 4 Weeks
  MSL_3: 10080,  // 168 Hours (7 Days)
  MSL_4: 4320,   // 72 Hours
  MSL_5: 2880,   // 48 Hours
  MSL_5A: 1440,  // 24 Hours
  MSL_6: 0       // Mandatory Bake before use
};

export interface SolderPasteProfile {
  id: string;
  manufacturer: string;
  productCode: string;
  alloyType: string;
  storageMinC: number;
  storageMaxC: number;
  thawRequiredMinutes: number;
  minimumProcessingTemperatureC: number;
  mixingRequired: boolean;
  mixingMethod: string;
  mixingMinSeconds: number;
  mixingMaxSeconds: number;
  stencilLifeMinutes: number;
  shelfLifeDays: number;
  standardOrTdsReference: string;
  revision: string;
  active: boolean;
}

export interface SolderPasteJar {
  id: string;
  jarId: string;
  partNumber: string;
  profileId: string;
  alloyType: string;
  lotNumber: string;
  expiryDate: string;
  status: 'REFRIGERATED' | 'THAWING' | 'THAWED' | 'MIXED' | 'AUTHORIZED' | 'ON_STENCIL' | 'DEPLETED' | 'EXPIRED' | 'DISCARDED';
  removedFromColdAt?: string;
  thawVerifiedAt?: string;
  thawDurationMinutes: number;
  temperatureVerifiedAt?: string;
  temperatureVerifiedC?: number;
  mixedAt?: string;
  mixedDurationSeconds: number;
  mixingMethod?: string;
  currentStencilSessionId?: string;
  currentWorkCenterId: string;
}

export interface Stencil {
  id: string;
  stencilId: string;
  partNumber: string;
  revision: string;
  stencilSerialNumber: string;
  status: 'AVAILABLE' | 'IN_USE' | 'CLEANING_REQUIRED' | 'SCRAPPED';
}

export interface StencilSession {
  id: string;
  stencilId: string;
  workCenterId: string;
  batchId?: string;
  startedAt: string;
  endedAt?: string;
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
  lifeExpiresAt?: string;
}

export interface FeederSlotMapping {
  id: string;
  workCenterId: string;
  moduleNo: number;
  stageNo: number;
  slotNo: number;
  feederId: string;            // Feeder RFID / Barcode UID
  feederType: string;          // e.g. "W08f (8mm High Speed)"
  assignedPartNumber: string;
  currentReelId?: string;
  currentReelQuantity?: number;
  mslClass?: MslClass;
  mslState?: string;
  mslRemainingMinutes?: number;
  status: 'OK' | 'LOW_PARTS' | 'PARTS_OUT' | 'WRONG_PART' | 'EMPTY';
}

export interface FeederPickupStats {
  moduleNo: number;
  slotNo: number;
  partNumber: string;
  feederId: string;
  pickupCount: number;
  errorParts: number;        // Vision processing errors
  rejectParts: number;       // Manual or nozzle dropped rejects
  dislodgedParts: number;    // Missed pickups
  noPickup: number;          // Empty feeder pickups
  errorRatePercentage: number;
}

export interface PanelCheckoutRecord {
  id: string;
  panelBarcode: string;
  workCenterId: string;
  jobId: string;
  programName: string;
  cycleTimeSeconds: number;
  blockCount: number;
  blockSkipCount: number;
  skipBitmask?: string;
  completedAt: string;
}

export interface SmtShiftSummaryReport {
  shiftCode: string;
  date: string;
  totalPlannedMinutes: number;
  operatingMinutes: number;
  downtimeMinutes: number;
  availabilityPercentage: number;
  totalPanelsProduced: number;
  totalPanelsSkipped: number;
  totalComponentsPlaced: number;
  componentsPerHour: number;  // Actual CPH
  targetComponentsPerHour: number;
  qualityPercentage: number;
  topDowntimeReasons: Array<{
    reasonCode: string;
    reasonLabel: string;
    category: string;
    durationMinutes: number;
    occurrences: number;
  }>;
  topFeederErrors: FeederPickupStats[];
}

export interface ShiftSummaryReport {
  shiftCode: string;
  date: string;
  totalPlannedMinutes: number;
  operatingMinutes: number;
  downtimeMinutes: number;
  availabilityPercentage: number;
  goodQuantity: number;
  rejectedQuantity: number;
  qualityPercentage: number;
  batchesCompleted?: number;
  topDowntimeReasons: Array<{
    reasonCode: string;
    reasonLabel: string;
    category: string;
    durationMinutes: number;
    occurrences: number;
  }>;
}

export interface GenealogyNode {
  id: string;
  label: string;
  type: 'FINISHED_PANEL' | 'COMPONENT_REEL' | 'SMT_EQUIPMENT' | 'SMT_JOB';
  code: string;
  details: Record<string, any>;
}

export interface GenealogyEdge {
  from: string;
  to: string;
  relation: 'PLACED_ON' | 'MOUNTED_IN' | 'PART_OF';
}

export interface GenealogyTree {
  rootId: string;
  rootNodeId?: string;
  nodes: GenealogyNode[];
  edges: GenealogyEdge[];
}
