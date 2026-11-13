/**
 * Entra directory role checks for the signed-in user.
 *
 * Roles come from the `wids` claim of the verified sign-in token (role
 * template ids). When the claim is absent we ask Graph once and fail closed
 * if that does not give a clear answer.
 */

import type { TokenUserInfo } from '@/lib/auth-utils';

/** Built-in role template ids, identical in every tenant. */
export const GLOBAL_ADMINISTRATOR_ROLE = '62e90394-69f5-4237-9190-012177145e10';
export const PRIVILEGED_ROLE_ADMINISTRATOR_ROLE = 'e8611ab8-c189-46e8-94e1-60213ab1f814';
export const INTUNE_ADMINISTRATOR_ROLE = '3a2c62db-5318-420d-8d74-23affee5d9d5';

/**
 * Roles that may hand Intune app management of their tenant to an MSP.
 * Global and Privileged Role Administrators can grant the app its
 * permissions in the first place; the Intune Administrator owns everything
 * the link lets an MSP do.
 */
export const TENANT_APPROVER_ROLES: ReadonlySet<string> = new Set([
  GLOBAL_ADMINISTRATOR_ROLE,
  PRIVILEGED_ROLE_ADMINISTRATOR_ROLE,
  INTUNE_ADMINISTRATOR_ROLE,
]);

export const TENANT_APPROVER_ROLE_NAMES = [
  'Global Administrator',
  'Privileged Role Administrator',
  'Intune Administrator',
] as const;

/**
 * The caller's directory role template ids, or null when they cannot be
 * determined. Null must be treated as "not allowed", never as "no roles".
 */
export async function resolveDirectoryRoles(
  user: TokenUserInfo,
  authHeader: string | null
): Promise<string[] | null> {
  if (user.directoryRoles !== undefined) {
    return user.directoryRoles;
  }

  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  try {
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/me/memberOf/microsoft.graph.directoryRole?$select=id,roleTemplateId&$top=100',
      { headers: { Authorization: authHeader } }
    );
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as { value?: Array<{ roleTemplateId?: unknown }> };
    if (!Array.isArray(body.value)) {
      return null;
    }

    const roles: string[] = [];
    for (const entry of body.value) {
      // Without directory read permission Graph returns only the object id.
      // An entry we cannot identify makes the whole answer unknown.
      if (typeof entry.roleTemplateId !== 'string') {
        return null;
      }
      roles.push(entry.roleTemplateId.toLowerCase());
    }
    return roles;
  } catch {
    return null;
  }
}

export function hasAnyDirectoryRole(roles: readonly string[], allowed: ReadonlySet<string>): boolean {
  return roles.some((role) => allowed.has(role.toLowerCase()));
}
