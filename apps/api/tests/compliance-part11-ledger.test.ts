import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import crypto from 'crypto';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { app } from '../src/server';
import { TokenManager } from '../src/security/jwt';
import { PinPolicy } from '../src/security/pin-policy';
import { ComplianceLedgerService } from '../src/services/compliance-ledger.service';
import { canonicalizeJson } from '../src/security/canonical-json';

describe('21 CFR Part 11 Compliance Ledger & Two-Component E-Signature Suite', () => {
  let server: http.Server;
  let baseUrl: string;
  let operatorToken: string;
  const operatorPin = '0429';

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();

    const db = getDatabase();

    // Configure operator op-smt-01 with a known Argon2id PIN hash
    const hashedPin = await PinPolicy.hashPin(operatorPin);
    await db.execute(
      `UPDATE operators 
       SET pin_hash = ?, pin = ?, role = 'OPERATOR' 
       WHERE id = 'op-smt-01'`,
      [hashedPin, operatorPin]
    );

    operatorToken = TokenManager.generateAccessToken({
      sub: 'op-smt-01',
      code: 'OP-SMT-01',
      name: 'Vikram Singh',
      role: 'OPERATOR',
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

  it('Test 1: rejects signature requests containing client-supplied actorId or timestamps (status 400)', async () => {
    // 1. Attempt to inject client-supplied actorId
    const resActorId = await fetch(`${baseUrl}/api/v1/compliance/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${operatorToken}`
      },
      body: JSON.stringify({
        entityType: 'DHR',
        entityId: 'DHR-JOB-SM-260901',
        entityRevision: 1,
        actionType: 'QUALITY_APPROVAL',
        meaning: 'I verify this lot conforms to IPC-A-610 Class 3 acceptance criteria',
        reason: 'Final QA passed inspection',
        signingPin: operatorPin,
        actorId: 'spoofed-malicious-actor-id'
      })
    });

    expect(resActorId.status).toBe(400);
    const bodyActor = await resActorId.json();
    expect(bodyActor.success).toBe(false);

    // 2. Attempt to inject client-supplied signedAt timestamp
    const resSignedAt = await fetch(`${baseUrl}/api/v1/compliance/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${operatorToken}`
      },
      body: JSON.stringify({
        entityType: 'DHR',
        entityId: 'DHR-JOB-SM-260901',
        entityRevision: 1,
        actionType: 'QUALITY_APPROVAL',
        meaning: 'I verify this lot conforms to IPC-A-610 Class 3 acceptance criteria',
        reason: 'Final QA passed inspection',
        signingPin: operatorPin,
        signedAt: '2020-01-01T00:00:00.000Z'
      })
    });

    expect(resSignedAt.status).toBe(400);

    // 3. Attempt to inject client-supplied timestamp
    const resTimestamp = await fetch(`${baseUrl}/api/v1/compliance/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${operatorToken}`
      },
      body: JSON.stringify({
        entityType: 'DHR',
        entityId: 'DHR-JOB-SM-260901',
        entityRevision: 1,
        actionType: 'QUALITY_APPROVAL',
        meaning: 'I verify this lot conforms to IPC-A-610 Class 3 acceptance criteria',
        reason: 'Final QA passed inspection',
        signingPin: operatorPin,
        timestamp: '2020-01-01T00:00:00.000Z'
      })
    });

    expect(resTimestamp.status).toBe(400);

    // 4. Attempt to inject client-supplied sequenceNumber or previousHash
    const resHash = await fetch(`${baseUrl}/api/v1/compliance/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${operatorToken}`
      },
      body: JSON.stringify({
        entityType: 'DHR',
        entityId: 'DHR-JOB-SM-260901',
        entityRevision: 1,
        actionType: 'QUALITY_APPROVAL',
        meaning: 'I verify this lot conforms to IPC-A-610 Class 3 acceptance criteria',
        reason: 'Final QA passed inspection',
        signingPin: operatorPin,
        previousHash: '0000000000000000000000000000000000000000000000000000000000000000'
      })
    });

    expect(resHash.status).toBe(400);
  });

  it('Test 2: rejects signature with incorrect signingPin (status 401 or 403)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/compliance/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${operatorToken}`
      },
      body: JSON.stringify({
        entityType: 'DHR',
        entityId: 'DHR-JOB-SM-260901',
        entityRevision: 1,
        actionType: 'QUALITY_APPROVAL',
        meaning: 'I verify this lot conforms to IPC-A-610 Class 3 acceptance criteria',
        reason: 'Final QA inspection passed',
        signingPin: '9999' // Invalid PIN
      })
    });

    expect([401, 403]).toContain(res.status);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('INVALID_SIGNING_PIN');
  });

  it('Test 3: successfully signs and chains records with valid token and PIN; re-calculating SHA-256 via RFC 8785 canonicalization matches current_hash exactly', async () => {
    // Block 1 signature
    const res1 = await fetch(`${baseUrl}/api/v1/compliance/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${operatorToken}`
      },
      body: JSON.stringify({
        entityType: 'BATCH',
        entityId: 'JOB-SM-260901',
        entityRevision: 1,
        actionType: 'PROCESS_INTERLOCK_OVERRIDE',
        meaning: 'Authorized thermal profile window adjustment per SOP-SMT-042',
        reason: 'Component supplier change requiring revised reflow peak',
        signingPin: operatorPin,
        metadata: {
          peakTempC: 245.5,
          soakDurationSeconds: 75
        }
      })
    });

    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    expect(body1.success).toBe(true);

    const record1 = body1.data;
    expect(record1.sequenceNumber).toBeGreaterThan(0);
    expect(record1.actorId).toBe('op-smt-01');
    expect(record1.actorRole).toBe('OPERATOR');
    expect(record1.organizationId).toBe('org-dixon');
    expect(record1.siteId).toBe('site-noida-p4');
    expect(record1.signedAt).toBeDefined();

    // Reconstruct canonical SignedEnvelope for record 1 and verify hash
    const envelope1 = {
      sequenceNumber: record1.sequenceNumber,
      previousHash: record1.previousHash,
      actorId: record1.actorId,
      actorRole: record1.actorRole,
      actionType: record1.actionType,
      meaning: record1.meaning,
      reason: record1.reason,
      entityType: record1.entityType,
      entityId: record1.entityId,
      entityRevision: record1.entityRevision,
      organizationId: record1.organizationId,
      siteId: record1.siteId,
      metadata: record1.metadata,
      signedAt: record1.signedAt
    };

    const canonical1 = canonicalizeJson(envelope1);
    const computedHash1 = crypto.createHash('sha256').update(canonical1).digest('hex');
    expect(computedHash1).toBe(record1.currentHash);

    // Block 2 signature (verifying hash chaining)
    const res2 = await fetch(`${baseUrl}/api/v1/compliance/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${operatorToken}`
      },
      body: JSON.stringify({
        entityType: 'DHR',
        entityId: 'DHR-JOB-SM-260901',
        entityRevision: 1,
        actionType: 'QUALITY_APPROVAL',
        meaning: 'I verify this medical PCBA lot conforms to 21 CFR 820.180',
        reason: 'Full functional and 3D AOI test suite passed',
        signingPin: operatorPin,
        metadata: {
          inspectedUnits: 150,
          passedUnits: 150
        }
      })
    });

    expect(res2.status).toBe(201);
    const body2 = await res2.json();
    expect(body2.success).toBe(true);

    const record2 = body2.data;
    expect(record2.sequenceNumber).toBe(record1.sequenceNumber + 1);
    expect(record2.previousHash).toBe(record1.currentHash);

    // Reconstruct canonical SignedEnvelope for record 2 and verify hash
    const envelope2 = {
      sequenceNumber: record2.sequenceNumber,
      previousHash: record2.previousHash,
      actorId: record2.actorId,
      actorRole: record2.actorRole,
      actionType: record2.actionType,
      meaning: record2.meaning,
      reason: record2.reason,
      entityType: record2.entityType,
      entityId: record2.entityId,
      entityRevision: record2.entityRevision,
      organizationId: record2.organizationId,
      siteId: record2.siteId,
      metadata: record2.metadata,
      signedAt: record2.signedAt
    };

    const canonical2 = canonicalizeJson(envelope2);
    const computedHash2 = crypto.createHash('sha256').update(canonical2).digest('hex');
    expect(computedHash2).toBe(record2.currentHash);
  });

  it('Test 4: dynamic chain verification (verifyLedgerIntegrity) returns valid: true', async () => {
    const result = await ComplianceLedgerService.verifyLedgerIntegrity();
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBeGreaterThanOrEqual(2);
    expect(result.message).toContain('Verified all');

    // Also verify via HTTP endpoint
    const httpRes = await fetch(`${baseUrl}/api/v1/compliance/ledger/verify`, {
      headers: { Authorization: `Bearer ${operatorToken}` }
    });
    expect(httpRes.status).toBe(200);
    const httpBody = await httpRes.json();
    expect(httpBody.success).toBe(true);
    expect(httpBody.data.valid).toBe(true);
  });

  it('Test 5: assert that mutating or deleting records from the compliance ledger is prohibited', async () => {
    // 1. Service safeguard: calling prohibitRecordMutation directly throws
    expect(() => ComplianceLedgerService.prohibitRecordMutation('UPDATE')).toThrow(/LEDGER_MUTATION_PROHIBITED/);
    expect(() => ComplianceLedgerService.prohibitRecordMutation('DELETE')).toThrow(/LEDGER_MUTATION_PROHIBITED/);

    // 2. Service safeguard: calling updateRecord or deleteRecord throws
    await expect(ComplianceLedgerService.updateRecord()).rejects.toThrow(/LEDGER_MUTATION_PROHIBITED/);
    await expect(ComplianceLedgerService.deleteRecord()).rejects.toThrow(/LEDGER_MUTATION_PROHIBITED/);

    // 3. HTTP endpoint safeguard: PUT /api/v1/compliance/ledger/:id is rejected (405 or 403)
    const putRes = await fetch(`${baseUrl}/api/v1/compliance/ledger/test-id`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${operatorToken}`
      },
      body: JSON.stringify({ meaning: 'TAMPERED' })
    });
    expect([403, 405]).toContain(putRes.status);
    const putBody = await putRes.json();
    expect(putBody.error).toBe('LEDGER_MUTATION_PROHIBITED');

    // 4. HTTP endpoint safeguard: DELETE /api/v1/compliance/ledger/:id is rejected (405 or 403)
    const deleteRes = await fetch(`${baseUrl}/api/v1/compliance/ledger/test-id`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${operatorToken}`
      }
    });
    expect([403, 405]).toContain(deleteRes.status);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.error).toBe('LEDGER_MUTATION_PROHIBITED');
  });
});
