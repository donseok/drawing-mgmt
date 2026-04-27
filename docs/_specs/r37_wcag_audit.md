# R37 Design Spec — WCAG 2.1 AA Audit + SAML Login UX

| 항목 | 내용 |
|---|---|
| 작성자 | drawing-mgmt designer agent (R37) |
| 작성일 | 2026-04-27 |
| 기준 main HEAD | `370a1c6` |
| 대상 라운드 | R37 |
| 대상 PRD/DESIGN | `docs/PRD.md` §3.1(페르소나), `docs/DESIGN.md` §11(접근성), §2.5(토큰), §10.1(Empty/Loading) |
| API 계약 | `_workspace/api_contract.md` §3.3(SAML 버튼), §4(WCAG audit), §6(FE 작업 분배) |
| 신규 라우트 | 없음 |
| 신규 컴포넌트 | `<SamlLoginButton>` (A 카드), `<SkipToContent>` (B 카드 P0-1) |
| 확장 컴포넌트 | `<LoginForm>` (SAML 버튼 wire), `apps/web/app/(main)/layout.tsx` (skip-link + main id), 그 외 P0/P1 패치 — 본문 §B 참고 |
| 의존 (BE) | `/api/v1/auth/saml/login`, `NEXT_PUBLIC_SAML_ENABLED` env (backend가 노출) |
| 디바이스 | Desktop only (≥1280) |
| 디자인 토큰 변경 | **있음 (P0-2 색대비 보정)**: `--fg-subtle` light: `240 4% 65%` → `240 4% 50%`. dark: `240 4% 55%` → `240 5% 70%`. §C.1 참조 |
| 새 단축키 | 없음. 기존 ⌘P / ⌘K / `?`(shortcuts) 유지 |
| 프리뷰 의도 | 이번 라운드는 **audit + P0/P1 수정 + SAML 버튼**까지. P2(저순위, 시각/장식 미세 개선)는 R38 이후 별도 카드 |

---

## 0. 라운드 개요와 사용자 시나리오

### 0.1 두 카드가 같은 라운드에 묶이는 이유

A-2(SAML SSO)와 AC-1(WCAG 2.1 AA audit)은 **운영 환경 안정화**라는 동일 카테고리에 속한다. SAML은 사내 IdP 분기로 R33의 Keycloak 옆자리에 들어갈 보조 SSO 경로이고, WCAG audit은 그동안 "기능 우선 / 접근성은 뒤로"였던 부채를 한 번에 정리하는 카드다. 둘 다 **자료 데이터 모델은 건드리지 않고**, 화면 chrome / 로그인 / 폼 / 동적 영역을 손본다는 공통점이 있다. 회귀 위험은 낮지만 영향 면적은 13 화면 + admin 10+로 가장 넓은 라운드라 designer 산출물의 우선순위 매김이 실패 시 frontend 부담이 커진다 → 이 문서가 **P0/P1만 이번 라운드, P2는 다음 라운드**라고 명시.

### 0.2 페르소나별 시나리오

| 페르소나 | A-2 SAML | AC-1 WCAG audit |
|---|---|---|
| 슈퍼관리자 / 관리자 | SAML_ENABLED=1 환경에서 사내 SSO를 SAML로 사용하는 별도 IdP가 있을 때 Keycloak 옆에 SAML 버튼을 통해 로그인. (PM 결정: A-1 Keycloak이 default, A-2는 보조 SSO) | 키보드만으로 admin 페이지 사용 가능 — Skip-to-content, 폼 라벨, errormessage, focus-visible 보장 |
| 설계자 (10~15명) | 거의 영향 없음 — 본인은 Keycloak으로 들어옴 | tab/shift+tab 으로 검색 결과 그리드를 탐색, 측정·줌 단축키가 viewer 모드에서 잘 작동, 도면 검색에서 "검색 결과 1,234건"같은 동적 카운트가 스크린리더에 announce |
| 열람자 (5~10명) | 거의 영향 없음 | 동일. 특히 색맹/저시력 사용자에게 `text-fg-subtle` 4.5:1 미만 대비 문제(P0-2)가 정상화되면 **"섹션 헤더 / Saved Views 카운트 / breadcrumb 보조 텍스트"가 처음으로 읽힘** |
| 협력업체 (5사) | SAML 사용 안함 (외부) | lobby [id] 검토회신 dialog가 키보드로 제어 가능해야 함(P1-3) |

### 0.3 핵심 시나리오 5개

1. **SAML SSO로 로그인 (관리자, SAML_ENABLED=1):** `/login` → Keycloak 버튼 아래에 동등 위계의 "SAML SSO 로그인" primary 버튼 → 클릭 → `/api/v1/auth/saml/login` redirect → IdP → ACS 콜백 → `/`. **Keycloak이 default**여서 SAML은 시각적으로 secondary가 아니라 **둘 다 primary 위계, 다른 아이콘**으로 구분 (Keycloak=KeyRound, SAML=Shield).
2. **SAML 비활성 (대부분의 환경):** `NEXT_PUBLIC_SAML_ENABLED=0` → SAML 버튼 자체가 렌더되지 않음. R33의 Keycloak 분기 회귀 0건.
3. **키보드 탐색 (설계자, P0-1 fix 후):** 페이지 진입 → tab 1번 → "본문으로 건너뛰기" skip-link 보임 → enter → main으로 포커스 점프. (현재는 7~10번 tab 후에야 본문 도달).
4. **검색 결과 카운트 announce (저시력 열람자, P1-2 fix 후):** /search에서 필터 적용 → 우상단 "검색 결과 1,234건" 셀이 변경 → `aria-live="polite"`로 스크린리더가 "검색 결과 1,234건"을 읽음. (현재는 silent 변경).
5. **폼 에러 association (관리자, P1-4 fix 후):** /admin/users 사용자 편집 다이얼로그에서 잘못된 이메일 입력 → 인풋 아래 빨간 텍스트 보임 + `aria-describedby`로 input과 연결 → 스크린리더 "이메일 형식이 올바르지 않습니다" 자동 read.

---

## A. SAML 로그인 UX (A-2 카드)

### A.1 진입점 — 어디에 어떻게 추가하는가

**대상 파일:** `apps/web/app/(auth)/login/login-form.tsx`. R33에서 추가된 `<KeycloakLoginButton>` 옆에 `<SamlLoginButton>`을 형제로 추가. SubSidebar처럼 "감춤 / 표시" 분기는 `NEXT_PUBLIC_SAML_ENABLED === '1'`로.

**왜 Keycloak 옆인가 (디자인 결정):**
- Keycloak과 SAML은 둘 다 SSO 옵션이며 환경별로 **택일** 또는 **공존**.
- PRD §3.1의 페르소나 중 "협력업체 5사"를 제외하면 거의 모두가 도메인 계정 → SSO가 권장 경로라는 R33의 결론은 그대로.
- 두 SSO 옵션이 **동시에 켜지는 환경(SAML_ENABLED=1 AND KEYCLOAK_ENABLED=1)** 에서는 **두 버튼 모두 primary, 위/아래로 stack**, 동일 너비 + 동일 높이(h-10).
- "SAML이 secondary"로 보이게 하면 사내 IdP가 SAML인 환경에서 사용자가 곁눈질로 Keycloak을 누르는 사고가 늘어남.

### A.2 분기 시각

```
┌──────── KEYCLOAK_ENABLED=1, SAML_ENABLED=1 (동시) ────────┐
│  ┌── app-panel ─────────────────────────────────────┐    │
│  │  ┌────────────────────────────────────────────┐  │    │
│  │  │  [🗝 KeyRound]  사내 SSO 로그인              │  │    │
│  │  └────────────────────────────────────────────┘  │    │
│  │     ─ KeycloakLoginButton, brand, h-10 ─          │    │
│  │  ┌────────────────────────────────────────────┐  │    │
│  │  │  [🛡 Shield]  SAML SSO 로그인               │  │    │
│  │  └────────────────────────────────────────────┘  │    │
│  │     ─ SamlLoginButton,    brand, h-10 ─           │    │
│  │     ─ gap-2 between two buttons ─                 │    │
│  │                                                   │    │
│  │  ─── 또는 ────────────────────────────────────    │    │
│  │                                                   │    │
│  │  아이디 / 비밀번호 + 로그인(outline) + 테스트 ...  │    │
│  └─────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────┘

┌──────── KEYCLOAK_ENABLED=0, SAML_ENABLED=1 ────────────┐
│  ┌── app-panel ─────────────────────────────────────┐    │
│  │  ┌────────────────────────────────────────────┐  │    │
│  │  │  [🛡 Shield]  SAML SSO 로그인               │  │    │
│  │  └────────────────────────────────────────────┘  │    │
│  │  ─── 또는 ────                                    │    │
│  │  아이디 / 비밀번호 + 로그인(outline)               │    │
│  └─────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────┘

┌──────── KEYCLOAK_ENABLED=0, SAML_ENABLED=0 ────────────┐
│   기존 그대로. 회귀 0건.                               │
└────────────────────────────────────────────────────────┘
```

### A.3 신규 컴포넌트 — `<SamlLoginButton>`

**파일:** `apps/web/app/(auth)/login/saml-button.tsx` (신규).
**baseline:** `apps/web/app/(auth)/login/keycloak-button.tsx`를 그대로 모사. 차이점만 명시.

**props (KeycloakLoginButton과 동일 인터페이스 — 호환성):**
```ts
interface SamlLoginButtonProps {
  callbackUrl?: string;
  disabled?: boolean;
  className?: string;
}
```

**시각:**
- 동일 `<Button>` (shadcn) 사용. `h-10 w-full text-sm font-medium`.
- 아이콘: `lucide-react`의 `Shield` (24×24, 내부 h-4 w-4). KeyRound와 다른 모양 → 사용자가 "두 SSO" 구분 가능.
- 라벨: "SAML SSO 로그인" / submitting 시 "SAML로 이동 중…".
- aria-label: `"SAML SSO로 로그인"`.

**동작:**
- `signIn('saml', { callbackUrl })` 또는 (Auth.js v5 SAML 미지원 시) BE가 마련한 `/api/v1/auth/saml/login` 으로 `window.location.href = ...` redirect.
- 어느 쪽이 될지는 backend agent의 §3.1 분기 결정에 따른다 (contract §3.1에 옵션 A/B 명시). designer 입장에서는 **둘 다 동일 시각**, 동작 wiring은 frontend가 BE 산출 보고 결정.

**예시 코드 (frontend가 그대로 옮길 수 있음):**

```tsx
'use client';

import * as React from 'react';
import { signIn } from 'next-auth/react';
import { Shield, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export interface SamlLoginButtonProps {
  callbackUrl?: string;
  disabled?: boolean;
  className?: string;
}

export function SamlLoginButton({
  callbackUrl,
  disabled,
  className,
}: SamlLoginButtonProps): JSX.Element {
  const [submitting, setSubmitting] = React.useState(false);

  async function onClick() {
    setSubmitting(true);
    try {
      // Auth.js v5에 SAML provider가 정식 등록되어 있으면 signIn 사용.
      // 없으면 BE의 /api/v1/auth/saml/login 으로 직접 redirect — backend가
      // 결정하여 contract §3.1에 wiring 방식 적어주면 그에 맞춤.
      await signIn('saml', { callbackUrl: callbackUrl ?? '/' });
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled || submitting}
      aria-label="SAML SSO로 로그인"
      className={cn('h-10 w-full text-sm font-medium', className)}
    >
      {submitting ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          SAML로 이동 중…
        </>
      ) : (
        <>
          <Shield className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
          SAML SSO 로그인
        </>
      )}
    </Button>
  );
}
```

### A.4 `<LoginForm>` 변경 (frontend가 옮길 패치)

**대상:** `apps/web/app/(auth)/login/login-form.tsx`.

```tsx
import { KeycloakLoginButton } from './keycloak-button';
import { SamlLoginButton } from './saml-button';   // ★ 신규

const ssoEnabled =
  process.env.NEXT_PUBLIC_KEYCLOAK_ENABLED === '1' ||
  process.env.NEXT_PUBLIC_SAML_ENABLED === '1';     // ★ 변경 (둘 중 하나라도 켜져 있으면 SSO 패널 + 디바이더)

const keycloakEnabled = process.env.NEXT_PUBLIC_KEYCLOAK_ENABLED === '1';
const samlEnabled     = process.env.NEXT_PUBLIC_SAML_ENABLED === '1';
```

**JSX 본문 — `app-panel p-6` 안에서:**
```tsx
{ssoEnabled ? (
  <>
    <div className="app-panel space-y-2 p-6">
      {keycloakEnabled ? (
        <KeycloakLoginButton callbackUrl={callbackUrl} disabled={locked || submitting} />
      ) : null}
      {samlEnabled ? (
        <SamlLoginButton     callbackUrl={callbackUrl} disabled={locked || submitting} />
      ) : null}
    </div>
    {/* divider 동일 — "또는" */}
  </>
) : null}
```

**자동 포커스 규칙 (P1-1과 연관):** SSO가 단 하나만 활성이면 그 버튼이 페이지 첫 포커스 (이미 R33 패턴). 둘 다 활성이면 첫 번째(Keycloak)에 포커스. 변경 없음.

### A.5 .env.example 표시

backend가 contract §3.1에서 추가하는 env 외에, **frontend가 알아야 하는 것은 `NEXT_PUBLIC_SAML_ENABLED`** 단 하나. R33의 `NEXT_PUBLIC_KEYCLOAK_ENABLED`와 동일 패턴이라 별도 디자인 결정 없음.

---

## B. WCAG 2.1 AA Audit — 13 화면 + admin

각 화면에 대해 (a) 키보드 nav (b) 스크린 리더 (c) 색대비 (d) 동적 콘텐츠 (e) 폼 5축으로 점검. **이번 라운드 수정은 P0/P1만**, P2는 다음 라운드. 발견 항목은 **`screen` / `severity` / `axis` / `현상` / `수정 hint`** 5필드.

### B.0 audit 범위 일람

| # | screen | path | 페르소나 노출 |
|---|---|---|---|
| 1 | 로그인 | `/login` | 전 사용자 (특히 외부 SSO 사용자) |
| 2 | 홈 | `/` | 전 사용자 (시작 화면) |
| 3 | 검색 | `/search` | 설계자/열람자 (1순위 화면) |
| 4 | 자료 상세 | `/objects/[id]` | 설계자/열람자/관리자 |
| 5 | 뷰어 | `/viewer/[attachmentId]` | 설계자/열람자/협력업체 |
| 6 | 결재 | `/approval`, `/approval/[id]` | 관리자/설계자 |
| 7 | 로비 | `/lobby`, `/lobby/[id]` | 협력업체/관리자 |
| 8 | 환경설정 | `/settings` | 전 사용자 |
| 9 | 작업공간 | `/workspace` | 전 사용자 |
| 10 | admin 대시 | `/admin` | 관리자/슈퍼관리자 |
| 11 | admin 사용자 | `/admin/users` | 슈퍼관리자 |
| 12 | admin 폴더권한 | `/admin/folder-permissions` | 슈퍼관리자 |
| 13 | admin 그룹/조직 | `/admin/groups`, `/admin/organizations` | 슈퍼관리자 |
| (참고) | admin 그 외 | `/admin/{classes,backups,scans,conversions,storage,[section]}` | 슈퍼관리자. **공통 발견 항목은 위 13개에서 도출됐고, 이 군은 동일 패치 footprint** — §B.5 참조 |

### B.1 P0 — 즉시 수정 (이번 라운드)

P0 정의: **"키보드 사용자가 이 화면을 사용할 수 없다"** 또는 **"WCAG 1.4.3 Contrast(4.5:1)을 명백히 위반한다"** 인 항목.

| ID | screen | axis | 현상 | 수정 hint |
|---|---|---|---|---|
| **P0-1** | 전체(layout) | (a) 키보드 nav | `apps/web/app/(main)/layout.tsx`에 main으로 점프하는 skip-link 없음. NavRail 9~12 tab + GlobalFolderSidebar 5~30 tab을 통과해야 본문 도달. | §C.2 `<SkipToContent>` 컴포넌트 추가 + `<main id="main-content" tabIndex={-1}>` 부여. WCAG 2.4.1 Bypass Blocks. |
| **P0-2** | 전체(globals.css) | (c) 색대비 | `--fg-subtle: 240 4% 65%` (light) → `#a4a4a8` on white = 약 2.6:1. WCAG 1.4.3 (normal text 4.5:1) 위반. dark의 `240 4% 55%`도 대형 텍스트 한정. 적용 부위: Saved Views 카운트, breadcrumb 보조, kicker 라벨, status info 배경 텍스트, ObjectTable 일부 메타. | §C.1 토큰 변경. light 65% → 50%, dark 55% → 70%. 모든 사용처는 토큰만 갈아끼우면 자동 수정 — 검색/대체 불필요. |
| **P0-3** | /viewer | (a) 키보드 nav | `<ViewerShell>`이 `<canvas>` 위주 + 단축키 안내(?)가 viewer 안에서 announce 안 됨. 키보드 사용자가 측정/줌을 시작할 진입점이 약함 (toolbar 버튼은 있음 — confirm). | toolbar 버튼은 이미 aria-label 있음(확인됨). 추가: `<ViewerShell>` 루트에 `aria-label="도면 뷰어"` + canvas wrapper에 `role="application"`로 명시. (canvas 직접 조작 단축키는 viewer-engineer가 별도 카드로 진행) |
| **P0-4** | /admin/users | (e) 폼 | `<UserFormDialog>`의 이메일/이름 필드 errormessage가 `<p>`로만 렌더되고 `aria-describedby`로 input과 연결 안 됨. 스크린리더가 에러를 읽지 못함. | input에 `aria-invalid` + `aria-describedby={errorId}` 부여, 에러 `<p>` 에 `id={errorId}`. WCAG 3.3.1 Error Identification. |
| **P0-5** | /search 그리드 | (d) 동적 콘텐츠 | "{N}건 패키징 중…" / 에러 toast는 sonner로 OK이지만 ObjectTable의 row state 변경(체크아웃→체크인 등)이 silent. 시각 사용자는 색 변화로 알지만 스크린리더 사용자는 모름. | sonner는 이미 `role="status"`로 announce → OK. ObjectTable 본문은 변경 불필요. **하지만** 검색 결과 카운트 셀(우상단 Metric "{filtered.length}건")은 `aria-live="polite"`로 wrap 필요. 이건 P1-2로 다운그레이드. (재분류) — P0 아님. P0-5 항목은 삭제. |

> P0-5는 audit 중 P1로 재분류. P0 진짜 항목은 4개.

### B.2 P1 — 가능하면 이번 라운드, 시간 부족 시 다음 라운드

P1 정의: 키보드/스크린리더 사용자가 **사용은 가능하나 정보 손실** 또는 **흐름 단절**이 있는 항목.

| ID | screen | axis | 현상 | 수정 hint |
|---|---|---|---|---|
| **P1-1** | /login | (a) 키보드 nav | SSO 버튼 + 디바이더 + 폼 사이 tab 순서 OK이나, `autoFocus={!ssoEnabled}` 가 SSO 켜진 상태에서 username 자동 포커스를 해제만 할 뿐 SSO 버튼으로 옮기지 않음. 스크린리더 첫 발화가 "도면관리시스템" 헤더로 끝남. | `<KeycloakLoginButton>` 또는 `<SamlLoginButton>`에 `autoFocus={ssoEnabled && firstSsoButton}` 추가. 두 버튼 동시일 때만 첫 번째. |
| **P1-2** | /search | (d) 동적 콘텐츠 | 우상단 `<Metric value="{N}건">` 셀(검색 결과 카운트)이 필터·검색 변경 시 silent. | Metric의 외곽 div에 `aria-live="polite"` + `aria-atomic="true"`. 또는 별도 `<span className="sr-only" aria-live="polite">검색 결과 {N}건</span>`을 그리드 위에 배치. |
| **P1-3** | /lobby/[id] | (a) 키보드 nav | 검토회신 dialog가 `role="dialog" aria-modal="true"` 까지 OK이나 **focus trap이 직접 구현되지 않음** (shadcn Dialog가 아니라 native `<div>` overlay 사용 — grep 결과 확인). dialog 안에서 tab이 배경 페이지로 흘러나갈 가능성. | shadcn `<Dialog>`로 마이그레이션 또는 dialog 마운트 시 첫 입력 요소에 ref.focus(), `Escape` 시 close, dialog 영역 밖 click도 close. 현재 close 버튼은 있음. |
| **P1-4** | /admin/* (전체) | (e) 폼 | `<UsersToolbar>`, `<OrgEditDialog>`, `<GroupEditDialog>` 등 form 다이얼로그 일부에서 같은 패턴(에러 `<p>` 미연결) 반복. | P0-4 fix 패턴을 그대로 모든 admin form dialog에 적용. (frontend가 한 번에 sweep) |
| **P1-5** | 전체 (object thumbnail / decorative icons) | (b) 스크린리더 | DropdownMenuTrigger 내부 lucide 아이콘 일부가 `aria-hidden` 누락 → 스크린리더가 "more horizontal icon"같은 raw 텍스트 발화. | DropdownMenuTrigger 내 모든 lucide 아이콘에 `aria-hidden="true"`. 표준 패턴: 트리거 button 자체에 `aria-label`, 내부 아이콘은 `aria-hidden`. (storage/scans/backups 페이지는 이미 적용. search/objects/login은 일부 누락) |
| **P1-6** | /viewer | (b) 스크린리더 | ViewerShell 컨테이너가 landmark 없음 → 페이지 진입 시 스크린리더가 "도면 뷰어"라고 말하지 못함. | §P0-3과 같이 처리. 우선순위만 다름. |
| **P1-7** | /objects/[id] tabs | (a) 키보드 nav | 탭(`role="tab"` OK)에 좌우 화살표 키 핸들러 없음. WCAG에서 강제는 아니지만 ARIA Authoring Practices 권장. | 탭 컨테이너에 `onKeyDown` 핸들러로 `ArrowLeft/Right`가 active tab 인덱스 ±1, `Home/End` 처음/끝. |

### B.3 P2 — 다음 라운드 (R38+)

목록만 기록. 이번 라운드 수정 대상 아님.

| ID | screen | axis | 현상 |
|---|---|---|---|
| P2-1 | / (홈) | 시각 | STAT_CARDS의 hover ring이 약함 — `focus-visible:ring-2`만 있고 hover lift가 없음. 시각 affordance 약. |
| P2-2 | /search 그리드 | 시각 | RowMenu 개정 취소 disabled 상태 시 reason tooltip 미흡. |
| P2-3 | /admin/storage | (b) 스크린리더 | "연결 테스트 결과" 작은 inline 영역이 toast 외에 별도 announce 없음 — toast로 충분이라 P2. |
| P2-4 | 전체 | (c) 색대비 | status-tint 류(예: `status-tint-new`)의 text + bg 조합 일부가 large text 기준 3:1 통과지만 12px small에서는 borderline. 디자인 의도는 "장식 + 옆에 라벨이 있음"이라 P2. |
| P2-5 | 전체 | (d) 동적 콘텐츠 | sonner toast가 aria-live OK이나 destructive 액션(개정 취소, 삭제) 시 visual + sound cue 추가 검토. |
| P2-6 | /viewer 키보드 단축키 | (a) 키보드 nav | viewer 내부 `+/-/=/0` 단축키 매핑이 도움말에는 있으나 viewer 사용자가 `?`로 뽑는 ShortcutsDialog가 viewer 모드에서도 잘 뜨는지 확인 필요. |

### B.4 화면별 상세 audit

#### B.4.1 `/login` — 로그인

- (a) **OK**: `noValidate` + RHF + Zod, autoComplete 정상.
- (b) **OK**: `<label htmlFor>` 적절. error `role="alert"`.
- (c) **P0-2 영향**: "테스트 관리자 로그인" 안내 `text-fg-muted` 5.5:1 OK; 그러나 그 옆 카운트다운 `text-xs opacity-80`은 borderline → P2.
- (d) **OK**: lockEndsAt 카운트다운이 `<span>`에 직접 렌더, role="alert"는 부모. → 문제 없음.
- (e) **OK**.
- 발견: **P1-1** (SSO 자동 포커스), 시각적 SSO 두 버튼 패턴 — A 카드 본문.

#### B.4.2 `/` (홈)

- (a) **OK**: STAT_CARDS, WORK_QUEUE는 `<Link>` → tab 가능.
- (b) **OK**: 카드 안 텍스트가 의미 그대로.
- (c) **P0-2 영향**: 카드 caption 부분 `text-fg-muted`(5.5:1) OK. 그러나 일부 메타 텍스트 (`text-fg-subtle`)는 P0-2 적용 시 자동 수정.
- (d) **N/A**: 정적.
- (e) **N/A**.
- 발견: P2-1 (시각).

#### B.4.3 `/search` — 검색

- (a) **OK**: 그리드 row `tabIndex={0}`, `aria-selected`, focus-visible 정상.
- (b) **부분 OK**: ObjectTable 헤더 sort 버튼은 aria-label 있음. **MemoSubSidebar의 즐겨찾기 버튼**은 `<Star>` 아이콘만 있고 `aria-hidden` 미부여. 스크린리더가 "star icon 즐겨찾기 이름"같이 어색하게 발화.
- (c) **P0-2 영향**: Saved Views 카운트(`text-fg-muted`)는 OK. **breadcrumb 영역의 `text-fg-muted`** 도 OK. 그러나 `app-kicker`는 `text-fg-subtle` 사용 → P0-2 자동 수정.
- (d) **P1-2**: 검색 결과 카운트 silent.
- (e) **OK**: 필터 폼은 toolbar의 `<Popover>` 안에 있고 aria-label 정상.
- 발견: **P1-2** + 즐겨찾기 별 아이콘 aria-hidden(P1-5에 흡수).

#### B.4.4 `/objects/[id]` — 자료 상세

- (a) **OK**: 탭 `role="tab"`, breadcrumb `<ol>`, 액션 버튼 `<Link>` + `<button>`. ⌘P 단축키도 input/textarea 안에서는 양보.
- (b) **부분 OK**: ActionButton의 lucide 아이콘 `aria-hidden` 누락 (`<GitBranch>`, `<Edit3>` 등). DropdownMenuTrigger 내 `<MoreHorizontal>`도 누락 (확인됨 line 752). aria-label은 트리거에 있어 발화 자체는 OK이지만 **이중 발화**(SR가 "more horizontal" + "더보기")가 발생.
- (c) **OK**: 본문 `text-fg`, 보조는 `text-fg-muted`. P0-2 적용 시 일관성 향상.
- (d) **부분 OK**: lockedByOther 배너 `role="status"` OK. detailQuery refetch 시 grid-style live region은 없음 — 페이지 자체가 재렌더이므로 P2.
- (e) **OK**: 첨부 메뉴 ConfirmDialog OK.
- 발견: **P1-5** (아이콘 aria-hidden), **P1-7** (탭 화살표 키).

#### B.4.5 `/viewer/[attachmentId]`

- (a) **부분 OK**: ViewerToolbar 측정/줌 버튼은 aria-label, aria-pressed, aria-expanded 정상. 측정 메뉴 `role="menu"`. 단 ViewerShell 자체는 비landmark.
- (b) **부분 OK**: canvas 위에 textOverlay 없음(원본 도면을 SR가 읽어야 할 의무는 없음 — 도면은 시각 콘텐츠), 그러나 컨테이너에 landmark 부재.
- (c) viewer는 dark 토대 — `text-fg`는 white-ish, OK.
- (d) **부분 OK**: 측정 결과(거리 X mm)가 measurement overlay에만 표시됨. SR 사용자에게는 도달 불가지만 P2(도면 자체가 시각 콘텐츠).
- (e) N/A.
- 발견: **P0-3** (landmark + role=application), **P1-6** (동일).

#### B.4.6 `/approval`, `/approval/[id]`

- (a) **OK**: 결재함 `role="radiogroup"`, 항목 `role="radio"` + `aria-checked`. 잘 구성됨.
- (b) **OK**: aside `aria-label="결재 상세"`.
- (c) **P0-2 영향만**.
- (d) **부분 OK**: 결재 처리 후 grid 갱신 — query invalidation으로 재렌더, SR announce는 sonner toast로 보완 → OK.
- (e) **부분 NG**: 결재 메모 `<textarea>`에 placeholder는 있으나 `<label>` 미연결. P1으로 분류.
- 발견: **P1-4 흡수**.

#### B.4.7 `/lobby`, `/lobby/[id]`

- (a) **NG**: `/lobby/[id]` 검토회신 dialog focus trap 미보장 → **P1-3**.
- (b) **OK**: aside aria-label, 패키지 메뉴 aria-label 정상.
- (c) **P0-2**.
- (d) skeleton `role="status" aria-busy="true"` OK.
- (e) 회신 form `<textarea>` 라벨 — 확인 필요. 없으면 **P1-4 흡수**.
- 발견: **P1-3**, **P1-4 흡수**.

#### B.4.8 `/settings`

- (a) **OK**: shadcn Tabs 내부 키보드 nav 자동.
- (b) **OK**: TabsTrigger / TabsContent 패턴 ARIA 정상.
- (c) **P0-2**.
- (d) `notifyByEmail` 토글 변경 시 toast — OK.
- (e) **OK**.
- 발견: 없음 (P0-2 자동 수정 외).

#### B.4.9 `/workspace`

- (a) **OK**: 탭 `role="tab"`, `aria-selected`, focus-visible, ring offset.
- (b) **OK**: aria-label, "{name} 열기" 명시.
- (c) **P0-2**.
- (d) skeleton OK.
- (e) N/A.
- 발견: 없음 (P0-2 외).

#### B.4.10 `/admin` (대시)

- (a) **OK**: 카드 `<Link>`.
- (b) **부분 OK**: 카드 `<Icon>`이 `aria-hidden` 미부여 (tabular 발화 위험) → **P1-5 흡수**.
- (c) **P0-2**.
- (d) N/A.
- (e) N/A.
- 발견: **P1-5 흡수**.

#### B.4.11 `/admin/users`

- (a) **부분 OK**: 테이블 `<UserManagementTable>` 내 row 클릭/키보드 동작은 확인 필요. 5초 자동 새로고침 토글 등 컨트롤은 정상.
- (b) **부분 OK**: 테이블 헤더 / 행 / 액션 메뉴.
- (c) **P0-2**.
- (d) listQuery refetch 시 silent → **P1-2 패턴(검색결과 carrierannouce)을 사용자 목록에도 적용** 권장. 이번 라운드는 search만 fix, admin은 P2.
- (e) **P0-4** (UserFormDialog errormessage 미연결). PasswordResetDialog 도 확인.
- 발견: **P0-4**, **P1-4 흡수**.

#### B.4.12 `/admin/folder-permissions`

- (a) **OK**: ConfirmDialog `role="alertdialog" aria-modal="true"` 정상.
- (b) **OK**: PermissionMatrix(별도 컴포넌트) 헤더 / 셀 명확.
- (c) **P0-2**.
- (d) optimistic update — silent. P2 (리스크 낮음).
- (e) **P1-4 가능** — 폼 dialog 있으면.
- 발견: **P1-4 흡수**.

#### B.4.13 `/admin/groups`, `/admin/organizations`

- (a) **OK**: AdminSidebar 키보드 nav 정상. tree/matrix UI는 자체 키보드 단축키 OK.
- (b) **OK**: alertdialog, aside.
- (c) **P0-2**.
- (d) optimistic — P2.
- (e) **P1-4** (OrgEditDialog, GroupEditDialog 폼 form errormessage 점검).
- 발견: **P1-4 흡수**.

### B.5 admin 그 외 (참고)

`/admin/{classes,backups,scans,conversions,storage,[section]}`는 **P0-2(토큰) + P1-4(form) + P1-5(아이콘 aria-hidden)** 패턴이 동일하게 적용된다. 별도 audit 항목 없음 — 같은 patch가 자동 커버. 단, `/admin/[section]/SectionToolbar.tsx` 는 form 입력이 있으면 P1-4 sweep.

---

## C. 디자인 토큰 / 신규 컴포넌트 / 패치

### C.1 토큰 변경 (P0-2)

**대상 파일:** `apps/web/app/globals.css`.

**변경:**
```css
:root {
  /* 기존: --fg-subtle: 240 4% 65%; */
  --fg-subtle: 240 4% 50%;   /* ★ 65% → 50%, 흰 바탕 4.5:1 보장 */
}

.dark {
  /* 기존: --fg-subtle: 240 4% 55%; */
  --fg-subtle: 240 5% 70%;   /* ★ 55% → 70%, 다크 바탕 4.5:1 보장 */
}
```

**근거 (계산):**
- light: `hsl(240,4%,50%)` ≈ `#7e7d80`. on `#ffffff` = ~5.0:1. AA 통과.
- dark: `hsl(240,5%,70%)` ≈ `#b1b1b6`. on `hsl(240,10%,4%)` ≈ `#0a0a0e` = ~9.0:1. AAA 통과.

**영향 범위:** `text-fg-subtle` Tailwind 클래스를 사용하는 모든 화면 (kicker, breadcrumb, Saved Views 카운트, ObjectTable 일부 메타). 토큰만 갈아끼우면 자동 반영 — 화면별 검색/대체 불필요.

**위험:** 시각적으로 약간 더 강한 contrast → 디자인 톤이 약간 변하지만 PRD §11 a11y 우선 → 채택. 재검토 시 더 약한 톤으로 회귀 가능.

### C.2 신규 컴포넌트 — `<SkipToContent>`

**파일:** `apps/web/components/layout/SkipToContent.tsx` (신규).

**의도:** 페이지 진입 시 첫 tab으로 본문에 점프. 평소엔 sr-only, 포커스 시에만 visible.

```tsx
'use client';

import { cn } from '@/lib/cn';

/**
 * R37 P0-1 — WCAG 2.4.1 Bypass Blocks.
 * 페이지 첫 tab으로 본문에 점프하는 skip-link.
 * 평소엔 sr-only, focus 시에만 좌상단에 visible.
 */
export function SkipToContent({
  targetId = 'main-content',
}: {
  targetId?: string;
}): JSX.Element {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        'sr-only focus:not-sr-only',
        'focus:absolute focus:left-3 focus:top-3 focus:z-50',
        'focus:rounded-md focus:bg-brand focus:px-3 focus:py-2',
        'focus:text-sm focus:font-semibold focus:text-brand-foreground',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
      )}
    >
      본문으로 건너뛰기
    </a>
  );
}
```

### C.3 layout.tsx 패치 (P0-1)

**대상:** `apps/web/app/(main)/layout.tsx`.

```tsx
import { SkipToContent } from '@/components/layout/SkipToContent';   // ★ 신규

return (
  <AuthSessionProvider session={session}>
    <div className="app-frame flex h-screen w-full flex-col">
      <SkipToContent />                                                {/* ★ 첫 element */}
      <Header user={...} />
      <div className="flex min-h-0 flex-1">
        <NavRail role={role} />
        <GlobalFolderSidebar />
        <main
          id="main-content"                                            {/* ★ 추가 */}
          tabIndex={-1}                                                {/* ★ 추가 — focus 받기 가능 */}
          className="flex min-w-0 flex-1 overflow-hidden focus:outline-none"
        >
          {children}
        </main>
      </div>
      <AppShellClient />
    </div>
  </AuthSessionProvider>
);
```

`(auth)/layout.tsx`(있으면)는 NavRail/GlobalFolderSidebar가 없어 skip-link가 불필요. 검토 후 미적용.

### C.4 viewer landmark (P0-3 / P1-6)

**대상:** `apps/web/components/viewer/ViewerShell.tsx`.

```tsx
return (
  <section
    aria-label="도면 뷰어"
    className="..."
  >
    {/* 기존 ViewerToolbar */}
    <div role="application" aria-label="도면 캔버스">
      <canvas ref={canvasRef} ... />
    </div>
    ...
  </section>
);
```

`role="application"`은 SR가 application 모드로 진입해 키보드 입력을 페이지가 아닌 캔버스로 보내게 함. 도면 측정/줌 단축키가 SR 사용자에게도 의도대로 동작.

### C.5 form errormessage 패턴 (P0-4 / P1-4)

**대상:** `<UserFormDialog>`, `<OrgEditDialog>`, `<GroupEditDialog>`, `<PasswordResetDialog>`, `/lobby/[id]` 회신 dialog 등.

**표준 패턴:**

```tsx
const usernameId = React.useId();
const usernameErrId = `${usernameId}-err`;

<label htmlFor={usernameId} className="text-sm font-medium text-fg">
  사용자명
</label>
<Input
  id={usernameId}
  aria-invalid={!!errors.username || undefined}
  aria-describedby={errors.username ? usernameErrId : undefined}
  {...register('username')}
/>
{errors.username ? (
  <p id={usernameErrId} className="text-xs text-danger">
    {errors.username.message}
  </p>
) : null}
```

`React.useId()`는 SSR 안전, RHF와 호환. `aria-describedby`는 에러가 있을 때만 attach (없을 때 dangling reference 방지).

### C.6 검색 결과 카운트 announce (P1-2)

**대상:** `apps/web/app/(main)/search/page.tsx`의 `<Metric>` 셀 또는 새로운 sr-only span.

```tsx
{/* 기존 Metric 옆에 또는 그리드 위에 */}
<span className="sr-only" aria-live="polite" aria-atomic="true">
  검색 결과 {filtered.length.toLocaleString()}건
</span>
```

`aria-atomic="true"`로 셀 전체를 한 번에 읽어 "1,234" → "1,235"같이 부분 변경 발화를 막음. 시각 영역에 영향 없음(sr-only). 또는 `<Metric>` 외곽 div에 `aria-live="polite"`을 직접 부여해도 됨 — 후자는 다른 metric(예: 폴더 이름)이 함께 announce되어 noisy → **별도 sr-only span 권장**.

### C.7 lucide 아이콘 aria-hidden sweep (P1-5)

**대상:** 아래 파일의 lucide 아이콘들.

frontend가 한 번에 sweep할 때 기준:

> aria-label이 부모(button/link)에 있는 lucide 아이콘은 모두 `aria-hidden="true"`. 단독 `<Lock>`처럼 aria-label로 의미를 전달 중인 아이콘은 그대로 유지.

영향 파일 (지금 부분만 적용된 곳):
- `apps/web/app/(main)/objects/[id]/page.tsx` — DropdownMenuTrigger 내부 아이콘 + ActionButton 아이콘.
- `apps/web/app/(auth)/login/login-form.tsx` — 이미 적용됨, 확인.
- `apps/web/app/(main)/search/page.tsx` — MemoSubSidebar Star, ChevronRight, FolderOpen.
- `apps/web/app/(main)/admin/page.tsx` — 카드 Icon, ArrowRight.
- `apps/web/components/object-list/ObjectTable.tsx` — 잠금 Lock는 aria-label로 의미 전달 중 → 유지. 나머지 정렬 ChevronUp 등은 aria-hidden.

(이미 적용된 곳: storage/scans/backups/conversions — 패턴 미러)

### C.8 lobby dialog focus trap (P1-3)

**대상:** `apps/web/app/(main)/lobby/[id]/page.tsx` 검토회신 dialog.

**옵션 A (권장):** shadcn `<Dialog>`로 마이그레이션. focus trap, escape close, ouverlay click close 자동.

**옵션 B (최소 패치):** native overlay 유지하되 다음 추가:
- dialog 마운트 시 첫 입력 요소(예: `<textarea>`)에 `useEffect(() => textareaRef.current?.focus(), [])`.
- `onKeyDown={e => { if (e.key === 'Escape') onClose(); }}` 컨테이너에 부착.
- overlay div `<div className="fixed inset-0" onClick={onClose} />`에 `role="presentation"`.
- focus trap은 직접 구현 또는 `react-focus-lock`(MIT) 추가 — 분량 큼.

**designer 결정:** 옵션 A로 마이그레이션 권장. 분량 부담 시 옵션 B로 패치 후 P2로 이전 → 다음 라운드에 shadcn Dialog로 마이그.

### C.9 /objects/[id] tabs 화살표 키 (P1-7)

**대상:** `apps/web/app/(main)/objects/[id]/page.tsx`의 탭 nav.

```tsx
<nav role="tablist" aria-label="자료 상세 탭" className="flex gap-2 text-sm"
     onKeyDown={(e) => {
       const idx = TABS.findIndex(t => t.key === tab);
       if (e.key === 'ArrowRight') {
         const next = TABS[(idx + 1) % TABS.length];
         setTab(next.key);
         e.preventDefault();
       } else if (e.key === 'ArrowLeft') {
         const next = TABS[(idx - 1 + TABS.length) % TABS.length];
         setTab(next.key);
         e.preventDefault();
       } else if (e.key === 'Home') {
         setTab(TABS[0].key);
         e.preventDefault();
       } else if (e.key === 'End') {
         setTab(TABS[TABS.length - 1].key);
         e.preventDefault();
       }
     }}
>
  {TABS.map((t) => {
    const active = t.key === tab;
    return (
      <button
        key={t.key}
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}                {/* ★ APG 권장 */}
        onClick={() => setTab(t.key)}
        ...
      >
        {t.label}
        ...
      </button>
    );
  })}
</nav>
```

ARIA Authoring Practices(APG) 권장: 활성 탭만 `tabIndex=0`, 비활성은 `-1`. 화살표가 active를 옮긴 뒤 자동 포커스.

---

## D. PM-DECISION 항목

> contract §3, §4에서 도출된 결정 필요 항목들. designer 보수적 default를 표시하되 PM이 검토.

| ID | 항목 | designer default (보수적) | 대안 | 영향 |
|---|---|---|---|---|
| **D-1** | SAML 버튼 위계 (Keycloak 옆에 동등 vs secondary) | **동등 위계 (둘 다 brand primary, 위/아래 stack)** | SAML을 secondary(outline) | 동등이 가장 안전 — 환경별 IdP 선택을 사용자가 직관적으로 인지. PM 확정 필요. |
| **D-2** | SAML 버튼 아이콘 | **`Shield` (lucide)** | `KeyRound` 변형, `BadgeCheck`, `Building2` | KeyRound는 Keycloak이 사용 중 → 다른 모양 필요. `Shield`가 SAML "보안 어설션"의 metaphor에 가장 가깝다. |
| **D-3** | 두 SSO 동시 활성 시 SAML 버튼 라벨 | **"SAML SSO 로그인"** | "사내 SAML 로그인", "보안 어설션 로그인" | "SAML"이 약어임을 인지하는 사용자(관리자/IT)만 보일 가능성 높음. PRD §3.1 페르소나 중 일반 설계자/열람자에 노출되면 혼란 → 환경 운영자가 env 켤지 결정. 라벨 자체는 보편 약어 유지. |
| **D-4** | P0-2 토큰 변경의 시각 회귀 허용 여부 | **허용**: `--fg-subtle`을 더 강한 톤으로. PRD §11 우선. | 변경 안하고 사용처 위치별로 클래스 변경 (`text-fg-muted` 같은 이미 통과한 토큰으로 갈아끼움) | 토큰 변경 쪽이 footprint 작고 일관성 보장. PM 확정 필요. |
| **D-5** | P1-3 lobby dialog 마이그레이션 분량 | **옵션 B(최소 패치)** + P2로 R38에 옵션 A | 옵션 A 즉시 적용 | A는 안전하나 분량 큼. R37의 backend(SAML), viewer(Line2)와 frontend가 동시 실행될 때 부담 분산을 위해 보수적으로 B. |
| **D-6** | P1-7 tablist 화살표 키 적용 범위 | **/objects/[id]만** (이번 라운드) | /workspace, /approval 등 모든 탭에 적용 | 분량 부담. /objects/[id]가 가장 사용 빈도 높은 탭 화면이라 ROI 1순위. 나머지는 P2. |
| **D-7** | "본문으로 건너뛰기" 라벨 | **"본문으로 건너뛰기"** | "메인 콘텐츠로 이동", "Skip to main content" | 한국어 우선 정책(§DESIGN.md), 짧고 명확. |

---

## E. frontend 작업 분배 (P0/P1만 — 이번 라운드)

| 우선순위 | ID | 파일 | 변경 |
|---|---|---|---|
| P0-1 | layout skip-link | `apps/web/components/layout/SkipToContent.tsx` (신규) + `apps/web/app/(main)/layout.tsx` | §C.2, §C.3 |
| P0-2 | fg-subtle 토큰 | `apps/web/app/globals.css` | §C.1 (단 2줄) |
| P0-3 | viewer landmark | `apps/web/components/viewer/ViewerShell.tsx` | §C.4 |
| P0-4 | UserFormDialog errormessage | `apps/web/components/admin/users/UserFormDialog.tsx` | §C.5 |
| P1-1 | login SSO 자동 포커스 | `apps/web/app/(auth)/login/login-form.tsx`, `keycloak-button.tsx`, `saml-button.tsx`(신규) | §A.4 + autoFocus prop |
| P1-2 | search 카운트 announce | `apps/web/app/(main)/search/page.tsx` | §C.6 |
| P1-3 | lobby dialog focus | `apps/web/app/(main)/lobby/[id]/page.tsx` | §C.8 옵션 B |
| P1-4 | admin form sweep | `OrgEditDialog`, `GroupEditDialog`, `PasswordResetDialog`, `UserDeactivateDialog` 등 | §C.5 패턴 미러 |
| P1-5 | 아이콘 aria-hidden sweep | `objects/[id]/page.tsx`, `search/page.tsx`, `admin/page.tsx`, `ObjectTable.tsx`(부분) | §C.7 |
| P1-6 | viewer landmark (P0-3와 동일) | (위와 동일) | §C.4 |
| P1-7 | objects/[id] tabs 키보드 | `apps/web/app/(main)/objects/[id]/page.tsx` | §C.9 |
| **A-2** | SAML button | `apps/web/app/(auth)/login/saml-button.tsx`(신규) + `login-form.tsx` | §A.3, §A.4 |

**검증:** P0/P1 patch 후
- typecheck pass
- `apps/web/__tests__/`에 a11y 단위 테스트는 R38에 추가 (이번 라운드 backend가 vitest 신규 테스트 추가하므로 frontend는 manual + axe DevTools로 spot-check).
- 키보드만으로 /login → /search → /objects/[id] → /admin/users 흐름 통과해야 함.

---

## F. 회귀 위험 / 외부 영향

| 영역 | 위험 | 완화 |
|---|---|---|
| 토큰 P0-2 | 디자인 톤이 약간 어두워짐 | DESIGN.md §11에 "WCAG AA 우선" 기재되어 있어 의도된 변경. 시각 QA에서 톤 회귀 발견 시 R38에 fine-tune. |
| skip-link | tab 1번 사용자가 갑자기 새 element 발견 | 평소엔 sr-only, focus 시에만 visible — 시각 영향 0. |
| viewer landmark | role=application 진입 시 SR 키보드가 page 모드와 분리 | 의도된 동작. SR 사용자가 viewer를 벗어나려면 Esc 또는 tab으로 toolbar 도달. |
| SAML 버튼 | NEXT_PUBLIC_SAML_ENABLED 미설정 시 default false → 회귀 0 | 명시적 env 분기. R33 Keycloak 패턴 미러. |
| 아이콘 aria-hidden sweep | 기존 발화가 사라진다는 인지 부담 | `aria-label`이 부모에 있어 의미는 보존. SR 사용자에게는 더 깔끔. |
| form errormessage 변경 | RHF의 register/errors 흐름은 그대로 | 패턴 추가 only, 기존 검증 로직 동일. |

---

## G. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-04-27 | 초기 작성 (R37). audit 13 화면 + admin 10+, P0×4 / P1×7, A-2 SAML 버튼 spec, P0-2 토큰 변경. |
