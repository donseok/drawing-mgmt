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
import { ChevronUp, ChevronDown, ChevronsUpDown, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/StatusBadge';
import { RowMenu } from '@/components/object-list/RowMenu';

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
        id: 'thumbnail',
        header: '',
        cell: ({ row }) => (
          <div className="flex h-10 w-12 items-center justify-center overflow-hidden rounded-md border border-border bg-bg-subtle">
            {row.original.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={row.original.thumbnailUrl}
                alt=""
                className="h-full w-full object-cover"
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
          <span className="font-mono text-[13px] font-medium text-fg">{highlight(row.original.number, searchTerm)}</span>
        ),
        size: 200,
      },
      {
        accessorKey: 'name',
        header: '자료명',
        cell: ({ row }) => (
          <span className="block max-w-[360px] truncate font-medium text-fg">{highlight(row.original.name, searchTerm)}</span>
        ),
      },
      {
        accessorKey: 'classLabel',
        header: '자료유형',
        cell: ({ row }) => (
          <span className="inline-flex h-6 items-center rounded-md border border-border bg-bg-subtle px-2 text-[12px] font-medium text-fg-muted">
            {row.original.classLabel}
          </span>
        ),
        size: 100,
      },
      {
        accessorKey: 'state',
        header: '상태',
        cell: ({ row }) => <StatusBadge status={row.original.state} size="sm" />,
        size: 104,
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
