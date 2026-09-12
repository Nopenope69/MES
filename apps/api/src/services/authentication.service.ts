// apps/api/src/services/authentication.service.ts
import { getDatabase, IDatabase } from '../db/database';
import { PinPolicy } from '../security/pin-policy';
import { TokenManager } from '../security/jwt';
import { SessionManager } from '../security/session-manager';

export interface LoginResult {
  success: boolean;
  operator?: {
    id: string;
    code: string;
    name: string;
    role: string;
    organizationId: string;
    siteId: string;
  };
  accessToken?: string;
  refreshToken?: string;
  error?: string;
  locked?: boolean;
}

export interface RefreshResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
}

export class AuthenticationService {
  private static get db(): IDatabase {
    return getDatabase();
  }

  /**
   * Authenticates an operator using their unique code and numeric/alphanumeric PIN.
   * Enforces anti-user-enumeration timing equality, atomic account lockout on 5 failures,
   * and Argon2id/Bcrypt hash verification.
   * Issues 15-minute access JWT and 12-hour rotating refresh session.
   */
  public static async loginWithPin(code: string, pin: string, ipAddress: string): Promise<LoginResult> {
    const rows = await this.db.query(
      `SELECT * FROM operators WHERE code = ?`,
      [code]
    );

    if (rows.length === 0) {
      await PinPolicy.verifyUnknownOperator(pin);
      return { success: false, error: 'INVALID_CREDENTIALS', locked: false };
    }

    const operator = rows[0];
    const now = new Date();

    // Check account lockout state
    if (operator.status === 'LOCKED') {
      if (operator.locked_until && new Date(operator.locked_until) > now) {
        return { success: false, error: 'ACCOUNT_LOCKED', locked: true };
      }
      // Lock has expired; restore account
      await this.db.execute(
        `UPDATE operators SET status = 'ACTIVE', failed_login_attempts = 0, locked_until = NULL WHERE id = ?`,
        [operator.id]
      );
      operator.status = 'ACTIVE';
      operator.failed_login_attempts = 0;
    }

    // Verify PIN against stored hash (or legacy plaintext during migration)
    const storedHash = operator.pin_hash || operator.pin;
    const isValid = await PinPolicy.verifyPin(pin, storedHash);

    if (!isValid) {
      const nextFailures = (operator.failed_login_attempts || 0) + 1;
      const isNowLocked = nextFailures >= 5;
      const lockUntil = isNowLocked ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;

      await this.db.execute(
        `UPDATE operators 
         SET failed_login_attempts = ?,
             status = CASE WHEN ? >= 5 THEN 'LOCKED' ELSE status END,
             locked_until = ?
         WHERE id = ?`,
        [nextFailures, nextFailures, lockUntil, operator.id]
      );

      if (isNowLocked) {
        return { success: false, error: 'ACCOUNT_LOCKED', locked: true };
      }
      return { success: false, error: 'INVALID_CREDENTIALS', locked: false };
    }

    // Authentication succeeded: reset failed attempts
    await this.db.execute(
      `UPDATE operators 
       SET failed_login_attempts = 0, 
           locked_until = NULL, 
           last_login_at = ? 
       WHERE id = ?`,
      [now.toISOString(), operator.id]
    );

    const authzVersion = Number(operator.authz_version || 1);
    const orgId = operator.organization_id || 'org-apex';
    const siteId = operator.site_id || 'site-noida-p4';

    // Issue rotating refresh session
    const session = await SessionManager.createSession(operator.id, authzVersion, ipAddress);

    // Issue short-lived 15-minute access JWT
    const accessToken = TokenManager.generateAccessToken({
      sub: operator.id,
      code: operator.code,
      name: operator.name,
      role: operator.role,
      org: orgId,
      site: siteId,
      authzVersion
    });

    return {
      success: true,
      operator: {
        id: operator.id,
        code: operator.code,
        name: operator.name,
        role: operator.role,
        organizationId: orgId,
        siteId: siteId
      },
      accessToken,
      refreshToken: session.refreshToken
    };
  }

  /**
   * Rotates refresh session and issues new 15-minute access JWT.
   * Enforces token reuse detection (revoking family on replay) and authzVersion freshness.
   */
  public static async refreshSession(refreshToken: string, ipAddress: string): Promise<RefreshResult> {
    const rotation = await SessionManager.rotateSession(refreshToken, ipAddress);

    if (!rotation.success) {
      return {
        success: false,
        error: rotation.error
      };
    }

    // Fetch fresh operator profile
    const rows = await this.db.query(
      `SELECT * FROM operators WHERE id = ?`,
      [rotation.operatorId]
    );

    if (rows.length === 0) {
      return {
        success: false,
        error: 'OPERATOR_NOT_FOUND'
      };
    }

    const operator = rows[0];
    const orgId = operator.organization_id || 'org-apex';
    const siteId = operator.site_id || 'site-noida-p4';

    // Issue new access JWT
    const accessToken = TokenManager.generateAccessToken({
      sub: operator.id,
      code: operator.code,
      name: operator.name,
      role: operator.role,
      org: orgId,
      site: siteId,
      authzVersion: rotation.authzVersion!
    });

    return {
      success: true,
      accessToken,
      refreshToken: rotation.newRefreshToken
    };
  }
}
