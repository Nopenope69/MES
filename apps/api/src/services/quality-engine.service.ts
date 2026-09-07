import {
  CanonicalAoiInspectionResult,
  QualityDispositionType,
  CadCoordinateDefinition
} from '@mes/shared';
import { DefectLifecycleModule } from '../modules/defect-lifecycle/defect-lifecycle.module';
import { IngestionResult } from '../modules/defect-lifecycle/defect-lifecycle.interface';

export type { IngestionResult };

/**
 * QualityEngineService (Backward-compatible facade delegating to DefectLifecycleModule).
 */
export class QualityEngineService {
  public static async ingestInspection(canonical: CanonicalAoiInspectionResult): Promise<IngestionResult> {
    return DefectLifecycleModule.getInstance().ingestInspection(canonical);
  }

  public static async recordDisposition(params: {
    defectId: string;
    panelBarcode: string;
    unitPosition: number;
    disposition: QualityDispositionType;
    reason: string;
    authorizedBy: string;
  }): Promise<{ success: boolean; dispositionId: string; status: string }> {
    return DefectLifecycleModule.getInstance().recordDisposition(params);
  }

  public static async getPanelQuality(panelBarcode: string): Promise<any> {
    return DefectLifecycleModule.getInstance().getPanelQuality(panelBarcode);
  }

  public static async getCadDefinitions(
    programId: string = 'PROG-SM-METER-TOP-REV4',
    programRevision: number = 4,
    boardSide: string = 'TOP'
  ): Promise<CadCoordinateDefinition[]> {
    return DefectLifecycleModule.getInstance().getCadDefinitions(programId, programRevision, boardSide);
  }

  public static async getDefectHeatmap(
    programId: string = 'PROG-SM-METER-TOP-REV4',
    revision: number = 4
  ): Promise<any[]> {
    return DefectLifecycleModule.getInstance().getDefectHeatmap(programId, revision);
  }
}
