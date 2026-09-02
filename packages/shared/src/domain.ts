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
  mslRemainingMinutes: number; // Floor life remaining in minutes
  status: 'READY' | 'MOUNTED' | 'SPLICED' | 'DEPLETED' | 'EXPIRED_MSL' | 'QUARANTINED';
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
  nodes: GenealogyNode[];
  edges: GenealogyEdge[];
}
