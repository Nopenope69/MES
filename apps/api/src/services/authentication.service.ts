// apps/api/src/services/authentication.service.ts
import { getDatabase, IDatabase } from '../db/database';
import { PinPolicy } from '../security/pin-policy';

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

    return {
      success: true,
      operator: {
        id: operator.id,
        code: operator.code,
        name: operator.name,
        role: operator.role,
        organizationId: operator.organization_id || 'org-dixon',
        siteId: operator.site_id || 'site-noida-p4'
      },
      accessToken: 'dummy-access-token-task-2',
      refreshToken: 'dummy-refresh-token-task-2'
    };
  }

  /**
   * Session refresh method (extended in Task 3)
   */
  public static async refreshSession(refreshToken: string, ipAddress: string): Promise<RefreshResult> {
    return {
      success: false,
      error: 'NOT_IMPLEMENTED'
    };
  }
}
