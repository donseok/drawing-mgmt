import Link from 'next/link';
import { redirect } from 'next/navigation';
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
  ArrowRight,
} from 'lucide-react';
import { auth } from '@/auth';
import { SubSidebar } from '@/components/layout/SubSidebar';
import { cn } from '@/lib/cn';

const ADMIN_GROUPS: {
  title: string;
  items: { href: string; label: string; description: string; icon: React.ComponentType<{ className?: string }> }[];
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
      { href: '/admin/folders', label: '폴더 트리', description: '폴더 구조 및 권한 매트릭스', icon: FolderTreeIcon },
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

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = session.user.role;
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
    // Soft 403 — render the home with a message rather than crashing.
    redirect('/');
  }

  return (
    <div className="flex h-full min-h-0 flex-1">
      <SubSidebar title="관리자 메뉴">
        <ul className="space-y-3 text-sm">
          {ADMIN_GROUPS.map((g) => (
            <li key={g.title}>
              <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                {g.title}
              </div>
              <ul className="space-y-0.5">
                {g.items.map((it) => (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      className="flex h-7 items-center gap-2 rounded px-2 text-fg-muted hover:bg-bg-muted hover:text-fg"
                    >
                      <it.icon className="h-4 w-4" />
                      <span className="text-[13px]">{it.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </SubSidebar>

      <section className="flex-1 overflow-auto p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-fg">관리자</h1>
          <p className="mt-1 text-sm text-fg-muted">시스템 설정·권한·감사 로그를 관리합니다.</p>
        </header>

        <div className="space-y-8">
          {ADMIN_GROUPS.map((g) => (
            <section key={g.title}>
              <h2 className="mb-3 text-base font-semibold text-fg">{g.title}</h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((it) => {
                  const Icon = it.icon;
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        className={cn(
                          'group flex items-start gap-3 rounded-lg border border-border bg-bg p-4 transition-colors',
                          'hover:border-border-strong hover:bg-bg-subtle',
                        )}
                      >
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-bg-muted text-fg-muted">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="flex-1">
                          <span className="block text-sm font-semibold text-fg">{it.label}</span>
                          <span className="mt-0.5 block text-xs text-fg-muted">{it.description}</span>
                        </span>
                        <ArrowRight className="h-4 w-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {/* TODO: deeper routes (/admin/users, /admin/folders, ...) live in their
              own page files. Backend & Designer will scaffold table/edit panels per DESIGN §6.8. */}
          <p className="text-xs text-fg-subtle">
            각 메뉴를 클릭하면 상세 화면으로 이동합니다. (상세 화면은 후속 작업)
          </p>
        </div>
      </section>
    </div>
  );
}
