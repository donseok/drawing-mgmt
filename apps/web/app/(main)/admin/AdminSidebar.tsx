'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SubSidebar } from '@/components/layout/SubSidebar';
import { cn } from '@/lib/cn';
import { ADMIN_GROUPS } from './admin-groups';

// Re-export for backward compatibility — older callers import ADMIN_GROUPS
// from this file. New server-side callers should import directly from
// './admin-groups' to avoid pulling in client-only state.
export { ADMIN_GROUPS };

/**
 * AdminSidebar — left navigation for the admin console.
 * Renders inside a SubSidebar so it inherits collapse/resize behavior.
 * Highlights the section that matches the current pathname.
 */
export function AdminSidebar() {
  const pathname = usePathname() ?? '';
  return (
    <SubSidebar title="관리자 메뉴">
      <ul className="space-y-3 text-sm">
        {ADMIN_GROUPS.map((g) => (
          <li key={g.title}>
            <div className="app-kicker mb-1 px-2">{g.title}</div>
            <ul className="space-y-0.5">
              {g.items.map((it) => {
                const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
                const Icon = it.icon;
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-8 items-center gap-2 rounded-md px-2 transition-colors',
                        active
                          ? 'bg-bg text-fg shadow-sm ring-1 ring-border'
                          : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
                      )}
                    >
                      <Icon
                        className={cn('h-4 w-4', active ? 'text-brand-500' : 'text-fg-subtle')}
                      />
                      <span className="text-[13px]">{it.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </SubSidebar>
  );
}
