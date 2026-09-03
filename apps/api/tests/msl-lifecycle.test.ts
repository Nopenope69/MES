import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { MslService } from '../src/services/msl.service';
import { FakeClock } from '../src/utils/clock';

describe('JEDEC J-STD-033D MSL Floor-Life Lifecycle Suite', () => {
  let fakeClock: FakeClock;
  let mslService: MslService;

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();

    fakeClock = new FakeClock('2026-09-04T00:00:00.000Z');
    mslService = new MslService(fakeClock);

    // Insert a fresh test reel for MSL-4 (nominal floor life = 72 hours = 4320 minutes)
    const db = getDatabase();
    await db.execute(`
      INSERT OR REPLACE INTO component_reels (
        id, reel_id, part_number, part_name, supplier_name, lot_number,
        date_code, initial_quantity, current_quantity, status, msl_level,
        msl_class, msl_remaining_minutes, storage_state, floor_clock_state,
        floor_life_nominal_minutes
      ) VALUES (
        'reel-msl4-test', 'REEL-MSL4-DETERMINISTIC', 'MOD-QUECTEL-EC200U', '4G LTE Module',
        'Quectel', 'LOT-TEST-MSL4', '2635', 500, 500, 'READY', 4,
        'MSL_4', 4320, 'SEALED_MBB', 'SEALED', 4320
      )
    `);
  });

  it('MSL 1 component has unlimited floor life (999,999 minutes) and is never expired', async () => {
    const status = await mslService.getReelMslStatus('REEL-MUR-98124');
    expect(status.mslClass).toBe('MSL_1');
    expect(status.remainingFloorLifeMinutes).toBe(999999);
    expect(status.isExpired).toBe(false);
  });

  it('Sealed MBB reel maintains 100% nominal floor life before unsealing', async () => {
    const status = await mslService.getReelMslStatus('REEL-MSL4-DETERMINISTIC');
    expect(status.storageState).toBe('SEALED_MBB');
    expect(status.floorClockState).toBe('SEALED');
    expect(status.remainingFloorLifeMinutes).toBe(4320);
    expect(status.isExpired).toBe(false);
  });

  it('Unsealing reel initiates ambient exposure interval and begins floor life countdown', async () => {
    await mslService.unsealReel('REEL-MSL4-DETERMINISTIC', 'op-qa-01');

    const status = await mslService.getReelMslStatus('REEL-MSL4-DETERMINISTIC');
    expect(status.storageState).toBe('AMBIENT_EXPOSURE');
    expect(status.floorClockState).toBe('FLOOR_EXPOSURE');
    expect(status.remainingFloorLifeMinutes).toBe(4320);
  });

  it('Accurately tracks ambient exposure over time using FakeClock', async () => {
    // Advance clock by 20 hours (1200 minutes)
    fakeClock.advanceHours(20);

    const status = await mslService.getReelMslStatus('REEL-MSL4-DETERMINISTIC');
    expect(status.cumulativeAmbientSeconds).toBe(20 * 3600);
    expect(status.remainingFloorLifeMinutes).toBe(4320 - 1200); // 3120 minutes (52 hours) left
    expect(status.isExpired).toBe(false);
  });

  it('Dry Storage pause: Entering dry cabinet halts exposure accumulation', async () => {
    // Put reel into Dry Cabinet
    await mslService.enterDryStorage('REEL-MSL4-DETERMINISTIC', 'DRY-CAB-01', 'op-qa-01');

    // Advance clock by 100 hours in dry cabinet
    fakeClock.advanceHours(100);

    const status = await mslService.getReelMslStatus('REEL-MSL4-DETERMINISTIC');
    expect(status.storageState).toBe('DRY_STORAGE');
    expect(status.floorClockState).toBe('DRY_STORAGE');
    // Exposure must NOT have accumulated the 100 hours in dry storage!
    expect(status.cumulativeAmbientSeconds).toBe(20 * 3600);
    expect(status.remainingFloorLifeMinutes).toBe(3120);
    expect(status.isExpired).toBe(false);
  });

  it('Exiting dry cabinet resumes ambient exposure countdown seamlessly', async () => {
    // Exit dry cabinet back to factory floor
    await mslService.exitDryStorage('REEL-MSL4-DETERMINISTIC', 'DRY-CAB-01', 'op-qa-01');

    // Advance clock by 10 hours ambient exposure
    fakeClock.advanceHours(10);

    const status = await mslService.getReelMslStatus('REEL-MSL4-DETERMINISTIC');
    expect(status.storageState).toBe('AMBIENT_EXPOSURE');
    expect(status.floorClockState).toBe('FLOOR_EXPOSURE');
    // Total exposure = 20h (first cycle) + 10h (second cycle) = 30 hours
    expect(status.cumulativeAmbientSeconds).toBe(30 * 3600);
    expect(status.remainingFloorLifeMinutes).toBe(4320 - (30 * 60)); // 2520 minutes
    expect(status.isExpired).toBe(false);
  });

  it('Trips MSL quality gate when cumulative ambient exposure exceeds nominal floor life', async () => {
    // Remaining is 42 hours (2520 minutes). Advance clock by 43 hours (2580 minutes)
    fakeClock.advanceHours(43);

    const status = await mslService.getReelMslStatus('REEL-MSL4-DETERMINISTIC');
    expect(status.isExpired).toBe(true);
    expect(status.remainingFloorLifeMinutes).toBe(0);
    expect(status.floorClockState).toBe('BAKE_REQUIRED');
  });

  it('Bake insufficiency: Rejects bake completion if duration is under standard profile', async () => {
    // Start bake in 125C oven (Profile BAKE-JEDEC-125C-24H requires 24h = 1440 min)
    await mslService.startBake('REEL-MSL4-DETERMINISTIC', 'OVEN-01', 'BAKE-JEDEC-125C-24H', 'op-bake-01');

    // Advance clock by only 6 hours (insufficient!)
    fakeClock.advanceHours(6);

    const result = await mslService.completeBake('REEL-MSL4-DETERMINISTIC', 'OVEN-01', 'op-bake-01');
    expect(result.bakeSufficient).toBe(false);

    const status = await mslService.getReelMslStatus('REEL-MSL4-DETERMINISTIC');
    expect(status.floorClockState).toBe('BAKE_REQUIRED');
    expect(status.isExpired).toBe(true);
  });

  it('Bake compliance: Fully restores nominal floor life when compliant bake duration is satisfied', async () => {
    // Start fresh bake session
    await mslService.startBake('REEL-MSL4-DETERMINISTIC', 'OVEN-01', 'BAKE-JEDEC-125C-24H', 'op-bake-01');

    // Advance clock by 24 hours (compliant!)
    fakeClock.advanceHours(24);

    const result = await mslService.completeBake('REEL-MSL4-DETERMINISTIC', 'OVEN-01', 'op-bake-01');
    expect(result.bakeSufficient).toBe(true);

    const status = await mslService.getReelMslStatus('REEL-MSL4-DETERMINISTIC');
    expect(status.bakeStatus).toBe('COMPLETED_VALID');
    expect(status.floorClockState).toBe('FLOOR_EXPOSURE');
    expect(status.remainingFloorLifeMinutes).toBe(4320); // 100% Restored!
    expect(status.isExpired).toBe(false);
  });
});
