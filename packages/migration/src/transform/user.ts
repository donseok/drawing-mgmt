// User mapping: TeamPlusUser → TargetUser.
//
// The placeholder password hash is the bcrypt of a constant marker string
// — the loader stamps the same hash on every migrated user and the FE
// forces a reset on first login. We deliberately don't import bcrypt here
// (keeps the transform module pure / dep-free); the loader is responsible
// for stamping.

import type { TeamPlusUser } from '../source/types.js';
import type { TargetUser } from '../target/types.js';
import {
  clampSecurityLevel,
  mapEmploymentType,
  mapRole,
} from './helpers.js';

/**
 * Sentinel passed through from the transform to the loader. The loader
 * replaces it with an actual bcrypt hash before insert. We do this in
 * two steps so the transform stays synchronous and dep-free.
 */
export const PASSWORD_PLACEHOLDER_SENTINEL = '__MIGRATION_RESET_REQUIRED__';

export function transformUser(
  src: TeamPlusUser,
  organizationIdMap: ReadonlyMap<string, string>,
): TargetUser {
  const orgId = src.organizationExternalId
    ? organizationIdMap.get(src.organizationExternalId) ?? null
    : null;

  return {
    externalId: src.externalId,
    username: src.username,
    fullName: src.fullName,
    email: src.email,
    organizationId: orgId,
    role: mapRole(src.roleHint),
    employmentType: mapEmploymentType(src.active, src.roleHint),
    // TeamPlus-side security level is not exposed in our `TeamPlusUser`
    // shape today (running as a user-level concept rather than per-row).
    // Once the real adapter brings it in, replace the constant with
    // `clampSecurityLevel(src.securityLevel)` and add a unit test.
    securityLevel: clampSecurityLevel(5),
    passwordHashPlaceholder: PASSWORD_PLACEHOLDER_SENTINEL,
  };
}
