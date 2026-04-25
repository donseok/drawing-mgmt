'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, LogOut, HelpCircle, User as UserIcon, Settings } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { cn } from '@/lib/cn';
import { ThemeToggle } from './ThemeToggle';

interface UserMenuProps {
  user: {
    name: string;
    organization?: string | null;
    email?: string | null;
  };
}

// TODO: Designer to provide @/components/ui/dropdown-menu — using a hand-rolled
// popover until shadcn primitives land. Behavior matches DESIGN.md §4.2.
export function UserMenu({ user }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const initials = user.name.slice(0, 1).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-md pl-1 pr-1.5 text-sm',
          'hover:bg-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <span
          aria-hidden
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-brand-foreground"
        >
          {initials}
        </span>
        <span className="hidden text-fg sm:inline">{user.name}</span>
        <ChevronDown className="h-3.5 w-3.5 text-fg-muted" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-md border border-border bg-bg shadow-lg"
        >
          <div className="border-b border-border px-3 py-3">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground">
                {initials}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-fg">{user.name}</div>
                <div className="truncate text-xs text-fg-muted">
                  {user.organization ?? '소속 미지정'}
                </div>
              </div>
            </div>
          </div>

          <ul className="py-1 text-sm">
            <MenuItem icon={<UserIcon className="h-4 w-4" />} label="프로필" onSelect={() => setOpen(false)} />
            <MenuItem
              icon={<Settings className="h-4 w-4" />}
              label="설정"
              onSelect={() => setOpen(false)}
            />
            <MenuItem
              icon={<HelpCircle className="h-4 w-4" />}
              label="도움말"
              onSelect={() => setOpen(false)}
            />
          </ul>

          <div className="border-t border-border px-3 py-2">
            <div className="mb-2 text-xs font-medium text-fg-muted">테마</div>
            <ThemeToggle variant="segmented" className="w-full justify-between" />
          </div>

          <div className="border-t border-border py-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                // signOut callback — backend owns the actual auth route
                void signOut({ callbackUrl: '/login' });
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-bg-muted"
            >
              <LogOut className="h-4 w-4" />
              <span>로그아웃</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  onSelect?: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="menuitem"
        onClick={onSelect}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-fg hover:bg-bg-muted"
      >
        <span className="text-fg-muted">{icon}</span>
        <span>{label}</span>
      </button>
    </li>
  );
}
