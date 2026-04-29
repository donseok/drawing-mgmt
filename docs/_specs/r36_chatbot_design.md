# R36 — ChatPanel 디자인 스펙

| 항목 | 내용 |
|---|---|
| Round | R36 |
| Subject | 귀여운 로봇 챗봇 + 동국씨엠 브랜드 톤 + 풍부한 UX |
| Status | Draft (designer) |
| 대상 API 계약 | `_workspace/api_contract.md` (R36) |
| 디자인 가이드 | `docs/DESIGN.md` v0.1 |
| 디바이스 | Desktop primary (≥1280) + 모바일 보조 (<640 sheet) |

---

## 1. 컨셉 한 줄

> **"옆 자리 신입 엔지니어 같은 작은 강철 로봇 'Dolly'가 폴더·결재·도면을 함께 찾아준다."**
>
> 친근하지만 차분한 인상. 동국씨엠의 메탈릭 블루(차가운 정밀함)에 따뜻한 액센트(시그널 옐로)를 한 점 얹어 "엄격한 EDMS 안에서도 사람을 도와준다"는 신호를 준다. 캐릭터는 절대 화려하지 않고 — Linear/Vercel 톤의 dense 엔지니어링 UI 위에 어색하지 않게 얹힌다.

---

## 2. 로봇 캐릭터 스펙 — "Dolly"

### 2.1 페르소나 후보

| 항목 | 값 |
|---|---|
| **이름** | **Dolly** (rolling mill의 "Doll" + 친근감. 동국씨엠 냉연 도메인 hint) |
| 대안 | Cobalt (브랜드 컬러), Pico (작은 로봇), Iron (PM 결정 필요) |
| 1인칭 | "저" (정중·존대) |
| 톤 | 차분하지만 살짝 호기심 많은 신입. 모르는 건 모른다고 말함. 이모지 X. |
| 인사 | "안녕하세요, 저는 도면관리 도우미 Dolly예요. 무엇을 도와드릴까요?" |

> **PM 결정 필요:** 이름. Dolly가 가장 안전(국내 발음 친숙·도메인 연관). 사내 컨벤션이 있으면 그쪽 우선.

### 2.2 시각 컨셉

- **머리**: 둥근 사각(rounded rect, radius=4 of 16-unit grid). 냉연강판 코일을 옆에서 본 느낌.
- **눈**: 두 개의 단순한 원 (●) — 흰자 없이 통점. 표정은 "눈 모양"으로만 변화 (안심감 + 단순함).
- **안테나**: 머리 위 짧은 막대(2unit) + 끝 점 1개. 액센트 컬러로 상태 표시(생각 중일 때 깜빡).
- **몸**: 머리보다 살짝 큰 둥근 사각. 가슴 중앙에 작은 사각 발광부(LED 패널 느낌). 발광부는 brand 컬러(파랑) — 시스템 정체성 시그널.
- **팔/다리**: 생략. 상반신만 있는 흉상 형태(thumb/avatar 친화).
- **그림자**: 바닥에 1px 옅은 타원 (있어도 되고 없어도 됨, 컴포지션 결정).

### 2.3 SVG 구조 트리

```
<svg viewBox="0 0 64 64" role="img" aria-hidden="true">
  shadow                  ellipse cx=32 cy=58 rx=16 ry=2 fill="bot.fg"/0.08
  ─ antenna
    line  x1=32 y1=4 x2=32 y2=11   stroke="bot.fg-soft" width=2 round
    dot   circle cx=32 cy=4 r=2 fill="bot.accent"  ← STATE: idle solid / thinking pulse / speaking solid
  ─ head
    rect  x=14 y=11 w=36 h=26 rx=10 ry=10  fill="bot.primary"
    ear-L rect x=10 y=20 w=4 h=8  rx=1  fill="bot.primary-deep"
    ear-R rect x=50 y=20 w=4 h=8  rx=1  fill="bot.primary-deep"
    visor (face plate)
          rect x=18 y=17 w=28 h=14 rx=6 fill="bot.faceplate"   (라이트=#0F1E33-ish, 다크=#0B1320)
    eye-L circle cx=26 cy=24 r=2.5 fill="bot.eye"            ← idle: solid round
    eye-R circle cx=38 cy=24 r=2.5 fill="bot.eye"
  ─ body
    rect  x=18 y=38 w=28 h=18 rx=6 ry=6 fill="bot.primary"
    chest rect x=28 y=44 w=8 h=6 rx=1 fill="bot.brand-glow"   (=hsl(var(--brand)) 직접 사용)
</svg>
```

ASCII 스케치 (정면):

```
        .
        |        ← 안테나 (액센트 깜빡)
      . | .
   ┌────●────┐
  ┌┤  ┌────┐ ├┐   ← 머리 + 양쪽 귀
  └┤  │● ●│ ├┘   ← visor (어두운 얼굴판) + 두 눈
   └──└────┘──┘
     ┌──────┐
     │ ┌──┐ │      ← 몸통 + 가슴 LED (brand 파랑)
     │ │■■│ │
     └─└──┘─┘
       ────         ← 그림자
```

### 2.4 상태 변형 (3종)

| 상태 | 트리거 | 변형 | 모션 |
|---|---|---|---|
| **idle** | 평상시 | 눈 = 동그란 점 (●●). 안테나 dot solid. 가슴 LED 일정 밝기. | 4s 주기로 **눈 깜빡임** (eye scaleY 1 → 0.1 → 1, 120ms). 안테나 dot 정적. |
| **thinking** | 어시스턴트 응답 대기 (POST /chat in-flight) | 눈 = 위로 살짝 올라간 호 (`^^`, scaleY 0.4 + translateY -1). 안테나 dot 펄스. | 안테나 dot 1.2s 주기 opacity 0.3↔1. 옆에 점 3개(• • •) 1.2s stagger. 눈 깜빡임 잠깐 정지. |
| **speaking** | 첫 응답 청크 도착 후 ~600ms (현재는 stream X라서 응답 도착 직후 600ms 펄스) | 눈 = 살짝 커짐(r 2.5 → 3). 안테나 dot solid + 1회 flash. | 가슴 LED 600ms ease-out 밝아졌다 원위치. 메시지 풍선이 fade+slide-up 들어올 때 동기화. |
| (보너스) **error** | 직전 메시지가 에러 | 눈 = 작은 가로줄(`- -`, scaleY 0.15). 안테나 dot 액센트 컬러 → danger로 일시 교체. | 정적. 가슴 LED 회색. |
| (보너스) **offline / 룰 모드** | mode='rule' 첫 진입 | 가슴 LED 더 어둡게(brand-soft). 헤더 배지 "룰 베이스" | 모션 없음 |

> 모든 모션은 `prefers-reduced-motion: reduce`에서 즉시 정지(opacity/transform 정적 값으로 고정).

### 2.5 크기 가이드

| 위치 | 픽셀 | viewBox | 비고 |
|---|---|---|---|
| 메시지 버블 옆 어시스턴트 아바타 | **24px** | `0 0 64 64` 그대로 축소 | 라인 두께가 가늘게 보일 수 있어 stroke-width 2 유지 |
| FAB 버튼 안 | **28px** | 동일 | FAB 배경(brand) 위에 흰 캐릭터 변형 사용 (caveat 참고) |
| 패널 헤더 아바타 | **32px** | 동일 | 이름 옆 |
| 빈 세션 환영 화면 (히어로) | **80px** | 동일 | 가운데 정렬, 위에 대화 시작 카피 |
| Onboarding tooltip / Tour | **48px** | 동일 | (Phase 2) |

> **FAB caveat:** FAB은 brand 컬러로 칠해진 원이라, 그 위에 같은 brand 컬러의 캐릭터를 얹으면 안 보임. FAB 안 캐릭터는 "단색 화이트 변형"(`bot-on-brand`)을 사용 — head/body 모두 흰색, visor만 brand-deep, 눈은 brand-deep. (10번 토큰 표 참조)

### 2.6 색상 매핑 (어느 부품에 어느 토큰)

| 부품 | 토큰 | 비고 |
|---|---|---|
| head, body | `bot-primary` | 메탈릭 블루 본체 |
| ear, head shadow | `bot-primary-deep` | 본체보다 한 단계 어두운 톤(접합부) |
| visor (얼굴판) | `bot-faceplate` | 거의 검정에 가까운 짙은 청회색 |
| eye (점) | `bot-eye` | 라이트 모드 = bot-soft(밝은 시안 화이트), 다크 모드 = bot-soft 그대로 |
| antenna stroke | `bot-fg-soft` | 본체와 톤 맞춤 |
| antenna dot | `bot-accent` | 시그널 옐로 (idle / thinking) |
| chest LED | `brand` (기존) | 시스템 정체성 — 챗봇만의 색이 아니라 시스템 brand로 |
| FAB 안 화이트 변형 | `bot-on-brand-fg` (=흰색) | FAB 배경 brand와 분리 |
| error 시 antenna dot | `danger` (기존) | 의미 일관성 |
| 그림자 | `bot-fg / 0.08` | 알파 적용 |

---

## 3. 컬러 토큰 정의 (CSS Variables)

> 동국씨엠 CI가 공식 색표로 잡혀 있지 않다는 가정 하에, "냉연강판 제조사 = 차가운 메탈릭 블루 + 산뜻한 시그널 옐로" 톤을 합리적 디폴트로 제안. CI 가이드가 확정되면 hue/saturation 1차 보정.

### 3.1 신규 변수 (globals.css에 추가)

```css
:root {
  /* R36 — Chatbot palette
   * 기존 --brand(파랑)와 보완 관계. 챗봇 영역에서만 사용해 시스템 정체성과
   * 챗봇 정체성을 분리한다. 일반 UI에서는 절대 사용 X (primary CTA에 쓰지 말 것).
   */
  --bot-primary:       212 38% 38%;   /* 메탈릭 블루 본체 (#3D5C7A 근처) */
  --bot-primary-deep:  212 40% 28%;   /* 그림자/접합부 */
  --bot-soft:          210 40% 96%;   /* 메시지 풍선 배경 (어시스턴트) / 눈 */
  --bot-accent:        45 95% 55%;    /* 시그널 옐로 (안테나 dot, 강조 1점) */
  --bot-faceplate:     215 35% 12%;   /* visor — 거의 검정 청회색 */
  --bot-fg:            215 30% 18%;   /* 캐릭터 위에 얹는 텍스트(거의 안 씀) */
  --bot-fg-soft:       215 20% 55%;   /* 안테나 stroke 등 보조선 */
  --bot-on-brand-fg:   0 0% 100%;     /* FAB 배경(brand) 위 캐릭터용 화이트 */
}

.dark {
  --bot-primary:       212 45% 56%;   /* 라이트보다 lightness ↑ — 어두운 배경에서 식별 */
  --bot-primary-deep:  212 45% 42%;
  --bot-soft:          212 30% 18%;   /* 어두운 풍선 배경 */
  --bot-accent:        45 90% 62%;    /* 시그널 옐로 — 채도 살짝 ↓ */
  --bot-faceplate:     215 35% 8%;    /* 더 깊게 */
  --bot-fg:            210 30% 92%;
  --bot-fg-soft:       215 15% 65%;
  --bot-on-brand-fg:   0 0% 100%;
}
```

### 3.2 Tailwind config 매핑

```ts
// tailwind.config.ts → theme.extend.colors
bot: {
  primary:     'hsl(var(--bot-primary))',
  primaryDeep: 'hsl(var(--bot-primary-deep))',
  soft:        'hsl(var(--bot-soft))',
  accent:      'hsl(var(--bot-accent))',
  faceplate:   'hsl(var(--bot-faceplate))',
  fg:          'hsl(var(--bot-fg))',
  fgSoft:      'hsl(var(--bot-fg-soft))',
  onBrandFg:   'hsl(var(--bot-on-brand-fg))',
},
```

> 키마다 두 가지 표기(`primary-deep` vs `primaryDeep`) 중 Tailwind 컨벤션은 camelCase가 안전. 기존 `'bg-subtle'`처럼 dash를 쓰는 키도 있으니 frontend가 일관성 있게 매핑.

### 3.3 기존 brand 토큰과의 관계

- **`--brand`** = 시스템 전체의 primary 컬러(파랑 #2563eb). 모든 CTA, 글로벌 검색 아이콘, NavRail active bar, 헤더 로고 배지에 쓰임. **변경 X**.
- **`--bot-primary`** = 챗봇 캐릭터의 본체 색. brand보다 채도가 낮고(38% saturation) 어둡다. 의도적으로 brand와 분리해 "챗봇이 시스템 전체를 대변하는 게 아니라 도구의 일부"라는 인지 정렬.
- **챗봇 영역의 brand 사용처** (충돌 없는 예외 1곳): 캐릭터 가슴 LED. 시스템 정체성 신호로 brand를 한 점만 주입.
- **금지:** `bot-primary`로 일반 버튼 칠하기, brand로 캐릭터 본체 칠하기. 두 토큰이 의미적으로 섞이면 시각 위계가 무너진다.

### 3.4 명도 대비 (WCAG 2.1 AA 검증)

| 조합 | 비율 | 4.5:1 (보통) | 3:1 (Large) |
|---|---|---|---|
| 라이트 | `bot-primary` (#3D5C7A 근처) on `bg`(white) | ≈ 5.6:1 | OK | OK |
| 라이트 | `fg` on `bot-soft`(거의 흰색) — 어시스턴트 풍선 본문 | ≈ 16:1 | OK | OK |
| 라이트 | `bot-accent`(노랑) on `bot-primary` (안테나 dot) | ≈ 3.1:1 | NG (보통 텍스트로 안 씀) | OK (large/decorative) |
| 다크 | `bot-primary` on `bg`(거의 검정) | ≈ 4.6:1 | OK | OK |
| 다크 | `fg` on `bot-soft`(212 30% 18%) | ≈ 11:1 | OK | OK |
| 다크 | `bot-accent` on `bot-primary` | ≈ 3.0:1 | NG (장식용만) | OK |

> bot-accent는 **장식 dot**으로만 쓰며 그 위에 텍스트를 얹지 않는다. 이로써 AA 준수.

---

## 4. 레이아웃 / 컴포넌트 명세

### 4.1 라우팅 / 진입점

- 챗봇은 라우트가 아니라 **모든 (main) 레이아웃에 mount되는 floating 위젯**.
- `apps/web/app/(main)/layout.tsx` 내부 (또는 `AppShellClient`)에 `<ChatToggle variant="fab" />` 1개. 헤더에서 진입점은 제거됨(API 계약 §0 참조).
- 비로그인 라우트(`/login`, `/share/[token]` 등)에서는 노출 X — 기존 layout 가드 그대로.
- 풀스크린 뷰어(`/viewer/[id]`)에서는 FAB이 캔버스를 가리지 않도록 자동 숨김. 단축키 `⌘.`만 동작 (PM 결정 필요: 뷰어에서 챗봇 자체를 끄는 게 자연스러우면 그냥 숨김).

### 4.2 컴포넌트 트리

```
<ChatToggle variant="fab">                       ← 항상 mount
  ├─ <FabButton>                                 ← 우하단 floating
  │   ├─ <RobotAvatar size="fab" state="idle"/>  ← FAB 안 캐릭터 화이트 변형
  │   └─ <UnreadBadge count={n}/>                ← 우상단 (선택)
  └─ {chatOpen && <ChatPanel/>}

<ChatPanel>                                      ← Sheet/Drawer (≥640: 우하단 floating, <640: full screen)
  ├─ <PanelHeader>
  │   ├─ <RobotAvatar size="header" state={panelState}/>
  │   ├─ <PanelTitle name="Dolly" subtitle={"RAG 모드" | "룰 베이스" | "오프라인"}/>
  │   ├─ <ModeBadge mode={'rag'|'rule'|'offline'}/>
  │   ├─ <SessionsToggle aria-expanded={sessionsOpen}/>  ← 햄버거 → 사이드바 펼침
  │   └─ <CloseButton onClick={close} aria-label="닫기"/>
  ├─ <SessionsSidebar isOpen={sessionsOpen}>     ← 좌측 슬라이드인, 데스크톱 width 220, 모바일 풀스크린 별도 화면
  │   ├─ <NewSessionButton/>
  │   └─ <SessionList items={sessions}>
  │       └─ <SessionRow title updatedAt messageCount onClick onDelete/>
  ├─ <PanelBody>
  │   ├─ {messages.length === 0 ? <EmptySession/> : <MessageList/>}
  │   └─ <QuickActionsRow actions={quickActions}/>  ← 입력창 위 sticky
  ├─ <Composer>
  │   ├─ <Textarea autosize/>
  │   ├─ <SendButton/>
  │   └─ <ComposerHint shortcut="Enter / Shift+Enter / ⌘."/>
  └─ <PanelFooter>                              ← (선택) 매우 작은 disclaimer
      └─ "AI 응답은 정확하지 않을 수 있어요 · 출처 확인 권장"
</ChatPanel>
```

### 4.3 props / 상태 (frontend가 그대로 코드에 옮길 수 있게)

#### `<ChatPanel>` 자체 상태
- `panelState: 'idle' | 'thinking' | 'speaking' | 'error'` — 캐릭터에 전달
- `mode: 'rag' | 'rule'` — API 응답 기반. 첫 응답 도착 후 갱신
- `health: 'ok' | 'rule-only' | 'offline'` — `GET /chat/health` 결과 캐시 (30s)
- `sessionId: string | undefined`
- `messages: ChatMessage[]` — `GET /chat/sessions/[id]` 또는 in-memory append
- `sessions: ChatSession[]` — `GET /chat/sessions`
- `sessionsOpen: boolean`
- `quickActions: ChatQuickAction[]` — `GET /chat/quick-actions`
- `inputValue: string`
- `error: { message: string; retryable: boolean } | null`
- `rateLimit: { until: number } | null` — `E_RATE_LIMIT` 응답 시 `retryAfter`로 채움

#### 외부 store (Zustand `useUiStore` 기존)
- `chatOpen: boolean` — 토글 상태(이미 있음)
- `chatLastSessionId?: string` — 마지막으로 본 세션 ID 기억(localStorage persist)

#### TanStack Query keys
- `['chat', 'sessions']` — 세션 리스트
- `['chat', 'session', id]` — 세션 + 메시지
- `['chat', 'quick-actions']` — staleTime 5min
- `['chat', 'health']` — staleTime 30s

### 4.4 FAB 버튼

- **위치:** `fixed bottom-5 right-5 z-40` (기존 그대로)
- **크기:** 56x56 원형. 기존 48x48보다 살짝 키워 캐릭터 노출 + 클릭 타깃 개선(접근성 ≥44).
- **배경:** `bg-brand` (=시스템 brand). hover시 `bg-brand-hover`.
- **링:** 1px ring inside `ring-brand/20` (저채도 광휘). 다크 모드에서도 동일 토큰.
- **그림자:** `shadow-lg` (기존 elevation token `elevation-popover` 사용 가능).
- **내부:** `<RobotAvatar size="fab" state="idle"/>` (28px, 화이트 변형). 캐릭터는 살짝 위로 1px translate해서 시각 중심 보정.
- **알림 뱃지:** 우상단 -2 / -2 위치 12x12 원형. 배경 `bg-danger`(존재하지 않는 상태 안내가 있을 때) 또는 `bg-bot-accent`(빠른 액션 변경 등). 숫자 1자리, 9건 초과는 `9+`.
- **호버 모션:** `scale(1.05)` + 안테나 dot 펄스 1회. 100ms ease-out.
- **활성(패널 열림) 상태:** 배경 `bg-bot-primaryDeep`로 전환 + 캐릭터의 visor만 살짝 밝게. 사용자가 "지금 열려 있다"를 인지.
- **포커스:** `focus-visible:ring-2 ring-ring ring-offset-2` (기존 패턴).
- **단축키:** `⌘.` 토글 — 기존 동작 유지(`useUiStore.toggleChat`).
- **풀스크린 뷰어 + 명령 팔레트 열림 시:** FAB 자동 hide(`opacity-0 pointer-events-none`).

### 4.5 패널 컨테이너

#### 데스크톱 (≥640)
- **위치:** `fixed bottom-20 right-5 z-40` — FAB 위에 살짝 띄움(gap 12px).
- **크기:** `w-[420px] h-[640px]` — 기존 400×480보다 키워 메시지 가독성 + 빠른 액션 + 출처 표시 공간 확보. 1280-1400 최소 화면에서도 우측 Detail Panel과 겹치지 않게(우측 Detail Panel 활성 시 자동 좌측 시프트는 Phase 2, 일단 z-index 우선).
- **반경:** `rounded-lg` (8px).
- **그림자:** `elevation-modal` (`0 12px 32px rgb(0 0 0 / 0.12)`).
- **테두리:** `border border-border`.
- **배경:** `bg-bg`.
- **스크롤:** PanelBody만 내부 스크롤. 헤더/Composer는 sticky.

#### 1280–1440 좁은 데스크톱 임계점
- 기본 420×640 그대로. 사용자가 폴더 트리(240) + 검색 결과(fluid) + Detail Panel(400)을 동시에 펼친 경우에만 챗봇이 뷰포트 우측을 가릴 수 있음. 이 경우는 사용자가 챗봇을 닫는 것이 자연스럽다(명시적 액션).

#### 모바일 (<640)
- **Sheet 변형:** shadcn `<Sheet side="bottom">`을 사용하되 `h-[100dvh]`로 풀스크린.
- 헤더의 닫기 버튼 외에 **상단 핸들(grab handle)** 1개 — 사용자가 끌어내려서 닫기 가능.
- 가상 키보드 올라올 때 Composer가 키보드 위에 따라오도록 `position: sticky; bottom: env(keyboard-inset-height, 0)`. iOS Safari 대응.
- SessionsSidebar는 **별도 화면**(같은 sheet 안에서 transform translate-x). 햄버거 → 풀폭 사이드뷰 → 뒤로가기로 복귀.

### 4.6 패널 헤더

```
┌──────────────────────────────────────────────────────────┐
│ [≡] [🤖 32px] Dolly             [● RAG] [전체화면] [✕] │
│      도면관리 도우미 · 응답 중...                          │
└──────────────────────────────────────────────────────────┘
height = 56
```

| 슬롯 | 내용 |
|---|---|
| 좌측 [≡] | SessionsSidebar 토글. `aria-label="이전 대화"`. 활성 시 background `bg-bg-muted`. |
| 아바타 | `<RobotAvatar size="header" state={panelState}/>` 32px. `aria-hidden`. |
| 제목 영역 | <strong class="text-sm font-semibold">Dolly</strong> + 부제 `text-[11px] text-fg-muted` (현재 상태 텍스트). 부제 예시: "도면관리 도우미", "생각하고 있어요…", "잠시 후 다시 시도해 주세요" |
| ModeBadge | 4.6.1 참조 |
| (선택) 전체화면 | Phase 2. 일단 hide. |
| 닫기 [✕] | 기존 패턴. `aria-label="닫기"`, Esc로도 동작. |

#### 4.6.1 ModeBadge (헤더 우측)

| mode | 라벨(한국어) | 보조 라벨(영문) | 배경 | 텍스트 | 아이콘 |
|---|---|---|---|---|---|
| `rag` | **RAG** | 'AI' | `bg-brand/12` | `text-brand` | `Sparkles` 12px |
| `rule` | **룰 베이스** | 'BASIC' | `bg-warning/15` | `text-warning` | `BookOpen` 12px |
| `offline` | **오프라인** | 'OFFLINE' | `bg-bg-muted` | `text-fg-muted` | `WifiOff` 12px |

- 사이즈: `h-5 px-1.5 text-[11px] font-semibold rounded`.
- 클릭 시 tooltip popover로 `health.reason` 노출 ("LLM endpoint 미설정 — 룰 모드").

### 4.7 빠른 액션 칩 영역

- **위치:** Composer 바로 위. PanelBody 안에 sticky bottom (메시지 스크롤이 칩을 가리지 않도록).
- **레이아웃:** `flex gap-2 overflow-x-auto no-scrollbar px-3 py-2`. 가로 스크롤. 우측 끝에 fade gradient 6px(스크롤 가능 신호).
- **칩 디자인:** `<button class="h-8 shrink-0 inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-3 text-xs font-medium text-fg hover:border-brand hover:text-brand focus-visible:ring-2 ring-ring">`
- **칩 prefix 아이콘:** 12px Lucide. 칩별 매핑은 §6.
- **동작 (kind):**
  - `navigate` — `router.push(href)` + 패널 닫기(선택)
  - `palette` — `useUiStore.setPaletteOpen(true, paletteQuery)`
  - `tool` — 사용자에게 보이는 텍스트 메시지 자동 전송(예: "최근 활동 보여줘") + tool 호출
  - `prompt` — Composer 입력창에 `promptText` 채워넣기 + 포커스
- **숨김 조건:** 메시지가 5건 이상 쌓이면 칩 영역 자동 collapse → 좌측 끝에 `[빠른 액션 ▾]` 버튼만. 사용자 명시 클릭 시 다시 펼침.
- **모바일:** 가로 스크롤 유지. 칩 높이 32px, tap target ≥44는 좌우 padding으로 보충.

### 4.8 메시지 리스트

#### 4.8.1 어시스턴트 메시지

```
[🤖 24px]  ┌──────────────────────────────────────┐
            │ "메인롤러 어셈블리 도면 12건이 있어요." │
            │                                       │
            │ ── 출처 ─────────────────────────     │
            │ [PRD §3.4]  [TRD §7]  [매뉴얼: 체크인] │
            │                                       │
            │ ── 다음에 할 일 ────────────────       │
            │ [📂 검색 페이지 열기] [📋 결재함]     │
            └──────────────────────────────────────┘
                              09:42 · RAG · [복사][다시][공유]
```

- **컨테이너:** `flex gap-2 items-start`. 어시스턴트는 좌측 정렬.
- **아바타:** 24px. 메시지가 연속(같은 role 직전 60초 이내)이면 아바타 생략하고 들여쓰기.
- **풍선:** `max-w-[85%] rounded-2xl rounded-tl-sm bg-bot-soft px-3.5 py-2.5 text-sm text-fg`. 라이트 모드 풍선은 `bot-soft`(거의 흰색). 다크 모드는 `bot-soft`(212 30% 18%).
- **Markdown 허용:** 굵게/기울임/리스트/링크/코드. 코드는 `JetBrains Mono` + 우상단 복사 버튼.
- **Sources 칩:** 메시지 본문 아래 구분선(`border-t border-border/60 my-2`) + "출처" 작은 라벨 + 칩들. 칩: `inline-flex h-6 px-2 rounded text-[11px] font-medium bg-bg-muted text-fg-muted hover:text-fg hover:bg-bg-subtle`. 라벨 = `${source}: ${title}` (예: `PRD: 3.4 자료유형`). similarity 0.8↑은 칩 좌측에 작은 dot `bg-success`. 칩 클릭 → 팝오버에 청크 본문 prefix 200자 + "원문 열기"(href는 `docs/`에 매핑되면 새 탭, 아니면 disabled).
- **Actions 버튼:** 메시지 본문 아래 또 다른 영역. "다음에 할 일" 라벨 + 버튼들. 버튼 디자인 = §4.7 칩과 동일하되 padding 조금 크게(`h-8 px-3`).
- **Meta line:** 풍선 외부(아래) `text-[11px] text-fg-subtle`. `HH:MM · MODE_BADGE_INLINE · [복사][재생성][공유]` (재생성은 RAG 모드만, 공유는 sessionId 링크 복사). 인라인 mode 배지는 `RAG`/`RULE` 텍스트 + 미니 dot.

#### 4.8.2 사용자 메시지

- 우측 정렬. 풍선 = `bg-brand text-brand-foreground rounded-2xl rounded-tr-sm px-3.5 py-2.5`.
- 아바타 없음(공간 절약). 대신 풍선 외부 우측에 작은 시각 `text-[11px] text-fg-subtle`.
- 사용자 메시지는 markdown 미지원, 줄바꿈만 보존(`whitespace-pre-wrap`).

#### 4.8.3 시스템 메시지 / 인라인 안내

- 가운데 정렬, 풍선 없음. `text-[11px] text-fg-muted`.
- 예: "이전 대화를 불러왔습니다.", "새 대화가 시작되었어요."

#### 4.8.4 메시지 그룹 / 날짜 구분

- 메시지가 30분 이상 떨어졌거나 날짜가 바뀌면 가운데 정렬 구분선: `── 오늘 14:33 ──` (`text-[11px] text-fg-subtle`).

### 4.9 Composer (입력창)

- **컨테이너:** `border-t border-border bg-bg p-2`. sticky bottom.
- **레이아웃:** `flex items-end gap-2`.
- **Textarea:**
  - shadcn `<Textarea>` 기반, autosize 1~6행 (1행 36, 6행 144, 그 이상은 내부 스크롤).
  - placeholder: "무엇을 도와드릴까요? (예: 'CGL-MEC-2026-00012 보여줘')"
  - `aria-label="메시지 입력"`.
  - 포커스: `focus-visible:ring-2 ring-ring`.
  - 최대 길이 4000자(API 계약 §3.1). 3500자 초과 시 우측에 카운터 `3654/4000` 노출, 4000 도달 시 `bg-danger/10` 테두리 강조.
- **Send 버튼:** 36x36 원형. 비활성(빈 입력) 시 `opacity-50 cursor-not-allowed`. 보내는 중일 때는 `<Loader2>` 회전 12px.
- **단축키 힌트:** Composer 하단 `text-[10px] text-fg-subtle` "Enter 전송 · Shift+Enter 줄바꿈 · ⌘. 닫기".
- **Slash commands (Phase 2):** `/`로 시작하면 빠른 액션 popup. 일단 디자인만 정의, 구현은 frontend 판단.
- **첨부 (Phase 2 — 디자인만):** 좌측에 `<Paperclip>` 16px 자리. 현재는 hide.

### 4.10 SessionsSidebar (히스토리)

- **트리거:** PanelHeader [≡] 토글. 패널 좌측에서 슬라이드인.
- **데스크톱:** `w-[220px] border-r border-border bg-bg-subtle`. 패널 width(420)는 그대로 — 사이드바가 메시지 영역을 잠시 덮는 형태(z-10). 닫으면 사라짐.
- **모바일:** 별도 화면 (전체 영역 차지). 상단에 "← 대화 목록" 헤더 + 닫기.
- **헤더:** `[+ 새 대화]` 버튼 (full width, dashed border, hover시 brand). 이전 대화 카운트 `이전 대화 (12)`.
- **리스트:**
  - 항목 1줄: title + 상대시각 + messageCount.
  - title이 없으면 첫 user 메시지 발췌 40자 (BE가 채워줌).
  - hover시 우측에 X 버튼 노출 → 삭제 확인 모달(`<AlertDialog>`).
  - 현재 활성 세션은 `bg-surface-selected` + 좌측 2px brand 라인.
  - 빈 상태: "아직 대화가 없어요. 새 대화로 시작해보세요." + 작은 캐릭터 idle 32px.
- **API:** `GET /chat/sessions?limit=20`. 더보기 페이지네이션은 Phase 2(일단 20개로 충분).

---

## 5. 상태 표현

### 5.1 로딩 (어시스턴트 응답 대기)

```
[🤖 thinking]  ┌──────────────┐
                │ • • •         │   ← 점 3개 stagger animation
                └──────────────┘
                생각하고 있어요…  ← 풍선 외부 meta line
```

- 캐릭터 상태 → `thinking` (눈 호 + 안테나 펄스).
- 메시지 풍선 안 점 3개. 각각 0.4s 간격으로 opacity 0.3↔1, transform translateY -2px↔0. 1.2s 주기.
- 풍선 폭은 처음에 56px로 시작 → 응답 도착 시 콘텐츠에 맞춰 부드럽게 확장(`transition-all duration-200`).
- 5초 이상 대기 시 풍선 아래에 미세한 텍스트 "조금만 더 걸릴 수 있어요…" 추가.
- 30초 timeout 시 자동 에러 상태로 전환(§5.2).

### 5.2 에러

| 케이스 | 표현 |
|---|---|
| 네트워크 / 5xx | 풍선 = `bg-danger/10 border border-danger/30 text-fg`. 본문: "응답을 받지 못했어요. 잠시 후 다시 시도해주세요." 우측 하단 [다시 시도] 버튼. 캐릭터 상태 = `error`(눈 가로줄). |
| Rate limit (429, `E_RATE_LIMIT`) | 풍선 = `bg-warning/10 border border-warning/30`. 본문: "잠시만요, 너무 빨리 보내고 계세요. **{초}초 후** 다시 시도할 수 있어요." {초}는 1초마다 카운트다운. 카운트가 0이 되면 [다시 시도] 활성. |
| 인증 만료 (401) | 풍선 = `bg-bg-muted text-fg-muted`. 본문: "세션이 만료되었어요. 다시 로그인해주세요." [로그인 페이지] 버튼. |
| 미인가 메시지 (403, 정책 위반 등) | 풍선 = `bg-danger/10`. 본문: "이 요청은 처리할 수 없어요." (사유는 `error.message`로 한 줄). |
| 본인 소유 아닌 sessionId (404) | 토스트 + 자동 새 세션 생성. 풍선 표시 없음. |

- 에러 풍선 아래 meta line: `[다시 시도] [복사] [신고]` (신고는 Phase 2). [다시 시도]는 마지막 user 메시지 재전송 + 직전 에러 풍선 제거(또는 시각적 fade).
- 캐릭터의 안테나 dot은 `bot-accent` → `danger` 일시 교체. 다음 정상 응답 시 원복.

### 5.3 빈 세션 (첫 진입 또는 새 대화)

```
┌──────────────────────────────────────────────┐
│                                                │
│              [🤖 80px Dolly idle]              │
│                                                │
│       안녕하세요! 저는 도면관리 도우미          │
│              Dolly예요.                         │
│      도면 검색·결재 안내·매뉴얼 질문에           │
│             도와드릴 수 있어요.                  │
│                                                │
│      ── 이렇게 시작해보세요 ──                  │
│      [🔍 검색 페이지]  [📋 내 결재함 (3건)]    │
│      [⏱️ 최근 활동]   [⭐ 즐겨찾기]            │
│      [⌨️ 단축키]      [❓ 도움말]              │
│      [🔢 도면번호로 찾기]                      │
│                                                │
└──────────────────────────────────────────────┘
                          [무엇을 도와드릴까요?]
```

- 캐릭터 80px 정중앙. idle blink 동작.
- 환영 카피 14/20, 강조 부분만 `text-fg`, 나머지 `text-fg-muted`.
- 빠른 액션 칩 7개 모두 노출 (스크롤 없이 보이도록 2~3행 wrap). `flex-wrap gap-2 justify-center`.
- 룰 모드일 때는 환영 카피 마지막에 한 줄 추가: "지금은 **간이 모드**예요. 자연어 응답이 제한될 수 있어요."

### 5.4 메시지가 있지만 비어 보이는 상태

- 응답 본문이 빈 문자열로 도착 (BE 폴백 실패): "응답을 만들지 못했어요. 다른 표현으로 다시 물어봐주세요." 자동 채움 + actions 칩 노출.

### 5.5 모드 전환 인지

- RAG → RULE로 폴백되면 헤더 ModeBadge가 `RAG` → `룰 베이스`로 전환. 첫 1회만 인라인 시스템 메시지: "잠시 간이 모드로 전환됐어요. 자연어 답변이 제한될 수 있어요." 이후 한 세션에서는 반복 표시 X.
- RULE → RAG 복귀 시: "정상 모드로 돌아왔어요." (Phase 2, 일단은 표시 X).

---

## 6. 빠른 액션 칩 시안 (API 계약 §9 매핑)

| 순서 | id | 라벨 (한국어) | 동적 변형 | 아이콘 (Lucide) | kind | 상세 |
|---|---|---|---|---|---|---|
| 1 | `open-search` | 검색 페이지 | — | `Search` | `navigate` | href=`/search` |
| 2 | `open-approval-inbox` | 내 결재함 (N건 대기) | N=대기 결재 수, 0이면 "내 결재함" + N뱃지 X | `Inbox` | `navigate` | href=`/approval?box=waiting` |
| 3 | `recent-activity` | 최근 활동 보기 | — | `Clock` | `tool` | `tool=get_recent_activity` |
| 4 | `my-favorites` | 내 즐겨찾기 | — | `Star` | `navigate` | href=`/workspace?tab=favorites` |
| 5 | `shortcuts` | 단축키 보기 | — | `Keyboard` | `palette` | `paletteQuery=">단축키"` |
| 6 | `help` | 도움말 | — | `HelpCircle` | `tool` | `tool=get_help` |
| 7 | `find-by-number` | 도면번호로 찾기 | — | `Hash` | `prompt` | `promptText="도면번호 "` 채움 |

- N이 5+면 라벨에 `+5` 표기 ("내 결재함 (+5건)")로 시각 노이즈 줄이기 결정 — PM 검토 필요.
- 빈 세션 화면에서는 7개 모두 노출. 메시지 진행 시는 가로 스크롤로 7개 유지(짧은 라벨 우선).
- 동적 라벨이 있는 칩은 라벨 옆 작은 카운트 뱃지 형태(`<span class="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand text-brand-foreground text-[10px] px-1">3</span>`)로도 표현 가능 — frontend 선택.

> **PM 결정 필요 — 카피:**
> - "도면번호로 찾기" vs "번호로 찾기"
> - 0건일 때 "내 결재함" 노출 자체를 빼고 "최근 활동"을 1번으로 올릴지

---

## 7. 접근성 (WCAG 2.1 AA)

### 7.1 ARIA / Semantics

- `<ChatPanel>` 컨테이너: `role="dialog" aria-modal="false" aria-labelledby="chat-panel-title" aria-describedby="chat-panel-desc"`.
  - `aria-modal="false"` 의도적 — 패널이 페이지 위에 떠 있지만 background 인터랙션 차단하지 않음(사용자가 동시에 다른 작업 가능).
- `<PanelTitle>`: `id="chat-panel-title"`.
- 모드 배지/부제: `id="chat-panel-desc"` 결합.
- `<MessageList>`: `role="log" aria-live="polite" aria-relevant="additions"`. 새 메시지가 자동으로 스크린리더에 읽힘.
- 어시스턴트 thinking 풍선: `aria-busy="true"` + `aria-label="응답 생성 중"`.
- `<RobotAvatar>`: `aria-hidden="true"` (캐릭터는 장식, 의미는 항상 텍스트로).
- ModeBadge: `aria-label="현재 모드: RAG"` (또는 룰 베이스).
- Sources 칩: `<button aria-label="출처: PRD 3.4 자료유형, 유사도 0.82">`.
- 빠른 액션 칩 영역: `<div role="toolbar" aria-label="빠른 액션">`.

### 7.2 포커스 관리

- 패널 열림 시 자동 포커스 → `<Textarea>` (Composer).
- Esc → 패널 닫고 포커스를 FAB으로 복귀.
- 닫기/사이드바/전체화면 버튼은 Tab 순서 명시.
- **focus trap:** `aria-modal="false"`이므로 명시적 트랩은 X. 그러나 Tab을 패널 내부에서 순환시키는 것이 사용자 경험상 자연스러움 → frontend 결정 (TanStack `<FocusScope>` 또는 Radix `<FocusScope loop>`). Esc로는 항상 닫힘.

### 7.3 Tab 순서 (패널 내부)

1. 헤더 [≡ 사이드바 토글]
2. 헤더 ModeBadge (클릭 가능 — health 정보)
3. 헤더 [✕ 닫기]
4. (사이드바 열림 시) 새 대화 버튼 → 세션 행 순서대로
5. 메시지 안 인터랙티브 요소 (sources 칩 → action 버튼 → 복사 → 재생성)
6. 빠른 액션 칩 (가로 순서)
7. Composer Textarea
8. Composer Send 버튼

### 7.4 키보드 단축키

| 키 | 동작 | 비고 |
|---|---|---|
| `⌘.` (또는 `Ctrl+.`) | 패널 토글 | 기존, 유지 |
| `Esc` | 닫기 (사이드바 열림 시 사이드바부터 닫힘) | 우선순위 |
| `Enter` (Composer) | 메시지 전송 | 단, IME 조합 중에는 무시 (한국어 입력 보호) |
| `Shift+Enter` | 줄바꿈 | |
| `↑` (Composer 비어있고 직전 user 메시지 있음) | 직전 메시지 채워넣기(편집/재전송) | Phase 2 |
| `⌘K` | 전역 — 챗봇 닫고 명령 팔레트 열기 | 기존 동작 보존, 충돌 없음 |

### 7.5 스크린 리더 안내 카피

- 패널 오픈: aria-live가 `dialog` open을 자동 안내 (Radix 처리).
- "Dolly가 응답을 생성하고 있어요" — assistant thinking 풍선 aria-label.
- 모드 폴백: aria-live region이 시스템 메시지 ("간이 모드로 전환되었어요.") 자동 읽음.
- Rate limit: "30초 후에 다시 시도할 수 있어요" 풍선이 polite live로 읽힘.

### 7.6 색상 대비

- 모든 텍스트(어시스턴트 풍선·사용자 풍선·소스 칩) 4.5:1 이상 — §3.4에서 검증.
- `bot-accent` (노랑)는 dot/장식만, 텍스트 X.
- 다크 모드에서 brand on bot-primary는 컴포넌트 자체적으로 사용 X (gut LED만 — 장식).

### 7.7 의미 전달의 다중화

- mode = 색만이 아니라 텍스트 라벨("RAG"/"룰 베이스"/"오프라인") + 아이콘 병행.
- error = 색만이 아니라 아이콘(`AlertTriangle`) + 카피 + 캐릭터 표정 변화.
- sources similarity = 색 dot만이 아니라 hover시 tooltip 정확 수치.

---

## 8. 모바일 반응형 (<640)

- **임계점:** 640. 그 이하는 풀스크린 sheet, 그 이상은 floating 패널.
- **FAB 위치:** `bottom-4 right-4` (모바일은 살짝 더 안쪽). 풀스크린 sheet 안에서는 FAB hide.
- **Sheet 동작:**
  - shadcn `<Sheet side="bottom">` + `h-[100dvh]`.
  - 상단 grab handle 32x4 rounded `bg-fg-subtle/40` 가운데 정렬, 영역 12px tap pad.
  - 사용자가 아래로 ≥120px drag 시 자동 닫힘 (Radix snap point는 미지원이라 단순 dismiss).
- **빠른 액션 칩:** 가로 스크롤 유지. 좌우 끝에 fade gradient 8px.
- **세션 사이드바:** 별도 화면. 헤더 [≡] 클릭 시 패널 본문이 좌측으로 -100% translate, 사이드바가 들어옴. 사이드바 헤더에 [← 뒤로] + 닫기.
- **키보드 대응:** Composer가 키보드 위에 따라가야 함. 다음 두 방식 중 1택:
  1. `position: sticky; bottom: env(keyboard-inset-height, 0)` — iOS Safari 16+/Android.
  2. JS로 `window.visualViewport.height`에 맞춰 패널 높이 동적 조정. (frontend 선택)
- **tap target:** 모든 버튼 최소 44x44 보장. FAB 56x56, 닫기 44x44, 빠른 액션 칩 32px이면 좌우 padding 10+10으로 hit area 확장.
- **메시지 풍선 max-width:** `90%`로 살짝 키움(데스크톱 85%).
- **폰트:** 모바일에서도 14/20 유지(iOS 자동 줌 방지 위해 input은 16px 이상).

---

## 9. 마이크로 인터랙션 / 모션

### 9.1 모션 토큰

| 컨텍스트 | duration | easing | 비고 |
|---|---|---|---|
| FAB hover scale | 100ms | ease-out | scale(1.05) |
| FAB press | 80ms | ease-in | scale(0.96) |
| Panel enter (열기) | 220ms | `cubic-bezier(0.32, 0.72, 0, 1)` | fade + translateY 8 → 0 |
| Panel exit | 160ms | ease-in | fade + translateY 0 → 8 |
| Mobile sheet | 240ms | 위와 동일 | translateY 100% → 0 |
| Sessions sidebar slide | 200ms | ease-out | translateX -100% → 0 |
| Message bubble enter | 160ms | ease-out | fade + translateY 4 → 0 |
| Quick action chip hover | 100ms | ease-out | border color shift |
| Robot eye blink | 120ms | ease-in-out | scaleY 1 → 0.1 → 1, 4s 주기 |
| Robot antenna pulse (thinking) | 1200ms | ease-in-out infinite | opacity 0.3 ↔ 1 |
| Thinking dots (메시지 풍선 안) | 1200ms | ease-in-out infinite | opacity + translateY, 0.4s stagger |
| Robot speaking flash | 600ms | ease-out | 가슴 LED 밝기 0% → +20% → 0% |
| Robot error settle | 200ms | ease-out | 1회만 |

### 9.2 prefers-reduced-motion

```css
@media (prefers-reduced-motion: reduce) {
  /* 패널 진입은 fade만, transform 0
   * 캐릭터 모션 모두 stop (현재 frame 고정)
   * thinking dots는 정적 ●●● 표시
   * antenna pulse 정지 — solid 유지
   */
}
```

(globals.css에 이미 글로벌 규칙 있음. 챗봇 컴포넌트는 keyframes를 안 쓰는 한 자동 적용.)

### 9.3 사운드 / 햅틱

- 사운드 X (사내 도구).
- 햅틱 X (모바일 보조).

---

## 10. Frontend가 그대로 가져갈 Tailwind 토큰 PR 안

### 10.1 `apps/web/app/globals.css` 추가분 (CSS Variables)

```css
/* ─── R36 챗봇 토큰 ─── */
:root {
  --bot-primary:       212 38% 38%;
  --bot-primary-deep:  212 40% 28%;
  --bot-soft:          210 40% 96%;
  --bot-accent:        45  95% 55%;
  --bot-faceplate:     215 35% 12%;
  --bot-fg:            215 30% 18%;
  --bot-fg-soft:       215 20% 55%;
  --bot-on-brand-fg:   0   0%  100%;
}
.dark {
  --bot-primary:       212 45% 56%;
  --bot-primary-deep:  212 45% 42%;
  --bot-soft:          212 30% 18%;
  --bot-accent:        45  90% 62%;
  --bot-faceplate:     215 35% 8%;
  --bot-fg:            210 30% 92%;
  --bot-fg-soft:       215 15% 65%;
  --bot-on-brand-fg:   0   0%  100%;
}
```

### 10.2 `apps/web/tailwind.config.ts` 추가분 (`theme.extend.colors`)

```ts
bot: {
  primary:     'hsl(var(--bot-primary))',
  primaryDeep: 'hsl(var(--bot-primary-deep))',
  soft:        'hsl(var(--bot-soft))',
  accent:      'hsl(var(--bot-accent))',
  faceplate:   'hsl(var(--bot-faceplate))',
  fg:          'hsl(var(--bot-fg))',
  fgSoft:      'hsl(var(--bot-fg-soft))',
  onBrandFg:   'hsl(var(--bot-on-brand-fg))',
},
```

> 기존 `colors.bg-subtle` 같은 dash key가 있으니 frontend가 일관되게 dash로 갈지 camel로 갈지 한 가지 골라서 적용. 본 스펙은 Tailwind utility 자동 생성이 더 직관적인 dash 표기를 권장: `bot-primary`, `bot-primary-deep`, `bot-soft`, `bot-accent`, `bot-faceplate`, `bot-fg`, `bot-fg-soft`, `bot-on-brand-fg`. (위 ts 예시는 camel — frontend가 dash로 변환해도 무방.)

### 10.3 추가 keyframes (선택)

```ts
// tailwind.config.ts → theme.extend.keyframes
'bot-blink': {
  '0%, 92%, 100%': { transform: 'scaleY(1)' },
  '95%, 97%':       { transform: 'scaleY(0.1)' },
},
'bot-antenna-pulse': {
  '0%, 100%': { opacity: '1' },
  '50%':       { opacity: '0.35' },
},
'bot-thinking-dot': {
  '0%, 80%, 100%': { opacity: '0.3', transform: 'translateY(0)' },
  '40%':           { opacity: '1',   transform: 'translateY(-2px)' },
},
'panel-enter': {
  from: { opacity: '0', transform: 'translateY(8px)' },
  to:   { opacity: '1', transform: 'translateY(0)' },
},

// theme.extend.animation
'bot-blink':          'bot-blink 4s ease-in-out infinite',
'bot-antenna-pulse':  'bot-antenna-pulse 1.2s ease-in-out infinite',
'bot-thinking-dot':   'bot-thinking-dot 1.2s ease-in-out infinite',
'panel-enter':        'panel-enter 220ms cubic-bezier(0.32, 0.72, 0, 1)',
```

### 10.4 신규 shadcn/ui 컴포넌트 — 도입 X

- 기존에 보유 중일 가능성이 높은 `Button`, `Textarea`, `ScrollArea`, `Tooltip`, `Sheet`, `Dialog`, `AlertDialog`, `Badge`만 사용.
- 만약 `ScrollArea`가 없다면 native `overflow-auto`로도 충분.
- **새 shadcn 컴포넌트 도입 권장 X** — 기존 패턴 + 자체 컴포넌트(`RobotAvatar`, `ChatPanel`, `MessageBubble`, `QuickActionChip`, `SessionRow`)로 충분.

### 10.5 새 컴포넌트 파일 구조 (frontend 참고용)

```
apps/web/components/chat/
├── RobotAvatar.tsx        ← SVG inline, props: size('fab'|'header'|'message'|'hero'), state, variant('default'|'on-brand')
├── ChatPanel.tsx           ← 컨테이너 (Sheet on mobile, floating on desktop)
├── PanelHeader.tsx
├── ModeBadge.tsx
├── SessionsSidebar.tsx
├── MessageList.tsx
├── MessageBubble.tsx       ← USER/ASSISTANT/SYSTEM 분기
├── SourceChip.tsx
├── ActionButton.tsx        ← actions[] 항목
├── QuickActionsRow.tsx
├── QuickActionChip.tsx
├── Composer.tsx
├── EmptySession.tsx
└── hooks/
    ├── useChatSend.ts        ← POST /chat (TanStack mutation)
    ├── useChatSessions.ts
    ├── useChatSession.ts
    ├── useChatHealth.ts
    └── useQuickActions.ts
```

`apps/web/components/layout/ChatToggle.tsx`는 FAB만 책임. 패널 본체는 위 디렉토리로 분리.

---

## 11. 결정 필요 / Open

| 항목 | 옵션 | 디자이너 권장 | 사유 |
|---|---|---|---|
| 캐릭터 이름 | Dolly / Cobalt / Pico / Iron | **Dolly** | 도메인 친숙(rolling mill) + 발음 쉬움 |
| 동국씨엠 공식 CI 컬러 | 미확인 | hsl 212 38 38 (메탈릭 블루) 가정 | CI 가이드 확보 시 1차 보정 |
| FAB 사이즈 | 48 / 56 / 64 | **56** | 캐릭터 가시성 + tap target 균형. DESIGN.md는 64를 명시했으나 Vercel/Linear 표준에 맞춰 56 권장 |
| 풀스크린 뷰어에서 챗봇 | 자동 hide / 토글로만 / 항상 표시 | **자동 hide** | 캔버스 가림 + 단축키로는 항상 동작 |
| 0건일 때 결재함 칩 | 노출 / 숨김 / 라벨 변형 | **노출 + 카운트 X** | 진입 일관성 |
| 사이드바 위치 | 좌측 in-panel / 우측 / 별도 모달 | **좌측 in-panel (데스크톱) / 별도 화면 (모바일)** | 좌측이 햄버거 관습과 일치 |
| Disclaimer 카피 | "AI 응답은…" / 생략 | **간소 1줄, 푸터** | 신뢰 명시 + 노이즈 최소 |

---

## 12. 검수 체크리스트 (디자이너 → frontend 핸드오프)

- [ ] FAB이 `(main)/layout.tsx`에서만 mount, 비로그인 라우트에서 X
- [ ] 헤더 우상단에서 `<ChatToggle variant="header" />` 흔적 사라짐 (frontend가 처리)
- [ ] FAB 56x56, 안에 Dolly idle (화이트 변형), `bg-brand`
- [ ] 패널 데스크톱 420×640, `elevation-modal`, 우하단 floating
- [ ] 모바일 <640에서 풀스크린 sheet + 키보드 위 Composer 추적
- [ ] `--bot-*` 토큰 8종이 라이트/다크 globals.css에 추가
- [ ] tailwind.config의 `colors.bot.*` 매핑 추가
- [ ] keyframes 4종(`bot-blink`, `bot-antenna-pulse`, `bot-thinking-dot`, `panel-enter`) 추가
- [ ] `<RobotAvatar>`가 size 4종(fab/header/message/hero) + state 4종(idle/thinking/speaking/error) + variant 2종(default/on-brand) 지원
- [ ] 어시스턴트 풍선 sources 영역 + actions 영역이 API 응답 shape(`sources[]`, `actions[]`)을 그대로 그림
- [ ] ModeBadge 3종(rag/rule/offline) — 색만 아니라 텍스트 + 아이콘
- [ ] 빠른 액션 7종이 §6 표대로 라벨/아이콘/순서/kind/href|paletteQuery|toolName|promptText 매핑
- [ ] Esc 닫기 + ⌘. 토글 + Enter 전송(IME 조합 무시) + Shift+Enter 줄바꿈
- [ ] role/dialog + aria-live(log) + aria-busy(thinking) + aria-hidden(robot)
- [ ] prefers-reduced-motion 검증 (캐릭터 정지)
- [ ] 다크 모드에서 캐릭터 명도/대비 — bot-primary 56% lightness로 식별
- [ ] WCAG 4.5:1 본문 대비 충족(라이트/다크 모두)

---

## 13. 변경 이력

| 날짜 | 변경 | 사유 |
|---|---|---|
| 2026-04-29 | 초안 작성 | R36 designer phase |
