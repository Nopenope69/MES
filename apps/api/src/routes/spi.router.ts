import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/database';
import { SpiClosedLoopService } from '../services/spi-closed-loop.service';
import { SpiSpcService } from '../services/spi-spc.service';
import { PrinterControlService } from '../services/printer-control.service';
import { PrinterCapabilityService } from '../services/printer-capability.service';
import { CfxAmqpAdapter } from '../adapters/cfx/cfx-amqp.adapter';
import { CanonicalSpiInspectionResult } from '@mes/shared';
import { requirePermission } from '../middleware/auth.middleware';
import { Permission } from '../security/permissions';

export const spiRouter = Router();
const cfxAdapter = new CfxAmqpAdapter();

/**
 * POST /api/v1/spi/inspections
 * Ingests 3D SPI inspection result (Native IPC-CFX v1.7 or Canonical format)
 * and runs closed-loop diagnosis and verification loop.
 */
spiRouter.post('/inspections', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    let canonical: CanonicalSpiInspectionResult;

    // Detect if input is native IPC-CFX envelope
    if (req.body.cfxVersion || req.body.messageName === 'CFX.Production.TestAndInspection.UnitsInspected') {
      canonical = cfxAdapter.parseUnitsInspected(req.body);
    } else {
      canonical = req.body as CanonicalSpiInspectionResult;
    }

    const recipeId = (req.query.recipeId as string) || (req.body.recipeId as string) || 'PROG-SM-METER-TOP-REV4';
    const diagnosis = await SpiClosedLoopService.processInspection(canonical, recipeId);

    res.status(201).json({
      success: true,
      data: diagnosis
    });
  } catch (err: any) {
    console.error('[SPI Router] Ingestion error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/spi/panels/:panelBarcode
 * Retrieves pad measurements and aperture inspection details for a panel.
 */
spiRouter.get('/panels/:panelBarcode', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const panelBarcode = String(req.params.panelBarcode);

    const inspections = await db.query<{
      id: string;
      source_system: string;
      source_inspection_id: string;
      panel_barcode: string;
      batch_id: string;
      work_center_id: string;
      optical_machine_id: string;
      result: string;
      total_pads_inspected: number;
      defective_pads_count: number;
      mean_volume_pct: number;
      sigma_volume_pct: number;
      inspected_at: string;
    }>(
      `SELECT * FROM spi_inspections WHERE panel_barcode = ? ORDER BY inspected_at DESC LIMIT 1`,
      [panelBarcode]
    );

    if (inspections.length === 0) {
      return res.status(404).json({ success: false, error: `No SPI inspection found for panel ${panelBarcode}` });
    }

    const insp = inspections[0];
    const measurements = await db.query<{
      pad_id: string;
      unit_position: number;
      ref_des: string;
      pin_no: number;
      volume_ratio_pct: number;
      height_um: number;
      area_ratio_pct: number;
      offset_x_um: number;
      offset_y_um: number;
      is_critical_pad: number;
      defect_type: string;
    }>(
      `SELECT * FROM spi_pad_measurements WHERE inspection_id = ? ORDER BY ref_des ASC, pin_no ASC`,
      [insp.id]
    );

    res.json({
      success: true,
      data: {
        inspection: {
          id: insp.id,
          sourceSystem: insp.source_system,
          panelBarcode: insp.panel_barcode,
          batchId: insp.batch_id,
          workCenterId: insp.work_center_id,
          opticalMachineId: insp.optical_machine_id,
          result: insp.result,
          totalPadsInspected: insp.total_pads_inspected,
          defectivePadsCount: insp.defective_pads_count,
          meanVolumePct: insp.mean_volume_pct,
          sigmaVolumePct: insp.sigma_volume_pct,
          inspectedAt: insp.inspected_at
        },
        measurements: measurements.map((m) => ({
          padId: m.pad_id,
          unitPosition: m.unit_position,
          refDes: m.ref_des,
          pinNo: m.pin_no,
          volumeRatioPct: Number(m.volume_ratio_pct),
          heightUm: Number(m.height_um),
          areaRatioPct: Number(m.area_ratio_pct),
          offsetXUm: Number(m.offset_x_um),
          offsetYUm: Number(m.offset_y_um),
          isCriticalPad: Boolean(m.is_critical_pad),
          defectType: m.defect_type || undefined
        }))
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/spi/spc/:recipeId
 * Retrieves rolling SPC metrics with strict N >= 30 sample size validation.
 */
spiRouter.get('/spc/:recipeId', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const recipeId = String(req.params.recipeId);
    const spc = await SpiSpcService.calculateSpc(recipeId);
    res.json({ success: true, data: spc });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/spi/printer/capabilities
 * Retrieves screen printer declared IPC-CFX capabilities.
 */
spiRouter.get('/printer/capabilities', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const equipmentId = (req.query.equipmentId as string) || 'wc-spg-01';
    const caps = await PrinterCapabilityService.getPrinterCapabilities(equipmentId);
    res.json({ success: true, data: caps });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/spi/printer/process-window/:recipeId
 * Retrieves recipe-specific process windows and machine limits.
 */
spiRouter.get('/printer/process-window/:recipeId', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const recipeId = String(req.params.recipeId);
    const window = await PrinterControlService.getProcessWindow(recipeId);
    res.json({ success: true, data: window });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/spi/tuning-history
 * Retrieves full audit log of closed loop printer modifications and verification results.
 */
spiRouter.get('/tuning-history', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const history = await PrinterControlService.getTuningHistory(limit);
    res.json({ success: true, data: history });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/spi/printer/clean
 * Triggers manual or authorized stencil underside cleaning.
 */
spiRouter.post('/printer/clean', requirePermission(Permission.EQUIPMENT_MAINTAIN), async (req: Request, res: Response) => {
  try {
    const result = await PrinterControlService.executeCleaning({
      equipmentId: req.body.equipmentId || 'wc-spg-01',
      workCenterId: req.body.workCenterId || 'wc-spg-01',
      recipeId: req.body.recipeId || 'PROG-SM-METER-TOP-REV4',
      cleaningMode: req.body.cleaningMode || 'VACUUM_SOLVENT',
      triggerCondition: req.body.triggerCondition || 'Manual operator trigger from 3D SPI Station',
      affectedApertures: req.body.affectedApertures
    });
    res.status(result.success ? 200 : 400).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/spi/printer/modify-parameter
 * Adjusts process parameter (e.g. Squeegee Pressure) subject to recipe bounds.
 */
spiRouter.post('/printer/modify-parameter', requirePermission(Permission.EQUIPMENT_MAINTAIN), async (req: Request, res: Response) => {
  try {
    const result = await PrinterControlService.modifyParameter({
      equipmentId: req.body.equipmentId || 'wc-spg-01',
      workCenterId: req.body.workCenterId || 'wc-spg-01',
      recipeId: req.body.recipeId || 'PROG-SM-METER-TOP-REV4',
      parameterName: req.body.parameterName,
      currentValue: req.body.currentValue,
      proposedValue: req.body.proposedValue,
      unit: req.body.unit || 'kgf',
      triggerCondition: req.body.triggerCondition || 'Manual operator micro-tune'
    });
    res.status(result.success ? 200 : 400).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
