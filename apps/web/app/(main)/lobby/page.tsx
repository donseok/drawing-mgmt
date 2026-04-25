'use client';

import * as React from 'react';
import Link from 'next/link';
import { Inbox, Send, Clock4, Paperclip } from 'lucide-react';
import { SubSidebar } from '@/components/layout/SubSidebar';
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
                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm',
                    active ? 'bg-brand/10 text-fg' : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
                  )}
                >
                  <Icon className="h-4 w-4" />
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

      <section className="flex min-w-0 flex-1 flex-col overflow-auto p-6">
        <h1 className="mb-4 text-lg font-semibold text-fg">{BOXES.find((b) => b.key === box)?.label}</h1>

        {rows.length === 0 ? (
          <div className="mt-12 flex flex-col items-center gap-2 text-sm text-fg-muted">
            <Inbox className="h-10 w-10 text-fg-subtle" />
            <p>해당 로비함에 항목이 없습니다.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {rows.map((l) => (
              <li
                key={l.id}
                className="rounded-lg border border-border bg-bg p-4 transition-colors hover:border-border-strong hover:bg-bg-subtle"
              >
                <Link href={`/lobby/${l.id}`} className="block">
                  <h2 className="text-sm font-semibold text-fg">{l.title}</h2>
                  <p className="mt-1 text-xs text-fg-muted">{l.company}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-fg-muted">
                    <span className="inline-flex items-center gap-1">
                      <Paperclip className="h-3.5 w-3.5" />
                      첨부 {l.attachmentCount}건
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock4 className="h-3.5 w-3.5" />
                      만료 {l.expiresAt} (D-{l.daysLeft})
                    </span>
                    <span className="ml-auto rounded-full border border-border bg-bg-muted px-2 py-0.5 text-[11px] text-fg">
                      {l.status}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
