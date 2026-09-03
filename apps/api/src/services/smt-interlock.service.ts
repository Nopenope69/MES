import { getDatabase } from '../db/database';

export interface SmtInterlockDecision {
  allowed: boolean;
  expectedPartNumber: string;
  actualPartNumber: string;
  feederId?: string;
  currentReelId?: string;
  reason?: string;
}

/**
 * Domain Service for SMT Splicing & Quality Interlocks (ADR-003 Compliant).
 * Decouples equipment integration adapters from direct domain schema access.
 */
export class SmtInterlockService {
  /**
   * Evaluates closed-loop feeder splice authorization against the programmed recipe BOM.
   * Ensures the adapter has zero knowledge of the database schema.
   */
  public static async verifyFeederSplice(
    workCenterId: string,
    slotNo: number,
    scannedPartNumber: string
  ): Promise<SmtInterlockDecision> {
    const db = getDatabase();
    const rows = await db.query<{ assigned_part_number: string; feeder_id: string; current_reel_id: string }>(
      'SELECT assigned_part_number, feeder_id, current_reel_id FROM smt_feeder_slots WHERE work_center_id = ? AND slot_no = ?',
      [workCenterId, slotNo]
    );

    if (rows.length === 0) {
      return {
        allowed: false,
        expectedPartNumber: 'UNKNOWN',
        actualPartNumber: scannedPartNumber,
        reason: `Slot ${slotNo} is not configured on work center ${workCenterId}`
      };
    }

    const expectedPart = rows[0].assigned_part_number;
    const allowed = expectedPart.trim().toUpperCase() === scannedPartNumber.trim().toUpperCase();

    return {
      allowed,
      expectedPartNumber: expectedPart,
      actualPartNumber: scannedPartNumber,
      feederId: rows[0].feeder_id,
      currentReelId: rows[0].current_reel_id,
      reason: allowed ? 'OK' : `BOM mismatch: expected ${expectedPart}, received ${scannedPartNumber}`
    };
  }
}
