'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, X, CheckCircle2, XCircle, Clock4 } from 'lucide-react';
import { SubSidebar } from '@/components/layout/SubSidebar';
import { cn } from '@/lib/cn';

type BoxKey = 'waiting' | 'done' | 'sent' | 'trash';

const BOXES: { key: BoxKey; label: string; count: number }[] = [
  { key: 'waiting', label: '대기', count: 3 },
  { key: 'done', label: '처리완료', count: 12 },
  { key: 'sent', label: '상신함', count: 5 },
  { key: 'trash', label: '회수', count: 1 },
];

// MOCK approval rows — TODO api.get('/api/v1/approvals?box=...')
const MOCK_ROWS = [
  {
    id: 'apr-1',
    title: 'R3 개정 결재',
    sender: '박영호',
    objectNumber: 'CGL-MEC-2026-00012',
    objectName: '메인롤러 어셈블리',
    submittedAt: '2026-04-24',
    box: 'waiting' as BoxKey,
  },
  {
    id: 'apr-2',
    title: 'R1 신규 결재',
    sender: '김철수',
    objectNumber: 'BFM-PRC-2026-00008',
    objectName: '소둔로 공정 P&ID',
    submittedAt: '2026-04-23',
    box: 'waiting' as BoxKey,
  },
  {
    id: 'apr-3',
    title: 'R2 개정 결재',
    sender: '최정아',
    objectNumber: 'CGL-ELE-2026-00031',
    objectName: '메인 컨트롤 패널',
    submittedAt: '2026-04-22',
    box: 'waiting' as BoxKey,
  },
];

export default function ApprovalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const box = (searchParams?.get('box') as BoxKey | null) ?? 'waiting';
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const setBox = (next: BoxKey) => {
    const sp = new URLSearchParams(searchParams?.toString());
    sp.set('box', next);
    router.replace(`/approval?${sp.toString()}`);
    setSelectedId(null);
  };

  const rows = MOCK_ROWS.filter((r) => r.box === box);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-1">
      <SubSidebar
        title="결재함"
        footer={
          <button
            type="button"
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-bg text-sm hover:bg-bg-muted"
          >
            <Plus className="h-4 w-4" />
            새 결재 상신
          </button>
        }
      >
        <ul role="radiogroup" aria-label="결재함 분류" className="space-y-1">
          {BOXES.map((b) => {
            const active = b.key === box;
            return (
              <li key={b.key}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setBox(b.key)}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm',
                    active ? 'bg-brand/10 text-fg' : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex h-3 w-3 items-center justify-center rounded-full border',
                      active ? 'border-brand-500 bg-brand-500/30' : 'border-border',
                    )}
                  />
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

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 items-center border-b border-border bg-bg px-4 text-sm font-semibold text-fg">
          {BOXES.find((b) => b.key === box)?.label} ({rows.length})
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-fg-muted">
              <Clock4 className="h-8 w-8 text-fg-subtle" />
              <span>해당 결재함에 항목이 없습니다.</span>
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-bg-subtle">
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-fg-muted">
                  <th className="h-9 w-8 px-2"></th>
                  <th className="h-9 px-2 text-left">제목</th>
                  <th className="h-9 px-2 text-left">상신자</th>
                  <th className="h-9 px-2 text-left">자료번호</th>
                  <th className="h-9 px-2 text-left">상신일</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isSelected = r.id === selectedId;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={cn(
                        'cursor-pointer border-b border-border hover:bg-bg-subtle',
                        isSelected && 'bg-brand/5',
                      )}
                    >
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label="선택"
                          onClick={(e) => e.stopPropagation()}
                          className="h-3.5 w-3.5 rounded border-border"
                        />
                      </td>
                      <td className="px-2 py-2 text-fg">{r.title}</td>
                      <td className="px-2 py-2 text-fg-muted">{r.sender}</td>
                      <td className="px-2 py-2">
                        <Link
                          href={`/objects/${r.id}`}
                          className="font-mono text-[12px] text-fg hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.objectNumber}
                        </Link>
                      </td>
                      <td className="px-2 py-2 font-mono text-[12px] text-fg-muted">{r.submittedAt}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* selection action bar */}
        {selectedId && (
          <div className="flex items-center gap-2 border-t border-border bg-brand/5 px-4 py-2 text-sm">
            <span className="font-medium text-fg">선택된 항목 1건</span>
            <span className="mx-2 text-border-strong">|</span>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1 rounded bg-emerald-500/10 px-2 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> 승인
            </button>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1 rounded bg-rose-500/10 px-2 text-rose-700 hover:bg-rose-500/20 dark:text-rose-400"
            >
              <XCircle className="h-3.5 w-3.5" /> 반려
            </button>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 hover:bg-bg-muted"
            >
              <Clock4 className="h-3.5 w-3.5" /> 미루기
            </button>
          </div>
        )}
      </section>

      {/* Detail Sheet — TODO replace with shadcn Sheet once available */}
      {selected && (
        <aside
          aria-label="결재 상세"
          className="flex h-full w-[420px] shrink-0 flex-col border-l border-border bg-bg"
        >
          <div className="flex h-10 items-center justify-between border-b border-border px-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">결재 상세</span>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="닫기"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4 text-sm">
            <h3 className="text-base font-semibold text-fg">{selected.title}</h3>
            <p className="mt-1 text-xs text-fg-muted">
              {selected.sender} · {selected.submittedAt}
            </p>

            <div className="mt-4 rounded-md border border-border bg-bg-subtle p-3">
              <div className="text-xs text-fg-muted">자료</div>
              <Link
                href={`/objects/${selected.id}`}
                className="font-mono text-sm text-fg hover:underline"
              >
                {selected.objectNumber}
              </Link>
              <div className="text-sm text-fg-muted">{selected.objectName}</div>
            </div>

            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">결재선</div>
              {/* TODO: Designer to provide ApprovalLine */}
              <ol className="space-y-1.5 text-sm">
                <li className="flex items-center gap-2 text-fg">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" />
                  </span>
                  <span>1단계 김지원</span>
                </li>
                <li className="flex items-center gap-2 text-fg">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/15 text-violet-600">
                    <Clock4 className="h-3 w-3" />
                  </span>
                  <span>2단계 박상민 — 진행중</span>
                </li>
              </ol>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
                코멘트
              </label>
              <textarea
                rows={4}
                className="w-full rounded-md border border-border bg-bg-subtle p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="검토 의견을 입력하세요…"
              />
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
