import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { SplicingAuthorizationService } from '../src/services/splicing-authorization.service';
import { FujiNeximAdapter } from '../src/adapters/fuji-nexim.adapter';
import { app } from '../src/server';
import http from 'http';

describe('SplicingAuthorizationService (Unified Quality Gate Suite)', () => {
  const adapter = new FujiNeximAdapter();
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });

    // Seed a known expired MSL reel for testing
    const db = getDatabase();
    await db.execute(`
      INSERT OR REPLACE INTO component_reels (
        id, reel_id, part_number, part_name, supplier_name, lot_number,
        date_code, initial_quantity, current_quantity, status, msl_level,
        msl_class, msl_remaining_minutes, floor_clock_state
      ) VALUES (
        'reel-exp-test', 'REEL-EXPIRED-TEST-01', 'C0402-100NF-16V', '100nF Cap',
        'Murata', 'LOT-EXP-01', '2635', 5000, 5000, 'EXPIRED_MSL', 3,
        'MSL_3', 0, 'BAKE_REQUIRED'
      )
    `);

    // Seed a quarantined reel
    await db.execute(`
      INSERT OR REPLACE INTO component_reels (
        id, reel_id, part_number, part_name, supplier_name, lot_number,
        date_code, initial_quantity, current_quantity, status, msl_level,
        msl_class, msl_remaining_minutes, floor_clock_state
      ) VALUES (
        'reel-quar-test', 'REEL-QUARANTINE-01', 'C0402-100NF-16V', '100nF Cap',
        'Murata', 'LOT-QUAR-01', '2635', 5000, 5000, 'QUARANTINED', 1,
        'MSL_1', 999999, 'FLOOR_EXPOSURE'
      )
    `);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('approves when BOM matches and reel is valid', async () => {
    const decision = await SplicingAuthorizationService.authorizeSplicing({
      workCenterId: 'wc-nxt-01',
      slotNo: 1,
      scannedPartNumber: 'C0402-100NF-16V',
      scannedReelId: 'REEL-MUR-98124'
    });

    expect(decision.allowed).toBe(true);
    expect(decision.decisionCode).toBe('APPROVED');
  });

  it('blocks with BLOCKED_BOM_MISMATCH when scanned part differs from slot BOM', async () => {
    const decision = await SplicingAuthorizationService.authorizeSplicing({
      workCenterId: 'wc-nxt-01',
      slotNo: 1,
      scannedPartNumber: 'WRONG-PART-999'
    });

    expect(decision.allowed).toBe(false);
    expect(decision.decisionCode).toBe('BLOCKED_BOM_MISMATCH');
    expect(decision.expectedPartNumber).toBe('C0402-100NF-16V');
  });

  it('blocks with BLOCKED_SLOT_NOT_CONFIGURED for invalid slot', async () => {
    const decision = await SplicingAuthorizationService.authorizeSplicing({
      workCenterId: 'wc-nxt-01',
      slotNo: 999,
      scannedPartNumber: 'C0402-100NF-16V'
    });

    expect(decision.allowed).toBe(false);
    expect(decision.decisionCode).toBe('BLOCKED_SLOT_NOT_CONFIGURED');
  });

  it('blocks with BLOCKED_MSL_EXPIRED when reel floor life is depleted', async () => {
    const decision = await SplicingAuthorizationService.authorizeSplicing({
      workCenterId: 'wc-nxt-01',
      slotNo: 1,
      scannedPartNumber: 'C0402-100NF-16V',
      scannedReelId: 'REEL-EXPIRED-TEST-01'
    });

    expect(decision.allowed).toBe(false);
    expect(decision.decisionCode).toBe('BLOCKED_MSL_EXPIRED');
    expect(decision.mslState).toBe('BAKE_REQUIRED');
  });

  it('blocks with BLOCKED_REEL_NOT_USABLE when reel is quarantined', async () => {
    const decision = await SplicingAuthorizationService.authorizeSplicing({
      workCenterId: 'wc-nxt-01',
      slotNo: 1,
      scannedPartNumber: 'C0402-100NF-16V',
      scannedReelId: 'REEL-QUARANTINE-01'
    });

    expect(decision.allowed).toBe(false);
    expect(decision.decisionCode).toBe('BLOCKED_REEL_NOT_USABLE');
  });

  it('Proves BOTH REST endpoint and Fuji Adapter evaluate the exact same underlying decision', async () => {
    // 1. REST endpoint call with expired MSL reel
    const res = await fetch(`${baseUrl}/api/v1/smt/splice-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workCenterId: 'wc-nxt-01',
        slotNo: 1,
        scannedPartNumber: 'C0402-100NF-16V',
        scannedReelId: 'REEL-EXPIRED-TEST-01'
      })
    });

    expect(res.status).toBe(400);
    const restData = await res.json();
    expect(restData.valid).toBe(false);
    expect(restData.decisionCode).toBe('BLOCKED_MSL_EXPIRED');

    // 2. Fuji Adapter interlock evaluation for the same parameters
    const fujiAllowed = await adapter.verifySplicingInterlock(
      1,
      'C0402-100NF-16V',
      'wc-nxt-01',
      'REEL-EXPIRED-TEST-01'
    );

    expect(fujiAllowed).toBe(false);
    // Identical gate decision confirmed!
  });
});
