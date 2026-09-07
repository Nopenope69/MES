import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDatabase, getDatabase } from '../../src/db/database';
import { seedDatabase } from '../../src/db/seed';
import {
  MachineControlModule,
  InMemoryEquipmentAdapter
} from '../../src/modules/machine-control';
import { FujiNeximAdapter } from '../../src/adapters/fuji-nexim.adapter';
import { FujiGpxPrinterAdapter } from '../../src/adapters/cfx/fuji-gpx-printer.adapter';

describe('MachineControlModule: Hardware Abstraction Layer & Control Seam Suite', () => {
  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();
  });

  beforeEach(() => {
    MachineControlModule.resetInstance();
  });

  it('enforces capability guards before dispatching machine parameter modifications', async () => {
    const mockAdapter = new InMemoryEquipmentAdapter({
      id: 'mock-no-params',
      workCenterId: 'wc-no-params',
      capabilities: ['HOLD'] // Only HOLD, no PARAMETER_MODIFICATION
    });

    const module = MachineControlModule.getInstance();
    module.registerAdapter(mockAdapter);

    await expect(
      module.applyParameters('wc-no-params', [
        { type: 'PRINTER_PRESSURE', value: 9.0 }
      ])
    ).rejects.toThrow(/does not support PARAMETER_MODIFICATION/);
  });

  it('enforces capability guards before dispatching machine actions', async () => {
    const mockAdapter = new InMemoryEquipmentAdapter({
      id: 'mock-no-actions',
      workCenterId: 'wc-no-actions',
      capabilities: ['HOLD'] // Only HOLD, no CLEANING
    });

    const module = MachineControlModule.getInstance();
    module.registerAdapter(mockAdapter);

    await expect(
      module.executeAction('wc-no-actions', {
        type: 'CLEANING',
        mode: 'VACUUM_SOLVENT'
      })
    ).rejects.toThrow(/does not support CLEANING capability/);
  });

  it('atomically trips interlock hold, updates work_centers DB, and emits audit event', async () => {
    const mockAdapter = new InMemoryEquipmentAdapter({
      id: 'mock-fuji-01',
      workCenterId: 'wc-nxt-01',
      capabilities: ['HOLD']
    });

    const module = MachineControlModule.getInstance();
    module.registerAdapter(mockAdapter);

    const tripResult = await module.tripInterlock('wc-nxt-01', 'Consecutive Tombstone defect on R12', {
      refDes: 'R12',
      defectType: 'TOMBSTONE',
      consecutiveCount: 3,
      slidingWindowCount: 3
    });

    expect(tripResult.success).toBe(true);
    expect(tripResult.holdActive).toBe(true);
    expect(mockAdapter.isHoldActive().active).toBe(true);
    expect(mockAdapter.isHoldActive().reason).toBe('Consecutive Tombstone defect on R12');

    // Verify DB state updated
    const db = getDatabase();
    const rows = await db.query<{ current_state: string }>(
      'SELECT current_state FROM work_centers WHERE id = ?',
      ['wc-nxt-01']
    );
    expect(rows[0].current_state).toBe('QUALITY_HOLD');

    // Verify audit event persisted in event log
    const events = await db.query<{ event_type: string; payload_json: string }>(
      'SELECT event_type, payload_json FROM production_events WHERE event_id = ?',
      [tripResult.auditEventId]
    );
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe('REPEAT_DEFECT_INTERLOCK_TRIPPED');
  });

  it('clears interlock hold, restores RUNNING state, and emits state change event', async () => {
    const mockAdapter = new InMemoryEquipmentAdapter({
      id: 'mock-fuji-01',
      workCenterId: 'wc-nxt-01',
      capabilities: ['HOLD']
    });

    const module = MachineControlModule.getInstance();
    module.registerAdapter(mockAdapter);

    // Trip then clear
    await module.tripInterlock('wc-nxt-01', 'Test hold');
    const clearResult = await module.clearInterlock(
      'wc-nxt-01',
      'QA-SUPERVISOR-99',
      'Root cause resolved and test board passed'
    );

    expect(clearResult.success).toBe(true);
    expect(mockAdapter.isHoldActive().active).toBe(false);

    // Verify DB state restored
    const db = getDatabase();
    const rows = await db.query<{ current_state: string }>(
      'SELECT current_state FROM work_centers WHERE id = ?',
      ['wc-nxt-01']
    );
    expect(rows[0].current_state).toBe('RUNNING');
  });

  it('dispatches strongly-typed printer parameter commands and emits audit events', async () => {
    const printer = new FujiGpxPrinterAdapter();
    const module = MachineControlModule.getInstance();
    module.registerAdapter(printer);

    const result = await module.applyParameters('wc-spg-01', [
      { type: 'PRINTER_PRESSURE', value: 9.2, unit: 'kgf' },
      { type: 'PRINTER_SEPARATION_SPEED', value: 1.5, unit: 'mm/s' }
    ]);

    expect(result.success).toBe(true);
    expect(result.appliedCommands.length).toBe(2);

    const state = printer.getState();
    expect(state.squeegeePressureKgf).toBe(9.2);
    expect(state.separationSpeedMmS).toBe(1.5);

    // Verify audit event in event store
    const db = getDatabase();
    const events = await db.query<{ event_type: string }>(
      'SELECT event_type FROM production_events WHERE work_center_id = ? AND event_type = ?',
      ['wc-spg-01', 'PRINTER_PARAMETERS_MODIFIED']
    );
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it('dispatches strongly-typed cleaning action command to screen printer', async () => {
    const printer = new FujiGpxPrinterAdapter();
    const module = MachineControlModule.getInstance();
    module.registerAdapter(printer);

    const result = await module.executeAction('wc-spg-01', {
      type: 'CLEANING',
      mode: 'VACUUM_SOLVENT',
      triggerReason: 'SPC Cpk degradation on QFP aperture'
    });

    expect(result.success).toBe(true);
    expect(printer.getState().cleaningCyclesTotal).toBeGreaterThanOrEqual(1);

    // Verify audit event
    const db = getDatabase();
    const events = await db.query<{ event_type: string }>(
      'SELECT event_type FROM production_events WHERE work_center_id = ? AND event_type = ?',
      ['wc-spg-01', 'PRINTER_CLEANING_COMMANDED']
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('integrates with production FujiNeximAdapter implementing IControllableEquipmentAdapter', async () => {
    const fuji = new FujiNeximAdapter();
    const module = MachineControlModule.getInstance();
    module.registerAdapter(fuji);

    expect(fuji.getCapabilities()).toEqual(['HOLD']);

    await module.tripInterlock('wc-nxt-01', 'Feeder pick error threshold exceeded');
    expect(fuji.isHoldActive().active).toBe(true);
    expect(fuji.isHoldActive().reason).toBe('Feeder pick error threshold exceeded');

    await module.clearInterlock('wc-nxt-01', 'TECH-01', 'Feeder tape reel reseated');
    expect(fuji.isHoldActive().active).toBe(false);
  });
});
