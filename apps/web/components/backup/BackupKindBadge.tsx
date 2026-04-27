'use client';

// R33 D-5 — small chip for `kind` (POSTGRES | FILES) so the table column
// reads at a glance. We keep this tiny and uncolored to avoid stealing
// attention from the status pill.

import * as React from 'react';
import { Database, FolderArchive } from 'lucide-react';

import { cn } from '@/lib/cn';
import type { BackupKind } from './types';

const KIND_LABEL: Record<BackupKind, string> = {
  POSTGRES: 'Postgres',
  FILES: '파일',
};

export interface BackupKindBadgeProps {
  kind: BackupKind;
  className?: string;
}

export function BackupKindBadge({
  kind,
  className,
}: BackupKindBadgeProps): JSX.Element {
  const Icon = kind === 'POSTGRES' ? Database : FolderArchive;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border bg-bg-subtle px-1.5 py-0.5 text-[11px] font-medium text-fg',
        className,
      )}
    >
      <Icon className="h-3 w-3 text-fg-muted" aria-hidden="true" />
      {KIND_LABEL[kind]}
    </span>
  );
}
