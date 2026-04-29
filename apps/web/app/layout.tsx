import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Suspense } from 'react';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { QueryProvider } from '@/components/providers/QueryProvider';
import './globals.css';

export const metadata: Metadata = {
  title: '동국씨엠 도면관리',
  description: '동국씨엠 도면관리 시스템 (EDMS)',
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // R-CSP / FIND-015 — middleware sets `x-nonce` per request. We forward it
  // to next-themes so its inline bootstrap script carries `nonce={...}` that
  // matches the CSP `'nonce-...'` token. Calling `headers()` makes this
  // layout dynamic, but it already is via `auth()` callsites downstream.
  // BUG-15 — coerce empty string to undefined so next-themes either gets a
  // real nonce (CSP enabled) or omits the attribute entirely. Mixing in an
  // empty string was the source of the "Server: \"\" Client: <token>"
  // hydration mismatch the QA report flagged.
  const nonceHeader = headers().get('x-nonce');
  const nonce = nonceHeader && nonceHeader.length > 0 ? nonceHeader : undefined;
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* Pretendard variable font (self-hosted in production per DESIGN §15) */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      <body className="bg-bg font-sans text-fg antialiased">
        <ThemeProvider nonce={nonce}>
          <QueryProvider>
            <Suspense fallback={null}>{children}</Suspense>
            <Toaster
              position="top-right"
              richColors
              closeButton
              duration={4000}
              toastOptions={{ className: 'font-sans' }}
            />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
