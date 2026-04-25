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
import { ChevronUp, ChevronDown, ChevronsUpDown, MoreVertical, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

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
}

const STATUS_STYLES: Record<ObjectState, { dot: string; label: string }> = {
  NEW: { dot: 'bg-status-new', label: 'NEW' },
  CHECKED_OUT: { dot: 'bg-status-checkedOut', label: 'C/O' },
  CHECKED_IN: { dot: 'bg-status-checkedIn', label: 'C/I' },
  IN_APPROVAL: { dot: 'bg-status-inApproval', label: '결재중' },
  APPROVED: { dot: 'bg-status-approved', label: 'APPR' },
  DELETED: { dot: 'bg-status-deleted', label: '폐기' },
};

interface ObjectTableProps {
  data: ObjectRow[];
  selectedId?: string;
  onSelect?: (row: ObjectRow | null) => void;
  /** highlight matches in name/number; case-insensitive */
  searchTerm?: string;
}

export function ObjectTable({ data, selectedId, onSelect, searchTerm }: ObjectTableProps) {
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
            className="h-3.5 w-3.5 cursor-pointer rounded border-border"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label="행 선택"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 cursor-pointer rounded border-border"
          />
        ),
        size: 32,
        enableSorting: false,
      },
      {
        id: 'thumbnail',
        header: '',
        cell: ({ row }) => (
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded border border-border bg-bg-muted">
            {row.original.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={row.original.thumbnailUrl}
                alt=""
                className="h-full w-full object-cover transition-transform group-hover:scale-150"
              />
            ) : (
              <ImageIcon className="h-4 w-4 text-fg-subtle" aria-hidden />
            )}
          </div>
        ),
        size: 56,
        enableSorting: false,
      },
      {
        accessorKey: 'number',
        header: '도면번호',
        cell: ({ row }) => (
          <span className="font-mono text-[13px] text-fg">{highlight(row.original.number, searchTerm)}</span>
        ),
        size: 200,
      },
      {
        accessorKey: 'name',
        header: '자료명',
        cell: ({ row }) => (
          <span className="truncate text-fg">{highlight(row.original.name, searchTerm)}</span>
        ),
      },
      {
        accessorKey: 'classLabel',
        header: '자료유형',
        cell: ({ row }) => (
          <span className="inline-flex h-5 items-center rounded border border-border bg-bg-muted px-1.5 text-[11px] text-fg-muted">
            {row.original.classLabel}
          </span>
        ),
        size: 100,
      },
      {
        accessorKey: 'state',
        header: '상태',
        cell: ({ row }) => {
          const s = STATUS_STYLES[row.original.state];
          return (
            <span className="inline-flex items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-full', s.dot)} aria-hidden />
              <span className="text-[12px] text-fg-muted">{s.label}</span>
            </span>
          );
        },
        size: 80,
      },
      {
        id: 'revVer',
        header: 'Rev / Ver',
        cell: ({ row }) => (
          <span className="font-mono text-[12px] text-fg-muted">
            R{row.original.revision} v{row.original.version}
          </span>
        ),
        size: 80,
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
        accessorKey: 'registeredAt',
        header: '등록일',
        cell: ({ row }) => (
          <span className="font-mono text-[12px] text-fg-muted">{row.original.registeredAt}</span>
        ),
        size: 100,
      },
      {
        id: 'actions',
        header: '',
        cell: () => (
          <button
            type="button"
            aria-label="행 메뉴"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-muted"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
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

  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-bg-subtle">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border">
              {hg.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() ? header.getSize() : undefined }}
                    className="h-9 select-none px-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-muted"
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
                  'group relative cursor-pointer border-b border-border transition-colors',
                  'hover:bg-bg-subtle focus-visible:bg-bg-muted focus-visible:outline-none',
                  isSelected && 'bg-brand/5',
                )}
              >
                {isSelected && (
                  <td aria-hidden className="absolute left-0 top-0 h-full w-1 bg-brand-500" />
                )}
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-2 py-2 align-middle">
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
