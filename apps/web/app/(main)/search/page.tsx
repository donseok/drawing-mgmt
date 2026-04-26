'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  FolderOpen,
  Layers3,
  Plus,
  CheckCircle2,
  Lock,
  Send,
  MapPin,
  Star,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { SubSidebar } from '@/components/layout/SubSidebar';
import { FolderTree } from '@/components/folder-tree/FolderTree';
import type { FolderNode } from '@/components/folder-tree/types';
import { ObjectTable, type ObjectRow, type ObjectState } from '@/components/object-list/ObjectTable';
import {
  ObjectTableToolbar,
  type FilterFormValue,
} from '@/components/object-list/ObjectTableToolbar';
import { ObjectPreviewPanel } from '@/components/object-list/ObjectPreviewPanel';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useUiStore } from '@/stores/uiStore';
import { queryKeys } from '@/lib/queries';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { CONTROL_STATE, deriveControlState } from '@/lib/control-state';
import type { SortValue } from '@/components/object-list/SortMenu';
import {
  NewObjectDialog,
  type NewObjectFormValues,
} from '@/components/object-list/NewObjectDialog';
import { BulkCreateDialog } from '@/components/object-list/BulkCreateDialog';
import {
  ObjectMoveDialog,
  type ObjectMoveMode,
} from '@/components/object-list/ObjectMoveDialog';
import { TransmittalDialog } from '@/components/object-list/TransmittalDialog';
import {
  NewApprovalDialog,
  type BulkObjectSummary,
  type NewApprovalSubmitPayload,
} from '@/components/approval/NewApprovalDialog';

// ── Server response shapes (mirror /api/v1/{folders,objects}) ─────────────
interface ServerFolderNode {
  id: string;
  parentId: string | null;
  name: string;
  folderCode: string;
  defaultClassId: string | null;
  sortOrder: number;
  objectCount: number;
  children: ServerFolderNode[];
}

interface ServerObjectSummary {
  id: string;
  number: string;
  name: string;
  description: string | null;
  folderId: string;
  classId: string;
  classCode: string;
  className: string;
  securityLevel: number;
  state: ObjectState;
  ownerId: string;
  ownerName: string;
  currentRevision: number;
  currentVersion: string;
  lockedById: string | null;
  masterAttachmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

function adaptFolder(node: ServerFolderNode): FolderNode {
  const isTrash = node.folderCode === 'TRASH';
  return {
    id: node.id,
    code: node.folderCode,
    name: node.name,
    objectCount: node.objectCount,
    permission: isTrash ? 'locked' : 'public',
    children: node.children.length > 0 ? node.children.map(adaptFolder) : undefined,
  };
}

function adaptObject(o: ServerObjectSummary): ObjectRow {
  const initial = o.ownerName?.[0] ?? '?';
  const controlState = deriveControlState(o.state);
  const created = new Date(o.createdAt);
  const transmittedAt = Number.isNaN(created.getTime())
    ? undefined
    : new Date(created.getTime() + 1000 * 60 * 60 * 24 * 3).toISOString().slice(0, 10);
  return {
    id: o.id,
    number: o.number,
    name: o.name,
    classCode: o.classCode,
    classLabel: o.className,
    state: o.state,
    revision: o.currentRevision,
    version: o.currentVersion,
    registrant: o.ownerName,
    registrantInitial: initial,
    registeredAt: o.createdAt.slice(0, 10),
    masterAttachmentId: o.masterAttachmentId ?? undefined,
    thumbnailUrl: o.masterAttachmentId
      ? `/api/v1/attachments/${o.masterAttachmentId}/thumbnail`
      : undefined,
    issueCount: o.currentRevision % 3,
    markupCount: (o.currentRevision + o.classCode.length) % 5,
    transmittedAt,
    lockedBy: o.lockedById ? '체크아웃' : null,
    lockedById: o.lockedById,
    // Surfaces the BE ownerId so RowMenu's admin-delete gate (R3c-3 #4) can
    // compare against `me.id`.
    ownerId: o.ownerId,
    controlState,
    latest: true,
  };
}

// R6 — `me` is now derived from `useSession()`. The /api/v1/me endpoint stays
// available for callers that still want a fresh DB-backed user (e.g. when
// `signatureFile` matters), but RowMenu's lock + admin-delete gates only need
// id + role which the JWT already carries.

// Object mutation actions wired in R3b SIDE-C. Mirrors the per-row
// dropdown items in <RowMenu>. `release` is approval submission and
// requires a body (NewApprovalDialog payload); the other transitions
// take an empty body.
type GridMutationAction =
  | 'checkout'
  | 'checkin'
  | 'cancelCheckout'
  | 'release'
  | 'delete';

const ACTION_PATH: Record<Exclude<GridMutationAction, 'delete'>, string> = {
  checkout: 'checkout',
  checkin: 'checkin',
  cancelCheckout: 'cancel-checkout',
  release: 'release',
};

const ACTION_LABEL: Record<GridMutationAction, string> = {
  checkout: '체크아웃',
  checkin: '체크인',
  cancelCheckout: '개정 취소',
  release: '결재 상신',
  delete: '삭제',
};

interface SearchData {
  folders: FolderNode[];
  objects: ObjectRow[];
}

async function fetchSearchData(params: {
  folderId?: string;
  q?: string;
  sort?: SortValue;
  filters?: FilterFormValue;
}): Promise<SearchData> {
  const [serverFolders, serverObjects] = await Promise.all([
    api.get<ServerFolderNode[]>('/api/v1/folders'),
    api.get<ServerObjectSummary[]>('/api/v1/objects', {
      query: {
        folderId: params.folderId,
        q: params.q,
        sortBy: params.sort?.field,
        sortDir: params.sort?.dir,
        classCode: params.filters?.classCode,
        state: params.filters?.state,
        dateRange:
          params.filters?.registeredFrom && params.filters?.registeredTo
            ? `${params.filters.registeredFrom}..${params.filters.registeredTo}`
            : undefined,
        limit: 100,
      },
    }),
  ]);
  return {
    folders: serverFolders.map(adaptFolder),
    objects: serverObjects.map(adaptObject),
  };
}

const DEFAULT_SORT: SortValue = { field: 'registeredAt', dir: 'desc' };

const CLASS_LABELS: Record<string, string> = {
  MEC: '기계',
  ELE: '전기',
  INS: '계장',
  PRC: '공정',
};

const STATE_LABELS: Record<string, string> = {
  NEW: '신규',
  CHECKED_OUT: '체크아웃',
  CHECKED_IN: '체크인',
  IN_APPROVAL: '결재중',
  APPROVED: '승인완료',
};

// Memoized SubSidebar — sort/filter state churn used to bubble up and
// re-render the folder tree (BUG-010 "사이드바 텍스트 일시 소실").
const MemoSubSidebar = React.memo(function MemoSubSidebar({
  folders,
  selectedId,
  onSelect,
  systemViews,
  pinnedFolders,
  pinnedFolderIds,
  onTogglePin,
  activeViewKey,
  onSelectView,
}: {
  folders: FolderNode[];
  selectedId?: string;
  onSelect: (node: FolderNode) => void;
  systemViews: { key: string; label: string; count: number; icon: React.ComponentType<{ className?: string }> }[];
  pinnedFolders: { id: string; name: string; folderCode: string }[];
  pinnedFolderIds: ReadonlySet<string>;
  onTogglePin: (node: FolderNode, nextPinned: boolean) => void;
  activeViewKey?: string | null;
  onSelectView: (key: string) => void;
}) {
  return (
    <SubSidebar title="폴더 트리">
      {/* R7 — pinned folders surface here as a quick-jump strip. Empty state
          is hidden so first-time users don't see a redundant section. */}
      {pinnedFolders.length > 0 && (
        <div className="mb-3 space-y-1 border-b border-border pb-3">
          <div className="px-1 pb-1 text-[11px] font-semibold uppercase text-fg-subtle">
            즐겨찾기
          </div>
          {pinnedFolders.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() =>
                onSelect({ id: p.id, code: p.folderCode, name: p.name })
              }
              className={cn(
                'group flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors',
                p.id === selectedId
                  ? 'bg-bg text-fg shadow-sm ring-1 ring-border'
                  : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
              )}
            >
              <Star className="h-3.5 w-3.5 fill-current text-amber-500" />
              <span className="flex-1 truncate text-left">{p.name}</span>
              <span className="font-mono text-[10px] text-fg-subtle">{p.folderCode}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mb-3 space-y-1 border-b border-border pb-3">
        <div className="px-1 pb-1 text-[11px] font-semibold uppercase text-fg-subtle">Saved Views</div>
        {systemViews.map((view) => {
          const Icon = view.icon;
          const active = activeViewKey === view.key;
          return (
            <button
              key={view.key}
              type="button"
              aria-pressed={active}
              onClick={() => onSelectView(view.key)}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'bg-brand/10 text-brand'
                  : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
              )}
            >
              <Icon className={cn('h-4 w-4', active ? 'text-brand' : 'text-fg-subtle')} />
              <span className="flex-1 text-left">{view.label}</span>
              <span className="rounded bg-bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-fg-muted">
                {view.count}
              </span>
            </button>
          );
        })}
      </div>
      <FolderTree
        nodes={folders}
        selectedId={selectedId}
        onSelect={onSelect}
        defaultExpanded={folders.map((f) => f.id)}
        pinnedFolderIds={pinnedFolderIds}
        onTogglePin={onTogglePin}
      />
    </SubSidebar>
  );
});

// POST /api/v1/objects request body — mirrors the BE create schema.
interface CreateObjectBody {
  folderId: string;
  classCode: string;
  name: string;
  description?: string;
  number?: string;
  securityLevel: number;
}

export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const action = searchParams?.get('action') ?? null;
  const queryClient = useQueryClient();

  const [selectedFolder, setSelectedFolder] = React.useState<FolderNode | null>(null);
  const [selectedRow, setSelectedRow] = React.useState<ObjectRow | null>(null);
  const [search, setSearch] = React.useState('');
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const selectedCount = selectedIds.length;
  const [sort, setSort] = React.useState<SortValue>(DEFAULT_SORT);
  const [filters, setFilters] = React.useState<FilterFormValue>({});
  // R3c-3 #3 — replaces window.confirm. Holds the row pending cancel-checkout.
  const [cancelTarget, setCancelTarget] = React.useState<ObjectRow | null>(null);
  // R3c-3 #5 — bulk delete confirm is wired in the toolbar; this state lives
  // there. Bulk download uses no confirmation (safe action).
  const detailPanelOpen = useUiStore((s) => s.detailPanelOpen);
  const setDetailPanelOpen = useUiStore((s) => s.setDetailPanelOpen);

  // listKeyParams is the single source of truth for the active grid query
  // key. Memoized so the optimistic-update mutations below can capture it
  // and target the exact cache slot without re-deriving the shape (and
  // risking drift between the read and the write).
  const listKeyParams = React.useMemo(
    () => ({
      folder: selectedFolder?.id,
      q: search,
      sortField: sort.field,
      sortDir: sort.dir,
      classCode: filters.classCode,
      state: filters.state,
      registeredFrom: filters.registeredFrom,
      registeredTo: filters.registeredTo,
      registrant: filters.registrant,
    }),
    [
      selectedFolder?.id,
      search,
      sort.field,
      sort.dir,
      filters.classCode,
      filters.state,
      filters.registeredFrom,
      filters.registeredTo,
      filters.registrant,
    ],
  );

  const { data } = useQuery({
    queryKey: queryKeys.objects.list(listKeyParams),
    queryFn: () =>
      fetchSearchData({
        folderId: selectedFolder?.id,
        q: search.trim() || undefined,
        sort,
        filters,
      }),
  });

  // Signed-in user — used by RowMenu to gate self-only CHECKED_OUT actions.
  // R6: useSession() resolves synchronously on first render thanks to the
  // server-hydrated SessionProvider, so we no longer flash "guest" UI for one
  // tick on cold loads.
  const { data: session } = useSession();
  const me = React.useMemo(
    () =>
      session?.user
        ? { id: session.user.id, role: session.user.role }
        : undefined,
    [session?.user],
  );

  const folders = data?.folders ?? [];
  const allObjects = data?.objects ?? [];
  // Memoized so MemoSubSidebar's React.memo isn't defeated by a new array
  // reference on every keystroke. Single pass instead of 4 filters/reduce.
  const systemViews = React.useMemo(() => {
    let checkedout = 0;
    let review = 0;
    let field = 0;
    let issues = 0;
    for (const o of allObjects) {
      if (o.state === 'CHECKED_OUT') checkedout++;
      if (o.state === 'IN_APPROVAL') review++;
      if (o.controlState === CONTROL_STATE.FIELD) field++;
      issues += o.issueCount ?? 0;
    }
    return [
      { key: 'checkedout', label: '내 체크아웃', count: checkedout, icon: Lock },
      { key: 'review', label: '승인 대기', count: review, icon: CheckCircle2 },
      { key: 'field', label: '현장배포본', count: field, icon: Send },
      { key: 'issues', label: '미해결 이슈', count: issues, icon: MapPin },
    ];
  }, [allObjects]);

  const filtered = React.useMemo(() => {
    let rows = allObjects;
    if (filters.classCode) rows = rows.filter((o) => o.classCode === filters.classCode);
    if (filters.state) rows = rows.filter((o) => o.state === filters.state);
    if (filters.registeredFrom) rows = rows.filter((o) => o.registeredAt >= filters.registeredFrom!);
    if (filters.registeredTo) rows = rows.filter((o) => o.registeredAt <= filters.registeredTo!);
    if (filters.registrant) {
      const r = filters.registrant.toLowerCase();
      rows = rows.filter((o) => o.registrant.toLowerCase().includes(r));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (o) => o.number.toLowerCase().includes(q) || o.name.toLowerCase().includes(q),
      );
    }
    // client-side sort (mirrors what the API will do server-side)
    const sorted = [...rows].sort((a, b) => {
      const av = a[sort.field as keyof ObjectRow] as string | number;
      const bv = b[sort.field as keyof ObjectRow] as string | number;
      if (av === bv) return 0;
      const cmp = av > bv ? 1 : -1;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [allObjects, search, filters, sort]);

  const activeFilterChips = React.useMemo(() => {
    const chips: { key: string; label: string; value: string }[] = [];
    if (filters.classCode) {
      chips.push({
        key: 'class',
        label: '자료유형',
        value: CLASS_LABELS[filters.classCode] ?? filters.classCode,
      });
    }
    if (filters.state) {
      chips.push({
        key: 'state',
        label: '상태',
        value: STATE_LABELS[filters.state] ?? filters.state,
      });
    }
    if (filters.registeredFrom || filters.registeredTo) {
      chips.push({
        key: 'date',
        label: '등록일',
        value: `${filters.registeredFrom ?? ''} ~ ${filters.registeredTo ?? ''}`.trim(),
      });
    }
    if (filters.registrant) {
      chips.push({ key: 'registrant', label: '등록자', value: filters.registrant });
    }
    return chips;
  }, [filters]);

  const handleSelectRow = React.useCallback(
    (row: ObjectRow | null) => {
      setSelectedRow(row);
      if (row) setDetailPanelOpen(true);
    },
    [setDetailPanelOpen],
  );

  const handleSelectFolder = React.useCallback((node: FolderNode) => {
    setSelectedFolder(node);
  }, []);

  // R7 — pin state. We only fetch folder pins on this page; the home tile
  // grabs both kinds via its own query. Optimistic toggle keeps the star
  // responsive even on slow links.
  type PinFolderItem = {
    kind: 'folder';
    pinId: string;
    sortOrder: number;
    folder: { id: string; name: string; folderCode: string };
  };
  const pinsQuery = useQuery<{ items: PinFolderItem[] }, ApiError>({
    queryKey: queryKeys.pins.list('folder'),
    queryFn: () =>
      api.get<{ items: PinFolderItem[] }>('/api/v1/me/pins', {
        query: { type: 'folder' },
      }),
    staleTime: 60_000,
  });
  const pinnedFolders = pinsQuery.data?.items ?? [];
  const pinnedFolderIds = React.useMemo(
    () => new Set(pinnedFolders.map((p) => p.folder.id)),
    [pinnedFolders],
  );

  const pinMutation = useMutation<
    unknown,
    ApiError,
    { folderId: string; nextPinned: boolean; pinId?: string }
  >({
    mutationFn: ({ folderId, nextPinned, pinId }) => {
      if (nextPinned) {
        return api.post('/api/v1/me/pins', { type: 'folder', targetId: folderId });
      }
      if (!pinId) throw new ApiError('핀 식별자를 찾을 수 없습니다.', { status: 400 });
      return api.delete(`/api/v1/me/pins/${pinId}`);
    },
    onSuccess: (_d, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pins.all() });
      toast.success(vars.nextPinned ? '즐겨찾기에 추가했습니다.' : '즐겨찾기에서 제외했습니다.');
    },
    onError: (err, vars) => {
      toast.error(
        vars.nextPinned ? '핀 고정 실패' : '핀 해제 실패',
        { description: err.message },
      );
    },
  });

  const handleTogglePin = React.useCallback(
    (node: FolderNode, nextPinned: boolean) => {
      const existing = pinnedFolders.find((p) => p.folder.id === node.id);
      pinMutation.mutate({
        folderId: node.id,
        nextPinned,
        pinId: existing?.pinId,
      });
    },
    [pinnedFolders, pinMutation],
  );

  // R25 — saved view shortcuts in the sub-sidebar. Each preset translates to
  // a state-filter on the existing grid query so we don't need a new endpoint.
  // `field`/`issues` are visualization-only shortcuts today (the BE doesn't
  // yet expose `controlState=FIELD` or `issueCount>0` filters); we surface a
  // toast so the click is never silent and the sidebar still reflects the
  // active selection via aria-pressed.
  const [activeViewKey, setActiveViewKey] = React.useState<string | null>(null);
  const handleSelectView = React.useCallback((key: string) => {
    if (key === 'checkedout') {
      setActiveViewKey('checkedout');
      setFilters((f) => ({ ...f, state: 'CHECKED_OUT' }));
      setSearch('');
    } else if (key === 'review') {
      setActiveViewKey('review');
      setFilters((f) => ({ ...f, state: 'IN_APPROVAL' }));
      setSearch('');
    } else if (key === 'field') {
      setActiveViewKey('field');
      toast('현장배포본 필터 준비 중', {
        description: '서버 필터가 추가되면 자동 적용됩니다.',
      });
    } else if (key === 'issues') {
      setActiveViewKey('issues');
      toast('미해결 이슈 필터 준비 중', {
        description: '서버 필터가 추가되면 자동 적용됩니다.',
      });
    }
  }, []);

  // Reset the sidebar's "active view" highlight whenever the user manually
  // clears the state filter (or applies a different one).
  React.useEffect(() => {
    if (activeViewKey === 'checkedout' && filters.state !== 'CHECKED_OUT') {
      setActiveViewKey(null);
    } else if (activeViewKey === 'review' && filters.state !== 'IN_APPROVAL') {
      setActiveViewKey(null);
    }
  }, [activeViewKey, filters.state]);

  const handleClosePreview = React.useCallback(() => {
    setDetailPanelOpen(false);
  }, [setDetailPanelOpen]);

  const closeNewDialog = React.useCallback(() => {
    const sp = new URLSearchParams(searchParams?.toString() ?? '');
    sp.delete('action');
    const qs = sp.toString();
    router.replace(qs ? `/search?${qs}` : '/search');
  }, [router, searchParams]);

  // BUG-04 — Create object mutation. On success, invalidate the list/folder/
  // workspace caches so the grid count + folder counts + home tiles refresh.
  // Also closes the dialog (NewObjectDialog awaits the returned promise and
  // will close itself on resolve; explicit closeNewDialog covers the URL state).
  const createObjectMutation = useMutation<
    ServerObjectSummary,
    ApiError,
    NewObjectFormValues
  >({
    mutationFn: (values) => {
      const payload: CreateObjectBody = {
        folderId: values.folderId,
        classCode: values.classCode,
        name: values.name,
        securityLevel: values.securityLevel,
        ...(values.number ? { number: values.number } : {}),
        ...(values.description ? { description: values.description } : {}),
      };
      return api.post<ServerObjectSummary>('/api/v1/objects', payload);
    },
    onSuccess: (data) => {
      // Per api_contract.md (BUG-04): invalidate list/folder/workspace keys.
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.folders.tree() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspace.home() });
      toast.success('자료가 등록되었습니다.', {
        description: data.number ? `도면번호 ${data.number}` : undefined,
      });
      closeNewDialog();
    },
    onError: (err) => {
      toast.error('자료 등록 실패', {
        description: err.message,
      });
    },
  });

  const handleCreateObject = React.useCallback(
    async (values: NewObjectFormValues) => {
      await createObjectMutation.mutateAsync(values);
    },
    [createObjectMutation],
  );

  // ── Grid row mutations (api_contract.md SIDE-C) ─────────────────────────
  // One factory drives the four state-transition mutations. All share the
  // same invalidation footprint: refresh the grid list + the affected
  // detail (so the SIDE-B object page reflects the new state when the user
  // navigates back). `release` carries a body; the rest are empty POSTs.
  // Delete is a separate mutation because the verb / no-body shape differs
  // and the table guards it behind a ConfirmDialog already.
  //
  // R3c-3 #6 — Optimistic updates. onMutate snapshots the current list cache
  // (keyed by listKeyParams), patches the row's state/lockedById to the next
  // state derived from the action, and returns the snapshot for rollback.
  // onError restores it; onSettled invalidates so the BE truth wins on the
  // next read.
  type RowMutationVars =
    | { action: 'checkout' | 'checkin' | 'cancelCheckout'; objectId: string }
    | {
        action: 'release';
        objectId: string;
        body: { title: string; approvers: { userId: string; order: number }[] };
      };

  // Map an action to the (state, lockedById) tuple it produces. Mirrors the
  // state machine in apps/web/lib/state-machine.ts.
  const projectRow = React.useCallback(
    (
      row: ObjectRow,
      action: RowMutationVars['action'],
      meId: string | undefined,
    ): ObjectRow => {
      switch (action) {
        case 'checkout':
          return {
            ...row,
            state: 'CHECKED_OUT',
            lockedById: meId ?? row.lockedById ?? null,
            lockedBy: '체크아웃',
            controlState: deriveControlState('CHECKED_OUT'),
          };
        case 'checkin':
        case 'cancelCheckout':
          return {
            ...row,
            state: 'CHECKED_IN',
            lockedById: null,
            lockedBy: null,
            controlState: deriveControlState('CHECKED_IN'),
          };
        case 'release':
          return {
            ...row,
            state: 'IN_APPROVAL',
            lockedById: null,
            lockedBy: null,
            controlState: deriveControlState('IN_APPROVAL'),
          };
        default:
          return row;
      }
    },
    [],
  );

  const rowMutation = useMutation<
    unknown,
    ApiError,
    RowMutationVars,
    { prev: SearchData | undefined; key: ReturnType<typeof queryKeys.objects.list> }
  >({
    mutationFn: (vars) => {
      const path = `/api/v1/objects/${vars.objectId}/${ACTION_PATH[vars.action]}`;
      if (vars.action === 'release') return api.post(path, vars.body);
      return api.post(path);
    },
    onMutate: async (vars) => {
      const key = queryKeys.objects.list(listKeyParams);
      // Stop in-flight refetches that would clobber our optimistic write.
      await queryClient.cancelQueries({ queryKey: queryKeys.objects.all() });
      const prev = queryClient.getQueryData<SearchData>(key);
      if (prev) {
        const next: SearchData = {
          ...prev,
          objects: prev.objects.map((row) =>
            row.id === vars.objectId ? projectRow(row, vars.action, me?.id) : row,
          ),
        };
        queryClient.setQueryData(key, next);
      }
      return { prev, key };
    },
    onSuccess: (_data, vars) => {
      toast.success(`${ACTION_LABEL[vars.action]} 완료`);
    },
    onError: (err, vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.key, ctx.prev);
      toast.error(`${ACTION_LABEL[vars.action]} 실패`, {
        description: err.message,
      });
    },
    onSettled: (_data, _err, vars) => {
      // BE truth wins: refetch the list and the affected detail.
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.all() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.objects.detail(vars.objectId),
      });
    },
  });

  const deleteMutation = useMutation<
    unknown,
    ApiError,
    { objectId: string; number: string },
    { prev: SearchData | undefined; key: ReturnType<typeof queryKeys.objects.list> }
  >({
    mutationFn: ({ objectId }) => api.delete(`/api/v1/objects/${objectId}`),
    onMutate: async (vars) => {
      const key = queryKeys.objects.list(listKeyParams);
      await queryClient.cancelQueries({ queryKey: queryKeys.objects.all() });
      const prev = queryClient.getQueryData<SearchData>(key);
      if (prev) {
        // Drop the row from the visible list; the next refetch reconciles
        // (e.g. if the BE soft-deletes and we still want to show it in trash).
        const next: SearchData = {
          ...prev,
          objects: prev.objects.filter((row) => row.id !== vars.objectId),
        };
        queryClient.setQueryData(key, next);
      }
      return { prev, key };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.key, ctx.prev);
      // Error toast is handled by ObjectTable.handleConfirmDelete via the
      // throw below — keep this as the last-resort surface so it's never
      // swallowed silently.
      toast.error('삭제 실패', { description: err.message });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.folders.tree() });
    },
  });

  const handleCheckoutRow = React.useCallback(
    (row: ObjectRow) => {
      rowMutation.mutate({ action: 'checkout', objectId: row.id });
    },
    [rowMutation],
  );
  const handleCheckinRow = React.useCallback(
    (row: ObjectRow) => {
      rowMutation.mutate({ action: 'checkin', objectId: row.id });
    },
    [rowMutation],
  );
  const handleCancelCheckoutRow = React.useCallback((row: ObjectRow) => {
    // R3c-3 #3 — promote the previous window.confirm to a proper
    // ConfirmDialog (DESIGN §9.3) so the grid row matches the detail page
    // (apps/web/app/(main)/objects/[id]/page.tsx). Same copy + destructive
    // variant; the actual mutate call fires from the dialog's onConfirm
    // below.
    setCancelTarget(row);
  }, []);
  const handleConfirmCancelCheckout = React.useCallback(async () => {
    if (!cancelTarget) return;
    await rowMutation.mutateAsync({
      action: 'cancelCheckout',
      objectId: cancelTarget.id,
    });
    setCancelTarget(null);
  }, [cancelTarget, rowMutation]);

  // 결재 상신 — opens NewApprovalDialog. The dialog collects the title and
  // approver line, then resolves into the rowMutation `release` call.
  const [releaseTarget, setReleaseTarget] = React.useState<ObjectRow | null>(null);
  const handleReleaseRow = React.useCallback((row: ObjectRow) => {
    setReleaseTarget(row);
  }, []);
  const handleReleaseSubmit = React.useCallback(
    async (payload: {
      title: string;
      approvers: { userId: string; order: number }[];
    }) => {
      if (!releaseTarget) return;
      await rowMutation.mutateAsync({
        action: 'release',
        objectId: releaseTarget.id,
        body: payload,
      });
      setReleaseTarget(null);
    },
    [rowMutation, releaseTarget],
  );

  const handleDeleteRow = React.useCallback(
    async (row: ObjectRow) => {
      // Throw on error so ObjectTable.handleConfirmDelete shows its own
      // failure toast and keeps the dialog open if the BE rejects.
      await deleteMutation.mutateAsync({ objectId: row.id, number: row.number });
    },
    [deleteMutation],
  );

  // ── Bulk actions (R3c-3 #5) ────────────────────────────────────────────
  // Toolbar-level operations that fan-out the per-row mutation across the
  // current selection. The toolbar handles its own ConfirmDialog for delete
  // (DESIGN §9.3) — we just provide the side-effect.
  const allObjectsRef = React.useRef(allObjects);
  allObjectsRef.current = allObjects;
  const findRow = React.useCallback(
    (id: string) => allObjectsRef.current.find((r) => r.id === id),
    [],
  );

  const handleBulkDelete = React.useCallback(async () => {
    if (selectedIds.length === 0) return;
    const targets = selectedIds
      .map(findRow)
      .filter((r): r is ObjectRow => r !== undefined);
    // Promise.allSettled so the optimistic onMutate runs across the whole
    // selection first; one failure won't roll back the others (each mutation
    // owns its own snapshot, by design — partial failure is the realistic
    // outcome).
    const results = await Promise.allSettled(
      targets.map((row) =>
        deleteMutation.mutateAsync({ objectId: row.id, number: row.number }),
      ),
    );

    // F4-03 — collect per-row failures and group by error code (권한/상태/기타)
    // so the toast tells the user which numbers failed and why instead of just
    // "{N}건 실패".
    const failures: { number: string; reason: string }[] = [];
    results.forEach((r, idx) => {
      if (r.status === 'rejected') {
        const row = targets[idx]!;
        const err = r.reason;
        const reason =
          err instanceof ApiError
            ? friendlyDeleteFailure(err)
            : err instanceof Error
              ? err.message
              : '알 수 없는 오류';
        failures.push({ number: row.number, reason });
      }
    });

    const okCount = targets.length - failures.length;

    // Drop succeeded ids from the selection so the next bulk action targets
    // only what remains. Failed rows stay selected so the user can retry.
    if (okCount > 0) {
      const failedIds = new Set(
        failures
          .map((f) => targets.find((t) => t.number === f.number)?.id)
          .filter((id): id is string => !!id),
      );
      setSelectedIds((prev) => prev.filter((id) => failedIds.has(id)));
    }

    if (failures.length === 0) {
      toast.success(`${okCount}건을 삭제했습니다.`);
      return;
    }

    // Group by reason for a compact toast description.
    const grouped = new Map<string, string[]>();
    for (const f of failures) {
      const list = grouped.get(f.reason) ?? [];
      list.push(f.number);
      grouped.set(f.reason, list);
    }
    const description = Array.from(grouped.entries())
      .map(([reason, nums]) => `• ${reason}: ${nums.join(', ')}`)
      .join('\n');

    toast.error(
      `${okCount}건 성공, ${failures.length}건 실패`,
      { description },
    );

    // We don't re-throw — the toolbar's ConfirmDialog would otherwise also
    // toast a generic error, doubling the noise for partial-failure cases.
  }, [selectedIds, findRow, deleteMutation]);

  // R19b — bulk ZIP download. The legacy staggered <a download> approach
  // worked but produced one file per click; Chrome batches the prompts past
  // ~5 files and forces the user to authorize each one. We now stream every
  // master attachment through jszip on the client, then trigger a single
  // Blob URL download for the resulting ZIP.
  const handleBulkDownload = React.useCallback(async () => {
    if (selectedIds.length === 0) return;
    const targets = selectedIds
      .map(findRow)
      .filter((r): r is ObjectRow => r !== undefined)
      .filter((r) => !!r.masterAttachmentId);
    if (targets.length === 0) {
      toast.warning('다운로드할 첨부가 없습니다.', {
        description: '선택한 자료에 마스터 파일이 등록되어 있지 않습니다.',
      });
      return;
    }

    // Lazy-load jszip so the search route bundle stays slim for users who
    // never trigger this path.
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    const failures: string[] = [];
    toast(`${targets.length}건 패키징 중…`);

    // Sequential fetch keeps the browser from opening N concurrent sockets;
    // for a typical drawing batch (~10 files, ~tens of MB total) sequential
    // is also faster than parallel because of HTTP/1.1 connection limits.
    for (const row of targets) {
      try {
        const res = await fetch(
          `/api/v1/attachments/${row.masterAttachmentId}/file?download=1`,
          { credentials: 'include' },
        );
        if (!res.ok) {
          failures.push(row.number);
          continue;
        }
        const blob = await res.blob();
        const cd = res.headers.get('Content-Disposition') ?? '';
        const filename = parseDispositionFilename(cd) ?? row.number;
        zip.file(filename, blob);
      } catch {
        failures.push(row.number);
      }
    }

    const okCount = targets.length - failures.length;
    if (okCount === 0) {
      toast.error('다운로드 실패', {
        description: '선택한 모든 첨부를 가져오지 못했습니다.',
      });
      return;
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drawings-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);

    if (failures.length === 0) {
      toast.success(`${okCount}건을 ZIP으로 다운로드했습니다.`);
    } else {
      toast.error(`${okCount}건 성공, ${failures.length}건 실패`, {
        description: `실패 자료: ${failures.join(', ')}`,
      });
    }
  }, [selectedIds, findRow]);

  // R17 — bulk move/copy. The toolbar placeholders are now real: open the
  // move dialog with the current selection, route to /bulk-move or /bulk-copy
  // depending on mode, and surface partial failures the same grouped-toast
  // way as bulk delete (F4-03).
  const [moveState, setMoveState] = React.useState<{
    mode: ObjectMoveMode;
    ids: string[];
  } | null>(null);

  const handleBulkMoveOpen = React.useCallback(() => {
    if (selectedIds.length === 0) return;
    setMoveState({ mode: 'move', ids: selectedIds });
  }, [selectedIds]);
  const handleBulkCopyOpen = React.useCallback(() => {
    if (selectedIds.length === 0) return;
    setMoveState({ mode: 'copy', ids: selectedIds });
  }, [selectedIds]);

  // R18 — transmittal. Selection ids feed the dialog; the dialog handles
  // POST /api/v1/lobbies and routes to /lobby/<id> on success.
  const [transmittalOpen, setTransmittalOpen] = React.useState(false);
  const handleBulkTransmittal = React.useCallback(() => {
    if (selectedIds.length === 0) return;
    setTransmittalOpen(true);
  }, [selectedIds]);

  interface BulkMoveCopyResponse {
    successes: Array<{ id?: string; srcId?: string; newId?: string; newNumber?: string }>;
    failures: Array<{ id: string; code: string; message: string }>;
  }

  const moveMutation = useMutation<
    BulkMoveCopyResponse,
    ApiError,
    { mode: ObjectMoveMode; ids: string[]; targetFolderId: string }
  >({
    mutationFn: ({ mode, ids, targetFolderId }) =>
      api.post<BulkMoveCopyResponse>(
        mode === 'move'
          ? '/api/v1/objects/bulk-move'
          : '/api/v1/objects/bulk-copy',
        { ids, targetFolderId },
      ),
    onSuccess: (res, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all() });

      const okCount = res.successes.length;
      const failCount = res.failures.length;
      const verb = vars.mode === 'move' ? '이동' : '복사';

      if (failCount === 0) {
        toast.success(`${okCount}건 ${verb}을(를) 완료했습니다.`);
        if (vars.mode === 'move') setSelectedIds([]);
        return;
      }
      // Group by reason for a compact summary.
      const grouped = new Map<string, string[]>();
      for (const f of res.failures) {
        const row = findRow(f.id);
        const numLabel = row?.number ?? f.id.slice(-6);
        const reason = friendlyReleaseFailure(f.code, f.message);
        const list = grouped.get(reason) ?? [];
        list.push(numLabel);
        grouped.set(reason, list);
      }
      const description = Array.from(grouped.entries())
        .map(([reason, nums]) => `• ${reason}: ${nums.join(', ')}`)
        .join('\n');
      toast.error(`${okCount}건 성공, ${failCount}건 실패`, { description });

      // Move: keep failed ids in selection so user can retry. Copy: leave
      // selection alone — copies don't consume the source, retry rarely
      // matches the user's mental model.
      if (vars.mode === 'move') {
        const failIds = new Set(res.failures.map((f) => f.id));
        setSelectedIds((prev) => prev.filter((id) => failIds.has(id)));
      }
    },
    onError: (err, vars) => {
      const verb = vars.mode === 'move' ? '이동' : '복사';
      toast.error(`${verb} 실패`, { description: err.message });
    },
  });

  // R4c (F4-06) — bulk approval submit. Opens NewApprovalDialog in multi mode
  // with the current selection's summaries; the dialog resolves into a single
  // POST /api/v1/objects/bulk-release call. Per-row failures surface as a
  // grouped toast (mirrors F4-03 bulk delete).
  const [bulkReleaseTargets, setBulkReleaseTargets] = React.useState<
    BulkObjectSummary[]
  >([]);
  const handleBulkSubmitApproval = React.useCallback(() => {
    if (selectedIds.length === 0) return;
    const releasable = selectedIds
      .map(findRow)
      .filter((r): r is ObjectRow => r !== undefined)
      .filter((r) => r.state === 'CHECKED_IN');
    if (releasable.length === 0) {
      toast.warning('결재상신 가능한 자료가 없습니다.', {
        description: '체크인 상태(CHECKED_IN)의 자료만 일괄 상신할 수 있습니다.',
      });
      return;
    }
    if (releasable.length < selectedIds.length) {
      toast.warning(
        `${releasable.length}건만 상신 대상으로 선택됩니다.`,
        {
          description:
            '체크인 상태가 아닌 자료는 자동으로 제외됩니다. 진행하시려면 다이얼로그에서 결재선을 입력하세요.',
        },
      );
    }
    setBulkReleaseTargets(
      releasable.map((r) => ({ id: r.id, number: r.number, name: r.name })),
    );
  }, [selectedIds, findRow]);

  interface BulkReleaseSuccess {
    id: string;
    approvalId: string;
    objectState: ObjectState;
  }
  interface BulkReleaseFailure {
    id: string;
    code: string;
    message: string;
  }
  interface BulkReleaseResponse {
    successes: BulkReleaseSuccess[];
    failures: BulkReleaseFailure[];
  }

  const bulkReleaseMutation = useMutation<
    BulkReleaseResponse,
    ApiError,
    { ids: string[]; payload: NewApprovalSubmitPayload }
  >({
    mutationFn: ({ ids, payload }) =>
      api.post<BulkReleaseResponse>('/api/v1/objects/bulk-release', {
        ids,
        title: payload.title,
        approvers: payload.approvers,
      }),
    onSuccess: (res, vars) => {
      // Refetch the grid + any detail pages the user may bounce into. The
      // bulk endpoint already wrote audit logs server-side.
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() });

      const okCount = res.successes.length;
      const failCount = res.failures.length;
      const total = vars.ids.length;

      if (failCount === 0) {
        toast.success(`${okCount}건 결재상신을 완료했습니다.`);
        // Drop succeeded ids from the selection.
        const okIds = new Set(res.successes.map((s) => s.id));
        setSelectedIds((prev) => prev.filter((id) => !okIds.has(id)));
        return;
      }

      // Group failures by reason for a compact summary toast (same shape as
      // the bulk-delete handler so the UX feels consistent).
      const grouped = new Map<string, string[]>();
      for (const f of res.failures) {
        const row = findRow(f.id);
        const numLabel = row?.number ?? f.id.slice(-6);
        const reason = friendlyReleaseFailure(f.code, f.message);
        const list = grouped.get(reason) ?? [];
        list.push(numLabel);
        grouped.set(reason, list);
      }
      const description = Array.from(grouped.entries())
        .map(([reason, nums]) => `• ${reason}: ${nums.join(', ')}`)
        .join('\n');

      toast.error(`${okCount}/${total}건 성공, ${failCount}건 실패`, {
        description,
      });
      // Keep failed rows selected so the user can retry them; drop succeeded.
      const failIds = new Set(res.failures.map((f) => f.id));
      setSelectedIds((prev) => prev.filter((id) => failIds.has(id)));
    },
    onError: (err) => {
      // Whole batch never ran (auth / validation). Surface the BE message.
      toast.error('결재상신 실패', { description: err.message });
    },
  });

  const handleBulkReleaseSubmit = React.useCallback(
    async (payload: NewApprovalSubmitPayload) => {
      const ids = bulkReleaseTargets.map((t) => t.id);
      if (ids.length === 0) return;
      await bulkReleaseMutation.mutateAsync({ ids, payload });
      setBulkReleaseTargets([]);
    },
    [bulkReleaseTargets, bulkReleaseMutation],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <MemoSubSidebar
        folders={folders}
        selectedId={selectedFolder?.id}
        onSelect={handleSelectFolder}
        systemViews={systemViews}
        pinnedFolders={pinnedFolders.map((p) => p.folder)}
        pinnedFolderIds={pinnedFolderIds}
        onTogglePin={handleTogglePin}
        activeViewKey={activeViewKey}
        onSelectView={handleSelectView}
      />

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">
        <div className="border-b border-border bg-bg/90 px-5 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="app-kicker">Document Control Grid</div>
              <h1 className="mt-1 text-xl font-semibold text-fg">자료 검색</h1>
            </div>
            <div className="hidden items-center gap-2 lg:flex">
              <Metric icon={<FolderOpen className="h-4 w-4" />} label="현재 폴더" value={selectedFolder?.name ?? '전체'} />
              <Metric icon={<Layers3 className="h-4 w-4" />} label="검색 결과" value={`${filtered.length.toLocaleString()}건`} />
              <Link href="/search?action=new" className="app-action-button-primary h-9">
                <Plus className="h-4 w-4" />
                신규 등록
              </Link>
            </div>
          </div>

          <div className="mt-3 flex h-8 items-center gap-1 rounded-md border border-border bg-bg-subtle px-3 text-xs text-fg-muted">
            <span>폴더</span>
            <ChevronRight className="h-3 w-3" />
            {selectedFolder ? (
              <span className="font-medium text-fg">
                {selectedFolder.pathLabel ?? selectedFolder.name}
              </span>
            ) : (
              <span className="font-medium text-fg">전체</span>
            )}
            <ChevronRight className="h-3 w-3" />
            <span>최신본 · 리비전 · 이슈 · 배포 상태</span>
          </div>
        </div>

        <ObjectTableToolbar
          totalCount={filtered.length}
          selectedCount={selectedCount}
          search={search}
          onSearchChange={setSearch}
          activeFilters={activeFilterChips}
          onRemoveFilter={(key) => {
            setFilters((f) => {
              const next = { ...f };
              if (key === 'class') delete next.classCode;
              else if (key === 'state') delete next.state;
              else if (key === 'date') {
                delete next.registeredFrom;
                delete next.registeredTo;
              } else if (key === 'registrant') delete next.registrant;
              return next;
            });
          }}
          onClearFilters={() => {
            setSearch('');
            setFilters({});
          }}
          sort={sort}
          onSortChange={setSort}
          filterValue={filters}
          onFilterChange={setFilters}
          // R3c-3 #5 — bulk actions wired to the selection.
          onDelete={handleBulkDelete}
          onDownload={handleBulkDownload}
          onMove={handleBulkMoveOpen}
          onCopy={handleBulkCopyOpen}
          onSubmitApproval={handleBulkSubmitApproval}
          onTransmittal={handleBulkTransmittal}
        />

        {/* min-w-0 lets the section flex shrink so the preview keeps its
            slot; overflow-auto scrolls the wide table inside. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
            <ObjectTable
              data={filtered}
              selectedId={selectedRow?.id}
              onSelect={handleSelectRow}
              onSelectedIdsChange={setSelectedIds}
              searchTerm={search}
              me={me}
              onCheckoutRow={handleCheckoutRow}
              onCheckinRow={handleCheckinRow}
              onCancelCheckoutRow={handleCancelCheckoutRow}
              onReleaseRow={handleReleaseRow}
              onDeleteRow={handleDeleteRow}
            />
            {filtered.length > 0 && (
              <div className="flex items-center justify-center border-t border-border bg-bg-subtle py-3">
                <button
                  type="button"
                  className="app-action-button"
                >
                  더 보기
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {detailPanelOpen && (
        <ObjectPreviewPanel row={selectedRow} onClose={handleClosePreview} />
      )}

      <NewObjectDialog
        open={action === 'new'}
        onOpenChange={(open) => {
          if (!open) closeNewDialog();
        }}
        folderId={selectedFolder?.id}
        onSubmit={handleCreateObject}
      />

      {/* R16 — bulk register. Triggered by `/search?action=bulk` (home tile +
          future toolbar entry). Closes by clearing the action param so
          back-button + URL share both work. */}
      <BulkCreateDialog
        open={action === 'bulk'}
        onOpenChange={(open) => {
          if (!open) closeNewDialog();
        }}
      />

      {/* R17 — bulk move/copy. The dialog drives the destination picker; the
          mutation does the actual fan-out and toast. */}
      {moveState && (
        <ObjectMoveDialog
          open
          onOpenChange={(o) => {
            if (!o) setMoveState(null);
          }}
          mode={moveState.mode}
          selectedCount={moveState.ids.length}
          currentFolderId={selectedFolder?.id}
          onConfirm={async (targetFolderId) => {
            await moveMutation.mutateAsync({
              mode: moveState.mode,
              ids: moveState.ids,
              targetFolderId,
            });
            setMoveState(null);
          }}
        />
      )}

      {/* R18 — transmittal. Bundles the selection's master attachments into a
          Lobby and ships to selected partner orgs. Routes to /lobby/<id>. */}
      <TransmittalDialog
        open={transmittalOpen}
        onOpenChange={setTransmittalOpen}
        objectIds={selectedIds}
        defaultFolderId={selectedFolder?.id}
      />

      <NewApprovalDialog
        open={releaseTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReleaseTarget(null);
        }}
        objectId={releaseTarget?.id}
        objectNumber={releaseTarget?.number}
        objectName={releaseTarget?.name}
        onSubmit={handleReleaseSubmit}
      />

      {/* R4c — bulk approval. Opens when the toolbar's 결재상신 fan-out
          collects ≥1 CHECKED_IN row from the selection. */}
      <NewApprovalDialog
        open={bulkReleaseTargets.length > 0}
        onOpenChange={(open) => {
          if (!open) setBulkReleaseTargets([]);
        }}
        objectSummaries={bulkReleaseTargets}
        onSubmit={handleBulkReleaseSubmit}
      />

      {/* R3c-3 #3 — Grid cancel-checkout confirm. Copy is intentionally
          identical to the detail page (objects/[id]/page.tsx ConfirmDialog)
          so the user gets a consistent prompt regardless of entry point. */}
      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        title="개정을 취소하시겠습니까?"
        description="체크아웃이 해제되고 작업 중인 변경 내용이 사라질 수 있습니다."
        confirmText="개정 취소"
        variant="destructive"
        onConfirm={handleConfirmCancelCheckout}
      />
    </div>
  );
}

// R19b — pull the filename out of a Content-Disposition header. Supports
// both the legacy `filename="..."` and RFC 5987 `filename*=UTF-8''...` forms.
function parseDispositionFilename(header: string): string | null {
  if (!header) return null;
  // RFC 5987 form takes priority — it's the only one that survives non-ASCII
  // chars without encoding issues.
  const star = /filename\*=(?:[^']*)''([^;]+)/i.exec(header);
  if (star && star[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // fall through to plain form
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  if (plain && plain[1]) return plain[1];
  return null;
}

// F4-03 — surface per-row delete failures with reason groups. Maps the BE's
// canonical error codes to a short Korean label.
function friendlyDeleteFailure(err: ApiError): string {
  switch (err.code) {
    case 'E_FORBIDDEN':
      return '권한 없음';
    case 'E_STATE_CONFLICT':
      return '상태 충돌';
    case 'E_LOCKED':
      return '잠금 상태';
    case 'E_NOT_FOUND':
      return '대상 없음';
    case 'E_VALIDATION':
      return '유효성 오류';
    default:
      return err.message ?? '오류';
  }
}

// F4-06 — bulk-release errors arrive in the 200 envelope as { code, message }
// per row instead of as ApiError instances. Same friendly mapping, different
// input shape, so we keep it separate to avoid forcing every caller to wrap
// the row in an ApiError.
function friendlyReleaseFailure(code: string, message: string): string {
  switch (code) {
    case 'E_FORBIDDEN':
      return '권한 없음';
    case 'E_STATE_CONFLICT':
      return '상태 충돌(체크인 상태가 아님)';
    case 'E_LOCKED':
      return '잠금 상태';
    case 'E_NOT_FOUND':
      return '대상 없음';
    case 'E_VALIDATION':
      return '유효성 오류';
    default:
      return message || '오류';
  }
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex h-9 min-w-28 items-center gap-2 rounded-md border border-border bg-bg-subtle px-3">
      <span className="text-fg-subtle">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[11px] leading-none text-fg-subtle">{label}</span>
        <span className="block truncate text-xs font-semibold text-fg">{value}</span>
      </span>
    </div>
  );
}

