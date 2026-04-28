'use client';

import * as React from 'react';
import Link from 'next/link';
import { Inbox, Send, Clock4, Paperclip, Building2, CalendarDays, X, MoreVertical } from 'lucide-react';
import { SubSidebar } from '@/components/layout/SubSidebar';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/cn';

type BoxKey = 'received' | 'sent' | 'expired';

interface BoxMeta {
  key: BoxKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  emptyTitle: string;
  emptyDescription: string;
}

const BOX_META: BoxMeta[] = [
  {
    key: 'received',
    label: '받은 로비함',
    icon: Inbox,
    emptyTitle: '받은 로비 패키지가 없습니다.',
    emptyDescription: '협력업체로부터 검토 요청이 들어오면 여기 표시됩니다.',
  },
  {
    key: 'sent',
    label: '보낸 로비함',
    icon: Send,
    emptyTitle: '보낸 로비 패키지가 없습니다.',
    emptyDescription: '검색 화면에서 자료를 선택해 [트랜스미털]로 협력업체에 발송하면 표시됩니다.',
  },
  {
    key: 'expired',
    label: '만료된 로비함',
    icon: Clock4,
    emptyTitle: '만료된 로비 패키지가 없습니다.',
    emptyDescription: '만료일이 지난 로비 패키지가 30일간 보관됩니다.',
  },
];

// MOCK lobby cards — TODO api.get('/api/v1/lobbies?box=...')
const MOCK_LOBBIES = [
  {
    id: 'lobby-1',
    title: 'CGL-2 메인롤러 도면 협업 (홍성기계)',
    company: '홍성기계',
    attachmentCount: 4,
    expiresAt: '2026-05-02',
    daysLeft: 7,
    status: '확인 대기',
    box: 'received' as BoxKey,
  },
  {
    id: 'lobby-2',
    title: '소둔로 부품 도면 검토 요청',
    company: '대한설비',
    attachmentCount: 2,
    expiresAt: '2026-04-30',
    daysLeft: 5,
    status: '재확인 요청됨',
    box: 'received' as BoxKey,
  },
  {
    id: 'lobby-3',
    title: 'CGL-1 펌프 도면 송부 (홍성기계)',
    company: '홍성기계',
    attachmentCount: 3,
    expiresAt: '2026-05-15',
    daysLeft: 19,
    status: '응답 대기',
    box: 'sent' as BoxKey,
  },
  {
    id: 'lobby-4',
    title: 'CGL-2 가이드 가공도 송부',
    company: '대한설비',
    attachmentCount: 1,
    expiresAt: '2026-05-08',
    daysLeft: 12,
    status: '응답 완료',
    box: 'sent' as BoxKey,
  },
  {
    id: 'lobby-5',
    title: '폐쇄 라인 검토 요청 (만료)',
    company: '한국기계',
    attachmentCount: 2,
    expiresAt: '2026-04-10',
    daysLeft: -16,
    status: '만료됨',
    box: 'expired' as BoxKey,
  },
];

export default function LobbyPage() {
  const [box, setBox] = React.useState<BoxKey>('received');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const rows = MOCK_LOBBIES.filter((l) => l.box === box);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const BOXES = BOX_META.map((b) => ({
    ...b,
    count: MOCK_LOBBIES.filter((l) => l.box === b.key).length,
  }));

  React.useEffect(() => {
    setSelectedId(null);
  }, [box]);

  return (
    <div className="flex h-full min-h-0 flex-1">
      <SubSidebar title="로비함">
        <ul className="space-y-1">
          {BOXES.map((b) => {
            const Icon = b.icon;
            const active = b.key === box;
            return (
              <li key={b.key}>
                <button
                  type="button"
                  onClick={() => setBox(b.key)}
                  aria-pressed={active}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors',
                    // R37 AC-1: keyboard nav between sidebar tabs needs a
                    // visible ring; ring-1 is the active *style*, not focus.
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'bg-bg text-fg shadow-sm ring-1 ring-border' : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
                  )}
                >
                  <Icon className={cn('h-4 w-4', active ? 'text-brand-500' : 'text-fg-subtle')} />
                  <span className="flex-1 text-left">{b.label}</span>
                  <span className="rounded bg-bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-fg-muted">
                    {b.count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </SubSidebar>

      <section className="flex min-w-0 flex-1 flex-col bg-bg">
        <div className="border-b border-border px-5 py-3">
          <div className="app-kicker">Partner Lobby</div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-fg">{BOXES.find((b) => b.key === box)?.label}</h1>
              <p className="mt-1 text-sm text-fg-muted">협력업체 도면 패키지의 첨부, 만료, 응답 상태를 비교합니다.</p>
            </div>
            <button type="button" className="app-action-button-primary h-9">
              <Send className="h-4 w-4" />
              로비 패키지 발송
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {rows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={BOX_META.find((b) => b.key === box)!.emptyTitle}
              description={BOX_META.find((b) => b.key === box)!.emptyDescription}
              className="min-h-80"
            />
          ) : (
            <table className="app-table">
              <thead>
                <tr>
                  <th>패키지</th>
                  <th>협력업체</th>
                  <th>상태</th>
                  <th>첨부</th>
                  <th>만료일</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const active = selected?.id === l.id;
                  return (
                    <tr
                      key={l.id}
                      onClick={() => setSelectedId(l.id)}
                      className={cn(
                        'cursor-pointer hover:bg-bg-subtle',
                        active && 'bg-brand/5 shadow-[inset_3px_0_0_hsl(var(--brand))]',
                      )}
                    >
                      <td>
                        <Link href={`/lobby/${l.id}`} className="block min-w-0" onClick={(e) => e.stopPropagation()}>
                          <span className="block truncate font-medium text-fg hover:text-brand">{l.title}</span>
                          <span className="font-mono text-[12px] text-fg-muted">{l.id.toUpperCase()}</span>
                        </Link>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 text-sm text-fg">
                          <Building2 className="h-3.5 w-3.5 text-fg-subtle" />
                          {l.company}
                        </span>
                      </td>
                      <td>
                        <span className="inline-flex h-6 items-center rounded-md border border-border bg-bg-subtle px-2 text-[12px] font-medium text-fg">
                          {l.status}
                        </span>
                      </td>
                      <td className="text-[12px] text-fg-muted">
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="h-3.5 w-3.5" />
                          {l.attachmentCount}건
                        </span>
                      </td>
                      <td className="font-mono text-[12px] text-fg-muted">
                        {l.expiresAt} <span className={l.daysLeft <= 7 ? 'text-warning' : ''}>(D-{l.daysLeft})</span>
                      </td>
                      <td>
                        <button type="button" className="app-icon-button h-7 w-7" aria-label="패키지 메뉴" onClick={(e) => e.stopPropagation()}>
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {selected && (
        <aside className="hidden h-full w-[360px] shrink-0 flex-col border-l border-border bg-bg lg:flex" aria-label="로비 상세">
          <div className="app-panel-header min-h-11">
            <span className="app-kicker">패키지 상세</span>
            <button type="button" className="app-icon-button h-7 w-7" aria-label="닫기" onClick={() => setSelectedId(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <h2 className="text-base font-semibold text-fg">{selected.title}</h2>
            <p className="mt-1 text-sm text-fg-muted">{selected.company}</p>

            <div className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
              <div className="rounded-md border border-border bg-bg-subtle p-3">
                <div className="text-fg-muted">첨부</div>
                <div className="mt-1 font-semibold text-fg">{selected.attachmentCount}건</div>
              </div>
              <div className="rounded-md border border-border bg-bg-subtle p-3">
                <div className="text-fg-muted">상태</div>
                <div className="mt-1 font-semibold text-fg">{selected.status}</div>
              </div>
            </div>

            <div className="mt-4 rounded-md border border-border">
              <div className="app-meta-row">
                <CalendarDays className="h-3.5 w-3.5 text-fg-subtle" />
                <span className="w-20 text-fg-muted">만료일</span>
                <span className="font-mono font-medium text-fg">{selected.expiresAt}</span>
              </div>
              <div className="app-meta-row">
                <Clock4 className="h-3.5 w-3.5 text-fg-subtle" />
                <span className="w-20 text-fg-muted">남은 기간</span>
                <span className="font-mono font-medium text-fg">D-{selected.daysLeft}</span>
              </div>
              <div className="app-meta-row border-b-0">
                <Paperclip className="h-3.5 w-3.5 text-fg-subtle" />
                <span className="w-20 text-fg-muted">패키지</span>
                <span className="font-medium text-fg">PDF/DWG 검토 세트</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 border-t border-border p-3">
            <Link href={`/lobby/${selected.id}`} className="app-action-button-primary h-9 flex-1">
              열기
            </Link>
            <button type="button" className="app-action-button h-9">
              재발송
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
