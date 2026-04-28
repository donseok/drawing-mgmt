// k6 smoke 테스트 — drawing-mgmt
//
// 목적: 운영 시작 직전, 시스템이 살아있는지(2xx) + p95 latency 임계 확인.
// 1 VU × 1분, 정상 5xx 0건 + p95 < 500ms 목표.
//
// 실행:
//   k6 run -e BASE_URL=https://drawing.dongkuk.local \
//          -e USERNAME=admin -e PASSWORD=admin123! \
//          ops/loadtest/smoke.js
//
// 라이선스: k6 (AGPL-3.0) — *외부 도구로 별도 실행*. 앱 코드에 link 안 됨.

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL ?? 'http://localhost:3000';
const USERNAME = __ENV.USERNAME ?? 'admin';
const PASSWORD = __ENV.PASSWORD ?? 'admin123!';

const errs = new Counter('app_errors');
const loginLatency = new Trend('login_latency_ms');
const searchLatency = new Trend('search_latency_ms');

export const options = {
  vus: 1,
  duration: '1m',
  thresholds: {
    http_req_failed: ['rate<0.01'],   // 99% 성공
    http_req_duration: ['p(95)<500'], // p95 < 500ms
    app_errors: ['count<5'],
    login_latency_ms: ['p(95)<800'],
    search_latency_ms: ['p(95)<400'],
  },
};

function login() {
  // Auth.js v5 Credentials provider — csrf token 가져오고 callback POST.
  const csrfRes = http.get(`${BASE}/api/auth/csrf`);
  check(csrfRes, { 'csrf 200': (r) => r.status === 200 }) || errs.add(1);
  const { csrfToken } = csrfRes.json();
  const t0 = Date.now();
  const res = http.post(
    `${BASE}/api/auth/callback/credentials`,
    {
      username: USERNAME,
      password: PASSWORD,
      csrfToken,
      json: 'true',
    },
    { redirects: 0 },
  );
  loginLatency.add(Date.now() - t0);
  // Auth.js는 set-cookie로 세션 발급 후 302 → /  (또는 200)
  const ok = res.status === 200 || res.status === 302;
  check(res, { 'login 2xx/3xx': () => ok }) || errs.add(1);
  return res.cookies;
}

export default function () {
  const cookies = login();
  const jar = http.cookieJar();
  for (const [domain, list] of Object.entries(cookies)) {
    for (const c of list) jar.set(`${BASE}/`, c.name, c.value);
  }

  group('health', () => {
    const r = http.get(`${BASE}/api/v1/health`);
    check(r, { 'health 200': (x) => x.status === 200 }) || errs.add(1);
  });

  group('search', () => {
    const t0 = Date.now();
    const r = http.get(`${BASE}/api/v1/objects?limit=20`);
    searchLatency.add(Date.now() - t0);
    check(r, {
      'search 2xx': (x) => x.status >= 200 && x.status < 300,
      'search has data': (x) => Array.isArray(x.json('data')),
    }) || errs.add(1);
  });

  group('me', () => {
    const r = http.get(`${BASE}/api/v1/me`);
    check(r, { 'me 200': (x) => x.status === 200 }) || errs.add(1);
  });

  sleep(1);
}
