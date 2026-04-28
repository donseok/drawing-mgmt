'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Archive,
  CheckCircle2,
  Clock4,
  FileText,
  GitCompare,
  Inbox,
  RotateCcw,
  Send,
  X,
  XCircle,
} from 'lucide-react';
import { DrawingPlaceholder } from '@/components/DrawingPlaceholder';
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
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';

type BoxKey = 'waiting' | 'done' | 'sent' | 'recall';

interface BoxMeta {
  key: BoxKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  emptyTitle: string;
  emptyDescription: string;
}

const BOX_META: BoxMeta[] = [
  {
    key: 'waiting',
    label: '대기',
    icon: Inbox,
    emptyTitle: '대기 중인 결재가 없습니다.',
    emptyDescription: '내가 결재해야 할 항목이 들어오면 여기 표시됩니다.',
  },
  {
    key: 'done',
    label: '처리완료',
    icon: CheckCircle2,
    emptyTitle: '아직 처리한 결재가 없습니다.',
    emptyDescription: '결재를 승인 또는 반려하면 여기에 누적됩니다.',
  },
  {
    key: 'sent',
    label: '상신함',
    icon: Send,
    emptyTitle: '아직 상신한 결재가 없습니다.',
    emptyDescription: '자료 상세에서 [결재 상신]을 누르면 여기 표시됩니다.',
  },
  {
    key: 'recall',
    label: '회수',
    icon: Archive,
    emptyTitle: '회수한 결재가 없습니다.',
    emptyDescription: '내가 상신한 결재를 회수했을 때 보관되는 곳입니다.',
  },
];

// ── BE shapes (mirrors /api/v1/approvals baseInclude) ─────────────────────
interface ApproverDTO {
  id: string;
  username: string;
  fullName: string | null;
}
interface StepDTO {
  id: string;
  order: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approver: ApproverDTO;
  comment: string | null;
  actedAt: string | null;
}
interface ApprovalDTO {
  id: string;
  title: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
  completedAt: string | null;
  requester: ApproverDTO;
  steps: StepDTO[];
  revision: {
    rev: number;
    object: {
      id: string;
      number: string;
      name: string;
      state: string;
      folderId: string;
      deletedAt: string | null;
    };
  };
}

type ApprovalListResponse = ApprovalDTO[];

function formatYmd(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function activeStepNumber(approval: ApprovalDTO): string {
  // "n/N" — n is the lowest-order PENDING step, N is total steps. Reaches
  // "N/N" once the last PENDING step lands.
  const n = approval.steps.length;
  const pending = approval.steps
    .filter((s) => s.status === 'PENDING')
    .map((s) => s.order);
  if (approval.status !== 'PENDING' || pending.length === 0) {
    return `${n}/${n}`;
  }
  return `${Math.min(...pending)}/${n}`;
}

export default function ApprovalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const box = (searchParams?.get('box') as BoxKey | null) ?? 'waiting';
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [comment, setComment] = React.useState('');
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [newApprovalOpen, setNewApprovalOpen] = React.useState(false);

  const setBox = (next: BoxKey) => {
    const sp = new URLSearchParams(searchParams?.toString());
    sp.set('box', next);
    router.replace(`/approval?${sp.toString()}`);
    setSelectedId(null);
    setComment('');
  };

  const listQuery = useQuery<ApprovalListResponse, ApiError>({
    queryKey: queryKeys.approvals.list(box),
    queryFn: () =>
      api.get<ApprovalListResponse>('/api/v1/approvals', { query: { box } }),
    staleTime: 15_000,
  });

  // Per-box counts for the sidebar — issue counts in parallel so the badges
  // stay accurate when navigating boxes.
  const countQueries = {
    waiting: useQuery<ApprovalListResponse, ApiError>({
      queryKey: queryKeys.approvals.list('waiting'),
      queryFn: () =>
        api.get<ApprovalListResponse>('/api/v1/approvals', {
          query: { box: 'waiting' },
        }),
      staleTime: 15_000,
    }),
    done: useQuery<ApprovalListResponse, ApiError>({
      queryKey: queryKeys.approvals.list('done'),
      queryFn: () =>
        api.get<ApprovalListResponse>('/api/v1/approvals', {
          query: { box: 'done' },
        }),
      staleTime: 15_000,
    }),
    sent: useQuery<ApprovalListResponse, ApiError>({
      queryKey: queryKeys.approvals.list('sent'),
      queryFn: () =>
        api.get<ApprovalListResponse>('/api/v1/approvals', {
          query: { box: 'sent' },
        }),
      staleTime: 15_000,
    }),
    recall: useQuery<ApprovalListResponse, ApiError>({
      queryKey: queryKeys.approvals.list('recall'),
      queryFn: () =>
        api.get<ApprovalListResponse>('/api/v1/approvals', {
          query: { box: 'recall' },
        }),
      staleTime: 15_000,
    }),
  };

  // Surface fetch failures via toast once per error instance.
  const listErr = listQuery.error;
  React.useEffect(() => {
    if (!listErr) return;
    toast.error('결재함 조회 실패', { description: listErr.message });
  }, [listErr]);

  const rows = listQuery.data ?? [];
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  // ── Action mutations (BUG-07) ──────────────────────────────────────────
  // approve / reject / recall fan out through the unified action endpoint
  // (/api/v1/approvals/:id/action) so the BE keeps state-machine logic
  // centralized. Defer is intentionally omitted — the inbox UI doesn't
  // expose it yet (R4c card).

  type ApprovalAction = 'approve' | 'reject' | 'recall';
  const ACTION_LABEL: Record<ApprovalAction, string> = {
    approve: '승인',
    reject: '반려',
    recall: '회수',
  };

  const actionMutation = useMutation<
    unknown,
    ApiError,
    { id: string; action: ApprovalAction; comment?: string }
  >({
    mutationFn: ({ id, action, comment: c }) =>
      api.post(`/api/v1/approvals/${id}/action`, {
        action,
        ...(c ? { comment: c } : {}),
      }),
    onSuccess: (_d, vars) => {
      // Refresh the list for every box (approve/reject can move rows between
      // waiting → done; recall moves sent → recall) and any object detail
      // that was reading the same approval.
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.all() });
      toast.success(`${ACTION_LABEL[vars.action]} 완료`);
      setComment('');
      setRejectOpen(false);
      // Drop selection if the row is no longer in the current box.
      setSelectedId(null);
    },
    onError: (err, vars) => {
      toast.error(`${ACTION_LABEL[vars.action]} 실패`, { description: err.message });
    },
  });

  const handleApprove = () => {
    if (!selected) return;
    actionMutation.mutate({
      id: selected.id,
      action: 'approve',
      comment: comment.trim() || undefined,
    });
  };

  const handleRejectOpen = () => {
    if (!selected) return;
    setRejectOpen(true);
  };

  const handleRejectConfirm = () => {
    if (!selected) return;
    const trimmed = comment.trim();
    if (trimmed.length === 0) {
      toast.error('반려 사유를 입력해주세요.');
      return;
    }
    actionMutation.mutate({ id: selected.id, action: 'reject', comment: trimmed });
  };

  const handleRecall = () => {
    if (!selected) return;
    actionMutation.mutate({ id: selected.id, action: 'recall' });
  };

  const showActionBar = selected && box === 'waiting';
  const showRecall = selected && box === 'sent' && selected.status === 'PENDING';

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
            <Send className="h-4 w-4" />새 결재 상신
          </button>
        }
      >
        <ul role="radiogroup" aria-label="결재함 분류" className="space-y-1">
          {BOX_META.map((b) => {
            const active = b.key === box;
            const Icon = b.icon;
            const count = countQueries[b.key].data?.length ?? 0;
            return (
              <li key={b.key}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setBox(b.key)}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors',
                    active
                      ? 'bg-bg text-fg shadow-sm ring-1 ring-border'
                      : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
                  )}
                >
                  <Icon className={cn('h-4 w-4', active ? 'text-brand-500' : 'text-fg-subtle')} />
                  <span className="flex-1 text-left">{b.label}</span>
                  <span className="rounded bg-bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-fg-muted">
                    {count}
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
              {BOX_META.find((b) => b.key === box)?.label} 결재 ({rows.length})
            </h1>
          </div>
          <button
            type="button"
            onClick={() => listQuery.refetch()}
            disabled={listQuery.isFetching}
            className="app-action-button"
          >
            <RotateCcw className="h-4 w-4" />
            새로고침
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {listQuery.isPending ? (
            <div className="m-6 space-y-2" role="status" aria-busy="true">
              {Array.from({ length: 4 }, (_, i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-md border border-border bg-bg-muted/60"
                />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Clock4}
              title={BOX_META.find((b) => b.key === box)!.emptyTitle}
              description={BOX_META.find((b) => b.key === box)!.emptyDescription}
              className="m-6 min-h-80"
            />
          ) : (
            <table className="app-table">
              <thead>
                <tr>
                  <th>제목</th>
                  <th>단계</th>
                  <th>자료번호</th>
                  <th>Rev</th>
                  <th>상신일</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isSelected = r.id === selectedId;
                  const obj = r.revision.object;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={cn(
                        'cursor-pointer hover:bg-bg-subtle',
                        isSelected && 'bg-brand/5 shadow-[inset_3px_0_0_hsl(var(--brand))]',
                      )}
                    >
                      <td>
                        <span className="block font-medium text-fg">{r.title}</span>
                        <span className="text-[12px] text-fg-muted">
                          {r.requester.fullName ?? r.requester.username}
                        </span>
                      </td>
                      <td>
                        <span className="inline-flex h-6 items-center rounded-md border border-border bg-bg-subtle px-2 font-mono text-[12px] font-semibold text-fg">
                          {activeStepNumber(r)}
                        </span>
                      </td>
                      <td>
                        <Link
                          href={`/objects/${obj.id}`}
                          className="font-mono text-[12px] text-fg hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {obj.number}
                        </Link>
                      </td>
                      <td className="font-mono text-[12px] font-semibold text-fg">
                        R{r.revision.rev}
                      </td>
                      <td className="font-mono text-[12px] text-fg-muted">
                        {formatYmd(r.createdAt)}
                      </td>
                      <td>
                        <span
                          className={cn(
                            'inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-medium',
                            r.status === 'PENDING'
                              ? 'border-brand/30 bg-brand/10 text-brand'
                              : r.status === 'APPROVED'
                                ? 'border-success/30 bg-success/10 text-success'
                                : r.status === 'REJECTED'
                                  ? 'border-danger/30 bg-danger/10 text-danger'
                                  : 'border-border bg-bg-subtle text-fg-muted',
                          )}
                        >
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {showActionBar ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-brand/5 px-4 py-2 text-sm">
            <span className="font-medium text-fg">선택된 항목 1건</span>
            <span className="mx-2 text-border-strong">|</span>
            {/* R37 AC-1: ad-hoc native buttons (vs Button component) needed
                explicit focus-visible rings to keep keyboard nav visible. */}
            <button
              type="button"
              onClick={handleApprove}
              disabled={actionMutation.isPending}
              className="inline-flex h-7 items-center gap-1 rounded bg-success/10 px-2 text-success hover:bg-success/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-bg disabled:opacity-60"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> 승인
            </button>
            <button
              type="button"
              onClick={handleRejectOpen}
              disabled={actionMutation.isPending}
              className="inline-flex h-7 items-center gap-1 rounded bg-danger/10 px-2 text-danger hover:bg-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-bg disabled:opacity-60"
            >
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> 반려
            </button>
          </div>
        ) : null}

        {showRecall ? (
          <div className="flex items-center gap-2 border-t border-border bg-bg-subtle px-4 py-2 text-sm">
            <span className="font-medium text-fg">선택된 항목 1건</span>
            <span className="mx-2 text-border-strong">|</span>
            <button
              type="button"
              onClick={handleRecall}
              disabled={actionMutation.isPending}
              className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 hover:bg-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-bg disabled:opacity-60"
            >
              <Archive className="h-3.5 w-3.5" aria-hidden="true" /> 회수
            </button>
          </div>
        ) : null}
      </section>

      {selected && (
        <aside
          aria-label="결재 상세"
          className={cn(
            'flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-l border-border bg-bg',
            // Mobile: full-width overlay so the user can read the detail
            // without horizontal scroll. md+: fixed 440 px side panel.
            'fixed inset-0 z-30 w-full md:relative md:inset-auto md:z-auto md:w-[440px]',
          )}
        >
          <div className="app-panel-header min-h-11">
            <span className="app-kicker">결재 상세</span>
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setComment('');
              }}
              aria-label="닫기"
              className="app-icon-button h-7 w-7"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4 text-sm">
            <h3 className="text-base font-semibold text-fg">{selected.title}</h3>
            <p className="mt-1 text-xs text-fg-muted">
              {selected.requester.fullName ?? selected.requester.username} ·{' '}
              {formatYmd(selected.createdAt)}
            </p>

            <div className="mt-4 overflow-hidden rounded-lg border border-border bg-bg">
              <div className="flex h-9 items-center justify-between border-b border-border px-3">
                <span className="font-mono text-[12px] font-semibold text-fg">
                  {selected.revision.object.number}
                </span>
                <span className="inline-flex h-6 items-center rounded-md border border-brand/25 bg-brand/10 px-2 font-mono text-[12px] font-semibold text-brand">
                  R{selected.revision.rev}
                </span>
              </div>
              <DrawingPlaceholder
                gridSize={22}
                icon={FileText}
                className="aspect-[4/3] h-auto"
              />
              <div className="grid grid-cols-3 divide-x divide-border border-t border-border text-[12px]">
                <div className="p-2">
                  <div className="text-fg-muted">단계</div>
                  <div className="font-semibold text-fg">{activeStepNumber(selected)}</div>
                </div>
                <div className="p-2">
                  <div className="text-fg-muted">상태</div>
                  <div className="font-semibold text-fg">
                    {STATUS_LABEL[selected.status]}
                  </div>
                </div>
                <div className="p-2">
                  <div className="text-fg-muted">상신</div>
                  <div className="font-mono font-semibold text-fg">
                    {formatYmd(selected.createdAt)}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-md border border-border bg-bg-subtle p-3">
              <div className="text-xs text-fg-muted">자료</div>
              <Link
                href={`/objects/${selected.revision.object.id}`}
                className="font-mono text-sm text-fg hover:underline"
              >
                {selected.revision.object.number}
              </Link>
              <div className="text-sm text-fg-muted">{selected.revision.object.name}</div>
            </div>

            <div className="mt-4">
              <div className="app-kicker mb-2">결재선</div>
              <ApprovalLine
                steps={selected.steps.map<ApprovalStep>((s) => ({
                  order: s.order,
                  approver: s.approver.fullName ?? s.approver.username,
                  status: s.status,
                  actedAt: s.actedAt,
                  comment: s.comment,
                }))}
                orientation="vertical"
              />
            </div>

            {box === 'waiting' ? (
              <div className="mt-4">
                <label className="app-kicker mb-1 block">코멘트 (선택)</label>
                <textarea
                  rows={4}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="w-full rounded-md border border-border bg-bg-subtle p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="검토 의견을 입력하세요…"
                />
              </div>
            ) : null}
          </div>
          <div className="border-t border-border bg-bg p-3">
            <div className="mb-2 grid grid-cols-2 gap-2">
              <button type="button" className="app-action-button h-8" disabled>
                <GitCompare className="h-3.5 w-3.5" />
                비교 열기
              </button>
              <Link
                href={`/objects/${selected.revision.object.id}`}
                className="app-action-button h-8"
              >
                상세 보기
              </Link>
            </div>
            {box === 'waiting' ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={actionMutation.isPending}
                  className="inline-flex h-9 items-center justify-center gap-1 rounded-md bg-success px-3 text-sm font-semibold text-white hover:bg-success/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  승인
                </button>
                <button
                  type="button"
                  onClick={handleRejectOpen}
                  disabled={actionMutation.isPending}
                  className="inline-flex h-9 items-center justify-center gap-1 rounded-md bg-danger px-3 text-sm font-semibold text-white hover:bg-danger/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-60"
                >
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                  반려
                </button>
              </div>
            ) : null}
          </div>
        </aside>
      )}

      {/* Reject confirm dialog — BE requires a non-empty comment for reject. */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>결재 반려</DialogTitle>
            <DialogDescription>
              반려 사유를 입력해주세요. 반려 시 자료는 다시 수정/재상신 단계로 돌아갑니다.
            </DialogDescription>
          </DialogHeader>
          <textarea
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="반려 사유 (필수)"
            className="w-full rounded-md border border-border bg-bg-subtle p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <DialogFooter>
            <button
              type="button"
              onClick={() => setRejectOpen(false)}
              disabled={actionMutation.isPending}
              className="app-action-button h-9"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleRejectConfirm}
              disabled={actionMutation.isPending || !comment.trim()}
              className="inline-flex h-9 items-center justify-center gap-1 rounded-md bg-danger px-3 text-sm font-semibold text-white hover:bg-danger/90 disabled:opacity-60"
            >
              <XCircle className="h-4 w-4" />
              반려
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New approval — direct the user to /search to pick the source object;
          the full submit flow lives in <NewApprovalDialog> on the search page
          where the row context (objectId/number/name) is already in hand. */}
      <Dialog open={newApprovalOpen} onOpenChange={setNewApprovalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>새 결재 상신</DialogTitle>
            <DialogDescription>
              상신할 자료를 검색 화면에서 선택한 후 행 메뉴의 “결재상신”을 사용하세요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setNewApprovalOpen(false)}
              className="app-action-button h-9"
            >
              취소
            </button>
            <Link
              href="/search?state=CHECKED_IN"
              onClick={() => setNewApprovalOpen(false)}
              className="app-action-button-primary h-9"
            >
              자료 검색으로 이동
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const STATUS_LABEL: Record<ApprovalDTO['status'], string> = {
  PENDING: '진행 중',
  APPROVED: '승인',
  REJECTED: '반려',
  CANCELLED: '회수',
};
