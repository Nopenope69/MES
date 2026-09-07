import crypto from 'crypto';
import {
  CanonicalAoiInspectionResult,
  CanonicalAoiDefect,
  DefectCategory
} from '@mes/shared';
import { IAoiAdapter, AoiParseContext } from './aoi-adapter.interface';

export class OmronAoiAdapter implements IAoiAdapter {
  readonly vendor = 'OMRON_VT_S_SERIES';
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

    const panelBarcode =
      data.PanelBarcode ||
      data.PanelId ||
      data.panelBarcode ||
      'UNKNOWN_PANEL';

    const sourceInspectionId =
      context?.sourceInspectionId ||
      data.InspectionNumber ||
      data.InspectionId ||
      data.sourceInspectionId ||
      `OMRON-${Date.now()}`;

    const opticalMachineId =
      context?.opticalMachineId ||
      data.MachineName ||
      data.opticalMachineId ||
      'OMRON-VT-S730';

    const workCenterId =
      context?.workCenterId ||
      data.WorkCenterId ||
      data.workCenterId ||
      'wc-aoi-01';

    const batchId =
      context?.batchId ||
      data.LotNumber ||
      data.batchId ||
      data.jobId;

    const inspectionPhase =
      context?.inspectionPhase ||
      data.inspectionPhase ||
      'POST_REFLOW';

    const rawJudge = (data.Judge || data.result || 'OK').toString().toUpperCase();
    const result: 'PASS' | 'FAIL' = rawJudge === 'OK' || rawJudge === 'PASS' ? 'PASS' : 'FAIL';
    const durationSeconds = Number(data.TactTime || data.durationSeconds || 0);
    const timestamp = data.InspectDateTime || data.timestamp || new Date().toISOString();

    const rawItems = data.DefectItems || data.defects || [];
    const defects: CanonicalAoiDefect[] = rawItems.map((item: any, idx: number) => {
      const refDes = item.PartsName || item.refDes || item.windowName || `UNK-${idx + 1}`;
      const unitPosition = Number(item.UnitNo || item.unitPosition || 1);
      const rawCode = (item.ErrorCode || item.defectType || item.defectCode || 'UNKNOWN').toString().toUpperCase();

      // Normalize Omron defect code
      let normalizedType = rawCode;
      if (rawCode === 'NG_TOMBSTONE' || rawCode === 'TOMBSTONE') normalizedType = 'TOMBSTONE';
      else if (rawCode === 'NG_SHORT' || rawCode === 'BRIDGING' || rawCode === 'BRIDGE') normalizedType = 'BRIDGING';
      else if (rawCode === 'NG_INSUFFICIENT' || rawCode === 'INSUFFICIENT') normalizedType = 'INSUFFICIENT_SOLDER';
      else if (rawCode === 'NG_EXCESS' || rawCode === 'EXCESS') normalizedType = 'EXCESS_SOLDER';
      else if (rawCode === 'NG_MISSING' || rawCode === 'MISSING') normalizedType = 'MISSING';
      else if (rawCode === 'NG_SHIFT' || rawCode === 'MISALIGNED') normalizedType = 'MISALIGNED';
      else if (rawCode === 'NG_POLARITY' || rawCode === 'REVERSED_POLARITY') normalizedType = 'REVERSED_POLARITY';
      else if (rawCode === 'NG_LIFTED' || rawCode === 'LIFTED_LEAD') normalizedType = 'LIFTED_LEAD';

      let category: DefectCategory = 'SOLDER';
      if (['MISSING', 'MISALIGNED', 'REVERSED_POLARITY', 'WRONG_PART', 'BILLBOARDING'].includes(normalizedType)) {
        category = 'COMPONENT';
      }

      return {
        defectId: item.DefectId || item.defectId || `OMR-DEF-${idx + 1}`,
        unitPosition,
        refDes,
        category,
        defectType: normalizedType,
        boardSide: (item.BoardSide || item.boardSide || 'TOP').toString().toUpperCase() === 'BOTTOM' ? 'BOTTOM' : 'TOP',
        offsetXUm: item.PosX !== undefined ? Number(item.PosX) : (item.offsetXUm !== undefined ? Number(item.offsetXUm) : undefined),
        offsetYUm: item.PosY !== undefined ? Number(item.PosY) : (item.offsetYUm !== undefined ? Number(item.offsetYUm) : undefined),
        rotationDeg: item.Angle !== undefined ? Number(item.Angle) : (item.rotationDeg !== undefined ? Number(item.rotationDeg) : undefined),
        defectSignature: item.defectSignature,
        imageRef: item.ImagePath || item.imageRef
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
