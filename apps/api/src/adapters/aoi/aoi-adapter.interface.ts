import { CanonicalAoiInspectionResult } from '@mes/shared';

export interface AoiParseContext {
  sourceInspectionId?: string;
  sourceFileHash?: string;
  workCenterId?: string;
  opticalMachineId?: string;
  batchId?: string;
  inspectionPhase?: 'POST_REFLOW' | 'PRE_REFLOW' | 'POST_REWORK';
}

export interface IAoiAdapter {
  readonly vendor: string;
  readonly supportedFormats: string[];
  parseInspection(
    payload: string | Buffer | Record<string, any>,
    context?: AoiParseContext
  ): Promise<CanonicalAoiInspectionResult> | CanonicalAoiInspectionResult;
}
