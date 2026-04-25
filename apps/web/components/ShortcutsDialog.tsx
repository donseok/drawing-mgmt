'use client';

import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useShortcutsHelp } from '@/hooks/useShortcutsHelp';
import { cn } from '@/lib/cn';

interface Group {
  title: string;
  items: { keys: string[]; label: string }[];
}

const GROUPS: Group[] = [
  {
    title: '글로벌',
    items: [
      { keys: ['⌘', 'K'], label: '명령 팔레트 / 글로벌 검색' },
      { keys: ['⌘', 'B'], label: '사이드바 토글' },
      { keys: ['⌘', '.'], label: '챗봇 토글' },
      { keys: ['⌘', '\\'], label: '다크모드 토글' },
      { keys: ['?'], label: '단축키 도움말' },
    ],
  },
  {
    title: '이동 (g + 키)',
    items: [
      { keys: ['g', 'h'], label: '홈' },
      { keys: ['g', 's'], label: '자료 검색' },
      { keys: ['g', 'a'], label: '결재함' },
      { keys: ['g', 'l'], label: '로비함' },
      { keys: ['g', 'm'], label: '관리자' },
    ],
  },
  {
    title: '자료 검색·목록',
    items: [
      { keys: ['/'], label: '인라인 검색 포커스' },
      { keys: ['↑', '↓'], label: '행 이동' },
      { keys: ['Enter'], label: '상세 페이지' },
      { keys: ['Space'], label: '미리보기 토글' },
      { keys: ['⌘', 'D'], label: '다운로드' },
      { keys: ['⌘', 'E'], label: '편집(체크아웃)' },
      { keys: ['⌘', '⇧', 'A'], label: '결재상신' },
      { keys: ['⌘', '⌫'], label: '폐기' },
      { keys: ['[', ']'], label: '폴더 prev / next' },
    ],
  },
  {
    title: '뷰어',
    items: [
      { keys: ['+', '−'], label: '줌 인 / 아웃' },
      { keys: ['0'], label: '맞춤(fit)' },
      { keys: ['r'], label: '회전' },
      { keys: ['m'], label: '측정' },
      { keys: ['t'], label: '문자 검색' },
      { keys: ['l'], label: '레이어 패널' },
      { keys: ['←', '→'], label: '페이지 이동' },
      { keys: ['f'], label: '전체화면' },
      { keys: ['Esc'], label: '닫기' },
    ],
  },
];

export function ShortcutsDialog() {
  const { open, setOpen } = useShortcutsHelp();

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="단축키 도움말"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-2xl rounded-lg border border-border bg-bg shadow-2xl">
        <div className="flex h-12 items-center justify-between border-b border-border px-4">
          <h2 className="text-sm font-semibold">단축키</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="닫기"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid max-h-[70vh] grid-cols-1 gap-6 overflow-auto p-5 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                {g.title}
              </h3>
              <ul className="space-y-1.5 text-sm">
                {g.items.map((item) => (
                  <li key={item.label} className="flex items-center justify-between gap-3">
                    <span className="text-fg">{item.label}</span>
                    <span className="flex items-center gap-1">
                      {item.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className={cn(
                            'inline-flex min-w-5 items-center justify-center rounded border border-border bg-bg-subtle px-1.5 py-0.5 text-[11px] font-medium text-fg-muted',
                          )}
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
