import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, IDatabase } from '../db/database';

export interface ComplianceLedgerEntryInput {
  actorId: string;
  actorRole: string; // e.g. QA_DIRECTOR, SMT_OPERATOR, SHIFT_SUPERVISOR
  actionType: string; // e.g. QUALITY_GATE_OVERRIDE, DHR_SIGN_OFF, MSL_BAKE_RESET, BATCH_RELEASE
  meaning: string; // e.g. "I verify this PCBA batch satisfies IPC-A-610 Class 3 acceptance criteria"
  entityType: 'REEL' | 'BATCH' | 'PASTE_JAR' | 'STENCIL' | 'WORK_ORDER' | 'DHR';
  entityId: string;
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
  entityType: string;
  entityId: string;
  metadata: Record<string, any>;
  signedAt: string;
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
 * ComplianceLedgerService (Track B: 21 CFR Part 11 & ISO 13485 Audit Trail)
 *
 * Implements an immutable, cryptographically hash-chained audit ledger.
 * Every compliance-critical signature or quality gate override is chained to the
 * preceding record via SHA-256, guaranteeing tamper-evident forensic integrity.
 */
export class ComplianceLedgerService {
  /**
   * Computes the SHA-256 digest for a given ledger record.
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
    const payload = `${sequenceNumber}|${previousHash}|${actorId}|${actionType}|${meaning}|${entityType}|${entityId}|${metadataJson}|${signedAt}`;
    return crypto.createHash('sha256').update(payload, 'utf-8').digest('hex');
  }

  /**
   * Append a 21 CFR Part 11 compliant signed record to the cryptographic ledger.
   */
  public static async recordSignature(input: ComplianceLedgerEntryInput): Promise<ComplianceLedgerRecord> {
    const db = getDatabase();
    const id = uuidv4();
    const metadataJson = JSON.stringify(input.metadata || {});
    const now = new Date().toISOString();

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

      const currentHash = this.computeHash(
        nextSeq,
        prevHash,
        input.actorId,
        input.actionType,
        input.meaning,
        input.entityType,
        input.entityId,
        metadataJson,
        now
      );

      await tx.execute(`
        INSERT INTO compliance_audit_ledger (
          id, sequence_number, previous_hash, current_hash, actor_id, actor_role,
          action_type, meaning, entity_type, entity_id, metadata_json, signed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id,
        nextSeq,
        prevHash,
        currentHash,
        input.actorId,
        input.actorRole,
        input.actionType,
        input.meaning,
        input.entityType,
        input.entityId,
        metadataJson,
        now
      ]);

      return {
        id,
        sequenceNumber: nextSeq,
        previousHash: prevHash,
        currentHash,
        actorId: input.actorId,
        actorRole: input.actorRole,
        actionType: input.actionType,
        meaning: input.meaning,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata || {},
        signedAt: now
      };
    });
  }

  /**
   * Verify the cryptographic integrity of the entire compliance ledger.
   * Detects record deletions, in-place tampering, and out-of-order mutations.
   */
  public static async verifyIntegrity(): Promise<LedgerVerificationResult> {
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

      // Verify sequence continuity (1, 2, 3...)
      if (seq !== i + 1) {
        return {
          valid: false,
          totalEntries: rows.length,
          brokenSequence: seq,
          message: `Sequence gap detected: expected block ${i + 1}, found ${seq}. Possible record deletion!`
        };
      }

      // Verify previous hash pointer
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

      // Recompute and verify current block hash
      const recomputedHash = this.computeHash(
        seq,
        row.previous_hash,
        row.actor_id,
        row.action_type,
        row.meaning,
        row.entity_type,
        row.entity_id,
        row.metadata_json,
        row.signed_at
      );

      if (recomputedHash !== row.current_hash) {
        return {
          valid: false,
          totalEntries: rows.length,
          brokenSequence: seq,
          expectedHash: recomputedHash,
          actualHash: row.current_hash,
          message: `Data tampering detected at block ${seq}: cryptographic SHA-256 payload checksum mismatch!`
        };
      }

      expectedPrevHash = row.current_hash;
    }

    return {
      valid: true,
      totalEntries: rows.length,
      message: `Verified all ${rows.length} ledger blocks. Zero tampering detected. 21 CFR Part 11 compliant unbroken hash chain.`
    };
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

    return rows.map(r => ({
      id: r.id,
      sequenceNumber: Number(r.sequence_number),
      previousHash: r.previous_hash,
      currentHash: r.current_hash,
      actorId: r.actor_id,
      actorRole: r.actor_role,
      actionType: r.action_type,
      meaning: r.meaning,
      entityType: r.entity_type,
      entityId: r.entity_id,
      metadata: JSON.parse(r.metadata_json || '{}'),
      signedAt: r.signed_at
    }));
  }
}
