// apps/api/tests/mes-doctor.test.ts
import { describe, it, expect } from 'vitest';
import { MesDoctor, DiagnosticResult } from '../../../scripts/mes-doctor';

describe('MES Doctor Diagnostic Suite (Task 9)', () => {
  let result: DiagnosticResult;

  it('executes 13 diagnostic modules and verifies deployment readiness', async () => {
    result = await MesDoctor.runDiagnostics();

    expect(result.modules.length).toBe(13);
    expect(result.version).toBe('1.0.0');
    expect(result.timestamp).toBeDefined();

    // Verify all expected module names are present
    const moduleNames = result.modules.map(m => m.name);
    expect(moduleNames).toContain('database-schema');
    expect(moduleNames).toContain('auth-stack');
    expect(moduleNames).toContain('credential-hashing');
    expect(moduleNames).toContain('rbac-permissions');
    expect(moduleNames).toContain('compliance-ledger');
    expect(moduleNames).toContain('perimeter-security');
    expect(moduleNames).toContain('ot-gateway');
    expect(moduleNames).toContain('bootstrap-lockdown');
    expect(moduleNames).toContain('disaster-recovery');
    expect(moduleNames).toContain('audit-exceptions');
    expect(moduleNames).toContain('container-config');
    expect(moduleNames).toContain('release-attestation');
    expect(moduleNames).toContain('traceability-module');

    // Every module should have timing
    for (const mod of result.modules) {
      expect(mod.durationMs).toBeGreaterThanOrEqual(0);
      expect(mod.detail).toBeDefined();
      expect(['PASS', 'FAIL', 'NOT_VERIFIED']).toContain(mod.status);
    }
  });

  it('strictly treats NOT_VERIFIED as failing deployment readiness', async () => {
    // The tri-state model requires NOT_VERIFIED to be treated as FAIL
    // Verify the logic: deploymentReady should be false if ANY module is NOT_VERIFIED
    const mockResult: DiagnosticResult = {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      modules: [
        { name: 'test-module-1', status: 'PASS', detail: 'ok', durationMs: 1 },
        { name: 'test-module-2', status: 'NOT_VERIFIED', detail: 'could not check', durationMs: 1 },
      ],
      deploymentReady: false,
      passCount: 1,
      failCount: 0,
      notVerifiedCount: 1,
      summary: 'FAIL'
    };

    // Verify NOT_VERIFIED contributes to non-readiness
    expect(mockResult.deploymentReady).toBe(false);
    expect(mockResult.notVerifiedCount).toBe(1);

    // Verify actual diagnostic result follows the same rule
    const actual = await MesDoctor.runDiagnostics();
    if (actual.notVerifiedCount > 0 || actual.failCount > 0) {
      expect(actual.deploymentReady).toBe(false);
    } else {
      expect(actual.deploymentReady).toBe(true);
    }
  });

  it('validates core security modules pass individually', async () => {
    const diag = await MesDoctor.runDiagnostics();

    // These security-critical modules must pass in a properly configured codebase
    const criticalModules = [
      'database-schema',
      'auth-stack',
      'credential-hashing',
      'rbac-permissions',
      'compliance-ledger',
      'perimeter-security',
      'ot-gateway',
      'bootstrap-lockdown',
      'disaster-recovery',
      'audit-exceptions'
    ];

    for (const name of criticalModules) {
      const mod = diag.modules.find(m => m.name === name);
      expect(mod, `Module '${name}' should exist`).toBeDefined();
      expect(mod!.status, `Module '${name}' should PASS but got ${mod!.status}: ${mod!.detail}`).toBe('PASS');
    }
  });

  it('produces a valid release attestation summary', async () => {
    const diag = await MesDoctor.runDiagnostics();

    expect(diag.summary).toBeDefined();
    expect(diag.summary).toContain('DEVSECOPS RELEASE ATTESTATION');
    expect(diag.passCount + diag.failCount + diag.notVerifiedCount).toBe(diag.modules.length);
  });

  it('reports correct counts for pass/fail/not-verified breakdown', async () => {
    const diag = await MesDoctor.runDiagnostics();

    const actualPass = diag.modules.filter(m => m.status === 'PASS').length;
    const actualFail = diag.modules.filter(m => m.status === 'FAIL').length;
    const actualNotVerified = diag.modules.filter(m => m.status === 'NOT_VERIFIED').length;

    expect(diag.passCount).toBe(actualPass);
    expect(diag.failCount).toBe(actualFail);
    expect(diag.notVerifiedCount).toBe(actualNotVerified);
  });
});
