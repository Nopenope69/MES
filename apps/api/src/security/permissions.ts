// apps/api/src/security/permissions.ts

export enum Permission {
  PRODUCTION_EXECUTE = 'PRODUCTION_EXECUTE',
  EQUIPMENT_MAINTAIN = 'EQUIPMENT_MAINTAIN',
  QUALITY_APPROVE = 'QUALITY_APPROVE',
  RECIPE_MANAGE = 'RECIPE_MANAGE',
  SYSTEM_MANAGE = 'SYSTEM_MANAGE',
  SECURITY_ADMIN = 'SECURITY_ADMIN',
  REPORTS_VIEW = 'REPORTS_VIEW',
  COMPLIANCE_SIGN = 'COMPLIANCE_SIGN'
}

export type Role =
  | 'OPERATOR'
  | 'SMT_SUPERVISOR'
  | 'QUALITY_INSPECTOR'
  | 'PROCESS_ENGINEER'
  | 'SYSTEM_ADMIN'
  | 'SUPERVISOR'
  | 'QA_DIRECTOR';

/**
 * Authoritative role-to-permission mapping for MES manufacturing execution.
 * Enforces non-delegable Segregation of Duties (SoD): SYSTEM_ADMIN is strictly
 * barred from quality approvals.
 */
export const ROLE_PERMISSIONS: Readonly<Record<string, ReadonlySet<Permission>>> = {
  OPERATOR: new Set([
    Permission.PRODUCTION_EXECUTE,
    Permission.REPORTS_VIEW
  ]),

  SMT_SUPERVISOR: new Set([
    Permission.PRODUCTION_EXECUTE,
    Permission.EQUIPMENT_MAINTAIN,
    Permission.RECIPE_MANAGE,
    Permission.REPORTS_VIEW
  ]),

  QUALITY_INSPECTOR: new Set([
    Permission.QUALITY_APPROVE,
    Permission.COMPLIANCE_SIGN,
    Permission.REPORTS_VIEW
  ]),

  PROCESS_ENGINEER: new Set([
    Permission.RECIPE_MANAGE,
    Permission.EQUIPMENT_MAINTAIN,
    Permission.REPORTS_VIEW
  ]),

  SYSTEM_ADMIN: new Set([
    Permission.SYSTEM_MANAGE,
    Permission.SECURITY_ADMIN,
    Permission.REPORTS_VIEW
  ]),

  // Aliases for backwards compatibility with existing fixtures/context
  SUPERVISOR: new Set([
    Permission.PRODUCTION_EXECUTE,
    Permission.EQUIPMENT_MAINTAIN,
    Permission.RECIPE_MANAGE,
    Permission.REPORTS_VIEW
  ]),

  QA_DIRECTOR: new Set([
    Permission.QUALITY_APPROVE,
    Permission.COMPLIANCE_SIGN,
    Permission.REPORTS_VIEW
  ])
};

/**
 * Checks if a given role possesses a specific permission.
 * Enforces hard non-delegable Segregation of Duties:
 * SYSTEM_ADMIN must NEVER have QUALITY_APPROVE.
 */
export function hasPermission(role: string, permission: Permission): boolean {
  // CRITICAL INVARIANT: Non-delegable Segregation of Duties (SoD)
  // SYSTEM_ADMIN must NEVER have QUALITY_APPROVE.
  if (role === 'SYSTEM_ADMIN' && permission === Permission.QUALITY_APPROVE) {
    return false;
  }

  const rolePerms = ROLE_PERMISSIONS[role];
  if (!rolePerms) {
    return false;
  }

  return rolePerms.has(permission);
}

/**
 * Returns all permissions granted to a role, guaranteed to filter out
 * QUALITY_APPROVE if the role is SYSTEM_ADMIN.
 */
export function getPermissionsForRole(role: string): Set<Permission> {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) {
    return new Set<Permission>();
  }

  const result = new Set<Permission>(perms);
  if (role === 'SYSTEM_ADMIN') {
    result.delete(Permission.QUALITY_APPROVE);
  }
  return result;
}
