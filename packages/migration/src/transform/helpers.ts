// Cross-cutting transform utilities.
//
// Split out so the per-entity transform modules stay focused on field
// mapping and don't reimplement the same logic five times.

/**
 * Map TeamPlus role hint strings to the drawing-mgmt Role enum.
 *
 * TeamPlus uses a free-form role string (DESIGNER / VIEWER / ADMIN /
 * PARTNER / 협력업체 / 슈퍼관리자 …) and there's no clean 1:1 mapping. The
 * defaults here mirror the PRD's permission matrix:
 *   - 슈퍼관리자 / SUPER → SUPER_ADMIN
 *   - 관리자 / ADMIN     → ADMIN
 *   - 협력업체 / PARTNER → PARTNER
 *   - everything else    → USER (covers DESIGNER + VIEWER, role gating
 *                                  inside drawing-mgmt is per-folder)
 *
 * When the real adapter lands, expand this with whatever vocabulary
 * TeamPlus actually has in production — the test suite will catch the
 * fallback-to-USER lazy default.
 */
export function mapRole(
  hint: string,
): 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'PARTNER' {
  const upper = hint.trim().toUpperCase();
  if (upper === 'SUPER_ADMIN' || upper === '슈퍼관리자' || upper === 'SUPER') {
    return 'SUPER_ADMIN';
  }
  if (upper === 'ADMIN' || upper === '관리자') return 'ADMIN';
  if (upper === 'PARTNER' || upper === '협력업체' || upper === 'VENDOR') {
    return 'PARTNER';
  }
  return 'USER';
}

/**
 * EmploymentType is split between an `active` boolean and the role hint:
 *   active=false               → RETIRED
 *   role hint smells like vendor → PARTNER
 *   else                        → ACTIVE
 */
export function mapEmploymentType(
  active: boolean,
  roleHint: string,
): 'ACTIVE' | 'RETIRED' | 'PARTNER' {
  if (!active) return 'RETIRED';
  if (mapRole(roleHint) === 'PARTNER') return 'PARTNER';
  return 'ACTIVE';
}

/**
 * Map TeamPlus state hints into the ObjectState enum. CHECKED_OUT isn't
 * migrated — anything mid-checkout in TeamPlus becomes CHECKED_IN
 * (workflow contract: post-migration users finish their work in the new
 * system from the last committed version).
 */
export function mapObjectState(
  hint: string,
): 'NEW' | 'CHECKED_OUT' | 'CHECKED_IN' | 'IN_APPROVAL' | 'APPROVED' {
  const upper = hint.trim().toUpperCase();
  if (upper === 'NEW' || upper === 'DRAFT') return 'NEW';
  if (upper === 'IN_APPROVAL' || upper === 'PENDING') return 'IN_APPROVAL';
  if (upper === 'APPROVED' || upper === '승인완료') return 'APPROVED';
  // Including CHECKED_OUT here: we deliberately collapse it.
  return 'CHECKED_IN';
}

/**
 * folderCode normalisation. drawing-mgmt requires Folder.folderCode to be
 * unique system-wide, while TeamPlus's pathCode can collide across
 * detached subtrees if names are reused. We hash a short suffix in for
 * collisions; callers register the chosen code in a Map<pathCode,
 * folderCode> so re-runs stay deterministic.
 */
export function normalizeFolderCode(pathCode: string): string {
  return pathCode
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_/-]/g, '')
    .toUpperCase();
}

/**
 * Lazy clamp for SecurityLevel (drawing-mgmt expects 1-5; legacy data
 * sometimes has 0 or 9).
 */
export function clampSecurityLevel(level: number): number {
  if (!Number.isFinite(level)) return 5;
  if (level < 1) return 1;
  if (level > 5) return 5;
  return Math.round(level);
}
