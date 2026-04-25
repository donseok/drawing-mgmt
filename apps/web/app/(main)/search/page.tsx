'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, FolderOpen, Layers3, Plus, CheckCircle2, Lock, Send, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { useUiStore } from '@/stores/uiStore';
import { queryKeys } from '@/lib/queries';
import { api, ApiError } from '@/lib/api-client';
import { CONTROL_STATE, deriveControlState } from '@/lib/control-state';
import type { SortValue } from '@/components/object-list/SortMenu';
import {
  NewObjectDialog,
  type NewObjectFormValues,
} from '@/components/object-list/NewObjectDialog';

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
    controlState,
    latest: true,
  };
}

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
}: {
  folders: FolderNode[];
  selectedId?: string;
  onSelect: (node: FolderNode) => void;
  systemViews: { key: string; label: string; count: number; icon: React.ComponentType<{ className?: string }> }[];
}) {
  return (
    <SubSidebar title="폴더 트리">
      <div className="mb-3 space-y-1 border-b border-border pb-3">
        <div className="px-1 pb-1 text-[11px] font-semibold uppercase text-fg-subtle">Saved Views</div>
        {systemViews.map((view) => {
          const Icon = view.icon;
          return (
            <button
              key={view.key}
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
            >
              <Icon className="h-4 w-4 text-fg-subtle" />
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
  const [selectedCount, setSelectedCount] = React.useState(0);
  const [sort, setSort] = React.useState<SortValue>(DEFAULT_SORT);
  const [filters, setFilters] = React.useState<FilterFormValue>({});
  const detailPanelOpen = useUiStore((s) => s.detailPanelOpen);
  const setDetailPanelOpen = useUiStore((s) => s.setDetailPanelOpen);

  const { data } = useQuery({
    queryKey: queryKeys.objects.list({
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
    queryFn: () =>
      fetchSearchData({
        folderId: selectedFolder?.id,
        q: search.trim() || undefined,
        sort,
        filters,
      }),
  });

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

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <MemoSubSidebar
        folders={folders}
        selectedId={selectedFolder?.id}
        onSelect={handleSelectFolder}
        systemViews={systemViews}
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
        />

        {/* min-w-0 lets the section flex shrink so the preview keeps its
            slot; overflow-auto scrolls the wide table inside. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
            <ObjectTable
              data={filtered}
              selectedId={selectedRow?.id}
              onSelect={handleSelectRow}
              onSelectedCountChange={setSelectedCount}
              searchTerm={search}
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
    </div>
  );
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

