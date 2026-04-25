import type { Metadata } from 'next';
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
        <ThemeProvider>
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
