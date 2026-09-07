import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase } from '../../src/db/database';
import { seedDatabase } from '../../src/db/seed';
import {
  DefectLifecycleModule,
  IDefectLifecycleModule
} from '../../src/modules/defect-lifecycle';
import { MachineControlModule, InMemoryEquipmentAdapter } from '../../src/modules/machine-control';
import { CanonicalAoiInspectionResult } from '@mes/shared';

describe('DefectLifecycleModule: Quality Engine & Rework Seam Suite', () => {
  let module: IDefectLifecycleModule;
  let mockPlacementAdapter: InMemoryEquipmentAdapter;

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();
  });

  beforeEach(async () => {
    await seedDatabase();
    MachineControlModule.resetInstance();
    DefectLifecycleModule.resetInstance();

    mockPlacementAdapter = new InMemoryEquipmentAdapter({
      id: 'mock-nxt-01',
      workCenterId: 'wc-nxt-01',
      capabilities: ['HOLD']
    });
    MachineControlModule.getInstance().registerAdapter(mockPlacementAdapter);

    module = DefectLifecycleModule.getInstance();
  });

  it('ingests canonical AOI inspection, applies quality hold, and evaluates repeat defects', async () => {
    const inspection: CanonicalAoiInspectionResult = {
      sourceSystem: 'KohYoung-Zenith-3D',
      sourceInspectionId: `KY-TEST-${Date.now()}`,
      sourceFileHash: `hash-${Date.now()}`,
      panelBarcode: 'PNL-TEST-DL-001',
      batchId: 'BATCH-SM-2026-001',
      workCenterId: 'wc-nxt-01',
      opticalMachineId: 'KY-ZENITH-01',
      inspectionPhase: 'POST_REFLOW',
      result: 'FAIL',
      totalDefects: 1,
      durationSeconds: 12.4,
      defects: [
        {
          defectId: uuidv4(),
          panelBarcode: 'PNL-TEST-DL-001',
          unitPosition: 1,
          refDes: 'C12',
          defectCategory: 'SOLDER',
          defectType: 'INSUFFICIENT',
          defectSignature: 'C12:INSUFFICIENT',
          boardSide: 'TOP'
        }
      ],
      timestamp: new Date().toISOString()
    };

    const result = await module.ingestInspection(inspection);

    expect(result.idempotentDuplicate).toBe(false);
    expect(result.result).toBe('FAIL');
    expect(result.totalDefects).toBe(1);
    expect(result.qualityHoldApplied).toBe(true);

    // Idempotency check on re-ingestion
    const duplicateResult = await module.ingestInspection(inspection);
    expect(duplicateResult.idempotentDuplicate).toBe(true);
  });

  it('records formal engineering disposition for rework', async () => {
    const defectId = uuidv4();
    const disposition = await module.recordDisposition({
      defectId,
      panelBarcode: 'PNL-260901-0042',
      unitPosition: 3,
      disposition: 'REWORK',
      reason: 'Solder touch-up required for insufficient joint',
      authorizedBy: 'QA-LEAD-01'
    });

    expect(disposition.success).toBe(true);
    expect(disposition.status).toBe('REWORK_PENDING');
  });

  it('CRITICAL INVARIANT: strictly blocks component replacement when JEDEC MSL is expired', async () => {
    // REEL-EXPIRED-TEST-01 is an authentic seeded reel with MSL 3 and BAKE_REQUIRED / 0 mins remaining
    const verification = await module.verifyReplacement(
      'PNL-260901-0042',
      3,
      'C12',
      'REEL-EXPIRED-TEST-01'
    );

    expect(verification.valid).toBe(false);
    expect(
      verification.errors.some(e => e.includes('JEDEC MSL Violation') || e.includes('EXPIRED_MSL'))
    ).toBe(true);

    // Attempting to execute replacement with expired reel must throw
    await expect(
      module.executeReplacement({
        defectId: 'defect-demo-01',
        panelBarcode: 'PNL-260901-0042',
        unitPosition: 3,
        refDes: 'C12',
        technicianId: 'TECH-BOB-01',
        replacementReelId: 'REEL-EXPIRED-TEST-01'
      })
    ).rejects.toThrow(/JEDEC MSL Violation/);
  });

  it('executes component replacement with valid reel and releases post-rework inspection', async () => {
    // REEL-MUR-98125-SPLICE is an authentic seeded sealed MSL 1 reel for C12 (C0402-100NF-16V)
    const verification = await module.verifyReplacement(
      'PNL-260901-0042',
      3,
      'C12',
      'REEL-MUR-98125-SPLICE'
    );

    expect(verification.valid).toBe(true);
    expect(verification.errors.length).toBe(0);

    // Execute replacement
    const replacementResult = await module.executeReplacement({
      defectId: 'defect-demo-01',
      panelBarcode: 'PNL-260901-0042',
      unitPosition: 3,
      refDes: 'C12',
      technicianId: 'TECH-BOB-01',
      replacementReelId: 'REEL-MUR-98125-SPLICE'
    });

    expect(replacementResult.success).toBe(true);

    // Verify post-rework inspection passing
    const postReworkResult = await module.verifyPostRework({
      panelBarcode: 'PNL-260901-0042',
      unitPosition: 3,
      defectId: 'defect-demo-01',
      result: 'PASS',
      inspectorId: 'QA-INSPECTOR-02'
    });

    expect(postReworkResult.success).toBe(true);
    expect(postReworkResult.panelStatus).toBe('RELEASED');
  });

  it('correlates defect RefDes back to CAD coordinates, feeder slot, and component reel', async () => {
    const report = await module.correlate('PNL-260901-0042', 3, 'C12');

    expect(report.refDes).toBe('C12');
    expect(report.partNumber).toBe('C0402-100NF-16V');
    expect(report.feederSlot).toBeDefined();
    expect(report.feederSlot?.slotNo).toBe(1);
    expect(report.componentReel).toBeDefined();
    expect(report.rootCauseHypothesis).toBeDefined();
  });
});
