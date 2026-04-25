'use client';

import Link from 'next/link';
import { Search } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/cn';
import { NotificationBell } from './NotificationBell';
import { ChatToggle } from './ChatToggle';
import { UserMenu } from './UserMenu';

interface HeaderProps {
  user: {
    name: string;
    organization?: string | null;
    email?: string | null;
  };
}

export function Header({ user }: HeaderProps) {
  const openPalette = useUiStore((s) => s.setPaletteOpen);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-bg px-4',
      )}
    >
      <Link
        href="/"
        className="flex items-center gap-2 text-sm font-semibold text-fg hover:opacity-80"
        aria-label="홈으로"
      >
        <span
          aria-hidden
          className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-brand text-brand-foreground"
        >
          <span className="text-xs font-bold">DG</span>
        </span>
        <span className="hidden md:inline">동국씨엠 도면관리</span>
      </Link>

      <div className="mx-2 flex flex-1 items-center justify-center">
        <button
          type="button"
          onClick={() => openPalette(true)}
          className={cn(
            'group flex h-9 w-full max-w-xl items-center gap-2 rounded-md border border-border bg-bg-subtle px-3 text-left text-sm text-fg-muted',
            'hover:border-border-strong hover:bg-bg-muted',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label="명령 팔레트 열기"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 truncate">도면번호·키워드 검색…</span>
          <kbd className="hidden rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] font-medium text-fg-muted sm:inline-block">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-1">
        <ChatToggle variant="header" />
        <NotificationBell />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
