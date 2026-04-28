# 부하 테스트 (WBS 4.4.2)

drawing-mgmt 운영 시작 전 검증용 [k6](https://k6.io/) script.

## 시나리오

| Script | VU | 시간 | 목적 |
|---|---|---|---|
| `smoke.js` | 1 | 1m | 살아있는지(2xx) + p95 < 500ms |
| `concurrent-users.js` | 5 | 5m | 동시 사용자 5명 검색·상세·다운로드 |
| `conversion-burst.js` | 1 (50 iter) | burst | 변환 큐 50건 일괄 enqueue, 5분 안에 DONE 확인 |

## 사전 준비

1. **k6 설치** (host 또는 Docker):
   ```bash
   # macOS
   brew install k6
   # Ubuntu
   sudo apt-get install -y k6
   # 또는 Docker
   docker run --rm -i grafana/k6 run - < ops/loadtest/smoke.js
   ```

2. **시드 데이터** — 검증 환경 또는 운영 dry-run 환경에 사용자/자료 시드 완료 상태일 것
   ```bash
   pnpm -F @drawing-mgmt/web db:seed     # 권장 — admin/admin123! + 일정 자료 수
   ```

3. **환경 변수**:
   ```bash
   export BASE_URL=https://drawing.dongkuk.local      # 운영 검증 환경
   export USERNAME=admin
   export PASSWORD='admin123!'                         # 시드 admin 임시 비번
   ```

## 실행

### 1) Smoke
```bash
k6 run ops/loadtest/smoke.js
```

성공 기준:
- `http_req_failed`: rate < 1%
- `http_req_duration`: p95 < 500ms
- `app_errors`: count < 5

### 2) 동시 5사용자
```bash
k6 run ops/loadtest/concurrent-users.js
```

성공 기준:
- `http_req_failed`: rate < 2%
- `http_req_duration`: p95 < 800ms
- `detail_latency_ms`: p95 < 700ms

### 3) 변환 50건 burst
```bash
k6 run -e TARGET=50 ops/loadtest/conversion-burst.js
```

성공 기준:
- `enqueued`: count >= 47 (95%+)
- 5분 후 `/admin/conversions` 페이지에서 50건 모두 `DONE` 또는 (ODA 환경 의존 실패 OK이지만 PENDING 폭주 없을 것)

## CI 통합

운영 진입 후 정기 회귀 (옵션 — 비용 큼):
- Github Actions에서 nightly schedule
- `concurrent-users.js`만 — 5분 자동 실행 후 threshold pass 검증

이번 라운드(R53)는 script만 작성. CI 통합은 별 라운드.

## 결과 해석

각 script가 끝나면 k6가 console에 metrics summary 출력. JSON으로 저장:
```bash
k6 run --out json=results.json ops/loadtest/smoke.js
```

장기 추적 시 Grafana + InfluxDB 또는 k6 Cloud에 보낼 수도 있으나 on-prem 단일 서버에선 console summary로 충분.

## 라이선스 메모

k6 자체는 AGPL-3.0이지만 **외부 도구로 별도 실행** — 앱 코드(`apps/web`, `apps/worker`)에 link 안 됨. AGPL 전염 없음. 동일 패턴: LibreDWG(GPL) subprocess 격리.

## 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-04-28 | R53 — 3종 script(smoke / concurrent / conversion-burst) + 가이드 작성 |
