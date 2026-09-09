// apps/api/src/controllers/compliance.controller.ts
import { Request, Response } from 'express';
import { z } from 'zod';
import { ComplianceLedgerService } from '../services/compliance-ledger.service';

/**
 * Strict schema for 21 CFR Part 11 Electronic Signature Requests.
 *
 * CRITICAL INVARIANT:
 * Uses .strict() to categorically reject any client payload containing spoofed
 * identity, sequence, or cryptographic attributes (actorId, actorRole, signedAt,
 * timestamp, sequenceNumber, previousHash, currentHash).
 */
export const SignLedgerRequestSchema = z
  .object({
    entityType: z.string().min(1, 'entityType is required'),
    entityId: z.string().min(1, 'entityId is required'),
    entityRevision: z.number().int().optional().default(1),
    actionType: z.string().min(1, 'actionType is required'),
    meaning: z.string().min(1, 'meaning is required'),
    reason: z.string().min(1, 'reason is required'),
    signingPin: z.string().min(4, 'signingPin must be at least 4 digits'),
    metadata: z.record(z.any()).optional().default({})
  })
  .strict();

export type SignLedgerRequest = z.infer<typeof SignLedgerRequestSchema>;

export class ComplianceController {
  /**
   * POST /api/v1/compliance/sign
   *
   * Executes a two-component 21 CFR Part 11 electronic signature:
   * 1. Component 1: Active authenticated session (RequestContext).
   * 2. Component 2: Operator re-authentication secret (signingPin).
   */
  public static async signLedgerEntry(req: Request, res: Response): Promise<void> {
    const parseResult = SignLedgerRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid signature request payload',
        details: parseResult.error.errors
      });
      return;
    }

    if (!req.context || !req.context.principal) {
      res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Authenticated session (RequestContext) is required for 21 CFR Part 11 signature'
      });
      return;
    }

    try {
      const record = await ComplianceLedgerService.recordSignature(parseResult.data, req.context);
      res.status(201).json({
        success: true,
        data: record
      });
    } catch (error: any) {
      if (error.message === 'INVALID_SIGNING_PIN') {
        res.status(401).json({
          success: false,
          error: 'INVALID_SIGNING_PIN',
          message: 'Invalid signing PIN for authenticated operator'
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: error.message || 'Failed to execute 21 CFR Part 11 signature'
      });
    }
  }
}
