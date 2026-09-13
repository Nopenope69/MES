#!/usr/bin/env npx tsx

// ==============================================================================
// Antigravity SMT MES - System Administration & License Management CLI (Stage 6 / C-01)
//
// Commands:
//   status                      Display current license state, fingerprint, and drift
//   generate-challenge          Generate offline hardware drift challenge for vendor
//   apply-patch <patch_file>    Apply Ed25519-signed drift patch issued by vendor
//   issue-license <options>     Vendor utility: Generate and sign Ed25519 license
//   verify                      Audit appliance license and exit with code 0/1
// ==============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  LicensingService,
  HardwareComponents,
  MesLicense,
  MesLicensePayload,
  LicensePatch,
  DEFAULT_VENDOR_PUBLIC_KEY
} from '../apps/api/src/services/licensing.service';
import { initDatabase } from '../apps/api/src/db/database';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';

  await initDatabase();

  switch (command) {
    case 'status': {
      console.log('================================================================================');
      console.log('   🔐 ANTIGRAVITY SMT MES LICENSE & APPLIANCE SECURITY STATUS');
      console.log('================================================================================');
      const hw = LicensingService.detectHardwareComponents();
      const fp = LicensingService.canonicalFingerprint(hw);
      console.log('[APPLIANCE HARDWARE]');
      console.log(`  - CPU ID:            ${hw.cpuId}`);
      console.log(`  - Motherboard UUID:  ${hw.mbUuid}`);
      console.log(`  - Primary MAC:       ${hw.primaryMac}`);
      console.log(`  - Active Fingerprint: ${fp}`);

      const result = await LicensingService.verifyLicense();
      console.log('\n[LICENSE STATE]');
      console.log(`  - Status:            ${result.status}`);
      console.log(`  - Drift Score:       ${result.driftScore} / 100`);
      if (result.driftedComponents.length > 0) {
        console.log(`  - Drifted Parts:     ${result.driftedComponents.join(', ')}`);
      }
      console.log(`  - Grace Remaining:   ${result.gracePeriodDaysRemaining} day(s)`);
      console.log(`  - Read-Only Mode:    ${result.readOnlyEnforced ? 'ACTIVE (Production Halted)' : 'Inactive (Full Production)'}`);
      console.log(`  - Message:           ${result.message}`);

      if (result.license) {
        console.log('\n[LICENSE DETAILS]');
        console.log(`  - License ID:        ${result.license.licenseId}`);
        console.log(`  - Customer:          ${result.license.customer}`);
        console.log(`  - Site ID:           ${result.license.siteId}`);
        console.log(`  - Tier:              ${result.license.tier}`);
        console.log(`  - Max SMT Lines:     ${result.license.maxLines}`);
        console.log(`  - Expires At:        ${result.license.expiresAt}`);
      }
      console.log('================================================================================\n');
      process.exit(result.readOnlyEnforced ? 1 : 0);
      break;
    }

    case 'generate-challenge': {
      console.log('[LICENSING] Generating offline hardware drift challenge...');
      const challenge = await LicensingService.generateDriftChallenge();
      const outputPath = args[1] || path.resolve(process.cwd(), 'drift-challenge.json');
      fs.writeFileSync(outputPath, JSON.stringify(challenge, null, 2), 'utf-8');
      console.log(`✅ Drift challenge written to: ${outputPath}`);
      console.log('Submit this file to vendor support to receive a signed patch.');
      break;
    }

    case 'apply-patch': {
      const patchPath = args[1];
      if (!patchPath || !fs.existsSync(patchPath)) {
        console.error('Usage: mes-admin apply-patch <path/to/patch.json>');
        process.exit(1);
      }
      console.log(`[LICENSING] Applying vendor patch from ${patchPath}...`);
      const rawPatch = fs.readFileSync(patchPath, 'utf-8');
      const patch: LicensePatch = JSON.parse(rawPatch);
      const result = await LicensingService.applyPatch(patch);
      console.log('✅ Patch applied successfully!');
      console.log(`Status: ${result.status}, Drift Score: ${result.driftScore}, Message: ${result.message}`);
      break;
    }

    case 'issue-license': {
      // Vendor utility: Generate an Ed25519-signed license for a customer
      const customer = args[1] || 'Apex Electronics Ltd';
      const siteId = args[2] || 'SITE-NOIDA-P4';
      const keypairPath = args[3];

      let privateKeyPem: string;
      let publicKeyPem: string;

      if (keypairPath && fs.existsSync(keypairPath)) {
        privateKeyPem = fs.readFileSync(keypairPath, 'utf-8');
      } else {
        console.log('[VENDOR-TOOL] Generating ephemeral Ed25519 keypair...');
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
        privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
        fs.writeFileSync('vendor_private.pem', privateKeyPem, 'utf-8');
        fs.writeFileSync('vendor_public.pem', publicKeyPem, 'utf-8');
        console.log('Saved vendor_private.pem and vendor_public.pem');
      }

      const hw = LicensingService.detectHardwareComponents();
      const fp = LicensingService.canonicalFingerprint(hw);

      const payload: MesLicensePayload = {
        licenseId: `LIC-APEX-${Date.now()}`,
        customer,
        siteId,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        tier: 'COMMERCIAL_ENTERPRISE',
        maxLines: 8,
        hardware: {
          ...hw,
          fingerprint: fp
        }
      };

      const signature = LicensingService.signPayloadEd25519(payload, privateKeyPem);
      const license: MesLicense = { payload, signature };

      const outPath = path.resolve(process.cwd(), 'config/license.json');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(license, null, 2), 'utf-8');
      await LicensingService.saveActiveLicense(license);
      console.log(`✅ Active license created and saved to: ${outPath}`);
      break;
    }

    case 'verify': {
      const result = await LicensingService.verifyLicense();
      if (result.readOnlyEnforced) {
        console.error(`❌ LICENSE INVALID / EXPIRED: ${result.message}`);
        process.exit(1);
      }
      console.log(`✅ LICENSE VALID: ${result.message}`);
      process.exit(0);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Available commands: status, generate-challenge, apply-patch, issue-license, verify');
      process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ mes-admin command failed:', err.message);
  process.exit(1);
});
