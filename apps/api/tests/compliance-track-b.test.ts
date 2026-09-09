import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { app } from '../src/server';
import { ComplianceLedgerService } from '../src/services/compliance-ledger.service';
import { EdhrService } from '../src/services/edhr.service';
import { TraceabilityInterrogationService } from '../src/services/traceability-interrogation.service';
import { TokenManager } from '../src/security/jwt';

describe('Track B: Compliance & Industrial Audit Readiness Suite (21 CFR Part 11 / FDA 820.180 / ISO 13485)', () => {
  let server: http.Server;
  let baseUrl: string;
  let qaToken: string;

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();

    qaToken = TokenManager.generateAccessToken({
      sub: 'qa-smt-01',
      code: 'QA-SMT-01',
      name: 'Meera Rao',
      role: 'QUALITY_INSPECTOR',
      org: 'org-dixon',
      site: 'site-noida-p4',
      authzVersion: 1
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('maintains a cryptographically unbroken SHA-256 hash-chained compliance audit ledger', async () => {
    const entry1 = await ComplianceLedgerService.recordSignature({
      actorId: 'usr-eng-01',
      actorRole: 'SMT_PROCESS_ENGINEER',
      actionType: 'QUALITY_GATE_OVERRIDE',
      meaning: 'Approved temporary thermal tolerance window of +1.5C during paste reflow test',
      entityType: 'BATCH',
      entityId: 'BATCH-2026-001',
      metadata: { temperatureC: 25.5, maxAllowedC: 25.0 }
    });

    const entry2 = await ComplianceLedgerService.recordSignature({
      actorId: 'usr-qa-02',
      actorRole: 'QA_INSPECTOR',
      actionType: 'MSL_BAKE_VERIFICATION',
      meaning: 'Verified 48-hour desiccation bake cycle completed per JEDEC J-STD-033D Table 4-1',
      entityType: 'REEL',
      entityId: 'REEL-C0402-001',
      metadata: { bakeDurationMinutes: 2880, ovenTempC: 125 }
    });

    expect(entry1.sequenceNumber).toBeGreaterThan(0);
    expect(entry2.sequenceNumber).toBe(entry1.sequenceNumber + 1);
    expect(entry2.previousHash).toBe(entry1.currentHash);

    // Verify ledger integrity
    const verification = await ComplianceLedgerService.verifyIntegrity();
    expect(verification.valid).toBe(true);
    expect(verification.totalEntries).toBeGreaterThanOrEqual(2);
  });

  it('detects forensic data tampering or record alteration in the ledger', async () => {
    const db = getDatabase();

    // Append a legitimate block
    const legitimate = await ComplianceLedgerService.recordSignature({
      actorId: 'usr-op-03',
      actorRole: 'LINE_OPERATOR',
      actionType: 'STENCIL_WIPE_CONFIRMED',
      meaning: 'Completed cleanroom ultrasonic stencil cleaning cycle',
      entityType: 'STENCIL',
      entityId: 'STENCIL-NXT-001'
    });

    // Simulate malicious in-place record alteration (tampering with 'meaning')
    await db.execute(
      `UPDATE compliance_audit_ledger SET meaning = 'TAMPERED_MEANING_ATTEMPT' WHERE id = ?`,
      [legitimate.id]
    );

    // Run verification - must fail with checksum mismatch!
    const tamperedCheck = await ComplianceLedgerService.verifyIntegrity();
    expect(tamperedCheck.valid).toBe(false);
    expect(tamperedCheck.brokenSequence).toBe(legitimate.sequenceNumber);
    expect(tamperedCheck.message).toContain('Data tampering detected');

    // Restore legitimate meaning to leave the DB valid
    await db.execute(
      `UPDATE compliance_audit_ledger SET meaning = ? WHERE id = ?`,
      [legitimate.meaning, legitimate.id]
    );

    const restoredCheck = await ComplianceLedgerService.verifyIntegrity();
    expect(restoredCheck.valid).toBe(true);
  });

  it('generates an FDA 21 CFR 820.180 compliant eDHR with complete as-built genealogy', async () => {
    // Generate eDHR for seeded batch JOB-SM-260901
    const dhr = await EdhrService.generateDhr('JOB-SM-260901', 'usr-sys-auto', 'SYSTEM_AUDITOR');

    expect(dhr.dhrNumber).toBe('DHR-JOB-SM-260901');
    expect(dhr.status).toBe('DRAFT');
    expect(dhr.manufacturedQuantity).toBeGreaterThanOrEqual(0);
    expect(dhr.sha256Checksum).toBeDefined();
    expect(dhr.sha256Checksum.length).toBe(64);

    // Inspect structured payload contents
    const payload = dhr.dhrPayload;
    expect(payload.batchNumber).toBe('JOB-SM-260901');
    expect(payload.regulatoryMetadata.standardCompliance).toContain('FDA 21 CFR 820.180 (Device History Record)');
    expect(payload.regulatoryMetadata.standardCompliance).toContain('ISO 13485:2016 Clause 7.5.3 (Identification and Traceability)');
    expect(payload.regulatoryMetadata.standardCompliance).toContain('21 CFR Part 11 (Electronic Records & Signatures)');

    // Verify acceptance, inspection counts, and materials
    expect(payload.acceptanceAndInspections).toBeDefined();
    expect(payload.billOfMaterialsAsBuilt).toBeDefined();
    expect(Array.isArray(payload.billOfMaterialsAsBuilt)).toBe(true);
    expect(payload.billOfMaterialsAsBuilt.length).toBeGreaterThanOrEqual(1);

    // Verify stored integrity
    const fetched = await EdhrService.getDhr(dhr.dhrNumber);
    expect(fetched.integrityVerified).toBe(true);
  });

  it('formally executes QA release with 21 CFR Part 11 digital signature', async () => {
    const dhrNumber = 'DHR-JOB-SM-260901';
    const qaSignerId = 'usr-qa-director-99';
    const qaMeaning = 'I verify this medical PCBA lot conforms to IPC-A-610 Class 3 acceptance criteria per 21 CFR 820.180';

    const released = await EdhrService.releaseDhr(dhrNumber, qaSignerId, qaMeaning, 142);

    expect(released.status).toBe('RELEASED');
    expect(released.releasedQuantity).toBe(142);
    expect(released.qaReviewerId).toBe(qaSignerId);
    expect(released.qaReleasedAt).toBeDefined();

    // Verify ledger entry was created for the release
    const entries = await ComplianceLedgerService.getEntriesForEntity('DHR', dhrNumber);
    // Use reverse() to get the most recent DHR_QA_RELEASE — a prior test (track-f) may have
    // already released this DHR, creating an earlier ledger entry with a different actorId.
    const releaseEntry = [...entries].reverse().find(e => e.actionType === 'DHR_QA_RELEASE');
    expect(releaseEntry).toBeDefined();
    expect(releaseEntry?.actorId).toBe(qaSignerId);
    expect(releaseEntry?.actorRole).toBe('QA_DIRECTOR');

    // Verify overall ledger integrity remains unbroken
    const check = await ComplianceLedgerService.verifyIntegrity();
    expect(check.valid).toBe(true);
  });

  it('performs ISO 13485 Clause 7.5.3 backward recall containment interrogation', async () => {
    // Interrogate component reel
    const recallResult = await TraceabilityInterrogationService.backwardRecall('REEL-MUR-98124');

    expect(recallResult.queryTarget).toBe('REEL-MUR-98124');
    expect(recallResult.containmentMetrics).toBeDefined();
    expect(Array.isArray(recallResult.impactedBatches)).toBe(true);
    expect(recallResult.impactedBatches.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(recallResult.impactedPanels)).toBe(true);

    // Test with raw part number
    const partRecall = await TraceabilityInterrogationService.backwardRecall('C0402-100NF-16V');
    expect(partRecall.impactedBatches.length).toBeGreaterThanOrEqual(1);
    expect(partRecall.containmentMetrics.quarantineRecommended).toBe(true);
  });

  it('performs ISO 13485 Clause 7.5.3 forward as-built genealogy interrogation', async () => {
    const lineage = await TraceabilityInterrogationService.forwardLineage('JOB-SM-260901');

    expect(lineage.batch.batchNumber).toBe('JOB-SM-260901');
    expect(lineage.batch.workCenterId).toBe('wc-nxt-01');
    expect(lineage.dhrInfo).toBeDefined();
    expect(lineage.dhrInfo?.status).toBe('RELEASED');
    expect(lineage.asBuiltMaterials.length).toBeGreaterThanOrEqual(1);

    // Also test forward lineage via panel barcode
    const panelLineage = await TraceabilityInterrogationService.forwardLineage('PNL-SM-00140');
    expect(panelLineage.targetType).toBe('PANEL_BARCODE');
    expect(panelLineage.batch.batchNumber).toBe('JOB-SM-260901');
  });

  it('exposes compliance endpoints over HTTP REST API', async () => {
    const authHeaders = { Authorization: `Bearer ${qaToken}` };

    // 1. GET /api/v1/compliance/ledger/verify
    const verifyRes = await fetch(`${baseUrl}/api/v1/compliance/ledger/verify`, { headers: authHeaders });
    expect(verifyRes.status).toBe(200);
    const verifyData = await verifyRes.json();
    expect(verifyData.success).toBe(true);
    expect(verifyData.data.valid).toBe(true);

    // 2. GET /api/v1/compliance/dhr/:dhrNumber
    const dhrRes = await fetch(`${baseUrl}/api/v1/compliance/dhr/DHR-JOB-SM-260901`, { headers: authHeaders });
    expect(dhrRes.status).toBe(200);
    const dhrData = await dhrRes.json();
    expect(dhrData.success).toBe(true);
    expect(dhrData.data.status).toBe('RELEASED');
    expect(dhrData.data.integrityVerified).toBe(true);

    // 3. GET /api/v1/compliance/traceability/backward/:identifier
    const recallRes = await fetch(`${baseUrl}/api/v1/compliance/traceability/backward/C0402-100NF-16V`, { headers: authHeaders });
    expect(recallRes.status).toBe(200);
    const recallData = await recallRes.json();
    expect(recallData.success).toBe(true);
    expect(recallData.data.containmentMetrics.totalBatchesAffected).toBeGreaterThanOrEqual(1);

    // 4. GET /api/v1/compliance/traceability/forward/:identifier
    const fwdRes = await fetch(`${baseUrl}/api/v1/compliance/traceability/forward/JOB-SM-260901`, { headers: authHeaders });
    expect(fwdRes.status).toBe(200);
    const fwdData = await fwdRes.json();
    expect(fwdData.success).toBe(true);
    expect(fwdData.data.batch.batchNumber).toBe('JOB-SM-260901');
  });
});
