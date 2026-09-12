// apps/web/src/fixtures/traceability.fixtures.ts

export interface FixtureMeta {
  source: 'OFFLINE_FIXTURE';
  fixtureId: string;
  fixtureVersion: string;
}

export const FIXTURE_VERSION = '1.0.0';

// Canonical Defect / Rework Panel: PNL-260901-0042 (6-up multi-circuit)
// Unit Position 3 has QUALITY_HOLD, SN-MTR-0042-U3, AOI tombstone defect at C12
export const FIXTURE_PANEL_0042: any = {
  source: 'OFFLINE_FIXTURE',
  fixtureId: 'PNL-260901-0042',
  fixtureVersion: FIXTURE_VERSION,
  panelBarcode: 'PNL-260901-0042',
  checkout: {
    workCenterId: 'wc-nxt-01',
    programName: 'PROG-SM-METER-TOP-REV4',
    cycleTimeSeconds: 18.20,
    blockCount: 6,
    blockSkipCount: 0,
    completedAt: '2026-09-08T10:14:10.000Z',
    profileRunId: 'run-prf-20260908-01'
  },
  batch: {
    batchId: 'job-01',
    batchNumber: 'JOB-SM-260901',
    productCode: 'PRD-SM-4G-V2',
    recipeCode: 'PROG-SM-METER-TOP-REV4',
    workOrderNumber: 'WO-2026-APEX-01',
    workCenterId: 'wc-nxt-01',
    operatorId: 'op-smt-01',
    status: 'RUNNING',
    startedAt: '2026-09-01T06:00:00.000Z',
    completedAt: null
  },
  units: [
    createFixtureUnit(1, 'PASSED', false),
    createFixtureUnit(2, 'PASSED', false),
    createFixtureUnit(3, 'QUALITY_HOLD', true), // Canonical Defect Unit
    createFixtureUnit(4, 'PASSED', false),
    createFixtureUnit(5, 'PASSED', false),
    createFixtureUnit(6, 'PASSED', false)
  ]
};

function createFixtureUnit(unitPosition: number, status: 'PASSED' | 'QUALITY_HOLD', hasDefect: boolean): any {
  const serialNumber = `SN-MTR-0042-U${unitPosition}`;
  const xBase = (unitPosition - 1) * 35.0;

  return {
    source: 'OFFLINE_FIXTURE',
    fixtureId: `PNL-260901-0042-U${unitPosition}`,
    fixtureVersion: FIXTURE_VERSION,
    panelBarcode: 'PNL-260901-0042',
    unitPosition,
    unitSerialNumber: serialNumber,
    unitStatus: status,
    batch: {
      batchId: 'job-01',
      batchNumber: 'JOB-SM-260901',
      productCode: 'PRD-SM-4G-V2',
      recipeCode: 'PROG-SM-METER-TOP-REV4',
      workOrderNumber: 'WO-2026-APEX-01',
      workCenterId: 'wc-nxt-01',
      operatorId: 'op-smt-01',
      status: 'RUNNING',
      startedAt: '2026-09-01T06:00:00.000Z',
      completedAt: null
    },
    placementChain: [
      {
        refDes: 'C12',
        partNumber: 'C0402-100NF-16V',
        packageType: '0402',
        cadCoordinates: { xMm: xBase + 12.4, yMm: 45.2, rotationDeg: 90, boardSide: 'TOP' },
        feederSlot: { moduleNo: 1, slotNo: 1, feederId: 'FID-W08F-01', feederType: 'W08f (8mm High Speed)' },
        componentReel: {
          reelId: 'REEL-MUR-98124',
          lotNumber: 'LOT-MUR-2601',
          supplierName: 'Murata Electronics',
          dateCode: '202612',
          mslClass: 'MSL_1',
          mslRemainingMinutes: 999999
        },
        linkage: {
          source: 'HISTORICAL_ASSIGNMENT',
          confidence: 'EXACT',
          detail: 'Matched slot-01 reel during placement window'
        }
      },
      {
        refDes: 'R10',
        partNumber: 'R0402-10K-1%',
        packageType: '0402',
        cadCoordinates: { xMm: xBase + 15.1, yMm: 45.2, rotationDeg: 0, boardSide: 'TOP' },
        feederSlot: { moduleNo: 1, slotNo: 2, feederId: 'FID-W08F-02', feederType: 'W08f (8mm High Speed)' },
        componentReel: {
          reelId: 'REEL-VSH-44120',
          lotNumber: 'LOT-VSH-8812',
          supplierName: 'Vishay Intertechnology',
          dateCode: '202615',
          mslClass: 'MSL_1',
          mslRemainingMinutes: 999999
        },
        linkage: {
          source: 'HISTORICAL_ASSIGNMENT',
          confidence: 'EXACT',
          detail: 'Matched slot-02 reel during placement window'
        }
      },
      {
        refDes: 'U1',
        partNumber: 'IC-STM32F401-LQFP64',
        packageType: 'LQFP64',
        cadCoordinates: { xMm: xBase + 35.0, yMm: 60.0, rotationDeg: 0, boardSide: 'TOP' },
        feederSlot: { moduleNo: 1, slotNo: 3, feederId: 'FID-W12F-03', feederType: 'W12f (12mm IC Feeder)' },
        componentReel: {
          reelId: 'REEL-STM-11029',
          lotNumber: 'LOT-STM-2602',
          supplierName: 'STMicroelectronics',
          dateCode: '202618',
          mslClass: 'MSL_3',
          mslRemainingMinutes: 9600
        },
        linkage: {
          source: 'HISTORICAL_ASSIGNMENT',
          confidence: 'EXACT',
          detail: 'Matched slot-03 reel during placement window'
        }
      },
      {
        refDes: 'MOD1',
        partNumber: 'MOD-QUECTEL-EC200U',
        packageType: 'LCC',
        cadCoordinates: { xMm: xBase + 65.0, yMm: 75.0, rotationDeg: 0, boardSide: 'TOP' },
        feederSlot: { moduleNo: 1, slotNo: 4, feederId: 'FID-W24F-04', feederType: 'W24f (24mm Module Feeder)' },
        componentReel: {
          reelId: 'REEL-QCT-77821',
          lotNumber: 'LOT-QCT-5519',
          supplierName: 'Quectel Wireless',
          dateCode: '202610',
          mslClass: 'MSL_3',
          mslRemainingMinutes: 4320
        },
        linkage: {
          source: 'HISTORICAL_ASSIGNMENT',
          confidence: 'EXACT',
          detail: 'Matched slot-04 reel during placement window'
        }
      },
      {
        refDes: 'U2',
        partNumber: 'IC-TPS62130-QFN16',
        packageType: 'QFN16',
        cadCoordinates: { xMm: xBase + 45.0, yMm: 30.0, rotationDeg: 0, boardSide: 'TOP' },
        feederSlot: { moduleNo: 1, slotNo: 5, feederId: 'FID-W16F-05', feederType: 'W16f (16mm QFN Feeder)' },
        componentReel: {
          reelId: 'REEL-TI-66100',
          lotNumber: 'LOT-TI-9901',
          supplierName: 'Texas Instruments',
          dateCode: '202620',
          mslClass: 'MSL_2',
          mslRemainingMinutes: 520000
        },
        linkage: {
          source: 'HISTORICAL_ASSIGNMENT',
          confidence: 'EXACT',
          detail: 'Matched slot-05 reel during placement window'
        }
      }
    ],
    solderPaste: [
      {
        jarId: 'JAR-ALPHA-2601-C',
        lotNumber: 'LOT-PASTE-2601',
        alloyType: 'SAC305',
        thawVerifiedAt: '2026-09-01T04:00:00.000Z',
        mixedAt: '2026-09-01T05:30:00.000Z',
        temperatureVerifiedC: 23.2,
        linkage: {
          source: 'EVENT_CORRELATION',
          confidence: 'EXACT',
          detail: 'Loaded on stencil session sess-01 for work center wc-spg-01'
        }
      }
    ],
    stencil: {
      stencilId: 'STC-SM-4G-TOP',
      serialNumber: 'STN-2026-0042',
      revision: 'A',
      sessionStartedAt: '2026-09-01T06:00:00.000Z',
      linkage: {
        source: 'EVENT_CORRELATION',
        confidence: 'EXACT',
        detail: 'Active stencil session sess-01'
      }
    },
    spiInspection: {
      inspectionId: 'spi-insp-0042',
      result: 'PASS',
      totalPads: 1420,
      defectivePads: 0,
      meanVolumePct: 104.2,
      sigmaVolumePct: 6.8,
      inspectedAt: '2026-09-08T10:10:00.000Z',
      opticalMachineId: 'KY-SPI-3D-01',
      unitCriticalPads: [
        {
          padId: `pad-u${unitPosition}-c12-1`,
          refDes: 'C12',
          volumeRatioPct: 102.5,
          heightUm: 122.0,
          areaRatioPct: 98.4,
          offsetXUm: 2.1,
          offsetYUm: -1.4
        },
        {
          padId: `pad-u${unitPosition}-u1-1`,
          refDes: 'U1',
          volumeRatioPct: 105.1,
          heightUm: 124.5,
          areaRatioPct: 101.2,
          offsetXUm: 0.8,
          offsetYUm: 0.4
        }
      ]
    },
    reflowProfile: {
      profileRunId: 'run-prf-20260908-01',
      overallPwi: 24.5,
      complianceResult: 'PASS',
      worstCharacteristic: 'Peak Temperature (TC2: 241.5°C)',
      recipeId: 'PROG-SM-METER-TOP-REV4',
      equipmentId: 'wc-rfl-01',
      lineId: 'line-smt-01',
      approvedBy: 'usr-qa-lead-01',
      approvedAt: '2026-09-08T08:30:00.000Z',
      linkage: {
        source: 'DIRECT_FK',
        confidence: 'EXACT',
        detail: 'Linked via panel_checkouts.profile_run_id'
      }
    },
    aoiInspections: [
      {
        inspectionId: 'aoi-insp-demo-01',
        phase: 'POST_REFLOW',
        result: hasDefect ? 'FAIL' : 'PASS',
        totalDefects: hasDefect ? 1 : 0,
        inspectedAt: '2026-09-08T10:15:30.000Z',
        opticalMachineId: 'KY-ZENITH-01',
        unitDefects: hasDefect ? [
          {
            defectId: 'defect-demo-01',
            refDes: 'C12',
            defectCategory: 'SOLDER',
            defectType: 'TOMBSTONE',
            defectSignature: 'PROG-SM-METER-TOP-REV4:wc-aoi-01:KY-ZENITH-01:C12:TOMBSTONE',
            boardSide: 'TOP',
            status: 'OPEN',
            imageRef: 'img/aoi/ky-zenith-01/pnl-0042-u3-c12.png'
          }
        ] : []
      }
    ],
    reworkHistory: hasDefect ? [
      {
        defectId: 'defect-demo-01',
        refDes: 'C12',
        disposition: 'REWORK',
        dispositionReason: 'Resolder and realign tombstoned capacitor C12 using hot air desoldering',
        authorizedBy: 'op-smt-01',
        dispositionAt: '2026-09-08T10:20:00.000Z',
        execution: {
          technicianId: 'tech-cleanroom-04',
          stationId: 'wc-rwk-01',
          oldMpn: 'C0402-100NF-16V',
          oldReelId: 'REEL-MUR-98124',
          replacementMpn: 'C0402-100NF-16V',
          replacementReelId: 'REEL-MUR-98125-SPLICE',
          reworkMethod: 'HOT_AIR_DESOLDER_SOLDERING_IRON',
          reworkCycle: 1,
          reworkedAt: '2026-09-08T10:35:00.000Z'
        },
        postReworkInspection: {
          result: 'PASS',
          inspectorId: 'op-qa-02',
          inspectedAt: '2026-09-08T10:45:00.000Z'
        }
      }
    ] : [],
    dhr: {
      dhrNumber: 'DHR-JOB-SM-260901',
      status: hasDefect ? 'PENDING_QA_REVIEW' : 'RELEASED',
      sha256Checksum: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      qaReviewerId: hasDefect ? null : 'usr-qa-lead-01',
      qaReleasedAt: hasDefect ? null : '2026-09-08T14:22:00.000Z'
    },
    complianceLedger: {
      dhrSignatures: [
        {
          sequenceNumber: 18421,
          currentHash: '3b092f6b8c8d88e0e37766861109a1a457494441544956455345513138343231',
          actorId: 'op-smt-01',
          actorRole: 'SMT_OPERATOR',
          actionType: 'PANEL_CHECKOUT',
          signedAt: '2026-09-08T10:14:10.000Z'
        },
        {
          sequenceNumber: 18425,
          currentHash: '8f7762a44b1c828d092e6651239841a457494441544956455345513138343235',
          actorId: 'ky-aoi-zenith',
          actorRole: 'MACHINE',
          actionType: 'AOI_INSPECTION_RECORDED',
          signedAt: '2026-09-08T10:15:30.000Z'
        }
      ]
    }
  };
}

// Clean Passed Panel Fixture: PNL-SM-00140 (4-up multi-circuit)
export const FIXTURE_PANEL_CLEAN: any = {
  source: 'OFFLINE_FIXTURE',
  fixtureId: 'PNL-SM-00140',
  fixtureVersion: FIXTURE_VERSION,
  panelBarcode: 'PNL-SM-00140',
  checkout: {
    workCenterId: 'wc-nxt-01',
    programName: 'PROG-SM-METER-TOP-REV4',
    cycleTimeSeconds: 18.24,
    blockCount: 4,
    blockSkipCount: 0,
    completedAt: '2026-09-08T10:10:00.000Z',
    profileRunId: 'run-prf-20260908-01'
  },
  batch: FIXTURE_PANEL_0042.batch,
  units: [
    createCleanUnit(1),
    createCleanUnit(2),
    createCleanUnit(3),
    createCleanUnit(4)
  ]
};

function createCleanUnit(unitPosition: number): any {
  const base = createFixtureUnit(unitPosition, 'PASSED', false);
  base.panelBarcode = 'PNL-SM-00140';
  base.unitSerialNumber = `SN-SM-00140-U${unitPosition}`;
  base.fixtureId = `PNL-SM-00140-U${unitPosition}`;
  base.dhr.status = 'RELEASED';
  base.dhr.qaReviewerId = 'usr-qa-lead-01';
  base.dhr.qaReleasedAt = '2026-09-08T14:00:00.000Z';
  return base;
}

// Recall Fixture: REEL-MUR-98124 (Component Reel Containment)
export const FIXTURE_RECALL_REEL: any = {
  source: 'OFFLINE_FIXTURE',
  fixtureId: 'RECALL-REEL-MUR-98124',
  fixtureVersion: FIXTURE_VERSION,
  queryTarget: 'REEL-MUR-98124',
  targetType: 'COMPONENT_REEL',
  status: 'CONTAINED',
  containmentRecommendation: 'QUARANTINE_REQUIRED',
  affectedBatches: [
    {
      batchId: 'job-01',
      batchNumber: 'JOB-SM-260901',
      productCode: 'PRD-SM-4G-V2',
      workOrderNumber: 'WO-2026-APEX-01',
      dhrStatus: 'PENDING_QA_REVIEW'
    }
  ],
  affectedPanels: [
    { panelBarcode: 'PNL-260901-0042', batchNumber: 'JOB-SM-260901', completedAt: '2026-09-08T10:14:10.000Z' },
    { panelBarcode: 'PNL-SM-00140', batchNumber: 'JOB-SM-260901', completedAt: '2026-09-08T10:10:00.000Z' },
    { panelBarcode: 'PNL-SM-00141', batchNumber: 'JOB-SM-260901', completedAt: '2026-09-08T10:11:30.000Z' },
    { panelBarcode: 'PNL-SM-00142', batchNumber: 'JOB-SM-260901', completedAt: '2026-09-08T10:13:00.000Z' }
  ],
  affectedUnits: [
    { panelBarcode: 'PNL-260901-0042', unitPosition: 1, unitSerialNumber: 'SN-MTR-0042-U1', unitStatus: 'PASSED', affectedRefDes: ['C12'], mountedReelId: 'REEL-MUR-98124' },
    { panelBarcode: 'PNL-260901-0042', unitPosition: 2, unitSerialNumber: 'SN-MTR-0042-U2', unitStatus: 'PASSED', affectedRefDes: ['C12'], mountedReelId: 'REEL-MUR-98124' },
    { panelBarcode: 'PNL-260901-0042', unitPosition: 3, unitSerialNumber: 'SN-MTR-0042-U3', unitStatus: 'QUALITY_HOLD', affectedRefDes: ['C12'], mountedReelId: 'REEL-MUR-98124' },
    { panelBarcode: 'PNL-260901-0042', unitPosition: 4, unitSerialNumber: 'SN-MTR-0042-U4', unitStatus: 'PASSED', affectedRefDes: ['C12'], mountedReelId: 'REEL-MUR-98124' },
    { panelBarcode: 'PNL-260901-0042', unitPosition: 5, unitSerialNumber: 'SN-MTR-0042-U5', unitStatus: 'PASSED', affectedRefDes: ['C12'], mountedReelId: 'REEL-MUR-98124' },
    { panelBarcode: 'PNL-260901-0042', unitPosition: 6, unitSerialNumber: 'SN-MTR-0042-U6', unitStatus: 'PASSED', affectedRefDes: ['C12'], mountedReelId: 'REEL-MUR-98124' },
    { panelBarcode: 'PNL-SM-00140', unitPosition: 1, unitSerialNumber: 'SN-SM-00140-U1', unitStatus: 'PASSED', affectedRefDes: ['C12'], mountedReelId: 'REEL-MUR-98124' },
    { panelBarcode: 'PNL-SM-00140', unitPosition: 2, unitSerialNumber: 'SN-SM-00140-U2', unitStatus: 'PASSED', affectedRefDes: ['C12'], mountedReelId: 'REEL-MUR-98124' },
    { panelBarcode: 'PNL-SM-00140', unitPosition: 3, unitSerialNumber: 'SN-SM-00140-U3', unitStatus: 'PASSED', affectedRefDes: ['C12'], mountedReelId: 'REEL-MUR-98124' },
    { panelBarcode: 'PNL-SM-00140', unitPosition: 4, unitSerialNumber: 'SN-SM-00140-U4', unitStatus: 'PASSED', affectedRefDes: ['C12'], mountedReelId: 'REEL-MUR-98124' }
  ],
  summary: {
    totalBatchesAffected: 1,
    totalPanelsAffected: 4,
    totalUnitsAffected: 17,
    quarantineScope: 'Batch JOB-SM-260901 (4 Panels, 17 Units) Mount Window 2026-09-08'
  }
};

// Batch Summary Fixture: JOB-SM-260901
export const FIXTURE_BATCH_SUMMARY: any = {
  source: 'OFFLINE_FIXTURE',
  fixtureId: 'BATCH-JOB-SM-260901',
  fixtureVersion: FIXTURE_VERSION,
  batch: FIXTURE_PANEL_0042.batch,
  dhr: FIXTURE_PANEL_0042.units[0].dhr,
  summary: {
    totalPanels: 4,
    totalUnits: 17,
    passedUnits: 16,
    heldUnits: 1,
    scrappedUnits: 0,
    totalDefects: 1,
    reworkCount: 1
  },
  panels: [
    { panelBarcode: 'PNL-260901-0042', completedAt: '2026-09-08T10:14:10.000Z', unitCount: 6, hasDefects: true },
    { panelBarcode: 'PNL-SM-00140', completedAt: '2026-09-08T10:10:00.000Z', unitCount: 4, hasDefects: false },
    { panelBarcode: 'PNL-SM-00141', completedAt: '2026-09-08T10:11:30.000Z', unitCount: 4, hasDefects: false },
    { panelBarcode: 'PNL-SM-00142', completedAt: '2026-09-08T10:13:00.000Z', unitCount: 3, hasDefects: false }
  ],
  materialsConsumed: [
    { partNumber: 'C0402-100NF-16V', reelId: 'REEL-MUR-98124', lotNumber: 'LOT-MUR-2601', supplierName: 'Murata Electronics', quantityConsumed: 2150 },
    { partNumber: 'R0402-10K-1%', reelId: 'REEL-VSH-44120', lotNumber: 'LOT-VSH-8812', supplierName: 'Vishay Intertechnology', quantityConsumed: 1790 },
    { partNumber: 'IC-STM32F401-LQFP64', reelId: 'REEL-STM-11029', lotNumber: 'LOT-STM-2602', supplierName: 'STMicroelectronics', quantityConsumed: 142 },
    { partNumber: 'MOD-QUECTEL-EC200U', reelId: 'REEL-QCT-77821', lotNumber: 'LOT-QCT-5519', supplierName: 'Quectel Wireless', quantityConsumed: 142 },
    { partNumber: 'IC-TPS62130-QFN16', reelId: 'REEL-TI-66100', lotNumber: 'LOT-TI-9901', supplierName: 'Texas Instruments', quantityConsumed: 284 }
  ]
};
