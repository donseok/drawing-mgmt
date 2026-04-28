# 데이터 마이그레이션 계획서 — TeamPlus → drawing-mgmt

| 항목 | 값 |
|---|---|
| 문서 ID | MIGRATION-PLAN |
| 작성일 | 2026-04-28 (R52) |
| 대상 시스템 | drawing-mgmt v1.0 (운영 시작 대상) |
| 원천 시스템 | 동국씨엠 TeamPlus (As-Is 도면관리 시스템) |
| WBS 항목 | 4.3.1 ~ 4.3.6 |
| 책임 | 운영팀(원천 데이터) + 개발자(ETL/실행) |

---

## 0. 한 페이지 요약

| 단계 | 무엇 | 누가 | 언제 | 산출 |
|---|---|---|---|---|
| 1 | TeamPlus DB 스키마 + 파일 NAS 인계 | 운영팀 → 개발 | D-7 | dump 파일 + NAS 마운트 |
| 2 | 매핑표 v1 작성 | 개발 | D-5 | `migration-mapping.md` |
| 3 | TeamPlus Source 어댑터 구현 | 개발 | D-3 | `packages/migration/src/source/teamplus.ts` |
| 4 | Dry-run (검증 환경) | 개발 | D-2 | report JSON, mismatch 0 목표 |
| 5 | 차이 보정 + 재 dry-run | 개발 | D-1 | report v2 |
| 6 | **본 마이그레이션 (cutover)** | 개발 + 운영 | D0 야간 | 운영 시스템 활성 |
| 7 | 검증 (admin smoke) + 사용자 통지 | 운영팀 | D+1 AM | 운영 시작 |

---

## 1. 매핑 가정 (v0 — 실 스키마 인계 후 갱신)

> 본 표는 As-Is/To-Be PRD 기반의 **추정 매핑**. 실 TeamPlus 컬럼명이 인계되면 v1로 정정.

### 1.1 사용자 (User)

| TeamPlus (추정) | drawing-mgmt | 변환 규칙 |
|---|---|---|
| `EmpNo` | `User.username` | trim, lower-case 권장 |
| `Name` | `User.fullName` | UTF-8 정규화 |
| `Email` | `User.email` | RFC 검증, 빈 값 → null |
| `Dept` | `User.organizationId` | 부서명 → Organization.id 매핑 (1.4 참조) |
| `Role` | `User.role` | TeamPlus enum → `SUPER_ADMIN/ADMIN/USER/PARTNER` 매핑 |
| (없음) | `User.passwordHash` | 임시 비밀번호 bcrypt + `passwordChangedAt: epoch 0` (R47/R48 정책) → 첫 로그인 시 강제 변경 |
| `RetiredFlag` | `User.deletedAt` | Y → 마이그 시각, N → null |
| `SignFile` | `User.signatureFile` | 파일 복사 + 경로 |

### 1.2 폴더 (Folder)

| TeamPlus | drawing-mgmt | 규칙 |
|---|---|---|
| `FolderID` | `Folder.id` | UUID로 재발급 (충돌 회피) — 매핑 테이블 보관 |
| `Name` | `Folder.name` | trim |
| `ParentID` | `Folder.parentId` | 매핑 테이블 lookup |
| `Code` | `Folder.folderCode` | 영문 대문자/숫자/`_-` 외 문자 reject (admin 결정 후 변환 또는 null) |
| `CreatedAt` | `Folder.createdAt` | as-is |

### 1.3 권한 (FolderPermission)

| TeamPlus | drawing-mgmt | 규칙 |
|---|---|---|
| `(folder, user, perm)` | `FolderPermission` rows | TeamPlus 단일 RBAC → READ/WRITE/EDIT 3단계 매핑 |

> 실 매핑 후 권한 매트릭스(`canAccess`)로 100% 이전 검증.

### 1.4 조직 (Organization) / 그룹 (Group)

| TeamPlus | drawing-mgmt | 규칙 |
|---|---|---|
| `Dept` 트리 | `Organization` 트리 | parent/child relationship 그대로 |
| `Group` (사용자 정의) | `Group` | name + members |

### 1.5 자료 (ObjectEntity / Revision / Version / Attachment)

| TeamPlus | drawing-mgmt | 규칙 |
|---|---|---|
| `DrawingNo` | `ObjectEntity.number` | as-is, 충돌 시 `-MIG` 접미사 |
| `Title` | `ObjectEntity.name` | as-is |
| `Class` | `ObjectEntity.classId` | TeamPlus 자료유형 → ObjectClass.id 매핑(R26 U-1로 admin 정의된 class 활용) |
| `SecurityLevel` | `ObjectEntity.securityLevel` | 1~5 normalize |
| `RevisionNo` | `Revision.rev` | int |
| `VersionNo` | `Version.ver` | int |
| `MasterFile` | `Attachment(isMaster=true)` | 파일 복사 + SHA-256 |
| `AttachedFiles[]` | `Attachment(isMaster=false)` | 동일 |
| `OwnerEmpNo` | `ObjectEntity.ownerId` | User 매핑 lookup |
| `RegDate` | `ObjectEntity.createdAt` | UTC 변환 |

### 1.6 결재 / 로비 / 활동 로그

- 결재 데이터(과거 완료된 결재선)는 마이그 OFF — 운영 시작 시점부터 새 결재선으로 시작 (운영팀 결정 필요)
- 로비함은 운영 시작 시점 이후 트랜스미털만 → 마이그 OFF
- 활동 로그는 마이그 OFF — TeamPlus 시점은 별도 archive로 보관

> 마이그 ON/OFF 결정은 운영팀과 합의 — 본 문서 §4 합의서.

---

## 2. ETL 실행 절차

### 2.1 도구

`packages/migration/` (R52 산출):
- `dry-run` — DB 쓰기 없음, 검증 리포트만
- `full` — 실 적재 (idempotent + resume 지원)
- `verify` — 50건 표본 비교
- `rehearsal` = dry-run + verify

### 2.2 검증 환경 적재 (D-2)

```bash
# 검증 환경 별도 DB
DATABASE_URL=postgresql://drawmgmt_staging:.../drawmgmt_staging \
MIGRATION_SOURCE_DB_URL=<TeamPlus dump 또는 직접 connection> \
MIGRATION_SOURCE_FILES_ROOT=/mnt/teamplus-files \
  pnpm -F @drawing-mgmt/migration run rehearsal
```

리포트 위치: `./migration-reports/rehearsal-<timestamp>.json`. 다음 메트릭 확인:
- total / migrated / failed / skipped 카운트
- 50건 표본의 mismatch 0건 목표
- 파일 checksum 검증 100% 통과
- 권한 매트릭스 100% 일치

### 2.3 차이 보정 (D-1)

`failed` 또는 `mismatch` 항목별로:
- 자료번호 충돌 → admin 합의 후 `-MIG` 접미사 또는 제외
- 누락된 사용자 → 기본 그룹/조직 매핑 폴백
- 깨진 파일 → 운영팀에 원본 재요청 + 임시 placeholder
- 권한 불일치 → 매핑표 v2로 정정

재 dry-run → mismatch 0 도달까지 반복.

### 2.4 본 마이그레이션 (D0 야간)

**Cutover 절차** (시간대 = 사용자 영향 최소):

```
T-1h     사용자 통지 (시스템 점검 안내), TeamPlus 쓰기 동결 안내
T-0      TeamPlus 마지막 dump 추출 + 파일 NAS 동기화 완료
T+0      운영 환경 신규 시스템에 ETL full 실행 시작
T+~      ETL 완료, 운영팀 admin 페이지 검증
T+10m    smoke 테스트 (5명 시드 사용자 로그인 → 자료 검색 → 뷰어 → 다운로드)
T+30m    운영 시스템 OPEN, TeamPlus는 read-only archive로 전환
```

명령:
```bash
DATABASE_URL=<운영 DB> \
MIGRATION_SOURCE_DB_URL=<TeamPlus 최종 dump> \
MIGRATION_SOURCE_FILES_ROOT=/mnt/teamplus-files \
FILE_STORAGE_ROOT=/var/lib/drawmgmt/files \
  pnpm -F @drawing-mgmt/migration run full --batch 100
```

**중단 시 재개:**
```bash
... pnpm -F @drawing-mgmt/migration run full --resume
```

ETL은 idempotent — 이미 적재된 row는 skip(원천 row의 unique key + 마이그 메타 테이블로 추적).

### 2.5 검증 (D+1 AM)

운영팀이 admin 페이지로 점검:
- `/admin/users` — 사용자 수 일치 확인
- `/admin/organizations` — 조직 트리 일치
- `/search` — 자료 1~2건 검색 → 뷰어 OK
- `/admin/conversions` — 변환 잡 PENDING 폭주 없는지
- `/admin/scans` — INFECTED 0건

이상 시 §3 롤백 절차.

---

## 3. 롤백 시나리오

### 3.1 실패 분류

| 유형 | 예시 | 조치 |
|---|---|---|
| 부분 실패 | 5% 자료 적재 실패 | log 분석 + 부분 재시도. 사용자 통지 — "실패 자료 수동 등록 예정". 운영 시작은 진행. |
| 광범위 실패 | 50% 이상 실패 | TeamPlus 원본 점검. 운영 시작 연기. |
| 데이터 corruption | checksum 불일치 다수 | full rollback (§3.2) |

### 3.2 Full Rollback

```bash
# 1) 신규 시스템 stop
docker compose -f docker-compose.prod.yml stop web worker

# 2) DB drop + restore (마이그 직전 백업으로)
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore --clean --if-exists -U drawmgmt -d drawmgmt < pre-migration-backup.dump

# 3) 파일 storage clean
rm -rf /var/lib/drawmgmt/files/*

# 4) 사용자 통지 — TeamPlus 사용 계속, 신규 일정 안내

# 5) 다시 D-7부터 시작
```

RTO: 4시간 이내. RPO: D-7 dump 시점.

---

## 4. 운영팀 합의 사항 (인계 받기 전 결정 필요)

| 항목 | 옵션 | 권장 |
|---|---|---|
| 과거 결재 데이터 | (a) 마이그 ON (b) OFF, archive로 보관 | OFF — 운영 시작 후 새 결재선으로 |
| 활동 로그 | (a) 마이그 ON (b) OFF | OFF — 별도 archive PDF/CSV로 보관 |
| 폐기/휴지통 항목 | (a) 마이그 ON (b) OFF | OFF — 운영 영향 0, 디스크 절약 |
| 임시 비밀번호 발급 | (a) 일괄 동일 비번 (b) 사용자별 무작위 | (b) 사용자별 무작위 + email/SMS 통지 — 보안 |
| 자료번호 충돌 | (a) `-MIG` 접미사 (b) 매핑표 사용자 결정 | (a) 자동, 운영팀 사후 검토 |
| 대상 사용자 polling | 사용자 개개인 동의 받음 | 운영팀 결정 — 노조/법무 검토 |

---

## 5. 산출물 체크리스트

마이그 완료 시 다음 모두 운영팀에 인계:

- [ ] `migration-mapping.md` (v1 — 실 스키마 반영 후)
- [ ] ETL report JSON (rehearsal + full)
- [ ] 마이그 통계 리포트 (사용자/조직/폴더/자료 카운트 일치 보고서)
- [ ] 50건 표본 mismatch 보고서 (mismatch 0)
- [ ] 사용자 임시 비밀번호 통지 완료 보고
- [ ] TeamPlus archive 위치 + 보관 기간 정책

---

## 6. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-04-28 | R52 — 1차 작성. 매핑 v0(추정) + cutover 절차 + 롤백 + 합의 사항 6 항목. 실 스키마 인계 후 v1로 정정. |
