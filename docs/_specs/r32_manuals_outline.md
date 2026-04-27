# R32 Design Spec — 사용자 매뉴얼(DOC-2) + 개발자 가이드(DOC-4) outline

| 항목 | 내용 |
|---|---|
| 작성자 | drawing-mgmt designer agent (R32) |
| 작성일 | 2026-04-27 |
| 기준 main HEAD | `2e790c4` |
| 대상 라운드 | R32 (인프라 라운드, web API 변경 없음) |
| 대상 카드 | DOC-2 사용자 매뉴얼 outline, DOC-4 개발자 가이드 outline (+보너스 운영 문서 outline) |
| 입력 | `_workspace/api_contract.md` §5 |
| 산출물 | 본 파일 1건 — 다음 라운드 본문 작성을 위한 골격 |
| 디자인 토큰 변경 | 없음 (문서 outline은 토큰 무관) |
| 이미지/스크린샷 | 본 outline 단계에서는 placeholder만 표기. 본문 작성 라운드에서 캡처 필요 — `docs/manuals/images/` 신규 디렉토리 예정 |

---

## 0. outline의 위치와 사용처

### 0.1 산출물 구조 (다음 라운드 이후)

본 outline은 다음 라운드에서 두 개의 본문 markdown(또는 PDF로 export될 markdown)으로 풀어진다. 작성 위치는 `docs/manuals/` 신규 디렉토리.

```
docs/
├── manuals/
│   ├── user-manual.ko.md          # DOC-2 본문 (사용자용, 한국어)
│   ├── developer-guide.ko.md      # DOC-4 본문 (개발자용, 한국어)
│   ├── operations.ko.md           # 운영 문서 (시간되면, §C)
│   └── images/                    # 스크린샷 (`{chapter}-{slug}-{n}.png`)
└── _specs/
    └── r32_manuals_outline.md    # 본 파일 (골격 only)
```

### 0.2 매뉴얼이 풀려야 할 형태 (스타일 컨벤션)

- **언어:** 한국어 우선. 영문 라벨은 괄호 보조 (예: "체크아웃(Check-out)").
- **페르소나 어휘:** PRD §2.3과 동일 — "슈퍼관리자, 관리자, 설계자, 열람자, 협력업체".
- **권한 명시:** 각 챕터 도입부에 "이 기능은 X 권한이 있어야 사용 가능합니다" 1줄.
- **스크린샷 자리:** 본 outline에는 `▶ [스크린샷] 위치 설명` 표기만. 본문 라운드에서 실제 PNG 삽입.
- **단축키:** `⌘P` / `Ctrl+P` 같이 mac/win 양쪽 표기.
- **에러 메시지:** `_workspace/api_contract.md`와 코드의 `apps/web/lib/api-errors.ts` 와 1:1 매핑되도록 `errorCode` 표기.
- **버전/날짜:** 모든 매뉴얼 상단 frontmatter에 `대상 버전`, `작성일`, `대상 main HEAD` 표기.
- **PDF export:** markdown → Pandoc 또는 mdBook 등으로 PDF 배포 가능하도록 ATX 헤더(#, ##, ###) 위주, HTML 임베드 자제.

### 0.3 페르소나별 매뉴얼 진입로

| 페르소나 | 본인이 읽을 챕터 | 다른 챕터 참조 빈도 |
|---|---|---|
| 슈퍼관리자 | 全 챕터 + 관리자 챕터 + 운영 문서 | 자주 |
| 관리자 | 全 챕터 + 관리자 챕터 | 자주 |
| 설계자 (10~15명) | 1~6, 8 (검색·등록·라이프사이클·결재·뷰어·인쇄·즐겨찾기) | 가끔 |
| 열람자 (5~10명) | 1, 2, 6, 7 (로그인·검색·뷰어·인쇄) | 드묾 |
| 협력업체 (5사) | 1, 9 (로그인·트랜스미털/로비함) | 드묾 |

---

## A. 사용자 매뉴얼 outline (DOC-2)

대상: `docs/manuals/user-manual.ko.md`. contract §5.A 9 챕터 + 0(시작하기)·10(자주 묻는 문제)·11(부록) 추가.

각 챕터는 본문에서 다음 5개 sub-section을 반드시 포함:
1. **진입점** — 사이드바 메뉴, URL, 단축키 중 무엇으로 도달하는가
2. **주요 액션** — 버튼/필드/체크박스 라벨 그대로 + 결과
3. **저장/완료 시그널** — toast, 페이지 이동, 상태 뱃지, badge color 변화
4. **자주 묻는 문제 / 권한 제약** — 비활성 사유, FAQ 단답 3~5건
5. **실제 페이지/컴포넌트 경로** — 본문 작성자(다음 라운드 frontend agent)가 실제 코드를 읽고 스크린샷을 뜰 수 있도록 hint

---

### 챕터 0. 시작하기 (Onboarding)

- **진입점:** 매뉴얼 첫 페이지. 사용자가 받는 ZIP에 `README.txt` + 본 매뉴얼 PDF.
- **주요 액션:** 시스템 개요 1쪽, 권장 브라우저(Chrome/Edge 최신), 화면 해상도 안내(≥1280×768).
- **저장/완료 시그널:** 없음 (정보 페이지).
- **자주 묻는 문제 / 권한 제약:**
  - "IE에서는 동작하지 않습니다."
  - "AutoCAD 미설치자도 모든 도면을 브라우저에서 볼 수 있습니다." ← 핵심 가치 강조 (PRD §2.2-1)
- **실제 페이지/컴포넌트 경로:**
  - `apps/web/app/page.tsx` (랜딩) — 스크린샷 1장
  - `docs/PRD.md` §2.3 페르소나 표 → 본 매뉴얼 §0에 그대로 차용

---

### 챕터 1. 로그인 / 비밀번호 / 사용자 설정

- **진입점:**
  - URL: `/login`
  - 메뉴: 헤더 우상단 user dropdown → `설정` 또는 `로그아웃`
  - 사용자 설정: `/settings`
- **주요 액션:**
  - 로그인 폼: `이메일(또는 사번)`, `비밀번호`, `[로그인]`
  - 비밀번호 정책 안내 (PRD §4.1 FR-AUTH-03): "최소 10자, 영문/숫자/특수문자 포함"
  - `/settings` 사용자 설정 (R27 P-5):
    - 비밀번호 변경 (`현재 PW` + `새 PW` + `새 PW 확인`)
    - 서명 이미지 업로드 (jpg/png, 결재 시 사용)
    - 알림 환경설정 (이메일 알림 on/off — 본문에서 명세)
- **저장/완료 시그널:**
  - 로그인 성공 → `/` 또는 마지막 방문 페이지로 redirect, 우상단 user dropdown에 이름 표시
  - 비밀번호 변경 성공 → 토스트 "비밀번호가 변경되었습니다" + 자동 로그아웃 → 재로그인 유도
  - 5회 실패 → "30분간 잠금" 안내 (FR-AUTH-04)
- **자주 묻는 문제 / 권한 제약:**
  - "잠겼어요" → 관리자에게 잠금 해제 요청 (`/admin/users` → 잠금 해제 — R29)
  - "비밀번호 잊었어요" → 관리자에게 리셋 요청 (자동 발급 평문은 1회만 노출 — R29 `<PasswordResetDialog>`)
  - "서명 이미지가 안 올라가요" → 확장자 jpg/png만 허용, 1MB 이내 권장
- **실제 페이지/컴포넌트 경로:**
  - 로그인: `apps/web/app/login/page.tsx`
  - 사용자 설정: `apps/web/app/(main)/settings/page.tsx`
  - 비밀번호 변경 폼: 본인 키로 `PATCH /api/v1/me/password`
  - 서명 업로드: `PATCH /api/v1/me/signature`
  - 화면 하단 단축키 도움말: `apps/web/components/ShortcutsDialog.tsx` (`?` 단축키)

---

### 챕터 2. 자료 검색 (전체 / 유형별 / 결과 내 / 이력)

- **진입점:**
  - URL: `/search`
  - 메뉴: 헤더 검색바 (글로벌, 어디서든 `/`(슬래시) 단축키로 포커스) → Enter
  - 폴더 트리에서 폴더 선택 시 자동 필터
- **주요 액션:**
  - 검색바: 도면번호 / 자료명 / 자료설명 (FR-SEARCH-01)
  - 자료유형 필터 (Class) → 자료유형 선택 시 속성 기반 세부검색 활성 (FR-SEARCH-02)
  - 결과 내 검색 (FR-SEARCH-03): 결과 위 토글 `결과 내 검색`
  - 하위 폴더 포함 / 미포함 토글 (FR-SEARCH-04)
  - 정렬: 헤더 컬럼 클릭 (FR-SEARCH-05)
  - 잠금 아이콘 표기: `🔒` 체크아웃, `📋` 결재중 (FR-SEARCH-06; `<StatusBadge>`/`<FileTypeIcon>` 매핑)
  - 결과 행 호버 → 우측 preview 패널에 thumbnail (R29 V-INF-6)
  - 행 더블클릭 → `/objects/[id]` 진입
  - `⋯` 행 액션 메뉴: `미리보기 / 다운로드 / 인쇄 / 즐겨찾기 담기` (R31 P-1 진입점 2)
  - **버전 이력 보기 (FR-SEARCH-09):** 자료 상세에서 `이력` 탭 → revision tree (`<RevisionTree>`)
- **저장/완료 시그널:**
  - 결과 카운트 우상단 표기 ("123건 / 5건 표시")
  - empty 시 `<EmptyState>` 컴포넌트 + 검색어 초기화 버튼
  - 검색 결과 캐싱 — TanStack Query → 같은 검색어 재진입 즉시 (`<500ms`)
- **자주 묻는 문제 / 권한 제약:**
  - "결과가 안 나와요" → 폴더 권한, 보안등급 등 행 자체가 숨겨질 수 있음
  - "한글이 일부만 일치해도 검색되나요" → pg_trgm 도입 후 부분일치 (FR-SEARCH-07; 본문 시점에 도입 여부 확인)
  - Excel export: 결과 우상단 `Excel` 버튼 (FR-SEARCH-10)
  - "검색이 느려요" → 10만건 기준 1초 (PRD §5.1)
- **실제 페이지/컴포넌트 경로:**
  - `apps/web/app/(main)/search/page.tsx` + `apps/web/components/object-list/`
  - 미리보기 thumbnail: `<AttachmentThumbnail>` (R29)
  - 검색 API: `GET /api/v1/search` (`apps/web/app/api/v1/search/route.ts`)
  - 글로벌 검색바: `apps/web/components/layout/` 헤더

---

### 챕터 3. 자료 등록 (단건 / 일괄)

- **진입점:**
  - 단건: 폴더 트리에서 폴더 선택 → 우상단 `[+ 신규등록]` 또는 단축키 (PRD §3.1)
  - 일괄: `/admin/bulk-import` (관리자만; FR-ADM-08, 본 라운드 시점에 미구현이면 placeholder 표기)
- **주요 액션:**
  - 단건 등록 폼:
    - `도면번호` (자동발번 ON 시 readonly; OFF 시 수동 입력) — 발번 규칙 PRD §6
    - `자료유형(Class)` (폴더 기본값 자동 선택; 변경 시 속성 폼이 다시 빌드됨)
    - `자료명`, `자료설명`
    - `보안등급` 1~5 (PRD §7)
    - 첨부파일 (드래그&드롭, 첫 파일 자동 마스터 `M` 표기 — FR-LC-09)
    - `연결문서` (선택)
    - `[등록]` / `[취소]`
  - 청크 업로드 (R31 V-INF-2): 파일이 5MB 이상이면 자동 청크 (사용자 액션 0; "5MB 청크로 N분할 업로드" 안내 노출)
  - 일괄: Excel 템플릿 다운로드 → 메타 입력 → DWG + Excel 동시 드래그 → 매핑 미리보기 → `[등록]`
- **저장/완료 시그널:**
  - 토스트 "등록되었습니다" + 자동 redirect → `/objects/[id]`
  - 상태 뱃지 → `NEW` (slate)
  - 변환 작업이 큐에 적재되면서 우상단 알림(NotificationPanel)에 "변환 시작" — 변환 완료 시 다시 알림
  - 일괄: 진행률 토스트 (예: 23/100 완료) + 실패 항목 분리 리포트
- **자주 묻는 문제 / 권한 제약:**
  - "등록 버튼이 비활성이에요" → 폴더 `EDIT` 권한 필요 (FR-FOLDER-03)
  - "마스터파일을 바꾸고 싶어요" → 첨부 행에서 `[M]` 토글 (FR-LC-09)
  - "DWG가 클립보드에 안 떠요" → 변환 큐 진행 중. `/admin/conversions`에서 상태 확인(관리자 한정)
  - 일괄 등록 매핑 오류 시: Excel 템플릿 검증 결과를 행마다 표시 (rose 강조)
- **실제 페이지/컴포넌트 경로:**
  - 단건 등록 dialog: 본문 라운드에 폼 코드 위치 확인 (TBD: 등록 dialog 컴포넌트 명)
  - 청크 업로드: `apps/web/lib/chunk-upload.ts`, `<ChunkProgressBar>` (R31)
  - 첨부 첨부 dialog: `<AttachmentUploadDialog>` (R31 확장)
  - 발번 규칙 설정: `/admin/classes` (FR-ADM-04~07)
  - 변환 큐 모니터: `/admin/conversions` (R28)

---

### 챕터 4. 자료 라이프사이클 (체크아웃·체크인·개정·삭제·복원)

- **진입점:**
  - 자료 상세: `/objects/[id]`
  - 폐기함: `/admin/[section]?section=trash` 또는 좌측 트리 `폐기함` 노드
- **주요 액션:**
  - **체크아웃** (FR-LC-02): `[수정 시작]` 또는 `[체크아웃]` 버튼 → 상태 → `CHECKED_OUT` (amber)
    - 다른 사용자에게는 `🔒 체크아웃중 (홍길동)` 표시
  - **수정** (FR-LC-03): 메타·첨부·연결문서 변경 → 자동 저장 또는 `[저장]`
  - **체크인** (FR-LC-02): `[체크인]` → 상태 → `CHECKED_IN` (sky), 버전 +0.1
  - **개정 (Revision +1)** (FR-LC-05): 승인된 자료에서 `[개정]` → 새 revision으로 체크아웃 상태 진입
  - **결재 상신**: `[승인 요청]` 버튼 (다음 챕터 5에서 상세) — 내부적으로 `POST /api/v1/objects/[id]/release` (CHECKED_IN → IN_APPROVAL)
  - **삭제** (FR-LC-06): `[삭제]` → ConfirmDialog → 폐기함 이동, 상태 `DELETED` (stone)
  - **복원** (FR-LC-06): 폐기함 행 → `[복원]` → 원 폴더로
  - **영구 폐기**: 폐기함 행 → `[영구 폐기]` → username 일치 confirm (R29 패턴 차용)
  - **자료 이동** (FR-LC-08): `[이동]` → 폴더 picker → 도면번호 재발번 안내
  - **Rev 이력 등록** (FR-LC-07): 중간 누락 이력을 추가 (도면번호 변경 불가)
- **저장/완료 시그널:**
  - 모든 액션 → 토스트 + 상태 뱃지 색 변화 (DESIGN.md §2.1)
  - 우측 ActivityLog 패널 (R29 N-1로 wired) 갱신
  - 결재 상신 시 결재자에게 NotificationPanel 알림 도착
- **자주 묻는 문제 / 권한 제약:**
  - "체크아웃 버튼이 회색이에요" → 다른 사용자가 점유 중이거나 `EDIT` 권한 없음 — tooltip 사유 노출
  - "개정 버튼이 안 보여요" → 자료가 `APPROVED` 상태가 아님 (FR-LC-05 전제)
  - "결재 취소" → 결재 진행 전(IN_APPROVAL → 첫 결재자 액션 전)만 가능 (FR-APPR-05)
  - "본인이 등록한 자료는?" → 보안등급 무관 모든 권한 (FR-FOLDER-05)
- **실제 페이지/컴포넌트 경로:**
  - 상세: `apps/web/app/(main)/objects/[id]/page.tsx`
  - 상태 머신: `apps/web/lib/state-machine.ts` (CLAUDE.md R2 학습 — PM이 코드를 직접 읽고 매뉴얼에 옮길 것)
  - 권한 검사: `apps/web/lib/permissions.ts` `canAccess`
  - Mutation 패턴: `useObjectMutation` factory (R3a/b/c)
  - 폐기함 진입: `apps/web/app/(main)/admin/[section]/page.tsx?section=trash`

---

### 챕터 5. 결재 (상신·대기·완료·반려·결재취소)

- **진입점:**
  - 결재함: `/approval` (현재 placeholder; 본문 작성 시점 실 구현 확인)
  - 자료 상세에서 `[승인 요청]` (자료 측 진입)
  - NotificationPanel 결재 알림 클릭 → 해당 자료 상세
- **주요 액션:**
  - **상신** (FR-APPR-01): 자료 상세 → `[승인 요청]` → 결재선 템플릿 선택 또는 직접 지정 → 의견 입력 → `[상신]`
    - `<ApprovalLine>` 컴포넌트로 결재선 시각화
  - **결재 대기함**: 본인이 결재할 차례인 자료 list — `[승인]` / `[반려]` / `[의견 추가]`
  - **완료 결재함**: 본인이 처리 완료한 자료
  - **보낸 결재함**: 본인이 상신한 자료 (진행률·다음 결재자 표시)
  - **지운 결재함**: 결재 취소된 자료 (FR-APPR-05)
  - **반려** (FR-APPR-03): 사유 입력 의무 → 자료는 다시 `CHECKED_IN`으로 복귀, 상신자에게 알림
  - **결재 의견 + 서명** (FR-APPR-04): 의견 textarea + 서명 이미지(`/settings`에서 업로드해둔 이미지) 자동 첨부
  - **결재 알림** (FR-APPR-06): 이메일 + 인앱(NotificationPanel)
- **저장/완료 시그널:**
  - 상신 → 토스트 "결재 상신되었습니다" + 자료 상태 `IN_APPROVAL` (violet)
  - 최종 승인 → `APPROVED` (emerald) + Revision +1
  - 반려 → `REJECTED` (rose) → `CHECKED_IN`으로 복귀(상신자 입장)
- **자주 묻는 문제 / 권한 제약:**
  - "결재 상신 버튼이 회색이에요" → 자료가 `CHECKED_IN`이 아님 또는 본인 권한 없음
  - "결재선이 안 보여요" → 결재선 템플릿이 없는 폴더 — 관리자에게 추가 요청
  - "결재 취소가 안 됩니다" → 첫 결재자가 이미 처리한 경우 불가 (FR-APPR-05)
  - "그룹웨어 결재 시스템과 연동되나요" → Phase 2 (FR-APPR-07)
- **실제 페이지/컴포넌트 경로:**
  - 결재함: `apps/web/app/(main)/approval/page.tsx`
  - 결재선: `apps/web/components/ApprovalLine.tsx`
  - 결재 API: `apps/web/app/api/v1/approvals/`
  - 상신: `POST /api/v1/objects/[id]/release` (CLAUDE.md R2 명시)

---

### 챕터 6. 웹 뷰어 (확대·축소·측정·레이어·회전)

- **진입점:**
  - 자료 상세 좌측 큰 뷰포트 — 자동 로딩
  - 검색 결과 행 더블클릭
  - URL: `/objects/[id]` (auto-open)
- **주요 액션:**
  - **지원 포맷** (FR-VIEW-01): DWG, DXF, PDF, TIFF, JPG, PNG, GIF, BMP
  - **변환 캐시** (FR-VIEW-02/03): DWG → DXF 자동 변환, 캐시 결과 즉시 응답 (PRD §5.1 <500ms)
  - **확대/축소/팬** (FR-VIEW-04):
    - 휠 → 줌
    - 우클릭 드래그 → 팬
    - 더블클릭 → 부분 확대
    - `F` → 전체보기
  - **회전** (FR-VIEW-05): `R` 우 90° / `Shift+R` 좌 90° / `0` 원래 상태
  - **창 배열** (FR-VIEW-06): 단일 / 탭 / 분할 — 토글
  - **측정** (FR-VIEW-07):
    - `M` → 2점 거리
    - `Shift+M` → 다중점 거리
    - `A` → 사각/다각형 면적
    - 반경/각도는 Phase 2 (FR-VIEW-08)
  - **레이어 On/Off** (FR-VIEW-09): 우측 패널에 레이어 list, 체크박스
  - **문자 검색** (FR-VIEW-10): 뷰어 내 `Ctrl+F` → 도면 내 텍스트 검색
  - **배경 반전** (FR-VIEW-11): `B` 단축키 (검정↔흰색)
  - **선 가중치 / 속성창** (FR-VIEW-13): 우측 패널 토글
  - **폰트 누락 대체** (FR-VIEW-12): 자동 — 사용자 액션 없음. 알림 배너 "폰트 N개 대체됨"
- **저장/완료 시그널:**
  - 측정 결과는 좌측 하단 `<MeasurementOverlay>` 또는 status bar에 실시간 표시
  - 줌 리셋 / 측정 클리어 / 레이어 전체 표시 → 명시적 토스트 없이 즉각
  - 변환 미완료 시 `<ConversionStatusBadge>` "변환 중..." (R28)
- **자주 묻는 문제 / 권한 제약:**
  - "도면이 안 보여요 / 새카매요" → 변환 큐 대기 중일 가능성. 알림 종에서 변환 완료 알림 대기
  - "외주 폰트가 깨져요" → 자동 대체 폰트 매핑 적용 (FR-VIEW-12). 정확한 폰트 풀은 관리자에게 요청
  - "측정값이 이상해요" → 도면 단위(mm/inch) 확인. 측정은 도면 단위 기준
  - 보안등급 / 폴더 권한 부족 시 뷰어 진입 차단 (PRD §7)
- **실제 페이지/컴포넌트 경로:**
  - 뷰어 컴포넌트: `apps/web/components/DwgViewer/` (`scene.ts` 등)
  - 자체 DXF 파서: `apps/web/lib/dxf-parser/`, `apps/web/lib/viewer/`
  - 측정 hatch clip: `clipSegmentToHatch` (T-1 unit test 후보)
  - 변환 큐: BullMQ + ODA + LibreDWG subprocess (`apps/worker/`)
  - **단축키 도움말 dialog** (`?` 단축키): `apps/web/components/ShortcutsDialog.tsx` — 본문 작성 시 단축키 표를 이 컴포넌트와 1:1 동기화

---

### 챕터 7. 인쇄 / PDF 다운로드 (R31 P-1)

- **진입점:**
  - 자료 상세: 우상단 `[인쇄]` 버튼 또는 dropdown
  - 검색 결과 행 `⋯` 메뉴 → `인쇄`
  - 단축키 `⌘P` / `Ctrl+P` (자료 상세 한정 — 브라우저 기본 인쇄 가로채기)
- **주요 액션:**
  - **PrintDialog** (`<PrintDialog>` 480px 고정 폭, R31 §A.2):
    - CTB(플롯 스타일): `mono` 기본 / `A3 컬러` (FR-EXP-03)
    - 페이지 크기: A4/A3/Letter 등 (FR-EXP-04)
    - 방향: 세로/가로
    - `[PDF 생성]` → 진행률 표시 → 완료 시 `[다운로드]` 또는 `[브라우저 인쇄]` 분기
  - **이미 캐시된 PDF**: "이미 변환된 PDF가 있습니다 (3분 전)" + `[다운로드]` 즉시 활성화 (R31 시나리오 2)
  - **자료 다운로드** (FR-EXP-06): 원본 zip — 권한 별도(`download` 비트)
  - **다중 도면 일괄 PDF** (FR-EXP-02): 검색 결과 다중 선택 → 일괄 변환
- **저장/완료 시그널:**
  - 진행률 progress bar (속도 KB/s + ETA — R31 P-1과 V-INF-2 공통 컨벤션)
  - 완료 토스트 "PDF가 준비되었습니다"
  - 다운로드 시 파일명: `{도면번호}_{revision}.pdf`
- **자주 묻는 문제 / 권한 제약:**
  - "인쇄 버튼이 회색이에요" → 마스터 첨부가 없거나 `download` 권한 없음 (R31 §A.1 PM-DECISION-1: download = print 권한 동등)
  - "변환이 30초 넘게 걸려요" → 10MB 이상 도면은 PRD §5.1 SLA 외 — 잠시 대기 또는 `/admin/conversions` 모니터링
  - "Microsoft Print to PDF 의존이 빠졌나요" → 네, 서버측 변환 (FR-EXP-05)
  - 컬러로 인쇄하고 싶을 때: CTB를 `A3 컬러`로 변경
- **실제 페이지/컴포넌트 경로:**
  - PrintDialog: `apps/web/components/print/PrintDialog.tsx` (R31)
  - 진행률: `<ChunkProgressBar>` 재사용 (R31 utility)
  - 단축키 등록: `ShortcutsDialog.tsx` `P + ⌘ — 인쇄`
  - API: `POST /api/v1/attachments/[id]/print`, `GET /api/v1/print-jobs/[jobId]/status`

---

### 챕터 8. 폴더 즐겨찾기 / 핀 / 내 작업함

- **진입점:**
  - 좌측 폴더 트리 위 `즐겨찾기` 섹션
  - URL: `/workspace` (내 작업함, FR-MY)
- **주요 액션:**
  - **폴더 즐겨찾기 추가**: 좌측 트리에서 폴더 우클릭 → `즐겨찾기 추가` (FR-MY-01)
  - **폴더 핀**: 폴더 명 hover → `📌` 토글 (UX 컨벤션, 본문 라운드 확인)
  - **자료 담기**: 검색 결과 행 → `⋯` → `즐겨찾기 담기` 또는 자료 상세 → `[즐겨찾기]` (FR-MY-02)
  - **자료 빼기**: `/workspace`에서 자료 행 → `[빼기]`
  - 내 작업함 안에서도 뷰어/출력/PDF 사용 가능 (FR-MY-03)
- **저장/완료 시그널:**
  - 토스트 "즐겨찾기에 추가/제거되었습니다"
  - 좌측 사이드바 즐겨찾기 카운트 즉시 갱신
- **자주 묻는 문제 / 권한 제약:**
  - "다른 사람과 즐겨찾기를 공유할 수 있나요" → 아니오, 개인용
  - "권한이 회수된 자료는 즐겨찾기에서 어떻게 되나요" → 자료 자체는 list에 남아 있되 행에서 진입 시 권한 가드
- **실제 페이지/컴포넌트 경로:**
  - `/workspace`: `apps/web/app/(main)/workspace/page.tsx`
  - 폴더 트리: `apps/web/components/folder-tree/FolderTree.tsx`
  - API: TBD — 본문 라운드에 favorites 엔드포인트 확정 (현재 contract 미명시 영역)

---

### 챕터 9. 트랜스미털 / 로비함 (협력업체 도면 배포) (FR-LOBBY)

- **진입점:**
  - 협력업체 페르소나: 로그인 후 자동으로 `/lobby/[id]` 진입(다른 메뉴 숨김 — PRD §3.5)
  - 자사 페르소나: `/lobby` 트리에서 폴더 선택
- **주요 액션:**
  - **로비함 생성** (FR-LOBBY-02): 자사 측에서 `[+ 로비함 생성]` → 대상업체·만료기간·첨부파일 → 저장
  - **자동 폐기** (FR-LOBBY-03): 만료기간 도래 시 시스템 자동 (사용자 액션 0)
  - **로비함 검색** (FR-LOBBY-04): 키워드·등록일
  - **자료 활용** (FR-LOBBY-05): 뷰어/출력/PDF/다운로드
  - **확인 요청 / 재확인 요청** (FR-LOBBY-06): 협력업체 측에서 의견 입력 후 클릭 → 자사 결재선으로 흘러감
  - **확장자 제한** (FR-LOBBY-07): 뷰어 가능 확장자만 등록 허용
- **저장/완료 시그널:**
  - 로비함 생성 → 토스트 + 협력업체에 알림
  - 만료 임박 → 자사 관리자에게 알림 (인앱)
- **자주 묻는 문제 / 권한 제약:**
  - "협력업체가 다른 메뉴를 볼 수 있나요" → 아니오. 페르소나가 협력업체면 `/lobby/*`만 접근 (FR-AUTH-06 + layout-level guard)
  - "DWG 원본을 협력업체가 받을 수 있나요" → 폴더 권한·보안등급에 따름. 일반적으로 PDF만 노출
  - "확인 요청이 안 보내져요" → 자사 결재선이 매핑되어 있어야 함
- **실제 페이지/컴포넌트 경로:**
  - 로비함: `apps/web/app/(main)/lobby/page.tsx` + `[id]/page.tsx`
  - API: `apps/web/app/api/v1/lobbies/`
  - 협력업체 페르소나 가드: layout 코드 (TBD: 본문 라운드 확인)

---

### 챕터 10. 알림 / 활동 로그 (R29 N-1)

- **진입점:**
  - 헤더 우상단 `🔔 NotificationBell`
  - URL: `/notifications` (전체 list, TBD)
- **주요 액션:**
  - 종 클릭 → `<NotificationPanel>` 열림
  - unread 굵은 행 / read 일반 행
  - 행 클릭 → 자동 read 처리 + 해당 자료/결재 페이지로 이동 (R29 시나리오)
  - `[모두 읽음으로]` 버튼
- **저장/완료 시그널:**
  - 종 위 빨간 dot — unread 카운트 ≥ 1
  - read 처리 시 즉시 dot 사라짐
- **자주 묻는 문제 / 권한 제약:**
  - "알림이 안 와요" → `/settings`에서 알림 환경설정 확인 (이메일 on/off 등)
  - "어떤 이벤트에 알림이 오나요" → 결재 상신 / 결재 완료 / 변환 실패 / 권한 변경 등 — 본문 라운드에 표 작성
- **실제 페이지/컴포넌트 경로:**
  - `apps/web/components/notifications/NotificationPanel.tsx`
  - API: `GET /api/v1/notifications`, `PATCH /api/v1/notifications/[id]/read`
  - 라벨 매핑: `apps/web/lib/activity-labels.ts`

---

### 챕터 11. 자주 묻는 문제 (FAQ) — 단원 전반 종합

- 본문 라운드에서는 챕터 1~10에서 등장한 "자주 묻는 문제"를 한곳에 모은다.
- 카테고리: 로그인 / 검색 / 등록 / 변환 / 결재 / 인쇄 / 권한 / 협력업체.
- 각 항목은 1문 1답 형식, 해결 단계 3step 이내.

### 부록 A. 단축키 일람

`apps/web/components/ShortcutsDialog.tsx`와 1:1 동기화. 본문 작성자는 컴포넌트 내 단축키 list를 그대로 표 형식으로 옮긴다.

### 부록 B. 상태 뱃지 색 / 의미 일람

DESIGN.md §2.1 그대로 차용:

| Status | Color | 의미 |
|---|---|---|
| `NEW` | Slate | 신규 등록, 미결재 |
| `CHECKED_OUT` | Amber | 체크아웃 (잠금 중) |
| `CHECKED_IN` | Sky | 체크인 완료 |
| `IN_APPROVAL` | Violet | 결재 진행 중 |
| `APPROVED` | Emerald | 승인됨 |
| `REJECTED` | Rose | 반려됨 |
| `DELETED` | Stone | 폐기함 |

### 부록 C. 보안등급 1~5

PRD §7 표 그대로 차용 + 본인 등록 자료 예외 1줄 강조.

---

## B. 개발자 가이드 outline (DOC-4)

대상: `docs/manuals/developer-guide.ko.md`. contract §5.B의 8개 항목 + 0(시작)·9(테스트)·10(배포 미리보기) 추가.

각 항목은 본문에서 다음 3개 sub-section을 반드시 포함:
1. **한 줄 설명** — 신규 기여자가 이 시스템에서 어떤 역할을 하는지 30초 안에 이해
2. **주요 파일 경로** — 코드를 어디서 시작해 읽어야 하는가
3. **다음 라운드 작성용 hint** — 본문 작성 시 어떤 다이어그램이 필요한지, 어떤 파일을 발췌해야 하는지

---

### 1. monorepo 구조

- **한 줄 설명:** pnpm workspace 기반 모노레포. 웹 앱 + 워커 + 공유 패키지 3-pack.
- **주요 파일 경로:**
  - `pnpm-workspace.yaml`, `package.json` (root)
  - `apps/web/` — Next.js 14 App Router 프론트 + API routes
  - `apps/worker/` — BullMQ worker (DWG → DXF/PDF 변환)
  - `packages/shared/` — 양쪽이 공유하는 타입·유틸 (Zod 스키마, ErrorCode enum 등)
- **다음 라운드 작성용 hint:**
  - **다이어그램:** 3개 패키지 + Postgres + Redis + 파일 스토리지 + ODA/LibreDWG subprocess 화살표 — Mermaid `flowchart LR`
  - **발췌:** `pnpm-workspace.yaml`, `apps/web/package.json` 의 dependencies 섹션 5~10줄
  - **언급할 키워드:** "왜 worker가 별도 패키지인가" — GPL 격리(LibreDWG) + sharp/pdf-lib 시스템 의존
  - **참고:** `_workspace/api_contract.md` §2 (Dockerfile multistage) — 패키지 간 빌드 의존성

### 2. 환경 변수 (`.env.example` 참고)

- **한 줄 설명:** 모든 환경 변수의 의미와 기본값.
- **주요 파일 경로:**
  - `.env.example` (있으면; 없으면 R32 본문 라운드에 만들기 — `_workspace/api_contract.md` §2.1 참고)
  - `apps/web/lib/db-helpers.ts`, `apps/web/lib/auth-helpers.ts` (env 사용처)
- **다음 라운드 작성용 hint:**
  - 표: `이름 / 필수 / 기본값 / 의미 / 예시`
  - 카테고리: DB(`DATABASE_URL`) / Auth(`AUTH_SECRET`) / Redis(`REDIS_URL`) / Storage(`FILE_STORAGE_ROOT`) / 변환(`ODA_CONVERTER_PATH`, `LIBREDWG_DWG2DXF_PATH`) / 공개 URL(`NEXT_PUBLIC_BASE_URL`)
  - **시크릿 다루기:** AUTH_SECRET 생성법(`openssl rand -base64 32`), 절대 commit 금지
  - **컨벤션:** `NEXT_PUBLIC_*` prefix는 클라이언트 노출. 그 외는 서버만.

### 3. 로컬 개발 (postgres + redis docker compose dev)

- **한 줄 설명:** 1분 안에 동작하는 로컬 환경. Postgres 16 + Redis 7 → `pnpm dev`.
- **주요 파일 경로:**
  - `docker-compose.dev.yml` (개발용; 프로덕션은 `docker-compose.prod.yml` — R32 X-1.c)
  - `apps/web/prisma/seed.ts`
  - `apps/web/lib/demo-seed.ts`
- **다음 라운드 작성용 hint:**
  - **순서 코드 블록:**
    ```bash
    cp .env.example .env.local
    docker compose -f docker-compose.dev.yml up -d postgres redis
    pnpm install
    pnpm -F web prisma migrate deploy
    pnpm -F web prisma db seed
    pnpm dev
    ```
  - **함정 (CLAUDE.md 학습):** prisma generate 미실행 시 50+ phantom TS 에러 — `pnpm -F web prisma generate` 1회 실행 권장 (R3a/b/c 학습)
  - **데모 데이터:** `demo-seed.ts`의 페르소나별 계정 5종 표

### 4. Prisma schema 변경 절차

- **한 줄 설명:** Prisma Migrate (R27 D-1 baseline 도입). manual SQL은 baseline 이전만.
- **주요 파일 경로:**
  - `apps/web/prisma/schema.prisma`
  - `apps/web/prisma/migrations/`
  - `apps/web/prisma/README.md` (R27 정착)
- **다음 라운드 작성용 hint:**
  - **flow:** schema 수정 → `prisma migrate dev --name xxx` → 결과 SQL 검토 → commit
  - **운영 배포:** `prisma migrate deploy` (CI 또는 진입점 컨테이너에서)
  - **dryrun 검증:** R32 X-3 §3.6 jobs.migrations에 진입점 두기
  - **언급할 키워드:** baseline migration(R27), naming(snake_case `add_xxx`), DEFAULT 처리, NULL→NOT NULL 변경 시 backfill

### 5. 변환 파이프라인 (BullMQ + ODA + LibreDWG + pdf-lib)

- **한 줄 설명:** DWG → DXF/PDF 비동기 변환. ODA / LibreDWG는 subprocess(GPL 격리) only.
- **주요 파일 경로:**
  - `apps/worker/src/` (job processors)
  - `apps/web/lib/conversion-queue.ts`
  - `apps/web/app/api/v1/admin/conversions/` (관리자 모니터 API)
  - `apps/web/app/(main)/admin/conversions/page.tsx` (R28 모니터)
- **다음 라운드 작성용 hint:**
  - **다이어그램 (Mermaid sequenceDiagram):** Web POST → Redis(BullMQ enqueue) → Worker pop → ODA/LibreDWG subprocess → 결과 파일 저장 → DB Attachment row 갱신 → web polling(/admin/conversions)
  - **상태 머신:** `pending → running → completed | failed | retrying`
  - **재시도:** R28 jobs `[id]/retry` 라우트 발췌
  - **GPL 격리 강조:** "GPL 라이브러리(LibreDWG)는 절대 JS import하지 않는다. subprocess only" (CLAUDE.md 라이선스 정책)

### 6. 자체 DXF 뷰어 (`lib/dxf-parser` + `components/DwgViewer`)

- **한 줄 설명:** three.js + 자체 DXF 파서로 브라우저 직접 렌더 (1순위 단계). dxf-viewer npm 의존 점진 제거 중.
- **주요 파일 경로:**
  - `apps/web/lib/dxf-parser/`
  - `apps/web/lib/viewer/`
  - `apps/web/components/DwgViewer/scene.ts`, `clipSegmentToHatch` 등
  - `.claude/skills/viewer-engineering/` (도메인 가이드)
- **다음 라운드 작성용 hint:**
  - **레이어 다이어그램:** DXF 파서 → BufferGeometry → three.js Scene + OrthographicCamera → Canvas
  - **성능 팁:** BufferGeometry 재사용, frustum culling, viewport-aware lazy load
  - **구현 단계 명시:** PRD/CLAUDE.md에 "단계 1 = DWG 뷰어 자체 구현" 강조 — 본 가이드는 이 단계 1의 핵심
  - **viewer-engineering 스킬 참조:** `.claude/skills/viewer-engineering/SKILL.md` 그대로 인용 + 신규 기여자 진입로

### 7. 권한 모델 (FolderPermission + canAccess)

- **한 줄 설명:** 폴더 단위 비트 권한(VIEW/EDIT/DELETE/APPROVE/DOWNLOAD/PRINT 등)을 USER/ORG/GROUP principal에 부여. 본인 등록 자료는 등급 무관 모든 권한.
- **주요 파일 경로:**
  - `apps/web/lib/permissions.ts` (`canAccess` — T-1 unit test 후보)
  - `apps/web/prisma/schema.prisma` `FolderPermission` 모델
  - `apps/web/app/(main)/admin/folder-permissions/page.tsx` (R28 매트릭스)
  - `apps/web/components/permission-matrix/PermissionMatrix.tsx`
- **다음 라운드 작성용 hint:**
  - **표 (PRD §4.2):** 비트 8종 + 의미
  - **결정 로직 의사코드 5~10줄:** principal 우선순위(USER > GROUP > ORG), 본인 등록 자료 예외, 슈퍼관리자 bypass
  - **테스트 후보:** `canAccess` 분기 (R32 T-1 §4 명시) — 발췌 + 단위 테스트 1건 예시 코드 7줄
  - **R28 매트릭스 UX:** dirty/new/removed `border-l-2` + `▴N 변경` 카운터 패턴 그대로 활용

### 8. drawing-mgmt-team 하네스 (5인 팀 worktree 격리)

- **한 줄 설명:** PM(Claude 메인) + designer + frontend + backend + viewer-engineer 5인이 worktree 격리 병렬로 작업 → PM이 main에 통합. 디자인 → API 계약 → 병렬 구현 → QA.
- **주요 파일 경로:**
  - `.claude/agents/drawing-mgmt-{pm,designer,frontend,backend,viewer-engineer}.md`
  - `.claude/skills/drawing-mgmt-team/SKILL.md`
  - `.claude/skills/viewer-engineering/SKILL.md`
  - `_workspace/api_contract.md` (라운드별 single source of truth)
  - `docs/_specs/r{N}_*.md` (designer 산출물; git tracked)
- **다음 라운드 작성용 hint:**
  - **다이어그램:** Phase 1 PM 분해 → Phase 2 contract → Phase 3 4명 병렬 worktree → Phase 4 PM 통합/검증 → Phase 5 QA
  - **재발 학습 인용:** CLAUDE.md `변경 이력` 표 R1~R30 사례 (특히 `_workspace/` git tracked 강제, base SHA 검증, main working tree clean 검증)
  - **신규 기여자 진입로:** "처음 한 라운드는 PM 호출만 따라가 본다" — 추천 시나리오
  - **의무 가드 표:** 시작 시 `git fetch + ff-only`, 종료 시 commit, isolation 절대 위반 금지

### 9. 테스트 (R32 T-1 도입)

- **한 줄 설명:** vitest 단위 테스트 + 점진적 e2e (Playwright). FE 위주.
- **주요 파일 경로:**
  - `apps/web/vitest.config.ts` (R32 T-1)
  - `apps/web/__tests__/` 또는 colocate `*.test.ts`
  - `_workspace/api_contract.md` §4 — 샘플 5~10건 후보 list
- **다음 라운드 작성용 hint:**
  - **첫 5건:** `permissions.canAccess`, `clipSegmentToHatch`, `chunk-upload`, `activity-labels`, `state-machine` (R3a 학습)
  - **컨벤션:** AAA 패턴(Arrange-Act-Assert), happy-dom 환경, `@testing-library/react` 사용
  - **CI 통합:** R32 X-3 jobs.test-unit 발췌
  - **e2e는 Phase 2:** Playwright는 manual trigger only (시간 비용)

### 10. 배포 (R32 X-1 docker-compose) — 미리보기 only, 본격 운영 문서는 §C

- **한 줄 설명:** docker-compose.prod.yml 단일 파일로 web + worker + postgres + redis 기동.
- **주요 파일 경로:**
  - `apps/web/Dockerfile` (R32 X-1.a)
  - `apps/worker/Dockerfile` (R32 X-1.b)
  - `docker-compose.prod.yml` (R32 X-1.c)
  - `.github/workflows/ci.yml` (R32 X-3)
- **다음 라운드 작성용 hint:**
  - 본 가이드는 개발자가 PR을 보내기 위한 환경 — 운영 진수는 §C로
  - 1쪽 요약: `docker compose -f docker-compose.prod.yml up -d` + healthcheck 확인 + smoke test 절차

---

## C. 운영 문서 outline (보너스)

대상: `docs/manuals/operations.ko.md`. 운영자(슈퍼관리자 + 1인 유지보수자) 대상.

각 항목은 본문에서 (1) 트리거 / (2) 절차 코드 블록 / (3) 검증 / (4) 롤백 4-step.

### C.1 배포 절차 (`docker compose up + migration`)

- **트리거:** 신규 릴리스(main → prod tag), 또는 hotfix.
- **절차 (코드 블록):**
  ```bash
  ssh prod-server
  cd /opt/drawing-mgmt
  git pull origin main
  docker compose -f docker-compose.prod.yml pull
  docker compose -f docker-compose.prod.yml run --rm web pnpm -F web prisma migrate deploy
  docker compose -f docker-compose.prod.yml up -d --remove-orphans
  ```
- **검증:**
  - `docker compose ps` — 모든 서비스 healthy
  - `curl https://{host}/api/v1/health` — 200
  - 스모크 테스트: 로그인 → 검색 1건 → 자료 상세 → 뷰어 렌더
- **롤백:**
  - 직전 main commit으로 `git reset --hard {sha}` → `docker compose up -d`
  - migration 롤백은 별도 — Prisma Migrate `down`이 없으므로 backup에서 복원 (다음 항목 참고)

### C.2 백업 / 복구

- **트리거:** 일 1회 cron (DB), 주 1회 (파일 스토리지) — PRD §5.2.
- **절차:**
  - DB: `docker compose exec postgres pg_dump -U postgres drawing_mgmt | gzip > {date}.sql.gz`
  - 파일: `rsync -av {FILE_STORAGE_ROOT}/ {NAS}/drawing-mgmt-files/` (PRD §5.2)
  - cron 등록 위치 + 보존 기간(접속로그 90일, 작업로그 1년 — PRD §5.2)
- **검증:**
  - 백업 파일 사이즈 비교 (전일 대비 +-10% 이상 변동 시 알림)
  - 월 1회 복원 dryrun: 별도 staging postgres에 restore → 행 수 비교
- **롤백:**
  - 복원: `gunzip < {date}.sql.gz | docker compose exec -T postgres psql -U postgres drawing_mgmt`
  - **RTO 4시간 / RPO 24시간** (PRD §5.2) 명시

### C.3 장애 대응 (큐 stuck, 변환 실패, DB 연결 끊김)

- **트리거:**
  - `/admin/conversions` `FAILED` 카운트 급증
  - 변환 30초 SLA 초과 (PRD §5.1)
  - DB 연결 에러 토스트 다발
- **절차:**
  - **큐 stuck:**
    - `docker compose logs worker --tail=100` 확인
    - Redis flush queue (실패 한정): `docker compose exec redis redis-cli LRANGE bull:conversion:failed 0 -1`
    - `[전체 재시도]` 버튼 (R28; TBD: 일괄 재시도 UI는 본문 라운드에 명시)
  - **변환 실패 (개별):**
    - `/admin/conversions` 행 펼쳐서 errorMessage 확인
    - 흔한 원인: 폰트 누락, ODA 라이선스, 손상 DWG, 파일 권한 (`chown`)
    - 행별 `[재시도]` (R28)
  - **DB 연결 끊김:**
    - `docker compose ps postgres` healthy 확인
    - `docker compose restart postgres` (백업 후 신중)
- **검증:**
  - `/admin/conversions` `FAILED` → 0
  - `/api/v1/health` 200
- **롤백:** 큐 데이터 손실 시 백업에서 작업 메타 복원 (BullMQ는 stateless — Redis dump only)

---

## D. 본문 라운드(다음) 작업 분배 권고

| 산출물 | 권장 담당 에이전트 | 입력 | 예상 분량 |
|---|---|---|---|
| `docs/manuals/user-manual.ko.md` 본문 | designer (텍스트 정확성) + frontend (스크린샷·실제 라벨 검증) | 본 outline §A | ~25~30쪽 |
| `docs/manuals/developer-guide.ko.md` 본문 | backend + frontend + viewer-engineer 3인 분담 | 본 outline §B | ~15~20쪽 |
| `docs/manuals/operations.ko.md` 본문 | backend (운영 배포 친숙) | 본 outline §C | ~5~7쪽 |
| 스크린샷 캡처 | frontend (실제 화면 띄워서 캡처) | 본 outline §A 챕터별 ▶ 표시 자리 | ~30장 |
| PDF export | designer 또는 backend (Pandoc 또는 mdBook 설정) | 위 3 markdown | 1회 빌드 |

각 챕터의 권한 제약은 코드(`apps/web/lib/permissions.ts`, `apps/web/lib/state-machine.ts`)를 직접 읽고 옮긴다 — CLAUDE.md R2 학습("이름만 보고 추측 금지").

---

## E. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-04-27 | 초기 outline 작성 (R32). DOC-2 9 챕터 + 0/10/11/부록 / DOC-4 8항목 + 0/9/10 / 운영 문서 보너스 §C. 본문 작성은 다음 라운드. |
