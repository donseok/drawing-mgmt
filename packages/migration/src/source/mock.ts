// In-memory mock TeamPlus source.
//
// Goals:
//   * Power unit tests + `pnpm dry-run` without a real DB or NAS.
//   * Exercise every transform path (user role hints, folder tree, drawing
//     state hints, version sub-numbering).
//   * Be tweakable from tests via `MockSource.create({ overrides })`.
//
// Counts are constrained by the prompt: 10 users, 5 folders, 50 drawings,
// roughly 1 revision + 1 version + 1 master attachment per drawing.

import { createHash } from 'node:crypto';
import type {
  Source,
  SourceFile,
  TeamPlusAttachment,
  TeamPlusDrawing,
  TeamPlusFolder,
  TeamPlusOrganization,
  TeamPlusRevision,
  TeamPlusUser,
  TeamPlusVersion,
} from './types.js';

export interface MockSourceOptions {
  drawingCount?: number;
  userCount?: number;
  folderCount?: number;
  /** When set, `resolveFile` returns null for these source paths. */
  missingFilePaths?: ReadonlySet<string>;
  /**
   * When true, deliberately corrupt the buffer for the first N attachments
   * so the loader's checksum re-validation flags a mismatch. Used by
   * verify tests.
   */
  corruptFirstN?: number;
}

interface MockState {
  users: TeamPlusUser[];
  orgs: TeamPlusOrganization[];
  folders: TeamPlusFolder[];
  drawings: TeamPlusDrawing[];
  revisions: TeamPlusRevision[];
  versions: TeamPlusVersion[];
  attachments: TeamPlusAttachment[];
  files: Map<string, Buffer>;
  missing: ReadonlySet<string>;
  corruptFirstN: number;
}

const ROLE_HINTS = ['DESIGNER', 'ADMIN', 'VIEWER', 'PARTNER'] as const;
const STATE_HINTS = [
  'DRAFT',
  'CHECKED_IN',
  'IN_APPROVAL',
  'APPROVED',
] as const;

function buildState(opts: MockSourceOptions): MockState {
  const drawingCount = opts.drawingCount ?? 50;
  const userCount = opts.userCount ?? 10;
  const folderCount = opts.folderCount ?? 5;

  // Two organizations, parent + child, so OrgTree FK is exercised.
  const orgs: TeamPlusOrganization[] = [
    { externalId: 'org-root', name: '본사', parentExternalId: null, sortOrder: 0 },
    {
      externalId: 'org-design',
      name: '설계팀',
      parentExternalId: 'org-root',
      sortOrder: 1,
    },
  ];

  const users: TeamPlusUser[] = Array.from({ length: userCount }, (_, i) => {
    const roleHint = ROLE_HINTS[i % ROLE_HINTS.length] ?? 'DESIGNER';
    const orgId = i % 2 === 0 ? 'org-root' : 'org-design';
    return {
      externalId: `user-${String(i + 1).padStart(3, '0')}`,
      username: `tp_user_${i + 1}`,
      fullName: `테스트사용자${i + 1}`,
      email: i % 3 === 0 ? null : `tp_user_${i + 1}@example.com`,
      organizationExternalId: orgId,
      roleHint,
      active: i !== userCount - 1, // last user retired to exercise mapping
    };
  });

  // Folder tree: ROOT → 5 children. Lots of TeamPlus deployments are flat.
  const folders: TeamPlusFolder[] = [
    {
      externalId: 'folder-root',
      name: 'ROOT',
      pathCode: 'ROOT',
      parentExternalId: null,
      sortOrder: 0,
    },
    ...Array.from({ length: folderCount }, (_, i) => ({
      externalId: `folder-${i + 1}`,
      name: `프로젝트${i + 1}`,
      pathCode: `ROOT/PRJ-${String(i + 1).padStart(2, '0')}`,
      parentExternalId: 'folder-root',
      sortOrder: i + 1,
    })),
  ];

  const drawings: TeamPlusDrawing[] = Array.from(
    { length: drawingCount },
    (_, i) => {
      const folderIdx = (i % folderCount) + 1;
      const folder = folders[folderIdx];
      if (!folder) {
        throw new Error(`mock: folder index ${folderIdx} out of bounds`);
      }
      const owner = users[i % users.length];
      if (!owner) {
        throw new Error(`mock: owner index ${i % users.length} out of bounds`);
      }
      const stateHint = STATE_HINTS[i % STATE_HINTS.length] ?? 'CHECKED_IN';
      return {
        externalId: `drawing-${String(i + 1).padStart(3, '0')}`,
        number: `D-${String(i + 1).padStart(5, '0')}`,
        name: `도면 #${i + 1}`,
        description: i % 4 === 0 ? null : `mock drawing #${i + 1}`,
        folderExternalId: folder.externalId,
        classCode: i % 2 === 0 ? 'PART' : 'ASSY',
        ownerExternalId: owner.externalId,
        securityLevel: 1 + (i % 5),
        stateHint,
        createdAt: new Date(2024, 0, 1 + (i % 28)),
        updatedAt: new Date(2024, 1, 1 + (i % 28)),
      };
    },
  );

  // 1 revision + 1 version + 1 master attachment per drawing. Simpler than
  // production but enough to exercise FK chains.
  const revisions: TeamPlusRevision[] = drawings.map((d) => ({
    externalId: `rev-${d.externalId}`,
    drawingExternalId: d.externalId,
    rev: 0,
    createdAt: d.createdAt,
  }));
  const versions: TeamPlusVersion[] = revisions.map((r) => ({
    externalId: `ver-${r.externalId}`,
    revisionExternalId: r.externalId,
    ver: '1.0',
    createdAt: r.createdAt,
    createdByExternalId: 'user-001',
    comment: null,
  }));
  const attachments: TeamPlusAttachment[] = versions.map((v, i) => {
    const sourcePath = `attachments/${v.externalId}/master.dwg`;
    return {
      externalId: `att-${v.externalId}`,
      versionExternalId: v.externalId,
      filename: `master-${i + 1}.dwg`,
      sourcePath,
      mimeType: 'application/acad',
      size: 1024 + i * 8,
      isMaster: true,
    };
  });

  // Synthetic file bodies so checksum + copy paths can run end-to-end.
  const files = new Map<string, Buffer>();
  for (const att of attachments) {
    const body = Buffer.from(
      `MOCK-DWG ${att.externalId} (${att.size}B)\n`.padEnd(att.size, '.'),
      'utf8',
    );
    files.set(att.sourcePath, body);
  }

  return {
    users,
    orgs,
    folders,
    drawings,
    revisions,
    versions,
    attachments,
    files,
    missing: opts.missingFilePaths ?? new Set<string>(),
    corruptFirstN: opts.corruptFirstN ?? 0,
  };
}

export class MockSource implements Source {
  private constructor(private readonly state: MockState) {}

  static create(options: MockSourceOptions = {}): MockSource {
    return new MockSource(buildState(options));
  }

  async countUsers(): Promise<number> {
    return this.state.users.length;
  }
  async countOrganizations(): Promise<number> {
    return this.state.orgs.length;
  }
  async countFolders(): Promise<number> {
    return this.state.folders.length;
  }
  async countDrawings(): Promise<number> {
    return this.state.drawings.length;
  }
  async countAttachments(): Promise<number> {
    return this.state.attachments.length;
  }

  async *iterateUsers(): AsyncIterable<TeamPlusUser> {
    yield* this.state.users;
  }
  async *iterateOrganizations(): AsyncIterable<TeamPlusOrganization> {
    yield* this.state.orgs;
  }
  async *iterateFolders(): AsyncIterable<TeamPlusFolder> {
    yield* this.state.folders;
  }
  async *iterateDrawings(): AsyncIterable<TeamPlusDrawing> {
    yield* this.state.drawings;
  }
  async *iterateRevisions(): AsyncIterable<TeamPlusRevision> {
    yield* this.state.revisions;
  }
  async *iterateVersions(): AsyncIterable<TeamPlusVersion> {
    yield* this.state.versions;
  }
  async *iterateAttachments(): AsyncIterable<TeamPlusAttachment> {
    yield* this.state.attachments;
  }

  async resolveFile(sourcePath: string): Promise<SourceFile | null> {
    if (this.state.missing.has(sourcePath)) return null;
    const original = this.state.files.get(sourcePath);
    if (!original) return null;

    // The "honest" path: hash the bytes we're about to return.
    const honestChecksum = sha256(original);

    // Optional corruption knob — if `corruptFirstN > 0`, the first N
    // attachments come back with a flipped byte but the source-claimed
    // checksum is the *original* (uncorrupted) hash. This simulates a
    // NAS-side bit-rot scenario: the source DB still claims the old
    // checksum, but the file body on disk was silently corrupted. The
    // loader's re-checksum-after-copy path catches this and records a
    // mismatch in the report.
    if (this.state.corruptFirstN > 0) {
      const idx = this.state.attachments.findIndex(
        (a) => a.sourcePath === sourcePath,
      );
      if (idx >= 0 && idx < this.state.corruptFirstN) {
        const corrupted = Buffer.from(original);
        const offset = 0;
        const oldVal = corrupted[offset] ?? 0;
        corrupted[offset] = (oldVal ^ 0xff) & 0xff;
        return { buffer: corrupted, checksum: honestChecksum };
      }
    }

    return { buffer: original, checksum: honestChecksum };
  }
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
