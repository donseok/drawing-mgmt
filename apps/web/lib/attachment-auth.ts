// R47 / FIND-003 — Attachment view gate.
//
// Centralizes the authentication + permission + virus-scan checks that the
// five attachment-serving routes (file, preview.dxf, preview.pdf, thumbnail,
// print) all need. Before R47 each route did `await auth().catch(() => null)`
// (effectively public) so any logged-out client could pull binary artifacts
// out of the system; the audit (FIND-003) flagged this as a P0 leak.
//
// Usage in a route handler:
//
//   const gate = await requireAttachmentView(req, ctx.params.id);
//   if (gate instanceof Response) return gate;     // 401/403/404
//   const { user, attachment, object } = gate;     // happy path
//
// Why a helper instead of middleware:
//   - The Edge runtime can't see Prisma. Folder permission resolution is a
//     Node-only operation (uses prisma + canAccess).
//   - The 5 routes have slightly different downstream behavior (placeholder
//     SVG fallback for thumbnails, range support for PDF, etc.) so we don't
//     try to centralize the response — only the gate.
//
// Fail-mode semantics:
//   - Missing/expired session            → 401 E_AUTH (NextResponse).
//   - Attachment id format invalid       → 400 (callers usually validate
//                                              the path-param shape on top).
//   - Attachment not found / wrong-tree  → 404 E_NOT_FOUND.
//   - User can't VIEW the parent folder  → 403 E_FORBIDDEN.
//   - Virus-scan status === INFECTED     → 403 (delegated to blockIfInfected).
//
// All other scan states (PENDING, SCANNING, CLEAN, SKIPPED, FAILED) fall
// through — same fail-open policy as the existing `blockIfInfected`.

import type { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  loadFolderPermissions,
  toPermissionUser,
} from '@/lib/permissions';
import { error, ErrorCode } from '@/lib/api-response';
import { blockIfInfected } from '@/lib/scan-guard';
import type { SessionUser } from '@/lib/auth-helpers';

export interface AttachmentLookup {
  id: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  versionId: string;
}

export interface AttachmentObject {
  id: string;
  folderId: string;
  ownerId: string;
  securityLevel: number;
}

export interface AttachmentViewGate {
  user: SessionUser;
  attachment: AttachmentLookup;
  object: AttachmentObject;
}

/**
 * Resolve the auth + permission + scan gate for an attachment-serving route.
 *
 * On success returns `{ user, attachment, object }`.
 * On any failure returns the precise NextResponse the caller should pass
 * straight through (so error envelopes are consistent project-wide).
 */
export async function requireAttachmentView(
  _req: Request,
  attachmentId: string,
): Promise<AttachmentViewGate | NextResponse> {
  // 1) Authenticated session — required.
  let user: SessionUser;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  // 2) Path-param sanity. Mirrors the existing per-route check.
  if (!/^[A-Za-z0-9_\-]+$/.test(attachmentId)) {
    return error(ErrorCode.E_NOT_FOUND);
  }

  // 3) Lookup attachment + walk Version → Revision → ObjectEntity so we
  //    have folderId / ownerId / securityLevel for the canAccess call.
  const attRow = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      storagePath: true,
      filename: true,
      mimeType: true,
      versionId: true,
      version: {
        select: {
          revision: {
            select: {
              object: {
                select: {
                  id: true,
                  folderId: true,
                  ownerId: true,
                  securityLevel: true,
                },
              },
            },
          },
        },
      },
    },
  });
  const obj = attRow?.version?.revision?.object ?? null;
  if (!attRow || !obj) {
    return error(ErrorCode.E_NOT_FOUND);
  }

  // 4) Virus-scan gate. Lift this *before* we leak permission status —
  //    INFECTED rows must never produce a "you can't view this" response
  //    that would let a probe distinguish "infected" from "no permission".
  const blocked = await blockIfInfected(attachmentId);
  if (blocked) return blocked;

  // 5) Folder permission. Admins skip the per-row check — canAccess()
  //    short-circuits SUPER_ADMIN/ADMIN at the top, but we still need a
  //    full Prisma User row for `toPermissionUser` (group memberships).
  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);
  const [pUser, perms] = await Promise.all([
    toPermissionUser(fullUser),
    loadFolderPermissions([obj.folderId]),
  ]);
  const decision = canAccess(pUser, obj, perms, 'VIEW');
  if (!decision.allowed) {
    return error(ErrorCode.E_FORBIDDEN, decision.reason);
  }

  return {
    user,
    attachment: {
      id: attRow.id,
      storagePath: attRow.storagePath,
      filename: attRow.filename,
      mimeType: attRow.mimeType,
      versionId: attRow.versionId,
    },
    object: obj,
  };
}
