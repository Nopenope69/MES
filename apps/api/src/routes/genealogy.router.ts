// apps/api/src/routes/genealogy.router.ts
import { Router, Request, Response } from 'express';
import { GenealogyService } from '../services/genealogy.service';
import { TraceabilityModule } from '../modules/traceability/traceability.module';
import { requirePermission } from '../middleware/auth.middleware';
import { Permission } from '../security/permissions';

export const genealogyRouter = Router();
const traceability = new TraceabilityModule();

// Backward trace: Batch -> Material Lots & Suppliers (Legacy graph structure)
genealogyRouter.get('/batch/:batchNumber', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const batchNumber = Array.isArray(req.params.batchNumber) 
      ? req.params.batchNumber[0] 
      : String(req.params.batchNumber);
    const tree = await GenealogyService.traceBatch(batchNumber);
    res.json(tree);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Forward trace: Raw Material Lot -> Batches & Finished Products (Legacy graph structure)
genealogyRouter.get('/lot/:lotNumber', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const lotNumber = Array.isArray(req.params.lotNumber) 
      ? req.params.lotNumber[0] 
      : String(req.params.lotNumber);
    const tree = await GenealogyService.traceMaterialLot(lotNumber);
    res.json(tree);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Unit-Level As-Built Record
genealogyRouter.get('/unit/:panelBarcode/:unitPosition', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const panelBarcode = Array.isArray(req.params.panelBarcode)
      ? req.params.panelBarcode[0]
      : String(req.params.panelBarcode);
    const unitPosition = Number(req.params.unitPosition);
    if (isNaN(unitPosition)) {
      return res.status(400).json({ error: 'unitPosition parameter must be a valid number' });
    }

    const record = await traceability.getUnitGenealogy(panelBarcode, unitPosition);
    res.json(record);
  } catch (error: any) {
    if (error.message?.includes('not found') || error.message?.includes('No panel checkout')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// Panel-Level Full As-Built Record (All Multi-Up Units via Bulk Assembly)
genealogyRouter.get('/panel/:panelBarcode', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const panelBarcode = Array.isArray(req.params.panelBarcode)
      ? req.params.panelBarcode[0]
      : String(req.params.panelBarcode);

    const record = await traceability.getPanelGenealogy(panelBarcode);
    res.json(record);
  } catch (error: any) {
    if (error.message?.includes('not found') || error.message?.includes('No panel checkout')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// Unit Lookup by Serial Number
genealogyRouter.get('/serial/:serialNumber', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const serialNumber = Array.isArray(req.params.serialNumber)
      ? req.params.serialNumber[0]
      : String(req.params.serialNumber);

    const record = await traceability.lookupBySerialNumber(serialNumber);
    res.json(record);
  } catch (error: any) {
    if (error.message?.includes('not found') || error.message?.includes('No board unit')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// Pure Set-Based Batch Summary Genealogy
genealogyRouter.get('/summary/batch/:batchNumber', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const batchNumber = Array.isArray(req.params.batchNumber)
      ? req.params.batchNumber[0]
      : String(req.params.batchNumber);

    const record = await traceability.getBatchGenealogy(batchNumber);
    res.json(record);
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// Pure Set-Based Backward Recall & Containment Interrogation
genealogyRouter.get('/recall/:identifier', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const identifier = Array.isArray(req.params.identifier)
      ? req.params.identifier[0]
      : String(req.params.identifier);

    const report = await traceability.recallByIdentifier(identifier);
    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
