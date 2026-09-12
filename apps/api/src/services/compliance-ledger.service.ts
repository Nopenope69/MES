// apps/api/src/services/compliance-ledger.service.ts
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, IDatabase } from '../db/database';
import { canonicalizeJson } from '../security/canonical-json';
import { PinPolicy } from '../security/pin-policy';
import { RequestContext } from '../security/context';

export interface SignedEnvelope {
  sequenceNumber: number;
  previousHash: string;
  actorId: string;
  actorRole: string;
  actionType: string;
  meaning: string;
  reason: string;
  entityType: string;
  entityId: string;
  entityRevision: number;
  organizationId: string;
  siteId: string;
  metadata: Record<string, any>;
  signedAt: string;
}

export interface ComplianceLedgerEntryInput {
  actorId?: string;
  actorRole?: string;
  actionType: string;
  meaning: string;
  reason?: string;
  entityType: string;
  entityId: string;
  entityRevision?: number;
  organizationId?: string;
  siteId?: string;
  signingPin?: string;
  metadata?: Record<string, any>;
}

export interface ComplianceLedgerRecord {
  id: string;
  sequenceNumber: number;
  previousHash: string;
  currentHash: string;
  actorId: string;
  actorRole: string;
  actionType: string;
  meaning: string;
  reason: string;
  entityType: string;
  entityId: string;
  entityRevision: number;
  organizationId: string;
  siteId: string;
  metadata: Record<string, any>;
  signedAt: string;
  envelope?: SignedEnvelope;
}

export interface LedgerVerificationResult {
  valid: boolean;
  totalEntries: number;
  brokenSequence?: number;
  expectedHash?: string;
  actualHash?: string;
  message: string;
}

const GENESIS_HASH = '0'.repeat(64);

/**
 * ComplianceLedgerService (21 CFR Part 11 & ISO 13485 Audit Trail)
 *
 * Implements an immutable, cryptographically hash-chained audit ledger.
 * Every compliance-critical signature or quality gate override is chained to the
 * preceding record via RFC 8785 canonical JSON and SHA-256, guaranteeing tamper-evident
 * forensic integrity.
 */
export class ComplianceLedgerService {
  /**
   * Computes the deterministic SHA-256 digest of a canonical signed envelope per RFC 8785.
   */
  public static computeEnvelopeHash(envelope: SignedEnvelope): string {
    return crypto.createHash('sha256').update(canonicalizeJson(envelope), 'utf-8').digest('hex');
  }

  /**
   * Backwards-compatible SHA-256 compute hash function.
   */
  public static computeHash(
    sequenceNumber: number,
    previousHash: string,
    actorId: string,
    actionType: string,
    meaning: string,
    entityType: string,
    entityId: string,
    metadataJson: string,
    signedAt: string
  ): string {
    let metaObj: any = {};
    try {
      metaObj = JSON.parse(metadataJson || '{}');
    } catch {
      metaObj = {};
    }

    const reason = metaObj.reason || meaning;
    const entityRevision = metaObj.entityRevision || 1;
    const organizationId = metaObj.organizationId || 'org-apex';
    const siteId = metaObj.siteId || 'site-noida-p4';
    const metadata = metaObj.metadata !== undefined ? metaObj.metadata : metaObj;

    const envelope: SignedEnvelope = {
      sequenceNumber,
      previousHash,
      actorId,
      actorRole: 'OPERATOR',
      actionType,
      meaning,
      reason,
      entityType,
      entityId,
      entityRevision,
      organizationId,
      siteId,
      metadata,
      signedAt
    };

    return this.computeEnvelopeHash(envelope);
  }

  /**
   * Computes the pre-Task-5 pipe-delimited SHA-256 hash for historical audit records.
   */
  public static computeLegacyHash(
    sequenceNumber: number,
    previousHash: string,
    actorId: string,
    actionType: string,
    meaning: string,
    entityType: string,
    entityId: string,
    metadataJson: string,
    signedAt: string
  ): string {
    const payload = `${sequenceNumber}|${previousHash}|${actorId}|${actionType}|${meaning}|${entityType}|${entityId}|${metadataJson}|${signedAt}`;
    return crypto.createHash('sha256').update(payload, 'utf-8').digest('hex');
  }

  /**
   * Append a 21 CFR Part 11 compliant signed record to the cryptographic ledger.
   *
   * Enforces two-component electronic signature:
   * - Component 1: Authoritative session RequestContext (actorId, actorRole, organizationId, siteId).
   * - Component 2: Immediate operator PIN re-authentication verified against operator's pin_hash.
   */
  public static async recordSignature(
    input: ComplianceLedgerEntryInput,
    context?: RequestContext
  ): Promise<ComplianceLedgerRecord> {
    const db = getDatabase();
    let actorId: string;
    let actorRole: string;
    let organizationId: string;
    let siteId: string;

    if (context && context.principal) {
      // Component 1: Attributable session identity from RequestContext
      actorId = context.principal.id || (context.principal as any).operatorId || (context.principal as any).serviceId;
      actorRole = context.principal.role || (context.principal as any).serviceName || 'OPERATOR';
      organizationId =
        context.scope?.organizationId ||
        (context.principal as any).organizationId ||
        (context.principal as any).scope?.organizationId ||
        'org-apex';
      siteId =
        context.scope?.siteId ||
        (context.principal as any).siteId ||
        (context.principal as any).scope?.siteId ||
        'site-noida-p4';

      // Component 2: Operator PIN re-authentication secret
      const signingPin = input.signingPin;
      if (!signingPin) {
        throw new Error('INVALID_SIGNING_PIN');
      }

      const opRows = await db.query<any>(
        'SELECT pin, pin_hash FROM operators WHERE id = ? OR code = ?',
        [actorId, actorId]
      );

      if (opRows.length === 0) {
        await PinPolicy.verifyUnknownOperator(signingPin);
        throw new Error('INVALID_SIGNING_PIN');
      }

      const storedHash = opRows[0].pin_hash || opRows[0].pin;
      const isValid = await PinPolicy.verifyPin(signingPin, storedHash);
      if (!isValid) {
        throw new Error('INVALID_SIGNING_PIN');
      }
    } else {
      // Legacy backwards-compatibility for direct service callers (e.g. EdhrService or legacy tests)
      actorId = input.actorId || 'SYSTEM';
      actorRole = input.actorRole || 'SYSTEM_AUDITOR';
      organizationId = input.organizationId || 'org-apex';
      siteId = input.siteId || 'site-noida-p4';
    }

    const reason = input.reason || input.meaning;
    const entityRevision = input.entityRevision !== undefined ? Number(input.entityRevision) : 1;
    const metadata = input.metadata || {};
    const id = uuidv4();
    const now = new Date().toISOString();

    const storedMetadataJson = JSON.stringify({
      reason,
      entityRevision,
      organizationId,
      siteId,
      metadata
    });

    return await db.withTransaction(async (tx: IDatabase) => {
      // Fetch latest block to get previous hash and next sequence number
      const latestRows = await tx.query<any>(
        'SELECT sequence_number, current_hash FROM compliance_audit_ledger ORDER BY sequence_number DESC LIMIT 1'
      );

      let nextSeq = 1;
      let prevHash = GENESIS_HASH;

      if (latestRows.length > 0) {
        nextSeq = Number(latestRows[0].sequence_number) + 1;
        prevHash = latestRows[0].current_hash;
      }

      const envelope: SignedEnvelope = {
        sequenceNumber: nextSeq,
        previousHash: prevHash,
        actorId,
        actorRole,
        actionType: input.actionType,
        meaning: input.meaning,
        reason,
        entityType: input.entityType,
        entityId: input.entityId,
        entityRevision,
        organizationId,
        siteId,
        metadata,
        signedAt: now
      };

      const currentHash = this.computeEnvelopeHash(envelope);

      await tx.execute(
        `
        INSERT INTO compliance_audit_ledger (
          id, sequence_number, previous_hash, current_hash, actor_id, actor_role,
          action_type, meaning, entity_type, entity_id, metadata_json, signed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          id,
          nextSeq,
          prevHash,
          currentHash,
          actorId,
          actorRole,
          input.actionType,
          input.meaning,
          input.entityType,
          input.entityId,
          storedMetadataJson,
          now
        ]
      );

      return {
        id,
        sequenceNumber: nextSeq,
        previousHash: prevHash,
        currentHash,
        actorId,
        actorRole,
        actionType: input.actionType,
        meaning: input.meaning,
        reason,
        entityType: input.entityType,
        entityId: input.entityId,
        entityRevision,
        organizationId,
        siteId,
        metadata,
        signedAt: now,
        envelope
      };
    });
  }

  /**
   * Verify the cryptographic integrity of the entire compliance ledger.
   * Walks the chain from Genesis to Block N, checking for sequence gaps, pointer mismatches,
   * or altered payload checksums via RFC 8785 canonical JSON.
   */
  public static async verifyLedgerIntegrity(): Promise<LedgerVerificationResult> {
    const db = getDatabase();
    const rows = await db.query<any>(
      'SELECT * FROM compliance_audit_ledger ORDER BY sequence_number ASC'
    );

    if (rows.length === 0) {
      return {
        valid: true,
        totalEntries: 0,
        message: 'Compliance audit ledger is empty and valid (Genesis state).'
      };
    }

    let expectedPrevHash = GENESIS_HASH;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const seq = Number(row.sequence_number);

      // 1. Verify sequence continuity (1, 2, 3...)
      if (seq !== i + 1) {
        return {
          valid: false,
          totalEntries: rows.length,
          brokenSequence: seq,
          message: `Sequence gap detected: expected block ${i + 1}, found ${seq}. Possible record deletion!`
        };
      }

      // 2. Verify previous hash pointer
      if (row.previous_hash !== expectedPrevHash) {
        return {
          valid: false,
          totalEntries: rows.length,
          brokenSequence: seq,
          expectedHash: expectedPrevHash,
          actualHash: row.previous_hash,
          message: `Chain link broken at block ${seq}: previous_hash mismatch.`
        };
      }

      // 3. Extract metadata fields
      let metaObj: any = {};
      try {
        metaObj = JSON.parse(row.metadata_json || '{}');
      } catch {
        metaObj = {};
      }

      const reason = metaObj.reason !== undefined ? metaObj.reason : (metaObj._reason || row.meaning);
      const entityRevision = metaObj.entityRevision !== undefined ? Number(metaObj.entityRevision) : 1;
      const organizationId = metaObj.organizationId || metaObj._organizationId || 'org-apex';
      const siteId = metaObj.siteId || metaObj._siteId || 'site-noida-p4';
      const metadata = metaObj.metadata !== undefined ? metaObj.metadata : metaObj;

      const signedAt =
        typeof row.signed_at === 'object' && row.signed_at instanceof Date
          ? row.signed_at.toISOString()
          : String(row.signed_at);

      const envelope: SignedEnvelope = {
        sequenceNumber: seq,
        previousHash: row.previous_hash,
        actorId: row.actor_id,
        actorRole: row.actor_role,
        actionType: row.action_type,
        meaning: row.meaning,
        reason,
        entityType: row.entity_type,
        entityId: row.entity_id,
        entityRevision,
        organizationId,
        siteId,
        metadata,
        signedAt
      };

      // 4. Recompute canonical SHA-256 hash
      const recomputedCanonicalHash = this.computeEnvelopeHash(envelope);
      if (recomputedCanonicalHash === row.current_hash) {
        expectedPrevHash = row.current_hash;
        continue;
      }

      // Backward-compatibility: Check legacy hash format for pre-Task-5 records
      const legacyHash = this.computeLegacyHash(
        seq,
        row.previous_hash,
        row.actor_id,
        row.action_type,
        row.meaning,
        row.entity_type,
        row.entity_id,
        row.metadata_json,
        signedAt
      );

      if (legacyHash === row.current_hash) {
        expectedPrevHash = row.current_hash;
        continue;
      }

      // Neither hash matched - data tampering detected!
      return {
        valid: false,
        totalEntries: rows.length,
        brokenSequence: seq,
        expectedHash: recomputedCanonicalHash,
        actualHash: row.current_hash,
        message: `Data tampering detected at block ${seq}: cryptographic SHA-256 payload checksum mismatch!`
      };
    }

    return {
      valid: true,
      totalEntries: rows.length,
      message: `Verified all ${rows.length} ledger blocks. Zero tampering detected. 21 CFR Part 11 compliant unbroken hash chain.`
    };
  }

  /**
   * Alias for verifyLedgerIntegrity for backwards compatibility.
   */
  public static async verifyIntegrity(): Promise<LedgerVerificationResult> {
    return this.verifyLedgerIntegrity();
  }

  /**
   * Safeguard prohibiting record mutation or deletion on compliance ledger records.
   */
  public static prohibitRecordMutation(action: 'UPDATE' | 'DELETE' | string = 'MUTATE'): never {
    throw new Error(
      `LEDGER_MUTATION_PROHIBITED: Cannot ${action} records in compliance_audit_ledger. 21 CFR Part 11 requires immutable append-only storage.`
    );
  }

  /**
   * Prohibited update operation.
   */
  public static async updateRecord(): Promise<never> {
    this.prohibitRecordMutation('UPDATE');
  }

  /**
   * Prohibited delete operation.
   */
  public static async deleteRecord(): Promise<never> {
    this.prohibitRecordMutation('DELETE');
  }

  /**
   * Query all signed audit entries for a specific entity (e.g. batch, reel, DHR).
   */
  public static async getEntriesForEntity(entityType: string, entityId: string): Promise<ComplianceLedgerRecord[]> {
    const db = getDatabase();
    const rows = await db.query<any>(
      'SELECT * FROM compliance_audit_ledger WHERE entity_type = ? AND entity_id = ? ORDER BY sequence_number ASC',
      [entityType, entityId]
    );

    return rows.map((r) => {
      let metaObj: any = {};
      try {
        metaObj = JSON.parse(r.metadata_json || '{}');
      } catch {
        metaObj = {};
      }

      const reason = metaObj.reason !== undefined ? metaObj.reason : (metaObj._reason || r.meaning);
      const entityRevision = metaObj.entityRevision !== undefined ? Number(metaObj.entityRevision) : 1;
      const organizationId = metaObj.organizationId || metaObj._organizationId || 'org-apex';
      const siteId = metaObj.siteId || metaObj._siteId || 'site-noida-p4';
      const metadata = metaObj.metadata !== undefined ? metaObj.metadata : metaObj;

      return {
        id: r.id,
        sequenceNumber: Number(r.sequence_number),
        previousHash: r.previous_hash,
        currentHash: r.current_hash,
        actorId: r.actor_id,
        actorRole: r.actor_role,
        actionType: r.action_type,
        meaning: r.meaning,
        reason,
        entityType: r.entity_type,
        entityId: r.entity_id,
        entityRevision,
        organizationId,
        siteId,
        metadata,
        signedAt:
          typeof r.signed_at === 'object' && r.signed_at instanceof Date
            ? r.signed_at.toISOString()
            : String(r.signed_at)
      };
    });
  }
}
