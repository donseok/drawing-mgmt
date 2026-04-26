'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';

interface SignatureSectionProps {
  signatureFile: string | null;
}

export function SignatureSection({ signatureFile }: SignatureSectionProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post<{ signatureFile: string }>('/api/v1/me/signature', formData);
    },
    onSuccess: () => {
      toast.success('서명이 업로드되었습니다.');
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.me() });
    },
    onError: (err: Error) => {
      const msg = err instanceof ApiError ? err.message : '서명 업로드에 실패했습니다.';
      toast.error(msg);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => api.delete('/api/v1/me/signature'),
    onSuccess: () => {
      toast.success('서명이 삭제되었습니다.');
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.me() });
    },
    onError: (err: Error) => {
      const msg = err instanceof ApiError ? err.message : '서명 삭제에 실패했습니다.';
      toast.error(msg);
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      toast.error('PNG 또는 JPEG 파일만 업로드할 수 있습니다.');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('파일 크기는 2MB 이하여야 합니다.');
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPreview(ev.target?.result as string);
    };
    reader.readAsDataURL(file);

    uploadMutation.mutate(file);

    // Reset input so the same file can be re-selected
    e.target.value = '';
  };

  const isPending = uploadMutation.isPending || deleteMutation.isPending;

  // Determine the image source to display
  const imageSrc = preview ?? signatureFile;

  return (
    <section>
      <h2 className="text-base font-semibold text-fg">서명 관리</h2>
      <p className="mt-1 text-sm text-fg-muted">
        결재 시 사용할 서명 이미지를 관리합니다. PNG 또는 JPEG 파일(2MB 이하)을 업로드하세요.
      </p>

      <div className="mt-4 rounded-lg border border-border bg-bg p-5">
        {/* Signature preview */}
        <div className="flex items-center justify-center rounded-md border border-dashed border-border bg-bg-subtle p-6">
          {imageSrc ? (
            <img
              src={imageSrc}
              alt="서명 미리보기"
              className="max-h-32 max-w-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-fg-muted">
              <ImageIcon className="h-10 w-10" />
              <span className="text-sm">등록된 서명이 없습니다</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-4 flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            onChange={handleFileChange}
            className="sr-only"
            aria-label="서명 이미지 파일 선택"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            업로드
          </Button>
          {signatureFile && (
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              삭제
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
