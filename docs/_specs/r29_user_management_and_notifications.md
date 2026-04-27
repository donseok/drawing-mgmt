# R29 Design Spec — 사용자 관리 admin 페이지 + NotificationPanel 갱신 + 자료 thumbnail wiring

| 항목 | 내용 |
|---|---|
| 작성자 | drawing-mgmt designer agent (R29) |
| 작성일 | 2026-04-27 |
| 대상 라운드 | R29 |
| 대상 카드 | U-2 사용자 관리, N-1 NotificationPanel, V-INF-6 thumbnail wiring (FE 1곳) |
| 의존 (BE) | `_workspace/api_contract.md` §3 (N-1), §4 (U-2), §5.2 (thumbnail endpoint) |
| 신규 페이지 | `/admin/users` |
| 수정 페이지 | `<NotificationPanel>` (또는 `NotificationBell`의 Popover 본문) |
| 신규 컴포넌트 | `<UserManagementTable>`, `<UserFormDialog>`, `<PasswordResetDialog>`, `<UserUnlockDialog>`, `<UserDeactivateDialog>`, `<AttachmentThumbnail>` |
| 디바이스 | Desktop only (≥1280) |
| 디자인 토큰 변경 | 없음 — 기존 Tailwind palette + DESIGN.md 토큰 활용 |

---

## 0. 라운드 개요

### 0.1 세 카드를 한 spec에 묶는 이유

세 카드 모두 **"이미 있는 자리"의 빈칸을 채우는** 작업이다. 신규 메뉴/구조 변경이 아니라 admin 페르소나·UX의 마지막 hooks 정착.

- **U-2** — `/admin/users`는 AdminSidebar 첫 항목(`사용자 / 조직 → 사용자`)으로 이미 등록되어 있으나 placeholder 페이지뿐. R29에서 실 CRUD를 붙인다.
- **N-1** — `<NotificationPanel>` shell은 R6에서 만들어졌고 `NotificationBell`이 ActivityLog로 fake 데이터를 채워왔다 (BUG-11). R29에서 진짜 Notification 테이블이 생기면서 mark-read/read-all/unread 정확도가 처음으로 wire-up된다.
- **V-INF-6** — viewer-engineer가 worker에서 thumbnail.png를 만든다. FE는 1곳만 wire하고 나중 라운드에 확산.

### 0.2 페르소나 시나리오

| 시나리오 | 페르소나 | 흐름 |
|---|---|---|
| 신입 사원 박지원 입사 | 슈퍼관리자 | `/admin/users` → `[+ 사용자 추가]` → 폼 채워 저장 → 박지원에게 임시 비밀번호 메모로 전달 |
| 박지원 5회 비밀번호 오입력 → 잠김 | 관리자 | 사용자 목록에서 amber 행(LOCKED) 발견 → `[잠금 해제]` → confirm → 토스트 |
| 박지원 비밀번호 분실 | 관리자 | 박지원 행 → `[비밀번호 리셋]` 다이얼로그 → "자동 생성" 토글 → 1회 노출되는 평문 복사 → 박지원에게 전달 |
| 김지원 결재 승인 알림 | 설계자 | 헤더 알림 종 클릭 → unread 굵은 행 클릭 → 자동 read 처리 + `/objects/{id}` 진입 |
| 검색 결과 미리보기 | 설계자 | `/search` 결과 행 호버 → 우측 preview 패널에 PDF/PNG thumbnail 노출 (현재 placeholder) |

---

# A. /admin/users — 사용자 관리

## A.1 라우트, AdminSidebar

- **Route:** `/admin/users` (이미 AdminSidebar 첫 항목으로 등록됨, `admin-groups.ts:36`).
- **권한:** SUPER_ADMIN / ADMIN. 그 외는 layout-level guard로 redirect.
- **AdminSidebar 변경 없음** — 기존 `Users` 아이콘과 `description: '계정·역할·서명 관리'` 그대로.

## A.2 레이아웃 — 단일 컬럼 테이블 + 우측 슬라이드 인 다이얼로그

R28의 `/admin/folder-permissions`는 3-pane(트리 + 매트릭스)이었지만, **사용자 관리는 좌·우 분할이 어울리지 않는다**:

- 사용자 목록은 가로로 넓어야 (8 컬럼) 한다 — 좌측 트리에 폭을 양보할 수 없다.
- "선택 → 우측 상세"보다 **테이블 내 inline 액션 + Dialog** 패턴이 빠르다 (한 명 수정만 하고 다음으로). 동시 비교 use case 없음.

따라서 **단일 컬럼 + 액션 시 모달 다이얼로그** 패턴 채택.

```
┌─ Header (글로벌, 56px) ──────────────────────────────────────────────────┐
│NavRail│ AdminSidebar  │ Users Main (fluid)                                │
│ 56px  │   240px        │                                                   │
│       │               │ [breadcrumb] 관리자 / 사용자                       │
│       │ ▼ 사용자/조직 │ ┌────────────────────────────────────────────┐    │
│       │ • 사용자 ←active │ │ 사용자                          [+ 사용자 추가] │
│       │ • 조직        │ │ 계정·역할·서명 관리                            │    │
│       │ • 그룹        │ └────────────────────────────────────────────┘    │
│       │               │                                                   │
│       │ ▼ 폴더/권한   │ ┌─ Toolbar ─────────────────────────────────┐    │
│       │ ...           │ │ 🔎 [검색…] 역할:[전체▼] 상태:[전체▼] ✕ 초기화 │    │
│       │               │ └────────────────────────────────────────────┘    │
│       │               │                                                   │
│       │               │ ┌─ UserManagementTable (8 + ⋮) ────────────┐    │
│       │               │ │ ...                                       │    │
│       │               │ └────────────────────────────────────────────┘    │
│       │               │                                                   │
│       │               │ [더 보기] (cursor pagination)                      │
└───────┴───────────────┴──────────────────────────────────────────────────┘
```

## A.3 Toolbar (Filter + Action)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🔎 [이름·사번·이메일 검색…]  역할:[전체▼] 상태:[전체▼] ✕ 필터 초기화  │
└──────────────────────────────────────────────────────────────────────┘
                                                            [+ 사용자 추가]
```

| 필드 | 동작 | URL sync |
|---|---|---|
| 검색 input | 400ms debounce, `?q=` URL sync, 기존 `q` 쿼리 활용 | `?q=` |
| 역할 select | `전체 / SUPER_ADMIN / ADMIN / USER / PARTNER` | `?role=` (FE 클라이언트 필터, list 결과 비교적 작음) |
| 상태 select | `전체 / 재직 / 잠김 / 비활성` (재직 = `deletedAt IS NULL && employmentType=ACTIVE`, 잠김 = `lockStatus='LOCKED'`, 비활성 = `deletedAt IS NOT NULL`) | `?status=` (FE 클라이언트 필터) |
| `✕ 필터 초기화` | 모든 쿼리 제거 | — |
| `[+ 사용자 추가]` | UserFormDialog mode=create open | — |

> [PM-DECISION-1] 역할/상태 필터를 FE 클라이언트 필터로 둘지 BE 쿼리(`?role=`, `?status=`)로 둘지. 보수적 default = **FE 클라이언트 필터** (전체 사용자 ≤ 200명 가정 — PRD §3 페르소나 합산 23~30명, 협력업체 5사 25명 = 50대). 200명 초과 시 BE 쿼리로 승격 후속 라운드.

## A.4 UserManagementTable — 9 컬럼

```
┌──────────┬─────────┬────────────────────┬────────────┬────────┬──────┬──────┬────────┬─────┐
│ 사용자명 │ 이름    │ 이메일              │ 조직       │ 역할   │ 재직 │ 보안 │ 잠금   │  ⋮  │
├──────────┼─────────┼────────────────────┼────────────┼────────┼──────┼──────┼────────┼─────┤
│ park.yh  │ 박영호  │ park.yh@dkc.co.kr  │ 냉연 1팀   │ USER   │ 재직 │  3   │  —     │ ⋮  │
│ kim.ji   │ 김지원  │ kim.ji@dkc.co.kr   │ 냉연 1팀   │ USER   │ 재직 │  3   │ 🔒잠김 │ ⋮  │
│ adm.lee  │ 이관리  │ adm.lee@dkc.co.kr  │ IT팀       │ ADMIN  │ 재직 │  1   │  —     │ ⋮  │
│ ext.hong │ 홍성기계 │ contact@hong.co.kr │ 협력업체   │PARTNER │ 재직 │  4   │  —     │ ⋮  │
│ kim.old  │ 김퇴직  │ —                  │ —          │ USER   │ 비활성│ 5    │  —     │ ⋮  │
└──────────┴─────────┴────────────────────┴────────────┴────────┴──────┴──────┴────────┴─────┘
```

### A.4.1 컬럼 사양

| # | Header | Width | Render |
|---|---|---|---|
| 1 | 사용자명 | 120 | mono `text-[12px]` `username` (truncate, tooltip full) |
| 2 | 이름 | 120 | `fullName` (text-sm font-medium) |
| 3 | 이메일 | flex (min 200) | `email ?? '—'` mono `text-[12px]` truncate |
| 4 | 조직 | 140 | `organization?.name ?? '—'`. PARTNER 강조: `text-violet-700` |
| 5 | 역할 | 100 | `<RoleBadge>` (§A.4.4) |
| 6 | 재직 | 80 | `<EmploymentBadge>`: 재직(ACTIVE) emerald-tinted / 퇴직(RETIRED) slate / 협력(PARTNER) violet / 비활성(deletedAt set) → 회색 strikethrough "비활성" |
| 7 | 보안 | 60 | `1 ~ 5` 숫자 + 1=brand red, 5=fg-subtle (보안등급 시각). `tabular-nums` |
| 8 | 잠금 | 110 | LOCKED → `<Lock className="h-3 w-3 text-amber-700"/> 🔒 잠김 (until M/D HH:mm)`. NONE → `—` |
| 9 | (Action) | 40 | `<DropdownMenu>` 트리거 |

### A.4.2 행 시각 변형

| 상태 | 좌측 border | 배경 | 텍스트 |
|---|---|---|---|
| `정상` (active, unlocked) | 없음 | 기본 | 기본 |
| `LOCKED` | `border-l-2 border-amber-400` | `bg-amber-50/60` (다크 `bg-amber-950/30`) | 잠금 컬럼 amber-700 |
| `비활성` (`deletedAt != null`) | `border-l-2 border-slate-300` | `bg-bg-subtle` | 모든 셀 `text-fg-subtle line-through`. 우측 액션은 "복원만 가능" (또는 비활성화) |
| `본인` (현재 세션 user) | (정상 위에) `font-medium` + 좌측 `<UserCog className="h-3 w-3 text-brand"/>` 아이콘을 사용자명 앞에 prepend | — | "본인 계정" tooltip |

> 비활성(`deletedAt IS NOT NULL`) 행은 default로 **숨김**. 상태 필터에서 "비활성" 또는 "전체"를 선택해야만 노출. 이는 토글이 아니라 select 옵션이며, default=재직.

### A.4.3 행 액션 (`⋮` DropdownMenu)

| 액션 | 조건 | 다이얼로그 | API |
|---|---|---|---|
| `✏ 수정` | 항상 | `<UserFormDialog mode="edit">` | `PATCH /api/v1/admin/users/{id}` |
| `🔓 잠금 해제` | `lockStatus === 'LOCKED'`만 | `<UserUnlockDialog>` (단순 confirm) | `POST /api/v1/admin/users/{id}/unlock` |
| `🔑 비밀번호 리셋` | `deletedAt == null`만 | `<PasswordResetDialog>` | `POST /api/v1/admin/users/{id}/reset-password` |
| `🚫 비활성화` | `deletedAt == null && id !== self.id`만 | `<UserDeactivateDialog>` (강한 확인) | `DELETE /api/v1/admin/users/{id}` |
| `↩ 복원` | `deletedAt != null`만 | (Phase 2 — 본 라운드 미구현) | — |

본인 행은 `🚫 비활성화` 영구 disabled. SUPER_ADMIN을 ADMIN/USER가 수정/비활성하려 하면 BE 403을 받지만 FE에서도 disable + tooltip:

```
"SUPER_ADMIN 계정은 다른 SUPER_ADMIN만 수정할 수 있습니다."
```

### A.4.4 `<RoleBadge>` 시각 (참고)

| Role | bg / fg | 아이콘 | label |
|---|---|---|---|
| SUPER_ADMIN | `bg-rose-50 text-rose-700` | `ShieldAlert` | 슈퍼관리자 |
| ADMIN | `bg-amber-50 text-amber-700` | `ShieldCheck` | 관리자 |
| USER | `bg-bg-subtle text-fg-muted` | (없음) | 사용자 |
| PARTNER | `bg-violet-50 text-violet-700` | `UsersRound` | 협력업체 |

`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium`. dark mode tints `*-950/30` + `*-300`.

### A.4.5 빈 상태 / 에러

| 상태 | 처리 |
|---|---|
| `list.isPending` (첫 로드) | 8행 `<Skeleton>` |
| `list.isError 403` | `<EmptyState icon={ShieldOff}>` "사용자 관리 권한이 없습니다" |
| `list.isError 5xx` | `<EmptyState icon={AlertTriangle}>` "사용자 목록을 불러오지 못했습니다 [재시도]" |
| `list.data.length === 0` (필터 있음) | "조건에 맞는 사용자가 없습니다 [필터 초기화]" |
| `list.data.length === 0` (필터 없음, 첫 로드) | "사용자가 아직 등록되지 않았습니다 [+ 사용자 추가]" (희박) |

## A.5 페이지네이션

- **Cursor 기반 무한 스크롤** — 기존 `GET /api/v1/admin/users?cursor=&limit=`. 응답에 `meta.nextCursor`.
- 하단 `[더 보기]` 버튼 + IntersectionObserver auto-load 둘 다.
- 검색/필터 변경 시 cursor 초기화. `useInfiniteQuery` 표준 패턴.

## A.6 UserFormDialog — 사용자 추가 / 수정

### A.6.1 레이아웃 (560×auto)

```
┌─ 사용자 추가 / 수정 ────────────────────────────[✕]┐
│  사용자명 (username)*                              │
│  [park.yh                                       ]  │
│  · 영문 소문자/숫자/`.`/`_`/`-`만 사용. 8~32자.    │
│                                                    │
│  이름 (fullName)*                                  │
│  [박영호                                       ]  │
│                                                    │
│  이메일                                            │
│  [park.yh@dkc.co.kr                            ]  │
│                                                    │
│  ┌─ 조직 ────────────┐ ┌─ 역할* ──────┐            │
│  │ [냉연 1팀     ▼] │ │ [USER     ▼] │            │
│  └───────────────────┘ └──────────────┘            │
│                                                    │
│  ┌─ 재직 형태 ───────┐ ┌─ 보안등급* ──┐            │
│  │ [ACTIVE      ▼] │ │ [3        ▼] │            │
│  └───────────────────┘ └──────────────┘            │
│                                                    │
│  ┌─ 비밀번호* (생성 시 필수) ──────────────────┐    │
│  │ [········                                 ]    │
│  │ · 8자 이상. 사용자에게 별도 채널로 전달하세요. │
│  └────────────────────────────────────────────┘    │
│  (mode='edit'일 땐 이 블록 자체가 hidden — 수정은     │
│   비밀번호 리셋 다이얼로그를 통하라는 안내 helper)     │
│                                                    │
│  ⚠️ 본인 강등 경고 (mode='edit' && role 변경 시)    │
│  "본인 계정의 역할을 강등합니다. 저장 후 즉시        │
│   관리 권한을 잃을 수 있습니다."                   │
│                                                    │
│  [취소]                              [저장]        │
└────────────────────────────────────────────────────┘
```

### A.6.2 필드 사양

| 필드 | mode='create' | mode='edit' | 검증 (Zod) |
|---|---|---|---|
| `username` | 필수 | **disabled** (변경 불가) | `^[a-z0-9._-]{8,32}$` (PRD §6.1.2) |
| `fullName` | 필수 | 가능 | `min(1).max(40)` |
| `email` | 옵션 | 가능 | `email().optional()` |
| `organizationId` | 옵션 (조직 select) | 가능 | uuid optional |
| `role` | 필수 | 가능 (단 본인 강등 경고) | enum `SUPER_ADMIN/ADMIN/USER/PARTNER` |
| `employmentType` | default `ACTIVE` | 가능 | enum `ACTIVE/RETIRED/PARTNER` |
| `securityLevel` | default `5` | 가능 | int 1..5 |
| `password` | 필수 | **숨김** (PATCH 대상 아님) | `min(8).max(64)` (영문/숫자/기호 — BE에서 추가 검증) |
| `signatureFile` | (Phase 2) | (Phase 2) | — |

> [PM-DECISION-2] **비밀번호 정책** — 8자 이상만 강제할지, 또는 영문+숫자+기호 강제할지. PRD에는 명시되지 않음. 보수적 default = **8자 이상 + 영문/숫자/기호 중 2종 이상** (RHF zod refine으로 검증).

### A.6.3 본인 강등 경고

`mode='edit' && form.values.role !== currentSelfRole && self.id === target.id`이면 폼 푸터 위 amber 배너:

```
⚠️ 본인 강등 경고
저장 후 본인의 역할이 [SUPER_ADMIN → USER]으로 변경됩니다.
이 페이지를 포함한 관리자 화면에 접근할 수 없게 됩니다. 정말 진행하시겠습니까?
[저장] 누르면 한 번 더 ConfirmDialog가 뜬다.
```

`<Alert variant="warning">` 패턴. 저장 클릭 시 강등 확정 ConfirmDialog 추가:

```
"본인 계정을 강등합니다.

  현재 역할: SUPER_ADMIN
  변경 역할: USER

저장 후 즉시 관리자 화면에서 자동 redirect 됩니다.
[취소]                                  [강등 진행]"
```

default focus = `취소`. `강등 진행`은 rose 색.

### A.6.4 SUPER_ADMIN 보호

- 자기 자신이 ADMIN/USER인데 SUPER_ADMIN 행을 수정하려 하면 행의 `⋮` 메뉴에서 `수정/비활성화`가 disabled + tooltip "SUPER_ADMIN은 다른 SUPER_ADMIN만 수정할 수 있습니다".
- BE 403 fallback 시 toast rose `"권한이 부족합니다. (SUPER_ADMIN 보호)"`.
- `mode='create'`에서 role select에 `SUPER_ADMIN` 옵션은 **현재 세션이 SUPER_ADMIN일 때만 노출** — 평범한 ADMIN은 SUPER_ADMIN 새로 만들 수 없다.

### A.6.5 저장 흐름

```
사용자 [저장] 클릭
  → RHF zod 검증 → 인라인 에러 표시
  → mode='create' → POST /api/v1/admin/users
     mode='edit'  → PATCH /api/v1/admin/users/{id}
  → 200 → toast emerald
        ├ create: "사용자가 추가되었습니다 (park.yh)"
        └ edit:   "변경사항이 저장되었습니다"
       → invalidate ['admin', 'users']
       → invalidate ['admin', 'users', userId]
       → 다이얼로그 닫기
  → 400 E_VALIDATION → 인라인 에러 (`details.fieldErrors`)
  → 409 E_CONFLICT (username 중복) → username 필드에 에러 "이미 사용 중인 사용자명입니다"
  → 403 E_FORBIDDEN → toast rose "권한이 부족합니다"
  → 5xx → toast rose persist + 재시도
```

> [PM-DECISION-3] 저장 성공 후 본인 강등이라면 즉시 `/login` 또는 `/`로 redirect할지. 보수적 default = `router.refresh()` 후 layout-level redirect에 위임 (다음 navigation에서 자동으로 `/admin/*`이 막힘).

## A.7 PasswordResetDialog — 비밀번호 리셋

### A.7.1 레이아웃 (480×auto)

```
┌─ 비밀번호 리셋 ─────────────────────────────────[✕]┐
│  대상 사용자                                       │
│  · 박영호 (park.yh)                                │
│                                                    │
│  ◯ 직접 입력  ◉ 자동 생성                          │
│                                                    │
│  (직접 입력 모드 — 자동 생성 unchecked일 때)       │
│  [임시 비밀번호                              ] 👁  │
│  · 8~32자. 영문/숫자/기호 2종 이상.                │
│                                                    │
│  (자동 생성 모드 — checked일 때)                   │
│  ℹ️ 12자 영숫자+기호 임의 비밀번호이 자동 생성되어 │
│     화면에 1회만 표시됩니다. 이후 다시 볼 수 없으니│
│     반드시 안전하게 메모해 사용자에게 전달하세요.  │
│                                                    │
│  [취소]                              [리셋]        │
└────────────────────────────────────────────────────┘
```

### A.7.2 응답 후 (자동 생성 모드 성공 시)

```
┌─ 비밀번호 리셋 완료 ────────────────────────────[✕]┐
│  ✅ 박영호의 임시 비밀번호가 설정되었습니다.       │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │  Tk7$mQ9aPzR2                       [📋 복사]│  │
│  └──────────────────────────────────────────────┘  │
│  ⚠️ 이 비밀번호는 다시 표시되지 않습니다.          │
│     지금 메모하거나 사용자에게 전달하세요.         │
│                                                    │
│  ☑ 안전한 채널로 사용자에게 전달했습니다.          │
│                                                    │
│  [닫기]                                            │
└────────────────────────────────────────────────────┘
```

- 평문은 `font-mono text-base bg-amber-50 border-amber-200 px-3 py-2 rounded select-all`.
- `[📋 복사]` → `navigator.clipboard.writeText(plain)` → 버튼 안에 inline `Check` 아이콘 1.5초 토글.
- 체크박스 체크해야 `[닫기]` enable. 사용자가 무심코 미복사 상태로 닫는 사고 방지.
- `[닫기]` 클릭 시 dialog state reset (다음 호출 시 평문 노출 X).

### A.7.3 직접 입력 모드 동작

- input은 default `type="password"` + 우측 `[👁]` toggle (text/password). RHF + zod (위 §A.6.2의 비밀번호 검증 동일).
- 응답에 평문이 없으므로(BE는 admin이 입력한 값을 리턴 안 함) 성공 후 단순 토스트 emerald `"비밀번호가 설정되었습니다"` + 다이얼로그 자동 close.

### A.7.4 BE 호출

```
mode='manual':
  POST /api/v1/admin/users/{id}/reset-password
  body: { tempPassword: 'Tk7$mQ9aPzR2' }

mode='generate':
  POST /api/v1/admin/users/{id}/reset-password
  body: { generate: true }
  response: { ok: true, data: { tempPassword: 'Tk7$mQ9aPzR2' } }
```

> [PM-DECISION-4] **자동 생성 임시 비밀번호 정책** — BE가 만드는 평문 길이/문자셋. 보수적 default = **12자 영숫자(a-zA-Z0-9) + 특수기호 1자 이상 보장 (`!@#$%^&*`)**. 시각적으로 헷갈리는 `0/O/o`, `1/l/I` 제외 권장. (BE 측 책임이지만 디자인 측에서 카피의 "12자"를 못 박으므로 PM 결정 필요.)

## A.8 UserUnlockDialog — 잠금 해제 (단순 confirm)

```
┌─ 잠금 해제 ────────────────────────────────────[✕]┐
│  김지원 (kim.ji) 계정의 잠금을 해제합니다.        │
│                                                    │
│  · 5회 비밀번호 오입력으로 잠금됨                  │
│  · 자동 잠금 해제 시각: 2026-04-27 11:42         │
│                                                    │
│  지금 해제하면 사용자는 즉시 다시 로그인할 수      │
│  있습니다. 비밀번호를 모를 경우 별도로             │
│  [비밀번호 리셋]을 사용하세요.                     │
│                                                    │
│  [취소]                          [잠금 해제]       │
└────────────────────────────────────────────────────┘
```

- `<ConfirmDialog>` 패턴 재사용 (R28 paradigm). default focus = `취소`.
- 200 → toast emerald `"잠금이 해제되었습니다 (kim.ji)"` + invalidate.

## A.9 UserDeactivateDialog — 비활성화 (강한 확인)

```
┌─ 사용자 비활성화 ──────────────────────────────[✕]┐
│  ⚠️  박영호 (park.yh) 계정을 비활성화합니다.       │
│                                                    │
│  비활성화 후:                                      │
│  · 이 사용자는 더 이상 로그인할 수 없습니다.       │
│  · 사용자명(park.yh)은 보존되어 활동 이력에        │
│    계속 표시됩니다.                                │
│  · 보유한 자료의 소유권은 그대로 유지되며,         │
│    필요 시 슈퍼관리자가 이전할 수 있습니다.        │
│                                                    │
│  ┌─ 확인 ──────────────────────────────────────┐  │
│  │ 정말로 비활성화하려면 사용자명을 입력하세요  │  │
│  │ [park.yh                                  ] │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  [취소]                          [비활성화]        │
└────────────────────────────────────────────────────┘
```

- 사용자명 일치 입력 후에만 `[비활성화]` enable. `<input>` value === `target.username`.
- `[비활성화]` 버튼은 rose. default focus = 취소.
- 200 → toast emerald `"비활성화되었습니다 (park.yh)"` + 행이 회색 strikethrough로 변경 (revalidate or filter on `deletedAt`).

> [PM-DECISION-5] **비활성화 confirm 강도** — 보수적 default = **사용자명 입력 일치** (강함). 너무 강하면 PM이 "체크박스 한 개로 변경" 가능.

## A.10 컴포넌트 트리

```
<UsersPage>                                // RSC frame
  <AdminSidebar />
  <UsersMain>                              // client (queries)
    <UsersHeader>                          // breadcrumb + title + [+ 추가]
      <Button onClick={() => setCreateOpen(true)}>+ 사용자 추가</Button>
    </UsersHeader>
    <UsersToolbar
      q={q} role={role} status={status}
      onChangeQ={...} onChangeRole={...} onChangeStatus={...} onReset={...}
    />
    <UserManagementTable
      rows={rows}
      currentSelfId={session.user.id}
      currentSelfRole={session.user.role}
      onEdit={(user) => setEditTarget(user)}
      onUnlock={(user) => setUnlockTarget(user)}
      onResetPassword={(user) => setResetTarget(user)}
      onDeactivate={(user) => setDeactivateTarget(user)}
    />
    <LoadMoreButton hasMore={hasNextPage} onLoad={fetchNextPage} />
  </UsersMain>

  {createOpen && (
    <UserFormDialog
      mode="create"
      onClose={() => setCreateOpen(false)}
      onSubmit={...}
    />
  )}
  {editTarget && (
    <UserFormDialog
      mode="edit"
      initial={editTarget}
      currentSelfId={session.user.id}
      currentSelfRole={session.user.role}
      onClose={() => setEditTarget(null)}
      onSubmit={...}
    />
  )}
  {unlockTarget && (
    <UserUnlockDialog
      user={unlockTarget}
      onClose={() => setUnlockTarget(null)}
      onConfirm={...}
    />
  )}
  {resetTarget && (
    <PasswordResetDialog
      user={resetTarget}
      onClose={() => setResetTarget(null)}
    />
  )}
  {deactivateTarget && (
    <UserDeactivateDialog
      user={deactivateTarget}
      onClose={() => setDeactivateTarget(null)}
      onConfirm={...}
    />
  )}
</UsersPage>
```

## A.11 TS Prop 시그니처

### A.11.1 Wire shapes

```ts
// GET /api/v1/admin/users response item (passwordHash 제외 + lockStatus 합성)
interface AdminUserListItem {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  organizationId: string | null;
  organization: { id: string; name: string } | null;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'PARTNER';
  employmentType: 'ACTIVE' | 'RETIRED' | 'PARTNER';
  securityLevel: 1 | 2 | 3 | 4 | 5;
  failedLoginCount: number;
  lockedUntil: string | null;          // ISO
  lockStatus: 'NONE' | 'LOCKED';       // BE 합성: lockedUntil > now() → LOCKED
  lastLoginAt: string | null;
  createdAt: string;
  deletedAt: string | null;
}
```

### A.11.2 `<UserManagementTable>` props

```ts
interface UserManagementTableProps {
  rows: AdminUserListItem[];
  currentSelfId: string;
  currentSelfRole: AdminUserListItem['role'];
  loading?: boolean;                           // skeleton placement
  onEdit: (user: AdminUserListItem) => void;
  onUnlock: (user: AdminUserListItem) => void;
  onResetPassword: (user: AdminUserListItem) => void;
  onDeactivate: (user: AdminUserListItem) => void;
}
```

### A.11.3 `<UserFormDialog>` props

```ts
type UserFormMode = 'create' | 'edit';

interface UserFormValues {
  username: string;
  fullName: string;
  email?: string;
  organizationId?: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'PARTNER';
  employmentType: 'ACTIVE' | 'RETIRED' | 'PARTNER';
  securityLevel: 1 | 2 | 3 | 4 | 5;
  password?: string;                            // create에서만 사용
}

interface UserFormDialogProps {
  mode: UserFormMode;
  initial?: AdminUserListItem;                  // mode='edit'일 때 필수
  currentSelfId: string;
  currentSelfRole: AdminUserListItem['role'];
  organizations: Array<{ id: string; name: string }>;  // 조직 select 옵션 (사전 fetch)
  open: boolean;
  onClose: () => void;
  onSubmit: (values: UserFormValues) => Promise<void>;
}
```

### A.11.4 `<PasswordResetDialog>` props

```ts
interface PasswordResetDialogProps {
  user: Pick<AdminUserListItem, 'id' | 'username' | 'fullName'>;
  open: boolean;
  onClose: () => void;
  /** Mutation hook 제공 — 다이얼로그 내부에서 호출 */
  onSubmitManual: (tempPassword: string) => Promise<void>;
  onSubmitGenerate: () => Promise<{ tempPassword: string }>;
}
```

### A.11.5 `<UserUnlockDialog>` / `<UserDeactivateDialog>` props

```ts
interface UserUnlockDialogProps {
  user: Pick<AdminUserListItem, 'id' | 'username' | 'fullName' | 'lockedUntil' | 'failedLoginCount'>;
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

interface UserDeactivateDialogProps {
  user: Pick<AdminUserListItem, 'id' | 'username' | 'fullName'>;
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}
```

## A.12 TanStack Query 키 + Mutation 패턴

```ts
queryKeys.adminUsers = {
  list: (params: { q?: string; role?: string; status?: string }) =>
    ['admin', 'users', 'list', params] as const,
  detail: (id: string) =>
    ['admin', 'users', 'detail', id] as const,
};
```

`useInfiniteQuery` (list, cursor) + `useMutation` (create/patch/unlock/reset/delete). 성공 시 `queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })` 한 번으로 전체 sync. detail은 별도 컴포넌트 진입 시에만 fetch (현재 라운드는 list-only로 충분).

기존 frontend.md "Mutation 패턴 가이드"에서 `useObjectMutation` factory 패턴이 정착했으나 사용자 관리는 한 페이지·로컬 상태가 단순 → **factory 불필요**. 다이얼로그별 로컬 mutation 4개 (`useUserCreate`, `useUserUpdate`, `useUserUnlock`, `useUserResetPassword`, `useUserDeactivate`)로 분리하고 모두 같은 invalidation으로 마무리.

## A.13 접근성

- 테이블은 의미적 `<table>` + `<th scope="col">`.
- 잠금/비활성 상태는 색뿐 아니라 텍스트 + 아이콘 (색맹 대응).
- 모든 다이얼로그는 shadcn `<Dialog>` 기반 → focus trap + Esc + restore 자동.
- `[+ 사용자 추가]` 버튼은 페이지 우상단 + AdminSidebar tab 후 첫 번째 focusable. 키보드 흐름: Tab → Toolbar 검색 → 역할 → 상태 → 초기화 → [+ 추가] → 행 1 → ... → 행 N action menu.
- ConfirmDialog 류는 default focus = 안전한 옵션(취소).
- `<input type="password">` + `[👁]` toggle은 `aria-label` 정확.
- 본인 강등 경고는 `aria-live="assertive"` (강한 알림).
- 임시 비밀번호 노출 영역은 `<output>` 시멘틱 + `aria-label="자동 생성된 임시 비밀번호"`.

---

# B. NotificationPanel — Mark-read / Read-all wiring

## B.1 현재 상태와 변경 동기

현재 `<NotificationBell>`(`apps/web/components/layout/NotificationBell.tsx`)이 직접 popover 본문을 렌더한다. 별도로 `<NotificationPanel>`(`apps/web/components/notifications/NotificationPanel.tsx`)이 R6에서 만들어진 정식 shell로 존재하지만 wire되지 않은 상태. **정책: NotificationBell의 본문을 `<NotificationPanel>`로 교체.** Bell trigger는 그대로 두고 본문만 swap (NotificationPanelTrigger.tsx 주석에도 그렇게 적혀있음).

추가 변경:

1. mark-read를 진짜 BE 호출로 wire (현재는 local Set fake).
2. read-all 버튼을 `POST /api/v1/notifications/read-all`로 wire.
3. unread count를 진짜 endpoint(`GET /api/v1/notifications/unread-count`)에서 받아 local subtraction trick 제거.
4. 행 클릭 시 (a) read mutation → (b) `objectId`가 있으면 `/objects/{objectId}` 라우팅.
5. 필터 토글: 전체 / 읽지 않음.
6. 무한 스크롤 (cursor).

## B.2 레이아웃 (380×680)

기존 360px → **380px**로 확장 (필터 토글이 추가되므로). max-height `680px` (헤더 40 + 필터바 36 + 리스트 max 560 + 푸터 44).

```
┌─────────────────────────────────────────┐
│ 알림   [3]                  모두 읽음   │ ← header (40)
├─────────────────────────────────────────┤
│ [전체  •  읽지 않음]                    │ ← filter (36)
├─────────────────────────────────────────┤
│ ● 결재 요청이 도착되었습니다  3분 전    │
│   DWG-2026-0012                         │
│ ───────────────────────────────────── │
│ ● 자료가 체크인되었습니다     1시간 전 │
│   DWG-2026-0008                         │
│ ─────────────────────────────────────  │
│   김지원이 회신했습니다       어제      │
│   "도면 검토 완료"                       │
│ ─────────────────────────────────────  │
│   ...                                   │
│   ⌄ 더 보기 (스크롤로 자동 로드)         │
├─────────────────────────────────────────┤
│ 모든 알림 보기                  ⚙       │ ← footer (44, 기존 유지)
└─────────────────────────────────────────┘
```

## B.3 Header

```
┌─────────────────────────────────────────┐
│ 알림   [3]                  모두 읽음   │
└─────────────────────────────────────────┘
```

- 좌측 `알림` (text-sm font-semibold) + 우측에 unread 뱃지 inline `<Badge variant="brand">3</Badge>` (count > 0일 때만).
- count = `unreadCountQuery.data` (별도 endpoint, 30초 stale).
- 우측 `[모두 읽음]` 버튼:
  - text-xs text-fg-muted hover text-fg.
  - count === 0 → disabled + opacity-40.
  - 클릭 → `markAllReadMutation.mutate()` → optimistic count = 0, list 모든 row read.
  - 성공 시 토스트 없음 (자체 시각 피드백 충분).
  - 실패 시 토스트 rose `"모두 읽음 처리에 실패했습니다 [재시도]"`.

## B.4 Filter Bar (신규)

```
┌─────────────────────────────────────────┐
│ [전체  •  읽지 않음]                    │
└─────────────────────────────────────────┘
```

- shadcn `<Tabs>` 또는 segmented control 패턴 (compact, h-7).
- `전체` (default) / `읽지 않음`. URL은 popover라 query string 안 씀, 컴포넌트 내부 state.
- `읽지 않음` 탭 활성 시 `useInfiniteQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api.get('/api/v1/notifications', { query: { unreadOnly: 1 } }) })` 별도 키.
- 탭 전환 시 cursor reset.
- "읽지 않음" 탭에서 행을 클릭해 read 처리하면 즉시 그 행이 사라지지 않는다 (UX: 클릭 = focus 이동 + read; 숨김은 다음 탭 진입에서). [PM-DECISION-7]

> [PM-DECISION-7] 읽지 않음 탭에서 행 클릭 후 동작:  (a) 행을 즉시 fade-out 후 리스트에서 제거 / (b) 그 자리에 그대로 두고 굵기만 일반으로 변경. 보수적 default = **(b) — 그 자리에 둠**. 행이 사라져 위치가 바뀌면 사용자가 의도한 다음 동작(연속 클릭)을 잃는다.

## B.5 Notification Row (시각 갱신)

```
┌─────────────────────────────────────────┐
│ ● 결재 요청이 도착되었습니다  3분 전    │ ← read=false
│   DWG-2026-0012                         │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│   자료가 체크인되었습니다     1시간 전  │ ← read=true (dot 없음, 굵기 약함)
│   DWG-2026-0008                         │
└─────────────────────────────────────────┘
```

| 상태 | dot | title | body |
|---|---|---|---|
| `read=false` | brand-500 6px solid | `font-semibold text-fg` | `text-xs text-fg-muted` |
| `read=true` | (투명 plchldr 6px) | `font-medium text-fg-muted` | `text-xs text-fg-subtle` |

기존 `NotificationPanel.tsx`의 `NotificationRow`가 이미 거의 정확함. 필요한 변경:

1. `<button>`을 클릭하면 onClick(item) 호출 → 부모가 `markReadMutation.mutate(item.id)` + `if (item.objectId) router.push(/objects/${item.objectId})`.
2. `key`는 `item.id` 그대로.
3. `body` 줄바꿈/긴 텍스트 처리: 1줄 truncate (기존). 2줄까지 보이도록 `line-clamp-2` 옵션 — [PM-DECISION-8] 보수적 default = **1줄 truncate** (panel 좁음).

## B.6 무한 스크롤

- `useInfiniteQuery({ queryKey: ['notifications', filter], queryFn: ... pageParam: cursor })`.
- 응답 `meta.nextCursor` 사용.
- ScrollArea 하단 100px 진입 시 IntersectionObserver fire → `fetchNextPage()`.
- 끝 도달 시 mini footer `"더 이상 알림이 없습니다."` (text-[11px] text-fg-subtle).
- 첫 30건 default `?limit=30`.

## B.7 폴링

| 시점 | 동작 |
|---|---|
| 패널 닫힘 | unreadCount만 30초 polling (기존 동일) |
| 패널 open | listQuery focus refetch (TanStack default `refetchOnWindowFocus`로 충분) |
| 새 알림 수신 (server-push 또는 polling) | unreadCount 증가 → 종 뱃지 업데이트 |

> [PM-DECISION-9] **폴링 주기** — unreadCount 현재 30초. 이번 라운드 변경 없음. 실시간성이 더 필요하면 5분 짜리 별도 long-poll 채널 검토. R29 보수적 default = **30초 유지**.

## B.8 빈 상태

```
┌─────────────────────────────────────────┐
│           🔕                            │
│                                         │
│        새로운 알림이 없습니다.           │
└─────────────────────────────────────────┘
```

- 기존 `<BellOff>` icon 그대로.
- 필터가 "읽지 않음"이고 unread=0이면 텍스트 변경: `"읽지 않은 알림이 없습니다."` + 작은 보조 링크 `[전체 보기]`.

## B.9 컴포넌트 트리 + Props

```
<NotificationBell>                            // 기존 button + Popover
  <PopoverPanel align="end" side="bottom">
    <NotificationPanelBody                    // 신설 — 위 B.2 레이아웃
      filter={filter}
      onFilterChange={setFilter}
      pages={pages}
      unreadCount={unreadCount}
      isPending={listQuery.isPending}
      isError={listQuery.isError}
      hasNextPage={hasNextPage}
      onLoadMore={fetchNextPage}
      onItemClick={handleItemClick}            // mutation + navigate
      onMarkAllRead={handleMarkAllRead}        // mutation + optimistic
    />
  </PopoverPanel>
</NotificationBell>
```

기존 `<NotificationPanel>`(`components/notifications/NotificationPanel.tsx`)은 **삭제하지 않고** 시그니처만 위 props에 맞춰 확장. 다른 곳에서 import하는 자리(검색 결과 grep) 없으면 통째로 갈음 가능.

```ts
type NotificationFilter = 'all' | 'unread';

interface NotificationItem {
  id: string;
  type: string;            // OBJECT_CHECKIN, APPROVAL_REQUEST, etc.
  title: string;
  body?: string;
  ts: string;              // ISO
  read: boolean;
  objectId?: string;       // 있으면 클릭 시 /objects/{id} 이동
}

interface NotificationPanelBodyProps {
  filter: NotificationFilter;
  onFilterChange: (next: NotificationFilter) => void;
  pages: NotificationItem[][];                   // useInfiniteQuery pages
  unreadCount: number;
  isPending: boolean;
  isError: boolean;
  hasNextPage: boolean;
  onLoadMore: () => void;
  onItemClick: (item: NotificationItem) => void;
  onMarkAllRead: () => void;
}
```

## B.10 `handleItemClick` (디테일)

```ts
async function handleItemClick(item: NotificationItem) {
  // 1) optimistic local update
  if (!item.read) {
    markReadMutation.mutate(item.id);  // POST /api/v1/notifications/{id}/read
  }
  // 2) navigate if linked
  if (item.objectId) {
    setOpen(false);                    // close popover
    router.push(`/objects/${item.objectId}`);
  }
}
```

`markReadMutation`의 onMutate에서 list cache의 해당 row를 `read=true`로 업데이트 + unreadCount cache를 -1 (clamp 0). onError 시 롤백.

## B.11 접근성

- `<Popover>` 기반 → 자동 focus trap.
- 필터 탭은 의미적 `<Tabs>` 사용 (`role="tab"` + `aria-selected`).
- unread 뱃지는 시각 + `aria-label="읽지 않은 알림 3건"` (NotificationBell의 button aria-label에 이미 반영됨).
- 행은 `<button>` (활성 가능 영역 명확). 키보드 Up/Down으로 행 이동(브라우저 기본 Tab) — 추가 grid nav는 v1 범위 외.
- `read=false` 행은 `<span className="sr-only">읽지 않은 알림</span>` 추가 (이미 있음).
- "모두 읽음" disabled 시 disabled 시각 + `aria-disabled` 둘 다.

---

# C. 자료 thumbnail wiring — 권장 1곳

## C.1 두 후보 비교

### 후보 1: 자료 상세 페이지 InfoTab 첨부 list 행 좌측

**위치:** `apps/web/app/(main)/objects/[id]/page.tsx:1042-1140`(InfoTab 첨부파일 섹션). 각 첨부 row 좌측 16×16 `<FileText>` 또는 `M` 뱃지 자리에 **64×64 썸네일**을 prepend.

**장점:**
- 첨부가 N개일 때 어떤 게 마스터인지 시각적으로 즉시 구분.
- 64px 고정 크기 → cumulative layout shift 없음.
- 페이지 로드 빈도 = 자료 클릭 후 1회 → 네트워크 부하 낮음.
- `ConversionJob.thumbnailPath`가 있을 때만 노출되므로 fallback이 자연스러움 (M 뱃지 또는 FileText 아이콘 그대로 유지).

**단점:**
- 첨부 list가 갑자기 시각적으로 무거워짐 (현재 한 줄 컴팩트 row).
- 자료 상세까지 진입한 사용자에게는 마스터 첨부의 viewer 링크가 이미 있어 신규 가치가 작음.

### 후보 2: 검색 결과 카드/그리드 뷰 (`/search`)

**위치:** 현재 `/search`는 ObjectTable(테이블 뷰) + ObjectPreviewPanel(우측). 후보는 (a) 테이블 좌측에 32×32 inline 또는 (b) 그리드 카드 뷰 (2026-04 시점 카드 뷰는 미존재).

**장점:**
- 검색 결과 한눈에 어떤 도면인지 즉시 파악 — 가장 큰 UX 가치.
- ObjectPreviewPanel은 이미 `thumbnailUrl?` prop을 가지고 있고 `<DrawingPlaceholder>` fallback도 구현되어 있음 (`ObjectPreviewPanel.tsx:61-72`). 즉 **변경량이 가장 작음** — preview panel에 thumbnailUrl을 채워주는 한 줄짜리 wiring.

**단점:**
- 검색 결과 행 자체에는 썸네일 자리가 없음 → ObjectPreviewPanel(우측, 1행 hover/select 시 노출)에만 노출되므로 "한눈에 보기"는 1건씩만.

## C.2 권장: **ObjectPreviewPanel에 thumbnailUrl 와이어 + 자료 상세 InfoTab은 Phase 2**

**근거:**

1. **변경량 최소** — `ObjectPreviewPanel`에 이미 `thumbnailUrl?: string` prop과 `<img src={thumbnailUrl}>`가 있다. ObjectTable의 행 데이터(또는 row 어댑터)에서 `masterAttachmentId`로부터 `/api/v1/attachments/{id}/thumbnail` URL을 합성해 prop으로 전달하면 끝. 단 1곳, 단 1줄 + 데이터 흐름 셋업.
2. **사용자 가치/노출 면 조합 최적** — 검색 페이지는 이 시스템에서 사용자가 가장 자주 머무는 화면이며, preview panel은 마우스로 행을 누르는 자연 흐름에 등장.
3. **404 graceful fallback** — `<img>`의 onError로 `<DrawingPlaceholder>`로 fallback 가능. BE가 thumbnailPath=null이면 endpoint에서 `404 + 1x1 placeholder` 또는 default icon 응답. FE는 이를 onError로 잡아 placeholder 노출.
4. **자료 상세 InfoTab thumbnail은 Phase 2** — 가치는 있지만 "list가 무거워지는 문제"가 있고 R29의 V-INF-6은 "FE 부담 최소화"가 목적.

## C.3 wiring 디테일

### C.3.1 ObjectTable의 row 데이터에 thumbnail URL 합성

`ObjectRow`는 이미 `thumbnailUrl?: string` 필드를 갖는다 (`ObjectTable.tsx:51`).

```ts
// search/page.tsx 어댑터 (ServerObjectSummary → ObjectRow)
function adaptRow(s: ServerObjectSummary): ObjectRow {
  return {
    ...,
    thumbnailUrl: s.masterAttachmentId
      ? `/api/v1/attachments/${s.masterAttachmentId}/thumbnail`
      : undefined,
  };
}
```

`s.masterAttachmentId`가 null이면 thumbnailUrl도 undefined → ObjectPreviewPanel은 자동으로 `<DrawingPlaceholder>` 표시.

### C.3.2 `<AttachmentThumbnail>` (옵션, 신설 권장)

후보 1을 Phase 2에 진입할 때 재사용할 수 있도록, **현재 라운드에 미니 컴포넌트로 추출**:

```ts
// apps/web/components/attachments/AttachmentThumbnail.tsx
interface AttachmentThumbnailProps {
  attachmentId: string | null;
  size?: 32 | 48 | 64 | 128;
  alt?: string;
  className?: string;
  /** Render this when attachmentId is null OR image fails to load. */
  fallback?: React.ReactNode;
}

// 내부:
//   if (!attachmentId) return fallback ?? <DrawingPlaceholder/>
//   <img src={`/api/v1/attachments/${attachmentId}/thumbnail`}
//        loading="lazy" decoding="async"
//        onError={() => setFailed(true)} ... />
```

ObjectPreviewPanel은 이미 자체 `<img>`를 가지므로 `<AttachmentThumbnail>`로 갈음할지 여부는 frontend 재량 — 현재 동작에 차이 없으면 갈음 안 해도 됨. **다음 라운드 Phase 2에서 InfoTab 첨부 list에 적용 시** 이 컴포넌트를 그대로 씀.

### C.3.3 BE endpoint 응답과의 정합

`api_contract.md §5.2`:
- 응답 `image/png`, `Cache-Control: private, max-age=86400`. 없으면 404.
- 1x1 placeholder PNG fallback "선택" — frontend는 **404 시 `<img onError>`로 placeholder 표시**가 더 깔끔. BE는 그냥 404 반환을 권장 (캐시 의미가 명확).

> [PM-DECISION-10] BE가 404로 응답할지 1x1 placeholder PNG로 응답할지. 보수적 default = **404 + FE에서 onError → DrawingPlaceholder**.

## C.4 보안

- 썸네일은 **VIEW_FOLDER 권한이 있는 사용자만 접근 가능** (`api_contract.md §5.2`). admin은 모든 첨부 가능.
- ObjectPreviewPanel은 search 결과 행만 표시하고, search BE는 이미 권한 필터링된 자료만 반환 → URL을 직접 알아도 BE가 권한 검증 → 별도 FE 가드 불필요.

---

# D. 인터랙션 시퀀스 (텍스트 다이어그램)

## D.1 사용자 신규 생성

```
admin clicks [+ 사용자 추가]
  │
  ▼
setCreateOpen(true) → <UserFormDialog mode="create">
  │
admin fills:
  username = "kim.ji"
  fullName = "김지원"
  email = "kim.ji@dkc.co.kr"
  organizationId = "org_cgl1"
  role = "USER"
  employmentType = "ACTIVE"
  securityLevel = 3
  password = "TempPass!23"
  │
admin clicks [저장]
  │
  ▼
RHF zod 검증
  │ (실패 → 인라인 에러 표시, 종료)
  │
  ▼
useUserCreate.mutate(values)
  POST /api/v1/admin/users
  body: { username, fullName, email, organizationId, role,
          employmentType, securityLevel, password }
  │
  ├─ 200 → onSuccess
  │     ├─ toast emerald "사용자가 추가되었습니다 (kim.ji)"
  │     ├─ invalidate ['admin', 'users']
  │     └─ setCreateOpen(false)
  │
  ├─ 400 E_VALIDATION → 인라인 에러 (e.g. password too short)
  ├─ 409 E_CONFLICT (username 중복) → username 필드 에러
  │     "이미 사용 중인 사용자명입니다. 다른 이름을 선택하세요."
  ├─ 403 E_FORBIDDEN → toast rose
  └─ 5xx → toast rose persist + retry
```

## D.2 비밀번호 리셋 (자동 생성 모드)

```
admin clicks [⋮] → [🔑 비밀번호 리셋]
  │
  ▼
setResetTarget(user) → <PasswordResetDialog>
  │
admin toggles [자동 생성] (라디오 또는 체크박스 ON)
  │   → manual input 영역 hide
  │   → "12자 영숫자+기호 자동 생성" 안내 노출
  │
admin clicks [리셋]
  │
  ▼
useUserResetPassword.mutate({ id, generate: true })
  POST /api/v1/admin/users/{id}/reset-password
  body: { generate: true }
  │
  ├─ 200 → response.data.tempPassword = "Tk7$mQ9aPzR2"
  │     ├─ 다이얼로그 view를 "결과 view"로 swap
  │     ├─ 평문을 mono large field에 노출 + [📋 복사] 버튼
  │     ├─ "안전한 채널로 전달했습니다" 체크박스 (필수)
  │     ├─ [닫기]는 체크박스 ON일 때만 enable
  │     └─ 닫기 시 dialog state reset (다음 호출 시 평문 X)
  │
  ├─ 403 E_FORBIDDEN → toast rose
  ├─ 404 E_NOT_FOUND → toast rose "사용자를 찾을 수 없습니다"
  └─ 5xx → toast rose persist
```

## D.3 잠금 해제

```
admin sees amber row (LOCKED) for "kim.ji"
admin clicks [⋮] → [🔓 잠금 해제]
  │
  ▼
setUnlockTarget(user) → <UserUnlockDialog>
  │
admin clicks [잠금 해제]
  │
  ▼
useUserUnlock.mutate(user.id)
  POST /api/v1/admin/users/{id}/unlock
  │
  ├─ 200 → onSuccess
  │     ├─ toast emerald "잠금이 해제되었습니다 (kim.ji)"
  │     ├─ invalidate ['admin', 'users']  (리스트의 lockStatus 갱신)
  │     │     → 행이 normal 시각으로 변경
  │     └─ setUnlockTarget(null)
  │
  ├─ 403 → toast rose
  ├─ 404 → toast rose "사용자를 찾을 수 없습니다"
  └─ 5xx → toast rose persist
```

## D.4 NotificationPanel mark-read (행 클릭)

```
user opens 종 popover → NotificationPanelBody open
  │
  ▼
useInfiniteQuery(['notifications', 'all']) fires
  GET /api/v1/notifications?limit=30
  → renders rows (some read=false)
  │
unreadCountQuery already loaded → header [3] 뱃지
  │
user clicks notification row "결재 요청이 도착했습니다"
  item = { id: 'nt_5G', objectId: 'obj_8w', read: false, ... }
  │
  ▼
handleItemClick(item)
  │
  ├─ if (!item.read):
  │     markReadMutation.mutate(item.id)
  │     POST /api/v1/notifications/nt_5G/read
  │
  │     onMutate (optimistic):
  │       - update list cache: this row.read = true
  │       - update unreadCount cache: count - 1
  │
  │     ├─ 200 → no-op (이미 optimistic)
  │     ├─ 404 → 롤백 + toast rose "이미 삭제된 알림입니다"
  │     └─ 5xx → 롤백 + toast rose "알림 처리 실패 [재시도]"
  │
  └─ if (item.objectId):
        setOpen(false)              // popover close
        router.push(`/objects/${item.objectId}`)
```

## D.5 NotificationPanel mark-all-read

```
user clicks [모두 읽음]
  │
  ▼
handleMarkAllRead()
  │
markAllReadMutation.mutate()
  POST /api/v1/notifications/read-all
  │
  onMutate (optimistic):
    - 모든 list cache row.read = true
    - unreadCount cache = 0
  │
  ├─ 200 → response.data.updatedCount = N
  │     ├─ (선택) toast emerald "${N}건 처리 완료" — v1은 토스트 생략
  │     │       (시각 피드백 충분)
  │     └─ refetch invalidate
  │
  ├─ 403 → 롤백 + toast rose
  └─ 5xx → 롤백 + toast rose persist + retry
```

---

# E. PM 결정 필요 항목

| # | 항목 | 보수적 default (frontend 채택) | 결정자 |
|---|---|---|---|
| 1 | 역할/상태 필터를 FE 클라이언트 필터 vs BE 쿼리 | **FE 클라이언트 필터** (사용자 ≤ 200명 가정) | PM |
| 2 | 비밀번호 검증 정책 | **8자 이상 + 영문/숫자/기호 중 2종 이상** | PM (보안 정책) |
| 3 | 본인 강등 후 redirect 시점 | **router.refresh() 후 layout-level redirect에 위임** | PM |
| 4 | 자동 생성 임시 비밀번호 정책 | **12자 영숫자(a-zA-Z0-9) + 특수기호 1자 이상 보장. 0/O/o, 1/l/I 제외** | PM (+ BE) |
| 5 | UserDeactivateDialog confirm 강도 | **사용자명 입력 일치** (강함). 너무 강하면 체크박스 1개로 변경 | PM |
| 6 | (사용 안 함 — 스펙 정리상 비워둠) | — | — |
| 7 | NotificationPanel "읽지 않음" 탭에서 행 클릭 후 동작 | **그 자리에 둠** (굵기만 일반으로). 즉시 fade-out 안 함 | PM |
| 8 | NotificationPanel body 줄 수 | **1줄 truncate** (panel 폭 380 좁음) | PM |
| 9 | NotificationBell 폴링 주기 | **30초 유지** (변경 없음) | PM |
| 10 | thumbnail endpoint missing 시 BE 응답 | **404 + FE에서 onError → DrawingPlaceholder fallback** | PM (+ BE/Viewer) |
| 11 | 비활성(deletedAt set) 사용자 default 노출 | **숨김** (상태 필터에서 비활성/전체 선택 시만 노출) | PM |
| 12 | UserMenu에서 본인 행 시각 | **`<UserCog>` 아이콘 + "본인 계정" tooltip** | PM |

---

# F. 디자인 토큰 / 컬러 (변경 없음)

기존 Tailwind palette + DESIGN.md 토큰만으로 표현 가능:

- amber-50/200/400/700 — LOCKED 행, 본인 강등 경고
- rose-50/200/400/500/700 — 비활성화 버튼, SUPER_ADMIN 뱃지
- emerald-50/300/400/700 — 성공 토스트, 재직 뱃지
- violet-50/700 — PARTNER 뱃지
- slate-100/300/400/700 — 비활성 행 회색
- brand-500 — primary CTA, focus ring, NotificationPanel unread dot

신규 토큰 없음. R28 §E의 선택적 `.status-tint-*` utility는 본 라운드와 무관.

---

# G. 반응형 (Desktop only, ≥1280)

| 영역 | 1280 | 1440 | 1920 |
|---|---|---|---|
| AdminSidebar | 240 | 240 | 240 |
| Users Main | fluid | fluid | fluid |
| UserManagementTable | 9 컬럼 fit (총 ~990) | fit | 여유 |
| NotificationPanel | 380×680 popover | 380×680 | 380×680 |

UserManagementTable은 1280에서도 9컬럼이 들어감 (240 + ~990 = 1230 + padding). 만약 좁아지면 이메일 컬럼 truncate + 조직 컬럼 hide [1024 이하] — 단 Desktop only라 미고려.

NotificationPanel은 popover라 어떤 viewport에서도 동일 380×680.

<1280 fallback: 페이지 자체는 동작하나 가로 스크롤 발생. 명시적 차단 안 함 (사용자 1~3명만 사용하는 admin 화면 — 실수 위험 낮음).

---

# H. Frontend Verification Checklist

## H.1 /admin/users

- [ ] AdminSidebar에서 "사용자" 활성 표시 정확
- [ ] 빈 상태 / 검색 0건 / 에러 / 로딩 분기 정확
- [ ] 검색 input 400ms debounce + URL sync (`?q=`)
- [ ] 역할/상태 필터 동작 + URL sync 또는 클라이언트 필터 동작
- [ ] 행 시각 — LOCKED amber bg, 비활성 회색 strikethrough, 본인 행 아이콘
- [ ] `[+ 사용자 추가]` 클릭 → UserFormDialog open
- [ ] 폼 검증 (username regex, password 정책, email 형식, securityLevel 1~5)
- [ ] 사용자 추가 성공 토스트 + 리스트 갱신
- [ ] username 중복 시 인라인 에러
- [ ] `[⋮] [✏ 수정]` → UserFormDialog edit + initial 채움 + username disabled
- [ ] 본인 강등 시 amber 경고 + 추가 ConfirmDialog
- [ ] SUPER_ADMIN 행은 ADMIN 세션에서 수정/비활성 disabled + tooltip
- [ ] `[⋮] [🔓 잠금 해제]` (LOCKED만) → 단순 confirm
- [ ] `[⋮] [🔑 비밀번호 리셋]` → 직접 입력 / 자동 생성 두 모드 동작
- [ ] 자동 생성 응답에 평문 1회 노출 + 복사 버튼 + 체크박스 후 닫기
- [ ] `[⋮] [🚫 비활성화]` → 사용자명 일치 입력 후 confirm
- [ ] 본인 행은 비활성화 영구 disabled
- [ ] 무한 스크롤 cursor 동작
- [ ] 키보드만으로 모든 동작 가능
- [ ] 다크모드 명도대비 OK

## H.2 NotificationPanel

- [ ] 헤더 unread 뱃지가 실제 endpoint(`/notifications/unread-count`) 반영
- [ ] [모두 읽음] 클릭 → optimistic 모든 행 read=true + 뱃지 0
- [ ] 행 클릭 → `markRead` mutation + (objectId 있으면) `/objects/{id}` 라우팅
- [ ] read=false: dot brand + 굵은 글씨, read=true: dot 투명 + 옅은 글씨
- [ ] 필터 [전체 / 읽지 않음] 토글 동작 + 캐시 분리
- [ ] 무한 스크롤 동작 + 끝 메시지
- [ ] 빈 상태 — 전체 vs 읽지 않음 분기 카피 다름
- [ ] mark-read 실패 시 롤백 + 토스트
- [ ] 폴링 30초 유지
- [ ] 키보드 Tab으로 행 이동 + Enter로 클릭

## H.3 자료 thumbnail

- [ ] /search 결과 hover/select 시 ObjectPreviewPanel에 thumbnail 노출
- [ ] thumbnail 404일 때 `<DrawingPlaceholder>` fallback
- [ ] masterAttachmentId가 null이면 자동 placeholder
- [ ] `<img loading="lazy" decoding="async">` 적용
- [ ] Cache-Control 적중 — 같은 자료 재방문 시 네트워크 재요청 없음

## H.4 공통

- [ ] api_contract.md (§3, §4, §5.2) 필드명/응답 shape 일치
- [ ] AdminSidebar 그룹 구조 변경 없음 (RSC/CSR 경계 BUG-02 회귀 없음)
- [ ] sonner 토스트 (`@/components/ui/toast` 또는 sonner 직접)
- [ ] 다크모드 양쪽 검증

---

# 부록 X. 의존하는 BE Contract (R29 카드 §3, §4, §5.2 그대로)

`_workspace/api_contract.md`가 single source of truth. 다음 항목만 디자인 측에서 명시 의존:

### X.1 Users (§4)
- `GET /api/v1/admin/users?limit=&cursor=&q=` — 응답에 `lockStatus: 'NONE'|'LOCKED'` 합성 필수
- `POST /api/v1/admin/users` — body §A.6.2 표
- `GET /api/v1/admin/users/{id}` — 본 라운드 FE는 list-only로 충분, detail endpoint는 차후
- `PATCH /api/v1/admin/users/{id}` — passwordHash 제외
- `POST /api/v1/admin/users/{id}/unlock`
- `POST /api/v1/admin/users/{id}/reset-password` — body `{ tempPassword?: string, generate?: boolean }`. generate=true 응답에 `data.tempPassword` 평문 포함
- `DELETE /api/v1/admin/users/{id}` — soft delete

### X.2 Notifications (§3)
- `GET /api/v1/notifications?cursor=&limit=&unreadOnly=` — 응답 shape:
  ```json
  { "ok": true, "data": [{ "id", "type", "title", "body", "objectId", "ts", "read" }], "meta": { "nextCursor", "unreadCount" } }
  ```
  > **주의**: 본 spec의 `<NotificationPanelBodyProps.unreadCount>`는 별도 endpoint `/unread-count`에서 가져오므로 list 응답의 `meta.unreadCount`는 옵션. BE가 둘 다 보내도 무방.
- `POST /api/v1/notifications/{id}/read`
- `POST /api/v1/notifications/read-all` — `data.updatedCount`
- `GET /api/v1/notifications/unread-count` — `data.count`

### X.3 Thumbnail (§5.2)
- `GET /api/v1/attachments/{id}/thumbnail` — `image/png`, `Cache-Control: private, max-age=86400`. 없으면 404 (FE가 onError로 fallback).

---

(끝)
