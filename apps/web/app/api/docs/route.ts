// GET /api/docs — Swagger UI served via CDN.
// No auth required. No npm dependency on swagger-ui-react.
//
// R-CSP / FIND-015 — middleware sets a per-request `x-nonce` header on every
// matched request (this route is matched). We read it via `headers()` and
// stamp the same value onto the inline `<style>` and the two inline
// `<script>` tags so they pass `script-src 'nonce-{X}'`. The remote
// swagger-ui-bundle.js (loaded with the same nonce) then dynamically loads
// its dependents — those are auto-trusted via `'strict-dynamic'`. Swagger UI
// fetches `/api/openapi.json`, which is same-origin and matches
// `connect-src 'self'`.

import { headers } from 'next/headers';

export async function GET() {
  // Middleware always sets x-nonce. Fall back defensively to an empty string
  // so the attribute renders harmlessly if the header is somehow missing
  // (e.g. unit-level invocations bypassing middleware).
  const nonce = headers().get('x-nonce') ?? '';

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>API Docs — 동국씨엠 도면관리시스템</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style nonce="${nonce}">
    body { margin: 0; padding: 0; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" nonce="${nonce}"></script>
  <script nonce="${nonce}">
    SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
