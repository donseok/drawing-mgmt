// Layout for the (auth) route group — login and any future password-reset pages.
// Centered, no nav. The (main) route group has the app shell.

import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4 dark:bg-zinc-900">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
