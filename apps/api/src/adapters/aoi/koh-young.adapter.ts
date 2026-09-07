import crypto from 'crypto';
import {
  CanonicalAoiInspectionResult,
  CanonicalAoiDefect,
  DefectCategory,
  ComponentDefectType,
  SolderDefectType
} from '@mes/shared';
import { IAoiAdapter, AoiParseContext } from './aoi-adapter.interface';

export class KohYoungAoiAdapter implements IAoiAdapter {
  readonly vendor = 'KOH_YOUNG_3D_AOI';
  readonly supportedFormats = ['json', 'xml'];

  parseInspection(
    payload: string | Buffer | Record<string, any>,
    context?: AoiParseContext
  ): CanonicalAoiInspectionResult {
    let rawStr: string;
    let data: any;

    if (Buffer.isBuffer(payload)) {
      rawStr = payload.toString('utf-8');
      data = JSON.parse(rawStr);
    } else if (typeof payload === 'string') {
      rawStr = payload;
      data = JSON.parse(rawStr);
    } else {
      rawStr = JSON.stringify(payload);
      data = payload;
    }

    const computedHash = crypto.createHash('sha256').update(rawStr).digest('hex');
    const sourceFileHash = context?.sourceFileHash || data.sourceFileHash || computedHash;

    // Support both Koh Young native schema and normalized input
    const header = data.InspectionHeader || data;
    const panelBarcode = header.BoardBarcode || header.panelBarcode || header.barcode || 'UNKNOWN_PANEL';
    const sourceInspectionId =
      context?.sourceInspectionId ||
      header.InspectionId ||
      header.sourceInspectionId ||
      header.inspectionId ||
      `KY-${Date.now()}`;
    const opticalMachineId =
      context?.opticalMachineId ||
      header.MachineId ||
      header.opticalMachineId ||
      header.machineId ||
      'KY-ZENITH-01';
    const workCenterId =
      context?.workCenterId ||
      header.WorkCenterId ||
      header.workCenterId ||
      'wc-aoi-01';
    const batchId =
      context?.batchId ||
      header.BatchId ||
      header.batchId ||
      header.jobId;
    const inspectionPhase =
      context?.inspectionPhase ||
      header.InspectionPhase ||
      header.inspectionPhase ||
      'POST_REFLOW';

    const rawResult = (header.Result || header.result || 'PASS').toString().toUpperCase();
    const result: 'PASS' | 'FAIL' = rawResult === 'PASS' || rawResult === 'OK' ? 'PASS' : 'FAIL';
    const durationSeconds = Number(header.DurationSec || header.durationSeconds || 0);
    const timestamp = header.InspectedAt || header.timestamp || new Date().toISOString();

    const rawDefectList = data.DefectList || data.defects || [];
    const defects: CanonicalAoiDefect[] = rawDefectList.map((d: any, idx: number) => {
      const refDes = d.RefDes || d.refDes || `UNK-${idx + 1}`;
      const unitPosition = Number(d.UnitNo || d.unitPosition || d.panelUnitIndex || 1);
      const rawDefectType = (d.DefectType || d.defectType || d.DefectCode || 'UNKNOWN').toString().toUpperCase();
      const boardSide = (d.Side || d.boardSide || 'TOP').toString().toUpperCase() === 'BOTTOM' ? 'BOTTOM' : 'TOP';

      // Categorize defect
      let category: DefectCategory = 'SOLDER';
      if (['MISSING', 'MISALIGNED', 'REVERSED_POLARITY', 'WRONG_PART', 'BILLBOARDING', 'ROTATED'].includes(rawDefectType)) {
        category = 'COMPONENT';
      } else if (['TOMBSTONE', 'BRIDGING', 'INSUFFICIENT_SOLDER', 'EXCESS_SOLDER', 'LIFTED_LEAD', 'SOLDER_BALLS', 'VOID'].includes(rawDefectType)) {
        category = 'SOLDER';
      } else if (d.Category || d.category) {
        category = (d.Category || d.category).toString().toUpperCase() === 'COMPONENT' ? 'COMPONENT' : 'SOLDER';
      }

      return {
        defectId: d.DefectId || d.defectId || `KY-DEF-${idx + 1}`,
        unitPosition,
        refDes,
        category,
        defectType: rawDefectType,
        boardSide,
        offsetXUm: d.OffsetX_um !== undefined ? Number(d.OffsetX_um) : (d.offsetXUm !== undefined ? Number(d.offsetXUm) : undefined),
        offsetYUm: d.OffsetY_um !== undefined ? Number(d.OffsetY_um) : (d.offsetYUm !== undefined ? Number(d.offsetYUm) : undefined),
        rotationDeg: d.Rotation_deg !== undefined ? Number(d.Rotation_deg) : (d.rotationDeg !== undefined ? Number(d.rotationDeg) : undefined),
        defectSignature: d.defectSignature,
        imageRef: d.ImageUri || d.imageRef || d.imageUrl
      };
    });

    const finalResult: 'PASS' | 'FAIL' = defects.length > 0 ? 'FAIL' : result;

    return {
      sourceSystem: this.vendor,
      sourceInspectionId,
      sourceFileHash,
      panelBarcode,
      batchId,
      workCenterId,
      opticalMachineId,
      inspectionPhase,
      result: finalResult,
      totalDefects: defects.length,
      defects,
      durationSeconds,
      timestamp
    };
  }
}
