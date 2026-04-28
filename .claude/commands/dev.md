---
description: Colima + docker + worker + web dev 서버 기동 후 브라우저 열기
allowed-tools: Bash
---

drawing-mgmt 개발 환경(Colima → Docker → worker → web)을 띄우고 브라우저를 엽니다.

## 실행 절차

1. **Colima 상태 점검** — `colima status 2>&1`. 출력에 `running`이 없으면 `colima start`로 기동(완료까지 대기). 이미 running이면 스킵.

2. **중복 기동 점검** — Colima가 준비된 뒤 다음을 병렬로 확인.
   - `docker compose ps --status running` (Postgres/Redis 컨테이너)
   - `lsof -i :3000 -sTCP:LISTEN` (web dev 서버)
   - 이미 떠 있는 항목은 재기동하지 말고 그대로 둡니다.

3. **Docker 서비스 기동** — `docker compose up -d` (포그라운드, 끝까지 대기). 이미 running이면 스킵.

4. **Worker 기동** — 떠 있지 않으면 `pnpm worker:dev`를 `run_in_background: true`로 실행. 떠 있으면 스킵.

5. **Web dev 서버 기동** — :3000이 비어 있으면 `pnpm dev`를 `run_in_background: true`로 실행. 떠 있으면 스킵.

6. **헬스체크 + 브라우저 열기** — `until curl -sf -o /dev/null http://localhost:3000; do sleep 2; done && open http://localhost:3000`. dev 서버 부팅을 기다린 뒤 기본 브라우저로 엽니다.

## 보고 형식

각 단계 결과를 1~2줄로 요약하고, 마지막에 백그라운드 작업 ID(worker / web)를 한 줄로 정리해주세요. 단계 중 하나라도 실패하면 즉시 멈추고 원인을 알려주세요.
