# R31 Design Spec — Print Dialog (P-1) + Chunked Upload (V-INF-2)

| 항목 | 내용 |
|---|---|
| 작성자 | drawing-mgmt designer agent (R31) |
| 작성일 | 2026-04-27 |
| 기준 main HEAD | `2ba38e1` |
| 대상 라운드 | R31 |
| 대상 PRD/DESIGN | `docs/PRD.md`, `docs/DESIGN.md` (§4 글로벌 레이아웃, §6.4 자료 상세, §6.6 검색) |
| 신규 컴포넌트 | `<PrintDialog>`, `<ChunkProgressBar>` (utility) |
| 확장 컴포넌트 | `<AttachmentUploadDialog>` (5MB+ 자동 청크) |
| 의존 (BE) | `_workspace/api_contract.md` §3 (`POST /attachments/{id}/print`, `GET /print-jobs/{jobId}/status`), §5 (`POST /uploads`, `PATCH /uploads/{id}`, `POST /uploads/{id}/finalize`, `DELETE /uploads/{id}`) |
| 디바이스 | Desktop only (≥1280) |
| 디자인 토큰 변경 | 없음 — 기존 Tailwind palette + `.app-action-button`, `.app-panel`, `.app-kicker` 활용 |
| 새 단축키 | `⌘P` / `Ctrl+P`(자료 상세에서 인쇄 다이얼로그 열기 — 브라우저 기본 인쇄 가로채기) — 자세한 내용은 §A.6 |

---

## 0. 라운드 개요와 사용자 시나리오

### 0.1 두 카드가 같은 라운드에 묶이는 이유

P-1(인쇄)와 V-INF-2(청크 업로드)는 **기능 영역은 다르지만 모두 "긴 시간이 걸리는 비동기 작업의 진행률을 사용자에게 보여주는 다이얼로그"라는 공통 UX 패턴**을 공유한다. 한 라운드에 묶음으로써:

- 진행률 컴포넌트 디자인을 한 번에 결정 (양쪽 다 progress bar + 속도/ETA + 취소).
- BullMQ 큐 polling 인터벌(250ms)을 두 카드 공통으로 통일.
- 사용자가 "왜 인쇄와 업로드가 다르게 동작해?"라고 헷갈리지 않게 한다.

### 0.2 페르소나별 시나리오

| 페르소나 | P-1 시나리오 | V-INF-2 시나리오 |
|---|---|---|
| 슈퍼관리자 | 큰 도면(A0)을 A3로 모노크롬 출력해 회의에 사용 | 협력업체에서 받은 250MB DWG를 자료에 첨부 |
| 관리자 | 동일 + 관련자에게 PDF 링크 공유 | 동일 + DWG 변환 큐 진입 확인 |
| 설계자 (10~15명) | 본인 작업 도면 인쇄 (CAD 미설치 자리에서도 가능해야 함) | 100~500MB DWG/PDF 첨부가 일상 — 가장 빈번한 사용자 |
| 열람자 / 협력업체 | 다운로드 권한 있는 도면을 PDF로 받아 인쇄 — DWG 파일 자체를 받지 못해도 PDF는 받아야 함 | 협력업체는 폴더에 따라 업로드 권한 유무 분기 |

### 0.3 핵심 시나리오 6개

1. **A0 도면을 A3 모노로 인쇄(설계자):** 자료 상세 → `인쇄` 버튼 → CTB `mono` + 페이지 `A3` 선택 → `PDF 생성` → 진행률 표시 → 완료 시 `다운로드` 또는 `브라우저 인쇄` 둘 중 선택.
2. **이미 PDF 캐시된 자료(설계자):** 동일 진입 → BE가 cached path 응답 → "이미 변환된 PDF가 있습니다 (3분 전)" 메시지 + `다운로드` 즉시 활성화.
3. **검색 페이지 row에서 인쇄(관리자):** 검색 결과 row의 `⋯` 메뉴 → `인쇄` → 동일 다이얼로그 (objectId 대신 masterAttachmentId 전달).
4. **150MB DWG 첨부(설계자):** 자료 상세 → `+ 첨부` → 파일 선택 후 size=152MB 감지 → 다이얼로그 하단에 "5MB 청크로 31분할 업로드" 안내 + 진행률(MB/MB, %) + 속도(KB/s) + ETA → 완료 시 일반 첨부와 동일 처리.
5. **업로드 중 사용자가 닫기:** progress bar 표시 중 `취소` 또는 `Esc` → 확인 ConfirmDialog → `DELETE /uploads/{id}` 호출 → 다이얼로그 닫힘.
6. **네트워크 끊김 → 재시도(설계자):** PATCH 청크 실패 → "전송 실패. 재시도(2/3)…" 메시지 + 자동 3회 재시도 → 마지막까지 실패 시 `재시도` 버튼 노출 (마지막 성공 offset부터 재개).

---

## A. 인쇄 다이얼로그 (P-1)

### A.1 진입점 — 어디서 열리는가

**진입점 1 — 자료 상세 페이지 (`/objects/[id]`):**
- 기존 `ActionButton` 행(`apps/web/app/(main)/objects/[id]/page.tsx:735~`)에 `다운로드` 버튼 **다음에 `인쇄` 버튼 신규 추가**.
- 라벨: `인쇄`. 아이콘: `Printer` (lucide-react).
- 가시성 (`vis.print`): `obj.masterAttachmentId != null` AND `vis.download === true` (PDF 출력은 다운로드 권한과 동등하게 취급 — PRD §3.1 설계자/열람자/협력업체 모두 가능).
  - PM-DECISION-1(채택): `download` 권한 = `print` 권한. 별도 `PRINT` 비트는 추가하지 않음. BE가 `download`로 검사.
- `obj.masterAttachmentId == null`이면 비활성(`disabled`) + `tooltip="인쇄할 마스터 파일이 없습니다."`.
- 또한 우상단 dropdown(`MoreHorizontal`)의 `다운로드` 항목 **아래**에도 `인쇄` 항목 동시 추가 (R7 패턴 일관성).

**진입점 2 — 검색 결과 (`/search/page.tsx`):**
- `<ObjectTable>` 행 hover 시 우측에 노출되는 `⋯` 액션 dropdown에 `인쇄` 항목 추가.
- `obj.masterAttachmentId == null` 행에서는 `disabled`.

**진입점 3 — 자료 상세 첨부 list (선택, Phase 2):**
- 첨부 목록 각 row 우측 `⋯` 메뉴에 `인쇄` 항목. 마스터가 아닌 첨부도 출력 가능.
- 이번 라운드(R31) 미수행 — PM이 결정.

**진입점 4 — 단축키:**
- `⌘P` / `Ctrl+P` (자료 상세 페이지 한정): 브라우저 기본 인쇄를 `e.preventDefault()`로 막고 `<PrintDialog>` 오픈.
- `apps/web/components/ShortcutsDialog.tsx`에 한 줄 추가 (`P + ⌘ — 인쇄`).
- 검색 페이지에서는 가로채지 않음 (다중 선택의 의미 모호 — Phase 2).

### A.2 다이얼로그 레이아웃 (480px 고정 폭)

```
┌─ Dialog (max-w-md = 28rem ≈ 448px) ───────────────────────────────┐
│ DialogHeader                                                         │
│   ▸ Title:  "인쇄 옵션"                                              │
│   ▸ Description: "PDF로 변환해 다운로드하거나 브라우저에서          │
│                   인쇄할 수 있습니다. 큰 도면은 1~2분 걸립니다."     │
├──────────────────────────────────────────────────────────────────────┤
│ ─ Info row (target file) ──────────────────────────────────────────  │
│   FileTypeIcon  drawing-cgl-204.dwg                                  │
│                 R3 v0.2 · 12.4 MB                                    │
├──────────────────────────────────────────────────────────────────────┤
│ ─ Options ─────────────────────────────────────────────────────────  │
│   출력 방식  [○ 흑백 (mono)]  [● 컬러 A3 (color-a3)]                 │
│              ─ 두 옵션을 horizontal radio chip 형태로                │
│                                                                      │
│   페이지 크기 [● A4]  [○ A3]                                         │
│              ─ 두 옵션을 horizontal radio chip 형태로                │
├──────────────────────────────────────────────────────────────────────┤
│ ─ Status zone (state-driven) ──────────────────────────────────────  │
│                                                                      │
│   [IDLE]      "PDF 생성을 누르면 변환을 시작합니다."                  │
│                                                                      │
│   [QUEUED]    ⌛ 대기 중…                                             │
│                                                                      │
│   [RUNNING]   ┌────────────────────────────────────┐                 │
│               │ [▓▓▓▓▓░░░░░] 47%                    │                │
│               └────────────────────────────────────┘                 │
│               변환 중 · 약 32초 남음                                  │
│                                                                      │
│   [SUCCEEDED] ✓ 변환 완료. PDF 미리보기 ▼                             │
│               ┌─ thumb 220×155 (앵커 클릭 시 새창) ──┐                │
│               │  [DocumentPreviewIframe or img]      │                │
│               └────────────────────────────────────┘                 │
│                                                                      │
│   [CACHED]    ✓ 이미 변환된 PDF가 있습니다 (3분 전).                  │
│               [같은 미리보기 영역]                                    │
│                                                                      │
│   [FAILED]    ✕ 변환 실패: <errorMessage>                             │
│               [다시 시도]                                             │
├──────────────────────────────────────────────────────────────────────┤
│ DialogFooter                                                         │
│   [닫기]  [PDF 생성 / 다운로드 / 브라우저 인쇄]  ← 상태별 라벨 변환   │
└──────────────────────────────────────────────────────────────────────┘
```

폭 결정 사유: 옵션 2조 + 진행률 + 미리보기를 안정적으로 담는 최소 폭. shadcn `<Dialog>`의 `DialogContent` 기본에 `className="max-w-md"` (= 28rem). Modal max-height: 자동 스크롤 (BE preview 썸네일이 클 수 있음).

### A.3 옵션 컨트롤 — Radio Chip 패턴

shadcn `<RadioGroup>`을 쓰지 않고 segmented chip으로 표현 (좌우 배치, 시각적 부담 적음).

```tsx
// 의사 코드 — 컴포넌트 트리만 명시. 실제 구현은 frontend 담당.
<fieldset className="space-y-1.5">
  <legend className="app-kicker">출력 방식</legend>
  <div role="radiogroup" aria-label="출력 방식" className="flex gap-1.5">
    <ChipRadio value="mono" checked={ctb === 'mono'} onSelect={...}>
      흑백
    </ChipRadio>
    <ChipRadio value="color-a3" checked={ctb === 'color-a3'} onSelect={...}>
      컬러 A3
    </ChipRadio>
  </div>
  <p className="text-[11px] text-fg-muted">
    {ctb === 'mono' ? '모든 선을 검정으로 변환합니다.' : '원본 ACI 색상을 유지합니다.'}
  </p>
</fieldset>
```

`ChipRadio` 시각:
- 선택됨: `bg-brand text-brand-foreground border-brand`
- 미선택: `bg-bg border-border text-fg hover:bg-bg-muted`
- 키보드: `←/→`로 라디오 그룹 내 이동 (shadcn `<RadioGroup>`을 chip 스타일로 쓰면 무료로 구현됨 — 권장).

PM-DECISION-2 (채택): default `ctb = 'mono'`, default `pageSize = 'A4'`. PRD §6.4 결정 없음 → 보수적 (잉크 절약 + 가장 흔한 용지).

### A.4 상태 머신 (FE 클라이언트 측)

```
┌──────┐  user clicks                    ┌────────┐  POST /print
│ IDLE │ ─────────────────────────────▶ │QUEUEING│ ─ 200, status='CACHED' ──┐
└──────┘   "PDF 생성"                    └────────┘                          ▼
                                            │  200, status='QUEUED'      ┌─────────┐
                                            │                            │ CACHED  │
                                            ▼                            └─────────┘
                                       ┌─────────┐  poll/status
                                       │ QUEUED  │ ─────────▶ ┌─────────┐
                                       └─────────┘             │ RUNNING │
                                                               └─────────┘
                                                                  │
                                                       ┌──────────┴──────────┐
                                                       ▼                     ▼
                                                 ┌───────────┐         ┌────────┐
                                                 │ SUCCEEDED │         │ FAILED │
                                                 └───────────┘         └────────┘
                                                                          │
                                                          user clicks "다시 시도"
                                                                          ▼
                                                                       (back to IDLE)
```

각 상태별 footer 버튼:

| 상태 | Primary 버튼 라벨 | Disabled 조건 | Secondary |
|---|---|---|---|
| IDLE | `PDF 생성` | 옵션 미선택 (default 채워짐) | `닫기` |
| QUEUEING | `요청 중…` | 항상 disabled | `닫기` (요청은 무시 안 됨) |
| QUEUED | `대기 중… (취소)` | enabled | (없음) |
| RUNNING | `변환 중… (취소)` | enabled | (없음) |
| CACHED | `다운로드` | — | `닫기` + dropdown `브라우저 인쇄` |
| SUCCEEDED | `다운로드` | — | `닫기` + dropdown `브라우저 인쇄` |
| FAILED | `다시 시도` | — | `닫기` |

`다운로드` 동작: `<a href={pdfUrl} download={...} target="_blank">`로 직접 트리거 (XHR 거치지 않음). 다이얼로그는 닫지 않음 — 사용자가 다운로드 + 브라우저 인쇄를 둘 다 하고 싶을 수 있음.

`브라우저 인쇄` 동작: 새 탭에서 `pdfUrl`을 열고 `window.print()`를 onload에 연결. 보안 정책상 cross-origin printRequest가 막히면 단순히 새 탭만 띄움.

`취소` (QUEUED/RUNNING 중 닫기 클릭 시):
- BE에 별도 cancel 엔드포인트 없음 (PM이 contract에 안 만듦). FE는 단순히 폴링을 중단하고 다이얼로그 닫음.
- 다음 진입 시 같은 jobId가 여전히 살아있으면 polling 재개 (`['print','status', jobId]` 캐시 lookup) — Phase 2.
- 이번 라운드는 단순히 "다이얼로그 닫기 = 폴링 중단" 로 충분. 백엔드 큐는 계속 작업 → 다음 진입 시 CACHED로 보임.

### A.5 폴링 (TanStack Query)

```ts
const { data: jobStatus } = useQuery({
  queryKey: ['print', 'status', jobId],
  queryFn: () => api.get<{ status: PrintJobStatus; pdfUrl?: string; errorMessage?: string }>(
    `/api/v1/print-jobs/${jobId}/status`
  ),
  enabled: jobId != null && (status === 'QUEUED' || status === 'RUNNING'),
  refetchInterval: (q) => {
    const s = q.state.data?.status;
    if (s === 'SUCCEEDED' || s === 'FAILED') return false;
    return 250; // PM-DECISION-3 채택
  },
});
```

PM-DECISION-3 (채택): polling 간격 **250ms**. 이유: PDF 변환은 대부분 5~30초 — 250ms면 progress가 부드럽게 갱신되면서 BE 부하도 1~2 req/s 수준. 사용자 1~2명이 동시에 인쇄해도 체감 OK.

진행률(%) 계산: BE가 `data.progress: number` (0~100)을 반환하면 그 값을 그대로 사용. 안 주면 `RUNNING` 상태에서 indeterminate progress(`<ChunkProgressBar indeterminate />`).
- contract §3.3 응답 schema에 `progress` 필드가 없으므로, **BE에 추가 요청 — TBD**. 없으면 indeterminate. (frontend 작업 시 옵셔널로 처리.)

### A.6 키보드 / 접근성

- `Esc`: 다이얼로그 닫기 (변환 중이면 confirm 없이 즉시 닫음 — 위 §A.4 취소 정책).
- `Tab` 순서: ctb radio → pageSize radio → primary button → secondary button.
- 옵션 변경 시 footer primary 버튼은 `IDLE`에서 다시 enabled가 되어야 함 (사용자가 옵션 바꾸고 다시 누를 수 있도록). `RUNNING/SUCCEEDED` 중에는 옵션 라디오가 `disabled` (재변환은 새로 시작해야 — `다시 시도`로).
- aria:
  - `<Dialog aria-labelledby="print-title">`
  - 진행률: `<div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>` + 텍스트로 `aria-live="polite"`로 "47% — 32초 남음" 갱신.
  - 라디오: `<RadioGroup aria-label="출력 방식">` (shadcn 기본 처리).
- `⌘P` 가로채기: `apps/web/app/(main)/objects/[id]/page.tsx` mount 시 `useEffect`로 `keydown` 등록, modifier+P일 때 `e.preventDefault()` + `setPrintOpen(true)`. unmount 시 cleanup.

### A.7 컴포넌트 prop signature

```ts
// apps/web/components/print/PrintDialog.tsx
export interface PrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  /** 인쇄 대상. attachmentId가 1순위. */
  attachmentId: string;

  /** 헤더 표기용 메타. attachment fetch를 절약. */
  filename: string;
  fileSize?: number; // bytes — info row에 표기. 0/undefined면 생략.
  fileMime?: string;
  contextLabel?: string; // "R3 v0.2" 같은 짧은 메타. 한 줄 표기.
}

// internal state (useReducer 또는 simple useState 군집)
type PrintState =
  | { kind: 'idle' }
  | { kind: 'queueing' }
  | { kind: 'queued' | 'running'; jobId: string; progress?: number }
  | { kind: 'cached' | 'succeeded'; pdfUrl: string; cachedAt?: string }
  | { kind: 'failed'; errorMessage: string };

interface PrintFormValues {
  ctb: 'mono' | 'color-a3';
  pageSize: 'A4' | 'A3';
}
```

호출 예 (자료 상세):
```tsx
<PrintDialog
  open={printOpen}
  onOpenChange={setPrintOpen}
  attachmentId={obj.masterAttachmentId!}
  filename={obj.masterFile}
  fileSize={Number(obj.masterAttachment?.size ?? 0)}
  fileMime={obj.masterAttachment?.mimeType}
  contextLabel={`R${obj.revision} v${obj.version}`}
/>
```

### A.8 Empty/에러/edge

| 상황 | UX |
|---|---|
| 마스터 파일 없음 | 다이얼로그는 안 열림 (`Printer` 버튼 disabled + tooltip). |
| 권한 없음 (BE 401/403) | toast `error('인쇄 권한이 없습니다.')` + 다이얼로그 닫음. |
| 변환 실패 (BE 500 또는 `status:FAILED`) | inline `errorMessage` 표시 + `다시 시도` 활성. |
| 폴링 timeout (5분) | "변환이 오래 걸립니다. 잠시 후 다시 시도해주세요." 메시지 + `닫기`. 5분 = 폴링 중단 임계점. |
| 동일 jobId 동시 다이얼로그 | TanStack Query 캐시 단일 — 두 다이얼로그가 같은 status 공유. 자연스럽게 OK. |
| 다이얼로그 닫고 다시 열기 | jobId 잃음 → IDLE 상태로 시작. 재요청 시 BE는 CACHED로 응답 (이미 만든 PDF 재사용). |

---

## B. 청크 업로드 다이얼로그 (V-INF-2)

### B.1 확장 대상 — 기존 `<AttachmentUploadDialog>`

`apps/web/components/object-list/AttachmentUploadDialog.tsx`를 in-place 확장. **새 컴포넌트로 분리하지 않음** — 사용자가 보는 다이얼로그는 동일하고 transport만 분기.

분기 규칙:
```
file.size < 5_000_000  →  기존 multipart POST /objects/{id}/attachments  (변경 없음)
file.size ≥ 5_000_000  →  청크 업로드 flow:
                          1. POST /uploads { filename, mimeType, totalBytes, folderId, classId? } → uploadId, chunkSize=5MB
                          2. PATCH /uploads/{uploadId} 반복 (X-Chunk-Offset 헤더, body=chunk)
                          3. POST /uploads/{uploadId}/finalize { objectId, asAttachment.isMaster } → attachmentId
```

PM-DECISION-4 (채택): 임계값 **5 MB (5_000_000 bytes)**. 5MB 이하는 한 번의 multipart로 빠르게 끝나는 게 더 좋고, 그 이상은 청크의 진행률 표시 가치가 명확.

### B.2 다이얼로그 레이아웃 변경분 (확장만 표시)

기존 다이얼로그(파일 픽커 + 마스터 체크박스)는 그대로. **파일 선택 후**에 size에 따라 추가 안내 영역이 conditional 노출:

```
┌─ Dialog (max-w-md, 기존) ─────────────────────────────────────────┐
│ DialogHeader: "첨부 추가"                                           │
├──────────────────────────────────────────────────────────────────┤
│ [파일 드롭존]                                                       │
│   ◯ 파일 미선택 → "여기에 끌어다 놓거나 클릭…"                      │
│   ● 파일 선택  → drawing-205.dwg (152.4 MB)  [✕]                    │
├──────────────────────────────────────────────────────────────────┤
│ [☑] 마스터로 지정                                                   │
├──────────────────────────────────────────────────────────────────┤
│ ── 추가 영역 (size ≥ 5MB일 때만) ────────────────────────────────  │
│ ⓘ 5MB 청크로 31분할 업로드. 중간 실패 시 자동 재개됩니다.           │
│                                                                    │
│ ── 진행 영역 (업로드 시작 후) ──────────────────────────────────  │
│ ┌─────────────────────────────────────────────────────────┐       │
│ │ [▓▓▓▓▓▓▓░░░░░░░] 47%                                    │       │
│ │ 71.2 / 152.4 MB · 1.8 MB/s · 약 45초 남음                │       │
│ │ 청크 14 / 31 전송 중                                     │       │
│ └─────────────────────────────────────────────────────────┘       │
├──────────────────────────────────────────────────────────────────┤
│ DialogFooter                                                      │
│   [취소]                       [업로드 / 일시정지 / 재시도]        │
└──────────────────────────────────────────────────────────────────┘
```

영역 4개:
1. **드롭존(기존):** file picker.
2. **isMaster 체크박스(기존):** 변경 없음.
3. **청크 안내 (신규):** size ≥ 5MB일 때만, idle 상태에서 노출. 청크 수 미리보기. `bg-brand/5 border border-brand/30 rounded-md p-2 text-xs text-fg-muted`. `Info` 아이콘.
4. **진행 영역 (신규):** 업로드 시작 후 노출. progress bar + 메타(MB/MB, MB/s, ETA, 청크 X/Y).

진행 메타 텍스트 포맷:
- 첫 줄: `<uploaded> / <total>` (`formatBytes`로 MB/GB 자동) `·` `<speed>` (`formatBytes(speed)/s`) `·` `약 <eta>` (`< 1초` / `<n>초 남음` / `<m>분 <s>초 남음`).
- 둘째 줄(작게): `청크 <n> / <total> 전송 중` 또는 상태 메시지(아래 §B.4).

### B.3 컴포넌트 prop signature

`<AttachmentUploadDialog>` props는 **변경 없음** (외부 인터페이스 안정성). 내부 동작만 분기.

```ts
// 기존 그대로
export interface AttachmentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  objectId: string;
  isFirstAttachment?: boolean;
}
```

내부 신규 클라이언트 helper:

```ts
// apps/web/lib/chunk-upload.ts
export interface ChunkUploadOptions {
  uploadId: string;
  file: File;
  chunkSize: number;        // BE가 응답으로 알려준 권장 크기, default 5_000_000
  onProgress: (uploadedBytes: number, totalBytes: number) => void;
  onSpeedSample: (bytesInWindow: number, windowMs: number) => void;
  signal?: AbortSignal;     // 사용자 취소
  retries?: number;         // default 3
}

export async function uploadInChunks(opts: ChunkUploadOptions): Promise<void> {
  // 1. file을 chunkSize로 슬라이스
  // 2. PATCH /api/v1/uploads/{uploadId} (offset, blob) 순차 호출
  // 3. 실패 시 expoential backoff (200ms, 800ms, 3.2s) 최대 retries회
  // 4. abort signal trip 시 즉시 throw AbortError
}
```

내부 state:

```ts
type UploadState =
  | { kind: 'idle' }
  | { kind: 'creating' }   // POST /uploads
  | { kind: 'uploading'; uploadId: string; uploadedBytes: number; totalBytes: number; speedBps: number; etaSec: number; chunkIdx: number; chunkTotal: number }
  | { kind: 'finalizing'; uploadId: string }
  | { kind: 'error'; uploadId?: string; message: string; retriable: boolean }
  | { kind: 'done' };
```

### B.4 footer 버튼 상태표

| state | secondary | primary 라벨 | disabled? |
|---|---|---|---|
| idle (file 없음) | 닫기 | 업로드 | yes |
| idle (file 있음, <5MB) | 닫기 | 업로드 | no |
| idle (file 있음, ≥5MB) | 닫기 | 청크 업로드 시작 | no |
| creating | (없음) | 준비 중… | yes |
| uploading | 취소 | 일시정지 (Phase 2: 미구현) | — |
| finalizing | (없음) | 마무리 중… | yes |
| error (retriable) | 취소 | 재시도 | no |
| error (non-retriable) | 닫기 | (없음) | — |
| done | (자동 닫힘 — toast로 성공 알림) | — | — |

PM-DECISION-5 (채택): 일시정지 기능은 **Phase 2**. 이번 라운드는 `취소`만. (구현 단순성 + PRD §6.4에 일시정지 요구 없음.)

### B.5 취소 동작

`취소` 버튼 또는 `Esc`/dialog overlay 클릭 시:

1. uploading 상태이고 진행률 ≥ 5%이면 ConfirmDialog: `"전송을 취소하면 지금까지 업로드한 부분이 삭제됩니다. 계속할까요?"` (5% 미만이면 즉시 취소 — 너무 적게 진행됐을 때 confirm은 귀찮음).
2. 확인 시:
   - `AbortController.abort()` → 진행 중 PATCH 중단.
   - `DELETE /api/v1/uploads/{uploadId}` 호출 (best-effort, 실패해도 무시 — BE가 expiresAt로 청소).
   - 다이얼로그 닫음.
3. 취소 시점 toast: `"업로드 취소됨"` (info, 4초).

진행률 = 0%인 상태(아직 PATCH 시작 안 함)에서 취소: `DELETE` 만 호출. 다이얼로그 즉시 닫음.

### B.6 재시도 / 자동 재개

PATCH 청크 실패 패턴:
- HTTP 5xx, network error, timeout(15s) → **자동 재시도 (200ms / 800ms / 3.2s, 최대 3회)**. 사용자 UI는 "재시도 (1/3)…" 메시지. progress bar는 그대로 유지.
- HTTP 4xx 중 `E_VALIDATION` `details.expected: <bytes>` (offset 불일치) → BE가 알려준 expected offset부터 재개. 자동.
- HTTP 4xx 중 그 외 (401/403/413) → state=`error.retriable=false`. 사용자에게 메시지 + `취소`만.
- 전체 청크 retry 모두 실패 → state=`error.retriable=true` + footer `재시도` 버튼 노출. 사용자 클릭 시 마지막 성공 offset부터 재개.

**핵심:** 재개 가능 조건은 BE가 `Upload.uploadedBytes`를 권위 있게 알고 있다는 점. FE는 매 PATCH 응답의 `data.uploadedBytes`를 신뢰값으로 사용 (자체 카운터는 보조).

### B.7 속도/ETA 계산

EMA(지수가중이동평균) — 5초 윈도우.
```ts
// 250ms 마다 sample (uploaded delta in last 250ms)
const alpha = 0.2; // 5초 평형(τ = 250ms / 0.2 = 1.25s, 5초 후 ~99% 새 값)
speedEma = alpha * (deltaBytes / deltaSec) + (1 - alpha) * speedEma;
etaSec = (totalBytes - uploadedBytes) / speedEma;
```

표시: speed가 NaN/0이면 `--`. ETA가 ∞이면 `계산 중…`. 매우 큰 ETA(>1시간)는 `1시간 이상 남음`.

### B.8 동시 업로드

PM-DECISION-6 (채택): **동시 1개**. 다이얼로그가 1개의 file만 받음 → 자연스러움.
- 다중 파일 큐 + 백그라운드 업로드는 **Phase 2** (전혀 다른 UX, NotificationBell 같은 글로벌 패널 필요).

### B.9 접근성

- progressbar에 `role="progressbar" aria-valuenow={...} aria-valuemin={0} aria-valuemax={100}`. `aria-valuetext={'71.2/152.4 MB, 약 45초 남음'}`.
- `aria-live="polite"`로 메타 텍스트 갱신 (250ms마다 — 너무 자주 읽으면 스크린리더 부담 → throttle 1초).
- `Esc`: 취소 confirm.
- focus: 다이얼로그 열림 시 first focusable(드롭존 label). 업로드 시작 후 primary 버튼(취소)으로 이동.

### B.10 Empty/에러/edge

| 상황 | UX |
|---|---|
| 파일 0 bytes | toast error `"빈 파일은 업로드할 수 없습니다."`, 업로드 버튼 disabled. |
| 파일 > 2 GB | toast error `"파일은 2GB 이하만 가능합니다."` (BE가 거부할 것 — FE도 사전 가드). |
| `POST /uploads` 실패 (folder 권한 없음) | state=error, message=`"이 폴더에 업로드 권한이 없습니다."`. retriable=false. |
| 디스크 full (BE 507) | state=error, `"서버 저장 공간이 부족합니다. 관리자에게 문의하세요."`. retriable=false. |
| `finalize` 실패 (sha mismatch 등) | state=error, retriable=true. `재시도` 클릭 시 finalize만 재시도 (PATCH 다시 안 함). |
| 다이얼로그 강제 닫힘(라우트 이동 등) | mount된 useEffect cleanup에서 `AbortController.abort()` 호출 + `DELETE` fire-and-forget. PROPER. |
| 동일 폴더에 같은 이름 파일 존재 | BE가 finalize에서 결정 (R21 패턴). FE는 BE 응답 그대로. |

---

## C. 컴포넌트 트리 + 상호작용 시퀀스

### C.1 PrintDialog 트리

```
<PrintDialog>
  <Dialog>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>인쇄 옵션</DialogTitle>
        <DialogDescription>…</DialogDescription>
      </DialogHeader>

      <FileTargetRow icon mime filename meta />

      <Form>
        <ChipRadioGroup name="ctb" options={[mono, color-a3]} value disabled={isProcessing} />
        <ChipRadioGroup name="pageSize" options={[A4, A3]} value disabled={isProcessing} />
      </Form>

      <PrintStatusZone state={state}>
        {state.kind === 'idle' && <p className="text-fg-muted text-xs">…</p>}
        {state.kind === 'queued' && <Spinner /> + <span>대기 중…</span>}
        {state.kind === 'running' && <ChunkProgressBar progress={state.progress} />}
        {(state.kind === 'cached' || 'succeeded') && <PdfPreview url={state.pdfUrl} />}
        {state.kind === 'failed' && <InlineError msg={state.errorMessage} />}
      </PrintStatusZone>

      <DialogFooter>
        <button>닫기</button>
        <button primary>{footerLabel(state)}</button>
        {/* SUCCEEDED/CACHED 시 dropdown으로 "브라우저 인쇄" 추가 */}
      </DialogFooter>
    </DialogContent>
  </Dialog>
</PrintDialog>
```

`<ChunkProgressBar>` (재사용 utility):

```tsx
// apps/web/components/ui/chunk-progress-bar.tsx (신규)
interface ChunkProgressBarProps {
  progress?: number; // 0~100. undefined = indeterminate.
  className?: string;
}
// 시각: 외곽 8px height, rounded-full, bg-bg-muted; 내부 bg-brand. indeterminate 시 stripe animation.
```

PrintDialog와 AttachmentUploadDialog 양쪽이 이걸 공유 (R31 통일성).

### C.2 PrintDialog 시퀀스 다이어그램 (success path)

```
User              FE (PrintDialog)        BE (Next.js)         Worker (BullMQ)
 │                      │                      │                      │
 │ click "인쇄"         │                      │                      │
 ├─────────────────────▶│                      │                      │
 │                      │ render IDLE          │                      │
 │                      │                      │                      │
 │ select ctb=mono A4   │                      │                      │
 │ click "PDF 생성"     │                      │                      │
 ├─────────────────────▶│ POST /attachments/   │                      │
 │                      │   {id}/print         │                      │
 │                      ├─────────────────────▶│                      │
 │                      │                      │ enqueue PDF job      │
 │                      │                      ├─────────────────────▶│
 │                      │                      │ ◀────────────────────┤ jobId
 │                      │ ◀────────────────────┤ {jobId, status:'QUEUED'}
 │                      │ state=QUEUED         │                      │
 │                      │ start polling 250ms  │                      │
 │                      │                      │                      │
 │                      │ GET /print-jobs/{id}/status                 │
 │                      ├─────────────────────▶│ ◀────────────────────┤ progress 47%
 │                      │ ◀────────────────────┤ {status:'RUNNING', progress:47}
 │                      │ state=RUNNING(47)    │                      │
 │                      │                      │                      │
 │                      │  …repeat…            │                      │
 │                      │                      │                      │ done, write pdf
 │                      ├─────────────────────▶│ ◀────────────────────┤
 │                      │ ◀────────────────────┤ {status:'SUCCEEDED', pdfUrl}
 │                      │ state=SUCCEEDED      │                      │
 │                      │ stop polling, render preview                 │
 │ click "다운로드"     │                      │                      │
 ├─────────────────────▶│ <a href={pdfUrl} download> trigger          │
 │                      │ GET pdfUrl ─────────▶│ stream pdf           │
 │                      │ ◀────────────────────┤                      │
 │ Save to disk         │                      │                      │
```

### C.3 AttachmentUploadDialog (chunked) 시퀀스

```
User              FE                  BE                       Worker
 │                  │                    │                        │
 │ select 152MB.dwg │                    │                        │
 ├─────────────────▶│ render with chunk hint                       │
 │ click "업로드"   │                    │                        │
 ├─────────────────▶│ POST /uploads {filename, totalBytes:152e6,…}│
 │                  ├───────────────────▶│ create Upload row     │
 │                  │ ◀──────────────────┤ {uploadId, chunkSize:5e6}
 │                  │ state=uploading    │                        │
 │                  │                    │                        │
 │                  │ slice file [0..5MB]│                        │
 │                  │ PATCH /uploads/{id}│                        │
 │                  │   X-Chunk-Offset:0 │                        │
 │                  │   body=chunk       │                        │
 │                  ├───────────────────▶│ append, store         │
 │                  │ ◀──────────────────┤ {uploadedBytes:5e6, totalBytes:152e6}
 │                  │ progress=3.3%      │                        │
 │                  │                    │                        │
 │                  │ slice [5..10MB]    │                        │
 │                  │ PATCH offset=5e6   │                        │
 │                  │ ◀──────────────────┤ {uploadedBytes:10e6}  │
 │                  │  …repeat 31 times… │                        │
 │                  │                    │                        │
 │                  │ all chunks done    │                        │
 │                  │ state=finalizing   │                        │
 │                  │ POST /uploads/{id}/finalize                 │
 │                  │   {objectId, asAttachment:{isMaster:true}}  │
 │                  ├───────────────────▶│ verify + create        │
 │                  │                    │ Attachment row         │
 │                  │                    │ enqueue conversion ───▶│
 │                  │ ◀──────────────────┤ {attachmentId,         │
 │                  │                    │  conversionJobId}      │
 │                  │ state=done         │                        │
 │                  │ toast success +    │                        │
 │                  │ invalidate object  │                        │
 │                  │ detail query       │                        │
 │                  │ close dialog       │                        │
```

---

## D. PM Decision Items (보수적 default 적용)

| # | 항목 | 채택 default | 이유 |
|---|---|---|---|
| 1 | 인쇄 권한 | `download` 비트 = 인쇄 가능. 별도 PRINT 비트 없음. | PRD §3.1에 별도 권한 명시 없음. 별 비트 추가는 마이그레이션 + 매트릭스 변경 필요. |
| 2 | 인쇄 default ctb | `mono` | 지시문 명시 "인쇄 ctb default `mono`". 잉크 절약. |
| 2.5 | 인쇄 default pageSize | `A4` | 사무실 기본 용지. PRD §6.4에 결정 없음. |
| 3 | 폴링 간격 | 250ms | 지시문 명시. 짧은 변환에서 진행률 부드러움. |
| 4 | 청크 임계값 | 5 MB | 지시문 명시. <5MB는 단일 multipart로 빠르게 끝나는 게 UX 우월. |
| 5 | 일시정지 기능 | Phase 2 (이번 라운드 미구현) | 단순성. PRD에 요구 없음. |
| 6 | 동시 업로드 | 1개 (다이얼로그 1개 파일) | 지시문 "동시 업로드: 1개씩 (Phase 2)". |
| 7 | 일괄 인쇄 (multi-select zip) | Phase 2 | 지시문 "일괄 인쇄: zip — Phase 2". |
| 8 | 인쇄 진입점 #3 (첨부 row 인쇄) | Phase 2 | 라운드 범위 컴팩트화. |
| 9 | 청크 업로드 진행 캡션 1줄 | "청크 N / Total 전송 중" | 디버깅 친화. 일반 사용자에게 무해. |

추가 PM 결정 필요 항목 (BE/FE 협의):

| # | TBD | 권장 사항 |
|---|---|---|
| T1 | `GET /print-jobs/{jobId}/status` 응답에 `progress: number (0~100)` 추가 여부 | **추가 권장**. 없으면 indeterminate progress(워닝 줄임표 spinner 수준)로 fallback. |
| T2 | `POST /attachments/{id}/print` 권한 체크에서 download/print 분리 여부 | 단일 `download` 비트로 통합. |
| T3 | `DELETE /uploads/{id}` 호출이 다이얼로그 닫힘 후에도 fire-and-forget인지 | best-effort. 응답 무시. expiresAt cleanup 워커에 의존. |
| T4 | 청크 업로드 max file size | 2 GB hard cap. 더 큰 파일은 사전에 알림. |
| T5 | `POST /uploads` body에 `folderId`가 필수인가, 아니면 finalize에서 결정인가 | **finalize에서 결정** (현 contract §5.3 그대로). FE는 `<AttachmentUploadDialog>`에서 objectId만 알면 됨. POST /uploads body에는 folderId/classId 안 보내도 됨 — contract §5.1 부분이 그대로 OK. |

---

## E. 디자인 토큰 / 유틸리티 — 변경 없음

현재 작업 범위에 새 토큰은 필요 없음. 활용:
- `bg-brand`, `bg-brand/5`, `border-brand/30`: 청크 안내 hint 영역.
- `app-action-button`, `app-action-button-primary`: footer.
- `app-kicker`: fieldset legend.
- `text-fg-subtle/muted/fg`: 메타 텍스트 계층.

신규 utility 1개 권장 (frontend agent가 globals.css에 추가):

```css
/* progress bar 공통. PrintDialog + AttachmentUploadDialog 공용. */
.app-progress {
  @apply h-2 w-full overflow-hidden rounded-full bg-bg-muted;
}
.app-progress > .app-progress-fill {
  @apply h-full bg-brand transition-[width] duration-150 ease-out;
}
```

또는 shadcn-style `<Progress />` 컴포넌트(Radix UI 기반)를 `apps/web/components/ui/progress.tsx`에 신규 추가. 후자가 더 정통. **frontend가 선택** — 이 결정은 코드 차원이라 디자인 spec에 못박지 않음.

---

## F. 작업 영역 분리 (frontend 작업 차원)

| 파일 | 변경 종류 | 사유 |
|---|---|---|
| `apps/web/components/print/PrintDialog.tsx` | 신규 | 본 라운드 핵심 신규 컴포넌트 |
| `apps/web/components/object-list/AttachmentUploadDialog.tsx` | 수정 (확장) | 5MB 임계값 분기 + 청크 진행 영역 |
| `apps/web/lib/chunk-upload.ts` | 신규 | 클라이언트 청크 업로드 helper |
| `apps/web/components/ui/progress.tsx` 또는 `app-progress` 유틸 | 신규(택1) | 공통 progress bar |
| `apps/web/app/(main)/objects/[id]/page.tsx` | 수정 | `인쇄` ActionButton + dropdown 항목 + ⌘P 핸들러 + `<PrintDialog>` 마운트 |
| `apps/web/components/object-list/ObjectTable.tsx` 또는 row dropdown | 수정 | 검색 결과 row `⋯` 메뉴에 `인쇄` 항목 추가 |
| `apps/web/components/ShortcutsDialog.tsx` | 수정 | `⌘P — 인쇄` 한 줄 |
| `apps/web/lib/queries.ts` | 수정 | `queryKeys.print.status(jobId)` 신규 |

---

## G. 검증 체크리스트 (PM Phase 4용)

- [ ] `<PrintDialog>` 신규 마운트, 모든 상태(IDLE/QUEUED/RUNNING/SUCCEEDED/CACHED/FAILED)에서 typecheck 통과.
- [ ] 자료 상세 페이지에서 `인쇄` 버튼이 `vis.download === true`이고 `masterAttachmentId != null`일 때만 enabled.
- [ ] `⌘P`/`Ctrl+P`가 자료 상세에서 가로채져 다이얼로그 오픈 (브라우저 기본 인쇄 차단).
- [ ] 검색 결과 row dropdown에 `인쇄` 항목 등장. 마스터 없는 자료에서는 disabled.
- [ ] `<AttachmentUploadDialog>` 외부 props 시그니처 변경 없음 (호출처 무수정).
- [ ] 5MB 이하 파일: 기존 단일 multipart flow (변경 없음).
- [ ] 5MB 초과 파일: POST /uploads → PATCH 반복 → finalize. 진행률/속도/ETA 표시.
- [ ] 청크 PATCH 실패 시 자동 3회 재시도 (200/800/3200ms backoff). 모두 실패 시 사용자 `재시도` 버튼.
- [ ] 사용자 취소 시 `DELETE /uploads/{id}` 호출 (fire-and-forget OK).
- [ ] 라우트 이동 등으로 다이얼로그 unmount되어도 AbortController로 PATCH 중단 + DELETE 호출.
- [ ] 진행률 progressbar에 `role/aria-valuenow/aria-valuemax`. `aria-live` 메타 갱신 throttle 1초.
- [ ] toast 메시지 한국어. error message 사용자 친화 (technical detail은 BE의 `errorMessage`만 노출).
- [ ] 새 디자인 토큰 0개. 신규 CSS 유틸 1개 이내 (`app-progress` 또는 `<Progress />` 컴포넌트).

---

## H. Out-of-scope (이번 라운드 명시 제외)

- 일괄 인쇄 (multi-select → zip): **Phase 2**.
- 첨부 row 단위 인쇄: **Phase 2**.
- 업로드 일시정지 / 재개: **Phase 2** (취소만 지원).
- 다중 파일 동시 업로드 + 백그라운드 업로드 패널: **Phase 2**.
- 풀 CTB(plot styles) 파싱: BE worker 차원 — 본 라운드는 mono / color-a3 두 가지 단순 매핑만.
- 인쇄 미리보기에서 페이지 회전 / 여백 조정: **Phase 2** 또는 무기한 보류 (PDF 자체로 충분).

---

## I. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-04-27 | 초기 작성 (R31). PM 결정 9건 + TBD 5건 명시. |
