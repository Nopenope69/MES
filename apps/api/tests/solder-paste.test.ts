import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { SolderPasteService } from '../src/services/solder-paste.service';
import { PrinterAuthorizationService } from '../src/services/printer-authorization.service';
import { FakeClock } from '../src/utils/clock';

describe('Solder Paste & Stencil Lifecycle Management Suite (Stage 01 SPG-01)', () => {
  let fakeClock: FakeClock;
  let pasteService: SolderPasteService;
  let printerAuth: PrinterAuthorizationService;

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();

    fakeClock = new FakeClock('2026-09-04T06:00:00.000Z');
    pasteService = new SolderPasteService(fakeClock);
    printerAuth = new PrinterAuthorizationService(fakeClock);

    // Insert a fresh test paste jar
    const db = getDatabase();
    await db.execute(`
      INSERT OR REPLACE INTO solder_paste_jars (
        id, jar_id, part_number, profile_id, alloy_type, lot_number,
        expiry_date, status, current_work_center_id
      ) VALUES (
        'jar-test-01', 'JAR-ALPHA-TEST-01', 'ALPHA-OM338-PT', 'spp-alpha-om338', 'SAC305',
        'LOT-ALPHA-T01', '2026-12-31T00:00:00Z', 'REFRIGERATED', 'wc-spg-01'
      )
    `);
  });

  it('Removes paste jar from cold storage and sets status to THAWING', async () => {
    await pasteService.removeFromCold('JAR-ALPHA-TEST-01', 'op-prep-01');

    const db = getDatabase();
    const rows = await db.query<any>('SELECT status, removed_from_cold_at FROM solder_paste_jars WHERE jar_id = ?', ['JAR-ALPHA-TEST-01']);
    expect(rows[0].status).toBe('THAWING');
    expect(rows[0].removed_from_cold_at).toBe('2026-09-04T06:00:00.000Z');
  });

  it('Rejects thaw verification if duration is under the configured profile (240 min required)', async () => {
    // Advance clock by only 120 minutes (2 hours)
    fakeClock.advanceMinutes(120);

    const result = await pasteService.verifyThaw('JAR-ALPHA-TEST-01', 23.5, 'op-prep-01');
    expect(result.thawSufficient).toBe(false);
    expect(result.actualThawMinutes).toBe(120);
    expect(result.requiredThawMinutes).toBe(240);
  });

  it('Rejects thaw verification if temperature is below 22.0°C even if time elapsed', async () => {
    // Advance clock by another 120 minutes (total 240 minutes = 4 hours)
    fakeClock.advanceMinutes(120);

    // Temperature verified at 19.5°C (below minimum 22.0°C)
    const result = await pasteService.verifyThaw('JAR-ALPHA-TEST-01', 19.5, 'op-prep-01');
    expect(result.thawSufficient).toBe(false);
    expect(result.actualThawMinutes).toBe(240);
  });

  it('Approves thaw when both required duration (>= 240m) and temperature (>= 22.0°C) are satisfied', async () => {
    // Temperature verified at 23.2°C
    const result = await pasteService.verifyThaw('JAR-ALPHA-TEST-01', 23.2, 'op-prep-01');
    expect(result.thawSufficient).toBe(true);

    const db = getDatabase();
    const rows = await db.query<any>('SELECT status FROM solder_paste_jars WHERE jar_id = ?', ['JAR-ALPHA-TEST-01']);
    expect(rows[0].status).toBe('THAWED');
  });

  it('Rejects mixing if duration is outside profile boundaries (< 120s or > 300s)', async () => {
    // Try mixing for only 45 seconds
    const result = await pasteService.recordMixing('JAR-ALPHA-TEST-01', 45, 'CENTRIFUGAL_PLANETARY', 'op-prep-01');
    expect(result.mixSufficient).toBe(false);
  });

  it('Approves mixing when compliant with profile parameters (120s)', async () => {
    const result = await pasteService.recordMixing('JAR-ALPHA-TEST-01', 120, 'CENTRIFUGAL_PLANETARY', 'op-prep-01');
    expect(result.mixSufficient).toBe(true);

    const db = getDatabase();
    const rows = await db.query<any>('SELECT status FROM solder_paste_jars WHERE jar_id = ?', ['JAR-ALPHA-TEST-01']);
    expect(rows[0].status).toBe('MIXED');
  });

  it('Authorizes qualified paste jar for printer staging', async () => {
    await pasteService.authorizeForPrinter('JAR-ALPHA-TEST-01', 'wc-spg-01', 'op-prep-01');

    const db = getDatabase();
    const rows = await db.query<any>('SELECT status FROM solder_paste_jars WHERE jar_id = ?', ['JAR-ALPHA-TEST-01']);
    expect(rows[0].status).toBe('AUTHORIZED');
  });

  it('Loads authorized jar on stencil and starts stencil session with 480m life', async () => {
    const { sessionId } = await pasteService.loadOnStencil('JAR-ALPHA-TEST-01', 'STC-SM-4G-TOP', 'wc-spg-01', 'wo-dixon-01', 'op-spg-01');

    const lifeStatus = await pasteService.checkStencilLife(sessionId);
    expect(lifeStatus.stencilLifeMinutes).toBe(480);
    expect(lifeStatus.elapsedMinutes).toBe(0);
    expect(lifeStatus.remainingMinutes).toBe(480);
    expect(lifeStatus.isExpired).toBe(false);

    // Screen printer authorization passes
    const auth = await printerAuth.authorizeScreenPrinter({
      workCenterId: 'wc-spg-01',
      stencilId: 'STC-SM-4G-TOP',
      pasteJarId: 'JAR-ALPHA-TEST-01'
    });
    expect(auth.allowed).toBe(true);
    expect(auth.decisionCode).toBe('APPROVED');
  });

  it('Trips screen printer interlock when stencil life exceeds profile limit (8 hours = 480m)', async () => {
    const db = getDatabase();
    const sessions = await db.query<any>("SELECT id FROM stencil_sessions WHERE work_center_id = 'wc-spg-01' ORDER BY started_at DESC LIMIT 1");
    const sessionId = sessions[0].id;

    // Advance clock by 9 hours (540 minutes)
    fakeClock.advanceHours(9);

    const lifeStatus = await pasteService.checkStencilLife(sessionId);
    expect(lifeStatus.isExpired).toBe(true);
    expect(lifeStatus.remainingMinutes).toBe(0);

    // Screen printer authorization BLOCKS
    const auth = await printerAuth.authorizeScreenPrinter({
      workCenterId: 'wc-spg-01',
      stencilId: 'STC-SM-4G-TOP',
      pasteJarId: 'JAR-ALPHA-TEST-01'
    });
    expect(auth.allowed).toBe(false);
    expect(auth.decisionCode).toBe('BLOCKED_STENCIL_EXPIRED');
  });
});
