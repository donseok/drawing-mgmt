'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FolderOpen, Layers3, Plus } from 'lucide-react';
import Link from 'next/link';
import { SubSidebar } from '@/components/layout/SubSidebar';
import { FolderTree } from '@/components/folder-tree/FolderTree';
import type { FolderNode } from '@/components/folder-tree/types';
import { ObjectTable, type ObjectRow } from '@/components/object-list/ObjectTable';
import { ObjectTableToolbar } from '@/components/object-list/ObjectTableToolbar';
import { ObjectPreviewPanel } from '@/components/object-list/ObjectPreviewPanel';
import { useUiStore } from '@/stores/uiStore';
import { queryKeys } from '@/lib/queries';
// import { api } from '@/lib/api-client'; // TODO wire real API

// MOCK folder tree — TODO: replace with `api.get('/api/v1/folders')`.
const MOCK_FOLDERS: FolderNode[] = [
  {
    id: 'f-hq',
    code: 'HQ',
    name: '본사',
    objectCount: 924,
    children: [
      {
        id: 'f-hq-mec',
        code: 'MEC',
        name: '기계',
        objectCount: 412,
        children: [
          { id: 'f-cgl1', code: 'CGL-1', name: 'CGL-1', objectCount: 124 },
          {
            id: 'f-cgl2',
            code: 'CGL-2',
            name: 'CGL-2',
            objectCount: 98,
            children: [
              { id: 'f-cgl2-main', code: 'CGL-2-M', name: '메인라인', objectCount: 45 },
              { id: 'f-cgl2-sub', code: 'CGL-2-S', name: '보조라인', objectCount: 28 },
            ],
          },
        ],
      },
      { id: 'f-hq-ele', code: 'ELE', name: '전기', objectCount: 412 },
      { id: 'f-hq-ins', code: 'INS', name: '계장', objectCount: 203 },
      { id: 'f-hq-prc', code: 'PRC', name: '공정', objectCount: 89 },
    ],
  },
  { id: 'f-partner', code: 'PRT', name: '협력업체', objectCount: 31, permission: 'restricted' },
  { id: 'f-trash', code: 'TRASH', name: '폐기함', objectCount: 42, permission: 'locked' },
];

// MOCK object list — realistic Korean samples per spec.
const MOCK_OBJECTS: ObjectRow[] = [
  {
    id: 'obj-1',
    number: 'CGL-MEC-2026-00012',
    name: '메인롤러 어셈블리',
    classCode: 'MEC',
    classLabel: '기계',
    state: 'APPROVED',
    revision: 3,
    version: '0.2',
    registrant: '박영호',
    registrantInitial: '박',
    registeredAt: '2026-04-12',
    masterAttachmentId: 'att-1',
  },
  {
    id: 'obj-2',
    number: 'CGL-MEC-2026-00013',
    name: '가이드롤러 베이스 가공도',
    classCode: 'MEC',
    classLabel: '기계',
    state: 'IN_APPROVAL',
    revision: 1,
    version: '0.0',
    registrant: '박영호',
    registrantInitial: '박',
    registeredAt: '2026-04-15',
    masterAttachmentId: 'att-2',
  },
  {
    id: 'obj-3',
    number: 'CGL-ELE-2026-00031',
    name: '메인 컨트롤 패널 결선도',
    classCode: 'ELE',
    classLabel: '전기',
    state: 'CHECKED_OUT',
    revision: 2,
    version: '0.1',
    registrant: '최정아',
    registrantInitial: '최',
    registeredAt: '2026-04-18',
    masterAttachmentId: 'att-3',
  },
  {
    id: 'obj-4',
    number: 'BFM-PRC-2026-00008',
    name: '소둔로 공정 P&ID',
    classCode: 'PRC',
    classLabel: '공정',
    state: 'NEW',
    revision: 0,
    version: '0.0',
    registrant: '김철수',
    registrantInitial: '김',
    registeredAt: '2026-04-20',
    masterAttachmentId: 'att-4',
  },
  {
    id: 'obj-5',
    number: 'CGL-INS-2026-00021',
    name: '온도센서 배치도',
    classCode: 'INS',
    classLabel: '계장',
    state: 'CHECKED_IN',
    revision: 1,
    version: '0.1',
    registrant: '임도현',
    registrantInitial: '임',
    registeredAt: '2026-04-22',
    masterAttachmentId: 'att-5',
  },
  {
    id: 'obj-6',
    number: 'CGL-MEC-2026-00009',
    name: '냉각롤러 조립도',
    classCode: 'MEC',
    classLabel: '기계',
    state: 'APPROVED',
    revision: 4,
    version: '0.0',
    registrant: '박영호',
    registrantInitial: '박',
    registeredAt: '2026-04-08',
    masterAttachmentId: 'att-6',
  },
];

interface SearchData {
  folders: FolderNode[];
  objects: ObjectRow[];
}

async function fetchSearchData(): Promise<SearchData> {
  // TODO: replace with parallel calls:
  //   const [folders, objects] = await Promise.all([
  //     api.get<FolderNode[]>('/api/v1/folders'),
  //     api.get<ObjectRow[]>('/api/v1/objects', { query: { folderId, q, classId, state } }),
  //   ]);
  return { folders: MOCK_FOLDERS, objects: MOCK_OBJECTS };
}

export default function SearchPage() {
  const [selectedFolder, setSelectedFolder] = React.useState<FolderNode | null>(null);
  const [selectedRow, setSelectedRow] = React.useState<ObjectRow | null>(null);
  const [search, setSearch] = React.useState('');
  const [selectedCount, setSelectedCount] = React.useState(0);
  const detailPanelOpen = useUiStore((s) => s.detailPanelOpen);
  const setDetailPanelOpen = useUiStore((s) => s.setDetailPanelOpen);

  const { data } = useQuery({
    queryKey: queryKeys.objects.list({ folder: selectedFolder?.id }),
    queryFn: fetchSearchData,
    placeholderData: { folders: MOCK_FOLDERS, objects: MOCK_OBJECTS },
  });

  const folders = data?.folders ?? MOCK_FOLDERS;
  const allObjects = data?.objects ?? MOCK_OBJECTS;

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
        <FolderTree
          nodes={folders}
          selectedId={selectedFolder?.id}
          onSelect={(node) => setSelectedFolder(node)}
          defaultExpanded={['f-hq', 'f-hq-mec', 'f-cgl2']}
        />
      </SubSidebar>

      <section className="flex min-w-0 flex-1 flex-col bg-bg">
        <div className="border-b border-border bg-bg px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="app-kicker">Document Search</div>
              <h1 className="mt-1 text-xl font-semibold text-fg">자료 검색</h1>
              <p className="mt-1 text-sm text-fg-muted">
                폴더, 도면번호, 상태를 기준으로 도면과 첨부 자료를 조회합니다.
              </p>
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

          <div className="mt-4 flex h-8 items-center gap-1 rounded-md border border-border bg-bg-subtle px-3 text-xs text-fg-muted">
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
            <span>검색결과</span>
          </div>
        </div>

        <ObjectTableToolbar
          totalCount={filtered.length}
          selectedCount={selectedCount}
          search={search}
          onSearchChange={setSearch}
          activeFilters={[
            { key: 'class', label: '자료유형', value: '전체' },
            { key: 'state', label: '상태', value: '전체' },
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
