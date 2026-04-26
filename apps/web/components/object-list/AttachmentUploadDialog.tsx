'use client';

/**
 * AttachmentUploadDialog — single-file multipart upload to
 * `/api/v1/objects/:id/attachments`. The BE handles state-machine + permission
 * checks; the dialog just collects the file + isMaster choice and surfaces
 * server errors inline.
 *
 * Drop-in for the object detail page; `objectId` is required, the rest of the
 * UX (file picker, name preview, upload progress) lives entirely here.
 */

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UploadCloud, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError, apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';
import { cn } from '@/lib/cn';

interface UploadResponse {
  id: string;
  filename: string;
  mimeType: string;
  size: string;
  isMaster: boolean;
}

export interface AttachmentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  objectId: string;
  /** True when the object has no master yet — preselects the isMaster checkbox. */
  isFirstAttachment?: boolean;
}

export function AttachmentUploadDialog({
  open,
  onOpenChange,
  objectId,
  isFirstAttachment,
}: AttachmentUploadDialogProps) {
  const queryClient = useQueryClient();
  const [file, setFile] = React.useState<File | null>(null);
  const [isMaster, setIsMaster] = React.useState(false);
  const [dragActive, setDragActive] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setFile(null);
      setIsMaster(!!isFirstAttachment);
      setDragActive(false);
    }
  }, [open, isFirstAttachment]);

  // R24 — drag & drop. We accept exactly one file; multi-file batch lives in
  // the bulk-create dialog (R16) under a different mental model.
  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  };
  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragActive(true);
  };
  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragActive(false);
  };

  const mutation = useMutation<UploadResponse, ApiError, FormData>({
    // We bypass the usual `api.post` helper because it JSON-encodes the body
    // by default; FormData needs a raw fetch path. apiRequest already detects
    // FormData and skips the JSON header.
    mutationFn: (form) =>
      apiRequest<UploadResponse>(`/api/v1/objects/${objectId}/attachments`, {
        method: 'POST',
        body: form,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.objects.detail(objectId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.objects.activity(objectId),
      });
      toast.success(
        res.isMaster
          ? `${res.filename}을(를) 마스터로 추가했습니다.`
          : `${res.filename}을(를) 추가했습니다.`,
      );
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error('첨부 업로드 실패', { description: err.message });
    },
  });

  const submit = () => {
    if (!file) {
      toast.error('파일을 선택하세요.');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    if (isMaster) form.append('isMaster', 'true');
    mutation.mutate(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>첨부 추가</DialogTitle>
          <DialogDescription>
            현재 자료의 작업 버전에 파일을 첨부합니다. 마스터로 지정하면 기존
            마스터는 보조로 변경됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-sm transition-colors',
              dragActive
                ? 'border-brand bg-brand/5 text-brand'
                : 'border-border bg-bg-subtle text-fg-muted hover:bg-bg-muted',
            )}
          >
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <UploadCloud
              className={cn(
                'h-6 w-6',
                dragActive ? 'text-brand' : 'text-fg-subtle',
              )}
              aria-hidden
            />
            {file ? (
              <span className="flex items-center gap-2 text-fg">
                <span className="font-medium">{file.name}</span>
                <span className="text-xs text-fg-muted">({formatBytes(file.size)})</span>
                <button
                  type="button"
                  aria-label="선택 해제"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setFile(null);
                  }}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : (
              <span>여기에 파일을 끌어다 놓거나 클릭해 선택하세요.</span>
            )}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isMaster}
              onChange={(e) => setIsMaster(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border accent-brand"
            />
            <span>마스터로 지정</span>
          </label>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
            className="app-action-button h-9"
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={mutation.isPending || !file}
            className="app-action-button-primary h-9 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <UploadCloud className="h-4 w-4" />
            {mutation.isPending ? '업로드 중…' : '업로드'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
