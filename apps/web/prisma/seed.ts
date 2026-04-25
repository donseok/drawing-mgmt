/**
 * Idempotent seed for the drawing-management system.
 *
 * Run with:
 *   pnpm --filter @drawing-mgmt/web db:seed
 *   (which is `tsx prisma/seed.ts`)
 *
 * Safe to re-run: every write is an `upsert` keyed on a unique field.
 * Korean text used everywhere — system locale is ko-KR.
 *
 * Seeds (per task spec):
 *   - Users:    1 SUPER_ADMIN, 1 ADMIN, 3 USER, 1 PARTNER
 *   - Org tree: 본사 → (설계1팀, 설계2팀, 협력업체)
 *   - Classes:  기계(MEC) / 전기(ELE) / 계장(INS) / 공정(PRC) / 일반(GEN)
 *               with 3-5 attributes each
 *   - NumberRule: "기본발번"  FOLDER_CODE-YEAR-SEQ(5)
 *   - Folders:  본사 / 기계(CGL-MEC) / 전기(CGL-ELE) / 계장(CGL-INS) /
 *               공정(CGL-PRC) / 폐기함(TRASH)
 *   - FolderPermission: SUPER_ADMIN full bits + USER view/edit/download/print
 *   - Notice:   "운영 시작 안내"
 *   - Objects:  5 sample with Revision/Version/Attachment (DONE conversion)
 *   - ManualChunks: 3 (체크아웃 / 개정 / 등록 — content only, no embedding)
 */
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

const BCRYPT_ROUNDS = 12;
const hash = (pw: string): string => bcrypt.hashSync(pw, BCRYPT_ROUNDS);

/** Padded sequence (e.g. 1 -> "00001"). */
const seq = (n: number): string => String(n).padStart(5, '0');

/** Current year for sample object numbers. */
const YEAR = new Date().getFullYear();

/* -------------------------------------------------------------------------- */
/*  Main                                                                      */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  console.log('▶ Seeding database…');

  /* ── 1. Organizations ─────────────────────────────────────────────── */
  const headquarters = await prisma.organization.upsert({
    where: { id: 'org-headquarters' },
    update: { name: '본사', sortOrder: 0, parentId: null },
    create: {
      id: 'org-headquarters',
      name: '본사',
      sortOrder: 0,
    },
  });

  const designTeam1 = await prisma.organization.upsert({
    where: { id: 'org-design-1' },
    update: { name: '설계1팀', sortOrder: 1, parentId: headquarters.id },
    create: {
      id: 'org-design-1',
      name: '설계1팀',
      sortOrder: 1,
      parentId: headquarters.id,
    },
  });

  const designTeam2 = await prisma.organization.upsert({
    where: { id: 'org-design-2' },
    update: { name: '설계2팀', sortOrder: 2, parentId: headquarters.id },
    create: {
      id: 'org-design-2',
      name: '설계2팀',
      sortOrder: 2,
      parentId: headquarters.id,
    },
  });

  const partnerOrg = await prisma.organization.upsert({
    where: { id: 'org-partner' },
    update: { name: '협력업체', sortOrder: 3, parentId: headquarters.id },
    create: {
      id: 'org-partner',
      name: '협력업체',
      sortOrder: 3,
      parentId: headquarters.id,
    },
  });

  console.log('  ✓ Organizations: 본사 → 설계1팀 / 설계2팀 / 협력업체');

  /* ── 2. Users ─────────────────────────────────────────────────────── */
  const superAdmin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {
      fullName: '시스템관리자',
      role: 'SUPER_ADMIN',
      securityLevel: 1,
      organizationId: headquarters.id,
    },
    create: {
      username: 'admin',
      passwordHash: hash('admin123!'),
      fullName: '시스템관리자',
      email: 'admin@example.com',
      role: 'SUPER_ADMIN',
      securityLevel: 1,
      organizationId: headquarters.id,
      employmentType: 'ACTIVE',
    },
  });

  const adminUser = await prisma.user.upsert({
    where: { username: 'manager' },
    update: {
      fullName: '관리자',
      role: 'ADMIN',
      securityLevel: 2,
      organizationId: headquarters.id,
    },
    create: {
      username: 'manager',
      passwordHash: hash('manager123!'),
      fullName: '관리자',
      email: 'manager@example.com',
      role: 'ADMIN',
      securityLevel: 2,
      organizationId: headquarters.id,
      employmentType: 'ACTIVE',
    },
  });

  const userKim = await prisma.user.upsert({
    where: { username: 'kim' },
    update: {
      fullName: '김설계',
      role: 'USER',
      securityLevel: 3,
      organizationId: designTeam1.id,
    },
    create: {
      username: 'kim',
      passwordHash: hash('kim123!'),
      fullName: '김설계',
      email: 'kim@example.com',
      role: 'USER',
      securityLevel: 3,
      organizationId: designTeam1.id,
      employmentType: 'ACTIVE',
    },
  });

  const userPark = await prisma.user.upsert({
    where: { username: 'park' },
    update: {
      fullName: '박설계',
      role: 'USER',
      securityLevel: 3,
      organizationId: designTeam1.id,
    },
    create: {
      username: 'park',
      passwordHash: hash('park123!'),
      fullName: '박설계',
      email: 'park@example.com',
      role: 'USER',
      securityLevel: 3,
      organizationId: designTeam1.id,
      employmentType: 'ACTIVE',
    },
  });

  const userLee = await prisma.user.upsert({
    where: { username: 'lee' },
    update: {
      fullName: '이설계',
      role: 'USER',
      securityLevel: 4,
      organizationId: designTeam2.id,
    },
    create: {
      username: 'lee',
      passwordHash: hash('lee123!'),
      fullName: '이설계',
      email: 'lee@example.com',
      role: 'USER',
      securityLevel: 4,
      organizationId: designTeam2.id,
      employmentType: 'ACTIVE',
    },
  });

  const partnerUser = await prisma.user.upsert({
    where: { username: 'partner1' },
    update: {
      fullName: '협력사담당',
      role: 'PARTNER',
      securityLevel: 5,
      organizationId: partnerOrg.id,
      employmentType: 'PARTNER',
    },
    create: {
      username: 'partner1',
      passwordHash: hash('partner123!'),
      fullName: '협력사담당',
      email: 'partner1@example.com',
      role: 'PARTNER',
      securityLevel: 5,
      organizationId: partnerOrg.id,
      employmentType: 'PARTNER',
    },
  });

  console.log(
    '  ✓ Users: admin / manager / kim / park / lee / partner1 (총 6)',
  );

  /* ── 3. ObjectClass + ObjectAttribute ─────────────────────────────── */
  type AttrSeed = {
    code: string;
    label: string;
    dataType: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'COMBO';
    required: boolean;
    defaultValue?: string;
    comboItems?: Prisma.InputJsonValue;
    sortOrder: number;
  };

  type ClassSeed = {
    code: string;
    name: string;
    description: string;
    attributes: AttrSeed[];
  };

  const classSeeds: ClassSeed[] = [
    {
      code: 'MEC',
      name: '기계',
      description: '기계 설비 도면',
      attributes: [
        { code: 'line', label: '라인', dataType: 'TEXT', required: true, sortOrder: 1 },
        { code: 'part', label: '부위', dataType: 'TEXT', required: false, sortOrder: 2 },
        { code: 'material', label: '재질', dataType: 'TEXT', required: false, sortOrder: 3 },
        { code: 'capacity', label: '용량', dataType: 'NUMBER', required: false, sortOrder: 4 },
      ],
    },
    {
      code: 'ELE',
      name: '전기',
      description: '전기 설비 도면',
      attributes: [
        { code: 'voltage', label: '전압(V)', dataType: 'NUMBER', required: true, sortOrder: 1 },
        { code: 'current', label: '전류(A)', dataType: 'NUMBER', required: false, sortOrder: 2 },
        { code: 'phase', label: '상수', dataType: 'COMBO', required: false, comboItems: ['단상', '3상'], sortOrder: 3 },
        { code: 'panel', label: '패널', dataType: 'TEXT', required: false, sortOrder: 4 },
      ],
    },
    {
      code: 'INS',
      name: '계장',
      description: '계측·제어 도면',
      attributes: [
        { code: 'tagNumber', label: '태그번호', dataType: 'TEXT', required: true, sortOrder: 1 },
        { code: 'signalType', label: '신호 유형', dataType: 'COMBO', required: false, comboItems: ['4-20mA', '0-10V', 'HART', 'Modbus'], sortOrder: 2 },
        { code: 'range', label: '레인지', dataType: 'TEXT', required: false, sortOrder: 3 },
      ],
    },
    {
      code: 'PRC',
      name: '공정',
      description: '공정 흐름 도면 (P&ID 등)',
      attributes: [
        { code: 'process', label: '공정명', dataType: 'TEXT', required: true, sortOrder: 1 },
        { code: 'unit', label: '단위공정', dataType: 'TEXT', required: false, sortOrder: 2 },
        { code: 'pressure', label: '운전압력', dataType: 'TEXT', required: false, sortOrder: 3 },
        { code: 'temperature', label: '운전온도', dataType: 'TEXT', required: false, sortOrder: 4 },
      ],
    },
    {
      code: 'GEN',
      name: '일반',
      description: '분류 미정 또는 일반 문서',
      attributes: [
        { code: 'category', label: '분류', dataType: 'TEXT', required: false, sortOrder: 1 },
        { code: 'note', label: '비고', dataType: 'TEXT', required: false, sortOrder: 2 },
        { code: 'isReference', label: '참고자료', dataType: 'BOOLEAN', required: false, defaultValue: 'false', sortOrder: 3 },
      ],
    },
  ];

  const classMap = new Map<string, { id: string; attrs: Map<string, string> }>();

  for (const c of classSeeds) {
    const cls = await prisma.objectClass.upsert({
      where: { code: c.code },
      update: { name: c.name, description: c.description },
      create: { code: c.code, name: c.name, description: c.description },
    });

    const attrIdByCode = new Map<string, string>();
    for (const a of c.attributes) {
      const created = await prisma.objectAttribute.upsert({
        where: { classId_code: { classId: cls.id, code: a.code } },
        update: {
          label: a.label,
          dataType: a.dataType,
          required: a.required,
          defaultValue: a.defaultValue ?? null,
          comboItems: a.comboItems ?? Prisma.JsonNull,
          sortOrder: a.sortOrder,
        },
        create: {
          classId: cls.id,
          code: a.code,
          label: a.label,
          dataType: a.dataType,
          required: a.required,
          defaultValue: a.defaultValue ?? null,
          comboItems: a.comboItems ?? Prisma.JsonNull,
          sortOrder: a.sortOrder,
        },
      });
      attrIdByCode.set(a.code, created.id);
    }

    classMap.set(c.code, { id: cls.id, attrs: attrIdByCode });
  }

  console.log('  ✓ ObjectClasses: MEC / ELE / INS / PRC / GEN (총 5)');

  /* ── 4. NumberRule "기본발번" ─────────────────────────────────────── */
  // Stable id makes the seed re-runnable.
  const RULE_ID = 'rule-default';
  await prisma.numberRule.upsert({
    where: { id: RULE_ID },
    update: { name: '기본발번', isDefault: true, classId: null },
    create: {
      id: RULE_ID,
      name: '기본발번',
      isDefault: true,
    },
  });

  // Replace parts deterministically: delete all parts for this rule, recreate.
  await prisma.numberRulePart.deleteMany({ where: { ruleId: RULE_ID } });
  await prisma.numberRulePart.createMany({
    data: [
      { ruleId: RULE_ID, type: 'FOLDER_CODE', order: 1 },
      { ruleId: RULE_ID, type: 'LITERAL', value: '-', order: 2 },
      { ruleId: RULE_ID, type: 'YEAR', digits: 4, order: 3 },
      { ruleId: RULE_ID, type: 'LITERAL', value: '-', order: 4 },
      { ruleId: RULE_ID, type: 'SEQUENCE', digits: 5, initial: 1, order: 5 },
    ],
  });

  console.log('  ✓ NumberRule: 기본발번 (FOLDER_CODE-YEAR-SEQ5)');

  /* ── 5. Folders ───────────────────────────────────────────────────── */
  const rootFolder = await prisma.folder.upsert({
    where: { folderCode: 'ROOT' },
    update: { name: '본사', parentId: null, sortOrder: 0 },
    create: {
      folderCode: 'ROOT',
      name: '본사',
      sortOrder: 0,
    },
  });

  type FolderSeed = {
    code: string;
    name: string;
    classCode?: string;
    sortOrder: number;
  };

  const folderSeeds: FolderSeed[] = [
    { code: 'CGL-MEC', name: '기계', classCode: 'MEC', sortOrder: 1 },
    { code: 'CGL-ELE', name: '전기', classCode: 'ELE', sortOrder: 2 },
    { code: 'CGL-INS', name: '계장', classCode: 'INS', sortOrder: 3 },
    { code: 'CGL-PRC', name: '공정', classCode: 'PRC', sortOrder: 4 },
    { code: 'TRASH', name: '폐기함', sortOrder: 99 },
  ];

  const folderMap = new Map<string, string>();
  folderMap.set('ROOT', rootFolder.id);

  for (const f of folderSeeds) {
    const defaultClassId = f.classCode ? classMap.get(f.classCode)?.id ?? null : null;
    const created = await prisma.folder.upsert({
      where: { folderCode: f.code },
      update: {
        name: f.name,
        parentId: rootFolder.id,
        defaultClassId,
        sortOrder: f.sortOrder,
      },
      create: {
        folderCode: f.code,
        name: f.name,
        parentId: rootFolder.id,
        defaultClassId,
        sortOrder: f.sortOrder,
      },
    });
    folderMap.set(f.code, created.id);
  }

  console.log(
    '  ✓ Folders: 본사 → 기계 / 전기 / 계장 / 공정 / 폐기함 (총 6)',
  );

  /* ── 6. FolderPermission ──────────────────────────────────────────── */
  // SUPER_ADMIN: full bits on every folder.
  // USER trio (kim/park/lee): view/edit/download/print on every working folder
  //                           (not on TRASH for download/print).
  type PermSpec = {
    folderCode: string;
    principalType: 'USER' | 'ORG' | 'GROUP';
    principalId: string;
    bits: {
      viewFolder?: boolean;
      editFolder?: boolean;
      viewObject?: boolean;
      editObject?: boolean;
      deleteObject?: boolean;
      approveObject?: boolean;
      download?: boolean;
      print?: boolean;
    };
  };

  const fullBits = {
    viewFolder: true,
    editFolder: true,
    viewObject: true,
    editObject: true,
    deleteObject: true,
    approveObject: true,
    download: true,
    print: true,
  } as const;

  const userBits = {
    viewFolder: true,
    editFolder: false,
    viewObject: true,
    editObject: true,
    deleteObject: false,
    approveObject: false,
    download: true,
    print: true,
  } as const;

  const trashUserBits = {
    viewFolder: true,
    editFolder: false,
    viewObject: true,
    editObject: false,
    deleteObject: false,
    approveObject: false,
    download: false,
    print: false,
  } as const;

  const allFolderCodes = ['ROOT', 'CGL-MEC', 'CGL-ELE', 'CGL-INS', 'CGL-PRC', 'TRASH'];
  const userIds = [userKim.id, userPark.id, userLee.id];

  const permSpecs: PermSpec[] = [];

  // SUPER_ADMIN — fullBits on every folder.
  for (const code of allFolderCodes) {
    permSpecs.push({
      folderCode: code,
      principalType: 'USER',
      principalId: superAdmin.id,
      bits: fullBits,
    });
  }

  // USERs — full working bits on regular folders, view-only on TRASH.
  for (const uid of userIds) {
    for (const code of allFolderCodes) {
      permSpecs.push({
        folderCode: code,
        principalType: 'USER',
        principalId: uid,
        bits: code === 'TRASH' ? trashUserBits : userBits,
      });
    }
  }

  for (const spec of permSpecs) {
    const folderId = folderMap.get(spec.folderCode);
    if (!folderId) continue;
    await prisma.folderPermission.upsert({
      where: {
        folderId_principalType_principalId: {
          folderId,
          principalType: spec.principalType,
          principalId: spec.principalId,
        },
      },
      update: { ...spec.bits },
      create: {
        folderId,
        principalType: spec.principalType,
        principalId: spec.principalId,
        ...spec.bits,
      },
    });
  }

  console.log(`  ✓ FolderPermissions: ${permSpecs.length} rows`);

  /* ── 7. Notice ────────────────────────────────────────────────────── */
  const NOTICE_ID = 'notice-launch';
  await prisma.notice.upsert({
    where: { id: NOTICE_ID },
    update: {
      title: '운영 시작 안내',
      body:
        '도면관리시스템 신규 버전 운영을 시작합니다. ' +
        '첫 로그인 시 비밀번호를 변경해주세요. ' +
        '문의: 시스템관리자',
      isPopup: true,
      isActive: true,
      publishFrom: new Date('2026-01-01T00:00:00Z'),
      publishTo: null,
    },
    create: {
      id: NOTICE_ID,
      title: '운영 시작 안내',
      body:
        '도면관리시스템 신규 버전 운영을 시작합니다. ' +
        '첫 로그인 시 비밀번호를 변경해주세요. ' +
        '문의: 시스템관리자',
      isPopup: true,
      isActive: true,
      publishFrom: new Date('2026-01-01T00:00:00Z'),
    },
  });

  console.log('  ✓ Notice: 운영 시작 안내');

  /* ── 8. Sample ObjectEntities ────────────────────────────────────── */
  type ObjectSeed = {
    n: number; // 1..5 — drives stable IDs and storage paths
    folderCode: string;
    classCode: 'MEC' | 'ELE' | 'INS' | 'PRC' | 'GEN';
    name: string;
    description: string;
    securityLevel: number;
    state: 'NEW' | 'CHECKED_IN' | 'APPROVED';
    ownerId: string;
    rev: number;
    ver: string; // Decimal as string (avoids precision drift)
    attrs: Record<string, string>;
  };

  const objectSeeds: ObjectSeed[] = [
    {
      n: 1,
      folderCode: 'CGL-MEC',
      classCode: 'MEC',
      name: 'CGL #1 라인 펌프 설치도',
      description: 'CGL 1라인 메인 펌프 설치 위치 및 배관 연결도',
      securityLevel: 3,
      state: 'APPROVED',
      ownerId: userKim.id,
      rev: 1,
      ver: '1.0',
      attrs: { line: 'CGL-1', part: '펌프', material: 'STS304' },
    },
    {
      n: 2,
      folderCode: 'CGL-MEC',
      classCode: 'MEC',
      name: 'CGL #2 컨베이어 조립도',
      description: '#2 라인 컨베이어 어셈블리',
      securityLevel: 3,
      state: 'CHECKED_IN',
      ownerId: userPark.id,
      rev: 1,
      ver: '0.3',
      attrs: { line: 'CGL-2', part: '컨베이어' },
    },
    {
      n: 3,
      folderCode: 'CGL-ELE',
      classCode: 'ELE',
      name: 'CGL #1 메인 배전반 결선도',
      description: '주배전반 결선도',
      securityLevel: 4,
      state: 'APPROVED',
      ownerId: userKim.id,
      rev: 1,
      ver: '1.0',
      attrs: { voltage: '380', current: '200', phase: '3상' },
    },
    {
      n: 4,
      folderCode: 'CGL-INS',
      classCode: 'INS',
      name: 'CGL 입측 온도 트랜스미터 설치도',
      description: '입측 라인 온도 측정 루프',
      securityLevel: 4,
      state: 'NEW',
      ownerId: userLee.id,
      rev: 0,
      ver: '0.1',
      attrs: { tagNumber: 'TT-1001', signalType: '4-20mA', range: '0-200℃' },
    },
    {
      n: 5,
      folderCode: 'CGL-PRC',
      classCode: 'PRC',
      name: 'CGL 공정 P&ID',
      description: '연속아연도금 라인 전체 P&ID',
      securityLevel: 5,
      state: 'APPROVED',
      ownerId: userPark.id,
      rev: 1,
      ver: '1.0',
      attrs: { process: 'CGL', unit: '도금', pressure: '상압', temperature: '460℃' },
    },
  ];

  for (const o of objectSeeds) {
    const folderId = folderMap.get(o.folderCode)!;
    const cls = classMap.get(o.classCode)!;
    const number = `${o.folderCode}-${YEAR}-${seq(o.n)}`;
    const objectId = `obj-${o.n}`;
    const revisionId = `rev-${o.n}-r${o.rev}`;
    const versionId = `ver-${o.n}-v${o.ver.replace('.', '_')}`;
    const attachmentId = `att-${o.n}`;

    await prisma.objectEntity.upsert({
      where: { number },
      update: {
        name: o.name,
        description: o.description,
        folderId,
        classId: cls.id,
        securityLevel: o.securityLevel,
        state: o.state,
        ownerId: o.ownerId,
        currentRevision: o.rev,
        currentVersion: new Prisma.Decimal(o.ver),
      },
      create: {
        id: objectId,
        number,
        name: o.name,
        description: o.description,
        folderId,
        classId: cls.id,
        securityLevel: o.securityLevel,
        state: o.state,
        ownerId: o.ownerId,
        currentRevision: o.rev,
        currentVersion: new Prisma.Decimal(o.ver),
      },
    });

    // Attribute values (idempotent per (objectId, attributeId))
    for (const [code, value] of Object.entries(o.attrs)) {
      const attrId = cls.attrs.get(code);
      if (!attrId) continue;
      await prisma.objectAttributeValue.upsert({
        where: { objectId_attributeId: { objectId, attributeId: attrId } },
        update: { value },
        create: { objectId, attributeId: attrId, value },
      });
    }

    // Revision (use stable id; createMany would skip duplicates but upsert is clearer)
    await prisma.revision.upsert({
      where: { objectId_rev: { objectId, rev: o.rev } },
      update: {},
      create: {
        id: revisionId,
        objectId,
        rev: o.rev,
      },
    });

    // Version
    await prisma.version.upsert({
      where: { revisionId_ver: { revisionId, ver: new Prisma.Decimal(o.ver) } },
      update: {},
      create: {
        id: versionId,
        revisionId,
        ver: new Prisma.Decimal(o.ver),
        createdBy: o.ownerId,
        comment: '시드 데이터',
      },
    });

    // Attachment
    const storagePath = `./.data/files/seed/${o.n}.dwg`;
    await prisma.attachment.upsert({
      where: { storagePath },
      update: {
        versionId,
        filename: `${number}.dwg`,
        mimeType: 'application/dwg',
        size: BigInt(1024 * 1024),
        isMaster: true,
        checksumSha256: `seed-checksum-${o.n}`,
        pdfPath: `./.data/files/seed/${o.n}.pdf`,
        dxfPath: `./.data/files/seed/${o.n}.dxf`,
        thumbnailPath: `./.data/files/seed/${o.n}.thumb.png`,
        conversionStatus: 'DONE',
      },
      create: {
        id: attachmentId,
        versionId,
        filename: `${number}.dwg`,
        storagePath,
        mimeType: 'application/dwg',
        size: BigInt(1024 * 1024),
        isMaster: true,
        checksumSha256: `seed-checksum-${o.n}`,
        pdfPath: `./.data/files/seed/${o.n}.pdf`,
        dxfPath: `./.data/files/seed/${o.n}.dxf`,
        thumbnailPath: `./.data/files/seed/${o.n}.thumb.png`,
        conversionStatus: 'DONE',
      },
    });
  }

  console.log(`  ✓ ObjectEntities: ${objectSeeds.length} (with rev/ver/attachment)`);

  /* ── 9. ManualChunks (RAG) ────────────────────────────────────────── */
  // No embedding here — vector column is added by 0001_pgvector.sql and is
  // populated separately by `pnpm chat:reindex`.
  type ChunkSeed = { id: string; source: string; title: string; content: string };

  const chunks: ChunkSeed[] = [
    {
      id: 'manual-checkout',
      source: 'manual:checkout',
      title: '체크아웃 절차',
      content:
        '체크아웃은 도면을 편집하기 위해 잠금을 거는 작업입니다. ' +
        '대상 도면 상세 화면에서 [체크아웃] 버튼을 누르면 본인에게 잠금이 설정되어 ' +
        '다른 사용자는 동일 도면을 동시에 편집할 수 없습니다. ' +
        '편집을 마치고 새 첨부파일을 업로드한 뒤 [체크인]을 눌러 잠금을 해제합니다. ' +
        '체크아웃 상태에서 EDIT 권한이 없는 사용자는 편집·체크인 모두 불가합니다.',
    },
    {
      id: 'manual-revision',
      source: 'manual:revision',
      title: '개정 절차',
      content:
        '개정은 이미 승인된 도면에 대해 새로운 변경사항을 반영하는 절차입니다. ' +
        '승인된 도면 상세 화면에서 [개정] 버튼을 누르면 새 Revision이 생성되고 ' +
        '상태가 CHECKED_OUT으로 전이됩니다. 새 첨부파일을 업로드하고 체크인 후 ' +
        '결재 라인에 상신하면 동일한 결재 절차를 거쳐 승인됩니다. ' +
        '버전(Version)은 0.1 단위로 증가하며 승인 시 정수 단위로 올림됩니다.',
    },
    {
      id: 'manual-register',
      source: 'manual:register',
      title: '등록 절차',
      content:
        '신규 도면 등록은 폴더 화면 상단 [신규등록] 버튼으로 시작합니다. ' +
        '대상 폴더, 자료유형(기계/전기/계장/공정 등)을 선택하고 ' +
        '도면번호는 발번 규칙에 따라 자동 생성됩니다. ' +
        '필수 속성을 입력하고 DWG 또는 PDF 첨부파일을 업로드하면 ' +
        '백그라운드에서 PDF·DXF·썸네일이 자동 변환됩니다. ' +
        '등록자는 자동으로 owner가 되며 이후 결재 절차를 통해 승인됩니다.',
    },
  ];

  for (const c of chunks) {
    await prisma.manualChunk.upsert({
      where: { id: c.id },
      update: { source: c.source, title: c.title, content: c.content },
      create: { id: c.id, source: c.source, title: c.title, content: c.content },
    });
  }

  console.log(`  ✓ ManualChunks: ${chunks.length} (체크아웃 / 개정 / 등록)`);

  console.log('✔ Seed complete.');
}

main()
  .catch((err: unknown) => {
    console.error('✖ Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
