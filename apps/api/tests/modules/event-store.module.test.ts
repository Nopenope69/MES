import { describe, it, expect, beforeAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase } from '../../src/db/database';
import { seedDatabase } from '../../src/db/seed';
import { EventStoreModule } from '../../src/modules/event-store/event-store.module';
import { InMemoryEventStoreAdapter } from '../../src/modules/event-store/in-memory-event-store.adapter';

describe('EventStoreModule: Declarative Event Spine Suite', () => {
  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();
  });

  it('should validate and append an event using declarative schema registry', async () => {
    const eventStore = EventStoreModule.getInstance();
    const result = await eventStore.append({
      eventType: 'BATCH_STARTED',
      workCenterId: 'wc-nxt-01',
      operatorId: 'op-smt-01',
      sourceType: 'INTEGRATION_SOCKET',
      sourceId: 'fuji-nxt01',
      payload: {
        batchNumber: `JOB-ES-${Date.now()}`,
        workOrderNumber: 'WO-2026-DIXON-01',
        productCode: 'PRD-SM-4G-V2',
        recipeCode: 'PROG-SM-METER-TOP-REV4',
        recipeRevision: 4,
        plannedQuantity: 500.0,
        unit: 'PANEL'
      }
    });

    expect(result.success).toBe(true);
    expect(result.eventId).toBeDefined();

    // Verify checkpoints were updated
    const checkpoints = await eventStore.getCheckpoints();
    expect(checkpoints.length).toBeGreaterThan(0);
    const coreCp = checkpoints.find((c) => c.projectionName === 'CoreProjector');
    expect(coreCp).toBeDefined();
    expect(coreCp?.eventsProcessed).toBeGreaterThan(0);
  });

  it('should support in-memory event store adapter for fast hermetic tests', async () => {
    const inMemoryStore = new InMemoryEventStoreAdapter();
    const appendRes = await inMemoryStore.append({
      eventType: 'OUTPUT_RECORDED',
      workCenterId: 'wc-nxt-01',
      payload: {
        goodQuantity: 10,
        unit: 'PANEL'
      }
    });

    expect(appendRes.success).toBe(true);
    const events = inMemoryStore.getEvents();
    expect(events.length).toBe(1);
    expect(events[0].eventType).toBe('OUTPUT_RECORDED');
  });

  it('should replay catchup events and synchronize projection checkpoints', async () => {
    const eventStore = EventStoreModule.getInstance();
    const replayRes = await eventStore.replay();
    expect(replayRes.status).toBe('SUCCESS');
    expect(replayRes.eventsReplayed).toBeGreaterThan(0);

    const checkpoints = await eventStore.getCheckpoints();
    const aoiCp = checkpoints.find((c) => c.projectionName === 'AoiProjector');
    expect(aoiCp).toBeDefined();
  });
});
