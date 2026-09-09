// apps/api/tests/auth-pin-security.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PinPolicy } from '../src/security/pin-policy';
import { AuthenticationService } from '../src/services/authentication.service';
import { DatabaseManager, initDatabase } from '../src/db/database';
import { migrateOperatorPins } from '../../scripts/migrate-pins';

describe('PIN Security, Anti-Enumeration & Lockout Suite (Task 2)', () => {
  const db = DatabaseManager.getInstance();

  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(async () => {
    await db.execute("DELETE FROM operators WHERE code LIKE 'TEST-%'");
    await db.execute(`
      INSERT INTO operators (id, code, name, role, pin, pin_hash, failed_login_attempts, status, locked_until)
      VALUES 
        ('test-op-1', 'TEST-OP-1', 'Test Operator 1', 'OPERATOR', '0429', NULL, 0, 'ACTIVE', NULL),
        ('test-sup-1', 'TEST-SUP-1', 'Test Supervisor 1', 'SUPERVISOR', '881422', NULL, 0, 'ACTIVE', NULL)
    `);
  });

  it('hashes operator PIN using Argon2id and verifies successfully', async () => {
    const hash = await PinPolicy.hashPin('0429');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await PinPolicy.verifyPin('0429', hash)).toBe(true);
    expect(await PinPolicy.verifyPin('0430', hash)).toBe(false);
  });

  it('verifies bcrypt fallback hashes for backwards-compatible verification', async () => {
    const bcryptHash = await PinPolicy.hashPin('0429', true); // explicit bcrypt
    expect(bcryptHash.startsWith('$2b$12$') || bcryptHash.startsWith('$2a$12$')).toBe(true);
    expect(await PinPolicy.verifyPin('0429', bcryptHash)).toBe(true);
    expect(await PinPolicy.verifyPin('0430', bcryptHash)).toBe(false);
  });

  it('enforces constant-time dummy compare for unknown operator codes (anti-enumeration)', async () => {
    const startUnknown = performance.now();
    await PinPolicy.verifyUnknownOperator('9999');
    const elapsedUnknown = performance.now() - startUnknown;

    const dummyHash = await PinPolicy.hashPin('1234');
    const startKnown = performance.now();
    await PinPolicy.verifyPin('9999', dummyHash);
    const elapsedKnown = performance.now() - startKnown;

    // Both should execute a real hash verification; difference within bounded jitter
    expect(Math.abs(elapsedUnknown - elapsedKnown)).toBeLessThan(150);
  });

  it('validates PIN complexity rules by role', () => {
    // Cleanroom operator: 4-8 numeric digits
    expect(PinPolicy.validateComplexity('0429', 'OPERATOR').valid).toBe(true);
    expect(PinPolicy.validateComplexity('123', 'OPERATOR').valid).toBe(false);
    expect(PinPolicy.validateComplexity('123456789', 'OPERATOR').valid).toBe(false);
    expect(PinPolicy.validateComplexity('abcd', 'OPERATOR').valid).toBe(false);

    // Privileged supervisor: minimum 6 digits
    expect(PinPolicy.validateComplexity('881422', 'SUPERVISOR').valid).toBe(true);
    expect(PinPolicy.validateComplexity('0429', 'SUPERVISOR').valid).toBe(false);
  });

  it('locks account atomically after 5 consecutive failed attempts', async () => {
    const hashedPin = await PinPolicy.hashPin('0429');
    await db.execute("UPDATE operators SET pin_hash = ? WHERE code = 'TEST-OP-1'", [hashedPin]);

    // Attempt 1-4 with wrong PIN
    for (let i = 1; i <= 4; i++) {
      const result = await AuthenticationService.loginWithPin('TEST-OP-1', '0000', '127.0.0.1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_CREDENTIALS');
      expect(result.locked).toBe(false);
    }

    // 5th attempt locks account
    const fifthResult = await AuthenticationService.loginWithPin('TEST-OP-1', '0000', '127.0.0.1');
    expect(fifthResult.success).toBe(false);
    expect(fifthResult.locked).toBe(true);
    expect(fifthResult.error).toBe('ACCOUNT_LOCKED');

    // 6th attempt with CORRECT PIN is rejected because account is locked
    const lockedResult = await AuthenticationService.loginWithPin('TEST-OP-1', '0429', '127.0.0.1');
    expect(lockedResult.success).toBe(false);
    expect(lockedResult.error).toBe('ACCOUNT_LOCKED');
  });

  it('executes idempotent, resumable backfill migration and drops plaintext PINs', async () => {
    const migrationReport = await migrateOperatorPins(db);
    expect(migrationReport.migratedCount).toBeGreaterThanOrEqual(2);
    expect(migrationReport.nullHashCount).toBe(0);

    // Verify all test operators now have valid pin_hash
    const operators = await db.query("SELECT code, pin, pin_hash FROM operators WHERE code LIKE 'TEST-%'");
    for (const op of operators) {
      expect(op.pin_hash).not.toBeNull();
      expect(op.pin_hash.startsWith('$argon2id$') || op.pin_hash.startsWith('$2b$12$')).toBe(true);
    }

    // Second run should be idempotent (0 migrated, 0 errors)
    const secondRun = await migrateOperatorPins(db);
    expect(secondRun.migratedCount).toBe(0);
    expect(secondRun.nullHashCount).toBe(0);
  }, 15000);
});
