import { Router, Request, Response } from 'express';
import { MetricsService } from '../services/metrics.service';
import { SloMonitorService } from '../services/slo-monitor.service';
import { ChaosInjectionService, ChaosExperimentPlan } from '../services/chaos-injection.service';
import { requirePermission } from '../middleware/auth.middleware';
import { Permission } from '../security/permissions';

export const sreRouter = Router();

/**
 * GET /api/v1/sre/slos
 * Returns live SLI evaluations, error budget consumption, and burn rates.
 */
sreRouter.get('/slos', requirePermission(Permission.REPORTS_VIEW), async (_req: Request, res: Response) => {
  try {
    const report = await SloMonitorService.evaluateSlos();
    res.json({
      success: true,
      data: report
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to evaluate SLOs'
    });
  }
});

/**
 * POST /api/v1/sre/chaos/run
 * Executes a controlled industrial chaos experiment with strict safety abort criteria.
 */
sreRouter.post(
  '/chaos/run',
  requirePermission(Permission.SYSTEM_MANAGE),
  async (req: Request, res: Response) => {
  try {
    const plan: ChaosExperimentPlan = req.body;
    if (!plan.experimentId || !plan.target || !plan.attackType) {
      return res.status(400).json({
        success: false,
        error: 'Missing required chaos plan fields: experimentId, target, attackType'
      });
    }

    const result = await ChaosInjectionService.runExperiment(plan);
    res.json({
      success: true,
      data: result
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || 'Chaos experiment execution failed'
    });
  }
});
