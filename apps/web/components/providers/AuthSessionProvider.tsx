'use client';

import type { Session } from 'next-auth';
import { SessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';

/**
 * Client-side wrapper around `next-auth/react`'s `SessionProvider` so we can
 * mount it from a server-rendered layout without crossing the use-client
 * boundary at the layout itself.
 *
 * The `(main)` layout fetches the session via `auth()` (Node runtime, no DB
 * round-trip after the first call thanks to the JWT strategy) and forwards it
 * here. `useSession()` then resolves synchronously on the first render —
 * client code no longer has to roundtrip through `/api/v1/me` to learn the
 * acting user's id/role (R6 / F4-09).
 *
 * `refetchOnWindowFocus={false}` mirrors our React Query default; the JWT is
 * 8h so silently re-validating on every tab focus is wasted work.
 */
export function AuthSessionProvider({
  session,
  children,
}: {
  session: Session | null;
  children: ReactNode;
}) {
  return (
    <SessionProvider session={session} refetchOnWindowFocus={false}>
      {children}
    </SessionProvider>
  );
}
