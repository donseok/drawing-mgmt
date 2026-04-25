// Layout for the (auth) route group — login and any future password-reset pages.
// Centered, no nav. The (main) route group has the app shell.

import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-frame flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
