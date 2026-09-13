// apps/api/tests/licensing-drift.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  LicensingService,
  HardwareComponents,
  MesLicensePayload,
  MesLicense,
  LicensePatch
} from '../src/services/licensing.service';
import { initDatabase } from '../src/db/database';

describe('Asymmetric Ed25519 Node-Locked Licensing & Drift Suite (Stage 6 / C-01 / Gate G-12)', () => {
  let vendorKeyPair: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };
  let vendorPublicKeyPem: string;
  let vendorPrivateKeyPem: string;

  const baselineHardware: HardwareComponents = {
    cpuId: 'Intel_Xeon_E-2388G_8CORE',
    mbUuid: 'MB-SUPERMICRO-X12STH-SYS-7789',
    primaryMac: '00:25:90:e4:11:22'
  };

  beforeEach(async () => {
    await initDatabase();

    // Generate fresh Ed25519 keypair for test assertions
    vendorKeyPair = crypto.generateKeyPairSync('ed25519');
    vendorPublicKeyPem = vendorKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    vendorPrivateKeyPem = vendorKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  });

  function createSignedLicense(
    hw: HardwareComponents,
    options?: { expiresAt?: string; privateKeyPem?: string }
  ): MesLicense {
    const key = options?.privateKeyPem || vendorPrivateKeyPem;
    const payload: MesLicensePayload = {
      licenseId: 'LIC-APEX-ENTERPRISE-001',
      customer: 'Apex Electronics Ltd',
      siteId: 'SITE-NOIDA-P4',
      issuedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
      expiresAt: options?.expiresAt || new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      tier: 'COMMERCIAL_ENTERPRISE',
      maxLines: 4,
      hardware: {
        ...hw,
        fingerprint: LicensingService.canonicalFingerprint(hw)
      }
    };

    const signature = LicensingService.signPayloadEd25519(payload, key);
    return { payload, signature };
  }

  it('1. Canonical Fingerprint matches SHA-256(cpu: + CPU + |mb: + MB + |mac: + MAC)', () => {
    const fp = LicensingService.canonicalFingerprint(baselineHardware);
    const expectedRaw = `cpu:${baselineHardware.cpuId}|mb:${baselineHardware.mbUuid}|mac:${baselineHardware.primaryMac}`;
    const expectedSha = crypto.createHash('sha256').update(expectedRaw).digest('hex');

    expect(fp).toBe(expectedSha);
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });

  it('2. Additive Drift Scoring Model correctly scores components', () => {
    // Exact match
    expect(LicensingService.calculateDrift(baselineHardware, { ...baselineHardware }).score).toBe(0);

    // Single component: CPU swapped (+35)
    const cpuSwap: HardwareComponents = { ...baselineHardware, cpuId: 'Intel_Core_i9_13900K' };
    const cpuDrift = LicensingService.calculateDrift(baselineHardware, cpuSwap);
    expect(cpuDrift.score).toBe(35);
    expect(cpuDrift.driftedComponents).toEqual(['CPU']);

    // Single component: Motherboard swapped (+35)
    const mbSwap: HardwareComponents = { ...baselineHardware, mbUuid: 'MB-ASUS-PRO-WS-9900' };
    const mbDrift = LicensingService.calculateDrift(baselineHardware, mbSwap);
    expect(mbDrift.score).toBe(35);
    expect(mbDrift.driftedComponents).toEqual(['MOTHERBOARD']);

    // Single component: NIC / MAC swapped (+30)
    const macSwap: HardwareComponents = { ...baselineHardware, primaryMac: '00:11:22:33:44:55' };
    const macDrift = LicensingService.calculateDrift(baselineHardware, macSwap);
    expect(macDrift.score).toBe(30);
    expect(macDrift.driftedComponents).toEqual(['PRIMARY_MAC']);

    // Multi-component: CPU + MAC swapped (35 + 30 = 65)
    const dualSwap: HardwareComponents = {
      ...baselineHardware,
      cpuId: 'AMD_EPYC_7443P',
      primaryMac: 'a0:36:9f:12:34:56'
    };
    const dualDrift = LicensingService.calculateDrift(baselineHardware, dualSwap);
    expect(dualDrift.score).toBe(65);
    expect(dualDrift.driftedComponents).toEqual(['CPU', 'PRIMARY_MAC']);

    // Full machine swap: all 3 components (35 + 35 + 30 = 100)
    const fullSwap: HardwareComponents = {
      cpuId: 'AMD_EPYC_9654',
      mbUuid: 'MB-SUPERMICRO-H13SSL',
      primaryMac: '0c:c4:7a:88:99:aa'
    };
    const fullDrift = LicensingService.calculateDrift(baselineHardware, fullSwap);
    expect(fullDrift.score).toBe(100);
    expect(fullDrift.driftedComponents).toEqual(['CPU', 'MOTHERBOARD', 'PRIMARY_MAC']);
  });

  it('3. Matching hardware verifies license as VALID with 0 drift', async () => {
    const license = createSignedLicense(baselineHardware);
    const result = await LicensingService.verifyLicense({
      license,
      currentHardware: baselineHardware,
      vendorPublicKey: vendorPublicKeyPem
    });

    expect(result.status).toBe('VALID');
    expect(result.driftScore).toBe(0);
    expect(result.driftedComponents).toHaveLength(0);
    expect(result.readOnlyEnforced).toBe(false);
  });

  it('4. Single-component drift (<= 35 pts) enters 14-day grace period without halting production', async () => {
    const license = createSignedLicense(baselineHardware);
    const driftedHw: HardwareComponents = {
      ...baselineHardware,
      primaryMac: '00:50:56:c0:00:08' // MAC swap (+30)
    };

    const result = await LicensingService.verifyLicense({
      license,
      currentHardware: driftedHw,
      vendorPublicKey: vendorPublicKeyPem
    });

    expect(result.status).toBe('GRACE_PERIOD');
    expect(result.driftScore).toBe(30);
    expect(result.driftedComponents).toEqual(['PRIMARY_MAC']);
    expect(result.readOnlyEnforced).toBe(false); // Production allowed to continue!
    expect(result.gracePeriodDaysRemaining).toBeGreaterThanOrEqual(13);
  });

  it('5. Full machine swap (> 50 pts) enters grace period with critical swap warning', async () => {
    const license = createSignedLicense(baselineHardware);
    const fullSwap: HardwareComponents = {
      cpuId: 'ARM_Neoverse_N2',
      mbUuid: 'MB-AMPERE-ALTRA-001',
      primaryMac: 'b8:ce:f6:11:22:33'
    };

    const result = await LicensingService.verifyLicense({
      license,
      currentHardware: fullSwap,
      vendorPublicKey: vendorPublicKeyPem
    });

    expect(result.status).toBe('GRACE_PERIOD');
    expect(result.driftScore).toBe(100);
    expect(result.message).toContain('Full machine swap detected');
    expect(result.readOnlyEnforced).toBe(false);
  });

  it('6. Expired grace period (> 14 days without patch) enforces read-only production halt', async () => {
    const license = createSignedLicense(baselineHardware);
    const driftedHw: HardwareComponents = { ...baselineHardware, cpuId: 'NEW_CPU_UPGRADED' };

    // Set first drift detected to 15 days ago
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 3600 * 1000);
    const result = await LicensingService.verifyLicense({
      license,
      currentHardware: driftedHw,
      vendorPublicKey: vendorPublicKeyPem,
      asOfDate: new Date() // Evaluated today, 15 days after first drift
    });

    // In a real run, if first drift was 15 days ago:
    const expiredEvaluation = await LicensingService.verifyLicense({
      license,
      currentHardware: driftedHw,
      vendorPublicKey: vendorPublicKeyPem,
      asOfDate: new Date(Date.now() + 15 * 24 * 3600 * 1000) // Simulated 15 days in the future
    });

    expect(expiredEvaluation.status).toBe('EXPIRED');
    expect(expiredEvaluation.readOnlyEnforced).toBe(true);
    expect(expiredEvaluation.message).toContain('expired');
  });

  it('7. Offline drift challenge generation and signed vendor patch restores VALID status', async () => {
    const license = createSignedLicense(baselineHardware);
    await LicensingService.saveActiveLicense(license);

    // Simulate motherboard replacement (+35 pts)
    const upgradedHw: HardwareComponents = {
      ...baselineHardware,
      mbUuid: 'MB-SUPERMICRO-X12STH-REPLACED-8899'
    };
    process.env.MES_HARDWARE_MB_UUID = upgradedHw.mbUuid;
    process.env.MES_HARDWARE_CPU_ID = upgradedHw.cpuId;
    process.env.MES_HARDWARE_MAC = upgradedHw.primaryMac;

    // Verify system initially enters grace period
    const graceCheck = await LicensingService.verifyLicense({
      vendorPublicKey: vendorPublicKeyPem
    });
    expect(graceCheck.status).toBe('GRACE_PERIOD');
    expect(graceCheck.driftScore).toBe(35);

    // 1. Generate challenge on edge appliance
    const challenge = await LicensingService.generateDriftChallenge();
    expect(challenge.driftScore).toBe(35);
    expect(challenge.licenseId).toBe(license.payload.licenseId);

    // 2. Vendor issues and signs patch
    const patchPayload = {
      patchId: `PATCH-${Date.now()}`,
      licenseId: challenge.licenseId,
      issuedAt: new Date().toISOString(),
      newHardware: challenge.currentHardware,
      newFingerprint: challenge.currentFingerprint
    };
    const patchSignature = LicensingService.signPayloadEd25519(patchPayload, vendorPrivateKeyPem);
    const patch: LicensePatch = {
      payload: patchPayload,
      signature: patchSignature
    };

    // 3. Edge appliance applies signed patch
    const patchedResult = await LicensingService.applyPatch(patch, vendorPublicKeyPem);
    expect(patchedResult.status).toBe('VALID');
    expect(patchedResult.driftScore).toBe(0);
    expect(patchedResult.readOnlyEnforced).toBe(false);

    // Clean up env overrides
    delete process.env.MES_HARDWARE_MB_UUID;
    delete process.env.MES_HARDWARE_CPU_ID;
    delete process.env.MES_HARDWARE_MAC;
  });

  it('8. Tampered or forged signatures are strictly rejected', async () => {
    const license = createSignedLicense(baselineHardware);

    // 1. Corrupt signature
    const tamperedLicense: MesLicense = {
      payload: license.payload,
      signature: Buffer.from('FORGED_SIGNATURE_BYTES_12345678901234567890').toString('base64')
    };

    const forgedCheck = await LicensingService.verifyLicense({
      license: tamperedLicense,
      currentHardware: baselineHardware,
      vendorPublicKey: vendorPublicKeyPem
    });
    expect(forgedCheck.status).toBe('INVALID');
    expect(forgedCheck.readOnlyEnforced).toBe(true);
    expect(forgedCheck.message).toContain('invalid or tampered');

    // 2. Corrupted patch signature
    const invalidPatch: LicensePatch = {
      payload: {
        patchId: 'PATCH-MALICIOUS',
        licenseId: license.payload.licenseId,
        issuedAt: new Date().toISOString(),
        newHardware: baselineHardware,
        newFingerprint: 'bogus_fingerprint'
      },
      signature: Buffer.from('BOGUS_SIGNATURE').toString('base64')
    };

    await expect(
      LicensingService.applyPatch(invalidPatch, vendorPublicKeyPem)
    ).rejects.toThrow(/invalid or tampered/i);
  });
});
