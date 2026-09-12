import { Router, Request, Response } from 'express';
import { FleetOrchestrationService } from '../services/fleet-orchestration.service';
import { ProductionMetricsService } from '../services/production-metrics.service';
import { requirePermission } from '../middleware/auth.middleware';
import { Permission } from '../security/permissions';

export const fleetRouter = Router();
const fleetService = FleetOrchestrationService.getInstance();
const metricsService = ProductionMetricsService.getInstance();

/**
 * GET /api/v1/fleet/overview
 * Returns facility & bay-level overview across all production lines and AGV fleet.
 */
fleetRouter.get('/overview', requirePermission(Permission.REPORTS_VIEW), async (_req: Request, res: Response) => {
  try {
    const overview = await fleetService.getFleetOverview();
    res.json({ success: true, data: overview });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/fleet/takt-balancing
 * Returns takt time pacing and load balancing analysis across lines in the bay.
 */
fleetRouter.get('/takt-balancing', requirePermission(Permission.REPORTS_VIEW), async (_req: Request, res: Response) => {
  try {
    const balancing = await fleetService.getBayTaktBalancing();
    res.json({ success: true, data: balancing });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/fleet/lines/:lineId/oee
 * Returns canonical SEMI E10 OEE breakdown for a specific line.
 */
fleetRouter.get('/lines/:lineId/oee', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const lineId = String(req.params.lineId);
    const currentOee = await metricsService.calculateLineOee(lineId);
    const history = await metricsService.getHistoricalMetrics(lineId, 12);
    res.json({ success: true, data: { current: currentOee, history } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/fleet/lines/:lineId/oee/snapshot
 * Captures and persists an immutable OEE metric snapshot.
 */
fleetRouter.post('/lines/:lineId/oee/snapshot', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const lineId = String(req.params.lineId);
    const metrics = await metricsService.calculateLineOee(lineId);
    const snapshotId = await metricsService.recordMetricSnapshot(metrics);
    res.json({ success: true, snapshotId, data: metrics });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
