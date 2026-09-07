export type SplicingDecisionCode =
  | 'APPROVED'
  | 'BLOCKED_SLOT_NOT_CONFIGURED'
  | 'BLOCKED_BOM_MISMATCH'
  | 'BLOCKED_REEL_NOT_FOUND'
  | 'BLOCKED_REEL_EXPIRED'
  | 'BLOCKED_MSL_EXPIRED'
  | 'BLOCKED_REEL_NOT_USABLE';

export type PrinterDecisionCode =
  | 'APPROVED'
  | 'BLOCKED_NO_STENCIL'
  | 'BLOCKED_NO_PASTE'
  | 'BLOCKED_PASTE_NOT_AUTHORIZED'
  | 'BLOCKED_STENCIL_EXPIRED'
  | 'BLOCKED_STENCIL_CLEANING_REQUIRED';

export type ReworkReelDecisionCode =
  | 'APPROVED'
  | 'BLOCKED_BOM_MISMATCH'
  | 'BLOCKED_REEL_NOT_FOUND'
  | 'BLOCKED_MSL_EXPIRED'
  | 'BLOCKED_REEL_NOT_USABLE';

export interface SplicingAuthParams {
  workCenterId: string;
  slotNo: number;
  scannedPartNumber: string;
  scannedReelId?: string;
  operatorId?: string;
  lineId?: string;
}

export interface SplicingDecision {
  allowed: boolean;
  decisionCode: SplicingDecisionCode;
  expectedPartNumber?: string;
  actualPartNumber?: string;
  reelId?: string;
  feederId?: string;
  currentReelId?: string;
  mslClass?: string;
  mslState?: string;
  mslRemainingMinutes?: number;
  reason: string;
  auditEventId?: string;
}

export interface PrinterAuthParams {
  workCenterId: string;
  batchId?: string;
  stencilId?: string;
  pasteJarId?: string;
  operatorId?: string;
}

export interface PrinterAuthDecision {
  allowed: boolean;
  decisionCode: PrinterDecisionCode;
  workCenterId: string;
  stencilId?: string;
  pasteJarId?: string;
  stencilSessionId?: string;
  remainingLifeMinutes?: number;
  reason: string;
  auditEventId?: string;
}

export interface ReworkReelAuthParams {
  reelId: string;
  expectedPartNumber: string;
  operatorId?: string;
  stationId?: string;
}

export interface ReworkReelAuthDecision {
  allowed: boolean;
  decisionCode: ReworkReelDecisionCode;
  reelId: string;
  partNumber: string;
  expectedPartNumber: string;
  mslClass?: string;
  mslState?: string;
  mslRemainingMinutes?: number;
  reason: string;
  auditEventId?: string;
}

export interface IMaterialGateModule {
  authorizeFeederSplice(params: SplicingAuthParams): Promise<SplicingDecision>;
  authorizeScreenPrinter(params: PrinterAuthParams): Promise<PrinterAuthDecision>;
  authorizeReworkReel(params: ReworkReelAuthParams): Promise<ReworkReelAuthDecision>;
}
