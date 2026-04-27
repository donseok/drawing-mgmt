# R34 Design Spec — Storage Admin (V-INF-1, MinIO/S3 전환)

| 항목 | 내용 |
|---|---|
| 작성자 | drawing-mgmt designer agent (R34) |
| 작성일 | 2026-04-27 |
| 기준 main HEAD | `14baaed` |
| 대상 라운드 | R34 |
| 대상 PRD/DESIGN | `docs/PRD.md`, `docs/DESIGN.md` (§4 글로벌 레이아웃, §10.1 Empty/Loading 패턴, §13 Admin Console 가이드) |
| API 계약 | `_workspace/api_contract.md` §3(storage abstraction), §4(핵심 5 라우트), §5(워커), §6(Admin UI), §7(작업 영역 분리) |
| 신규 라우트 | `/admin/storage` (page) |
| 신규 컴포넌트 | `<StorageDriverCard>`, `<StorageStatsCard>`, `<ConnectionTestButton>` |
| 확장 컴포넌트 | `ADMIN_GROUPS` (스토리지 메뉴 추가), `apps/web/lib/queries.ts` (`queryKeys.admin.storage`) |
| 의존 (BE) | `GET /api/v1/admin/storage/info`, `POST /api/v1/admin/storage/test` |
| 디바이스 | Desktop only (≥1280) |
| 디자인 토큰 변경 | 없음 — R28 `<ConversionStatusBadge>`/R33 `<BackupStatusBadge>` 팔레트(slate/sky/emerald/rose) 그대로 재사용 |
| 새 단축키 | 없음 |
| PRD 페르소나 영향 | 슈퍼관리자만 사용. ADMIN+은 진입 가능 (PM-DECISION-1). 일반 사용자 시야에 들어가지 않음 |

---

## 0. 라운드 개요와 사용자 시나리오

### 0.1 R34 위치

R34는 **storage abstraction 도입 + S3 driver + 핵심 5 라우트 + 워커 마이그레이션** 단독 라운드다 (api_contract.md 서두). 디자이너 영역은 **`/admin/storage` 단일 페이지** — 운영자가 "지금 이 시스템이 LOCAL 디스크에 파일을 두고 있는지, MinIO/S3 버킷을 보고 있는지"를 한눈에 보고, 연결이 살아있는지 확인하는 surface다.

이 화면은 **마이그레이션 도구가 아니다** — `_workspace/api_contract.md` §6.1 마지막 줄 "마이그레이션 (LOCAL → S3) 도구는 다음 라운드 (이번엔 noop)" 명시. 본 라운드에선 **현재 상태 표시 + 연결 테스트 + 통계** 세 가지만 한다.

### 0.2 페르소나별 시나리오

| 페르소나 | 시나리오 |
|---|---|
| 슈퍼관리자 | (운영 환경) `/admin/storage` 진입 → 카드에서 "S3 / MinIO 운영 버킷에 정상 연결됨" 확인 → bucket=`drawing-mgmt`, endpoint=`http://minio:9000`, 총 object 11,243건 / 4.2 GB / recent activity 24h 내 312건 → "연결 테스트" 1회 클릭 → toast로 "200 OK / 89ms" 확인. |
| 관리자 (1~2명) | 동일. 권한 가드는 ADMIN+ (R28 `/admin/conversions`, R33 `/admin/backups`와 동일 정책). |
| 설계자 / 열람자 / 협력업체 | 메뉴 자체에 접근 불가. middleware의 admin 가드가 처리. |

### 0.3 핵심 시나리오 5개

1. **LOCAL 모드 확인 (개발 환경, 슈퍼관리자):** `/admin/storage` 진입 → 헤더 옆 큰 LOCAL 뱃지(slate) → DriverCard에 `STORAGE_DRIVER=local` / `rootPath=./.data/files` / 디스크 가용량(`os.statvfs` 안내 문구는 다음 라운드, 현재는 미표시) → connection 상태 emerald(정상) → "연결 테스트" 버튼 클릭 → `storage.list('', { limit: 1 })` 통과 → toast `"LOCAL 스토리지 연결 정상 (4ms)"`.
2. **S3 모드 확인 (운영, 슈퍼관리자):** 같은 페이지 진입 → S3 뱃지(sky) → endpoint=`http://minio:9000` / bucket=`drawing-mgmt` / region=`us-east-1` / forcePathStyle=`true` → credentials는 마스킹 (Access Key의 앞 4자리만 노출, Secret은 `••••••••`) → connection emerald → 통계 카드 4개에 실제 수치 표시.
3. **연결 실패 (S3 자격 증명 오류):** 연결 테스트 클릭 → BE가 `storage.list` 시도하다 SDK 401 → connection rose + DriverCard 본문에 `S3SignatureDoesNotMatch` 1줄 + "운영자에게 자격 증명 확인 요청" → toast `error`. 통계 카드 4개는 모두 `—` 표시 (LOCAL/S3 무관 stats endpoint 실패 시 동일 fallback).
4. **빈 통계 (시스템 첫 가동):** info 응답이 200이지만 `objectCount=0`, `totalBytes=0`, recent activity 없음 → 통계 카드 4개에 `0` 표시 (`—` 가 아니라 `0`이 의도). DriverCard는 정상 표시. EmptyState는 페이지 전체에는 띄우지 않는다 (driver 정보가 핵심이라 항상 보여야 한다).
5. **마이그레이션 안내 (운영자가 LOCAL→S3 전환 직전 호기심):** 페이지 하단 callout 박스에 "LOCAL → S3 마이그레이션 도구는 다음 라운드(R35+) 카드입니다. 현재는 ENV 변경 + 워커 재시작 후 신규 업로드만 S3에 저장됩니다. 기존 LOCAL 파일은 보존되며, 다음 라운드에서 일괄 이관됩니다." 회색 ghost 톤 + Info 아이콘.

---

## A. 페이지 구조

### A.1 라우트 등록과 사이드바 메뉴

**대상 파일:**
- `apps/web/app/(main)/admin/storage/page.tsx` (신규, frontend 담당 — 본 spec)
- `apps/web/app/(main)/admin/admin-groups.ts` (수정 — `통합 / 로그` 그룹에 `백업` 다음 라인 추가)

**`ADMIN_GROUPS` 변경 (제안):** `통합 / 로그` 그룹의 백업 항목 **다음**에 storage 항목 삽입. 변환 → 백업 → **스토리지** → API Key → 감사 로그 순. 변환·백업과 같은 "운영 surface" 묶음 안에 두는 것이 자연스럽다.

```ts
// 통합 / 로그 그룹 안 (R33의 백업 항목 다음에 추가)
{
  href: '/admin/storage',
  label: '스토리지',
  description: '파일 저장소 드라이버(LOCAL/S3) 상태 및 연결 테스트',
  icon: HardDrive, // lucide
},
```

### A.2 와이어프레임 (Desktop ≥1280, 단일 컬럼)

```
┌──────────────────────────── /admin/storage ────────────────────────────────┐
│  ┌── breadcrumb ────────────────────────────────────────────────────────┐  │
│  │  관리자 / 스토리지                                                    │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│  ┌── page header ──────────────────────────────────────────────────────┐  │
│  │  ADMIN CONSOLE                                                        │  │
│  │  스토리지                                              [🔄 새로고침] │  │
│  │  파일 저장소 드라이버 상태와 연결을 확인합니다.                       │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌── DriverCard (full-width) ─────────────────────────────────────────┐    │
│  │  ┌─────────┐                                            [● 정상]    │    │
│  │  │ LOCAL   │  파일 시스템 (./.data/files)              emerald-500  │    │
│  │  │ slate   │  rootPath: /var/lib/drawing-mgmt/files                  │    │
│  │  └─────────┘  디스크 가용량: — (다음 라운드)                         │    │
│  │                                                                       │    │
│  │  STORAGE_DRIVER=local · path-safe guard: 활성                        │    │
│  │                                                                       │    │
│  │                                  [ 연결 테스트 ]   ← Button           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  S3 일 때:                                                                  │
│  ┌── DriverCard (S3 모드) ────────────────────────────────────────────┐    │
│  │  ┌─────────┐                                            [● 정상]    │    │
│  │  │   S3    │  MinIO / S3 호환                          emerald-500  │    │
│  │  │  sky    │  endpoint: http://minio:9000                            │    │
│  │  └─────────┘  bucket:   drawing-mgmt                                 │    │
│  │                region:   us-east-1                                    │    │
│  │                path-style: true (MinIO 호환)                         │    │
│  │                accessKeyId: AKIA••••••••                              │    │
│  │                secretAccessKey: ••••••••                              │    │
│  │                                                                       │    │
│  │  STORAGE_DRIVER=s3 · @aws-sdk/client-s3                              │    │
│  │                                                                       │    │
│  │                                  [ 연결 테스트 ]                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌── stats grid (4 cards × 1 row) ────────────────────────────────────┐    │
│  │  [총 객체 수]  [총 용량]  [최대 객체]  [최근 24시간 활동]            │    │
│  │   11,243건    4.2 GB    312 MB        87건                           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌── migration callout (ghost) ───────────────────────────────────────┐    │
│  │  ℹ  LOCAL → S3 마이그레이션 도구는 다음 라운드(R35+) 카드입니다.     │    │
│  │     현재는 ENV 변경 + 워커 재시작 후 신규 업로드만 S3에 저장됩니다.   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### A.3 컴포넌트 트리

```
<StoragePage>                       (page.tsx, 'use client')
  <AdminSidebar />                  (기존)
  <section>
    <BreadcrumbBar />               (기존 패턴, 인라인 렌더 — 별도 컴포넌트 불요)
    <PageHeader />                  (인라인 — title + 새로고침 버튼)
    <StorageDriverCard ... />       (신규 컴포넌트)
    <div className="grid grid-cols-4 gap-3">
      <StorageStatsCard kind="objectCount" .../>
      <StorageStatsCard kind="totalBytes" .../>
      <StorageStatsCard kind="largestObject" .../>
      <StorageStatsCard kind="recentActivity" .../>
    </div>
    <MigrationCallout />            (인라인 — Info 아이콘 + 1~2줄 텍스트)
  </section>
```

`<ConnectionTestButton>`은 `<StorageDriverCard>` 내부에 위치한다. 별도 export하긴 하나 페이지에서 직접 placement 하지는 않는다.

---

## B. 컴포넌트 시그니처

### B.1 `<StorageDriverCard>`

**파일:** `apps/web/components/admin/storage/StorageDriverCard.tsx`

```ts
export type StorageDriver = 'LOCAL' | 'S3';
export type StorageConnectionStatus = 'OK' | 'ERROR' | 'UNKNOWN';

export interface StorageDriverInfo {
  driver: StorageDriver;
  // LOCAL 전용
  rootPath?: string;
  // S3 전용 (서버에서 미리 마스킹된 값으로 내려옴)
  endpoint?: string;
  bucket?: string;
  region?: string;
  forcePathStyle?: boolean;
  accessKeyIdMasked?: string;   // 예: "AKIA••••••••" (BE 측 마스킹 후 전달)
  // 공통
  connection: StorageConnectionStatus;
  // 마지막 테스트 시각 / latency / 메시지 (선택)
  lastTestedAt?: string | null; // ISO
  lastTestLatencyMs?: number | null;
  lastTestError?: string | null;
}

export interface StorageDriverCardProps {
  info: StorageDriverInfo | null; // null = 로딩 중
  isLoading: boolean;
  onTest: () => void;             // ConnectionTestButton 클릭 핸들러
  isTesting: boolean;
}
```

**행동:**
- `info === null` && `isLoading` → 카드 자리에 `<Skeleton className="h-[180px] w-full" />`.
- `connection==='OK'` → 우상단 `[● 정상]` (emerald).
- `connection==='ERROR'` → `[● 연결 실패]` (rose) + `lastTestError` 본문 1줄.
- `connection==='UNKNOWN'` → `[● 미확인]` (slate) + 본문에 "연결 테스트 버튼을 눌러 확인하세요."
- 카드 좌측 컬럼은 **드라이버 뱃지** — 큰 박스 (88×56px) + 굵은 라벨 + 색상 보더 좌측 4px.
  - LOCAL: `border-l-slate-400`, 박스 배경 `bg-slate-50 dark:bg-slate-950/30`, 텍스트 `text-slate-700 dark:text-slate-300`.
  - S3:    `border-l-sky-400`, `bg-sky-50 dark:bg-sky-950/30`, `text-sky-700 dark:text-sky-300`.
- 본문은 key=value 라인 6~8개. 큰 폰트는 driver 라벨만 (text-2xl); 본문은 text-sm + tabular-nums.

**접근성:**
- `role="region"` + `aria-labelledby="storage-driver-card-title"`.
- connection 상태는 색 + 텍스트 + 도트(애니메이션 없음). 색맹 대응.
- `lastTestedAt`은 `<time dateTime={...}>`로 감싸 SR이 읽을 수 있게.

### B.2 `<StorageStatsCard>`

**파일:** `apps/web/components/admin/storage/StorageStatsCard.tsx`

R28 `StatCard` (conversions/page.tsx 안 inline)과 같은 시각 패턴 — 좌측 컬러 보더 4px + 라벨 + 큰 숫자 + 보조 텍스트. 단, **클릭 가능하지 않다** (storage stats는 필터 토글이 없으므로). 그래서 `<button>`이 아니라 `<div role="group">`.

```ts
export type StorageStatsKind =
  | 'objectCount'
  | 'totalBytes'
  | 'largestObject'
  | 'recentActivity';

export interface StorageStatsCardProps {
  kind: StorageStatsKind;
  value: number | null;          // null = stats endpoint 실패 → "—"
  // largestObject 일 때 추가 메타: 파일명 또는 attachmentId 짧게
  subLabel?: string;             // 예: "preview.dxf · 312 MB"
  isLoading?: boolean;
}
```

**시각:**

| kind | 라벨 (KO) | 색 (보더) | value 포맷 |
|---|---|---|---|
| `objectCount` | 총 객체 수 | `border-l-slate-400` | `value.toLocaleString()` + " 건" |
| `totalBytes` | 총 용량 | `border-l-sky-400` | `formatBytes(value)` (R33 패턴 재사용) |
| `largestObject` | 최대 객체 | `border-l-amber-400` | `formatBytes(value)` + 하단 subLabel |
| `recentActivity` | 최근 24시간 활동 | `border-l-emerald-400` | `value.toLocaleString()` + " 건" |

**행동:**
- `isLoading` → `<Skeleton className="h-20 w-full" />`.
- `value===null` → 큰 자리에 `—` 표시 + 보조 텍스트 "stats endpoint 실패".
- `value===0` → `0` 그대로 (zero ≠ null).

### B.3 `<ConnectionTestButton>`

**파일:** `apps/web/components/admin/storage/ConnectionTestButton.tsx`

```ts
export interface ConnectionTestButtonProps {
  isTesting: boolean;       // mutation.isPending
  onTest: () => void;
  // last-test 결과 chip 표시 여부 (선택)
  lastResult?: {
    ok: boolean;
    latencyMs: number | null;
    at: string;             // ISO
  } | null;
}
```

**시각:**
- 기본: shadcn `Button variant="outline" size="sm"` + `<RefreshCw>` 아이콘 + 라벨 "연결 테스트".
- `isTesting` → 라벨 "테스트 중…" + `<Loader2 className="animate-spin" />`. `disabled`.
- 옆에 마지막 결과 chip — `lastResult.ok ? "✓ 89ms" : "✗ 실패"` (emerald / rose 색, text-xs, ml-2).

**행동:**
- 클릭 → `onTest()` (페이지에서 mutation 발사) → 결과 toast (성공: success, 실패: error).
- BE 응답을 받은 뒤 `info`를 invalidate해서 `<StorageDriverCard>`의 connection 상태가 즉시 갱신되도록 한다 (queryClient.invalidateQueries).

---

## C. 인터랙션과 상태 머신

### C.1 페이지 라이프사이클

| 단계 | 상태 | UI |
|---|---|---|
| 진입 직후 | `info` 쿼리 fetching | DriverCard skeleton + Stats skeleton ×4 |
| info 도착 (connection=OK) | 정상 | DriverCard 풀 표시 + Stats 풀 표시 |
| info 도착 (connection=ERROR) | 실패 | DriverCard rose + 본문에 error msg + Stats 카드 모두 `—` |
| info 도착 (connection=UNKNOWN, 최초) | 중립 | DriverCard slate + "연결 테스트 버튼을 눌러 확인하세요." + Stats 카드 모두 `—` |
| info 4xx/5xx | 페이지 에러 | EmptyState (AlertCircle, "스토리지 정보를 불러오지 못했습니다", 재시도 버튼) — Driver/Stats 카드 자체를 렌더하지 않음 |
| 연결 테스트 클릭 | testing | DriverCard `connection`은 그대로, ConnectionTestButton 만 spinner. Stats 카드는 그대로. |
| 연결 테스트 성공 | 갱신 | toast success + queryClient.invalidate(`info`) → DriverCard re-render → emerald |
| 연결 테스트 실패 | 갱신 | toast error + queryClient.invalidate(`info`) → DriverCard re-render → rose + lastTestError |
| 새로고침 버튼 (헤더) | 강제 refetch | info + stats 모두 invalidate. 변환/백업 페이지의 RotateCw 아이콘 패턴과 동일. |

### C.2 폴링 정책

- **폴링하지 않는다.** 변환/백업과 달리 storage info는 변화 빈도가 낮다 (드라이버는 ENV에 의해 결정되며, 통계는 분 단위로 의미 있게 바뀌지 않음).
- 대신 `staleTime: 30_000`, `refetchOnWindowFocus: true` — 사용자가 탭 복귀 시 한 번 갱신.
- "연결 테스트" 버튼이 사실상 수동 health-check 역할.

### C.3 connection 상태 머신

```
        UNKNOWN ──[연결 테스트 클릭]──→ TESTING
           ▲                              │
           │                          ┌───┴───┐
       (최초 진입)                    │       │
                                     OK     ERROR
                                      │       │
                                      └───────┘
                                          │
                                  [연결 테스트 재클릭]
                                          ▼
                                       TESTING
```

서버 측 `/info` 응답에 `connection` 필드가 항상 포함된다고 가정. BE는 매 요청마다 light health-check를 수행하지 않을 수도 있으니, **`connection` 필드는 "마지막으로 알려진 상태" 의미** — UI는 이를 그대로 신뢰.

---

## D. PM-DECISION 항목 (보수적 default)

| 번호 | 결정 사항 | 디자이너 default | 사유 |
|---|---|---|---|
| **PM-DECISION-1** | `/admin/storage` 접근 권한: SUPER_ADMIN만? ADMIN+? | **ADMIN+** | R28 `/admin/conversions`, R33 `/admin/backups`와 정책 통일. 운영 surface 일관성 우선. SUPER_ADMIN 전용으로 좁히고 싶다면 PM이 변경. |
| **PM-DECISION-2** | credentials 마스킹 시 Access Key 앞부분 몇 자리 노출? | **앞 4자리** + 나머지 `••••••••` | AWS Console 컨벤션과 동일. 0자리는 디버깅 어려움, 8자리는 보안 약함. Secret은 무조건 전체 마스킹. |
| **PM-DECISION-3** | "최대 객체 (largestObject)" 통계가 BE 부담이면 다음 라운드로 미뤄도 되나? | **이번 라운드에 포함**, 단 BE가 stats endpoint를 단일 쿼리로 합성하기 어려우면 응답에 `largestObject: null` 보내고 카드는 `—` 표시. | 4 카드 grid 균형 유지. null fallback이 자연스러움. |
| **PM-DECISION-4** | "최근 24시간 활동" 의 정의: 새로 put된 객체 수? Attachment 생성 row 수? | **Attachment 신규 생성 row 수** (`createdAt > now-24h`). `storage.put` 이벤트는 추적 안 함. | DB count로 충분, 별도 Audit 필요 없음. 다음 라운드에서 storage I/O 메트릭이 필요하면 그때 분리. |
| **PM-DECISION-5** | 페이지 헤더의 "새로고침" 버튼 — info만 invalidate vs. stats도 같이? | **둘 다 invalidate** (별도 쿼리 키지만 함께 갱신) | 사용자 멘탈 모델에서 "새로고침"은 페이지 전체. 분리 시 혼란. |
| **PM-DECISION-6** | 마이그레이션 callout 위치: 페이지 하단 vs. driver card 안? | **페이지 하단 ghost callout** | driver card는 "지금 상태", callout은 "다음 단계 안내" — 정보 위계 분리. |
| **PM-DECISION-7** | LOCAL 모드일 때 `rootPath` 절대경로 전체 노출 vs. 마지막 path segment만? | **전체 노출** | 운영자가 디버깅할 정보. 보안 민감도 낮음 (서버 내부 경로). 마스킹 비용이 효익보다 큼. |
| **PM-DECISION-8** | Connection 테스트 결과 toast의 메시지 톤 | 성공: `"LOCAL 스토리지 연결 정상 (4ms)"` / 실패: `"LOCAL 스토리지 연결 실패: <SDK 메시지>"` | R33 백업 toast 패턴과 동일. 라이트 톤 + 기술적 사실 1줄. |

---

## E. Endpoint 매핑

### E.1 `GET /api/v1/admin/storage/info` (R34 신규, BE 담당)

**FE 호출:** TanStack Query, key=`queryKeys.admin.storageInfo()`, `staleTime: 30_000`.

**기대 응답 (envelope):**
```jsonc
{
  "ok": true,
  "data": {
    "driver": "LOCAL",
    "rootPath": "/var/lib/drawing-mgmt/files",
    // S3 모드일 때 추가:
    // "endpoint": "http://minio:9000",
    // "bucket": "drawing-mgmt",
    // "region": "us-east-1",
    // "forcePathStyle": true,
    // "accessKeyIdMasked": "AKIA••••••••",
    "connection": "OK",
    "lastTestedAt": "2026-04-27T10:32:11Z",
    "lastTestLatencyMs": 4,
    "lastTestError": null,
    // 인라인 stats — 변환 페이지(`meta.stats`)와 동일 패턴
    "stats": {
      "objectCount": 11243,
      "totalBytes": 4500000000,
      "largestObject": {
        "key": "abc123/preview.dxf",
        "size": 312000000,
        "label": "preview.dxf · 도면 12-345"
      },
      "recentActivity24h": 87
    }
  }
}
```

`stats` 가 없거나 `null`인 필드는 카드에서 `—` 처리 (PM-DECISION-3).

### E.2 `POST /api/v1/admin/storage/test` (R34 신규, BE 담당)

**FE 호출:** `useMutation`, mutationFn = `api.post('/api/v1/admin/storage/test')`.

**기대 응답:**
```jsonc
{ "ok": true, "data": { "connection": "OK", "latencyMs": 89, "testedAt": "..." } }
// 또는
{ "ok": false, "error": { "code": "E_STORAGE_UNREACHABLE", "message": "S3SignatureDoesNotMatch" } }
```

**onSuccess:** `toast.success` + `queryClient.invalidateQueries({ queryKey: queryKeys.admin.storageInfo() })`.
**onError:** `toast.error` (메시지에 `error.message` 포함) + 동일 invalidate (서버가 connection 상태를 ERROR로 갱신했을 것이므로 재조회 필요).

### E.3 frontend.md 컨벤션 준수

- `placeholderData: keepPreviousData` (TanStack v5).
- `refetchOnWindowFocus: true`, `staleTime: 30_000`, `refetchInterval` 없음.
- 에러는 `ApiError` (`apps/web/lib/api-client.ts`) 캐치 → toast + EmptyState.
- mutation은 R28/R33의 패턴 — `onSuccess`/`onError` 분리 + `invalidateQueries` 단일 키 패턴.

### E.4 `queryKeys.admin.storage` 추가 (`apps/web/lib/queries.ts` 확장)

```ts
admin: {
  // ... 기존 (users, organizations, groups, conversions, backups, ...)

  // R34 V-INF-1 — storage admin. info 쿼리는 30초 stale, 연결 테스트
  // mutation 후에 invalidate. stats는 info 응답에 인라인이라 별도 키 없음.
  storageInfo: () => ['admin', 'storage', 'info'] as const,
},
```

---

## F. 디자인 토큰 / 시각 결정

### F.1 색 팔레트 (기존 R28/R33 재사용)

| 의미 | Tailwind | 사용처 |
|---|---|---|
| 중립 / LOCAL | `slate-{50,100,400,500,700}` | LOCAL 드라이버 뱃지, objectCount 보더 |
| 활성 / S3 / 정보 | `sky-{50,100,400,500,700}` | S3 드라이버 뱃지, totalBytes 보더 |
| 성공 / 정상 | `emerald-{50,400,500,700}` | connection OK 도트, recentActivity 보더 |
| 경고 / 큰 객체 | `amber-{50,400,500}` | largestObject 보더 (운영자 시선 유도) |
| 실패 | `rose-{50,400,500,700}` | connection ERROR 도트 + 본문 메시지 |

신규 토큰 없음. `app-panel`, `app-kicker`, `border-border`, `bg-bg`, `bg-bg-subtle`, `text-fg`, `text-fg-muted`, `text-fg-subtle` 모두 R28/R33에서 정착된 기존 토큰 그대로.

### F.2 타이포그래피

- 페이지 타이틀: `text-2xl font-semibold` (R28과 동일).
- 카드 큰 숫자: `text-2xl font-semibold tabular-nums` (R28 StatCard 동일).
- 드라이버 뱃지 라벨 (LOCAL / S3): `text-xl font-bold uppercase tracking-wide`.
- key=value 본문: `text-sm` + `font-mono-num` (숫자/path만).

### F.3 간격

- 페이지 헤더 padding: `px-6 py-5` (R28 conversions/page와 동일).
- 카드 grid gap: `gap-3`.
- DriverCard 내부 padding: `p-5`.

### F.4 아이콘 (lucide-react)

| 자리 | 아이콘 | 용도 |
|---|---|---|
| 사이드바 메뉴 | `HardDrive` | 디스크/스토리지 의미 |
| 헤더 새로고침 | `RotateCw` | R28/R33과 동일 |
| 연결 테스트 버튼 | `RefreshCw` | "지금 한번 핑" 의미 |
| 성공 toast | `CheckCircle2` | (toast 라이브러리가 자동) |
| 실패 toast / 카드 메시지 | `AlertCircle` | 에러 표시 |
| 마이그레이션 callout | `Info` | 안내 톤 |
| largestObject 카드 | `FileWarning` 또는 `Files` | 큰 파일 강조용. 둘 중 PM이 선택 — default `Files`. |

---

## G. 접근성 (WCAG 2.1 AA)

- **색 + 텍스트 + 도트 3중 표현.** connection 상태는 색만으로 구분되지 않는다 (rose/emerald/slate 도트 + "정상/연결 실패/미확인" 라벨 동반).
- **포커스 가시성.** 모든 버튼 `focus-visible:ring-2 focus-visible:ring-ring`. R28 StatCard의 패턴 그대로.
- **키보드 동선:** Tab 순서 = 헤더 새로고침 → DriverCard 내 연결 테스트 버튼 → (Stats 카드는 비대화형이라 skip) → 마이그레이션 callout 외부 링크 (없음). 단축키 신설 없음.
- **ARIA:** DriverCard `role="region" aria-labelledby="storage-driver-card-title"`. ConnectionTestButton의 `isTesting` 상태는 `aria-busy="true"`.
- **toast.** sonner 기본이 `role="status"` + 자동 SR 알림 → 별도 처리 불필요.
- **명도 대비.** rose-700/emerald-700/sky-700 텍스트 vs. white/slate-50 배경 → 모두 AA 통과 (R28/R33에서 검증).

---

## H. Empty / Loading / Error 패턴 (DESIGN.md §10.1 정렬)

| 상태 | 컴포넌트 | 카피 |
|---|---|---|
| 페이지 로딩 | DriverCard `<Skeleton className="h-[180px] w-full" />` + Stats `<Skeleton className="h-20" />` ×4 | — |
| info 4xx/5xx (전체 실패) | `<EmptyState icon={AlertCircle} title="스토리지 정보를 불러오지 못했습니다" description={error.message} action={<Button onClick={refetch}>재시도</Button>} />` | — |
| 권한 부족 (403) | `<EmptyState icon={AlertCircle} title="스토리지 관리 권한이 없습니다" />` | description 없음 (자세한 사유 노출하지 않음). |
| connection=ERROR (info는 200) | DriverCard 본문에 인라인 에러 1줄 + Stats 카드는 `—` | "연결 실패: SDK 메시지 1줄" |
| stats만 누락 (info OK + stats null) | DriverCard 정상, Stats 카드 `—` | "통계 일시 불가" 보조 라벨 |
| 첫 가동 (값이 0) | 정상 표시 | `0` 표시 (— 가 아님) |

EmptyState는 **페이지 전체에 한해서만** 띄운다. driver card는 항상 보여야 한다 (운영자가 가장 알고 싶은 정보).

---

## I. 산출물 / 작업 영역 (frontend 담당)

### I.1 frontend가 만들어야 하는 파일

| 경로 | 종류 | 메모 |
|---|---|---|
| `apps/web/app/(main)/admin/storage/page.tsx` | 신규 | 본 spec §A.2 와이어프레임 그대로. `'use client'`. |
| `apps/web/components/admin/storage/StorageDriverCard.tsx` | 신규 | §B.1 시그니처. |
| `apps/web/components/admin/storage/StorageStatsCard.tsx` | 신규 | §B.2 시그니처. |
| `apps/web/components/admin/storage/ConnectionTestButton.tsx` | 신규 | §B.3 시그니처. |
| `apps/web/components/admin/storage/types.ts` | 신규 | `StorageDriver`, `StorageConnectionStatus`, `StorageDriverInfo`, `StorageStatsKind` 등 wire shape 모듈. R29/R33 admin 컴포넌트 패턴과 동일. |
| `apps/web/lib/queries.ts` | 수정 | §E.4의 `storageInfo` 추가만. |
| `apps/web/app/(main)/admin/admin-groups.ts` | 수정 | §A.1의 `/admin/storage` 메뉴 항목 1개 추가. icon=`HardDrive`. |

### I.2 frontend가 건드리지 말아야 하는 영역

- BE `/api/v1/admin/storage/{info,test}` route — backend 담당.
- `apps/web/lib/storage/*`, `packages/shared/src/storage.ts` — backend 담당.
- 핵심 5 라우트 (`api_contract.md` §4) — backend 담당.
- 워커 (`apps/worker/src/*`) — viewer-engineer 담당.
- 다른 admin 페이지 (conversions/backups/users/...) — 회귀 위험.

### I.3 회귀 보장 항목

- `STORAGE_DRIVER` ENV가 빠져 있어 `info` 응답이 `driver: 'LOCAL'` + `rootPath: undefined`인 경우에도 카드가 깨지지 않아야 한다 (`rootPath ?? '—'`).
- S3 응답에서 `accessKeyIdMasked`가 빈 문자열일 때도 카드가 깨지지 않아야 한다.
- `stats` 객체 자체가 누락된 응답에서도 stats 카드 4개 모두 `—`로 graceful degrade.

---

## J. 분기 처리

### J.1 LOCAL vs. S3 분기

DriverCard는 `info.driver`를 보고 다음을 분기한다:
- LOCAL: 좌측 뱃지 라벨 `LOCAL`, 본문에 `rootPath` 1줄 + STORAGE_DRIVER ENV 표시 + path-safe guard 활성 표시 (안내 톤).
- S3: 좌측 뱃지 라벨 `S3`, 본문에 endpoint / bucket / region / forcePathStyle / accessKeyIdMasked / secretAccessKey(`••••••••`) 5~6줄.

**미래 드라이버 추가 (R35+에서 GCS, Azure 등) 대비:** `StorageDriver` 타입을 union으로 두고, 알 수 없는 값이 오면 `<UnknownDriverFallback>` (회색 박스 + "알 수 없는 드라이버: ${name}") 처리. 이번 라운드는 LOCAL/S3 둘만.

### J.2 ENV 미주입 / 부분 누락

- `STORAGE_DRIVER`가 빠져 있으면 BE는 default `LOCAL`로 응답해야 한다 (api_contract.md §3.3 default).
- S3 ENV (endpoint/bucket/region) 중 하나라도 빠지면 BE는 `connection=ERROR` + `lastTestError="S3 환경변수 누락: BUCKET"` 식으로 응답해야 한다 — UI는 이를 그대로 표시 (별도 분기 불필요).

---

## K. 다음 라운드 예고 (참고만)

- LOCAL → S3 일괄 마이그레이션 도구 (`POST /api/v1/admin/storage/migrate` + 진행률 폴링).
- 잔여 라우트 (preview.dxf, preview.pdf, lobby attachment, me/signature 등) storage 통과로 전환.
- 디스크 가용량 표시 (LOCAL 모드일 때 `os.statvfs` 합성).
- 스토리지 I/O 메트릭 (put/get throughput, error rate) — BullMQ 메트릭 surface와 합쳐 별도 페이지 또는 별도 카드.

이번 라운드 페이지 구조는 이 모든 확장을 흡수할 수 있도록 **세로 스택 + 카드 단위** 구성으로 설계됐다 (마이그레이션 진행률 카드, 디스크 가용량 카드, I/O 메트릭 카드를 stats grid 아래에 행 단위로 추가만 하면 된다).

---

## L. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-04-27 | 초기 작성 (R34 — V-INF-1 storage admin) |
