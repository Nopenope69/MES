/**
 * IPC-2591 Connected Factory Exchange (IPC-CFX) Version 1.7
 * Standard message definitions for SMT Test, Inspection & Screen Printing.
 */

export const CFX_VERSION = '1.7';

export interface CfxMessageEnvelope<T = any> {
  cfxVersion: string; // "1.7"
  messageName: string; // e.g. "CFX.Production.TestAndInspection.UnitsInspected"
  sourceUri: string; // e.g. "cfx:ky-aspire3-01@dixon-p4"
  targetUri?: string; // e.g. "cfx:mes-core@dixon-p4"
  timestamp: string;
  uniqueId: string;
  data: T;
}

export interface CfxPadMeasurementData {
  padId: string;
  unitPosition: number;
  refDes: string;
  pinNo?: number;
  volumeRatioPct: number;
  heightUm: number;
  areaRatioPct: number;
  offsetXUm: number;
  offsetYUm: number;
  isCriticalPad?: boolean;
  defectType?: string;
}

export interface CfxUnitsInspectedData {
  inspectionPhase: 'SolderPasteInspection' | 'PreReflowInspection' | 'PostReflowInspection';
  panelBarcode: string;
  batchId?: string;
  overallResult: 'Passed' | 'Warning' | 'Failed';
  totalPadsInspected: number;
  defectivePadsCount: number;
  meanVolumePct: number;
  sigmaVolumePct: number;
  measurements: CfxPadMeasurementData[];
  durationSeconds?: number;
}

export interface CfxExecuteCleaningData {
  equipmentId: string;
  cleaningMode: 'Dry' | 'Vacuum' | 'Solvent' | 'VacuumSolvent';
  triggerReason: string;
  requestedBy: string;
}

export interface CfxModifyProcessParametersData {
  equipmentId: string;
  parameterName: 'SqueegeePressure' | 'SeparationSpeed' | 'PrintSpeed';
  targetValue: number;
  unit: string;
  triggerReason: string;
  requestedBy: string;
}

export interface CfxCommandResponse {
  transactionId: string;
  status: 'Success' | 'Failure';
  equipmentId: string;
  message: string;
  appliedValue?: number;
  timestamp: string;
}
