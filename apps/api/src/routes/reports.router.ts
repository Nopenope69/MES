import { Router, Request, Response } from 'express';
import { OeeReportService } from '../services/oee-report.service';
import { requirePermission } from '../middleware/auth.middleware';
import { Permission } from '../security/permissions';

export const reportsRouter = Router();

// Shift summary OEE and Downtime Pareto
reportsRouter.get('/shift-summary', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const { workCenterId, shiftCode } = req.query;
    const summary = await OeeReportService.getShiftSummary(
      workCenterId as string | undefined,
      shiftCode as string | undefined
    );
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
