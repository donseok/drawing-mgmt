# drawing-mgmt

동국씨엠 사내 도면관리 시스템. 1인 개발 / 4주 / 바이브코딩 / 무료 SW.

> AutoCAD 미설치 사용자도 브라우저만으로 모든 도면을 보고 인쇄할 수 있다.

## 1분 quick-start (개발자)

```bash
git clone <repo-url> drawing-mgmt && cd drawing-mgmt

cp .env.example .env
# AUTH_SECRET 등 필수 항목만 채움 — DB/Redis는 docker-compose가 띄움

pnpm install
pnpm docker:up                 # postgres + redis
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev                       # http://localhost:3000

# (선택) 워커
pnpm worker:dev
```

시드 계정: `admin / admin123!` (SUPER_ADMIN). `manager`, `kim`, `partner1`도 시드돼 있음.

상세 부팅·구조는 `docs/manuals/DEVELOPER_GUIDE.md` 30분 가이드.

## 운영자 quick-start

```bash
# 검증/운영 서버에서
cp .env.example .env.production
# 필수 채움: AUTH_SECRET / DATABASE_URL / POSTGRES_PASSWORD /
#         NEXT_PUBLIC_BASE_URL / DEV_AUTH_FALLBACK=false / NODE_ENV=production /
#         BACKUP_ENCRYPTION_KEY (16자+)

# TLS 인증서 배치
mkdir -p ops/nginx/certs
# 사내 CA 또는 Let's Encrypt 발급 인증서 → server.crt / server.key

docker compose -f docker-compose.prod.yml up -d --build

# 헬스
curl https://drawing.dongkuk.local/api/v1/health
```

배포 절차·트러블슈팅·재해 복구는 `docs/manuals/operations.md`.

## 핵심 문서

| 문서 | 대상 | 위치 |
|---|---|---|
| 사용자 매뉴얼 | 일반 사용자/관리자 | `docs/manuals/USER_MANUAL.md` |
| 개발자 가이드 | 신규/기존 기여자 | `docs/manuals/DEVELOPER_GUIDE.md` |
| 운영 매뉴얼 | 운영팀 | `docs/manuals/operations.md` |
| 보안 감사 | 운영팀 / 보안 담당 | `docs/SECURITY_AUDIT.md` |
| 마이그 계획 | 운영팀 + 개발 | `docs/MIGRATION_PLAN.md` |
| PRD/TRD/WBS/DESIGN | 전체 | `docs/{PRD,TRD,WBS,DESIGN}.md` |

## 모노레포 구조

```
drawing-mgmt/
├── apps/
│   ├── web/                # Next.js 14 + Auth.js v5 + Prisma
│   └── worker/             # BullMQ — DWG 변환 / PDF / 백업 / 바이러스 스캔 / 메일·SMS·카카오
├── packages/
│   ├── shared/             # FE/BE/worker 공용 타입·schema
│   └── migration/          # TeamPlus → drawing-mgmt ETL (R52 골격)
├── docs/                   # 매뉴얼 + 사양서
├── ops/
│   ├── nginx/              # 운영 reverse proxy + TLS
│   └── loadtest/           # k6 부하 테스트 script
├── docker-compose.yml      # dev (postgres + redis)
└── docker-compose.prod.yml # prod (nginx + web + worker + postgres + redis)
```

## 라이선스 정책

- 유료 SDK/API 금지 (ODA Teigha 등). 오픈소스만
- **GPL/AGPL은 subprocess 격리만** — LibreDWG(`dwg2dxf`), ClamAV(`clamscan`), k6(외부 도구) 모두 별도 프로세스
- npm 의존성은 MIT/Apache 2.0/BSD/ISC만 — `apps/web/app/api/v1/admin/security/audit`로 운영 중 추적

## 보안 자세

- 인증: Credentials + 비밀번호 정책(R39) + MFA TOTP(R39) + Keycloak(R33) + SAML 2.0(R37)
- 인가: 폴더 권한 매트릭스(R28) + 보안등급(1~5) + role gate
- CSRF + Rate limit: 모든 mutating 라우트 `withApi` wrap (R47, 41 routes)
- 파일 업로드: 200MB cap + MIME 화이트리스트 + ClamAV 스캔(R36)
- at-rest 암호화: TOTP secret AES-256-GCM(R49), 백업 archive openssl AES-256-CBC(R50)
- 감사 추적: ActivityLog로 LOGIN/PASSWORD/DOWNLOAD/PRINT/PREVIEW 등 (R29 + R47 + R48)
- 의존성: `pnpm audit` CI + `/admin/security` 운영 가시화 (R40 + R41)

상세는 `docs/SECURITY_AUDIT.md` (R46 감사 22 findings 처리 결과).

## 변경 이력 / 라운드별 산출

`docs/백로그.md` "변경 이력" 섹션 — 각 라운드(R26~)의 산출물 + 결정.

## Phase 2 백로그

- 그룹웨어 결재 통합 / LDAP/AD SSO·MFA / 워터마크·DLP·다운로드 추적
- 도면 Diff 시각화 (2 리비전 비교)
- OCR 도면 본문 검색
- 통계 대시보드
- 외부 협력업체 포털 분리 (DMZ)
- 모바일 결재
- BIM(IFC)/STEP 등 3D 포맷
- 고급 측정(반경·각도)·창배열·복합 정렬
- CSP nonce 마이그 (FIND-015 — RSC 영향 큼)

## 라이선스

Internal — 동국씨엠 사내용. 외부 공개 시 별도 검토.
