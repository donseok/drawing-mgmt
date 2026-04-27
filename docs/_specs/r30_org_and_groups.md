# R30 Design Spec — 조직 트리 admin (U-3) + 그룹/사용자 매트릭스 admin (U-4)

| 항목 | 내용 |
|---|---|
| 작성자 | drawing-mgmt designer agent (R30) |
| 작성일 | 2026-04-27 |
| 기준 main HEAD | `4e597ae` |
| 대상 라운드 | R30 |
| 대상 카드 | U-3 조직 트리 admin, U-4 그룹/사용자 매트릭스 admin |
| 의존 (BE) | `_workspace/api_contract.md` §3 (조직 endpoints), §4 (그룹 endpoints), §6 (FE 페이지 요약) |
| 신규 페이지 | `/admin/organizations`, `/admin/groups` |
| 신규 컴포넌트 | `<OrganizationTree>`, `<OrganizationDetailPanel>`, `<OrgEditDialog>`, `<OrgDeleteDialog>`, `<GroupListPanel>`, `<GroupMembershipMatrix>`, `<GroupEditDialog>`, `<GroupDeleteDialog>` |
| 수정 컴포넌트 | (없음) |
| 디바이스 | Desktop only (≥1280). 좁으면 read-only fallback 배너. |
| 디자인 토큰 변경 | 없음 (R28/R29 토큰 그대로) |

---

## 0. 라운드 개요

### 0.1 두 카드를 한 spec에 묶는 이유

- 둘 다 **AdminSidebar `사용자 / 조직`** 그룹의 마지막 빈칸이다 (`admin-groups.ts` 38~39행에 이미 `/admin/organizations`, `/admin/groups` 메뉴가 정의됨). R29에서 `/admin/users`가 채워졌고 이번 라운드에서 같은 그룹 내 두 형제가 마저 채워진다.
- 두 페이지 모두 **principal 관리** 영역이다. R28 `/admin/folder-permissions` 매트릭스가 USER/ORG/GROUP 행에 권한 비트를 부여하는 화면이라면, R30은 그 USER/ORG/GROUP 자체를 관리한다. 즉 권한 매트릭스에 들어갈 "재료"를 빚는 화면.
- 두 화면 모두 **두 패널 레이아웃**이고 두 모델 모두 R28 패턴(좌측 식별자 list/tree → 우측 편집)으로 흡수 가능. `/admin/organizations`는 트리 + 상세, `/admin/groups`는 list + 멤버십 매트릭스.

### 0.2 페르소나 시나리오

| 시나리오 | 페르소나 | 흐름 |
|---|---|---|
| 신규 부서 "냉연 3팀" 신설 | 슈퍼관리자 | `/admin/organizations` → 좌측 트리에서 `냉연사업부` 선택 → `[+ 자식 조직]` → 이름 입력 → 저장 |
| 부서 통폐합: "압연 1팀" 폐지, 인원을 "압연팀"으로 이전 | 슈퍼관리자 | 사용자 페이지(`/admin/users`)에서 인원 organizationId 변경 → `/admin/organizations`에서 빈 부서 삭제. 빈 부서가 아닐 때 삭제 버튼이 disabled되어 안전. |
| 부서 정렬 변경: "냉연 1팀"을 "냉연 2팀" 위로 | 관리자 | 상세 패널 `[↑]` 버튼 클릭 또는 형제 영역에서 드래그(보류, PM 결정) |
| 신규 그룹 `cgl-2-editors` 생성 + 5명 추가 | 슈퍼관리자 | `/admin/groups` → `[+ 그룹 추가]` → 이름·설명 입력 → 좌측 list에서 새 그룹 선택 → 우측 매트릭스에서 5명 체크 → `[저장]` |
| 협력업체 `홍성기계` 1명 입사 → 기존 `partner-vendors` 그룹에 추가 | 관리자 | `/admin/groups` → `partner-vendors` 선택 → 검색 "홍성" → 체크 → 저장 |
| 그룹 일괄 갱신: 변환 자동화 그룹 정원 변경 | 관리자 | 그룹 선택 → 매트릭스에서 컬럼 헤더 토글로 모두 해제 후 신규 인원 체크 → 저장. "변경된 N건"으로 즉시 차이 가시화. |

### 0.3 디자인 토큰 / 컴포넌트 재사용

| R28/R29 자산 | R30 활용 |
|---|---|
| `<AdminSidebar>` | 양쪽 페이지 좌측 (활성 indicator만 다름) |
| `<SubSidebar>` | 조직 페이지 트리 컬럼, 그룹 페이지 그룹 list 컬럼 |
| R28 dirty/new/removed `border-l-2` + 배지 시각 | 그룹 매트릭스 행 상태 (체크/언체크 차이를 amber로 표기) |
| R28 `▴N 변경` 카운터 + Layer 1/2/3 unsaved guard | 그룹 매트릭스 그대로 차용 |
| R29 `<UserManagementTable>`의 행 hover 패턴, mono username, RoleBadge | 매트릭스 사용자 행 보조 라벨 |
| R29 `<UserFormDialog>`의 RHF+Zod inline error, helper text 위치 | OrgEditDialog / GroupEditDialog 동일 패턴 |
| R29 `<UserDeactivateDialog>`의 username 일치 입력 강한 confirm | (사용 안 함 — 조직/그룹은 `자식/멤버 있음` 가드만으로 충분) |
| `<EmptyState>`, `<Skeleton>`, `<Button>`, shadcn `<Dialog>`/`<Select>` | 표준 사용 |

---

# A. /admin/organizations — 조직 트리 관리

## A.1 라우트 + AdminSidebar

- **Route:** `/admin/organizations` (이미 `admin-groups.ts:38`에 등록됨, `Building2` 아이콘, "조직 트리 관리" description)
- **권한:** SUPER_ADMIN / ADMIN. 그 외 layout-level guard로 `/`로 redirect.
- **AdminSidebar 변경:** 없음. 단 description을 `'조직 트리 관리'`(현행) 그대로 둔다 — "조직 관리"보다 "조직 트리"가 의도(계층 편집)를 더 잘 전한다.

## A.2 레이아웃 — 3-pane (R28 folder-permissions와 동일 골격)

```
┌─ Header (글로벌, 56px) ─────────────────────────────────────────────────┐
│NavRail│ AdminSidebar  │ OrganizationTree    │ OrganizationDetailPanel    │
│ 56px  │   240px        │   280px              │   fluid (≥720)             │
│       │               │                      │                            │
│       │ ▼ 사용자/조직 │ ▼ 동국씨엠 (root)    │ ┌─ Header (sticky) ──────┐ │
│       │   • 사용자     │   ▼ 냉연사업부        │ │ 동국씨엠 / 냉연사업부 │ │
│       │   • 조직 ←active │   ▼ 압연팀          │ │   / 냉연 1팀  [✏] [⋮] │ │
│       │   • 그룹       │     • 냉연 1팀 ●     │ ├────────────────────────┤ │
│       │               │     • 냉연 2팀       │ │ ┌─ 기본 정보 ─────────┐│ │
│       │ ▼ 폴더/권한    │   ▶ 도금사업부        │ │ │ ID: org_abc        ││ │
│       │   ...          │ ▶ IT팀                │ │ │ 부모: 압연팀         ││ │
│       │               │ ▶ 협력업체            │ │ │ 정렬 순서: 1 [↑][↓] ││ │
│       │               │                      │ │ │ 자식: 0개            ││ │
│       │               │ [+ 최상위 조직 추가]  │ │ │ 소속 사용자: 7명     ││ │
│       │               │                      │ │ └─────────────────────┘│ │
│       │               │                      │ │ ┌─ 자식 조직 ─────────┐│ │
│       │               │                      │ │ │ (0개) [+ 자식 조직] ││ │
│       │               │                      │ │ └─────────────────────┘│ │
│       │               │                      │ │ ┌─ 소속 사용자 (7명) ─┐│ │
│       │               │                      │ │ │ • 박영호 (USER)     ││ │
│       │               │                      │ │ │ • 김지원 (USER)     ││ │
│       │               │                      │ │ │ ... [모두 보기 →]   ││ │
│       │               │                      │ │ └─────────────────────┘│ │
│       │               │                      │ └────────────────────────┘ │
└───────┴───────────────┴──────────────────────┴────────────────────────────┘
```

- **AdminSidebar (240px)** — `<AdminSidebar />` 그대로 활성 = `/admin/organizations`.
- **OrganizationTree (280px, `<SubSidebar title="조직 트리">`)** — 자체 `<OrganizationTree>` 컴포넌트(아래 §A.3). 트리 하단에 sticky `[+ 최상위 조직 추가]` 버튼. 선택된 조직은 `bg-brand/10` 강조, 같은 부모의 형제 사이는 visual gap 없음(트리는 명확).
- **OrganizationDetailPanel (fluid, min-width 480)** — 선택된 조직 1개의 상세. 조직 미선택 시 `<EmptyState icon={Building2}>` "왼쪽 트리에서 조직을 선택해 편집하세요". 폭이 넓은 이유: 미래에 조직 단위 권한 일괄 부여 등 확장 여지 (현 라운드는 §A.4 카드 3종만).

> [PM-DECISION-1] **조직 트리는 통상 깊이 ≤ 3 (회사 → 사업부 → 팀)이라 우측 패널이 과한가?** 보수적 default = **3-pane 유지** — 일관성(R28 folder-permissions와 같은 골격), 미래 확장(상세 카드 추가) 우선. PM이 "단일 컬럼이 더 빠르다" 판단 시 단순화 가능. 본 spec은 3-pane 가정.

## A.3 OrganizationTree (좌측)

### A.3.1 시각

```
▼ 동국씨엠                        20
  ▼ 냉연사업부                     12
    ▼ 압연팀                        7
      • 냉연 1팀  ●선택              4
      • 냉연 2팀                    3
    ▶ 도금사업부                     5
  ▶ IT팀                           3
  ▶ 협력업체                        5
```

- 행 높이 28px, 들여쓰기 12px/depth. `<ChevronRight>` rotate 90 expand. 폴더 트리(`FolderTree.tsx`)와 동일 시각 언어.
- 좌측 아이콘 `<Building2 className="h-4 w-4 text-fg-muted">` (root는 brand). 선택 시 `bg-brand/10`. 호버 시 `bg-bg-muted`.
- 우측 `tabular-nums text-xs text-fg-muted`로 **소속 user count** (직속만, 자식 합산 X).
- `aria-label="냉연 1팀 조직, 4명 소속"` (FolderTree와 동일 패턴).
- 키보드: `Enter`/`Space` = 선택, `ArrowDown`/`Up` = 인접 행 focus, `ArrowRight` = expand, `ArrowLeft` = collapse, `Home`/`End` = 첫/마지막 행.

### A.3.2 트리 구조 도출 (FE adapter)

GET `/api/v1/admin/organizations`는 flat array `[{ id, name, parentId, sortOrder, userCount, childCount }]`. FE에서 트리 구성:

```ts
function buildTree(rows: AdminOrganization[]): OrganizationTreeNode[] {
  const byId = new Map(rows.map((o) => [o.id, { ...o, children: [] as OrganizationTreeNode[] }]));
  const roots: OrganizationTreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // sortOrder 오름차순 (같으면 name 한글 collation)
  const sortRec = (xs: OrganizationTreeNode[]) => {
    xs.sort((a, b) =>
      a.sortOrder === b.sortOrder ? a.name.localeCompare(b.name, 'ko') : a.sortOrder - b.sortOrder,
    );
    xs.forEach((x) => sortRec(x.children));
  };
  sortRec(roots);
  return roots;
}
```

### A.3.3 reorder 인터랙션 — **↑↓ 버튼 권장 (드래그 보류)**

> [PM-DECISION-2] **드래그 reorder vs ↑↓ 버튼.** 디자이너 권장 = **↑↓ 버튼** (v1).
> 이유:
> 1. **명확성**: 부모 변경(드롭 위치 = 다른 부모의 자식이 됨)과 형제 정렬(드롭 위치 = 같은 부모 안 sortOrder 변경)이 한 제스처에 섞이면 사고가 잦다. R28 권한 매트릭스도 dragger 없음.
> 2. **API 정합**: contract §3.5 `POST /admin/organizations/reorder`가 `{ parentId, ids[] }` — 같은 부모 형제 일괄 sortOrder 갱신 전용. 부모 변경은 §3.3 `PATCH /:id { parentId }` 별도. 드래그 UX는 두 endpoint를 한 제스처로 묶어야 해서 backend rollback도 까다롭다.
> 3. **사용 빈도**: 조직 reorder는 신설/통폐합 직후 드물게. 드래그의 속도 이득이 미미.
>
> 만약 PM이 드래그를 우선시하면 "**같은 부모 안에서만** 드래그 reorder, 부모 변경은 상세 패널의 `<ParentSelect>`로만"으로 분리해 §3.5/§3.3 구분 유지. 본 spec은 ↑↓ 버튼 가정.

상세 패널 `정렬 순서: N [↑] [↓]` 형태(§A.5.2 참조).
- `[↑]` 클릭: 같은 부모 형제 중 현재 인덱스 i → i-1. 첫째면 disabled.
- `[↓]` 클릭: 같은 부모 형제 중 i → i+1. 막내면 disabled.
- 동작: 클라이언트 측에서 형제 array의 ids 순서를 바꾼 후 `POST /admin/organizations/reorder` `{ parentId, ids }`. optimistic 갱신.
- 실패 시 rollback + toast rose `"정렬 변경 실패: <error>"`.

## A.4 트리 컬럼 액션 — `[+ 최상위 조직 추가]` (sticky bottom)

```
┌──────────────────────────────────┐
│ (트리 본문 scroll)                │
│ ...                               │
├──────────────────────────────────┤
│  [+ 최상위 조직 추가]             │  ← sticky
└──────────────────────────────────┘
```

- 트리 컬럼 푸터에 sticky 버튼. 클릭 시 `<OrgEditDialog mode="create" parentId={null}>`.
- 자식 추가는 우측 상세 패널의 `[+ 자식 조직]` 버튼으로 (§A.5.3) — 부모 컨텍스트가 명시적.

## A.5 OrganizationDetailPanel (우측)

### A.5.1 헤더

```
┌──────────────────────────────────────────────────────────────┐
│ 동국씨엠 / 냉연사업부 / 압연팀 / 냉연 1팀     [✏ 편집] [⋮]   │
└──────────────────────────────────────────────────────────────┘
```

- breadcrumb: mono `font-mono text-[12px] text-fg-muted`. 마지막 노드 `text-fg font-medium`. 길면 `truncate` (path 길이 제한 없으니 horizontal scroll은 패널 자체 overflow-x-auto로 보호).
- `[✏ 편집]` = `<OrgEditDialog mode="edit" target={selected}>` open.
- `[⋮] DropdownMenu`:
  - `🗑 삭제` — `<OrgDeleteDialog>` open. 자식 또는 user 있으면 disabled + tooltip "자식 조직이 있어 삭제할 수 없습니다" / "소속 사용자가 있어 삭제할 수 없습니다" (둘 다면 `자식 조직과 소속 사용자가 있어`).

### A.5.2 카드 1 — 기본 정보

```
┌─ 기본 정보 ─────────────────────────────────────────────────┐
│  ID                org_3F8e2KqA                              │
│  이름              냉연 1팀                                   │
│  부모 조직         압연팀  [↗ 선택]                            │
│  정렬 순서         1 / 2  [↑ 위로] [↓ 아래로]                  │
│  생성일            2025-11-12                                  │
│  자식 조직         0개                                         │
│  소속 사용자       7명                                         │
└─────────────────────────────────────────────────────────────┘
```

- `ID` mono `text-[11px] text-fg-subtle` + click-to-copy (호버 시 `<Copy>` 아이콘 노출).
- `부모 조직` 셀의 `[↗ 선택]` 클릭 → 부모 변경 모달 (간이 organization picker — Tree에서 한 노드 선택. 자기 자신 + 후손은 disable). 최상위로 보내려면 picker 상단 `[(없음 — 최상위)]` row.
- `정렬 순서` 표시: `현재 인덱스 / 형제 수` (1-indexed). `[↑]` 첫째면 disabled, `[↓]` 막내면 disabled.
- `자식 조직`/`소속 사용자` 카운트는 BE 합성. 숫자에 하이퍼링크: 자식 조직 → 트리에서 expand. 소속 사용자 → 카드 3로 스크롤 또는 `/admin/users?organizationId=...`로 navigate.

### A.5.3 카드 2 — 자식 조직

```
┌─ 자식 조직 (3개) ──────────────────────────────────────────┐
│ • 냉연 1팀                       4명                        │
│ • 냉연 2팀                       3명                        │
│ • 냉연 3팀                       0명                        │
│                                       [+ 자식 조직 추가]    │
└────────────────────────────────────────────────────────────┘
```

- 자식 list (현재 선택된 조직의 직속 자식만). 행 클릭 = 트리에서 그 자식 선택.
- 빈 상태: `(0개) [+ 자식 조직 추가]`.
- `[+ 자식 조직 추가]` 클릭 → `<OrgEditDialog mode="create" parentId={selected.id}>`.

### A.5.4 카드 3 — 소속 사용자 (직속만, 자식 합산 X)

```
┌─ 소속 사용자 (7명) ─────────────────────────────────────────┐
│ 👤 박영호 (park.yh)         USER     재직                    │
│ 👤 김지원 (kim.ji)          USER     재직                    │
│ 👤 이관리 (adm.lee)         ADMIN    재직                    │
│ 👤 최정아 (choi.ja)         USER     재직                    │
│ 👤 정신입 (jung.new)        USER     재직                    │
│                              [모두 보기 (7명) →]             │
└────────────────────────────────────────────────────────────┘
```

- 행: `<UserCell>` (R29 §A.4.1의 사용자명 패턴 압축). hover bg-bg-muted, 클릭 시 `/admin/users?q=<username>` (R29 검색 URL sync 기존 패턴 재사용 — 사용자 페이지에서 정확히 한 명만 보임).
- list 길이가 5명 초과면 처음 5명 + `[모두 보기 (N명) →]` 링크 (=`/admin/users?organizationId=<id>`).
- BE 합성 소스 부재(현 contract는 userCount만 노출): 이 카드를 **별도 `GET /api/v1/admin/users?organizationId=<id>&limit=6`** 사용. 이미 R29에서 admin users list에 `organizationId` 필터가 있을 것 — 없으면 backend agent 질의 필요.

> [PM-DECISION-3] **카드 3을 본 라운드에 포함할지.** 보수적 default = **포함** (조직 페이지의 핵심 가시성 — "이 부서에 누가 있나"). BE에 `organizationId` 필터가 미구현이면 카드 3 텍스트만 `(7명) — 사용자 페이지에서 확인하세요 [→]` 형태 fallback. **PM이 BE에 추가 작업을 시키기 싫다면 fallback을 디폴트로 두고 후속 라운드에서 정식 카드로 승격**.

## A.6 OrgEditDialog — 신규/수정 (480×auto)

### A.6.1 레이아웃

```
┌─ 조직 추가 / 수정 ───────────────────────────[✕]┐
│  조직 이름*                                       │
│  [냉연 1팀                                    ]  │
│  · 1~50자. 같은 부모 안에서 중복 불가.            │
│                                                   │
│  부모 조직                                        │
│  [압연팀                                    ▼ ]  │
│  · 변경하면 자식 조직과 사용자가 함께 이동합니다. │
│  · 자기 자신 또는 자손은 부모로 선택할 수 없습니다.│
│                                                   │
│  정렬 순서                                        │
│  [1                                            ]  │
│  · 같은 부모 안 형제들의 정렬 순서. 비워두면 끝에  │
│    추가됩니다.                                    │
│                                                   │
│  [취소]                              [저장]       │
└──────────────────────────────────────────────────┘
```

### A.6.2 필드 사양

| 필드 | mode='create' | mode='edit' | 검증 (Zod) |
|---|---|---|---|
| `name` | 필수 | 가능 | `.min(1).max(50)` (한글 trim 후) |
| `parentId` | option select (default = caller-prefilled `parentId`) | 가능. 자기 / 후손은 옵션에서 제외 | uuid optional, null 허용(최상위) |
| `sortOrder` | optional, 빈 값이면 BE가 max+1 | optional, 빈 값이면 변경 안 함 | int ≥ 0 optional |

> [PM-DECISION-4] **mode='edit'에서 `parentId` 변경 허용?** 보수적 default = **허용 — 단 ConfirmDialog 한 번 더**. 부모 변경은 자식·user를 통째로 옮기는 큰 변경. 저장 클릭 시:
>
> ```
> ┌─ 조직 이동 ──────────────────────────[✕]┐
> │  냉연 1팀을 다음 부모로 이동합니다:       │
> │                                          │
> │   현재: 동국씨엠 / 냉연사업부 / 압연팀    │
> │   변경: 동국씨엠 / 냉연사업부 / 도금팀    │
> │                                          │
> │  · 자식 조직 0개와 소속 사용자 7명이      │
> │    함께 이동합니다.                       │
> │                                          │
> │  [취소]                      [이동 진행]  │
> └──────────────────────────────────────────┘
> ```
>
> default focus = `취소`. PM이 부담스러우면 mode='edit'에서 parentId를 read-only(이동은 별도 모달)로 두고 분리할 수 있다.

### A.6.3 부모 select 옵션 트리

`<ParentSelect>`는 단순 `<Select>` 평면 옵션이 아니라 트리 들여쓰기 형태:

```
[(없음 — 최상위)]
    동국씨엠
        냉연사업부
            압연팀
            도금팀
        IT팀
    (협력업체 — 자기 자신, disabled)
```

- 선택된 조직(mode='edit')과 그 후손은 `disabled` + `text-fg-subtle line-through` (cycle 방지).
- 들여쓰기 `padding-left: 12 + depth*12 px`.
- Combobox 검색 (이름 substring): `<Command>` shadcn 패턴. 단 R28 `<PrincipalPicker>` 패턴으로 가도 무방.

### A.6.4 검증/저장 흐름

```
[저장] 클릭
  → RHF zod 검증 → 인라인 에러
  → mode='create' → POST /api/v1/admin/organizations
     mode='edit'  → PATCH /api/v1/admin/organizations/{id}
       (parentId 변경 시 §A.6.2 ConfirmDialog 1차 통과 후)
  → 200 → toast emerald
        ├ create: "조직이 추가되었습니다 (냉연 1팀)"
        └ edit:   "변경사항이 저장되었습니다 (냉연 1팀)"
       → invalidate ['admin', 'organizations', 'tree']
       → 다이얼로그 닫기
       → mode='create' && parentId 있음 → 트리에서 새 조직 선택
  → 400 E_VALIDATION → 인라인 (`details.fieldErrors.name` 등)
  → 409 E_CONFLICT (이름 중복) → name 필드에 "같은 부모 안에서 이미 사용 중인 이름입니다"
  → 409 E_STATE_CONFLICT (cycle) → toast rose "선택한 부모는 자신의 후손이라 이동할 수 없습니다"
  → 404 → toast rose "조직이 삭제되었습니다. 트리를 새로고침하세요."
  → 403 → toast rose "권한이 부족합니다."
```

## A.7 OrgDeleteDialog — 삭제 confirm

### A.7.1 삭제 가능한 경우 (자식 0, user 0)

```
┌─ 조직 삭제 ─────────────────────────────────[✕]┐
│  냉연 3팀 조직을 삭제합니다.                    │
│                                                 │
│  · 자식 조직 0개, 소속 사용자 0명                │
│  · 정렬 순서가 형제들 사이에서 자동 재계산됩니다.│
│                                                 │
│  [취소]                              [삭제]      │
└────────────────────────────────────────────────┘
```

default focus = `취소`. `[삭제]` rose. 200 → toast emerald `"조직이 삭제되었습니다"` + invalidate.

### A.7.2 삭제 불가한 경우 (자식 또는 user 있음)

상세 패널의 `[⋮ → 🗑 삭제]` 메뉴 항목 자체가 disabled + tooltip:

| 조건 | tooltip |
|---|---|
| 자식 조직 N개 | `자식 조직 N개를 먼저 삭제하거나 다른 부모로 이동하세요.` |
| 소속 사용자 N명 | `소속 사용자 N명을 먼저 다른 조직으로 옮기거나 비활성화하세요.` |
| 둘 다 | `자식 조직 N개와 소속 사용자 M명이 있어 삭제할 수 없습니다.` |

만약 사용자가 어떻게든 호출해 BE가 `E_STATE_CONFLICT` (`details.reason: 'HAS_CHILDREN' | 'HAS_USERS'`)를 반환하면, dialog는 안내 모드로 전환:

```
┌─ 삭제할 수 없습니다 ────────────────────────[✕]┐
│  ⚠️ 압연팀 조직은 다음 항목이 있어 삭제할 수    │
│     없습니다:                                   │
│                                                 │
│  · 자식 조직 2개                                │
│  · 소속 사용자 7명                              │
│                                                 │
│  먼저 자식 조직을 다른 부모로 이동하거나        │
│  사용자를 옮긴 뒤 다시 시도하세요.              │
│                                                 │
│                                       [닫기]    │
└────────────────────────────────────────────────┘
```

## A.8 빈 상태 / 에러

| 상태 | 처리 |
|---|---|
| `treeQuery.isPending` | 트리 컬럼 6행 `<Skeleton>` |
| `treeQuery.isError 403` | `<EmptyState icon={ShieldOff}>` "조직 관리 권한이 없습니다" |
| `treeQuery.isError 5xx` | `<EmptyState icon={AlertTriangle}>` "조직 트리를 불러오지 못했습니다 [재시도]" |
| `treeQuery.data.length === 0` | `<EmptyState icon={Building2}>` "등록된 조직이 없습니다 [+ 최상위 조직 추가]" |
| 미선택 (트리 있음) | 우측 패널 `<EmptyState icon={Building2}>` "왼쪽 트리에서 조직을 선택해 편집하세요" |

## A.9 컴포넌트 트리

```
<OrganizationsPage>                       // RSC frame
  <AdminSidebar />
  <OrganizationsMain>                     // 'use client'
    <SubSidebar title="조직 트리">
      <OrganizationTree
        nodes={tree}
        selectedId={selectedOrgId}
        onSelect={setSelectedOrgId}
        defaultExpanded={['root']}
      />
      <SubSidebarFooter>
        <Button onClick={() => setCreateOpen({ parentId: null })}>
          + 최상위 조직 추가
        </Button>
      </SubSidebarFooter>
    </SubSidebar>

    <OrganizationDetailPanel
      org={selectedOrg}
      siblings={siblings}                 // for ↑↓ + sortOrder display
      onEdit={() => setEditTarget(selectedOrg)}
      onCreateChild={() => setCreateOpen({ parentId: selectedOrg.id })}
      onDelete={() => setDeleteTarget(selectedOrg)}
      onMoveUp={...}
      onMoveDown={...}
    />
  </OrganizationsMain>

  {createOpen && (
    <OrgEditDialog
      mode="create"
      parentId={createOpen.parentId}
      organizations={flatList}
      open
      onClose={() => setCreateOpen(null)}
      onSubmit={...}
    />
  )}
  {editTarget && (
    <OrgEditDialog
      mode="edit"
      target={editTarget}
      organizations={flatList}
      open
      onClose={() => setEditTarget(null)}
      onSubmit={...}
    />
  )}
  {deleteTarget && (
    <OrgDeleteDialog
      target={deleteTarget}
      open
      onClose={() => setDeleteTarget(null)}
      onConfirm={...}
    />
  )}
</OrganizationsPage>
```

## A.10 TS Prop 시그니처

### A.10.1 Wire shapes

```ts
// GET /api/v1/admin/organizations
interface AdminOrganization {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  userCount: number;       // BE 합성 — 직속만 (자식 합산 X)
  childCount: number;      // BE 합성
  createdAt: string;       // ISO
}

// FE-derived tree node
interface OrganizationTreeNode extends AdminOrganization {
  children: OrganizationTreeNode[];
}
```

### A.10.2 `<OrganizationTree>` props

```ts
interface OrganizationTreeProps {
  nodes: OrganizationTreeNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  defaultExpanded?: string[];
  expanded?: ReadonlySet<string>;
  onExpandedChange?: (id: string, expanded: boolean) => void;
}
```

> 시그니처는 의도적으로 `<FolderTree>`와 평행 — 두 컴포넌트가 미래에 통합 가능. 본 라운드는 **별도 컴포넌트** 유지(폴더 vs 조직은 정신모델/아이콘/badge가 다름).

### A.10.3 `<OrganizationDetailPanel>` props

```ts
interface OrganizationDetailPanelProps {
  org: AdminOrganization | null;
  /** 같은 부모 형제 list (sortOrder 정렬됨) — ↑↓ 버튼이 사용 */
  siblings: AdminOrganization[];
  /** 직속 자식 list */
  children: AdminOrganization[];
  /** 직속 사용자 list (선두 6명만, 별도 query로 fetch) */
  members?: { id: string; username: string; fullName: string; role: UserRole }[];
  membersTotal?: number;
  membersLoading?: boolean;
  onEdit: () => void;
  onCreateChild: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}
```

### A.10.4 `<OrgEditDialog>` props

```ts
type OrgEditMode = 'create' | 'edit';

interface OrgEditValues {
  name: string;
  parentId: string | null;
  sortOrder?: number;
}

interface OrgEditDialogProps {
  mode: OrgEditMode;
  /** mode='edit'에서 필수. */
  target?: AdminOrganization;
  /** mode='create'에서 caller가 prefill — null이면 최상위 */
  parentId?: string | null;
  /** 부모 select 트리에 쓰이는 전체 조직 list */
  organizations: AdminOrganization[];
  open: boolean;
  onClose: () => void;
  onSubmit: (values: OrgEditValues) => Promise<void>;
}
```

### A.10.5 `<OrgDeleteDialog>` props

```ts
interface OrgDeleteDialogProps {
  target: AdminOrganization;
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}
```

내부에서 `target.childCount > 0 || target.userCount > 0`이면 §A.7.2 안내 모드로 자동 전환.

## A.11 TanStack Query 키

```ts
queryKeys.adminOrganizations = {
  tree: () => ['admin', 'organizations', 'tree'] as const,
  members: (orgId: string, params: { limit?: number }) =>
    ['admin', 'organizations', orgId, 'members', params] as const,
};
```

성공한 mutation 후 invalidate:
- create/patch/delete/reorder → `['admin', 'organizations']` 한 번 (가장 안전).
- mode='edit'에서 organizationId 같은 사용자 list가 영향받으면 `['admin', 'users']`도 invalidate (보수적).

## A.12 인터랙션 시퀀스 (조직)

### A.12.1 신규 자식 조직 추가

```
1. 사용자가 트리에서 "압연팀" 선택
2. 우측 상세 카드 2 [+ 자식 조직 추가] 클릭
3. <OrgEditDialog mode="create" parentId="org_pressed-team"> open
   - name input focus
   - parent select: 기본값 "압연팀", 하지만 변경 가능
4. name "냉연 3팀" 입력 → [저장]
   - zod: name min 1, max 50 ✓
   - mutation POST /api/v1/admin/organizations { name, parentId }
   - 200 → toast "조직이 추가되었습니다 (냉연 3팀)"
   - invalidate tree → 트리 재로드 → 새 조직이 압연팀의 자식으로 등장
   - 새 조직을 트리에서 자동 선택 (URL ?orgId 갱신)
   - dialog close
```

### A.12.2 부모 변경(이동)

```
1. 트리에서 "냉연 1팀" 선택
2. 상세 카드 1의 "부모 조직" 셀 [↗ 선택] 클릭 (또는 [✏ 편집])
3. <OrgEditDialog mode="edit" target={선택}> open
   - parent select 트리에서 "도금팀" 선택 → 자기/후손은 disabled로 회색
4. [저장] 클릭
5. parentId 값이 바뀌었으므로 ConfirmDialog (§A.6.2):
   "냉연 1팀을 압연팀 → 도금팀으로 이동합니다. 자식 0개와 소속 7명이 함께 이동합니다."
6. [이동 진행] 클릭
   - mutation PATCH /api/v1/admin/organizations/:id { parentId, sortOrder }
   - 200 → toast "변경사항이 저장되었습니다"
   - invalidate tree → 트리에서 위치 갱신, 선택 유지
7. 에러 케이스:
   - 409 E_STATE_CONFLICT (cycle) → toast rose "선택한 부모는 자신의 후손이라 이동할 수 없습니다."
     dialog는 닫지 않음 (사용자가 다시 부모를 고를 수 있게).
```

### A.12.3 자식+소속 user 있는 조직 삭제 시도

```
1. 트리에서 "압연팀" 선택 (자식 2개, 사용자 7명)
2. 상세 헤더 [⋮] 클릭
3. DropdownMenuItem [🗑 삭제] disabled (회색 + lock icon)
   tooltip: "자식 조직 2개와 소속 사용자 7명이 있어 삭제할 수 없습니다."
4. (사용자가 무시하고 클릭해도 nothing happens — disabled item)

[강제로 삭제 API 호출 가능한 경로가 있다면(예: 자식이 0이 됐는데 캐시 stale)
 BE는 E_STATE_CONFLICT 반환 → §A.7.2 안내 모드 dialog로 fallback.]
```

### A.12.4 정렬 순서 변경 (↑↓)

```
1. 트리에서 "냉연 2팀" 선택 (현재 sortOrder=2, 형제 3개 중 가운데)
2. 상세 카드 1 "정렬 순서: 2 / 3 [↑] [↓]" 표시
3. [↑] 클릭
   - 형제 array를 클라이언트에서 swap (1↔2)
   - mutation POST /api/v1/admin/organizations/reorder
     { parentId: "org_pressed-team", ids: ["org_2팀", "org_1팀", "org_3팀"] }
   - optimistic: 트리 즉시 재정렬
   - 200 → toast emerald "정렬이 변경되었습니다"
   - 실패 → rollback + toast rose
```

## A.13 접근성

- 트리: `role="tree"`, 행 `role="treeitem"` + `aria-expanded`/`aria-selected`. 키보드 네비 (FolderTree와 동등).
- 상세 패널: `<section aria-label="조직 상세">`. 카드별 `<h3>` heading.
- 다이얼로그: shadcn `<Dialog>` → focus trap + Esc + restore.
- 입력 검증 에러: `<input aria-invalid="true" aria-describedby="org-name-error">` + `<p id="org-name-error">`.
- 삭제 disabled 메뉴 항목: `aria-disabled="true"` + tooltip은 `aria-describedby`로 연결.
- ↑↓ 버튼: `aria-label="위로 이동"`/`"아래로 이동"`. disabled 시 `aria-disabled="true"`.
- 색맹 대응: 자식/user 카운트는 색이 아니라 숫자+텍스트. 빈 카드도 색 의존 X.

---

# B. /admin/groups — 그룹 + 사용자 매트릭스 관리

## B.1 라우트 + AdminSidebar

- **Route:** `/admin/groups` (이미 `admin-groups.ts:39`에 등록됨, `Users2` 아이콘, "권한 그룹 관리" description)
- **권한:** SUPER_ADMIN / ADMIN. 그 외 redirect.
- **AdminSidebar 변경:** 없음.

## B.2 레이아웃 — 3-pane (그룹 list → 멤버십 매트릭스)

```
┌─ Header (글로벌, 56px) ─────────────────────────────────────────────────┐
│NavRail│ AdminSidebar  │ GroupListPanel       │ GroupMembershipMatrix      │
│ 56px  │   240px        │   280px              │   fluid (≥720)             │
│       │               │                      │                            │
│       │ ▼ 사용자/조직 │ 그룹 목록             │ ┌─ Header (sticky) ──────┐ │
│       │   • 사용자     │ ┌──────────────────┐ │ │ drawing-editors        │ │
│       │   • 조직       │ │🔎 [검색…       ] │ │ │ ─────────────────────  │ │
│       │   • 그룹 ←active │ └──────────────────┘ │ │ 12명 멤버 · ▴3 변경     │ │
│       │               │                      │ │  [↺ 되돌리기] [저장(3)] │ │
│       │ ▼ 폴더/권한    │ • drawing-editors ●  │ ├────────────────────────┤ │
│       │   ...          │   12명               │ │ Toolbar: [🔎 사용자검색]│ │
│       │               │ • approver-cgl       │ │ Filter: 역할·소속      │ │
│       │               │   4명                │ ├────────────────────────┤ │
│       │               │ • partner-vendors    │ │ ☑ 사용자 (12 / 47)      │ │
│       │               │   8명                │ │ ─────────────────────── │ │
│       │               │ • cgl-2-editors      │ │ ☑ 박영호 (USER)         │ │
│       │               │   5명                │ │ ☐ 김지원 (USER)         │ │
│       │               │ ...                  │ │ ☑ 최정아 (USER)  ▴추가  │ │
│       │               │                      │ │ ☐ 이관리 (ADMIN) ▴제거  │ │
│       │               │ [+ 그룹 추가]         │ │ ...                    │ │
│       │               │                      │ │ [더 보기]               │ │
│       │               │                      │ └────────────────────────┘ │
└───────┴───────────────┴──────────────────────┴────────────────────────────┘
```

- **GroupListPanel (280px, `<SubSidebar title="그룹 목록">`)**: 그룹 list. 검색(클라이언트 필터, ≤200 그룹 가정). 각 행: 이름 + memberCount. 우측 hover 시 `[⋮]` (수정/삭제) DropdownMenu. 푸터 sticky `[+ 그룹 추가]`.
- **GroupMembershipMatrix (fluid, min-width 720)**: 선택된 그룹의 사용자 멤버십 편집. 매트릭스 헤더 + 사용자 toolbar(검색·필터) + 행(체크박스 + 사용자 정보 + 변경 표시).

> [PM-DECISION-5] **그룹 list panel에서 검색을 BE 쿼리로 둘지 클라이언트 필터로 둘지.** 보수적 default = **클라이언트 필터** (그룹 ≤200개 가정 — 4팀 × 5폴더 × 권한 그룹 약 30~50개). 200 초과 시 BE 검색 승격.

## B.3 GroupListPanel (좌측)

### B.3.1 시각

```
┌─ 그룹 목록 ──────────────────────────────────┐
│  🔎 [검색…                              ]    │
├──────────────────────────────────────────────┤
│ ● drawing-editors                       12   │
│   설계자 도면 편집 권한 그룹                  │
│ ─                                            │
│   approver-cgl                           4   │
│   CGL 결재선                                  │
│ ─                                            │
│   partner-vendors                        8   │
│   외주 협력업체 통합                          │
│ ...                                          │
├──────────────────────────────────────────────┤
│  [+ 그룹 추가]                                │
└──────────────────────────────────────────────┘
```

- 행 56px (이름 + description 2줄). 단일 행: `font-medium text-sm` + `text-xs text-fg-muted`.
- 우측 끝 `tabular-nums text-xs` memberCount.
- 선택 행: 좌측 `border-l-2 border-brand` + `bg-brand/10`. 호버 `bg-bg-muted`.
- 행 hover 또는 focus 시 `[⋮] DropdownMenu` 노출 (R29 `<UserManagementTable>`의 행 액션 패턴):
  - `✏ 수정` → `<GroupEditDialog mode="edit">`
  - `🗑 삭제` → `<GroupDeleteDialog>`
- 키보드: `ArrowDown`/`Up` = 행 이동, `Enter`/`Space` = 선택, `Tab` = 액션 메뉴.

### B.3.2 검색

- 클라이언트 필터. 입력 즉시 (no debounce — 작은 list).
- `name`과 `description` 둘 다 substring 매칭 (case-insensitive).
- 빈 결과: `(검색 결과 없음) [✕ 초기화]`.

## B.4 GroupMembershipMatrix (우측)

### B.4.1 헤더 (sticky)

```
┌──────────────────────────────────────────────────────────┐
│  drawing-editors                                          │
│  설계자 도면 편집 권한 그룹                                │
│  ──────────────────────────────────────                  │
│  12명 멤버 · ▴3 변경 (추가 2 / 제거 1)                   │
│                                                           │
│  [↺ 되돌리기]    [저장 (3)]                               │
└──────────────────────────────────────────────────────────┘
```

- 위 줄: 그룹 name (`text-base font-semibold`).
- 둘째 줄: description (`text-sm text-fg-muted`). 없으면 줄 자체 hide.
- 셋째 줄: 카운터 — `<현재 체크 수>명 멤버 · ▴<변경 수> 변경 (추가 X / 제거 Y)`. 변경=0이면 후반부 hide.
- 넷째 줄(액션): `[↺ 되돌리기]` + `[저장 (N)]`. R28 권한 매트릭스와 동일 패턴.
  - `저장`은 변경=0이면 disabled. ≥1이면 primary brand. label에 `(N)` inline.
  - `되돌리기`는 변경=0이면 disabled. 클릭 시 ConfirmDialog "변경사항 N건이 모두 사라집니다. 계속할까요?".
  - 닫기 버튼은 없음 — 좌측 list에서 다른 그룹 클릭이 곧 "닫기"이며 unsaved guard가 트리거됨(§B.6).

### B.4.2 매트릭스 toolbar (사용자 검색·필터)

```
┌──────────────────────────────────────────────────────────┐
│ 🔎 [이름·사번·이메일…  ]  역할:[전체▼]  소속:[전체▼]      │
│                                       [📊 멤버만 보기]   │
└──────────────────────────────────────────────────────────┘
```

- R29 `<UsersToolbar>` 컴포넌트 그대로 활용 가능 (또는 동등 신규). 검색 400ms debounce, URL sync `?q=`.
- `소속` select: 조직 list (R29의 사용자 페이지 toolbar를 확장하거나 별도). 보수적 default = **검색만 + 역할 필터** (소속 필터 후속 라운드). 본 spec은 검색+역할 가정.
- `[📊 멤버만 보기]` 토글: 체크 시 현재 group에 속하는 사용자만 표시 (체크박스 ☑인 행 + dirty의 ☑→☐ 행 모두 포함). 체크 해제 시 전체 list. **검토 시 빠르다 — 추천**.

> [PM-DECISION-6] **사용자 list 페이지네이션** — BE는 `/api/v1/admin/users`가 cursor 기반(R29 §A.5). 매트릭스에서 한 그룹당 멤버 수가 수십~수백명, 후보 user pool은 200~300명 수준이므로:
> - **default = cursor 무한 스크롤 + IntersectionObserver auto-load** (R29 패턴 재사용).
> - 단 그룹 멤버는 **항상 list 상단으로 모아서** 보여줌 (정렬 우선순위 1: 멤버 여부 desc, 2: fullName asc). BE의 cursor pagination은 "전체 user 정렬"이므로, 멤버 우선 정렬을 위해 **별도 endpoint `GET /admin/groups/:id/members` + `GET /admin/users?cursor=...` 두 query를 머지**해 표시. 또는 BE에 `?groupMembershipFirst=<groupId>` 파라미터 요청 (decision 필요).
>
> 보수적 default = **frontend가 두 query를 머지**:
> 1. `GET /admin/groups/:id/members` → 전부 한 번에 (멤버 ≤1000명 제한 contract §4.6).
> 2. `GET /admin/users?cursor=&limit=50` → 무한 스크롤.
> 3. 매트릭스는 1번 user를 상단에 항상 고정, 2번을 그 아래에 cursor 무한.
> 4. 사용자가 검색어를 입력하면 1+2 모두 클라이언트 측에서 substring 필터.

### B.4.3 매트릭스 본문 (사용자 행)

```
┌─────────────────────────────────────────────────────────────┐
│ ☑   사용자 (12 / 47)                                         │
│ ─────────────────────────────────────────────────────────── │
│ ☑   👤 박영호 (park.yh)         USER     냉연 1팀           │
│ ☐   👤 김지원 (kim.ji)          USER     냉연 1팀           │
│ ☑   👤 최정아 (choi.ja)         USER     계장팀     ▴추가    │
│ ☐   👤 이관리 (adm.lee)         ADMIN    IT팀       ▴제거    │
│ ☑   👤 정정원 (jung.jw)         USER     냉연 2팀           │
│ ☐   👤 김퇴직 (kim.old, 비활성)  USER     —          (제외)  │
│ ...                                                          │
│                                          [더 보기]            │
└─────────────────────────────────────────────────────────────┘
```

#### B.4.3.1 행 컬럼

| 컬럼 | Width | Render |
|---|---|---|
| ☑ Checkbox | 36 | shadcn `<Checkbox>`. 32×32 클릭 영역, 16×16 시각. |
| 사용자 정보 | flex | `<UserCell>`: 좌측 `<UserRound>` 16px + `fullName (username)` mono `text-[12px]` + `<RoleBadge>` (R29 §A.4.4 재사용) + 조직명 `text-fg-muted`. |
| 변경 표시 | 60 | `▴추가` (text-emerald-700) / `▴제거` (text-rose-700) / 빈칸. |

#### B.4.3.2 행 상태 (체크박스 + 변경 표기)

| 원본 (loaded) | 현재 (UI) | 시각 | 표기 |
|---|---|---|---|
| ☑ (멤버) | ☑ | 기본 | 없음 |
| ☐ (비멤버) | ☐ | 기본 | 없음 |
| ☐ → ☑ | ☑ | `border-l-2 border-emerald-400`, `bg-emerald-50/40` | `▴추가` |
| ☑ → ☐ | ☐ | `border-l-2 border-rose-400`, `bg-rose-50/30` | `▴제거` |

R28 권한 매트릭스의 dirty 시각과 동일 정신모델. amber 대신 add/remove를 직관적으로 보여주는 emerald/rose 사용.

#### B.4.3.3 컬럼 헤더 클릭 = 일괄 토글 (R28 패턴)

좌측 `☑` 헤더 셀 클릭 시 **현재 표시 중인 행 전체** 일괄 토글:

```
columnState =
  - all-on    (모두 체크) → 모두 해제
  - all-off   (모두 미체크) → 모두 체크
  - mixed     → 모두 체크 (한 번 더 누르면 모두 해제)
```

- 핵심 차이: "현재 표시 중"이라는 점. 검색·필터가 활성화된 상태라면 그 사용자들만 일괄 토글한다 (전체 user 풀이 아님 — 사고 방지).
- 시각: 헤더에 hover `cursor-pointer` + tooltip "현재 보이는 사용자 일괄 추가/제거".
- 키보드: 헤더 셀 `tabIndex=0`, `Space`/`Enter` 동일.
- aria: `aria-pressed={columnState === 'all-on'}` 동적 갱신.
- `aria-live="polite"` 영역에 변경 결과 카운트를 announce: `"15명 추가, 0명 제거. 현재 변경 18건"`.

### B.4.4 비활성 사용자 처리

R29 §A.4.2에서 비활성(`deletedAt != null`) 사용자는 default로 숨김. 매트릭스에서도 동일:
- `[멤버만 보기]` 토글이 켜져 있고 비활성 사용자가 멤버였다면(historical), 행은 회색 strikethrough + checkbox disabled + `(제외)` 라벨. 저장 시 자동으로 제거(`userIds`에서 빠짐). `aria-label="비활성 사용자, 자동 제거됩니다"`.
- 그 외에는 list에서 숨김.

### B.4.5 빈 상태 / 에러

| 상태 | 처리 |
|---|---|
| `groupsQuery.isPending` | 좌측 list 6행 `<Skeleton>` |
| `membersQuery.isPending` | 매트릭스 8행 `<Skeleton>` |
| `groupsQuery.isError` | 좌측 `<EmptyState icon={AlertTriangle}>` "그룹 목록을 불러오지 못했습니다 [재시도]" |
| `membersQuery.isError` | 우측 `<EmptyState>` |
| 그룹 없음 (첫 사용) | 좌측 `<EmptyState icon={Users2}>` "등록된 그룹이 없습니다 [+ 그룹 추가]" |
| 그룹 미선택 | 우측 `<EmptyState icon={Users2}>` "왼쪽 목록에서 그룹을 선택해 멤버를 편집하세요" |
| 그룹 선택, 사용자 0명 (검색 결과) | "조건에 맞는 사용자가 없습니다 [필터 초기화]" |

## B.5 GroupEditDialog — 신규/수정 (480×auto)

### B.5.1 레이아웃

```
┌─ 그룹 추가 / 수정 ───────────────────────────[✕]┐
│  그룹 이름*                                       │
│  [drawing-editors                            ]   │
│  · 1~50자. 영문 소문자/숫자/`-`/`_` 권장.         │
│  · 시스템 전역 unique.                            │
│                                                   │
│  설명                                             │
│  [설계자 도면 편집 권한 그룹                  ]   │
│  · 1~200자. 화면 list에 함께 표시됩니다.          │
│                                                   │
│  [취소]                              [저장]       │
└──────────────────────────────────────────────────┘
```

### B.5.2 필드 사양

| 필드 | mode='create' | mode='edit' | 검증 (Zod) |
|---|---|---|---|
| `name` | 필수 | 가능 | `.min(1).max(50)` + 시스템 전역 unique (BE 검증 + 409로 인라인 에러). 추천 패턴 `^[a-z0-9._-]+$`(영문 그룹) but 한글도 허용. |
| `description` | optional | optional | `.max(200).optional()` |

> [PM-DECISION-7] **그룹 name regex 강제 여부.** 보수적 default = **권장만 하고 강제 X** — 한글 그룹("결재자-CGL2") 사용 사례 가능. helper text에 "영문 권장"으로만 안내.

### B.5.3 저장 흐름

```
[저장] 클릭
  → RHF zod 검증 → 인라인 에러
  → mode='create' → POST /api/v1/admin/groups
     mode='edit'  → PATCH /api/v1/admin/groups/{id}
  → 200 → toast emerald
        ├ create: "그룹이 추가되었습니다 (drawing-editors)"
        └ edit:   "변경사항이 저장되었습니다"
       → invalidate ['admin', 'groups', 'list']
       → 다이얼로그 닫기
       → mode='create' → 새 그룹을 list에서 자동 선택
  → 409 E_CONFLICT (이름 중복) → name 필드에 "이미 사용 중인 그룹명입니다"
  → 403 → toast rose "권한이 부족합니다"
```

## B.6 GroupDeleteDialog — 삭제 confirm

```
┌─ 그룹 삭제 ────────────────────────────────[✕]┐
│  drawing-editors 그룹을 삭제합니다.            │
│                                                │
│  · 현재 멤버 12명의 멤버십이 함께 삭제됩니다.   │
│  · 사용자 계정 자체는 그대로 유지됩니다.        │
│  · 폴더 권한 매트릭스에서 이 그룹이 부여한       │
│    권한 행도 함께 사라집니다.                   │
│                                                │
│  ┌─ 확인 ───────────────────────────────────┐ │
│  │ 정말로 삭제하려면 그룹명을 입력하세요    │ │
│  │ [drawing-editors                       ] │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  [취소]                              [삭제]    │
└────────────────────────────────────────────────┘
```

- 멤버 ≥ 1이거나 권한 매트릭스 영향 가능 → R29 `<UserDeactivateDialog>` 패턴 차용 (그룹명 일치 입력).
- 멤버 0명이면 입력 없이 단순 confirm으로 단순화 가능 — but 일관성을 위해 **항상 이름 입력 강제** (보수적).
- `[삭제]` rose. default focus = `취소`.
- 200 → toast emerald `"그룹이 삭제되었습니다 (drawing-editors)"` + invalidate `['admin', 'groups']`. 매트릭스는 빈 상태로 전환(현재 선택이 삭제된 그룹이었으므로 selection 해제).

> [PM-DECISION-8] **그룹 삭제 confirm 강도.** 보수적 default = **이름 일치 입력 강제** (강함). PM이 "체크박스 한 개로 OK" 판단하면 단순 confirm으로 변경 가능.

## B.7 Unsaved-Changes 가드 (R28 패턴 재사용)

매트릭스는 R28 folder-permissions의 dirty 가드를 그대로 따른다. 3 layer:

### Layer 1 — 인라인 카운터

매트릭스 헤더 `▴3 변경 (추가 2 / 제거 1)` (§B.4.1).

### Layer 2 — intra-page navigation guard

좌측 list에서 다른 그룹을 클릭했을 때 (또는 `<AdminSidebar>`의 다른 메뉴 클릭):

```
┌─ 변경사항이 저장되지 않았습니다 ────────[✕]┐
│  drawing-editors 그룹의 변경 3건이 사라    │
│  집니다. 그룹을 이동할까요?                 │
│                                             │
│  저장이 필요하면 먼저 [저장] 버튼을         │
│  누르세요.                                  │
│                                             │
│  [취소]                  [버리고 이동]      │
└────────────────────────────────────────────┘
```

R28 `FolderPermissionsPage`의 `pendingFolderId` 패턴 그대로 옮긴다. `pendingGroupId`로 이름만 바꿈. default focus = `취소`. `[버리고 이동]` rose.

### Layer 3 — beforeunload

R28과 동일:
```ts
useEffect(() => {
  if (dirtyCount === 0) return;
  const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}, [dirtyCount]);
```

## B.8 저장 흐름 (Full-Replace PUT)

contract §4.6는 `PUT /api/v1/admin/groups/:id/members { userIds: string[] }` (full-replace, ≤1000명).

```
[저장 (3)] 클릭
  → 변경 카운트 검증 (>0)
  → ConfirmDialog 생략 (헤더 카운터로 명시적)
  → mutation: PUT /api/v1/admin/groups/{id}/members
     body: { userIds: string[] }    // 현재 매트릭스에서 ☑인 user.id 모두
  → 200 → toast emerald "멤버가 저장되었습니다 (12명)"
       → 변경 카운터 0
       → invalidate ['admin','groups',id,'members']
       → invalidate ['admin','groups','list']  // memberCount 갱신
  → 4xx
       → 400 E_VALIDATION → 인라인 (대개 userIds 길이 초과 = >1000) → toast amber persist
              "한 번에 최대 1000명까지 저장할 수 있습니다 (현재 N명)"
       → 403 → toast rose "권한이 부족합니다"
       → 404 → toast rose "그룹이 삭제되었습니다. 목록을 새로고침하세요."
              [새로고침 버튼] 클릭 시 invalidate + 그룹 selection 해제
       → 409 (사용자 존재/소프트삭제 검증 실패) → toast rose
              "선택된 사용자 중 일부가 비활성 상태입니다. 새로고침 후 다시 시도하세요."
  → 5xx → toast rose persist "서버 오류"
```

## B.9 인터랙션 시퀀스 (그룹)

### B.9.1 신규 그룹 생성 + 5명 추가

```
1. /admin/groups → [+ 그룹 추가] (좌측 푸터)
2. <GroupEditDialog mode="create"> open
   - name "cgl-2-editors", description "CGL-2 도면 편집 권한"
3. [저장] 클릭
   - POST /api/v1/admin/groups → 200
   - toast "그룹이 추가되었습니다 (cgl-2-editors)"
   - invalidate list → 새 그룹이 list에 추가
   - 자동 선택 (URL ?groupId=...)
4. 매트릭스 헤더 표시: "0명 멤버" → 검색 toolbar 활성화
5. 검색 "박" → 박영호, 박지현 후보로 좁힘
6. ☐ → ☑ 박영호 → 행이 emerald border + ▴추가
7. 검색 clear → "김" → 김지원, 김재순 ☑
8. 헤더 카운터 "0명 멤버 · ▴5 변경 (추가 5 / 제거 0)"
9. [저장 (5)] 클릭
   - PUT /api/v1/admin/groups/cgl-2-editors/members { userIds: [...] }
   - 200 → toast "멤버가 저장되었습니다 (5명)"
   - 카운터 0으로 리셋
```

### B.9.2 일괄 토글로 그룹 정원 통째 교체

```
1. /admin/groups → 좌측에서 "approver-cgl" 선택
2. [📊 멤버만 보기] 토글 ON → 현재 멤버 4명만 표시
3. ☑ 컬럼 헤더 클릭 → all-on → 모두 해제 → 4명 ☑→☐ (▴제거 4)
4. [📊 멤버만 보기] 토글 OFF → 전체 user list로 복귀 (제거된 4명도 ☐로 보임)
5. 검색 "이관리" + "박결재" 두 명 ☑ → ▴추가 2
6. 헤더 "0명 멤버 (현재) · ▴6 변경 (추가 2 / 제거 4)"
   ※ 카운터의 "현재 N명" 계산: 원본 멤버 - 제거 + 추가 = 4 - 4 + 2 = 2
   → 표시 보정: "2명 멤버 · ▴6 변경"
7. [저장 (6)] → PUT { userIds: [이관리.id, 박결재.id] }
   - 200 → toast "멤버가 저장되었습니다 (2명)"
```

### B.9.3 다른 그룹 클릭 시 unsaved guard

```
1. drawing-editors 선택 + 변경 3건 발생
2. 좌측 list에서 "approver-cgl" 클릭
3. <UnsavedGuardDialog> open
4. [취소] → 현재 그룹/매트릭스 유지
5. [버리고 이동] → 변경 3건 폐기 → URL ?groupId=approver-cgl로 갱신
   → 새 그룹의 멤버 query 시작
   → dirty=0 reset
```

## B.10 컴포넌트 트리

```
<GroupsPage>                                  // RSC frame
  <AdminSidebar />
  <GroupsMain>                                // 'use client'
    <SubSidebar title="그룹 목록">
      <GroupListPanel
        groups={groups}
        selectedId={selectedGroupId}
        onSelect={handleSelectGroup}          // unsaved guard 포함
        onEdit={(g) => setEditTarget(g)}
        onDelete={(g) => setDeleteTarget(g)}
        searchValue={search}
        onSearchChange={setSearch}
      />
      <SubSidebarFooter>
        <Button onClick={() => setCreateOpen(true)}>+ 그룹 추가</Button>
      </SubSidebarFooter>
    </SubSidebar>

    <GroupMembershipMatrix
      group={selectedGroup}
      initialMembers={membersQuery.data ?? []}
      candidateUsers={usersInfiniteQuery.data ?? []}
      onLoadMore={fetchNextPage}
      hasMore={hasNextPage}
      onSave={async (userIds) => saveMutation.mutateAsync({ groupId, userIds })}
      onDirtyCountChange={setDirtyCount}
    />
  </GroupsMain>

  {createOpen && (
    <GroupEditDialog
      mode="create"
      open
      onClose={() => setCreateOpen(false)}
      onSubmit={...}
    />
  )}
  {editTarget && (
    <GroupEditDialog
      mode="edit"
      target={editTarget}
      open
      onClose={() => setEditTarget(null)}
      onSubmit={...}
    />
  )}
  {deleteTarget && (
    <GroupDeleteDialog
      target={deleteTarget}
      open
      onClose={() => setDeleteTarget(null)}
      onConfirm={...}
    />
  )}

  {pendingGroupId && (
    <UnsavedGuardDialog ... />
  )}
</GroupsPage>
```

## B.11 TS Prop 시그니처

### B.11.1 Wire shapes

```ts
// GET /api/v1/admin/groups
interface AdminGroupListItem {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;      // BE 합성
  createdAt: string;
}

// GET /api/v1/admin/groups/:id/members
interface AdminGroupMember {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  organizationId: string | null;
  // 디자인 표기에 필요한 보조 필드. BE 응답에 organization name이 없으면
  // 별도 query로 join하거나 contract 보강 요청. 보수적으로 organizationName도
  // 응답에 포함되어 있다고 가정 (PM이 BE에 확인).
  organizationName?: string | null;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'PARTNER';
  deletedAt?: string | null;
}

// 매트릭스 내부 행 모델 (form-state, NOT wire)
interface MembershipRow {
  user: AdminUserListItem;            // R29 §A.11.1 재사용
  origin: boolean;                    // 로드 시점에 멤버였는가
  current: boolean;                   // UI 현재 체크 상태
  state: 'normal' | 'added' | 'removed';
}
```

### B.11.2 `<GroupListPanel>` props

```ts
interface GroupListPanelProps {
  groups: AdminGroupListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (group: AdminGroupListItem) => void;
  onDelete: (group: AdminGroupListItem) => void;
  searchValue: string;
  onSearchChange: (next: string) => void;
  loading?: boolean;
}
```

### B.11.3 `<GroupMembershipMatrix>` props

```ts
interface GroupMembershipMatrixProps {
  group: AdminGroupListItem;
  /** 그룹의 현재 멤버 (서버 로드) — origin 계산 source */
  initialMembers: AdminGroupMember[];
  /** 후보 user pool (cursor pagination) */
  candidateUsers: AdminUserListItem[];
  onLoadMore: () => void;
  hasMore: boolean;
  loading?: boolean;
  /** 사용자 검색·필터 상태 (caller 관리) */
  q: string;
  onChangeQ: (v: string) => void;
  roleFilter: 'all' | 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'PARTNER';
  onChangeRole: (v: GroupMembershipMatrixProps['roleFilter']) => void;
  membersOnly: boolean;
  onChangeMembersOnly: (v: boolean) => void;
  /** 저장 — 현재 ☑인 user.id 전부를 보냄 */
  onSave: (userIds: string[]) => Promise<void>;
  /** dirty 카운트 보고 (헤더 외부 unsaved guard에 사용) */
  onDirtyCountChange?: (count: number) => void;
  readOnly?: boolean;
}
```

### B.11.4 `<GroupEditDialog>` / `<GroupDeleteDialog>` props

```ts
type GroupEditMode = 'create' | 'edit';

interface GroupEditValues {
  name: string;
  description?: string;
}

interface GroupEditDialogProps {
  mode: GroupEditMode;
  target?: AdminGroupListItem;          // mode='edit' 필수
  open: boolean;
  onClose: () => void;
  onSubmit: (values: GroupEditValues) => Promise<void>;
}

interface GroupDeleteDialogProps {
  target: AdminGroupListItem;
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}
```

## B.12 TanStack Query 키

```ts
queryKeys.adminGroups = {
  list: () => ['admin', 'groups', 'list'] as const,
  members: (groupId: string) => ['admin', 'groups', groupId, 'members'] as const,
  candidateUsers: (params: { q?: string; role?: string }) =>
    ['admin', 'groups', '__candidates__', params] as const,    // R29 ['admin','users']와 분리
};
```

> 주의: 후보 user pool은 `['admin','users','list']`(R29 키)와 **공유 가능**. 같은 endpoint이므로 캐시 재사용을 위해 그대로 사용 권장. 본 spec은 R29 키 재사용 가정.

## B.13 접근성

- 그룹 list: `<ul role="list">`, 행 `<li>` + `<button>` 또는 `role="button"` + tabIndex.
- 매트릭스: `<table>` + `<th scope="col">` (체크박스 헤더, 사용자 헤더, 변경 표시 헤더). 사용자 행 `<tr>` + 체크박스 `<td>` + `<td>` user info.
- `<Checkbox>` 각각 `aria-label="박영호 (park.yh)을 그룹에 포함"`.
- 변경 표시 셀 `<td aria-label="추가 예정">`/`"제거 예정"` 또는 `aria-hidden`으로 두고 행 단위 변경을 `aria-label="박영호 추가 예정"`로 표현.
- 일괄 토글 헤더: `<button aria-pressed="false">현재 보이는 사용자 일괄 추가/제거</button>`.
- 일괄 토글 결과는 `aria-live="polite"` 영역으로 announce: `"15명 추가, 0명 제거. 현재 변경 18건."`
- 다이얼로그: shadcn `<Dialog>` (focus trap, Esc, focus restore).
- 매트릭스에서 [저장] 클릭 시 dirty=0이 되면 헤더 카운터 영역 `aria-live="polite"`에 `"저장 완료. 변경 사항 없음."`.

---

# C. 공통 (양 페이지)

## C.1 디자인 토큰 변경 — 없음

R28/R29에서 정착한 토큰 그대로:
- amber (변경/dirty), emerald (추가/성공), rose (제거/위험), brand (active selection).
- `border-l-2` 좌측 strip + 배경 tint 0.4~0.6 alpha 시각.
- `tabular-nums` 카운트, mono `font-mono text-[12px]` username/breadcrumb.

토큰 추가/변경 **요청 없음**. PM이 별도 결정 안 해도 frontend는 R28/R29 코드 그대로 차용.

## C.2 반응형 임계점

| Width | 처리 |
|---|---|
| ≥1280 | 정상 3-pane |
| <1280 | 매트릭스/상세 패널이 크게 좁아져 read-only 배너 (R28 패턴): "⚠ 화면이 좁아 편집 모드를 사용할 수 없습니다. 1280px 이상에서 접속하세요." |
| <1024 | (드물 — desktop only 정책) 좌측 sub sidebar collapse (icon-only)로 대체 가능 — but v1 범위 외 |

## C.3 라우팅 / URL sync

```
/admin/organizations
  ?orgId=<uuid>          ← 선택된 조직 (트리에서 highlight)

/admin/organizations/new           ← 별도 라우트 X. dialog state로만 처리.
/admin/organizations/[id]          ← 별도 라우트 X. ?orgId=로 처리.

/admin/groups
  ?groupId=<uuid>        ← 선택된 그룹
  ?q=<search>            ← 사용자 검색
  ?role=<role>           ← 역할 필터

검색·필터 변경 → router.replace (history 더럽히지 않음)
조직/그룹 선택 → router.replace
```

R29 `/admin/users`의 URL sync 패턴 차용. `useSearchParams` + `router.replace`.

## C.4 키보드 단축키

| 키 | 페이지 | 동작 |
|---|---|---|
| `Esc` | dialog 열림 | 닫기 (default — shadcn) |
| `/` | /admin/groups | 매트릭스 toolbar 검색 input focus (R29 글로벌 패턴 있으면 따름) |
| `Cmd/Ctrl+S` | 매트릭스 dirty | `[저장]` 트리거 (브라우저 저장 prevent) — 보너스, v1 우선순위 낮음 |
| `Cmd/Ctrl+Z` | 매트릭스 dirty | `[되돌리기]` 트리거 — 보너스, v1 우선순위 낮음 |

> [PM-DECISION-9] **`Cmd+S`/`Cmd+Z` 단축키 v1 포함 여부.** 보수적 default = **포함** (R28 매트릭스 spec에는 미명시였으나 admin 사용 빈도 고려). PM이 "v2로" 결정하면 시간 단축. 본 spec은 §C.4 표에 적어두기만 함.

## C.5 토스트 컨벤션 (R28/R29 그대로)

| 결과 | 색 | 위치 | 자동 닫힘 |
|---|---|---|---|
| 성공 | emerald | 우상단 | 4초 |
| 경고 (저장 가능 but 주의) | amber | 우상단 | 4초 |
| 실패 (재시도 가능) | rose | 우상단 | persist + `[닫기]` |
| 실패 (재시도 불가) | rose | 우상단 | persist |

`sonner`의 `toast.success/warning/error/loading`. R28 PermissionMatrix와 동일.

## C.6 Mutation 패턴

R29 §A.12 가이드 그대로:
- 다이얼로그별 로컬 mutation 5개 (`useOrgCreate`, `useOrgUpdate`, `useOrgDelete`, `useOrgReorder`, `useGroupCreate`, ...).
- `useObjectMutation` factory 패턴은 **이번 라운드 미사용** — admin endpoints는 entity 단순.
- 성공 시 `queryClient.invalidateQueries({ queryKey: ['admin', 'organizations'] })` 또는 `['admin','groups']` 한 번으로 전체 sync.

## C.7 V-1 (HATCH polygon clip)와의 관계

V-1은 viewer-engineer 단독 작업이고 admin UI와 영역 분리(`apps/web/lib/dxf-parser/`, `apps/web/components/DwgViewer/`). **이 디자인 spec은 V-1을 다루지 않는다.** contract §5에 viewer-engineer 작업 정의가 따로 있음.

---

# D. PM Decision Items 요약 (보수적 default 포함)

| # | 결정 항목 | 보수적 default | 영향 |
|---|---|---|---|
| 1 | 조직 페이지 3-pane 유지 vs 단일 컬럼 단순화 | **3-pane** (R28 일관성) | 시각/구현량 |
| 2 | reorder = 드래그 vs ↑↓ 버튼 | **↑↓ 버튼** (안전성·API 정합) | UX 학습 곡선, 구현 복잡도 |
| 3 | 조직 상세 카드 3 (소속 사용자) 포함 | **포함**. BE에 organizationId 필터 미구현 시 fallback 텍스트 | BE 추가 작업 ±1h |
| 4 | OrgEditDialog mode='edit'에서 parentId 변경 허용 | **허용 + ConfirmDialog 1차** | UX 사고 위험, but 기능 완결성 |
| 5 | 그룹 list 검색 = 클라이언트 필터 vs BE | **클라이언트 필터** (그룹 ≤200 가정) | 200 초과 시 BE 추가 |
| 6 | 사용자 list 페이지네이션 = 두 query 머지 vs BE 보강 | **두 query 머지** (FE만, contract 그대로) | FE 복잡도 +; 그룹 멤버 수가 1000 근접 시 한계 |
| 7 | 그룹명 regex 강제 | **강제 X (helper text만)** | 한글 그룹명 허용 |
| 8 | 그룹 삭제 confirm = 이름 일치 강제 vs 단순 | **이름 일치** (강함, R29 사용자 비활성화 일관성) | UX 마찰 ±2초 |
| 9 | `Cmd+S`/`Cmd+Z` 단축키 v1 포함 | **포함** (보너스) | 추가 구현 ~30분 |

---

# E. 검증 체크리스트 (PM Phase 4용)

- [ ] `/admin/organizations` 라우트 manifest 등장
- [ ] `/admin/groups` 라우트 manifest 등장
- [ ] AdminSidebar에서 두 메뉴가 active 상태 표시 정상
- [ ] 트리 빈 상태 / 그룹 빈 상태 EmptyState 노출
- [ ] OrgEditDialog 부모 select에서 자기/후손 disabled
- [ ] OrgDeleteDialog: 자식·user 0이면 삭제 가능, 그 외 disabled+tooltip
- [ ] 정렬 ↑↓ 버튼 첫째/막내 disabled, optimistic + rollback
- [ ] 그룹 list 검색 substring 매칭 (name + description)
- [ ] 그룹 매트릭스 일괄 토글 = 현재 표시 행만 적용 (검색 활성 시 그 결과만)
- [ ] 그룹 매트릭스 dirty 카운터 = 추가/제거 분리 표시
- [ ] 그룹 매트릭스 unsaved guard 3 layer (인라인/intra-page/beforeunload) 모두 동작
- [ ] PUT /admin/groups/:id/members 호출 시 userIds = 현재 ☑ 행 전체
- [ ] 비활성 사용자(`deletedAt != null`)는 default 숨김, 멤버였으면 strikethrough+disabled
- [ ] toast emerald/amber/rose 컨벤션 일관
- [ ] WCAG: 키보드 네비, focus visible, ARIA labels, color-blind 안전 (변경 표시는 텍스트 ▴추가/▴제거 동반)

---

# F. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-04-27 | 초기 작성 (R30) |
