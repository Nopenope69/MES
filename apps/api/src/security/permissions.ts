// apps/api/src/security/permissions.ts

export enum Permission {
  PRODUCTION_EXECUTE = 'PRODUCTION_EXECUTE',
  EQUIPMENT_MAINTAIN = 'EQUIPMENT_MAINTAIN',
  QUALITY_APPROVE = 'QUALITY_APPROVE',
  RECIPE_MANAGE = 'RECIPE_MANAGE',
  SYSTEM_MANAGE = 'SYSTEM_MANAGE',
  SECURITY_ADMIN = 'SECURITY_ADMIN',
  REPORTS_VIEW = 'REPORTS_VIEW',
  COMPLIANCE_SIGN = 'COMPLIANCE_SIGN',
  HOLD_ACKNOWLEDGE = 'HOLD_ACKNOWLEDGE'
}

export type Role =
  | 'OPERATOR'
  | 'MAINTENANCE'
  | 'QUALITY_LEAD'
  | 'LINE_LEAD'
  | 'SYSTEM_ADMIN'
  | 'SMT_SUPERVISOR'
  | 'QUALITY_INSPECTOR'
  | 'PROCESS_ENGINEER'
  | 'SUPERVISOR'
  | 'QA_DIRECTOR';

/**
 * Authoritative role-to-permission mapping for MES manufacturing execution.
 * Enforces non-delegable Segregation of Duties (SoD): SYSTEM_ADMIN is strictly
 * barred from quality approvals.
 */
export const ROLE_PERMISSIONS: Readonly<Record<string, ReadonlySet<Permission>>> = {
  // Canonical 5 Roles
  OPERATOR: new Set([
    Permission.PRODUCTION_EXECUTE,
    Permission.COMPLIANCE_SIGN,
    Permission.REPORTS_VIEW
  ]),

  MAINTENANCE: new Set([
    Permission.EQUIPMENT_MAINTAIN,
    Permission.COMPLIANCE_SIGN,
    Permission.REPORTS_VIEW
  ]),

  QUALITY_LEAD: new Set([
    Permission.QUALITY_APPROVE,
    Permission.COMPLIANCE_SIGN,
    Permission.REPORTS_VIEW,
    Permission.HOLD_ACKNOWLEDGE
  ]),

  LINE_LEAD: new Set([
    Permission.PRODUCTION_EXECUTE,
    Permission.EQUIPMENT_MAINTAIN,
    Permission.RECIPE_MANAGE,
    Permission.COMPLIANCE_SIGN,
    Permission.REPORTS_VIEW,
    Permission.HOLD_ACKNOWLEDGE
  ]),

  SYSTEM_ADMIN: new Set([
    Permission.SYSTEM_MANAGE,
    Permission.SECURITY_ADMIN,
    Permission.REPORTS_VIEW,
    Permission.PRODUCTION_EXECUTE,
    Permission.EQUIPMENT_MAINTAIN,
    Permission.RECIPE_MANAGE,
    Permission.COMPLIANCE_SIGN
  ]),

  // Aliases for backwards compatibility with existing fixtures/context
  SMT_SUPERVISOR: new Set([
    Permission.PRODUCTION_EXECUTE,
    Permission.EQUIPMENT_MAINTAIN,
    Permission.RECIPE_MANAGE,
    Permission.REPORTS_VIEW,
    Permission.HOLD_ACKNOWLEDGE
  ]),

  SUPERVISOR: new Set([
    Permission.PRODUCTION_EXECUTE,
    Permission.EQUIPMENT_MAINTAIN,
    Permission.RECIPE_MANAGE,
    Permission.REPORTS_VIEW,
    Permission.HOLD_ACKNOWLEDGE
  ]),

  QUALITY_INSPECTOR: new Set([
    Permission.QUALITY_APPROVE,
    Permission.COMPLIANCE_SIGN,
    Permission.REPORTS_VIEW,
    Permission.HOLD_ACKNOWLEDGE
  ]),

  QA_DIRECTOR: new Set([
    Permission.QUALITY_APPROVE,
    Permission.COMPLIANCE_SIGN,
    Permission.REPORTS_VIEW,
    Permission.HOLD_ACKNOWLEDGE
  ]),

  PROCESS_ENGINEER: new Set([
    Permission.RECIPE_MANAGE,
    Permission.EQUIPMENT_MAINTAIN,
    Permission.REPORTS_VIEW
  ])
};

/**
 * Checks if a given role possesses a specific permission.
 * Enforces hard non-delegable Segregation of Duties:
 * SYSTEM_ADMIN must NEVER have QUALITY_APPROVE or HOLD_ACKNOWLEDGE.
 */
export function hasPermission(role: string, permission: Permission): boolean {
  // CRITICAL INVARIANT: Non-delegable Segregation of Duties (SoD)
  // SYSTEM_ADMIN must NEVER have QUALITY_APPROVE or HOLD_ACKNOWLEDGE.
  if (role === 'SYSTEM_ADMIN' && (permission === Permission.QUALITY_APPROVE || permission === Permission.HOLD_ACKNOWLEDGE)) {
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
 * QUALITY_APPROVE and HOLD_ACKNOWLEDGE if the role is SYSTEM_ADMIN.
 */
export function getPermissionsForRole(role: string): Set<Permission> {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) {
    return new Set<Permission>();
  }

  const result = new Set<Permission>(perms);
  if (role === 'SYSTEM_ADMIN') {
    result.delete(Permission.QUALITY_APPROVE);
    result.delete(Permission.HOLD_ACKNOWLEDGE);
  }
  return result;
}
