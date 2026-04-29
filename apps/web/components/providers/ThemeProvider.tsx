'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

/**
 * R-CSP / FIND-015 — `nonce` flows from middleware → root layout
 * (`headers().get('x-nonce')`) → here → `next-themes`. next-themes 0.3.0
 * stamps the value onto its inline bootstrap `<script nonce={...}>` so it
 * matches the CSP `script-src 'nonce-{X}'` directive. When `nonce` is
 * undefined (e.g. during a static page where middleware did not run),
 * next-themes simply omits the attribute, which is fine for builds.
 */
export function ThemeProvider({
  children,
  nonce,
}: {
  children: ReactNode;
  nonce?: string;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  );
}
