# TRD — 동국씨엠 도면관리시스템 재구축

| 항목 | 내용 |
|---|---|
| 문서명 | Technical Requirements Document |
| 버전 | v0.2 (Vercel 배포 옵션 + AI 챗봇 추가) |
| 대상 | 도면관리시스템 (Pure Web, 듀얼트랙: On-Prem 운영 / Vercel 개발·시연) |
| 라이선스 정책 | 100% 무료 OSS / 무상 배포 SW (단, LLM API·Vercel 호스팅은 종량제·상용) |
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
| **AI 챗봇 SDK** | **Vercel AI SDK 4** | Apache-2.0 | 스트리밍·도구 호출(Tool Use) 표준화, Next.js 통합 |
| **LLM Provider** | **Anthropic Claude (claude-sonnet-4-6)** | 종량제 API | 한글 자연어·도구 호출 안정성, 200K 컨텍스트 |
| **임베딩·벡터 검색 (기본)** | **pgvector + OpenAI text-embedding-3-small** (Vercel Postgres에 pgvector 확장 활성) | BSD-style / 종량제 | 챗봇 RAG 기본 모드 — 매뉴얼·자료 의미 검색 |
| **챗봇 폴백** | **자체 룰베이스 인텐트 매처** (regex/keyword → 도구 호출·고정 응답) | (자체) | pgvector·LLM 미가용 시 자동 폴백 (사내 격리·비용 절감) |
| **클라우드 배포 옵션** | **Vercel + Vercel Postgres(Neon) + Vercel Blob** | 상용 (Hobby 무료 / Pro 유상) | 서버리스 풀스택, 개발·시연 환경 |
| 클라우드 큐 (옵션) | Inngest 또는 Upstash QStash | 상용 (무료 티어) | Vercel 환경에서 BullMQ 대체 |
| 클라우드 변환 워커 | Railway / Fly.io / Render | 상용 (무료 티어) | ODA Converter 바이너리 호스팅 (Vercel 함수는 바이너리 미지원) |

### 1.2 대안과 결정 사유

| 후보 | 결정 | 사유 |
|---|---|---|
| Spring Boot vs Next.js | Next.js | 1인 1개월 + 바이브코딩 → 풀스택 TS가 LLM 어시스트 강함 |
| Django/FastAPI vs Next.js | Next.js | 프론트·백엔드 분리 시 스위칭 비용 큼 |
| MinIO vs 로컬 디스크 | 로컬 디스크 | 사용자 20명·동시 5명·중소 규모 → MinIO 오버엔지 |
| Elasticsearch vs PostgreSQL FTS | PostgreSQL | 데이터 < 10만 건 추정, 별도 인프라 부담 |
| LibreDWG vs ODA Converter | ODA 우선 | 변환 안정성 우수, GPL 전염 회피 (백업으로 LibreDWG) |
| AWS·NCP vs On-Prem | On-Prem | 사용자 요구사항 |
| 단일 배포 (On-Prem만) vs 듀얼트랙 | 듀얼트랙 | 개발·시연은 Vercel(빠른 반복·외부 시연), 운영은 On-Prem(사내망 자료 보호) |
| LangChain/LangGraph vs Vercel AI SDK | Vercel AI SDK | 단일 코드베이스, 도구 호출 단순, Next.js 통합·학습곡선 낮음 |
| OpenAI vs Anthropic Claude | Anthropic Claude | 한글 응답 자연성·도구 호출 안정성·200K 컨텍스트 |
| RAG(벡터검색) 단일 vs Tool Use 단일 | **RAG + Tool Use 결합** | 도면 검색은 Tool Use(권한·정확성), 매뉴얼·유사도 추천은 pgvector RAG (Vercel Postgres 기본 활성) |
| 챗봇 단일 모드 vs 모드 전환(auto) | **모드 전환** | 기본은 RAG, pgvector·LLM 미가용 시 룰베이스 자동 폴백 (사내망 격리·비용 절감 대응) |
| 챗봇 데이터 노출 (도면 본문) vs (메타데이터만) | 메타데이터만 | 도면 본문(BLOB)은 LLM 전송 금지, 메타·속성·이력만 허용 |

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

### 2.4 클라우드 배포 옵션 (Vercel) — 듀얼트랙

운영 환경은 사내 On-Prem(2.1)이 기본이지만, 동일 코드베이스를 Vercel에 배포해 개발·시연·외부 데모용으로 사용할 수 있도록 설계한다. 핵심은 **저장소·큐·워커·변환기를 어댑터 인터페이스로 추상화**하여 환경에 따라 구현체를 교체하는 것.

#### 2.4.1 어댑터 추상화

| 추상화 인터페이스 | On-Prem 구현 | Vercel 구현 |
|---|---|---|
| `Storage` | 로컬 디스크 (`/data/files`) | Vercel Blob (`@vercel/blob`) 또는 S3 |
| `Queue` | BullMQ + Redis | Inngest 또는 Upstash QStash |
| `DB` | 자체 PostgreSQL 16 (Docker) | Vercel Postgres (Neon, 서버리스) |
| `Converter` | 동일 컨테이너 내 워커 | 외부 호스팅(Railway/Fly) → HTTP 호출 |
| `Auth Session` | DB 세션 (Auth.js) | JWT 세션 (Auth.js) |
| `Cron` | Linux cron / pg_cron | Vercel Cron Jobs |
| `LLM` | 외부 Anthropic API (사내망 화이트리스트, 차단 시 룰베이스 폴백) | 외부 Anthropic API |
| `Embedding/Vector` | PostgreSQL + pgvector 확장 (옵션, 미설치 시 룰베이스) | **Vercel Postgres + pgvector 기본 활성** |
| `ChatBackend` | RAG 우선, pgvector·LLM 미가용 시 룰베이스 자동 폴백 | RAG 기본 (pgvector + Claude) |

`packages/shared/adapters/` 아래에 `StorageAdapter`, `QueueAdapter`, `ConverterAdapter` 인터페이스 정의 후 환경변수 `DEPLOY_TARGET=onprem|vercel` 로 팩토리 분기.

#### 2.4.2 Vercel 아키텍처 (개발·시연)

```
┌──────────────────────────────────────────────────────────────┐
│  사용자 브라우저 (외부 인터넷 / 사내)                          │
│      │ HTTPS                                                  │
│      ▼                                                        │
│  ┌────────────────────────────────┐                          │
│  │  Vercel (Next.js Functions)    │ ──► Anthropic Claude API │
│  │  • App Router (RSC)            │     (AI 챗봇 스트리밍)    │
│  │  • API Routes (Edge / Node)    │                          │
│  │  • Auth.js v5 (JWT)            │                          │
│  └──┬──────────────┬─────────┬────┘                          │
│     │              │         │                               │
│     ▼              ▼         ▼                               │
│  Vercel        Vercel      Inngest / QStash                  │
│  Postgres      Blob        (Queue + Trigger)                 │
│  (Neon)        (도면 파일)    │                              │
│                                ▼                              │
│                      ┌────────────────────────┐              │
│                      │ 외부 변환 워커          │              │
│                      │ (Railway/Fly/Render)    │              │
│                      │ • ODA File Converter   │              │
│                      │ • Ghostscript / sharp  │              │
│                      └────────────────────────┘              │
└──────────────────────────────────────────────────────────────┘
```

#### 2.4.3 제약·트레이드오프

- **함수 타임아웃**: Vercel Pro 기준 Edge 25s / Node 60s / Fluid Compute 800s. DWG 변환은 외부 워커로 분리하여 우회.
- **함수 사이즈**: 50MB 압축 / 250MB 비압축 → ODA·Ghostscript 바이너리 포함 불가 → 외부 워커 필수.
- **콜드 스타트**: Edge ~50ms, Node 서버리스 1~3초 → 챗봇 첫 응답 라우트는 `runtime = "edge"` 권장.
- **파일 보안**: 도면 본문이 외부 저장소에 적재됨 → 사내 보안정책 검토 필수. 운영은 On-Prem 권장.
- **비용**: Vercel Pro $20/mo + Postgres·Blob 사용량 + Claude API 종량제. 시연 규모는 무료 티어로도 충분.
- **외부 망 의존**: Vercel 환경에서는 사내 설비관리 시스템 연계가 어려움 → 통합 테스트는 On-Prem에서 수행.

#### 2.4.4 환경 분기

```
.env.local              # 로컬 개발
.env.preview            # Vercel Preview (PR별)
.env.production.vercel  # Vercel Production
.env.production         # On-Prem
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

ChatSession ── User (N:1)
            └─ ChatMessage (1:N) [role, toolCalls, toolResults, mode]

ManualChunk (RAG 매뉴얼 청크, pgvector 임베딩)  ※ 챗봇 RAG 모드 전용
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

model ChatSession {
  id        String   @id @default(cuid())
  userId    String
  title     String?            // 첫 메시지 요약 (자동 생성)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id])
  messages  ChatMessage[]
  @@index([userId, updatedAt])
}

model ChatMessage {
  id          String   @id @default(cuid())
  sessionId   String
  role        ChatRole           // SYSTEM/USER/ASSISTANT/TOOL
  content     String             // text/markdown
  toolCalls   Json?              // assistant가 호출한 도구·인자
  toolResults Json?              // 도구 실행 결과 (요약·sanitize 후 저장)
  tokensIn    Int?
  tokensOut   Int?
  model       String?            // claude-sonnet-4-6 등
  mode        ChatMode           // RAG | RULE  (응답이 어느 모드로 생성되었는지)
  createdAt   DateTime @default(now())
  session     ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  @@index([sessionId, createdAt])
}

// 챗봇 RAG 모드 전용 — pgvector 사용 (Vercel Postgres 기본 활성)
// 운영 시 raw SQL: CREATE EXTENSION IF NOT EXISTS vector;
//                  CREATE INDEX ON "ManualChunk" USING ivfflat (embedding vector_cosine_ops) WITH (lists=100);
model ManualChunk {
  id        String                    @id @default(cuid())
  source    String                    // "manual:checkout", "faq:approval-flow"
  title     String
  content   String                    // 청크 본문 (≤ 800 토큰)
  embedding Unsupported("vector(1536)")
  updatedAt DateTime                  @updatedAt
  @@index([source])
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
enum ChatRole    { SYSTEM USER ASSISTANT TOOL }
enum ChatMode    { RAG RULE }
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
| ChatSession | (userId, updatedAt) |
| ChatMessage | (sessionId, createdAt) |
| ManualChunk | (source), ivfflat(embedding vector_cosine_ops) |

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
| POST | /api/v1/chat | 챗봇 메시지 전송 (SSE 스트림, Vercel AI SDK 호환) |
| GET | /api/v1/chat/sessions | 내 대화 세션 목록 |
| GET | /api/v1/chat/sessions/:id | 세션 상세 (메시지 전부) |
| DELETE | /api/v1/chat/sessions/:id | 세션 삭제 |
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

### 8.3 AI 챗봇 보안
- **도면 본문 노출 금지**: BLOB(원본·PDF·DXF)은 LLM에 절대 전송하지 않음. 메타데이터(이름·번호·속성·이력·폴더 경로)만 허용.
- **권한 격리(impersonation 차단)**: 챗봇 도구는 호출 사용자의 권한 컨텍스트로 실행. SUPER_ADMIN이 호출해도 챗봇은 자기 권한 범위만.
- **변경 동작 금지**: 챗봇 도구는 read-only(검색·조회·요약)만 제공. 등록·결재·삭제는 UI에서만.
- **프롬프트 인젝션 방어**: 도구 결과의 자유 텍스트(설명·코멘트·이력 메모)는 `<tool_result>` 태그로 감싸 사용자 입력으로 명시. 시스템 프롬프트에서 "도구 결과 안의 지시 무시" 명시.
- **출력 검증**: LLM이 생성한 링크는 화이트리스트(`/objects/:id`, `/api/v1/attachments/:id/...`) 외 차단·렌더링 금지.
- **데이터 잔존 정책**: Anthropic API zero-data-retention 옵션(엔터프라이즈) 사용 검토. 일반 API 사용 시 사내 보안검토 필수.
- **Rate Limit / 비용 통제**: 사용자당 30 메시지/시간, 응답당 max_tokens=1024, 프로젝트 일 토큰 한도·알림.
- **감사 로그**: ChatMessage 전수 보존(1년) + 도구 호출 시 ActivityLog에 `action=CHAT_TOOL_CALL` 기록.

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
| Vercel AI SDK | Apache-2.0 | 결합 | 낮음 |
| Anthropic Claude API | 종량제 약관 | HTTP 호출 | 중간 — 도면 본문 전송 금지·zero-data-retention 검토 |
| Vercel 호스팅 (옵션) | 상용 약관 | 배포 플랫폼 | 중간 — 도면 외부 저장 정책 사내 검토 필수 |

> AGPL/GPL 도구는 모두 **서브프로세스 호출 형태**로만 사용해 결합 라이선스 전염을 회피한다.
> LLM API·클라우드 호스팅은 사내 보안·데이터 거버넌스 검토를 통과한 범위에서만 사용한다.

---

## 13. 환경 변수 (.env 예시)

```
# ── 공통 ──
DEPLOY_TARGET=onprem                    # onprem | vercel  (어댑터 팩토리 분기)
DATABASE_URL=postgresql://user:pass@postgres:5432/drawmgmt
NEXTAUTH_SECRET=<32+ random>
NEXTAUTH_URL=https://drawing.dongkuk.local
INTEGRATION_API_KEY=<32+ random>
LOG_LEVEL=info

# ── On-Prem 전용 ──
REDIS_URL=redis://redis:6379
FILE_STORAGE_ROOT=/data/files
ODA_CONVERTER_PATH=/opt/oda/ODAFileConverter
GS_PATH=/usr/bin/gs

# ── Vercel 배포 (옵션) ──
BLOB_READ_WRITE_TOKEN=<vercel blob token>
INNGEST_EVENT_KEY=<inngest>
INNGEST_SIGNING_KEY=<inngest>
EXTERNAL_CONVERTER_URL=https://converter.example.com   # Railway/Fly 변환 워커
EXTERNAL_CONVERTER_KEY=<api key>

# ── AI 챗봇 ──
CHAT_MODE=auto                           # auto | rag | rule  (auto = 자원 가용성에 따라 결정)
ANTHROPIC_API_KEY=<sk-ant-...>           # 비어 있으면 룰베이스 강제
LLM_MODEL=claude-sonnet-4-6
LLM_MAX_TOKENS=1024
CHAT_RATE_LIMIT_PER_HOUR=30
CHAT_DAILY_TOKEN_BUDGET=2000000          # 프로젝트 전체 일 한도
RULE_FALLBACK_ON_LLM_ERROR=true          # LLM 호출 실패 시 룰베이스로 폴백

# ── 챗봇 RAG (기본 모드) ──
PGVECTOR_ENABLED=true                    # Postgres에 pgvector 확장 설치 여부
EMBEDDING_PROVIDER=openai                # openai | voyage | none
EMBEDDING_API_KEY=<sk-...>               # EMBEDDING_PROVIDER=none이면 무시
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIM=1536
RAG_TOP_K=5                              # 컨텍스트로 주입할 청크 수
```

---

## 14. AI 챗봇 (자연어 검색·도우미) ⭐

### 14.1 목적·원칙
- "도면번호를 모르는데 무슨 단어로 검색해야 할지 모르겠다"는 사용자 진입장벽을 자연어로 해소
- 시스템 사용법 FAQ (등록·체크아웃·결재 절차 등) 즉답
- 내 결재함·작업 요약 같은 단순 운영 질의 자동 응답
- **변경 동작은 절대 수행 안 함** — 안내·검색·요약 전용
- **항상 동작**: 외부 LLM·임베딩 API가 차단된 환경에서도 룰베이스 폴백으로 핵심 기능 유지

### 14.2 동작 모드 (이중화)

| 모드 | 사용 조건 | 응답 생성 방식 | 외부 호출 |
|---|---|---|---|
| **`rag` (기본)** | `PGVECTOR_ENABLED=true` & `ANTHROPIC_API_KEY` 유효 & 임베딩 API 도달 가능 | LLM(Claude) + Tool Use + pgvector 컨텍스트 | Anthropic + 임베딩 API |
| **`rule` (폴백)** | 위 조건 중 하나라도 불충족, 또는 `CHAT_MODE=rule` | regex/keyword 인텐트 매칭 → 도구 호출 또는 고정 응답 템플릿 | 없음 (완전 사내 격리 가능) |

`CHAT_MODE=auto` 가 기본. 시작 시 헬스체크로 자원 가용성을 확인하여 모드 결정 + 1분 캐시.
런타임 LLM 호출 실패 시 `RULE_FALLBACK_ON_LLM_ERROR=true` 면 해당 요청은 룰모드로 즉시 재처리 → 사용자에게는 `mode: "rule"` 메타 + 안내 배너 노출.

### 14.3 사용 시나리오 (예시)

| 사용자 발화 | RAG 모드 | 룰 모드 |
|---|---|---|
| "2026년에 승인된 기계 도면 보여줘" | LLM이 `search_drawings({classCode:'MEC', state:'APPROVED', dateRange:'2026'})` 호출 + 자연어 요약 | 인텐트 `search` 매칭 → 동일 API 호출 → "검색 결과 N건" + 카드 |
| "CGL-MEC-2026-00012 어디 있어?" | LLM이 `get_drawing` 호출 + 위치·이력 자연어 요약 | 도면번호 정규식 매칭 → `get_drawing` 호출 → 카드 |
| "내 결재 대기 몇 건?" | `list_my_approvals` 호출 + 자연어 요약 | 인텐트 `my_approvals` 매칭 → 동일 호출 → 건수 + 카드 |
| "체크아웃이 뭐야?" | pgvector에서 매뉴얼 청크 top-K 검색 → LLM이 자연어 응답 | 인텐트 `help_checkout` 매칭 → 사전 작성 짧은 텍스트 |
| "어떤 도면이 SAS 라인 관련이야?" | pgvector 의미검색으로 유사 자료명·설명 추천 + LLM 정리 | 키워드 검색만 (동등 결과 안 나올 수 있음 → "정확 검색을 사용하세요" 안내) |
| "이 도면 삭제해" | **거절** — 변경 도구 없음 | **거절** — 인텐트 화이트리스트 외 |

### 14.4 아키텍처

```
사용자 입력
   │
   ▼
POST /api/v1/chat (Edge Runtime, SSE 스트림)
   │
   ├─ JWT 검증 → 사용자 권한 컨텍스트 주입
   ├─ Rate Limit 검사 (30 msg/hr)
   ├─ 모드 결정: chooseMode(env, healthCache) → "rag" | "rule"
   │
   ├──────────────────────────┬──────────────────────────┐
   │  [RAG 모드 — 기본]        │  [Rule 모드 — 폴백]       │
   ▼                          │                          ▼
1) 사용자 발화 임베딩          │           1) 인텐트 매처(intent classifier)
   (text-embedding-3-small)   │              · regex/keyword 카탈로그
   │                          │              · 도면번호·날짜·classCode 슬롯 추출
   ▼                          │              │
2) pgvector 검색              │              ▼
   · manual_chunks            │           2) 매핑된 도구 호출 또는 고정 템플릿
   · object_meta (옵션)       │              · search_drawings / get_drawing 등
   · 권한 필터 적용            │              · 권한 동일하게 적용
   │ (top-K=5)                │              │
   ▼                          │              ▼
3) Vercel AI SDK streamText   │           3) 응답 템플릿 렌더 (Handlebars)
   model: claude-sonnet-4-6   │              · 카드 동일 포맷으로 렌더
   tools: { search_drawings,  │              · 토큰 스트림 모사 (chunked write)
           get_drawing, ... } │              │
   system: 안전지침 + RAG     │              ▼
           컨텍스트 주입       │           SSE 종료
   maxSteps: 5                │
   │                          │
   ▼                          │
4) 도구 호출(필요 시)          │
   사용자 권한으로 내부 API 호출
   │
   ▼
5) 자연어 응답 스트림           │
                               │
   ↓                           ↓
   ChatMessage 저장 (mode 필드 포함)
   ActivityLog (action=CHAT_TOOL_CALL, mode)
```

### 14.5 도구(Tool) 명세 — 양 모드 공통

| 도구 | 입력 | 동작 | 권한 | RAG | Rule |
|---|---|---|---|---|---|
| `search_drawings` | q, classCode?, folderId?, state?, dateRange?, limit? | 사용자 권한 적용한 ObjectEntity 검색 | VIEW | ✓ | ✓ |
| `get_drawing` | number 또는 id | 상세(메타·현재 리비전·미리보기 URL) | VIEW | ✓ | ✓ |
| `list_my_approvals` | box: waiting/done/sent | 내 결재함 | 본인 | ✓ | ✓ |
| `get_recent_activity` | objectId, limit? | 최근 활동 이력 | VIEW | ✓ | △ (객체 ID 매칭 시만) |
| `get_help` | topic | 매뉴얼 단편 — RAG: pgvector top-K, Rule: 사전 텍스트 | 공개 | ✓ (RAG) | ✓ (사전 텍스트) |

> **변경 도구는 제공하지 않는다** (등록·삭제·체크인·결재 등). RAG·Rule 양 모드 모두 동일.

### 14.6 룰베이스 폴백 — 인텐트 카탈로그

선언적으로 `apps/web/lib/chat/rules.ts` 에 정의한다. 우선순위 상→하로 매칭.

| Intent | 매칭 패턴(예) | 추출 슬롯 | 동작 |
|---|---|---|---|
| `drawing_lookup` | `/^[A-Z]{2,5}-[A-Z]{2,4}-\d{4}-\d{4,5}$/` | `number` | `get_drawing(number)` |
| `search_by_class_year` | `(\d{4})년.*(기계|전기|계장|공정)` | `year`, `classCode` | `search_drawings({classCode, dateRange:year})` |
| `search_keyword` | `검색|찾|보여줘|리스트` + 명사 | `q` (전체 발화) | `search_drawings({q})` |
| `my_approvals` | `내 결재|대기.*결재|결재함` | `box` (default=waiting) | `list_my_approvals({box})` |
| `help_checkout` | `체크아웃|체크인.*어떻게|방법` | — | 사전 매뉴얼 텍스트 |
| `help_revision` | `개정.*어떻게|리비전.*올리` | — | 사전 매뉴얼 텍스트 |
| `help_register` | `등록.*어떻게|어떻게.*등록` | — | 사전 매뉴얼 텍스트 |
| `unknown` | 기타 | — | 빠른 답변 메뉴(도면검색·결재함·도움말) 표시 |

특징:
- 외부 호출 0회 (Anthropic·임베딩 API 미사용) → 사내 격리 환경에서 동작
- 응답 시간 ≤ 200ms (DB 쿼리 시간만)
- 의도 누락 시 메뉴로 graceful degrade
- 카탈로그는 코드형(typed)으로 관리 → 단위 테스트 가능 (Vitest)

### 14.7 RAG — pgvector 스키마

```prisma
// Prisma schema (별도 파일 또는 raw SQL 마이그레이션로 vector 타입 등록)
model ManualChunk {
  id        String                    @id @default(cuid())
  source    String                    // "manual:checkout", "faq:approval-flow"
  title     String
  content   String                    // 청크 본문 (≤ 800 토큰)
  embedding Unsupported("vector(1536)")
  updatedAt DateTime                  @updatedAt
}

// raw SQL: CREATE EXTENSION IF NOT EXISTS vector;
//          CREATE INDEX manual_chunk_emb_idx
//            ON "ManualChunk" USING ivfflat (embedding vector_cosine_ops)
//            WITH (lists = 100);
```

색인 운영:
- 매뉴얼 마크다운 → `pnpm chat:reindex` 스크립트로 청크 분할(≤800 토큰, 50 토큰 오버랩) → 임베딩 → upsert
- 자료명·설명 임베딩(옵션, Phase 2): `ObjectEntity` 트리거로 변경 시 큐에 reindex job
- 임베딩 비용: 매뉴얼 ~500 청크 × 0.5K 토큰 = 250K 토큰 → text-embedding-3-small 기준 ~$0.005 (1회성)

### 14.8 보안 (요약 — 상세는 §8.3)

- 도면 본문(BLOB) → LLM·임베딩 API 전송 금지, 메타데이터·매뉴얼만
- 도구는 호출자 권한으로 실행 (impersonation 차단) — RAG/Rule 동일
- 프롬프트 인젝션: 도구 결과·RAG 청크는 `<tool_result>` / `<context>` 태그로 감싸 사용자 입력으로 명시
- 출력 링크 화이트리스트 강제
- ChatMessage 전수 감사 로그 (1년 보존), `mode` 필드 포함
- Rule 모드는 LLM 미호출 → 프롬프트 인젝션 표면 자체가 작음 (보안 측면 추가 이점)

### 14.9 UI

- 메인 레이아웃 우하단 플로팅 챗 위젯 (shadcn/ui Drawer + Tailwind)
- `useChat()` (Vercel AI SDK) — 스트림 토큰 점진 렌더 (Rule 모드도 chunked write로 동일 UX)
- 도구 호출 결과는 카드 형태로 인라인 렌더 (검색 결과 카드 / 결재함 카드 / 도면 상세 카드)
- **모드 배지**: 응답 옆에 작은 배지 — `AI` (RAG) / `간이` (Rule). 사용자에게 한계를 솔직히 표시
- 룰모드일 때 빠른 답변 칩(quick replies): "도면 검색", "내 결재함", "체크아웃 방법", "등록 방법"
- 사이드바: "새 대화", "이전 대화 목록" (ChatSession 리스트)
- 모바일 미지원 (Phase 1과 동일 — Desktop only)

### 14.10 Phase 분리

| 기능 | Phase | 모드 | 비고 |
|---|---|---|---|
| 룰베이스 폴백 (인텐트 카탈로그 + 도구) | **1** | rule | 외부 의존성 0, 항상 동작 |
| 자연어 도면 검색·상세·결재함 (Tool Use) | 1 | rag | 핵심 |
| 매뉴얼 RAG (pgvector + manual_chunks) | **1** | rag | Vercel Postgres 기본 활성, 매뉴얼 청크 색인 |
| 자료명·속성 의미 검색(embedding) | 2 | rag | 트래픽 증가 시 색인 트리거 활성화 |
| 룰 인텐트 카탈로그 확장 (현장 발화 수집 후) | 2 | rule | 운영 로그 분석으로 추가 |
| 음성 입력 / TTS | 보류 | — | |
| 변경 동작(등록·결재·삭제 자동화) | **미지원** | — | 양 모드 모두 UI에서만 |

### 14.11 비용·성능 목표

| 항목 | RAG 모드 | Rule 모드 |
|---|---|---|
| 첫 토큰 응답 | ≤ 1.5초 (Edge + 스트림) | ≤ 200ms |
| 응답 완료 | ≤ 5초 (도구 1회 + 자연어 응답) | ≤ 500ms |
| 외부 API 호출 | Anthropic + 임베딩 | 없음 |
| 월 비용 (20명·1인 100msg) | ~6M 토큰 → Sonnet 4.6 ~$20~30/월 + 임베딩 ~$1/월 | $0 |
| 폴백 트리거 시 추가 지연 | LLM 실패 감지 후 룰 재처리 < 100ms | — |

---

## 15. 가정·미정 항목

| 항목 | 상태 | 결정 필요 시점 |
|---|---|---|
| 설비관리 시스템 API 명세 | 미정 | W1 종료 전 |
| 사내 SSL 인증서 발급 | 미정 | W3 |
| 사내 표준 SHX/한글 폰트 인벤토리 | 미정 | W2 |
| 협력업체 접근 망 구성 | 미정 | W4 (운영 정책) |
| 자료유형 초기 셋 (기계/전기/계장/공정/일반) | 가정 | W2 (관리자와 합의) |
| TeamPlus DB 스키마 접근 | 미정 | W1 종료 전 (필수) |
| **사내망에서 외부 LLM API 호출 허용 여부** | **미정** | **W1 (RAG 모드 사용 가부 결정)** — 차단 시 룰 모드 단독 운영 |
| Anthropic zero-data-retention 적용 가능 여부 | 미정 | W2 |
| Vercel 배포 범위 (개발만 / 시연 / 외부 데모 한정) | 미정 | W1 |
| **매뉴얼 컨텐츠 (RAG 청크 대상 문서·범위)** | **미정** | **W2 (Phase 1 RAG 색인 위해 필수)** |
| 임베딩 Provider (OpenAI vs Voyage vs 사내 임베딩) | 미정 | W2 |
| 룰베이스 인텐트 카탈로그 초기 셋 (현장 발화 5~10건 수집) | 미정 | W3 (관리자 인터뷰) |
| 외부 변환 워커 호스팅(Railway/Fly) 채택 여부 | 미정 | Vercel 배포 결정 시 |
