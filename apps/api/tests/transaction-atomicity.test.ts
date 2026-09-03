import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase, getDatabase, IDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { EventIngestionService } from '../src/services/event-ingestion.service';
import { IEventProjector } from '../src/services/projectors/projector.interface';
import { MesEventEnvelope, MesEventType } from '@mes/shared';
import { v4 as uuidv4 } from 'uuid';

describe('Database Transaction Atomicity & Event Ingestion Rollback Suite', () => {
  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();
  });

  it('withTransaction commits all writes when no error is thrown', async () => {
    const db = getDatabase();
    const testReelId = 'REEL-TX-COMMIT-101';

    await db.withTransaction(async (tx: IDatabase) => {
      await tx.execute(`
        INSERT INTO component_reels (
          id, reel_id, part_number, part_name, supplier_name,
          lot_number, date_code, initial_quantity, current_quantity,
          status, msl_level, msl_remaining_minutes
        ) VALUES ('tx-1', ?, 'C0402-100NF-16V', 'Test Cap', 'Murata', 'LOT-TX', '2635', 5000, 5000, 'AVAILABLE', 1, 999999)
      `, [testReelId]);
    });

    const rows = await db.query('SELECT * FROM component_reels WHERE reel_id = ?', [testReelId]);
    expect(rows.length).toBe(1);
    expect(rows[0].reel_id).toBe(testReelId);
  });

  it('withTransaction rolls back all writes when an exception is thrown', async () => {
    const db = getDatabase();
    const testReelId = 'REEL-TX-ROLLBACK-999';

    await expect(
      db.withTransaction(async (tx: IDatabase) => {
        await tx.execute(`
          INSERT INTO component_reels (
            id, reel_id, part_number, part_name, supplier_name,
            lot_number, date_code, initial_quantity, current_quantity,
            status, msl_level, msl_remaining_minutes
          ) VALUES ('tx-2', ?, 'C0402-100NF-16V', 'Test Cap', 'Murata', 'LOT-TX', '2635', 5000, 5000, 'AVAILABLE', 1, 999999)
        `, [testReelId]);

        // Deliberately trigger failure
        throw new Error('SIMULATED_DATABASE_FAILURE');
      })
    ).rejects.toThrow('SIMULATED_DATABASE_FAILURE');

    // Verify row was completely rolled back and does not exist
    const rows = await db.query('SELECT * FROM component_reels WHERE reel_id = ?', [testReelId]);
    expect(rows.length).toBe(0);
  });

  it('EventIngestionService atomically rolls back production_events on projection failure', async () => {
    const db = getDatabase();
    const failingEventId = uuidv4();

    // Register a failing projector
    class FailingTestProjector implements IEventProjector {
      readonly name = 'FailingTestProjector';
      supports(eventType: MesEventType): boolean {
        return eventType === 'OUTPUT_RECORDED';
      }
      async project(_event: MesEventEnvelope, _tx: IDatabase): Promise<void> {
        throw new Error('PROJECTION_FAILED_CRASH');
      }
    }

    EventIngestionService.registerProjector(new FailingTestProjector());

    // Ingest event that trips the failing projector
    await expect(
      EventIngestionService.ingest({
        eventId: failingEventId,
        eventType: 'OUTPUT_RECORDED',
        workCenterId: 'wc-nxt-01',
        payload: {
          goodQuantity: 10,
          rejectedQuantity: 0
        }
      })
    ).rejects.toThrow('PROJECTION_FAILED_CRASH');

    // Verify that production_events contains NO row for failingEventId (atomic rollback!)
    const events = await db.query('SELECT * FROM production_events WHERE event_id = ?', [failingEventId]);
    expect(events.length).toBe(0);
  });
});
