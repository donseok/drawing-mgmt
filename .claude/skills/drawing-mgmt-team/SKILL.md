---
name: drawing-mgmt-team
description: drawing-mgmt(동국씨엠 도면관리시스템) 프로젝트 전용 5인 팀 오케스트레이터. 사용자가 이 프로젝트 안에서 "기능 추가", "버그 수정", "디자인 개선", "뷰어 개발", "API 추가", "재구현", "이어서 작업해줘", "BUG-XXX 처리" 같은 요청을 하면 반드시 이 스킬을 사용한다. PM이 요구사항을 분해해 designer/frontend/backend/viewer-engineer를 worktree 격리로 병렬 호출하고 main으로 통합한다. 단일 파일 미세 수정에는 사용하지 않는다. 범용 fullstack-web-orchestrator와 다르게 이 스킬은 drawing-mgmt 도메인 컨텍스트(LibreDWG 격리, three.js 자체 뷰어 우선 단계 등)를 프리로드한다.
---

# drawing-mgmt 5인 팀 오케스트레이터

drawing-mgmt 프로젝트 전용. PM(=너) + designer + frontend + backend + viewer-engineer 5인 팀이 worktree 격리 병렬로 일하고 PM이 통합한다.

## 트리거

이 스킬은 다음 상황에서 동작한다:
- drawing-mgmt 프로젝트 내에서 기능 추가·버그 수정·디자인 개편·뷰어 작업 요청
- "BUG-XXX 처리해줘", "검색에 필터 추가", "뷰어 측정 도구 만들어줘" 같은 단위 작업
- "재실행", "이어서", "수정본 다시", "지난 산출물 개선" 같은 후속 작업
- "리팩터링 전 정리", "API 추가" 같은 코드/제품 단위 변경

다음에는 동작하지 않는다:
- 단일 파일 한두 줄 수정
- 단순 정보 질문 (사실 확인)
- drawing-mgmt 외 프로젝트 (그 경우는 범용 `fullstack-web-orchestrator` 또는 직접 처리)

## 실행 모드

**서브 에이전트 + worktree 격리** (메모리 `feedback_agent_isolation.md`).

이유:
- 사용자가 "에이전트팀은 각자의 분할창을 가진다"라고 명시 (2026-04-25 확정)
- TeamCreate는 세션당 1팀이라 5명 동시 worktree 격리와 어색함
- PM(메인 세션)이 `Agent` 도구로 각 전문가를 `isolation: "worktree"`로 띄우고, 각 worktree의 diff를 main으로 통합하는 흐름이 깔끔

모든 Agent 호출에 `model: "opus"`와 `isolation: "worktree"`를 명시한다.

## Phase 0: 컨텍스트 확인 (재실행 판별)

워크플로우를 시작하기 전 먼저 `_workspace/`를 확인:
- **`_workspace/`가 존재 + 사용자가 "이어서/재실행/부분 수정"** → 부분 재실행. 해당 에이전트만 재호출, 이전 산출물 입력으로 전달.
- **`_workspace/`가 존재 + 사용자가 새 기능 요청** → `_workspace_prev_{YYYYMMDD}/`로 이동 후 새로 시작.
- **`_workspace/`가 없음** → 초기 실행.

또한 `.claude/worktrees/`에 살아있는 agent worktree가 있으면 어떤 에이전트의 어떤 작업이었는지 git log로 확인. 재사용 가능하면 재사용, 아니면 정리(사용자에게 확인 후).

## Phase 1: 요구사항 분해 + API 계약 (PM, 메인 세션)

PM(=너) 본인이 메인 세션에서 직접 수행:

1. 사용자 요청을 읽고 영향 범위 파악 (어떤 페이지·API·DB 모델·뷰어 부분이 바뀌는가)
2. **메모리 확인:**
   - `project_drawing_mgmt.md` — 단계 순서·라이선스 제약 위반하는지
   - `feedback_agent_isolation.md` — worktree 격리 원칙
3. 기능 카드 목록 작성 (TaskCreate로 추적)
4. **API 계약 초안** 작성 → `_workspace/api_contract.md`
   - 글로벌 스킬 `api-contract-schema`가 정의한 형식을 따른다
   - 신규/수정 엔드포인트, 요청/응답 shape, 에러 코드, 권한
   - Prisma 모델 변경이 있으면 변경 요약
   - zod schema는 `packages/shared/src/schemas/`에 둘 것을 명시
5. 사용자에게 분해 결과 + 영향 범위 요약 보고하고, 큰 변경이면 동의 받기

## Phase 2: 디자인 스펙 (designer, 병렬 가능)

```
Agent({
  subagent_type: "drawing-mgmt-designer",
  isolation: "worktree",
  model: "opus",
  prompt: "..." // 기능 카드 + 참조 문서 경로 + 출력 파일 경로
})
```

API 계약과 동시에 진행 가능. designer는 코드 안 짜고 `_workspace/design_spec_*.md`만 쓴다.

## Phase 3: 구현 (frontend / backend / viewer-engineer 병렬)

API 계약과 디자인 스펙이 확정되면 세 에이전트를 동시 호출 (한 메시지 안에 세 Agent 호출):

```
[Agent(drawing-mgmt-frontend, isolation=worktree, run_in_background=true), 
 Agent(drawing-mgmt-backend,  isolation=worktree, run_in_background=true),
 Agent(drawing-mgmt-viewer-engineer, isolation=worktree, run_in_background=true)]
```

### Phase 3 호출 전 PM 체크리스트

1. **main HEAD 기록** — 호출 직전 `git rev-parse main`으로 SHA를 메모. Phase 4에서 worktree base가 이 SHA인지 검증한다.
2. **각 prompt에 다음 5개 블록을 반드시 포함:**
   1. 기능 카드 요약
   2. **워크트리 동기화 지침** (아래 "Worktree 동기화 가드" 섹션을 그대로 복붙)
   3. 입력 파일 경로 (`_workspace/api_contract.md`, `_workspace/design_spec_*.md`, `_workspace/viewer_spec.md` 중 해당)
   4. 작업 범위 (어디까지 만지고 어디는 만지지 마는지)
   5. **종료 시 commit 의무 + 검증 명령** (아래 "Commit 의무 가드" 섹션을 그대로 복붙)

### Worktree 동기화 가드 (모든 구현 에이전트 prompt에 복붙)

> ## ⚠️ 작업 시작 전 worktree 동기화 (필수)
> 너의 worktree는 main의 **최신 HEAD가 아닌 과거 commit**에서 분기됐을 수 있다. 작업을 시작하기 전 다음을 실행해서 main과 동기화해라:
>
> ```bash
> git fetch  # 안전, 무해
> # 다음 중 하나:
> git merge --ff-only main   # fast-forward 가능하면 즉시 동기화
> # 또는 fast-forward 불가능 (즉 worktree에 이미 다른 커밋이 있으면):
> git rebase main            # 위에 얹기
> ```
>
> rebase 충돌이 나면 작업 보류하고 PM에게 보고. 임의 충돌 해결 금지 — main 머지 이력의 의미를 모르면 의도 충돌이 난다.
>
> 동기화 후 `git log --oneline main..HEAD`가 비어 있어야 정상(아직 너의 커밋 0개). 비어있지 않으면 이전 세션의 잔여물이니 PM에게 보고.

### Commit 의무 가드 (모든 구현 에이전트 prompt에 복붙)

> ## ⚠️ 작업 종료 직전 commit (필수)
> 작업이 완료되면 반드시 다음을 실행하고 종료해라:
>
> ```bash
> git add <변경 파일들>             # `git add -A`보다 명시적 staging 권장
> git commit -m "..."              # conventional commit 메시지
> git log --oneline -1             # 너의 커밋이 HEAD인지 확인
> ```
>
> commit 메시지 형식:
> - `fix(web): BUG-XX 한 줄 요약` 또는 `feat(web): 기능 한 줄 요약`
> - 본문에 변경 의도(왜) — 줄당 ~80자
> - 마지막 줄에 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
>
> **uncommitted 상태로 종료 금지.** PM은 너의 worktree 브랜치를 머지하는 거지 staged/unstaged 상태를 줍는 게 아니다.

뷰어 작업이 없는 카드면 viewer-engineer 호출 생략. 디자인 변경이 없는 카드면 designer 생략.

## Phase 4: 통합 + 점진 QA (PM)

각 에이전트 결과 수신 후:

1. **base 검증 (가장 먼저)** — `git merge-base main worktree-agent-XXX`가 Phase 3 시작 시 기록한 main SHA와 일치하는지 확인. 더 과거면 에이전트가 동기화 가드를 안 따른 것 → 에이전트 재호출(동기화 명시 후) 또는 PM이 직접 worktree에서 `git rebase main` 후 진행.
2. **commit 검증** — `git log --oneline main..worktree-agent-XXX`로 에이전트가 commit했는지 확인. 비어있으면 에이전트가 commit 누락 → 부분 재호출. PM이 직접 commit하지 말 것 (의도 추적 어려워짐).
3. **diff 읽기** — `git diff main..worktree-agent-XXX --stat` 으로 변경 파악. 의도와 무관한 광범위 diff(수십 파일/수천 라인 추가/삭제)면 base 문제이므로 1로 돌아가라.
4. **머지 순서:** backend → viewer-engineer → frontend (의존 방향대로). 가능하면 `git merge --no-ff worktree-agent-XXX -m "merge ..."`로 머지 커밋 보존.
5. **충돌 해결:** 같은 파일을 여러 명이 만진 경우 PM이 직접 봉합. 의미 충돌이면 계약 다시 쓰고 부분 재실행. 진단 불가 규모의 충돌이면 abort 후 수동 포팅(`git merge --abort` + 한 파일씩 적용).
6. **점진 QA** (각 머지 직후 즉시):
   - `pnpm -F web typecheck`
   - 응답 shape ↔ 훅 기대 타입 일치 (`packages/shared` 공유 타입 import 일관성 확인)
   - Auth/Authz 가드 누락 없는지
   - 뷰어 작업이면 실제 .dwg 샘플로 빌드 후 Chrome에서 렌더 확인 (가능하면)
5. 회귀 발생 시 해당 에이전트만 부분 재호출

## Phase 5: 사용자 보고 + 피드백 수집

- 무엇을 바꿨는지 짧게 (이상적으로 ≤ 10줄)
- 검증 결과 (typecheck/build pass/fail)
- 남은 작업 (있으면)
- "추가로 고치고 싶은 부분 있으세요?" 1줄 질문 (강요는 X)

피드백이 다음 패턴 중 하나면 하네스 자체를 진화:
- 같은 종류 피드백 2회 이상 → 에이전트 정의 업데이트
- 자주 누락되는 검증 → Phase 4 체크리스트 보강

## 데이터 전달 규칙

| 산출물 | 위치 | 작성자 | 독자 |
|--------|------|--------|------|
| API 계약 | `_workspace/api_contract.md` | PM | frontend, backend, (viewer) |
| 디자인 스펙 | `_workspace/design_spec_{feature}.md` | designer | frontend |
| 뷰어 스펙 | `_workspace/viewer_spec.md` | viewer-engineer | frontend, PM |
| 통합 노트 | `_workspace/integration_notes.md` | PM | (감사 추적) |
| 코드 변경 | 각 worktree → main | 구현 에이전트 → PM | git |

`_workspace/`는 `.gitignore`에 등록 (커밋되지 않음). 산출물 보존은 사후 검증용.

## 에러 핸들링

| 상황 | 대응 |
|------|------|
| 에이전트 typecheck 실패 | 1회 부분 재호출. 재실패 시 사용자 보고 |
| API 계약 위반 발견 | 계약 정정 → frontend/backend 양쪽 부분 재호출 |
| worktree 머지 충돌 | PM이 해결. 의미 충돌이면 계약 재작성 |
| 사용자가 단계 순서 어김 (예: 뷰어 미완 상태에서 폴더 메뉴 작업 요청) | 메모리의 단계 순서 명시 후 사용자 의사 재확인 |
| GPL 라이브러리가 웹 앱에 link되려 함 | 즉시 중단, subprocess 격리 재설계 |

재시도 1회 원칙. 재실패 시 보고서에 누락 명시 후 사용자 결정 위임.

## 테스트 시나리오

### 정상 흐름 — "검색 결과에 자료유형 필터 추가"

1. PM 본인이 `apps/web/app/(main)/search/page.tsx`와 검색 API 라우트를 읽어 영향 파악
2. PM이 `_workspace/api_contract.md`에 `GET /api/search?type=...` 스펙 추가
3. designer 호출 → `_workspace/design_spec_search_filter.md`
4. frontend + backend 병렬 호출 (viewer 생략, 뷰어 무관)
5. PM이 두 worktree diff 머지, typecheck 통과 확인
6. 사용자에게 결과 보고

### 에러 흐름 — backend가 계약과 다른 응답 형식 사용

1. Phase 4 통합 중 PM이 frontend의 훅과 backend 응답 shape 불일치 감지
2. backend worktree만 부분 재호출, prompt에 위반된 계약 라인 인용 + 정정 지시
3. 재머지 후 다시 검증

### 후속 작업 흐름 — "지난번 검색 필터, type=image일 때 정렬 안 돼"

1. Phase 0에서 `_workspace/api_contract.md` 존재 확인 → 부분 재실행 모드
2. PM이 backend만 부분 재호출 (frontend는 영향 없으면 생략)
3. typecheck + 수동 케이스 검증

## 참고

- 에이전트 정의: `.claude/agents/drawing-mgmt-{pm,designer,frontend,backend,viewer-engineer}.md`
- 뷰어 도메인 가이드: `.claude/skills/viewer-engineering/`
- API 계약 스키마: 글로벌 스킬 `api-contract-schema`
- 프로젝트 메모리: `~/.claude/projects/-Users-jerry-drawing-mgmt/memory/`
- PRD/TRD/WBS: `docs/PRD.md`, `docs/TRD.md`, `docs/WBS.md`
