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
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/StatusBadge';
import { RowMenu } from '@/components/object-list/RowMenu';
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
  controlState?: ControlState;
  latest?: boolean;
}

interface ObjectTableProps {
  data: ObjectRow[];
  selectedId?: string;
  onSelect?: (row: ObjectRow | null) => void;
  onSelectedCountChange?: (count: number) => void;
  /** highlight matches in name/number; case-insensitive */
  searchTerm?: string;
}

export function ObjectTable({ data, selectedId, onSelect, onSelectedCountChange, searchTerm }: ObjectTableProps) {
  const router = useRouter();
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'registeredAt', desc: true }]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});

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
          <span className="block max-w-[420px] truncate font-medium text-fg">
            {highlight(row.original.name, searchTerm)}
          </span>
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
            }}
          />
        ),
        size: 32,
        enableSorting: false,
      },
    ],
    [searchTerm],
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
    onSelectedCountChange?.(Object.values(rowSelection).filter(Boolean).length);
  }, [onSelectedCountChange, rowSelection]);

  return (
    <div className="min-h-0 overflow-auto">
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
                        className="inline-flex items-center gap-1 hover:text-fg"
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
                  'hover:bg-bg-subtle focus-visible:bg-bg-muted focus-visible:outline-none',
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
