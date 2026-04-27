# R33 Design Spec — Backup Admin (D-5) + Keycloak SSO Login (A-1)

| 항목 | 내용 |
|---|---|
| 작성자 | drawing-mgmt designer agent (R33) |
| 작성일 | 2026-04-27 |
| 기준 main HEAD | `ab00cbb` |
| 대상 라운드 | R33 |
| 대상 PRD/DESIGN | `docs/PRD.md`, `docs/DESIGN.md` (§4 글로벌 레이아웃, §10.1 Empty/Loading 패턴) |
| API 계약 | `_workspace/api_contract.md` §3.2(Keycloak login), §4.4(backup admin), §5(FE 작업 요약) |
| 신규 라우트 | `/admin/backups` (page) |
| 신규 컴포넌트 | `<KeycloakLoginButton>`, `<BackupTable>`, `<BackupRunDialog>` |
| 확장 컴포넌트 | `<LoginForm>` (Keycloak 버튼 wire), `ADMIN_GROUPS` (백업 메뉴 추가) |
| 의존 (BE) | `GET /api/v1/admin/backups`, `POST /api/v1/admin/backups/run`, `GET /api/v1/admin/backups/{id}/download`, Auth.js Keycloak provider |
| 디바이스 | Desktop only (≥1280) |
| 디자인 토큰 변경 | 없음 — 기존 Tailwind palette + `.app-panel`, `.app-kicker`, `.app-action-button*` 재사용. 상태별 상태색은 R28 `<ConversionStatusBadge>` 팔레트와 동일하게 정렬(slate/sky/emerald/rose) |
| 새 단축키 | 없음 |
| PRD 페르소나 영향 | 슈퍼관리자만 사용. 일반 사용자 시야에 들어가지 않음 (admin 메뉴 아래 + 권한 가드) |

---

## 0. 라운드 개요와 사용자 시나리오

### 0.1 두 카드가 같은 라운드에 묶이는 이유

A-1(Keycloak SSO)와 D-5(백업 자동화)는 **인프라 / 운영 카테고리에 속하는 "관리자만 의식하는" 카드**라는 공통점이 있다. 일반 사용자 화면 영역(자료 목록 / 상세 / 검색)은 손대지 않으므로 디자인 회귀 위험이 낮고, 디자인 단위로 묶기 좋다. 또한 둘 다 "환경변수에 따라 보였다 안 보였다"하는 분기를 갖는다는 공통 패턴이 있다 (Keycloak: `KEYCLOAK_ENABLED`, 백업: 메뉴 자체는 항상 표시하지만 `BACKUP_CRON_ENABLED=0`이면 자동 스케줄 안내 문구가 달라짐).

### 0.2 페르소나별 시나리오

| 페르소나 | A-1 시나리오 | D-5 시나리오 |
|---|---|---|
| 슈퍼관리자 | (운영 환경) `KEYCLOAK_ENABLED=1` 일 때 사내 SSO 버튼으로 로그인. 첫 로그인 시 자동 provisioning. | `/admin/backups` 진입 → 이력 확인 → "지금 실행" 으로 즉시 백업 → 다운로드. `BACKUP_CRON_ENABLED=1` 자동 스케줄(매일 02:00) 정상 동작 확인. |
| 관리자 (1~2명) | 동일 (역할 ADMIN 이상이 백업 페이지 접근 가능 — 단 PM-DECISION 항목 §D.1 참조) | 동일 (스펙 PM-DECISION-1: ADMIN도 가능) |
| 설계자 / 열람자 / 협력업체 | (개발 환경) `KEYCLOAK_ENABLED=0` → 기존 Credentials 폼만. 사내 SSO 사용자도 SSO 버튼 보이면 곧장 클릭. | 메뉴 자체에 접근 불가 (admin/* 라우트는 middleware에서 ADMIN+ 가드) |

### 0.3 핵심 시나리오 5개

1. **사내 SSO로 처음 로그인 (설계자, KEYCLOAK_ENABLED=1):** `/login` → 화면 상단에 "사내 SSO 로그인" primary 버튼 → 클릭 → Keycloak 페이지로 redirect → 인증 후 callback → Auth.js가 user 자동 INSERT → `/` 진입.
2. **dev/fallback 로그인 (관리자, KEYCLOAK_ENABLED=0):** `/login` → SSO 버튼 자체가 렌더되지 않음 → 기존 Credentials 폼만 보임. 디자인 회귀 0건.
3. **DB/파일 즉시 백업 (슈퍼관리자):** `/admin/backups` → 우측 상단 "지금 실행" 클릭 → Dialog에서 `POSTGRES`/`FILES` 라디오 선택 → "실행" → 새 row가 RUNNING(sky pulse)로 추가 → 5초 폴링으로 DONE(emerald) 또는 FAILED(rose) 갱신 → DONE이면 액션 컬럼 "다운로드" 활성화.
4. **이전 백업 다운로드 (관리자):** 테이블에서 DONE row의 "다운로드" 클릭 → `GET /admin/backups/{id}/download` → 브라우저가 파일 저장 다이얼로그 표시.
5. **빈 상태 (시스템 첫 가동):** Backup row가 0건이면 EmptyState 컴포넌트 — "백업 이력이 없습니다. 매일 02:00에 자동 실행됩니다 (BACKUP_CRON_ENABLED=1 기준). 또는 '지금 실행'을 눌러 수동으로 실행할 수 있습니다."

---

## A. 로그인 페이지 SSO 버튼 (A-1)

### A.1 진입점 — 어디에 어떻게 추가하는가

**대상 파일:** `apps/web/app/(auth)/login/login-form.tsx`. 기존 `<LoginForm>` 클라이언트 컴포넌트를 그대로 두고 SSO 버튼만 **Credentials form 위에** 추가.

**왜 폼 위인가 (PM-DECISION-2):**
- 사내 환경에서 SSO가 **권장 경로**다. PRD §3.1의 페르소나(슈퍼관리자/관리자/설계자/열람자) 중 협력업체 5사를 제외하면 **거의 모두가 도메인 계정**을 갖는다.
- 협력업체는 외부이므로 SSO 미적용 — Credentials 폼이 보조 진입점.
- 폼 **아래**에 두면 "테스트 관리자 로그인" 버튼처럼 보조처럼 인식돼 권장이 약해진다.
- 따라서 `KEYCLOAK_ENABLED=1`일 때는 SSO 버튼이 **primary**(brand 색), Credentials는 **`OR` 디바이더 + 하위 영역**으로 visual hierarchy.

### A.2 분기 시각 (KEYCLOAK_ENABLED 따라)

```
┌──────────────────────────── KEYCLOAK_ENABLED=1 ────────────────────────────┐
│  ┌── header ─────────────────────────────────────────────────────────┐    │
│  │   [DG]                                                              │    │
│  │   도면관리시스템                                                    │    │
│  │   계정으로 로그인하세요                                             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌── app-panel ───────────────────────────────────────────────────────┐    │
│  │  ┌───────────────────────────────────────────────────────────────┐  │    │
│  │  │  [🔐 lock-keyhole]  사내 SSO 로그인                            │  │    │
│  │  └───────────────────────────────────────────────────────────────┘  │    │
│  │       ─ KeycloakLoginButton.  bg=brand,  white text,  height=10  ─  │    │
│  │       ─ icon: KeyRound (lucide)                                     │    │
│  │                                                                      │    │
│  │  ─── 또는 ──────────────────────────────────────────────────────    │    │
│  │       ─ horizontal divider with centered "또는" 라벨 ─              │    │
│  │                                                                      │    │
│  │  아이디 [______________]                                             │    │
│  │  비밀번호 [______________]                                           │    │
│  │                                                                      │    │
│  │  [ 로그인 ]   ← Button variant=outline (회색, secondary 위계)        │    │
│  │                                                                      │    │
│  │  ┌── 점선 border-t ─────────────────────────────────────────────┐   │    │
│  │  │ [테스트 관리자 로그인 (SUPER_ADMIN)]  ← 기존 dev 버튼 유지     │   │    │
│  │  └────────────────────────────────────────────────────────────┘   │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────── KEYCLOAK_ENABLED=0 ────────────────────────────┐
│  ┌── app-panel (기존 그대로) ─────────────────────────────────────────┐    │
│  │  아이디 [______________]                                             │    │
│  │  비밀번호 [______________]                                           │    │
│  │  [ 로그인 ]   ← Button variant=default (brand, primary)              │    │
│  │  [ 테스트 관리자 로그인 ]                                            │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ─ 회귀 0건. SSO 버튼 영역 자체가 렌더되지 않음 ─                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

**시각 위계 변환 규칙:**
- `KEYCLOAK_ENABLED=1`: SSO = primary, Credentials 로그인 버튼 = **outline** (시각적으로 secondary).
- `KEYCLOAK_ENABLED=0`: Credentials 로그인 버튼 = **default** (brand, primary) — 기존 동작 유지.

### A.3 컴포넌트 시그니처 — `<KeycloakLoginButton>`

**위치:** `apps/web/app/(auth)/login/keycloak-button.tsx` (login-form.tsx와 같은 폴더).

**Props:**
```
interface KeycloakLoginButtonProps {
  callbackUrl?: string;       // signIn(provider, { callbackUrl })에 그대로 전달
  disabled?: boolean;         // 부모 폼이 lock 상태일 때 동기 disable (드물지만 일관성)
  className?: string;
}
```

**행동:**
- 클릭 시 `signIn('keycloak', { callbackUrl: callbackUrl ?? '/' })` 호출 (next-auth/react).
- 클릭 직후 1초 동안 spinner + "사내 SSO로 이동 중…" 라벨로 변경 (signIn은 same-origin redirect라 컴포넌트 unmount 직전까지 짧게 보이지만 사용자 피드백 차원에서 유지).
- 버튼 시각:
  - 아이콘: `KeyRound` from lucide-react (size=18, strokeWidth=2).
  - 라벨: "사내 SSO 로그인".
  - 색상: `bg-brand text-brand-foreground hover:bg-brand-600` (= `.app-action-button-primary`와 같은 토큰 가족이지만 height=10 = 40px로 강조).
  - 높이: 40px (h-10) — Credentials 버튼(h-9 = 36px)보다 약간 크게 해서 위계 강화.
  - 폭: `w-full`.
  - focus ring: `focus-visible:ring-2 focus-visible:ring-ring`.

**환경 분기:**
- `<LoginForm>`이 mount 시 `process.env.NEXT_PUBLIC_KEYCLOAK_ENABLED === '1'`을 boolean으로 평가해 `<KeycloakLoginButton>`을 conditional 렌더.
- 서버 측 prerender에서 동일 결과가 나오도록 `NEXT_PUBLIC_*` 사용 (서버 컴포넌트 page.tsx에서 prop으로 내려도 무방하나 client 내부 분기가 더 단순).

### A.4 인터랙션 + 상태

| 상태 | 트리거 | 시각 |
|---|---|---|
| idle | 페이지 로드 | brand 버튼 + lock 아이콘 |
| hover | 마우스 over | `bg-brand-600` |
| focus | Tab 도달 | ring-2 ring (focus-visible 만) |
| pressed | 클릭 직후 | 즉시 disabled + Loader2 spinner + "사내 SSO로 이동 중…" |
| error (callback `?error=`) | 콜백 실패 | login-form의 기존 errorBox 재사용 (mapErrorCode에 `OAuthSignin`, `OAuthCallback`, `OAuthAccountNotLinked`, `AccessDenied` 4개 케이스 추가) |

**에러 케이스 카피 (PM-DECISION-3):**
- `OAuthSignin` / `OAuthCallback`: "사내 SSO 로그인에 실패했습니다. 잠시 후 다시 시도하세요."
- `OAuthAccountNotLinked`: "이미 다른 방식으로 가입된 계정입니다. 관리자에게 문의하세요."
- `AccessDenied`: "접근이 거부되었습니다. 관리자에게 문의하세요."
- 알 수 없는 OAuth 에러: 기존 `default` fallback 유지.

### A.5 접근성

- 버튼 `aria-label="사내 SSO로 로그인"` 명시 (아이콘+텍스트지만 SR 보조 차원).
- Tab 순서: SSO 버튼 → 아이디 → 비밀번호 → Credentials 로그인 버튼 → 테스트 관리자 로그인.
- 키보드 단축키 추가 없음 (Enter는 폼 안 input에서 default로 submit이므로 SSO 버튼은 의도적으로 폼 밖에 둔다 = `<form>` 외부 div 또는 같은 폼 안이지만 `type="button"` 명시).
- 대비: brand-on-white = WCAG AA 통과 (CSS 변수 `--brand`는 globals.css에서 4.5:1 이상 확보).

### A.6 변경 영향 — login-form.tsx

기존 파일에 다음 3개 지점만 손댄다 (frontend agent용 가이드):

1. import 추가: `import { KeycloakLoginButton } from './keycloak-button';`
2. `mapErrorCode`에 위 §A.4의 4개 OAuth 케이스 추가.
3. JSX 최상단 `<form>` **위쪽**에 분기 블록 + `<form>` 자체는 `app-panel space-y-4 p-6` 그대로:

```
<div className="space-y-4">
  {keycloakEnabled ? (
    <>
      <div className="app-panel p-6">
        <KeycloakLoginButton callbackUrl={callbackUrl} disabled={submitting} />
      </div>
      <div className="flex items-center gap-3 px-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wide text-fg-subtle">또는</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    </>
  ) : null}

  <form ...>
    {/* 기존 폼 그대로 */}
    <Button
      type="submit"
      variant={keycloakEnabled ? 'outline' : 'default'}
      className="w-full"
      ...
    >
      로그인
    </Button>
    {/* 테스트 관리자 로그인 영역 그대로 */}
  </form>
</div>
```

- **회귀 방지:** `KEYCLOAK_ENABLED=0`일 때 outer div는 단일 자식 `<form>`만 가지므로 layout shift 없음.
- 페이지 server component(`page.tsx`)는 손대지 않음.

---

## B. /admin/backups 페이지 (D-5)

### B.1 라우트 + 메뉴 등록

**라우트:** `apps/web/app/(main)/admin/backups/page.tsx` (신설). 클라이언트 컴포넌트 (TanStack Query 폴링 사용).

**메뉴 등록:** `apps/web/app/(main)/admin/admin-groups.ts`의 "통합 / 로그" 그룹에 한 줄 추가:
```
{
  href: '/admin/backups',
  label: '백업',
  description: 'DB·파일 백업 이력 / 즉시 실행 / 다운로드',
  icon: Archive,   // lucide-react
}
```

위치: 기존 `/admin/conversions` (변환 작업) 바로 아래, `/admin/integrations` 위. 이유: 둘 다 BullMQ-backed 운영 surface라 mental model이 같음.

### B.2 페이지 와이어프레임 (≥1280)

```
┌──────── /admin/backups ────────────────────────────────────────────────────┐
│ [TopBar — 글로벌, 그대로]                                                  │
├────────────┬───────────────────────────────────────────────────────────────┤
│ AdminSidebar│ ┌── breadcrumb ──────────────────────────────────────────┐  │
│            │ │  관리자 / 백업                                            │  │
│  ▸ 사용자  │ └─────────────────────────────────────────────────────────┘  │
│  ▸ 조직    │ ┌── page header ─────────────────────────────────────────┐   │
│  ▸ 그룹    │ │  ADMIN CONSOLE                                           │   │
│  ─        │ │  백업                                                     │   │
│  ▸ 폴더트리│ │  매일 02:00에 자동 실행됩니다. 30일 후 자동 삭제됩니다.   │   │
│  ▸ 권한매트│ │                                       [⟳][지금 실행 ▼]   │   │
│  ─        │ └─────────────────────────────────────────────────────────┘   │
│  ▸ 자료유형│                                                                │
│  ▸ 발번규칙│ ┌── stats strip (선택, phase 1) ────────────────────────┐    │
│  ─        │ │  최근 7일: DB ✓3 · FILES ✓3   |   실패 0   |   총 6.2GB │    │
│  ▸ 공지   │ └────────────────────────────────────────────────────────┘    │
│  ─        │                                                                │
│  ▸ 변환작업│ ┌── BackupTable ──────────────────────────────────────┐      │
│  ▸ 백업 ●  │ │ 종류  | 상태   | 시작            | 완료    | 소요  | 크기  | │   │
│  ▸ API key│ │ ───── ┼─────── ┼────────────────┼────────┼──────┼──────┼─ │ │
│  ▸ 감사로그│ │ DB    | RUNNING| 04-27 14:00:11 | —      | 02:14| —    | … │ │
│            │ │ FILES | DONE   | 04-27 02:00:03 | 02:11  | 11m  | 4.3GB|⬇  │ │
│            │ │ DB    | DONE   | 04-27 02:00:01 | 02:00  | 1m12s|412MB |⬇  │ │
│            │ │ FILES | FAILED | 04-26 02:00:03 | 02:01  | 0m58s| —    | i │ │
│            │ │ ...                                                       │  │
│            │ └─────────────────────────────────────────────────────────┘  │
│            │                                                                │
│            │ [ 더 불러오기 (n=50) ]   ← 더 있을 때만                        │
└────────────┴───────────────────────────────────────────────────────────────┘
```

### B.3 헤더 영역 — 자동 안내 + 즉시 실행 진입점

- `<div className="app-kicker">ADMIN CONSOLE</div>` (R28/R29 패턴 동일).
- `<h1>백업</h1>`.
- 본문 한 줄 안내: `매일 02:00에 자동 실행됩니다. 30일 후 자동 삭제됩니다.` (PM-DECISION-4 — retention 30일 고정 안내. `BACKUP_RETENTION_DAYS` 환경변수가 변경되면 BE에서 응답 meta로 내려주고 FE는 그 값을 그대로 사용. 디폴트 카피는 "30일".)
- 우측 상단 액션 영역(2개 버튼 가로 배열):
  - `<Button size="sm" variant="outline" aria-label="새로고침"><RefreshCw /></Button>` — `listQuery.refetch()` 호출, RUNNING 폴링과 별도 수동 갱신.
  - `<Button size="sm" className="app-action-button-primary">지금 실행</Button>` — 클릭 시 `<BackupRunDialog>` 오픈.

### B.4 BackupTable — 컬럼 정의

**Wire shape (BE 응답 — `_workspace/api_contract.md` §4.4 기반 추정. BE는 contract §4.3에 명시된 필드를 그대로 응답하면 됨):**
```
interface BackupRowDTO {
  id: string;
  kind: 'POSTGRES' | 'FILES';
  status: 'RUNNING' | 'DONE' | 'FAILED';
  startedAt: string;        // ISO
  finishedAt: string | null;
  durationMs: number | null;
  sizeBytes: number | null;
  errorMessage: string | null;
  storagePath: string | null; // FE는 안 씀 (다운로드 endpoint id로 처리)
}

interface BackupListEnvelope {
  ok: true;
  data: BackupRowDTO[];
  meta: {
    nextCursor: string | null;
    runningCount: number;       // 폴링 결정용 — BE가 inline으로 내려주면 좋음
    retentionDays: number;      // 안내 카피용. 디폴트 30
  };
}
```

> Frontend agent 노트: 만약 BE가 `meta.runningCount`/`meta.retentionDays`를 내려주지 않으면 FE에서 `data.some(r => r.status === 'RUNNING')` 와 `30` 상수로 대체. R28 변환 페이지의 `meta.stats` 패턴(§B.4 conversions)과 동일 의도.

**컬럼 (좌→우):**

| # | 헤더 | 셀 내용 | 정렬 | 폭 |
|---|---|---|---|---|
| 1 | 종류 | `<KindBadge>` (`POSTGRES → "DB"`, `FILES → "파일"`) | left | 80px |
| 2 | 상태 | `<BackupStatusBadge>` (sky pulse / emerald / rose) | left | 110px |
| 3 | 시작 | `MM-DD HH:mm:ss` (당일이면 `HH:mm:ss`) | left | 160px |
| 4 | 완료 | 동일 포맷 또는 `—` | left | 100px |
| 5 | 소요시간 | `formatDurationMs` (R28 conversion 페이지의 함수 그대로 재사용) | right | 80px |
| 6 | 크기 | `formatBytes` (KB/MB/GB) 또는 `—` | right | 90px |
| 7 | 액션 | DONE이면 `<Button variant="outline">⬇ 다운로드</Button>`<br/>FAILED이면 `<Button variant="ghost">i 오류 확인</Button>` (popover에 errorMessage)<br/>RUNNING이면 비어 있음 | center | 120px |

- 헤더는 `.app-table` + sticky thead 사용 (globals.css §307).
- row 호버: `bg-bg-muted/40`.
- row 클릭: 행 펼침 토글 — 펼쳐지면 storagePath, errorMessage, finishedAt 자세히 (R28 conversions의 expand 패턴).
- 행 keyboard: ↑↓ 포커스 이동, Enter = expand toggle. (간단 phase 1: tab 순회만 보장).

### B.5 상태 색상 — `<BackupStatusBadge>`

R28의 `<ConversionStatusBadge>` 팔레트와 의도적으로 정렬해 운영자의 시각 인지 부담을 줄인다.

| status | label | 알약 색 | dot 색 | pulse |
|---|---|---|---|---|
| RUNNING | 진행 중 | `bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300` | `bg-sky-500` | **yes** |
| DONE | 완료 | `bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300` | `bg-emerald-500` | no |
| FAILED | 실패 | `bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300` | `bg-rose-500` | no |

- 알약 모양: `inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium leading-none`.
- 6px dot + label + (RUNNING) 스피너 옵션 (Loader2, h-3.5 w-3.5).
- 접근성: `role="status"` + `aria-label="백업 상태: {label}"`.

> 컴포넌트 위치 추천: `apps/web/components/admin/backups/BackupStatusBadge.tsx`.
> R28 ConversionStatusBadge 코드의 100% mirror — frontend는 파일을 새로 만들고 RUNNING/DONE/FAILED 3개 enum만 정의.

**KindBadge:**
- 작은 outline pill. 색상은 채움 없이 border만. 운영자가 이미 컬러 4개(sky/emerald/rose/slate)를 status에 쓰므로 kind까지 색을 더하면 시각 잡음.
- `<span className="inline-flex h-5 items-center gap-1 rounded border border-border px-1.5 text-[11px] font-medium text-fg-muted">DB</span>` — `POSTGRES → "DB"`, `FILES → "파일"`.

### B.6 폴링 정책

- `useQuery({ queryKey: ['admin','backups',filter], queryFn, refetchInterval: (q) => running(q) ? 5000 : false })` — R28 conversions와 동일 패턴(§B.4 conversion page).
- `running(q)` = `q.state.data?.meta.runningCount > 0` (또는 fallback: `data.some(r => r.status === 'RUNNING')`).
- Visibility API: 탭 hidden일 때 자동 일시정지 (TanStack Query 기본 + 명시적 `visibilitychange` 핸들러로 복귀 시 1회 refetch).
- `refetchIntervalInBackground: false`.

### B.7 Empty / Loading / Error 상태

| 상태 | 컴포넌트 | 메시지 |
|---|---|---|
| 첫 로딩 | `<Skeleton>` 5행 (R28 conversions 동일) | — |
| 빈 (data.length === 0) | `<EmptyState icon={Archive} title="백업 이력이 없습니다." description="매일 02:00에 자동 실행됩니다. 또는 우측 상단 '지금 실행'을 눌러 수동으로 실행할 수 있습니다." />` | description 안에 retention 안내 한 줄 더: "백업은 30일 후 자동 삭제됩니다." |
| 에러 (network) | inline alert (rose) + 재시도 버튼 | "백업 이력을 불러오지 못했습니다. {message}" + `<Button onClick={refetch}>재시도</Button>` |
| 권한 에러 (403) | `<EmptyState icon={ShieldAlert} title="권한이 없습니다." description="이 페이지는 관리자 권한이 필요합니다." />` | — |

### B.8 다운로드 액션

- DONE row의 "⬇ 다운로드" 클릭 → `<a href={`/api/v1/admin/backups/${row.id}/download`} download>` 형태 또는 `window.location.href = ...` 또는 `fetch + blob` 중 단순 anchor 권장 (BE가 `Content-Disposition: attachment` 보냄).
- 클릭 직후 toast: "다운로드를 시작합니다…" (sonner). 큰 파일(>1GB)은 브라우저가 알아서 진행률 표시.
- 권장 구현: `<Button asChild><a href={url} download>...</a></Button>` (shadcn/ui 패턴).

### B.9 FAILED row의 errorMessage

- 액션 컬럼에 `<Button variant="ghost" size="sm">i 오류 확인</Button>` → `<Popover>` (radix) 표시.
- popover 내용: `<pre className="text-xs whitespace-pre-wrap max-h-60 overflow-auto">{errorMessage}</pre>` + 하단 "복사" 버튼 (clipboard API).
- 디자인 토큰: bg-bg, border-border, p-3, rounded-md, max-w-sm.
- 만약 errorMessage가 너무 길면(`> 2000자`) 첫 1500자 + "(중략)" + 마지막 500자.

### B.10 페이지네이션

- cursor 기반. `meta.nextCursor`가 있으면 테이블 하단에 `<Button variant="outline" className="w-full">더 불러오기 (n=50)</Button>`.
- 클릭 → `loadMore()` (R28 conversions의 `loadMore` 패턴 동일). Page 0만 polling, page 1+ append-only.

---

## C. 컴포넌트 시그니처 + 인터랙션 시퀀스

### C.1 `<KeycloakLoginButton>`

**Props:**
```
interface KeycloakLoginButtonProps {
  callbackUrl?: string;
  disabled?: boolean;
  className?: string;
}
```

**상태 머신:** 단순 — `idle → submitting → (redirect)`.

**시퀀스:**
```
User: clicks button
  ↓
Component: setSubmitting(true)
Component: signIn('keycloak', { callbackUrl })   # next-auth/react
  ↓ (full-page redirect to KEYCLOAK_ISSUER)
Keycloak: 사용자 인증
  ↓ (redirect back to /api/auth/callback/keycloak)
Auth.js: signIn callback (BE에서 user provisioning)
  ↓ (redirect to callbackUrl ?? '/')
Browser: 새 페이지 로드 — component unmount
```

성공 측 별도 client-side handling 불필요. 실패 측은 Auth.js가 `?error=OAuthCallback` 등으로 `/login`에 다시 보내므로 `<LoginForm>`의 `initialError`가 받아 처리.

### C.2 `<BackupRunDialog>`

**위치:** `apps/web/components/admin/backups/BackupRunDialog.tsx`.

**Props:**
```
interface BackupRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTriggered?: (jobId: string) => void;  // optimistic insert에 활용
}
```

**레이아웃:**
```
┌── Dialog (max-w-md) ──────────────────────────────────────────┐
│ DialogHeader                                                   │
│   Title:        백업 실행                                       │
│   Description:  실행할 백업 종류를 선택하세요.                  │
│                 진행 상황은 테이블에 RUNNING으로 표시됩니다.    │
├────────────────────────────────────────────────────────────────┤
│  ─ Radio group (vertical, 2개) ──                               │
│   (●) DB 백업 (PostgreSQL pg_dump)                              │
│       마지막 백업: 04-27 02:00 (DONE, 412MB)                    │
│   (○) 파일 백업 (storage tarball)                               │
│       마지막 백업: 04-27 02:11 (DONE, 4.3GB)                    │
│                                                                 │
│   ⚠ 동시 실행은 1건만 허용됩니다. 이미 RUNNING이 있으면          │
│     선택지가 비활성화되며, 끝난 후 다시 시도하세요.              │
├────────────────────────────────────────────────────────────────┤
│ DialogFooter                                                    │
│   [취소]  [실행]                                                │
└────────────────────────────────────────────────────────────────┘
```

**행동:**
- mount 시 `meta.runningCount > 0`이면 같은 kind의 라디오 선택 비활성화 (`disabled` + tooltip "이미 진행 중입니다").
- "실행" 클릭:
  1. `setMutating(true)` + `mutate({ kind })` → `POST /api/v1/admin/backups/run`.
  2. 성공: `toast.success('백업이 시작되었습니다. 곧 테이블에 표시됩니다.')` + `queryClient.invalidateQueries(['admin','backups'])` + `onOpenChange(false)`.
  3. 실패: 상태별 toast — 409 = "이미 진행 중인 백업이 있습니다.", 403 = "권한이 없습니다.", `E_RATE_LIMIT` = "잠시 후 다시 시도하세요.", 그 외 = "백업 실행 실패: {message}".
- ESC / 바깥 클릭: `mutating` 중에는 차단 (Radix Dialog `onPointerDownOutside={e => e.preventDefault()}` + `onEscapeKeyDown={e => mutating && e.preventDefault()}`).
- 키보드: 라디오 ↑↓ 이동 + Enter = 실행.

**마지막 백업 정보:**
- BE가 응답 meta에 `lastRun: { POSTGRES: BackupRowDTO | null, FILES: BackupRowDTO | null }`을 내려주면 좋음. 없으면 listQuery에서 kind별 첫 row 클라이언트 추출.

### C.3 `<BackupTable>`

**위치:** `apps/web/components/admin/backups/BackupTable.tsx`.

**Props:**
```
interface BackupTableProps {
  rows: BackupRowDTO[];
  loading: boolean;
  onRowExpand?: (rowId: string | null) => void;  // 선택사항
  onDownload: (rowId: string) => void;           // anchor click handler
  onShowError: (row: BackupRowDTO) => void;      // popover anchor 직접 처리 시 미사용
}
```

- 테이블 마크업: `<table className="app-table">` + `<thead><tr>...</tr></thead>` + `<tbody>`.
- 각 row의 키보드 포커스 가능: `<tr tabIndex={0} onKeyDown={...}>`.
- `aria-rowindex` 명시 (스크린 리더용).
- 가로 스크롤 가드: `overflow-x-auto` 부모 wrapper(`.app-table-scroll` 클래스 R28에서 정의됨).

**시퀀스 (다운로드):**
```
User: row의 "다운로드" 클릭
  ↓
Component: anchor href = `/api/v1/admin/backups/${id}/download` 즉시 navigation
Browser: 인증 쿠키 자동 첨부 (same-origin)
BE: storagePath 파일 streaming + Content-Disposition: attachment
Browser: 저장 다이얼로그 (큰 파일이면 진행률 표시)
```

**시퀀스 (오류 확인):**
```
User: FAILED row의 "i 오류 확인" 클릭
  ↓
Popover: open=true, anchor=button
  Content: errorMessage(잘림 처리) + "복사" 버튼
User: ESC / 바깥 클릭
  ↓
Popover: open=false
```

### C.4 페이지 컴포지션 트리

```
<BackupsPage>                                              (page.tsx, 'use client')
├─ <AdminSidebar />                                       (기존)
└─ <section>                                               (main pane)
   ├─ <Breadcrumb>관리자 / 백업</Breadcrumb>
   ├─ <PageHeader>                                        (kicker + h1 + description + action buttons)
   │  ├─ <Button variant="outline" size="sm" aria-label="새로고침">
   │  └─ <Button onClick={() => setRunDialogOpen(true)}>지금 실행</Button>
   ├─ <StatsStrip stats={meta.stats?} />                  (선택 — phase 1에서 단순한 1줄 요약. 없으면 스킵 가능)
   ├─ <Suspense fallback={<TableSkeleton />}>
   │     <BackupTable rows={...} ... />
   │  </Suspense>
   ├─ <LoadMoreButton visible={!!nextCursor} />
   └─ <BackupRunDialog open={runDialogOpen} onOpenChange={setRunDialogOpen} />
```

---

## D. PM Decision Items (보수적 default)

각 항목은 PM이 결정하지 않으면 **D.x default**로 진행. 결정 결과는 PM이 최종 spec 사용 시 frontend agent prompt에 명시.

| ID | 항목 | 보수적 default | 선택지 |
|---|---|---|---|
| **D.1** | `/admin/backups` 접근 권한 | **ADMIN+** (즉, ADMIN/SUPER_ADMIN 둘 다 가능) | (a) ADMIN+ — 기본 admin/* 가드와 동일 / (b) SUPER_ADMIN only — 백업이 워낙 민감해 슈퍼만 |
| **D.2** | 즉시 실행 권한 | D.1과 동일 | 다운로드/실행은 다른 권한 분리도 가능하나 default는 동일 |
| **D.3** | SSO 버튼 위치 | **Credentials form 위** (primary) | (a) 위 / (b) 아래 보조 / (c) 좌우 분할 |
| **D.4** | `KEYCLOAK_ENABLED=1`일 때 Credentials form 표시 여부 | **표시** (협력업체용 fallback) | (a) 표시 / (b) 숨김 (SSO only) |
| **D.5** | retention 안내 카피 | **"30일 후 자동 삭제"** | 30/60/90 — `BACKUP_RETENTION_DAYS` 환경변수 기반. 30 외 다른 값일 때만 PM이 카피 변경 결정 |
| **D.6** | 백업 다운로드 시 confirm 다이얼로그 | **없음** (anchor 즉시 navigation) | (a) 없음 / (b) "이 파일은 민감한 정보를 포함합니다. 계속하시겠습니까?" 1회 |
| **D.7** | RUNNING 상태에서 사용자가 다운로드 시도 | 액션 컬럼 자체가 비어있어 시도 불가 (default) | 별도 처리 불필요 |
| **D.8** | FAILED row의 "재시도" 버튼 | **이번 라운드 없음** | (a) 없음 / (b) 추가 — 새 RUNNING row 발생. 재시도 빈도 제한 필요해 phase 2 권장 |
| **D.9** | RUNNING이 24시간 이상이면 stale 표시 | **default: 그대로 RUNNING** | BE 측 책임 (stuck job 감지 후 FAILED로 전이) — FE는 표현만 |
| **D.10** | "지금 실행" 라디오에서 BE가 `meta.runningCount` 미제공 시 | **클라이언트 측 `data.some(r=>r.status==='RUNNING')` 사용** | BE에 inline 추가 권장 (R28 패턴과 일관) |
| **D.11** | KindBadge 색 사용 여부 | **outline only (border만)** | 색 추가 시 status 색과 시각 충돌 가능 — phase 2 평가 |
| **D.12** | 빈 상태에서 "지금 실행" 권유 정도 | **EmptyState description에 한 줄 안내만** | (a) 안내만 / (b) action prop에 primary CTA 버튼 추가 |
| **D.13** | 시간 포맷 — 당일/그 외 | **당일=`HH:mm:ss`, 그 외=`MM-DD HH:mm`** (R28 패턴 동일) | KST 고정 |
| **D.14** | 다국어 | **한국어 only** | 영문 라벨 보조는 admin 페이지 외부와 동일 (kicker만 영문 `ADMIN CONSOLE`) |
| **D.15** | mobile/tablet 대응 | **Desktop only — ≥1280** | drawing-mgmt 전체 정책. 1024px 이하 미지원 안내 없음 (admin 진입은 desktop 가정) |

---

## E. 디자인 토큰 / 컴포넌트 변경

### E.1 새 토큰

**없음.** R33은 기존 토큰만으로 구현 가능:
- 색: `--brand`, `--bg`, `--bg-muted`, `--bg-subtle`, `--fg`, `--fg-muted`, `--fg-subtle`, `--border`, `--border-strong`, `--ring` + Tailwind palette(`sky-*`, `emerald-*`, `rose-*`, `slate-*`).
- 스페이싱: 기본 Tailwind.
- 타이포: 기본 Tailwind + `app-kicker` (이미 globals.css §302).

### E.2 기존 컴포넌트 재사용

| 새 사용처 | 기존 컴포넌트 / 토큰 | 출처 |
|---|---|---|
| `<KeycloakLoginButton>` 색 | `bg-brand text-brand-foreground hover:bg-brand-600` | tailwind.config.ts |
| `<BackupStatusBadge>` 알약 | R28 `<ConversionStatusBadge>` 미러 | `apps/web/components/conversion/ConversionStatusBadge.tsx` |
| `<BackupTable>` 테이블 | `.app-table` + `.app-table-scroll` | globals.css §307 |
| 헤더 우측 액션 | `.app-action-button-primary` | globals.css §297 |
| EmptyState | `<EmptyState>` from `@/components/EmptyState` | R28에 정의 |
| Dialog | shadcn/ui `<Dialog>` | `@/components/ui/dialog` |
| Popover (오류 메시지) | shadcn/ui `<Popover>` | `@/components/ui/popover` |
| Toast | sonner `toast.success/error/warning` | 기존 |

### E.3 신규 파일 (frontend agent용 체크리스트)

- `apps/web/app/(auth)/login/keycloak-button.tsx` — 약 50 LOC.
- `apps/web/app/(auth)/login/login-form.tsx` — `mapErrorCode` + JSX 분기 추가 (변경 LOC ≈ 20).
- `apps/web/app/(main)/admin/backups/page.tsx` — 신설, 약 250 LOC.
- `apps/web/components/admin/backups/BackupTable.tsx` — 약 200 LOC.
- `apps/web/components/admin/backups/BackupRunDialog.tsx` — 약 150 LOC.
- `apps/web/components/admin/backups/BackupStatusBadge.tsx` — 약 80 LOC (R28 mirror).
- `apps/web/components/admin/backups/types.ts` — DTO 타입.
- `apps/web/lib/queries.ts` — `queryKeys.admin.backups({ kind, cursor })` 추가 (1줄).
- `apps/web/app/(main)/admin/admin-groups.ts` — `/admin/backups` 메뉴 한 줄 추가.

---

## F. 접근성 체크리스트 (WCAG 2.1 AA)

- [ ] `<KeycloakLoginButton>` 명도대비 ≥ 4.5:1 (brand-on-white).
- [ ] 폼 라벨 — `<label htmlFor>`로 input과 명시적 연결 (기존 LoginForm 그대로 유지).
- [ ] 모든 버튼 keyboard 접근 가능 — Tab 순서 합리적 (login: SSO → 아이디 → 비밀번호 → Credentials 로그인 → 테스트 관리자).
- [ ] focus-visible ring 가시 (기존 `--ring` 토큰 사용).
- [ ] 상태 색만으로 의미 전달 금지 — `<BackupStatusBadge>`는 (a) 색 (b) 라벨 텍스트 (c) `aria-label` 3중.
- [ ] `<Dialog>` open 시 포커스가 첫 라디오로 이동, close 시 trigger 버튼으로 복귀 (Radix 기본).
- [ ] `<Popover>` 안의 errorMessage `<pre>`는 `aria-live="polite"` 필요 없음 (사용자 트리거).
- [ ] 테이블에 `<caption className="sr-only">백업 작업 이력</caption>` (스크린 리더).
- [ ] `aria-busy` — 폴링 갱신 중 테이블 wrapper에 표시 (선택).
- [ ] EmptyState의 description 한국어 자연스러움 + 읽기 어려운 약어 없음.

---

## G. 테스트 시나리오 (QA 가이드)

1. **로그인 — KEYCLOAK_ENABLED=1:** `/login` 진입 → SSO 버튼 visible + primary 위계 확인. 클릭 → KEYCLOAK_ISSUER로 redirect. 인증 후 callback → `/` 진입. user 테이블에 새 row(첫 로그인이면).
2. **로그인 — KEYCLOAK_ENABLED=0:** SSO 버튼 absent. 기존 Credentials 폼 동작 회귀 0건.
3. **로그인 — 콜백 에러:** Keycloak에서 거부 → `/login?error=OAuthCallback` → 에러 박스에 한국어 메시지.
4. **백업 페이지 진입 (관리자):** `/admin/backups` 진입 → 사이드바 활성 표시 → 테이블 로드.
5. **백업 페이지 진입 (USER 역할):** middleware 가드로 차단 → `/login?callbackUrl=/admin/backups`로 redirect.
6. **즉시 실행:** "지금 실행" → POSTGRES 선택 → "실행" → 1초 안에 RUNNING row 추가 → 5초마다 폴링 → DONE 전이 확인.
7. **이미 RUNNING:** 같은 다이얼로그 재진입 → 동시 RUNNING이 있는 kind 라디오 disabled.
8. **다운로드:** DONE row의 "⬇" → 브라우저 저장 다이얼로그.
9. **FAILED row 오류 확인:** "i" 클릭 → popover에 errorMessage. 복사 버튼 동작.
10. **빈 상태:** 이력 0건 → EmptyState (Archive 아이콘) + 안내.
11. **권한 에러 (mock 403):** EmptyState (ShieldAlert) + 메시지.
12. **대용량 stress:** 1000+ row → `더 불러오기` 버튼 정상 page 0 폴링 유지.
13. **접근성:** Tab만으로 페이지 전체 navigate 가능. axe-core 자동 검사 0 violations 목표.
14. **다크 모드:** 모든 색상 이하 다크 토큰 정상.
15. **Network 끊김:** 폴링 실패 → toast 에러 + 다음 5초 후 재시도.

---

## H. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-04-27 | 초기 작성 (R33). PM이 contract §3.2/§4.4 확정한 상태에서 디자인 spec 1개 작성. |
