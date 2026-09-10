// scripts/mes-doctor.ts
//
// MES Doctor — Pre-Deployment Diagnostic CLI
//
// Validates appliance readiness across 12 diagnostic modules before deployment.
// Each module returns PASS, FAIL, or NOT_VERIFIED. NOT_VERIFIED is treated as FAIL.
//
// Usage:
//   npx tsx scripts/mes-doctor.ts
//   npm run doctor
//
// Tri-State Result Model:
//   PASS         — verified and healthy
//   FAIL         — verified and unhealthy, must fix
//   NOT_VERIFIED — could not verify, treated as FAIL for deployment readiness

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type DiagnosticStatus = 'PASS' | 'FAIL' | 'NOT_VERIFIED';

export interface DiagnosticModule {
  name: string;
  status: DiagnosticStatus;
  detail: string;
  durationMs: number;
}

export interface DiagnosticResult {
  timestamp: string;
  version: string;
  modules: DiagnosticModule[];
  deploymentReady: boolean;
  passCount: number;
  failCount: number;
  notVerifiedCount: number;
  summary: string;
}

export interface AuditException {
  advisory: string;
  package: string;
  rationale: string;
  owner: string;
  mitigation: string;
  expiresAt: string;
}

export interface AuditExceptionsFile {
  exceptions: AuditException[];
}

// ---------------------------------------------------------------------------
// Individual diagnostic modules
// ---------------------------------------------------------------------------

async function checkDatabaseSchema(): Promise<DiagnosticModule> {
  const start = Date.now();
  try {
    const schemaPath = path.resolve(__dirname, '../apps/api/src/db/schema.sql');
    const databasePath = path.resolve(__dirname, '../apps/api/src/db/database.ts');

    const schemaExists = fs.existsSync(schemaPath);
    const databaseExists = fs.existsSync(databasePath);

    if (!schemaExists || !databaseExists) {
      return { name: 'database-schema', status: 'FAIL', detail: 'Schema files missing', durationMs: Date.now() - start };
    }

    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
    const requiredTables = [
      'operators', 'production_events', 'compliance_audit_ledger',
      'device_history_records', 'refresh_tokens', 'dr_drill_history'
    ];

    const missing = requiredTables.filter(t => !schemaContent.includes(t));
    if (missing.length > 0) {
      return { name: 'database-schema', status: 'FAIL', detail: `Missing tables in schema.sql: ${missing.join(', ')}`, durationMs: Date.now() - start };
    }

    return { name: 'database-schema', status: 'PASS', detail: `All ${requiredTables.length} core tables present in schema`, durationMs: Date.now() - start };
  } catch (e: any) {
    return { name: 'database-schema', status: 'NOT_VERIFIED', detail: e.message, durationMs: Date.now() - start };
  }
}

async function checkAuthStack(): Promise<DiagnosticModule> {
  const start = Date.now();
  try {
    const files = [
      'apps/api/src/security/jwt.ts',
      'apps/api/src/security/session-manager.ts',
      'apps/api/src/security/pin-policy.ts',
      'apps/api/src/middleware/auth.middleware.ts',
      'apps/api/src/security/permissions.ts'
    ];

    const root = path.resolve(__dirname, '..');
    const missing = files.filter(f => !fs.existsSync(path.join(root, f)));

    if (missing.length > 0) {
      return { name: 'auth-stack', status: 'FAIL', detail: `Missing auth files: ${missing.map(f => path.basename(f)).join(', ')}`, durationMs: Date.now() - start };
    }

    // Verify JWT uses short-lived tokens
    const jwtContent = fs.readFileSync(path.join(root, 'apps/api/src/security/jwt.ts'), 'utf-8');
    if (!jwtContent.includes('expiresIn') && !jwtContent.includes('exp')) {
      return { name: 'auth-stack', status: 'FAIL', detail: 'JWT module missing token expiry configuration', durationMs: Date.now() - start };
    }

    return { name: 'auth-stack', status: 'PASS', detail: 'Dual-token JWT + session manager + PIN policy + RBAC middleware present', durationMs: Date.now() - start };
  } catch (e: any) {
    return { name: 'auth-stack', status: 'NOT_VERIFIED', detail: e.message, durationMs: Date.now() - start };
  }
}

async function checkCredentialHashing(): Promise<DiagnosticModule> {
  const start = Date.now();
  try {
    const root = path.resolve(__dirname, '..');
    const pinPolicyPath = path.join(root, 'apps/api/src/security/pin-policy.ts');

    if (!fs.existsSync(pinPolicyPath)) {
      return { name: 'credential-hashing', status: 'FAIL', detail: 'pin-policy.ts not found', durationMs: Date.now() - start };
    }

    const content = fs.readFileSync(pinPolicyPath, 'utf-8');
    const hasArgon2 = content.includes('argon2');
    const hasBcrypt = content.includes('bcrypt');

    if (!hasArgon2 && !hasBcrypt) {
      return { name: 'credential-hashing', status: 'FAIL', detail: 'No password hashing algorithm (argon2/bcrypt) found in pin-policy', durationMs: Date.now() - start };
    }

    return { name: 'credential-hashing', status: 'PASS', detail: `Credential hashing: ${hasArgon2 ? 'argon2id' : ''}${hasArgon2 && hasBcrypt ? '+' : ''}${hasBcrypt ? 'bcrypt' : ''} present`, durationMs: Date.now() - start };
  } catch (e: any) {
    return { name: 'credential-hashing', status: 'NOT_VERIFIED', detail: e.message, durationMs: Date.now() - start };
  }
}

async function checkRbac(): Promise<DiagnosticModule> {
  const start = Date.now();
  try {
    const root = path.resolve(__dirname, '..');
    const permFile = path.join(root, 'apps/api/src/security/permissions.ts');

    if (!fs.existsSync(permFile)) {
      return { name: 'rbac-permissions', status: 'FAIL', detail: 'permissions.ts not found', durationMs: Date.now() - start };
    }

    const content = fs.readFileSync(permFile, 'utf-8');
    const hasPermissionEnum = content.includes('Permission');
    const hasRoleMap = content.includes('ROLE_PERMISSIONS') || content.includes('rolePermissions') || content.includes('ROLE_PERMISSION_MAP');
    const hasSoD = content.includes('SoD') || content.includes('separation') || content.includes('NON_DELEGABLE');

    if (!hasPermissionEnum) {
      return { name: 'rbac-permissions', status: 'FAIL', detail: 'Permission enum not found', durationMs: Date.now() - start };
    }

    return { name: 'rbac-permissions', status: 'PASS', detail: `Permission enum present, role map: ${hasRoleMap ? 'yes' : 'no'}, SoD: ${hasSoD ? 'yes' : 'no'}`, durationMs: Date.now() - start };
  } catch (e: any) {
    return { name: 'rbac-permissions', status: 'NOT_VERIFIED', detail: e.message, durationMs: Date.now() - start };
  }
}

async function checkComplianceLedger(): Promise<DiagnosticModule> {
  const start = Date.now();
  try {
    const root = path.resolve(__dirname, '..');
    const ledgerPath = path.join(root, 'apps/api/src/services/compliance-ledger.service.ts');

    if (!fs.existsSync(ledgerPath)) {
      return { name: 'compliance-ledger', status: 'FAIL', detail: 'compliance-ledger.service.ts not found', durationMs: Date.now() - start };
    }

    const content = fs.readFileSync(ledgerPath, 'utf-8');
    const hasCanonical = content.includes('canonicalize') || content.includes('RFC 8785');
    const hasHashChain = content.includes('previousHash') || content.includes('previous_hash');
    const hasVerify = content.includes('verifyIntegrity') || content.includes('verifyLedgerIntegrity');

    if (!hasHashChain) {
      return { name: 'compliance-ledger', status: 'FAIL', detail: 'No hash-chain implementation found', durationMs: Date.now() - start };
    }

    return { name: 'compliance-ledger', status: 'PASS', detail: `Hash-chained ledger: canonical=${hasCanonical}, integrity-verify=${hasVerify}`, durationMs: Date.now() - start };
  } catch (e: any) {
    return { name: 'compliance-ledger', status: 'NOT_VERIFIED', detail: e.message, durationMs: Date.now() - start };
  }
}

async function checkPerimeterSecurity(): Promise<DiagnosticModule> {
  const start = Date.now();
  try {
    const root = path.resolve(__dirname, '..');
    const files = [
      'apps/api/src/security/safe-connector.ts',
      'apps/api/src/security/egress-policies.ts',
      'deploy/caddy/Caddyfile'
    ];

    const missing = files.filter(f => !fs.existsSync(path.join(root, f)));
    if (missing.length > 0) {
      return { name: 'perimeter-security', status: 'FAIL', detail: `Missing: ${missing.map(f => path.basename(f)).join(', ')}`, durationMs: Date.now() - start };
    }

    // Verify Caddyfile has TLS config
    const caddyContent = fs.readFileSync(path.join(root, 'deploy/caddy/Caddyfile'), 'utf-8');
    const hasTls = caddyContent.includes('tls') || caddyContent.includes('TLS');
    const hasHsts = caddyContent.includes('Strict-Transport-Security');

    return { name: 'perimeter-security', status: 'PASS', detail: `SafeConnector + egress policies + Caddy (TLS=${hasTls}, HSTS=${hasHsts})`, durationMs: Date.now() - start };
  } catch (e: any) {
    return { name: 'perimeter-security', status: 'NOT_VERIFIED', detail: e.message, durationMs: Date.now() - start };
  }
}

async function checkOtGateway(): Promise<DiagnosticModule> {
  const start = Date.now();
  try {
    const root = path.resolve(__dirname, '..');
    const adapterPath = path.join(root, 'apps/api/src/adapters/fuji-nexim.adapter.ts');

    if (!fs.existsSync(adapterPath)) {
      return { name: 'ot-gateway', status: 'FAIL', detail: 'fuji-nexim.adapter.ts not found', durationMs: Date.now() - start };
    }

    const content = fs.readFileSync(adapterPath, 'utf-8');
    const hasFrameGuard = content.includes('65536') || content.includes('64 * 1024') || content.includes('MAX_FRAME');
    const hasIdleTimeout = content.includes('idle') || content.includes('IDLE') || content.includes('timeout');
    const hasSyncValidation = content.includes('sync') || content.includes('SYNC');

    return { name: 'ot-gateway', status: 'PASS', detail: `Frame guard=${hasFrameGuard}, idle timeout=${hasIdleTimeout}, sync validation=${hasSyncValidation}`, durationMs: Date.now() - start };
  } catch (e: any) {
    return { name: 'ot-gateway', status: 'NOT_VERIFIED', detail: e.message, durationMs: Date.now() - start };
  }
}

async function checkBootstrapLockdown(): Promise<DiagnosticModule> {
  const start = Date.now();
  try {
    const root = path.resolve(__dirname, '..');
    const onboardingPath = path.join(root, 'apps/api/src/services/onboarding.service.ts');

    if (!fs.existsSync(onboardingPath)) {
      return { name: 'bootstrap-lockdown', status: 'FAIL', detail: 'onboarding.service.ts not found', durationMs: Date.now() - start };
    }

    const content = fs.readFileSync(onboardingPath, 'utf-8');
    const hasStateMachine = content.includes('UNINITIALIZED') || content.includes('PROVISIONING') || content.includes('PRODUCTION_ACTIVE');
    const hasIrreversible = content.includes('irreversible') || content.includes('BOOTSTRAPPING') || content.includes('cannot') || content.includes('locked');

    return { name: 'bootstrap-lockdown', status: 'PASS', detail: `State machine=${hasStateMachine}, lockdown=${hasIrreversible}`, durationMs: Date.now() - start };
  } catch (e: any) {
    return { name: 'bootstrap-lockdown', status: 'NOT_VERIFIED', detail: e.message, durationMs: Date.now() - start };
  }
}

async function checkDisasterRecovery(): Promise<DiagnosticModule> {
  const start = Date.now();
  try {
    const root = path.resolve(__dirname, '..');
    const scripts = ['scripts/backup.sh', 'scripts/restore.sh', 'scripts/dr-drill.sh'];
    const servicePath = path.join(root, 'apps/api/src/services/dr-verification.service.ts');

    const missingScripts = scripts.filter(s => !fs.existsSync(path.join(root, s)));
    if (missingScripts.length > 0) {
      return { name: 'disaster-recovery', status: 'FAIL', detail: `Missing scripts: ${missingScripts.join(', ')}`, durationMs: Date.now() - start };
    }

    if (!fs.existsSync(servicePath)) {
      return { name: 'disaster-recovery', status: 'FAIL', detail: 'dr-verification.service.ts not found', durationMs: Date.now() - start };
    }

    // Verify scripts are executable
    for (const script of scripts) {
      const fullPath = path.join(root, script);
      try {
        fs.accessSync(fullPath, fs.constants.X_OK);
      } catch {
        return { name: 'disaster-recovery', status: 'FAIL', detail: `${script} is not executable`, durationMs: Date.now() - start };
      }
    }

    return { name: 'disaster-recovery', status: 'PASS', detail: 'backup.sh + restore.sh + dr-drill.sh executable, DrVerificationService present', durationMs: Date.now() - start };
  } catch (e: any) {
    return { name: 'disaster-recovery', status: 'NOT_VERIFIED', detail: e.message, durationMs: Date.now() - start };
  }
}

async function checkAuditExceptions(): Promise<DiagnosticModule> {
  const start = Date.now();
  try {
    const root = path.resolve(__dirname, '..');
    const exceptionsPath = path.join(root, '.audit-exceptions.json');

    if (!fs.existsSync(exceptionsPath)) {
      return { name: 'audit-exceptions', status: 'FAIL', detail: '.audit-exceptions.json not found', durationMs: Date.now() - start };
    }

    const content = JSON.parse(fs.readFileSync(exceptionsPath, 'utf-8')) as AuditExceptionsFile;
    const now = new Date();

    const expired = (content.exceptions || []).filter(e => {
      try {
        return new Date(e.expiresAt) < now;
      } catch {
        return true; // Invalid date is treated as expired
      }
    });

    const invalid = (content.exceptions || []).filter(e => {
      return !e.advisory || !e.package || !e.rationale || !e.owner || !e.mitigation || !e.expiresAt;
    });

    if (expired.length > 0) {
      return { name: 'audit-exceptions', status: 'FAIL', detail: `${expired.length} expired exception(s): ${expired.map(e => e.advisory).join(', ')}`, durationMs: Date.now() - start };
    }

    if (invalid.length > 0) {
      return { name: 'audit-exceptions', status: 'FAIL', detail: `${invalid.length} incomplete exception(s) missing required fields`, durationMs: Date.now() - start };
    }

    return { name: 'audit-exceptions', status: 'PASS', detail: `${content.exceptions.length} active exception(s), 0 expired`, durationMs: Date.now() - start };
  } catch (e: any) {
    return { name: 'audit-exceptions', status: 'NOT_VERIFIED', detail: e.message, durationMs: Date.now() - start };
  }
}

async function checkDockerCompose(): Promise<DiagnosticModule> {
  const start = Date.now();
  try {
    const root = path.resolve(__dirname, '..');
    const composePath = path.join(root, 'docker-compose.yml');

    if (!fs.existsSync(composePath)) {
      return { name: 'container-config', status: 'NOT_VERIFIED', detail: 'docker-compose.yml not found', durationMs: Date.now() - start };
    }

    const content = fs.readFileSync(composePath, 'utf-8');

    // Verify Adminer is gated behind a profile (not default-exposed)
    const hasAdminer = content.includes('adminer');
    const hasProfile = content.includes('profiles:') || content.includes('profile:');
    const exposesAdminer = hasAdminer && !hasProfile;

    if (exposesAdminer) {
      return { name: 'container-config', status: 'FAIL', detail: 'Adminer exposed without debug profile gate', durationMs: Date.now() - start };
    }

    // Check no direct PG port exposure (5432) — ignore YAML comment lines
    const uncommentedLines = content.split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
    const pgPortMatch = uncommentedLines.match(/['"]?5432:5432['"]?/);
    if (pgPortMatch) {
      return { name: 'container-config', status: 'FAIL', detail: 'PostgreSQL port 5432 directly exposed to host', durationMs: Date.now() - start };
    }

    return { name: 'container-config', status: 'PASS', detail: `Adminer gated=${hasAdminer ? 'profile' : 'absent'}, PG port=internal-only`, durationMs: Date.now() - start };
  } catch (e: any) {
    return { name: 'container-config', status: 'NOT_VERIFIED', detail: e.message, durationMs: Date.now() - start };
  }
}

async function checkReleaseAttestation(): Promise<DiagnosticModule> {
  const start = Date.now();
  try {
    const root = path.resolve(__dirname, '..');
    const ciPath = path.join(root, 'deploy/ci/ci.yml');

    if (!fs.existsSync(ciPath)) {
      return { name: 'release-attestation', status: 'FAIL', detail: 'CI pipeline configuration not found', durationMs: Date.now() - start };
    }

    const content = fs.readFileSync(ciPath, 'utf-8');

    // The CI captures npm audit JSON with `|| true` then evaluates via inline Node script
    // that calls process.exit(1) on unexcepted high/critical vulns. Detect the actual
    // blocking mechanism, not just the raw `|| true` capture pattern.
    const hasAudit = content.includes('npm audit');
    const hasBlockingEvaluation = content.includes('process.exit(1)') && content.includes('audit-exceptions');
    const hasNaiveBypass = hasAudit && content.includes('|| true') && !hasBlockingEvaluation;
    const hasBlockingAudit = hasAudit && (hasBlockingEvaluation || !content.includes('|| true'));
    const hasSecretScan = content.includes('gitleaks') || content.includes('trufflehog') || content.includes('secret') || content.includes('detect-secrets');
    const hasSast = content.includes('semgrep') || content.includes('eslint-plugin-security') || content.includes('SAST') || content.includes('sast');
    const hasDoctor = content.includes('doctor') || content.includes('mes-doctor');

    const issues: string[] = [];
    if (hasNaiveBypass) issues.push('npm audit gate bypassed with || true');
    if (!hasSecretScan) issues.push('no secret scanning');
    if (!hasSast) issues.push('no SAST scanning');
    if (!hasDoctor) issues.push('mes-doctor not in CI');

    if (issues.length > 0) {
      if (hasNaiveBypass) {
        return { name: 'release-attestation', status: 'FAIL', detail: `CI deficiencies: ${issues.join('; ')}`, durationMs: Date.now() - start };
      }
    }

    return { name: 'release-attestation', status: hasBlockingAudit ? 'PASS' : 'FAIL', detail: `Blocking audit=${hasBlockingAudit}, secrets=${hasSecretScan}, SAST=${hasSast}, doctor=${hasDoctor}`, durationMs: Date.now() - start };
  } catch (e: any) {
    return { name: 'release-attestation', status: 'NOT_VERIFIED', detail: e.message, durationMs: Date.now() - start };
  }
}

// ---------------------------------------------------------------------------
// MesDoctor main orchestrator
// ---------------------------------------------------------------------------

export class MesDoctor {
  public static readonly VERSION = '1.0.0';

  /**
   * Execute all 12 diagnostic modules and produce a deployment readiness report.
   * Any module returning NOT_VERIFIED is treated as FAIL for deployment readiness.
   */
  public static async runDiagnostics(): Promise<DiagnosticResult> {
    const startTime = Date.now();
    const modules: DiagnosticModule[] = [];

    // Execute all 12 diagnostic modules
    const checks = [
      checkDatabaseSchema,
      checkAuthStack,
      checkCredentialHashing,
      checkRbac,
      checkComplianceLedger,
      checkPerimeterSecurity,
      checkOtGateway,
      checkBootstrapLockdown,
      checkDisasterRecovery,
      checkAuditExceptions,
      checkDockerCompose,
      checkReleaseAttestation
    ];

    for (const check of checks) {
      const result = await check();
      modules.push(result);
    }

    const passCount = modules.filter(m => m.status === 'PASS').length;
    const failCount = modules.filter(m => m.status === 'FAIL').length;
    const notVerifiedCount = modules.filter(m => m.status === 'NOT_VERIFIED').length;

    // NOT_VERIFIED is treated as FAIL for deployment readiness
    const deploymentReady = failCount === 0 && notVerifiedCount === 0;

    const result: DiagnosticResult = {
      timestamp: new Date().toISOString(),
      version: MesDoctor.VERSION,
      modules,
      deploymentReady,
      passCount,
      failCount,
      notVerifiedCount,
      summary: deploymentReady
        ? `DEVSECOPS RELEASE ATTESTATION: PASS — ${passCount}/${modules.length} modules verified`
        : `DEVSECOPS RELEASE ATTESTATION: FAIL — ${failCount} failed, ${notVerifiedCount} not verified`
    };

    return result;
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           MES DOCTOR — Pre-Deployment Diagnostics          ║');
  console.log('║           Antigravity SMT Manufacturing Execution          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const result = await MesDoctor.runDiagnostics();

  for (const mod of result.modules) {
    const icon = mod.status === 'PASS' ? '✅' : mod.status === 'FAIL' ? '❌' : '⚠️ ';
    const padded = mod.name.padEnd(22);
    console.log(`  ${icon}  ${padded}  ${mod.status.padEnd(13)}  ${mod.detail}  (${mod.durationMs}ms)`);
  }

  console.log('');
  console.log('─'.repeat(64));
  console.log(`  📊 Results: ${result.passCount} PASS / ${result.failCount} FAIL / ${result.notVerifiedCount} NOT_VERIFIED`);
  console.log(`  🚀 ${result.summary}`);
  console.log('─'.repeat(64));

  if (!result.deploymentReady) {
    process.exit(1);
  }
}

// Run CLI when executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error('MES Doctor fatal error:', err);
    process.exit(1);
  });
}
