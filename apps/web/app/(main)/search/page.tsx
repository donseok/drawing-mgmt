'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FolderOpen, Layers3, Plus, CheckCircle2, Lock, Send, MapPin } from 'lucide-react';
import Link from 'next/link';
import { SubSidebar } from '@/components/layout/SubSidebar';
import { FolderTree } from '@/components/folder-tree/FolderTree';
import type { FolderNode } from '@/components/folder-tree/types';
import { ObjectTable, type ObjectRow, type ObjectState } from '@/components/object-list/ObjectTable';
import { ObjectTableToolbar } from '@/components/object-list/ObjectTableToolbar';
import { ObjectPreviewPanel } from '@/components/object-list/ObjectPreviewPanel';
import { useUiStore } from '@/stores/uiStore';
import { queryKeys } from '@/lib/queries';
import { api } from '@/lib/api-client';

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
  const controlState =
    o.state === 'APPROVED'
      ? '현장배포본'
      : o.state === 'IN_APPROVAL'
        ? '검토중'
        : o.state === 'CHECKED_OUT'
          ? '작업중'
          : '승인본';
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
}): Promise<SearchData> {
  const [serverFolders, serverObjects] = await Promise.all([
    api.get<ServerFolderNode[]>('/api/v1/folders'),
    api.get<ServerObjectSummary[]>('/api/v1/objects', {
      query: {
        folderId: params.folderId,
        q: params.q,
        limit: 100,
      },
    }),
  ]);
  return {
    folders: serverFolders.map(adaptFolder),
    objects: serverObjects.map(adaptObject),
  };
}

export default function SearchPage() {
  const [selectedFolder, setSelectedFolder] = React.useState<FolderNode | null>(null);
  const [selectedRow, setSelectedRow] = React.useState<ObjectRow | null>(null);
  const [search, setSearch] = React.useState('');
  const [selectedCount, setSelectedCount] = React.useState(0);
  const detailPanelOpen = useUiStore((s) => s.detailPanelOpen);
  const setDetailPanelOpen = useUiStore((s) => s.setDetailPanelOpen);

  const { data } = useQuery({
    queryKey: queryKeys.objects.list({ folder: selectedFolder?.id, q: search }),
    queryFn: () =>
      fetchSearchData({
        folderId: selectedFolder?.id,
        q: search.trim() || undefined,
      }),
  });

  const folders = data?.folders ?? [];
  const allObjects = data?.objects ?? [];
  const systemViews = [
    { key: 'checkedout', label: '내 체크아웃', count: allObjects.filter((o) => o.state === 'CHECKED_OUT').length, icon: Lock },
    { key: 'review', label: '승인 대기', count: allObjects.filter((o) => o.state === 'IN_APPROVAL').length, icon: CheckCircle2 },
    { key: 'field', label: '현장배포본', count: allObjects.filter((o) => o.controlState === '현장배포본').length, icon: Send },
    { key: 'issues', label: '미해결 이슈', count: allObjects.reduce((sum, o) => sum + (o.issueCount ?? 0), 0), icon: MapPin },
  ];

  const filtered = React.useMemo(() => {
    if (!search.trim()) return allObjects;
    const q = search.toLowerCase();
    return allObjects.filter(
      (o) => o.number.toLowerCase().includes(q) || o.name.toLowerCase().includes(q),
    );
  }, [allObjects, search]);

  const handleSelectRow = (row: ObjectRow | null) => {
    setSelectedRow(row);
    if (row) setDetailPanelOpen(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-1">
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
          selectedId={selectedFolder?.id}
          onSelect={(node) => setSelectedFolder(node)}
          defaultExpanded={folders.map((f) => f.id)}
        />
      </SubSidebar>

      <section className="flex min-w-0 flex-1 flex-col bg-bg">
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
          activeFilters={[
            { key: 'class', label: '분야', value: '전체' },
            { key: 'state', label: '상태', value: '전체' },
            { key: 'latest', label: '최신본', value: '예' },
            { key: 'field', label: '현장배포', value: '포함' },
          ]}
          onClearFilters={() => setSearch('')}
        />

        <div className="min-h-0 flex-1 overflow-hidden bg-bg">
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
      </section>

      {detailPanelOpen && (
        <ObjectPreviewPanel row={selectedRow} onClose={() => setDetailPanelOpen(false)} />
      )}
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
