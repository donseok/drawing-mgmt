# R39 Design Spec — MFA(TOTP) + 비밀번호 정책 + 의존성 취약점 audit UX

| 항목 | 내용 |
|---|---|
| 작성자 | drawing-mgmt designer agent (R39) |
| 작성일 | 2026-04-27 |
| 기준 main HEAD | `f75f157` |
| 대상 라운드 | R39 |
| 대상 PRD/DESIGN | `docs/PRD.md` §3.1(페르소나), `docs/DESIGN.md` §11(접근성), §10(Empty/Loading), R28~R37 spec(공통 폼 패턴) |
| API 계약 | `_workspace/api_contract.md` §3(MFA), §4(비밀번호), §5(SEC-4), §7(FE 작업 분배) |
| 신규 라우트 | `/login/mfa`, `/admin/security` |
| 신규 컴포넌트 | `<MfaSection>`, `<MfaEnrollDialog>`, `<MfaDisableDialog>`, `<RecoveryCodesDialog>`, `<MfaVerifyForm>` (login/mfa 페이지 내), `<SecurityAuditCard>`, `<VulnerabilitiesTable>`, `<PasswordPolicyHint>`, `<PasswordStrengthMeter>`, `<PasswordExpiryBanner>` |
| 확장 컴포넌트 | `apps/web/app/(main)/settings/page.tsx` (탭 추가), `apps/web/components/settings/PasswordSection.tsx` (정책·강도·만료 안내 추가), `apps/web/app/(main)/admin/admin-groups.ts` (메뉴 추가), `apps/web/app/(auth)/login/login-form.tsx` (mfa redirect handling) |
| 디바이스 | Desktop only (≥1280) |
| 디자인 토큰 변경 | **없음** — 기존 brand/danger/warning/success 토큰으로 충분. 비밀번호 강도 4단계는 fg-muted/warning/brand-500/success로 매핑(§D.3) |
| 새 단축키 | 없음. MfaVerifyForm은 6자리 자동완성에 의존 |
| 프리뷰 의도 | A-3 MFA의 enroll/disable/login flow 전체 + A-4 비밀번호 정책 enforcement UX + SEC-4 admin/security 미니 페이지. 모든 카드가 **로그인/계정 보안** 카테고리에 묶이므로 시각/카피 톤 일관성 우선 |

---

## 0. 라운드 개요와 사용자 시나리오

### 0.1 세 카드가 같은 라운드에 묶이는 이유

A-3(MFA TOTP), A-4(비밀번호 정책), SEC-4(취약점 audit)는 모두 **계정·시스템 보안 부채 정리**라는 동일 카테고리다. 세 카드 모두 사용자 데이터 모델 핵심(Object/Folder/Attachment)은 건드리지 않고, **사용자 계정 영역(`User` 테이블 확장 + `/settings`/`/login`)** 과 **운영 패널(`/admin/security`)**만 손본다. 회귀 위험은 가장 낮지만, MFA enroll flow의 **복구 코드 표시 누락 = 영구 계정 분실** 같은 1회성 UX 사고가 발생하면 복구가 어렵기 때문에 designer 산출물에서 dialog 흐름의 **"강제 인지"** 패턴(체크박스 + 복사·다운로드 + 닫기 차단)이 핵심이다.

### 0.2 페르소나별 시나리오

| 페르소나 | A-3 MFA | A-4 비밀번호 | SEC-4 audit |
|---|---|---|---|
| 슈퍼관리자 / 관리자 | 본인 계정에 MFA 활성화 권장 (정책상 강제 아님). 로그인 시 6자리 코드 입력 추가 | 90일 만료 시 강제 변경 페이지로 redirect. admin은 다른 사용자 강제 만료도 가능 | `/admin/security` 페이지에서 high/critical 카운트 확인, "지금 검사" 버튼으로 수동 트리거 |
| 설계자 (10~15명) | 옵션. 활성화 시 로그인 1단계 추가만 변경 | 90일마다 변경 강제. 변경 폼에서 정책(10자+3종+직전 2개 다름) 실시간 검증 | 접근 권한 없음 (admin only) |
| 열람자 (5~10명) | 동일 옵션 | 동일 정책 | 접근 권한 없음 |
| 협력업체 (5사) | 권장. lobby에서 보안성 ↑ | 동일 정책 (협력업체 외부 IP 노출 위험 ↑이라 만료 정책 효과 큼) | 접근 권한 없음 |

### 0.3 핵심 시나리오 7개

1. **MFA 활성화 (관리자):** `/settings` → "보안" 탭 → "2단계 인증" 카드의 `[활성화]` 버튼 → `<MfaEnrollDialog>` 열림 → QR 표시 + Google Authenticator 등으로 스캔 → 6자리 코드 입력 → confirm 성공 → `<RecoveryCodesDialog>`로 자동 전환 → 10개 복구 코드 표시 + "복사 또는 다운로드 했습니다" 체크박스 강제 → 닫기 → 카드 상태 "활성화됨"으로 토글.
2. **MFA 로그인 (활성화된 관리자):** `/login` → 아이디/비밀번호 입력 → submit → 1단계 성공 시 임시 토큰 발급 + `/login/mfa?token=...` redirect → 6자리 코드 입력 (autofocus) → submit → 세션 발급 → `/`.
3. **MFA 복구 코드로 로그인 (인증기 분실):** `/login/mfa` 화면 하단 "복구 코드로 로그인" 링크 → 페이지 변형 → 복구 코드 1개 입력 → 1회성 소비 후 세션 발급 + 사용된 복구 코드 1개 차감 안내 토스트.
4. **MFA 비활성화 (사용자 본인):** `/settings` → "2단계 인증" 카드 → `[비활성화]` 버튼 → `<MfaDisableDialog>` (현재 비밀번호 OR 6자리 코드 재인증) → 확인 → 카드 상태 "비활성"로 토글, 복구 코드 일괄 폐기.
5. **비밀번호 변경 (정책 인지):** `/settings` → "비밀번호" 탭 → 정책 안내 박스 (10자 이상 / 영숫특 3종 / 직전 2개 다름) → 새 비밀번호 입력 → 입력 중 실시간 강도 미터(약함/보통/강함/매우 강함) + 정책 충족 체크리스트 → 직전 2개 재사용 시 서버 에러 코드 `E_PW_REUSED` → "직전 2개 비밀번호와 같을 수 없습니다." 토스트.
6. **비밀번호 만료 임박 안내 (7일 이내):** 모든 페이지 진입 시 layout 상단에 노란 배너 "비밀번호 만료까지 N일 남았습니다. 지금 변경" → 클릭 → `/settings?tab=password` 이동.
7. **취약점 audit 확인 (슈퍼관리자):** `/admin/security` → 카운트 카드 (Critical 0 / High 2 / Moderate 5 / Low 12) → 마지막 검사 시각 ("3시간 전") → `[지금 검사]` → spinner → 결과 갱신 → 패키지명 + severity + CVE 링크 list.

---

## A. /settings — MfaSection (A-3 카드)

### A.1 진입 — settings 페이지 탭 구조 변경

기존(R27~R38): `[프로필] [비밀번호] [서명] [알림]` 4탭.

R39 변경: **`[프로필] [비밀번호] [서명] [알림] [보안]`** — 탭 1개 추가. "보안" 탭은 향후 MFA 외에 다른 보안 옵션(API token, 활성 세션 등)이 들어갈 자리지만 R39 시점에는 MFA만.

```
┌── /settings ──────────────────────────────────────────────────┐
│ 환경설정                                                       │
│ 프로필, 비밀번호, 서명, 알림, 보안 등 개인 설정을 관리합니다.    │
│ ─────────────────────────────────────────────────────────────│
│ [프로필] [비밀번호] [서명] [알림] [보안]                       │
│                                                              │
│ ── 보안 탭 활성 시 ──                                          │
│                                                              │
│ <MfaSection mfaEnabledAt={... | null}                        │
│              recoveryCodesRemaining={number} />              │
└──────────────────────────────────────────────────────────────┘
```

### A.2 MfaSection — 비활성 상태

```
┌─ 2단계 인증 ──────────────────────────────────────────────────┐
│ 로그인 시 비밀번호 외에 인증기 앱이 생성하는 6자리 코드를 추가  │
│ 입력합니다. 다른 사람이 비밀번호를 알아도 인증기가 없으면 로그인│
│ 할 수 없으므로 계정 보안이 크게 강화됩니다.                    │
│                                                              │
│ ┌─ 상태 ─────────────────────────────────────────────────┐  │
│ │ ⊝ 비활성                                              │  │
│ │ Google Authenticator, 1Password, Authy 등을 사용할    │  │
│ │ 수 있습니다.                                          │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│                                          [활성화] (primary)  │
└──────────────────────────────────────────────────────────────┘
```

- 카드 컨테이너: `app-panel`(`rounded-lg border border-border bg-bg`) + `p-5`
- 상태 표시: `<Badge>` 또는 dot + 텍스트. 비활성은 `text-fg-muted` + `bg-bg-muted`
- 활성화 버튼: `<Button variant="default">` (brand). MfaEnrollDialog 트리거

### A.3 MfaSection — 활성 상태

```
┌─ 2단계 인증 ──────────────────────────────────────────────────┐
│ 로그인 시 비밀번호 외에 인증기 앱이 생성하는 6자리 코드를 추가  │
│ 입력합니다.                                                   │
│                                                              │
│ ┌─ 상태 ─────────────────────────────────────────────────┐  │
│ │ ✓ 활성                                                │  │
│ │ 2026-04-15에 활성화됨                                  │  │
│ │ 복구 코드 잔여: 10개 / 10개                            │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│             [복구 코드 재발급] (outline) [비활성화] (danger) │
└──────────────────────────────────────────────────────────────┘
```

- 상태 dot: `bg-success` (`hsl(var(--success))`) + 체크 아이콘
- 활성화 시각: `mfaEnabledAt` ISO → `YYYY-MM-DD` 표시 (시간까지 노출 X — 보안 정보의 추적 단서가 되지 않게)
- 복구 코드 잔여: `recoveryCodesRemaining` (BE가 사용된 코드 카운트해서 내려줌). **3개 이하면 노란 텍스트 + 재발급 강조**
- 두 버튼:
  - `[복구 코드 재발급]` — `<Button variant="outline">`, 클릭 시 `<MfaDisableDialog>`와 동일한 재인증 단계 거친 후 새 10개 발급 + `<RecoveryCodesDialog>` 재표시
  - `[비활성화]` — `<Button variant="destructive">` (danger), 클릭 시 `<MfaDisableDialog>`

### A.4 MfaEnrollDialog — 4단계 흐름

shadcn `<Dialog>` 사용. 4단계를 dialog 내 1단계씩 보여줌 (한 dialog에 stepper).

#### 단계 1: 안내

```
┌─ 2단계 인증 활성화 ─ 1/4 ─────────────────────────────────────┐
│ 다음 4단계를 진행합니다:                                       │
│                                                              │
│  1. 인증기 앱 설치 안내                                        │
│  2. QR 코드 스캔 또는 비밀키 수동 입력                         │
│  3. 6자리 코드로 인증기 검증                                   │
│  4. 복구 코드 저장                                            │
│                                                              │
│ ⚠ 4단계의 복구 코드는 한 번만 표시되며 인증기를 분실했을 때    │
│   계정 복구의 유일한 수단입니다. 반드시 복사하거나 다운로드해  │
│   안전한 곳에 보관하세요.                                     │
│                                                              │
│ 권장 인증기 앱 (무료):                                         │
│ • Google Authenticator (iOS/Android)                         │
│ • 1Password / Bitwarden (브라우저 확장)                       │
│ • Authy (multi-device)                                        │
│                                                              │
│                                              [취소] [다음 →]  │
└──────────────────────────────────────────────────────────────┘
```

#### 단계 2: QR 표시 + secret

```
┌─ 2단계 인증 활성화 ─ 2/4 ─────────────────────────────────────┐
│ 인증기 앱으로 아래 QR 코드를 스캔하세요.                       │
│                                                              │
│       ┌──────────────────┐                                    │
│       │                  │   비밀키 (수동 입력용):              │
│       │     [QR 이미지]   │   JBSWY3DPEHPK3PXP                │
│       │                  │   [복사]                          │
│       │                  │                                   │
│       └──────────────────┘   계정: drawing-mgmt:donseok75     │
│                                                              │
│ QR을 스캔할 수 없는 경우 비밀키를 직접 입력하세요.              │
│                                                              │
│                                  [← 이전] [다음 →]            │
└──────────────────────────────────────────────────────────────┘
```

- QR: `qrcode` 라이브러리가 내려주는 PNG dataURL을 `<img>`로 렌더 (160×160 px). `alt="2단계 인증 QR 코드"`
- 비밀키: `<code>`로 monospace + `<Button variant="ghost" size="sm">` 복사 버튼 → `navigator.clipboard.writeText` + `toast.success('비밀키를 복사했습니다.')`
- 비밀키 표시 자체가 보안 자산이므로 dialog 닫히면 secret이 메모리에서 지워지도록 frontend 구현 노트(§E.5에 명시)

#### 단계 3: 6자리 코드 검증

```
┌─ 2단계 인증 활성화 ─ 3/4 ─────────────────────────────────────┐
│ 인증기 앱이 표시하는 6자리 코드를 입력하세요.                  │
│ 코드는 30초마다 갱신됩니다.                                    │
│                                                              │
│              ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐                  │
│              │  │ │  │ │  │ │  │ │  │ │  │                  │
│              └──┘ └──┘ └──┘ └──┘ └──┘ └──┘                  │
│                                                              │
│ ⚠ 코드가 맞지 않습니다. (실패 시)                              │
│                                                              │
│                                  [← 이전] [확인 →]            │
└──────────────────────────────────────────────────────────────┘
```

- 6자리 input: 단일 `<Input>` `inputMode="numeric"` `pattern="[0-9]{6}"` `autoComplete="one-time-code"` `maxLength={6}` `autoFocus`
  - **Decision (PM 확정 필요):** 6분할 input (Apple Sign-In 스타일) vs 단일 input. **권장은 단일 input** — 구현 단순, autoComplete OTP 자연 작동, 키보드 paste 정상 작동. 6분할은 모바일 UX 이점이 있으나 본 제품은 Desktop only이라 메리트 ↓
- 에러 카피: BE의 `E_INVALID_TOTP` → "코드가 맞지 않습니다. 인증기 앱의 최신 6자리 코드를 입력하세요."
- 5회 실패 시 (rate limit): "인증 시도 횟수를 초과했습니다. 잠시 후 다시 시도하세요." + 5분 lock (BE 정책)

#### 단계 4: 복구 코드 표시 (RecoveryCodesDialog로 전환)

§A.5 참조.

### A.5 RecoveryCodesDialog — "강제 인지" 패턴

이 dialog는 **사용자가 복구 코드를 실제로 저장했는지를 행동으로 보장하는 핵심 UX**다. 단순히 "확인" 버튼만 두면 사용자가 클릭하고 잊어버려서 인증기 분실 시 영구 계정 분실로 이어진다.

```
┌─ 복구 코드 ──────────────────────────────────────────── 4/4 ─┐
│ 인증기를 분실했을 때 계정 복구에 사용할 1회성 코드 10개입니다.  │
│ ⚠ 이 코드는 지금 한 번만 표시됩니다. 반드시 안전한 곳에 보관    │
│   하세요.                                                    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  1234-5678   2345-6789   3456-7890   4567-8901       │    │
│  │  5678-9012   6789-0123   7890-1234   8901-2345       │    │
│  │  9012-3456   0123-4567                              │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│              [📋 복사]  [⬇ 텍스트 파일로 다운로드]             │
│                                                              │
│  ☐ 복사 또는 다운로드 했으며 안전한 곳에 보관했습니다.          │
│                                                              │
│                                    [완료] (체크 시 활성화)    │
└──────────────────────────────────────────────────────────────┘
```

**핵심 규칙 (frontend 구현 의무):**
1. **체크박스 미체크 상태에서 [완료] 버튼 비활성화** — `disabled={!confirmed}`. 체크 전에는 ESC 키로도 닫히지 않게 `onEscapeKeyDown={(e) => !confirmed && e.preventDefault()}`, `onPointerDownOutside={(e) => !confirmed && e.preventDefault()}`
2. **복구 코드 영역 monospace** — `font-mono text-sm` + 4×3 그리드. `tabular-nums`로 정렬
3. **복사 버튼:** `navigator.clipboard.writeText(codes.join('\n'))` → `toast.success('복구 코드 10개를 복사했습니다.')`
4. **다운로드 버튼:** Blob → `drawing-mgmt-recovery-codes-{username}-{YYYYMMDD}.txt` 파일명. 내용:
   ```
   drawing-mgmt 2단계 인증 복구 코드
   사용자: donseok75
   발급일: 2026-04-27

   1234-5678
   2345-6789
   ...
   0123-4567

   ⚠ 각 코드는 1회만 사용 가능합니다.
   ⚠ 안전한 위치(비밀번호 매니저, 인쇄물 금고 등)에 보관하세요.
   ```
5. **체크박스 라벨에 두 동작 명시** — "복사 또는 다운로드 했으며" — 둘 중 하나는 무조건 했어야 한다는 인지 강제. 체크박스만으로는 검증 불가하지만, 적어도 "이 단계가 중요하다"는 시각 신호.
6. **dialog 닫힘 후에는 코드 표시 절대 불가** — frontend는 codes를 useState 외에는 어디에도 저장하지 않고, dialog `onOpenChange={false}` 시 메모리에서 즉시 폐기. **새로고침 후 다시 보기 절대 불가** (BE도 hash만 저장).

### A.6 MfaDisableDialog — 재인증 + 확인

```
┌─ 2단계 인증 비활성화 ────────────────────────────────────────┐
│ 비활성화하면 로그인 시 6자리 코드를 입력하지 않습니다.          │
│ 모든 복구 코드는 폐기되며 다시 활성화하면 새 코드가 발급됩니다.│
│                                                              │
│ ⚠ 보안 수준이 낮아집니다. 정말 비활성화하시겠습니까?           │
│                                                              │
│ ─ 본인 확인 ────────────────────────────────────────────────│
│ 다음 중 하나를 입력하세요:                                    │
│                                                              │
│ ◯ 현재 비밀번호                                               │
│ ◉ 인증기 6자리 코드                                            │
│                                                              │
│ ┌──────────────────────────────┐                             │
│ │ 6자리 코드                   │                             │
│ └──────────────────────────────┘                             │
│                                                              │
│                          [취소] [비활성화] (danger)          │
└──────────────────────────────────────────────────────────────┘
```

- 두 옵션 중 하나만 입력해도 통과. radio 선택 후 input 1개만 노출
- 6자리 코드 옵션이 default (비밀번호를 잊었을 때보다 인증기를 가지고 있을 가능성이 더 높음)
- BE 라우트는 단일 `POST /api/v1/me/mfa/disable` `{ code? , password? }` — 둘 중 하나 보냄
- 확인 버튼: `<Button variant="destructive">`. mutation onSuccess → toast "2단계 인증이 비활성화되었습니다." + `MfaSection` invalidate

### A.7 컴포넌트 props

```tsx
interface MfaSectionProps {
  // 서버에서 받은 me 응답
  mfaEnabledAt: string | null;          // ISO; null이면 비활성
  recoveryCodesRemaining: number;       // 0~10
  // hasPassword: 항상 true (Credentials만), SSO-only 사용자는 disable
  hasPassword: boolean;
}

interface MfaEnrollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (recoveryCodes: string[]) => void;  // 4단계로 codes 전달
}

interface RecoveryCodesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  codes: string[];
  username: string;                      // 다운로드 파일명용
  variant: 'enroll' | 'regenerate';      // 카피 다름
}

interface MfaDisableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasPassword: boolean;                  // password radio 옵션 표시 여부
}
```

---

## B. /login/mfa — MfaVerifyForm (A-3 카드, 로그인 2단계)

### B.1 라우트 신설

`apps/web/app/(auth)/login/mfa/page.tsx` — `(auth)` 그룹 (logged-out layout) 내에 배치. 기존 `/login`과 같은 좌우 split 또는 center card layout 재사용.

### B.2 진입 흐름

1. 사용자가 `/login`에서 아이디/비밀번호 입력 → submit
2. BE auth.ts의 Credentials authorize:
   - 1단계 비밀번호 OK + `totpEnabledAt` null → 기존처럼 세션 발급
   - 1단계 OK + `totpEnabledAt` 있음 → HMAC 임시 토큰 (TTL 5분, payload: `userId + iat + exp`) 발급 후 `/login/mfa?token=...`로 redirect
   - 1단계 fail → 기존 에러 처리 (R28 5회 잠금)
3. `/login/mfa`에서 token query 읽고 form 렌더 → 6자리 입력 → `POST /api/v1/auth/mfa/verify { token, code }` → 세션 발급 → `/`

### B.3 와이어프레임

```
┌── /login/mfa ────────────────────────────────────────────────┐
│                                                              │
│           [로고]                                              │
│                                                              │
│        2단계 인증                                              │
│        인증기 앱의 6자리 코드를 입력하세요.                     │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐                        │  │
│  │  │  │ │  │ │  │ │  │ │  │ │  │  (autofocus)           │  │
│  │  └──┘ └──┘ └──┘ └──┘ └──┘ └──┘                        │  │
│  │                                                       │  │
│  │  ⚠ 코드가 맞지 않습니다. (4회 더 시도 가능)             │  │
│  │                                                       │  │
│  │                                       [확인]          │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  → 복구 코드로 로그인                                          │
│  → 다른 계정으로 로그인 (/login으로)                           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### B.4 인터랙션

- **autofocus** 6자리 input. `autoComplete="one-time-code"` (iOS/Safari가 SMS 코드 자동 채움 시도하지만 본 제품은 TOTP라서 효과 X — 무해)
- 6자리 모두 입력되면 자동 submit (UX 가속). 또는 enter로 명시 submit
- 1회 fail: 입력 비우고 다시 focus + 카운터 ("4회 더 시도 가능")
- 5회 fail: BE 정책으로 임시 토큰 무효화 + `E_TOTP_LOCKED` → "인증 시도 횟수를 초과했습니다. 처음부터 다시 로그인하세요." + 3초 후 `/login` redirect
- 토큰 만료 (TTL 5분): "인증 시간이 만료되었습니다. 처음부터 다시 로그인하세요." + 즉시 `/login` redirect
- "복구 코드로 로그인" 링크 → 같은 페이지에서 input 변형:
  - 라벨 "복구 코드 (XXXX-XXXX 형식)"
  - input `inputMode="text"` `pattern="[0-9-]{8,9}"` `maxLength={9}`
  - placeholder `1234-5678`
  - "← 6자리 코드 사용" 토글 링크

### B.5 컴포넌트 props

```tsx
interface MfaVerifyFormProps {
  token: string;                         // URL query에서 읽음
  initialMode?: 'totp' | 'recovery';     // 기본 'totp', 링크 클릭 시 'recovery'
}
```

### B.6 접근성

- `<form>` `aria-labelledby="mfa-title"` `noValidate`
- 에러 영역 `role="alert"` (login-form 패턴 동일)
- "복구 코드로 로그인" 링크는 `<a>` 또는 `<button type="button">` (mode 전환만 하므로 button이 시맨틱하게 정확)
- focus order: input → submit → 복구 링크 → /login 링크

---

## C. /admin/security — 의존성 취약점 audit (SEC-4 카드)

### C.1 라우트 + 메뉴 신설

- 신규 라우트: `apps/web/app/(main)/admin/security/page.tsx`
- 메뉴 추가: `admin-groups.ts`의 "통합 / 로그" 그룹 끝에 추가. **이유:** 백업·스토리지·바이러스 스캔과 같은 "운영 가드" 카테고리. R36 바이러스 스캔이 attachment 보안이라면 SEC-4는 의존성 보안 — 같은 운영 패널 흐름.

```ts
{
  href: '/admin/security',
  label: '의존성 취약점',
  description: 'npm audit / 패키지 보안 점검',
  icon: ShieldAlert,  // 이미 사용 중. 여기는 변형 또는 ShieldX
},
```

> Decision (PM 결정 필요): 아이콘 충돌 — `/admin/scans`(바이러스)도 `ShieldAlert`. 권장은 `/admin/security`에 lucide의 `Bug` 또는 `Package` 아이콘. **본 spec은 `Package`로 가정.**

### C.2 와이어프레임

```
┌── /admin/security ───────────────────────────────────────────┐
│ ┌──[관리자 메뉴]─┐ ┌──[메인]──────────────────────────────┐  │
│ │                │ │ 의존성 취약점                          │  │
│ │ 사용자/조직    │ │ pnpm audit 결과를 기반으로 npm 패키지   │  │
│ │ ...            │ │ 의존성의 알려진 취약점을 모니터링합니다. │  │
│ │ 통합 / 로그    │ │                                       │  │
│ │  변환 작업     │ │ ┌─ 마지막 검사 ───────────────────┐   │  │
│ │  백업          │ │ │ 3시간 전 (2026-04-27 09:15)    │   │  │
│ │  스토리지      │ │ │           [지금 검사] [outline]│   │  │
│ │  바이러스 스캔 │ │ └────────────────────────────────┘   │  │
│ │ ▶의존성 취약점 │ │                                       │  │
│ │  API Key       │ │ ┌─ 카운트 ─────────────────────────┐  │  │
│ │  감사 로그     │ │ │ ┌──────┐ ┌──────┐ ┌──────┐ ┌────┐ │  │  │
│ │                │ │ │ │ 🔴 0│ │ 🟠 2│ │ 🟡 5│ │⚪12│ │  │  │
│ │                │ │ │ │Critical│ │ High │ │ Mod │ │ Low│ │  │  │
│ │                │ │ │ └──────┘ └──────┘ └──────┘ └────┘ │  │  │
│ │                │ │ └──────────────────────────────────┘  │  │
│ │                │ │                                       │  │
│ │                │ │ ┌─ 항목 (high+critical 우선) ──────┐  │  │
│ │                │ │ │ severity │ 패키지 │ 버전 │ CVE │  │  │
│ │                │ │ │ 🟠 High  │ axios  │1.6.x │CVE…│  │  │
│ │                │ │ │ 🟠 High  │ ws     │8.5.x │CVE…│  │  │
│ │                │ │ │ 🟡 Mod   │ ...    │ ...  │... │  │  │
│ │                │ │ │ ...                              │  │  │
│ │                │ │ └──────────────────────────────────┘  │  │
│ │                │ │                                       │  │
│ │                │ │ pnpm audit는 매일 02:00 KST 자동 실행 │  │
│ │                │ │ 됩니다. CI 빌드도 high 이상에서 실패. │  │
│ └────────────────┘ └───────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### C.3 SecurityAuditCard (마지막 검사 + 트리거)

```tsx
interface SecurityAuditCardProps {
  lastCheckedAt: string | null;          // ISO
  isRunning: boolean;                    // 검사 진행 중
  onRunNow: () => void;
}
```

- "마지막 검사" 텍스트: ISO → relative ("3시간 전") + tooltip으로 절대 시각 ("2026-04-27 09:15:32")
- "지금 검사" 버튼: `<Button variant="outline">`. mutation isPending이면 spinner + "검사 중..." 텍스트
- BE 캐시 (15분) 안내: 카드 아래 작은 텍스트 "결과는 15분간 캐시됩니다."

### C.4 카운트 카드 4개

```tsx
interface VulnerabilityCountsProps {
  counts: { critical: number; high: number; moderate: number; low: number };
  onFilterClick?: (sev: 'critical' | 'high' | 'moderate' | 'low' | null) => void;
}
```

- 4개 카드 grid (`grid grid-cols-4 gap-3`):
  - **Critical**: dot `bg-danger`, 카운트 `text-3xl font-semibold`, severity 라벨
  - **High**: dot `bg-warning` (또는 `text-orange-600` — danger와 구분 위해)
  - **Moderate**: dot `bg-warning/60`, `text-yellow-600`
  - **Low**: dot `bg-fg-muted`
- 카운트가 0이면 카드 dim (`opacity-60`)
- 카운트 1+면 클릭 시 아래 테이블 필터 (R36 scans 페이지 패턴 동일). R39 1차에서는 클릭 필터 생략 가능 (PM 결정).

### C.5 VulnerabilitiesTable

```tsx
interface VulnerabilityRow {
  packageName: string;
  installedVersion: string;
  severity: 'critical' | 'high' | 'moderate' | 'low';
  cveId: string | null;             // 'CVE-2024-12345'
  cveUrl: string | null;            // 'https://...'
  title: string;                    // 'Prototype Pollution in axios'
  patchedVersions: string | null;   // '>=1.7.0'
  paths: string[];                  // ['axios', 'foo > axios'] (의존 경로)
}
```

- shadcn `<Table>` 사용
- 컬럼:
  1. **severity** — `<Badge>` (critical=danger, high=warning, moderate=warning/dim, low=muted)
  2. **패키지명** — monospace `font-mono text-sm`
  3. **버전** — installedVersion → `text-fg-muted`. patched가 있으면 `→ {patchedVersions}` 표시
  4. **취약점** — title (한글 번역 X — npm advisory 영문 그대로) + CVE 링크 (있으면)
  5. **경로** — paths[0] 표시 + tooltip으로 전체 경로 (`>` 구분)
- 정렬: severity desc → packageName asc (default)
- empty state: "발견된 취약점이 없습니다." + 초록 ✓ 아이콘 (`text-success`)
- 행 hover: `hover:bg-bg-muted`
- 외부 링크는 `target="_blank" rel="noreferrer noopener"` + `<ExternalLink className="ml-1 h-3 w-3" />`

### C.6 페이지 권한

- `/admin/security`는 SUPER_ADMIN + ADMIN 접근 가능 (다른 admin 페이지와 동일)
- 다른 사용자가 직접 URL로 접근 시 layout가드(R28+)에서 403

---

## D. 비밀번호 변경 폼 확장 (A-4 카드)

### D.1 PasswordSection 변경 — 정책 안내 + 강도 미터 + 만료 안내

기존 PasswordSection (R27 P-5)을 다음 4개 추가로 확장:

1. 폼 상단 **정책 안내 박스** (PasswordPolicyHint 컴포넌트)
2. 새 비밀번호 input 아래 **실시간 강도 미터** (PasswordStrengthMeter)
3. 강도 미터 아래 **정책 충족 체크리스트** (4개 항목, 실시간 ✓/×)
4. 만료 임박 시 **상단 배너** (PasswordExpiryBanner — settings layout 또는 main layout)

### D.2 와이어프레임

```
┌─ 비밀번호 변경 ──────────────────────────────────────────────┐
│ 계정 비밀번호를 변경합니다. 변경 후 다시 로그인할 필요는 없습니│
│ 다.                                                          │
│                                                              │
│ ┌─ 비밀번호 정책 ─────────────────────────────────────────┐  │
│ │ • 10자 이상 (현재 정책 — 기존 8자에서 강화됨)            │  │
│ │ • 영문 / 숫자 / 특수문자 중 3종 이상 포함                │  │
│ │ • 직전 2개 비밀번호와 다름                              │  │
│ │ • 90일마다 변경 권장 (만료 시 강제)                      │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ 현재 비밀번호 *                                               │
│ [───────────────────────────────────────]                    │
│                                                              │
│ 새 비밀번호 *                                                 │
│ [───────────────────────────────────────]                    │
│                                                              │
│   강도: ████░░░░░░ 보통                                       │
│                                                              │
│   ✓ 10자 이상 (12자)                                         │
│   ✓ 영문 / 숫자 / 특수문자 중 3종 이상                        │
│   ✗ 직전 2개와 다름 (서버 검증, 입력 후 표시)                 │
│                                                              │
│ 비밀번호 확인 *                                               │
│ [───────────────────────────────────────]                    │
│                                                              │
│                                              [변경] (primary)│
└──────────────────────────────────────────────────────────────┘
```

### D.3 PasswordStrengthMeter

```tsx
interface PasswordStrengthMeterProps {
  password: string;                // 클라 측에서만 평가, 서버 전송 X
}

type Strength = 'weak' | 'fair' | 'good' | 'strong';
```

**알고리즘 (frontend 로컬 평가):**
- score = 0~4
- +1 if length ≥ 10
- +1 if length ≥ 14
- +1 if 영문 + 숫자 + 특수 3종 모두 포함
- +1 if 영문 대소문자 혼용
- 매핑:
  - 0~1: weak (약함, `bg-danger` 또는 `text-danger`)
  - 2: fair (보통, `bg-warning`, `text-warning`)
  - 3: good (강함, `bg-brand-500`)
  - 4: strong (매우 강함, `bg-success`)

**시각:**
- 10단위 progress bar (`<div className="flex gap-0.5">`로 10개 칸 — 또는 `<Progress>` 4분할 색상)
- 라벨 텍스트: 약함/보통/강함/매우 강함
- **빈 input일 때는 미표시** (`if (!password) return null`)

> Decision (PM 결정 필요): zxcvbn 라이브러리 사용 vs 자체 알고리즘. **권장: 자체 알고리즘 (위 4점 score).** zxcvbn은 ~400KB로 무겁고 한국어 사전 X, 본 제품은 빠른 로컬 hint면 충분.

### D.4 정책 충족 체크리스트

```tsx
interface PasswordChecklistProps {
  password: string;
}
```

- 4개 항목 (체크박스 like dot, 실시간):
  1. **10자 이상** — `password.length >= 10` → ✓ 초록 (`text-success`), 아니면 ✗ 회색
  2. **영문/숫자/특수 3종 이상** — 정규식으로 카운트
  3. **공백 포함 X** — `!/\s/.test(password)` (BE 정책 따라 추가; PM 결정)
  4. **직전 2개와 다름** — 서버에서만 검증 가능 → 폼 제출 후 에러 시 빨간 ✗ 텍스트로 표시

각 항목은 `<div className="flex items-center gap-2 text-xs">` + dot/icon

### D.5 PasswordPolicyHint

위 와이어프레임의 정책 안내 박스. 정적 컴포넌트.

```tsx
interface PasswordPolicyHintProps {
  // 정책 값을 prop으로 받아 변경 가능 (현재는 hardcode)
  minLength: number;            // 10
  requiredKinds: number;        // 3 (영숫특 중)
  preventReuseCount: number;    // 2 (직전 N개)
  expiryDays: number;           // 90
}
```

- `app-panel-muted` (`bg-bg-subtle`) + `<Info>` 아이콘 + `<ul>`

### D.6 PasswordExpiryBanner

만료 7일 이내일 때 main layout 상단에 노란 배너.

```tsx
interface PasswordExpiryBannerProps {
  daysRemaining: number | null;  // null이면 미표시; 7 이하면 표시
}
```

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠ 비밀번호 만료까지 5일 남았습니다. [지금 변경하기 →]          │
└──────────────────────────────────────────────────────────────┘
```

- 배경: `bg-warning/10` + 좌측 `border-l-4 border-warning` (R37 패턴 따라)
- 위치: `apps/web/app/(main)/layout.tsx`에서 header 아래, 콘텐츠 위 (sticky 아님 — 스크롤 시 사라짐)
- 클릭 → `/settings?tab=password`
- ⚠ **만료된 경우(0일 이하)**는 R39에서는 강제 변경 페이지 redirect (BE middleware 처리). FE는 redirect 후 PasswordSection만 표시 + "비밀번호가 만료되었습니다. 변경 후 사용할 수 있습니다." 알림.

> Decision (PM 결정 필요): 만료 강제 변경 시 다른 페이지 접근 차단 — 어떤 라우트는 허용? `/login`, `/logout`, `/settings?tab=password`만 허용? `/api/v1/me/password` PATCH만 허용? **권장은 layout 가드에서 `/settings`만 화이트리스트 + 다른 라우트는 `/settings?tab=password&forced=1`로 redirect.**

### D.7 카피 (서버 에러 매핑)

PasswordSection.tsx의 onError에 추가:

```tsx
case 'WEAK_PASSWORD':         // 길이 / 종류 부족
  toast.error('새 비밀번호가 정책을 충족하지 않습니다. 10자 이상 + 영숫특 3종 이상.');
case 'PW_REUSED':             // 직전 2개와 같음 (BE의 새 코드)
  toast.error('직전 2개 비밀번호와 같을 수 없습니다.');
case 'PW_CONTAINS_USERNAME':  // 사용자명 포함 (선택 정책)
  toast.error('비밀번호에 사용자 ID가 포함되어 있습니다.');
```

---

## E. 컴포넌트 시그니처 + 파일 구조

### E.1 신규 파일

```
apps/web/
  app/
    (auth)/
      login/
        mfa/
          page.tsx                       # B 카드
    (main)/
      admin/
        security/
          page.tsx                       # C 카드
  components/
    settings/
      MfaSection.tsx                     # A 카드
      PasswordPolicyHint.tsx             # D 카드 (서브)
      PasswordStrengthMeter.tsx          # D 카드 (서브)
      PasswordChecklist.tsx              # D 카드 (서브)
      PasswordExpiryBanner.tsx           # D 카드
    mfa/
      MfaEnrollDialog.tsx                # A.4
      MfaDisableDialog.tsx               # A.6
      RecoveryCodesDialog.tsx            # A.5
      MfaVerifyForm.tsx                  # B 카드 (login/mfa 페이지 내용)
    security/
      SecurityAuditCard.tsx              # C.3
      VulnerabilityCounts.tsx            # C.4
      VulnerabilitiesTable.tsx           # C.5
      SeverityBadge.tsx                  # severity → 색·라벨 매핑
```

### E.2 수정 파일

```
apps/web/
  app/
    (auth)/
      login/
        login-form.tsx                   # mfaRequired redirect 처리
    (main)/
      layout.tsx                         # PasswordExpiryBanner 마운트
      settings/
        page.tsx                         # "보안" 탭 추가 + MfaSection 마운트
      admin/
        admin-groups.ts                  # /admin/security 메뉴 추가
  components/
    settings/
      PasswordSection.tsx                # 정책·강도·체크리스트 mount + 에러 카피 추가
```

### E.3 핵심 훅·쿼리 키 추가

```ts
// apps/web/lib/queries.ts
queryKeys.me = () => ['me'];                                         // 기존
queryKeys.adminSecurityAudit = () => ['admin', 'security', 'audit']; // 신규

// useMfaEnrollMutation, useMfaConfirmMutation, useMfaDisableMutation,
// useRegenerateRecoveryCodesMutation, useMfaVerifyMutation,
// useSecurityAuditQuery, useRunSecurityAuditMutation
```

### E.4 라우팅 + 가드

```ts
// middleware.ts 또는 layout.tsx
// 1) /settings, /admin/* — 인증 필수 (기존)
// 2) /login/mfa — 인증 미필수, query token 필수
// 3) 비밀번호 만료 강제 변경 — middleware에서 me 응답의 passwordExpiredAt < now()이면
//    /settings?tab=password&forced=1로 redirect (단, /settings, /api/v1/me/password,
//    /api/v1/auth/signout, /login, /logout만 화이트리스트)
```

### E.5 보안 메모 (frontend 구현 의무)

1. **TOTP secret은 dialog 안에서만 메모리에 존재** — useState만 사용. dialog `onOpenChange={false}` 시 `setSecret(null)` 명시. Dev tools React state inspector에 secret이 노출되어도 운영자만 볼 수 있는 환경이라 OK.
2. **복구 코드는 dialog 닫힘과 함께 메모리에서 폐기** — 같은 규칙. 새로고침 후 절대 다시 표시 불가.
3. **6자리 코드 input은 paste 허용** — 사용자가 인증기에서 복사해 붙여넣기 가능. 자동 split (6분할 input) 패턴은 안 씀.
4. **비밀번호 입력은 평문 메모리 노출 최소화** — `<Input type="password">` 기본 사용. 강도 미터 평가는 onChange 시점에만 실행하고 변수에 저장 X.
5. **다운로드 파일명에 username 포함** — 본인 외 다른 계정 코드와 섞이지 않게. timestamp도 포함.

---

## F. 디자인 토큰 변경 — 없음

R28~R37의 토큰(`brand`, `success`, `warning`, `danger`, `fg-muted`, `bg-subtle` 등)으로 R39 모든 시각 요구를 충족 가능. 강도 미터의 4단계 색도 기존 토큰 매핑(§D.3)으로 처리.

---

## G. 접근성 (WCAG 2.1 AA — R37 audit 패턴 따름)

### G.1 키보드

- MfaSection 카드: tab → 버튼 1개(또는 2개), enter로 dialog 열림
- MfaEnrollDialog: tab으로 step 내 input → 버튼. shift+tab 역순. ESC 닫기 (단계 4 RecoveryCodesDialog는 체크 후에만)
- RecoveryCodesDialog: 체크박스 → [복사] → [다운로드] → [완료]. 체크 안 하면 [완료] disabled + ESC 차단
- MfaVerifyForm: autofocus → input → submit → "복구 코드로 로그인" 링크 → "다른 계정" 링크
- PasswordSection: tab 순서는 기존 그대로 (current → new → confirm → submit). 강도 미터/체크리스트는 readonly 보조 정보라 tab order에서 skip

### G.2 ARIA / 시맨틱

- MfaSection 상태 표시: `role="status"` + `aria-live="polite"` (변경 시 SR 통지)
- MfaEnrollDialog: shadcn Dialog가 `role="dialog"` `aria-labelledby` 자동 처리
- 6자리 input: `<Input>` `id="totp-code"` `aria-label="6자리 인증 코드"` `aria-describedby="totp-error"`
- 에러 영역: `<p id="totp-error" role="alert">` (login-form 패턴 동일)
- RecoveryCodesDialog 체크박스: `<Checkbox id="confirm-saved">` + `<Label htmlFor="confirm-saved">`
- VulnerabilitiesTable: `<table>` + `<caption className="sr-only">의존성 취약점 목록</caption>`
- SeverityBadge: 색만으로 구분 X — dot + 텍스트 라벨 항상. R36 AttachmentScanBadge 패턴 그대로
- PasswordExpiryBanner: `role="alert"` + `<a>` 링크에 `aria-label="비밀번호 변경 페이지로 이동"`

### G.3 색대비

- 강도 미터 4단계 모두 `text-fg` 또는 `text-warning`/`text-success` 등 R37 보정된 토큰 사용 — AA 4.5:1 충족
- SeverityBadge `text-warning` (orange) on `bg-warning/10` — AA 충족 (R37 검증된 조합)

### G.4 스크린리더

- MfaSection `<h2>2단계 인증</h2>` 헤딩 → SR이 섹션 구조 인식
- 활성 상태 변경 시: `<div aria-live="polite">활성</div>` 텍스트가 ✓ 아이콘과 함께 announce
- VulnerabilityCounts: 각 카드 `aria-label="Critical 0건, High 2건, Moderate 5건, Low 12건"` 통합 라벨 또는 카드별 라벨

---

## H. Empty / Loading / Error 상태

### H.1 MfaSection

- Loading (me query pending): `<Skeleton>` 3줄 (헤딩 / 상태 라인 / 버튼)
- Error (me query 실패): "보안 설정을 불러올 수 없습니다. 새로고침하세요." (R28~R38 패턴)
- Empty: 해당 없음 — 상태가 always {활성|비활성} 둘 중 하나

### H.2 MfaEnrollDialog

- enroll mutation pending: 단계 2 진입 전 spinner ("QR 코드 생성 중...")
- confirm mutation pending: 단계 3 [확인] 버튼에 spinner + disabled
- Error: 6자리 미스매치는 inline 에러, 그 외(network 등)는 toast

### H.3 SecurityAuditCard / VulnerabilitiesTable

- Loading: `<Skeleton>` (카운트 4 + 테이블 행 5)
- Empty (취약점 0건): `<EmptyState>` "발견된 취약점이 없습니다." + ✓ 아이콘 (success 색)
- Error: "검사 결과를 불러올 수 없습니다." + 재시도 버튼
- 검사 진행 중 (mutation isPending): 카드 disabled + spinner + "검사 중... (최대 1분)" 안내

### H.4 PasswordSection (확장)

- 강도 미터: 빈 input → 미표시. 1자 이상 → 표시
- 체크리스트: 빈 input → 4개 모두 ✗ 회색. 입력 시 실시간 갱신
- 만료 안내 배너: daysRemaining null → 미표시

---

## I. 반응형 (Desktop only)

- 1280 / 1440 / 1920 모두 동일 레이아웃
- /settings 컨테이너 `max-w-2xl` (기존)
- /admin/security 메인 영역: AdminSidebar(고정 폭) + 메인 (flex-1, max-w-6xl)
- VulnerabilityCounts grid: 1280에서 4컬럼, 그 미만으로 줄어들지 않음 (Desktop only)
- MfaEnrollDialog 너비: shadcn Dialog 기본 (`max-w-lg`) — 단계 2의 QR(160px) 가로 영역 충분

---

## J. PM 결정 필요 항목 (TBD)

| # | 항목 | 권장 | 영향 |
|---|---|---|---|
| 1 | 6자리 input — 단일 vs 6분할 | **단일** (Desktop only, 구현 단순, paste 자연 작동) | enroll/login 6자리 입력 UX |
| 2 | 강도 미터 — zxcvbn vs 자체 알고리즘 | **자체 알고리즘** (4점 score) | 번들 사이즈 (zxcvbn ~400KB) |
| 3 | 비밀번호 만료 강제 변경 시 라우트 화이트리스트 | `/settings`, `/login`, `/logout`, `/api/v1/me/password`만 허용 | UX (다른 페이지 접근 차단 강도) |
| 4 | `/admin/security` 메뉴 아이콘 | `Package` (lucide) — `ShieldAlert`는 `/admin/scans`에 사용 중 | admin 사이드바 시각 |
| 5 | 카운트 카드 클릭 → 테이블 필터 | **R39 1차에는 생략** (다음 라운드) | 코드 양 |
| 6 | 비밀번호 정책 — 공백 금지 | **금지** (BE 정책 일치) | 정책 체크리스트 4번째 항목 추가 |
| 7 | 카운트 카드 — Critical만 빨강 vs Critical+High 빨강 | **Critical만 danger, High는 warning** (R36 InfoTab 패턴 동일) | 시각 강도 |
| 8 | 복구 코드 형식 — 4-4 vs 4자×2 (`XXXX-XXXX`) vs 16자 단일 | **`XXXX-XXXX` (4자-4자)** — 손글씨/구두 전달 시 가독성 ↑ | BE 생성 형식 일치 필요 |
| 9 | 복구 코드 갯수 — 10개 vs 5개 | **10개** (GitHub/Google 표준) | recovery 잔여 표시 영향 |
| 10 | recovery 잔여 ≤ 3 일 때의 알림 | settings에 노란 텍스트 + 종 알림 1건 자동 발행 | 사용자 인지 |

---

## K. 검증 체크리스트 (frontend 구현 완료 시)

- [ ] /settings에 "보안" 탭 추가, MfaSection 정상 mount
- [ ] MFA 비활성 → enroll 4단계 → 활성화 + recovery codes 표시 + 체크 후 닫기 강제
- [ ] 활성 상태에서 [복구 코드 재발급] → 재인증 후 새 10개 표시
- [ ] [비활성화] → 6자리 또는 비밀번호 재인증 → 비활성으로 토글
- [ ] /login에서 MFA 활성 사용자는 1단계 후 /login/mfa로 redirect
- [ ] /login/mfa에서 6자리 → 세션 발급, "복구 코드로 로그인" 링크 작동
- [ ] /login/mfa 5회 fail 시 잠금 + /login redirect
- [ ] /admin/security 카운트 4개 + 마지막 검사 시각 + [지금 검사] mutation 작동
- [ ] /admin/security 취약점 0건 시 EmptyState 표시 (성공 아이콘)
- [ ] 비밀번호 변경 폼: 정책 안내 + 강도 미터 + 체크리스트 실시간 작동
- [ ] 비밀번호 변경 폼: WEAK_PASSWORD / PW_REUSED 에러 코드 매핑
- [ ] 만료 7일 이내 → 모든 페이지 상단 배너 표시
- [ ] 만료된 사용자 → /settings?tab=password로 강제 redirect (다른 라우트 접근 차단)
- [ ] 키보드만으로 모든 신규 dialog 조작 가능
- [ ] RecoveryCodesDialog 체크 안 하면 [완료] disabled + ESC 닫기 차단
- [ ] 모든 신규 컴포넌트 색대비 AA 4.5:1 충족 (R37 보정된 토큰)
- [ ] Lobby/Approval/Search 등 기존 페이지 회귀 0건

---

## L. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-04-27 | 초기 작성 (R39 designer agent) |
