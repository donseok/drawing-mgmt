'use client';

/**
 * FolderEditDialog — single dialog used for both "새 하위 폴더" and
 * "이름 변경". The discriminator is `mode`:
 *   - 'create-child' → POST /api/v1/folders with parentId
 *   - 'rename'       → PATCH /api/v1/folders/:id with name (+ folderCode)
 *
 * Validates inline (non-empty name, folderCode shape). Server rejects on
 * uniqueness collision; we surface that error inline so the user can correct
 * without losing the dialog.
 */

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type FolderEditMode = 'create-child' | 'rename';

export interface FolderEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: FolderEditMode;
  /** Parent (create-child) or self (rename). */
  contextFolder: { id: string; name: string; code: string } | null;
  /** Initial values for rename mode. */
  initialName?: string;
  initialFolderCode?: string;
  /** Resolves on success, throws on failure (caller wires the mutation). */
  onSubmit: (values: { name: string; folderCode: string }) => Promise<void>;
}

const FOLDER_CODE_RE = /^[A-Z0-9_-]+$/;

export function FolderEditDialog({
  open,
  onOpenChange,
  mode,
  contextFolder,
  initialName = '',
  initialFolderCode = '',
  onSubmit,
}: FolderEditDialogProps) {
  const [name, setName] = useState('');
  const [folderCode, setFolderCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset every time the dialog opens so leftover state from a prior edit
  // doesn't leak into the next one.
  useEffect(() => {
    if (open) {
      setName(initialName);
      setFolderCode(initialFolderCode);
      setErr(null);
      setSubmitting(false);
    }
  }, [open, initialName, initialFolderCode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const trimmedName = name.trim();
    const trimmedCode = folderCode.trim().toUpperCase();
    if (!trimmedName) {
      setErr('폴더 이름을 입력하세요.');
      return;
    }
    if (!trimmedCode) {
      setErr('폴더 코드를 입력하세요.');
      return;
    }
    if (!FOLDER_CODE_RE.test(trimmedCode)) {
      setErr('폴더 코드는 영문 대문자/숫자/_-만 허용합니다.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ name: trimmedName, folderCode: trimmedCode });
      onOpenChange(false);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : '저장에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === 'create-child' ? '새 하위 폴더' : '폴더 이름 변경';
  const description =
    mode === 'create-child'
      ? `${contextFolder?.name ?? '루트'} 아래에 새 폴더를 만듭니다.`
      : `${contextFolder?.name ?? ''}의 이름과 코드를 변경합니다.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="app-kicker mb-1 block">폴더 이름</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoFocus
              className="h-9 w-full rounded-md border border-border bg-bg px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="block">
            <span className="app-kicker mb-1 block">폴더 코드</span>
            <input
              type="text"
              value={folderCode}
              onChange={(e) => setFolderCode(e.target.value)}
              maxLength={32}
              placeholder="예: CGL-MEC"
              className="h-9 w-full rounded-md border border-border bg-bg px-2 font-mono text-sm uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="mt-1 text-xs text-fg-subtle">
              영문 대문자/숫자/_-만 허용. 자동 발번에 사용됩니다.
            </p>
          </label>
          {err ? (
            <p role="alert" className="text-xs text-danger">
              {err}
            </p>
          ) : null}
          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="app-action-button h-9"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="app-action-button-primary h-9"
            >
              {submitting ? '저장 중…' : mode === 'create-child' ? '만들기' : '저장'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
