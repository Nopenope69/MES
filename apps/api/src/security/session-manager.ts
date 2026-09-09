// apps/api/src/security/session-manager.ts
import crypto from 'crypto';
import { getDatabase, IDatabase } from '../db/database';

export interface SessionTokenRecord {
  id: string;
  operatorId: string;
  tokenHash: string;
  familyId: string;
  revoked: boolean;
  revokedReason?: string;
  expiresAt: Date;
  createdAt: Date;
  createdByIp: string;
  authzVersion: number;
}

export interface SessionCreationResult {
  refreshToken: string;
  familyId: string;
  expiresAt: Date;
}

export interface SessionRotationResult {
  success: boolean;
  newRefreshToken?: string;
  operatorId?: string;
  authzVersion?: number;
  error?: string;
}

export class SessionManager {
  private static readonly REFRESH_EXPIRY_HOURS = 12;

  private static get db(): IDatabase {
    return getDatabase();
  }

  public static hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Generates a cryptographically strong 32-byte opaque refresh token,
   * stores its SHA-256 hash in a new session family.
   */
  public static async createSession(
    operatorId: string,
    authzVersion: number,
    ipAddress: string
  ): Promise<SessionCreationResult> {
    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const familyId = crypto.randomUUID();
    const id = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.REFRESH_EXPIRY_HOURS * 60 * 60 * 1000);

    await this.db.execute(
      `INSERT INTO refresh_tokens (
        id, operator_id, token_hash, family_id, revoked, revoked_reason, expires_at, created_at, created_by_ip, authz_version
      ) VALUES (?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)`,
      [
        id,
        operatorId,
        tokenHash,
        familyId,
        expiresAt.toISOString(),
        now.toISOString(),
        ipAddress,
        authzVersion
      ]
    );

    return {
      refreshToken: rawRefreshToken,
      familyId,
      expiresAt
    };
  }

  /**
   * Looks up a token record by hashing the raw token.
   */
  public static async lookupToken(rawToken: string): Promise<SessionTokenRecord | null> {
    const tokenHash = this.hashToken(rawToken);
    const rows = await this.db.query(
      `SELECT * FROM refresh_tokens WHERE token_hash = ?`,
      [tokenHash]
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      operatorId: row.operator_id,
      tokenHash: row.token_hash,
      familyId: row.family_id,
      revoked: Boolean(row.revoked),
      revokedReason: row.revoked_reason,
      expiresAt: new Date(row.expires_at),
      createdAt: new Date(row.created_at),
      createdByIp: row.created_by_ip,
      authzVersion: Number(row.authz_version)
    };
  }

  /**
   * Rotates a refresh token within a serialized transaction.
   * Enforces token reuse detection (revoking family on replay).
   */
  public static async rotateSession(
    oldRawToken: string,
    ipAddress: string
  ): Promise<SessionRotationResult> {
    const tokenHash = this.hashToken(oldRawToken);

    return await this.db.withTransaction(async (tx) => {
      const rows = await tx.query(
        `SELECT * FROM refresh_tokens WHERE token_hash = ?`,
        [tokenHash]
      );

      if (rows.length === 0) {
        return { success: false, error: 'INVALID_TOKEN' };
      }

      const current = rows[0];

      // Anti-theft invariant & revocation handling:
      if (Boolean(current.revoked)) {
        if (current.revoked_reason === 'ROTATED') {
          // An already-rotated token is being presented: active replay attack!
          // Invalidate the entire token family immediately to protect the compromised user.
          await tx.execute(
            `UPDATE refresh_tokens 
             SET revoked = 1, revoked_reason = 'FAMILY_REUSED_COMPROMISE' 
             WHERE family_id = ?`,
            [current.family_id]
          );
          return { success: false, error: 'TOKEN_REUSE_DETECTED' };
        }

        if (current.revoked_reason === 'FAMILY_REUSED_COMPROMISE') {
          return { success: false, error: 'TOKEN_REUSE_DETECTED' };
        }

        if (current.revoked_reason === 'USER_LOGOUT') {
          return { success: false, error: 'SESSION_REVOKED' };
        }

        if (current.revoked_reason === 'STALE_AUTHZ_VERSION') {
          return { success: false, error: 'STALE_AUTHZ_VERSION' };
        }

        if (current.revoked_reason === 'EXPIRED') {
          return { success: false, error: 'TOKEN_EXPIRED' };
        }

        return { success: false, error: 'SESSION_REVOKED' };
      }

      // Check if the token has expired
      const now = new Date();
      if (new Date(current.expires_at) <= now) {
        await tx.execute(
          `UPDATE refresh_tokens SET revoked = 1, revoked_reason = 'EXPIRED' WHERE id = ?`,
          [current.id]
        );
        return { success: false, error: 'TOKEN_EXPIRED' };
      }

      // Verify operator status and authzVersion
      const opRows = await tx.query(
        `SELECT id, status, authz_version FROM operators WHERE id = ?`,
        [current.operator_id]
      );

      if (opRows.length === 0 || opRows[0].status !== 'ACTIVE') {
        return { success: false, error: 'OPERATOR_INACTIVE' };
      }

      const operator = opRows[0];
      if (Number(operator.authz_version) !== Number(current.authz_version)) {
        await tx.execute(
          `UPDATE refresh_tokens SET revoked = 1, revoked_reason = 'STALE_AUTHZ_VERSION' WHERE family_id = ?`,
          [current.family_id]
        );
        return { success: false, error: 'STALE_AUTHZ_VERSION' };
      }

      // Mark current token as revoked with reason 'ROTATED'
      await tx.execute(
        `UPDATE refresh_tokens SET revoked = 1, revoked_reason = 'ROTATED' WHERE id = ?`,
        [current.id]
      );

      // Issue new token in the same lineage/family
      const newRawRefreshToken = crypto.randomBytes(32).toString('hex');
      const newTokenHash = this.hashToken(newRawRefreshToken);
      const newId = crypto.randomUUID();
      const newExpiresAt = new Date(now.getTime() + this.REFRESH_EXPIRY_HOURS * 60 * 60 * 1000);

      await tx.execute(
        `INSERT INTO refresh_tokens (
          id, operator_id, token_hash, family_id, revoked, revoked_reason, expires_at, created_at, created_by_ip, authz_version
        ) VALUES (?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)`,
        [
          newId,
          current.operator_id,
          newTokenHash,
          current.family_id,
          newExpiresAt.toISOString(),
          now.toISOString(),
          ipAddress,
          operator.authz_version
        ]
      );

      return {
        success: true,
        newRefreshToken: newRawRefreshToken,
        operatorId: current.operator_id,
        authzVersion: operator.authz_version
      };
    });
  }

  /**
   * Revokes all tokens in a session family (e.g. on explicit logout or theft detection).
   */
  public static async revokeFamily(familyId: string, reason = 'USER_LOGOUT'): Promise<void> {
    await this.db.execute(
      `UPDATE refresh_tokens SET revoked = 1, revoked_reason = ? WHERE family_id = ?`,
      [reason, familyId]
    );
  }

  /**
   * Revokes all tokens for an operator across all families.
   */
  public static async revokeAllForOperator(operatorId: string, reason = 'OPERATOR_REVOCATION'): Promise<void> {
    await this.db.execute(
      `UPDATE refresh_tokens SET revoked = 1, revoked_reason = ? WHERE operator_id = ?`,
      [reason, operatorId]
    );
  }
}
