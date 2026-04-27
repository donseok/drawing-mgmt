# R28 Design Spec — Folder Permissions Matrix + Conversion Jobs Monitor

| 항목 | 내용 |
|---|---|
| 작성자 | drawing-mgmt designer agent (R28) |
| 작성일 | 2026-04-27 |
| 대상 라운드 | R28 |
| 대상 PRD/DESIGN | docs/PRD.md, docs/DESIGN.md (특히 §4 글로벌 레이아웃, §6.8 관리자) |
| 신규 페이지 | `/admin/folder-permissions`, `/admin/conversions` |
| 신규 컴포넌트 | `<PermissionMatrix>`, `<PrincipalPicker>`, `<ConversionStatusBadge>` |
| 의존 (BE) | `_workspace/api_contract.md` §3(Folder), §4.3(Permission CRUD), §8(Conversion Admin) — *주의: 본 라운드에서 손실되어 PM이 재발행 예정. 본 spec은 재발행될 contract와 정합되도록 보수적으로 기술됨.* |
| 디바이스 | Desktop only (≥1280). <1280은 read-only fallback. |
| 디자인 토큰 변경 | 없음 (기존 Tailwind palette + DESIGN.md 토큰 활용). 선택적 utility 1조 제안 (§E). |

---

## 0. 라운드 개요와 사용자 시나리오

### 0.1 두 페이지가 같은 라운드에 묶이는 이유

두 페이지 모두 **관리자(SUPER_ADMIN/ADMIN)만** 접근하는 화면이며, 기존 `/admin/[section]/page.tsx`의 placeholder 테이블로는 표현할 수 없는 **편집·실시간 모니터링** 요구가 있다. 두 화면 모두 이번 라운드에 처음 실 데이터와 결합한다.

- **/admin/folder-permissions** — 기존 dummy 테이블(§admin/[section] folders)을 대체. FolderPermission 행을 폴더 단위로 편집한다.
- **/admin/conversions** — DWG → PDF/DXF/SVG 변환 큐 모니터링. 기존 BullMQ 큐의 가시성을 처음 부여하는 화면.

### 0.2 페르소나별 시나리오

| 페르소나 | 사용 목적 | 빈도 |
|---|---|---|
| 슈퍼관리자 (1~2명) | 신규 폴더 권한 일괄 부여, 대규모 grant 변경, 큐 장애 대응 | 주 1~2회 |
| 관리자 (2~3명) | 신규 사원·외주사 입사 시 권한 추가/회수, 변환 실패 재시도 | 일 단위 |
| 설계자 (10~15명) | 접근 불가 (이 화면에서는 viewer 페르소나가 아님) | — |

핵심 시나리오 3개:

1. **신규 협력업체 `홍성기계` 입사 → CGL-2/협력업체 폴더에 VIEW + DOWNLOAD만 부여**
   - admin이 `/admin/folder-permissions` → 좌측 트리에서 폴더 선택 → `+ 추가` → 탭 ORG → `홍성기계` 검색 → 추가 → 매트릭스에서 VIEW/DOWNLOAD 체크 → `저장`
2. **DWG 변환이 5분째 실패 누적 → 강제 재시도**
   - admin이 `/admin/conversions` → 상단 stats `FAILED 7` 클릭 → 실패 행 펼쳐서 errorMessage 확인 → 행별 `재시도` 또는 (TBD: 일괄 재시도)
3. **퇴사자 권한 즉시 회수**
   - admin이 폴더 권한 화면 진입 → 행 우측 `삭제` → 행이 rose-bordered "(삭제됨)" 상태로 변함 → `저장`

---

## A. /admin/folder-permissions — 폴더 권한 매트릭스 편집

### A.1 라우트 및 진입점

- **Route:** `/admin/folder-permissions`
- **AdminSidebar 진입:** `apps/web/app/(main)/admin/admin-groups.ts`의 `폴더 / 권한` 그룹에 신규 항목 추가:
  ```ts
  {
    href: '/admin/folder-permissions',
    label: '권한 매트릭스',
    description: '폴더별 사용자/조직/그룹 권한 비트 편집',
    icon: ShieldCheck, // lucide-react
  }
  ```
  기존 `/admin/folders` (폴더 트리) 항목 **바로 아래**에 위치. 같은 그룹 내 두 항목으로 분리 — 폴더 트리(이름·코드·정렬)와 권한(비트)은 다른 정신 모델이라는 PM 결정.
- **권한:** SUPER_ADMIN/ADMIN. 외에는 layout-level guard로 redirect (`/login` 또는 `/`로). 본 spec은 layout이 이미 가드한다고 가정.

### A.2 3-Pane 레이아웃 (1280+ 기준)

```
┌─ Header (글로벌, 56px) ─────────────────────────────────────────────────┐
│NavRail│ AdminSidebar  │ FolderTree (admin)  │ Permission Matrix          │
│ 56px  │   240px        │   280px              │   fluid (≥720)             │
│       │               │                      │                            │
│       │ ▼ 폴더/권한    │ ▼ 본사               │ ┌─ Header (sticky) ──────┐ │
│       │   • 폴더 트리   │   ▼ 기계              │ │ 본사/기계/CGL-2/메인  │ │
│       │ • 권한 매트릭스 │     ▼ CGL-1           │ │ ─────────────────────  │ │
│       │   ← active     │     ▼ CGL-2           │ │ 12 principals · ▴2변경  │ │
│       │               │       • 메인라인 ●    │ │  [+ 추가]  [↺ 되돌리기] │ │
│       │ ▼ 자료유형     │       • 보조라인     │ │  [저장]    [닫기]        │ │
│       │ ...            │   ▶ 전기              │ ├────────────────────────┤ │
│       │               │ ▶ 협력업체            │ │ Matrix table (scroll)   │ │
│       │               │ ▶ 폐기함              │ └────────────────────────┘ │
└───────┴───────────────┴──────────────────────┴────────────────────────────┘
```

- 좌측 **AdminSidebar**: 기존 그대로(`<AdminSidebar />`), `/admin/folder-permissions` 활성 표시.
- 중앙 **FolderTree**: 기존 `<FolderTree>` 재사용. **단 admin 화면에서는 모든 폴더가 보여야 함** — admin은 SUPER_ADMIN이거나 ADMIN으로, `filterVisibleFolders`가 ADMIN을 SUPER_ADMIN처럼 다루지는 않는다는 점 유의(`permissions.ts:90`은 SUPER_ADMIN만 bypass). [PM-DECISION-7] `/api/v1/folders`가 admin 호출에 한해 모든 폴더를 반환하도록 BE 변경이 필요할지, 아니면 이 페이지 전용 `/api/v1/admin/folders` 신설이 필요할지 결정 필요. 보수적 default: BE에 `?admin=true` 쿼리 파라미터(ADMIN role일 때만 모든 폴더 반환) 추가 요청 — frontend는 `?admin=true`를 항상 붙임.
- 우측 **Permission Matrix**: 폴더 미선택 시 EmptyState (`<ShieldCheck>` icon + "왼쪽 트리에서 폴더를 선택해 권한을 편집하세요"). 선택 시 9컬럼 매트릭스.

### A.3 매트릭스 헤더(Sticky)

```
┌─────────────────────────────────────────────────────────────────┐
│ 본사 / 기계 / CGL-2 / 메인라인          12 principals · ▴2 변경  │
│                                                                  │
│ [+ 추가]    [↺ 되돌리기 (2)]    [저장 (2)]    [✕ 닫기]            │
└─────────────────────────────────────────────────────────────────┘
```

- 위 줄: 폴더 breadcrumb (mono, `font-mono text-[12px]`) — `<Breadcrumb>` 재사용.
- 우측 끝: principals 수 (`text-fg-muted`) + "▴2 변경" (변경분 0이면 숨김, ≥1이면 amber).
- 액션 버튼: 좌→우 `+ 추가` / `↺ 되돌리기` / `저장` / `✕ 닫기`.
  - `저장` 버튼은 변경분=0이면 disabled. ≥1이면 primary brand. 라벨에 `(2)` 같은 카운트 inline.
  - `되돌리기`도 변경분=0이면 disabled. 클릭 시 ConfirmDialog (`변경사항 2건이 모두 사라집니다. 계속할까요?`).
  - `✕ 닫기`는 좌측 트리 선택 해제 (URL `?folderId=` 제거). 변경분 ≥1이면 unsaved-changes 가드 트리거.

### A.4 매트릭스 본문 (9 컬럼)

```
┌──────────────────────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
│ Principal            │VIEW│EDIT│ V  │ E  │ D  │APR │DL  │PR  │  ⋮ │
│                      │FLD │FLD │OBJ │OBJ │OBJ │   │    │    │    │
├──────────────────────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
│ 👤 박영호 (USER)      │ ☑  │ ☐  │ ☑  │ ☑  │ ☐  │ ☐  │ ☑  │ ☐  │ 🗑  │
│ 🏢 냉연 1팀 (ORG)     │ ☑  │ ☐  │ ☑  │ ☐  │ ☐  │ ☐  │ ☑  │ ☐  │ 🗑  │
│ 👥 drawing-editors   │ ☑  │ ☑  │ ☑  │ ☑  │ ☐  │ ☐  │ ☑  │ ☑  │ 🗑  │
│ 👤 김지원 (USER) 신규 │ ☐  │ ☐  │ ☑  │ ☐  │ ☐  │ ☐  │ ☑  │ ☐  │ 🗑  │
│ 👥 ext-홍성 (삭제됨)   │ ─  │ ─  │ ─  │ ─  │ ─  │ ─  │ ─  │ ─  │ 🧹  │
└──────────────────────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘
```

#### A.4.1 컬럼 사양

| # | Header (short) | Tooltip (full) | Bit field | Width |
|---|---|---|---|---|
| 1 | Principal | — | (label) | flex (min 240) |
| 2 | VIEW FLD | 폴더 보기 (트리에 노출) | `viewFolder` | 56 |
| 3 | EDIT FLD | 폴더 수정 (이름·코드·이동) | `editFolder` | 56 |
| 4 | V OBJ | 자료 보기 | `viewObject` | 56 |
| 5 | E OBJ | 자료 편집 (체크아웃·체크인·개정) | `editObject` | 56 |
| 6 | D OBJ | 자료 삭제 (폐기/복원) | `deleteObject` | 56 |
| 7 | APR | 결재 (승인/반려) | `approveObject` | 56 |
| 8 | DL | 다운로드 (원본/변환본) | `download` | 56 |
| 9 | PR | 인쇄 (워터마크 포함) | `print` | 56 |
| ⋮ | (Action) | — | (행 메뉴) | 40 |

- **Sticky thead** (`top: header-bottom`): 매트릭스가 길어져도 헤더 고정.
- 짧은 라벨은 `text-[11px] font-medium uppercase tracking-wide` (DESIGN.md `app-kicker` 토큰 재사용 가능). 전체 라벨은 `<Tooltip>`으로 200ms hover 후 노출. `<th>` 자체에 `aria-label="폴더 보기 권한"` 같은 풀 라벨을 두어 스크린리더에 정확히 전달.
- 컬럼 헤더 클릭 = **bulk column toggle** (§A.4.4 참조).

#### A.4.2 Principal 셀 시각

```
👤 박영호 (kim.young-ho)            [USER]
🏢 냉연 1팀                          [ORG]
👥 drawing-editors                   [GROUP]
```

- 좌측 16px 아이콘 (`Users` / `Building2` / `UsersRound`).
- 메인 라벨: 
  - USER → `fullName (username)` (fullName이 본문, username은 `text-fg-muted text-xs ml-1`).
  - ORG → `name`.
  - GROUP → `name`.
- 우측 `<Badge variant="outline" className="text-[10px]">` 로 principalType 표기 (USER/ORG/GROUP).
- 행 hover 시 `bg-bg-subtle`. 행 dragger는 없음.

#### A.4.3 행 상태 (4가지)

| 상태 | 좌측 border | 배경 | trailing 라벨 | trailing action |
|---|---|---|---|---|
| `normal` | 없음 | white/dark default | — | `🗑 삭제` (DropdownMenu) |
| `dirty` (값 수정) | `border-l-2 border-amber-400` | `bg-amber-50/60` (다크: `bg-amber-950/30`) | `▴ 수정됨` (text-amber-700) | `🗑 삭제`, `↺ 되돌리기 (행)` |
| `new` (방금 추가) | `border-l-2 border-amber-400` | `bg-amber-50/60` | `▴ 신규` (text-amber-700) | `🗑 삭제` (= 추가 취소) |
| `removed` | `border-l-2 border-rose-400` | `bg-rose-50/40` (다크: `bg-rose-950/20`) + 셀 내용 strikethrough/회색 | `─ 삭제됨` (text-rose-700) | `🧹 정리` (= undo 삭제) |

`removed` 행은 체크박스 모두 disabled + 회색. 클릭 불가. 단 `🧹 정리`로 복원하면 직전 상태(normal/dirty)로 돌아간다.

#### A.4.4 컬럼 헤더 클릭 = Bulk Column Toggle

`<th>` 클릭 시 해당 컬럼 전체에 대해 다음 규칙으로 일괄 토글:

```
columnState =
  - all-on    → 모두 off
  - all-off   → 모두 on
  - mixed     → 모두 on (한 번 더 누르면 모두 off)
```

- 시각: column header에 hover 시 `cursor-pointer` + 툴팁 `"이 열 일괄 토글 (mixed → on, uniform → invert)"`.
- 정확한 동작: 현재 매트릭스 모든 row(단 `removed` 제외)에 대해 그 비트를 위 규칙으로 변경 → 행 상태 재계산(원본 대비 달라졌으면 `dirty`).
- 키보드: `<th>`에 `tabIndex=0`, `Space`/`Enter`로 동일 동작. `aria-pressed` 동적 갱신 (all-on이면 true).

#### A.4.5 셀 (체크박스) 인터랙션

- 표준 `<Checkbox>` (shadcn) 28×28 클릭 영역, 16×16 시각.
- 클릭 → optimistic 상태 변경 → 행 상태 재계산.
- 키보드: `Space` 토글, `Tab`/`Shift+Tab` 셀 이동 (브라우저 자연 순서). 고급 그리드 네비(`Arrow*`로 cell 단위 이동)는 v1 범위 외 — [PM-DECISION-9] 추가 요구 시 후속 라운드.
- focus ring: `focus-visible:ring-2 focus-visible:ring-ring`.

### A.5 PrincipalPicker Dialog (`+ 추가` 클릭 시)

#### A.5.1 레이아웃

```
┌─ 권한 추가 ─────────────────────────────────────[✕]┐
│  [USER] [ORG] [GROUP]   ← Tabs                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │ 🔎  검색 (이름/사번/조직코드/그룹코드)…          │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─ 결과 (8) ───────────────────────────────────┐    │
│  │ 👤 김지원  (kim.jiwon)    냉연 1팀     [+ 추가]│    │
│  │ 👤 박영호  (park.yh)      냉연 1팀     이미 추가│    │
│  │ 👤 최정아  (choi.ja)      계장팀       [+ 추가]│    │
│  │ ...                                              │    │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ※ 추가된 principal은 모든 권한 비트가 OFF 상태입니다.│
│    매트릭스에서 직접 체크하세요.                      │
│                                                       │
│  [닫기]                          [완료 (3건 추가됨)]  │
└──────────────────────────────────────────────────────┘
```

- Dialog 폭 560px, height auto (max 80vh). shadcn `<Dialog>` 재사용.
- Tabs (`<Tabs>` shadcn): `USER` / `ORG` / `GROUP`. 탭 전환 시 검색어 유지, 결과만 새로고침.
- Search input: 300ms debounce (`useDebouncedValue`). placeholder 탭별 다름:
  - USER: "이름 또는 사번 (예: 박영호, kim.young-ho)"
  - ORG: "조직명 또는 코드 (예: 냉연 1팀, DKC-PROD-CGL)"
  - GROUP: "그룹명 또는 코드 (예: drawing-editors)"
- 결과 리스트: 가상 스크롤은 v1에 불필요 (탭별 30~50건 권장 limit). hover 시 `bg-bg-subtle`. 우측 `+ 추가` 버튼.
- **이미 매트릭스에 있는 principal**은 `[+ 추가]` 자리에 회색 텍스트 `이미 추가됨` + 행 자체 `opacity-60`, 클릭 불가.
- **연속 추가**: 한 명 추가해도 다이얼로그 닫히지 않음. 추가된 principal은 즉시 `이미 추가됨`으로 변함. 새로 추가된 행은 새 매트릭스에 `new` 상태로 합류 (배경에서 매트릭스 재렌더 — but 행 추가가 dialog 닫힘 트리거는 아님).
- 푸터: 좌측 `닫기`, 우측 `완료 (N건 추가됨)`. `완료`는 단순 `닫기`와 동일 동작 (UI에 명시적 종료를 주기 위해 둠).
- `Esc` = 닫기. 추가된 항목은 매트릭스에 이미 반영되었으므로 닫기로 잃지 않음.

#### A.5.2 데이터 소스

| 탭 | 엔드포인트 | 주의 |
|---|---|---|
| USER | `GET /api/v1/users/search?q=&limit=30` | 기존 사용. 단 limit 30. response: `{ items: { id, username, fullName, organization }[] }` |
| ORG | `GET /api/v1/admin/organizations` | 기존 사용. **검색은 클라이언트 필터** (조직 수가 적음). |
| GROUP | `GET /api/v1/admin/groups` | 기존 사용. **검색은 클라이언트 필터**. |

[PM-DECISION-3] organization/group이 100개 초과 가능하면 BE 추가 필요. 현재 가정: ≤ 50개 → 클라이언트 필터로 충분.

#### A.5.3 다중 선택 옵션 — 보류 ([PM-DECISION-8])

체크박스로 여러 명을 한 번에 추가하는 모드는 v1에서 **하지 않는다** — 한 번에 한 건씩 명시적으로 누르는 편이 실수 적다. 단 PM이 "외주사 입사 시 5명 일괄 추가" 시나리오를 우선시한다면 후속 라운드에 추가.

### A.6 저장 흐름 (Full-Replace PUT)

#### A.6.1 흐름

```
사용자 [저장] 클릭
  → 변경 카운터 검증 (>0)
  → ConfirmDialog 생략 (footer 카운터로 충분히 명시적)
  → mutation: PUT /api/v1/admin/folders/{folderId}/permissions
     body: { permissions: PermissionRow[] }
     // 서버는 해당 folderId의 기존 FolderPermission row를 모두 삭제하고
     // body의 행으로 교체 (full-replace; 부분 업데이트가 아님).
  → 200 → toast "저장되었습니다 (12명)" emerald
       → 변경 카운터 0으로 리셋
       → 매트릭스 재로드 (서버가 정규화한 결과로)
  → 4xx
       → 400 E_VALIDATION → 인라인 에러 (어느 행/필드가 잘못됐는지)
       → 403 E_FORBIDDEN → toast rose persist + "권한 부족"
       → 404 E_NOT_FOUND → toast rose + "폴더가 삭제되었습니다. 트리를 새로고침하세요."
       → 409 E_CONFLICT → toast amber + "다른 사용자가 같은 폴더를 수정했습니다.
                          [최신으로 새로고침]" → 클릭 시 매트릭스 reload, 변경분 폐기
                          (현재 변경분을 보존하고 머지하는 UI는 v1 범위 외)
  → 5xx → toast rose persist + "서버 오류 (요청 ID: xxx) [재시도]"
```

#### A.6.2 Full-Replace 선택 이유

부분 업데이트(POST/PATCH/DELETE 행별)도 가능하나 (a) UI는 어차피 행 단위가 아니라 "이 폴더의 권한 전체"라는 정신모델, (b) 스토어가 9bit × N row 작은 페이로드, (c) row 추가/삭제/수정이 한 번에 일어나는 경우가 대부분 — full-replace가 직관적. BE도 단일 transaction으로 깔끔. **단 race-condition을 위해 If-Match 또는 updatedAt 동등성 체크가 필요**: contract에 `meta.lastModifiedAt` 또는 `If-Match: etag` 둘 중 하나 추가 요청 ([PM-DECISION-10]).

### A.7 Unsaved-Changes 가드 (3 layer)

#### Layer 1: footer alert (선언적)

매트릭스 헤더에 `▴2 변경` 카운터 + footer 라인 (sticky bottom, `bg-amber-50 border-amber-200 text-amber-900 text-xs px-4 py-2`):

```
▴ 변경사항 2건이 저장되지 않았습니다.   [저장]   [되돌리기]
```

#### Layer 2: intra-page navigation guard

좌측 트리에서 다른 폴더를 클릭했을 때:

```
다이얼로그: "변경사항이 저장되지 않았습니다.

[저장 후 이동]  [버리고 이동]  [취소]"
```

`<ConfirmDialog>` 패턴 재사용. default focus = `취소`.

#### Layer 3: beforeunload

브라우저 닫기/뒤로가기:

```js
useEffect(() => {
  if (dirtyCount === 0) return;
  const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}, [dirtyCount]);
```

Next.js `router.push` intra-app 이동도 동일 가드 필요 — `usePathname` 변화 감지 후 navigate 시점에 confirm. (Next 14의 `useRouter`는 `events.routeChangeStart` API가 없으므로 link 클릭에 onClick 가드 + `router.push` wrapper 사용.)

### A.8 컴포넌트 트리

```
<FolderPermissionsPage>          // RSC 또는 client wrapper
  <AdminSidebar />
  <FolderTreePane>               // client
    <FolderTree
      nodes={...}
      selectedId={folderId}
      onSelect={handleSelectFolder}  // unsaved guard 포함
    />
  </FolderTreePane>
  <PermissionMatrixPane>         // client
    {!folderId
      ? <EmptyState ... />
      : <PermissionMatrix
          folder={folder}
          initialPermissions={data}
          onSave={mutate}
        />
    }
  </PermissionMatrixPane>
</FolderPermissionsPage>
```

#### A.8.1 `<PermissionMatrix>` props

```ts
interface PermissionRow {
  // form-state row, NOT directly the wire shape
  id: string;                                           // local id (uuid for new rows)
  principalType: 'USER' | 'ORG' | 'GROUP';
  principalId: string;
  principalLabel: string;                                // "박영호 (kim.young-ho)" 등 표시용
  principalSubLabel?: string;                            // 조직명 등
  bits: {
    viewFolder: boolean;
    editFolder: boolean;
    viewObject: boolean;
    editObject: boolean;
    deleteObject: boolean;
    approveObject: boolean;
    download: boolean;
    print: boolean;
  };
  state: 'normal' | 'dirty' | 'new' | 'removed';
  /** snapshot of bits at load time (or null for `new` rows) — used to derive `dirty` and undo */
  origin: PermissionRow['bits'] | null;
}

interface PermissionMatrixProps {
  folder: { id: string; name: string; pathLabel: string };
  initialPermissions: PermissionRow[];                   // server load
  onSave: (rows: PermissionRow[]) => Promise<void>;      // full-replace; only non-`removed` rows submitted
  onClose: () => void;                                   // ✕ 닫기
  readOnly?: boolean;                                    // <1280 viewport fallback
}
```

#### A.8.2 `<PermissionMatrixHeader>` props

```ts
interface PermissionMatrixHeaderProps {
  folder: { name: string; pathLabel: string };
  principalCount: number;
  dirtyCount: number;
  saving: boolean;
  onAdd: () => void;
  onRevert: () => void;
  onSave: () => void;
  onClose: () => void;
}
```

#### A.8.3 `<PrincipalPicker>` props

```ts
type PrincipalKind = 'USER' | 'ORG' | 'GROUP';

interface PrincipalPickerCandidate {
  type: PrincipalKind;
  id: string;
  label: string;
  subLabel?: string;
}

interface PrincipalPickerProps {
  open: boolean;
  excludePrincipalIds: ReadonlySet<string>; // already in matrix → "이미 추가됨"
  defaultBits?: Partial<PermissionRow['bits']>;
  onAdd: (candidate: PrincipalPickerCandidate) => void;
  onClose: () => void;
}
```

[PM-DECISION-1] **신규 추가 시 default bits**: 보수적 default = **모든 비트 OFF**. admin이 의도적으로 켜야 한다는 명시성. 다만 `viewFolder + viewObject` 두 개는 켜둬야 매트릭스에 들어온 의미가 있다는 의견도 있음 — PM이 결정. 본 spec은 "모두 OFF" 가정.

### A.9 Query / Mutation 상태 (TanStack Query v5)

| 상태 | 컴포넌트 처리 |
|---|---|
| `tree.isPending` | `<FolderTree>` 자리에 `<Skeleton>` 5행 |
| `tree.isError` | `<EmptyState>` rose icon + "폴더 트리를 불러오지 못했습니다 [재시도]" |
| `permissions.isPending` (folder 선택 직후) | 매트릭스 자리에 skeleton 8행 × 9컬럼 |
| `permissions.isError 403` | "이 폴더의 권한을 볼 권한이 없습니다" (드물지만 ADMIN ≠ SUPER_ADMIN 에지) |
| `permissions.isError 404` | "폴더를 찾을 수 없습니다 (삭제됨)" + 트리 새로고침 CTA |
| `permissions.isError 5xx` | "서버 오류 [재시도]" |
| `permissions.isFetching` (refetch) | 헤더 우측 `<Loader2 className="animate-spin" />` 작게 표시. 본문은 그대로. |
| `mutation.isPending` (저장 중) | `저장` 버튼 → `<Loader2/> 저장 중…` + disabled. 매트릭스 전체 `pointer-events-none opacity-80`. |
| `mutation.isSuccess` | toast emerald + 카운터 0 + refetch |
| `mutation.isError 409` | toast amber + reload CTA |
| `mutation.isError 5xx` | toast rose persist + retry |
| empty (folder selected, 0 permissions) | EmptyState `<ShieldOff>` + "이 폴더에는 명시된 권한이 없습니다. SUPER_ADMIN만 접근 가능합니다." + `[+ 첫 권한 추가]` |

### A.10 접근성 (WCAG 2.1 AA)

- Matrix는 의미적 `<table>`로 구현 (NOT div grid). `<th scope="col">` 9개 + `<th scope="row">`는 principal 셀 (`<th>`로 표기).
- 컬럼 헤더에 `aria-sort` 불필요 (정렬 없음). `aria-pressed` (bulk toggle)만.
- 체크박스 `<input type="checkbox" aria-label="박영호의 자료 보기 권한">` 풀 라벨. shadcn `<Checkbox>` + `<Label>` 페어로 구현 가능.
- 행 상태(`new`/`dirty`/`removed`)는 색뿐 아니라 텍스트 라벨(`▴ 신규`/`▴ 수정됨`/`─ 삭제됨`)로도 표시 (색맹 대응).
- Bulk column toggle은 `<th>`에 `role="button" tabIndex={0}` + `aria-pressed`.
- Dialog는 shadcn 기본값으로 focus trap + restore 보장.
- Dirty footer는 `aria-live="polite"`.
- 명도 대비: amber-50 배경 + amber-700 텍스트 = 4.5:1 이상 (Tailwind 표준 통과). rose-50 + rose-700 동일.

---

## B. /admin/conversions — 변환 작업 모니터

### B.1 라우트 및 진입점

- **Route:** `/admin/conversions`
- **AdminSidebar 진입:** `통합 / 로그` 그룹 제일 위에 추가:
  ```ts
  {
    href: '/admin/conversions',
    label: '변환 작업',
    description: 'DWG/DXF 변환 큐 모니터링 및 재시도',
    icon: RefreshCw, // lucide-react
  }
  ```
  (기존 `API Key`, `감사 로그`보다 위.)
- **권한:** SUPER_ADMIN/ADMIN.

### B.2 단일 컬럼 레이아웃

```
┌─ Header (글로벌, 56px) ───────────────────────────────────────────┐
│NavRail│ AdminSidebar  │ Conversions Main (fluid)                    │
│ 56px  │   240px        │                                              │
│       │               │ [breadcrumb] 관리자 / 변환 작업              │
│       │ ▼ 통합/로그   │ ┌────────────────────────────────────┐       │
│       │ • 변환 작업←active │ │ 변환 작업                              │       │
│       │ • API Key     │ │ DWG → PDF/DXF/SVG 변환 큐 모니터링    │       │
│       │ • 감사 로그    │ └────────────────────────────────────┘       │
│       │               │                                              │
│       │               │ ┌─ Stats (4 cards) ────────────────┐         │
│       │               │ │ PENDING 12 │ PROC 3 │ DONE 145 │ FAIL 7 │   │
│       │               │ └──────────────────────────────────┘         │
│       │               │                                              │
│       │               │ ┌─ Filters ─────────────────────────┐        │
│       │               │ │ 상태:[전체▼] 첨부:[..] 5초자동↻ ☑ │        │
│       │               │ └──────────────────────────────────┘        │
│       │               │                                              │
│       │               │ ┌─ Table (9 cols, scrollable) ─────┐        │
│       │               │ │ ...                              │        │
│       │               │ └──────────────────────────────────┘        │
└───────┴───────────────┴──────────────────────────────────────────────┘
```

### B.3 Stats Cards (4개)

```
┌─ PENDING ─────┐ ┌─ PROCESSING ─┐ ┌─ DONE ───────┐ ┌─ FAILED ─────┐
│ │ 12          │ │ │ 3 ●pulse   │ │ │ 145         │ │ │ 7           │
│ │ 대기 중     │ │ │ 처리 중     │ │ │ 완료        │ │ │ 실패        │
└──slate left──┘ └──sky left────┘ └──emerald lft─┘ └──rose left──┘
```

- 4 cards in `grid grid-cols-4 gap-3`.
- 각 카드: `<button>` (전체 클릭 가능) — 클릭 시 `?status=PENDING|PROCESSING|DONE|FAILED` 필터 적용 (URL sync).
- 좌측 4px 색상 border (`border-l-4 border-slate-400|sky-400|emerald-400|rose-500`).
- 활성 필터 카드는 `ring-2 ring-brand-500/40 bg-bg-subtle`.
- 숫자: `text-2xl font-semibold tabular-nums`. 라벨: `text-xs text-fg-muted`.
- PROCESSING ≥1이면 빨강 점이 아닌 sky 점이 `animate-pulse`.
- 데이터 소스: `/api/v1/admin/conversions/stats` (BE에 신설 필요). response: `{ pending: number; processing: number; done: number; failed: number }`. 5초 폴링 (테이블과 같은 간격).

### B.4 Filter Bar

```
┌────────────────────────────────────────────────────────────────────┐
│ 상태: [전체 ▼] 첨부 ID: [_______]  ✕필터초기화  ☑ 5초 자동 새로고침 │
└────────────────────────────────────────────────────────────────────┘
```

- 상태 select: `전체 | PENDING | PROCESSING | DONE | FAILED`. `?status=` URL sync.
- 첨부 ID input: 부분 일치. `?attachmentId=` URL sync. 디바운스 400ms.
- `✕ 필터 초기화`: ?쿼리 모두 제거, stats 카드 active 해제.
- `☑ 5초 자동 새로고침`: 디폴트 ON (PROCESSING > 0일 때만 실제 폴링; 이외엔 ON 표시는 유지하되 idle). 사용자가 OFF하면 `localStorage.setItem('conversions.autoRefresh', '0')`.
- (Phase 2 후보) 일자 범위, errorMessage 검색.

[PM-DECISION-4] **자동 새로고침 default**: ON 추천 (관리자가 "지금 큐 어떻게 흐르나" 모니터링이 주 use case). PM 확정 필요.

### B.5 Conversion Table (9 컬럼)

```
┌─────┬─────────────┬──────────────────┬────────────┬──────────┬────┬─────────────────┬───────────┬─────┐
│Stat │ 첨부 ID    │ 도면번호 / 자료명 │ 시도        │ 시작     │ 소요│ 에러 메시지       │ 생성일    │ ⋮  │
├─────┼─────────────┼──────────────────┼────────────┼──────────┼────┼─────────────────┼───────────┼─────┤
│●FAIL│ att_5G9q… ↗│ CGL-MEC-2026-…   │ 3/3        │ 10:23:14 │ 12s│ libdwg core dum…│ 4/27 10:21│ 🔄  │
│●PROC│ att_2Pmf…  │ CGL-ELE-2026-…   │ 1/3        │ 10:24:01 │ 32s│ —              │ 4/27 10:23│     │
│●DONE│ att_4Hwx…  │ BFM-PRC-2026-…   │ 1/3        │ 10:18:30 │ 18s│ —              │ 4/27 10:18│     │
│●PEND│ att_0aaa…  │ —                │ 0/3        │ —        │ —  │ —              │ 4/27 10:24│     │
└─────┴─────────────┴──────────────────┴────────────┴──────────┴────┴─────────────────┴───────────┴─────┘
```

| # | Header | Width | Notes |
|---|---|---|---|
| 1 | 상태 | 80 | `<ConversionStatusBadge>` |
| 2 | 첨부 ID | 140 | mono `text-[11px]`, truncate, `↗` icon: 새 탭 `/api/v1/attachments/{id}/meta`로 이동 (admin 전용 빠른 inspect) |
| 3 | 도면번호 / 자료명 | flex | 자료번호 (mono) 1줄 + 자료명 (truncate) 1줄. 클릭 = `/objects/{objectId}` ([PM-DECISION-3]) |
| 4 | 시도 | 70 | `attempt / 3` (max attempts; BE config 기준 3 가정) |
| 5 | 시작 | 90 | `HH:mm:ss` (오늘만), 어제 이전은 `M/D HH:mm` |
| 6 | 소요 | 60 | `(finishedAt - startedAt)` mono `12s`, `1m32s` |
| 7 | 에러 메시지 | flex (min 200) | 1줄 truncate; 클릭 시 행 expand하여 mono pre-wrap 노출 |
| 8 | 생성일 | 110 | `M/D HH:mm` |
| 9 | (Action) | 40 | `<DropdownMenu>` |

#### B.5.1 행 시각 변형

| 상태 | 좌측 border | 배경 | 추가 효과 |
|---|---|---|---|
| `PENDING` | `border-l-2 border-slate-300` | (없음) | — |
| `PROCESSING` | `border-l-2 border-sky-400` | `bg-sky-50/40` | 좌측 dot `animate-pulse`, 시도/시작/소요 셀 `<Loader2 spin>` 미세 |
| `DONE` | `border-l-2 border-emerald-400` | (없음) | dot emerald solid |
| `FAILED` | `border-l-2 border-rose-400` | `bg-rose-50/40` (다크 `bg-rose-950/20`) | 에러 메시지 셀 `text-rose-700` |

#### B.5.2 Error Cell Expand

- 한 번에 **하나의 행만** expand (다른 행 클릭 시 직전 expand는 자동 close).
- expand된 영역:
  ```
  ┌─────────────────────────────────────────────────┐
  │ 에러 메시지 (전체)                       [📋 복사]│
  │ ─────────────────────────────────────────────── │
  │ libdwg: core dumped at parse() — input header   │
  │ malformed at offset 0x4f3                        │
  │   Stack trace:                                   │
  │     ...                                          │
  └─────────────────────────────────────────────────┘
  ```
- `<pre className="text-[12px] font-mono whitespace-pre-wrap text-rose-800 bg-rose-50/60 p-3 rounded-md">`
- `[📋 복사]` 클릭 → `navigator.clipboard.writeText(errorMessage)` → toast emerald `"클립보드에 복사됨"`.
- expand는 같은 셀 클릭으로 토글, 또는 행 어디든 클릭. 단 `자료명` 셀 클릭은 페이지 이동(우선).

#### B.5.3 행 액션 (`⋮ DropdownMenu`)

- `🔄 재시도` (FAILED 행만): 클릭 → `<ConfirmDialog>`:
  ```
  "이 변환을 재시도합니다.

  첨부 ID: att_5G9q...
  도면: CGL-MEC-2026-00012
  마지막 에러: libdwg: core dumped...

  [취소]    [재시도]"
  ```
  primary = 재시도 (brand). default focus = 취소.
  → `POST /api/v1/admin/conversions/{id}/retry` (BE 신설)
   - 200 → toast emerald "재시도 큐에 추가되었습니다"
   - 409 (이미 처리 중) → toast amber "이미 처리 중인 작업입니다"
   - 404 → toast rose "작업이 삭제되었습니다 [새로고침]"
- `🔍 첨부 보기` (모든 상태): 새 탭 `/api/v1/attachments/{id}/meta` 또는 (PM-DECISION-3 결과에 따라) `/objects/{objectId}?tab=info&attachmentId={id}`.
- (Phase 2) `🚫 작업 취소` (PENDING/PROCESSING).

### B.6 Pagination

- **Cursor 기반 무한 스크롤** (admin/users와 동일 패턴): `?cursor=` + `?limit=50`.
- 하단에 `[더 보기]` 버튼 + IntersectionObserver auto-load 둘 다.
- 5초 폴링은 첫 페이지만 갱신 (load-more 페이지는 stale OK). 필터 변경 시 cursor 초기화.

### B.7 폴링 정책

```
- on mount → 즉시 fetch
- if any row has status = PROCESSING || PENDING && autoRefresh ON
    → setInterval(refetch, 5000)
- Visibility API: tab hidden → pause polling
- on unmount → clear interval
```

5초가 너무 빠를 수 있어 `autoRefresh` toggle 외에 향후 10s/30s 옵션 추가 여지. v1은 5s 고정.

### B.8 컴포넌트 트리

```
<ConversionsPage>                         // RSC frame
  <AdminSidebar />
  <ConversionsMain>                       // client (queries)
    <ConversionsHeader />                 // breadcrumb + title
    <ConversionStatsCards
      stats={statsQuery.data}
      activeStatus={status}
      onSelectStatus={(s) => setStatusFilter(s)}
    />
    <ConversionsFilterBar
      status={status}
      attachmentId={attachmentId}
      autoRefresh={autoRefresh}
      onChangeStatus={...}
      onChangeAttachmentId={...}
      onToggleAutoRefresh={...}
      onReset={...}
    />
    <ConversionsTable
      rows={rows}
      expandedRowId={expandedRowId}
      onToggleExpand={...}
      onRetry={...}
      onOpenAttachment={...}
    />
  </ConversionsMain>
</ConversionsPage>
```

### B.9 `<ConversionStatusBadge>` props

```ts
interface ConversionStatusBadgeProps {
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';
  /** show animated spinner inside the badge — default true for PROCESSING */
  showSpinner?: boolean;
  size?: 'sm' | 'md';            // default 'md'
  className?: string;
}
```

시각:

| status | dot | bg | fg | label |
|---|---|---|---|---|
| PENDING | slate-400 | slate-100 / dark slate-900/40 | slate-700 / slate-300 | `대기` |
| PROCESSING | sky-500 (`animate-pulse`) + optional `<Loader2 spin>` | sky-50 / sky-950/30 | sky-700 / sky-300 | `처리 중` |
| DONE | emerald-500 | emerald-50 / emerald-950/30 | emerald-700 / emerald-300 | `완료` |
| FAILED | rose-500 | rose-50 / rose-950/30 | rose-700 / rose-300 | `실패` |

- 모양: pill (`rounded-full px-2 py-0.5 text-[12px] font-medium`), 좌측 6px dot. `inline-flex items-center gap-1.5`.
- DESIGN.md `StatusBadge` 패턴(자료 상태)과 시각적으로 구분되도록 dot 8px(자료 상태) vs 6px(변환) 차이 — 또는 같은 컴포넌트 family로 묶기 ([PM-DECISION-5]). 본 spec은 별도 `ConversionStatusBadge` 권장 (의미 도메인이 다름).

### B.10 Query / Mutation 상태

| 상태 | 처리 |
|---|---|
| `stats.isPending` | 4 카드 자리에 skeleton (각각 96px 높이) |
| `stats.isError` | 카드 자리에 EmptyState `[새로고침]` |
| `list.isPending` | 테이블 자리 skeleton 8행 |
| `list.isPlaceholderData` (v5: `keepPreviousData` 옵션 deprecated; `placeholderData: keepPreviousData` 사용) | 테이블 그대로 + 헤더에 `<Loader2 spin>` 작게 |
| `list.isError 403` | EmptyState "변환 작업 조회 권한이 없습니다" |
| `list.isError 5xx` | EmptyState rose `[재시도]` |
| `list.data.length === 0` | 필터 적용 상태에 따라 분기: 필터 있음 = "조건에 맞는 작업이 없습니다 [필터 초기화]"; 없음 = "변환 작업이 없습니다" |
| `retry.isPending` | 행 액션 메뉴 비활성 + 행 좌측에 spinner |
| `retry.isSuccess` | toast emerald + 5초 내 폴링이 새 PROCESSING 행 반영 |

### B.11 접근성

- Stats card는 `<button>` (접근성 자연 보장). active 상태 `aria-pressed="true"`.
- 테이블 의미적 마크업. expand는 `<tr><td colSpan="9">`. 트리거 셀에 `aria-expanded` + `aria-controls`.
- 폴링 자동 새로고침 toggle은 `<input type="checkbox">` + `<label>`.
- 5초 폴링 중에도 사용자 포커스/스크롤이 파괴되지 않도록 stable row keys (`row.id`).
- ConversionStatusBadge는 색 + 텍스트 둘 다 (색맹 대응).

---

## C. 신규 컴포넌트 3개 — 상세

### C.1 `<PermissionMatrix>`

- **위치:** `apps/web/components/admin/permissions/PermissionMatrix.tsx`
- **책임:** 폴더 1개의 권한 행 N개를 편집. dirty/new/removed 상태 추적, full-replace로 외부에 위임.
- **state hook 권장:** `useReducer` (action: `TOGGLE_BIT | ADD_ROW | REMOVE_ROW | RESTORE_ROW | REVERT_ROW | TOGGLE_COLUMN | RESET_TO_INITIAL | LOAD_FROM_SERVER`).
- **dirty 계산:** 각 행마다 `origin` snapshot과 현재 `bits` 비교 → 한 비트라도 다르면 dirty. `removed`는 항상 dirty로 카운트, `new`도 항상 dirty로 카운트.

### C.2 `<PrincipalPicker>`

- **위치:** `apps/web/components/admin/permissions/PrincipalPicker.tsx`
- **책임:** 3 종류 principal 검색 + 추가. 매트릭스 외부 컴포넌트라 `excludePrincipalIds` props로 중복 방지.
- **자체 query**: 탭별 `useQuery({ queryKey: ['principal-search', tab, debouncedQ], staleTime: 30_000 })`. ORG/GROUP은 항상 전체 fetch + client filter.
- **principalId composite key**: 탭별 id 충돌 방지 위해 매트릭스에서는 `${type}:${id}` 같은 합성키로 dedupe. excludeSet도 합성키.

### C.3 `<ConversionStatusBadge>`

- **위치:** `apps/web/components/admin/conversions/ConversionStatusBadge.tsx`
- **책임:** §B.9 시각 사양 그대로.
- **재사용 가능성:** 자료 상세에서 첨부 아이콘 옆에 작게 표시 가능. v1은 `/admin/conversions`에서만 사용.

---

## D. 인터랙션 시퀀스 (텍스트 다이어그램)

### D.1 Permission Matrix — Folder 선택부터 첫 렌더까지

```
사용자 클릭 [기계/CGL-2/메인라인]
   │
   ▼
trees[0].onSelect 콜백 호출
   │
   ├─ unsaved guard? (dirtyCount > 0)
   │     ├─ Y → ConfirmDialog 표시
   │     │     ├─ [저장 후 이동] → mutation → 성공 시 navigate
   │     │     ├─ [버리고 이동]  → reducer dispatch RESET → navigate
   │     │     └─ [취소]        → return (선택 무시)
   │     └─ N → navigate immediately
   │
   ▼
URL: /admin/folder-permissions?folderId=fld_xxx
   │
   ▼
useQuery(['admin', 'folder-permissions', folderId])
   GET /api/v1/admin/folders/{folderId}/permissions
   │
   ▼
응답 → reducer dispatch LOAD_FROM_SERVER → matrix 렌더
   │
   ▼
  [+ 추가] / 비트 토글 / 행 삭제 → reducer dispatch
   │
   ▼
  dirtyCount 변화 → footer alert 갱신
```

### D.2 Permission Matrix — `+ 추가` 클릭부터 행 추가까지

```
[+ 추가] 클릭 → setPickerOpen(true)
   │
   ▼
<PrincipalPicker open=true>
   │
사용자가 USER 탭 → "김지원" 입력 (debounce 300ms)
   │
   ▼
useQuery(['principal-search', 'USER', '김지원'])
   GET /api/v1/users/search?q=김지원&limit=30
   │
   ▼
결과 리스트 렌더 (이미 매트릭스에 있는 행은 disabled)
   │
사용자가 [+ 추가] 클릭 (개별 행)
   │
   ▼
onAdd(candidate) → reducer dispatch ADD_ROW
   │   payload: {
   │     id: uuid(),
   │     principalType, principalId, principalLabel,
   │     bits: ALL_OFF,                  // [PM-DECISION-1]
   │     state: 'new',
   │     origin: null,
   │   }
   │
   ▼
matrix 재렌더 → 새 행 amber 배경 + ▴신규
   │   (Picker는 닫히지 않음 — 연속 추가)
   │
   ▼
사용자가 [닫기] 또는 [완료] → setPickerOpen(false)
```

### D.3 Permission Matrix — 저장 흐름

```
[저장 (3)] 클릭
   │
   ▼
onSave(rows.filter(r => r.state !== 'removed'))
   │
   ▼
mutation.mutate({ folderId, permissions: rows })
   PUT /api/v1/admin/folders/{folderId}/permissions
   body: {
     ifMatch?: lastModifiedAt,           // [PM-DECISION-10]
     permissions: [
       { principalType, principalId,
         viewFolder, editFolder, viewObject, editObject,
         deleteObject, approveObject, download, print },
       ...
     ]
   }
   │
   ├─ 200 → onSuccess
   │     ├─ toast emerald "저장되었습니다 (12명)"
   │     ├─ invalidate ['admin', 'folder-permissions', folderId]
   │     ├─ refetch → reducer LOAD_FROM_SERVER
   │     └─ dirtyCount = 0
   │
   ├─ 400 → 인라인 errors[].path 매핑하여 행에 빨간 외곽선
   ├─ 403 → toast rose "권한 부족"
   ├─ 404 → toast rose + invalidate folder tree
   ├─ 409 → toast amber "다른 사용자가 수정 [최신으로]"
   │         CTA → reducer LOAD_FROM_SERVER (변경분 폐기 — v1)
   └─ 5xx → toast rose persist + retry
```

### D.4 Conversions — 폴링 + 재시도

```
mount
   │
   ├─ statsQuery 첫 fetch
   ├─ listQuery 첫 fetch
   │
   ▼
useEffect(() => {
  if (!autoRefresh) return;
  if (anyProcessing || anyPending) {
    const id = setInterval(() => {
      statsQuery.refetch();
      listQuery.refetch();
    }, 5000);
    return () => clearInterval(id);
  }
}, [autoRefresh, anyProcessing, anyPending]);
   │
사용자가 [⋮] → [🔄 재시도] (FAILED 행)
   │
   ▼
ConfirmDialog → [재시도] 클릭
   │
   ▼
retryMutation.mutate(jobId)
   POST /api/v1/admin/conversions/{jobId}/retry
   │
   ├─ 200 → toast emerald → 즉시 listQuery.refetch()
   ├─ 404 → toast rose "작업이 삭제되었습니다"
   └─ 409 → toast amber "이미 처리 중"
```

---

## E. 디자인 토큰 / 컬러

### E.1 신규 디자인 토큰

**없음.** 기존 `apps/web/tailwind.config.ts` + `apps/web/app/globals.css`의 토큰만으로 표현 가능. 사용 팔레트:

- amber-50/200/400/700 — dirty/new 행
- rose-50/200/400/500/700/800 — removed 행, FAILED, error message
- sky-50/300/400/500/700 — PROCESSING
- emerald-50/300/400/500/700 — DONE, 저장 성공
- slate-100/300/400/700 — PENDING, neutral
- 기존 brand-500 — primary CTA, focus ring

### E.2 선택적 utility (제안)

만약 ConversionStatusBadge에서 "stat tint" 용 미세 변형이 자주 필요하면 다음 utility를 `globals.css` `@layer components`에 추가 검토:

```css
@layer components {
  .status-tint-pending { @apply bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300; }
  .status-tint-processing { @apply bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300; }
  .status-tint-done { @apply bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300; }
  .status-tint-failed { @apply bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300; }
}
```

이 utility는 권장이지 필수는 아님. ConversionStatusBadge 한 곳에서만 쓴다면 컴포넌트 내부 `cn(...)`로 충분.

---

## F. 반응형 (Desktop only, ≥1280)

### F.1 Breakpoints

| 영역 | 1280 | 1440 | 1920 |
|---|---|---|---|
| AdminSidebar | 240 | 240 | 240 |
| FolderTree (페이지 A) | 280 | 280 | 320 |
| Matrix (페이지 A) | fluid (≥720) | fluid | fluid |
| Conversions Main (페이지 B) | fluid | fluid | fluid |
| Stats cards (페이지 B) | grid-cols-4 | grid-cols-4 | grid-cols-4 |

매트릭스 9컬럼이 1280에서 빡빡함:

- 1280: principal 셀 240, 권한 컬럼 56 × 8 = 448, action 40, padding 등 = ~728. AdminSidebar 240 + Tree 280 + 728 = 1248 → 살짝 부족.
- **대응 1**: 1280에서 Matrix가 가로 스크롤 (sticky thead + sticky principal column).
- **대응 2**: 1280에서 권한 컬럼을 48로 축소.

본 spec은 **대응 1 (가로 스크롤)** 권장. principal 컬럼만 sticky left로 고정 (`<th>`에 `sticky left-0 bg-bg z-10`).

### F.2 <1280 fallback

- Matrix는 read-only로 강등 (체크박스 disabled, `+ 추가` / `저장` 버튼 hidden).
- 헤더에 amber 배너:
  ```
  ⚠ 화면이 좁아 편집 모드를 사용할 수 없습니다. 1280px 이상의 화면에서 접속하세요.
  ```
- Conversions는 그대로 동작 (테이블이 단일 가로축이라 모바일 친화적).

[PM-DECISION-6] <1280 정책 — 편집 차단 vs 가로 스크롤만 강제. 본 spec은 편집 차단 권장 (실수 방지 + 모바일 사용 빈도 0에 수렴).

---

## G. PM 결정 필요 항목 (8개)

| # | 항목 | 보수적 default (frontend가 PM 응답 전 채택) | 의사결정자 |
|---|---|---|---|
| 1 | 신규 principal 추가 시 default bits | **모든 비트 OFF** | PM (보안 vs UX) |
| 2 | 컬럼 헤더 tooltip wording | "폴더 보기 권한 (트리 노출)", "자료 편집 (체크아웃·체크인·개정)" 등 — §A.4.1 표 그대로 | PM (도메인 어휘 확정) |
| 3 | conversions 테이블에서 도면번호 클릭 시 이동 대상 | **`/objects/{objectId}`로 이동**. BE response에 `objectId` 필드 추가 필요 (현재 `attachmentId`만 있음). frontend는 일단 `/api/v1/attachments/{id}/meta` (admin debug용)로 fallback | PM (BE에 `objectId` 추가 요청 동의 여부) |
| 4 | conversions 자동 새로고침 default | **ON** | PM |
| 5 | ConversionStatusBadge가 기존 StatusBadge family인지 별도인지 | **별도 컴포넌트** (`ConversionStatusBadge`) — 도메인 분리 | PM |
| 6 | <1280 정책 | **편집 차단 + read-only 배너** | PM |
| 7 | FolderTree에 admin 화면용 "전체 폴더" fetch 모드 | BE에 `/api/v1/folders?admin=true` 추가 (ADMIN role일 때 `filterVisibleFolders` skip). 또는 별도 `/api/v1/admin/folders` 신설 | PM (+ BE) |
| 8 | PrincipalPicker 다중 선택 모드 | **단일 선택** (1행씩 추가) v1 | PM |

추가 (R28에서 발견됨):

| # | 항목 | 보수적 default | 의사결정자 |
|---|---|---|---|
| 9 | 매트릭스 셀 키보드 그리드 네비게이션 | v1 미지원 (Tab/Shift+Tab만) | PM |
| 10 | 저장 시 race-condition 보호 (If-Match / lastModifiedAt) | contract에 `meta.lastModifiedAt` ETag 추가 요청 | PM (+ BE) |

---

## H. Frontend Verification Checklist

Frontend agent가 구현 후 self-check 할 항목들. PM의 Phase 4 검증과 별도.

### H.1 페이지 A — /admin/folder-permissions

- [ ] AdminSidebar에서 "권한 매트릭스" 항목이 보이고 active 상태가 정확
- [ ] 폴더 미선택 시 EmptyState 정확히 표시
- [ ] 폴더 선택 → 매트릭스 로딩 → 정상 렌더
- [ ] sticky thead가 스크롤 시 고정
- [ ] 컬럼 헤더 hover 시 tooltip 노출
- [ ] 컬럼 헤더 클릭 = bulk toggle (mixed/uniform 모두 검증)
- [ ] 셀 토글 시 행 상태 amber/dirty로 변경, footer 카운터 +1
- [ ] [+ 추가] 클릭 → PrincipalPicker open
- [ ] PrincipalPicker USER 탭에서 검색 → 결과 노출
- [ ] 이미 추가된 principal은 disabled
- [ ] 추가 후 매트릭스에 `new` 상태 행 등장
- [ ] 행 [🗑 삭제] 클릭 → `removed` 상태 (rose-bordered, 셀 disabled)
- [ ] [🧹 정리] 클릭 → 직전 상태로 복원
- [ ] 매트릭스에 원본 대비 변경분=0이면 [저장], [되돌리기] 모두 disabled
- [ ] [저장] 클릭 → mutation 호출 → 성공 토스트 + 카운터 0
- [ ] 저장 중에는 매트릭스 disable + spinner
- [ ] 변경분 ≥1 + 좌측 트리 다른 폴더 클릭 → unsaved guard ConfirmDialog
- [ ] 변경분 ≥1 + 브라우저 닫기 → beforeunload 표시
- [ ] [✕ 닫기] 클릭 → URL의 ?folderId= 제거, EmptyState 복귀
- [ ] 1280에서 매트릭스 가로 스크롤 + principal 컬럼 sticky
- [ ] <1280 read-only 배너 표시
- [ ] 키보드만으로 모든 동작 가능 (Tab으로 셀 이동, Space로 토글, Enter로 버튼)
- [ ] 스크린리더로 행 라벨 정확 (테스트: macOS VoiceOver / NVDA)
- [ ] 다크모드에서 amber/rose 배경 명도대비 확인

### H.2 페이지 B — /admin/conversions

- [ ] AdminSidebar에서 "변환 작업" 항목이 통합/로그 그룹 첫번째에 노출
- [ ] 4 stats 카드 정상 렌더 + 클릭 시 필터 적용 + URL sync
- [ ] PROCESSING > 0이면 카드에 pulse 효과
- [ ] 필터 chip (상태/첨부 ID) 동작 + URL sync + 새로고침 후 보존
- [ ] [✕ 필터 초기화] 동작
- [ ] 5초 자동 새로고침 toggle 동작 + localStorage persist
- [ ] PROCESSING/PENDING 0건이면 polling idle (네트워크 탭 확인)
- [ ] 탭 hidden 시 polling pause (Visibility API)
- [ ] 행 좌측 색상 border 정확
- [ ] FAILED 행 에러 셀 클릭 → expand (한 번에 1행만)
- [ ] [📋 복사] → 클립보드에 errorMessage 정확히 복사
- [ ] [⋮] → [🔄 재시도] (FAILED만) → ConfirmDialog → 200 토스트
- [ ] 재시도 후 5초 내 새 PROCESSING 행 등장
- [ ] [더 보기] / 무한 스크롤 동작
- [ ] cursor 페이지네이션 정확 (중복/누락 없음)
- [ ] empty state (필터 0건 / 전체 0건) 분기 정확
- [ ] 행 키 stable (refetch 후 expand 상태 유지)

### H.3 공통

- [ ] AdminSidebar 항목 추가가 RSC/CSR 경계 안전 (BUG-02 회귀 없음)
- [ ] ShieldCheck / RefreshCw 아이콘 import (lucide-react)
- [ ] 토스트는 sonner 사용 (`apps/web/components/ui/toast.tsx` 또는 sonner 직접)
- [ ] 다크모드 양쪽 모두 검증
- [ ] api-contract.md의 필드명과 응답 shape 정확 (request/response 예시 일치)

---

## 부록 X. 의존하는 BE Contract (가정)

본 spec은 `_workspace/api_contract.md`가 본 라운드에 손실되어 PM이 재발행 예정인 상황에서 작성되었다. 다음 엔드포인트들이 contract에 포함되어야 한다 (미포함 시 frontend가 BE에 즉시 fail-fast 질의):

### X.1 Folder permissions

```
GET /api/v1/admin/folders?admin=true
  → 200 ok([FolderNode...])    // 모든 폴더 (admin role only)
                                 // ADMIN/SUPER_ADMIN 외 403

GET /api/v1/admin/folders/{folderId}/permissions
  → 200 ok([
      { principalType, principalId, principalLabel, principalSubLabel,
        viewFolder, editFolder, viewObject, editObject,
        deleteObject, approveObject, download, print },
      ...
    ], { lastModifiedAt: ISO })

PUT /api/v1/admin/folders/{folderId}/permissions
  body: {
    ifMatch?: ISO,
    permissions: [
      { principalType, principalId,
        viewFolder, ..., print },
      ...
    ]
  }
  → 200 (저장된 결과 + 새 lastModifiedAt)
  → 400 E_VALIDATION (어느 행/필드가 잘못됐는지 details)
  → 403 E_FORBIDDEN
  → 404 E_NOT_FOUND (폴더 삭제됨)
  → 409 E_CONFLICT (lastModifiedAt mismatch)
```

`principalLabel`은 BE가 관계 join으로 만들어줘야 함 (FE가 매번 별도 fetch하면 N+1). USER → fullName, ORG → name, GROUP → name. `principalSubLabel`은 USER의 organization name (옵션).

### X.2 Conversions

```
GET /api/v1/admin/conversions/stats
  → 200 ok({ pending: N, processing: N, done: N, failed: N })

GET /api/v1/admin/conversions?status=&attachmentId=&cursor=&limit=
  → 200 ok([
      { id, attachmentId, objectId?, objectNumber?, objectName?,
        status, attempt, errorMessage,
        startedAt, finishedAt, createdAt },
      ...
    ], { nextCursor })

POST /api/v1/admin/conversions/{id}/retry
  → 200 ok({ id, status: 'PENDING', attempt }) — 큐에 재투입
  → 404 E_NOT_FOUND
  → 409 E_CONFLICT — 이미 PROCESSING (재시도 중)
```

`objectId`/`objectNumber`/`objectName`은 BE가 attachment → object join으로 채워야 [PM-DECISION-3] 클릭 동작이 올바름.

---

(끝)
