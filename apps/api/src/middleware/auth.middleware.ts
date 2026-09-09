// apps/api/src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { TokenManager } from '../security/jwt';
import { TrustedProxyResolver } from '../security/trusted-proxy';
import { RequestContext, SecurityPrincipal, OperatorRole } from '../security/context';
import { Permission, hasPermission, getPermissionsForRole } from '../security/permissions';
import { SecretsConfigManager } from '../config/secrets';

export interface AuthenticatedUser {
  id: string;
  code: string;
  name: string;
  role: string;
  org: string;
  site: string;
  authzVersion: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      context?: RequestContext;
    }
  }
}

/**
 * Authentication Middleware:
 * - Extracts Bearer token from Authorization header (or validates X-API-Key for service integration)
 * - Verifies token validity and expiration via TokenManager
 * - Resolves client IP via TrustedProxyResolver.extractClientIp
 * - Injects principal RequestContext and req.user for downstream handlers
 * - Rejects unauthenticated/invalid calls with 401 Unauthorized
 */
export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const ipAddress = TrustedProxyResolver.extractClientIp(req);

  // 1. Check Bearer Token
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    const verification = TokenManager.verifyAccessToken(token);

    if (!verification.valid || !verification.claims) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: verification.error === 'TOKEN_EXPIRED' ? 'Token expired' : 'Invalid token'
      });
      return;
    }

    const claims = verification.claims;
    const userRole = claims.role;
    const perms = getPermissionsForRole(userRole);

    const principal: SecurityPrincipal = {
      kind: 'HUMAN',
      id: claims.sub,
      operatorId: claims.sub,
      operatorCode: claims.code,
      role: claims.role as OperatorRole,
      permissions: perms,
      organizationId: claims.org,
      siteId: claims.site,
      sessionId: claims.sub
    };

    req.user = {
      id: claims.sub,
      code: claims.code,
      name: claims.name,
      role: claims.role,
      org: claims.org,
      site: claims.site,
      authzVersion: claims.authzVersion
    };

    req.context = {
      principal,
      scope: {
        organizationId: claims.org,
        siteId: claims.site
      },
      correlationId: TrustedProxyResolver.resolveCorrelationId(req.headers['x-correlation-id']),
      requestId: TrustedProxyResolver.generateRequestId(),
      ipAddress
    };

    return next();
  }

  // 2. Check X-API-Key fallback for regulatory / machine service endpoints
  const rawApiKey = req.headers['x-api-key'];
  if (rawApiKey && typeof rawApiKey === 'string') {
    const config = SecretsConfigManager.loadConfig();
    if (rawApiKey.trim() === config.apiKeySecret) {
      const perms = getPermissionsForRole('SYSTEM_ADMIN');
      const principal: SecurityPrincipal = {
        kind: 'SERVICE',
        id: 'svc-system',
        serviceId: 'svc-system',
        serviceName: 'System Service Principal',
        role: 'SYSTEM_ADMIN' as OperatorRole,
        scope: { kind: 'SYSTEM', organizationId: 'org-dixon' },
        permissions: perms,
        credentialId: 'cred-api-key'
      };

      req.user = {
        id: 'svc-system',
        code: 'SVC-ADMIN',
        name: 'Service Principal',
        role: 'SYSTEM_ADMIN',
        org: 'org-dixon',
        site: 'site-noida-p4',
        authzVersion: 1
      };

      req.context = {
        principal,
        scope: {
          organizationId: 'org-dixon',
          siteId: 'site-noida-p4'
        },
        correlationId: TrustedProxyResolver.resolveCorrelationId(req.headers['x-correlation-id']),
        requestId: TrustedProxyResolver.generateRequestId(),
        ipAddress
      };

      return next();
    } else {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid API key'
      });
      return;
    }
  }

  // 3. No credentials supplied
  res.status(401).json({
    error: 'UNAUTHORIZED',
    message: 'Bearer token or authorized API key is required'
  });
}

/**
 * Capability-Based Authorization Guard:
 * - Verifies caller has the required Permission
 * - Enforces hard non-delegable Segregation of Duties:
 *   SYSTEM_ADMIN is strictly prohibited from QUALITY_APPROVE
 * - Returns 403 Forbidden on failure
 */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required'
      });
      return;
    }

    // CRITICAL INVARIANT: Non-delegable Segregation of Duties (SoD)
    // SYSTEM_ADMIN must NEVER perform quality approvals (reflow profile approvals, batch releases)
    if (req.user.role === 'SYSTEM_ADMIN' && permission === Permission.QUALITY_APPROVE) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Segregation of duties violation: SYSTEM_ADMIN cannot perform quality approvals'
      });
      return;
    }

    if (!hasPermission(req.user.role, permission)) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: `Insufficient permissions: requires ${permission}`
      });
      return;
    }

    next();
  };
}

/**
 * Role Membership Guard:
 * - Verifies caller belongs to at least one of the specified roles
 * - Returns 403 Forbidden on failure
 */
export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required'
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: `Insufficient role: requires one of [${roles.join(', ')}]`
      });
      return;
    }

    next();
  };
}
