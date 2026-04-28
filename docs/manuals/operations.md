---
문서: 운영 매뉴얼 (Operations Manual)
대상 시스템: drawing-mgmt — 동국씨엠 도면관리시스템
작성일: 2026-04-28 (R51 catch-up)
대상 main HEAD: R50 이후
대상 독자: 운영자 / 시스템 관리자 / 시스템 인계받는 후속 담당자
산출물 라운드: R51 (WBS 4.4.4 부분)
---

# drawing-mgmt 운영 매뉴얼

> 본 매뉴얼은 시스템을 **운영(production)** 환경에서 가동·유지·복구하는 데 필요한 절차를 모은다.
> 개발 부팅·구조는 `DEVELOPER_GUIDE.md`, 사용자 화면 안내는 `USER_MANUAL.md`를 참조하라.

---

## 0. 한 페이지 운영 요약

| 영역 | 도구 | 주기 / 트리거 |
|---|---|---|
| 배포 | `docker compose -f docker-compose.prod.yml up -d --build` | 코드 변경 시 |
| DB 마이그레이션 | `pnpm db:migrate` (worker 컨테이너 안 또는 호스트) | 배포 직전 |
| 백업 | BullMQ `backup` 큐 (`BACKUP_CRON_ENABLED=1`) | 매일 02:00 UTC + 수동 admin 페이지 |
| 모니터링 | `/admin/conversions`, `/admin/scans`, `/admin/pdf-extracts`, `/admin/security`, `/admin/backups` | 일 1회 점검 권장 |
| 헬스체크 | `GET /api/v1/health` (200) | docker healthcheck 30초 |
| 로그 | `docker compose logs -f --tail 200 web worker` | 사고/디버깅 시 |
| 사용자 잠금 해제 | `/admin/users/<id>` → [잠금 해제] | 5회 실패 잠금 사용자 보고 시 |
| 비밀번호 만료 강제 | `/admin/users/<id>` → [비밀번호 만료] | 보안 사고 의심 시 |

---

## 1. 배포

### 1.1 첫 배포 (Day 0)

전제: 운영 서버에 Docker + docker-compose 설치, 외부 IP/도메인 + TLS 인증서, 사용자 인계 받은 운영팀.

```bash
# 1) 코드 클론 (서버 운영 사용자로)
git clone <repo-url> /opt/drawing-mgmt
cd /opt/drawing-mgmt

# 2) 운영 환경 변수 작성
cp .env.example .env.production
# 필수 편집 항목:
#   AUTH_SECRET           = openssl rand -base64 32 (32자 이상)
#   DATABASE_URL          = postgresql://drawmgmt:<강한비번>@postgres:5432/drawmgmt
#   POSTGRES_PASSWORD     = 위 강한 비번과 동일
#   REDIS_URL             = redis://redis:6379
#   NEXT_PUBLIC_BASE_URL  = https://drawing.dongkuk.local (운영 도메인)
#   FILE_STORAGE_ROOT     = /var/lib/drawmgmt/files
#   DEV_AUTH_FALLBACK     = false   ★ 운영에선 반드시 false
#   NODE_ENV              = production
#   BACKUP_ENCRYPTION_KEY = (16자 이상, 별도 보관)
# 선택:
#   KEYCLOAK_*, SAML_*, MAIL_*, SMS_*, KAKAO_*

# 3) TLS 인증서 배치
mkdir -p ops/nginx/certs
# 사내 CA 또는 Let's Encrypt 발급 후
cp <발급>.crt ops/nginx/certs/server.crt
cp <발급>.key ops/nginx/certs/server.key
chmod 600 ops/nginx/certs/server.key

# 4) 컨테이너 빌드 + 기동
docker compose -f docker-compose.prod.yml up -d --build

# 5) DB 마이그레이션 + 시드 (1회만)
docker compose -f docker-compose.prod.yml exec web sh -c "
  pnpm prisma migrate deploy &&
  pnpm db:seed:prod
"
# 또는 호스트에서 직접 (권장하지 않음)

# 6) 헬스체크
curl https://drawing.dongkuk.local/api/v1/health
# {"ok":true,"data":{"status":"ok"}}

# 7) 첫 로그인 (시드된 admin 또는 별도 계정)
# 운영 시드는 비밀번호를 강한 임시 비밀번호로 — 첫 로그인 시 강제 변경
```

### 1.2 코드 변경 배포 (롤링)

```bash
cd /opt/drawing-mgmt
git pull origin main

# 새 마이그레이션이 있으면 사전 백업 권장
docker compose -f docker-compose.prod.yml exec web sh -c "
  pnpm prisma migrate deploy
"

docker compose -f docker-compose.prod.yml up -d --build web worker
# postgres/redis는 재시작하지 않음 (데이터 보호)
```

### 1.3 롤백

```bash
git log --oneline -10                        # 마지막 안전 SHA 확인
git checkout <safe-sha>
docker compose -f docker-compose.prod.yml up -d --build web worker

# 마이그레이션이 비파괴적이면 그대로 두고, 파괴적이면 백업 복원 절차로
```

---

## 2. 환경 변수 체크리스트

운영 시작 전 **반드시** 확인:

| 변수 | 값 | 의미 |
|---|---|---|
| `NODE_ENV` | `production` | RSC 만료 가드 + DEV 계정 차단 + HSTS 활성화 트리거 |
| `AUTH_SECRET` | 32자 이상 무작위 | 세션 + MFA bridge token + TOTP 암호화 키 derive |
| `DEV_AUTH_FALLBACK` | `false` | DEV 평문 계정 비활성 (NODE_ENV=production이면 자동, 명시 권장) |
| `DATABASE_URL` | 강한 비번 포함 | DB 접속 |
| `POSTGRES_PASSWORD` | 위와 일치 | postgres 컨테이너 |
| `REDIS_URL` | redis://redis:6379 | rate limit + SAML cache + BullMQ |
| `FILE_STORAGE_ROOT` | volume mount path | 자료/PDF/썸네일 |
| `ATTACHMENT_MAX_BYTES` | 209715200 (200MB) | 업로드 cap |
| `BACKUP_ENCRYPTION_KEY` | 16자 이상 | 백업 파일 at-rest 암호화 |
| `BACKUP_CRON_ENABLED` | `1` | 매일 자동 백업 |
| `BACKUP_RETENTION_DAYS` | `30` | 30일 후 자동 prune |
| `CLAMAV_ENABLED` | `1` (권장) | 첨부 바이러스 스캔 |
| `MAIL_ENABLED` | `1` (운영 SMTP 있을 시) | 알림 메일 발송 |
| `KEYCLOAK_ENABLED` / `SAML_ENABLED` | `1` (사내 SSO 있을 시) | SSO |

**저장 절대 금지 (commit 금지):**
- `AUTH_SECRET`, `DATABASE_URL`, `POSTGRES_PASSWORD`, `BACKUP_ENCRYPTION_KEY`, IdP secrets, SMTP/Twilio/Kakao API 키.

---

## 3. 백업 & 복구

### 3.1 자동 백업

`BACKUP_CRON_ENABLED=1`이면 worker가 BullMQ repeatable job으로 매일 02:00 UTC에 두 개 백업 생성:
- `postgres-<timestamp>.dump.gz` (또는 `.dump.gz.enc` 암호화 시)
- `files-<timestamp>.tar.gz` (또는 `.tar.gz.enc`)

저장 위치: `BACKUP_ROOT` (default `./.data/backups`).

`BACKUP_RETENTION_DAYS`(default 30) 지난 archive는 자동 prune.

관리자 페이지 `/admin/backups`에서:
- 백업 목록 + 크기 + 시각
- [지금 백업] 수동 트리거 (POSTGRES / FILES)
- archive 다운로드(admin only)

### 3.2 수동 백업 (admin 페이지 외)

```bash
docker compose -f docker-compose.prod.yml exec worker sh -c "
  pg_dump --format=custom --compress=9 \"\$DATABASE_URL\" > /backups/pg-manual-$(date +%Y%m%d-%H%M).dump
"
```

암호화 적용:
```bash
... pg_dump ... | openssl aes-256-cbc -salt -pbkdf2 -iter 100000 \
  -k "$BACKUP_ENCRYPTION_KEY" \
  -out /backups/pg-manual-$(date +%Y%m%d-%H%M).dump.enc
```

### 3.3 복구

#### Postgres 복구

암호화 있는 경우 먼저 복호화:
```bash
openssl aes-256-cbc -d -pbkdf2 -iter 100000 \
  -k "$BACKUP_ENCRYPTION_KEY" \
  -in postgres-XXX.dump.gz.enc \
  -out postgres-XXX.dump.gz
gunzip postgres-XXX.dump.gz
```

복구:
```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore --clean --if-exists -U drawmgmt -d drawmgmt < postgres-XXX.dump
```

⚠️ `--clean`은 기존 객체를 drop. 복구 직전 별도 안전 백업 후 진행.

#### 파일 복구

```bash
# 암호화 있으면 먼저 복호화 (postgres와 동일 패턴)
tar -xzf files-XXX.tar.gz -C /var/lib/drawmgmt/
```

### 3.4 재해 복구 시나리오

서버 전체 손실 시:
1. 새 서버에 운영 환경 부트(§1.1)
2. 마지막 백업 archive를 새 서버로 안전 채널로 전송 (rsync over ssh)
3. Postgres 복구(§3.3) + 파일 복구
4. `docker compose up -d` 후 헬스체크
5. 사용자 통지

대상 RTO/RPO는 운영팀 정책에 따라(권장: RTO 4시간, RPO 24시간 — 매일 백업).

---

## 4. 모니터링

### 4.1 일 1회 점검 권장 페이지

- `/admin/conversions` — 변환 잡 PENDING/FAILED 카운트. FAILED 다발 시 ODA/LibreDWG 환경 점검.
- `/admin/scans` — INFECTED 첨부. 발견 시 사용자/IP 추적 + 격리.
- `/admin/pdf-extracts` — FAILED 사건. 재시도 가능.
- `/admin/security` — Critical/High 취약점 카운트. 신규 등장 시 긴급 패치 큐잉.
- `/admin/backups` — 매일 백업 DONE 상태 확인. FAILED 시 즉시 수동 백업 + 원인 추적.

### 4.2 시스템 헬스

```bash
# 컨테이너 상태
docker compose -f docker-compose.prod.yml ps

# 헬스체크 직접
curl -k https://drawing.dongkuk.local/api/v1/health

# 로그 (실시간)
docker compose -f docker-compose.prod.yml logs -f --tail 200 web worker

# 디스크 사용
df -h /var/lib/drawmgmt /var/lib/docker
```

### 4.3 디스크 임계값

`FILE_STORAGE_ROOT`와 `BACKUP_ROOT` 디스크 사용률 80% 도달 시:
1. `BACKUP_RETENTION_DAYS` 단축(예: 30 → 14) 후 다음 백업 사이클 대기
2. 휴지통(soft-deleted Object) 영구 폐기 검토 — 별 SQL 또는 admin 대량 액션
3. 외부 NAS / S3로 archive 이전 (R34 V-INF-1로 추상화 완비)

---

## 5. 사용자 관리

### 5.1 사용자 잠금 해제

5회 로그인 실패 → 30분 잠금. 운영자가 즉시 해제하려면:
- `/admin/users/<id>` → [잠금 해제] 버튼

### 5.2 비밀번호 강제 만료

보안 사고 의심(예: 자격 증명 노출 가능성) 시:
- `/admin/users/<id>` → [비밀번호 만료]
- 다음 로그인 시 사용자가 강제 변경 화면으로 이동

### 5.3 임시 비밀번호 발급

- `/admin/users/<id>` → [비밀번호 재설정]
- 정책 검증 통과한 임시 비밀번호 입력 → 사용자에게 보안 채널로 전달
- `passwordChangedAt`이 epoch 0으로 설정 → 다음 로그인 시 즉시 강제 변경

### 5.4 MFA 비활성

사용자가 MFA 디바이스 분실 시:
- `/admin/users/<id>` → [MFA 비활성] (운영자 권한 필요)
- 사용자 다음 로그인 시 MFA 미요구 → /settings에서 재등록

### 5.5 사용자 폐기

- `/admin/users/<id>` → [폐기] (soft-delete, `deletedAt` 설정)
- 폐기 사용자는 로그인 차단 + 검색·자료 list에서 제외
- 자료의 ownerId는 유지 (감사 추적용) — 별도 사용자에 위임은 별 라운드

---

## 6. 트러블슈팅

| 증상 | 원인 후보 | 조치 |
|---|---|---|
| 로그인 후 즉시 `/login`으로 redirect | `AUTH_SECRET` 변경 또는 누락 | `.env.production`의 AUTH_SECRET 복원 후 web 재시작 |
| `/api/v1/health` 200, but 페이지 500 | DB 마이그 누락 | `pnpm prisma migrate deploy` 실행 |
| 자료 업로드 후 변환 PENDING 영원 | worker 미기동 또는 Redis 연결 실패 | `docker compose ps worker` + `docker compose logs worker --tail 200` |
| 사용자 다 잠금 해제됐는데 못 들어옴 | 비밀번호 만료(epoch 0) | /admin/users/<id> → [비밀번호 재설정] |
| Nginx 502 Bad Gateway | web 컨테이너 다운 | `docker compose ps web` + 로그 + 재기동 |
| INFECTED 자료 업로드 시도 후 차단되지 않음 | `CLAMAV_ENABLED=0` 또는 binary 누락 | env 변수 확인 + worker 컨테이너에서 `clamscan -V` 실행 |
| MFA 6자리 항상 거부 | 서버 시계 drift > 1분 | 호스트 NTP 동기화 (`timedatectl` 또는 chrony) |
| 백업 잡이 매일 fail | `BACKUP_ROOT` 권한 또는 `BACKUP_ENCRYPTION_KEY` 누락 | 디렉토리 권한 + env 변수 |
| 검색 결과에서 PDF 본문 매칭 안 됨 | pdf-extract 워커가 안 도는 중 | `/admin/pdf-extracts` PENDING 카운트 폭주 + worker 재시작 |
| `/admin/security` Critical 발견 | npm 의존성 신규 advisory | 운영팀 + 개발팀 회의 → 패치 후 재배포 |

---

## 7. SSO 활성화

### 7.1 Keycloak (R33 A-1)

`.env.production`:
```
KEYCLOAK_ENABLED=1
NEXT_PUBLIC_KEYCLOAK_ENABLED=1
KEYCLOAK_ISSUER=https://keycloak.dongkuk.local/realms/dongkuk
KEYCLOAK_CLIENT_ID=drawing-mgmt
KEYCLOAK_CLIENT_SECRET=<Keycloak admin이 생성>
```

Keycloak 측 설정:
- Client → Client ID = `drawing-mgmt`
- Valid Redirect URIs = `https://drawing.dongkuk.local/api/auth/callback/keycloak`
- Web Origins = `https://drawing.dongkuk.local`
- Protocol = openid-connect

### 7.2 SAML 2.0 (R37 A-2)

`.env.production`:
```
SAML_ENABLED=1
NEXT_PUBLIC_SAML_ENABLED=1
SAML_IDP_ENTRY_POINT=https://idp.dongkuk.local/saml/sso
SAML_IDP_CERT="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
SAML_SP_ENTITY_ID=https://drawing.dongkuk.local
```

R50에서 `validateInResponseTo`가 REDIS_URL 있을 때 자동 'always'로 활성 — Redis 가용 확인.

SP 메타데이터:
```
GET https://drawing.dongkuk.local/api/v1/auth/saml/metadata
```

IdP 관리자에 위 XML 전달해 SP 등록.

---

## 8. 보안 운영

### 8.1 의존성 보안 점검 (R40 + R41)

- 매일 `/admin/security` 카운트 확인
- Critical/High 신규 advisory 등장 시:
  1. CI의 `npm audit` 워크플로 결과 확인
  2. 영향 패키지의 patch release 확인
  3. 임시 mitigation 가능 시 적용 + 배포
  4. 패치 여유 없으면 운영 회의 후 risk acceptance 또는 운영 일시 중단

### 8.2 로그인/다운로드 감사 (R48)

ActivityLog 테이블이 다음 액션을 기록:
- LOGIN_SUCCESS / LOGIN_FAIL (R48)
- PASSWORD_CHANGE_SELF (R47)
- USER_PASSWORD_RESET / USER_PASSWORD_EXPIRE (R47/R48)
- OBJECT_DOWNLOAD / OBJECT_PREVIEW / OBJECT_PRINT (R48)
- 그 외 OBJECT_CREATE/CHECKOUT/CHECKIN/RELEASE/APPROVE 등

`/admin/activity-log`(없으면 직접 SQL — `psql`로 `ActivityLog` 조회)에서 사고 시 forensics.

### 8.3 백업 암호화 키 관리 (R50)

`BACKUP_ENCRYPTION_KEY`:
- 운영팀 키 보관소(예: HashiCorp Vault 또는 사내 secret manager)
- 절대 git/log에 노출 금지
- 정기 회전(예: 분기) — 회전 시 기존 백업은 옛 키로만 복구 가능 → 롤오버 기간 동안 두 키 모두 보관

---

## 9. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-04-28 | R51 — 1차 본문 작성 (배포·환경변수·백업/복구·모니터링·사용자관리·트러블슈팅·SSO·보안운영·9 챕터). |
