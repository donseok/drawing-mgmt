// Inline first-call demo seeders for the new domain APIs (BUG-003 / BUG-004).
//
// Each function is **idempotent**: it bails out the moment it sees any row in
// the relevant table, so calling it on every request is cheap and safe. The
// seeded payloads are deliberately small (3-5 rows) and reuse the entities
// already created by `prisma/seed.ts` (obj-1..obj-5, admin/manager/kim/park/lee
// users, etc.). No new tables, no schema changes — pure data fixtures.
//
// Owned by BE-2.

import { ApprovalStatus, LobbyStatus, StepStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';

let approvalSeedChecked = false;
let lobbySeedChecked = false;

/**
 * Insert a tiny set of Approval / ApprovalStep rows the first time the
 * approvals API is hit. Re-runs are O(1) (one count query, then early return).
 */
export async function ensureApprovalDemoSeed(): Promise<void> {
  if (approvalSeedChecked) return;
  const existing = await prisma.approval.count();
  if (existing > 0) {
    approvalSeedChecked = true;
    return;
  }

  // Verify that the seed users + revisions we need actually exist.
  // If `prisma db seed` has not been run yet, we silently skip.
  const [admin, manager, kim, park, lee] = await Promise.all([
    prisma.user.findUnique({ where: { username: 'admin' } }),
    prisma.user.findUnique({ where: { username: 'manager' } }),
    prisma.user.findUnique({ where: { username: 'kim' } }),
    prisma.user.findUnique({ where: { username: 'park' } }),
    prisma.user.findUnique({ where: { username: 'lee' } }),
  ]);
  if (!admin || !manager || !kim || !park || !lee) {
    approvalSeedChecked = true;
    return;
  }

  // We attach approvals to existing Revisions from seed.ts (rev-{n}-r{rev}).
  const revisions = await prisma.revision.findMany({
    where: {
      id: { in: ['rev-1-r1', 'rev-2-r1', 'rev-3-r1', 'rev-5-r1'] },
    },
    select: { id: true, objectId: true },
  });
  const revById = new Map(revisions.map((r) => [r.id, r] as const));
  if (revById.size < 4) {
    // Object seed not present yet — defer, will retry on next request.
    return;
  }

  type DemoApproval = {
    id: string;
    revisionId: string;
    title: string;
    requesterId: string;
    status: ApprovalStatus;
    completedAt: Date | null;
    steps: Array<{
      order: number;
      approverId: string;
      status: StepStatus;
      comment?: string;
      actedAt?: Date | null;
    }>;
  };

  const now = new Date();
  const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  const demos: DemoApproval[] = [
    // 1) waiting — manager is the active step approver
    {
      id: 'apr-demo-1',
      revisionId: 'rev-1-r1',
      title: 'CGL #1 라인 펌프 설치도 R1 결재',
      requesterId: kim.id,
      status: ApprovalStatus.PENDING,
      completedAt: null,
      steps: [
        { order: 1, approverId: manager.id, status: StepStatus.PENDING },
        { order: 2, approverId: admin.id, status: StepStatus.PENDING },
      ],
    },
    // 2) waiting — admin already approved, manager is up next (also a
    //    "done" entry for admin)
    {
      id: 'apr-demo-2',
      revisionId: 'rev-3-r1',
      title: 'CGL #1 메인 배전반 결선도 R1 결재',
      requesterId: park.id,
      status: ApprovalStatus.PENDING,
      completedAt: null,
      steps: [
        {
          order: 1,
          approverId: admin.id,
          status: StepStatus.APPROVED,
          actedAt: days(1),
          comment: '검토 완료',
        },
        { order: 2, approverId: manager.id, status: StepStatus.PENDING },
      ],
    },
    // 3) sent — completed approval, requester=manager
    {
      id: 'apr-demo-3',
      revisionId: 'rev-5-r1',
      title: 'CGL 공정 P&ID R1 결재',
      requesterId: manager.id,
      status: ApprovalStatus.APPROVED,
      completedAt: days(3),
      steps: [
        {
          order: 1,
          approverId: admin.id,
          status: StepStatus.APPROVED,
          actedAt: days(3),
          comment: '승인',
        },
      ],
    },
    // 4) recall — CANCELLED by requester (kim)
    {
      id: 'apr-demo-4',
      revisionId: 'rev-2-r1',
      title: 'CGL #2 컨베이어 조립도 R1 결재 (회수)',
      requesterId: kim.id,
      status: ApprovalStatus.CANCELLED,
      completedAt: days(5),
      steps: [
        { order: 1, approverId: manager.id, status: StepStatus.PENDING },
      ],
    },
  ];

  try {
    await prisma.$transaction(
      demos.flatMap((d) => [
        prisma.approval.create({
          data: {
            id: d.id,
            revisionId: d.revisionId,
            title: d.title,
            requesterId: d.requesterId,
            status: d.status,
            completedAt: d.completedAt,
            createdAt: days(7),
          },
        }),
        ...d.steps.map((s) =>
          prisma.approvalStep.create({
            data: {
              approvalId: d.id,
              order: s.order,
              approverId: s.approverId,
              status: s.status,
              comment: s.comment ?? null,
              actedAt: s.actedAt ?? null,
            },
          }),
        ),
      ]),
    );
  } catch (err) {
    // Tolerate races (e.g. two concurrent first-callers): unique-violation
    // means someone else seeded already.
    // eslint-disable-next-line no-console
    console.warn('[demo-seed] approval seed skipped:', (err as Error).message);
  } finally {
    approvalSeedChecked = true;
  }
}

/**
 * Insert a tiny set of Lobby + LobbyTargetCompany rows the first time the
 * lobbies API is hit. Same idempotency guarantees as the approval seeder.
 */
export async function ensureLobbyDemoSeed(): Promise<void> {
  if (lobbySeedChecked) return;
  const existing = await prisma.lobby.count();
  if (existing > 0) {
    lobbySeedChecked = true;
    return;
  }

  const [admin, kim, partnerOrg, designTeam1] = await Promise.all([
    prisma.user.findUnique({ where: { username: 'admin' } }),
    prisma.user.findUnique({ where: { username: 'kim' } }),
    prisma.organization.findUnique({ where: { id: 'org-partner' } }),
    prisma.organization.findUnique({ where: { id: 'org-design-1' } }),
  ]);
  if (!admin || !kim || !partnerOrg || !designTeam1) {
    lobbySeedChecked = true;
    return;
  }

  const folder = await prisma.folder.findFirst({ where: { folderCode: 'CGL-MEC' } });
  if (!folder) {
    return;
  }

  const now = new Date();
  const future = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);
  const past = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  type DemoLobby = {
    id: string;
    title: string;
    description: string;
    expiresAt: Date | null;
    status: LobbyStatus;
    createdBy: string;
    targetCompanyIds: string[];
  };

  const demos: DemoLobby[] = [
    // received — partner org is in targets
    {
      id: 'lobby-demo-1',
      title: 'CGL-2 메인롤러 도면 협업 (협력업체 송부)',
      description: '협력업체 검토 요청',
      expiresAt: future(7),
      status: LobbyStatus.IN_REVIEW,
      createdBy: admin.id,
      targetCompanyIds: [partnerOrg.id],
    },
    // received #2
    {
      id: 'lobby-demo-2',
      title: '소둔로 부품 도면 검토 요청',
      description: '재확인 요청',
      expiresAt: future(5),
      status: LobbyStatus.NEW,
      createdBy: admin.id,
      targetCompanyIds: [partnerOrg.id, designTeam1.id],
    },
    // sent — created by kim
    {
      id: 'lobby-demo-3',
      title: 'CGL-1 펌프 도면 송부 (협력업체)',
      description: '응답 대기',
      expiresAt: future(19),
      status: LobbyStatus.IN_REVIEW,
      createdBy: kim.id,
      targetCompanyIds: [partnerOrg.id],
    },
    // expired — past expiresAt
    {
      id: 'lobby-demo-4',
      title: '폐쇄 라인 검토 요청 (만료)',
      description: '만료된 패키지',
      expiresAt: past(16),
      status: LobbyStatus.EXPIRED,
      createdBy: admin.id,
      targetCompanyIds: [partnerOrg.id],
    },
  ];

  try {
    await prisma.$transaction(
      demos.flatMap((d) => [
        prisma.lobby.create({
          data: {
            id: d.id,
            folderId: folder.id,
            title: d.title,
            description: d.description,
            expiresAt: d.expiresAt,
            status: d.status,
            createdBy: d.createdBy,
            createdAt: past(2),
          },
        }),
        ...d.targetCompanyIds.map((cid) =>
          prisma.lobbyTargetCompany.create({
            data: { lobbyId: d.id, companyId: cid },
          }),
        ),
      ]),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[demo-seed] lobby seed skipped:', (err as Error).message);
  } finally {
    lobbySeedChecked = true;
  }
}
