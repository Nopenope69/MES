import { describe, it, expect, beforeAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { EventIngestionService } from '../src/services/event-ingestion.service';
import { EventUpcasterService } from '../src/services/event-upcaster.service';
import { ProjectionReplayService } from '../src/services/projection-replay.service';
import { EquipmentGatewayManager } from '../src/adapters/equipment-gateway.manager';

describe('Track A: Architecture & Event Sourcing Suite', () => {
  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();
  });

  it('enforces Idempotency: duplicate eventId skips duplicate write and duplicate projection', async () => {
    const db = getDatabase();
    const testEventId = `evt-idem-${uuidv4()}`;

    // First ingestion
    const res1 = await EventIngestionService.ingest({
      eventId: testEventId,
      eventType: 'STATE_CHANGED',
      workCenterId: 'wc-nxt-01',
      sourceType: 'MANUAL_UI',
      sourceId: 'test-runner',
      payload: {
        previousState: 'RUNNING',
        currentState: 'IDLE',
        comment: 'Idempotency test initial'
      }
    });

    expect(res1.success).toBe(true);

    // Second ingestion with identical eventId
    const res2 = await EventIngestionService.ingest({
      eventId: testEventId,
      eventType: 'STATE_CHANGED',
      workCenterId: 'wc-nxt-01',
      sourceType: 'MANUAL_UI',
      sourceId: 'test-runner',
      payload: {
        previousState: 'RUNNING',
        currentState: 'IDLE',
        comment: 'Idempotency duplicate'
      }
    });

    expect(res2.success).toBe(true);
    expect(res2.message).toContain('idempotent duplicate skipped');

    // Verify exactly one record exists in production_events
    const rows = await db.query(
      'SELECT id, event_id FROM production_events WHERE event_id = ?',
      [testEventId]
    );
    expect(rows.length).toBe(1);
  });

  it('upcasts legacy event schemas dynamically via EventUpcasterService', async () => {
    // Register test upcaster: v0.9.0 -> v1.0.0
    EventUpcasterService.registerUpcaster(
      'PANEL_CHECKOUT',
      '0.9.0',
      '1.0.0',
      (payload) => ({
        ...payload,
        upcastedLegacyField: true,
        cycleTimeSeconds: payload.cycleTimeSeconds || 15.0
      })
    );

    const legacyEventId = `evt-upcast-${uuidv4()}`;
    const res = await EventIngestionService.ingest({
      eventId: legacyEventId,
      eventType: 'PANEL_CHECKOUT',
      schemaVersion: '0.9.0',
      workCenterId: 'wc-nxt-01',
      sourceType: 'INTEGRATION_SOCKET',
      sourceId: 'fuji-legacy',
      payload: {
        panelBarcode: 'PNL-UPCAST-001',
        programName: 'PROG-SM-METER-TOP-REV4',
        blockCount: 2,
        blockSkipCount: 0
      }
    });

    expect(res.success).toBe(true);

    const db = getDatabase();
    const rows = await db.query<any>(
      'SELECT schema_version, payload_json FROM production_events WHERE event_id = ?',
      [legacyEventId]
    );

    expect(rows.length).toBe(1);
    expect(rows[0].schema_version).toBe('1.0.0');
    const storedPayload = JSON.parse(rows[0].payload_json);
    expect(storedPayload.upcastedLegacyField).toBe(true);
    expect(storedPayload.cycleTimeSeconds).toBe(15.0);
  });

  it('maintains high-water mark projection checkpoints for all registered projectors', async () => {
    const checkpoints = await ProjectionReplayService.getCheckpoints();
    expect(checkpoints.length).toBeGreaterThan(0);

    const coreCheckpoint = checkpoints.find(c => c.projectionName === 'CoreProjector');
    expect(coreCheckpoint).toBeDefined();
    expect(coreCheckpoint?.eventsProcessed).toBeGreaterThan(0);
    expect(coreCheckpoint?.lastEventId).toBeDefined();
  });

  it('captures and retrieves point-in-time aggregate snapshots for O(1) catch-up', async () => {
    const aggregateType = 'FEEDER_BANK';
    const aggregateId = 'wc-nxt-01-bank-A';
    const sampleState = {
      slots: [
        { slotNo: 1, partNumber: 'C0402-100NF-16V', reelId: 'REEL-MUR-98124' },
        { slotNo: 2, partNumber: 'R0402-10K-1%', reelId: 'REEL-VSH-44120' }
      ],
      snapshotTimestamp: new Date().toISOString()
    };

    const snapshotId = await ProjectionReplayService.saveSnapshot(
      aggregateType,
      aggregateId,
      1,
      sampleState
    );

    expect(snapshotId).toBeDefined();

    const retrieved = await ProjectionReplayService.getLatestSnapshot(
      aggregateType,
      aggregateId
    );

    expect(retrieved).not.toBeNull();
    expect(retrieved?.snapshotVersion).toBe(1);
    expect(retrieved?.state.slots.length).toBe(2);
    expect(retrieved?.state.slots[0].partNumber).toBe('C0402-100NF-16V');
  });

  it('replays historical event streams through catch-up projection runner', async () => {
    const replayResult = await ProjectionReplayService.replayCatchup();
    expect(replayResult.status).toBe('SUCCESS');
    expect(replayResult.eventsReplayed).toBeGreaterThan(0);
  });

  it('exposes Hardware Abstraction Layer (HAL) Equipment Gateway Manager and status', () => {
    const manager = EquipmentGatewayManager.getInstance();
    const statuses = manager.getAllStatuses();

    expect(statuses.length).toBeGreaterThanOrEqual(1);
    const fuji = statuses.find(s => s.id === 'fuji-nxt-01');
    expect(fuji).toBeDefined();
    expect(fuji?.protocolName).toBe('Fuji Nexim Host Interface V2.8.0');
    expect(fuji?.workCenterId).toBe('wc-nxt-01');
  });
});
