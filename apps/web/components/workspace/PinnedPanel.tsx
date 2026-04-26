'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, FileText, Folder, Plus, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';
import { cn } from '@/lib/cn';

// Mirrors the PinPayload union from /api/v1/me/pins. Kept inline so the
// home tile doesn't pull a server-only types file into the client bundle.
type PinItem =
  | {
      kind: 'folder';
      pinId: string;
      sortOrder: number;
      folder: { id: string; name: string; folderCode: string };
    }
  | {
      kind: 'object';
      pinId: string;
      sortOrder: number;
      object: { id: string; number: string; name: string; state: string };
    };

interface PinsResponse {
  items: PinItem[];
}

/**
 * Workspace home "핀 고정" section. R7 — replaces the static FAVORITES
 * fixture in app/(main)/page.tsx with the live `/api/v1/me/pins` feed and
 * lets the user remove a pin inline.
 */
export function PinnedPanel() {
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useQuery<PinsResponse, ApiError>({
    queryKey: queryKeys.pins.list(),
    queryFn: () => api.get<PinsResponse>('/api/v1/me/pins'),
    staleTime: 60_000,
  });

  const unpinMutation = useMutation<unknown, ApiError, string>({
    mutationFn: (pinId) => api.delete(`/api/v1/me/pins/${pinId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pins.all() });
      toast.success('즐겨찾기에서 제외했습니다.');
    },
    onError: (err) => {
      toast.error('핀 해제 실패', { description: err.message });
    },
  });

  // R9 — reorder via PATCH /api/v1/me/pins/reorder. The home tile keeps two
  // separate ordered lists (folder vs object) and only sends the kind that
  // changed so the BE doesn't have to re-sort the other.
  const reorderMutation = useMutation<
    unknown,
    ApiError,
    { type: 'folder' | 'object'; ids: string[] }
  >({
    mutationFn: (vars) =>
      api.patch('/api/v1/me/pins/reorder', { type: vars.type, ids: vars.ids }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pins.all() });
    },
    onError: (err) => {
      toast.error('순서 변경 실패', { description: err.message });
    },
  });

  const items = data?.items ?? [];

  // Split + sort by sortOrder so reorder UI operates on stable kind-local
  // indices. The shared `items` array intermixes kinds in the API response
  // but the user only reorders within a kind.
  const folderPins = React.useMemo(
    () =>
      items
        .filter((i): i is Extract<PinItem, { kind: 'folder' }> => i.kind === 'folder')
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [items],
  );
  const objectPins = React.useMemo(
    () =>
      items
        .filter((i): i is Extract<PinItem, { kind: 'object' }> => i.kind === 'object')
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [items],
  );

  const moveWithinKind = (
    kind: 'folder' | 'object',
    fromIdx: number,
    direction: -1 | 1,
  ) => {
    const list = kind === 'folder' ? folderPins : objectPins;
    const toIdx = fromIdx + direction;
    if (toIdx < 0 || toIdx >= list.length) return;
    const next = [...list];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved!);
    reorderMutation.mutate({ type: kind, ids: next.map((p) => p.pinId) });
  };

  return (
    <section className="app-panel overflow-hidden" aria-label="핀 고정 도면">
      <div className="app-panel-header">
        <div>
          <div className="app-kicker">Pinned</div>
          <h2 className="text-sm font-semibold text-fg">핀 고정 도면/폴더</h2>
        </div>
        <Link href="/search" className="app-icon-button h-7 w-7" aria-label="자료 검색에서 핀 추가">
          <Plus className="h-4 w-4" />
        </Link>
      </div>
      <div className="divide-y divide-border">
        {isPending ? (
          <div className="space-y-2 px-4 py-3" role="status" aria-busy="true">
            {Array.from({ length: 3 }, (_, i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded-md bg-bg-muted/60"
              />
            ))}
          </div>
        ) : isError ? (
          <div className="px-4 py-6 text-center text-xs text-fg-muted">
            핀 목록을 불러오지 못했습니다.
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-fg-muted">
            아직 핀 고정한 항목이 없습니다.
            <br />
            폴더 트리나 자료에서 ☆ 를 클릭해 추가하세요.
          </div>
        ) : (
          // Render folders first then objects so the user can reorder each
          // kind independently without the lists intermixing on every click.
          [
            ...folderPins.map((p, idx) => (
              <PinRow
                key={p.pinId}
                pin={p}
                isFirst={idx === 0}
                isLast={idx === folderPins.length - 1}
                onMoveUp={() => moveWithinKind('folder', idx, -1)}
                onMoveDown={() => moveWithinKind('folder', idx, 1)}
                onRemove={unpinMutation.mutate}
              />
            )),
            ...objectPins.map((p, idx) => (
              <PinRow
                key={p.pinId}
                pin={p}
                isFirst={idx === 0}
                isLast={idx === objectPins.length - 1}
                onMoveUp={() => moveWithinKind('object', idx, -1)}
                onMoveDown={() => moveWithinKind('object', idx, 1)}
                onRemove={unpinMutation.mutate}
              />
            )),
          ]
        )}
      </div>
    </section>
  );
}

function PinRow({
  pin,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  pin: PinItem;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: (pinId: string) => void;
}) {
  const { href, primary, secondary, icon } =
    pin.kind === 'folder'
      ? {
          href: `/search?folder=${pin.folder.id}`,
          primary: pin.folder.name,
          secondary: pin.folder.folderCode,
          icon: <Folder className="h-4 w-4" />,
        }
      : {
          href: `/objects/${pin.object.id}`,
          primary: pin.object.name,
          secondary: pin.object.number,
          icon: <FileText className="h-4 w-4" />,
        };

  return (
    <div className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-bg-subtle">
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-bg-subtle text-fg-subtle">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{primary}</span>
          <span className="block truncate font-mono text-[11px] text-fg-muted">
            {secondary}
          </span>
        </span>
      </Link>
      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5',
          'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
        )}
      >
        <button
          type="button"
          aria-label="위로"
          disabled={isFirst}
          onClick={onMoveUp}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="아래로"
          disabled={isLast}
          onClick={onMoveDown}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="핀 해제"
          onClick={() => onRemove(pin.pinId)}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
