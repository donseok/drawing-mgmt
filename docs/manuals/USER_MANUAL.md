---
문서: 사용자 매뉴얼 (User Manual)
대상 시스템: drawing-mgmt — 동국씨엠 도면관리시스템
대상 버전: R35 시점 main
작성일: 2026-04-27
대상 main HEAD: a045772 이후
대상 페르소나: 슈퍼관리자 / 관리자 / 설계자 / 열람자 / 협력업체
산출물 라운드: R35 (DOC-2 1차 본문)
연관 outline: docs/_specs/r32_manuals_outline.md §A
---

# drawing-mgmt 사용자 매뉴얼

> 본 매뉴얼은 동국씨엠 도면관리시스템(drawing-mgmt)의 일반 사용자(설계자/열람자/협력업체) 및
> 관리자(슈퍼관리자/관리자) 모두를 대상으로 한다.
>
> AutoCAD 미설치자도 모든 도면을 브라우저만으로 조회·인쇄할 수 있도록 설계되었다.
>
> 화면 캡처는 본 1차 본문에서 placeholder로 표시된다(`![스크린샷: ...](placeholder)`).
> 이후 라운드에서 실제 PNG로 교체될 예정.

---

## 챕터 0. 시작하기 (Onboarding)

### 0.1 시스템 개요

drawing-mgmt는 냉연강판 사내 도면(DWG/DXF/PDF/이미지)을 통합 관리하기 위한 사내 웹 시스템이다.
다음 다섯 가지 페르소나가 사용한다.

| 페르소나 | 인원 | 주요 역할 |
|---|---|---|
| 슈퍼관리자 | 1~2명 | 전 영역 관리자(시스템 설정, 권한, 백업) |
| 관리자 | 2~3명 | 폴더/조직/사용자/결재선 관리 |
| 설계자 | 10~15명 | 도면 등록, 체크아웃/체크인, 결재 상신, 개정 |
| 열람자 | 5~10명 | 도면 검색·조회·인쇄 |
| 협력업체 | 5사 | 트랜스미털/로비함을 통한 도면 수신·확인 |

### 0.2 권장 환경

- **브라우저:** Chrome 또는 Edge 최신 버전 (Internet Explorer 미지원)
- **화면 해상도:** 1280×768 이상 (1920×1080 권장)
- **OS:** Windows 10/11, macOS 12 이상
- **AutoCAD:** **미설치 상태에서도 모든 도면 조회 가능** (PRD §2.2 핵심 가치)

### 0.3 로그인 페이지로 이동

브라우저 주소창에 회사 내부 URL(예: `https://drawmgmt.your-company.local`)을 입력한다.
로그인 화면으로 자동 redirect 된다.

![스크린샷: 시스템 시작 화면(/) 또는 로그인 페이지](placeholder)

### 0.4 자주 묻는 문제

- **Q.** Internet Explorer에서 동작하지 않는다.
  **A.** IE는 공식 지원 대상이 아니다. Chrome 또는 Edge를 사용한다.
- **Q.** AutoCAD가 없는데 도면을 볼 수 있나?
  **A.** **있다.** 시스템이 자동으로 DWG → DXF/PDF로 변환하여 브라우저 자체 뷰어로 표시한다.

### 0.5 코드/페이지 hint (관리자/개발자용)

- 랜딩 페이지: `apps/web/app/page.tsx`
- 페르소나 정의: `docs/PRD.md` §2.3

---

## 챕터 1. 로그인 / 비밀번호 / 사용자 설정

### 1.1 진입점

| 동선 | 위치 |
|---|---|
| 로그인 페이지 | `/login` |
| 사용자 설정 | 헤더 우상단 사용자 드롭다운 → `설정` (또는 직접 URL `/settings`) |
| 로그아웃 | 헤더 우상단 사용자 드롭다운 → `로그아웃` |
| 키클락(SSO) | `/login` 페이지의 `사내 SSO 로그인` 버튼 (운영 환경에서 활성 시) |

![스크린샷: 로그인 페이지(/login) 전체](placeholder)

### 1.2 주요 액션

#### 1.2.1 일반 로그인

1. `이메일(또는 사번)` 입력
2. `비밀번호` 입력
3. `[로그인]` 버튼 클릭

비밀번호 정책 (PRD §4.1 FR-AUTH-03)

- 최소 10자
- 영문/숫자/특수문자 모두 포함
- 본인 정보(사번·생일 등) 사용 금지

#### 1.2.2 SSO 로그인 (운영 환경에서 활성화된 경우)

`사내 SSO 로그인` 버튼 클릭 → Keycloak 로그인 페이지로 이동 → 사내 계정으로 인증.

> 시스템 환경 변수 `NEXT_PUBLIC_KEYCLOAK_ENABLED=1`인 경우에만 표시된다(`.env.example` 참조).

#### 1.2.3 사용자 설정 (`/settings`)

- **비밀번호 변경:** `현재 PW` → `새 PW` → `새 PW 확인` → `[변경]`
- **서명 이미지 업로드:** 결재 시 본인 서명으로 사용 (jpg/png, 1MB 이내 권장)
- **알림 환경설정:** 이메일 알림 on/off 등

![스크린샷: 사용자 설정 페이지(/settings)](placeholder)

### 1.3 저장/완료 시그널

| 액션 | 신호 |
|---|---|
| 로그인 성공 | `/`(홈) 또는 마지막 방문 페이지로 redirect, 헤더 우상단에 사용자명 표시 |
| 비밀번호 변경 성공 | 토스트 "비밀번호가 변경되었습니다" + 자동 로그아웃 → 재로그인 유도 |
| 5회 연속 로그인 실패 | "30분간 잠금" 안내 (FR-AUTH-04) |
| 서명 업로드 성공 | 토스트 "서명이 업데이트되었습니다" |

### 1.4 자주 묻는 문제 / 권한 제약

- **계정이 잠겼을 때:** 관리자에게 잠금 해제를 요청한다. 관리자는 `/admin/users` 페이지의
  잠금 해제 다이얼로그(`UserUnlockDialog`)에서 처리한다.
- **비밀번호를 잊었을 때:** 관리자에게 리셋 요청. 관리자는 `<PasswordResetDialog>`에서
  자동 발급되는 평문을 **1회만** 사용자에게 전달한다(이후 화면 닫으면 복구 불가, R29 패턴).
- **서명 이미지가 업로드되지 않을 때:** 확장자(jpg/png) 및 1MB 이내인지 확인.

### 1.5 코드/페이지 hint

- 로그인 페이지: `apps/web/app/(auth)/login/login-form.tsx`
- Keycloak 버튼: `apps/web/app/(auth)/login/keycloak-button.tsx`
- 사용자 설정: `apps/web/app/(main)/settings/page.tsx`
- 비밀번호 변경 API: `PATCH /api/v1/me/password`
- 서명 업로드 API: `PATCH /api/v1/me/signature`
- 단축키 도움말: `apps/web/components/ShortcutsDialog.tsx` (`?` 단축키)

---

## 챕터 2. 자료 검색 (전체 / 유형별 / 결과 내 / 이력)

### 2.1 진입점

| 동선 | 위치 |
|---|---|
| 검색 페이지 | `/search` |
| 글로벌 검색바 | 헤더 중앙 (`⌘K` 단축키로 명령 팔레트 호출, `/`로 인라인 검색 포커스) |
| 폴더 트리에서 폴더 선택 | 좌측 사이드바 → 자동으로 `/search?folderId=...` 진입 |

![스크린샷: 자료 검색 페이지(/search) 전체 — 좌측 폴더, 가운데 결과 테이블, 우측 미리보기](placeholder)

### 2.2 주요 액션

#### 2.2.1 검색바 (FR-SEARCH-01)

다음 필드를 통합 검색한다.

- 도면번호 (number)
- 자료명 (name)
- 자료설명 (description)

#### 2.2.2 자료유형(Class) 필터 (FR-SEARCH-02)

자료유형을 선택하면 해당 유형 고유의 속성 기반 세부검색 폼이 활성화된다.

#### 2.2.3 결과 내 검색 (FR-SEARCH-03)

검색 결과 위 토글 `결과 내 검색`을 ON 하면, 다음 입력은 현재 결과 집합 내부에서만 검색된다.

#### 2.2.4 하위 폴더 포함 토글 (FR-SEARCH-04)

폴더를 선택했을 때 하위 폴더의 자료까지 포함할지 여부.

#### 2.2.5 정렬 (FR-SEARCH-05)

테이블 헤더 컬럼을 클릭해 오름/내림 정렬. `SortMenu` 컴포넌트로 추가 옵션 노출.

#### 2.2.6 잠금/상태 표기 (FR-SEARCH-06)

| 표기 | 의미 |
|---|---|
| `🔒` | 다른 사용자가 체크아웃 중 |
| `📋` | 결재 진행 중 |
| 색 뱃지 | 상태 라벨 (부록 B 참고) |

#### 2.2.7 행 호버 미리보기 (R29 V-INF-6)

결과 행 위에 마우스 호버 → 우측 패널에 thumbnail 표시.

#### 2.2.8 행 더블클릭 / `Enter`

`/objects/[id]` 자료 상세로 이동.

#### 2.2.9 행 액션 메뉴 `⋯` (R31 P-1)

- `미리보기`
- `다운로드` (download 권한 필요)
- `인쇄` (print 권한 필요)
- `즐겨찾기 담기`

#### 2.2.10 버전 이력 보기 (FR-SEARCH-09)

자료 상세 → `이력` 탭 → `<RevisionTree>` (revision tree 시각화).

### 2.3 저장/완료 시그널

- **결과 카운트:** 우상단 표기 (예: "전체 123건 / 표시 50건")
- **빈 결과:** `<EmptyState>` + `검색어 초기화` 버튼
- **캐시:** TanStack Query — 같은 검색어 재진입 시 즉시 표시(<500ms)
- **Excel 내보내기:** 우상단 `Excel` 버튼 (FR-SEARCH-10)

### 2.4 자주 묻는 문제 / 권한 제약

- **결과가 안 나옴:** 폴더 권한, 보안등급 부족 시 행 자체가 숨겨진다. 폴더 권한 매트릭스를
  관리자에게 확인 요청.
- **부분 일치 검색:** Postgres `pg_trgm` 트라이그램 인덱스로 한글 부분 일치 검색 지원
  (FR-SEARCH-07; `apps/web/prisma/migrations/manual/0001_pgvector.sql`에서 GIN 인덱스 생성).
- **검색 속도:** 10만 건 기준 1초 SLA (PRD §5.1).

### 2.5 코드/페이지 hint

- 검색 페이지: `apps/web/app/(main)/search/page.tsx`
- 결과 테이블: `apps/web/components/object-list/ObjectTable.tsx`
- 미리보기 패널: `apps/web/components/object-list/ObjectPreviewPanel.tsx`
- 미리보기 thumbnail API: `GET /api/v1/attachments/[id]/thumbnail`
- 검색 API: `GET /api/v1/search` (`apps/web/app/api/v1/search/route.ts`)
- 글로벌 검색바: `apps/web/components/layout/`(헤더)
- Revision tree: `apps/web/components/RevisionTree.tsx`

---

## 챕터 3. 자료 등록 (단건 / 일괄)

### 3.1 진입점

| 동선 | 위치 |
|---|---|
| 단건 등록 | 폴더 트리에서 폴더 선택 → 우상단 `[+ 신규등록]` 버튼 |
| 일괄 등록 | 관리자 한정. `<BulkCreateDialog>` 또는 `/admin/bulk-import` |
| 단축키 | (정의되어 있는 단축키는 `ShortcutsDialog.tsx` 참고) |

### 3.2 주요 액션

#### 3.2.1 단건 등록 폼 (`<NewObjectDialog>`)

| 필드 | 비고 |
|---|---|
| 도면번호 (number) | 자동발번 ON 시 readonly. OFF 시 수동 입력 (PRD §6 발번 규칙) |
| 자료유형 (Class) | 폴더의 기본 Class 자동 선택. 변경 시 속성 폼 재생성 |
| 자료명 (name) | 필수 |
| 자료설명 (description) | 옵션 |
| 보안등급 (securityLevel) | 1~5 (PRD §7) |
| 첨부파일 | 드래그 & 드롭 다중 업로드. 첫 파일 자동 마스터(M) 표기 (FR-LC-09) |
| 연결문서 | 다른 자료를 참조 링크로 연결 (옵션) |

`[등록]` 클릭 → 자료 생성 → 자동으로 `/objects/[id]` 이동.

#### 3.2.2 청크 업로드 (R31 V-INF-2)

5MB 이상 파일은 자동으로 청크로 분할 업로드된다. 사용자 액션은 0 — 진행률 progress bar에
"5MB 청크로 N분할 업로드" 안내가 노출된다.

#### 3.2.3 일괄 등록 (`<BulkCreateDialog>`)

1. Excel 템플릿 다운로드 → 메타 입력
2. DWG + Excel을 함께 드래그
3. 매핑 미리보기 확인
4. `[등록]` 클릭

각 행 단위로 등록되며, 진행률 토스트(예: 23/100 완료)가 표시된다. 실패 항목은 분리 리포트로 제공.

![스크린샷: 신규 등록 다이얼로그 — 자료 메타 입력 + 첨부 드래그 영역](placeholder)

### 3.3 저장/완료 시그널

| 액션 | 신호 |
|---|---|
| 단건 등록 성공 | 토스트 "등록되었습니다" + `/objects/[id]`로 redirect |
| 상태 뱃지 | `NEW` (slate; 부록 B) |
| 변환 큐 적재 | 우상단 `<NotificationBell>` 알림 "변환 시작" → 완료 시 다시 알림 |
| 일괄 등록 진행 | 진행률 토스트 + 실패 분리 리포트 |

### 3.4 자주 묻는 문제 / 권한 제약

- **`[+ 신규등록]` 버튼이 비활성:** 폴더 `EDIT_FOLDER` 권한 필요 (FR-FOLDER-03).
  `apps/web/lib/permissions.ts`의 `canAccess` 평가에서 거부됨.
- **마스터 파일을 다른 첨부로 바꾸기:** 첨부 행에서 `[M]` 토글 (FR-LC-09).
- **DWG가 변환되지 않음:** 변환 큐에서 처리 중이거나 실패. 관리자는 `/admin/conversions`에서
  상태 확인.
- **일괄 등록 매핑 오류:** 각 행에 검증 결과(rose 강조)가 표시된다. Excel 템플릿 헤더와
  Class 속성을 다시 확인.

### 3.5 코드/페이지 hint

- 단건 등록 다이얼로그: `apps/web/components/object-list/NewObjectDialog.tsx`
- 일괄 등록 다이얼로그: `apps/web/components/object-list/BulkCreateDialog.tsx`
- 청크 업로드 클라이언트: `apps/web/lib/chunk-upload.ts`
- 청크 진행률 컴포넌트: `<ChunkProgressBar>`
- 첨부 업로드 다이얼로그: `apps/web/components/object-list/AttachmentUploadDialog.tsx`
- 발번 규칙: `apps/web/lib/db-helpers.ts` (`MAX(number)+1` per (folderCode, year))
- 변환 큐 모니터: `apps/web/app/(main)/admin/conversions/page.tsx` (R28)
- 청크 업로드 API: `POST /api/v1/uploads`, `PATCH /api/v1/uploads/[id]`,
  `POST /api/v1/uploads/[id]/finalize`

---

## 챕터 4. 자료 라이프사이클 (체크아웃·체크인·개정·삭제·복원)

### 4.1 상태 머신

```
NEW          ─ checkout       ─→ CHECKED_OUT
NEW          ─ checkin        ─→ CHECKED_IN
CHECKED_IN   ─ checkout       ─→ CHECKED_OUT
CHECKED_OUT  ─ checkin        ─→ CHECKED_IN
CHECKED_OUT  ─ cancelCheckout ─→ CHECKED_IN  (본인 잠금만 가능, 버전 +0 유지)
CHECKED_IN   ─ release        ─→ IN_APPROVAL
IN_APPROVAL  ─ approve        ─→ APPROVED
IN_APPROVAL  ─ reject         ─→ CHECKED_IN
APPROVED     ─ newRevision    ─→ CHECKED_OUT
*            ─ delete         ─→ DELETED
DELETED      ─ restore        ─→ NEW (이전 상태)
```

> 출처: `apps/web/lib/state-machine.ts` 헤더 주석. **추측 금지** — 본 표는 코드와 1:1
> 동기화되어야 한다 (CLAUDE.md R2 학습).

### 4.2 진입점

| 동선 | 위치 |
|---|---|
| 자료 상세 | `/objects/[id]` |
| 폐기함 | 좌측 트리 `폐기함` 노드 또는 `/admin/[section]?section=trash` |

![스크린샷: 자료 상세(/objects/[id]) — 좌측 뷰어, 우측 메타/이력/첨부 탭](placeholder)

### 4.3 주요 액션

#### 4.3.1 체크아웃 (FR-LC-02)

자료 상세 → `[수정 시작]` (또는 `[체크아웃]`) → 상태 → `CHECKED_OUT`(amber).
다른 사용자에게는 `🔒 체크아웃중 (홍길동)`으로 표시.

#### 4.3.2 수정 (FR-LC-03)

체크아웃 상태에서 메타·첨부·연결문서 변경 가능. 자동 저장 또는 `[저장]` 버튼.

#### 4.3.3 체크인

`[체크인]` 클릭 → 상태 → `CHECKED_IN`(sky), 버전 +0.1 (마이너 +1).

> **본인 잠금만 체크인 가능** (`state-machine.ts` `NOT_LOCKED_BY_USER` 가드).

#### 4.3.4 체크아웃 취소

`[체크아웃 취소]` → 상태 → `CHECKED_IN` (버전 변경 없음). 본인 잠금만 취소 가능.

#### 4.3.5 결재 상신 (release)

자료가 `CHECKED_IN` 상태일 때만 `[승인 요청]` 버튼이 활성. 클릭 시 `IN_APPROVAL`로 진입.
자세한 내용은 챕터 5 결재 참고.

> 내부 호출: `POST /api/v1/objects/[id]/release` — **release = 결재 상신**, 잠금 해제 아님
> (CLAUDE.md R2 학습).

#### 4.3.6 개정 (Revision +1) (FR-LC-05)

`APPROVED` 상태인 자료에서만 `[개정]` 버튼 활성. 클릭 시 새 revision으로 `CHECKED_OUT` 진입.

#### 4.3.7 삭제 (FR-LC-06)

`[삭제]` → ConfirmDialog → 폐기함으로 이동, 상태 `DELETED`(stone).

#### 4.3.8 복원 (FR-LC-06)

폐기함의 자료 행 → `[복원]` → 원 폴더로 복귀.

#### 4.3.9 영구 폐기

폐기함 행 → `[영구 폐기]` → 사용자명 일치 confirm 다이얼로그 → 영구 삭제 (R29 패턴).

#### 4.3.10 자료 이동 (FR-LC-08)

`[이동]` → 폴더 picker → 도면번호 재발번 안내 다이얼로그.

#### 4.3.11 Rev 이력 등록 (FR-LC-07)

기존 외부 시스템에서 옮겨온 자료의 누락 이력을 추가하는 기능. 도면번호는 변경 불가.

### 4.4 저장/완료 시그널

- 모든 액션 → 토스트 + 상태 뱃지 색 변화 (부록 B)
- 우측 ActivityLog 패널 즉시 갱신 (R29 N-1과 wired)
- 결재 상신 시 결재자에게 `<NotificationBell>` 알림 도착

### 4.5 자주 묻는 문제 / 권한 제약

- **체크아웃 버튼이 회색 (비활성):**
  - 다른 사용자가 점유 중(`ALREADY_LOCKED`)
  - `EDIT_OBJECT` 권한 없음
  - tooltip에 사유 노출
- **개정 버튼이 안 보임:** 자료가 `APPROVED` 상태가 아님(FR-LC-05 전제).
- **결재 취소:** 첫 결재자가 액션을 취하기 전(`IN_APPROVAL`)만 가능 (FR-APPR-05).
- **본인이 등록한 자료는?** 보안등급 무관 모든 권한이 부여된다 (FR-FOLDER-05; `canAccess` ownerId 분기).
- **`INVALID_TRANSITION` 에러:** 현재 상태에서 시도한 action이 허용되지 않음. 4.1 상태 머신 표를
  다시 확인. (CLAUDE.md R2 사례)

### 4.6 코드/페이지 hint

- 자료 상세: `apps/web/app/(main)/objects/[id]/page.tsx`
- 상태 머신: `apps/web/lib/state-machine.ts`
- 권한 평가: `apps/web/lib/permissions.ts` (`canAccess`)
- Mutation 패턴: `useObjectMutation` factory (R3a/b/c, `apps/web/components/object-list/` 내부)
- 체크인/체크아웃 API: `POST /api/v1/objects/[id]/checkin`, `POST /api/v1/objects/[id]/checkout`
- release(상신) API: `POST /api/v1/objects/[id]/release`
- 폐기함: `apps/web/app/(main)/admin/[section]/page.tsx?section=trash`

---

## 챕터 5. 결재 (상신·대기·완료·반려·취소)

### 5.1 진입점

| 동선 | 위치 |
|---|---|
| 결재함 | `/approval` (대기/완료/보낸/지운 결재함 통합) |
| 자료 측 진입 | 자료 상세 → `[승인 요청]` |
| 알림에서 진입 | 헤더 `<NotificationBell>` → 결재 알림 클릭 → 해당 자료 상세 |

![스크린샷: 결재함(/approval) — 좌측 결재 카테고리, 우측 결재 list](placeholder)

### 5.2 주요 액션

#### 5.2.1 상신 (FR-APPR-01)

자료 상세에서 `[승인 요청]` 클릭 → 다이얼로그 열림:

1. 결재선 템플릿 선택 (또는 `[직접 지정]`)
2. 의견 입력 (textarea)
3. `[상신]` 클릭

`<ApprovalLine>` 컴포넌트로 결재선이 시각화된다.

#### 5.2.2 결재 대기함

본인이 결재할 차례인 자료가 list로 표시된다. 각 행에서:

- `[승인]` — 의견(옵션) + 서명 자동 첨부 → 다음 결재자에게 패스
- `[반려]` — **사유 입력 의무** → 자료가 `CHECKED_IN`으로 복귀, 상신자에게 알림
- `[의견 추가]` — 결재 진행 중 의견만 추가

#### 5.2.3 완료 결재함

본인이 처리 완료한 자료. 처리 결과(승인/반려)가 표기된다.

#### 5.2.4 보낸 결재함

본인이 상신한 자료. 진행률 + 다음 결재자 표시. 첫 결재자 액션 전에는 `[결재 취소]` 가능.

#### 5.2.5 지운 결재함

`[결재 취소]`된 자료 (FR-APPR-05).

#### 5.2.6 결재 의견 + 서명 (FR-APPR-04)

각 결재자의 의견과 서명 이미지(`/settings`에서 미리 업로드한 이미지)가 결재 이력에 포함된다.

#### 5.2.7 결재 알림 (FR-APPR-06)

- 인앱: `<NotificationPanel>` (R29)
- 이메일: `/settings`에서 알림 환경설정 켰을 때만

### 5.3 저장/완료 시그널

| 액션 | 신호 |
|---|---|
| 상신 | 토스트 "결재 상신되었습니다" + 자료 상태 `IN_APPROVAL`(violet) |
| 최종 승인 | 자료 상태 `APPROVED`(emerald) + Revision +1 |
| 반려 | 자료 상태 `REJECTED` 후 `CHECKED_IN`으로 복귀 (상신자 입장) |
| 취소 | 자료 상태 `CHECKED_IN` 복귀 |

### 5.4 자주 묻는 문제 / 권한 제약

- **결재 상신 버튼이 회색:** 자료가 `CHECKED_IN`이 아니거나 본인 권한 없음.
- **결재선이 보이지 않음:** 폴더에 결재선 템플릿이 없음 — 관리자에게 추가 요청.
- **결재 취소가 안 됨:** 첫 결재자가 이미 처리한 경우 불가 (FR-APPR-05).
- **그룹웨어 결재 시스템 연동:** Phase 2 예정 (FR-APPR-07).

### 5.5 코드/페이지 hint

- 결재함: `apps/web/app/(main)/approval/page.tsx`
- 결재선: `apps/web/components/ApprovalLine.tsx`
- 결재 API: `apps/web/app/api/v1/approvals/`
- 상신 API: `POST /api/v1/objects/[id]/release`
- 승인 API: `POST /api/v1/approvals/[id]/approve`
- 반려 API: `POST /api/v1/approvals/[id]/reject`

---

## 챕터 6. 웹 뷰어 (확대·축소·측정·레이어·회전)

### 6.1 진입점

| 동선 | 위치 |
|---|---|
| 자료 상세 좌측 큰 뷰포트 | `/objects/[id]` 진입 시 자동 로드 |
| 검색 결과 행 더블클릭 | `/objects/[id]`로 이동 후 자동 로드 |
| 단축키 | `Enter`(검색 결과 행 선택 후) |

![스크린샷: 웹 뷰어 전체 — 좌측 뷰포트, 우측 레이어/속성 패널, 하단 status bar](placeholder)

### 6.2 지원 포맷 (FR-VIEW-01)

DWG, DXF, PDF, TIFF, JPG, PNG, GIF, BMP

DWG/DXF는 자체 DXF 엔진으로 렌더된다. DWG는 워커가 LibreDWG subprocess로 DXF 변환 후 표시.

### 6.3 변환 캐시 (FR-VIEW-02/03)

- 첫 조회: 변환 큐 enqueue → 변환 완료 후 표시
- 재조회: 캐시 즉시 응답(<500ms, PRD §5.1)

### 6.4 주요 단축키

> 출처: `apps/web/components/ShortcutsDialog.tsx` (`?` 단축키로 항상 호출 가능)

#### 6.4.1 글로벌

| 키 | 동작 |
|---|---|
| `⌘K` | 명령 팔레트 / 글로벌 검색 |
| `⌘B` | 사이드바 토글 |
| `⌘.` | 챗봇 토글 |
| `⌘\` | 다크모드 토글 |
| `?` | 단축키 도움말 |

#### 6.4.2 이동 (g + 키)

| 키 | 동작 |
|---|---|
| `g h` | 홈 |
| `g s` | 자료 검색 |
| `g a` | 결재함 |
| `g l` | 로비함 |
| `g m` | 관리자 |

#### 6.4.3 자료 검색·목록

| 키 | 동작 |
|---|---|
| `/` | 인라인 검색 포커스 |
| `↑` `↓` | 행 이동 |
| `Enter` | 상세 페이지 |
| `Space` | 미리보기 토글 |
| `⌘D` | 다운로드 |
| `⌘P` | 인쇄 (자료 상세) |
| `⌘E` | 편집(체크아웃) |
| `⌘⇧A` | 결재 상신 |
| `⌘⌫` | 폐기 |
| `[` `]` | 폴더 prev / next |

#### 6.4.4 뷰어

| 키 | 동작 |
|---|---|
| `+` `−` | 줌 인 / 아웃 |
| `0` | 맞춤(fit) |
| `r` | 회전 |
| `m` | 측정 |
| `t` | 문자 검색 |
| `l` | 레이어 패널 |
| `←` `→` | 페이지 이동 (멀티페이지 PDF) |
| `f` | 전체화면 |
| `Esc` | 닫기 |

### 6.5 주요 액션

#### 6.5.1 확대/축소/팬 (FR-VIEW-04)

- 휠 → 줌
- 우클릭 드래그 → 팬
- 더블클릭 → 부분 확대
- `0` 또는 `f` → 전체보기

#### 6.5.2 회전 (FR-VIEW-05)

- `r` → 우 90°
- (Shift+R 좌 90°, `0` 원위치 복귀는 단축키 dialog 정의에 맞춤)

#### 6.5.3 측정 (FR-VIEW-07)

- `m` → 측정 모드 → 2점 거리, 다중점 거리, 사각/다각형 면적
- 결과는 좌측 하단 status bar 또는 `<MeasurementOverlay>`에 실시간 표시
- 반경/각도 측정은 Phase 2 (FR-VIEW-08)

#### 6.5.4 레이어 On/Off (FR-VIEW-09)

`l` → 우측 패널에 레이어 list, 체크박스로 토글.

#### 6.5.5 문자 검색 (FR-VIEW-10)

`t` → 도면 내 텍스트 검색 입력창. 매칭된 텍스트 hilite.

#### 6.5.6 배경 반전 (FR-VIEW-11)

검정/흰색 토글 (`B` 단축키 또는 우측 상단 버튼).

#### 6.5.7 선 가중치 / 속성창 (FR-VIEW-13)

우측 패널 토글로 선 가중치 표시 ON/OFF, 도면 entity 속성 창 호출.

#### 6.5.8 폰트 누락 대체 (FR-VIEW-12)

자동 처리 — 사용자 액션 0. 상단에 알림 배너 "폰트 N개가 자동 대체되었습니다".

### 6.6 저장/완료 시그널

- 줌/팬/회전: 명시적 토스트 없이 즉각 반영
- 측정 결과: 실시간 status bar 표시
- 변환 미완료: `<ConversionStatusBadge>`에 "변환 중..." (R28)

### 6.7 자주 묻는 문제 / 권한 제약

- **도면이 새카맣게 표시:** 변환 큐 대기 중. `<NotificationBell>`에서 변환 완료 알림 대기.
- **외주 폰트가 깨짐:** 자동 대체 폰트 매핑이 적용된다 (FR-VIEW-12). 정확한 매핑은 관리자에게 요청.
- **측정값이 이상함:** 도면 단위(mm/inch) 확인. 측정은 도면 단위 기준 그대로 표시.
- **뷰어 진입이 차단됨:** 폴더 권한 또는 보안등급 부족 (PRD §7).

### 6.8 코드/페이지 hint

- 뷰어 컴포넌트: `apps/web/components/DwgViewer/` (`DwgViewer.tsx`, `scene.ts`, `camera.ts`, `dxf-worker-client.ts`, `dxf-worker.ts`)
- 자체 DXF 파서: `apps/web/lib/dxf-parser/` (`parser.ts`, `aci-colors.ts`, `types.ts`)
- 뷰어 엔진: `apps/web/lib/viewer/` (`dxf-engine.ts`, `pdf-engine.ts`, `keyboard.ts`, `measurements.ts`)
- 측정 hatch clip: `clipSegmentToHatch` (T-1 unit test 후보 — `apps/web/__tests__/clip-segment.test.ts`)
- 변환 큐: BullMQ + LibreDWG subprocess (`apps/worker/src/libredwg.ts`, `apps/worker/src/oda.ts`)
- 단축키 dialog: `apps/web/components/ShortcutsDialog.tsx` (본 매뉴얼의 단축키 표는 이 파일과 1:1 동기화)

---

## 챕터 7. 인쇄 / PDF 다운로드 (R31 P-1)

### 7.1 진입점

| 동선 | 위치 |
|---|---|
| 자료 상세 | 우상단 `[인쇄]` 버튼 또는 dropdown |
| 검색 결과 | 행 `⋯` 메뉴 → `인쇄` |
| 단축키 | `⌘P` (자료 상세 한정 — 브라우저 기본 인쇄를 가로챔) |

![스크린샷: PrintDialog — 480px 고정 폭, CTB/페이지/방향 선택, 진행률 progress bar](placeholder)

### 7.2 주요 액션 (`<PrintDialog>`)

| 옵션 | 값 |
|---|---|
| CTB(플롯 스타일) | `mono`(기본) / `A3 컬러` (FR-EXP-03) |
| 페이지 크기 | A4 / A3 / Letter 등 (FR-EXP-04) |
| 방향 | 세로 / 가로 |
| `[PDF 생성]` | 진행률 표시 → 완료 시 `[다운로드]` 또는 `[브라우저 인쇄]` 분기 |

#### 7.2.1 캐시 hit 시나리오 (R31 시나리오 2)

이미 같은 옵션으로 PDF가 생성되어 있으면 다이얼로그 상단에 "이미 변환된 PDF가 있습니다 (3분 전)"
배너 + 즉시 활성화된 `[다운로드]` 버튼이 노출된다.

#### 7.2.2 자료 다운로드 (FR-EXP-06)

원본 zip 다운로드는 별도 권한(`download` 비트)이 필요하다. 권한 없으면 회색.

#### 7.2.3 다중 도면 일괄 PDF (FR-EXP-02)

검색 결과에서 행 다중 선택 → `[일괄 PDF]` → 변환 큐로 일괄 enqueue.

### 7.3 저장/완료 시그널

- 진행률 progress bar: 속도(KB/s) + ETA (R31 P-1과 V-INF-2 공통 컨벤션)
- 완료 토스트: "PDF가 준비되었습니다"
- 다운로드 시 파일명: `{도면번호}_{revision}.pdf`

### 7.4 자주 묻는 문제 / 권한 제약

- **인쇄 버튼이 회색:**
  - 마스터 첨부가 없음
  - `download` 권한 없음 (R31 §A.1 PM-DECISION-1: download 비트가 print 권한과 동등)
- **변환이 30초 넘게 걸림:** 10MB 이상 도면은 SLA 외(PRD §5.1) — 잠시 대기. 관리자는
  `/admin/conversions`에서 진행 상태 모니터링.
- **컬러 인쇄:** CTB를 `A3 컬러`로 변경.
- **Microsoft Print to PDF 의존:** 빠졌다 — 서버측 변환(FR-EXP-05)으로 통일.

### 7.5 코드/페이지 hint

- 인쇄 다이얼로그: `apps/web/components/print/PrintDialog.tsx` (R31)
- 진행률 컴포넌트: `<ChunkProgressBar>` 재사용 (R31 utility)
- 단축키 등록: `ShortcutsDialog.tsx` `⌘P — 인쇄`
- 인쇄 API: `POST /api/v1/attachments/[id]/print`
- 인쇄 작업 상태 조회: `GET /api/v1/print-jobs/[jobId]/status`

---

## 챕터 8. 폴더 즐겨찾기 / 핀 / 내 작업함

### 8.1 진입점

| 동선 | 위치 |
|---|---|
| 좌측 폴더 트리 위 `즐겨찾기` 섹션 | 사이드바 상단 |
| 내 작업함 | `/workspace` |

### 8.2 주요 액션

#### 8.2.1 폴더 즐겨찾기 추가 (FR-MY-01)

좌측 트리에서 폴더 우클릭 → `즐겨찾기 추가`.

#### 8.2.2 폴더 핀

폴더명 hover → `📌` 토글 (UX 컨벤션).

#### 8.2.3 자료 담기 (FR-MY-02)

- 검색 결과 행 → `⋯` → `즐겨찾기 담기`
- 자료 상세 → `[즐겨찾기]` 버튼

#### 8.2.4 자료 빼기

`/workspace`에서 자료 행 → `[빼기]`.

#### 8.2.5 내 작업함 안에서의 작업 (FR-MY-03)

뷰어/출력/PDF 모두 사용 가능.

### 8.3 저장/완료 시그널

- 토스트: "즐겨찾기에 추가/제거되었습니다"
- 좌측 사이드바 즐겨찾기 카운트 즉시 갱신

### 8.4 자주 묻는 문제 / 권한 제약

- **다른 사람과 즐겨찾기 공유:** 불가 — 개인용
- **권한이 회수된 자료:** 즐겨찾기 list에는 남되, 진입 시 권한 가드로 차단

### 8.5 코드/페이지 hint

- 내 작업함: `apps/web/app/(main)/workspace/page.tsx`
- 폴더 트리: `apps/web/components/folder-tree/`
- 즐겨찾기 API는 본문 라운드에 명시 예정 (현재 TBD)

---

## 챕터 9. 트랜스미털 / 로비함 (협력업체 도면 배포)

### 9.1 진입점

| 페르소나 | 동선 |
|---|---|
| 협력업체 | 로그인 후 자동으로 `/lobby/[id]`로 진입 (다른 메뉴 숨김 — PRD §3.5, FR-AUTH-06) |
| 자사 (관리자/설계자) | `/lobby` 트리에서 폴더 선택 |

![스크린샷: 로비함 페이지 — 자사용 list / 협력업체 단일 view](placeholder)

### 9.2 주요 액션

#### 9.2.1 로비함 생성 (FR-LOBBY-02)

자사 측에서 `[+ 로비함 생성]` 다이얼로그(`<TransmittalDialog>`):

- 대상업체 선택
- 만료기간 설정
- 첨부파일

`[저장]` → 협력업체에게 알림 발송.

#### 9.2.2 자동 폐기 (FR-LOBBY-03)

만료기간 도래 시 시스템 자동 처리. 사용자 액션 0.

#### 9.2.3 로비함 검색 (FR-LOBBY-04)

키워드/등록일로 검색.

#### 9.2.4 자료 활용 (FR-LOBBY-05)

뷰어/출력/PDF/다운로드 가능 (폴더 권한·보안등급 의존).

#### 9.2.5 확인 요청 / 재확인 요청 (FR-LOBBY-06)

협력업체 측에서 의견 입력 후 클릭 → 자사 결재선으로 흘러간다. 결재 진행 후 결과를 협력업체에 회신.

#### 9.2.6 확장자 제한 (FR-LOBBY-07)

뷰어 가능한 확장자만 등록 허용 (DWG/DXF/PDF/TIFF/JPG/PNG/GIF/BMP).

### 9.3 저장/완료 시그널

- 로비함 생성 → 토스트 + 협력업체에 인앱 알림
- 만료 임박 → 자사 관리자에게 인앱 알림

### 9.4 자주 묻는 문제 / 권한 제약

- **협력업체가 다른 메뉴를 볼 수 있나:** 불가. 페르소나가 `PARTNER`면 `/lobby/*`만 접근 (FR-AUTH-06).
- **DWG 원본을 협력업체가 받을 수 있나:** 폴더 권한·보안등급에 따른다. 일반적으로 PDF만 노출.
- **확인 요청이 안 보내짐:** 자사 결재선이 매핑되어 있어야 한다.

### 9.5 코드/페이지 hint

- 로비함: `apps/web/app/(main)/lobby/page.tsx`, `apps/web/app/(main)/lobby/[id]/page.tsx`
- 트랜스미털 다이얼로그: `apps/web/components/object-list/TransmittalDialog.tsx`
- 로비 API: `apps/web/app/api/v1/lobbies/`
- 답글 API: `POST /api/v1/lobbies/[id]/replies`
- 협력업체 페르소나 가드: layout-level (`apps/web/middleware.ts` + auth.ts)

---

## 챕터 10. 알림 / 활동 로그 (R29 N-1)

### 10.1 진입점

| 동선 | 위치 |
|---|---|
| 헤더 우상단 종 아이콘 | `<NotificationBell>` |
| 알림 패널 | 종 클릭 → `<NotificationPanel>` 슬라이드인 |

![스크린샷: NotificationBell + NotificationPanel — unread 굵은 행, read 일반 행](placeholder)

### 10.2 주요 액션

- 종 클릭 → `<NotificationPanel>` 열림
- unread 굵은 행 / read 일반 행 (시각적 구분)
- 행 클릭 → 자동 read 처리 + 해당 자료/결재 페이지로 이동
- `[모두 읽음으로]` 버튼 — 한 번에 전체 read 처리

### 10.3 저장/완료 시그널

- 종 위 빨간 dot — unread 카운트 ≥ 1
- 행 read 처리 시 dot 즉시 사라짐
- `unread-count` 폴링: 자동 갱신 (TanStack Query)

### 10.4 알림 트리거 이벤트

(라벨은 `apps/web/lib/activity-labels.ts`와 1:1)

| 이벤트 | 트리거 시점 |
|---|---|
| 결재 상신 | `release` (CHECKED_IN → IN_APPROVAL) — 첫 결재자 알림 |
| 결재 차례 | 다음 결재자에게 |
| 결재 완료 | `approve` 최종 또는 `reject` |
| 변환 실패 | 변환 큐 worker에서 catch |
| 권한 변경 | 폴더 권한 매트릭스 저장 |
| 백업 실패 | R33 백업 worker에서 catch |
| 로비함 만료 임박 | 일 1회 cron |

### 10.5 자주 묻는 문제 / 권한 제약

- **알림이 안 옴:** `/settings`에서 알림 환경설정(이메일 on/off) 확인.
- **알림 종류:** 위 10.4 표 참조.

### 10.6 코드/페이지 hint

- 알림 종: `apps/web/components/layout/NotificationBell.tsx`
- 알림 패널: `apps/web/components/notifications/NotificationPanel.tsx`
- 라벨 매핑: `apps/web/lib/activity-labels.ts` (테스트 `apps/web/__tests__/activity-labels.test.ts`)
- API:
  - `GET /api/v1/notifications`
  - `GET /api/v1/notifications/unread-count`
  - `PATCH /api/v1/notifications/[id]/read`
  - `POST /api/v1/notifications/read-all`

---

## 챕터 11. 자주 묻는 문제 (FAQ)

### 11.1 로그인

- **Q.** 비밀번호를 잊었어요.
  **A.** 관리자에게 리셋 요청 → `<PasswordResetDialog>`에서 자동 발급되는 평문을 1회만 전달받음.
- **Q.** 5회 실패해서 잠겼어요.
  **A.** 관리자에게 잠금 해제 요청. `/admin/users` → `UserUnlockDialog`.
- **Q.** SSO 버튼이 안 보여요.
  **A.** `NEXT_PUBLIC_KEYCLOAK_ENABLED=1`이 운영 환경에 설정되어 있어야 표시된다. 관리자에게 문의.

### 11.2 검색

- **Q.** 한글 부분 일치가 안 돼요.
  **A.** Postgres `pg_trgm` 인덱스가 적용되어 있어야 한다. 관리자에게 `0001_pgvector.sql` 적용 여부 문의.
- **Q.** 결과가 너무 적어요.
  **A.** 폴더 권한·보안등급으로 행이 숨겨졌을 수 있다. 권한 매트릭스 확인 요청.
- **Q.** Excel 다운로드가 안 돼요.
  **A.** 검색 결과 우상단 `Excel` 버튼이 활성화되어 있는지 확인. 결과 0건이면 비활성.

### 11.3 등록

- **Q.** `[+ 신규등록]`이 회색이에요.
  **A.** 폴더 `EDIT_FOLDER` 권한 필요.
- **Q.** 첨부 마스터 파일을 바꾸고 싶어요.
  **A.** 첨부 행에서 `[M]` 토글.
- **Q.** 일괄 등록 매핑 오류가 나요.
  **A.** Excel 템플릿 헤더와 Class 속성을 일치시킨다. 행 단위 검증 결과(rose 강조)를 확인.

### 11.4 변환

- **Q.** 도면이 새카맣게 표시돼요.
  **A.** 변환 큐 대기 중. `<NotificationBell>`에서 변환 완료 알림 대기. 30초 이상 지연 시
  관리자에게 `/admin/conversions` 모니터링 요청.
- **Q.** 외주 폰트가 깨져요.
  **A.** 자동 대체 폰트가 적용된다. 정확한 폰트는 관리자에게 매핑 추가 요청.

### 11.5 결재

- **Q.** 결재 상신 버튼이 회색이에요.
  **A.** 자료가 `CHECKED_IN`이 아니거나 본인이 작성자/편집자가 아님.
- **Q.** 결재 취소가 안 돼요.
  **A.** 첫 결재자가 이미 처리한 경우 불가 (FR-APPR-05).
- **Q.** 결재선이 비어 있어요.
  **A.** 폴더에 결재선 템플릿이 없음 — 관리자에게 추가 요청.

### 11.6 인쇄

- **Q.** 인쇄 버튼이 회색이에요.
  **A.** 마스터 첨부가 없거나 `download` 비트 권한 없음 (R31에서 print 권한과 동등 처리).
- **Q.** 컬러 인쇄가 안 돼요.
  **A.** CTB를 `A3 컬러`로 변경.

### 11.7 권한

- **Q.** 본인이 등록한 자료는 보안등급이 높아도 볼 수 있나요?
  **A.** 예, 본인 등록 자료는 보안등급 무관 모든 권한 (FR-FOLDER-05).
- **Q.** 폴더 권한이 회수됐어요.
  **A.** 즐겨찾기 list에는 남아 있되 진입 시 차단된다. 관리자에게 권한 부여 요청.

### 11.8 협력업체

- **Q.** 다른 메뉴가 안 보여요.
  **A.** 협력업체 페르소나는 `/lobby/*`만 접근 가능 (FR-AUTH-06; layout-level guard).
- **Q.** DWG 원본을 받을 수 있나요?
  **A.** 폴더 권한·보안등급에 따른다. 일반적으로 PDF만 노출.

---

## 챕터 12. R36~R44 신규 기능 요약 (v0.2 catch-up)

> R35 본문(v0.1) 작성 이후 추가된 기능을 사용자 관점에서 요약. 기존 챕터에 통합 반영은 v0.3 일괄 리팩터에서 진행.

### 12.1 보안 / 인증 강화

#### 12.1.1 SAML SSO (R37 A-2)
- 운영 환경 변수 `NEXT_PUBLIC_SAML_ENABLED=1` + IdP 메타데이터 설정 시 로그인 페이지 상단에 [SAML로 계속] 버튼 노출.
- 키즈 + Keycloak(R33)과 같은 패널에서 "또는" divider 아래 일반 로그인 폼 유지.
- 코드 hint: `apps/web/auth.ts` SAML 모드, `apps/web/app/api/v1/auth/saml/*`.

#### 12.1.2 2단계 인증 (MFA TOTP, R39 + R40)
- **활성화**: `/settings` → 보안 탭 → [2단계 인증 설정] → QR 코드 스캔(Google Authenticator/Authy 등) → 6자리 입력 → 복구 코드 10개 안전한 곳에 저장.
- **로그인 흐름**: 1단계 비밀번호 통과 후 자동으로 `/login/mfa`로 이동 → 6자리 입력(자동 submit) 또는 [복구 코드 사용] 토글.
- **5회 실패** → 계정 일시 잠금 + `/login`으로 강제 이동.
- **복구 코드 재발급**: `/settings` → 보안 → [복구 코드 재발급] → 비밀번호 또는 6자리 재인증 → 신규 10개 표시(체크 후 닫기).
- **비활성화**: `/settings` → 보안 → [2단계 비활성화] → 비밀번호 또는 6자리 재인증.
- 코드 hint: `apps/web/components/settings/MfaSection.tsx`, `apps/web/app/(auth)/login/mfa/page.tsx`.

#### 12.1.3 비밀번호 정책 (R39 A-4)
- 변경 시 정책 검사: 8자 이상, 영문 + 숫자 + 특수문자 1개 이상, 직전 2개 비밀번호 재사용 금지, 공백 금지.
- 변경 폼은 강도 미터 + 체크리스트 실시간 갱신.
- 만료 90일(`PASSWORD_EXPIRY_DAYS` 환경 변수). 만료 7일 전부터 페이지 상단 배너로 알림. 만료 후엔 `/settings?tab=password`로 강제 이동, 다른 페이지 접근 차단.
- 관리자가 강제 만료시킬 수 있음(`/admin/users` 상세 → [비밀번호 만료]).

#### 12.1.4 SMS / 카카오 알림톡 (R38 N-2)
- `/settings` → 알림 채널에서 메일/SMS/카카오 토글. SMS·카카오는 `phoneNumber` 입력 필요.
- 메일: nodemailer SMTP. SMS: Twilio 또는 NCP SENS. 카카오: Bizmessage 알림톡(템플릿 사전 등록 필요).
- 운영 환경 변수: `MAIL_ENABLED`, `SMS_ENABLED`, `KAKAO_ENABLED` 각자 0/1.

### 12.2 검색 강화

#### 12.2.1 PDF 본문 전문 검색 (R40 S-1)
- 자료 첨부에 PDF가 있으면 본문 텍스트가 자동 추출되어 검색에 포함.
- 검색 결과 행에 매칭된 본문 단편이 `<mark>강조된 부분</mark>`으로 노출 (1줄, 자동 truncate).
- 검색 placeholder가 "도면번호, 자료명, **PDF 내용** 검색…"으로 갱신됨.

#### 12.2.2 검색 ranking 통합 (R42)
- 자료번호/이름/설명(trgm) + PDF 본문(FTS) 매칭 점수를 통합해 가장 관련도 높은 결과가 위로.
- PDF 본문 매칭에 약간 가중치(`FTS_WEIGHT=1.5`) 부여 — 본문에 정확히 있는 키워드가 메타에 약하게 있는 것보다 우선.
- 결과 행 옆 작은 칩으로 매치 출처 표시: **"본문"** / **"본문+메타"** / 메타만은 미표시.

#### 12.2.3 멀티 fragment 스니펫 (R43)
- 긴 PDF에서 매칭이 여러 곳에 있을 때 최대 3개의 컨텍스트 단편이 ` … ` 구분자로 연결되어 노출.
- 각 fragment는 15단어 안팎으로 짧게 — 한 줄에 충분한 다양한 컨텍스트 노출.

#### 12.2.4 정확한 cursor 페이지네이션 (R43)
- "더 보기" 페이지로 이동해도 ranking이 일관 유지(이전엔 첫 페이지만 ranking 적용).
- 깊은 페이지 진입 시 권한 필터 후에도 가능한 한 limit만큼 결과 보장.

### 12.3 관리자 페이지 신규

#### 12.3.1 의존성 보안 (`/admin/security`, R40 + R41)
- 진입: 좌측 관리자 메뉴 → "의존성 보안".
- **카운트 카드 4종**: Critical / High / Moderate / Low. 마지막 검사 시각(KST) 표시.
- **[지금 검사]** 버튼: `pnpm audit`을 즉시 재실행(15분 캐시 무효화). 검사 중에는 spinner + "최대 1분" 안내.
- **카드 클릭 → 필터**: 클릭한 severity로 하단 취약점 테이블 필터링. URL `?severity=high` 형태로 동기화 — 새로고침/공유 시 필터 복원.
- **취약점 테이블**: 패키지 / 제목 / 영향 받는 버전 / 외부 advisory 링크 (target=_blank, rel=noopener). severity 우선 정렬, 같은 severity 안에서는 알파벳.
- 50건 초과 시 [더 보기] 버튼으로 추가 노출.

#### 12.3.2 PDF 본문 추출 모니터 (`/admin/pdf-extracts`, R41)
- 진입: 좌측 관리자 메뉴 → "PDF 본문 추출".
- **카운트 카드 5종**: PENDING / EXTRACTING / DONE / FAILED / SKIPPED.
- **카드 클릭 → 필터**: URL `?status=FAILED` 동기화.
- **테이블**: 자료번호 / 파일명 / 상태 / 마지막 시도 시각 / 오류 메시지 / [재시도] 버튼.
- **재시도**: FAILED 또는 SKIPPED 행만 활성. ConfirmDialog로 확인 후 큐에 재 enqueue. optimistic으로 PENDING 표시 후 5초 폴링으로 갱신.

#### 12.3.3 바이러스 스캔 모니터 (`/admin/scans`, R36)
- 진입: 좌측 관리자 메뉴 → "파일 검사".
- 카운트 카드 6종: PENDING / SCANNING / CLEAN / INFECTED / SKIPPED / FAILED.
- INFECTED 첨부는 다운로드/미리보기/인쇄/썸네일 자동 차단(서버측 강제) — 사용자에게는 "감염 의심으로 차단" 안내.
- [재검사] 버튼으로 ClamAV 재실행. 환경 변수 `CLAMAV_ENABLED=0`이면 SKIPPED 처리.

### 12.4 뷰어 / 측정

#### 12.4.1 측정 도구 정밀도 (R39 V-5)
- 거리/면적 측정 시 단위(`$INSUNITS`) 인식 + ts소수점 정확도 보강.
- 측정 결과는 도면 좌표 기반 — 화면 줌 레벨과 무관하게 동일.

#### 12.4.2 선 가중치 정확 표현 (R37 V-2)
- DXF 그룹 코드 370(LineWeight)을 Line2로 정확 렌더링. 인쇄/PDF 출력에 동일 두께 반영.

### 12.5 접근성 (R37 AC-1)

- 13개 핵심 화면 WCAG 2.1 AA audit 후 P0/P1 수정 적용.
- focus-visible ring + ARIA role/label + 색대비 4.5:1 충족.
- 스크린 리더 호환 강화 — `<dl>` 시맨틱, `<mark>`/`<th aria-sort>` 등.

### 12.6 알림 채널 채울 (R38 + 후속)

알림 받기 채널이 다양화됨 — 사용자 설정에서 메일/SMS/카카오 중 원하는 채널을 토글.

---

## 부록 A. 단축키 일람

> 출처: `apps/web/components/ShortcutsDialog.tsx` (`?` 단축키로 항상 호출)

### A.1 글로벌

| 키 | 동작 |
|---|---|
| `⌘K` / `Ctrl+K` | 명령 팔레트 / 글로벌 검색 |
| `⌘B` / `Ctrl+B` | 사이드바 토글 |
| `⌘.` / `Ctrl+.` | 챗봇 토글 |
| `⌘\` / `Ctrl+\` | 다크모드 토글 |
| `?` | 단축키 도움말 |

### A.2 이동 (g + 키)

| 키 | 동작 |
|---|---|
| `g h` | 홈 |
| `g s` | 자료 검색 |
| `g a` | 결재함 |
| `g l` | 로비함 |
| `g m` | 관리자 |

### A.3 자료 검색·목록

| 키 | 동작 |
|---|---|
| `/` | 인라인 검색 포커스 |
| `↑` `↓` | 행 이동 |
| `Enter` | 상세 페이지 |
| `Space` | 미리보기 토글 |
| `⌘D` / `Ctrl+D` | 다운로드 |
| `⌘P` / `Ctrl+P` | 인쇄 (자료 상세) |
| `⌘E` / `Ctrl+E` | 편집(체크아웃) |
| `⌘⇧A` / `Ctrl+Shift+A` | 결재 상신 |
| `⌘⌫` / `Ctrl+Backspace` | 폐기 |
| `[` `]` | 폴더 prev / next |

### A.4 뷰어

| 키 | 동작 |
|---|---|
| `+` `−` | 줌 인 / 아웃 |
| `0` | 맞춤(fit) |
| `r` | 회전 |
| `m` | 측정 |
| `t` | 문자 검색 |
| `l` | 레이어 패널 |
| `←` `→` | 페이지 이동 (PDF 멀티페이지) |
| `f` | 전체화면 |
| `Esc` | 닫기 |

---

## 부록 B. 상태 뱃지 색 / 의미 일람

> 출처: `docs/DESIGN.md` §2.1 + `apps/web/components/StatusBadge.tsx`

| Status | Color (Tailwind) | 의미 |
|---|---|---|
| `NEW` | Slate | 신규 등록, 미결재 |
| `CHECKED_OUT` | Amber | 체크아웃 (잠금 중) |
| `CHECKED_IN` | Sky | 체크인 완료 |
| `IN_APPROVAL` | Violet | 결재 진행 중 |
| `APPROVED` | Emerald | 승인됨 |
| `REJECTED` | Rose | 반려됨 |
| `DELETED` | Stone | 폐기함 |

부가 표기:

- `🔒` — 다른 사용자 체크아웃 중
- `📋` — 결재 진행 중
- `[M]` — 마스터 첨부

---

## 부록 C. 보안등급 1~5

> 출처: PRD §7

| 등급 | 의미 (요약) | 접근 가능 페르소나 (예시) |
|---|---|---|
| 1 | 일반 사내 공유 | 全 사내 |
| 2 | 부서 공유 | 해당 부서 + 관리자 |
| 3 | 팀 공유 | 해당 팀 + 관리자 |
| 4 | 개인 + 결재선 | 작성자 + 결재선 + 관리자 |
| 5 | 작성자 + 슈퍼관리자 | 작성자 + 슈퍼관리자 |

> **본인 등록 자료 예외:** 보안등급 무관 모든 권한 (FR-FOLDER-05).
> 평가 로직: `apps/web/lib/permissions.ts` `canAccess` 함수 ownerId 분기.

---

## 부록 D. 에러 코드 (대표)

> 출처: `apps/web/lib/api-errors.ts` (정확한 enum은 본문 라운드에 1:1 매핑)

| 코드 | 의미 | 사용자에게 보일 때 |
|---|---|---|
| `INVALID_TRANSITION` | 현재 상태에서 시도한 액션이 허용되지 않음 | "현재 상태에서 수행할 수 없습니다" |
| `NOT_LOCKED_BY_USER` | 본인이 잠근 자료가 아님 | "본인이 체크아웃한 자료만 가능합니다" |
| `ALREADY_LOCKED` | 다른 사용자가 잠금 중 | "다른 사용자가 잠금 중입니다" |
| `E_NO_PERMISSION` | 권한 없음 | "권한이 부족합니다" |
| `E_NOT_FOUND` | 자료/리소스 없음 | "자료를 찾을 수 없습니다" |
| `E_RATE_LIMIT` | 요청 빈도 초과 | "잠시 후 다시 시도하세요" |

---

## 부록 E. 페르소나별 권장 학습 경로

| 페르소나 | 첫 1주 학습 챕터 | 가끔 참조할 챕터 |
|---|---|---|
| 슈퍼관리자 | 全 챕터 + 운영 문서 | 모든 챕터를 자주 |
| 관리자 | 全 챕터 | 1, 4, 5, 10 자주 |
| 설계자 | 1, 2, 3, 4, 5, 6, 7, 8 | 9, 10, 부록 A |
| 열람자 | 0, 1, 2, 6, 7 | 부록 A, B |
| 협력업체 | 0, 1, 9 | 부록 A 일부 |

---

## 부록 F. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-04-27 | R35 1차 본문 작성 (DOC-2). 챕터 0~11 + 부록 A~E. 스크린샷 placeholder. |
| 2026-04-28 | R45 catch-up: 챕터 12 신설 (R36~R44 신규 기능 — SAML/MFA/비밀번호정책/SMS·카카오/PDF 본문 검색/검색 ranking/멀티 fragment/cursor 페이지네이션/관리자 의존성 보안/PDF 추출 모니터/바이러스 스캔 모니터/측정 정밀도/선 가중치/접근성). 기존 챕터 통합 반영은 v0.3에서. |
