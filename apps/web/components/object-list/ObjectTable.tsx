'use client';

import * as React from 'react';
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type RowSelectionState,
} from '@tanstack/react-table';
import { useRouter } from 'next/navigation';
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Image as ImageIcon,
  FileText,
  Lock,
  MessageSquare,
  MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/StatusBadge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RowMenu, type RowMenuMe } from '@/components/object-list/RowMenu';
import { CONTROL_STATE, type ControlState } from '@/lib/control-state';

export type ObjectState =
  | 'NEW'
  | 'CHECKED_OUT'
  | 'CHECKED_IN'
  | 'IN_APPROVAL'
  | 'APPROVED'
  | 'DELETED';

export interface ObjectRow {
  id: string;
  number: string;
  name: string;
  classCode: string;
  classLabel: string;
  state: ObjectState;
  revision: number;
  version: string;
  registrant: string;
  registrantInitial: string;
  registeredAt: string; // YYYY-MM-DD
  thumbnailUrl?: string;
  masterAttachmentId?: string;
  issueCount?: number;
  markupCount?: number;
  transmittedAt?: string;
  lockedBy?: string | null;
  /** Raw lock owner id — needed by RowMenu to gate self-only actions. */
  lockedById?: string | null;
  /** Object owner id — needed by RowMenu to gate the admin-only delete rule. */
  ownerId?: string | null;
  controlState?: ControlState;
  latest?: boolean;
  /**
   * R40 S-1 — PDF body 매칭 시 BE가 내려주는 ts_headline 결과
   * (`...<b>매칭어</b>...` 형식 plain string). null이면 매칭 위치가
   * number/name/description 측이라 snippet 미생성. 자료명 cell 아래 한 줄
   * <PdfSnippetLine>으로 렌더된다.
   */
  pdfSnippet?: string | null;
  /**
   * R42 D — 검색 결과 행이 어느 매치 소스에서 왔는지. q 파라미터가 없는
   * 일반 list에선 항상 null. q 있을 때 'meta'(자료번호/이름/설명),
   * 'pdf'(본문), 'both'. 자료명 cell의 PdfSnippetLine 위에 작은 chip으로
   * 노출 — pdfSnippet이 비어 있어도 본문 매치라는 사실을 분리해 알 수 있다.
   */
  matchSource?: 'meta' | 'pdf' | 'both' | null;
}

interface ObjectTableProps {
  data: ObjectRow[];
  selectedId?: string;
  onSelect?: (row: ObjectRow | null) => void;
  /** Legacy count-only callback (kept for callers not yet upgraded). */
  onSelectedCountChange?: (count: number) => void;
  /**
   * Selection callback that surfaces the actual selected ids — needed by
   * the toolbar bulk actions wired in R3c-3 #5 (delete / download).
   * Fired alongside `onSelectedCountChange` so old call sites keep working.
   */
  onSelectedIdsChange?: (ids: string[]) => void;
  /** highlight matches in name/number; case-insensitive */
  searchTerm?: string;
  /**
   * Per-row delete. Table guards this behind a ConfirmDialog (DESIGN §9.3).
   * Caller performs the mutation; throwing surfaces an error toast.
   * If omitted, the row menu's delete entry stays disabled.
   */
  onDeleteRow?: (row: ObjectRow) => void | Promise<void>;
  /**
   * Signed-in user id — forwarded to <RowMenu> so self-only actions
   * (checkin / cancel-checkout) can be gated when the row is checked out.
   * @deprecated Pass `me` instead so the admin-delete gate (R3c-3 #4) works.
   */
  meId?: string;
  /**
   * Signed-in user — forwarded to <RowMenu>. Carries `id` (lock owner check)
   * and `role` (admin-delete gate, R3c-3 #4).
   */
  me?: RowMenuMe;
  // ── Row mutation callbacks (api_contract.md SIDE-C). The table is
  // a pass-through: callers in search/page.tsx wire these to React Query
  // mutations. Each callback fires on the corresponding RowMenu item.
  onCheckoutRow?: (row: ObjectRow) => void;
  onCheckinRow?: (row: ObjectRow) => void;
  onCancelCheckoutRow?: (row: ObjectRow) => void;
  onReleaseRow?: (row: ObjectRow) => void;
  /** R31 P-1 — open the PrintDialog for the row's master attachment. */
  onPrintRow?: (row: ObjectRow) => void;
}

export function ObjectTable({
  data,
  selectedId,
  onSelect,
  onSelectedCountChange,
  onSelectedIdsChange,
  searchTerm,
  onDeleteRow,
  meId,
  me,
  onCheckoutRow,
  onCheckinRow,
  onCancelCheckoutRow,
  onReleaseRow,
  onPrintRow,
}: ObjectTableProps) {
  const router = useRouter();
  // Default sort targets a column that actually exists in this table. The
  // earlier `registeredAt` key had no matching accessorKey, so react-table
  // logged a warning and the initial sort was silently dropped.
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'transmittedAt', desc: true }]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [pendingDelete, setPendingDelete] = React.useState<ObjectRow | null>(null);

  const handleConfirmDelete = async () => {
    if (!pendingDelete || !onDeleteRow) {
      setPendingDelete(null);
      return;
    }
    try {
      await onDeleteRow(pendingDelete);
      toast.success('삭제했습니다.', { description: pendingDelete.number });
      setPendingDelete(null);
    } catch (err) {
      toast.error('삭제에 실패했습니다.', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const columns = React.useMemo<ColumnDef<ObjectRow>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="전체 선택"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
            className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-brand"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label="행 선택"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-brand"
          />
        ),
        size: 32,
        enableSorting: false,
      },
      {
        accessorKey: 'state',
        header: '상태',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <StatusBadge status={row.original.state} size="sm" />
            {row.original.lockedBy ? (
              <Lock className="h-3.5 w-3.5 text-warning" aria-label="체크아웃됨" />
            ) : null}
          </div>
        ),
        size: 122,
      },
      {
        accessorKey: 'number',
        header: '도면번호',
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-bg-subtle text-fg-subtle">
              <FileText className="h-3.5 w-3.5" />
            </span>
            <span className="font-mono text-[13px] font-semibold text-fg">
              {highlight(row.original.number, searchTerm)}
            </span>
          </span>
        ),
        size: 230,
      },
      {
        id: 'revVer',
        header: 'Current Rev',
        cell: ({ row }) => (
          <span className="font-mono text-[12px] font-semibold text-fg">
            R{row.original.revision} <span className="font-normal text-fg-muted">v{row.original.version}</span>
          </span>
        ),
        size: 96,
      },
      {
        accessorKey: 'name',
        header: '자료명',
        cell: ({ row }) => (
          <div className="max-w-[420px]">
            <span className="block truncate font-medium text-fg">
              {highlight(row.original.name, searchTerm)}
            </span>
            <MatchSourceChip source={row.original.matchSource ?? null} />
            {row.original.pdfSnippet ? (
              <PdfSnippetLine snippet={row.original.pdfSnippet} />
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'classLabel',
        header: '분야',
        cell: ({ row }) => (
          <span className="inline-flex h-6 items-center rounded-md border border-border bg-bg-subtle px-2 text-[12px] font-medium text-fg-muted">
            {row.original.classLabel}
          </span>
        ),
        size: 94,
      },
      {
        id: 'controlState',
        header: '문서 통제',
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                'inline-flex h-6 items-center rounded-md border px-2 text-[12px] font-medium',
                row.original.controlState === CONTROL_STATE.FIELD
                  ? 'border-success/25 bg-success/10 text-success'
                  : row.original.controlState === CONTROL_STATE.REVIEW
                    ? 'border-warning/25 bg-warning/10 text-warning'
                    : 'border-border bg-bg-subtle text-fg-muted',
              )}
            >
              {row.original.controlState ?? CONTROL_STATE.WORKING}
            </span>
            {row.original.latest ? (
              <span className="text-[11px] font-medium text-brand">최신본</span>
            ) : null}
          </span>
        ),
        size: 130,
      },
      {
        id: 'signals',
        header: '이슈 / 마크업',
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2 text-[12px] text-fg-muted">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-danger" />
              {row.original.issueCount ?? 0}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3.5 w-3.5 text-info" />
              {row.original.markupCount ?? 0}
            </span>
          </span>
        ),
        size: 118,
      },
      {
        accessorKey: 'transmittedAt',
        header: '최근 배포',
        cell: ({ row }) => (
          <span className="font-mono text-[12px] text-fg-muted">
            {row.original.transmittedAt ?? '-'}
          </span>
        ),
        size: 100,
      },
      {
        accessorKey: 'registrant',
        header: '등록자',
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[10px] font-semibold text-brand-foreground">
              {row.original.registrantInitial}
            </span>
            <span className="text-[12px] text-fg">{row.original.registrant}</span>
          </span>
        ),
        size: 100,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <RowMenu
            row={{
              id: row.original.id,
              number: row.original.number,
              name: row.original.name,
              state: row.original.state,
              lockedById: row.original.lockedById ?? null,
              ownerId: row.original.ownerId ?? null,
              masterAttachmentId: row.original.masterAttachmentId ?? null,
            }}
            me={me}
            meId={meId}
            onCheckout={onCheckoutRow ? () => onCheckoutRow(row.original) : undefined}
            onCheckin={onCheckinRow ? () => onCheckinRow(row.original) : undefined}
            onCancelCheckout={
              onCancelCheckoutRow ? () => onCancelCheckoutRow(row.original) : undefined
            }
            onRelease={onReleaseRow ? () => onReleaseRow(row.original) : undefined}
            onDelete={onDeleteRow ? () => setPendingDelete(row.original) : undefined}
            onPrint={onPrintRow ? () => onPrintRow(row.original) : undefined}
          />
        ),
        size: 32,
        enableSorting: false,
      },
    ],
    [
      searchTerm,
      onDeleteRow,
      me,
      meId,
      onCheckoutRow,
      onCheckinRow,
      onCancelCheckoutRow,
      onReleaseRow,
      onPrintRow,
    ],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  React.useEffect(() => {
    // rowSelection is keyed by react-table row.id which (since we don't pass
    // a custom getRowId) maps to the row's index in `data`. Translate to the
    // ObjectRow.id ourselves so callers can run mutations off the selection.
    const selectedIndices = Object.entries(rowSelection)
      .filter(([, on]) => on)
      .map(([k]) => Number(k))
      .filter((n) => Number.isFinite(n));
    onSelectedCountChange?.(selectedIndices.length);
    if (onSelectedIdsChange) {
      const ids = selectedIndices
        .map((idx) => data[idx]?.id)
        .filter((id): id is string => typeof id === 'string');
      onSelectedIdsChange(ids);
    }
  }, [onSelectedCountChange, onSelectedIdsChange, rowSelection, data]);

  return (
    <div className="min-h-0 overflow-auto">
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title={pendingDelete ? `${pendingDelete.number} 자료를 삭제하시겠습니까?` : '자료를 삭제하시겠습니까?'}
        description={
          pendingDelete
            ? `${pendingDelete.name} — 이 작업은 되돌릴 수 없습니다. 삭제된 항목은 휴지통으로 이동합니다.`
            : '이 작업은 되돌릴 수 없습니다.'
        }
        confirmText="삭제"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
      <table className="app-table">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border">
              {hg.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() ? header.getSize() : undefined }}
                    className="select-none"
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        aria-label={`정렬: ${typeof header.column.columnDef.header === 'string' ? header.column.columnDef.header : header.column.id}`}
                        className="inline-flex items-center gap-1 rounded hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === 'asc' ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : sorted === 'desc' ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 && (
            <tr>
                  <td colSpan={columns.length} className="px-3 py-12 text-center text-sm text-fg-muted">
                    결과가 없습니다.
                  </td>
            </tr>
          )}
          {table.getRowModel().rows.map((row) => {
            const r = row.original;
            const isSelected = r.id === selectedId;
            return (
              <tr
                key={row.id}
                data-state={isSelected ? 'selected' : undefined}
                onClick={() => onSelect?.(r)}
                onDoubleClick={() => {
                  if (r.masterAttachmentId) router.push(`/viewer/${r.masterAttachmentId}`);
                  else router.push(`/objects/${r.id}`);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') router.push(`/objects/${r.id}`);
                  if (e.key === ' ') {
                    e.preventDefault();
                    onSelect?.(isSelected ? null : r);
                  }
                }}
                tabIndex={0}
                aria-selected={isSelected}
                className={cn(
                  'group cursor-pointer transition-colors',
                  // Keep the row tinted on focus and let the global
                  // :focus-visible outline (globals.css) draw the ring so
                  // <tr> doesn't need its own outline-suppression dance.
                  'hover:bg-bg-subtle focus-visible:bg-bg-muted',
                  isSelected && 'bg-brand/5 shadow-[inset_3px_0_0_hsl(var(--brand))]',
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function highlight(text: string, term?: string) {
  if (!term) return text;
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-amber-200/60 px-0.5 text-fg dark:bg-amber-500/30">
        {text.slice(idx, idx + term.length)}
      </mark>
      {text.slice(idx + term.length)}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// MatchSourceChip — R42 D
// `matchSource === 'pdf' | 'both'`일 때만 자료명 cell 아래에 작은 chip을
// 노출. 'meta'는 기존 자료번호/이름 hit이라 별도 라벨이 의미 없음(미표시).
// chip은 pdfSnippet이 비어 있어도(ts_headline이 짧은 매칭에서 빈값을 줄 때)
// "본문에서 매치됐다"는 사실을 분리해 보여줄 수 있게 한다 — contract §4.
// ──────────────────────────────────────────────────────────────────────────

function MatchSourceChip({
  source,
}: {
  source: 'meta' | 'pdf' | 'both' | null;
}): JSX.Element | null {
  if (source !== 'pdf' && source !== 'both') return null;
  const label = source === 'pdf' ? '본문' : '본문+메타';
  return (
    <span
      className="mt-0.5 mr-1 inline-flex items-center rounded-full border border-warning/25 bg-warning/10 px-1.5 py-0 text-[10px] font-medium leading-4 text-warning"
      aria-label={`매치 위치: ${label}`}
    >
      {label}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// PdfSnippetLine — R40 S-1
// BE의 ts_headline 결과는 `...<b>매칭어</b>...` 형식의 plain string이다.
// dangerouslySetInnerHTML은 절대 사용하지 않는다 — 임의의 HTML이 들어와도
// XSS가 되지 않도록 정규식 split + JSX <mark> 렌더로 안전하게 변환한다.
// designer §D.3.
// ──────────────────────────────────────────────────────────────────────────

const PDF_SNIPPET_MAX_CHARS = 80;

function PdfSnippetLine({
  snippet,
  maxChars = PDF_SNIPPET_MAX_CHARS,
}: {
  snippet: string;
  maxChars?: number;
}) {
  if (!snippet || !snippet.trim()) return null;
  return (
    <p className="mt-0.5 truncate text-xs text-fg-muted">
      <span className="font-medium text-fg-subtle">본문 </span>
      {renderSnippet(snippet, maxChars)}
    </p>
  );
}

/**
 * `<b>...</b>` 마커를 `<mark>`로 변환. 정규식 split이라 짝이 안 맞거나
 * 다른 태그가 섞여 들어와도 plain text로 떨어진다 (XSS 안전 fallback).
 */
function renderSnippet(snippet: string, maxChars: number): React.ReactNode {
  const truncated = truncatePreservingTags(snippet, maxChars);
  const re = /<b>(.*?)<\/b>/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(truncated)) !== null) {
    if (m.index > lastIndex) {
      parts.push(truncated.slice(lastIndex, m.index));
    }
    parts.push(
      <mark
        key={key++}
        className="rounded bg-amber-200/60 px-0.5 text-fg dark:bg-amber-500/30"
      >
        {m[1]}
      </mark>,
    );
    lastIndex = re.lastIndex;
  }
  if (lastIndex < truncated.length) {
    parts.push(truncated.slice(lastIndex));
  }
  return <>{parts}</>;
}

function truncatePreservingTags(snippet: string, maxChars: number): string {
  // BE는 MaxFragments=1, MaxWords=20으로 자체 짧게 만들어 보내므로 실제 잘림은
  // 거의 없다. 안전망 — `<b>...</b>` 마커 길이를 제외한 가시 글자 수가
  // maxChars + 마커 페어 길이를 넘어가면 단순 slice + ellipsis.
  if (snippet.length <= maxChars + 7 /* "<b></b>".length */) return snippet;
  return snippet.slice(0, maxChars) + '…';
}
