---
문서: 개발자 가이드 (Developer Guide)
대상 시스템: drawing-mgmt — 동국씨엠 도면관리시스템
대상 버전: R35 시점 main
작성일: 2026-04-27
대상 main HEAD: a045772 이후
대상 독자: 신규 기여자 / 기존 기여자 / 운영자(보조)
산출물 라운드: R35 (DOC-4 1차 본문)
연관 outline: docs/_specs/r32_manuals_outline.md §B
---

# drawing-mgmt 개발자 가이드

> 본 가이드는 신규 기여자가 30분 이내에 dev 환경을 부팅하고, 첫 PR을 보낼 수 있는 수준의
> 정보를 모아 둔다. 운영(production) 절차의 진수는 `docs/manuals/operations.md`(예정)에서 다룬다.

---

## 0. 시작하기 (30분 부팅 가이드)

### 0.1 5분 안에 시스템을 이해하기

drawing-mgmt는 동국씨엠 사내 도면(DWG/DXF/PDF) 관리 시스템이다. 핵심 가치 한 줄:

> AutoCAD 미설치 사용자도 브라우저만으로 모든 도면을 보고 인쇄할 수 있다.

- **기술 스택:** Next.js 14 App Router + TS / Prisma + Postgres 16 / Auth.js v5 / Tailwind +
  shadcn/ui / TanStack Query + Zustand + RHF + Zod / BullMQ + Redis
- **모노레포:** `apps/web` (UI + API) + `apps/worker` (변환/백업) + `packages/shared`
- **현 단계 1순위 (사용자 확정 2026-04-24):** 자체 DWG 뷰어 구현 (LibreDWG subprocess +
  three.js 직접 렌더). `dxf-viewer` npm 의존을 점진 제거 중.
- **라이선스 정책 절대 준수:**
  - 유료 SDK/API 금지 (ODA Teigha 등). 오픈소스만.
  - GPL 라이브러리(LibreDWG)는 **반드시 서버 subprocess(`dwg2dxf` CLI)로만** 호출. JS 바인딩
    import는 GPL 전염을 일으키므로 금지. 웹 앱 코드는 MIT/Apache 유지.

### 0.2 30분 부팅 절차

```bash
# 1) 클론 + 진입
git clone <repo-url> drawing-mgmt
cd drawing-mgmt

# 2) Node 20 / pnpm 9 확인
node -v   # >= 20
pnpm -v   # >= 9

# 3) env 복사 (필수: AUTH_SECRET 32자 이상으로 변경)
cp .env.example .env
# 또는 apps/web/.env.local
# AUTH_SECRET 생성: openssl rand -base64 32

# 4) Postgres + Redis 기동 (docker-compose.yml = dev 기본)
pnpm docker:up

# 5) 의존성 설치 + Prisma 클라이언트 생성
pnpm install
pnpm db:generate

# 6) 마이그레이션 + 시드
pnpm db:migrate
docker compose exec -T postgres \
  psql -U drawmgmt -d drawmgmt \
  < apps/web/prisma/migrations/manual/0001_pgvector.sql
pnpm db:seed

# 7) Next.js dev 서버
pnpm dev

# 8) (옵션) 워커 dev (변환/백업이 필요한 경우)
pnpm worker:dev
```

브라우저에서 `http://localhost:3000` 접속 → 시드 계정 중 하나로 로그인.

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123!` | SUPER_ADMIN |
| `manager` | `manager123!` | ADMIN |
| `kim` | `kim123!` | USER |
| `partner1` | `partner123!` | PARTNER |

> **함정 주의 (CLAUDE.md R3a/b/c 학습):** `prisma generate`를 한 번 실행하지 않으면 IDE에서
> 50개 이상의 phantom TypeScript 오류가 보인다. `pnpm db:generate` 1회 실행으로 해결.

---

## 1. 모노레포 구조

### 1.1 한 줄 설명

pnpm workspace 기반 3-pack 모노레포: 웹 앱 + 워커 + 공유 패키지.

### 1.2 패키지 구성

```
drawing-mgmt/
├── apps/
│   ├── web/                  # Next.js 14 App Router (FE + API routes)
│   │   ├── app/              # 라우트
│   │   ├── components/       # React 컴포넌트
│   │   ├── lib/              # 서버/클라이언트 유틸
│   │   ├── prisma/           # schema + migrations + seed
│   │   ├── __tests__/        # vitest unit tests
│   │   └── Dockerfile
│   └── worker/               # BullMQ worker (DWG/PDF 변환, 백업)
│       ├── src/
│       │   ├── index.ts          # 메인 dispatcher
│       │   ├── libredwg.ts       # GPL 격리 subprocess wrapper
│       │   ├── oda.ts            # ODA File Converter wrapper (옵션)
│       │   ├── pdf.ts            # PDF 변환 (Ghostscript)
│       │   ├── thumbnail.ts      # 썸네일 생성
│       │   ├── backup.ts         # pg_dump + 파일 tar
│       │   └── backup-worker.ts
│       └── Dockerfile
├── packages/
│   └── shared/               # FE+BE+worker 모두 import (Zod 스키마, ErrorCode, types)
│       └── src/
│           ├── types.ts
│           ├── permissions.ts    # 순수 canAccess (pure)
│           ├── conversion.ts
│           ├── storage.ts
│           ├── chat.ts
│           ├── constants.ts
│           └── index.ts
├── docs/
│   ├── PRD.md / TRD.md / DESIGN.md / WBS.md
│   ├── manuals/              # 사용자 매뉴얼, 본 가이드
│   └── _specs/               # 라운드별 designer 산출물 (git tracked)
├── docker-compose.yml        # dev (postgres + redis)
├── docker-compose.prod.yml   # production
└── pnpm-workspace.yaml
```

### 1.3 다이어그램

```
            ┌──────────────┐                  ┌──────────────┐
            │   Browser    │ ◄── HTTPS ──►   │    web       │
            │  (Chrome)    │                  │ Next.js 14   │
            └──────────────┘                  │  + Prisma    │
                                              └──────┬───────┘
                                                     │
                          ┌──────────────────────────┼─────────────────────┐
                          │                          │                     │
                          ▼                          ▼                     ▼
                   ┌────────────┐            ┌────────────┐         ┌────────────┐
                   │ Postgres16 │            │   Redis    │         │ FILE_STORAGE│
                   │  pgvector  │            │  (BullMQ)  │         │   (local/S3)│
                   └────────────┘            └─────┬──────┘         └─────▲──────┘
                                                   │                      │
                                                   ▼                      │
                                            ┌────────────┐                │
                                            │   worker   │ ──── write ────┘
                                            │ (BullMQ)   │
                                            └─────┬──────┘
                                                  │ subprocess only (GPL 격리)
                                       ┌──────────┼──────────┐
                                       ▼          ▼          ▼
                                  LibreDWG    ODA File    Ghostscript
                                  dwg2dxf     Converter   (PDF)
```

### 1.4 왜 worker가 별도 패키지인가

1. **GPL 격리:** LibreDWG는 GPL이지만 subprocess로만 호출하기 때문에 web 이미지에 binary가
   포함되지 않는다. worker 이미지에만 격리한다.
2. **시스템 의존:** worker는 sharp/pdf-lib/Ghostscript/ODA File Converter 등 시스템 binary에
   의존. web은 이런 의존 없이 가볍게 유지.
3. **스케일 분리:** 변환은 큐 기반 비동기 → web과 별도로 수평 확장 가능.

### 1.5 코드 hint

- `pnpm-workspace.yaml`
- `apps/web/package.json` (의존성)
- `apps/worker/package.json`
- `packages/shared/package.json`

---

## 2. 환경 변수

### 2.1 한 줄 설명

모든 환경 변수는 `.env.example` 1곳에 모여 있다. 시크릿은 절대 commit 금지.

### 2.2 변수 카테고리 표

> 정확한 기본값은 `.env.example`을 직접 참조. 본 표는 의미 요약.

| 카테고리 | 이름 | 필수 | 의미 / 예시 |
|---|---|---|---|
| Common | `DEPLOY_TARGET` | N | `onprem` / `vercel` |
| Common | `NODE_ENV` | N | `development` / `production` |
| Common | `LOG_LEVEL` | N | `info` / `debug` |
| DB | `DATABASE_URL` | Y | `postgresql://drawmgmt:drawmgmt@localhost:5432/drawmgmt` |
| Auth | `AUTH_SECRET` | Y | 32자 이상. `openssl rand -base64 32`로 생성. **commit 금지** |
| Auth | `NEXTAUTH_URL` | Y | `http://localhost:3000` (운영은 https URL) |
| SSO | `KEYCLOAK_ENABLED` | N | `0`/`1` — 1이면 Keycloak provider 활성 |
| SSO | `NEXT_PUBLIC_KEYCLOAK_ENABLED` | N | FE에서 SSO 버튼 노출 여부 (위와 mirror) |
| SSO | `KEYCLOAK_ISSUER` | N | `https://keycloak.your-company/realms/xxx` |
| SSO | `KEYCLOAK_CLIENT_ID` | N | OIDC client id |
| SSO | `KEYCLOAK_CLIENT_SECRET` | N | OIDC client secret. **commit 금지** |
| Backup | `BACKUP_ROOT` | N | `./.data/backups` |
| Backup | `BACKUP_RETENTION_DAYS` | N | `30` |
| Backup | `BACKUP_CRON_ENABLED` | N | `0`/`1` |
| Files | `REDIS_URL` | Y | `redis://localhost:6379` |
| Files | `FILE_STORAGE_ROOT` | Y | `./.data/files` (local 드라이버 시) |
| Convert | `ODA_CONVERTER_PATH` | N | ODA File Converter binary 경로 |
| Convert | `LIBREDWG_DWG2DXF_PATH` | N | LibreDWG `dwg2dxf` binary 경로 |
| Convert | `GS_PATH` | N | Ghostscript binary 경로 (`/usr/bin/gs`) |
| Storage | `STORAGE_DRIVER` | N | `local` (default) / `s3` |
| Storage | `S3_ENDPOINT` | s3 시 | `http://minio:9000` |
| Storage | `S3_REGION` | s3 시 | `us-east-1` |
| Storage | `S3_BUCKET` | s3 시 | `drawing-mgmt` |
| Storage | `S3_ACCESS_KEY_ID` | s3 시 | **commit 금지** |
| Storage | `S3_SECRET_ACCESS_KEY` | s3 시 | **commit 금지** |
| Storage | `S3_FORCE_PATH_STYLE` | N | `1`(MinIO) / `0`(AWS) |
| Integration | `INTEGRATION_API_KEY` | N | 외부 시스템 연동 키. **commit 금지** |
| Chat | `CHAT_MODE` | N | `auto` / `rule` / `llm` |
| Chat | `ANTHROPIC_API_KEY` | LLM 시 | **commit 금지** |
| Chat | `LLM_MODEL` | N | `claude-sonnet-4-6` |
| Chat | `LLM_MAX_TOKENS` | N | `1024` |
| Chat | `CHAT_RATE_LIMIT_PER_HOUR` | N | `30` |
| Chat | `CHAT_DAILY_TOKEN_BUDGET` | N | `2000000` |
| Chat | `RULE_FALLBACK_ON_LLM_ERROR` | N | `true` / `false` |
| RAG | `PGVECTOR_ENABLED` | N | `true` |
| RAG | `EMBEDDING_PROVIDER` | RAG 시 | `openai` |
| RAG | `EMBEDDING_API_KEY` | RAG 시 | **commit 금지** |
| RAG | `EMBEDDING_MODEL` | N | `text-embedding-3-small` |
| RAG | `EMBEDDING_DIM` | N | `1536` |
| RAG | `RAG_TOP_K` | N | `5` |
| Viewer | `NEXT_PUBLIC_USE_OWN_DXF_VIEWER` | N | `1`(R24+ default) / `0`(legacy) |
| Vercel | `BLOB_READ_WRITE_TOKEN` 등 | N | 옵션, 본 단계 미사용 |

### 2.3 명명 컨벤션

- `NEXT_PUBLIC_*` prefix는 **클라이언트 번들에 노출**된다. 시크릿은 절대 이 prefix를 쓰지 않는다.
- 그 외 변수는 서버 사이드만.
- Boolean은 `0`/`1` 또는 `true`/`false` 둘 다 사용. 코드 일관성을 위해 신규 변수는 `0`/`1`로.

### 2.4 시크릿 다루기

```bash
# 32자 이상 안전한 secret 생성
openssl rand -base64 32

# .env / .env.local / .env.production은 모두 .gitignore에 등록되어 있다
# .env.example만 commit 대상이다
```

---

## 3. 로컬 개발

### 3.1 한 줄 설명

Postgres 16 + Redis 7만 docker로 띄우고, 나머지(web/worker)는 host에서 `pnpm dev`로 실행.

### 3.2 docker-compose

루트의 `docker-compose.yml`은 dev 기본 — Postgres + Redis만 띄운다. (운영은 별도
`docker-compose.prod.yml`에서 web/worker까지 빌드.)

```bash
pnpm docker:up      # 또는 docker compose up -d
pnpm docker:down
```

### 3.3 첫 실행 순서 (`apps/web/prisma/README.md`와 1:1)

```bash
pnpm docker:up                                                  # 1. Postgres + Redis
pnpm db:generate                                                # 2. Prisma client
pnpm db:migrate                                                 # 3. 마이그레이션
docker compose exec -T postgres \
  psql -U drawmgmt -d drawmgmt \
  < apps/web/prisma/migrations/manual/0001_pgvector.sql         # 4. pgvector + pg_trgm GIN
pnpm db:seed                                                    # 5. 시드 (idempotent)
pnpm dev                                                        # 6. Next.js dev (3000)
pnpm worker:dev                                                 # 7. (옵션) 변환/백업 worker
```

### 3.4 데모 데이터 (`apps/web/prisma/seed.ts` + `apps/web/lib/demo-seed.ts`)

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123!` | SUPER_ADMIN |
| `manager` | `manager123!` | ADMIN |
| `kim` | `kim123!` | USER |
| `park` | `park123!` | USER |
| `lee` | `lee123!` | USER |
| `partner1` | `partner123!` | PARTNER |

시드는 모두 `upsert` 기반 — 재실행해도 데이터를 덮어쓰지 않는다. 처음부터 다시 시작하려면:

```bash
pnpm docker:down && docker volume rm drawing-mgmt_drawmgmt_db
```

### 3.5 함정 (CLAUDE.md 누적 학습)

- **`prisma generate` 미실행 시 IDE에 50+ phantom 오류:** R3a/b/c 라운드 학습. `pnpm db:generate` 1회.
- **`type "vector" does not exist`:** 4번(pgvector SQL)을 건너뜀. 또는 Postgres 이미지가
  pgvector 미포함. `docker-compose.yml`은 `pgvector/pgvector:pg16` 사용 — 다른 이미지 쓰면 직접 빌드 필요.
- **시퀀스 충돌(bulk register):** Phase-1은 `MAX(number)+1` per (folderCode, year). 동시 등록 시
  serializable isolation으로 감싼다. Phase 2에서 sequence table로 마이그레이션 예정.

---

## 4. Prisma schema 변경 절차

### 4.1 한 줄 설명

R27 D-1 baseline migration 도입 이후 모든 schema 변경은 `prisma migrate dev`로 처리.
manual SQL은 baseline 이전 + pgvector/trgm 같은 extension에 한정.

### 4.2 흐름

```bash
# 1) schema.prisma 수정
vi apps/web/prisma/schema.prisma

# 2) dev 마이그레이션 (자동 SQL 생성 + 적용)
pnpm --filter @drawing-mgmt/web prisma migrate dev --name add_xxx

# 3) 결과 SQL 검토 (커밋 대상)
git diff apps/web/prisma/migrations/

# 4) 클라이언트 재생성
pnpm db:generate

# 5) commit
git add apps/web/prisma/schema.prisma apps/web/prisma/migrations/
git commit -m "feat(db): add xxx"
```

### 4.3 운영 배포

```bash
pnpm --filter @drawing-mgmt/web exec prisma migrate deploy
```

CI 또는 진입점 컨테이너 entrypoint에서 1회 실행.

### 4.4 manual SQL 디렉토리

`apps/web/prisma/migrations/manual/`은 Prisma가 생성하지 않는 영역(extensions, GIN 인덱스 등):

- `0001_pgvector.sql` — `vector`, `pgcrypto`, `pg_trgm` extensions + `ivfflat` ANN 인덱스 + GIN trigram 인덱스
- `0005_r29_notification.sql`
- `0006_r29_conversion_thumbnail.sql`
- `0007_r31_upload.sql`
- `0008_r33_backup_keycloak.sql`

모두 idempotent (`IF NOT EXISTS`). `prisma migrate deploy` 후 1회 실행.

### 4.5 컨벤션

- migration 이름: `snake_case`, prefix `add_/alter_/drop_`
- DEFAULT 처리: NULL → NOT NULL 변경 시 backfill 단계 필수 (3-step: ① 컬럼 추가 nullable + default → ② backfill SQL → ③ NOT NULL 강제)
- baseline migration(R27): `apps/web/prisma/migrations/20260426000000_init/`

---

## 5. 변환 파이프라인 (BullMQ + ODA + LibreDWG + pdf-lib)

### 5.1 한 줄 설명

DWG → DXF/PDF 비동기 변환. ODA File Converter / LibreDWG는 **subprocess only** (GPL 격리).

### 5.2 시퀀스 다이어그램

```
[Browser]                [web]                [Redis(BullMQ)]            [worker]
   │                       │                          │                       │
   │  업로드 (POST upload) │                          │                       │
   │ ────────────────────► │                          │                       │
   │                       │  enqueue conversion job  │                       │
   │                       │ ───────────────────────► │                       │
   │                       │                          │  pop job              │
   │                       │                          │ ────────────────────► │
   │                       │                          │                       │
   │                       │                          │           subprocess: │
   │                       │                          │       ODA / LibreDWG  │
   │                       │                          │            ↓          │
   │                       │                          │           DXF         │
   │                       │                          │            ↓          │
   │                       │                          │       (PDF 필요시)    │
   │                       │                          │       Ghostscript     │
   │                       │                          │            ↓          │
   │                       │                          │     write to storage  │
   │                       │                          │     update DB row     │
   │  GET /admin/conversions(polling)                                         │
   │ ────────────────────► │ ────► DB ◄─────────────────────────────────────  │
   │ ◄─────────────────────│                                                  │
```

### 5.3 잡 상태 머신

```
pending  ──→ running ──→ completed
                ├──→ failed   (재시도 가능)
                └──→ retrying (max retry 도달 시 → failed)
```

상태/카운트는 `apps/web/app/(main)/admin/conversions/page.tsx`(R28)에서 관리자가 모니터링.

### 5.4 GPL 격리 (절대 위반 금지)

> **CLAUDE.md 라이선스 정책:**
> GPL 라이브러리(LibreDWG)는 서버 subprocess(`dwg2dxf` CLI)로만 호출. JS 바인딩 import는
> GPL 전염을 일으키므로 금지. 웹 앱 코드는 MIT/Apache 유지.

`apps/worker/src/libredwg.ts`는 child_process로 binary를 호출하는 wrapper만 둔다. 절대
`@libredwg/wasm` 같은 npm 패키지를 import하지 않는다 (있더라도). `apps/web`은 LibreDWG 호출
경로가 0개여야 한다 — 의심스러우면 `grep -r libredwg apps/web/` 확인.

### 5.5 재시도 (R28)

- 행별 재시도 API: `POST /api/v1/admin/conversions/jobs/[id]/retry`
- BullMQ backoff: 지수형 (default 3회)

### 5.6 코드 hint

- 워커 메인: `apps/worker/src/index.ts`
- 큐 enqueue: `apps/web/lib/conversion-queue.ts`
- LibreDWG wrapper: `apps/worker/src/libredwg.ts`
- ODA wrapper: `apps/worker/src/oda.ts`
- PDF: `apps/worker/src/pdf.ts`
- 썸네일: `apps/worker/src/thumbnail.ts`
- 모니터 페이지: `apps/web/app/(main)/admin/conversions/page.tsx`
- 모니터 API: `apps/web/app/api/v1/admin/conversions/jobs/`

---

## 6. 자체 DXF 뷰어 (`lib/dxf-parser` + `components/DwgViewer`)

### 6.1 한 줄 설명

three.js + 자체 DXF 파서로 브라우저 직접 렌더. **현 단계 1순위.** 기존 `dxf-viewer` npm
의존을 점진 제거 중.

### 6.2 레이어 다이어그램

```
   ┌──────────────────────────────────────────────────────────────┐
   │                    apps/web/components/DwgViewer/             │
   │                                                               │
   │   DwgViewer.tsx ─────► scene.ts ────► three.js Scene          │
   │        │                  │                                   │
   │        │                  ├─► OrthographicCamera (camera.ts)  │
   │        │                  └─► BufferGeometry × N              │
   │        │                                                      │
   │        └─► dxf-worker-client.ts ───── (Web Worker) ──┐        │
   │                                                       │        │
   └───────────────────────────────────────────────────────┼────────┘
                                                           │
   ┌───────────────────────────────────────────────────────┼────────┐
   │                     apps/web/lib/                     ▼        │
   │                                                                │
   │   dxf-parser/parser.ts  ── 토큰 파싱 (LINE/ARC/TEXT/...)        │
   │   viewer/dxf-engine.ts  ── 파싱 결과를 BufferGeometry로 변환    │
   │   viewer/measurements.ts ─ 측정 (clipSegmentToHatch)            │
   │   viewer/keyboard.ts     ─ 단축키 처리                          │
   │                                                                │
   └────────────────────────────────────────────────────────────────┘
```

### 6.3 지원 entity (현 단계)

`apps/web/lib/dxf-parser/parser.ts` 기준:

- LINE
- CIRCLE
- ARC
- LWPOLYLINE
- TEXT / MTEXT
- INSERT (블록 인스턴스)
- HATCH (solid 패턴 only)
- DIMENSION

### 6.4 성능 가이드

- **BufferGeometry 재사용:** 같은 entity 타입은 한 번 생성 후 instancing.
- **frustum culling:** OrthographicCamera + viewport 외 entity는 스킵.
- **viewport-aware lazy load:** 큰 도면(>10MB)은 청크 파싱 진행률 표시.
- **Web Worker 파싱:** `dxf-worker.ts`에서 메인 스레드 차단 회피.
- **테스트 기준:** 동일 도면 첫 렌더 < 1초, 재진입 캐시 hit < 500ms (PRD §5.1).

### 6.5 환경 변수

- `NEXT_PUBLIC_USE_OWN_DXF_VIEWER=1` (R24+ default) — 자체 엔진
- `=0` — 레거시 `dxf-viewer` npm 폴백 (긴급 시)
- per-tab override: URL `?engine=legacy`

### 6.6 viewer-engineering 스킬 참조

`.claude/skills/viewer-engineering/SKILL.md` — 뷰어 작업 시 viewer-engineer agent가 반드시
먼저 읽는 도메인 가이드. three.js Scene 구성, OrthographicCamera, BufferGeometry 최적화,
LibreDWG subprocess 격리 같은 토픽이 등장하면 이 스킬을 사용한다.

### 6.7 코드 hint

- 뷰어 컴포넌트: `apps/web/components/DwgViewer/`
  - `DwgViewer.tsx` — React 진입
  - `scene.ts` — three.js Scene 구성
  - `camera.ts` — OrthographicCamera + zoom/pan
  - `dxf-worker-client.ts` / `dxf-worker.ts` — Web Worker 파싱
- 자체 DXF 파서: `apps/web/lib/dxf-parser/`
- 뷰어 엔진: `apps/web/lib/viewer/`
- 측정 hatch clip 단위 테스트: `apps/web/__tests__/clip-segment.test.ts`

---

## 7. 권한 모델 (FolderPermission + canAccess)

### 7.1 한 줄 설명

폴더 단위 비트 권한 (VIEW_FOLDER / EDIT_FOLDER / VIEW_OBJECT / EDIT_OBJECT / DELETE_OBJECT /
APPROVE_OBJECT / DOWNLOAD / PRINT)을 USER/ORG/GROUP principal에 부여.
**본인 등록 자료는 보안등급 무관 모든 권한**(FR-FOLDER-05).

### 7.2 비트 표

| 비트 | 의미 |
|---|---|
| `viewFolder` | 폴더 트리에 폴더 자체가 보인다 |
| `editFolder` | 폴더 신규 자료 등록, 하위 폴더 생성 |
| `viewObject` | 자료 list/상세 조회 |
| `editObject` | 자료 메타/첨부 수정 (체크아웃 포함) |
| `deleteObject` | 자료 삭제 (폐기함 이동) |
| `approveObject` | 결재 라인에서 승인/반려 |
| `download` | 원본 zip 다운로드 (R31에서 print와 동등 처리) |
| `print` | PDF 출력 (download와 묶임) |

### 7.3 결정 로직 의사 코드

> 출처: `packages/shared/src/permissions.ts` `canAccess` (pure function — DB I/O 없음)
> 평가 헬퍼: `apps/web/lib/permissions.ts` (Prisma 로더 wrapper)

```ts
// 0) Super admin은 모든 것을 통과
if (user.role === 'SUPER_ADMIN') return { allowed: true };

// 1) 본인 등록 자료 예외 (보안등급 무관)
if (object.ownerId === user.id) return { allowed: true };

// 2) 보안등급 가드 (object 액션 한정)
if (action.startsWith('VIEW_OBJECT' | 'EDIT_OBJECT' | ...) {
  if (object.securityLevel > user.securityLevel) {
    return { allowed: false, reason: 'SECURITY_LEVEL' };
  }
}

// 3) 폴더 비트 평가
//    principal 우선순위: USER > GROUP > ORG (가장 좁은 범위가 win)
const rows = perms.filter(p => p.folderId === object.folderId);
const userRow  = rows.find(p => p.principalType === 'USER'  && p.principalId === user.id);
const groupRow = rows.find(p => p.principalType === 'GROUP' && user.groupIds.includes(p.principalId));
const orgRow   = rows.find(p => p.principalType === 'ORG'   && p.principalId === user.organizationId);

const effective = userRow ?? groupRow ?? orgRow;
if (!effective) return { allowed: false, reason: 'NO_PERMISSION' };

const bitName = mapActionToBit(action); // VIEW_OBJECT → viewObject 등
return effective[bitName] ? { allowed: true } : { allowed: false, reason: 'NO_PERMISSION' };
```

> 정확한 함수 시그니처는 `packages/shared/src/permissions.ts` 참조. 본 의사코드는 핵심 분기만 발췌.

### 7.4 단위 테스트 후보

`apps/web/__tests__/permissions.test.ts` (R32 T-1으로 정착, 195줄). 분기:

- SUPER_ADMIN bypass
- 본인 등록 자료 예외
- 보안등급 차단
- principal 우선순위 (USER > GROUP > ORG)
- 비트 매핑 (VIEW_OBJECT → viewObject)
- folderId 미스매치 (no row)

```ts
// 예시
it('owner bypasses securityLevel', () => {
  const user = mkUser({ id: 'u1', securityLevel: 1 });
  const obj  = mkObject({ ownerId: 'u1', securityLevel: 5 });
  const decision = canAccess(user, obj, [], 'VIEW_OBJECT');
  expect(decision.allowed).toBe(true);
});
```

### 7.5 매트릭스 UX (R28)

`/admin/folder-permissions` 페이지 — `<PermissionMatrix>` 컴포넌트.

- dirty / new / removed 상태를 `border-l-2`로 시각화
- 우상단 `▴N 변경` 카운터
- 일괄 저장 시 dryrun → confirm → 저장 흐름

### 7.6 코드 hint

- `apps/web/lib/permissions.ts` — 서버 헬퍼 (toPermissionUser / loadFolderPermissions / checkObjectAccess)
- `packages/shared/src/permissions.ts` — pure canAccess
- `apps/web/prisma/schema.prisma` — `FolderPermission` 모델
- `apps/web/app/(main)/admin/folder-permissions/page.tsx` — R28 매트릭스
- `apps/web/components/permission-matrix/PermissionMatrix.tsx`
- 단위 테스트: `apps/web/__tests__/permissions.test.ts`

---

## 8. drawing-mgmt-team 하네스 (5인 팀 worktree 격리)

### 8.1 한 줄 설명

PM(Claude 메인 세션) + designer + frontend + backend + viewer-engineer 5인이 worktree 격리
병렬로 작업 → PM이 main에 통합. **디자인 → API 계약 → 병렬 구현 → 점진 QA** 흐름.

### 8.2 페이즈

```
Phase 1: PM이 요구사항을 카드로 분해
   ↓
Phase 2: designer가 카드별 디자인 스펙 작성 (docs/_specs/r{N}_*.md, git tracked)
   ↓
Phase 3: 4명의 에이전트(designer/frontend/backend/viewer-engineer)가
         각자 worktree(.claude/worktrees/agent-XXX/)에서 병렬 작업
   ↓
Phase 4: PM이 통합 검증
   - main HEAD가 Phase 3 시작 시점과 같은가? (격리 위반 검증)
   - 각 worktree의 base SHA가 일치하는가?
   - main working tree clean인가?
   - pnpm install --frozen-lockfile (lockfile 동기화)
   - typecheck / lint / build 통과?
   - 머지
   ↓
Phase 5: QA (기능 카드별 수동 시나리오)
```

### 8.3 핵심 운영 원칙

- 모든 에이전트는 반드시 `isolation: "worktree"`로 호출 (메모리 `feedback_agent_isolation.md`)
- 모든 에이전트 호출에 `model: "opus"` 명시
- API 계약(`_workspace/api_contract.md`)을 먼저 쓰고 코드는 그다음 — FE/BE drift의 단일 예방선
- `_workspace/`는 `.gitignore` 등록 (커밋 안 됨). 단, designer 산출물은 git tracked 경로
  (`docs/_specs/`, `docs/manuals/`)에 commit (R28 학습)

### 8.4 의무 가드 표

| 시점 | 가드 | 사유 |
|---|---|---|
| 에이전트 시작 시 | `git fetch && git merge --ff-only main` (또는 rebase) | worktree가 과거 SHA에서 분기 방지 (R1) |
| 에이전트 시작 시 | 첫 응답에서 `git rev-parse HEAD` 보고 | base SHA 검증 (R29) |
| 에이전트 작업 중 | 본인 worktree 외 cwd 이동 금지 | isolation (R3a) |
| 에이전트 작업 중 | main 브랜치 직접 manipulate 금지 | isolation (R3a) |
| 에이전트 종료 시 | worktree branch tip에 commit | 산출물 영속화 (R1) |
| PM Phase 4 직전 | main working tree clean 확인 (`git status`) | sandbox snapshot 사고 (R30/R31) |
| PM Phase 4 직전 | `pnpm install --frozen-lockfile` | lockfile drift (R28) |
| PM Phase 4 직전 | base SHA / merge-base 검증 | isolation (R29) |
| PM contract 작성 시 | "아마/~인 듯" 어휘 금지 | endpoint 의미 추측 금지 (R2) |
| Backend 호출 시 | worktree에서 `prisma generate` 1회 | 50+ phantom 오류 회피 (R3a/b/c) |

### 8.5 누적 학습 (CLAUDE.md 변경 이력)

| 라운드 | 학습 |
|---|---|
| R1 | worktree 동기화/commit 가드 추가 |
| R2 | endpoint 이름만 보고 의미 추측 금지 — `route.ts` + `state-machine.ts` 직접 read |
| R3a | backend agent의 commit이 main에 직접 ff됨 → isolation 가드 강화 |
| R3a/b/c | Mutation 패턴(useObjectMutation factory / rowMutation discriminated union) 정착 |
| R28 | designer 산출물을 `_workspace/`에만 두면 worktree 정리로 손실 → `docs/_specs/`에 commit 의무화 |
| R29 | base SHA 검증 강화 |
| R30/R31 | main working tree clean 검증 의무화 |

### 8.6 신규 기여자 진입로

1. **첫 라운드는 PM 호출만 따라간다.** `drawing-mgmt-team` 스킬을 트리거하고 PM이 카드를
   분해하는 과정을 관찰.
2. **두 번째 라운드부터는 designer 또는 frontend agent로 참여.** 산출물을
   `docs/_specs/r{N}_*.md`로 commit.
3. **3개 라운드 누적 후 backend / viewer-engineer 도전.** GPL 격리·BufferGeometry 최적화 같은
   도메인 컨텍스트가 필요한 영역.

### 8.7 코드/문서 hint

- 에이전트 정의: `.claude/agents/drawing-mgmt-{pm,designer,frontend,backend,viewer-engineer}.md`
- 오케스트레이터 스킬: `.claude/skills/drawing-mgmt-team/SKILL.md`
- 뷰어 가이드: `.claude/skills/viewer-engineering/SKILL.md`
- 라운드별 spec: `docs/_specs/r{N}_*.md`
- 누적 학습: 루트 `CLAUDE.md`의 변경 이력 표

---

## 9. 테스트 (R32 T-1)

### 9.1 한 줄 설명

vitest 단위 테스트 + 점진적 e2e (Playwright). FE 위주, 핵심 비즈니스 로직 우선.

### 9.2 환경 구성

- `apps/web/vitest.config.ts` — happy-dom + @testing-library/react
- `apps/web/vitest.setup.ts` — 글로벌 setup (cleanup 등)
- 테스트 위치: `apps/web/__tests__/` 또는 colocate `*.test.ts`

### 9.3 현재 테스트 (R32 T-1)

| 파일 | 대상 |
|---|---|
| `apps/web/__tests__/permissions.test.ts` | `canAccess` 분기 (195 LOC) |
| `apps/web/__tests__/clip-segment.test.ts` | `clipSegmentToHatch` (뷰어 측정) |
| `apps/web/__tests__/activity-labels.test.ts` | 알림 라벨 매핑 |
| `apps/web/__tests__/storage-local.test.ts` | local storage driver |

### 9.4 컨벤션

- AAA 패턴: Arrange / Act / Assert
- factory: `mkUser()`, `mkObject()`, `mkPerm()` (각 테스트 파일 상단에서 직접 정의)
- happy-dom 환경 (jsdom 대체) — 가벼움
- React Testing Library: `render` / `screen.getByRole` / `userEvent`

### 9.5 실행

```bash
pnpm -F web test        # 1회 실행
pnpm -F web test --watch # watch 모드
pnpm -F web test:e2e    # Playwright (옵션, manual trigger)
```

### 9.6 다음 추가 후보

- `state-machine.canTransition` 분기
- `chunk-upload` 청크 분할 로직
- `csrf` 검증
- `rate-limit` window 카운트

### 9.7 e2e (Playwright)

Phase 2 — 시간 비용이 크므로 manual trigger only. 핵심 시나리오:

- 로그인 → 검색 1건 → 상세 → 뷰어 렌더
- 자료 등록 → 변환 완료 알림 → 인쇄

### 9.8 CI 통합

`.github/workflows/ci.yml` (R32 X-3):

```yaml
jobs:
  test-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:generate
      - run: pnpm -F web test
```

---

## 10. 배포 (`docker-compose.prod.yml`) — 미리보기

> 운영(production) 진수는 별도 운영 문서로 분리될 예정 (R32 outline §C — `docs/manuals/operations.md`).
> 본 항목은 PR을 보낼 개발자가 빌드/스모크 테스트를 하기 위한 1쪽 요약.

### 10.1 빌드 + 기동

```bash
# .env.production 준비 (DATABASE_URL / AUTH_SECRET / REDIS_URL / FILE_STORAGE_ROOT 등)
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

기동 서비스:

- `drawmgmt-postgres` (16-alpine, healthcheck 포함)
- `drawmgmt-redis` (7-alpine, AOF on)
- `drawmgmt-web` (apps/web/Dockerfile, port 3000만 외부 노출)
- `drawmgmt-worker` (apps/worker/Dockerfile, GPL binary 포함)

### 10.2 마이그레이션 (운영 첫 배포)

```bash
docker compose -f docker-compose.prod.yml run --rm web pnpm -F web prisma migrate deploy
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U $POSTGRES_USER -d $POSTGRES_DB \
  < apps/web/prisma/migrations/manual/0001_pgvector.sql
```

### 10.3 스모크 테스트

```bash
# 1) 헬스체크
curl -fsS https://{host}/api/v1/health        # 200 기대

# 2) docker compose 상태
docker compose -f docker-compose.prod.yml ps
# 모든 서비스 (healthy)

# 3) 시나리오
#  - admin 로그인 → /search 한 건 조회 → 상세 → 뷰어 렌더 OK
```

### 10.4 라이선스 메모

- LibreDWG(GPL)는 worker 이미지 안에서만 — `dwg2dxf` subprocess. web 이미지는 포함하지 않는다.
- ODA File Converter binary는 라이선스가 사용자 환경에 의존. compose에서는 path만 환경변수로 받는다.

### 10.5 코드 hint

- `apps/web/Dockerfile` (R32 X-1.a)
- `apps/worker/Dockerfile` (R32 X-1.b, LibreDWG binary 포함)
- `docker-compose.prod.yml` (R32 X-1.c)
- `.github/workflows/ci.yml` (R32 X-3)

---

## 11. R36~R44 신규 기능 (개발자 catch-up)

> 0~10장은 R35 baseline 기준. 그 이후 라운드의 dev-facing 변경을 한 곳에 모아 둠. 11.x는 임시 catch-up — 다음 manual 리팩터에서 해당 챕터로 흡수 예정.

### 11.1 통합 테스트 인프라 (R36 T-2)

- `apps/web/__tests__/integration/` — `*.int.test.ts` 패턴.
- `VITEST_INTEGRATION=1`로 분기 — 평소 vitest run에서는 skip.
- `apps/web/__tests__/integration/setup.ts` — 테스트 DB 시드/cleanup helper.
- 5개 샘플 spec 동봉(auth/object/folder/approval/lobby).
- 실행: `VITEST_INTEGRATION=1 pnpm -F web test`.

### 11.2 ClamAV 바이러스 스캔 워커 (R36 V-INF-3)

- 큐: `virus-scan` (BullMQ).
- Worker: `apps/worker/src/scan-worker.ts` + `apps/worker/src/clamav.ts`.
- ClamAV는 GPL → subprocess only(`clamscan` 또는 clamd TCP). JS 바인딩 import 금지.
- Attachment.virusScanStatus enum: PENDING/SCANNING/CLEAN/INFECTED/SKIPPED/FAILED.
- INFECTED 가드: 5개 라우트(다운로드/미리보기/인쇄/썸네일/뷰어 source)가 자동 차단.
- 환경 변수: `CLAMAV_ENABLED`, `CLAMAV_BINARY`, `CLAMAV_HOST`, `CLAMAV_PORT`.

### 11.3 SAML SSO + HMAC bridge token (R37 A-2)

- node-saml(MIT) — IdP redirect → ACS endpoint(`/api/v1/auth/saml/acs`) → `auth.ts`의 `samlBridge` 모드.
- HMAC bridge token: ACS가 사용자 row 프로비저닝 후 5분 ttl HMAC token mint → callback URL의 query로 전달 → Auth.js v5 Credentials provider가 `{ samlBridge }` 모드로 verify.
- 마이그 0011 — User.externalId, User.externalIdProvider.
- 환경 변수: `SAML_ENABLED`, `SAML_IDP_METADATA_URL`, `SAML_SP_ENTITY_ID`, `SAML_SP_CALLBACK_URL`.
- 관련: `apps/web/lib/saml.ts`, `apps/web/auth.ts`의 `authorizeSamlBridge`.

### 11.4 WCAG 2.1 AA audit (R37 AC-1)

- 13개 핵심 화면 audit 결과 → `docs/_specs/r37_wcag_audit.md`.
- P0/P1 fix: focus-visible ring 토큰, ARIA role/label, 색대비 4.5:1.
- 추가된 토큰은 `docs/DESIGN.md` §2.x에 반영.

### 11.5 DXF Line2 + lineWeight (R37 V-2)

- `apps/web/components/DwgViewer/scene.ts` — Line2(three.js examples).
- DXF 그룹 코드 370 인식 + 디바이스 픽셀 비율 보정.
- 10건 vitest case 동봉.

### 11.6 SMS / 카카오 채널 (R38 N-2)

- 큐: `sms`, `kakao`(BullMQ, 채널 독립).
- Worker: `apps/worker/src/sms-worker.ts` + `apps/worker/src/sms.ts`(Twilio Apache 2.0 lazy import 또는 NCP SENS native fetch). `apps/worker/src/kakao.ts`(템플릿 기반, native fetch).
- enqueueNotification fan-out: notifyByEmail/Sms/Kakao 토글에 따라 각각 enqueue.
- 환경 변수: `SMS_ENABLED`, `SMS_DRIVER`(twilio|ncp|noop), `KAKAO_ENABLED`.
- 마이그 0012 — User.phoneNumber, User.notifyBySms, User.notifyByKakao.

### 11.7 MFA TOTP + 비밀번호 정책 (R39 + R40)

- `apps/web/lib/totp.ts` — otpauth(MIT) wrapping. mintMfaBridgeToken/verifyMfaBridgeToken HMAC pair.
- `apps/web/lib/mfa-bridge.ts` — re-export at contract path.
- `apps/web/lib/password-policy.ts` — 강도 검사, 만료 산정.
- `apps/web/auth.ts` — credentials provider가 `{ username, password }` / `{ samlBridge }` / `{ mfaBridge }` 3 모드.
- `MfaRequiredError` 클래스 — code = `mfa_required:<bridgeToken>`. FE login-form은 콜론 split → /login/mfa 라우팅.
- `/api/v1/auth/mfa/verify` — 6자리 또는 복구 코드 검증 → 신규 bridge token mint.
- 마이그 0013 — User.totpSecret, totpEnabledAt, passwordChangedAt, passwordPrev1Hash, passwordPrev2Hash, recoveryCodesHash.

### 11.8 PDF 본문 전문 검색 (R40 S-1, R42, R43)

- 마이그 0014 — Attachment.contentText TEXT + content_tsv tsvector GENERATED + GIN index.
- 워커: `apps/worker/src/pdf-extract-worker.ts` + `pdf-extract.ts`(pdfjs-dist Apache 2.0).
- 메인 dwg-conversion 워커가 ConversionJob DONE 후 PDF 산출이 있으면 pdf-extract 큐에 enqueue.
- 검색 라우트(`apps/web/app/api/v1/objects/route.ts`):
  - trgm + FTS OR-union(R40)
  - ts_rank + FTS_WEIGHT=1.5로 unified ranking + matchSource 노출(R42)
  - candidateIds idxMap position 페이징(R43) — q+!sortBy일 때 모든 페이지에서 ranking 일관 유지
  - ts_headline MaxFragments=3 + FragmentDelimiter=` … `
- 마이그 0015 — Attachment.pdfExtractStatus enum + pdfExtractAt + pdfExtractError. backfill로 contentText 있는 row를 DONE으로 회수.
- `apps/web/lib/pdf-extract-queue.ts` — BullMQ Queue 헬퍼(웹 측 enqueue용).

### 11.9 의존성 보안 페이지 (R40 + R41)

- `/api/v1/admin/security/audit` — `pnpm audit --json` spawn + tolerant parser(JSON blob과 JSONL 양쪽).
- 15분 in-memory 캐시. POST는 캐시 무효화 + 재실행.
- R41: parseAuditDetail로 advisories 배열까지 노출(severity/package/title/versionRange/url).
- CI `.github/workflows/ci.yml` — audit job(continue-on-error: true). 권고 단계, 머지 차단 안 함.

### 11.10 PDF 추출 admin 페이지 (R41)

- `/api/v1/admin/pdf-extracts`(GET 리스트 + 카운트) + `/api/v1/admin/pdf-extracts/[id]/retry`(POST 재 enqueue, 상태 가드 FAILED/SKIPPED).
- 5초 폴링 + optimistic PENDING flip + ConfirmDialog 재시도.
- VulnerabilitiesTable 컴포넌트 — severity 정렬 + 50건 [더 보기] threshold + 외부 링크 보안 가드.
- count card 클릭 → URL `?status=` / `?severity=` 동기화(R42).

### 11.11 E2E 시나리오 5건 (R44, WBS 4.4.1)

- `apps/web/e2e/`:
  - `login.spec.ts`(R26 T-3)
  - `search.spec.ts`(R26 T-3)
  - `object-lifecycle.spec.ts`(R44, 신규)
  - `approval.spec.ts`(R44, 신규)
  - `lobby-transmittal.spec.ts`(R44, 신규)
- 실행: `pnpm -F web exec playwright test`(dev server + DB seed 가정).
- CI 자동 트리거는 비용으로 미적용 — manual 또는 별 워크플로.

### 11.12 라이선스 정책 누적 (R36~R44)

신규 모든 deps는 다음만 허용:
- MIT / Apache 2.0 / BSD / ISC / 0BSD
- LGPL은 dynamic link 시 OK이나 가능하면 회피
- GPL/AGPL은 **subprocess 격리만**(LibreDWG, ClamAV) — 직접 link 금지

R36~R44에 추가된 deps 라이선스:
- ClamAV(GPL) → subprocess only ✅
- node-saml(MIT) ✅
- twilio(Apache 2.0) ✅
- otpauth(MIT) ✅
- pdfjs-dist(Apache 2.0) ✅
- Line2(BSD via three.js) ✅

GPL/AGPL 직접 link 0건 유지.

---

## 부록 A. 기여 워크플로우 (PR을 보내기 전)

```bash
# 1) 동기화
git checkout main && git pull origin main

# 2) feature branch
git checkout -b feat/r36-xxx

# 3) 의존성 + Prisma
pnpm install --frozen-lockfile
pnpm db:generate

# 4) 변경 작업
# ...

# 5) 검증
pnpm typecheck
pnpm lint
pnpm -F web test

# 6) commit + push
git commit -m "feat(scope): xxx"
git push origin feat/r36-xxx

# 7) PR 생성 (gh cli 사용)
```

## 부록 B. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-04-27 | R35 1차 본문 작성 (DOC-4). 0~10 + 부록 A. |
| 2026-04-28 | R45 catch-up: 11장 신설 (R36~R44 dev-facing — 통합 테스트 인프라/ClamAV/SAML/WCAG/Line2/SMS·카카오/MFA·비밀번호/PDF FTS/admin 페이지/E2E 5건/라이선스 누적). 기존 챕터 통합 반영은 다음 리팩터에서. |
