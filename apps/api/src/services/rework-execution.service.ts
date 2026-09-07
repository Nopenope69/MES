import { DefectLifecycleModule } from '../modules/defect-lifecycle/defect-lifecycle.module';
import {
  ReplacementVerificationResult,
  ExecuteReplacementParams,
  PostReworkInspectionParams
} from '../modules/defect-lifecycle/defect-lifecycle.interface';

export type {
  ReplacementVerificationResult,
  ExecuteReplacementParams,
  PostReworkInspectionParams
};

/**
 * ReworkExecutionService (Backward-compatible facade delegating to DefectLifecycleModule).
 */
export class ReworkExecutionService {
  /**
   * Verifies replacement component reel against BOM MPN, CAD thermal rework limits,
   * and computed-on-read JEDEC MSL floor-life.
   */
  public static async verifyReplacement(
    panelBarcode: string,
    unitPosition: number = 1,
    refDes: string,
    replacementReelId: string
  ): Promise<ReplacementVerificationResult> {
    return DefectLifecycleModule.getInstance().verifyReplacement(
      panelBarcode,
      unitPosition,
      refDes,
      replacementReelId
    );
  }

  /**
   * Executes the physical component replacement on the rework bench.
   */
  public static async executeReplacement(params: ExecuteReplacementParams): Promise<{
    success: boolean;
    reworkCycle: number;
    message: string;
  }> {
    const res = await DefectLifecycleModule.getInstance().executeReplacement(params);
    return {
      success: res.success,
      reworkCycle: res.reworkCycle,
      message: res.message
    };
  }

  /**
   * Records post-rework optical inspection.
   */
  public static async recordPostReworkInspection(params: PostReworkInspectionParams): Promise<{
    success: boolean;
    result: 'PASS' | 'FAIL';
    finalStatus: string;
    message: string;
  }> {
    const res = await DefectLifecycleModule.getInstance().verifyPostRework(params);
    return {
      success: res.success,
      result: params.result,
      finalStatus: res.panelStatus,
      message: res.message
    };
  }
}
