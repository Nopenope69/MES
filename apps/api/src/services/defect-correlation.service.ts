import { DefectLifecycleModule } from '../modules/defect-lifecycle/defect-lifecycle.module';
import { DefectCorrelationReport } from '../modules/defect-lifecycle/defect-lifecycle.interface';

export type { DefectCorrelationReport };

/**
 * DefectCorrelationService (Backward-compatible facade delegating to DefectLifecycleModule).
 */
export class DefectCorrelationService {
  /**
   * Correlates an optical inspection defect back to the SMT line root-cause components:
   * RefDes -> CAD -> Feeder Slot -> Reel Lot -> Nozzle ID -> Solder Paste Lot -> Stencil Session
   */
  public static async correlate(
    panelBarcode: string,
    unitPosition: number = 1,
    refDes: string
  ): Promise<DefectCorrelationReport> {
    return DefectLifecycleModule.getInstance().correlate(panelBarcode, unitPosition, refDes);
  }
}
