import { Router, Request, Response } from 'express';
import { ComplianceLedgerService } from '../services/compliance-ledger.service';
import { ComplianceController } from '../controllers/compliance.controller';
import { EdhrService } from '../services/edhr.service';
import { TraceabilityInterrogationService } from '../services/traceability-interrogation.service';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware';
import { Permission } from '../security/permissions';

export const complianceRouter = Router();

/**
 * POST /api/v1/compliance/sign
 * Attributable 21 CFR Part 11 Two-Component Electronic Signature
 */
complianceRouter.post(
  '/sign', 
  authenticateToken, 
  requirePermission(Permission.COMPLIANCE_SIGN), 
  ComplianceController.signLedgerEntry
);

/**
 * PUT /api/v1/compliance/ledger/:id
 * Safeguard: Ledger records are append-only. UPDATE is prohibited per 21 CFR Part 11.
 */
complianceRouter.put('/ledger/:id', (_req: Request, res: Response) => {
  res.status(405).json({
    success: false,
    error: 'LEDGER_MUTATION_PROHIBITED',
    message: 'Compliance ledger is append-only. UPDATE operations are prohibited by 21 CFR Part 11.'
  });
});

/**
 * DELETE /api/v1/compliance/ledger/:id
 * Safeguard: Ledger records are append-only. DELETE is prohibited per 21 CFR Part 11.
 */
complianceRouter.delete('/ledger/:id', (_req: Request, res: Response) => {
  res.status(405).json({
    success: false,
    error: 'LEDGER_MUTATION_PROHIBITED',
    message: 'Compliance ledger is append-only. DELETE operations are prohibited by 21 CFR Part 11.'
  });
});

/**
 * GET /api/v1/compliance/ledger/verify
 * Walks the complete hash chain from Genesis to Block N, checking for data tampering,
 * altered payload hashes, or missing sequence blocks.
 */
complianceRouter.get(
  '/ledger/verify', 
  requirePermission(Permission.REPORTS_VIEW), 
  async (_req: Request, res: Response) => {
  try {
    const result = await ComplianceLedgerService.verifyLedgerIntegrity();
    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to verify ledger integrity'
    });
  }
});

/**
 * GET /api/v1/compliance/ledger/entity/:entityType/:entityId
 * Fetches the chronological audit trail for a specific entity (REEL, BATCH, PASTE_JAR, DHR).
 */
complianceRouter.get(
  '/ledger/entity/:entityType/:entityId', 
  requirePermission(Permission.REPORTS_VIEW), 
  async (req: Request, res: Response) => {
  try {
    const { entityType, entityId } = req.params;
    const records = await ComplianceLedgerService.getEntriesForEntity(String(entityType), String(entityId));
    res.json({
      success: true,
      data: records
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch entity audit trail'
    });
  }
});

/**
 * POST /api/v1/compliance/dhr/generate
 * Generates and signs an Electronic Device History Record (eDHR) per 21 CFR 820.180.
 */
complianceRouter.post(
  '/dhr/generate', 
  requirePermission(Permission.QUALITY_APPROVE), 
  async (req: Request, res: Response) => {
  try {
    const { batchId, actorId, actorRole } = req.body;

    if (!batchId) {
      return res.status(400).json({
        success: false,
        error: 'batchId (or batchNumber) is required'
      });
    }

    const effectiveActorId = req.user?.code || req.user?.id || actorId || 'SYSTEM_DHR_ENGINE';
    const effectiveActorRole = req.user?.role || actorRole || 'QA_SPECIALIST';

    const dhr = await EdhrService.generateDhr(
      batchId,
      effectiveActorId,
      effectiveActorRole
    );

    res.status(201).json({
      success: true,
      data: dhr
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate eDHR'
    });
  }
});

/**
 * GET /api/v1/compliance/dhr/:dhrNumber
 * Fetches an eDHR and verifies its cryptographic payload integrity.
 */
complianceRouter.get(
  '/dhr/:dhrNumber', 
  requirePermission(Permission.REPORTS_VIEW), 
  async (req: Request, res: Response) => {
  try {
    const { dhrNumber } = req.params;
    const dhr = await EdhrService.getDhr(String(dhrNumber));
    res.json({
      success: true,
      data: dhr
    });
  } catch (error: any) {
    res.status(404).json({
      success: false,
      error: error.message || 'DHR not found'
    });
  }
});

/**
 * POST /api/v1/compliance/dhr/:dhrNumber/release
 * Formally signs off and releases a DHR per 21 CFR Part 11 and 21 CFR 820.180.
 */
complianceRouter.post(
  '/dhr/:dhrNumber/release', 
  requirePermission(Permission.QUALITY_APPROVE), 
  async (req: Request, res: Response) => {
  try {
    const { dhrNumber } = req.params;
    const { qaReviewerId, qaMeaning, releasedQuantity } = req.body;

    const effectiveReviewer = req.user?.code || req.user?.id || qaReviewerId;
    if (!effectiveReviewer) {
      return res.status(400).json({
        success: false,
        error: 'qaReviewerId is required for formal QA release'
      });
    }

    const dhr = await EdhrService.releaseDhr(
      String(dhrNumber),
      effectiveReviewer,
      qaMeaning,
      releasedQuantity !== undefined ? Number(releasedQuantity) : undefined
    );

    res.json({
      success: true,
      data: dhr
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to release DHR'
    });
  }
});

/**
 * GET /api/v1/compliance/traceability/backward/:identifier
 * ISO 13485 Clause 7.5.3 Backward Recall Containment Analysis
 */
complianceRouter.get(
  '/traceability/backward/:identifier', 
  requirePermission(Permission.REPORTS_VIEW), 
  async (req: Request, res: Response) => {
  try {
    const { identifier } = req.params;
    const result = await TraceabilityInterrogationService.backwardRecall(String(identifier));
    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Backward recall analysis failed'
    });
  }
});

/**
 * GET /api/v1/compliance/traceability/forward/:identifier
 * ISO 13485 Clause 7.5.3 Forward As-Built BoM Genealogy Interrogation
 */
complianceRouter.get(
  '/traceability/forward/:identifier', 
  requirePermission(Permission.REPORTS_VIEW), 
  async (req: Request, res: Response) => {
  try {
    const { identifier } = req.params;
    const result = await TraceabilityInterrogationService.forwardLineage(String(identifier));
    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Forward lineage interrogation failed'
    });
  }
});
