import { Router, Request, Response } from 'express';
import { ReflowProfilingModule } from '../modules/reflow-profiling/reflow-profiling.module';
import { requirePermission } from '../middleware/auth.middleware';
import { Permission } from '../security/permissions';

export const reflowRouter = Router();
const reflowModule = ReflowProfilingModule.getInstance();

/**
 * POST /api/v1/reflow/profiles/import
 * Imports a physical thermocouple profile run file (KIC, Datapaq, M.O.L.E., CSV).
 * Accepts JSON payload with fileContent (string or base64) or buffer.
 */
reflowRouter.post('/profiles/import', requirePermission(Permission.EQUIPMENT_MAINTAIN), async (req: Request, res: Response) => {
  try {
    const {
      fileName,
      fileContent,
      fileBase64,
      lineId,
      equipmentId,
      recipeId,
      boardPartNumber,
      boardRevision
    } = req.body;
    const importedBy = req.user?.code || req.user?.id || req.body.importedBy || 'OPERATOR-SMT';

    if (!fileName) {
      return res.status(400).json({ success: false, error: 'fileName is required' });
    }
    if (!lineId || !equipmentId || !recipeId || !boardPartNumber || !boardRevision) {
      return res.status(400).json({
        success: false,
        error: 'Applicability scope (lineId, equipmentId, recipeId, boardPartNumber, boardRevision) is required'
      });
    }

    let buffer: Buffer;
    const anyReq = req as any;
    if (fileBase64) {
      buffer = Buffer.from(fileBase64, 'base64');
    } else if (typeof fileContent === 'string') {
      buffer = Buffer.from(fileContent, 'utf8');
    } else if (anyReq.file && anyReq.file.buffer) {
      buffer = anyReq.file.buffer;
    } else {
      return res.status(400).json({ success: false, error: 'fileContent, fileBase64, or multipart file required' });
    }

    const result = await reflowModule.importProfileRun({
      file: {
        fileName,
        buffer,
        fileSizeBytes: buffer.length
      },
      lineId,
      equipmentId,
      recipeId,
      boardPartNumber,
      boardRevision,
      importedBy
    });

    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/reflow/profiles/active
 * Resolves current active profile baseline for an applicability scope.
 */
reflowRouter.get('/profiles/active', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const lineId = req.query.lineId as string;
    const equipmentId = req.query.equipmentId as string;
    const recipeId = req.query.recipeId as string;
    const boardPartNumber = req.query.boardPartNumber as string;
    const boardRevision = req.query.boardRevision as string;
    const includeProbes = req.query.includeProbes !== 'false';

    if (!lineId || !equipmentId || !recipeId || !boardPartNumber || !boardRevision) {
      return res.status(400).json({
        success: false,
        error: 'Missing required query parameters: lineId, equipmentId, recipeId, boardPartNumber, boardRevision'
      });
    }

    const result = await reflowModule.getActiveProfile({
      lineId,
      equipmentId,
      recipeId,
      boardPartNumber,
      boardRevision,
      includeProbes
    });

    if (!result) {
      return res.status(404).json({ success: false, error: 'No active profile found for the specified scope' });
    }

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/reflow/profiles/:id
 * Fetches profile run and probes by ID.
 */
reflowRouter.get('/profiles/:id', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const includeProbes = req.query.includeProbes !== 'false';
    const result = await reflowModule.getProfileRunById(id, includeProbes);

    if (!result) {
      return res.status(404).json({ success: false, error: `Profile run not found: ${id}` });
    }

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/reflow/profiles/:id/approve
 * QA sign-off (21 CFR Part 11 electronic signature).
 */
reflowRouter.post(
  '/profiles/:id/approve',
  requirePermission(Permission.QUALITY_APPROVE),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { approvedBy, electronicSignature, comments } = req.body;

      const effectiveApprover = req.user?.code || req.user?.id || approvedBy || 'QA-INSPECTOR';

      const run = await reflowModule.approveProfileRun({
        runId: id,
        approvedBy: effectiveApprover,
        electronicSignature,
        comments
      });

      res.json({ success: true, data: run });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

/**
 * POST /api/v1/reflow/profiles/:id/reject
 * QA rejection of profile run.
 */
reflowRouter.post(
  '/profiles/:id/reject',
  requirePermission(Permission.QUALITY_APPROVE),
  async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const rejectedBy = req.user?.code || req.user?.id || req.body.rejectedBy || 'QA-INSPECTOR';
    const reason = req.body.reason;

    if (!reason) {
      return res.status(400).json({ success: false, error: 'reason is required' });
    }

    const run = await reflowModule.rejectProfileRun({
      runId: id,
      rejectedBy,
      reason
    });

    res.json({ success: true, data: run });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/reflow/profiles/:id/activate
 * Activates profile run as current production baseline (PWI-FAIL guarded).
 */
reflowRouter.post('/profiles/:id/activate', requirePermission(Permission.RECIPE_MANAGE), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const activatedBy = req.user?.code || req.user?.id || req.body.activatedBy;

    if (!activatedBy) {
      return res.status(400).json({ success: false, error: 'activatedBy is required' });
    }

    const run = await reflowModule.activateProfileRun({
      runId: id,
      activatedBy
    });

    res.json({ success: true, data: run });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/reflow/process-state/:lineId/:equipmentId
 * Gets active process compliance state snapshot.
 */
reflowRouter.get('/process-state/:lineId/:equipmentId', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const lineId = String(req.params.lineId);
    const equipmentId = String(req.params.equipmentId);
    const recipeId = req.query.recipeId as string;
    const boardPartNumber = req.query.boardPartNumber as string;
    const boardRevision = req.query.boardRevision as string;

    if (!recipeId || !boardPartNumber || !boardRevision) {
      return res.status(400).json({
        success: false,
        error: 'Missing required query parameters: recipeId, boardPartNumber, boardRevision'
      });
    }

    const state = await reflowModule.getProcessState({
      lineId,
      equipmentId,
      recipeId,
      boardPartNumber,
      boardRevision
    });

    res.json({ success: true, data: state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/reflow/drift/evaluate
 * Evaluates live continuous oven telemetry drift.
 */
reflowRouter.post('/drift/evaluate', requirePermission(Permission.EQUIPMENT_MAINTAIN), async (req: Request, res: Response) => {
  try {
    const {
      lineId,
      equipmentId,
      recipeId,
      boardPartNumber,
      boardRevision,
      windowSeconds,
      simulatedTelemetry
    } = req.body;

    if (!lineId || !equipmentId || !recipeId || !boardPartNumber || !boardRevision) {
      return res.status(400).json({
        success: false,
        error: 'lineId, equipmentId, recipeId, boardPartNumber, boardRevision are required'
      });
    }

    const report = await reflowModule.evaluateOvenDrift({
      lineId,
      equipmentId,
      recipeId,
      boardPartNumber,
      boardRevision,
      windowSeconds: windowSeconds ? Number(windowSeconds) : undefined,
      simulatedTelemetry
    });

    res.json({ success: true, data: report });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/reflow/specifications/:recipeId
 * Scoped query: GET /api/v1/reflow/specifications/:recipeId?boardPartNumber=...&boardRevision=...&version=...
 */
reflowRouter.get('/specifications/:recipeId', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const recipeId = String(req.params.recipeId);
    const boardPartNumber = req.query.boardPartNumber as string;
    const boardRevision = req.query.boardRevision as string;
    const version = req.query.version ? Number(req.query.version) : undefined;

    if (!boardPartNumber || !boardRevision) {
      return res.status(400).json({
        success: false,
        error: 'boardPartNumber and boardRevision query parameters are required'
      });
    }

    const spec = await reflowModule.getThermalSpecification({
      recipeId,
      boardPartNumber,
      boardRevision,
      version
    });

    if (!spec) {
      return res.status(404).json({ success: false, error: 'Thermal specification not found' });
    }

    res.json({ success: true, data: spec });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/reflow/specifications
 * Registers a new versioned thermal specification.
 */
reflowRouter.post(
  '/specifications',
  requirePermission(Permission.RECIPE_MANAGE),
  async (req: Request, res: Response) => {
    try {
      const spec = await reflowModule.registerThermalSpecification(req.body);
      res.status(201).json({ success: true, data: spec });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);
