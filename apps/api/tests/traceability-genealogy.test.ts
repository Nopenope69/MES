// apps/api/tests/traceability-genealogy.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDatabase, initDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { TraceabilityModule } from '../src/modules/traceability/traceability.module';
import { GenealogyService } from '../src/services/genealogy.service';
import { TokenManager } from '../src/security/jwt';
import { app } from '../src/server';
import http from 'http';

describe('Traceability & Genealogy Module — Unit-Level As-Built Engine', () => {
  let module: TraceabilityModule;
  let server: http.Server;
  let baseUrl: string;
  let qaToken: string;

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();
    module = new TraceabilityModule();

    qaToken = TokenManager.generateAccessToken({
      sub: 'OP-QA-01',
      code: 'QA-SMT-01',
      name: 'Ananya Sharma',
      role: 'QUALITY_INSPECTOR',
      org: 'org-dixon',
      site: 'site-noida-p4',
      authzVersion: 1
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  // Test 1: Unit genealogy for PNL-260901-0042 unit 3 (QUALITY_HOLD with defect & rework)
  it('1. retrieves complete unit genealogy for unit with defects and quality hold', async () => {
    const record = await module.getUnitGenealogy('PNL-260901-0042', 3);

    expect(record.panelBarcode).toBe('PNL-260901-0042');
    expect(record.unitPosition).toBe(3);
    expect(record.unitSerialNumber).toBe('SN-MTR-0042-U3');
    expect(record.unitStatus).toBe('QUALITY_HOLD');

    // Batch metadata
    expect(record.batch.batchNumber).toBe('JOB-SM-260901');
    expect(record.batch.productCode).toBe('PRD-SM-4G-V2');

    // Placement chain has CAD, Feeder, Reel with provenance
    expect(record.placementChain.length).toBeGreaterThan(0);
    const c12Placement = record.placementChain.find(p => p.refDes === 'C12');
    expect(c12Placement).toBeDefined();
    expect(c12Placement!.partNumber).toBe('C0402-100NF-16V');
    expect(c12Placement!.componentReel.reelId).toBe('REEL-MUR-98124');
    expect(c12Placement!.linkage.source).toBeDefined();
    expect(c12Placement!.linkage.confidence).toBeDefined();

    // Solder paste & stencil
    expect(record.solderPaste.length).toBeGreaterThanOrEqual(1);
    expect(record.solderPaste[0].alloyType).toBe('SAC305');
    expect(record.stencil).toBeDefined();
    expect(record.stencil?.stencilId).toBe('STC-SM-4G-TOP');

    // AOI inspection results show defect on C12
    expect(record.aoiInspections.length).toBeGreaterThanOrEqual(1);
    const postReflow = record.aoiInspections.find(i => i.phase === 'POST_REFLOW');
    expect(postReflow).toBeDefined();
    expect(postReflow!.unitDefects.length).toBeGreaterThanOrEqual(1);
    const tombstone = postReflow!.unitDefects.find(d => d.refDes === 'C12');
    expect(tombstone).toBeDefined();
    expect(tombstone!.defectType).toBe('TOMBSTONE');
    expect(tombstone!.defectCategory).toBe('SOLDER');

    // Reflow profile linkage
    expect(record.reflowProfile).toBeDefined();
    expect(record.reflowProfile?.overallPwi).toBeDefined();
    expect(record.reflowProfile?.complianceResult).toBe('PASS');
  });

  // Test 2: Unit genealogy for PNL-260901-0042 unit 1 (PASSED clean unit)
  it('2. retrieves clean unit genealogy for passed board unit with no defects', async () => {
    const record = await module.getUnitGenealogy('PNL-260901-0042', 1);

    expect(record.panelBarcode).toBe('PNL-260901-0042');
    expect(record.unitPosition).toBe(1);
    expect(record.unitSerialNumber).toBe('SN-MTR-0042-U1');
    expect(record.unitStatus).toBe('PASSED');

    // Clean unit has no AOI defects
    const postReflow = record.aoiInspections.find(i => i.phase === 'POST_REFLOW');
    expect(postReflow?.unitDefects.length).toBe(0);

    // No rework history on clean unit
    expect(record.reworkHistory.length).toBe(0);

    // Still has full placement chain and paste/stencil/reflow history
    expect(record.placementChain.length).toBeGreaterThan(0);
    expect(record.solderPaste.length).toBeGreaterThan(0);
    expect(record.reflowProfile).toBeDefined();
  });

  // Test 3: Panel genealogy query count regression assertion (O(tables), NOT N * O(tables))
  it('3. asserts panel genealogy bulk assembly runs in O(tables) bounded query count for 6 units', async () => {
    const db = getDatabase();
    let queryCount = 0;
    const originalQuery = db.query.bind(db);

    // Spy on db.query
    db.query = async (...args: any[]) => {
      queryCount++;
      return originalQuery(...args);
    };

    try {
      const panelRecord = await module.getPanelGenealogy('PNL-260901-0042');

      expect(panelRecord.panelBarcode).toBe('PNL-260901-0042');
      expect(panelRecord.units.length).toBe(6);

      // Verifies all 6 units are assembled in memory from bulk retrieval
      expect(panelRecord.units.map(u => u.unitPosition)).toEqual([1, 2, 3, 4, 5, 6]);

      // Bounded Query Count Invariant:
      // ~18 bulk queries for the panel. Must NOT scale as 6 units * 18 queries = 108!
      expect(queryCount).toBeLessThanOrEqual(20);
    } finally {
      db.query = originalQuery;
    }
  });

  // Test 4: Set-based batch genealogy summary
  it('4. computes set-based batch genealogy summary without looping over panel records', async () => {
    const batchSummary = await module.getBatchGenealogy('JOB-SM-260901');

    expect(batchSummary.batch.batchNumber).toBe('JOB-SM-260901');
    expect(batchSummary.batch.productCode).toBe('PRD-SM-4G-V2');
    expect(batchSummary.summary.totalPanels).toBeGreaterThanOrEqual(1);
    expect(batchSummary.summary.totalUnits).toBeGreaterThanOrEqual(6);
    expect(batchSummary.summary.passedUnits).toBeGreaterThanOrEqual(5);
    expect(batchSummary.summary.heldUnits).toBeGreaterThanOrEqual(1);
    expect(batchSummary.panels.length).toBeGreaterThanOrEqual(1);
    expect(batchSummary.materialsConsumed.length).toBeGreaterThanOrEqual(1);
  });

  // Test 5: Backward recall by reel ID (set-based)
  it('5. executes set-based backward recall by component reel ID', async () => {
    const report = await module.recallByIdentifier('REEL-MUR-98124');

    expect(report.queryTarget).toBe('REEL-MUR-98124');
    expect(report.targetType).toBe('COMPONENT_REEL');
    expect(report.status).toBe('CONTAINED');
    expect(report.containmentRecommendation).toBe('QUARANTINE_REQUIRED');
    expect(report.affectedBatches.length).toBeGreaterThanOrEqual(1);
    expect(report.affectedBatches[0].batchNumber).toBe('JOB-SM-260901');
    expect(report.affectedPanels.length).toBeGreaterThanOrEqual(1);

    // Affected units pinpoint RefDes C12
    expect(report.affectedUnits.length).toBeGreaterThanOrEqual(1);
    const unit3 = report.affectedUnits.find(u => u.unitPosition === 3);
    expect(unit3).toBeDefined();
    expect(unit3!.affectedRefDes).toContain('C12');
  });

  // Test 6: Backward recall by paste lot
  it('6. executes set-based backward recall by solder paste lot', async () => {
    const report = await module.recallByIdentifier('LOT-PASTE-2601');

    expect(report.queryTarget).toBe('LOT-PASTE-2601');
    expect(report.targetType).toBe('PASTE_LOT');
    expect(report.status).toBe('CONTAINED');
    expect(report.affectedBatches.length).toBeGreaterThanOrEqual(1);
    expect(report.affectedPanels.length).toBeGreaterThanOrEqual(1);
  });

  // Test 7: Backward recall by stencil serial
  it('7. executes set-based backward recall by stencil serial number', async () => {
    const report = await module.recallByIdentifier('STN-2026-0042');

    expect(report.queryTarget).toBe('STN-2026-0042');
    expect(report.targetType).toBe('STENCIL_SERIAL');
    expect(report.status).toBe('CONTAINED');
    expect(report.affectedBatches.length).toBeGreaterThanOrEqual(1);
  });

  // Test 8: Serial number direct lookup
  it('8. resolves board unit by unit serial number', async () => {
    const record = await module.lookupBySerialNumber('SN-MTR-0042-U3');

    expect(record.panelBarcode).toBe('PNL-260901-0042');
    expect(record.unitPosition).toBe(3);
    expect(record.unitSerialNumber).toBe('SN-MTR-0042-U3');
    expect(record.unitStatus).toBe('QUALITY_HOLD');
  });

  // Test 9: Placement chain composite join integrity
  it('9. verifies placement chain composite joins: RefDes -> CAD -> Feeder Slot -> Reel -> MSL', async () => {
    const record = await module.getUnitGenealogy('PNL-260901-0042', 3);

    for (const item of record.placementChain) {
      expect(item.refDes).toBeDefined();
      expect(item.partNumber).toBeDefined();
      expect(item.cadCoordinates.xMm).toBeGreaterThanOrEqual(0);
      expect(item.cadCoordinates.yMm).toBeGreaterThanOrEqual(0);
      expect(item.feederSlot.slotNo).toBeGreaterThanOrEqual(1);
      expect(item.componentReel.reelId).toBeDefined();
      expect(item.componentReel.mslClass).toBeDefined();
      expect(item.linkage.confidence).toBeDefined();
    }
  });

  // Test 10: SPI pad measurements mapped to unit
  it('10. verifies SPI pad measurements are projected onto the board unit', async () => {
    const record = await module.getUnitGenealogy('PNL-260901-0042', 3);

    expect(record.spiInspection).toBeDefined();
    expect(record.spiInspection?.opticalMachineId).toBe('KY-ASPIRE3-01');
    expect(record.spiInspection?.unitCriticalPads.length).toBeGreaterThanOrEqual(1);

    const pad = record.spiInspection!.unitCriticalPads[0];
    expect(pad.refDes).toBe('C12');
    expect(pad.volumeRatioPct).toBeDefined();
    expect(pad.heightUm).toBeDefined();
  });

  // Test 11: Direct profile-run ID reflow linkage
  it('11. verifies direct profile_run_id linkage yields EXACT confidence', async () => {
    const record = await module.getUnitGenealogy('PNL-260901-0042', 1);

    expect(record.reflowProfile).toBeDefined();
    expect(record.reflowProfile?.profileRunId).toBe('run-prf-20260908-01');
    expect(record.reflowProfile?.linkage.source).toBe('DIRECT_FK');
    expect(record.reflowProfile?.linkage.confidence).toBe('EXACT');
  });

  // Test 12: Facade backward compatibility
  it('12. preserves backward compatibility of GenealogyService.traceBatch() returning GenealogyTree', async () => {
    const tree = await GenealogyService.traceBatch('JOB-SM-260901');

    expect(tree.rootId).toBeDefined();
    expect(tree.nodes.length).toBeGreaterThanOrEqual(1);
    expect(tree.edges.length).toBeGreaterThanOrEqual(1);

    // Finished panel or job node exists
    const jobNode = tree.nodes.find(n => n.type === 'FINISHED_PANEL');
    expect(jobNode).toBeDefined();

    // Component reel nodes exist
    const reelNodes = tree.nodes.filter(n => n.type === 'COMPONENT_REEL');
    expect(reelNodes.length).toBeGreaterThanOrEqual(1);
  });

  // Test 13: Overlapping reflow candidates -> deterministic ambiguity detection
  it('13. detects ambiguity when multiple active reflow profiles overlap checkout without direct FK', async () => {
    const db = getDatabase();

    // Insert a second active reflow profile for the same line and recipe with different board revision
    const now = new Date().toISOString();
    await db.execute(`
      INSERT INTO reflow_profile_runs (
        id, line_id, equipment_id, recipe_id, board_part_number, board_revision,
        file_sha256, specification_id, specification_version, calculation_version,
        overall_pwi, compliance_result, status, metadata_json, imported_by, activated_at
      ) VALUES (
        'run-prf-overlap-test', 'line-smt-01', 'wc-rfl-01', 'PROG-SM-METER-TOP-REV4', 'PRD-SM-4G-V3', 'REV5',
        'sha-overlap-test', 'spec-prog-sm-meter-top-rev4', 1, '1.0.0',
        22.5, 'PASS', 'ACTIVE', '{}', 'OP-TEST', ?
      )
    `, [now]);

    // Insert a legacy panel checkout without direct profile_run_id (profile_run_id = NULL)
    await db.execute(`
      INSERT INTO panel_checkouts (
        id, panel_barcode, work_center_id, batch_id, program_name,
        cycle_time_seconds, block_count, block_skip_count, completed_at, profile_run_id
      ) VALUES (
        'panel-chk-legacy-ambig', 'PNL-LEGACY-AMBIG-01', 'wc-nxt-01', 'job-01', 'PROG-SM-METER-TOP-REV4',
        18.0, 1, 0, ?, NULL
      )
    `, [now]);

    await db.execute(`
      INSERT INTO panel_units (id, panel_barcode, unit_position, unit_serial_number, status)
      VALUES ('pnl-unit-legacy-1', 'PNL-LEGACY-AMBIG-01', 1, 'SN-LEGACY-01', 'PASSED')
    `);

    try {
      const record = await module.getUnitGenealogy('PNL-LEGACY-AMBIG-01', 1);

      expect(record.reflowProfile).toBeDefined();
      expect(record.reflowProfile?.linkage.source).toBe('TEMPORAL_CORRELATION');
      expect(record.reflowProfile?.linkage.confidence).toBe('AMBIGUOUS');
      expect(record.reflowProfile?.linkage.detail).toContain('overlapping');
    } finally {
      // Clean up test fixture
      await db.execute("DELETE FROM reflow_profile_runs WHERE id = 'run-prf-overlap-test'");
      await db.execute("DELETE FROM panel_checkouts WHERE id = 'panel-chk-legacy-ambig'");
      await db.execute("DELETE FROM panel_units WHERE id = 'pnl-unit-legacy-1'");
    }
  });

  // Test 14: Reel splice historical attribution (pre-splice panel vs post-splice panel)
  it('14. verifies reel splice historical attribution: panel before splice resolves to oldReelId, panel after resolves to newReelId', async () => {
    const db = getDatabase();

    const tPre = new Date(Date.now() - 600000).toISOString(); // 10 minutes ago
    const tSplice = new Date(Date.now() - 300000).toISOString(); // 5 minutes ago
    const tPost = new Date().toISOString(); // Now

    // Insert test component reels
    await db.execute(`
      INSERT OR REPLACE INTO component_reels (id, reel_id, part_number, part_name, supplier_name, lot_number, date_code, initial_quantity, current_quantity, status)
      VALUES 
        ('reel-test-old', 'REEL-HIST-OLD-01', 'C0402-100NF-16V', 'Capacitor', 'Murata', 'LOT-OLD-01', '202601', 5000, 500, 'MOUNTED'),
        ('reel-test-new', 'REEL-HIST-NEW-02', 'C0402-100NF-16V', 'Capacitor', 'Murata', 'LOT-NEW-02', '202602', 5000, 5000, 'SPLICED')
    `);

    // Insert initial mount event (REEL_LOADED) 15 minutes ago
    const tLoad = new Date(Date.now() - 900000).toISOString();
    await db.execute(`
      INSERT INTO production_events (
        id, event_id, event_type, event_time, received_time, source_type, source_id,
        site_id, work_center_id, payload_json
      ) VALUES (
        'evt-load-test', 'evt-id-load-01', 'REEL_LOADED', ?, ?, 'MANUAL_UI', 'test-user',
        'site-noida-p4', 'wc-nxt-01', ?
      )
    `, [tLoad, tLoad, JSON.stringify({ moduleNo: 1, slotNo: 1, feederId: 'FID-W08F-01', partNumber: 'C0402-100NF-16V', reelId: 'REEL-HIST-OLD-01' })]);

    // Insert splice event (REEL_SPLICED) at tSplice
    await db.execute(`
      INSERT INTO production_events (
        id, event_id, event_type, event_time, received_time, source_type, source_id,
        site_id, work_center_id, payload_json
      ) VALUES (
        'evt-splice-test', 'evt-id-splice-01', 'REEL_SPLICED', ?, ?, 'MANUAL_UI', 'test-user',
        'site-noida-p4', 'wc-nxt-01', ?
      )
    `, [tSplice, tSplice, JSON.stringify({ moduleNo: 1, slotNo: 1, feederId: 'FID-W08F-01', partNumber: 'C0402-100NF-16V', oldReelId: 'REEL-HIST-OLD-01', newReelId: 'REEL-HIST-NEW-02' })]);

    // Panel A: completed before splice (at tPre)
    await db.execute(`
      INSERT INTO panel_checkouts (id, panel_barcode, work_center_id, batch_id, program_name, cycle_time_seconds, block_count, block_skip_count, completed_at, profile_run_id)
      VALUES ('chk-splice-pre', 'PNL-SPLICE-PRE', 'wc-nxt-01', 'job-01', 'PROG-SM-METER-TOP-REV4', 18.0, 1, 0, ?, 'run-prf-20260908-01')
    `, [tPre]);
    await db.execute(`
      INSERT INTO panel_units (id, panel_barcode, unit_position, unit_serial_number, status)
      VALUES ('unit-splice-pre', 'PNL-SPLICE-PRE', 1, 'SN-SPLICE-PRE-1', 'PASSED')
    `);

    // Panel B: completed after splice (at tPost)
    await db.execute(`
      INSERT INTO panel_checkouts (id, panel_barcode, work_center_id, batch_id, program_name, cycle_time_seconds, block_count, block_skip_count, completed_at, profile_run_id)
      VALUES ('chk-splice-post', 'PNL-SPLICE-POST', 'wc-nxt-01', 'job-01', 'PROG-SM-METER-TOP-REV4', 18.0, 1, 0, ?, 'run-prf-20260908-01')
    `, [tPost]);
    await db.execute(`
      INSERT INTO panel_units (id, panel_barcode, unit_position, unit_serial_number, status)
      VALUES ('unit-splice-post', 'PNL-SPLICE-POST', 1, 'SN-SPLICE-POST-1', 'PASSED')
    `);

    try {
      // Panel A before splice must resolve to REEL-HIST-OLD-01
      const recordPre = await module.getUnitGenealogy('PNL-SPLICE-PRE', 1);
      const c12Pre = recordPre.placementChain.find(p => p.refDes === 'C12');
      expect(c12Pre).toBeDefined();
      expect(c12Pre!.componentReel.reelId).toBe('REEL-HIST-OLD-01');
      expect(c12Pre!.linkage.source).toBe('HISTORICAL_ASSIGNMENT');

      // Panel B after splice must resolve to REEL-HIST-NEW-02
      const recordPost = await module.getUnitGenealogy('PNL-SPLICE-POST', 1);
      const c12Post = recordPost.placementChain.find(p => p.refDes === 'C12');
      expect(c12Post).toBeDefined();
      expect(c12Post!.componentReel.reelId).toBe('REEL-HIST-NEW-02');
      expect(c12Post!.linkage.source).toBe('HISTORICAL_ASSIGNMENT');
    } finally {
      // Clean up test fixtures
      await db.execute("DELETE FROM production_events WHERE id IN ('evt-load-test', 'evt-splice-test')");
      await db.execute("DELETE FROM panel_checkouts WHERE id IN ('chk-splice-pre', 'chk-splice-post')");
      await db.execute("DELETE FROM panel_units WHERE id IN ('unit-splice-pre', 'unit-splice-post')");
      await db.execute("DELETE FROM component_reels WHERE id IN ('reel-test-old', 'reel-test-new')");
    }
  });

  // Test 15: Identifier resolution ambiguity gate
  it('15. halts and flags AMBIGUOUS_IDENTIFIER when query target matches multiple inventory namespaces', async () => {
    const db = getDatabase();

    const sharedId = 'AMBIG-CROSS-NAMESPACE-01';

    // Seed shared ID in both component_reels and solder_paste_jars
    await db.execute(`
      INSERT OR REPLACE INTO component_reels (id, reel_id, part_number, part_name, supplier_name, lot_number, date_code, initial_quantity, current_quantity)
      VALUES ('reel-ambig-id', ?, 'TEST-MPN', 'Capacitor', 'Murata', 'LOT-AMBIG', '202601', 1000, 1000)
    `, [sharedId]);

    await db.execute(`
      INSERT OR REPLACE INTO solder_paste_jars (id, jar_id, part_number, profile_id, alloy_type, lot_number, expiry_date)
      VALUES ('jar-ambig-id', ?, 'TEST-PASTE', 'spp-alpha-om338', 'SAC305', 'LOT-PASTE-AMBIG', datetime('now', '+30 days'))
    `, [sharedId]);

    try {
      const report = await module.recallByIdentifier(sharedId);

      expect(report.queryTarget).toBe(sharedId);
      expect(report.status).toBe('AMBIGUOUS_IDENTIFIER');
      expect(report.containmentRecommendation).toBe('INVESTIGATION_REQUIRED');
      expect(report.ambiguityDetail).toContain('multiple distinct inventory namespaces');
      expect(report.affectedBatches.length).toBe(0);
    } finally {
      await db.execute('DELETE FROM component_reels WHERE id = ?', ['reel-ambig-id']);
      await db.execute('DELETE FROM solder_paste_jars WHERE id = ?', ['jar-ambig-id']);
    }
  });

  // Test 16: HTTP REST Endpoints
  it('16. exposes unit, panel, recall, and serial endpoints over authenticated REST API', async () => {
    const headers = { Authorization: `Bearer ${qaToken}` };

    // 1. GET /api/v1/genealogy/unit/:panelBarcode/:unitPosition
    const unitRes = await fetch(`${baseUrl}/api/v1/genealogy/unit/PNL-260901-0042/3`, { headers });
    expect(unitRes.status).toBe(200);
    const unitData = await unitRes.json();
    expect(unitData.panelBarcode).toBe('PNL-260901-0042');
    expect(unitData.unitPosition).toBe(3);

    // 2. GET /api/v1/genealogy/panel/:panelBarcode
    const panelRes = await fetch(`${baseUrl}/api/v1/genealogy/panel/PNL-260901-0042`, { headers });
    expect(panelRes.status).toBe(200);
    const panelData = await panelRes.json();
    expect(panelData.units.length).toBe(6);

    // 3. GET /api/v1/genealogy/serial/:serialNumber
    const serialRes = await fetch(`${baseUrl}/api/v1/genealogy/serial/SN-MTR-0042-U3`, { headers });
    expect(serialRes.status).toBe(200);
    const serialData = await serialRes.json();
    expect(serialData.unitSerialNumber).toBe('SN-MTR-0042-U3');

    // 4. GET /api/v1/genealogy/recall/:identifier
    const recallRes = await fetch(`${baseUrl}/api/v1/genealogy/recall/REEL-MUR-98124`, { headers });
    expect(recallRes.status).toBe(200);
    const recallData = await recallRes.json();
    expect(recallData.status).toBe('CONTAINED');

    // 5. GET /api/v1/genealogy/summary/batch/:batchNumber
    const batchRes = await fetch(`${baseUrl}/api/v1/genealogy/summary/batch/JOB-SM-260901`, { headers });
    expect(batchRes.status).toBe(200);
    const batchData = await batchRes.json();
    expect(batchData.batch.batchNumber).toBe('JOB-SM-260901');
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
