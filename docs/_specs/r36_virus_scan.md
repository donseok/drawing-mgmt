# R36 Design Spec — V-INF-3 Virus Scan UX + /admin/scans

| 항목 | 내용 |
|---|---|
| 작성자 | drawing-mgmt designer agent (R36) |
| 작성일 | 2026-04-27 |
| 기준 main HEAD | `57287b2` |
| 대상 라운드 | R36 (V-INF-3 ClamAV + T-2) |
| 대상 PRD/DESIGN | `docs/PRD.md`, `docs/DESIGN.md` (§4 글로벌 레이아웃, §10.1 Empty/Loading 패턴, §10.3 상태색 시스템) |
| API 계약 | `_workspace/api_contract.md` §3 (ClamAV) + §5 (FE 작업) |
| 신규 라우트 | `/admin/scans` (page) |
| 신규 컴포넌트 | `<AttachmentScanBadge>`, `<ScanSignatureCell>`, `<ScansTable>` (in-page), `<RescanConfirmDialog>` (in-page) |
| 확장 컴포넌트 | `apps/web/app/(main)/objects/[id]/page.tsx` InfoTab 첨부 list (badge wire), `apps/web/components/object-list/ObjectPreviewPanel.tsx` (badge wire — master만), `ADMIN_GROUPS` (스캔 메뉴 추가) |
| 의존 (BE) | `Attachment.virusScanStatus/Sig/At` 필드, `GET /api/v1/admin/scans`, `POST /api/v1/admin/scans/jobs/:attachmentId/rescan` (PM-DECISION §D.5) |
| 디바이스 | Desktop only (≥1280) |
| 디자인 토큰 변경 | **0건**. R28 ConversionStatusBadge 팔레트(slate/sky/emerald/rose) + amber(R32 시각 보유) 재사용. 새 CSS 변수·Tailwind 토큰 없음 |
| 새 단축키 | 없음 |
| PRD 페르소나 영향 | 슈퍼관리자/관리자: `/admin/scans` 사용. 설계자/열람자/협력업체: 첨부 list에서 SCANNING/INFECTED를 만나는 정도 (감염 차단은 BE가 가드, FE는 disabled tooltip 노출) |

---

## 0. 라운드 개요와 사용자 시나리오

### 0.1 카드 묶기 근거 — designer 관점에서

V-INF-3은 BE/worker가 "첨부에 ClamAV scan 결과를 새 컬럼으로 붙인다"는 **데이터 모델 변경**이고, FE는 그 컬럼을 두 군데에 노출한다:
1. **첨부 row(자료 상세 + 검색 결과 마스터 슬롯)** — "이 파일을 다운로드해도 안전한가"가 사용자 의식의 1차 질문.
2. **/admin/scans (운영 surface)** — "지금 큐 상태와 감염 첨부가 무엇인가"가 관리자 의식의 1차 질문.

두 surface는 **공유 컴포넌트 1개 (`<AttachmentScanBadge>`)** 와 **운영 페이지 1개 (`/admin/scans`)** 로 정확히 분리된다. R28 conversion (PROCESSING/PENDING/DONE/FAILED), R33 backup (RUNNING/DONE/FAILED), R34 storage (LOCAL/S3 + 연결 상태)와 같은 "BullMQ-backed 운영 surface" 가족의 4번째 항목으로, **시각/구조/메뉴 위치를 그 가족과 정확히 정렬**한다 — 사용자가 한 번 학습한 mental model을 그대로 재사용하게 한다.

### 0.2 페르소나별 시나리오

| 페르소나 | 시나리오 |
|---|---|
| 슈퍼관리자 | (주간) `/admin/scans` 진입 → INFECTED 1건 발견 → 행 expand로 시그니처 확인 → 업로더에게 통보 (SECURITY_INFECTED_FILE 알림은 BE가 자동 발송, 관리자는 follow-up만) → 필요시 admin 강제 우회 (후속 라운드, 본 스펙은 hook만 둠). FAILED 발견 → "재스캔" 클릭 → BullMQ 재투입 → 5초 폴링으로 CLEAN/INFECTED 갱신. |
| 관리자 (1~2명) | 동일 (역할 ADMIN+ — PM-DECISION §D.1). |
| 설계자 | 첨부 업로드 직후 자료 상세에서 자기 첨부가 "SCANNING(파란 점멸) → CLEAN(초록)"으로 바뀌는 것을 본다. CLEAN은 다운로드 활성. INFECTED면 빨간 뱃지 + 다운로드 버튼 disabled + "보안팀에 문의" 안내 tooltip. SKIPPED는 dim slate (운영자가 ClamAV를 끈 상태이며 사용자 액션 변화 없음 — 다운로드 가능). |
| 열람자 | 동일 (mutate 권한이 없으므로 "재시도" 같은 메뉴는 노출 자체가 안 된다 — 단순 정보 표시). |
| 협력업체 | 동일. 단 INFECTED 첨부는 transmittal 생성 시 BE가 자동 제외(api_contract §3.4)이므로 협력업체 화면에 노출되지 않는다. |

### 0.3 핵심 시나리오 5개 (frontend 구현 우선 순서)

1. **신규 첨부 업로드 직후 (설계자):** 자료 상세 InfoTab의 첨부 list 행에 새 첨부가 추가되면서 동시에 PENDING(slate) 뱃지로 등장 → 5초 폴링으로 SCANNING(sky pulse) → CLEAN(emerald) 으로 전환. 다운로드 버튼은 PENDING/SCANNING 동안 enabled (BE가 가드 — FE는 차단하지 않는다, 단 "스캔 진행 중" tooltip만 표시).
2. **감염 첨부 (열람자):** InfoTab 첨부 list 행이 INFECTED(rose+icon) 뱃지 + 행 자체에 좌측 4px rose border 강조 + 다운로드 버튼/메뉴 비활성. 호버 tooltip "바이러스 감염: {signature}". 미리보기/뷰어 링크도 클릭해도 바로 disabled (라우트 자체는 BE가 403을 돌려주지만 FE 사전 차단으로 사용자 혼란 방지).
3. **/admin/scans 진입 (슈퍼관리자):** 4 + 2 stats card 행 → 9컬럼 테이블 → INFECTED 행 강조 + 시그니처 expand 가능 → 5초 자동 폴링 (PENDING+SCANNING > 0일 때만, R28 패턴 동일).
4. **재스캔 (관리자):** FAILED 또는 INFECTED 행의 "재스캔" 버튼 → ConfirmDialog ("이 첨부를 다시 스캔하시겠습니까? 결과가 갱신됩니다.") → POST → 토스트 "재스캔 큐에 추가되었습니다." → 행 상태가 PENDING 으로 돌아가고 폴링 재개.
5. **빈 상태 (시스템 첫 가동):** 첨부 자체가 0건이면 EmptyState ("아직 스캔 이력이 없습니다. 첨부가 업로드되면 여기에 기록됩니다."). 첨부는 있으나 status filter로 0건이면 "조건에 맞는 작업이 없습니다" + "필터 초기화" 버튼.

---

## A. `<AttachmentScanBadge>` (공유 컴포넌트)

### A.1 위치, 시그니처

**파일:** `apps/web/components/AttachmentScanBadge.tsx` (신설). client component.

**Props:**
```ts
export type VirusScanStatus =
  | 'PENDING'
  | 'SCANNING'
  | 'CLEAN'
  | 'INFECTED'
  | 'SKIPPED'
  | 'FAILED';

export interface AttachmentScanBadgeProps {
  status: VirusScanStatus;
  /** INFECTED 일 때만 의미 있음. tooltip + (선택) inline 표시. */
  signature?: string | null;
  /** scan 종료 시각. tooltip secondary 줄에 노출. */
  scannedAt?: string | null;
  /** sm = 11px, md = 12px (default). md 가 admin 테이블 / sm 이 InfoTab 첨부 list */
  size?: 'sm' | 'md';
  /** SR 접두사. 기본은 "보안 검사:" — 자료 상세에서 다른 도메인 뱃지와 같이 줄을 이룰 때 명시. */
  ariaLabelPrefix?: string;
  className?: string;
}
```

JSX 출력은 R28 `ConversionStatusBadge`와 동일 골격(점 + 라벨 + 선택적 spinner) — Korean text + dot color로 colorblind/SR 보호.

### A.2 6 status 시각 정의 (디자인 토큰 0건 추가)

| status | 점 색 | pill 배경/글자 | pulse | 우측 아이콘 | 라벨 | 의미 카피 (tooltip 1행) |
|---|---|---|---|---|---|---|
| PENDING | `bg-slate-400` | `bg-slate-100 text-slate-700` (다크 `bg-slate-900/40 text-slate-300`) | × | × | 대기 | 스캔 대기 중 |
| SCANNING | `bg-sky-500` | `bg-sky-50 text-sky-700` (다크 `bg-sky-950/30 text-sky-300`) | ● | `Loader2` (animate-spin) | 검사 중 | 바이러스 검사 진행 중 |
| CLEAN | `bg-emerald-500` | `bg-emerald-50 text-emerald-700` (다크 `bg-emerald-950/30 text-emerald-300`) | × | `ShieldCheck` (lucide, h-3.5 w-3.5) | 안전 | 검사 통과 |
| INFECTED | `bg-rose-600` | `bg-rose-50 text-rose-700 ring-1 ring-rose-300/70` (다크 `bg-rose-950/40 text-rose-300 ring-rose-800/60`) | × | `ShieldAlert` (lucide, h-3.5 w-3.5) | 감염 | 바이러스 감염: `{signature}` |
| SKIPPED | `bg-slate-300` | `bg-slate-50 text-slate-500` (다크 `bg-slate-900/30 text-slate-500`) | × | `MinusCircle` (h-3 w-3) | 미검사 | 스캐너 비활성화로 검사 생략됨 |
| FAILED | `bg-amber-500` | `bg-amber-50 text-amber-700` (다크 `bg-amber-950/30 text-amber-300`) | × | `AlertTriangle` (h-3.5 w-3.5) | 실패 | 스캔 실패 — 재시도 가능 |

**왜 amber 인가 (PM 결정 §D.4 default):**
- rose 는 "사용자에게 위험 신호"를 보내는 색이고, INFECTED 는 사용자가 의식해야 할 진짜 위협. FAILED 는 "스캔이 안 끝남(=시스템 결함)"이지 위협이 아님 → amber(주의). conversion FAILED는 rose를 쓰지만, 거기는 결과가 사용자에게 전달되는 surface가 아니라 (관리자만 봄) 같은 색을 써도 혼동이 적음. 이번 뱃지는 **자료 상세에 노출**되므로 사용자에게 INFECTED와 FAILED가 시각적으로 구분되어야 한다.
- amber 는 R32 manuals outline / R29 알림 토큰에 이미 존재 → 신규 토큰 0.

**SKIPPED 가 dim 인 이유:**
- 사용자/관리자 모두에게 정보 가치가 낮다 (운영자가 ClamAV를 일부러 껐을 때만 발생). 시각적으로 약화시켜 다른 status에 우선순위를 넘긴다.

### A.3 시각 디테일

```
inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium leading-none
size=sm  →  text-[11px]
size=md  →  text-[12px]
점       →  inline-block h-1.5 w-1.5 shrink-0 rounded-full {dot}
              SCANNING 만 animate-pulse
spinner  →  Loader2  size 별 h-3 w-3 (sm) / h-3.5 w-3.5 (md)
icon     →  CLEAN/INFECTED/SKIPPED/FAILED 의 식별 아이콘 (위 표 참조). h-3 w-3 (sm) / h-3.5 w-3.5 (md)
INFECTED ring → 추가 ring-1 ring-rose-300/70 으로 일반 pill보다 한 단계 강조
```

### A.4 ARIA + 키보드

- `role="status"` 를 pill 자체에 부여. SR이 즉시 읽도록 `aria-live` 는 부모(자료 상세 InfoTab의 첨부 list)에서만 polite로 둔다 — 이렇게 해야 폴링으로 SCANNING→CLEAN 전환 시 SR이 한 번 알린다 (대시보드는 너무 많아서 live 제외).
- `aria-label` = `${ariaLabelPrefix ?? '보안 검사:'} ${label}${signature && status === 'INFECTED' ? ', 시그니처 ' + signature : ''}`.
- 자체적인 tabIndex 없음. 부모 `<Tooltip>` 또는 `<button>` (재스캔 행 등)이 포커스 받음.

### A.5 Tooltip wrapping rule

뱃지 자체는 tooltip을 내장하지 않는다 (재사용성·layout 단순). **소비측에서 `<Tooltip>` 으로 감싼다.**
- InfoTab 첨부 list: 항상 wrap. 컨텐츠는 위 표 "의미 카피" + (있으면) `scannedAt` 포맷. INFECTED 만 추가로 "다운로드가 차단되었습니다. 보안 담당자에게 문의하세요."
- /admin/scans 테이블: status 컬럼은 wrap 안 함 (행 자체 컨텍스트가 충분). signature 셀이 별도 컬럼으로 따로 노출.

### A.6 상태 전환 애니메이션 — 디자인 의도

폴링 5초 주기로 status 가 바뀌는 시점에 **한 번만 부드러운 페이드**:
- 기본은 즉시 교체 (껌뻑이는 효과는 일부러 없앤다).
- **PENDING→SCANNING**, **SCANNING→CLEAN**, **SCANNING→INFECTED** 의 세 전환은 사용자 의식 변화 지점이므로 200ms `transition-colors` 정도로만 부드럽게.
- 점의 `animate-pulse` 가 SCANNING 동안 시각적 진행 신호 — 별도 spinner를 무겁게 안 써도 됨 (Loader2는 우측 secondary cue).

---

## B. 첨부 list 행 — 자료 상세 InfoTab + 검색 결과 마스터 행

### B.1 자료 상세 InfoTab — 영향 파일

**파일:** `apps/web/app/(main)/objects/[id]/page.tsx` (line 1136 ~ 1215 영역).

`obj.attachments` 의 각 row 에 scan status 가 도달하도록 **타입 확장** (frontend agent 가이드):

```ts
// 기존 (line 154):
attachments: Array<{ id: string; name: string; size: string; master: boolean }>;
// 확장:
attachments: Array<{
  id: string;
  name: string;
  size: string;
  master: boolean;
  /** R36 — virus scan status. PENDING for newly created attachments. */
  scanStatus: VirusScanStatus;
  scanSignature?: string | null;
  scanAt?: string | null;
}>;
```

페이지 server component (`page.tsx` 의 `loadObject`) 가 BE 응답 shape에서 `virusScanStatus / virusScanSig / virusScanAt` 을 그대로 매핑한다. BE 작업이 contract §3.5의 attachment list 응답에 이 3필드를 포함하면 끝.

### B.2 첨부 list 행 와이어프레임

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [M] 도면.dwg              [● 안전 ✓]                  4.3 MB   [⬇][⋮]      │   ← CLEAN (default)
│                                                                              │
│ [📄] meta.json            [● 검사 중 ◌]              412 B    [⬇][⋮]      │   ← SCANNING (sky pulse, spinner; 다운로드 enabled, tooltip "스캔 진행 중")
│                                                                              │
│┃[📄] suspicious.zip       [● 감염 ⚠ Eicar-Test]      1.0 KB   [⬇disabled]  │   ← INFECTED — 행 좌측 ┃ rose-300 4px border
│                                                                              │
│ [📄] proto.dwg            [● 미검사 ⊝]               2.1 MB   [⬇][⋮]      │   ← SKIPPED (dim, 다운로드 enabled)
│                                                                              │
│ [📄] retry.dxf            [● 실패 ⚠]                  88 KB    [⬇][⋮]      │   ← FAILED — 다운로드 enabled (BE는 FAILED를 차단하지 않음 — PENDING와 동일 정책, PM-DECISION §D.2)
└─────────────────────────────────────────────────────────────────────────────┘
```

**좌측 4px rose border (INFECTED 만):**
- `<li>` 클래스에 `border-l-4 border-l-rose-400 dark:border-l-rose-700 pl-3.5` (기본 `pl-4` 에서 4px 빼서 alignment 유지).
- 행 배경은 그대로 (분홍 fill 안 함 — 너무 시끄럽다). border 1줄 + 뱃지 ring 으로 충분히 강조.

**버튼 disable 매트릭스:**

| status | 다운로드 (`<a>`) | 뷰어 링크 (`/viewer/:id`) | 행 메뉴 (마스터로 지정 / 삭제) |
|---|---|---|---|
| PENDING | enabled (tooltip "스캔 대기 중") | enabled | enabled (관리는 admin 권한이 있으면 항상 가능) |
| SCANNING | enabled (tooltip "스캔 진행 중") | enabled | enabled |
| CLEAN | enabled | enabled | enabled |
| INFECTED | **disabled** (`pointer-events-none opacity-40` + `aria-disabled="true"` + tooltip 강제 노출) | **disabled** (Link 대신 `<span>` 으로 렌더 + `cursor-not-allowed`) | **삭제만 enabled** (감염 첨부를 정리할 수 있어야 함, "마스터로 지정" disabled). |
| SKIPPED | enabled | enabled | enabled |
| FAILED | enabled (tooltip "스캔 실패 — 재시도 권장") | enabled | enabled |

**핵심:** `INFECTED` 만 사용자 진입을 차단. 나머지 status 는 BE 가드(서버에서 실제 차단)를 신뢰하고, FE 는 정보 표시만 한다. 이 분리는 **두 가지를 보장**: (a) BE 가 정책을 한 곳에서 관리 (다른 status를 추가로 차단하기로 결정해도 FE 미수정), (b) FE 는 시각 신호의 단일성만 책임진다.

### B.3 컴포넌트 트리 (자료 상세)

```
<ObjectDetailPage>
  <InfoTab>
    <Section title="첨부파일">
      <ul>
        {obj.attachments.map(a => (
          <li key={a.id} className={cn('flex items-center gap-3 px-4 py-2.5', a.scanStatus === 'INFECTED' && 'border-l-4 border-l-rose-400 pl-3.5')}>
            <MasterOrFileIcon master={a.master} />
            <FilenameOrViewerLink a={a} disabled={a.scanStatus === 'INFECTED'} />
            <Tooltip content={<ScanTooltipBody a={a} />}>
              <AttachmentScanBadge size="sm" status={a.scanStatus} signature={a.scanSignature} scannedAt={a.scanAt} />
            </Tooltip>
            <span className="ml-auto font-mono text-xs text-fg-muted">{a.size}</span>
            <DownloadAnchor a={a} disabled={a.scanStatus === 'INFECTED'} />
            {canMutateAttachment ? <RowMenu a={a} setMasterDisabled={a.scanStatus === 'INFECTED'} /> : null}
          </li>
        ))}
      </ul>
    </Section>
  </InfoTab>
</ObjectDetailPage>
```

### B.4 폴링 — InfoTab 한정

PENDING/SCANNING 첨부가 **한 건이라도** 있을 때만 5초 폴링으로 객체 detail 쿼리를 invalidate. 모든 첨부가 terminal(CLEAN/INFECTED/SKIPPED/FAILED) 이면 폴링 정지.

```ts
// useQuery refetchInterval (objects.detail)
refetchInterval: (query) => {
  const atts = query.state.data?.attachments ?? [];
  return atts.some(a => a.scanStatus === 'PENDING' || a.scanStatus === 'SCANNING') ? 5000 : false;
}
```

이미 R28/R33 패턴이라 frontend agent 가 그대로 옮긴다.

### B.5 검색 결과 행 (`/search`) — 처리 방침

검색 결과 그리드(`apps/web/components/object-list/ObjectTable.tsx`)는 **객체 단위**이고 첨부는 마스터 1개만 노출되므로 다음 정책:

- 그리드 자체에는 **scan badge 컬럼을 추가하지 않는다** — 30+개 행에 6색 뱃지가 깔리면 컬럼 노이즈가 너무 큼. 객체 단위에서 보안 신호는 마스터의 INFECTED 여부 1bit로 충분.
- 단, **마스터가 INFECTED 인 행** 은 그리드에서 시각 강조: 도면번호 셀 좌측에 작은 rose dot (h-1.5 w-1.5) + tooltip "마스터 첨부가 감염 — 다운로드 차단". `ObjectRow` 타입에 `masterScanStatus?: VirusScanStatus | null` 추가.
- 그리드 행의 일괄 다운로드(`handleBulkDownload`) 가 INFECTED 마스터를 만나면 **사전에 제외** + 토스트 ("`{N}건이 감염으로 제외됨"). 이건 BE 가드가 더 강하지만 (BE도 거절), FE 사전 필터로 사용자 메시지가 덜 시끄러워진다.
- **`<ObjectPreviewPanel>`** (preview pane) 의 "마스터 첨부" 영역에는 **명시적인 `<AttachmentScanBadge>` 1개**를 표시 — preview 는 한 번에 한 행이라 노이즈 부담 없음. INFECTED 면 "열기/다운로드/인쇄" 버튼 모두 disabled.

이 방침은 contract §5.1 "검색 결과에 노출"을 **그리드 = silent dot + bulk filter / preview = 명시 뱃지**로 분기 해석한 것 — designer 결정이며 PM이 contract 문구를 바꾸지 않아도 backend agent 가 마스터 status 만 노출하면 충족.

---

## C. /admin/scans 페이지 (D-운영)

### C.1 라우트 + 메뉴

**라우트:** `apps/web/app/(main)/admin/scans/page.tsx` (신설). 클라이언트 컴포넌트.

**메뉴 등록:** `apps/web/app/(main)/admin/admin-groups.ts`의 "통합 / 로그" 그룹에 추가. 위치는 `/admin/storage` 바로 아래, `/admin/integrations` 위. 이유: storage(어디 저장?) → scans(저장된 것이 안전한가?) 의 mental flow.

```ts
// admin-groups.ts — items 배열에 storage 직후 삽입
{
  href: '/admin/scans',
  label: '바이러스 검사',
  description: '첨부 파일 검사 이력 / 감염 / 재스캔',
  icon: ShieldAlert,   // lucide-react
},
```

`ShieldAlert` 아이콘은 다른 메뉴에 없는 것을 확인 (R28의 `ShieldCheck` 와 다름 — Check 는 권한 매트릭스, Alert 는 보안 위험).

### C.2 페이지 와이어프레임 (≥1280)

```
┌──────── /admin/scans ────────────────────────────────────────────────────────┐
│ [TopBar — 글로벌, 그대로]                                                    │
├────────────┬─────────────────────────────────────────────────────────────────┤
│ AdminSidebar│ ┌── breadcrumb ────────────────────────────────────────────┐  │
│            │ │  관리자 / 바이러스 검사                                     │  │
│  ▸ 사용자  │ └────────────────────────────────────────────────────────────┘  │
│  ▸ 조직    │                                                                 │
│  ▸ 그룹    │ ┌── page header ───────────────────────────────────────────┐    │
│  ─        │ │  ADMIN CONSOLE                                             │    │
│  ▸ 폴더트리│ │  바이러스 검사                                             │    │
│  ▸ 권한매트│ │  ClamAV 로 첨부를 자동 검사합니다. INFECTED 는 다운로드/   │    │
│  ─        │ │  미리보기/인쇄가 차단됩니다.                               │    │
│  ▸ 자료유형│ │                                       [⟳][필터▼]          │    │
│  ▸ 발번규칙│ └────────────────────────────────────────────────────────────┘    │
│  ─        │                                                                 │
│  ▸ 공지   │ ┌── stats strip — 4 primary cards ───────────────────────┐     │
│  ─        │ │  [대기 PENDING ●12]  [검사 중 SCANNING ●3]              │     │
│  ▸ 변환작업│ │  [안전 CLEAN ●1,243] [감염 INFECTED ●2 (강조 rose ring)]│     │
│  ▸ 백업   │ └─────────────────────────────────────────────────────────┘     │
│  ▸ 스토리지│ ┌── secondary stats — 2 small cards ─────────────────────┐    │
│  ▸ 검사 ●  │ │  [미검사 SKIPPED ●41] [실패 FAILED ●5]                   │     │
│  ▸ API key│ └─────────────────────────────────────────────────────────┘     │
│  ▸ 감사로그│                                                                 │
│            │ ┌── filter bar ──────────────────────────────────────────┐     │
│            │ │ 상태 [전체▼]  검색 [🔎 첨부ID·파일명·자료번호 ]   [필터초기화] │     │
│            │ │                                       [☑ 5초 자동새로고침]    │     │
│            │ └─────────────────────────────────────────────────────────┘    │
│            │                                                                 │
│            │ ┌── ScansTable (9컬럼) ───────────────────────────────────┐    │
│            │ │ ▽ │ 상태  │ 자료번호 │ 파일명 │ 시그니처 │ scan 시각 │ 시도│크기│ … │
│            │ │ ─ ┼──────┼─────────┼───────┼─────────┼──────────┼────┼───┼─── │
│            │ │ ▶ │[●감염]│ MB-001  │a.zip  │Eicar-Test│04-27 14:02│ 1 │1KB│ ⋮ │ ← INFECTED 행: 좌측 4px rose border + 시그니처 mono red
│            │ │ ▶ │[●대기]│ MB-002  │b.dwg  │  —       │04-27 14:01│ 0 │4MB│ ⋮ │
│            │ │ ▶ │[●실패]│ MB-003  │c.dxf  │  —       │04-27 13:55│ 2 │8MB│⋮(재스캔)│
│            │ │ ▶ │[●안전]│ MB-004  │d.pdf  │  —       │04-27 13:54│ 1 │220K│⋮ │
│            │ │ ...                                                       │   │
│            │ └─────────────────────────────────────────────────────────┘    │
│            │                                                                 │
│            │ [ 더 보기 (n=50) ]   ← 더 있을 때만                              │
└────────────┴─────────────────────────────────────────────────────────────────┘
```

### C.3 stats card layout — 4 primary + 2 secondary

R28 conversions 페이지가 4개 primary cards 한 줄 grid 였다면, 본 페이지는 6 status 라 어느 4개를 primary 로 둘지 결정해야 한다.

**Primary (큰 카드, `grid-cols-4 gap-3`):**
1. **대기 PENDING** (slate dot)
2. **검사 중 SCANNING** (sky dot, count > 0 일 때 pulse ring)
3. **안전 CLEAN** (emerald dot)
4. **감염 INFECTED** (rose dot, count > 0 일 때 **카드 자체 ring-2 ring-rose-300** + count 굵게)

**Secondary (작은 카드, primary 아래 별도 row, `grid-cols-2 gap-3 max-w-md`, sm 사이즈):**
5. **미검사 SKIPPED** (slate dim dot)
6. **실패 FAILED** (amber dot)

**왜 이 분할인가 (PM-DECISION §D.4 default):**
- 사용자 의식 우선순위: INFECTED ≫ SCANNING(진행) ≫ PENDING(대기) ≫ CLEAN(누계) ≫ FAILED(시스템 결함) ≫ SKIPPED(운영자 의도). 앞 4개가 일상 운영의 메인 메트릭, 뒤 2개는 진단 메트릭.
- 시각적으로 6개를 한 줄에 두면 INFECTED 가 묻혀버림. 4 + 2 분할이 INFECTED 의 시각 무게를 늘린다.

각 card 는 클릭 시 status filter 토글 (R28 패턴 재사용 — `setStatusFilter((cur) => cur === 'INFECTED' ? 'ALL' : 'INFECTED')`). 카드 자체에 `aria-pressed` 가 active 상태를 noise 없이 노출.

### C.4 9컬럼 테이블 — 컬럼 정의

테이블 wrapper 는 R28 conversions 와 동일한 sticky header pattern (`<table className="w-full border-collapse text-sm">` + `thead.sticky top-0 z-10 bg-bg-subtle`).

| # | 컬럼 (`<th>` 라벨) | 너비 | 정렬 | 내용 | 타입 |
|---|---|---|---|---|---|
| 1 | "" (expand toggle) | 28px | left | `<ChevronRight>` / `<ChevronDown>` | button |
| 2 | "상태" | 96px | left | `<AttachmentScanBadge size="md">` | badge |
| 3 | "자료번호" | 140px | left | `Link` to `/objects/{objectId}` (mono) | link |
| 4 | "파일명" | flex (min 200px) | left | `<span className="truncate font-mono text-[12px]">` | text |
| 5 | "시그니처" | 200px | left | `<ScanSignatureCell>` (INFECTED 만 빨간 mono, 나머지 "—") | text |
| 6 | "scan 시각" | 120px | left | `formatTimestamp` (R28 함수 재사용) | text |
| 7 | "시도" | 56px | left | `attempt` 숫자 (FAILED+ 만 의미, 나머지 1 또는 "—") | num |
| 8 | "크기" | 80px | right | `formatBytes` | num-mono |
| 9 | 행 메뉴 | 44px | right | `<DropdownMenu>` (재스캔 / 자료 열기 / 시그니처 복사) | button |

**Total: 9 columns**. PRD/contract 가 명시한 컬럼 수와 일치. 자료번호와 파일명을 한 셀로 합치지 않은 이유: 검색 패턴(자료번호로 검색 vs 파일명으로 검색)이 다르고, 정렬 가능성을 두 컬럼 각각에 보존하기 위함.

**INFECTED 행 강조:**
- `<tr>` 에 `data-infected="true"` 속성 + `tr[data-infected=true] { box-shadow: inset 4px 0 0 hsl(var(--rose-400)); background: hsl(var(--rose-50) / 0.4); }` 같은 효과로 좌측 4px 라인 + 매우 옅은 분홍 fill (R34 storage 페이지가 LOCAL row를 살짝 강조한 패턴과 동일 강도).
- 다크 모드: `bg: rose-950/20`, `box-shadow: rose-700`.

**시그니처 셀 (`<ScanSignatureCell>`):**
- INFECTED 일 때만 의미 있음. `<span className="font-mono text-[11px] text-rose-700 dark:text-rose-300">` + 클릭 시 클립보드 복사 + toast.
- 그 외 status: `<span className="text-fg-subtle">—</span>`.
- INFECTED 가 아닌데 시그니처가 있으면(엣지 케이스) `<span className="font-mono text-[11px] text-fg-muted">` 로 lighten.

### C.5 expand row (시그니처 + 메타 상세)

R28 conversions 의 `expandedId` 패턴 재사용. 클릭 시 다음 줄에 `<tr.expand-row>` 가 펼쳐짐:

```
┌── expanded row content ──────────────────────────────────────────────┐
│  Attachment ID:    01HZB...XYZ                       [📋 복사]        │
│  업로드:           홍길동 (hong) — 2026-04-27 13:50:11               │
│  자료 경로:        / 기계 / 압연기 / MB-001 (R3 v1.2)                │
│  마지막 시도:      2026-04-27 14:02:33   (총 1회)                    │
│  시그니처:         Eicar-Test-Signature              [📋 복사] (INFECTED만)│
│  최근 메시지:      (FAILED 시) clamscan exit 2: malformed binary      │
│                                                                       │
│  [ 자료 상세 열기 → ]    [ 재스캔 (FAILED + INFECTED만) ]              │
└───────────────────────────────────────────────────────────────────────┘
```

스타일: `<tr><td colSpan={9}>` 안에 `<div className="rounded-md border border-border bg-bg-subtle p-3 m-2 text-sm">` + dl-style 두 컬럼 grid.

### C.6 재스캔 액션 — 트리거 + ConfirmDialog

**트리거 위치 (PM-DECISION §D.5):**
- 행 메뉴(컬럼 9)에서 **항상** "재스캔" item을 표시. **disabled**: 아래 매트릭스.
- expanded row 의 footer 영역에서도 **`FAILED` 와 `INFECTED` 만 명시 버튼 노출** — 가장 액션이 유효한 케이스라 시각적으로 강조.

**활성 매트릭스:**

| status | 행메뉴 "재스캔" | expanded 버튼 |
|---|---|---|
| PENDING | disabled (이미 큐에 있음) | 표시 안 함 |
| SCANNING | disabled (이미 처리 중) | 표시 안 함 |
| CLEAN | enabled (관리자 명시 의지로 재검사 가능) | 표시 안 함 |
| INFECTED | enabled | **표시** (빨간 outline, "재스캔") |
| SKIPPED | enabled (CLAMAV 가 다시 켜진 후 사후 검사) | 표시 안 함 |
| FAILED | enabled | **표시** (amber outline, "재스캔") |

**ConfirmDialog 카피 (`<RescanConfirmDialog>` — 페이지 안에 inline 컴포넌트):**

| 상태별 | title | description |
|---|---|---|
| INFECTED 재스캔 | "이 첨부를 다시 검사하시겠습니까?" | "현재 INFECTED 상태입니다. 시그니처 DB가 갱신되어 false positive 가능성이 있을 때만 사용하세요." |
| FAILED 재스캔 | "이 첨부를 다시 검사하시겠습니까?" | "이전 실패: {errorMessage}. 큐에 PENDING 으로 다시 투입됩니다." |
| 기타 (CLEAN/SKIPPED) | "이 첨부를 다시 검사하시겠습니까?" | "관리자 의지로 재검사합니다. 결과가 갱신됩니다." |

**Mutation 패턴:** R28 conversions retry 와 동일한 detail-mutation factory. error code 매핑:
- 404: "첨부를 찾을 수 없습니다 (삭제되었을 수 있습니다)."
- 409: "이미 처리 중인 작업입니다." (SCANNING/PENDING 와 race)
- E_RATE_LIMIT: "요청 빈도 제한에 걸렸습니다. 잠시 후 다시 시도하세요."
- 그 외: "재스캔 실패" + err.message.

**행 row optimistic:**
- onMutate 에 row 의 `virusScanStatus` 를 `PENDING` 으로 setQueryData. (이전 status 가 INFECTED 였더라도 즉시 PENDING 으로 바뀌어 사용자 피드백 즉시.)
- onSettled 에 invalidate.

### C.7 폴링 정책

R28 conversions 와 동일:
- `useQuery({ refetchInterval: (q) => autoRefresh && (stats.PENDING + stats.SCANNING > 0) ? 5000 : false })`.
- `autoRefresh` 토글은 stats strip 우측 또는 filter bar 우측에 inline 체크박스(R28 패턴). 기본 ON.
- visibilitychange 로 탭 전환 시 fetch resume (R28 패턴).

### C.8 컴포넌트 트리

```
<ScansPage>
  <AdminSidebar />
  <section className="flex flex-col">
    <Breadcrumb />
    <PageHeader title="바이러스 검사" />
    <StatsStripPrimary stats={stats} activeFilter={statusFilter} onSelect={setStatusFilter} />
    <StatsStripSecondary stats={stats} activeFilter={statusFilter} onSelect={setStatusFilter} />
    <FilterBar
      statusFilter={statusFilter}
      onStatusChange={setStatusFilter}
      query={query}
      onQueryChange={setQuery}
      autoRefresh={autoRefresh}
      onAutoRefreshChange={setAutoRefresh}
      isFetching={listQuery.isFetching}
    />
    <div className="overflow-auto">
      <ScansTable
        rows={rows}
        expandedId={expandedId}
        onToggleExpand={...}
        onRescan={(row) => setRescanTarget(row)}
        onCopySignature={...}
      />
    </div>
    <LoadMoreButton nextCursor={nextCursor} onClick={loadMore} />
  </section>
  <RescanConfirmDialog target={rescanTarget} onCancel={() => setRescanTarget(null)} onConfirm={...} />
</ScansPage>
```

각 sub-component(StatsStripPrimary, ScansTable, FilterBar) 는 `apps/web/app/(main)/admin/scans/page.tsx` **안의 inline 컴포넌트**로 둔다 — R28 conversions 페이지 패턴과 동일. 별도 파일로 분리하지 않는다 (페이지 단위 응집성).

### C.9 인터랙션 시퀀스 — 4 시나리오

**S1: 페이지 첫 진입 → 첫 폴링 사이클**
```
사용자  Click [/admin/scans 메뉴]
  → Next.js navigates → page.tsx mounts
  → useQuery(GET /api/v1/admin/scans?limit=50) fires
  → loading skeleton (8 rows) 표시
  ← 200 { data: [50 rows], meta: { stats, nextCursor } }
  → stats strip 4+2 cards 마운트, INFECTED count > 0 면 카드 ring 강조
  → table 렌더, INFECTED 행 좌측 라인 + 옅은 fill
  → autoRefresh ON + (stats.PENDING + stats.SCANNING > 0) → 5s interval 시작
[+5s] auto refetch fires. 같은 query key.
  ← 200 (변경된 status 만 stats + rows 갱신)
  → SCANNING 점이 pulse 유지, status 전환된 행은 200ms transition-colors 로 부드럽게 색 바뀜
```

**S2: status filter 토글 (INFECTED card 클릭)**
```
사용자  Click [INFECTED card]
  → setStatusFilter('INFECTED'), card aria-pressed=true (rose ring 강화)
  → useEffect 가 query key 갱신 → 새 useQuery fire (cursor reset)
  ← 200 (INFECTED 만)
  → table 가 INFECTED 행만 노출. count = N. 카드 다시 클릭 시 toggle off.
```

**S3: FAILED 행 재스캔**
```
사용자  Click [⋮ → 재스캔] on FAILED row OR Click [재스캔] in expanded footer
  → setRescanTarget(row)
  → <RescanConfirmDialog open=true title="이 첨부를 다시 검사하시겠습니까?" description="이전 실패: {errorMessage}." />
사용자  Click [재스캔 (확인 버튼)]
  → mutate POST /api/v1/admin/scans/jobs/{attachmentId}/rescan
  → onMutate: row.virusScanStatus = 'PENDING' optimistic, dialog 닫힘
  ← 200 { ok: true }
  → toast.success('재스캔 큐에 추가되었습니다.')
  → invalidate /admin/scans list
  → 새 데이터 도착 → 행 status PENDING (옵티미스틱과 일치) → 다음 폴링에서 SCANNING → CLEAN 또는 INFECTED
```

**S4: 시그니처 복사**
```
사용자  Click expanded row 의 시그니처 옆 [📋]
  → navigator.clipboard.writeText('Eicar-Test-Signature')
  → toast.success('클립보드에 복사되었습니다.')
```

### C.10 빈 상태 / 에러 / 로딩

| 상황 | 시각 |
|---|---|
| listQuery.isPending (첫 로드) | 8개 `<Skeleton h-9 w-full>` 행 (R28 패턴) |
| listQuery.isError + 403 | EmptyState icon=`AlertCircle` title="스캔 이력 조회 권한이 없습니다" + [재시도] outline 버튼 |
| listQuery.isError 일반 | EmptyState icon=`AlertCircle` title="스캔 이력을 불러오지 못했습니다" + description=err.message + [재시도] |
| 데이터 0건 + filter 활성 | EmptyState icon=`Search` title="조건에 맞는 작업이 없습니다" + [필터 초기화] |
| 데이터 0건 + filter 없음 | EmptyState icon=`ShieldCheck` title="아직 스캔 이력이 없습니다" description="첨부가 업로드되면 여기에 기록됩니다." |

### C.11 접근성

- 4+2 stats card 는 `<button role="button" aria-pressed={active}>` — 키보드 Tab 으로 6 카드 사이 이동, Space/Enter 로 토글.
- table 행 expand toggle 은 `<button aria-expanded={expanded} aria-controls={"row-"+id+"-expand"}>`. 키보드 Enter/Space.
- INFECTED 행에 `aria-label="감염: {filename} - {signature}"` 전체 행에 부여 → SR 읽기 1줄 요약.
- table caption: `<caption className="sr-only">바이러스 검사 이력 — 최신 50건. 자동 새로고침 5초.</caption>`.
- color-contrast: amber-700 on amber-50 = 4.7:1 (AA pass), rose-700 on rose-50 = 5.8:1 (AA pass), emerald-700 on emerald-50 = 4.6:1 (AA pass), sky-700 on sky-50 = 5.0:1 (AA pass), slate-700 on slate-100 = 9.2:1 (AAA). 모든 6 status 가 WCAG AA 통과.
- 다크 모드: 모든 pill 의 dark variant 가 `bg-{hue}-950/30 text-{hue}-300` 패턴으로 표준 (R28/R33 패턴 일관) — 4.5:1 이상.

---

## D. PM 결정 항목 (보수적 default 명시)

| ID | 항목 | designer 보수적 default | PM 검토 시 고려 |
|---|---|---|---|
| D.1 | `/admin/scans` 접근 권한 | **ADMIN+** (SUPER_ADMIN 만 아님) — R28 conversions / R33 backups 와 동일 | 필요시 SUPER_ADMIN only 로 좁혀도 시각 영향 없음, middleware 만 변경 |
| D.2 | FAILED 첨부 다운로드 정책 | **enabled** (BE 가 막지 않음, FE도 시각 신호만 + tooltip "스캔 실패") | 보수적으로 막을지 정책 변경하면 disable 매트릭스만 1줄 수정 |
| D.3 | INFECTED 첨부 삭제 가능 여부 | **가능** (관리자가 정리해야 하므로 RowMenu 의 "삭제" 만 enabled, "마스터로 지정" 은 disabled) | BE 가 "INFECTED 라도 삭제는 허용"이어야 함 (contract §3.4 에 명시 안 됨 → BE 확인 필요) |
| D.4 | FAILED 색상 (rose vs amber) | **amber** — 사용자 위협이 아니라 시스템 결함이므로 INFECTED(rose) 와 시각 분리 | rose 로 통일하면 INFECTED 와 한눈에 안 구분됨, 권장하지 않음 |
| D.5 | 재스캔 endpoint 경로 | `POST /api/v1/admin/scans/jobs/:attachmentId/rescan` (R28 conversions retry 와 동일 형태) — contract §3.5 에 미명시. **PM/BE 확정 필요** | URL 변경되면 frontend mutation path 1줄만 수정 |
| D.6 | 시그니처 복사 시 toast | "클립보드에 복사되었습니다." — R28 패턴 그대로 | 변경 불필요 |
| D.7 | INFECTED 알림(`SECURITY_INFECTED_FILE`) UI 출처 | 본 라운드는 **알림 채널 wiring 없음**. 알림 자체는 NotificationBell(R29) 가 자동 표시 — 본 페이지는 이력 surface, 알림은 별도 채널 | 다음 라운드(`R37+`) 에 admin Bell alert 추가 시 NotificationBell type case 1줄만 |
| D.8 | INFECTED 그리드 행 silent dot | 검색 결과 그리드는 객체 단위라 6 색 뱃지를 다 두면 노이즈, 마스터 INFECTED 만 작은 rose dot + bulk download pre-filter | PM이 "그리드도 명시 뱃지" 원하면 ObjectTable 에 컬럼 1개 추가. 시각 부담 큼 |

---

## E. 변경 영향 — 파일별

| 파일 | 변경 타입 | 핵심 변경 |
|---|---|---|
| `apps/web/components/AttachmentScanBadge.tsx` | **신설** | 6 status pill 컴포넌트 |
| `apps/web/app/(main)/admin/scans/page.tsx` | **신설** | 페이지 + inline 컴포넌트 (StatsStrip, FilterBar, ScansTable, RescanConfirmDialog) |
| `apps/web/app/(main)/admin/admin-groups.ts` | edit | "통합 / 로그" 그룹에 1 항목 추가 (storage 직후) |
| `apps/web/app/(main)/objects/[id]/page.tsx` | edit | (1) `obj.attachments` 타입에 `scanStatus / scanSignature / scanAt` 추가, (2) InfoTab 첨부 list 에 `<AttachmentScanBadge>` wire + INFECTED 행 좌측 border + 다운로드/뷰어 disable, (3) detail query refetchInterval 분기 추가 |
| `apps/web/components/object-list/ObjectTable.tsx` | edit | `ObjectRow` 에 `masterScanStatus` 추가, INFECTED 마스터 행 도면번호 셀 좌측 작은 rose dot + tooltip |
| `apps/web/components/object-list/ObjectPreviewPanel.tsx` | edit | preview 의 마스터 영역에 `<AttachmentScanBadge size="sm">` 1개 + INFECTED 시 열기/다운로드/인쇄 버튼 disabled |
| `apps/web/app/(main)/search/page.tsx` | edit | `adaptObject` 가 `o.masterScanStatus` 를 `ObjectRow` 에 매핑, `handleBulkDownload` 가 INFECTED 마스터 사전 필터 + 토스트 |
| `apps/web/lib/queries.ts` | edit | `queryKeys.admin.scans({ status, cursor })` 추가 (R28 conversions 패턴) |

**디자인 토큰 / globals.css / tailwind.config.ts: 변경 없음.** 기존 slate/sky/emerald/rose/amber + `.app-panel` + `.app-kicker` + `.app-action-button*` 만 사용.

---

## F. 시각 검증 (frontend 구현 후 QA 체크리스트)

- [ ] 6 status 뱃지가 `<AttachmentScanBadge status="..." />` storybook(있으면) 또는 임시 페이지에서 한 줄에 모두 보이고 sm/md 두 사이즈가 균형
- [ ] 자료 상세 InfoTab 의 첨부 list 에서 INFECTED 행만 좌측 4px rose border, 다운로드/뷰어 disabled, 행 메뉴의 "마스터로 지정" disabled
- [ ] /admin/scans 4 primary cards 가 INFECTED count > 0 일 때 ring 강조, 0 일 때 일반 상태
- [ ] 9 컬럼 테이블 이 ≥1280 에서 가로 스크롤 없이 들어감 (시그니처 200px 가 가장 빠듯) — 컬럼 폭 미세조정 필요할 수 있음
- [ ] expanded row 의 시그니처/Attachment ID 복사 버튼이 클립보드 + toast 발화
- [ ] "재스캔" ConfirmDialog 가 status 별 카피로 분기되며 INFECTED / FAILED 만 expanded 영역에 명시 버튼 표시
- [ ] 5초 폴링이 PENDING+SCANNING > 0 일 때만 가동 (network tab 확인)
- [ ] visibilitychange 시 탭 hidden 동안 fetch 중단, 복귀 시 즉시 1회 fetch
- [ ] 키보드 only — Tab 으로 stats card → filter bar → table 행 expand → 메뉴 → ConfirmDialog 까지 도달 가능, focus ring 모두 가시
- [ ] color-blind 시뮬레이터 (deuteranopia) 에서 6 status 가 각각 구분 가능 (점 색 외 라벨 + 아이콘이 구분 신호)

---

## G. 변경 이력
| 날짜 | 변경 |
|---|---|
| 2026-04-27 | 초기 작성 (R36) — designer agent in worktree `agent-a667d042` |
