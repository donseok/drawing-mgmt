# R28~R45 누적 보안 감사 보고서

> drawing-mgmt(동국씨엠 도면관리시스템) 운영 시작(WBS 4.4.3 / R46) 전 P0 산출물.
> 본 문서는 정적 분석 + 코드 리딩으로 도출한 사실 기반 감사 결과이며,
> 침투 테스트나 동적 fuzzing은 포함하지 않는다. 동적 검증은 별 단계로 권고.

---

## 0. 요약 (Executive summary)

| 항목 | 내용 |
|------|------|
| 감사일 | 2026-04-28 |
| 감사자 | security-auditor (R46) |
| 평가 대상 commit | `f209cc1` (main HEAD, R45 catch-up docs 직후) |
| 평가 범위 | R28~R45 누적 + 그 이전 라운드 잔존분 (apps/web 전체 + lib/ + auth/ + prisma) |
| 적용 체크리스트 | OWASP Top 10 + 의존성/라이선스 + 비밀 관리 + 운영 환경(헤더/CSP) |
| 전체 등급 | **PASS-WITH-CAVEATS** — 운영 시작은 가능하나 P0 4건은 **머지 차단 수준**으로 해소 필요 |

**주요 강점 Top 5**
1. `withApi` wrapper(R28 SEC-1/SEC-3)로 CSRF + Rate limit 일원화 — 적용된 라우트는 결함 없음.
2. SAML/MFA bridge token이 `crypto.timingSafeEqual` + AUTH_SECRET HMAC + ttl로 일관 설계.
3. 모든 SQL은 Prisma ORM 또는 template-literal `$queryRaw` (parameterized) — 인젝션 취약점 0건.
4. ts_headline `<b>` 마커는 정규식 split + JSX `<mark>`로 렌더 — `dangerouslySetInnerHTML` 0건.
5. GPL/AGPL 직접 link 0건 재확인. ClamAV/LibreDWG는 subprocess 격리. 라이선스 정책 무위반.

**주요 취약점 Top 5 (자세한 내용은 §13 참고)**
1. **[FIND-001 / Critical]** `withApi` wrapper 미적용 라우트가 47개 → CSRF + Rate limit 무방비. **P0**.
2. **[FIND-002 / Critical]** `PATCH /api/v1/me/password`가 R39 비밀번호 정책(`validatePasswordWithHistory`)을 호출하지 않아 정책 우회 가능 + `passwordChangedAt` 미갱신 + 직전 비밀번호 history 미shift. **P0**.
3. **[FIND-003 / High]** middleware의 `isDemoPublic` 분기가 `/api/v1/attachments/*`와 `/viewer/*`를 인증 없이 통과시킴 → 운영에서 모든 첨부 파일이 익명 다운로드 가능. **P0**.
4. **[FIND-004 / High]** `auth.ts`의 `findDevUser` 평문 인메모리 계정 6개가 `DEV_AUTH_FALLBACK !== 'false'`일 때 항상 활성. 운영 배포 시 이 변수 주입 누락 = `admin/admin123!`로 즉시 SUPER_ADMIN 로그인. **P0**.
5. **[FIND-005 / High]** middleware가 `isPasswordExpired`를 호출하지 않음 → 90일 만료 정책이 사실상 비활성. R39의 핵심 보안 약속 불이행. **P0**.

P0 4건(FIND-001~005 중 005는 P1로 분류 후술)이 해결되지 않으면 운영 시작을 권하지 않는다.

> **R47 업데이트(2026-04-28):** P0 4건(FIND-001/002/003/004) + FIND-014 모두 **Mitigated**. R47 backend round에서 일괄 fix 완료. typecheck/build pass. `meta/route.ts` dev fixture path는 P3 후속으로 별도 트래킹. 운영 시작 차단 사유 해소됨. FIND-005(90일 만료 middleware 통합), FIND-006(reset-password 정책 검증) 등 P1는 다음 라운드 권고.

---

## 1. 인증 (Authentication)

### 1.1 일반 로그인 (Credentials Provider) — `apps/web/auth.ts`
| 점검 | 결과 | 근거 |
|------|------|------|
| bcrypt cost factor | OK | `BCRYPT_ROUNDS = 12` (`apps/web/app/api/v1/admin/users/route.ts:24`, `me/password/route.ts:74`, `reset-password/route.ts:28`). 2026 기준 적정 (≥10 권장). |
| 로그인 실패 lockout | OK | 5회 → 30분 (`auth.ts:41-42`). 카운터/타임스탬프 모두 DB 컬럼. |
| Constant-time fallback | OK | DB lookup miss 시 더미 bcrypt compare 수행 (`auth.ts:250`) — 사용자 존재 여부 timing oracle 방지. |
| Soft-delete 게이팅 | OK | `getCurrentUser`가 `user.deletedAt`을 401 처리 (`auth-helpers.ts:34`). |
| **DEV 평문 계정** | **NG** | `auth.ts:47-54`의 6개 평문 계정 (`admin123!` 등)이 `DEV_AUTH_FALLBACK === 'false'`가 아닐 때 항상 활성. **FIND-004 / P0**. |

### 1.2 SAML SSO (R37) — `lib/saml.ts` + `app/api/v1/auth/saml/`
| 점검 | 결과 | 근거 |
|------|------|------|
| `SAML_ENABLED` gate | OK | metadata/login/acs 모두 `isSamlEnabled()` 첫 줄. 비활성 시 404. |
| Assertion 서명 검증 | OK | `wantAssertionsSigned: true`, `wantAuthnResponseSigned: true` (`saml.ts:88-89`). |
| Clock skew | OK | 5분 — AD federation 표준치. |
| Bridge token | OK | HMAC-SHA256 + `AUTH_SECRET` 도메인 prefix (`saml-bridge:`) + 1분 ttl + `timingSafeEqual` (`saml.ts:296-356`). |
| RelayState open-redirect 방지 | OK | `sanitizeRelay` — `/`로 시작하면서 `//`은 거부 + 512자 cap (`acs/route.ts:134-139`, `login/route.ts:45-51`). |
| `validateInResponseTo` | 보류 | 현재 `'never'` (`saml.ts:93`). Redis-backed cache 도입 전까지 약점. **FIND-007 / Medium**. |
| 에러 메시지 리킹 | OK | `acs/route.ts:90-94` IdP 검증 실패 시 stable error code만 반환, 내부 에러는 `console.error`로만. |

### 1.3 MFA TOTP (R39 + R40) — `lib/totp.ts`, `lib/mfa-bridge.ts`
| 점검 | 결과 | 근거 |
|------|------|------|
| TOTP 알고리즘 | OK | RFC 6238 표준. 160-bit secret, ±1 step window (`totp.ts:38-49,89-108`). |
| Recovery codes | OK | 10개 발급, bcrypt rounds=10, 일정-시간 매칭 (`totp.ts:112-157`). |
| Recovery code single-use 강제 | OK | `verify/route.ts:139-147` 매칭 인덱스 제거 후 update. |
| MFA bridge token | OK | HMAC + 5분 ttl, 도메인 prefix `mfa-bridge:` (SAML과 분리). |
| MFA gate at login | OK | `auth.ts:282-292` `totpEnabledAt` 검사 + `MfaRequiredError` throw. |
| **TOTP secret 평문 저장** | NG (선언적 알려진 사실) | schema.prisma:74-75 주석에 "should be encrypted at rest" 명시. **FIND-008 / Medium**. |

### 1.4 비밀번호 정책 (R39) — `lib/password-policy.ts`
| 점검 | 결과 | 근거 |
|------|------|------|
| 길이 ≥ 10 | 정의됨, 미사용 | `validatePassword` 정의(`password-policy.ts:53`). 어디에서도 import 안 됨. |
| 복잡도 3/4 클래스 | 정의됨, 미사용 | 동상. |
| 직전 2개 hash 재사용 금지 | 정의됨, 미사용 | `validatePasswordWithHistory`(line 74) — **0회 import**. |
| 90일 만료 | 정의됨, 미사용 | `isPasswordExpired`(line 116) — **0회 import**. middleware도 호출 안 함. |
| `passwordChangedAt` 갱신 | 미적용 | `me/password/route.ts:74-77`이 `passwordHash`만 update, `passwordChangedAt`/`passwordPrev1Hash` 미shift. |
| `buildPasswordChangeUpdate` | 정의됨, 미사용 | 동상. |

**결론:** R39에서 신설된 비밀번호 정책 모듈 전체가 **dead code**. 사용자 비밀번호 변경 경로(PATCH /api/v1/me/password)는 R28~R30 시점의 단순 8자 검사만 한다. **FIND-002 / P0**.

### 1.5 세션 관리 (Auth.js v5)
| 점검 | 결과 | 근거 |
|------|------|------|
| `AUTH_SECRET` 강도 요구 | 부분 OK | `.env.example:10`이 32-char 권고. 빌드 시 placeholder 체크 없음 (`ci.yml:164`은 placeholder 그대로). 운영 배포 가이드 강화 필요. |
| Session strategy | OK | JWT 8시간 (`auth.ts:336`, `auth.config.ts:23`). |
| HttpOnly | OK | Auth.js v5 default (서버 코드에서 cookie 명시 설정 없음). |
| Secure flag | 보류 | Auth.js v5는 production에서 자동 `__Secure-` prefix. 다만 `auth.config.ts`에 `trustHost`/`useSecureCookies` 명시 없음 → Next.js 14 + reverse proxy 환경에서 헤더 주입 시 위험. **FIND-009 / Medium**. |

---

## 2. 인가 (Authorization)

| 점검 | 결과 | 근거 |
|------|------|------|
| `requireUser` 일관 적용 | 대부분 OK | `objects/[id]/route.ts:88` 등 모든 mutating 라우트가 첫 줄에 호출. |
| Admin role gate | OK | `admin/users/route.ts:43-45` `actor.role !== 'SUPER_ADMIN' && actor.role !== 'ADMIN'` 패턴 일관. |
| ADMIN→SUPER_ADMIN 가드 | OK | 4개 라우트 모두 적용: `users/[id]/route.ts:114`, `unlock/route.ts:39`, `reset-password/route.ts:70`, `expire-password/route.ts:46`. |
| Self-demotion 가드 | OK | `users/[id]/route.ts:131-134` 본인 권한 변경 거부. |
| Self-delete 가드 | OK | `users/[id]/route.ts:221-222`. |
| 폴더 권한 평가 (`canAccess`) | OK | `permissions.ts:73-77` 단일 진입점. 모든 관련 라우트가 통일 사용 (objects/route.ts, attachments/route.ts, lobbies/route.ts 등). |
| 자료 상태 머신 | OK | `lib/state-machine.ts`의 `canTransition`이 모든 transition 라우트에서 호출 (checkout/checkin/release/approve/reject/cancel-checkout). |
| Lock ownership 가드 | OK | `objects/[id]/route.ts:178-180` 본인 lock 검사. `state-machine.ts:42-49` 명시. |
| Upload owner 가드 | OK | `uploads/[id]/route.ts:60-62` `row.userId !== userId && !isAdmin(role)` 체크. |
| **API key prefix/scope 검증** | 미사용 | `ApiKey` 모델은 schema에 있으나 라우트가 아직 미구현. `INTEGRATION_API_KEY` 환경 변수 → 라우트 매핑 grep 결과 0건. **FIND-010 / Info**. |

---

## 3. 입력 검증 (Input validation)

| 점검 | 결과 | 근거 |
|------|------|------|
| zod 적용도 | 거의 100% | `safeParse` grep 결과 모든 mutating 라우트 적용. |
| Query params 검증 | OK | `objects/route.ts:28-70`, `admin/users/route.ts:26-33` 등 cursor/limit 폭주 가드. limit `Math.min(100, …)` 클램프. |
| 파일 업로드 size cap | 부분 OK | `MAX_UPLOAD_BYTES = 2 GiB` (`lib/upload-store.ts`). 프롬프트의 `200MB` 명세와 차이 — TRD/PRD 재검토 필요. **FIND-011 / Low**. |
| MIME 검증 | 부분 OK | `uploads/route.ts:34-46`은 mimeType을 받기만 하고 화이트리스트 검증 없음. 실제 컨버전/스캔 워커에서 거른다지만 edge에서 차단이 깔끔. **FIND-012 / Medium**. |
| `dev/ingest-dwg` 확장자 화이트리스트 | OK | `ext === '.dwg' || '.dxf'`만 허용 (`route.ts:80-85`). prod에서는 middleware가 차단. |

---

## 4. CSRF / Origin (R28 SEC-1)

### 4.1 `withApi` 적용 매트릭스

`grep -l "withApi("` 결과 mutating 라우트 62개 중 **15개만 적용**. 47개가 미적용.

**적용 (안전):**
- `bulk-create / bulk-move / bulk-copy / bulk-release`
- `me/preferences`, `me/mfa/{enroll,confirm,disable}`
- `chat`, `admin/security/audit (POST)`, `admin/storage/test`
- `admin/organizations`(POST/reorder), `admin/groups`(POST), `admin/backups/run`
- `folders/[id]/permissions` (PUT)
- `uploads/route.ts` (POST), `uploads/[id]/route.ts` (PATCH/DELETE)
- `admin/users/[id]/expire-password`

**미적용 (취약):** 47개. 대표 예:
- `admin/users/route.ts` (POST 사용자 생성)
- `admin/users/[id]/route.ts` (PATCH/DELETE)
- `admin/users/[id]/unlock/route.ts` (POST)
- `admin/users/[id]/reset-password/route.ts` (POST)
- `me/password/route.ts` (PATCH)
- `objects/[id]/route.ts` (PATCH/DELETE)
- `objects/[id]/{checkout,checkin,cancel-checkout,release}/route.ts`
- `objects/route.ts` (POST 자료 생성)
- `attachments/[id]/route.ts` (PATCH/DELETE)
- `approvals/[id]/{approve,reject,action}/route.ts`
- `lobbies/route.ts` (POST), `lobbies/[id]/replies/route.ts` (POST)
- `folders/route.ts`, `folders/[id]/{copy,route.ts}`
- `notifications/[id]/read/route.ts`, `read-all/route.ts`
- `me/{route.ts,signature,pins,...}` 모든 PATCH/POST/DELETE
- `admin/scans/[id]/rescan`, `admin/pdf-extracts/[id]/retry`, `admin/conversions/jobs/[id]/retry`
- `admin/users/route.ts` GET/POST, `admin/classes/{*,[id]/{*,attributes/*}}`
- `admin/organizations/[id]/route.ts`, `admin/groups/[id]/{route.ts,members/route.ts}`

**SAML ACS는 의도적 skip** — IdP가 cross-origin POST한다는 설계, bridge token이 CSRF 대용. 코드 주석(`acs/route.ts:25-28`)에 명시. OK.

**MFA verify는 pre-session이라 의도적 skip** — bridge token이 proof. OK (`auth/mfa/verify/route.ts:25-28`).

**문제:** 위 47개는 인증된 사용자 세션 쿠키만으로 cross-site에서 POST/PATCH/DELETE 가능 → CSRF로 사용자 탈퇴, 비밀번호 리셋, 자료 삭제·결재 가능. **FIND-001 / P0**.

### 4.2 `assertSameOrigin` 자체 품질
- Origin 헤더 우선, Referer fallback (`csrf.ts:99-111`).
- `null` Origin 거부 (`csrf.ts:101`).
- `NEXT_PUBLIC_BASE_URL` 미설정 시 `x-forwarded-host`로 fallback — reverse proxy 환경 OK.
- 헬퍼 자체는 견고. 적용 미흡이 문제.

---

## 5. Rate limiting (R28 SEC-3)

| 점검 | 결과 | 근거 |
|------|------|------|
| 알고리즘 | OK | fixed-window + 인라인 GC (`rate-limit.ts:1-82`). |
| Bucket 분리 | OK | scope `api`/`chat`/`login`. |
| User key vs IP | OK | 인증 시 `user:${userId}`, 미인증 시 `ip:${ip}`. |
| **다중 인스턴스 분산** | NG (선언적) | 인메모리 Map. 다중 인스턴스에서 카운트 비공유 — 실효 한도 N배. `rate-limit.ts:3-5` 주석에 "Replace with Redis" 명시되어 있으나 미수행. **FIND-013 / Medium**. |
| Login route rate limit | NG | `RateLimitConfig.LOGIN`은 정의만 되어 있고 사용처 없음 (`grep` 결과). Auth.js의 Credentials provider authorize에서 `rateLimit` 호출 0건. 5회/분 제한이 in-app DB lockout로만 — 매분 쓸 수 있어 사전 brute force 약점. **FIND-014 / High**. |
| Retry-After 헤더 | OK | `api-helpers.ts:111-114` Retry-After + X-RateLimit-Reset. |

---

## 6. 파일 업로드 / 변환 / 다운로드

| 점검 | 결과 | 근거 |
|------|------|------|
| Size cap | 부분 OK | 2 GiB. 프롬프트의 200 MB와 불일치(§3 참고). |
| ClamAV INFECTED 차단 | OK | `lib/scan-guard.ts` + 5개 라우트 모두 `blockIfInfected` 호출 (file/preview.dxf/preview.pdf/print/thumbnail). |
| INFECTED 시 메시지 | 정보노출 미니멀 | `scan-guard.ts:56-58` 시그니처는 노출하나 사용자 가이드 차원으로 적정. |
| Path traversal | OK | `lib/storage/local.ts:243-268` `assertSafeKey` — `..` segment / 절대경로 / 백슬래시 / 비-ASCII 거부. SAFE_KEY 정규식 `[A-Za-z0-9_./-]+`. |
| Storage abstraction | OK | s3.ts에도 동일 `assertSafeKey` (`s3.ts:251-252`). |
| Content-Disposition + RFC 5987 | OK | `attachments/[id]/file/route.ts:90` legacy `filename="..."` + `filename*=UTF-8''<encoded>` 동시. lobbies/[id]/attachments/[attachmentId]/file도 동일. |
| 한글 파일명 처리 | OK | `encodeURIComponent(filename)`. |
| LibreDWG GPL subprocess 격리 | OK | dependencies grep 결과 LibreDWG/ezdxf/teigha 직접 import 0건. `apps/worker`만이 `dwg2dxf` CLI subprocess. |
| dev `/dev/ingest-dwg` 사용 | 안전 | middleware가 prod에서 차단(`middleware.ts:30-38`) + 확장자 화이트리스트. |

---

## 7. SQL Injection

| 사용처 | 안전성 | 근거 |
|------|------|------|
| Prisma ORM 99% | OK | 모든 일반 CRUD가 ORM. |
| `$queryRaw` template-literal | OK | `objects/route.ts:225,254` (검색 trgm/FTS). 모든 `${term}`이 자동 parameterized. |
| `$queryRaw(Prisma.sql\`\`)` | OK | `admin/pdf-extracts/route.ts:128-132` `Prisma.join(ids)` — 안전한 array bind. |
| `$queryRaw\`SELECT 1\`` | OK | `health/route.ts:72` 정적 쿼리. |
| `$executeRawUnsafe` | OK (test only) | `__tests__/integration/setup.ts`에만 — 운영 미영향. |
| `$queryRawUnsafe` | 0건 | grep 결과 운영 코드에 0건. |

**결론:** SQL 인젝션 취약점 0건.

---

## 8. XSS

| 사용처 | 안전성 | 근거 |
|------|------|------|
| `dangerouslySetInnerHTML` | 0건 | grep 결과 운영 코드 0건. 주석으로 "절대 사용하지 않는다" 명시 (`ObjectTable.tsx:535`). |
| ts_headline `<b>` 마커 | OK | `ObjectTable.tsx:534-560` 정규식 split + JSX `<mark>` 변환. plain string으로 처리되어 임의 HTML 무력화. |
| `innerHTML =` | 1건, 안전 | `lib/viewer/pdf-engine.ts:146` `tl.innerHTML = ''` — 빈 문자열로 클리어, 사용자 입력 무관. |
| 외부 링크 `target="_blank"` | OK | 3개 모두 `rel="noopener noreferrer"` 동반 (VulnerabilitiesTable.tsx:256, scans/page.tsx:863, pdf-extracts/page.tsx:770). |
| CSP `script-src` | 부분 | `'unsafe-inline' 'unsafe-eval'` 허용 — Next.js 14 RSC 제약. nonce 마이그는 Phase 2 예정 (`middleware.ts:91`). **FIND-015 / Medium**. |

---

## 9. 비밀 관리 (Secrets)

| 점검 | 결과 | 근거 |
|------|------|------|
| `.env` git tracked? | 안전 | `git ls-files | grep .env` → `.env.example`만 트래킹. `.gitignore`에 `.env`, `.env.local`, `.env.*.local` 명시. |
| `.env.example` placeholder | OK | `AUTH_SECRET=please-change-32-char-secret-here-xxxxxxxx`, `INTEGRATION_API_KEY=please-change-integration-api-key`. |
| CI placeholder 분리 | OK | `ci.yml:164` build 단계에서만 사용되는 placeholder, 런타임 미주입. |
| 로그 비밀 누출 | OK | `lib/audit.ts`는 `userId`/`action`/`metadata` JSON만 기록. password/token 필드 grep → 0건. |
| `console.error` 검사 | OK | SAML/Keycloak provisioning 실패만 `console.error`. 토큰/secret 자체 미출력. |
| `recoveryCodesHash` | OK | bcrypt-hashed array. 평문은 confirm 응답 1회만. |
| **TOTP secret 평문 저장** | NG | `User.totpSecret`이 base32 평문. DB 침해 시 모든 사용자 MFA 무력화. KMS 도입 권고 (FIND-008과 중복). |

---

## 10. 의존성 / 라이선스 (R36~R44 누적)

### 10.1 라이선스 정책 준수

| 패키지 | 라이선스 | 사용 방식 | 정책 |
|------|------|------|------|
| ClamAV | GPL | subprocess | OK (GPL 격리) |
| LibreDWG | GPL | subprocess (dwg2dxf CLI) | OK |
| `@node-saml/node-saml` | MIT | direct import | OK |
| `twilio` | Apache 2.0 | lazy import in worker | OK |
| `otpauth` | MIT | direct import | OK |
| `pdfjs-dist` | Apache 2.0 | direct import (worker) | OK |
| `@aws-sdk/*` | Apache 2.0 | direct import | OK |
| `next-auth` 5.0.0-beta.25 | MIT | direct import | OK (베타라 운영 시 안정 버전 추적 권고) |
| `@auth/prisma-adapter` 2.7.0 | MIT | direct import | OK |
| `bcryptjs` 2.4.3 | MIT | direct import | OK |
| `bullmq` 5.21.0 | MIT | direct import | OK |
| `dxf-viewer` 1.0.47 | MIT | direct import (legacy) | OK |
| `three` 0.169.0 | MIT | direct import | OK |
| `qrcode` 1.5.4 | MIT | direct import | OK |

**GPL/AGPL 직접 link 0건 재확인.** R45 catch-up DEVELOPER_GUIDE 11.12 명시 정책 준수.

### 10.2 `pnpm audit` 자동화
| 점검 | 결과 |
|------|------|
| CI step | 있음 — `.github/workflows/ci.yml:175-212` `audit` job (`continue-on-error: true`로 권고 단계). |
| 머지 차단 안 함 | 의도된 동작 (R40 도입 메모) |
| Admin 가시화 | 있음 — `/admin/security` 페이지 + `/api/v1/admin/security/audit` (R40+R41). 15분 in-mem cache + 즉시 재실행 POST. |
| 결과 기록 | 부분 — in-memory cache, 운영 인스턴스 재시작 시 소실. 변경 추세 트래킹 미흡. **FIND-016 / Low**. |

### 10.3 `next-auth` 5.x beta 사용
- `next-auth: "5.0.0-beta.25"` — beta 의존. 운영 시작 전 안정 release 추적 또는 변경 이력 monitoring 필요. **FIND-017 / Low**.

---

## 11. 로깅 / 감사 추적

| 액션 | 로깅 | 근거 |
|------|------|------|
| LOGIN_SUCCESS / FAIL | 부분 | Auth.js 자체 로깅 + `lastLoginAt` 갱신. 명시적 `LOGIN`/`LOGIN_FAIL` ActivityLog row 미작성. **FIND-018 / Medium**. |
| MFA_ENROLL / DISABLE / VERIFY_SUCCESS / FAIL | OK | `mfa/{enroll,disable,confirm,verify}/route.ts` 각자 logActivity. |
| USER_CREATE / UPDATE / DELETE / UNLOCK / PASSWORD_RESET / PASSWORD_EXPIRE | OK | `admin/users/{*,[id]/{*,unlock,reset-password,expire-password}}/route.ts` 모두 logActivity. |
| OBJECT_CHECKOUT / CHECKIN / RELEASE / DELETE / UPDATE / ATTACH / DETACH | OK | 각 라우트에서 logActivity. |
| APPROVE / REJECT | OK |  |
| FOLDER_PERMISSION_UPDATE | OK | `folders/[id]/permissions/route.ts`에서 before/after counts. |
| 다운로드 | NG | `attachments/[id]/file/route.ts`에서 logActivity 호출 0건. 보안등급 자료의 다운로드 추적 불가. **FIND-019 / High**. |
| 비밀번호 변경 (self) | NG | `me/password/route.ts`에 logActivity 0건. **FIND-020 / Medium**. |
| 비밀 노출 회피 | OK | 비밀번호/토큰 metadata에 미포함. |

---

## 12. 운영 / 배포

### 12.1 HTTP 보안 헤더 (`middleware.ts:104-123`)

| 헤더 | 값 | 평가 |
|------|------|------|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` | 합리적. unsafe-inline/eval은 Next.js 14 제약. |
| `X-Content-Type-Options` | `nosniff` | OK |
| `X-Frame-Options` | `DENY` | OK |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | OK |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | OK |
| **`Strict-Transport-Security`** | **누락** | HTTPS 강제. on-prem Nginx 4.4.5 단계에서 추가 가능하나 앱 layer에서도 명시 권고. **FIND-021 / Medium**. |

### 12.2 HTTPS 강제
- on-prem Nginx (WBS 4.4.5)에서 강제 가정. 앱 코드는 reverse proxy header (`x-forwarded-proto`)를 신뢰.
- `auth.config.ts`에 `trustHost` 명시 누락 — Next.js 14 + Auth.js v5에서 host header injection 우려. **FIND-009와 통합**.

### 12.3 백업 (R33 D-5)
- `BACKUP_CRON_ENABLED=0` default. 운영 시 1로 활성화 필요.
- POSTGRES + FILES 두 종류. retention 30일.
- `Backup` 모델 + `/admin/backups` 페이지 + `/admin/backups/[id]/download` 라우트 구현 완료.
- 백업 다운로드 인가는 admin gate만 — 백업 파일 자체 암호화는 미구현. **FIND-022 / Medium**.

---

## 13. 발견 사항 (Findings)

> 심각도: Critical(즉시 악용 + 데이터 유출) / High(제한 조건 악용) / Medium(방어심층화 위반) / Low(잠재 위험) / Info(기록).
> 우선순위: P0(머지 차단) / P1(빠른 후속 라운드) / P2(분기 내) / P3(백로그).

---

### [FIND-001] withApi 미적용으로 47개 mutating 라우트 CSRF + Rate limit 무방비

- **심각도:** Critical
- **영역:** CSRF / Rate limiting
- **위치:** `apps/web/app/api/v1/**/route.ts` 47개 (§4.1 목록 참고)
- **설명:** R28 SEC-1/SEC-3 도입 시 `withApi` wrapper를 만들었으나 신규 라우트(R29~R45)와 기존 라우트 양쪽 모두 일괄 적용이 누락됨. R29 catch-up 학습(`CLAUDE.md`)에도 명시되어 있으나 PR-by-PR 모니터링이 실효 없음.
- **영향:** 인증 사용자가 악성 사이트 방문 시, 해당 사이트에서 `<form>` 자동 submit 또는 `fetch(..., {credentials: 'include'})`로:
  - 본인 계정 비밀번호 변경 (`PATCH /me/password`)
  - 다른 사용자 계정 생성/삭제 (admin 세션) (`POST /admin/users`, `DELETE /admin/users/:id`)
  - 자료 강제 결재(approve), 자료 삭제, 첨부 삭제 등 모든 자료 mutating
  - 무제한 호출 → API rate limit 무력화 → DB I/O 폭주 / chat 비용 폭주
- **재현 경로:** `https://attacker.example/csrf.html` (인증된 admin 브라우저에서 방문)
  ```html
  <form action="https://drawing-mgmt.local/api/v1/admin/users" method="POST" enctype="text/plain">
    <input name='{"username":"backdoor","password":"x","fullName":"x","role":"SUPER_ADMIN","__":"' value='__"}' />
  </form>
  <script>document.forms[0].submit()</script>
  ```
  (실제로는 JSON body 강제가 어려울 수 있으나 `application/json` 우회 PoC는 성숙. 핵심은 Origin 검증 부재.)
- **권장 수정:**
  1. 모든 mutating route handler를 `export const POST = withApi({ rateLimit: 'api' }, async (req, ctx) => {...})`로 마이그.
  2. ESLint custom rule 또는 CI grep step으로 “mutating method without `withApi`” 회귀 가드.
  3. 또는 next.js middleware에서 `/api/v1/*` 전체에 origin 검증 + (rate limit은 wrapper 유지).
- **우선순위:** P0
- **상태:** Mitigated (R47) — 41개 mutating route에 `withApi({ rateLimit: 'api' })` wrap 적용. 의도적 skip 2건(saml/acs, mfa/verify) 제외 모든 mutating exports에 CSRF + Rate limit 가드. grep 검증 완료.

---

### [FIND-002] PATCH /api/v1/me/password가 R39 비밀번호 정책 우회 + history 미shift

- **심각도:** Critical
- **영역:** 인증 / Password lifecycle
- **위치:** `apps/web/app/api/v1/me/password/route.ts` (전체)
- **설명:** R39에서 신설한 `lib/password-policy.ts` 모듈(`validatePasswordWithHistory`, `buildPasswordChangeUpdate`, `isPasswordExpired`)이 어디에서도 import되지 않음(`grep` 0건). me/password 라우트는 R28 시점의 단순 검사(min 8자, current ≠ new)만 수행하고 `passwordHash`만 update — `passwordChangedAt`/`passwordPrev1Hash`/`passwordPrev2Hash` 갱신 누락.
- **영향:**
  1. 사용자가 `password123!`(복잡도 OK, 길이 ≥ 10 미충족)을 거쳐도 통과 (정책 8자 vs 명세 10자).
  2. 직전 비밀번호 재사용 검사 부재 → R39의 “직전 2개 비밀번호 금지” 규제 위반.
  3. `passwordChangedAt` 미갱신 → 만료 알림이 영원히 “방금 변경” 상태 → middleware에 `isPasswordExpired` 호출이 추가되어도 효과 0.
  4. 회사 보안 audit 시 “R39 정책 미시행” 규제 미준수.
- **재현 경로:**
  ```bash
  curl -X PATCH https://.../api/v1/me/password \
    -H "Cookie: <session>" -H "Content-Type: application/json" \
    -d '{"currentPassword":"...","newPassword":"abc12345"}'  # 8자 통과
  ```
- **권장 수정:**
  ```typescript
  import { validatePasswordWithHistory, buildPasswordChangeUpdate } from '@/lib/password-policy';
  // ...
  const user = await prisma.user.findUnique({ where: { id: session.id }, 
    select: { id: true, passwordHash: true, passwordPrev1Hash: true, passwordPrev2Hash: true } });
  const { ok: policyOk, errors } = await validatePasswordWithHistory(newPassword,
    [user.passwordHash, user.passwordPrev1Hash, user.passwordPrev2Hash]);
  if (!policyOk) return error(ErrorCode.E_VALIDATION, '비밀번호 정책 위반', 400, { errors });
  const newHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, 
    data: buildPasswordChangeUpdate(user, newHash) });
  await logActivity({ userId: user.id, action: 'PASSWORD_CHANGE', ipAddress, userAgent });
  ```
  + `withApi({ rateLimit: 'api' })`로 wrap.
- **우선순위:** P0
- **상태:** Mitigated (R47) — `validatePasswordWithHistory` + `buildPasswordChangeUpdate` 통합, `currentPassword` bcrypt 검증, `passwordChangedAt` 갱신, history shift 활성, `PASSWORD_CHANGE_SELF` ActivityLog 기록, `withApi({ rateLimit: 'api' })` wrap.

---

### [FIND-003] middleware demo-public 분기가 모든 첨부 파일을 익명 다운로드 허용

- **심각도:** High
- **영역:** Authentication / Authorization
- **위치:** `apps/web/middleware.ts:43-46`
- **코드:**
  ```typescript
  const isDemoPublic =
    pathname.startsWith('/viewer/') ||
    pathname === '/api/v1/health' ||
    pathname.startsWith('/api/v1/attachments/');
  ```
- **설명:** 데모 환경 편의로 viewer/health/attachments를 인증 미요구 패스로 두었음. 현재 attachment 라우트(`file`, `preview.dxf`, `preview.pdf`, `thumbnail`, `print`)는 `await auth().catch(() => null)`로 인증을 옵셔널 처리 + folder permission/securityLevel 검사 0건. `blockIfInfected`만 실행.
- **영향:** 운영 환경에서 attachment id를 추측(또는 검색 결과/링크 등을 통해 획득)한 익명 사용자가 보안등급 1 자료까지 다운로드 가능. 회사 도면 자산 유출 시나리오.
- **재현 경로:**
  ```
  GET /api/v1/attachments/<attachmentId>/file       (no cookie)
  → 200 OK + 본문 streaming
  ```
- **권장 수정:**
  1. `isDemoPublic`에서 `/api/v1/attachments/`를 제거 (운영 분기).
  2. 각 attachment 라우트의 `await auth().catch(() => null)`을 `requireUser()` (또는 동등한 401 throw)로 교체.
  3. `requireUser` 후 `loadAttachmentWithObject` + `canAccess(... 'VIEW' or 'DOWNLOAD')` 가드 추가.
  4. `/viewer/`는 별도 sample-only path로 분리하거나 prod에서만 차단(`NODE_ENV === 'production'` 가드).
- **우선순위:** P0
- **상태:** Mitigated (R47) — middleware `isDemoPublic`에서 `/api/v1/attachments/` 제거, `/viewer/`는 `NODE_ENV !== 'production'` 가드로 dev only. 신규 `apps/web/lib/attachment-auth.ts:requireAttachmentView` helper로 5개 라우트(file/preview.dxf/preview.pdf/thumbnail/print) 모두 requireUser + canAccess('VIEW') + INFECTED 가드 적용. `meta/route.ts`(dev fixture path)는 본 라운드 범위 외 — 후속 라운드 P3.

---

### [FIND-004] 평문 DEV 계정 6개가 운영 환경 변수 1개 차이로 활성화

- **심각도:** High
- **영역:** 인증
- **위치:** `apps/web/auth.ts:47-69`
- **설명:** in-memory 평문 계정 6개(`admin/admin123!`, `manager/manager123!` 등 SUPER_ADMIN 포함)가 `process.env.DEV_AUTH_FALLBACK !== 'false'`일 때만 비활성. 부정 명시(`!== 'false'`) 패턴이라 누락/오타 시 자동 활성. `.env.example`에 이 변수 자체가 없어 운영 가이드 누락 가능성 높음.
- **영향:** 운영 컨테이너에 `DEV_AUTH_FALLBACK=false` 미주입 시 `admin/admin123!`로 SUPER_ADMIN 즉시 로그인 → 모든 자료/사용자 접근.
- **재현 경로:**
  ```bash
  curl -X POST .../api/auth/callback/credentials \
    -d 'username=admin&password=admin123!&csrfToken=...'
  ```
- **권장 수정:**
  1. 단기: `auth.ts:57`을 `if (process.env.NODE_ENV === 'production' || process.env.DEV_AUTH_FALLBACK === 'false') return null;`로 강화 — 운영에서는 환경변수 없어도 차단.
  2. 중기: DEV_USERS 블록 자체를 `apps/web/lib/_dev-fixtures.ts`로 분리 + `if (process.env.NODE_ENV === 'production') throw new Error('DEV fixture imported in prod');`로 자기 가드.
  3. `.env.example`에 `DEV_AUTH_FALLBACK=false # 운영에서는 반드시 false` 명시.
- **우선순위:** P0
- **상태:** Mitigated (R47) — `findDevUser` 첫 줄에 `if (process.env.NODE_ENV === 'production') return null;` 추가. `.env.example`에 `DEV_AUTH_FALLBACK=false` + 운영 가이드 주석 명시. 운영 환경에선 환경 변수 누락에도 자동 차단.

---

### [FIND-005] middleware에서 isPasswordExpired 호출 누락 → 90일 만료 정책 사실상 비활성

- **심각도:** High
- **영역:** Password lifecycle
- **위치:** `apps/web/middleware.ts` (전체)
- **설명:** `lib/password-policy.ts:116-122`의 `isPasswordExpired`가 “middleware에서 사용된다”고 주석 명시하나 grep 결과 어디에서도 import되지 않음. 만료된 비밀번호 사용자가 `/change-password`로 강제 redirect되지 않음.
- **영향:** R39의 핵심 보안 약속(90일 만료) 미준수. SOX/ISO 27001 등 규제 audit 시 결격.
- **재현 경로:** 90일 이상 비밀번호 변경 안 한 계정으로 로그인 → 정상 메인 페이지 이동.
- **권장 수정:**
  ```typescript
  // middleware.ts에 추가 (단, edge runtime이므로 prisma import 불가 → JWT의 passwordChangedAt claim 추가 필요)
  // Option A: auth.config.ts session callback에서 token.passwordChangedAt = ... 주입
  // Option B: 첫 페이지 RSC에서 server-side check + redirect (간단, edge 영향 없음)
  ```
  편의상 Option B 권고. `apps/(main)/layout.tsx`에서 `getCurrentUser()` 후 `isPasswordExpired(user.passwordChangedAt)` true면 `redirect('/settings?tab=password&forced=1')`.
- **우선순위:** P1 (FIND-002 우선 해결 후)
- **상태:** Mitigated (R48) — Option B 채택. middleware에 `x-pathname` 헤더 forwarding 추가, `(main)/layout.tsx`에서 path 추출 후 `/settings|/logout` skip, 그 외 라우트는 `isPasswordExpired` true 시 `/settings?tab=password&forced=1`로 redirect.

---

### [FIND-006] reset-password 라우트가 비밀번호 정책을 검증하지 않음

- **심각도:** Medium
- **영역:** 인증 / Admin workflow
- **위치:** `apps/web/app/api/v1/admin/users/[id]/reset-password/route.ts:33-36`
- **설명:** `tempPassword` 8~32자 길이 검사만. 정책(`validatePasswordWithHistory`) 미호출. admin이 약한 비밀번호로 reset 가능.
- **영향:** admin이 실수 또는 의도적으로 `12345678`을 user에 설정 가능. 이후 user가 강제 변경하기 전까지 brute force 위험.
- **권장 수정:** `validatePassword(tempPassword)` 호출 또는 `generate=true`만 허용. + `passwordChangedAt`을 `new Date(0)`으로 설정해 즉시 만료 정책 trigger.
- **우선순위:** P1
- **상태:** Mitigated (R48) — `validatePassword(tempPassword)` 호출 추가, 통과 시 `passwordChangedAt: new Date(0)`로 즉시 만료 → 다음 로그인 시 FIND-005 가드가 `/settings?tab=password&forced=1`로 강제 이동.

---

### [FIND-007] SAML validateInResponseTo='never' — replay 공격 잠재 위험

- **심각도:** Medium
- **영역:** SAML SSO
- **위치:** `apps/web/lib/saml.ts:93`
- **설명:** SAML response의 `InResponseTo`를 검증하지 않음(`'never'`). 정상적인 IdP-initiated flow에서 동일 SAMLResponse를 도청한 공격자가 replay 시 ACS가 재처리할 수 있음. ttl 외에는 방지선 없음.
- **영향:** SAML 응답 유효 시간 내 replay → 동일 사용자 세션 발급. 영향 제한적이나 RFC 권고 미준수.
- **권장 수정:** Redis-backed cache provider (`@node-saml`의 `requestIdExpirationPeriodMs`)로 InResponseTo 검증 활성화. 운영 Redis가 이미 BullMQ용으로 있어 의존 추가 없음.
- **우선순위:** P2
- **상태:** Mitigated (R50) — 신규 `lib/saml-cache.ts`(node-saml v5 `CacheProvider` async 인터페이스 — `saveAsync`/`getAsync`/`removeAsync`) Redis 구현. saml.ts의 `getSamlConfig`가 REDIS_URL 있으면 `validateInResponseTo: 'always'` + `cacheProvider: samlCacheProvider`, 없으면 'never' fallback. TTL 10분, 키 `saml:rid:<id>`, `SET NX EX`로 first-write-wins.

---

### [FIND-008] User.totpSecret 평문 저장

- **심각도:** Medium
- **영역:** MFA at-rest 보호
- **위치:** `apps/web/prisma/schema.prisma:74-81`
- **설명:** TOTP secret이 base32 평문으로 저장. schema 주석에 “Should be encrypted at rest in production” 명시되어 있으나 미구현.
- **영향:** DB 또는 백업 침해 시 모든 사용자의 MFA 무력화 (공격자가 secret으로 코드 생성 가능).
- **권장 수정:** AES-256-GCM 또는 KMS-backed envelope encryption. 단기 mitigation으로 `crypto.scrypt`-derived key + AUTH_SECRET prefix로 암호화.
- **우선순위:** P2
- **상태:** Mitigated (R49) — 신규 `lib/crypto.ts`에서 AES-256-GCM + scrypt(AUTH_SECRET) + `v1:` prefix envelope 암호화. enroll route가 totpSecret 저장 직전 `encryptSecret`. `verifyTotp`가 `isEncryptedSecret` true일 때 `decryptSecret` 후 verify, false면 평문 그대로 — pre-R49 row backward-compat 유지(다음 enroll 시 자연 마이그레이션). 마이그 미발행(컬럼 변경 없음).

---

### [FIND-009] auth.config.ts에 trustHost / useSecureCookies 명시 누락

- **심각도:** Medium
- **영역:** 세션 보호 / 운영 헤더
- **위치:** `apps/web/auth.config.ts` (전체)
- **설명:** Next.js 14 + Auth.js v5 + reverse proxy 환경에서 `trustHost: true` 명시가 권고됨. 누락 시 Host header injection으로 콜백 URL 변조 위험.
- **영향:** 잘못 구성된 운영 환경에서 SAML/Keycloak 콜백 hijacking 가능.
- **권장 수정:**
  ```typescript
  export const authConfig = {
    trustHost: true,
    useSecureCookies: process.env.NODE_ENV === 'production',
    // ...
  } satisfies NextAuthConfig;
  ```
- **우선순위:** P1
- **상태:** Mitigated (R49) — `auth.config.ts`에 `trustHost: true` + `useSecureCookies: process.env.NODE_ENV === 'production'` 추가. Host header injection 가드.

---

### [FIND-010] ApiKey 모델 미구현 + INTEGRATION_API_KEY 라우트 매핑 부재

- **심각도:** Info
- **영역:** 외부 연계
- **위치:** `apps/web/prisma/schema.prisma:753-764`
- **설명:** `ApiKey` 모델 + `INTEGRATION_API_KEY` 환경변수 정의되었으나 실제 인증 라우트 매핑 0건.
- **영향:** 외부 연계 사용 시 단일 환경변수 비교 또는 미보호 가능성.
- **권장 수정:** 외부 연계 사용 단계 도래 시 `lib/api-key.ts`(prefix + bcrypt-hash secret) 도입.
- **우선순위:** P3 (현 단계에서 외부 연계 미사용)
- **상태:** Accepted Risk

---

### [FIND-011] 업로드 size cap 2 GiB — TRD/PRD 명세 200 MB와 불일치

- **심각도:** Low
- **영역:** 파일 업로드
- **위치:** `apps/web/lib/upload-store.ts` `MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024`
- **설명:** R31 chunked upload cap. 단일 사용자가 2 GiB까지 업로드 가능. DWG 도면 평균 사이즈(수~수십 MB) 대비 과다.
- **영향:** disk DoS — 1명이 storage root를 기가 단위로 채울 수 있음. 디스크 풀 시 다른 모든 업로드/변환/백업 차단.
- **권장 수정:** 200 MB(또는 500 MB)로 cap 조정 + 사용자별 quota 추가 검토.
- **우선순위:** P2
- **상태:** Mitigated (R49) — `MAX_UPLOAD_BYTES`를 `parseInt(process.env.ATTACHMENT_MAX_BYTES ?? String(200 * 1024 * 1024))`로 환경변수 driven 200 MB 기본. `.env.example`에 `ATTACHMENT_MAX_BYTES=209715200` 명시. 사용자별 quota는 별 라운드.

---

### [FIND-012] uploads/route.ts MIME 화이트리스트 부재

- **심각도:** Medium
- **영역:** 파일 업로드
- **위치:** `apps/web/app/api/v1/uploads/route.ts:34-46`
- **설명:** `mimeType: z.string().min(1).max(255)` — 어떤 MIME이든 허용. 후속 변환 워커는 MIME 무관 파일을 받아도 fail open(SKIPPED) 처리. ClamAV 스캔은 모든 파일 통과 후 작동하나 DB row가 무용한 attachment 누적.
- **영향:** PDF/DWG/DXF 외의 임의 파일 업로드 가능. 자료 메타데이터 조작 + 저장 공간 낭비.
- **권장 수정:** `enum(['application/pdf', 'image/vnd.dwg', 'image/x-dwg', 'application/dxf', 'image/png', ...])` 화이트리스트.
- **우선순위:** P2
- **상태:** Mitigated (R49) — 신규 `lib/mime-allowed.ts`에 ALLOWED_MIME_TYPES + `isAllowedMimeType` 헬퍼. uploads route는 zod `z.enum(ALLOWED_MIME_TYPES)`, multipart objects/[id]/attachments도 동일 가드. octet-stream은 fallback 허용 + ClamAV가 실 콘텐츠 검사.

---

### [FIND-013] Rate limit이 in-memory Map — 다중 인스턴스에서 카운트 비공유

- **심각도:** Medium
- **영역:** Rate limiting
- **위치:** `apps/web/lib/rate-limit.ts:14`
- **설명:** Map 기반 process-local 카운터. 다중 인스턴스(또는 vercel serverless cold start)에서 실효 한도 N배.
- **영향:** 분산 환경에서 brute force / API 폭주 방어 약화.
- **권장 수정:** `ioredis INCR + EXPIRE` 기반 redis-backed limiter. 의존 redis는 이미 BullMQ로 사용 중.
- **우선순위:** P2 (on-prem 단일 인스턴스에서는 영향 작음)
- **상태:** Mitigated (R50) — `lib/rate-limit.ts`에 IORedis 싱글톤 + `INCR`/`EXPIRE` 패턴 + ready 체크 + in-memory fallback. `rateLimit()`이 async로 전환되어 호출자(auth.ts:344, api-helpers.ts:91)도 `await` 적용. REDIS_URL 미설정 또는 ready 안 됐을 때 in-memory fallback로 backward-compat.

---

### [FIND-014] Auth.js Credentials authorize에 rate limit 미적용 → 사전 brute force

- **심각도:** High
- **영역:** 인증
- **위치:** `apps/web/auth.ts:218-314`
- **설명:** `RateLimitConfig.LOGIN`(5/min)이 정의만 되어 있고 사용처 0건. 실패 lockout(5회/30분)은 DB column 기반이므로 정확히 5번째 시도까지 통과. 자동화 도구로 분당 5회 × 다중 ip × 다중 username으로 사전 공격 가능.
- **영향:** username + 약한 비밀번호 colocation으로 사전 brute force 시도 가능. Credentials provider authorize는 CredentialsSignin error만 반환하므로 client에서 retry.
- **권장 수정:** authorize 첫 줄에서 `rateLimit({ key: \`login:ip:${ip}\`, ...RateLimitConfig.LOGIN })` + 실패 시 throw. `extractRequestMeta`로 ip 확보. 또는 middleware에서 `/api/auth/callback/credentials` 경로 한정 limiter 추가.
- **우선순위:** P1
- **상태:** Mitigated (R47) — `authorize(raw, request)`의 첫 줄에 IP 기반 5/min rate limit 추가, 초과 시 `LoginRateLimitedError(code='rate_limited')` throw. login-form mapErrorCode FE 매핑은 다음 라운드 polish.

---

### [FIND-015] CSP에 'unsafe-inline' + 'unsafe-eval' 잔존

- **심각도:** Medium
- **영역:** XSS 방어심층화
- **위치:** `apps/web/middleware.ts:106`
- **설명:** Next.js 14 RSC payload + dev mode eval 제약으로 잔존. nonce 마이그가 Phase 2로 큐잉.
- **영향:** XSS 1차 방어 라인 약화. 다만 운영 코드에서 `dangerouslySetInnerHTML` 0건 확인되어 실효 위험은 낮음.
- **권장 수정:** Next.js 14의 nonce script-src 도입(`'nonce-...' 'strict-dynamic'`).
- **우선순위:** P2
- **상태:** Open

---

### [FIND-016] pnpm audit 결과 trend 트래킹 미흡

- **심각도:** Low
- **영역:** 의존성 보안
- **위치:** `apps/web/app/api/v1/admin/security/audit/route.ts`
- **설명:** in-memory 캐시만, 인스턴스 재시작 시 소실. 신규 advisory 등장 추세를 비교할 baseline 없음.
- **권장 수정:** `SecurityAuditSnapshot` 모델 + 일일 cron snapshot (BullMQ repeatable job 패턴 재사용).
- **우선순위:** P3
- **상태:** Open

---

### [FIND-017] next-auth 5.0.0-beta.25 베타 의존

- **심각도:** Low
- **영역:** 의존성
- **위치:** `apps/web/package.json:64`
- **설명:** Auth.js v5는 2026-04 시점 stable beta 단계. 마이너 변경 가능성 + CVE 추적 부담.
- **권장 수정:** stable release 도래 시 즉시 마이그. 현재는 변경 이력 monitoring 충분.
- **우선순위:** P3
- **상태:** Accepted Risk

---

### [FIND-018] 로그인 성공/실패 ActivityLog row 미작성

- **심각도:** Medium
- **영역:** 감사 추적
- **위치:** `apps/web/auth.ts` (Credentials authorize)
- **설명:** `lastLoginAt` 갱신 + `failedLoginCount` 갱신은 있으나 `ActivityLog`에 `LOGIN_SUCCESS`/`LOGIN_FAIL` row가 없음. 보안 사고 후 forensics에 username + ipAddress + userAgent 추적 어려움.
- **권장 수정:** authorize 성공/실패 분기에 logActivity 호출 추가. ip/UA는 authorize 함수가 받는 `req`에서 추출(현재는 `req` 미수신 — Auth.js v5 callback signature 검토 필요).
- **우선순위:** P1
- **상태:** Mitigated (R48) — `authorize(raw, request)` 두 번째 인자에서 `extractRequestMeta`로 ip/UA 확보. 모든 분기(password/samlBridge/mfaBridge/rate_limited/mfa_required/account_locked)에서 `LOGIN_SUCCESS` 또는 `LOGIN_FAIL`(metadata.username/reason 포함) 기록. ActionType `LOGIN_SUCCESS` enum/label 추가.

---

### [FIND-019] 첨부 다운로드 ActivityLog 미기록

- **심각도:** High
- **영역:** 감사 추적
- **위치:** `apps/web/app/api/v1/attachments/[id]/file/route.ts`, preview.{dxf,pdf}, print, thumbnail
- **설명:** 다운로드/프린트 액션이 ActivityLog에 기록되지 않음. 회사 자산인 도면이 누구에게 언제 다운로드됐는지 추적 불가. 사고 발생 시 책임 소재 불명.
- **권장 수정:** 5개 라우트에서 `logActivity({ action: 'OBJECT_DOWNLOAD'/'OBJECT_PRINT'/'OBJECT_PREVIEW', objectId, metadata: { attachmentId, filename } })` 추가.
- **우선순위:** P1
- **상태:** Mitigated (R48) — file/preview.dxf/preview.pdf/print 4개 라우트에 logActivity 추가(`OBJECT_DOWNLOAD`/`OBJECT_PREVIEW`/`OBJECT_PRINT`). thumbnail은 명시적 skip(list 렌더 폭주 가드). preview.pdf는 no-Range read에만 기록(PDF.js Range chunk 폭주 회피). file은 GET만 기록(HEAD skip). ActionType enum/label 추가.

---

### [FIND-020] me/password 변경 ActivityLog 미기록

- **심각도:** Medium
- **영역:** 감사 추적
- **위치:** `apps/web/app/api/v1/me/password/route.ts`
- **설명:** 비밀번호 변경(self) 감사 row 없음.
- **권장 수정:** logActivity({ action: 'PASSWORD_CHANGE_SELF' }) 추가. FIND-002 수정과 함께.
- **우선순위:** P1 (FIND-002와 묶음)
- **상태:** Open

---

### [FIND-021] HSTS 헤더 누락

- **심각도:** Medium
- **영역:** HTTPS 강제
- **위치:** `apps/web/middleware.ts:117-122`
- **설명:** `Strict-Transport-Security` 미포함. on-prem Nginx(WBS 4.4.5)에서 추가 가능하나 앱 layer에서도 명시 권고.
- **권장 수정:** `'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'` 추가 (NODE_ENV === 'production' 분기).
- **우선순위:** P2
- **상태:** Mitigated (R49) — middleware의 보안 헤더 set 블록에 `if (process.env.NODE_ENV === 'production') res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');` 추가.

---

### [FIND-022] 백업 파일 자체 암호화 없음

- **심각도:** Medium
- **영역:** Data at-rest
- **위치:** `apps/worker` 백업 워커 + `Backup` 모델
- **설명:** pg_dump/tar 출력이 평문. 백업 디스크 침해 시 모든 자료 + 사용자 비밀번호 hash 노출.
- **권장 수정:** GPG 또는 openssl AES-256으로 백업 파일 암호화 + key를 별도 보관.
- **우선순위:** P2
- **상태:** Mitigated (R50) — `apps/worker/src/backup.ts`가 `BACKUP_ENCRYPTION_KEY` 설정 시 pg_dump/tar 출력을 openssl `aes-256-cbc -salt -pbkdf2 -iter 100000` 파이프로 통과시키고 `.enc` 접미사 부여. 미설정 시 평문(R33 호환). prune은 prefix 매칭이라 `.enc`와 양립. DEVELOPER_GUIDE.md §10.6에 복구 절차 1줄 코드 블록 추가.

---

## 14. 운영 시작 전 P0/P1 권고

### P0 (머지 차단 / 운영 시작 차단) — **R47에서 모두 Mitigated**

1. ~~**FIND-001**~~ — ✅ **R47 Mitigated.** 41개 mutating route에 `withApi({ rateLimit: 'api' })` wrap 적용. 의도적 skip 2건(saml/acs, mfa/verify) 제외 누락 0건 grep 검증.
2. ~~**FIND-002**~~ — ✅ **R47 Mitigated.** me/password를 `validatePasswordWithHistory` + `buildPasswordChangeUpdate` 사용으로 재작성. `currentPassword` bcrypt 검증, history shift, `passwordChangedAt` 갱신, ActivityLog `PASSWORD_CHANGE_SELF` 기록 포함. 단위 테스트는 후속.
3. ~~**FIND-003**~~ — ✅ **R47 Mitigated.** middleware `isDemoPublic`에서 attachments 제거, `/viewer/`는 `NODE_ENV !== 'production'` dev only. `lib/attachment-auth.ts` helper 신설 + 5개 라우트(file/preview.dxf/preview.pdf/thumbnail/print) 모두 가드. `meta/route.ts` 잔여(P3 후속).
4. ~~**FIND-004**~~ — ✅ **R47 Mitigated.** `findDevUser` 첫 줄에 `if (process.env.NODE_ENV === 'production') return null;` 추가. `.env.example`에 `DEV_AUTH_FALLBACK=false` 명시.

### P1 (운영 시작 직후 빠른 후속 라운드) — **R48까지 Mitigated, R49에서 잔여 1건 마무리**

1. ~~**FIND-005**~~ — ✅ R48 Mitigated.
2. ~~**FIND-006**~~ — ✅ R48 Mitigated.
3. ~~**FIND-009**~~ — ✅ **R49 Mitigated.** `auth.config.ts`에 trustHost + useSecureCookies 명시.
4. ~~**FIND-014**~~ — ✅ R47 Mitigated. R48에서 FE 매핑 추가.
5. ~~**FIND-018**~~ — ✅ R48 Mitigated.
6. ~~**FIND-019**~~ — ✅ R48 Mitigated.
7. ~~**FIND-020**~~ — ✅ R47 Mitigated.

**P1 모두 Mitigated.** R49까지 P0 + P1 전부 해소.

### P2 처리 현황 (R49 + R50)

R49 + R50에서 P2 묶음 처리:
- ~~**FIND-007**~~ SAML InResponseTo Redis 캐시 ✅ (R50)
- ~~**FIND-008**~~ TOTP secret AES-256-GCM 암호화 ✅ (R49)
- ~~**FIND-011**~~ 업로드 cap 200 MB ✅ (R49)
- ~~**FIND-012**~~ MIME 화이트리스트 ✅ (R49)
- ~~**FIND-013**~~ Rate limit Redis-backed ✅ (R50)
- ~~**FIND-021**~~ HSTS 헤더 ✅ (R49)
- ~~**FIND-022**~~ 백업 파일 암호화 ✅ (R50)

**잔여 P2: FIND-015(CSP nonce 마이그)만.** RSC 영향 커서 별 라운드(또는 Phase 2)로 이연. `dangerouslySetInnerHTML` 0건 확인되어 실효 위험 낮음.

P3는 본 보고서를 백로그(`docs/잔여작업.md`)로 옮겨 분기 단위로 처리한다.

---

## 15. 변경 이력

| 날짜 | 변경 | 사유 |
|------|------|------|
| 2026-04-28 | R46 — R28~R45 누적 보안 감사 초판 작성. 22 findings (Critical 2 / High 5 / Medium 9 / Low 4 / Info 2). PASS-WITH-CAVEATS 등급. | WBS 4.4.3 운영 시작 전 P0 산출물 |
| 2026-04-28 | R47 — P0 4건(FIND-001/002/003/004) + FIND-014 Mitigated. backend single round로 41 mutating routes withApi wrap, me/password 정책 통합, middleware isDemoPublic 정리 + attachment helper, DEV_AUTH_FALLBACK NODE_ENV 강화, login rate limit 추가. typecheck/build pass. 운영 시작 차단 사유 해소. | P0 fix |
| 2026-04-28 | R48 — P1 5건(FIND-005/006/018/019 + meta dev path) Mitigated + FE rate_limited 한국어 매핑. backend가 (main)/layout.tsx 만료 가드, admin reset-password validatePassword 검증, auth.ts authorize 전 분기 LOGIN_SUCCESS/FAIL 감사, 4개 attachment 라우트(thumbnail skip) OBJECT_DOWNLOAD/PREVIEW/PRINT 감사, meta/route requireUser 추가. frontend가 login-form mapErrorCode에 rate_limited case 한 줄 추가. typecheck/build pass. 잔여 P1=FIND-009만. | P1 cleanup |
| 2026-04-28 | R49 — P1 잔여(FIND-009) + P2 묶음 4건(FIND-008/011/012/021) Mitigated. backend single round로 (1) auth.config.ts trustHost+useSecureCookies (2) middleware에 prod-only HSTS (3) MAX_UPLOAD_BYTES env-driven 200MB + .env.example 추가 (4) 신규 lib/mime-allowed.ts ALLOWED_MIME_TYPES + uploads/multipart 화이트리스트 (5) 신규 lib/crypto.ts AES-256-GCM envelope + scrypt(AUTH_SECRET) + v1 prefix → enroll route encryptSecret + verifyTotp 자동 decrypt + backward-compat 평문 fallback. 11 files +322/-13. typecheck/build pass. **P0 + P1 전부 해소.** 잔여 P2 = FIND-007/013/015/022. | P1잔여 + P2 묶음 |
| 2026-04-28 | R50 — P2 묶음 3건(FIND-013/022/007) Mitigated. backend single round로 (1) `lib/rate-limit.ts` IORedis 싱글톤 + INCR/EXPIRE + ready 체크 + in-memory fallback, `rateLimit()` async 전환 + 호출자(auth.ts/api-helpers.ts) await (2) `apps/worker/src/backup.ts`에서 `BACKUP_ENCRYPTION_KEY` 있으면 openssl aes-256-cbc -pbkdf2 파이프 + `.enc` 접미사, 미설정 시 평문 (3) 신규 `lib/saml-cache.ts` node-saml v5 CacheProvider Redis 구현 → `validateInResponseTo: REDIS_URL ? 'always' : 'never'`, TTL 10분, SET NX EX. 8 files +509/-46. typecheck/build pass. DEVELOPER_GUIDE §10.6에 백업 복구 절차. **잔여 P2 = FIND-015(CSP nonce)만**, RSC 영향 커서 Phase 2로 이연. | 잔여 P2 묶음 |
