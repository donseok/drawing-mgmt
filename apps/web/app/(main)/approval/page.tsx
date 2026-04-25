'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Plus,
  X,
  CheckCircle2,
  XCircle,
  Clock4,
  Inbox,
  Send,
  RotateCcw,
  Archive,
  GitCompare,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { SubSidebar } from '@/components/layout/SubSidebar';
import { ApprovalLine, type ApprovalStep } from '@/components/ApprovalLine';
import { EmptyState } from '@/components/EmptyState';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/cn';

type BoxKey = 'waiting' | 'done' | 'sent' | 'recall';

const BOX_META: Omit<BoxRow, 'count'>[] = [
  { key: 'waiting', label: '대기', icon: Inbox },
  { key: 'done', label: '처리완료', icon: CheckCircle2 },
  { key: 'sent', label: '상신함', icon: Send },
  { key: 'recall', label: '회수', icon: Archive },
];
interface BoxRow {
  key: BoxKey;
  label: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
}

// MOCK approval rows — TODO api.get('/api/v1/approvals?box=...')
const MOCK_ROWS = [
  {
    id: 'apr-1',
    objectId: 'obj-1',
    title: 'R3 개정 결재',
    sender: '박영호',
    objectNumber: 'CGL-MEC-2026-00012',
    objectName: '메인롤러 어셈블리',
    submittedAt: '2026-04-24',
    dueAt: '2026-04-26',
    currentStep: '2/3',
    revision: 'R3',
    reason: '베어링 사양 변경',
    issueCount: 2,
    box: 'waiting' as BoxKey,
    steps: [
      { order: 1, approver: '김지원', status: 'APPROVED', actedAt: '4/24 09:12', comment: '검토 완료' },
      { order: 2, approver: '박상민', status: 'IN_PROGRESS', actedAt: null },
      { order: 3, approver: '최정아', status: 'PENDING', actedAt: null },
    ] satisfies ApprovalStep[],
  },
  {
    id: 'apr-2',
    objectId: 'obj-4',
    title: 'R1 신규 결재',
    sender: '김철수',
    objectNumber: 'BFM-PRC-2026-00008',
    objectName: '소둔로 공정 P&ID',
    submittedAt: '2026-04-23',
    dueAt: '2026-04-27',
    currentStep: '1/2',
    revision: 'R1',
    reason: '신규 등록',
    issueCount: 1,
    box: 'waiting' as BoxKey,
    steps: [
      { order: 1, approver: '김지원', status: 'IN_PROGRESS', actedAt: null },
      { order: 2, approver: '박상민', status: 'PENDING', actedAt: null },
    ] satisfies ApprovalStep[],
  },
  {
    id: 'apr-3',
    objectId: 'obj-3',
    title: 'R2 개정 결재',
    sender: '최정아',
    objectNumber: 'CGL-ELE-2026-00031',
    objectName: '메인 컨트롤 패널',
    submittedAt: '2026-04-22',
    dueAt: '2026-04-26',
    currentStep: '2/3',
    revision: 'R2',
    reason: '마크업 반영',
    issueCount: 0,
    box: 'waiting' as BoxKey,
    steps: [
      { order: 1, approver: '김지원', status: 'APPROVED', actedAt: '4/22 10:30' },
      { order: 2, approver: '박상민', status: 'IN_PROGRESS', actedAt: null },
      { order: 3, approver: '임도현', status: 'PENDING', actedAt: null },
    ] satisfies ApprovalStep[],
  },
  {
    id: 'apr-4',
    objectId: 'obj-2',
    title: 'R1 신규 결재',
    sender: '박설계',
    objectNumber: 'CGL-MEC-2026-00002',
    objectName: 'CGL #2 컨베이어 조립도',
    submittedAt: '2026-04-15',
    dueAt: '2026-04-18',
    currentStep: '2/2',
    revision: 'R1',
    reason: '신규 등록',
    issueCount: 0,
    box: 'done' as BoxKey,
    steps: [
      { order: 1, approver: '김지원', status: 'APPROVED', actedAt: '4/15 14:02' },
      { order: 2, approver: '박상민', status: 'APPROVED', actedAt: '4/16 09:11' },
    ] satisfies ApprovalStep[],
  },
  {
    id: 'apr-5',
    objectId: 'obj-5',
    title: 'R1 신규 결재',
    sender: '박설계',
    objectNumber: 'CGL-PRC-2026-00005',
    objectName: 'CGL 공정 P&ID',
    submittedAt: '2026-04-10',
    dueAt: '2026-04-17',
    currentStep: '2/2',
    revision: 'R1',
    reason: '현장 배포 전 승인',
    issueCount: 3,
    box: 'sent' as BoxKey,
    steps: [
      { order: 1, approver: '김지원', status: 'APPROVED', actedAt: '4/10 11:00' },
      { order: 2, approver: '박상민', status: 'IN_PROGRESS', actedAt: null },
    ] satisfies ApprovalStep[],
  },
  {
    id: 'apr-6',
    objectId: 'obj-1',
    title: 'R2 개정 결재 (회수됨)',
    sender: '김설계',
    objectNumber: 'CGL-MEC-2026-00001',
    objectName: 'CGL #1 라인 펌프 설치도',
    submittedAt: '2026-04-08',
    dueAt: '2026-04-12',
    currentStep: '0/1',
    revision: 'R2',
    reason: '승인선 오류',
    issueCount: 1,
    box: 'recall' as BoxKey,
    steps: [
      { order: 1, approver: '김지원', status: 'PENDING', actedAt: null },
    ] satisfies ApprovalStep[],
  },
];

const BOXES: BoxRow[] = BOX_META.map((b) => ({
  ...b,
  count: MOCK_ROWS.filter((r) => r.box === b.key).length,
}));

export default function ApprovalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const box = (searchParams?.get('box') as BoxKey | null) ?? 'waiting';
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [newApprovalOpen, setNewApprovalOpen] = React.useState(false);

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
            onClick={() => setNewApprovalOpen(true)}
            className="app-action-button w-full"
          >
            <Plus className="h-4 w-4" />
            새 결재 상신
          </button>
        }
      >
        <ul role="radiogroup" aria-label="결재함 분류" className="space-y-1">
          {BOXES.map((b) => {
            const active = b.key === box;
            const Icon = b.icon;
            return (
              <li key={b.key}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
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
        <div className="flex min-h-16 items-center justify-between gap-4 border-b border-border bg-bg px-5 py-3">
          <div>
            <div className="app-kicker">Approval Inbox</div>
            <h1 className="mt-1 text-lg font-semibold text-fg">
              {BOXES.find((b) => b.key === box)?.label} 결재 ({rows.length})
            </h1>
          </div>
          <button type="button" className="app-action-button">
            <RotateCcw className="h-4 w-4" />
            새로고침
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {rows.length === 0 ? (
            <EmptyState
              icon={Clock4}
              title="해당 결재함에 항목이 없습니다."
              className="m-6 min-h-80"
            />
          ) : (
            <table className="app-table">
              <thead>
                <tr>
                  <th className="w-8"></th>
                  <th>제목</th>
                  <th>단계</th>
                  <th>자료번호</th>
                  <th>Rev</th>
                  <th>변경 사유</th>
                  <th>이슈</th>
                  <th>상신일</th>
                  <th>기한</th>
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
                        'cursor-pointer hover:bg-bg-subtle',
                        isSelected && 'bg-brand/5 shadow-[inset_3px_0_0_hsl(var(--brand))]',
                      )}
                    >
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label="선택"
                          onClick={(e) => e.stopPropagation()}
                          className="h-3.5 w-3.5 rounded border-border accent-brand"
                        />
                      </td>
                      <td>
                        <span className="block font-medium text-fg">{r.title}</span>
                        <span className="text-[12px] text-fg-muted">{r.sender}</span>
                      </td>
                      <td>
                        <span className="inline-flex h-6 items-center rounded-md border border-border bg-bg-subtle px-2 font-mono text-[12px] font-semibold text-fg">
                          {r.currentStep}
                        </span>
                      </td>
                      <td>
                        <Link
                          href={`/objects/${r.objectId}`}
                          className="font-mono text-[12px] text-fg hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.objectNumber}
                        </Link>
                      </td>
                      <td className="font-mono text-[12px] font-semibold text-fg">{r.revision}</td>
                      <td className="max-w-44 truncate text-[12px] text-fg-muted">{r.reason}</td>
                      <td>
                        <span className={cn('inline-flex items-center gap-1 text-[12px]', r.issueCount > 0 ? 'text-danger' : 'text-fg-muted')}>
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {r.issueCount}
                        </span>
                      </td>
                      <td className="font-mono text-[12px] text-fg-muted">{r.submittedAt}</td>
                      <td className="font-mono text-[12px] text-fg-muted">{r.dueAt}</td>
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
              className="inline-flex h-7 items-center gap-1 rounded bg-success/10 px-2 text-success hover:bg-success/20"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> 승인
            </button>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1 rounded bg-danger/10 px-2 text-danger hover:bg-danger/20"
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
          className="flex h-full w-[440px] shrink-0 flex-col border-l border-border bg-bg"
        >
          <div className="app-panel-header min-h-11">
            <span className="app-kicker">결재 상세</span>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="닫기"
              className="app-icon-button h-7 w-7"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4 text-sm">
            <h3 className="text-base font-semibold text-fg">{selected.title}</h3>
            <p className="mt-1 text-xs text-fg-muted">
              {selected.sender} · {selected.submittedAt}
            </p>

            <div className="mt-4 overflow-hidden rounded-lg border border-border bg-bg">
              <div className="flex h-9 items-center justify-between border-b border-border px-3">
                <span className="font-mono text-[12px] font-semibold text-fg">{selected.objectNumber}</span>
                <span className="inline-flex h-6 items-center rounded-md border border-brand/25 bg-brand/10 px-2 font-mono text-[12px] font-semibold text-brand">
                  {selected.revision}
                </span>
              </div>
              <div className="flex aspect-[4/3] items-center justify-center bg-[linear-gradient(90deg,hsl(var(--viewer-grid))_1px,transparent_1px),linear-gradient(0deg,hsl(var(--viewer-grid))_1px,transparent_1px)] bg-[size:22px_22px]">
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-bg/90 text-fg-subtle shadow-sm">
                  <FileText className="h-8 w-8" />
                </div>
              </div>
              <div className="grid grid-cols-3 divide-x divide-border border-t border-border text-[12px]">
                <div className="p-2">
                  <div className="text-fg-muted">단계</div>
                  <div className="font-semibold text-fg">{selected.currentStep}</div>
                </div>
                <div className="p-2">
                  <div className="text-fg-muted">이슈</div>
                  <div className={cn('font-semibold', selected.issueCount > 0 ? 'text-danger' : 'text-fg')}>
                    {selected.issueCount}건
                  </div>
                </div>
                <div className="p-2">
                  <div className="text-fg-muted">기한</div>
                  <div className="font-mono font-semibold text-fg">{selected.dueAt}</div>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-md border border-border bg-bg-subtle p-3">
              <div className="text-xs text-fg-muted">자료</div>
              <Link
                href={`/objects/${selected.objectId}`}
                className="font-mono text-sm text-fg hover:underline"
              >
                {selected.objectNumber}
              </Link>
              <div className="text-sm text-fg-muted">{selected.objectName}</div>
            </div>

            <div className="mt-4">
              <div className="app-kicker mb-2">결재선</div>
              <ApprovalLine steps={selected.steps} orientation="vertical" />
            </div>

            <div className="mt-4">
              <label className="app-kicker mb-1 block">
                코멘트
              </label>
              <textarea
                rows={4}
                className="w-full rounded-md border border-border bg-bg-subtle p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="검토 의견을 입력하세요…"
              />
            </div>
          </div>
          <div className="border-t border-border bg-bg p-3">
            <div className="mb-2 grid grid-cols-2 gap-2">
              <button type="button" className="app-action-button h-8">
                <GitCompare className="h-3.5 w-3.5" />
                비교 열기
              </button>
              <Link href={`/objects/${selected.objectId}`} className="app-action-button h-8">
                상세 보기
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="inline-flex h-9 items-center justify-center gap-1 rounded-md bg-success px-3 text-sm font-semibold text-white hover:bg-success/90">
                <CheckCircle2 className="h-4 w-4" />
                승인
              </button>
              <button type="button" className="inline-flex h-9 items-center justify-center gap-1 rounded-md bg-danger px-3 text-sm font-semibold text-white hover:bg-danger/90">
                <XCircle className="h-4 w-4" />
                반려
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* New approval dialog (BUG-017). Inline fallback until Designer-2's
          `<NewApprovalDialog />` lands at `@/components/approval/NewApprovalDialog`. */}
      <Dialog open={newApprovalOpen} onOpenChange={setNewApprovalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>새 결재 상신</DialogTitle>
            <DialogDescription>
              결재할 자료와 결재선을 선택해 상신합니다. 정식 폼은 곧 제공됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="app-kicker mb-1 block">대상 자료번호</span>
              <input
                type="text"
                placeholder="예: CGL-MEC-2026-00012"
                className="h-9 w-full rounded-md border border-border bg-bg px-2 font-mono text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="block">
              <span className="app-kicker mb-1 block">결재선</span>
              <select className="h-9 w-full rounded-md border border-border bg-bg px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option>표준 3단계 (검토→승인→통보)</option>
                <option>긴급 2단계 (승인→통보)</option>
              </select>
            </label>
            <label className="block">
              <span className="app-kicker mb-1 block">코멘트</span>
              <textarea
                rows={3}
                placeholder="상신 사유나 변경 요지를 입력하세요…"
                className="w-full rounded-md border border-border bg-bg p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setNewApprovalOpen(false)}
              className="app-action-button h-9"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => setNewApprovalOpen(false)}
              className="app-action-button-primary h-9"
            >
              상신
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
