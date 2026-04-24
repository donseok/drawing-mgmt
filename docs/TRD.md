# TRD — 동국씨엠 도면관리시스템 재구축

| 항목 | 내용 |
|---|---|
| 문서명 | Technical Requirements Document |
| 버전 | v0.1 (초안) |
| 대상 | 도면관리시스템 (Pure Web, On-Prem) |
| 라이선스 정책 | 100% 무료 OSS / 무상 배포 SW |
| 대상 PRD | docs/PRD.md v0.1 |

---

## 1. 기술 스택 결정

### 1.1 최종 스택

| 계층 | 선택 | 라이선스 | 선택 이유 |
|---|---|---|---|
| Runtime | Node.js 20 LTS | MIT | LTS, 풀스택 TS 지원 |
| Framework | **Next.js 14 (App Router)** | MIT | SSR + API Route 단일 코드베이스, LLM 코딩 친화 |
| Language | TypeScript 5.x | Apache-2.0 | 타입 안정성·자동완성 |
| ORM | **Prisma 5.x** | Apache-2.0 | 스키마 퍼스트, 마이그레이션 자동 |
| DB | **PostgreSQL 16** | PostgreSQL License (BSD-style) | FTS, JSONB, BLOB, 한글 N-gram |
| 인증 | Auth.js v5 (NextAuth) | ISC | Credentials + 향후 OIDC 확장 |
| UI | Tailwind CSS 3 + shadcn/ui (Radix) | MIT | 복붙형 컴포넌트, 디자인 일관 |
| 상태관리 | TanStack Query 5 + Zustand | MIT | 서버 상태/클라이언트 상태 분리 |
| 폼 | React Hook Form + Zod | MIT | 검증·타입 통합 |
| 파일 업로드 | tus-js / 자체 청크 업로드 | MIT | 대용량 도면 안정 업로드 |
| 작업 큐 | BullMQ 5 + Redis 7 | MIT | DWG 변환 비동기 처리 |
| **DWG 변환** | **ODA File Converter** | 무상 배포 (ODA 라이선스) | DWG↔DXF·PDF·SVG, 검증된 안정성 |
| DXF 보조 변환 | LibreDWG (백업) | GPLv3 | 폐쇄망 사내 사용 OK |
| PDF 후처리 | Ghostscript 10 | AGPL-3.0 | 사내 사용 OK |
| **DWG 웹 렌더** | **PDF.js 4** + **dxf-viewer** | Apache-2.0 / MIT | PDF.js로 변환본, dxf-viewer로 측정·레이어 |
| 이미지 처리 | sharp | Apache-2.0 | 썸네일·미리보기 |
| 검색 | PostgreSQL FTS + pg_trgm | BSD-style | 별도 검색엔진 불필요 (소규모) |
| 한글 검색 | textsearch_ko 또는 N-gram 인덱스 | MIT | 형태소·N-gram 토크나이징 |
| 컨테이너 | Docker 24 + Docker Compose v2 | Apache-2.0 | 단일 명령 배포 |
| 리버스프록시 | Nginx 1.24 | BSD | HTTPS·정적 파일·압축 |
| 로깅 | Pino + Loki(선택) | MIT/Apache | 구조적 로그 |
| 모니터링 | Uptime Kuma (선택) | MIT | 단순 헬스체크 |
| OS | Ubuntu Server 22.04 LTS | 자유 | 무료, 자료 풍부 |

### 1.2 대안과 결정 사유

| 후보 | 결정 | 사유 |
|---|---|---|
| Spring Boot vs Next.js | Next.js | 1인 1개월 + 바이브코딩 → 풀스택 TS가 LLM 어시스트 강함 |
| Django/FastAPI vs Next.js | Next.js | 프론트·백엔드 분리 시 스위칭 비용 큼 |
| MinIO vs 로컬 디스크 | 로컬 디스크 | 사용자 20명·동시 5명·중소 규모 → MinIO 오버엔지 |
| Elasticsearch vs PostgreSQL FTS | PostgreSQL | 데이터 < 10만 건 추정, 별도 인프라 부담 |
| LibreDWG vs ODA Converter | ODA 우선 | 변환 안정성 우수, GPL 전염 회피 (백업으로 LibreDWG) |
| AWS·NCP vs On-Prem | On-Prem | 사용자 요구사항 |

---

## 2. 시스템 아키텍처

### 2.1 논리 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                       사내 LAN (HTTPS)                        │
│                                                                │
│  사용자 브라우저 (Chrome/Edge, Desktop only)                    │
│      │                                                          │
│      ▼                                                          │
│  ┌─────────────┐   reverse proxy / TLS                          │
│  │   Nginx     │                                                │
│  └──────┬──────┘                                                │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────────┐                                        │
│  │  Next.js (App+API)   │ ── REST/Server Action ── 외부 시스템   │
│  │  • SSR / RSC          │                                        │
│  │  • API Routes        │                                        │
│  │  • Auth.js           │                                        │
│  │  • Prisma Client     │                                        │
│  └──────┬───────────────┘                                        │
│         │                                                        │
│  ┌──────┴───────┐  ┌──────────────┐  ┌────────────────────┐      │
│  │ PostgreSQL   │  │   Redis      │  │  파일 스토리지      │      │
│  │  (메타·이력)  │  │  (BullMQ Q)  │  │  /data/files/...   │      │
│  └──────────────┘  └──────┬───────┘  └────────┬───────────┘      │
│                           │                   │                  │
│                           ▼                   ▼                  │
│                   ┌────────────────────────────────┐             │
│                   │  변환 워커 (Node.js)            │             │
│                   │  • ODA File Converter (CLI)     │             │
│                   │  • Ghostscript / sharp          │             │
│                   │  • LibreDWG (백업)              │             │
│                   └────────────────────────────────┘             │
│                                                                  │
│  ↘ 일 1회 백업 → NAS (rsync)                                     │
└─────────────────────────────────────────────────────────────────┘

  ↕ 외부 연계
  ┌─────────────────────────────────────────────┐
  │ 설비관리 시스템 (REST API, 인증: API Key)    │
  │ 향후: 그룹웨어 결재 / AD-LDAP                 │
  └─────────────────────────────────────────────┘
```

### 2.2 컨테이너 구성 (docker-compose)

```yaml
services:
  postgres:    # PostgreSQL 16
  redis:       # Redis 7
  app:         # Next.js (web + API)
  worker:      # 변환 워커 (Node.js + ODA File Converter 설치)
  nginx:       # 리버스프록시 + HTTPS
```

볼륨: `/data/files` (도면 원본·캐시), `/data/postgres`, `/data/backup`.

### 2.3 디렉토리 구조 (모노레포)

```
drawing-mgmt/
├─ apps/
│  ├─ web/              # Next.js
│  │  ├─ app/           # App Router
│  │  │  ├─ (auth)/     # 로그인
│  │  │  ├─ (main)/     # 메인 라우트 그룹
│  │  │  │  ├─ search/
│  │  │  │  ├─ approval/
│  │  │  │  ├─ lobby/
│  │  │  │  ├─ workspace/
│  │  │  │  └─ admin/
│  │  │  ├─ api/        # REST API
│  │  │  └─ viewer/     # 뷰어 페이지
│  │  ├─ components/
│  │  ├─ lib/
│  │  └─ prisma/        # schema.prisma
│  └─ worker/           # 변환 워커
│     ├─ jobs/
│     │  ├─ dwg-convert.ts
│     │  └─ thumbnail.ts
│     └─ adapters/
│        └─ oda-converter.ts
├─ packages/
│  ├─ shared/           # 공유 타입·zod 스키마
│  └─ migration/        # TeamPlus → 신시스템 마이그레이션
├─ docker/
│  ├─ Dockerfile.app
│  ├─ Dockerfile.worker
│  └─ nginx.conf
├─ docker-compose.yml
└─ docs/                # PRD/TRD/WBS
```

---

## 3. 데이터 모델 (Prisma 스키마 — 핵심 엔티티)

### 3.1 ER 개요

```
User ─┬─ Organization (N:1)
      └─ UserGroup ── Group (N:M)

Folder ── self (Tree, parentId)
        └─ FolderPermission ── (User|Org|Group) × Action

Object (자료) ── Folder (N:1)
              ├─ ObjectClass (자료유형)
              ├─ ObjectAttribute (자료유형 속성 정의)
              ├─ ObjectAttributeValue (값)
              ├─ Revision (1:N)
              │   └─ Version (1:N)
              │       └─ Attachment (1:N) ── master flag
              ├─ LinkedObject (연결문서, N:M self)
              └─ ActivityLog (1:N)

Approval (결재) ── Object × Revision
                 └─ ApprovalLine ── ApprovalStep
                                  └─ ApprovalAction (승인/반려/의견)

Lobby ── Folder
       ├─ LobbyAttachment
       └─ LobbyTargetCompany (대상업체)

Notice (공지사항)
SystemLog (감사 로그)
NumberRule (자동발번 규칙) ── NumberRulePart
ConversionJob (변환 작업) ── Attachment
```

### 3.2 핵심 테이블 (요약)

```prisma
model User {
  id            String   @id @default(cuid())
  username      String   @unique
  passwordHash  String
  email         String?
  fullName      String
  organizationId String?
  employmentType  EmploymentType  // ACTIVE/RETIRED/PARTNER
  role          Role             // SUPER_ADMIN/ADMIN/USER/PARTNER
  securityLevel Int              @default(5) // 1~5
  signatureFile String?
  failedLoginCount Int @default(0)
  lockedUntil   DateTime?
  createdAt     DateTime @default(now())

  organization  Organization? @relation(fields: [organizationId], references: [id])
  groups        UserGroup[]
  ownedObjects  ObjectEntity[]
}

model Organization {
  id        String   @id @default(cuid())
  name      String
  parentId  String?
  sortOrder Int
  parent    Organization?  @relation("OrgTree", fields: [parentId], references: [id])
  children  Organization[] @relation("OrgTree")
  users     User[]
}

model Group {
  id    String  @id @default(cuid())
  name  String  @unique
  users UserGroup[]
}

model Folder {
  id         String   @id @default(cuid())
  parentId   String?
  name       String
  folderCode String   @unique
  defaultClassId String?
  sortOrder  Int
  parent     Folder?  @relation("FolderTree", fields: [parentId], references: [id])
  children   Folder[] @relation("FolderTree")
  permissions FolderPermission[]
  objects    ObjectEntity[]
}

model FolderPermission {
  id           String   @id @default(cuid())
  folderId     String
  principalType PrincipalType  // USER/ORG/GROUP
  principalId  String
  // 권한 비트
  viewFolder   Boolean  @default(false)
  editFolder   Boolean  @default(false)
  viewObject   Boolean  @default(false)
  editObject   Boolean  @default(false)
  deleteObject Boolean  @default(false)
  approveObject Boolean @default(false)
  download     Boolean  @default(false)
  print        Boolean  @default(false)
}

model ObjectEntity {  // 자료
  id            String  @id @default(cuid())
  number        String  @unique  // 도면번호
  name          String
  description   String?
  folderId      String
  classId       String
  securityLevel Int
  state         ObjectState  // NEW/CHECKED_OUT/CHECKED_IN/IN_APPROVAL/APPROVED/DELETED
  ownerId       String        // 등록자
  currentRevision Int   @default(0)
  currentVersion  Decimal @default(0.0)
  lockedById    String?  // 체크아웃 사용자
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  revisions     Revision[]
  attributes    ObjectAttributeValue[]
  links         LinkedObject[] @relation("LinkSource")
  linkedFrom    LinkedObject[] @relation("LinkTarget")
  activities    ActivityLog[]
}

model Revision {
  id        String   @id @default(cuid())
  objectId  String
  rev       Int
  versions  Version[]
  approval  Approval?
}

model Version {
  id          String   @id @default(cuid())
  revisionId  String
  ver         Decimal  // 0.1 단위 증가
  attachments Attachment[]
  createdAt   DateTime @default(now())
  createdBy   String
}

model Attachment {
  id           String  @id @default(cuid())
  versionId    String
  filename     String
  storagePath  String     // /data/files/yyyy/mm/uuid.dwg
  mimeType     String
  size         BigInt
  isMaster     Boolean  @default(false)
  checksumSha256 String
  // 변환 결과 캐시 경로
  pdfPath      String?
  dxfPath      String?
  svgPath      String?
  thumbnailPath String?
  conversionStatus ConversionStatus  // PENDING/PROCESSING/DONE/FAILED
}

model ObjectClass {
  id   String  @id @default(cuid())
  code String  @unique
  name String
  attributes ObjectAttribute[]
}

model ObjectAttribute {
  id        String  @id @default(cuid())
  classId   String
  code      String
  label     String
  dataType  AttrType  // TEXT/NUMBER/BOOLEAN/DATE/COMBO
  required  Boolean
  defaultValue String?
  comboItems Json?
  sortOrder Int
}

model NumberRule {
  id     String @id @default(cuid())
  classId String?
  parts  NumberRulePart[]
}

model NumberRulePart {
  id    String @id @default(cuid())
  ruleId String
  type  PartType  // FOLDER_CODE/LITERAL/SEQUENCE/YEAR
  value String?
  digits Int?
  initial Int?
  order  Int
}

model Approval {
  id          String  @id @default(cuid())
  revisionId  String  @unique
  title       String
  status      ApprovalStatus  // PENDING/IN_PROGRESS/APPROVED/REJECTED/CANCELLED
  requesterId String
  steps       ApprovalStep[]
  createdAt   DateTime @default(now())
}

model ApprovalStep {
  id         String  @id @default(cuid())
  approvalId String
  approverId String
  order      Int
  status     StepStatus  // WAITING/APPROVED/REJECTED
  comment    String?
  signatureFile String?
  actedAt    DateTime?
}

model Lobby {
  id        String  @id @default(cuid())
  folderId  String
  title     String
  description String?
  expiresAt DateTime?
  status    LobbyStatus  // NEW/IN_REVIEW/IN_APPROVAL/COMPLETED/EXPIRED
  createdBy String
  attachments LobbyAttachment[]
  targets   LobbyTargetCompany[]
}

model ConversionJob {
  id           String  @id @default(cuid())
  attachmentId String
  status       ConversionStatus
  attempt      Int
  errorMessage String?
  startedAt    DateTime?
  finishedAt   DateTime?
}

model ActivityLog {
  id        String   @id @default(cuid())
  objectId  String?
  action    String   // VIEW/EDIT/CHECKOUT/CHECKIN/APPROVE/DOWNLOAD/PRINT/DELETE
  userId    String
  ipAddress String?
  userAgent String?
  metadata  Json?
  createdAt DateTime @default(now())
}

model SystemLog {
  id        String   @id @default(cuid())
  level     String   // INFO/WARN/ERROR
  category  String
  message   String
  metadata  Json?
  createdAt DateTime @default(now())
}

model Notice {
  id          String   @id @default(cuid())
  title       String
  body        String
  isPopup     Boolean  @default(false)
  isActive    Boolean  @default(true)
  publishFrom DateTime
  publishTo   DateTime?
  createdAt   DateTime @default(now())
}

enum Role          { SUPER_ADMIN ADMIN USER PARTNER }
enum EmploymentType { ACTIVE RETIRED PARTNER }
enum ObjectState  { NEW CHECKED_OUT CHECKED_IN IN_APPROVAL APPROVED DELETED }
enum ApprovalStatus { PENDING IN_PROGRESS APPROVED REJECTED CANCELLED }
enum StepStatus  { WAITING APPROVED REJECTED }
enum AttrType    { TEXT NUMBER BOOLEAN DATE COMBO }
enum PartType    { FOLDER_CODE LITERAL SEQUENCE YEAR }
enum PrincipalType { USER ORG GROUP }
enum LobbyStatus { NEW IN_REVIEW IN_APPROVAL COMPLETED EXPIRED }
enum ConversionStatus { PENDING PROCESSING DONE FAILED }
```

### 3.3 인덱스 정책

| 테이블 | 인덱스 |
|---|---|
| ObjectEntity | (folderId, state), (number), (ownerId), GIN(name, description) trgm |
| Revision | (objectId, rev) UNIQUE |
| Version | (revisionId, ver) UNIQUE |
| Attachment | (versionId), (storagePath) UNIQUE |
| FolderPermission | (folderId, principalType, principalId) UNIQUE |
| ActivityLog | (userId, createdAt), (objectId, createdAt) |
| Approval | (status, createdAt), (requesterId) |
| ApprovalStep | (approvalId, order), (approverId, status) |

### 3.4 한글 전문 검색

- pg_trgm + GIN 인덱스로 부분일치 (자료명·도면번호·설명)
- 향후 `mecab-ko` 또는 `textsearch_ko` 도입 시 ts_vector 컬럼 추가
- 검색 우선순위: 도면번호 완전일치 > 도면번호 prefix > 자료명 trgm > 속성값 trgm

---

## 4. DWG 변환 파이프라인 ⭐

### 4.1 흐름

```
업로드(.dwg)
   │
   ├─ Attachment 레코드 + 원본 저장 (/data/files/yyyy/mm/uuid.dwg)
   │
   ├─ ConversionJob INSERT (PENDING) → BullMQ enqueue
   │
   ▼
워커 dequeue
   │
   ├─ 1단계: ODA File Converter (DWG → DXF)
   │           실패 시 → LibreDWG 재시도
   │
   ├─ 2단계: ODA File Converter (DWG → PDF)  ※ 플롯스타일별
   │           a. monochrome.ctb 적용 PDF
   │           b. 컬러 PDF (옵션)
   │
   ├─ 3단계: 썸네일 생성 (sharp + ghostscript)
   │           PDF 1페이지 → 256x256 PNG
   │
   ├─ 4단계: SVG 생성 (옵션, dxf-viewer용)
   │
   └─ Attachment.pdfPath/dxfPath/svgPath/thumbnailPath 업데이트
        ConversionJob.status = DONE
        WebSocket 또는 폴링으로 클라이언트 알림
```

### 4.2 변환 옵션

| 출력 | 용도 | 도구 |
|---|---|---|
| PDF (monochrome) | 일반 인쇄·미리보기 | ODA Converter --PdfOutput |
| PDF (컬러) | A3 컬러 인쇄 | ODA Converter (컬러 ctb) |
| DXF (R2018 LT) | dxf-viewer 렌더 | ODA Converter |
| SVG | 측정·레이어 토글용 | dxf2svg (자체) 또는 dxf-viewer 자체 렌더 |
| 썸네일 PNG | 목록·미리보기 | sharp(GS PDF→PNG) |

### 4.3 폰트·SHX 처리

- 서버 `/opt/oda/fonts/` 경로에 사내 표준 SHX·TTF 사전 배치
- 변환 시 `--FontMapping` 옵션으로 누락 폰트를 기본 폰트로 대체
- 사용자가 폰트 누락 발견 시 관리자에게 요청 → 폰트 풀에 추가

### 4.4 실패 처리

- 1차 실패: 5분 후 재시도 (max 3회)
- 3회 실패: ConversionJob.status=FAILED, errorMessage 저장
- 사용자 화면: "변환 실패 — 원본 다운로드만 가능" 표시
- 관리자 화면: 실패 작업 재시도 버튼

### 4.5 캐시 정책

- 변환 결과는 영구 보존 (도면 자체 삭제 시 함께 삭제)
- 도면 수정(체크인) 시 새 Version의 Attachment에 대해 신규 변환
- 캐시 무효화는 파일 자체 변경 시만

---

## 5. 인증·권한 설계

### 5.1 인증 흐름

1. POST /api/auth/login (username, password)
2. bcrypt 검증 → 실패 5회 시 30분 잠금 (User.lockedUntil)
3. 성공 시 JWT 발급 (HttpOnly, Secure, SameSite=Strict, 8h)
4. 미들웨어가 모든 보호 라우트에서 JWT 검증
5. 비밀번호 변경 시 모든 세션 무효화 (jti 블랙리스트)

### 5.2 권한 평가 알고리즘

```
canAccess(user, object, action) =
   1. user.role == SUPER_ADMIN → ALLOW
   2. object.ownerId == user.id → ALLOW (등록자 우선)
   3. object.securityLevel < user.securityLevel → DENY
   4. folderPermission(user|user.org|user.groups, object.folderId, action) == true → ALLOW
   5. ELSE DENY
```

행위 종류: VIEW_FOLDER, EDIT_FOLDER, VIEW, EDIT, DELETE, APPROVE, DOWNLOAD, PRINT.
체크인/체크아웃/개정/승인요청/응용프로그램실행 등은 EDIT 권한으로 묶고 상태 머신으로 전이 통제.

### 5.3 상태 머신 (서버측 검증)

```
NEW ─ checkin ─→ CHECKED_IN ─ release ─→ IN_APPROVAL ─ approve ─→ APPROVED
                       │                        │ reject
                       │ ←──────────────────────┘
                       │
                       └ checkout ─→ CHECKED_OUT ─ checkin ─→ CHECKED_IN
APPROVED ─ newRevision ─→ CHECKED_OUT
*  ─ delete ─→ DELETED ─ restore ─→ (이전 상태)
DELETED ─ purge ─→ (영구 삭제)
```

전이는 서버에서 강제 (클라이언트 상태값을 신뢰하지 않음).

---

## 6. API 설계 (REST)

### 6.1 명명 규칙
- `/api/v1/...`
- 인증: HttpOnly 쿠키 또는 `Authorization: Bearer <jwt>` (외부 연계용)
- 응답: `{ data, meta }` / 에러: `{ error: { code, message, details } }`

### 6.2 주요 엔드포인트 (요약)

| Method | Path | 설명 |
|---|---|---|
| POST | /api/v1/auth/login | 로그인 |
| POST | /api/v1/auth/logout | 로그아웃 |
| GET | /api/v1/me | 내 정보 |
| GET | /api/v1/folders | 폴더 트리 |
| POST | /api/v1/folders | 폴더 생성 (관리자) |
| GET | /api/v1/objects | 검색·목록 (쿼리: folderId, q, classId, state, page) |
| POST | /api/v1/objects | 신규등록 |
| GET | /api/v1/objects/:id | 상세 |
| PATCH | /api/v1/objects/:id | 수정 (체크아웃 상태에서) |
| POST | /api/v1/objects/:id/checkout | 체크아웃 |
| POST | /api/v1/objects/:id/checkin | 체크인 |
| POST | /api/v1/objects/:id/release | 승인요청 |
| POST | /api/v1/objects/:id/revise | 개정 |
| DELETE | /api/v1/objects/:id | 삭제 (폐기함 이동) |
| POST | /api/v1/objects/:id/restore | 복원 |
| POST | /api/v1/objects/:id/move | 이동 (도면번호 변경) |
| POST | /api/v1/objects/bulk-import | 일괄등록 (Excel + zip) |
| GET | /api/v1/objects/:id/versions | 버전 이력 |
| GET | /api/v1/attachments/:id/file | 원본 다운로드 |
| GET | /api/v1/attachments/:id/preview.pdf | 변환 PDF |
| GET | /api/v1/attachments/:id/preview.dxf | 변환 DXF |
| GET | /api/v1/attachments/:id/thumbnail | 썸네일 |
| POST | /api/v1/approvals | 결재 상신 |
| POST | /api/v1/approvals/:id/approve | 승인 |
| POST | /api/v1/approvals/:id/reject | 반려 |
| POST | /api/v1/approvals/:id/cancel | 결재취소 |
| GET | /api/v1/approvals?box=waiting|done|sent|trash | 결재함 |
| GET | /api/v1/lobbies | 로비함 목록 |
| POST | /api/v1/lobbies | 로비함 생성 |
| POST | /api/v1/lobbies/:id/recheck | 재확인요청 |
| GET | /api/v1/admin/users | 사용자 목록 |
| GET | /api/v1/admin/activity-log | 작업 이력 |
| GET | /api/v1/integration/equipments/:code/drawings | 설비코드 → 도면 (외부) |

### 6.3 외부 연계 — 설비관리 시스템

```
GET /api/v1/integration/equipments/{equipmentCode}/drawings
Auth: X-API-KEY: <key>
Resp: {
  data: [
    {
      number: "CGL-MEC-2026-00012",
      name: "...",
      currentRevision: 3,
      lastApprovedAt: "2026-04-10T...",
      previewUrl: "/api/v1/attachments/.../preview.pdf",
      detailUrl: "/objects/{id}"
    }
  ]
}
```

API Key는 관리자 화면에서 발급·취소. 호출 로그는 ActivityLog에 기록.

---

## 7. 마이그레이션 전략

### 7.1 단계
1. **추출**: TeamPlus DB 덤프 + 파일서버 디렉토리 복사
2. **매핑 분석**: TeamPlus 스키마 → 신규 Prisma 스키마 매핑표 작성
3. **변환 스크립트**: `packages/migration/` Node.js 스크립트로 ETL
4. **검증 환경 적재**: 별도 DB·파일경로에 적재, 차이 리포트 생성
5. **본 적재**: 무중단 윈도우(주말) 본 마이그레이션
6. **사후 검증**: 건수·체크섬·랜덤 표본 50건 비교

### 7.2 매핑 (TeamPlus → 신규)

| TeamPlus | 신규 |
|---|---|
| 사용자 | User |
| 조직 | Organization |
| 그룹 | Group |
| 폴더 | Folder + folderCode |
| 자료(Object) | ObjectEntity |
| 자료유형 | ObjectClass |
| 자료속성 | ObjectAttribute / Value |
| 리비전·버전 | Revision / Version |
| 첨부파일 | Attachment (storagePath 재할당) |
| 결재 | Approval / ApprovalStep |
| 로비함 | Lobby |
| 공지사항 | Notice |
| 작업이력 | ActivityLog |

### 7.3 도면번호 정합성
- 기존 번호 체계가 신규 자동발번 규칙과 다를 경우, 기존 번호는 "수동입력" 모드로 보존
- 충돌 검증: number UNIQUE 인덱스 위배 시 리포트, 수동 조정

---

## 8. 보안

### 8.1 Phase 1
- HTTPS (Nginx + 사내 인증서)
- 비밀번호 bcrypt (cost 12)
- JWT HttpOnly 쿠키, CSRF 토큰
- SQL Injection: Prisma 파라미터 바인딩
- XSS: React 이스케이프 + DOMPurify (사용자 입력 HTML 표시 시)
- 파일 업로드: 확장자 화이트리스트 + MIME sniff + 사이즈 제한 (단일 200MB)
- 감사 로그: 로그인·다운로드·삭제·승인·권한변경
- Rate Limit: 로그인 5회/분, API 100회/분

### 8.2 Phase 2 후보
- 워터마크(브라우저 미리보기 + PDF)
- 다운로드 추적 + DRM
- AD/LDAP 연동
- MFA (TOTP)

---

## 9. 성능·확장

| 항목 | 정책 |
|---|---|
| DB 커넥션 풀 | 20 |
| 변환 워커 | 동시 3 |
| 업로드 청크 | 5MB |
| 파일 스토리지 | 단일 디스크 (RAID1 권장) |
| 스케일 업 옵션 | 워커 N개로 수평 확장 (BullMQ) |
| 향후 | MinIO 도입 시 Attachment.storagePath만 교체 |

---

## 10. 운영

### 10.1 백업
- DB: `pg_dump` 일 1회 02:00 → /data/backup/db-YYYYMMDD.sql.gz
- 파일: `rsync /data/files → NAS` 주 1회 + 변경분 일 1회
- 보존: 최근 30일 + 분기말 1세트

### 10.2 로그
- 애플리케이션: pino → /data/logs/app-YYYYMMDD.log (90일)
- Nginx access/error: 30일
- ActivityLog DB: 1년

### 10.3 모니터링 (선택)
- Uptime Kuma — `/api/health` 헬스체크
- Postgres 디스크 사용량 알림 (>80%)

### 10.4 배포
```bash
git pull
docker compose pull
docker compose up -d --build
docker compose exec app npx prisma migrate deploy
```

### 10.5 롤백
- DB: 직전 dump 복구
- 코드: `git checkout <prev-tag> && docker compose up -d`

---

## 11. 테스트 전략

| 레벨 | 도구 | 범위 |
|---|---|---|
| Unit | Vitest | 권한 평가·상태 머신·자동발번 |
| Integration | Vitest + Testcontainers | Prisma·Auth·API |
| E2E | Playwright | 라이프사이클·검색·뷰어 (Phase 1 핵심 시나리오 5건) |
| 변환 | 실제 DWG 샘플 50건 | 변환 성공률 ≥ 95% |
| 부하 | k6 (가벼운 수준) | 동시 5사용자 동시 검색·뷰어 |

---

## 12. 라이선스 컴플라이언스

| SW | 라이선스 | 사용 형태 | 위험 |
|---|---|---|---|
| Next.js / React / Prisma / Tailwind | MIT/Apache | 결합 | 낮음 |
| PostgreSQL | BSD-style | 결합 | 낮음 |
| ODA File Converter | 무상 배포 | 별도 CLI 호출 (서버) | 낮음 — 사내 사용·재배포 시 약관 확인 |
| LibreDWG | GPLv3 | 별도 CLI 호출 (백업) | 낮음 — 별도 프로세스 호출이라 GPL 결합 회피 |
| Ghostscript | AGPL-3.0 | 별도 CLI 호출 | 낮음 — 사내 한정 사용 |
| dxf-viewer | MIT | 클라이언트 결합 | 낮음 |
| PDF.js | Apache-2.0 | 클라이언트 결합 | 낮음 |

> AGPL/GPL 도구는 모두 **서브프로세스 호출 형태**로만 사용해 결합 라이선스 전염을 회피한다.

---

## 13. 환경 변수 (.env 예시)

```
DATABASE_URL=postgresql://user:pass@postgres:5432/drawmgmt
REDIS_URL=redis://redis:6379
NEXTAUTH_SECRET=<32+ random>
NEXTAUTH_URL=https://drawing.dongkuk.local
FILE_STORAGE_ROOT=/data/files
ODA_CONVERTER_PATH=/opt/oda/ODAFileConverter
GS_PATH=/usr/bin/gs
INTEGRATION_API_KEY=<32+ random>
LOG_LEVEL=info
```

---

## 14. 가정·미정 항목

| 항목 | 상태 | 결정 필요 시점 |
|---|---|---|
| 설비관리 시스템 API 명세 | 미정 | W1 종료 전 |
| 사내 SSL 인증서 발급 | 미정 | W3 |
| 사내 표준 SHX/한글 폰트 인벤토리 | 미정 | W2 |
| 협력업체 접근 망 구성 | 미정 | W4 (운영 정책) |
| 자료유형 초기 셋 (기계/전기/계장/공정/일반) | 가정 | W2 (관리자와 합의) |
| TeamPlus DB 스키마 접근 | 미정 | W1 종료 전 (필수) |
