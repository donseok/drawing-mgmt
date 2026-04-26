'use client';

/**
 * BulkCreateDialog — paste-to-create flow for bulk object registration.
 *
 * Replaces As-Is TeamPlus' separate `.exe` Excel-importer. The user pastes a
 * tab- or comma-separated chunk (first row optionally headers); we parse it
 * client-side, render a preview table with per-row validation hints, then
 * POST the cleaned rows to /api/v1/objects/bulk-create.
 *
 * Column order (6 columns; later ones optional):
 *   folderCode | classCode | name | number | securityLevel | description
 *
 * Per-row outcome surfaces via the same grouped-toast pattern as F4-03 bulk
 * delete, so users see "{N}건 성공, {M}건 실패. 실패 사유: …".
 */

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';
import { cn } from '@/lib/cn';

interface ParsedRow {
  folderCode: string;
  classCode: string;
  name: string;
  /** Required in bulk path — autonumber stays in the single-row dialog. */
  number: string;
  securityLevel?: number;
  description?: string;
  /** Per-row pre-flight error (e.g. missing required field). */
  err?: string;
}

const COLUMNS = ['folderCode', 'classCode', 'name', 'number', 'securityLevel', 'description'] as const;

function detectSeparator(text: string): '\t' | ',' {
  // Prefer TAB when present in any line — Excel paste defaults to TAB.
  return text.includes('\t') ? '\t' : ',';
}

function parsePaste(text: string, hasHeader: boolean): ParsedRow[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const sep = detectSeparator(trimmed);
  const lines = trimmed.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  const dataLines = hasHeader ? lines.slice(1) : lines;
  return dataLines.map((line) => {
    const cells = line.split(sep).map((c) => c.trim());
    const folderCode = cells[0] ?? '';
    const classCode = cells[1] ?? '';
    const name = cells[2] ?? '';
    const number = cells[3] ?? '';
    const slRaw = cells[4];
    const securityLevel =
      slRaw && slRaw.length > 0 ? Number.parseInt(slRaw, 10) : undefined;
    const description = cells[5] && cells[5].length > 0 ? cells[5] : undefined;

    let err: string | undefined;
    if (!folderCode) err = '폴더코드 누락';
    else if (!classCode) err = '자료유형 누락';
    else if (!name) err = '자료명 누락';
    else if (!number) err = '도면번호 누락';
    else if (
      securityLevel !== undefined &&
      (!Number.isInteger(securityLevel) || securityLevel < 1 || securityLevel > 5)
    ) {
      err = '보안등급은 1~5';
    }

    return {
      folderCode,
      classCode,
      name,
      number,
      securityLevel,
      description,
      err,
    };
  });
}

interface BulkCreateResponse {
  successes: Array<{ index: number; id: string; number: string }>;
  failures: Array<{ index: number; code: string; message: string }>;
}

export interface BulkCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BulkCreateDialog({ open, onOpenChange }: BulkCreateDialogProps) {
  const queryClient = useQueryClient();
  const [paste, setPaste] = React.useState('');
  const [hasHeader, setHasHeader] = React.useState(true);

  React.useEffect(() => {
    if (open) {
      setPaste('');
      setHasHeader(true);
    }
  }, [open]);

  const rows = React.useMemo(
    () => parsePaste(paste, hasHeader),
    [paste, hasHeader],
  );
  const validRows = rows.filter((r) => !r.err);
  const invalidCount = rows.length - validRows.length;

  const mutation = useMutation<
    BulkCreateResponse,
    ApiError,
    ParsedRow[]
  >({
    mutationFn: (cleanRows) =>
      api.post<BulkCreateResponse>('/api/v1/objects/bulk-create', {
        rows: cleanRows.map((r) => ({
          folderCode: r.folderCode,
          classCode: r.classCode,
          name: r.name,
          number: r.number,
          ...(r.securityLevel !== undefined
            ? { securityLevel: r.securityLevel }
            : {}),
          ...(r.description ? { description: r.description } : {}),
        })),
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all() });

      const okCount = res.successes.length;
      const failCount = res.failures.length;
      if (failCount === 0) {
        toast.success(`${okCount}건 등록을 완료했습니다.`);
        onOpenChange(false);
        return;
      }
      // Group failures by reason — same UX shape as F4-03 bulk delete.
      const grouped = new Map<string, number[]>();
      for (const f of res.failures) {
        const reason = f.message ?? f.code;
        const list = grouped.get(reason) ?? [];
        list.push(f.index + (hasHeader ? 2 : 1)); // 1-based row number for users
        grouped.set(reason, list);
      }
      const description = Array.from(grouped.entries())
        .map(([reason, idxs]) => `• 행 ${idxs.join(', ')}: ${reason}`)
        .join('\n');
      toast.error(
        `${okCount}건 성공, ${failCount}건 실패`,
        { description },
      );
      // Leave the dialog open so the user can fix offending rows and retry.
    },
    onError: (err) => {
      toast.error('일괄 등록 실패', { description: err.message });
    },
  });

  const submit = () => {
    if (validRows.length === 0) {
      toast.error('등록 가능한 행이 없습니다.');
      return;
    }
    mutation.mutate(validRows);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>자료 일괄 등록</DialogTitle>
          <DialogDescription>
            Excel/스프레드시트에서 6개 컬럼 (폴더코드, 자료유형, 자료명, 도면번호,
            [보안등급], [설명])을 복사해 아래에 붙여넣으세요. 탭 또는 콤마 구분 모두
            지원합니다. 자동 발번이 필요하면 단건 신규 등록을 사용하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-brand"
              />
              <span>첫 행은 헤더</span>
            </label>
            <span className="text-xs text-fg-muted">
              총 {rows.length}행 / 유효 {validRows.length}행
              {invalidCount > 0 ? ` / 오류 ${invalidCount}행` : ''}
            </span>
          </div>

          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={6}
            placeholder="CGL-MEC&#9;MEC&#9;CGL #1 라인 펌프 설치도&#9;&#9;3"
            className="w-full rounded-md border border-border bg-bg-subtle p-2 font-mono text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />

          {rows.length > 0 && (
            <div className="max-h-64 overflow-auto rounded-md border border-border">
              <table className="app-table">
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    {COLUMNS.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={i}
                      className={cn(r.err && 'bg-danger/5')}
                    >
                      <td className="font-mono text-xs text-fg-muted">
                        {i + (hasHeader ? 2 : 1)}
                      </td>
                      <td className="font-mono text-[12px]">{r.folderCode}</td>
                      <td className="font-mono text-[12px]">{r.classCode}</td>
                      <td className="text-[12px]">{r.name}</td>
                      <td className="font-mono text-[12px] text-fg-muted">
                        {r.number}
                      </td>
                      <td className="font-mono text-[12px] text-fg-muted">
                        {r.securityLevel ?? '5'}
                      </td>
                      <td className="max-w-44 truncate text-[12px] text-fg-muted">
                        {r.description ?? ''}
                      </td>
                      <td>
                        {r.err ? (
                          <span className="text-[11px] text-danger">{r.err}</span>
                        ) : (
                          <span className="text-[11px] text-success">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
            disabled={mutation.isPending || validRows.length === 0}
            className="app-action-button-primary h-9"
          >
            {mutation.isPending ? '등록 중…' : `${validRows.length}건 등록`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
