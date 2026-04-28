// k6 동시 사용자 5명 시나리오 — drawing-mgmt
//
// WBS 4.4.2 — "변환 50건 + 동시 5사용자" 의 사용자 part.
//
// 목적: 5 VU가 5분간 검색 + 자료 상세 + 다운로드(소형)를 반복.
// p95 latency / 에러율 / 5xx 0건 목표.
//
// 실행:
//   k6 run -e BASE_URL=https://drawing.dongkuk.local \
//          -e USERNAME=admin -e PASSWORD=admin123! \
//          ops/loadtest/concurrent-users.js

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL ?? 'http://localhost:3000';
const USERNAME = __ENV.USERNAME ?? 'admin';
const PASSWORD = __ENV.PASSWORD ?? 'admin123!';

const errs = new Counter('app_errors');
const detailLatency = new Trend('detail_latency_ms');

export const options = {
  scenarios: {
    concurrent_5: {
      executor: 'constant-vus',
      vus: 5,
      duration: '5m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<800'],
    app_errors: ['count<20'],
    detail_latency_ms: ['p(95)<700'],
  },
};

function loginOnce() {
  const csrfRes = http.get(`${BASE}/api/auth/csrf`);
  const { csrfToken } = csrfRes.json();
  const res = http.post(
    `${BASE}/api/auth/callback/credentials`,
    { username: USERNAME, password: PASSWORD, csrfToken, json: 'true' },
    { redirects: 0 },
  );
  return res.status === 200 || res.status === 302;
}

// VU별로 1회 로그인(setup이 아니라 vu 진입 시)
export function setup() {
  return {};
}

export default function () {
  if (__ITER === 0) {
    if (!loginOnce()) {
      errs.add(1);
      return;
    }
  }

  // 1) 검색
  let r = http.get(`${BASE}/api/v1/objects?limit=20`);
  check(r, { 'search 2xx': (x) => x.status >= 200 && x.status < 300 }) || errs.add(1);
  const items = r.json('data') ?? [];
  if (!items.length) {
    sleep(1);
    return;
  }
  const pick = items[Math.floor(Math.random() * items.length)];

  // 2) 자료 상세
  if (pick && pick.id) {
    const t0 = Date.now();
    r = http.get(`${BASE}/api/v1/objects/${pick.id}`);
    detailLatency.add(Date.now() - t0);
    check(r, { 'detail 2xx': (x) => x.status >= 200 && x.status < 300 }) || errs.add(1);

    // 3) 활동 로그(자료별)
    r = http.get(`${BASE}/api/v1/objects/${pick.id}/activity?limit=10`);
    check(r, { 'activity 2xx': (x) => x.status >= 200 && x.status < 300 }) || errs.add(1);

    // 4) 썸네일(있으면)
    if (pick.masterAttachmentId) {
      r = http.get(`${BASE}/api/v1/attachments/${pick.masterAttachmentId}/thumbnail`);
      check(r, { 'thumbnail 2xx/404': (x) => x.status === 200 || x.status === 404 }) || errs.add(1);
    }
  }

  // 5) 알림 unread count
  r = http.get(`${BASE}/api/v1/notifications/unread-count`);
  check(r, { 'unread-count 2xx': (x) => x.status >= 200 && x.status < 300 }) || errs.add(1);

  sleep(2 + Math.random() * 3);
}
