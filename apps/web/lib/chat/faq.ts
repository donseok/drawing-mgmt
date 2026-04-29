// R36 — FAQ dictionary.
//
// Hand-curated Korean FAQ entries used by the rule-based matcher when:
//   1) embedding/LLM aren't configured (no RAG path), OR
//   2) RAG returned nothing above the similarity threshold.
//
// Each entry has:
//   - `keywords`: lowercased Korean fragments that, if any appear in the
//     normalized user message, trigger this entry.
//   - `answer`: ready-to-render markdown response.
//   - `actions`: optional quick-action chips (navigate / palette / tool / prompt).
//
// Order matters — earlier entries win on ambiguous matches. The matcher in
// `rules.ts` short-circuits at the first hit.

import type { ChatAction } from '@drawing-mgmt/shared';

export interface FaqEntry {
  id: string;
  keywords: string[];
  answer: string;
  actions?: ChatAction[];
}

export const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: 'find-by-number',
    keywords: ['도면번호', '도면 번호', '품번 검색', '번호로 찾'],
    answer:
      '도면번호로 찾으려면 상단 검색창에 번호를 그대로 붙여 넣거나, **⌘K(Ctrl+K)** 명령 팔레트에서 번호를 검색해 보세요. 자동으로 도면 상세 페이지로 안내합니다.',
    actions: [
      { label: '검색 페이지 열기', kind: 'navigate', href: '/search' },
      { label: '명령 팔레트로 검색', kind: 'palette', paletteQuery: '' },
    ],
  },
  {
    id: 'approval-inbox',
    keywords: ['결재함', '결재 함', '승인함', '승인 함', '결재 보기', '결재 어디'],
    answer:
      '내 결재함은 상단 메뉴의 **결재** 또는 좌측 사이드바에서 열 수 있어요. 대기 중인 결재가 있으면 우측 상단 종 모양 알림에도 카운트가 뜹니다.',
    actions: [
      { label: '내 결재함 열기', kind: 'navigate', href: '/approval' },
    ],
  },
  {
    id: 'mfa-enable',
    keywords: ['mfa', '2단계', 'otp', 'totp', '이중 인증', '인증 앱'],
    answer:
      '2단계 인증(TOTP)은 **환경설정 → 보안** 에서 켤 수 있습니다. QR 코드를 인증 앱에 등록한 뒤 6자리 코드를 입력해 확인하면 활성화됩니다. 분실에 대비해 발급된 복구 코드는 안전한 곳에 보관하세요.',
    actions: [{ label: '보안 설정 열기', kind: 'navigate', href: '/settings?tab=security' }],
  },
  {
    id: 'shortcuts',
    keywords: ['단축키', '키보드', '바로가기'],
    answer:
      '주요 단축키:\n- **⌘K / Ctrl+K** — 명령 팔레트\n- **⌘/ / Ctrl+/** — 단축키 도움말\n- **G H** — 홈\n- **G S** — 검색\n- **G A** — 결재함\n\n명령 팔레트에서 "단축키" 를 입력하면 전체 목록을 볼 수 있어요.',
    actions: [{ label: '명령 팔레트 열기', kind: 'palette', paletteQuery: '단축키' }],
  },
  {
    id: 'checkout-checkin',
    keywords: ['체크아웃', '체크인', '잠금', '편집 잠금'],
    answer:
      '도면을 편집하려면 도면 상세에서 **체크아웃** 을 누르세요. 작업이 끝나면 새 첨부를 올린 뒤 **체크인** 으로 마무리합니다. 다른 사용자가 잠근 상태면 잠금 해제 후 시도해 주세요.',
  },
  {
    id: 'approval-flow',
    keywords: ['결재 올리', '상신', '결재 요청', '승인 요청', '승인 올리'],
    answer:
      '체크인된 개정본의 도면 상세에서 **결재 상신** 을 누르면 결재선을 지정할 수 있어요. 결재가 모두 승인되면 자동으로 APPROVED 상태로 전환됩니다.',
  },
  {
    id: 'recent-activity',
    keywords: ['최근 작업', '히스토리', '활동', '변경 이력'],
    answer:
      '도면 상세 우측의 **활동 로그** 탭에서 변경/체크아웃/체크인/결재 이력을 볼 수 있습니다. 또는 빠른 액션의 "최근 활동 보기" 를 사용해 보세요.',
    actions: [
      {
        label: '최근 활동 보기',
        kind: 'tool',
        toolName: 'get_recent_activity',
        toolArgs: { limit: 10 },
      },
    ],
  },
  {
    id: 'permissions',
    keywords: ['권한', '접근', '못 보', '안 보'],
    answer:
      '도면이 보이지 않거나 다운로드가 막혀 있다면 폴더 권한 또는 보안레벨 때문일 수 있어요. 폴더 관리자에게 **권한 부여** 를 요청하거나, 도면 상세의 보안레벨을 확인해 주세요.',
  },
  {
    id: 'download-print',
    keywords: ['다운로드', '인쇄', '출력', '저장'],
    answer:
      '도면 상세 우측 상단 메뉴에서 **다운로드** / **인쇄** 가 가능합니다. 권한이 없는 경우 버튼이 비활성화돼요. 인쇄는 PDF로 변환된 결과를 사용하므로 변환이 끝난 도면만 가능합니다.',
  },
  {
    id: 'viewer',
    keywords: ['뷰어', '도면 안 열', '도면 안열', '미리보기', '렌더링'],
    answer:
      '도면 뷰어가 안 열리면 (1) 변환이 아직 끝나지 않았는지(상태 PROCESSING) 확인, (2) 페이지 새로고침, (3) 그래도 실패면 관리자에게 알려 주세요. 우측 상단의 변환 상태 배지로 진행을 볼 수 있습니다.',
  },
  {
    id: 'help',
    keywords: ['도움말', '사용법', '안내', '메뉴얼', '매뉴얼'],
    answer:
      '명령 팔레트(⌘K)에서 "도움말" 을 검색하거나, 빠른 액션의 "도움말 보기" 를 사용해 주세요. 사용자 매뉴얼은 README/docs/manuals/USER_MANUAL.md에 있습니다.',
    actions: [
      {
        label: '도움말 보기',
        kind: 'tool',
        toolName: 'get_help',
        toolArgs: { topic: 'getting-started' },
      },
    ],
  },
  {
    id: 'notification',
    keywords: ['알림', '메일', '이메일 알림'],
    answer:
      '알림 채널(이메일/SMS/카카오톡)은 **환경설정 → 알림** 에서 켜고 끌 수 있어요. SMS와 카카오톡은 비용이 들기 때문에 기본은 꺼져 있습니다.',
    actions: [{ label: '알림 설정 열기', kind: 'navigate', href: '/settings?tab=notifications' }],
  },
];

const NORMALIZE_RE = /\s+/g;

/** Normalize Korean/English text for keyword matching: lowercase + collapse whitespace. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(NORMALIZE_RE, ' ').trim();
}

/** Find the first FAQ entry whose keywords match the normalized message. */
export function matchFaq(message: string): FaqEntry | null {
  const norm = normalize(message);
  if (!norm) return null;
  for (const entry of FAQ_ENTRIES) {
    for (const kw of entry.keywords) {
      if (norm.includes(normalize(kw))) return entry;
    }
  }
  return null;
}
