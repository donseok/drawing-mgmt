# drawing-mgmt — 프로젝트 컨텍스트 + 하네스

동국씨엠 도면관리시스템 재구축. 1인 단독 / 4주 / 바이브코딩 / 무료 SW.

## 프로젝트 핵심 (반드시 숙지)

- **도메인:** 냉연강판 사내 도면관리 (DWG/DXF/PDF). AutoCAD 미설치 사용자도 브라우저에서 도면을 봐야 함이 1순위.
- **현 단계 최우선:** **자체 DWG 뷰어 구현** (LibreDWG subprocess + three.js 직접 렌더). 기존 `dxf-viewer` npm 의존을 점진 교체 중.
- **단계 순서 (사용자 확정 2026-04-24):** (1) 지금 = DWG 뷰어 자체 구현 → (2) 폴더 좌측 메뉴 + 사용자 커스터마이즈 → (3) 추가 작업.
- **라이선스 정책 (절대 위반 금지):**
  - 유료 SDK/API 금지 (ODA Teigha 등). 오픈소스만.
  - **GPL 라이브러리(LibreDWG)는 서버 subprocess(`dwg2dxf` CLI)로만 호출.** JS 바인딩 import는 GPL 전염을 일으키므로 금지. 웹 앱 코드는 MIT/Apache 유지.
- **스택:** Next.js 14 App Router + TS / Prisma + Postgres 16 / Auth.js v5 / Tailwind + shadcn/ui / TanStack Query + Zustand + RHF + Zod / BullMQ + Redis. monorepo: `apps/web`, `packages/shared`.
- **상세 문서:** `docs/PRD.md`, `docs/TRD.md`, `docs/WBS.md`, `docs/DESIGN.md`.

## 하네스: drawing-mgmt 5인 팀

**목표:** PM(=Claude 메인 세션) + designer + frontend + backend + viewer-engineer 5인이 worktree 격리 병렬로 작업하고 PM이 통합. 디자인 → API 계약 → 병렬 구현 → 점진 QA 흐름.

**트리거:** drawing-mgmt 프로젝트 안에서 기능 추가·버그 수정·디자인 개편·뷰어 개발·"이어서 작업" 같은 요청이 오면 `drawing-mgmt-team` 스킬 사용. 단일 파일 미세 수정에는 사용 안 함. 범용 `fullstack-web-orchestrator`와 분리 — 이 하네스는 LibreDWG 격리·three.js 자체 뷰어 같은 도메인 컨텍스트를 프리로드.

**핵심 운영 원칙:**
- 모든 에이전트는 반드시 `isolation: "worktree"`로 호출 (메모리 `feedback_agent_isolation.md`).
- 모든 에이전트 호출에 `model: "opus"` 명시.
- API 계약(`_workspace/api_contract.md`)을 먼저 쓰고 코드는 그다음. FE/BE drift의 단일 예방선.
- `_workspace/`는 `.gitignore` 등록 (커밋 안 됨).

**구성 파일:**
- 에이전트 정의: `.claude/agents/drawing-mgmt-{pm,designer,frontend,backend,viewer-engineer}.md`
- 오케스트레이터 스킬: `.claude/skills/drawing-mgmt-team/`
- 뷰어 도메인 가이드: `.claude/skills/viewer-engineering/`

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-04-25 | 글로벌 CLAUDE.md에 하네스 등록 (PM/FE디자이너/FE개발/BE개발 4인) | 글로벌 인덱스 | 초기 구성 의도 |
| 2026-04-26 | 실 파일 신규 구축: 5개 에이전트 + drawing-mgmt-team + viewer-engineering 스킬 | 전체 | 글로벌 등록만 있고 실체 파일이 누락된 drift 해소. 뷰어 단계 1순위 반영해 viewer-engineer 추가(4→5인). worktree 격리 원칙을 오케스트레이터에 명문화. |
| 2026-04-26 | worktree 동기화 가드 + commit 의무 가드 추가 | drawing-mgmt-team SKILL.md, pm/frontend/backend/viewer/designer .md | R1 첫 실행에서 발견: Agent 도구의 worktree가 과거 commit에서 분기되어 main(fe-1/fe-2/refactor 머지) 뒤에 있었고, 에이전트가 commit 안 하고 종료. 머지 abort + 수동 포팅으로 우회. 재발 방지: (1) 에이전트 호출 prompt에 시작 시 `git merge --ff-only main` 또는 `git rebase main` 의무 + 종료 시 commit 의무, (2) PM 측 Phase 4에 base/commit/diff 규모 3중 검증. |
| 2026-04-26 | PM 작업 원칙 1-1 추가: 기존 엔드포인트 의미는 코드(route.ts + state-machine.ts) 직접 읽고 옮기기 | drawing-mgmt-pm.md | R2 실행 중 발견: PM이 `/api/v1/objects/[id]/release`를 이름만 보고 "잠금 해제"로 추측해 contract에 적었으나 실제는 결재 상신(`CHECKED_IN → IN_APPROVAL`). FE가 contract대로 "개정 취소" 버튼을 wire해 클릭 시 `INVALID_TRANSITION` 에러 발생 위험. 사후 한 줄 disable로 회피. 재발 방지: contract 작성 시 "아마/~인 듯" 어휘 금지, 모호하면 `TBD` + BE agent 질의 카드. |
| 2026-04-26 | Worktree isolation 가드 추가 (cwd 이동/main 직접 조작 금지) + PM Phase 4에 isolation 검증 추가 | drawing-mgmt-team SKILL.md, frontend/backend/viewer .md | R3a 실행 중 발견: backend agent의 commit이 worktree branch tip이 아닌 main에 직접 ff됨 (`worktree-agent-aebcc42c` tip은 base SHA 그대로). 결과는 OK였으나 격리 위반. 가드: agent prompt에 "본인 worktree 외 cwd 이동 금지, main 직접 manipulate 금지, 너의 commit은 worktree branch tip에만 존재" 명시. PM Phase 4에 "main HEAD가 Phase 3 시작 시점과 같은지" 검증 추가 (PM이 머지 안 했는데 main 변했으면 격리 위반 의심). |
| 2026-04-26 | Mutation 패턴 가이드 + TanStack v5 컨벤션 + prisma generate 메모 추가 | drawing-mgmt-frontend.md, drawing-mgmt-team SKILL.md | R3a/R3b/R3c 학습: 두 패턴(detail용 `useObjectMutation` factory, grid용 `rowMutation` discriminated union)이 자연 도출. Optimistic update + Bulk action 컨벤션도 정착. 다음 라운드 일관성을 위해 frontend.md에 "Mutation 패턴 가이드" 섹션 신설. v5의 `keepPreviousData` 옵션 deprecation도 명시. SKILL.md에 backend agent 호출 시 worktree에서 `prisma generate` 한 번 실행 메모(부트스트랩 50+ phantom 에러 방지). |
| 2026-04-27 | Designer 산출물 git tracked 강제 + PM Phase 4에 `pnpm install` 동기화 가드 추가 | drawing-mgmt-designer.md, drawing-mgmt-team SKILL.md | R28 실행 중 발견: (1) designer가 산출물을 `_workspace/`(.gitignore)에만 두자 worktree에 코드 변경이 없어 Agent runtime이 worktree 자동 정리 → spec 파일 손실. designer 재호출 + spec을 `docs/_specs/r28_*.md`(git tracked)에 commit하는 패턴으로 우회. 재발 방지: designer 에이전트는 산출물을 반드시 git tracked 경로(`docs/_specs/`)에 commit. (2) PM 메인 트리의 node_modules가 sub-agent worktree와 비동기 상태였는데(R27의 `@asteasolutions/zod-to-openapi` 미설치) 통합 typecheck에서만 발견. 재발 방지: PM Phase 4 머지 직전 `pnpm install --frozen-lockfile` 1회 실행. (3) backend가 contract의 `E_RATE_LIMITED`를 기존 `E_RATE_LIMIT`로 자연 정정 — contract 작성 시 기존 ErrorCode enum 먼저 grep해 컨벤션 충돌 회피. |
| 2026-04-27 | Worktree base SHA 검증 강화 + agent prompt에 첫 응답 검증 단계 추가 | drawing-mgmt-{frontend,backend,viewer-engineer}.md, drawing-mgmt-team SKILL.md | R29 실행 중 발견: backend agent의 worktree가 `git fetch + ff-only` 가드 누락으로 R28 시작 시점(`357f951`)에서 분기됨. 영역이 R28과 겹치지 않아 3-way merge로 통합은 됐지만(R28 변경은 main이 retain), `withApi` 같은 R28 산출물을 모르는 채 작업 → 신규 라우트가 CSRF/Rate limit wrapper 미적용. 재발 방지: (a) Phase 3 prompt 초입에 base SHA를 명시("동기화 후 main HEAD = `XXXXXXX`이어야 정상")는 이미 있으나, (b) agent가 첫 응답에서 `git rev-parse HEAD`로 SHA 확인 후 진행하도록 강제, (c) PM Phase 4에 `git merge-base`가 R29 시작 SHA와 일치하는지 검증을 강화(현재는 isolation만 체크). |
| 2026-04-27 | PM Phase 4 머지 직전 main working tree clean 검증 의무화 | drawing-mgmt-team SKILL.md | R30 designer + R31 backend 둘 다 sandbox snapshot 사고 또는 우발적 격리 위반으로 main 트리에 산출물 누출. R30은 designer 자체 회복(보고에 명시), R31은 PM이 머지 abort 발견 후 `git checkout --` + `rm -rf` 정리 후 재머지로 복구. 격리 가드 prompt 강화만으로는 sandbox 사고 회피 어려움 — Phase 4 첫 단계에 `git status --short`로 main 트리에 untracked/modified가 worktree 산출물 leak인지 점검하고, 발견 시 정리 후 정상 머지하는 절차를 명문화. |
