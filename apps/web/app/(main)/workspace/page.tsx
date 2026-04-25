'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Clock3,
  FileText,
  Folder,
  Lock,
  Star,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { EmptyState } from '@/components/EmptyState';

type TabKey = 'checkedout' | 'recent' | 'favorites';

interface WorkspaceItem {
  id: string;
  kind: 'object' | 'folder';
  number?: string;
  code?: string;
  name: string;
  // checkedout-specific
  checkedOutAt?: string;
  // recent-specific
  viewedAt?: string;
  // favorites-specific
  pinnedAt?: string;
  state?: string;
}

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'checkedout', label: '체크아웃 중', icon: Lock },
  { key: 'recent', label: '최근 열람', icon: Clock3 },
  { key: 'favorites', label: '즐겨찾기', icon: Star },
];

// MOCK datasets — TODO replace with `/api/v1/workspace/{checkedout,recent,favorites}`.
const CHECKEDOUT_ITEMS: WorkspaceItem[] = [
  {
    id: 'obj-3',
    kind: 'object',
    number: 'CGL-ELE-2026-00031',
    name: '메인 컨트롤 패널',
    checkedOutAt: '2026-04-25 14:22',
    state: 'CHECKED_OUT',
  },
  {
    id: 'obj-5',
    kind: 'object',
    number: 'CGL-INS-2026-00021',
    name: '계장 점검 체크리스트',
    checkedOutAt: '2026-04-25 09:48',
    state: 'CHECKED_OUT',
  },
];

const RECENT_ITEMS: WorkspaceItem[] = [
  {
    id: 'obj-1',
    kind: 'object',
    number: 'CGL-MEC-2026-00012',
    name: '메인롤러 어셈블리',
    viewedAt: '2026-04-26 10:23',
  },
  {
    id: 'obj-4',
    kind: 'object',
    number: 'BFM-PRC-2026-00008',
    name: '소둔로 공정 P&ID',
    viewedAt: '2026-04-26 09:14',
  },
  {
    id: 'obj-2',
    kind: 'object',
    number: 'CGL-MEC-2026-00013',
    name: '가이드롤러 베이스',
    viewedAt: '2026-04-25 17:05',
  },
  {
    id: 'obj-6',
    kind: 'object',
    number: 'CGL-MEC-2026-00009',
    name: '냉각수 배관 P&ID',
    viewedAt: '2026-04-25 11:32',
  },
];

const FAVORITE_ITEMS: WorkspaceItem[] = [
  {
    id: 'obj-1',
    kind: 'object',
    number: 'CGL-MEC-2026-00012',
    name: '메인롤러 어셈블리',
    pinnedAt: '2026-04-12',
  },
  {
    id: 'obj-2',
    kind: 'object',
    number: 'CGL-MEC-2026-00013',
    name: '가이드롤러 베이스',
    pinnedAt: '2026-04-15',
  },
  {
    id: 'f-cgl2',
    kind: 'folder',
    code: 'CGL-2',
    name: 'CGL-2 / 메인라인',
    pinnedAt: '2026-04-10',
  },
  {
    id: 'obj-3',
    kind: 'object',
    number: 'CGL-ELE-2026-00031',
    name: '메인 컨트롤 패널',
    pinnedAt: '2026-04-18',
  },
  {
    id: 'obj-4',
    kind: 'object',
    number: 'BFM-PRC-2026-00008',
    name: '소둔로 공정 P&ID',
    pinnedAt: '2026-04-20',
  },
];

const DATA_BY_TAB: Record<TabKey, WorkspaceItem[]> = {
  checkedout: CHECKEDOUT_ITEMS,
  recent: RECENT_ITEMS,
  favorites: FAVORITE_ITEMS,
};

const META_LABEL_BY_TAB: Record<TabKey, string> = {
  checkedout: '체크아웃 시각',
  recent: '열람 시각',
  favorites: '추가일',
};

function isTabKey(value: string | null): value is TabKey {
  return value === 'checkedout' || value === 'recent' || value === 'favorites';
}

function metaValue(item: WorkspaceItem, tab: TabKey): string {
  if (tab === 'checkedout') return item.checkedOutAt ?? '-';
  if (tab === 'recent') return item.viewedAt ?? '-';
  return item.pinnedAt ?? '-';
}

export default function WorkspacePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams?.get('tab') ?? null;
  const tab: TabKey = isTabKey(rawTab) ? rawTab : 'checkedout';

  const setTab = React.useCallback(
    (next: TabKey) => {
      const sp = new URLSearchParams(searchParams?.toString());
      sp.set('tab', next);
      router.replace(`/workspace?${sp.toString()}`);
    },
    [router, searchParams],
  );

  const items = DATA_BY_TAB[tab];

  return (
    <div className="flex-1 overflow-auto bg-bg">
      <div className="border-b border-border px-6 py-5">
        <div className="app-kicker">My Workspace</div>
        <h1 className="mt-1 text-2xl font-semibold text-fg">내 작업공간</h1>
        <p className="mt-1 text-sm text-fg-muted">
          담당 중인 도면, 최근 작업, 즐겨찾기를 빠르게 확인합니다.
        </p>
      </div>

      <div className="px-6 pt-4">
        {/* Tab strip */}
        <div role="tablist" aria-label="작업공간 탭" className="inline-flex h-10 items-center gap-1 border-b border-border">
          {TABS.map((t) => {
            const active = tab === t.key;
            const Icon = t.icon;
            const count = DATA_BY_TAB[t.key].length;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={cn(
                  'relative inline-flex items-center gap-2 px-3 py-2 text-sm font-medium leading-none transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm',
                  active ? 'text-fg' : 'text-fg-muted hover:text-fg',
                  'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5',
                  active ? 'after:bg-brand' : 'after:bg-transparent',
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{t.label}</span>
                <span
                  className={cn(
                    'ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold',
                    active ? 'bg-brand text-brand-foreground' : 'bg-bg-muted text-fg-muted',
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Item list */}
        <div className="mt-4 pb-8">
          {items.length === 0 ? (
            <EmptyState
              icon={TABS.find((t) => t.key === tab)!.icon}
              title="표시할 항목이 없습니다."
              description="새 도면을 등록하거나 다른 탭을 확인해 보세요."
              className="min-h-80"
            />
          ) : (
            <div className="app-panel overflow-hidden">
              <table className="app-table">
                <thead>
                  <tr>
                    <th className="w-8"></th>
                    <th>자료번호 / 코드</th>
                    <th>이름</th>
                    <th className="w-44">{META_LABEL_BY_TAB[tab]}</th>
                    <th className="w-12 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const Icon = it.kind === 'object' ? FileText : Folder;
                    const href =
                      it.kind === 'object'
                        ? `/objects/${it.id}`
                        : `/search?folder=${it.id}`;
                    return (
                      <tr key={it.id} className="hover:bg-bg-subtle">
                        <td className="px-2 py-2 align-middle">
                          <Icon className="h-4 w-4 text-fg-subtle" />
                        </td>
                        <td>
                          <Link
                            href={href}
                            className="font-mono text-[12px] text-fg hover:underline"
                          >
                            {it.number ?? it.code}
                          </Link>
                        </td>
                        <td>
                          <Link
                            href={href}
                            className="text-sm text-fg hover:underline"
                          >
                            {it.name}
                          </Link>
                        </td>
                        <td className="font-mono text-[12px] text-fg-muted">
                          {metaValue(it, tab)}
                        </td>
                        <td className="text-right">
                          <Link
                            href={href}
                            aria-label={`${it.name} 열기`}
                            className="app-icon-button h-7 w-7"
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
