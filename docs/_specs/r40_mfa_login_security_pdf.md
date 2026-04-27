# R40 Design Spec — /login/mfa + /admin/security + 검색 PDF snippet

| 항목 | 내용 |
|---|---|
| 작성자 | drawing-mgmt designer agent (R40) |
| 작성일 | 2026-04-28 |
| 기준 main HEAD | `f432820` (R40 base — R39 흡수분 + 0014 마이그) |
| 대상 라운드 | R40 |
| API 계약 | `_workspace_r40/api_contract.md` §2 (엔드포인트), §5 (FE 라우트) |
| 선행 spec | `docs/_specs/r39_mfa_password_security.md` (특히 §A.4, §A.5, §B, §C, §J 결정 항목) |
| 신규 라우트 | `/login/mfa` (B), `/admin/security` (C) |
| 신규 컴포넌트 | `<MfaVerifyForm>` (`/login/mfa` 페이지 본체), `<SecurityAuditCard>`, `<VulnerabilityCounts>`, `<VulnerabilitiesEmpty>`, `<PdfSnippetLine>` |
| 확장 컴포넌트 | `apps/web/app/(auth)/login/login-form.tsx` (`mfa_required:<token>` 분기), `apps/web/app/(main)/admin/admin-groups.ts` (이미 R39에서 `/admin/security` 항목 등록됨 — **추가 변경 없음**), `apps/web/app/(main)/search/page.tsx`(ObjectVM에 pdfSnippet 합성), `apps/web/components/object-list/ObjectTable.tsx`(자료명 cell 하단 snippet 한 줄) |
| 디바이스 | Desktop only (1280 / 1440 / 1920) |
| 디자인 토큰 변경 | **없음** — 기존 brand/danger/warning/success/fg-muted/bg-subtle/border 토큰만 사용 |
| 새 단축키 | 없음 |
| 프리뷰 의도 | R39 partial을 마무리(login/mfa + /admin/security)하고 S-1 검색 결과의 PDF 본문 snippet UX를 R39 §J #7 "Critical만 danger, High는 warning" 결정과 §J #1 "단일 input" 결정의 연속선으로 통일 |

---

## 0. 라운드 개요와 사용자 시나리오

### 0.1 R39 partial과의 연결

R39는 MFA enroll/disable + 비밀번호 정책 + admin/security의 메뉴 등록까지 끝냈다. R40에서 마무리할 미완 항목:

1. **/login/mfa 페이지 자체 신설** — R39 §B 와이어프레임을 6분할 input으로 그렸으나 §J #1 PM 결정 = **단일 input**. R40 spec은 단일 input으로 확정해 frontend가 그대로 구현 가능하도록 명시.
2. **/admin/security 페이지 자체 신설** — R39 §C 와이어프레임은 카운트 카드 4개 + VulnerabilitiesTable까지 잡았다. R40 1차에서는 PM 결정에 따라 **테이블 생략, 카운트 + EmptyState만**으로 좁힌다(§J #5 R40 1차에는 클릭 필터/테이블 없음). 사이드바 진입점은 R39에 이미 등록됨(`ADMIN_GROUPS` 마지막 그룹 끝).
3. **S-1 PDF 본문 검색 snippet UX** — R40 신규. 검색 결과 row에 PDF에서 매칭된 부분을 한 줄로 보여주는 라인을 추가.

### 0.2 페르소나 동선

| 페르소나 | /login/mfa | /admin/security | PDF snippet |
|---|---|---|---|
| 슈퍼관리자/관리자 | MFA 활성화한 본인이 매 로그인마다 거치는 화면 | 본인 또는 운영팀이 매주 확인. 빨간 카드(critical) 발견 시 알림 + 패치 발주 | 검색 시 PDF 본문 매칭이 한 줄 미리보기로 노출 |
| 설계자 | MFA 옵션 활성화 후 매 로그인마다 거침 | 접근 권한 없음 (admin only) | 동일 |
| 열람자 | 동일 | 동일 (없음) | 동일 |
| 협력업체 | 동일 (lobby 인증) | 없음 | lobby에서도 동일하게 PDF snippet 노출(다음 라운드 후보) |

### 0.3 핵심 시나리오 4개

1. **MFA 로그인 (활성 사용자):** /login → 아이디/비밀번호 → submit → 1단계 OK인데 BE가 `mfa_required:<token>` 코드 반환 → login-form.tsx가 자동으로 `/login/mfa?token=...`로 redirect → autofocus된 단일 input에 6자리 입력 → 자동 submit 또는 enter → `POST /api/v1/auth/mfa/verify` → `mfaBridgeToken` 응답 → `signIn('credentials', { mfaBridge: token, redirect: false })` → `/`(또는 callbackUrl) replace.
2. **MFA 복구 코드 로그인 (인증기 분실):** /login/mfa → 하단 "복구 코드 사용" 토글 → input 변형 → `XXXX-XXXX` 입력 → verify → 세션 발급 + "복구 코드 1개를 사용했습니다." 토스트.
3. **취약점 점검 (관리자):** AdminSidebar의 "통합 / 로그 → 보안" 클릭 → /admin/security → 카운트 카드 4개(Critical / High / Moderate / Low) + 마지막 검사 시각 + [지금 검사] 버튼 → 클릭 → `POST /audit` → spinner + "검사 중... (최대 1분)" → 갱신 → 0건이면 ✓ EmptyState로 전환.
4. **PDF 본문 검색 (설계자):** /search → 검색창에 "도면번호 12-3456" 입력 → ObjectTable의 자료명 cell 하단에 "본문: …<mark>도면번호</mark>는 12-3456…" 한 줄 표시 → 클릭 시 detail 이동.

---

## A. 진입 흐름 정리 (login-form.tsx 변경)

### A.1 BE → FE 신호 규약

R39 BE가 1단계 로그인 OK인데 MFA가 활성된 사용자에게 응답하는 코드:

```
res.code === 'mfa_required:<base64url-jwt>'
```

(또는 `res.error === 'mfa_required'` + 별도 헤더 — backend 구현에 따라 다름. R39 PR 기준은 위 형태.)

### A.2 login-form.tsx 분기

`submitCredentials()` 내 기존 `if (res.error) { setErrorCode(res.code ?? res.error); ... return; }` 직전에 다음 분기 추가:

```ts
// MFA 필요 — 1단계 OK이지만 2FA 활성화된 사용자.
const code = res?.code ?? res?.error;
if (typeof code === 'string' && code.startsWith('mfa_required:')) {
  const token = code.slice('mfa_required:'.length);
  // sessionStorage 백업(새로고침 후 query string 사라짐 대비) + query string 둘 다.
  try { sessionStorage.setItem('mfaBridgeToken', token); } catch {}
  const search = new URLSearchParams();
  search.set('token', token);
  if (callbackUrl) search.set('callbackUrl', callbackUrl);
  router.replace(`/login/mfa?${search.toString()}`);
  return;
}
```

→ `/login/mfa` 페이지가 token을 query 또는 sessionStorage에서 읽어 form 렌더.

### A.3 errorCode 매핑 보강 (mapErrorCode)

`/login/mfa` 페이지 내부 에러는 거기서 처리하므로 login-form.tsx에는 추가 없음. 단 `/login/mfa`에서 token 만료/위조로 다시 `/login`으로 강제 이동시킬 때 query string `?error=mfa_token_expired`를 붙여 보내고, `mapErrorCode`에 다음 케이스 추가:

```ts
case 'mfa_token_expired':
  return '인증 시간이 만료되었습니다. 처음부터 다시 로그인하세요.';
case 'mfa_locked':
  return '인증 시도 횟수를 초과했습니다. 처음부터 다시 로그인하세요.';
```

---

## B. /login/mfa 페이지 (신규)

### B.1 라우트와 layout

- 파일: `apps/web/app/(auth)/login/mfa/page.tsx`
- `(auth)` 그룹 아래 → 기존 `/login`과 동일한 logged-out layout 재사용 (좌측 브랜드 패널 + 우측 폼 카드 패턴).
- 인증 미필요 (token만 검증). middleware/layout 가드에서 `/login/mfa`도 화이트리스트에 포함되어야 함 — backend 측 가드.

### B.2 진입과 token 해소

1. `useSearchParams()`로 `?token=` 읽기.
2. 없으면 `sessionStorage.getItem('mfaBridgeToken')` fallback.
3. 둘 다 없으면 즉시 `router.replace('/login')` (직접 URL 진입 차단).
4. 마운트 시 `sessionStorage.setItem('mfaBridgeToken', token)`로 통일(새로고침 회복).
5. 성공/실패와 무관하게 페이지 unmount 시 `sessionStorage.removeItem('mfaBridgeToken')`.

### B.3 와이어프레임 (단일 input — R39 §J #1 결정 반영)

```
┌── /login/mfa ────────────────────────────────────────────────┐
│                                                              │
│           [로고 / 동국씨엠 도면관리]                              │
│                                                              │
│        2단계 인증                                              │
│        인증기 앱의 6자리 코드를 입력하세요.                     │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                                                        │  │
│  │   인증 코드                                              │  │
│  │   ┌──────────────────────────────┐                     │  │
│  │   │ 6자리 코드 (autofocus, paste OK) │                  │  │
│  │   └──────────────────────────────┘                     │  │
│  │                                                        │  │
│  │   ⚠ 코드가 맞지 않습니다. (4회 더 시도 가능)              │  │
│  │                                                        │  │
│  │                                       [확인] (primary) │  │
│  │                                                        │  │
│  │   ─── 또는 ───                                          │  │
│  │                                                        │  │
│  │   → 복구 코드 사용                                       │  │
│  │                                                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ← 다른 계정으로 로그인                                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

#### 복구 코드 모드(토글 후)

```
│  │   복구 코드                                              │  │
│  │   ┌──────────────────────────────┐                     │  │
│  │   │ XXXX-XXXX                    │                     │  │
│  │   └──────────────────────────────┘                     │  │
│  │   복구 코드는 한 번만 사용할 수 있습니다.                  │  │
│  │                                                        │  │
│  │                                       [확인] (primary) │  │
│  │                                                        │  │
│  │   ← 6자리 인증 코드 사용                                  │  │
```

### B.4 MfaVerifyForm 인터랙션

#### B.4.1 6자리 input (`mode === 'totp'`)

- 단일 `<Input>` 컴포넌트.
- 속성:
  - `id="totp-code"`
  - `inputMode="numeric"`
  - `pattern="[0-9]{6}"`
  - `maxLength={6}`
  - `autoComplete="one-time-code"`
  - `autoFocus`
  - `aria-label="2단계 인증 코드"`
  - `aria-describedby="mfa-error"` (에러 영역 id)
  - `aria-invalid={!!errorCode || undefined}`
- onChange에서 숫자가 아닌 문자는 strip (`value.replace(/\D/g, '').slice(0,6)`).
- **6자 입력 완료 시 자동 submit** (UX 가속) — `useEffect(() => { if (value.length === 6 && !submitting) handleSubmit(); }, [value])`. 또한 enter 키도 submit.
- placeholder는 비워둠 (autocomplete OTP 동작과 충돌 회피). 시각적 자리 표시는 input 내부 `letter-spacing: 0.4em` + `text-center` + `font-mono` `text-2xl`로 6자리가 시각적으로 균등하게 보이게.
- 페이스트(인증기에서 복사한 6자리) 자연 동작.

#### B.4.2 복구 코드 input (`mode === 'recovery'`)

- 같은 단일 `<Input>`이지만 다음 속성:
  - `inputMode="text"` (`-` 포함 가능)
  - `pattern="[0-9-]{8,9}"`
  - `maxLength={9}`
  - `autoComplete="off"`
  - `autoFocus`
  - `aria-label="2단계 인증 복구 코드"`
  - placeholder `1234-5678`
- onChange에서 숫자/하이픈만 허용. 사용자가 `12345678`(하이픈 없이) 입력하면 자동으로 4자 뒤에 하이픈 삽입(`v.length === 8 && !v.includes('-') ? v.slice(0,4)+'-'+v.slice(4) : v`).
- 자동 submit은 없음 — 8~9자 길이 검증만 통과시키고 사용자가 enter / 확인 클릭.

#### B.4.3 모드 토글

- "복구 코드 사용" 링크는 `<button type="button">` (form 내부, 시맨틱 정확).
- 클릭 시 `mode='recovery'` + input value 비우고 새 placeholder/규칙 적용 + autofocus 이동.
- 반대 토글은 "← 6자리 인증 코드 사용".
- token 자체는 두 모드에서 같은 것을 사용 — backend가 `code` 또는 `recoveryCode` 둘 중 하나를 받음.

#### B.4.4 mutation

```ts
const verifyMutation = useMutation<
  { ok: true; data: { mfaBridgeToken: string } },
  ApiError,
  { mfaToken: string; code?: string; recoveryCode?: string }
>({
  mutationFn: (vars) => api.post('/api/v1/auth/mfa/verify', vars),
  onSuccess: async (res) => {
    // 두 번째 자격증명으로 신규 mfaBridgeToken 사용해 세션 발급.
    const r = await signIn('credentials', {
      mfaBridge: res.data.mfaBridgeToken,
      redirect: false,
    });
    if (!r) { setErrorCode('unknown'); return; }
    if (r.error) { setErrorCode(r.code ?? r.error); return; }
    sessionStorage.removeItem('mfaBridgeToken');
    router.replace(callbackUrl ?? '/');
    router.refresh();
  },
  onError: (err) => {
    handleVerifyError(err);
  },
});
```

#### B.4.5 5회 fail 처리 (FE 카운터)

- 컴포넌트 state로 `attemptsLeft` (초기 5).
- mutation onError에서 INVALID_MFA_CODE 또는 MFA_BRIDGE_INVALID 받을 때마다 `setAttemptsLeft(n => n-1)`.
- attemptsLeft === 0 도달 시:
  - sessionStorage 정리.
  - `router.replace('/login?error=mfa_locked')`.
  - 같은 페이지의 토스트는 띄우지 않음 (`/login`이 banner로 메시지 처리).
- 1회 fail 시(아직 잠금 아님): 에러 영역 `<p id="mfa-error" role="alert">` 표시:
  - "인증 코드가 맞지 않습니다. ({attemptsLeft}회 더 시도 가능)"
  - 또는 복구 코드 모드: "복구 코드가 맞지 않거나 이미 사용된 코드입니다. ({attemptsLeft}회 더 시도 가능)"
- INVALID_MFA_CODE는 카운터에 영향 주지만, MFA_NOT_ENABLED는 즉시 `/login`으로 redirect (account 상태가 변한 것이므로 카운터 무의미).

#### B.4.6 token 만료 / 위조 처리 (MFA_BRIDGE_INVALID)

- 401 + code `MFA_BRIDGE_INVALID` 받으면:
  - sessionStorage 정리.
  - `router.replace('/login?error=mfa_token_expired')`.
- 카운터 -1 처리하지 않고 즉시 `/login`으로 (재발급이 필요한 상황).

### B.5 에러 매핑 (handleVerifyError)

```ts
function handleVerifyError(err: ApiError) {
  switch (err.code) {
    case 'MFA_BRIDGE_INVALID':
      sessionStorage.removeItem('mfaBridgeToken');
      router.replace('/login?error=mfa_token_expired');
      return;
    case 'INVALID_MFA_CODE':
      setAttemptsLeft((n) => Math.max(0, n - 1));
      setErrorCode('invalid');
      return;
    case 'MFA_NOT_ENABLED':
      sessionStorage.removeItem('mfaBridgeToken');
      router.replace('/login?error=mfa_disabled');
      return;
    default:
      setErrorCode('unknown');
  }
}
```

`mapVerifyError` 한글 메시지:

```ts
function mapVerifyError(code: string | null, mode: 'totp' | 'recovery', attemptsLeft: number): string | null {
  if (!code) return null;
  switch (code) {
    case 'invalid':
      return mode === 'totp'
        ? `인증 코드가 맞지 않습니다. (${attemptsLeft}회 더 시도 가능)`
        : `복구 코드가 맞지 않거나 이미 사용된 코드입니다. (${attemptsLeft}회 더 시도 가능)`;
    case 'unknown':
    default:
      return '인증에 실패했습니다. 다시 시도하세요.';
  }
}
```

### B.6 "다른 계정으로 로그인" 링크

- 폼 카드 외부 하단에 `<Link href="/login">` (Next.js Link). 클릭 시:
  - sessionStorage 정리.
  - 사용자가 명시적으로 처음부터 다시 시작 → query 없이 /login.
- `/login`은 SSO 패널 + credentials 폼 둘 다 다시 보여주므로 다른 계정 / SSO 전환 모두 자연.

### B.7 컴포넌트 props

```tsx
interface MfaVerifyFormProps {
  initialToken: string;        // page.tsx가 query 또는 sessionStorage에서 해소해 전달
  callbackUrl?: string;
  initialMode?: 'totp' | 'recovery';   // 기본 'totp'
}
```

페이지 컴포넌트(page.tsx)는 token 해소만 담당하고, 나머지 폼 로직은 모두 `<MfaVerifyForm>` 안에서.

### B.8 레이아웃 디테일

- 기존 `/login` 페이지의 폼 카드와 동일 너비(`max-w-md` ~ `max-w-lg` 가운데 정렬).
- 6자리 input은 카드 너비의 60% 정도, 가운데 정렬.
- 에러 영역은 input 직하 + `<Button type="submit">` 위.
- "복구 코드 사용" / "← 6자리 인증 코드 사용" 링크는 [확인] 버튼 아래 + `text-sm text-fg-muted hover:text-fg`.
- "다른 계정으로 로그인" 링크는 카드 외부 / 카드 아래 / `text-xs text-fg-subtle`.

---

## C. /admin/security 페이지 (신규)

### C.1 라우트와 진입

- 파일: `apps/web/app/(main)/admin/security/page.tsx`
- 사이드바 진입점은 R39에서 이미 등록됨:
  ```ts
  // apps/web/app/(main)/admin/admin-groups.ts (현재 main 상태)
  {
    href: '/admin/security',
    label: '보안',
    description: 'npm 의존성 취약점 / 즉시 검사',
    icon: ShieldCheck,
  }
  ```
- **R40 designer 결정:** `label`을 `'의존성 보안'`으로 살짝 변경(R40 contract §5.2가 명시) — `ShieldCheck` 아이콘은 다른 admin 항목(`/admin/folder-permissions`)과 중복이지만 R39 결정대로 유지(별도 토큰 도입 비용 > 충돌 비용). `label`만 `'의존성 보안'`으로 단어 1개 교체. PM 결정 필요 시 R39 §J #4 권장 `Package` 아이콘 채택 가능 — frontend가 1줄 변경.
- 권한: SUPER_ADMIN + ADMIN. 다른 admin 페이지와 동일하게 layout 가드(R28+) 적용.

### C.2 와이어프레임

```
┌── /admin/security ───────────────────────────────────────────┐
│ ┌──[관리자 사이드바]──┐ ┌──[메인]────────────────────────────┐ │
│ │ 사용자/조직         │ │ 의존성 보안                            │ │
│ │ 폴더/권한           │ │ pnpm audit 결과를 기반으로 npm 의존    │ │
│ │ 자료 유형           │ │ 성의 알려진 취약점을 모니터링합니다.    │ │
│ │ 규칙/공지           │ │                                         │ │
│ │ 통합/로그           │ │ ┌─ 마지막 검사 ─────────────────────┐ │ │
│ │  변환 작업          │ │ │ 2026-04-28 14:23 (3시간 전)      │ │ │
│ │  백업              │ │ │                       [지금 검사] │ │ │
│ │  스토리지           │ │ └──────────────────────────────────┘ │ │
│ │  바이러스 스캔      │ │                                         │ │
│ │ ▶의존성 보안       │ │ ┌─ 카운트 ────────────────────────┐  │ │
│ │  API Key           │ │ │ <dl>                             │ │ │
│ │  감사 로그         │ │ │ ┌──────┐┌──────┐┌──────┐┌────┐ │  │ │
│ │                    │ │ │ │ 0  ││ 2  ││ 5  ││ 12 │ │  │ │
│ │                    │ │ │ │Critical││High ││Mod ││Low │ │  │ │
│ │                    │ │ │ └──────┘└──────┘└──────┘└────┘ │  │ │
│ │                    │ │ │ </dl>                            │ │ │
│ │                    │ │ └──────────────────────────────────┘ │ │
│ │                    │ │                                         │ │
│ │                    │ │ pnpm audit는 매일 02:00 KST 자동 실행   │ │
│ │                    │ │ 됩니다. CI에서도 high 이상은 워크플로 카드 │ │
│ │                    │ │ 가 빨갛게 표시됩니다(머지 차단은 안 함).  │ │
│ └────────────────────┘ └─────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

#### 0건 EmptyState (R39 §J 따름 — R40 1차의 default 시각)

```
┌── /admin/security ───────────────────────────────────────────┐
│ ┌──[관리자 사이드바]──┐ ┌──[메인]────────────────────────────┐ │
│ │  ...                │ │ 의존성 보안                          │ │
│ │ ▶의존성 보안       │ │                                       │ │
│ │  ...                │ │ ┌─ 마지막 검사 ────────────────────┐ │ │
│ │                    │ │ │ 2026-04-28 14:23 (방금 전)       │ │ │
│ │                    │ │ │                       [지금 검사] │ │ │
│ │                    │ │ └──────────────────────────────────┘ │ │
│ │                    │ │                                         │ │
│ │                    │ │      ✓ (success 색, 큰 아이콘)          │ │
│ │                    │ │                                         │ │
│ │                    │ │   발견된 취약점이 없습니다.              │ │
│ │                    │ │                                         │ │
│ │                    │ │   pnpm audit가 모든 패키지를 점검했고    │ │
│ │                    │ │   현재 알려진 취약점은 없습니다.          │ │
│ │                    │ │                                         │ │
│ └────────────────────┘ └─────────────────────────────────────┘ │
```

### C.3 메인 영역 레이아웃

- 컨테이너: 다른 admin 페이지(R28~R36)와 동일하게 AdminSidebar(고정 폭) + 메인(flex-1).
- 메인 안쪽: `<div className="mx-auto w-full max-w-6xl space-y-6 p-6">`
- 헤더: `<h1 className="text-xl font-semibold text-fg">의존성 보안</h1>` + `<p className="text-sm text-fg-muted">pnpm audit ...</p>`

### C.4 SecurityAuditCard (마지막 검사 + [지금 검사])

```tsx
interface SecurityAuditCardProps {
  lastCheckedAt: string | null;     // ISO
  isRunning: boolean;
  isError: boolean;                 // 직전 mutation 실패
  onRunNow: () => void;
}
```

#### C.4.1 시각

- 카드: `app-panel p-5 flex items-center justify-between gap-4`.
- 좌측:
  - 라벨 `text-xs text-fg-subtle uppercase tracking-wide`: `마지막 검사`
  - 값 (KST):
    - 절대 시각: `2026-04-28 14:23` (`YYYY-MM-DD HH:mm`, R28 패턴) `text-sm font-medium text-fg`
    - 상대 시각 보조: `(3시간 전)` `text-xs text-fg-muted`
    - 절대/상대 둘 다 표시. 마우스 hover 시 tooltip으로 ISO 절대(예: `2026-04-28T14:23:01+09:00`).
- 우측: [지금 검사] 버튼.

#### C.4.2 [지금 검사] 버튼 4상태

| 상태 | 시각 | 인터랙션 |
|---|---|---|
| idle | `<Button variant="outline">지금 검사</Button>` | 클릭 시 mutation trigger |
| pending | `<Button variant="outline" disabled aria-disabled>` + `<Loader2 className="animate-spin h-4 w-4 mr-2"/>` + 라벨 `검사 중... (최대 1분)` | 비활성. 폴링이 아니라 단일 POST + spinner |
| success | 일시적으로 (~2초) `<Button variant="outline" disabled>` + ✓ 아이콘 + `완료` → 그 후 idle 복귀 | toast.success(`{count}건 발견` 또는 `취약점 없음`) |
| error | idle 상태로 복귀하되 카드 아래 `<p className="text-xs text-danger" role="alert">검사 실패: {message}</p>` 1줄 + 토스트 | 클릭 가능 (재시도) |

- pending 라벨에 "(최대 1분)"이 있는 이유: pnpm audit가 first-run이면 registry hit이 길어질 수 있음. 사용자 인내 한계 사전 안내.
- aria-disabled 명시(disabled prop만으로는 SR 일부 환경에서 announce 안 함).

### C.5 VulnerabilityCounts (카운트 카드 4개)

```tsx
interface VulnerabilityCountsProps {
  counts: { critical: number; high: number; moderate: number; low: number };
}
```

#### C.5.1 시맨틱 (`<dl>` 권장)

```html
<dl className="grid grid-cols-4 gap-3">
  <div className="app-panel p-4">
    <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Critical</dt>
    <dd className="mt-1 flex items-baseline gap-2">
      <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-danger" />
      <span className="text-3xl font-semibold tabular-nums text-fg">{counts.critical}</span>
    </dd>
  </div>
  ...
</dl>
```

- 4 카드 grid `grid grid-cols-4 gap-3` (Desktop only — 1280에서도 4 컬럼 유지).
- 각 카드 `app-panel p-4`.
- 각 카드는 `<div>` 안에 `<dt>` + `<dd>`. dl이 grid 컨테이너인 게 시맨틱적으로 맞음 (term/description 쌍).

#### C.5.2 색 매핑 (R39 §J #7 결정 = Critical만 danger, High는 warning)

| severity | dot 색 | 텍스트 색 | 토큰 |
|---|---|---|---|
| Critical | `bg-danger` | `text-fg` | `--danger` |
| High | `bg-warning` | `text-fg` | `--warning` |
| Moderate | `bg-warning/60` | `text-fg` | `--warning` (반투명) |
| Low | `bg-fg-muted` | `text-fg` | neutral |

- 카운트 0인 카드는 카드 전체 `opacity-60` (시선 분산 방지).
- 카운트 1+인 critical/high는 `opacity-100` 유지 → 자연스럽게 시선이 빨간/주황 카드로 이동.

#### C.5.3 클릭 → 필터링: R40 1차 **없음** (R39 §J #5 결정)

- 카드는 그냥 통계 표시. 클릭 핸들러 미부착, hover 효과 없음.
- 다음 라운드(R41+)에서 VulnerabilitiesTable 도입 시 클릭 → 필터로 확장.

### C.6 EmptyState (`<VulnerabilitiesEmpty>`) — 4개 카운트 모두 0일 때

```tsx
interface VulnerabilitiesEmptyProps {
  // 검사 시각만 주면 메시지 합성. props 0개여도 OK.
}
```

```html
<div className="rounded-lg border border-border bg-bg p-10 text-center">
  <div className="mx-auto mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
    <CheckCircle2 className="h-8 w-8 text-success" aria-hidden="true" />
  </div>
  <p className="text-base font-medium text-fg">발견된 취약점이 없습니다.</p>
  <p className="mt-2 text-sm text-fg-muted">
    pnpm audit가 모든 패키지를 점검했고 현재 알려진 취약점은 없습니다.
  </p>
</div>
```

- 카드 4개를 EmptyState로 **대체**하지 않고, 카드 4개는 그대로 두고 그 아래에 EmptyState 추가. 카드는 "0/0/0/0"의 **증명**, EmptyState는 "축하" 메시지.
- 카드 4개를 모두 `opacity-60`으로 dim하고 EmptyState만 `opacity-100`이라 시선 자연 이동.

### C.7 페이지 구조 (page.tsx 의사 코드)

```tsx
'use client';
export default function AdminSecurityPage() {
  const queryClient = useQueryClient();
  const auditQuery = useQuery({
    queryKey: queryKeys.adminSecurityAudit(),
    queryFn: () => api.get<AuditResponse>('/api/v1/admin/security/audit'),
    staleTime: 60_000,
  });
  const runMutation = useMutation({
    mutationFn: () => api.post<AuditResponse>('/api/v1/admin/security/audit'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminSecurityAudit() }),
    onError: (err) => toast.error('검사 실패', { description: err.message }),
  });

  // Loading skeleton (auditQuery.isLoading)
  // Error banner (auditQuery.isError)
  // Render: SecurityAuditCard + VulnerabilityCounts + (sumCounts === 0 ? VulnerabilitiesEmpty : null)
}
```

### C.8 useAdminSecurityAudit 훅

`apps/web/lib/queries.ts`에 추가:

```ts
queryKeys.adminSecurityAudit = () => ['admin', 'security', 'audit'] as const;

export function useAdminSecurityAudit() {
  return useQuery({
    queryKey: queryKeys.adminSecurityAudit(),
    queryFn: () => api.get<AuditResponse>('/api/v1/admin/security/audit'),
    staleTime: 60_000,
  });
}
```

응답 type:

```ts
interface AuditResponse {
  vulnerabilities: { critical: number; high: number; moderate: number; low: number };
  count: number;
  lastChecked: string;     // ISO
  // meta는 envelope에 있음
}
```

---

## D. 검색 결과 PDF snippet UX (S-1)

### D.1 데이터 흐름

`GET /api/v1/objects` 응답의 각 row에 신규 필드:

```ts
pdfSnippet: string | null;   // null이면 매칭이 number/name/description 측 (미표시)
                             // 문자열이면 ts_headline 결과 ('…<b>도면번호</b>는 12-3456…')
```

`ServerObjectSummary`에 `pdfSnippet?: string | null` 추가. `adaptObject(o: ServerObjectSummary): ObjectRow`에서 `pdfSnippet: o.pdfSnippet ?? null` 합성. `ObjectRow` 인터페이스에 `pdfSnippet?: string | null` 추가.

### D.2 표시 위치 — ObjectTable의 "자료명" cell 하단 한 줄

R39에서 본 ObjectTable 구조상 가장 자연스러운 통합 지점:

- 기존 `accessorKey: 'name'` cell:
  ```tsx
  cell: ({ row }) => (
    <span className="block max-w-[420px] truncate font-medium text-fg">
      {highlight(row.original.name, searchTerm)}
    </span>
  )
  ```
- R40 변경 후:
  ```tsx
  cell: ({ row }) => (
    <div className="max-w-[420px]">
      <span className="block truncate font-medium text-fg">
        {highlight(row.original.name, searchTerm)}
      </span>
      {row.original.pdfSnippet ? (
        <PdfSnippetLine snippet={row.original.pdfSnippet} />
      ) : null}
    </div>
  )
  ```
- 행 높이는 snippet이 있을 때만 한 줄 늘어남 → 검색 시에만 가끔 행이 두 줄. 사용자가 검색 중이라는 맥락이 분명하므로 leg 변동은 자연스럽다.

### D.3 `<PdfSnippetLine>` 컴포넌트

```tsx
interface PdfSnippetLineProps {
  snippet: string;     // ts_headline 결과: "…<b>foo</b> bar…"
  maxChars?: number;   // 기본 80
}
```

#### D.3.1 시각

```
┌──────────────────────────────────────────────────────────┐
│ 자료명: 1차 압연기 도면 (highlight 적용)                    │
│ 본문: …<b>도면번호</b>는 12-3456이며 두께…  ← 1줄, 작은 폰트 │
└──────────────────────────────────────────────────────────┘
```

- `<p>` 단일.
- 클래스: `mt-0.5 truncate text-xs text-fg-muted` (한 줄 ellipsis).
- "본문" 라벨 prefix: `<span className="font-medium text-fg-subtle">본문 </span>`.
- 본문 텍스트 자체는 같은 줄에 따라옴. `truncate`이 양쪽 다 처리.

#### D.3.2 `<b>...</b>` → `<mark>` 안전 파싱

backend가 내려주는 snippet은 `MaxFragments=1, MaxWords=20, MinWords=5` 기준 ~80자 미만이지만 안전상 maxChars로 한 번 더 자른다. 또한 `<b>...</b>`는 backend가 `StartSel/StopSel`로 만든 마커지 HTML 신뢰 콘텐츠가 아니므로 **dangerouslySetInnerHTML 절대 사용 금지**. JSX split 패턴:

```tsx
function renderSnippet(snippet: string, maxChars: number): React.ReactNode {
  // 1) maxChars로 자르되 <b>...</b> 페어 깨지지 않게.
  const truncated = truncatePreservingTags(snippet, maxChars);
  // 2) <b>...</b>를 <mark>로 변환 (정규식 split — XSS 안전)
  const re = /<b>(.*?)<\/b>/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(truncated))) {
    if (m.index > lastIndex) {
      parts.push(truncated.slice(lastIndex, m.index));
    }
    parts.push(
      <mark
        key={key++}
        className="rounded bg-warning/20 px-0.5 text-fg dark:bg-warning/30"
      >
        {m[1]}
      </mark>
    );
    lastIndex = re.lastIndex;
  }
  if (lastIndex < truncated.length) {
    parts.push(truncated.slice(lastIndex));
  }
  return <>{parts}</>;
}
```

- `<mark>` 색은 ObjectTable의 highlight 함수가 쓰는 amber와 일관: **`bg-warning/20`** (R37에서 amber-200이 warning 토큰과 매핑) — 검색 결과 행 내부에서 두 종의 highlight가 시각적으로 통일.
- 정규식 split이라 `<script>` 등 다른 태그가 들어와도 plain text로 떨어짐(XSS 안전).

#### D.3.3 truncate 보조 함수

```ts
function truncatePreservingTags(snippet: string, maxChars: number): string {
  // <b>...</b>를 카운트에서 제외한 가시 글자 수가 maxChars 넘으면 자른다.
  // 가독성 우선 — 단순 구현으로 충분 (snippet 자체가 이미 ~80자 이하).
  if (snippet.length <= maxChars + 7 /* <b></b> */) return snippet;
  return snippet.slice(0, maxChars) + '…';
}
```

backend가 `MaxWords=20`으로 이미 짧게 만들어 보내므로 실제 잘림은 거의 없음. 안전망 역할.

#### D.3.4 빈/null/공백 처리

- `pdfSnippet === null` → `<PdfSnippetLine>` 자체를 mount하지 않음 (search/page.tsx 측 가드 + 컴포넌트도 `if (!snippet?.trim()) return null`).
- 빈 문자열도 동일.

### D.4 ObjectRow.pdfSnippet은 클라이언트 필터에서 제외

`apps/web/app/(main)/search/page.tsx`의 `filtered` useMemo에서 search.toLowerCase() 매칭은 number/name만 검사 (현재 코드 그대로). pdfSnippet은 BE가 매칭 보장한 row에 대해서만 내려주므로 클라 필터에서 다시 검사할 필요 없다. **변경 필요 없음.**

### D.5 ObjectPreviewPanel 확장 — R40 범위 외

오른쪽 미리보기 패널에 PDF snippet을 길게(여러 줄, 페이지 번호와 함께) 보여주는 것은 다음 라운드 후보. R40에서는 행 inline 한 줄로 충분.

---

## E. 색·간격·타이포 토큰

### E.1 신규 토큰 — 없음

R39 designer가 이미 정리한 토큰으로 R40 모든 시각 요구를 충족.

| 용도 | 토큰 | 비고 |
|---|---|---|
| Critical 카드 dot | `bg-danger` | R37 |
| High 카드 dot | `bg-warning` | R37, R39 |
| Moderate 카드 dot | `bg-warning/60` | 반투명 변형 |
| Low 카드 dot | `bg-fg-muted` | neutral |
| EmptyState success 아이콘 | `text-success` + `bg-success/10` | R36 패턴 |
| `<mark>` 검색 highlight | `bg-warning/20 text-fg dark:bg-warning/30` | ObjectTable 기존 amber와 매핑 동일 |
| MfaVerifyForm input | 기존 `<Input>` 컴포넌트 그대로 | 추가 토큰 없음 |
| /admin/security 카드 컨테이너 | `app-panel` (`rounded-lg border border-border bg-bg`) | R28 패턴 |
| 에러 영역 | `text-danger` + `role="alert"` | R28 login-form 패턴 |
| Pending 버튼 spinner | `<Loader2 className="animate-spin h-4 w-4">` | lucide |

### E.2 간격

- /admin/security 메인 컨테이너: `space-y-6` (헤더 → SecurityAuditCard → VulnerabilityCounts → EmptyState).
- 카운트 카드 grid: `grid grid-cols-4 gap-3`.
- /login/mfa 폼 카드 내부: 기존 login-form `space-y-4` 패턴 유지.

### E.3 타이포

- /admin/security h1: `text-xl font-semibold text-fg`.
- 카운트 숫자: `text-3xl font-semibold tabular-nums text-fg`.
- /login/mfa 6자리 input 자체: `text-2xl font-mono tracking-[0.4em] text-center` (가시성).
- snippet line: `text-xs text-fg-muted`.

---

## F. 접근성 (WCAG 2.1 AA)

### F.1 /login/mfa

- 6자리 input `aria-label="2단계 인증 코드"` `autoComplete="one-time-code"` `inputMode="numeric"` `pattern="[0-9]{6}"`.
- 복구 코드 input `aria-label="2단계 인증 복구 코드"` `inputMode="text"` `pattern="[0-9-]{8,9}"`.
- 에러 영역 `<p id="mfa-error" role="alert">` (R28/R39 login-form과 동일 패턴) — 에러 발생 시 SR이 즉시 announce.
- 모드 토글 링크는 `<button type="button">` (시맨틱 정확). focus order: input → submit → 모드 토글 → "다른 계정으로 로그인" 링크.
- ESC로 닫는 dialog가 아니라 페이지 전체이므로 ESC 동작 없음. browser back으로 /login 복귀 가능 (sessionStorage cleanup은 unmount에서).
- 색대비: 에러 텍스트 `text-danger` on `bg-danger/10` (R37 검증된 AA 4.5:1 조합).

### F.2 /admin/security

- 카운트 카드 그룹은 `<dl>`로 시맨틱화. 각 카드는 `<div><dt>...</dt><dd>...</dd></div>`. SR이 "Critical 0건, High 2건..."로 자연 읽음.
- [지금 검사] 버튼:
  - idle: 일반 button.
  - pending: `disabled={true} aria-disabled="true"` 둘 다 명시. spinner 아이콘은 `aria-hidden="true"`. 라벨 텍스트 "검사 중... (최대 1분)"이 SR이 읽는 콘텐츠.
- EmptyState 아이콘 `aria-hidden="true"` + 텍스트가 본문이므로 SR 자연 읽기.
- 페이지 h1 `<h1>의존성 보안</h1>` → admin layout breadcrumb과 함께 페이지 구조 인식.
- 색만으로 severity 구분하지 않음 — 각 카드에 텍스트 라벨(Critical/High/Moderate/Low) + 카운트 숫자 항상 함께 표시. R36 SeverityBadge 패턴 그대로.

### F.3 검색 snippet

- `<mark>` 시맨틱 태그 사용 → SR이 자동으로 "강조" 톤으로 읽음 (브라우저/SR 조합에 따라). dangerouslySetInnerHTML이면 시맨틱 손실.
- snippet 라인 자체는 `<p>` (또는 `<div>`) 일반 텍스트, `<mark>`는 strong이 아닌 highlight 의도이므로 시맨틱 정확.
- "본문" 라벨은 텍스트로 prefix 되어 있어 SR이 "본문, …도면번호는 12-3456…"로 자연 읽음.

---

## G. 반응형 (Desktop only)

- 1280 / 1440 / 1920 모두 동일 레이아웃.
- /login/mfa 카드 너비: `max-w-md` (모바일 비대상이므로 좁게 두는 게 6자리 입력 시각성 ↑).
- /admin/security 메인 영역: AdminSidebar(고정 폭) + main `max-w-6xl mx-auto`.
- VulnerabilityCounts grid는 1280에서도 `grid-cols-4` 유지 (좁아지지 않음). 카드 1개 약 280px 폭이라 1280-폴더트리 폭 후 충분.
- ObjectTable의 "자료명" cell `max-w-[420px]`는 기존 그대로. snippet은 이 영역 안에 두 번째 줄로 들어가므로 reflow 없음.

---

## H. Empty / Loading / Error 상태

### H.1 /login/mfa

- Loading: 페이지 마운트 즉시 input 표시. token 해소 실패 시 `<p>잘못된 접근입니다. 처음부터 다시 로그인하세요.</p>` 1초 표시 후 `/login` redirect.
- mutation pending: [확인] 버튼 spinner + disabled. input 자체는 활성 유지 (사용자가 코드 수정 시도 가능).
- Empty: 해당 없음.
- Error: §B.5 매핑 그대로.

### H.2 /admin/security

- Loading (auditQuery.isLoading): `<Skeleton>` 4개 카드 + SecurityAuditCard 자리 비움.
  - SecurityAuditCard: `<Skeleton className="h-16 w-full" />`
  - 카운트: `<Skeleton className="h-24 w-full" />` 4개
- Error (auditQuery.isError): `<div role="alert" className="rounded-md border border-danger/25 bg-danger/10 p-4 text-sm text-danger">검사 결과를 불러올 수 없습니다. <button onClick={() => auditQuery.refetch()} className="underline">재시도</button></div>` (R28 패턴).
  - 503 + `AUDIT_RUN_FAILED`이면 메시지 "이전 캐시가 없어 결과를 표시할 수 없습니다. [지금 검사] 버튼을 다시 시도하세요."로 좀 더 친절하게.
- Empty (모든 카운트 0): VulnerabilitiesEmpty 표시 (§C.6).
- Mutation pending (지금 검사): SecurityAuditCard 우측 버튼만 spinner + disabled. 카운트 카드는 직전 값 유지 (refetch 후 새 값으로 교체).

### H.3 검색 snippet

- pdfSnippet null/빈 문자열: 컴포넌트 mount 자체를 안 함 (§D.3.4).
- pdfSnippet 있지만 비정상(`<b>`만 있고 닫기 없음 등): 정규식 split이 그냥 plain text로 떨어뜨림 → 안전 fallback.
- API 에러: ObjectTable 자체 로딩/에러는 search/page.tsx의 useQuery로 처리됨. R40 변경 없음.

---

## I. 검증 체크리스트 (frontend가 구현 완료했을 때 체크할 항목)

### I.1 /login/mfa

- [ ] /login에서 MFA 활성 사용자가 1단계 입력 후 자동으로 /login/mfa로 redirect됨 (URL query token 또는 sessionStorage 회복)
- [ ] /login/mfa에 직접 URL 진입(token 없음) → /login로 즉시 redirect
- [ ] 6자리 input에 autofocus + autoComplete="one-time-code" + 6자 입력 시 자동 submit
- [ ] 6자리 input에 페이스트(인증기에서 복사)가 자연 동작
- [ ] "복구 코드 사용" 토글 → input이 `XXXX-XXXX` 모드로 변경, autofocus 이동
- [ ] 8자만 입력하면 자동으로 4자 뒤에 하이픈 삽입
- [ ] "← 6자리 인증 코드 사용" 토글로 원복
- [ ] 1회 fail → 에러 영역 "(N회 더 시도 가능)" 카운터 감소
- [ ] 5회 fail → /login?error=mfa_locked로 강제 redirect + sessionStorage 정리
- [ ] MFA_BRIDGE_INVALID → /login?error=mfa_token_expired로 즉시 redirect
- [ ] MFA_NOT_ENABLED → /login?error=mfa_disabled로 즉시 redirect (메시지: "2단계 인증이 비활성화되었습니다. 처음부터 다시 로그인하세요.")
- [ ] 성공 → mfaBridgeToken으로 signIn(credentials, { mfaBridge }) 호출 → callbackUrl 또는 / replace + sessionStorage 정리
- [ ] "다른 계정으로 로그인" 링크 → /login으로 이동 + sessionStorage 정리
- [ ] aria-label, role="alert", inputMode 속성 모두 정확
- [ ] 페이지 unmount 시 sessionStorage cleanup

### I.2 /admin/security

- [ ] 사이드바 "통합 / 로그 → 의존성 보안" 진입점 작동 (admin-groups의 label 1단어 변경)
- [ ] /admin/security를 비-admin 사용자가 접근 시 layout 가드에서 403 (R28+)
- [ ] 페이지 로드 → SecurityAuditCard + 카운트 카드 4개 표시
- [ ] 마지막 검사 시각이 KST 절대 + 상대 형식("3시간 전") 둘 다 표시
- [ ] hover 시 ISO 절대 시각 tooltip
- [ ] 카운트 4개 색 매핑: Critical=danger, High=warning, Moderate=warning/60, Low=fg-muted
- [ ] 카운트 0인 카드 opacity-60
- [ ] 모든 카운트 0이면 카드 4개 + EmptyState(✓ 아이콘 + "발견된 취약점이 없습니다." + 보조 설명) 둘 다 표시
- [ ] [지금 검사] 4상태 (idle/pending/success/error) 시각 확인
- [ ] pending 시 버튼 disabled + aria-disabled + spinner + "검사 중... (최대 1분)" 라벨
- [ ] mutation 성공 시 query invalidate → 카운트 갱신
- [ ] mutation 실패 시 토스트 + 카드 아래 에러 1줄
- [ ] 503 AUDIT_RUN_FAILED 친절한 메시지
- [ ] R40 1차에는 카운트 카드 클릭 → 필터/테이블 없음 (R39 §J #5 결정)
- [ ] `<dl>` 시맨틱 + 카드 라벨 + 카운트 SR 자연 읽기

### I.3 검색 PDF snippet

- [ ] ServerObjectSummary와 ObjectRow에 `pdfSnippet?: string | null` 필드 추가
- [ ] adaptObject가 BE 응답의 pdfSnippet을 그대로 합성
- [ ] ObjectTable의 자료명 cell이 row에 pdfSnippet 있을 때 두 번째 줄로 PdfSnippetLine 렌더 (없으면 mount 없음)
- [ ] PdfSnippetLine: 라벨 "본문 " + snippet, 한 줄 truncate, text-xs text-fg-muted
- [ ] `<b>...</b>` 마커가 dangerouslySetInnerHTML이 아닌 정규식 split + JSX `<mark>`로 렌더 (XSS 안전)
- [ ] `<mark>` 색이 ObjectTable의 기존 highlight(amber)와 동일 톤 (bg-warning/20)
- [ ] snippet null/빈 문자열이면 라인 자체 mount 안 함
- [ ] 깨진 마커(`<b>` 닫기 누락 등)에도 plain text fallback이라 화면 안 깨짐
- [ ] 행 높이가 snippet 있을 때만 한 줄 늘어나며 다른 cell 정렬 깨지지 않음
- [ ] 검색 결과 행이 0건일 때 기존 빈 테이블 UX 그대로 (snippet 변경 영향 없음)

### I.4 회귀

- [ ] 기존 /login(MFA 비활성 사용자)가 변경 없이 그대로 작동
- [ ] R39 settings의 MfaSection 기능에 영향 없음
- [ ] AdminSidebar의 다른 메뉴 항목 영향 없음
- [ ] /search 기존 검색(number/name 매칭)이 snippet 도입 후에도 그대로 작동, q 비었을 때 snippet 미생성

---

## J. PM 결정 필요 / TBD 항목

| # | 항목 | 권장 | 영향 |
|---|---|---|---|
| 1 | /admin/security 사이드바 label "보안" → "의존성 보안" 단어 변경 | **변경** (다른 보안 카테고리와 혼동 ↓) | admin-groups.ts 1줄 |
| 2 | /admin/security 사이드바 아이콘 `ShieldCheck` 유지 vs `Package` 변경 | **유지** (R39 결정 그대로 / 변경 비용 > 충돌 비용) | admin-groups.ts 1줄 |
| 3 | 6자리 input의 자동 submit | **유지** (UX 가속, R40 명시) | mutation 빈도 |
| 4 | 복구 코드 input의 8자 시 하이픈 자동 삽입 | **삽입** (사용자 입력 부담 ↓) | onChange 로직 약간 |
| 5 | 5회 fail 시 BE도 token 무효화하는지 | **BE도 무효화 권장** (FE 카운터만으로는 우회 가능). R39 BE에 이미 들어가 있으면 그대로 | backend 측 |
| 6 | snippet maxChars 80 vs 60 | **80** (대부분의 도면 설명에서 1줄 ~80자가 자연) | 가독성 |
| 7 | snippet `<mark>` 색 — amber vs orange | **amber(warning/20)** (ObjectTable 기존 highlight와 통일) | 시각 일관성 |
| 8 | EmptyState를 카드 4개와 함께 표시 vs EmptyState만 표시 | **함께 표시** (카드는 0/0/0/0의 증명) | 시각 |

---

## K. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-04-28 | 초기 작성 (R40 designer agent) — R39 partial(/login/mfa, /admin/security) 마무리 + S-1 PDF snippet UX |
