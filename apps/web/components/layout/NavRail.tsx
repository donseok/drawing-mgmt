'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Search,
  CheckSquare,
  Inbox,
  Star,
  Settings2,
  HelpCircle,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useUiStore } from '@/stores/uiStore';

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
  /** matches if pathname startsWith href */
  matchPrefix?: string;
  adminOnly?: boolean;
}

interface NavItemSpec extends NavItem {
  devOnly?: boolean;
}

const ITEMS: NavItemSpec[] = [
  { href: '/', icon: Home, label: '홈', matchPrefix: '/__home__' },
  { href: '/search', icon: Search, label: '자료 검색', matchPrefix: '/search' },
  { href: '/approval', icon: CheckSquare, label: '결재함', matchPrefix: '/approval' },
  { href: '/lobby', icon: Inbox, label: '로비함', matchPrefix: '/lobby' },
  { href: '/workspace', icon: Star, label: '내 작업공간', matchPrefix: '/workspace' },
  { href: '/admin', icon: Settings2, label: '관리자', matchPrefix: '/admin', adminOnly: true },
  // Dev-only DWG drop page — surfaced only in `next dev`. Remove when the real
  // registration flow lands.
  { href: '/dev/upload', icon: Upload, label: '도면 업로드 (개발용)', matchPrefix: '/dev/upload', devOnly: true },
];

const IS_DEV = process.env.NODE_ENV !== 'production';

export interface NavRailProps {
  /** session role; admin items are hidden for non-admin */
  role?: 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'PARTNER' | null;
}

export function NavRail({ role }: NavRailProps) {
  const pathname = usePathname() ?? '/';
  const setShortcutsHelpOpen = useUiStore((s) => s.setShortcutsHelpOpen);

  const isActive = (item: NavItem) => {
    if (item.href === '/') return pathname === '/';
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  };

  const visible = ITEMS.filter((it) => {
    if (it.devOnly && !IS_DEV) return false;
    if (it.adminOnly && role !== 'SUPER_ADMIN' && role !== 'ADMIN') return false;
    return true;
  });

  return (
    <nav
      aria-label="주 네비게이션"
      className="flex h-full w-14 shrink-0 flex-col items-center border-r border-border bg-bg/85 py-2 backdrop-blur"
    >
      <ul className="flex flex-1 flex-col items-center gap-1.5">
        {visible.map((item) => (
          <li key={item.href}>
            <NavLink item={item} active={isActive(item)} />
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-col items-center gap-1 pb-1">
        <button
          type="button"
          onClick={() => setShortcutsHelpOpen(true)}
          aria-label="도움말 (단축키)"
          title="단축키 도움말 (?)"
          className={cn(
            'app-icon-button h-10 w-10',
          )}
        >
          <HelpCircle className="h-5 w-5" />
        </button>
      </div>
    </nav>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      title={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-10 w-10 items-center justify-center rounded-md text-fg-muted transition-colors',
        'hover:bg-bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active && 'bg-brand/10 text-brand shadow-sm ring-1 ring-brand/20 hover:bg-brand/10',
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute -left-2 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-brand"
        />
      )}
      <Icon className="h-5 w-5" />
    </Link>
  );
}
