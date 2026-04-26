import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Header } from '@/components/layout/Header';
import { NavRail } from '@/components/layout/NavRail';
import { AppShellClient } from '@/components/layout/AppShellClient';
import { GlobalFolderSidebar } from '@/components/layout/GlobalFolderSidebar';
import { AuthSessionProvider } from '@/components/providers/AuthSessionProvider';

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  // Middleware already gates the (main) tree, but a server-side check ensures
  // session.user is non-null for all child server components.
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const { name, organizationId, role, email } = session.user;

  return (
    // R6 (F4-09) — SessionProvider so client components can read the acting
    // user via `useSession()` instead of round-tripping through `/api/v1/me`.
    // The server-resolved session hydrates the provider, so the first render
    // already has `status === 'authenticated'` and the cached user fields.
    <AuthSessionProvider session={session}>
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
          {/* R8 — workspace-wide folder browser. Collapsed by default; the
              user toggles it from NavRail. Persists open/closed + width
              + tree expansion via Zustand. */}
          <GlobalFolderSidebar />
          <main className="flex min-w-0 flex-1 overflow-hidden">{children}</main>
        </div>

        <AppShellClient />
      </div>
    </AuthSessionProvider>
  );
}
