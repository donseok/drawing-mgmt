'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Users,
  Building2,
  Users2,
  FolderTree as FolderTreeIcon,
  Layers,
  Hash,
  Megaphone,
  Plug,
  ScrollText,
} from 'lucide-react';
import { SubSidebar } from '@/components/layout/SubSidebar';
import { cn } from '@/lib/cn';

export const ADMIN_GROUPS: {
  title: string;
  items: {
    href: string;
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }[];
}[] = [
  {
    title: '사용자 / 조직',
    items: [
      { href: '/admin/users', label: '사용자', description: '계정·역할·서명 관리', icon: Users },
      { href: '/admin/organizations', label: '조직', description: '조직 트리 관리', icon: Building2 },
      { href: '/admin/groups', label: '그룹', description: '권한 그룹 관리', icon: Users2 },
    ],
  },
  {
    title: '폴더 / 권한',
    items: [
      {
        href: '/admin/folders',
        label: '폴더 트리',
        description: '폴더 구조 및 권한 매트릭스',
        icon: FolderTreeIcon,
      },
    ],
  },
  {
    title: '자료 유형',
    items: [
      { href: '/admin/classes', label: '자료유형 / 속성', description: 'Class 정의 및 속성 매핑', icon: Layers },
      { href: '/admin/number-rules', label: '자동발번 규칙', description: '도면번호 규칙 빌더', icon: Hash },
    ],
  },
  {
    title: '규칙 / 공지',
    items: [
      { href: '/admin/notices', label: '공지사항', description: '메인/팝업 공지 관리', icon: Megaphone },
    ],
  },
  {
    title: '통합 / 로그',
    items: [
      { href: '/admin/integrations', label: 'API Key', description: '외부 연계 키 발급/취소', icon: Plug },
      { href: '/admin/audit', label: '감사 로그', description: '시스템 활동 이력', icon: ScrollText },
    ],
  },
];

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
