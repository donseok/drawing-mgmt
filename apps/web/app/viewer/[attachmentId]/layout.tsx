/**
 * Layout for /viewer/[attachmentId].
 *
 * The viewer is fullscreen and intentionally bypasses the global Header /
 * NavRail (DESIGN §6.5 "ESC 또는 X로 닫고 이전 화면 복귀"). We don't render a
 * separate <html>/<body> here — Next 14 segment layouts inherit from the
 * root layout — but we do constrain overflow on the wrapper so the canvas can
 * fully claim the viewport without scrollbars.
 *
 * NOTE: globals styles + RootProviders are still applied by app/layout.tsx,
 * which is the right place for theme/auth providers. This layout only adjusts
 * presentation.
 */

import type { ReactNode } from 'react';

export default function ViewerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 h-screen w-screen overflow-hidden bg-bg">
      {children}
    </div>
  );
}
