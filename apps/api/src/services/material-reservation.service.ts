import { v4 as uuidv4 } from 'uuid';
import { getDatabase, IDatabase } from '../db/database';
import { Clock, SystemClock } from '../utils/clock';
import { IEventStoreModule } from '../modules/event-store/event-store.interface';
import { EventStoreModule } from '../modules/event-store/event-store.module';

export interface ReserveMaterialParams {
  reelId: string;
  lineId: string;
  slotNo: number;
  partNumber: string;
  purpose: string;
  correlationId: string;
  reservedForRequestId?: string;
  operatorId?: string;
}

export interface MaterialReservationResult {
  success: boolean;
  reservationId?: string;
  reelId: string;
  lineId: string;
  status: 'RESERVED' | 'REJECTED';
  reason?: string;
}

export interface MaterialReservationRecord {
  id: string;
  reelId: string;
  lineId: string;
  slotNo: number;
  partNumber: string;
  reservedForRequestId?: string;
  purpose: string;
  correlationId: string;
  status: 'RESERVED' | 'MOUNTED' | 'CONSUMED' | 'RELEASED' | 'EXPIRED';
  reservedAt: string;
  mountedAt?: string;
  consumedAt?: string;
  releasedAt?: string;
}

/**
 * MaterialReservationService: Atomic Concurrency Lock for Cross-Line Material Integrity.
 *
 * Guarantees that two concurrent lines cannot mount or reserve the same physical component reel.
 * Enforced via database-level active index constraint on (reel_id) WHERE status IN ('RESERVED', 'MOUNTED').
 */
export class MaterialReservationService {
  private static instance: MaterialReservationService | null = null;

  constructor(
    private dbProvider: () => IDatabase = () => getDatabase(),
    private clock: Clock = new SystemClock(),
    private eventStore: IEventStoreModule = EventStoreModule.getInstance()
  ) {}

  public static getInstance(): MaterialReservationService {
    if (!MaterialReservationService.instance) {
      MaterialReservationService.instance = new MaterialReservationService();
    }
    return MaterialReservationService.instance;
  }

  public static resetInstance(): void {
    MaterialReservationService.instance = null;
  }

  /**
   * Atomically reserves a component reel for a designated line and slot.
   */
  public async reserveMaterial(params: ReserveMaterialParams): Promise<MaterialReservationResult> {
    const db = this.dbProvider();
    const now = this.clock.now().toISOString();
    const reservationId = uuidv4();

    // 1. Check if reel exists in component_reels inventory
    const reelRows = await db.query<any>(`
      SELECT reel_id, part_number, status, current_quantity
      FROM component_reels
      WHERE reel_id = ?
      LIMIT 1
    `, [params.reelId]);

    if (reelRows.length === 0) {
      return {
        success: false,
        reelId: params.reelId,
        lineId: params.lineId,
        status: 'REJECTED',
        reason: `Reel ${params.reelId} not found in inventory`
      };
    }

    const reel = reelRows[0];
    if (reel.status === 'EXPIRED' || reel.status === 'SCRAPPED') {
      return {
        success: false,
        reelId: params.reelId,
        lineId: params.lineId,
        status: 'REJECTED',
        reason: `Reel ${params.reelId} is ${reel.status} and cannot be reserved`
      };
    }

    // 2. Transactional lock / reservation attempt
    try {
      await db.withTransaction(async (tx) => {
        // Active reservation conflict check
        const existing = await tx.query<any>(`
          SELECT id, line_id, status 
          FROM material_reservations
          WHERE reel_id = ? AND status IN ('RESERVED', 'MOUNTED')
          LIMIT 1
        `, [params.reelId]);

        if (existing.length > 0) {
          throw new Error(`REEL_ALREADY_RESERVED: Reel ${params.reelId} is already held by line ${existing[0].line_id} (status: ${existing[0].status})`);
        }

        await tx.execute(`
          INSERT INTO material_reservations (
            id, reel_id, line_id, slot_no, part_number,
            reserved_for_request_id, purpose, correlation_id, status, reserved_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?)
        `, [
          reservationId, params.reelId, params.lineId, params.slotNo,
          params.partNumber, params.reservedForRequestId || null,
          params.purpose, params.correlationId, now
        ]);
      });

      // 3. Emit MATERIAL_RESERVED business fact into EventStoreModule
      await this.eventStore.append({
        eventId: uuidv4(),
        eventType: 'MATERIAL_RESERVED',
        eventTime: now,
        receivedTime: now,
        sourceType: 'LOGISTICS_MANAGER',
        sourceId: 'mat-reservation-svc',
        lineId: params.lineId,
        workCenterId: `wc-nxt-${params.lineId.includes('02') ? '02' : '01'}`,
        correlationId: params.correlationId,
        payload: {
          reservationId,
          reelId: params.reelId,
          lineId: params.lineId,
          slotNo: params.slotNo,
          partNumber: params.partNumber,
          reservedForRequestId: params.reservedForRequestId
        }
      });

      return {
        success: true,
        reservationId,
        reelId: params.reelId,
        lineId: params.lineId,
        status: 'RESERVED'
      };
    } catch (err: any) {
      const isUniqueConflict = err.message && (
        err.message.includes('UNIQUE constraint failed') ||
        err.message.includes('unique constraint') ||
        err.message.includes('duplicate key')
      );
      const reason = isUniqueConflict
        ? `REEL_ALREADY_RESERVED: Reel ${params.reelId} is already held (database mutual exclusion)`
        : (err.message || 'CONCURRENCY_CONFLICT');

      return {
        success: false,
        reelId: params.reelId,
        lineId: params.lineId,
        status: 'REJECTED',
        reason
      };
    }
  }

  /**
   * Confirms mounting of a reserved reel onto a feeder slot.
   */
  public async confirmMount(reservationId: string, operatorId: string): Promise<void> {
    const db = this.dbProvider();
    const now = this.clock.now().toISOString();

    await db.execute(`
      UPDATE material_reservations
      SET status = 'MOUNTED', mounted_at = ?
      WHERE id = ? AND status = 'RESERVED'
    `, [now, reservationId]);
  }

  /**
   * Releases an active reservation back to available storage.
   */
  public async releaseReservation(reservationId: string, reason: string): Promise<void> {
    const db = this.dbProvider();
    const now = this.clock.now().toISOString();

    await db.execute(`
      UPDATE material_reservations
      SET status = 'RELEASED', released_at = ?
      WHERE id = ? AND status = 'RESERVED'
    `, [now, reservationId]);
  }

  /**
   * Fetches active reservations.
   */
  public async getActiveReservations(lineId?: string): Promise<MaterialReservationRecord[]> {
    const db = this.dbProvider();
    let sql = `
      SELECT 
        id, reel_id as reelId, line_id as lineId, slot_no as slotNo,
        part_number as partNumber, reserved_for_request_id as reservedForRequestId,
        purpose, correlation_id as correlationId, status,
        reserved_at as reservedAt, mounted_at as mountedAt,
        consumed_at as consumedAt, released_at as releasedAt
      FROM material_reservations
      WHERE status IN ('RESERVED', 'MOUNTED')
    `;
    const params: any[] = [];
    if (lineId) {
      sql += ' AND line_id = ?';
      params.push(lineId);
    }
    sql += ' ORDER BY reserved_at DESC';

    return db.query<MaterialReservationRecord>(sql, params);
  }
}
