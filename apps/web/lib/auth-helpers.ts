// Server-side auth helpers used by API route handlers and RSC.
//
// `getCurrentUser()` returns the full Prisma User (no passwordHash) — useful
// when you need fields not on the JWT (e.g. signatureFile).
//
// `requireUser()` is the route-handler variant: throws a Response on 401 so
// callers can `return await requireUser(req)` once at the top.

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { error, ErrorCode } from '@/lib/api-response';
import type { User } from '@prisma/client';

export type SessionUser = Omit<User, 'passwordHash'>;

/**
 * Returns the current user (without passwordHash) if logged in, else null.
 * Use in RSC where you'd handle the null case yourself.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) return null;

  // Strip the password hash defensively.
  const { passwordHash: _omit, ...rest } = user;
  return rest;
}

/**
 * Same as getCurrentUser, but throws a Response (401) when unauthenticated.
 * Use in route handlers:
 *
 *   const user = await requireUser();   // returns SessionUser or throws
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw error(ErrorCode.E_AUTH);
  return user;
}

/**
 * Lightweight session check (no DB hit). Use when you only need claims on
 * the JWT (id, role, securityLevel, organizationId).
 */
export async function getSessionClaims() {
  const session = await auth();
  return session?.user ?? null;
}
