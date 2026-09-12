import { Request, Response, NextFunction } from 'express';
import { SecretsConfigManager } from '../config/secrets';

/**
 * Enterprise HTTP Security Headers Middleware.
 * Applies OWASP recommended baseline defense-in-depth headers.
 */
export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://unpkg.com 'unsafe-inline'; style-src 'self' https://unpkg.com 'unsafe-inline'; img-src 'self' data:;"
  );
  next();
}

/**
 * High-performance sliding-window in-memory rate limiter.
 * Protects factory MES endpoints against credential brute forcing and denial of service.
 */
export class SimpleRateLimiter {
  private hits: Map<string, number[]> = new Map();

  constructor(
    private windowMs: number = 60000,
    private maxRequests: number = 100
  ) {}

  public middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const now = Date.now();

      let timestamps = this.hits.get(ip) || [];
      // Remove timestamps outside current window
      timestamps = timestamps.filter((t) => now - t < this.windowMs);

      if (timestamps.length >= this.maxRequests) {
        const oldest = timestamps[0];
        const resetSeconds = Math.ceil((oldest + this.windowMs - now) / 1000);
        res.setHeader('Retry-After', resetSeconds);
        res.setHeader('X-RateLimit-Limit', this.maxRequests);
        res.setHeader('X-RateLimit-Remaining', 0);
        res.status(429).json({
          error: 'TOO_MANY_REQUESTS',
          message: `Rate limit exceeded. Try again in ${resetSeconds} seconds.`,
          retryAfterSeconds: resetSeconds
        });
        return;
      }

      timestamps.push(now);
      this.hits.set(ip, timestamps);

      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, this.maxRequests - timestamps.length));

      next();
    };
  }

  public reset(): void {
    this.hits.clear();
  }
}

import crypto from 'node:crypto';

/**
 * Constant-time string comparison to prevent timing attack side channels.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Authentication middleware for privileged regulatory and SRE endpoints.
 * Validates 'X-API-Key' or 'Authorization: Bearer <key>'.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const config = SecretsConfigManager.loadConfig();
  const rawKey = req.headers['x-api-key'] || req.headers['authorization'];

  let token: string | undefined;
  if (typeof rawKey === 'string') {
    if (rawKey.startsWith('Bearer ')) {
      token = rawKey.substring(7).trim();
    } else {
      token = rawKey.trim();
    }
  }

  if (!token || !timingSafeCompare(token, config.apiKeySecret)) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Valid X-API-Key or Bearer token is required for privileged operations.'
    });
    return;
  }

  next();
}

