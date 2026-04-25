'use client';

import Link from 'next/link';
import { Building2, Search, ShieldCheck } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/cn';
import { NotificationBell } from './NotificationBell';
import { ChatToggle } from './ChatToggle';
import { UserMenu } from './UserMenu';
import { ThemeToggle } from './ThemeToggle';

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
        'sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur',
      )}
    >
      <Link
        href="/"
        className="flex min-w-0 items-center gap-3 text-sm font-semibold text-fg hover:opacity-90"
        aria-label="홈으로"
      >
        <span
          aria-hidden
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand text-brand-foreground shadow-sm ring-1 ring-brand/20"
        >
          <span className="text-[11px] font-bold leading-none">DC</span>
        </span>
        <span className="hidden min-w-0 flex-col leading-tight md:flex">
          <span className="truncate text-[13px] font-semibold">동국씨엠 도면관리</span>
          <span className="truncate text-[11px] font-medium text-fg-subtle">Common Data Environment</span>
        </span>
      </Link>

      <div className="hidden h-7 items-center gap-1.5 rounded-md border border-border bg-bg-subtle px-2 text-[11px] font-medium text-fg-muted lg:flex">
        <ShieldCheck className="h-3.5 w-3.5 text-brand" />
        <span>최신본 통제</span>
      </div>

      <div className="mx-1 flex flex-1 items-center justify-center">
        <button
          type="button"
          onClick={() => openPalette(true)}
          className={cn(
            'group flex h-9 w-full max-w-2xl items-center gap-2 rounded-md border border-border bg-bg px-3 text-left text-sm text-fg-muted shadow-sm',
            'hover:border-border-strong hover:bg-bg-subtle',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label="명령 팔레트 열기"
        >
          <Search className="h-4 w-4 text-brand" />
          <span className="flex-1 truncate">도면번호, Rev, 마크업, 이슈 검색...</span>
          <span className="hidden text-xs text-fg-subtle lg:inline">문서·폴더·명령·PDF 내용</span>
          <kbd className="hidden rounded border border-border bg-bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-fg-muted sm:inline-block">
            Ctrl K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-1">
        {user.organization && (
          <div className="hidden h-8 items-center gap-1.5 rounded-md border border-border bg-bg-subtle px-2 text-xs text-fg-muted xl:flex">
            <Building2 className="h-3.5 w-3.5" />
            <span className="max-w-32 truncate">{user.organization}</span>
          </div>
        )}
        <ThemeToggle className="hidden sm:inline-flex" />
        <ChatToggle variant="header" />
        <NotificationBell />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
