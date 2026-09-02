import { Router, Request, Response } from 'express';
import { GenealogyService } from '../services/genealogy.service';

export const genealogyRouter = Router();

// Backward trace: Batch -> Material Lots & Suppliers
genealogyRouter.get('/batch/:batchNumber', async (req: Request, res: Response) => {
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

// Forward trace: Raw Material Lot -> Batches & Finished Products
genealogyRouter.get('/lot/:lotNumber', async (req: Request, res: Response) => {
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
