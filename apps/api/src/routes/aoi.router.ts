import { Router, Request, Response } from 'express';
import { QualityEngineService } from '../services/quality-engine.service';
import { ReworkExecutionService } from '../services/rework-execution.service';
import { DefectCorrelationService } from '../services/defect-correlation.service';
import { RepeatDefectSentinelService } from '../services/repeat-defect-sentinel.service';
import { defaultAoiGateway } from '../adapters/aoi/aoi-gateway-manager';
import { CanonicalAoiInspectionResult } from '@mes/shared';
import { requirePermission } from '../middleware/auth.middleware';
import { Permission } from '../security/permissions';

export const aoiRouter = Router();

/**
 * POST /api/v1/aoi/inspections
 * Ingests AOI inspection results (vendor-neutral or vendor-specific like Koh Young / Omron).
 * Enforces deduplication via (source_system, source_inspection_id, source_file_hash).
 */
aoiRouter.post('/inspections', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const vendor = (req.query.vendor || req.headers['x-aoi-vendor'] || req.body.sourceSystem || 'KOH_YOUNG_3D_AOI') as string;
    let canonical: CanonicalAoiInspectionResult;

    if (req.body.panelBarcode && Array.isArray(req.body.defects) && req.body.sourceFileHash) {
      canonical = req.body as CanonicalAoiInspectionResult;
    } else {
      canonical = await defaultAoiGateway.parse(vendor, req.body, {
        sourceInspectionId: req.body.sourceInspectionId,
        sourceFileHash: req.body.sourceFileHash,
        workCenterId: req.body.workCenterId,
        opticalMachineId: req.body.opticalMachineId,
        batchId: req.body.batchId,
        inspectionPhase: req.body.inspectionPhase
      });
    }

    const result = await QualityEngineService.ingestInspection(canonical);
    res.status(result.idempotentDuplicate ? 200 : 201).json({
      success: true,
      data: result
    });
  } catch (err: any) {
    console.error('[AOI Router] Ingestion error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/aoi/panels/:panelBarcode
 * Retrieves complete quality status, multi-up units, defects, and history for a panel.
 */
aoiRouter.get('/panels/:panelBarcode', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const panelBarcode = String(req.params.panelBarcode);
    const data = await QualityEngineService.getPanelQuality(panelBarcode);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/aoi/cad/:programId/:programRevision
 * Retrieves CAD coordinates for visual PCB rendering.
 */
aoiRouter.get('/cad/:programId/:programRevision', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const programId = String(req.params.programId);
    const programRevision = String(req.params.programRevision);
    const boardSide = String(req.query.boardSide || 'TOP');
    const cad = await QualityEngineService.getCadDefinitions(
      programId,
      parseInt(programRevision, 10),
      boardSide
    );
    res.json({ success: true, data: cad });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/aoi/disposition
 * Records formal engineering disposition (REWORK, SCRAP, ACCEPT_AS_IS, REINSPECT).
 */
aoiRouter.post('/disposition', requirePermission(Permission.QUALITY_APPROVE), async (req: Request, res: Response) => {
  try {
    const { defectId, panelBarcode, unitPosition, disposition, reason } = req.body;
    const authorizedBy = req.user?.code || req.user?.id;
    if (!authorizedBy) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: missing authenticated user context'
      });
    }
    if (!defectId || !panelBarcode || !disposition || !reason) {
      return res.status(400).json({
        success: false,
        error: 'Missing required disposition fields: defectId, panelBarcode, disposition, reason'
      });
    }

    const result = await QualityEngineService.recordDisposition({
      defectId,
      panelBarcode,
      unitPosition: Number(unitPosition || 1),
      disposition,
      reason,
      authorizedBy
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/aoi/rework/verify-replacement
 * Verifies replacement component reel against BOM MPN, MSL floor life, and CAD thermal rework cycle limits.
 */
aoiRouter.post('/rework/verify-replacement', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const { panelBarcode, unitPosition, refDes, replacementReelId } = req.body;
    if (!panelBarcode || !refDes || !replacementReelId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required verification fields: panelBarcode, refDes, replacementReelId'
      });
    }

    const result = await ReworkExecutionService.verifyReplacement(
      panelBarcode,
      Number(unitPosition || 1),
      refDes,
      replacementReelId
    );

    res.json({ success: result.valid, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/aoi/rework/execute
 * Records physical component replacement on the rework bench.
 */
aoiRouter.post('/rework/execute', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const {
      defectId,
      panelBarcode,
      unitPosition,
      refDes,
      stationId,
      replacementReelId,
      reworkMethod,
      temperatureProfileId
    } = req.body;
    const technicianId = req.user?.code || req.user?.id || req.body.technicianId;

    if (!defectId || !panelBarcode || !refDes || !technicianId || !replacementReelId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required rework fields: defectId, panelBarcode, refDes, technicianId, replacementReelId'
      });
    }

    const result = await ReworkExecutionService.executeReplacement({
      defectId,
      panelBarcode,
      unitPosition: Number(unitPosition || 1),
      refDes,
      technicianId,
      stationId,
      replacementReelId,
      reworkMethod,
      temperatureProfileId
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/aoi/post-rework-inspect
 * Closed-loop quality gate: records mandatory post-rework optical inspection.
 */
aoiRouter.post('/post-rework-inspect', requirePermission(Permission.QUALITY_APPROVE), async (req: Request, res: Response) => {
  try {
    const { panelBarcode, unitPosition, defectId, result, notes } = req.body;
    const inspectorId = req.user?.code || req.user?.id || req.body.inspectorId;
    if (!panelBarcode || !defectId || !result || !inspectorId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: panelBarcode, defectId, result, inspectorId'
      });
    }

    const resObj = await ReworkExecutionService.recordPostReworkInspection({
      panelBarcode,
      unitPosition: Number(unitPosition || 1),
      defectId,
      result,
      inspectorId,
      notes
    });

    res.json({ success: true, data: resObj });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/aoi/interlocks/clear
 * Clears repeat defect production interlock on SMT line.
 */
aoiRouter.post('/interlocks/clear', requirePermission(Permission.QUALITY_APPROVE), async (req: Request, res: Response) => {
  try {
    const { workCenterId, reason } = req.body;
    const authorizedBy = req.user?.code || req.user?.id;
    if (!authorizedBy) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: missing authenticated user context'
      });
    }
    if (!workCenterId || !reason) {
      return res.status(400).json({
        success: false,
        error: 'Missing required interlock clear fields: workCenterId, reason'
      });
    }

    await RepeatDefectSentinelService.clearInterlock(workCenterId, authorizedBy, reason);
    res.json({ success: true, message: `Production interlock cleared for ${workCenterId}` });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/aoi/correlation/:panelBarcode/:unitPosition/:refDes
 * Upstream root-cause correlation (RefDes -> Feeder Slot -> Reel Lot -> Nozzle -> Paste Jar -> Stencil).
 */
aoiRouter.get('/correlation/:panelBarcode/:unitPosition/:refDes', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const panelBarcode = String(req.params.panelBarcode);
    const unitPosition = String(req.params.unitPosition);
    const refDes = String(req.params.refDes);
    const report = await DefectCorrelationService.correlate(
      panelBarcode,
      parseInt(unitPosition, 10),
      refDes
    );
    res.json({ success: true, data: report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
