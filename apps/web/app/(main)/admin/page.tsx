import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { auth } from '@/auth';
import { cn } from '@/lib/cn';
import { AdminSidebar } from './AdminSidebar';
import { ADMIN_GROUPS } from './admin-groups';

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = session.user.role;
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
    // Soft 403 — redirect to home rather than crashing.
    redirect('/');
  }

  return (
    <div className="flex h-full min-h-0 flex-1">
      <AdminSidebar />

      <section className="flex-1 overflow-auto bg-bg">
        <header className="border-b border-border px-6 py-5">
          <div className="app-kicker">Administration</div>
          <h1 className="mt-1 text-2xl font-semibold text-fg">관리자</h1>
          <p className="mt-1 text-sm text-fg-muted">
            조직, 권한, 자료 유형, 감사 로그를 한 곳에서 관리합니다.
          </p>
        </header>

        <div className="space-y-8 p-6">
          {ADMIN_GROUPS.map((g) => (
            <section key={g.title}>
              <h2 className="mb-3 text-base font-semibold text-fg">{g.title}</h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.items.map((it) => {
                  const Icon = it.icon;
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        className={cn(
                          'group flex min-h-24 items-start gap-3 rounded-lg border border-border bg-bg p-4 transition-colors',
                          'hover:border-border-strong hover:bg-bg-subtle',
                        )}
                      >
                        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-bg-subtle text-fg-muted">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="flex-1">
                          <span className="block text-sm font-semibold text-fg">{it.label}</span>
                          <span className="mt-0.5 block text-xs text-fg-muted">
                            {it.description}
                          </span>
                        </span>
                        <ArrowRight className="h-4 w-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <p className="rounded-md border border-dashed border-border bg-bg-subtle px-3 py-2 text-xs text-fg-muted">
            각 메뉴를 클릭하면 상세 화면으로 이동합니다. 좌측 메뉴에서도 이동할 수 있습니다.
          </p>
        </div>
      </section>
    </div>
  );
}
