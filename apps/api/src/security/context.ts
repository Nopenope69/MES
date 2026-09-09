// apps/api/src/security/context.ts

export type OperatorRole =
  | 'OPERATOR'
  | 'SUPERVISOR'
  | 'PROCESS_ENGINEER'
  | 'QA_DIRECTOR'
  | 'SYSTEM_ADMIN';

export type ServiceScope =
  | { readonly kind: 'SITE'; readonly organizationId: string; readonly siteId: string }
  | { readonly kind: 'ORGANIZATION'; readonly organizationId: string }
  | { readonly kind: 'SYSTEM'; readonly organizationId: string };

export type SecurityPrincipal =
  | {
      readonly kind: 'HUMAN';
      readonly id: string;
      readonly operatorId: string;
      readonly operatorCode: string;
      readonly role: OperatorRole;
      readonly permissions: ReadonlySet<string>;
      readonly organizationId: string;
      readonly siteId: string;
      readonly sessionId: string;
    }
  | {
      readonly kind: 'SERVICE';
      readonly id: string;
      readonly serviceId: string;
      readonly serviceName: string;
      readonly role?: OperatorRole;
      readonly scope: ServiceScope;
      readonly permissions: ReadonlySet<string>;
      readonly credentialId: string;
    };

export interface RequestContext {
  readonly principal: SecurityPrincipal;
  readonly scope?: { readonly organizationId: string; readonly siteId: string };
  readonly correlationId: string;
  readonly requestId: string;
  readonly ipAddress: string;
}

export interface ServiceContext {
  readonly principal: Extract<SecurityPrincipal, { kind: 'SERVICE' }>;
  readonly correlationId: string;
  readonly taskId: string;
  readonly jobName: string;
}

export type ExecutionContext = RequestContext | ServiceContext;

export class SecurityContextMissingError extends Error {
  constructor(message: string = 'SecurityContext is missing or invalid') {
    super(message);
    this.name = 'SecurityContextMissingError';
    Object.setPrototypeOf(this, SecurityContextMissingError.prototype);
  }
}

export function isHumanPrincipal(principal: SecurityPrincipal): principal is Extract<SecurityPrincipal, { kind: 'HUMAN' }> {
  return principal?.kind === 'HUMAN';
}

export function isServicePrincipal(principal: SecurityPrincipal): principal is Extract<SecurityPrincipal, { kind: 'SERVICE' }> {
  return principal?.kind === 'SERVICE';
}

export function getPrincipalOrganizationId(principal: SecurityPrincipal): string {
  if (!principal) {
    throw new SecurityContextMissingError('Principal is missing');
  }
  if (isHumanPrincipal(principal)) {
    return principal.organizationId;
  }
  return principal.scope.organizationId;
}

export function getPrincipalSiteId(principal: SecurityPrincipal): string | null {
  if (!principal) {
    throw new SecurityContextMissingError('Principal is missing');
  }
  if (isHumanPrincipal(principal)) {
    return principal.siteId;
  }
  if (principal.scope.kind === 'SITE') {
    return principal.scope.siteId;
  }
  return null;
}
