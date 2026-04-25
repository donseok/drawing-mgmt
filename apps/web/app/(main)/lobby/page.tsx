'use client';

import * as React from 'react';
import Link from 'next/link';
import { Inbox, Send, Clock4, Paperclip } from 'lucide-react';
import { SubSidebar } from '@/components/layout/SubSidebar';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/cn';

type BoxKey = 'received' | 'sent' | 'expired';

const BOXES: { key: BoxKey; label: string; icon: React.ComponentType<{ className?: string }>; count: number }[] = [
  { key: 'received', label: '받은 로비함', icon: Inbox, count: 4 },
  { key: 'sent', label: '보낸 로비함', icon: Send, count: 7 },
  { key: 'expired', label: '만료된 로비함', icon: Clock4, count: 2 },
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
];

export default function LobbyPage() {
  const [box, setBox] = React.useState<BoxKey>('received');
  const rows = MOCK_LOBBIES.filter((l) => l.box === box);

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
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors',
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
        <div className="border-b border-border px-5 py-4">
          <div className="app-kicker">Partner Lobby</div>
          <h1 className="mt-1 text-lg font-semibold text-fg">{BOXES.find((b) => b.key === box)?.label}</h1>
          <p className="mt-1 text-sm text-fg-muted">협력업체와 주고받은 도면 검토 패키지를 확인합니다.</p>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {rows.length === 0 ? (
            <EmptyState icon={Inbox} title="해당 로비함에 항목이 없습니다." className="min-h-80" />
          ) : (
          <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {rows.map((l) => (
              <li
                key={l.id}
                className="rounded-lg border border-border bg-bg transition-colors hover:border-border-strong hover:bg-bg-subtle"
              >
                <Link href={`/lobby/${l.id}`} className="block p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-fg">{l.title}</h2>
                      <p className="mt-1 text-xs text-fg-muted">{l.company}</p>
                    </span>
                    <span className="shrink-0 rounded-full border border-border bg-bg-subtle px-2 py-0.5 text-[11px] font-medium text-fg">
                      {l.status}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs text-fg-muted">
                    <span className="inline-flex items-center gap-1">
                      <Paperclip className="h-3.5 w-3.5" />
                      첨부 {l.attachmentCount}건
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock4 className="h-3.5 w-3.5" />
                      만료 {l.expiresAt} (D-{l.daysLeft})
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          )}
        </div>
      </section>
    </div>
  );
}
