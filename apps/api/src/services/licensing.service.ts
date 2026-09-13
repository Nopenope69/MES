// apps/api/src/services/licensing.service.ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { getDatabase } from '../db/database';

export interface HardwareComponents {
  cpuId: string;
  mbUuid: string;
  primaryMac: string;
}

export interface MesLicensePayload {
  licenseId: string;
  customer: string;
  siteId: string;
  issuedAt: string;
  expiresAt: string;
  tier: 'COMMERCIAL_ENTERPRISE' | 'PILOT';
  maxLines: number;
  hardware: HardwareComponents & {
    fingerprint: string;
  };
}

export interface MesLicense {
  payload: MesLicensePayload;
  signature: string; // Ed25519 Base64 signature
}

export interface DriftChallenge {
  challengeId: string;
  licenseId: string;
  timestamp: string;
  currentHardware: HardwareComponents;
  currentFingerprint: string;
  driftScore: number;
  driftedComponents: string[];
}

export interface LicensePatchPayload {
  patchId: string;
  licenseId: string;
  issuedAt: string;
  newHardware: HardwareComponents;
  newFingerprint: string;
  extendedUntil?: string;
}

export interface LicensePatch {
  payload: LicensePatchPayload;
  signature: string; // Ed25519 Base64 signature of JSON(payload)
}

export interface LicenseVerificationResult {
  status: 'VALID' | 'GRACE_PERIOD' | 'EXPIRED' | 'INVALID';
  driftScore: number;
  driftedComponents: string[];
  gracePeriodDaysRemaining: number;
  message: string;
  readOnlyEnforced: boolean;
  license: MesLicensePayload | null;
}

// Default Embedded Vendor Ed25519 Public Key (Production Root of Trust)
export const DEFAULT_VENDOR_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA25k/ruX6GBkT9mduYWHCnFdtRZiBPDyiAp+2Sjmkeq8=
-----END PUBLIC KEY-----`;

export class LicensingService {
  private static cachedLicense: MesLicense | null = null;
  public static readonly GRACE_PERIOD_SECONDS = 14 * 24 * 60 * 60; // 14 days in seconds

  /**
   * Computes the canonical hardware fingerprint:
   * SHA256("cpu:" + CPU_ID + "|mb:" + MB_UUID + "|mac:" + PRIMARY_MAC)
   */
  public static canonicalFingerprint(hw: HardwareComponents): string {
    const raw = `cpu:${hw.cpuId.trim()}|mb:${hw.mbUuid.trim()}|mac:${hw.primaryMac.trim().toLowerCase()}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Detects local hardware components. Allows explicit environment overrides for testing
   * and isolated edge appliances.
   */
  public static detectHardwareComponents(): HardwareComponents {
    // 1. Check environment variable overrides (highest precedence for testing & container appliances)
    const envCpu = process.env.MES_HARDWARE_CPU_ID;
    const envMb = process.env.MES_HARDWARE_MB_UUID;
    const envMac = process.env.MES_HARDWARE_MAC;

    if (envCpu && envMb && envMac) {
      return {
        cpuId: envCpu,
        mbUuid: envMb,
        primaryMac: envMac
      };
    }

    // 2. Real local platform detection
    let detectedMac = '00:00:00:00:00:00';
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const ifaceList = interfaces[name];
      if (ifaceList) {
        for (const iface of ifaceList) {
          if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
            detectedMac = iface.mac;
            break;
          }
        }
      }
      if (detectedMac !== '00:00:00:00:00:00') break;
    }

    const cpus = os.cpus();
    const detectedCpu = cpus.length > 0
      ? `${cpus[0].model.replace(/\s+/g, '_')}_${cpus.length}CORE`
      : 'GENERIC_x86_64_CPU';

    const detectedMb = `${os.hostname()}_HOST_MB_UUID`;

    return {
      cpuId: envCpu || detectedCpu,
      mbUuid: envMb || detectedMb,
      primaryMac: envMac || detectedMac
    };
  }

  /**
   * Additive Drift Scoring Model:
   * - CPU change: +35 points
   * - Motherboard UUID change: +35 points
   * - Primary MAC change: +30 points
   */
  public static calculateDrift(
    licensed: HardwareComponents,
    current: HardwareComponents
  ): { score: number; driftedComponents: string[] } {
    let score = 0;
    const driftedComponents: string[] = [];

    if (licensed.cpuId.trim() !== current.cpuId.trim()) {
      score += 35;
      driftedComponents.push('CPU');
    }
    if (licensed.mbUuid.trim() !== current.mbUuid.trim()) {
      score += 35;
      driftedComponents.push('MOTHERBOARD');
    }
    if (licensed.primaryMac.trim().toLowerCase() !== current.primaryMac.trim().toLowerCase()) {
      score += 30;
      driftedComponents.push('PRIMARY_MAC');
    }

    return { score, driftedComponents };
  }

  /**
   * Verifies an Ed25519 digital signature of an arbitrary object using canonical JSON serialization.
   */
  public static verifyEd25519Signature(
    data: object,
    signatureBase64: string,
    publicKeyPem = DEFAULT_VENDOR_PUBLIC_KEY
  ): boolean {
    try {
      const canonicalData = Buffer.from(JSON.stringify(data, Object.keys(data).sort()));
      const signatureBuffer = Buffer.from(signatureBase64, 'base64');
      const publicKey = crypto.createPublicKey(publicKeyPem);
      return crypto.verify(null, canonicalData, publicKey, signatureBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Signs an arbitrary object with a vendor Ed25519 private key (Used by vendor offline signing tool).
   */
  public static signPayloadEd25519(data: object, privateKeyPem: string): string {
    const canonicalData = Buffer.from(JSON.stringify(data, Object.keys(data).sort()));
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    const signature = crypto.sign(null, canonicalData, privateKey);
    return signature.toString('base64');
  }

  /**
   * Loads the active license from persistent storage (database system_settings or local file).
   */
  public static async loadActiveLicense(): Promise<MesLicense | null> {
    if (this.cachedLicense) {
      return this.cachedLicense;
    }

    try {
      const db = getDatabase();
      const rows = await db.query<any>(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'active_mes_license' LIMIT 1"
      );
      if (rows.length > 0 && rows[0].setting_value) {
        this.cachedLicense = JSON.parse(rows[0].setting_value);
        return this.cachedLicense;
      }
    } catch {
      // Database not ready or system_settings missing
    }

    // Fallback check on filesystem
    const candidatePaths = [
      process.env.LICENSE_PATH,
      path.resolve(process.cwd(), 'config/license.json'),
      path.resolve(process.cwd(), 'license.json'),
      '/var/data/license.json'
    ].filter(Boolean) as string[];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf-8');
          this.cachedLicense = JSON.parse(raw);
          return this.cachedLicense;
        } catch {
          // invalid json file
        }
      }
    }

    return null;
  }

  /**
   * Persists a license into persistent storage and updates cache.
   */
  public static async saveActiveLicense(license: MesLicense): Promise<void> {
    this.cachedLicense = license;
    try {
      const db = getDatabase();
      const serialized = JSON.stringify(license);
      await db.execute(`
        INSERT INTO system_settings (setting_key, setting_value, updated_at)
        VALUES ('active_mes_license', ?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET
          setting_value = excluded.setting_value,
          updated_at = excluded.updated_at
      `, [serialized, new Date().toISOString()]);
    } catch (err: any) {
      console.warn('[LICENSING] Could not persist license to system_settings:', err.message);
    }
  }

  /**
   * Verifies the complete state of the active license:
   * 1. Cryptographic Ed25519 vendor signature
   * 2. Expiration date
   * 3. Hardware fingerprint and additive drift score
   * 4. 14-day Read-Only Grace Period calculation
   */
  public static async verifyLicense(options?: {
    license?: MesLicense;
    currentHardware?: HardwareComponents;
    vendorPublicKey?: string;
    asOfDate?: Date;
  }): Promise<LicenseVerificationResult> {
    const license = options?.license || (await this.loadActiveLicense());
    const vendorKey = options?.vendorPublicKey || DEFAULT_VENDOR_PUBLIC_KEY;
    const now = options?.asOfDate || new Date();

    if (!license) {
      return {
        status: 'INVALID',
        driftScore: 100,
        driftedComponents: ['NO_LICENSE_INSTALLED'],
        gracePeriodDaysRemaining: 0,
        message: 'No active MES license installed on appliance.',
        readOnlyEnforced: true,
        license: null
      };
    }

    // 1. Verify Ed25519 Cryptographic Signature
    const sigValid = this.verifyEd25519Signature(license.payload, license.signature, vendorKey);
    if (!sigValid) {
      return {
        status: 'INVALID',
        driftScore: 100,
        driftedComponents: ['SIGNATURE_VERIFICATION_FAILED'],
        gracePeriodDaysRemaining: 0,
        message: 'License Ed25519 signature is invalid or tampered.',
        readOnlyEnforced: true,
        license: license.payload
      };
    }

    // 2. Verify Expiration Date
    const expiresAt = new Date(license.payload.expiresAt).getTime();
    if (now.getTime() > expiresAt) {
      return {
        status: 'EXPIRED',
        driftScore: 0,
        driftedComponents: [],
        gracePeriodDaysRemaining: 0,
        message: `License expired on ${license.payload.expiresAt}.`,
        readOnlyEnforced: true,
        license: license.payload
      };
    }

    // 3. Verify Hardware Binding & Additive Drift
    const currentHw = options?.currentHardware || this.detectHardwareComponents();
    const licensedHw: HardwareComponents = {
      cpuId: license.payload.hardware.cpuId,
      mbUuid: license.payload.hardware.mbUuid,
      primaryMac: license.payload.hardware.primaryMac
    };

    const currentFp = this.canonicalFingerprint(currentHw);
    const licensedFp = license.payload.hardware.fingerprint || this.canonicalFingerprint(licensedHw);

    const { score, driftedComponents } = this.calculateDrift(licensedHw, currentHw);

    // Exact Match (0 Drift)
    if (score === 0 && currentFp.toLowerCase() === licensedFp.toLowerCase()) {
      // Clear any prior drift record in system_settings
      await this.clearDriftRecord();
      return {
        status: 'VALID',
        driftScore: 0,
        driftedComponents: [],
        gracePeriodDaysRemaining: 14,
        message: 'License is fully valid and locked to host hardware.',
        readOnlyEnforced: false,
        license: license.payload
      };
    }

    // Drift Detected: Check/Record Grace Period
    const firstDriftTime = await this.getOrCreateFirstDriftTime(now);
    const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - firstDriftTime.getTime()) / 1000));
    const secondsRemaining = Math.max(0, this.GRACE_PERIOD_SECONDS - elapsedSeconds);
    const daysRemaining = Math.ceil(secondsRemaining / (24 * 60 * 60));

    if (elapsedSeconds > this.GRACE_PERIOD_SECONDS) {
      // Grace period expired without applying a vendor patch
      return {
        status: 'EXPIRED',
        driftScore: score,
        driftedComponents,
        gracePeriodDaysRemaining: 0,
        message: `Hardware drift tolerance (14 days) expired on ${new Date(firstDriftTime.getTime() + this.GRACE_PERIOD_SECONDS * 1000).toISOString()}. Read-only enforcement active.`,
        readOnlyEnforced: true,
        license: license.payload
      };
    }

    // Currently within 14-day Grace Period
    const swapAlert = score > 50 ? ' [CRITICAL: Full machine swap detected]' : '';
    return {
      status: 'GRACE_PERIOD',
      driftScore: score,
      driftedComponents,
      gracePeriodDaysRemaining: daysRemaining,
      message: `Hardware drift detected (${score} pts: ${driftedComponents.join(', ')})${swapAlert}. 14-day grace period active (${daysRemaining} day(s) remaining). Production continuing. Apply vendor patch.`,
      readOnlyEnforced: false,
      license: license.payload
    };
  }

  /**
   * Generates an offline Drift Challenge for the vendor to issue a signed patch.
   */
  public static async generateDriftChallenge(): Promise<DriftChallenge> {
    const license = await this.loadActiveLicense();
    if (!license) {
      throw new Error('Cannot generate drift challenge: No active license loaded.');
    }

    const currentHw = this.detectHardwareComponents();
    const currentFp = this.canonicalFingerprint(currentHw);
    const licensedHw: HardwareComponents = {
      cpuId: license.payload.hardware.cpuId,
      mbUuid: license.payload.hardware.mbUuid,
      primaryMac: license.payload.hardware.primaryMac
    };

    const { score, driftedComponents } = this.calculateDrift(licensedHw, currentHw);

    return {
      challengeId: `CHALLENGE-${Date.now()}`,
      licenseId: license.payload.licenseId,
      timestamp: new Date().toISOString(),
      currentHardware: currentHw,
      currentFingerprint: currentFp,
      driftScore: score,
      driftedComponents
    };
  }

  /**
   * Applies an offline Ed25519-signed drift patch from the vendor.
   */
  public static async applyPatch(
    patch: LicensePatch,
    vendorPublicKey = DEFAULT_VENDOR_PUBLIC_KEY
  ): Promise<LicenseVerificationResult> {
    // 1. Verify Patch Ed25519 Signature
    const patchValid = this.verifyEd25519Signature(patch.payload, patch.signature, vendorPublicKey);
    if (!patchValid) {
      throw new Error('License patch rejection: Ed25519 digital signature is invalid or tampered.');
    }

    // 2. Load active license and match licenseId
    const current = await this.loadActiveLicense();
    if (!current) {
      throw new Error('Cannot apply patch: No baseline license exists.');
    }
    if (current.payload.licenseId !== patch.payload.licenseId) {
      throw new Error(`Patch license ID mismatch: expected ${current.payload.licenseId}, got ${patch.payload.licenseId}`);
    }

    // 3. Update Hardware Binding
    current.payload.hardware = {
      cpuId: patch.payload.newHardware.cpuId,
      mbUuid: patch.payload.newHardware.mbUuid,
      primaryMac: patch.payload.newHardware.primaryMac,
      fingerprint: patch.payload.newFingerprint || this.canonicalFingerprint(patch.payload.newHardware)
    };

    if (patch.payload.extendedUntil) {
      current.payload.expiresAt = patch.payload.extendedUntil;
    }

    // 4. Save and Clear Drift State
    await this.saveActiveLicense(current);
    await this.clearDriftRecord();

    return this.verifyLicense({ license: current, vendorPublicKey });
  }

  private static async getOrCreateFirstDriftTime(now: Date): Promise<Date> {
    try {
      const db = getDatabase();
      const rows = await db.query<any>(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'licensing_drift_first_detected_at' LIMIT 1"
      );
      if (rows.length > 0 && rows[0].setting_value) {
        const d = new Date(rows[0].setting_value);
        if (!isNaN(d.getTime())) return d;
      }

      // Record first drift timestamp
      const iso = now.toISOString();
      await db.execute(`
        INSERT INTO system_settings (setting_key, setting_value, updated_at)
        VALUES ('licensing_drift_first_detected_at', ?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET
          setting_value = excluded.setting_value,
          updated_at = excluded.updated_at
      `, [iso, iso]);
      return now;
    } catch {
      return now;
    }
  }

  private static async clearDriftRecord(): Promise<void> {
    try {
      const db = getDatabase();
      await db.execute("DELETE FROM system_settings WHERE setting_key = 'licensing_drift_first_detected_at'");
    } catch {
      // ignore
    }
  }
}
