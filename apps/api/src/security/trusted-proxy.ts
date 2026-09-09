// apps/api/src/security/trusted-proxy.ts
import crypto from 'crypto';
import { Request } from 'express';

export class TrustedProxyResolver {
  private static readonly CORRELATION_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;

  /**
   * Resolves or generates a valid tracing correlation ID.
   * Preserves client X-Correlation-ID only if strictly alphanumeric/hyphen/underscore (8-64 chars).
   */
  public static resolveCorrelationId(rawHeader?: string | string[]): string {
    const candidate = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (candidate && this.CORRELATION_REGEX.test(candidate)) {
      return candidate;
    }
    return crypto.randomUUID();
  }

  /**
   * Generates a strict server-originated UUID v4 request ID.
   * Client-supplied request IDs are NEVER trusted for security attribution.
   */
  public static generateRequestId(): string {
    return crypto.randomUUID();
  }

  /**
   * Resolves client IP address respecting trusted reverse proxy boundaries.
   */
  public static resolveClientIp(req: Request): string {
    const trustedProxiesEnv = process.env.TRUSTED_PROXIES || '127.0.0.1,::1';
    const trustedList = trustedProxiesEnv.split(',').map(s => s.trim());

    const remoteAddress = req.socket?.remoteAddress || '127.0.0.1';
    const isDirectHopTrusted = trustedList.includes(remoteAddress) ||
      trustedList.includes('*') ||
      remoteAddress === '127.0.0.1' ||
      remoteAddress === '::1';

    if (isDirectHopTrusted && req.headers['x-forwarded-for']) {
      const forwarded = req.headers['x-forwarded-for'];
      const rawHeader = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      const ips = rawHeader.split(',').map(ip => ip.trim());
      if (ips.length > 0 && ips[0]) {
        return ips[0];
      }
    }

    return remoteAddress;
  }

  /**
   * Extracts client IP address respecting trusted reverse proxy boundaries.
   * Alias for resolveClientIp.
   */
  public static extractClientIp(req: Request): string {
    return this.resolveClientIp(req);
  }
}
