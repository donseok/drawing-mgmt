'use client';

import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

const ORDER = ['light', 'dark', 'system'] as const;
type ThemeName = (typeof ORDER)[number];

const THEME_OPTIONS: { value: ThemeName; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '라이트', icon: Sun },
  { value: 'dark', label: '다크', icon: Moon },
  { value: 'system', label: '시스템', icon: Monitor },
];

export function ThemeToggle({
  className,
  variant = 'icon',
}: {
  className?: string;
  variant?: 'icon' | 'segmented';
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const current: ThemeName = (mounted ? (theme as ThemeName) : 'system') ?? 'system';

  if (variant === 'segmented') {
    return (
      <div
        className={cn(
          'inline-flex rounded-md border border-border bg-bg-subtle p-0.5',
          className,
        )}
        role="group"
        aria-label="테마 선택"
      >
        {THEME_OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = current === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setTheme(option.value)}
              aria-pressed={active}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded px-2 text-[12px] font-medium transition-colors',
                active
                  ? 'bg-bg text-fg shadow-sm ring-1 ring-border'
                  : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

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
