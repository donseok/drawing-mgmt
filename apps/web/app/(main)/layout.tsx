import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Header } from '@/components/layout/Header';
import { NavRail } from '@/components/layout/NavRail';
import { AppShellClient } from '@/components/layout/AppShellClient';

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  // Middleware already gates the (main) tree, but a server-side check ensures
  // session.user is non-null for all child server components.
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const { name, organizationId, role, email } = session.user;

  return (
    <div className="app-frame flex h-screen w-full flex-col">
      <Header
        user={{
          name: name ?? session.user.username ?? '사용자',
          // TODO: resolve organization name via /api/v1/me — for now show the id.
          organization: organizationId ?? null,
          email,
        }}
      />
      <div className="flex min-h-0 flex-1">
        <NavRail role={role} />
        <main className="flex min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>

      <AppShellClient />
    </div>
  );
}
