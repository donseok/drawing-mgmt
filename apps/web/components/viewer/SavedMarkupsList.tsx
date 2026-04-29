'use client';

/**
 * SavedMarkupsList — R-MARKUP (백로그 V-6).
 *
 * Lists the markups saved against the current attachment, split into two
 * sections — "내 마크업" (mine) and "팀 공유" (shared). Each row exposes a
 * "⋯" menu with: 불러오기 / 이름변경 / 공유토글 / 삭제. Shared rows owned by
 * other users only get 불러오기.
 *
 * Wiring:
 *  - List query: GET /api/v1/attachments/{id}/markups → { mine, shared }.
 *  - Load:   reads `payload` from the row (BE may include it on list, see
 *            note below) and pushes `payload.measurements` into the viewer
 *            store via `loadMeasurements`. When current measurements > 0 we
 *            confirm before overwriting.
 *  - Rename: PATCH /api/v1/markups/{id} { name }.
 *  - Toggle: PATCH /api/v1/markups/{id} { isShared }. Turning ON triggers a
 *            confirm (visibility implication); turning OFF is silent.
 *  - Delete: DELETE /api/v1/markups/{id} with confirm.
 *
 * Mode mismatch: a markup saved while viewing as 'pdf' uses page-space
 * coords (`pdf-page`), and a 'dxf' markup uses world coords (`dxf-world`).
 * Loading a mismatched markup would render measurements at wrong positions,
 * so we disable 불러오기 with a tooltip when row.mode !== current mode.
 *
 * Notes on payload:
 *   The contract §3 defines two row types — `MarkupRow` (no payload) for
 *   the list response, and `MarkupDetail` (with payload) for write
 *   responses. The list endpoint returns rows. To support 불러오기 in a
 *   single round-trip we treat `payload` on the row as optional and rely
 *   on BE including it in the list response (the row size is bounded by
 *   the contract's 256KB cap so this is safe). If a BE deployment ships
 *   list without payload, the load action surfaces a clear error toast
 *   pointing at the missing field — a contract-validation issue PM
 *   resolves rather than silent breakage.
 */

import * as React from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Eye,
  EyeOff,
  Loader2,
  MoreVertical,
  Pencil,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import type { Measurement } from '@/lib/viewer/types';
import { useViewerStoreApi, useViewerStore } from '@/lib/viewer/use-viewer-state';

// ── Types (mirror packages/shared/src/markup.ts; defined locally to avoid
//   coupling on BE merge order — structurally compatible with the BE schema
//   when both worktrees land) ─────────────────────────────────────────────

interface MarkupPayload {
  schemaVersion: 1;
  mode: 'pdf' | 'dxf';
  unitLabel: string;
  measurements: Measurement[];
}

interface MarkupRow {
  id: string;
  attachmentId: string;
  ownerId: string;
  ownerName: string;
  name: string;
  isShared: boolean;
  measurementCount: number;
  mode: 'pdf' | 'dxf';
  createdAt: string;
  updatedAt: string;
  /**
   * Optional. Present when BE ships payload on the list response (default
   * assumption for V1, see file header). When absent, 불러오기 surfaces a
   * clear error toast.
   */
  payload?: MarkupPayload;
}

interface MarkupListResponse {
  attachmentId: string;
  mine: MarkupRow[];
  shared: MarkupRow[];
}

interface MeResponse {
  id: string;
  role?: 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'PARTNER';
}

// ── Query keys ─────────────────────────────────────────────────────────────

const markupsKey = (attachmentId: string) =>
  ['markups', attachmentId] as const;

// ── Component ──────────────────────────────────────────────────────────────

export interface SavedMarkupsListProps {
  attachmentId: string;
  /** Current viewer mode — used to gate 불러오기 against mode mismatch. */
  mode: 'pdf' | 'dxf';
  /** Display unit suffix (informational; not used for load). */
  unitLabel: string;
}

export function SavedMarkupsList({
  attachmentId,
  mode,
}: SavedMarkupsListProps) {
  const queryClient = useQueryClient();
  const storeApi = useViewerStoreApi();
  const loadMeasurements = useViewerStore((s) => s.loadMeasurements);

  const meQuery = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/api/v1/me'),
    staleTime: 60_000,
  });

  const listQuery = useQuery<MarkupListResponse>({
    queryKey: markupsKey(attachmentId),
    queryFn: () =>
      api.get<MarkupListResponse>(
        `/api/v1/attachments/${encodeURIComponent(attachmentId)}/markups`,
      ),
    staleTime: 30_000,
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch<MarkupRow>(
        `/api/v1/markups/${encodeURIComponent(id)}`,
        { name },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: markupsKey(attachmentId) });
      toast.success('마크업 이름을 변경했습니다');
    },
    onError: (err) => surfaceError(err, '이름 변경에 실패했습니다'),
  });

  const shareMutation = useMutation({
    mutationFn: ({ id, isShared }: { id: string; isShared: boolean }) =>
      api.patch<MarkupRow>(
        `/api/v1/markups/${encodeURIComponent(id)}`,
        { isShared },
      ),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: markupsKey(attachmentId) });
      toast.success(vars.isShared ? '팀과 공유했습니다' : '공유를 해제했습니다');
    },
    onError: (err) => surfaceError(err, '공유 설정 변경에 실패했습니다'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete<{ deleted: boolean }>(
        `/api/v1/markups/${encodeURIComponent(id)}`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: markupsKey(attachmentId) });
      toast.success('마크업을 삭제했습니다');
    },
    onError: (err) => surfaceError(err, '마크업 삭제에 실패했습니다'),
  });

  // ── Action handlers ──────────────────────────────────────────────────────

  const meId = meQuery.data?.id ?? null;
  const isAdmin =
    meQuery.data?.role === 'ADMIN' || meQuery.data?.role === 'SUPER_ADMIN';

  /**
   * Read payload from the row. When BE didn't include it, surface a clear
   * error pointing at the contract drift instead of failing silently.
   */
  function readPayloadOrError(row: MarkupRow): MarkupPayload | null {
    if (row.payload) return row.payload;
    toast.error('마크업을 불러오지 못했습니다', {
      description:
        '서버 응답에 payload가 없습니다. 페이지를 새로고침해주세요.',
    });
    return null;
  }

  function handleLoad(row: MarkupRow) {
    if (row.mode !== mode) {
      toast.warning('다른 모드의 마크업입니다', {
        description: `${row.mode === 'pdf' ? 'PDF' : 'DXF'} 모드로 전환 후 다시 시도해주세요.`,
      });
      return;
    }
    const payload = readPayloadOrError(row);
    if (!payload) return;

    const current = storeApi.getState().measurements.length;
    const incoming = payload.measurements.length;

    const proceed = () => {
      loadMeasurements(payload.measurements);
      toast.success(`마크업을 불러왔습니다 (측정 ${incoming}건)`);
    };

    if (current > 0) {
      const ok = window.confirm(
        `현재 측정 ${current}건을 덮어씁니다. 계속할까요?`,
      );
      if (!ok) return;
    }
    proceed();
  }

  function handleRename(row: MarkupRow) {
    const next = window.prompt('새 이름을 입력하세요', row.name);
    if (next == null) return;
    const trimmed = next.trim();
    if (trimmed.length === 0) {
      toast.warning('이름을 입력해주세요');
      return;
    }
    if (trimmed.length > 200) {
      toast.warning('이름은 200자 이하여야 합니다');
      return;
    }
    if (trimmed === row.name) return;
    renameMutation.mutate({ id: row.id, name: trimmed });
  }

  function handleToggleShare(row: MarkupRow) {
    const next = !row.isShared;
    if (next) {
      const ok = window.confirm(
        '팀과 공유하시겠어요? 첨부에 권한이 있는 모두가 이 마크업을 볼 수 있습니다.',
      );
      if (!ok) return;
    }
    shareMutation.mutate({ id: row.id, isShared: next });
  }

  function handleDelete(row: MarkupRow) {
    const ok = window.confirm(`마크업 "${row.name}"을(를) 삭제할까요?`);
    if (!ok) return;
    deleteMutation.mutate(row.id);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (listQuery.isLoading) {
    return (
      <SectionShell title="저장된 마크업">
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-fg-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          불러오는 중…
        </div>
      </SectionShell>
    );
  }

  if (listQuery.isError) {
    const msg =
      listQuery.error instanceof ApiError
        ? listQuery.error.message
        : '마크업 목록을 불러오지 못했습니다';
    return (
      <SectionShell title="저장된 마크업">
        <div className="space-y-2 px-3 py-3 text-xs">
          <p className="text-danger">{msg}</p>
          <button
            type="button"
            onClick={() => listQuery.refetch()}
            className="app-action-button h-7 text-xs"
          >
            다시 시도
          </button>
        </div>
      </SectionShell>
    );
  }

  const data = listQuery.data!;
  const isEmpty = data.mine.length === 0 && data.shared.length === 0;

  if (isEmpty) {
    return (
      <SectionShell title="저장된 마크업">
        <p className="px-3 py-3 text-xs text-fg-muted">
          저장된 마크업이 없습니다.
        </p>
      </SectionShell>
    );
  }

  // Whether a write action on this row is in flight — disables menu items.
  const writePending =
    renameMutation.isPending ||
    shareMutation.isPending ||
    deleteMutation.isPending;

  return (
    <SectionShell title="저장된 마크업">
      <RowGroup
        label="내 마크업"
        emptyHint="아직 저장한 마크업이 없습니다."
        rows={data.mine}
        currentMode={mode}
        meId={meId}
        isAdmin={isAdmin}
        writePending={writePending}
        onLoad={handleLoad}
        onRename={handleRename}
        onToggleShare={handleToggleShare}
        onDelete={handleDelete}
      />
      <RowGroup
        label="팀 공유"
        emptyHint="공유된 마크업이 없습니다."
        rows={data.shared}
        currentMode={mode}
        meId={meId}
        isAdmin={isAdmin}
        writePending={writePending}
        onLoad={handleLoad}
        onRename={handleRename}
        onToggleShare={handleToggleShare}
        onDelete={handleDelete}
      />
    </SectionShell>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function SectionShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border" aria-label={title}>
      <h3 className="border-b border-border bg-bg px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

function RowGroup({
  label,
  emptyHint,
  rows,
  currentMode,
  meId,
  isAdmin,
  writePending,
  onLoad,
  onRename,
  onToggleShare,
  onDelete,
}: {
  label: string;
  emptyHint: string;
  rows: MarkupRow[];
  currentMode: 'pdf' | 'dxf';
  meId: string | null;
  isAdmin: boolean;
  writePending: boolean;
  onLoad: (row: MarkupRow) => void;
  onRename: (row: MarkupRow) => void;
  onToggleShare: (row: MarkupRow) => void;
  onDelete: (row: MarkupRow) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between border-b border-border bg-bg-subtle px-3 py-1">
        <span className="text-[11px] text-fg-muted">{label}</span>
        <span className="text-[11px] text-fg-subtle">{rows.length}건</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-[11px] text-fg-subtle">{emptyHint}</p>
      ) : (
        <ul className="divide-y divide-border" role="list">
          {rows.map((row) => (
            <MarkupRowItem
              key={row.id}
              row={row}
              currentMode={currentMode}
              meId={meId}
              isAdmin={isAdmin}
              writePending={writePending}
              onLoad={onLoad}
              onRename={onRename}
              onToggleShare={onToggleShare}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MarkupRowItem({
  row,
  currentMode,
  meId,
  isAdmin,
  writePending,
  onLoad,
  onRename,
  onToggleShare,
  onDelete,
}: {
  row: MarkupRow;
  currentMode: 'pdf' | 'dxf';
  meId: string | null;
  isAdmin: boolean;
  writePending: boolean;
  onLoad: (row: MarkupRow) => void;
  onRename: (row: MarkupRow) => void;
  onToggleShare: (row: MarkupRow) => void;
  onDelete: (row: MarkupRow) => void;
}) {
  // Owner-or-admin rules — mirror the BE permission matrix (contract §7).
  const isOwner = !!meId && row.ownerId === meId;
  const canMutate = isOwner || isAdmin;
  const modeMismatch = row.mode !== currentMode;
  // Load is gated on (a) matching mode and (b) presence of payload (checked
  // at click time inside onLoad — not statically — so the menu item itself
  // stays clickable to surface the missing-payload toast).
  const loadDisabled = modeMismatch;

  return (
    <li className="flex items-start justify-between gap-2 px-3 py-2 text-xs">
      <button
        type="button"
        onClick={() => (loadDisabled ? null : onLoad(row))}
        disabled={loadDisabled}
        className={cn(
          'group min-w-0 flex-1 rounded text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          loadDisabled
            ? 'cursor-not-allowed opacity-60'
            : 'hover:bg-bg-muted',
        )}
        title={
          loadDisabled
            ? '다른 모드의 마크업입니다 (저장 당시: ' +
              (row.mode === 'pdf' ? 'PDF' : 'DXF') +
              ')'
            : '클릭하여 불러오기'
        }
      >
        <div className="flex items-center gap-1">
          <span className="truncate font-medium text-fg">{row.name}</span>
          {row.isShared ? (
            <Share2
              className="h-3 w-3 shrink-0 text-info"
              aria-label="공유됨"
            />
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-muted">
          <span>측정 {row.measurementCount}건</span>
          <span aria-hidden>·</span>
          <span title={row.updatedAt}>{formatRelative(row.updatedAt)}</span>
        </div>
        {!isOwner ? (
          <div className="mt-0.5 truncate text-[11px] text-fg-subtle">
            {row.ownerName}
          </div>
        ) : null}
        {modeMismatch ? (
          <div className="mt-0.5 text-[11px] text-warning">
            {row.mode === 'pdf' ? 'PDF' : 'DXF'} 모드 마크업
          </div>
        ) : null}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="마크업 메뉴"
            className="app-icon-button h-7 w-7 shrink-0"
            disabled={writePending}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="min-w-[10rem]">
          <DropdownMenuItem
            disabled={loadDisabled}
            onSelect={() => onLoad(row)}
          >
            <Upload className="text-fg-muted" />
            불러오기
          </DropdownMenuItem>

          {canMutate ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onRename(row)}>
                <Pencil className="text-fg-muted" />
                이름 변경
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onToggleShare(row)}>
                {row.isShared ? (
                  <EyeOff className="text-fg-muted" />
                ) : (
                  <Eye className="text-fg-muted" />
                )}
                {row.isShared ? '공유 해제' : '팀과 공유'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onSelect={() => onDelete(row)}
              >
                <Trash2 />
                삭제
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function surfaceError(err: unknown, fallback: string) {
  const msg =
    err instanceof ApiError
      ? err.message
      : err instanceof Error
        ? err.message
        : fallback;
  toast.error(fallback, { description: msg });
}

/**
 * Lightweight relative-time formatter. We avoid pulling in date-fns/dayjs
 * for a single string in the sidebar — the resolution we want (분/시간/일)
 * is small and the cost of a dependency outweighs the polish.
 */
function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return '방금 전';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}일 전`;
  const date = new Date(t);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
