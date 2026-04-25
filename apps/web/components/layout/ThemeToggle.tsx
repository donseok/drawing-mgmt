'use client';

import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

const ORDER = ['light', 'dark', 'system'] as const;
type ThemeName = (typeof ORDER)[number];

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const current: ThemeName = (mounted ? (theme as ThemeName) : 'system') ?? 'system';
  const cycle = () => {
    const idx = ORDER.indexOf(current);
    const next = ORDER[(idx + 1) % ORDER.length] ?? 'system';
    setTheme(next);
  };

  const Icon = current === 'dark' ? Moon : current === 'light' ? Sun : Monitor;
  const label = current === 'dark' ? '다크' : current === 'light' ? '라이트' : '시스템';

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`테마: ${label} (클릭하여 변경)`}
      title={`테마: ${label}`}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted',
        'hover:bg-bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
