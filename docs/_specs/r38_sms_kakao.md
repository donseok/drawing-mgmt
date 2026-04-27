# R38 Design Spec — SMS / 카카오 알림톡 채널 추가

| 항목 | 내용 |
|---|---|
| 작성자 | drawing-mgmt designer agent (R38) |
| 작성일 | 2026-04-27 |
| 기준 main HEAD | `38b30e3` |
| 대상 라운드 | R38 (자동 라운드 시리즈 마무리, N-2) |
| 대상 PRD/DESIGN | `docs/PRD.md` §3.1(페르소나), `docs/DESIGN.md` §2.5(토큰), §11(접근성) |
| API 계약 | `_workspace/api_contract.md` §3(SMS), §4(Kakao), §6(me/preferences), §7(settings UI) |
| 신규 라우트 | 없음 — `/settings` 알림 탭 확장 |
| 신규 컴포넌트 | 없음 — `<NotificationsSection>` 단일 컴포넌트 안에서 row 2개 + input 1개 추가 |
| 확장 컴포넌트 | `apps/web/components/settings/NotificationsSection.tsx` (R35 base) |
| 의존 (BE) | `PATCH /api/v1/me/preferences` (notifyBySms / notifyByKakao / phoneNumber 추가), `GET /api/v1/me` (응답 필드 3개 추가) |
| 디바이스 | Desktop only (≥1280) — 기존 Tabs/Section 그대로 |
| 디자인 토큰 변경 | **없음** — R35 토큰셋 + R37 P0-2 보정값 그대로 사용. SMS/Kakao 라벨링은 lucide 아이콘(`MessageSquare` for SMS, `MessageCircle` for Kakao)으로 시각 차별화 |
| 새 단축키 | 없음 |
| 회귀 위험 | 매우 낮음 — 알림 탭만 변경, 다른 탭(profile/password/signature) 무수정. 토글 default `false`라 base case 동작 그대로 |

---

## 0. 라운드 개요와 사용자 시나리오

### 0.1 R35 메일 토글 패턴 그대로 확장

R35에서 `<NotificationsSection>`은 의도적으로 **장차 카카오/SMS row가 추가될 자리**로 설계됐다(파일 헤더 주석 line 17: "예: 카카오톡/Slack/SMS 드롭인"). R38은 그 약속을 회수한다. 새 컴포넌트나 페이지를 만들지 않는다 — **기존 카드 형태 row 1개를 row 3개로 늘리고, 전화번호 input 한 줄을 카드 안에 추가**한다.

### 0.2 페르소나별 시나리오

| 페르소나 | SMS 토글 | 카카오 토글 |
|---|---|---|
| 슈퍼관리자 / 관리자 (2~3명) | 결재 상신·반려 알림을 외근/회의 중 받기 위해 ON. 회사가 외부 SMS 비용을 부담. | 사내 카카오 워크/알림톡 사용 환경에서 ON. SMS보다 비용 저렴 + 도착률 높음. |
| 설계자 (10~15명) | 본인 도면 결재 결과를 PC 외부에서 확인하고 싶을 때 ON. 기본은 OFF(메일+사이트로 충분). | 동일. 회사가 알림톡 채널 운영 중이면 default 권장. |
| 열람자 (5~10명) | 거의 OFF — 알림 빈도 낮음. | 동일. |
| 협력업체 (5사) | 도면 회신 요청 알림을 휴대폰으로 받으려 ON 가능. **단, 외부 사용자 대상 SMS 발송은 PM/관리자가 정책으로 막을 수도 있음 → §D-1 결정 필요**. | 동일 + 카카오는 한국 외부 사용자 친화. |

### 0.3 핵심 시나리오 4개

1. **SMS 토글 처음 ON (관리자, 전화번호 미등록):** /settings → 알림 탭. SMS 행에서 Switch가 **disabled** + 안내문 "전화번호를 먼저 등록하세요". 카드 하단에 "전화번호" input이 노출돼 있고 placeholder는 `010-0000-0000`. 입력 → 형식 검증(010-XXXX-XXXX 또는 +82) → 저장 → SMS 토글 enabled. ON 클릭 → toast "SMS 알림을 받습니다.".
2. **카카오 토글 ON (관리자, 전화번호 이미 등록):** SMS와 같은 카드. 카카오톡 행은 곧바로 enabled (전화번호는 SMS·Kakao 공용). ON 클릭 → toast "카카오 알림톡을 받습니다.".
3. **둘 다 OFF + 전화번호 빈 칸:** 카드 하단 phoneNumber input은 **숨김**(또는 collapsed). UI 가벼움 우선.
4. **SMS_ENABLED=0 / KAKAO_ENABLED=0 환경 (개발/저비용 환경):** 토글 자체는 보임(사용자가 의사 표현은 가능) + 행 끝에 작은 secondary badge "발송 중지(서버 설정)" + tooltip. 토글을 ON 해도 toast는 정상이지만 실제 발송은 SKIPPED. **PM 결정 필요(§D-3): badge 보일지 / 토글 disabled 처리할지.**

---

## A. settings 알림 섹션 확장

### A.1 진입점 — 어디에 어떻게 추가하는가

**대상 파일:** `apps/web/components/settings/NotificationsSection.tsx`. 이미 `flex-1` 컨테이너 안에 row 1개(이메일)가 있다. 그 컨테이너 안의 row 단위 div 패턴을 그대로 복제해 SMS/카카오 row를 추가하고, 카드 하단(`<form>` 같은 sub-block)에 `<PhoneInput>` 한 줄을 잇는다.

- **단일 카드 (border-border bg-bg)** 안에 알림 채널 row 3개 + 전화번호 input 1개.
- **복수 카드로 분리하지 않는 이유:** 사용자에게 "메일/SMS/카카오는 서로 대체재"라는 인지가 자연스럽고, 전화번호 input은 SMS/카카오 둘 다의 종속 입력이어서 같은 카드 안에 있는 게 의미상 맞다.

### A.2 와이어프레임

```
┌──────────── /settings → 알림 탭 (TabsContent value="notifications") ────────────┐
│                                                                                 │
│  알림 환경설정                                                                  │
│  결재·회신·시스템 알림을 받을 채널을 선택합니다.                                │
│                                                                                 │
│  ┌── 카드 (rounded-lg border bg-bg p-5) ──────────────────────────────────┐    │
│  │                                                                          │    │
│  │  [✉ Mail]  이메일로 알림 받기                          [● ON]            │    │
│  │            중요한 결재·회신 알림이 사이트 알림과 별도로                  │    │
│  │            등록된 이메일로 발송됩니다. 끄면 사이트 알림(종)만 받습니다.  │    │
│  │                                                                          │    │
│  │  ────────────────── divider (border-t border-border my-4) ──────────────│    │
│  │                                                                          │    │
│  │  [💬 MessageSquare]  SMS로 알림 받기                   [○ OFF]            │    │
│  │            중요 알림을 휴대폰 문자로 받습니다.                           │    │
│  │            ※ 외부 SMS 발송 비용이 발생할 수 있습니다.                    │    │
│  │            (전화번호 미입력 시 disabled + "전화번호를 먼저 등록하세요")  │    │
│  │                                                                          │    │
│  │  ────────────────── divider ────────────────────────────────────────────│    │
│  │                                                                          │    │
│  │  [💭 MessageCircle]  카카오 알림톡 받기                [○ OFF]            │    │
│  │            카카오톡으로 사전 승인된 알림 템플릿을 받습니다.              │    │
│  │            (전화번호 미입력 시 disabled)                                 │    │
│  │                                                                          │    │
│  │  ────────────────── divider ────────────────────────────────────────────│    │
│  │                                                                          │    │
│  │  📞 전화번호 (SMS/카카오 공용)                                           │    │
│  │  ┌─────────────────────────────┐ [저장]                                   │    │
│  │  │ 010-0000-0000               │                                          │    │
│  │  └─────────────────────────────┘                                         │    │
│  │  형식: 010-XXXX-XXXX 또는 +82-10-XXXX-XXXX                              │    │
│  │  (둘 다 OFF + 빈 칸이면 collapsed: 안내문만 + "전화번호 추가" link button)│    │
│  └────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### A.3 컴포넌트 트리

```
<TabsContent value="notifications">
  <NotificationsSection
    notifyByEmail={...}     // R35
    hasEmail={...}          // R35
    notifyBySms={...}       // R38 신규
    notifyByKakao={...}     // R38 신규
    phoneNumber={...}       // R38 신규 (string | null)
  />
</TabsContent>

<NotificationsSection>
  <header>알림 환경설정 + helper text</header>
  <Card>                                        // 단일 카드, R35 형태 유지
    <ChannelRow icon={Mail}    channel="email" .../>     // R35 그대로
    <Divider/>
    <ChannelRow icon={MessageSquare} channel="sms" .../> // 신규
    <Divider/>
    <ChannelRow icon={MessageCircle} channel="kakao" .../>// 신규
    <Divider/>
    <PhoneNumberField                                     // 신규
       value={phoneNumber}
       onSave={(next) => mutate({phoneNumber: next})}
       collapsed={!notifyBySms && !notifyByKakao && !phoneNumber}
    />
  </Card>
</NotificationsSection>
```

`ChannelRow`/`PhoneNumberField`는 **별도 export 컴포넌트 만들지 않는다**(파일 1개 안에서 inline 함수로 충분, R35 구조 보존). 만약 frontend가 가독성을 위해 분리하고 싶다면 같은 파일 내 private function component로.

### A.4 상태와 props 매핑 (API 계약 §6과 1:1)

| UI 상태 | 출처 | 변경 채널 |
|---|---|---|
| `notifyByEmail` (boolean) | `GET /api/v1/me`.notifyByEmail (R35) | `PATCH /api/v1/me/preferences { notifyByEmail }` |
| `notifyBySms` (boolean) | `GET /api/v1/me`.notifyBySms (R38) | `PATCH /api/v1/me/preferences { notifyBySms }` |
| `notifyByKakao` (boolean) | `GET /api/v1/me`.notifyByKakao (R38) | `PATCH /api/v1/me/preferences { notifyByKakao }` |
| `phoneNumber` (string \| null) | `GET /api/v1/me`.phoneNumber (R38) | `PATCH /api/v1/me/preferences { phoneNumber }` |
| `hasEmail` (R35) | `me.email != null` | (서버) ProfileSection에서 변경 |

### A.5 인터랙션과 상태 전이

#### A.5.1 SMS row

| 트리거 | 결과 |
|---|---|
| `phoneNumber == null` 인 상태에서 사용자가 토글 클릭 | **클릭 차단** (Switch `disabled=true`). helper text 마지막 줄에 빨강 글씨로 "전화번호를 먼저 등록하세요" |
| `phoneNumber` 입력 후 저장 → 토글 클릭 | optimistic update + `PATCH /api/v1/me/preferences { notifyBySms: true }`. 성공 시 toast "SMS 알림을 받습니다.", 실패 시 rollback + toast "환경설정 저장에 실패했습니다." |
| ON → OFF | 동일 패턴, toast "SMS 알림을 받지 않습니다." |
| 저장 중(`mutation.isPending`) | Switch `disabled=true` (R35와 동일) |
| `SMS_ENABLED=0` 서버 환경 (PM decision §D-3) | **옵션 a (recommended):** Switch enabled, 클릭/저장은 정상, 단 row 우측 끝에 small Badge "발송 중지(서버 설정)" + tooltip "관리자에게 문의하세요." 의사 표현은 가능, 실제 발송은 SKIPPED. **옵션 b:** Switch disabled. 이 경우 helper에 같은 안내. |

#### A.5.2 카카오 row

SMS와 동일 패턴. helper 카피만 다름 (§B 참고). `KAKAO_ENABLED=0` 처리 SMS와 동일.

#### A.5.3 전화번호 input

- **collapsed 조건:** `!notifyBySms && !notifyByKakao && !phoneNumber`. 이 경우 row 자리에 회색 helper text "SMS 또는 카카오 알림을 받으시려면 [+ 전화번호 추가] 버튼을 누르세요" 만 표시. 클릭 시 expand.
- **expanded:** `<Input>` + 우측 [저장] 버튼. R35 NotificationsSection은 form이 아니라 onCheckedChange 즉시 patch였지만, 전화번호는 typed input이라 **명시적 저장 버튼**이 맞다 (RHF + zod로 PasswordSection / ProfileSection과 같은 패턴).
- **검증 (zod):** 클라이언트는 `^(\+?82-?)?0?1[0-9]-?\d{3,4}-?\d{4}$` (한국 휴대폰 / +82 prefix 모두 허용). 서버 계약 §6은 `^\+?[0-9-]{8,20}$`로 더 느슨함 → **클라이언트가 더 엄격하게 잡고, 서버가 안전망.** 형식 미스 시 input 아래 빨강 텍스트 "휴대폰 번호 형식이 올바르지 않습니다. 010-XXXX-XXXX 또는 +82-10-XXXX-XXXX".
- **저장 후:** toast "전화번호가 저장되었습니다.". query invalidate → SMS/카카오 토글이 enabled로 전환.
- **삭제(빈 문자열 저장):** 두 토글이 모두 OFF인 상태에서만 허용. 둘 중 하나라도 ON이면 [저장] 클릭 시 confirm dialog "전화번호를 지우면 SMS/카카오 알림이 중단됩니다. 계속하시겠습니까?". 확인 시 PATCH `{ phoneNumber: null, notifyBySms: false, notifyByKakao: false }` (서버 atomic 권장).

#### A.5.4 phoneNumber + 토글 race

사용자가 phoneNumber input에 타이핑 중(unsaved) 상태에서 SMS 토글을 ON 시도하면? → **토글이 disabled 유지** (saved phoneNumber 기준 판단). 안내 helper "변경된 전화번호를 먼저 저장하세요" (RHF `isDirty`로 inline 표시). 이렇게 해야 UI 상태와 서버 상태가 분기되지 않는다.

### A.6 Loading / Empty / Error 상태

| 상태 | 표현 |
|---|---|
| 초기 로딩 | settings/page.tsx 자체 isLoading spinner (R35 기존 동작 그대로). NotificationsSection은 me 데이터 도착 후 마운트. |
| `me` 데이터 가져오기 실패 | settings/page.tsx 의 "사용자 정보를 불러올 수 없습니다." (R35 그대로) |
| mutation pending | Switch / [저장] 버튼 disabled, R35 패턴 |
| mutation 실패 | rollback + toast (ApiError.message). R35 `onError` 그대로 |
| phoneNumber 형식 에러 | input 아래 빨강 텍스트, RHF + zod |
| `SMS_ENABLED=0` 동시 토글 OFF | helper text 회색 "현재 환경에서는 SMS 발송이 비활성화되어 있습니다.". toggle 자체는 옵션 a 따라 enabled. |

### A.7 시각 일관성 — 비밀번호/서명 섹션과의 톤

- **카드 형태:** R35의 `rounded-lg border border-border bg-bg p-5` 그대로. PasswordSection / SignatureSection도 같은 카드 톤 → 일관.
- **헤더:** `text-base font-semibold text-fg` + 보조 `text-sm text-fg-muted` (R35 동일).
- **row 간격:** R35는 단일 row였음. row 3개로 늘어나면 row 사이 `border-t border-border my-4` divider로 구분 (PasswordSection의 form 필드 spacing과 시각 보조 일치).
- **아이콘 크기:** `h-5 w-5 text-fg-muted` (R35 Mail 아이콘과 동일 spec).
- **저장 버튼:** PasswordSection / ProfileSection의 우측 정렬 [저장] 버튼과 동일 — `<Button type="submit">` + 작은 Loader2 spinner.

### A.8 키보드 / 접근성

- **포커스 순서:** 메일 Switch → SMS Switch → 카카오 Switch → 전화번호 input → [저장]. (헤더는 `tabindex` 없음.)
- **Switch 키보드:** 기존 `<button role="switch">` 구현이라 Space/Enter 둘 다 toggle (Switch 컴포넌트 line 41-44).
- **disabled 상태 ARIA:** `<button role="switch" aria-checked={false} disabled aria-describedby="...">` + helper text id 매칭. SMS/카카오 row 모두 적용.
- **에러 announcement:** phoneNumber input에러 텍스트는 `<p id="phone-error" role="alert">`로 마킹 + input에 `aria-describedby="phone-error" aria-invalid="true"`. (R37 P1-4 패턴.)
- **focus-visible:** Switch의 `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1` (기존 컴포넌트). [저장] 버튼은 Button shadcn default ring.
- **명도대비:** 모든 helper text는 `text-fg-muted` (R37 P0-2 보정 후 4.5:1 ↑). "전화번호를 먼저 등록하세요" 빨강은 `text-danger` (이미 4.5:1 통과).

### A.9 카피 (한국어 우선)

| 위치 | 카피 |
|---|---|
| 섹션 헤더 | 알림 환경설정 |
| 섹션 helper | 결재·회신·시스템 알림을 받을 채널을 선택합니다. |
| 메일 row label | 이메일로 알림 받기 (R35 그대로) |
| 메일 row helper (이메일 등록 시) | 중요한 결재·회신 알림이 사이트 알림과 별도로 등록된 이메일로 발송됩니다. 끄면 사이트 알림(종 아이콘)만 받습니다. (R35 그대로) |
| SMS row label | SMS로 알림 받기 |
| SMS row helper | 중요 알림을 등록된 휴대폰 번호로 문자(SMS) 발송합니다. 외부 발송 비용이 발생할 수 있어 기본은 꺼져 있습니다. |
| SMS row helper (전화번호 미등록) | 전화번호를 먼저 등록하세요. (※ `text-danger`) |
| 카카오 row label | 카카오 알림톡 받기 |
| 카카오 row helper | 사전 승인된 카카오 알림톡 템플릿으로 결재·회신 알림을 받습니다. 카카오톡 친구 추가가 자동으로 진행됩니다. |
| 카카오 row helper (전화번호 미등록) | 전화번호를 먼저 등록하세요. |
| 전화번호 label | 전화번호 (SMS / 카카오 공용) |
| 전화번호 placeholder | 010-0000-0000 |
| 전화번호 helper | 형식: 010-XXXX-XXXX 또는 +82-10-XXXX-XXXX |
| 전화번호 검증 에러 | 휴대폰 번호 형식이 올바르지 않습니다. |
| collapsed 안내 | SMS 또는 카카오 알림을 받으시려면 전화번호를 등록하세요. |
| collapsed CTA 버튼 | + 전화번호 추가 |
| 저장 toast 성공 (SMS ON) | SMS 알림을 받습니다. |
| 저장 toast 성공 (SMS OFF) | SMS 알림을 받지 않습니다. |
| 저장 toast 성공 (카카오 ON) | 카카오 알림톡을 받습니다. |
| 저장 toast 성공 (카카오 OFF) | 카카오 알림톡을 받지 않습니다. |
| 저장 toast 성공 (phoneNumber) | 전화번호가 저장되었습니다. |
| 저장 toast 실패 | 환경설정 저장에 실패했습니다. (R35 그대로) |
| `_ENABLED=0` 배지 (옵션 a) | 발송 중지(서버 설정) |
| `_ENABLED=0` 배지 tooltip | 관리자에게 문의하세요. 현재 환경에서는 발송이 비활성화되어 있습니다. |
| phoneNumber 삭제 confirm | 전화번호를 지우면 SMS/카카오 알림이 중단됩니다. 계속하시겠습니까? |

---

## B. Push 채널 4종 비교 표 (in-app / 메일 / SMS / 카카오)

사용자에게 직접 보여주는 표는 아니지만, **frontend가 helper text와 tooltip 카피를 결정할 때, 그리고 PM이 매뉴얼(R32 산출물)에 channel 비교를 추가할 때 참조 자료**다.

| 항목 | in-app (종 아이콘) | 메일 | SMS | 카카오 알림톡 |
|---|---|---|---|---|
| **구현 라운드** | R29 | R35 | R38 | R38 |
| **대상 사용자** | 모든 사용자 (login 후) | 이메일 등록 사용자 | 전화번호 등록 + 토글 ON | 전화번호 등록 + 토글 ON |
| **default 상태** | 항상 ON (사이트 기본 채널) | ON (서버 default true) | OFF (외부 비용) | OFF (외부 비용 + 템플릿 사전 승인 필요) |
| **발송 시점** | mutation 시점 즉시 (DB row insert + websocket/polling) | mutation 직후 fire-and-forget BullMQ enqueue | mutation 직후 fire-and-forget BullMQ enqueue | mutation 직후 fire-and-forget BullMQ enqueue |
| **도착 지연** | 0~5초 (polling 30s) | 1~30초 (SMTP) | 1~10초 (이통사 망) | 1~5초 (카카오 비즈메시지 망) |
| **사용자 도달성** | 사이트 접속 중에만 인지 | 메일함 확인 시 | 항상 (휴대폰 들고 있는 한) | 항상 + 카톡 알림 |
| **비용** | 0원 (자체 시스템) | 0원~SMTP 사용료 | **건당 ~10~30원** (외부 API) | **건당 ~7~15원** (SMS보다 저렴) |
| **사용자 통제** | 종 아이콘 클릭으로 read 처리. OFF 불가 (시스템 채널) | settings 토글 ON/OFF | settings 토글 + 전화번호 + `SMS_ENABLED` | settings 토글 + 전화번호 + `KAKAO_ENABLED` |
| **시스템 의존** | DB + websocket/polling | SMTP server (mail-worker) + `MAIL_ENABLED` | 외부 SMS 사업자 (Twilio / generic HTTP) + `SMS_ENABLED` | 카카오 비즈메시지 사업자 (NCP SENS 등) + 사전 승인 templateCode + `KAKAO_ENABLED` |
| **발송 실패 시** | DB row 그대로 남음, 사용자가 결국 봄 | 큐 재시도 → DLQ. 사용자 모름 | 큐 재시도 → DLQ. 사용자 모름 | 큐 재시도 → DLQ. 사용자 모름. 단, 카카오는 미친구 시 SMS 자동 fallback 옵션 있음(NCP) — **§D-2 결정** |
| **개인정보 노출** | 사이트 내 (낮음) | 메일 본문 (중간) — 도면명/결재자명 포함 | 문자 본문 (중간) — 통신사 로그 | 카카오 서버 (높음) — 외부 사업자 보관 |
| **회사 정책 영향** | 없음 | 회사 메일 정책 | 회사 SMS 비용 정책 + 외부 API 약관 | 회사 카카오 채널 운영 + 외부 사업자 약관 |
| **trade-off 한 줄** | 사이트 안 접속하면 못 봄 | 도착률 보통 + 메일함 매몰 위험 | 도달성 최고 but 비용 + 글자수 제약(80자) | 도달성 최고 + 비용 저렴 but 사전 승인 필요 + 정형 템플릿만 가능 |

**사용자 카피용 요약(자기 설명문):**
- "메일은 천천히, 자세히. SMS는 빠르게, 짧게. 카카오는 빠르게 + 알림톡 형태로. 사이트(종)는 항상."

---

## C. 디자인 토큰 / 컴포넌트 변경 검토

### C.1 토큰

**변경 없음.** R35에서 도입된 `text-fg`, `text-fg-muted`, `bg-bg`, `border-border`, `text-danger`, `text-brand`, `bg-bg-muted` 그리고 R37 P0-2에서 보정된 `--fg-subtle` 모두 그대로 충분.

### C.2 컴포넌트

**신규 없음.** 모두 기존 활용:
- `Switch` (`apps/web/components/ui/switch.tsx`) — R35 그대로 (Space/Enter 키보드, focus-visible ring 이미 OK)
- `Input` / `Label` / `Button` — shadcn 기존
- `Tooltip` — `_ENABLED=0` 배지 hover 안내 (admin 페이지에서 이미 사용 중)
- `lucide-react` 아이콘 — `Mail`(R35), `MessageSquare`(SMS), `MessageCircle`(카카오). 이 둘은 lucide 표준 set에 있고 회사 알림톡 스타일에 가깝다. **카카오 공식 BI 색(노랑 #FEE500)은 사용하지 않음** — 토큰 일관성 + 외부 브랜드 노출 방지.

### C.3 zod schema (frontend)

`apps/web/components/settings/NotificationsSection.tsx` 또는 같은 파일 export 안:

```ts
// E.164 / 한국 010-XXXX-XXXX 둘 다 허용. 빈 문자열은 삭제 의도.
const phoneNumberSchema = z
  .string()
  .trim()
  .refine(
    (v) => v === '' || /^(\+?82-?)?0?1[0-9]-?\d{3,4}-?\d{4}$/.test(v),
    '휴대폰 번호 형식이 올바르지 않습니다.',
  );
```

서버 계약 §6는 더 느슨해 (`^\+?[0-9-]{8,20}$`) 형식 충돌 가능성 낮음. 클라이언트가 엄격, 서버가 안전망.

---

## D. PM decision items

| ID | 결정 항목 | 옵션 | 디자이너 권장 |
|---|---|---|---|
| **D-1** | **협력업체(PARTNER role)에게 SMS/카카오 토글을 노출할 것인가?** 외부 사용자 대상 SMS는 비용/스팸 리스크가 본사 사용자보다 높음. | (a) 노출 — 협력업체도 결재 회신 SMS 필요. (b) 비노출 — role gate. settings 알림 탭에서 SMS/Kakao 두 row를 PARTNER일 때 숨김. | **(a) 노출 + default 강제 OFF**. role gate를 두면 R29 메일과 정책 비대칭이 생기고, 사용자 자율 결정이 더 깔끔. 비용은 토글 default OFF로 통제. |
| **D-2** | **카카오 미친구 시 SMS auto-fallback 활성화?** 카카오 비즈메시지(NCP)는 친구 추가 안 된 사용자에게 SMS 자동 발송 옵션을 제공. | (a) ON — 도달성 최고. (b) OFF — 사용자가 둘 다 ON 한 경우 중복. (c) 토글 레벨에서 사용자가 직접 선택. | **(b) OFF (이번 라운드).** Stub-friendly 방향(계약 §4.2)과 부합. 사용자 설정 레벨로 노출하는 건 자동 라운드 시리즈 끝난 뒤 별도 카드. |
| **D-3** | **`SMS_ENABLED=0` / `KAKAO_ENABLED=0` 환경에서 토글 UX?** | (a) 토글 enabled + 우측 small badge "발송 중지(서버 설정)" + tooltip. 의사 표현은 가능, 실제 발송 SKIPPED. (b) 토글 disabled + helper "관리자에게 문의하세요". | **(a) badge.** 관리자가 나중에 ENABLED=1로 켰을 때 사용자 의사가 보존됨. 명시적이고 점진적이다. backend는 R35 메일 패턴(SKIPPED 상태)과 동일하게 처리하면 됨. |
| **D-4** | **알림 채널 카드를 단일 카드 vs 채널별 카드 분리?** | (a) 단일 카드 + divider로 row 구분 (본 spec 권장). (b) 채널 1개당 카드 1개 — 시각 분리 강함. | **(a) 단일 카드.** 사용자 인지가 "알림 채널 묶음"이라 단일 카드가 자연. 채널이 5개를 넘으면 (b)로 재고. |
| **D-5** | **전화번호 위치: 알림 섹션 vs 프로필 섹션?** ProfileSection은 이메일을 갖고 있어 phoneNumber도 거기 두는 편이 데이터 모델적으로 깔끔할 수 있음. | (a) 알림 섹션(본 spec) — SMS/카카오와 같은 카드. (b) 프로필 섹션 — fullName/email 옆. | **(a) 알림 섹션.** phoneNumber는 SMS/카카오의 종속 입력이고, 사용자는 SMS 토글을 켤 때 처음으로 전화번호 등록 동기를 가짐. 프로필에 두면 "왜 등록해야 하지?" 문맥이 없어 채택률 떨어짐. ProfileSection의 phone은 향후 다른 용도(예: 비밀번호 초기화 OTP) 도입 시 옮길 수 있음. |
| **D-6** | **카카오 알림톡 helper text에 "친구 추가 자동" 안내 필요?** 사실 NCP/카카오 비즈메시지는 친구가 아니더라도 발송 가능(승인된 channelId 보유 시). | (a) 안내 — "카카오톡 친구 추가가 자동으로 진행됩니다." (b) 단순화 — "카카오톡으로 알림을 받습니다." | **(b) 단순화.** D-2가 (b)이므로 친구 추가 흐름을 사용자가 의식할 필요 없음. helper에서 친구 자동 추가 문구는 제거 권장 (위 §A.9 카피 표는 PM 결정대로 토글). |

---

## E. frontend 구현 체크리스트

이 문서를 받은 frontend agent가 그대로 항목별 PR 작성 가능하도록.

- [ ] `apps/web/app/(main)/settings/page.tsx`의 `MeResponse`에 `notifyBySms?: boolean`, `notifyByKakao?: boolean`, `phoneNumber?: string | null` 3개 필드 추가
- [ ] `<NotificationsSection>` props 시그니처 확장 (§A.3)
- [ ] `<NotificationsSection>` 본문에 SMS row + 카카오 row + PhoneNumberField 추가 (§A.2)
- [ ] zod phoneNumberSchema (§C.3)
- [ ] phoneNumber expand/collapse 로직 (§A.5.3)
- [ ] phoneNumber 삭제 confirm dialog (§A.5.3)
- [ ] phoneNumber `isDirty` 시 토글 disabled 가드 (§A.5.4)
- [ ] `_ENABLED=0` badge + tooltip (D-3 결정 따라 — 권장 옵션 a)
- [ ] D-1 PARTNER role gate (PM 결정 — 권장 옵션 a, 별도 코드 없음)
- [ ] toast 카피 (§A.9)
- [ ] aria attributes (§A.8)
- [ ] R37 WCAG 회귀 0건 (text-fg-muted contrast 등)
- [ ] vitest: `<NotificationsSection>`의 phoneNumber 검증 + collapsed 분기 + race 분기

---

## F. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-04-27 | 초기 작성 (R38 — N-2 SMS/카카오 채널 추가 디자인) |
