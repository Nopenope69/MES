// apps/api/tests/auth-token-rotation.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AuthenticationService } from '../src/services/authentication.service';
import { TokenManager } from '../src/security/jwt';
import { SessionManager } from '../src/security/session-manager';
import { getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';

describe('Dual-Token Architecture & Token-Family Refresh Rotation Suite', () => {
  beforeEach(async () => {
    await seedDatabase();
  });

  it('issues valid 15-minute access JWT and opaque refresh token on login', async () => {
    const login = await AuthenticationService.loginWithPin('OP-SMT-01', '1234', '127.0.0.1');
    expect(login.success).toBe(true);
    expect(login.accessToken).toBeDefined();
    expect(login.refreshToken).toBeDefined();

    // Verify access JWT claims
    const verified = TokenManager.verifyAccessToken(login.accessToken!);
    expect(verified.valid).toBe(true);
    expect(verified.claims).toBeDefined();
    expect(verified.claims?.sub).toBe(login.operator?.id);
    expect(verified.claims?.code).toBe('OP-SMT-01');
    expect(verified.claims?.role).toBe(login.operator?.role);
    expect(verified.claims?.org).toBe(login.operator?.organizationId);
    expect(verified.claims?.site).toBe(login.operator?.siteId);
    expect(verified.claims?.iss).toBe('Antigravity-MES');
    expect(verified.claims?.aud).toBe('mes-api');
    expect(typeof verified.claims?.authzVersion).toBe('number');
  });

  it('rotates refresh token and issues new access JWT on valid refresh', async () => {
    const login = await AuthenticationService.loginWithPin('OP-SMT-01', '1234', '127.0.0.1');
    expect(login.success).toBe(true);

    const oldRefreshToken = login.refreshToken!;
    const refresh1 = await AuthenticationService.refreshSession(oldRefreshToken, '127.0.0.1');

    expect(refresh1.success).toBe(true);
    expect(refresh1.accessToken).toBeDefined();
    expect(refresh1.refreshToken).toBeDefined();
    expect(refresh1.refreshToken).not.toBe(oldRefreshToken);

    // New access token is valid
    const claims = TokenManager.verifyAccessToken(refresh1.accessToken!);
    expect(claims.valid).toBe(true);
  });

  it('detects refresh token reuse and revokes the entire token family (anti-theft)', async () => {
    const login = await AuthenticationService.loginWithPin('OP-SMT-01', '1234', '127.0.0.1');
    expect(login.success).toBe(true);
    const tokenA = login.refreshToken!;

    // Legitimate rotation: Token A -> Token B
    const rotation1 = await AuthenticationService.refreshSession(tokenA, '127.0.0.1');
    expect(rotation1.success).toBe(true);
    const tokenB = rotation1.refreshToken!;

    // Malicious attacker attempts to replay already-rotated Token A
    const replayAttempt = await AuthenticationService.refreshSession(tokenA, '192.168.1.100');
    expect(replayAttempt.success).toBe(false);
    expect(replayAttempt.error).toBe('TOKEN_REUSE_DETECTED');

    // Due to family revocation, even the legitimate latest Token B is now revoked
    const postReplayAttempt = await AuthenticationService.refreshSession(tokenB, '127.0.0.1');
    expect(postReplayAttempt.success).toBe(false);
    expect(postReplayAttempt.error).toBe('TOKEN_REUSE_DETECTED');
  });

  it('rejects refresh when operator authzVersion has been incremented', async () => {
    const login = await AuthenticationService.loginWithPin('OP-SMT-01', '1234', '127.0.0.1');
    expect(login.success).toBe(true);
    const db = getDatabase();

    // Bump operator's authz_version in database (simulating permission revocation or role update)
    await db.execute(
      `UPDATE operators SET authz_version = authz_version + 1 WHERE id = ?`,
      [login.operator!.id]
    );

    const refreshAttempt = await AuthenticationService.refreshSession(login.refreshToken!, '127.0.0.1');
    expect(refreshAttempt.success).toBe(false);
    expect(refreshAttempt.error).toBe('STALE_AUTHZ_VERSION');
  });

  it('allows manual revocation of active session family', async () => {
    const login = await AuthenticationService.loginWithPin('OP-SMT-01', '1234', '127.0.0.1');
    expect(login.success).toBe(true);
    const token = login.refreshToken!;

    const sessionInfo = await SessionManager.lookupToken(token);
    expect(sessionInfo).toBeDefined();

    await SessionManager.revokeFamily(sessionInfo!.familyId, 'USER_LOGOUT');

    const refreshAttempt = await AuthenticationService.refreshSession(token, '127.0.0.1');
    expect(refreshAttempt.success).toBe(false);
    expect(refreshAttempt.error).toBe('SESSION_REVOKED');
  });
});
