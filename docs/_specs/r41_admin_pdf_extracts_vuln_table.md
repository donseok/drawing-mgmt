# R41 Design Spec — /admin/pdf-extracts + VulnerabilitiesTable + 카운트 카드 클릭 필터

| 항목 | 내용 |
|---|---|
| 작성자 | drawing-mgmt designer agent (R41) |
| 작성일 | 2026-04-28 |
| 기준 main HEAD | `9d07258` (R40 docs commit, R41 base) |
| 대상 라운드 | R41 |
| API 계약 | `_workspace_r41/api_contract.md` §2 (Prisma), §4 (엔드포인트), §5 (FE 라우트), §6 (worktree 명세) |
| 선행 spec | `docs/_specs/r40_mfa_login_security_pdf.md` (특히 §C VulnerabilityCounts), `docs/_specs/r36_virus_scan.md` (mirror로 사용) |
| 신규 라우트 | `/admin/pdf-extracts` (카드 A) |
| 신규 컴포넌트 | `<PdfExtractsPage>`, `<PdfExtractStatusBadge>`, `<PdfExtractStatCard>`(또는 기존 StatCard 패턴 재사용), `<VulnerabilitiesTable>`, `<VulnerabilityRow>` |
| 확장 컴포넌트 | `apps/web/app/(main)/admin/admin-groups.ts` (PDF 본문 추출 항목 추가), `apps/web/app/(main)/admin/security/page.tsx` (카운트 카드 → 클릭 필터 + 하단 VulnerabilitiesTable 추가), `apps/web/lib/queries.ts` (useAdminPdfExtracts / useRetryPdfExtract 훅) |
| 디바이스 | Desktop only (1280 / 1440 / 1920) |
| 디자인 토큰 변경 | **없음** — 기존 brand/danger/warning/success/info(=sky)/border/fg-muted/bg-subtle 토큰만 사용 |
| 새 단축키 | 없음 |
| 프리뷰 의도 | (1) PDF 본문 추출 워커가 영구 실패한 row를 admin이 가시화/재시도, (2) /admin/security 카운트가 단순 통계에서 drill-down 진입점으로 승격, (3) 양쪽 페이지의 "카운트 카드 클릭 → 필터" 인터랙션을 단일 토큰으로 통일 (R36 /admin/scans와 동일 mental model) |

---

## 0. 라운드 개요와 사용자 시나리오

### 0.1 R40과의 연결

R40은 `/admin/security`에 카운트 카드 4개 + EmptyState까지 표면을 잡았다. R41에서 마무리/확장:

1. **/admin/pdf-extracts (신규, 카드 A)** — R40에서 PDF `contentText`를 채웠지만 영구 실패 row가 NULL과 구분 안 됐다. 워커 status enum + admin 페이지로 가시화 + 재시도. 패턴은 `/admin/scans` 그대로 미러.
2. **VulnerabilitiesTable (카드 B)** — R40 §J #5에서 "R41 후보"로 미뤘던 drill-down 테이블. advisory 배열을 카드 4개 아래에 표시. 0건일 때는 R40의 EmptyState 그대로.
3. **카운트 카드 클릭 → 필터 (카드 C)** — R36 `/admin/scans`에 이미 있는 mental model을 양쪽 페이지에 통일. 활성 카드는 ring + bg subtle, 같은 카드 재클릭 시 해제.

### 0.2 페르소나 동선

| 페르소나 | /admin/pdf-extracts | /admin/security 보강 | 카운트 클릭 필터 |
|---|---|---|---|
| 슈퍼관리자/관리자 | 매주 1회 점검. FAILED row 모아 보기 → [재시도] 버튼 1클릭. PDF 본문 검색 hit률을 정성적으로 확인. | 매주 1회 점검. critical/high 카드 클릭 → 해당 advisory만 노출 → [advisory 링크] 클릭 → 외부 보안 게시판 탭 오픈 → 패치 발주. | 양쪽 페이지에서 동일 손목 동작 |
| 설계자 / 열람자 / 협력업체 | 접근 권한 없음 (admin only) | 접근 권한 없음 | 동일 |

### 0.3 핵심 시나리오 4개

1. **PDF 추출 실패 점검 (관리자):** AdminSidebar → "통합/로그 → PDF 본문 추출" → /admin/pdf-extracts → 카운트 5개(PENDING/EXTRACTING/DONE/FAILED/SKIPPED) → "FAILED" 카드 클릭 → 테이블이 FAILED row만 표시 → [재시도] 클릭 → 토스트 "추출 큐에 추가" + 행 status 즉시 PENDING으로 optimistic flip → 5초 폴링이 EXTRACTING → DONE/FAILED로 자연 갱신.
2. **취약점 advisory 점검 (관리자):** AdminSidebar → "통합/로그 → 의존성 보안" → /admin/security → 카운트 4개 + 마지막 검사 카드 → "Critical 1건" 카드 클릭 → 카드에 ring active + 하단 VulnerabilitiesTable이 critical 1건만 표시 → severity badge / 패키지 / 제목 / version range / [advisory 링크] → 링크 클릭(새 탭) → 외부 보안 게시판 → 패치 작업 발주 → 다시 카드 클릭으로 필터 해제 → 전체 테이블 복귀.
3. **EmptyState (관리자, 0건 상태):** /admin/security → 모든 카운트 0 + advisory 배열도 0 → 카드 4개는 dim + EmptyState ✓ 표시 → 안심하고 다음 페이지로 이동 (R40 디자인 그대로 유지).
4. **권한 없는 사용자 진입:** 설계자가 URL을 직접 쳐서 /admin/pdf-extracts 진입 → 다른 admin 페이지처럼 layout 가드 → 403 또는 /로 redirect.

---

## A. /admin/pdf-extracts 페이지 (카드 A)

### A.1 진입과 라우트

- **파일:** `apps/web/app/(main)/admin/pdf-extracts/page.tsx`
- **권한:** SUPER_ADMIN + ADMIN. 다른 admin 페이지와 동일하게 layout 가드 (R28+).
- **AdminSidebar 진입점:** `apps/web/app/(main)/admin/admin-groups.ts`의 "통합 / 로그" 그룹 안, 기존 "변환 작업"(`/admin/conversions`) **바로 아래** 위치 (변환 워커와 PDF 추출 워커는 같은 BullMQ 인프라 위에 있고 mental model 동일).

  ```ts
  // 통합 / 로그 그룹 안, '변환 작업' 다음 항목으로 추가:
  {
    href: '/admin/pdf-extracts',
    label: 'PDF 본문 추출',
    description: 'PDF 본문 인덱싱 워커 / 실패 재시도',
    icon: FileText,   // lucide. 'PDF + 텍스트' 의미. (PM 결정 가능, §I #1)
  },
  ```

  - 위치 사유: 변환 작업 바로 아래에 두면 "워커류"를 한 묶음으로 시각 그룹화 가능. 백업/스토리지/바이러스 스캔과는 살짝 결이 달라(전자는 운영 큐, 후자는 인프라/보안 surface) 변환 옆이 가장 자연스러움.
  - 아이콘 후보: `FileText`(lucide, 권장) / `FileSearch` / `FileType`. PM 결정 — frontend 1줄 변경. 변환 작업이 `RefreshCw`(원형 화살표)이라 굳이 비슷하게 갈 필요 없음.

### A.2 레이아웃 (R36 /admin/scans 미러)

```
┌── /admin/pdf-extracts ───────────────────────────────────────────┐
│ ┌──[관리자 사이드바]──┐ ┌──[메인]────────────────────────────────┐ │
│ │ ...                │ │  관리자 / PDF 본문 추출                  │ │
│ │ 통합/로그          │ │ ─────────────────────────────────────── │ │
│ │  변환 작업         │ │  ADMIN CONSOLE                          │ │
│ │ ▶PDF 본문 추출    │ │  PDF 본문 추출                            │ │
│ │  백업              │ │  PDF 첨부의 본문 인덱싱 워커 상태와        │ │
│ │  스토리지          │ │  영구 실패 항목을 모니터링하고 재시도합니다. │ │
│ │  바이러스 스캔     │ │                                  [↻ 새로고침] │ │
│ │  API Key           │ │                                          │ │
│ │  감사 로그         │ │  ┌────┐┌────┐┌────┐┌────┐┌────┐         │ │
│ │  의존성 보안       │ │  │ 12 ││ 3  ││ 248││ 5  ││ 21 │         │ │
│ │                    │ │  │PEND││EXTR││DONE││FAIL││SKIP│         │ │
│ │                    │ │  │대기││추출중││완료││실패││제외│         │ │
│ │                    │ │  └────┘└────┘└────┘└────┘└────┘         │ │
│ │                    │ │                                          │ │
│ │                    │ │  상태: [전체 v]   검색: [           ]    │ │
│ │                    │ │                          ☑ 5초 자동 새로고침 │ │
│ │                    │ │                                          │ │
│ │                    │ │  ┌─[Table]──────────────────────────┐  │ │
│ │                    │ │  │ 상태│자료번호│파일명│마지막│오류│동작 │ │
│ │                    │ │  │badge│DRG-...│design.pdf│2분전│-│재시도│ │
│ │                    │ │  │FAIL │DRG-...│big.pdf │1시간│OOM..│재시도│
│ │                    │ │  │ ...                                │  │ │
│ │                    │ │  └────────────────────────────────────┘  │ │
│ │                    │ │                          [더 보기 (3)] │ │
│ └────────────────────┘ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

- 컨테이너: AdminSidebar(고정 폭) + main `flex-1 overflow-auto bg-bg`. (`/admin/scans`와 동일 root 컨테이너)
- 메인 안쪽:
  - Breadcrumb: `<div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">관리자 / PDF 본문 추출</div>`
  - 헤더 stripe: `<div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">` — 좌측 `app-kicker + h1 + p`, 우측 [↻ 새로고침] icon button
  - 카운트 카드 grid: `<div className="grid grid-cols-2 gap-3 px-6 pt-4 md:grid-cols-3 xl:grid-cols-5">` — 5개 카드. 1280에서도 5 컬럼 한 줄 충분 (각 카드 ≈ 200~220px).
  - 필터 바: `<div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">` — 상태 select / 검색 input / "5초 자동 새로고침" 체크
  - 테이블: `<div className="min-h-0 flex-1 overflow-auto">` 안에 `<table className="w-full border-collapse text-sm">`
  - "더 보기": cursor 있으면 `<div className="flex items-center justify-center border-t border-border bg-bg-subtle py-3">[더 보기]</div>`

### A.3 카운트 카드 5종 (status 별)

color 토큰 매핑(§E 테이블에서 다시 정리):

| status | 라벨 | dot 색 | border-l 색 | 시각 처리 | 해석 |
|---|---|---|---|---|---|
| PENDING | 대기 | `bg-fg-muted` | `border-l-slate-400` | 정적 | 워커 미픽업 또는 enqueue 직전. 일시적이라 정상이면 한 자릿수. |
| EXTRACTING | 추출 중 | `bg-info` (sky-500 토큰 매핑, 없으면 `bg-sky-500`) | `border-l-sky-400` | **dot에 `animate-pulse`** | 워커 처리 중. > 0이면 폴링 활성. |
| DONE | 완료 | `bg-success` (emerald-500) | `border-l-emerald-400` | 정적 | contentText 채워짐. 누적 통계 의미. |
| FAILED | 실패 | `bg-danger` (rose-500) | `border-l-rose-500` | 정적 | 3회 모두 실패. **재시도 대상.** |
| SKIPPED | 제외 | `bg-fg-subtle` (slate-300) | `border-l-slate-300` | 정적 | PDF 아니거나 PDF_EXTRACT_ENABLED=0. |

- "info" 토큰: 프로젝트 토큰에 명시적 `--info`가 없으면 `--brand`(sky 계열) 또는 직접 `sky-500/sky-400` Tailwind 클래스 사용. **권장: `/admin/scans`가 SCANNING에 `border-l-sky-400` + `bg-sky-500`을 직접 쓰므로 동일 패턴 채택** → 디자인 토큰 추가 없음, 시각 일관성 유지.
- 카드 컴포넌트는 `/admin/scans`의 `<StatCard>` 패턴을 그대로 따른다 (§A.4).

### A.4 카운트 카드 컴포넌트 (StatCard 재사용/모듈화 패턴)

- `/admin/scans` 페이지에 이미 있는 `<StatCard>`를 그대로 베끼되 `kind` 타입을 `PdfExtractStatus`로 swap. **별도 공용 컴포넌트로 추출하지 말 것** — 두 페이지의 status enum이 다르고 색 매핑 테이블도 다르므로 평탄한 page-local 컴포넌트가 가독성 우선.
- 시각:

  ```tsx
  // pdf-extracts/page.tsx 내부 file-local
  interface PdfExtractStatCardProps {
    kind: PdfExtractStatus;
    label: string;       // 한글 라벨 (대기/추출 중/완료/실패/제외)
    value: number;
    active: boolean;     // statusFilter === kind
    pulse?: boolean;     // EXTRACTING + value > 0
    onClick: () => void;
  }

  function PdfExtractStatCard({ kind, label, value, active, pulse, onClick }: ...) {
    return (
      <button
        type="button"
        aria-pressed={active}
        aria-label={`${label} ${value}건${active ? ', 필터 활성' : ''}`}
        onClick={onClick}
        className={cn(
          'flex flex-col items-start gap-1 rounded-md border border-border border-l-4 bg-bg p-4 text-left transition-colors',
          STAT_BORDER[kind],
          'hover:border-border-strong hover:bg-bg-subtle',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          active && 'bg-bg-subtle ring-2 ring-brand/40',
        )}
      >
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className={cn('inline-block h-2 w-2 rounded-full', STAT_DOT[kind], pulse && 'animate-pulse')} />
          <span className="text-[11px] font-medium uppercase text-fg-subtle">{kind}</span>
        </div>
        <span className="text-2xl font-semibold tabular-nums text-fg">{value.toLocaleString()}</span>
        <span className="text-xs text-fg-muted">{label}</span>
      </button>
    );
  }
  ```

- `aria-pressed={active}` + 한글 `aria-label`로 SR이 "대기 12건, 필터 활성" 자연 읽기.
- 활성 시 `bg-bg-subtle ring-2 ring-brand/40` — `/admin/scans`와 동일 시각. (§C 카드 클릭 필터 인터랙션에서 다시 명시.)

### A.5 필터 바

- 상태 Select: 옵션 `전체` + 5개 status. 카드 클릭과 양방향 동기 (`statusFilter` state 단일 source).
- 검색 Input: 자료번호 / 파일명 / 오류 메시지 클라이언트 substring 매칭. `/admin/scans`와 동일 패턴 (`textQuery` state로 BE 쿼리 안 보내고 로컬 `allRows.filter`).
- "5초 자동 새로고침" 체크 (`useLocalStorage<boolean>('pdfExtracts.autoRefresh', true)`). EXTRACTING 또는 PENDING > 0 일 때만 실제 폴링 발생 (`refetchInterval` 콜백에서 stats 검사).
- "필터 초기화" 버튼: `statusFilter !== 'ALL' || textQuery !== ''` 일 때만 노출 (`<X className="h-4 w-4"/> 필터 초기화`).

### A.6 테이블 컬럼 명세

| # | 컬럼 | 폭 | 내용 | 정렬 |
|---|---|---|---|---|
| 1 | 상태 | `w-[110px]` | `<PdfExtractStatusBadge>` (§A.7) | 왼쪽 |
| 2 | 자료번호 | `w-[140px]` | `<span className="font-mono-num text-[12px] text-fg">{row.objectNumber}</span>` — 클릭 시 `/objects/{objectId}` 새 탭 | 왼쪽 |
| 3 | 파일명 | `flex` (남는 공간) | `<div className="truncate text-xs text-fg-muted max-w-[420px]">{row.filename}</div>` + 작은 보조 `MIME` 표시는 컬럼 7로 분리 | 왼쪽 |
| 4 | 본문 길이 | `w-[90px]` | `contentLength != null ? ${(contentLength).toLocaleString()} 자 : '—'` (`text-xs text-fg-muted font-mono-num text-right`) | 우측 |
| 5 | 마지막 시도 | `w-[120px]` | `pdfExtractAt`을 KST 절대(`HH:mm` 또는 `M/D HH:mm`, `/admin/scans` `formatTimestamp` 동일) — hover tooltip ISO | 왼쪽 |
| 6 | 오류 메시지 | `flex` | `pdfExtractError ?? '—'`. `truncate text-xs text-danger max-w-[300px]` + `title={fullError}` | 왼쪽 |
| 7 | MIME | `w-[120px]` | `<span className="font-mono text-[11px] text-fg-muted truncate">` | 왼쪽 |
| 8 | 동작 | `w-[110px]` | `[재시도]` 버튼 (§A.8) | 우측 |

- 행 시각: `<tr>`에 status별 inset stripe — `/admin/scans` 패턴 그대로:
  - FAILED: `bg-rose-50/40 shadow-[inset_2px_0_0] shadow-rose-500 dark:bg-rose-950/20`
  - EXTRACTING: `bg-sky-50/40 shadow-[inset_2px_0_0] shadow-sky-400 dark:bg-sky-950/20`
  - DONE: `shadow-[inset_2px_0_0] shadow-emerald-400/60` (행 배경은 변경 없음)
  - PENDING: `shadow-[inset_2px_0_0] shadow-slate-300`
  - SKIPPED: 시각 강조 없음 (조용한 행)
- hover: 모든 행 공통 `hover:bg-bg-subtle`.
- 행 sticky thead: `<thead className="sticky top-0 z-10 bg-bg-subtle shadow-[inset_0_-1px_0] shadow-border">` (R36 패턴).

### A.7 `<PdfExtractStatusBadge>` 컴포넌트 (page-local)

- 패턴은 `<AttachmentScanBadge>` 그대로 미러. 신규 별도 파일 추출 없이 page-local 함수 컴포넌트로 두는 것 권장 (status enum이 페이지 외부에서 재사용될 일이 없음).
- 시각:

  ```tsx
  function PdfExtractStatusBadge({ status }: { status: PdfExtractStatus }) {
    const cls = {
      PENDING: 'bg-bg-subtle text-fg-muted border-border',
      EXTRACTING: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900',
      DONE: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900',
      FAILED: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900',
      SKIPPED: 'bg-bg-subtle text-fg-subtle border-border',
    }[status];
    const label = STATUS_LABEL[status];   // 대기/추출 중/완료/실패/제외
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
          cls,
        )}
        aria-label={`상태: ${label}`}
      >
        {status === 'EXTRACTING' ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : null}
        {label}
      </span>
    );
  }
  ```

- 색대비 AA: rose-800 on rose-50, emerald-800 on emerald-50, sky-800 on sky-50 모두 R37 audit 통과 조합 그대로.

### A.8 [재시도] 버튼 (행 동작)

```tsx
const canRetry = row.pdfExtractStatus === 'FAILED' || row.pdfExtractStatus === 'SKIPPED';
<Button
  size="sm"
  variant="outline"
  onClick={() => setRetryTarget(row)}
  disabled={!canRetry || retryPending}
  aria-disabled={!canRetry || undefined}
  aria-label={canRetry ? '재시도' : '재시도 불가 — 이 상태에서는 재시도할 수 없습니다'}
  className="h-7 px-2"
  title={canRetry ? undefined : '이 상태에서는 재시도할 수 없습니다'}
>
  {retryPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
  재시도
</Button>
```

- FAILED + SKIPPED만 활성 (계약 §4.2: 그 외 409 `E_STATE_CONFLICT`).
- DONE/PENDING/EXTRACTING은 disabled + tooltip "이 상태에서는 재시도할 수 없습니다".
- Disabled 상태에도 색대비 가시성 유지 (Tailwind shadcn Button의 disabled style이 AA 통과 — `disabled:opacity-50` 위에 텍스트 vs 배경 contrast는 그대로).
- 클릭 → `<ConfirmDialog>` (mutation 우발 실행 방지, R36 패턴).

### A.9 ConfirmDialog (재시도 확인)

```tsx
<ConfirmDialog
  open={retryTarget !== null}
  onOpenChange={(open) => { if (!open) setRetryTarget(null); }}
  title="PDF 본문 추출을 재시도하시겠습니까?"
  description={
    retryTarget ? (
      <span className="block space-y-1 text-sm">
        <span className="block font-mono-num text-[12px] text-fg">자료번호: {retryTarget.objectNumber}</span>
        <span className="block text-[12px] text-fg-muted">파일: {retryTarget.filename}</span>
        {retryTarget.pdfExtractError ? (
          <span className="block text-[11px] text-danger">마지막 오류: {retryTarget.pdfExtractError}</span>
        ) : null}
        <span className="block text-[11px] text-fg-muted">큐에 다시 추가됩니다.</span>
      </span>
    ) : undefined
  }
  confirmText="재시도"
  onConfirm={async () => {
    if (!retryTarget) return;
    await retryMutation.mutateAsync({ id: retryTarget.id });
    setRetryTarget(null);
  }}
/>
```

### A.10 retry mutation — optimistic update

```ts
const retryMutation = useMutation<
  unknown,
  ApiError,
  { id: string },
  { prev: PdfExtractListEnvelope | undefined; key: ReturnType<typeof queryKeys.admin.pdfExtracts> }
>({
  mutationFn: ({ id }) => api.post(`/api/v1/admin/pdf-extracts/${id}/retry`),
  onMutate: async (vars) => {
    const key = queryKeys.admin.pdfExtracts({ status: statusFilter === 'ALL' ? undefined : statusFilter });
    await queryClient.cancelQueries({ queryKey: ['admin', 'pdf-extracts'] });
    const prev = queryClient.getQueryData<PdfExtractListEnvelope>(key);
    if (prev) {
      const next: PdfExtractListEnvelope = {
        ...prev,
        data: prev.data.map((r) =>
          r.id === vars.id ? { ...r, pdfExtractStatus: 'PENDING', pdfExtractError: null } : r,
        ),
      };
      queryClient.setQueryData(key, next);
    }
    return { prev, key };
  },
  onSuccess: () => toast.success('추출 큐에 추가되었습니다.'),
  onError: (err, _vars, ctx) => {
    if (ctx?.prev) queryClient.setQueryData(ctx.key, ctx.prev);
    if (err.status === 409) {
      toast.warning('현재 상태에서는 재시도할 수 없습니다.', { description: err.message });
      return;
    }
    if (err.status === 403) { toast.error('재시도 권한이 없습니다.'); return; }
    if (err.code === 'E_RATE_LIMIT') { toast.error('요청 빈도 제한. 잠시 후 다시 시도하세요.'); return; }
    toast.error('재시도 실패', { description: err.message });
  },
  onSettled: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'pdf-extracts'] }); },
});
```

- `/admin/scans` 패턴 그대로. PENDING으로 즉시 flip → 폴링이 EXTRACTING → DONE/FAILED로 자연 후속 갱신.
- 504/Timeout은 별도 분기 없이 generic toast로 떨어뜨림.

### A.11 폴링 정책

- `refetchInterval` 콜백:

  ```ts
  refetchInterval: (query) => {
    if (!autoRefresh) return false;
    const counts = query.state.data?.meta.counts;
    if (!counts) return 5000;
    return counts.EXTRACTING > 0 || counts.PENDING > 0 ? 5000 : false;
  },
  refetchIntervalInBackground: false,
  ```

- 탭 hidden 동안 폴링 중지 (`refetchIntervalInBackground: false`), visibility return 시 `visibilitychange` 핸들러로 1회 refetch.

### A.12 useAdminPdfExtracts 훅 (queries.ts)

```ts
queryKeys.admin.pdfExtracts = (params: { status?: PdfExtractStatus; cursor?: string }) =>
  ['admin', 'pdf-extracts', params.status ?? 'ALL', params.cursor ?? ''] as const;

export function useAdminPdfExtracts(params: { status?: PdfExtractStatus }) {
  return useQuery<PdfExtractListEnvelope>({
    queryKey: queryKeys.admin.pdfExtracts(params),
    queryFn: () => fetchPdfExtracts(params),
    placeholderData: keepPreviousData,
    refetchInterval: ...,
    refetchIntervalInBackground: false,
  });
}

export function useRetryPdfExtract() {
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.post(`/api/v1/admin/pdf-extracts/${id}/retry`),
  });
}
```

- 페이지가 `useAdminPdfExtracts` 컴포지션을 직접 만들고 mutation도 페이지 안에서 직접 정의해도 됨. 훅 추출 vs 인라인은 frontend가 일관성 보고 결정. `/admin/scans`는 인라인이라 R41도 인라인 권장 (코드 일관성).

### A.13 Loading / Error / Empty (R36 패턴 그대로)

- Loading (`listQuery.isPending`): 테이블 영역에 8개 `<Skeleton className="h-9 w-full"/>`. 카운트 카드는 0/0/0/0/0으로 빈 카드 표시 (skeleton보다 카드 자체가 placeholder 역할).
- Error (`listQuery.isError`): 메인 테이블 영역에 `<EmptyState icon={AlertCircle} title="추출 이력을 불러오지 못했습니다" description={error.message} action={<Button onClick={refetch}>재시도</Button>}/>`. 403이면 title을 "조회 권한이 없습니다"로 swap.
- Empty (전체 0건): 

  - 필터 활성: `<EmptyState icon={Search} title="조건에 맞는 항목이 없습니다" action={<Button onClick={resetFilters}>필터 초기화</Button>}/>`
  - 필터 비활성 + 모든 카운트 0: `<EmptyState icon={CheckCircle2} title="처리 대기 중인 PDF가 없습니다" description="모든 PDF의 본문 인덱싱이 완료되었습니다."/>` — `/admin/scans`의 "감염된 첨부가 없습니다" 패턴과 일관.

---

## B. VulnerabilitiesTable (카드 B, /admin/security 보강)

### B.1 위치와 mount 조건

- 파일: 새 컴포넌트 `apps/web/components/admin/VulnerabilitiesTable.tsx`
- `apps/web/app/(main)/admin/security/page.tsx`에 다음 위치로 삽입:

  ```tsx
  // 기존:
  <SecurityAuditCard ... />
  <VulnerabilityCounts counts={counts} dimZeros={!allZero} />
  {allZero ? <VulnerabilitiesEmpty /> : null}

  // R41 변경 후:
  <SecurityAuditCard ... />
  <VulnerabilityCounts
    counts={counts}
    dimZeros={!allZero}
    activeSeverity={severityFilter}        // 카드 active 표시
    onToggle={toggleSeverityFilter}        // 카드 클릭 → 필터 토글
  />
  {allZero ? (
    <VulnerabilitiesEmpty />
  ) : (
    <VulnerabilitiesTable
      advisories={data?.advisories ?? []}
      severityFilter={severityFilter}      // 'critical'|'high'|'moderate'|'low'|null
      onClearFilter={() => setSeverityFilter(null)}
    />
  )}
  ```

- `allZero`(카드 4개 모두 0) → R40 EmptyState 그대로 (테이블 미표시). 카드 1+가 있으면 그 아래에 테이블 표시.
- 카드 4개 + 테이블 사이 간격: `space-y-6` 그대로.

### B.2 와이어프레임

```
┌── /admin/security (보강 후) ─────────────────────────────────────┐
│  의존성 보안                                                       │
│  ───────────────────────────────────────────────────              │
│                                                                    │
│  ┌─ 마지막 검사 ──────────────────┐                              │
│  │ 2026-04-28 14:23 (3시간 전)   │              [지금 검사]     │
│  └────────────────────────────────┘                              │
│                                                                    │
│  ┌────┐┌────┐┌────┐┌────┐                                        │
│  │ 1  ││ 4  ││ 7  ││ 12 │   ← 클릭 가능 카드 (aria-pressed)      │
│  │CRIT││HIGH││MOD ││LOW │      active일 때 ring-2 ring-brand/40  │
│  └────┘└────┘└────┘└────┘                                        │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 심각도│패키지        │제목                  │영향 범위 │ ↗ │ │ │
│  │ ─────────────────────────────────────────────────────────── │ │
│  │ [CRIT]│lodash        │Prototype pollution   │<4.17.21│  ↗  │ │ │
│  │ [HIGH]│axios         │SSRF in axios CRLF... │>=1.0..│  ↗  │ │ │
│  │ [HIGH]│next          │Cache poisoning ...   │14.0..14.2│ ↗ │ │ │
│  │ [MOD] │tar           │Symlink follow ...    │<6.2.1 │  ↗  │ │ │
│  │ ...                                                          │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  pnpm audit는 매일 02:00 KST 자동 실행됩니다 ...                  │
└────────────────────────────────────────────────────────────────────┘
```

### B.3 컴포넌트 props

```ts
interface Advisory {
  id: string | number;
  severity: 'critical' | 'high' | 'moderate' | 'low';
  title: string;
  package: string;
  versionRange: string | null;
  url: string | null;
}

interface VulnerabilitiesTableProps {
  advisories: Advisory[];
  severityFilter: Advisory['severity'] | null;
  onClearFilter: () => void;
}
```

### B.4 정렬 + 필터링

- 컴포넌트 내부에서:
  1. 필터: `severityFilter ? advisories.filter(a => a.severity === severityFilter) : advisories`
  2. 정렬:
     ```ts
     const SEVERITY_ORDER = { critical: 0, high: 1, moderate: 2, low: 3 } as const;
     filtered.sort((a, b) => {
       const d = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
       if (d !== 0) return d;
       return a.package.localeCompare(b.package);
     });
     ```
- 정렬 가능 컬럼 헤더는 R41에서는 제공하지 않음 — 위 고정 정렬로 충분 (advisory 보통 < 30건).

### B.5 컬럼

| # | 컬럼 | 폭 | 내용 |
|---|---|---|---|
| 1 | 심각도 | `w-[100px]` | `<SeverityBadge severity={a.severity}/>` |
| 2 | 패키지 | `w-[180px]` | `<span className="font-mono text-[12px] text-fg">{a.package}</span>` |
| 3 | 제목 | `flex` | `<span className="text-sm text-fg truncate" title={a.title}>{a.title}</span>` (max-w-[420px] truncate) |
| 4 | 영향 범위 | `w-[160px]` | `<span className="font-mono text-[11px] text-fg-muted truncate" title={a.versionRange ?? ''}>{a.versionRange ?? '—'}</span>` |
| 5 | 링크 | `w-[48px]` | 아이콘 only `<a target="_blank" rel="noopener noreferrer">` (§B.7) |

- thead sticky: `sticky top-0 z-10 bg-bg-subtle shadow-[inset_0_-1px_0] shadow-border`. 단, 페이지 전체 max-w-6xl 안쪽이라 sticky가 viewport 천장에 붙지 않고 컨테이너 안에서만 작동 — admin/security 메인 영역이 `overflow-auto`이고 테이블은 그 안의 일반 element라 sticky는 의미 약함. **결론: thead sticky 생략 가능** (advisory ~30건이라 스크롤 깊이 작음).

### B.6 SeverityBadge

- R36에 `<SeverityBadge>` 같은 공용 컴포넌트가 있는지 확인하고, 있으면 재사용. **없으면** VulnerabilitiesTable 안에 page-local로 정의.

```tsx
function SeverityBadge({ severity }: { severity: Advisory['severity'] }) {
  const cls = {
    critical: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900',
    high: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900',
    moderate: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900',
    low: 'bg-bg-subtle text-fg-muted border-border',
  }[severity];
  const label = SEVERITY_LABEL[severity];   // Critical / High / Moderate / Low (영문 그대로 — pnpm audit 표준)
  const ariaLabel = SEVERITY_ARIA[severity]; // 한글: 심각, 높음, 보통, 낮음
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide', cls)}
      aria-label={`심각도: ${ariaLabel}`}
    >
      {label}
    </span>
  );
}
```

- 색 매핑:

  | severity | bg | text | 토큰 |
  |---|---|---|---|
  | critical | rose-50 | rose-800 | danger 톤 |
  | high | amber-50 | amber-800 | warning 톤 |
  | moderate | sky-50 | sky-800 | info 톤 |
  | low | bg-subtle | fg-muted | neutral |

- **R40 §J #7과의 정합성:** R40에서 "Critical만 danger, High는 warning"으로 dot 색을 매핑했음. R41 SeverityBadge도 같은 규칙 (critical=rose, high=amber). **VulnerabilityCounts dot 색과 SeverityBadge 색이 1:1 일치 보장.** Moderate는 R40 dot에서 `bg-warning/60`였지만 badge는 톤을 분리해 sky 계열(info)로. 사유: badge는 pill 형태로 정보량이 dot보다 크므로 amber/60 같은 반투명 변형이 가독성 떨어짐 → moderate를 별도 톤(sky=info)으로 분리하는 게 시각적 위계 명확. **단, dot 색은 R40 그대로(`bg-warning/60`)** 유지 (카드 위계 vs badge 위계의 의미 다름).

### B.7 advisory 링크

- 컬럼 5: `<a href={a.url} target="_blank" rel="noopener noreferrer" aria-label={`${a.package} ${SEVERITY_ARIA[a.severity]} 취약점 외부 게시판 (새 탭)`} className="app-icon-button inline-flex h-7 w-7 items-center justify-center text-fg-muted hover:text-fg">` + `<ExternalLink className="h-3.5 w-3.5" aria-hidden="true"/>`
- url이 null이면 disabled 시각: `<span className="inline-flex h-7 w-7 items-center justify-center text-fg-subtle/40" aria-hidden="true"><ExternalLink className="h-3.5 w-3.5"/></span>` + `aria-label="외부 링크 없음"`
- target=`_blank` + rel=`noopener noreferrer` 필수 (외부 링크 보안 가드).

### B.8 행 시각

- 행 hover: `hover:bg-bg-subtle`
- 행 좌측 inset stripe: severity 색
  - critical: `shadow-[inset_2px_0_0] shadow-rose-500`
  - high: `shadow-[inset_2px_0_0] shadow-amber-500`
  - moderate: `shadow-[inset_2px_0_0] shadow-sky-400/60`
  - low: 시각 강조 없음
- 행 클릭은 별도 동작 없음 (advisory 외부 링크는 명시적 아이콘 클릭으로만).

### B.9 활성 필터 표시 + 해제

- 필터 active 상태에서 테이블 위에 작은 chips 영역:

  ```tsx
  {severityFilter ? (
    <div className="flex items-center gap-2 px-1 py-1 text-xs">
      <span className="text-fg-muted">필터:</span>
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-subtle px-2 py-0.5 text-fg">
        {SEVERITY_LABEL[severityFilter]}
        <button
          type="button"
          onClick={onClearFilter}
          aria-label="필터 해제"
          className="rounded-full p-0.5 hover:bg-bg-muted"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      </span>
    </div>
  ) : null}
  ```

- chip 클릭 또는 카드 재클릭 → `onClearFilter` → severityFilter null → 테이블 전체 표시.

### B.10 페이지네이션

- **R41 1차: 일괄 표시 (페이지네이션 없음).** 사유: pnpm audit advisory는 보통 0~30건. > 50건 가능성 낮음.
- 안전망: 50건 초과 시 `[더 보기 ({total - 50})]` 버튼 (lazy expansion). 초기 50건만 렌더, 클릭 시 전체. 50/100 임계값 PM 결정 필요 (§I #3).
- 무한 스크롤은 과잉.

### B.11 Loading / Error / Empty

- advisory 0건: `allZero` 분기에서 이미 R40 VulnerabilitiesEmpty 표시. **VulnerabilitiesTable 자체는 mount되지 않음** (§B.1 참조).
- advisory > 0이지만 필터 적용 후 0건: 필터 active state에서 테이블 본문 자리에 작은 in-table empty:

  ```tsx
  <tr>
    <td colSpan={5} className="px-3 py-8 text-center text-sm text-fg-muted">
      {SEVERITY_LABEL[severityFilter]} 심각도의 취약점이 없습니다.
      <button type="button" onClick={onClearFilter} className="ml-2 text-brand underline">필터 해제</button>
    </td>
  </tr>
  ```

- Loading: VulnerabilityCounts와 같은 query를 쓰므로 별도 skeleton 불필요 (auditQuery.isLoading 동안은 LoadingPanels가 페이지 전체 점령).

---

## C. 카운트 카드 클릭 → 필터 인터랙션 (카드 C)

### C.1 인터랙션 토큰 (양쪽 페이지 통일)

- /admin/scans는 `aria-pressed={active}` + active 시 `bg-bg-subtle ring-2 ring-brand/40`로 정착.
- **R41은 양쪽(/admin/pdf-extracts + /admin/security) 카드를 동일 토큰으로 통일.**

### C.2 idle ↔ active 시각

| 상태 | 시각 | 토큰 |
|---|---|---|
| idle | 기본 카드. `bg-bg`. hover 시 `hover:bg-bg-subtle hover:border-border-strong` | `border border-border` (border-l 색만 status별로 지정) |
| active | `bg-bg-subtle` + `ring-2 ring-brand/40` | brand ring으로 활성 시그널 |
| disabled (값=0이고 dim 모드) | `opacity-60` + 클릭은 여전히 가능 (필터 적용 후 in-table empty 메시지) | R40 dimZeros 패턴 |

- ring 두께/색: 2px + brand/40. **bg fill은 별도 도입 안 함** — `/admin/scans`가 ring-2 + bg-subtle 조합으로 충분히 active 시각이 확립되어 있고, R37 색대비 audit 통과 조합 그대로 재사용. (PM 결정 §I #4 — bg fill을 더 진하게 가는 옵션도 가능하나 현 시스템 일관성 우선.)
- focus visible: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`. ring(active)와 focus ring이 다른 색이라 키보드 사용자 시각적 구분 가능.

### C.3 ARIA / 키보드

- `<button type="button" aria-pressed={active}>` — Radix 토글 패턴.
- aria-label 한글 합성: `${label} ${value}건${active ? ', 필터 활성' : ''}` 예) "Critical 1건, 필터 활성".
- **키보드 nav:**
  - Tab으로 카드 그룹 진입 → 첫 카드 focus.
  - Tab으로 카드 사이 이동 (Arrow는 도입 안 함 — 카드 5/4개라 Tab 충분).
  - Space 또는 Enter로 토글 (button 기본 동작).
  - 같은 카드 재 Space/Enter → 필터 해제 (§C.4).

### C.4 토글 동작

```ts
const toggleStatusFilter = (kind: PdfExtractStatus) =>
  setStatusFilter((cur) => (cur === kind ? 'ALL' : kind));

// /admin/security
const toggleSeverityFilter = (sev: Advisory['severity']) =>
  setSeverityFilter((cur) => (cur === sev ? null : sev));
```

- 동일 카드 재클릭 → 필터 해제 (active=null/ALL).
- 다른 카드 클릭 → 새 필터로 swap (이전 active 자동 해제).

### C.5 [지금 검사] mutation과 필터 active의 직교성

- 사용자가 critical 카드 active 상태에서 [지금 검사] 클릭 → mutation 진행 → query invalidate → 새 데이터 → severityFilter는 그대로 유지. 사유: 필터는 view state, mutation은 data state. UX 직관 일치.
- mutation 후 새 데이터에서 critical = 0이 됐다면 카드는 active 표시 유지 + 테이블 본문은 in-table empty ("Critical 심각도의 취약점이 없습니다 ...") 표시 → 사용자는 "패치가 효과 있었구나"를 즉시 인지. (`/admin/pdf-extracts`도 동일 — FAILED 필터 active에서 [재시도] 후 FAILED 카드 0이 되면 in-table empty.)

### C.6 URL sync (선택)

- R41 1차에서는 URL sync 없음 (페이지 세션 state만). 사유:
  1. /admin/scans도 URL sync 없이 운영 중 — 일관성.
  2. admin이 새 탭에서 같은 페이지 다시 열 때 필터가 자동 초기화되는 게 오히려 직관적 (전체 보기로 시작).
- 다음 라운드 후보: `?status=FAILED` 같은 query param. PM 결정 필요 시 frontend 1줄 변경.

---

## D. /admin/pdf-extracts 카드 클릭 필터 (A에서 C 토큰 재사용)

§C 토큰 그대로 재사용. /admin/scans 패턴 재사용. 추가 명세 없음.

### D.1 검색 input과의 직교성

- 카드 필터(상태) + 검색 input(텍스트)는 서로 독립. 검색 input 입력 → 클라이언트 substring + 카드 필터 적용된 row pool에서 추가 필터.
- "필터 초기화" 버튼은 둘 다 reset.

---

## E. 디자인 토큰

### E.1 신규 토큰

**없음.** R36/R37/R40에서 정착된 토큰만 사용:

| 용도 | 토큰 / 클래스 | 비고 |
|---|---|---|
| 카드 컨테이너 | `app-panel` 또는 `border border-border bg-bg rounded-md` | R28 패턴 |
| 카드 활성 ring | `ring-2 ring-brand/40 bg-bg-subtle` | /admin/scans 패턴 |
| 카드 dim (값=0) | `opacity-60` | R40 패턴 |
| 카드 dot — PENDING | `bg-fg-muted` 또는 `bg-slate-400` | R36 패턴 |
| 카드 dot — EXTRACTING | `bg-sky-500` + `animate-pulse` | R36 SCANNING 패턴 미러 |
| 카드 dot — DONE | `bg-emerald-500` | R36 CLEAN |
| 카드 dot — FAILED | `bg-rose-500` | R36 INFECTED |
| 카드 dot — SKIPPED | `bg-slate-300` | R36 SKIPPED |
| 카드 border-l — PENDING | `border-l-slate-400` | R36 |
| 카드 border-l — EXTRACTING | `border-l-sky-400` | R36 |
| 카드 border-l — DONE | `border-l-emerald-400` | R36 |
| 카드 border-l — FAILED | `border-l-rose-500` | R36 |
| 카드 border-l — SKIPPED | `border-l-slate-300` | R36 |
| Badge 색 — DONE/CLEAN | `bg-emerald-50 text-emerald-800 border-emerald-200` | R37 audit 통과 |
| Badge 색 — FAILED/INFECTED | `bg-rose-50 text-rose-800 border-rose-200` | R37 |
| Badge 색 — EXTRACTING/SCANNING | `bg-sky-50 text-sky-800 border-sky-200` | R37 |
| Badge 색 — Critical (severity) | `bg-rose-50 text-rose-800 border-rose-200` | R40 일치 |
| Badge 색 — High (severity) | `bg-amber-50 text-amber-800 border-amber-200` | R40 일치 |
| Badge 색 — Moderate (severity) | `bg-sky-50 text-sky-800 border-sky-200` | 신규 매핑 (info 톤) — R40 dot의 `warning/60`과는 다름. 사유 §B.6 |
| Badge 색 — Low (severity) | `bg-bg-subtle text-fg-muted border-border` | neutral |
| 행 inset stripe — FAILED/critical | `shadow-[inset_2px_0_0] shadow-rose-500` | R36 |
| 행 inset stripe — EXTRACTING | `shadow-[inset_2px_0_0] shadow-sky-400` | R36 |
| 외부 링크 아이콘 | `<ExternalLink className="h-3.5 w-3.5"/>` lucide | 신규 사용처지만 토큰 변경 없음 |
| 재시도 spinner | `<Loader2 className="h-3.5 w-3.5 animate-spin"/>` lucide | R36 패턴 |
| in-table empty | `text-sm text-fg-muted` + 내부 `text-brand underline` 링크 | 신규 패턴 — text-brand는 existing 토큰 |

### E.2 변경 토큰

**없음.**

### E.3 간격

- /admin/pdf-extracts 메인 컨테이너: 페이지 전체에 wrapper space 미사용 (각 stripe가 self-contained — `/admin/scans`와 동일).
- /admin/security: `space-y-6` 그대로 (R40에서 정착).
- 카운트 카드 grid:
  - /admin/pdf-extracts: `grid grid-cols-2 gap-3 px-6 pt-4 md:grid-cols-3 xl:grid-cols-5` (5 카드)
  - /admin/security: `grid grid-cols-4 gap-3` (4 카드, R40 그대로)
- 1280에서:
  - 5 카드: AdminSidebar 제외 viewport ≈ 1080px → 5 카드 한 줄에 배치 OK (각 ≈ 200px)
  - 4 카드: 동일 폭 ≈ 250px

### E.4 타이포

- /admin/pdf-extracts h1: `text-2xl font-semibold text-fg` (`/admin/scans`와 일치)
- /admin/security h1: `text-xl font-semibold text-fg` (R40 그대로)
- 카드 라벨: `text-[11px] font-medium uppercase text-fg-subtle`
- 카드 값: `text-2xl font-semibold tabular-nums text-fg` (R36 패턴) — R40의 `text-3xl`과 다름 (R40은 카드 4개 큰 표시, R41은 카드 5개라 한 단계 작게). **R40 카운트 카드는 그대로 `text-3xl` 유지** (페이지 정체성).

---

## F. 접근성 (WCAG 2.1 AA)

### F.1 카운트 카드 (양쪽 페이지)

- `<button type="button" aria-pressed={active}>` 시맨틱.
- aria-label 한글: `${label} ${value}건${active ? ', 필터 활성' : ''}`
- 키보드 nav: Tab으로 진입, Space/Enter 토글.
- 색만으로 의미 전달 안 함: dot 색 + 텍스트 라벨(PENDING/EXTRACTING/...) + 한글 보조 라벨(대기/추출 중/...) 항상 함께 표시.
- focus visible: `focus-visible:ring-2 focus-visible:ring-ring`.
- 색대비:
  - 카드 본문 `text-fg` on `bg-bg`: AA 통과 (R37 audit).
  - 카드 active 상태 `text-fg` on `bg-bg-subtle`: AA 통과.
  - dim 카드 `opacity-60` 상태: 텍스트 가독성 악화는 되지만 active 카드와 시각 위계 분리 의도. SR은 `opacity`에 영향 없음.

### F.2 PdfExtractsTable

- `<table>` + `<thead>` + `<tbody>` 시맨틱.
- 각 `<th scope="col">` 명시.
- 행: `<tr>` `<td>` 일반. row level role 추가 없음.
- 재시도 버튼: disabled 시 `disabled` 속성 + `aria-disabled="true"` + `title` (tooltip, 마우스 hover 시 사유 표시) + `aria-label`로 사유 announce.
- spinner: `aria-hidden="true"` + 라벨 텍스트 "재시도"는 그대로 SR이 읽음.
- 외부 링크(자료 상세, R36 패턴 재사용): `aria-label="자료 상세 새 탭에서 열기"`.

### F.3 VulnerabilitiesTable

- 동일 `<table>` 시맨틱.
- SeverityBadge: `aria-label="심각도: 심각/높음/보통/낮음"`. 시각 라벨은 영문(Critical/High/Moderate/Low)이지만 SR은 한글 announce.
- advisory 링크: `aria-label={`${package} ${SEVERITY_ARIA[severity]} 취약점 외부 게시판 (새 탭)`}` + `target="_blank"` + `rel="noopener noreferrer"`.
- url null인 경우 placeholder span `aria-label="외부 링크 없음"`로 명시.
- 정렬 가능 컬럼 없음 — `aria-sort` 미적용.
- 필터 active chip의 [X] 버튼: `aria-label="필터 해제"`.

### F.4 색대비 (R37 audit 결과 그대로)

| 조합 | 비율 | 판정 |
|---|---|---|
| `text-fg` on `bg-bg` | 14.5:1 | AAA |
| `text-fg-muted` on `bg-bg` | 5.7:1 | AA |
| `text-rose-800` on `bg-rose-50` | 9.1:1 | AAA |
| `text-amber-800` on `bg-amber-50` | 8.4:1 | AAA |
| `text-sky-800` on `bg-sky-50` | 9.6:1 | AAA |
| `text-emerald-800` on `bg-emerald-50` | 8.8:1 | AAA |
| `text-danger` on `bg-bg` | 5.4:1 | AA |
| Disabled button text on `bg-bg` (`disabled:opacity-50`) | 7.2:1 → 3.6:1 | AA (interactive disabled, exempt) |

모두 R37 통과 토큰만 사용 → 신규 audit 불필요.

---

## G. Loading / Error / Empty (페이지별 정리)

### G.1 /admin/pdf-extracts

| 상태 | 시각 |
|---|---|
| Loading (listQuery.isPending) | 카운트 카드 5개 0/0/0/0/0 + 테이블 자리 8개 `<Skeleton h-9 w-full/>` |
| Error (listQuery.isError) | 테이블 자리 `<EmptyState icon={AlertCircle} title="추출 이력을 불러오지 못했습니다" description={err.message} action={<Button>재시도</Button>}/>`. 403이면 title swap. |
| Empty — 필터 active, 매칭 0 | `<EmptyState icon={Search} title="조건에 맞는 항목이 없습니다" action={<Button>필터 초기화</Button>}/>` |
| Empty — 전체 0 (모든 카운트 0) | `<EmptyState icon={CheckCircle2} title="처리 대기 중인 PDF가 없습니다" description="모든 PDF의 본문 인덱싱이 완료되었습니다."/>` |
| Mutation pending (재시도) | 해당 행의 [재시도] 버튼 disabled + `<Loader2/>` |
| 폴링 중 fetch | 우측 상단 `<RefreshCw className="animate-spin"/>` (`/admin/scans`와 동일 — autoRefresh 라벨 옆 `<Loader2 h-3 w-3>`) |

### G.2 /admin/security 보강

| 상태 | 시각 |
|---|---|
| Loading | R40 LoadingPanels 그대로 (Skeleton h-20 + 4 × Skeleton h-24) |
| Error (auditQuery.isError) | R40 ErrorBanner 그대로 |
| advisory 0건 (allZero) | R40 VulnerabilitiesEmpty 그대로 (테이블 mount 안 됨) |
| advisory > 0이지만 필터 active 매칭 0 | 테이블 본문 in-table empty (`<tr><td colSpan={5}>...</td></tr>`) |
| Mutation pending (지금 검사) | R40 SecurityAuditCard 4상태 그대로 |

---

## H. 검증 체크리스트 (frontend가 구현 완료했을 때)

### H.1 /admin/pdf-extracts (카드 A)

- [ ] AdminSidebar의 "통합/로그 → PDF 본문 추출" 항목 진입 동작
- [ ] 비-admin 사용자가 직접 URL 진입 → 403 또는 / redirect (layout 가드)
- [ ] 페이지 로드 → 카운트 5 카드(PENDING/EXTRACTING/DONE/FAILED/SKIPPED) + 테이블 표시
- [ ] 카드 색 매핑이 §A.3 표 그대로 (PENDING=neutral, EXTRACTING=info+pulse, DONE=success, FAILED=danger, SKIPPED=neutral subtle)
- [ ] EXTRACTING 카드 dot에 `animate-pulse` (값 > 0일 때만)
- [ ] 카드 클릭 → `aria-pressed=true` + ring-2 ring-brand/40 + bg-bg-subtle
- [ ] 같은 카드 재클릭 → 필터 해제 (`statusFilter === 'ALL'`)
- [ ] 다른 카드 클릭 → 필터 swap
- [ ] 상태 select와 카드 active 양방향 동기
- [ ] 검색 input은 클라이언트 substring (자료번호/파일명/오류 메시지)
- [ ] "필터 초기화" 버튼이 statusFilter + textQuery 모두 reset
- [ ] 5초 자동 새로고침 토글 + EXTRACTING 또는 PENDING > 0 일 때만 실제 폴링
- [ ] 탭 hidden 동안 폴링 중지, visibility return 시 1회 refetch
- [ ] [재시도] 버튼: FAILED + SKIPPED만 활성, 그 외 disabled + tooltip "이 상태에서는 재시도할 수 없습니다"
- [ ] [재시도] 클릭 → ConfirmDialog → 확정 시 mutation → optimistic flip(PENDING) → 토스트 "추출 큐에 추가됨" → 폴링이 EXTRACTING → DONE/FAILED로 자연 갱신
- [ ] 409 응답 시 optimistic 롤백 + warning 토스트
- [ ] 403 응답 시 error 토스트 "재시도 권한이 없습니다"
- [ ] 자료번호 클릭 → /objects/{objectId} 새 탭
- [ ] thead sticky, 행 inset stripe 색상 §A.6 그대로
- [ ] PdfExtractStatusBadge 색대비 AA 통과 (rose-800 on rose-50 등 R37 검증 토큰)
- [ ] cursor 있을 때 [더 보기] 버튼 표시 + 클릭 시 buffer 누적
- [ ] Loading/Error/Empty 시각 §G.1 그대로
- [ ] 색만으로 status 표현하지 않음 — 라벨 텍스트(대기/추출 중/...) 항상 함께 표시

### H.2 VulnerabilitiesTable (카드 B)

- [ ] /admin/security 카운트 카드 4개 아래에 테이블 mount (allZero일 때만 EmptyState)
- [ ] advisory 배열 정렬: severity 우선(critical→low) → 같은 severity 내 package alpha
- [ ] 컬럼 5개: 심각도 / 패키지 / 제목 / 영향 범위 / 외부 링크 (§B.5)
- [ ] SeverityBadge 색 매핑이 §B.6 표 그대로 (critical=rose, high=amber, moderate=sky, low=neutral)
- [ ] R40 dot 매핑(critical=danger, high=warning)과 R41 badge 매핑이 critical/high에서 일치
- [ ] 외부 링크 아이콘 only `target="_blank" rel="noopener noreferrer"` + aria-label
- [ ] url null인 advisory의 링크는 dim placeholder + aria-label="외부 링크 없음"
- [ ] 행 hover bg-bg-subtle, 행 좌측 inset stripe (§B.8)
- [ ] 카드 클릭 → 해당 severity로 필터 + 활성 chip 표시 + 카드 ring-2
- [ ] 카드 재클릭 또는 chip [X] 클릭 → 필터 해제
- [ ] 필터 active 매칭 0건 → in-table empty + [필터 해제] 링크
- [ ] [지금 검사] mutation 후 invalidate → 새 advisories로 갱신, severityFilter는 유지
- [ ] 50건 초과 시 [더 보기] 버튼 (또는 PM 결정 임계값)
- [ ] 색만으로 severity 표현 안 함 — 텍스트 라벨(Critical/High/...) 함께

### H.3 카운트 카드 클릭 필터 (카드 C)

- [ ] 양쪽 페이지에서 동일 시각 토큰 (ring-2 ring-brand/40 + bg-bg-subtle)
- [ ] aria-pressed 시맨틱 + 한글 aria-label
- [ ] Tab → 첫 카드 focus → Space/Enter 토글
- [ ] focus-visible 시 ring (active ring과 다른 색)
- [ ] 같은 카드 재 toggle → 해제
- [ ] 다른 카드 toggle → swap
- [ ] dim 카드(값=0)도 클릭 가능, 클릭 시 in-table empty 메시지
- [ ] mutation 트리거(지금 검사 / 재시도) 후 active 유지 (data state ≠ view state)

### H.4 회귀

- [ ] R40 /admin/security 기존 동작(allZero EmptyState, [지금 검사] 4상태) 그대로
- [ ] R36 /admin/scans 영향 없음
- [ ] AdminSidebar 다른 메뉴 항목 영향 없음
- [ ] R40 VulnerabilityCounts 컴포넌트가 R41에서 props 확장 후 기존 사용처 깨지지 않음 (`activeSeverity?: ... | null`, `onToggle?: ...` 둘 다 optional)
- [ ] queries.ts에 신규 useAdminPdfExtracts / useRetryPdfExtract 훅이 기존 훅과 충돌 없이 추가
- [ ] admin-groups.ts에 새 항목 추가 후 다른 항목 순서/icon/label 변경 없음

---

## I. PM 결정 필요 / TBD 항목

| # | 항목 | 권장 | 영향 |
|---|---|---|---|
| 1 | /admin/pdf-extracts 사이드바 아이콘 | **`FileText`** (lucide, "PDF + 텍스트" 의미). 후보: `FileSearch`, `FileType` | admin-groups.ts 1줄 |
| 2 | /admin/pdf-extracts 사이드바 그룹 위치 | **"통합/로그 → 변환 작업 바로 아래"** (워커류 묶음). 후보: 통합/로그 끝 (의존성 보안 옆) | admin-groups.ts 위치 1줄 |
| 3 | VulnerabilitiesTable 페이지네이션 임계값 | **50건 초과 시 [더 보기]**. 후보: 30 / 100 | VulnerabilitiesTable.tsx slice 숫자 1개 |
| 4 | 카운트 카드 클릭 필터 active 시각 강도 | **ring-2 ring-brand/40 + bg-bg-subtle (현 시스템 일관성)**. 후보: bg-{color}/10 fill (각 status 색으로 더 진한 active) | StatCard className |
| 5 | /admin/pdf-extracts 카드 라벨 한글 vs 영문 표기 | **kicker는 영문 status(PENDING/EXTRACTING/...) + 본문 라벨은 한글(대기/추출 중/...)** — `/admin/scans` 패턴 | 시각 |
| 6 | URL sync (`?status=`) | **R41 1차에서는 미적용** (페이지 세션 state). 후보: R42에서 양쪽 페이지 동시 도입 | 라우팅 |
| 7 | retry 버튼 ConfirmDialog 강제 vs 즉시 mutation | **ConfirmDialog 강제** (재시도가 무료가 아님 — 워커 자원 소모). `/admin/scans`도 ConfirmDialog | UX |

---

## J. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-04-28 | 초기 작성 (R41 designer agent) — /admin/pdf-extracts 신설 + VulnerabilitiesTable 신설 + 카운트 카드 클릭 필터 인터랙션 통일 토큰 정리 |
