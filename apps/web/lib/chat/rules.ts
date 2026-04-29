// R36 — Rule-based responder.
//
// Used in two scenarios:
//   1) Embedding/LLM env not configured → orchestrator skips RAG entirely.
//   2) RAG retriever returned no chunk above CHAT_RAG_SIMILARITY_MIN.
//
// Order of checks (contract §2):
//   (a) intent regex   — "검색", "찾아", "조회" + (도면|품번)
//   (b) page keywords  — 결재함 / 마이페이지 / 설정 / 알림 / 검색 / 홈
//   (c) FAQ keyword dictionary (lib/chat/faq.ts)
//   (d) final fallback message
//
// Always returns `{ response, actions }`. `mode='rule'` is set by the
// orchestrator when persisting; this file does not touch DB.

import type { ChatAction } from '@drawing-mgmt/shared';
import { matchFaq, normalize } from './faq';

export interface RuleReply {
  response: string;
  actions: ChatAction[];
  /** Stable id of the rule that produced this reply (for logging/diagnostics). */
  ruleId: string;
}

// "검색|찾아|조회" 동사 의도 + (도면|품번|번호) 명사가 같이 등장하면 매칭.
// 어순은 한국어 특성상 자유롭다 — "도면 검색해줘" / "검색 ... 도면" 모두 OK.
const INTENT_SEARCH_RE =
  /((검색|찾[아아줘]|조회).*(도면|품번|번호))|((도면|품번|번호).*(검색|찾[아아줘]|조회))/;

interface PageEntry {
  keyword: RegExp;
  label: string;
  href: string;
  reply: string;
}

const PAGE_ENTRIES: PageEntry[] = [
  {
    keyword: /결재함|승인함|결재 함|승인 함/,
    label: '내 결재함 열기',
    href: '/approval',
    reply: '결재함은 좌측 사이드바 또는 아래 버튼으로 열 수 있어요.',
  },
  {
    keyword: /마이페이지|내 정보/,
    label: '환경설정 열기',
    href: '/settings',
    reply: '내 정보·서명·비밀번호·보안·알림은 환경설정 페이지에서 관리합니다.',
  },
  {
    keyword: /설정|환경설정|preference/,
    label: '환경설정 열기',
    href: '/settings',
    reply: '환경설정의 프로필/비밀번호/보안/서명/알림 탭에서 변경할 수 있어요.',
  },
  {
    keyword: /알림(\s*(설정|함))?/,
    label: '알림 설정 열기',
    href: '/settings?tab=notifications',
    reply: '알림 채널(이메일/SMS/카카오톡)은 환경설정 → 알림 탭에서 토글할 수 있어요.',
  },
  {
    // "검색 페이지", "검색 화면" 같은 navigation 의도만 잡는다. 단순 "검색"
    // 단어는 intent layer가 먼저 잡아야 하므로 page 매칭에서 제외.
    keyword: /검색\s*(페이지|화면|메뉴)/,
    label: '검색 페이지 열기',
    href: '/search',
    reply: '검색 페이지에서는 키워드, 품번, 폴더, 상태로 도면을 좁혀 찾을 수 있어요.',
  },
  {
    keyword: /홈|home/,
    label: '홈으로',
    href: '/',
    reply: '홈에서 즐겨찾는 폴더와 핀 고정한 도면을 볼 수 있어요.',
  },
];

const FALLBACK: RuleReply = {
  ruleId: 'fallback',
  response:
    '죄송해요, 아직 그건 잘 모르겠어요. 빠른 액션을 사용해 보시거나, **명령 팔레트(⌘K)** 로 검색해 보세요.',
  actions: [
    { label: '검색 페이지 열기', kind: 'navigate', href: '/search' },
    { label: '명령 팔레트 열기', kind: 'palette', paletteQuery: '' },
    { label: '도움말 보기', kind: 'tool', toolName: 'get_help', toolArgs: { topic: 'getting-started' } },
  ],
};

/** Match the user message against the rule layers and produce a reply. */
export function matchRule(message: string): RuleReply {
  const norm = normalize(message);

  // (a) intent regex — "도면 검색해줘" 류는 검색 페이지로 보낸다.
  if (INTENT_SEARCH_RE.test(norm)) {
    return {
      ruleId: 'intent-search',
      response: '도면 검색은 아래 검색 페이지에서 키워드/번호로 찾을 수 있어요.',
      actions: [
        { label: '검색 페이지 열기', kind: 'navigate', href: '/search' },
        { label: '명령 팔레트로 빠른 검색', kind: 'palette', paletteQuery: '' },
      ],
    };
  }

  // (b) page keyword shortcut.
  for (const entry of PAGE_ENTRIES) {
    if (entry.keyword.test(norm)) {
      return {
        ruleId: `page:${entry.href}`,
        response: entry.reply,
        actions: [{ label: entry.label, kind: 'navigate', href: entry.href }],
      };
    }
  }

  // (c) FAQ dictionary.
  const faq = matchFaq(message);
  if (faq) {
    return {
      ruleId: `faq:${faq.id}`,
      response: faq.answer,
      actions: faq.actions ?? [],
    };
  }

  // (d) final fallback.
  return FALLBACK;
}
