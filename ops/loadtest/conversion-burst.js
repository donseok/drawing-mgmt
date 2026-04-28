// k6 변환 큐 50건 부하 — drawing-mgmt
//
// WBS 4.4.2 — "변환 50건" part.
//
// 목적: 짧은 시간 안에 50개 변환 작업이 큐에 enqueue됐을 때 워커가 처리하는지 +
//       처리 시간 분포 + ConversionStatus 추적.
//
// 가정: 사전 시드된 attachment들이 있어서 enqueue 가능 — 이번 script는
//       /api/v1/dev/conversions/enqueue 같은 dev-only 라우트 OR 신규 자료
//       업로드 multipart 시나리오 둘 중 하나로 분기.
//
// 본 script는 단순화된 "기존 자료 50개를 재변환 trigger" 패턴 — 실 운영에선
// 관리자가 /admin/conversions에서 retry 버튼을 눌러 같은 효과 발생.
//
// 실행:
//   k6 run -e BASE_URL=https://drawing.dongkuk.local \
//          -e USERNAME=admin -e PASSWORD=admin123! \
//          ops/loadtest/conversion-burst.js
//
// 검증 포인트(시각적):
//   - /admin/conversions 에서 PENDING/PROCESSING/DONE/FAILED 카운트
//   - 5분 안에 50건 모두 DONE 도달

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL ?? 'http://localhost:3000';
const USERNAME = __ENV.USERNAME ?? 'admin';
const PASSWORD = __ENV.PASSWORD ?? 'admin123!';
const TARGET_COUNT = parseInt(__ENV.TARGET ?? '50', 10);

const enqueued = new Counter('enqueued');
const errs = new Counter('app_errors');

export const options = {
  // 50건 한 번에 spawn (1 VU가 50번 enqueue) — 큐 burst 효과 검증
  vus: 1,
  iterations: TARGET_COUNT,
  thresholds: {
    http_req_failed: ['rate<0.05'],
    enqueued: [`count>=${Math.floor(TARGET_COUNT * 0.95)}`], // 95%+ 성공
  },
};

let bearerCookie = null;

function login() {
  const csrfRes = http.get(`${BASE}/api/auth/csrf`);
  const { csrfToken } = csrfRes.json();
  const res = http.post(
    `${BASE}/api/auth/callback/credentials`,
    { username: USERNAME, password: PASSWORD, csrfToken, json: 'true' },
    { redirects: 0 },
  );
  return res.status === 200 || res.status === 302;
}

export function setup() {
  if (!login()) throw new Error('login failed in setup');
  // 50개 retry 가능한 ConversionJob id 확보
  const r = http.get(`${BASE}/api/v1/admin/conversions/jobs?limit=${TARGET_COUNT}`);
  check(r, { 'list 2xx': (x) => x.status === 200 }) || errs.add(1);
  const data = r.json('data') ?? [];
  const ids = data.map((j) => j.id).slice(0, TARGET_COUNT);
  return { ids };
}

export default function (data) {
  if (__ITER === 0 && !bearerCookie) {
    login();
    bearerCookie = true;
  }

  const idx = __ITER % (data.ids?.length || 1);
  const jobId = data.ids?.[idx];
  if (!jobId) {
    errs.add(1);
    return;
  }

  const r = http.post(`${BASE}/api/v1/admin/conversions/jobs/${jobId}/retry`);
  if (r.status >= 200 && r.status < 300) {
    enqueued.add(1);
  } else {
    errs.add(1);
  }
  // burst 효과 — sleep 0
}

export function teardown(data) {
  // 5초 대기 후 카운트 한 번 확인 (워커가 시작했는지)
  sleep(5);
  const r = http.get(`${BASE}/api/v1/admin/conversions/jobs?limit=${TARGET_COUNT}`);
  const list = r.json('data') ?? [];
  const counts = list.reduce((acc, j) => {
    acc[j.status] = (acc[j.status] || 0) + 1;
    return acc;
  }, {});
  console.log('teardown counts:', JSON.stringify(counts));
}
