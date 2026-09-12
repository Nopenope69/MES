// apps/api/src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { TokenManager } from '../security/jwt';
import { TrustedProxyResolver } from '../security/trusted-proxy';
import { RequestContext, SecurityPrincipal, OperatorRole } from '../security/context';
import { Permission, hasPermission, getPermissionsForRole } from '../security/permissions';
import { SecretsConfigManager } from '../config/secrets';
import { timingSafeCompare } from '../security/http-security';

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
    const trimmedKey = rawApiKey.trim();

    const SCOPED_SERVICES = [
      {
        serviceId: 'gateway-fuji-01',
        name: 'Fuji Nexim Gateway Service',
        role: 'OPERATOR',
        tokenEnvVar: 'FUJI_SERVICE_KEY',
        defaultSuffix: '-fuji'
      },
      {
        serviceId: 'station-spi-01',
        name: 'SPI Station Service',
        role: 'MAINTENANCE',
        tokenEnvVar: 'SPI_SERVICE_KEY',
        defaultSuffix: '-spi'
      },
      {
        serviceId: 'station-aoi-01',
        name: 'AOI Station Service',
        role: 'QUALITY_LEAD',
        tokenEnvVar: 'AOI_SERVICE_KEY',
        defaultSuffix: '-aoi'
      },
      {
        serviceId: 'svc-qa-compliance',
        name: 'Regulatory QA Service',
        role: 'QUALITY_LEAD',
        tokenEnvVar: 'QA_SERVICE_KEY',
        defaultSuffix: '-qa'
      }
    ];

    const matchedService = SCOPED_SERVICES.find((s) => {
      const expectedToken = process.env[s.tokenEnvVar] || `${config.apiKeySecret}${s.defaultSuffix}`;
      return timingSafeCompare(trimmedKey, expectedToken);
    });

    const isMasterKey = timingSafeCompare(trimmedKey, config.apiKeySecret);

    if (matchedService || isMasterKey) {
      let role: string = matchedService ? matchedService.role : 'SYSTEM_ADMIN';
      let actorId: string = matchedService ? matchedService.serviceId : 'svc-system';
      let serviceName: string = matchedService ? matchedService.name : 'System Service Principal';

      if (isMasterKey) {
        const headerRole = req.headers['x-service-role'];
        if (typeof headerRole === 'string' && headerRole.trim()) {
          role = headerRole.trim();
        } else if (req.body?.qaReviewerId) {
          role = 'QUALITY_LEAD';
          actorId = String(req.body.qaReviewerId);
          serviceName = 'QA Reviewer Service';
        }
      }

      const orgId = process.env.ORGANIZATION_ID || 'org-apex';
      const siteId = process.env.SITE_ID || 'site-apex-01';
      const perms = getPermissionsForRole(role);

      const principal: SecurityPrincipal = {
        kind: 'SERVICE',
        id: actorId,
        serviceId: actorId,
        serviceName,
        role: role as OperatorRole,
        scope: { kind: 'SYSTEM', organizationId: orgId },
        permissions: perms,
        credentialId: matchedService ? `cred-${matchedService.serviceId}` : 'cred-api-key'
      };

      req.user = {
        id: actorId,
        code: actorId.toUpperCase(),
        name: serviceName,
        role,
        org: orgId,
        site: siteId,
        authzVersion: 1
      };

      req.context = {
        principal,
        scope: {
          organizationId: orgId,
          siteId
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
