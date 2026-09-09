// apps/api/src/security/jwt.ts
import jwt from 'jsonwebtoken';

export interface AccessTokenClaims {
  sub: string;
  code: string;
  name: string;
  role: string;
  org: string;
  site: string;
  authzVersion: number;
  iss: string;
  aud: string;
  iat?: number;
  exp?: number;
}

export interface VerifyTokenResult {
  valid: boolean;
  claims?: AccessTokenClaims;
  error?: string;
}

export class TokenManager {
  private static get secret(): string {
    return process.env.JWT_SECRET || 'antigravity-mes-enterprise-secret-key-4096';
  }

  private static readonly ISSUER = 'Antigravity-MES';
  private static readonly AUDIENCE = 'mes-api';
  private static readonly EXPIRATION = '15m'; // 15 minutes strict

  /**
   * Generates a short-lived (15-min) signed JWT access token
   */
  public static generateAccessToken(payload: Omit<AccessTokenClaims, 'iss' | 'aud' | 'iat' | 'exp'>): string {
    return jwt.sign(
      {
        sub: payload.sub,
        code: payload.code,
        name: payload.name,
        role: payload.role,
        org: payload.org,
        site: payload.site,
        authzVersion: payload.authzVersion
      },
      this.secret,
      {
        issuer: this.ISSUER,
        audience: this.AUDIENCE,
        expiresIn: this.EXPIRATION
      }
    );
  }

  /**
   * Verifies and decodes an access token
   */
  public static verifyAccessToken(token: string): VerifyTokenResult {
    try {
      const decoded = jwt.verify(token, this.secret, {
        issuer: this.ISSUER,
        audience: this.AUDIENCE
      }) as AccessTokenClaims;

      return {
        valid: true,
        claims: decoded
      };
    } catch (err: any) {
      return {
        valid: false,
        error: err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
      };
    }
  }
}
