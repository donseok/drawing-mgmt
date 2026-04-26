'use client';

/**
 * Lobby detail — recipient + requester view of a transmittal package.
 *
 * R19 — wired to live data:
 *   - `/api/v1/lobbies/:id` for the package metadata + attachments.
 *   - `/api/v1/lobbies/:id/replies` GET for the conversation thread,
 *     POST for new replies. Reply UI now ships a real comment + optional
 *     decision (COMMENT / APPROVE / REJECT / REVISE_REQUESTED) instead of the
 *     R3 placeholder toast.
 */

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CheckCircle2,
  Clock4,
  Download,
  FileText,
  MessageSquare,
  Paperclip,
  Send,
  X,
  XCircle,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';
import { cn } from '@/lib/cn';

interface LobbyDetailDTO {
  id: string;
  title: string;
  description: string | null;
  expiresAt: string | null;
  status: string;
  createdAt: string;
  folderId: string;
  createdBy: string;
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: string; // BigInt → string via safeJsonStringify
    createdAt: string;
  }>;
  targets: Array<{ id: string; companyId: string }>;
}

type ReplyDecision = 'COMMENT' | 'APPROVE' | 'REJECT' | 'REVISE_REQUESTED';

interface ReplyDTO {
  id: string;
  userId: string;
  author: string;
  comment: string;
  decision: ReplyDecision;
  createdAt: string;
}

const DECISION_META: Record<
  ReplyDecision,
  { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }
> = {
  COMMENT: { label: '코멘트', tone: 'text-fg-muted', icon: MessageSquare },
  APPROVE: { label: '승인', tone: 'text-success', icon: CheckCircle2 },
  REJECT: { label: '반려', tone: 'text-danger', icon: XCircle },
  REVISE_REQUESTED: { label: '수정 요청', tone: 'text-warning', icon: Clock4 },
};

const STATUS_LABEL: Record<string, string> = {
  NEW: '신규',
  IN_REVIEW: '검토 중',
  IN_APPROVAL: '결재 진행',
  COMPLETED: '완료',
  EXPIRED: '만료',
};

function formatBytes(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function LobbyDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const lobbyId = params.id;

  const lobbyQuery = useQuery<LobbyDetailDTO, ApiError>({
    queryKey: queryKeys.lobby.detail(lobbyId),
    queryFn: () => api.get<LobbyDetailDTO>(`/api/v1/lobbies/${lobbyId}`),
    staleTime: 30_000,
  });
  const repliesQuery = useQuery<{ items: ReplyDTO[] }, ApiError>({
    queryKey: ['lobby', 'replies', lobbyId],
    queryFn: () =>
      api.get<{ items: ReplyDTO[] }>(`/api/v1/lobbies/${lobbyId}/replies`),
    staleTime: 15_000,
    enabled: !!lobbyId,
  });

  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [comment, setComment] = React.useState('');
  const [decision, setDecision] = React.useState<ReplyDecision>('COMMENT');

  const replyMutation = useMutation<
    { id: string; decision: ReplyDecision; statusFlip: string | null },
    ApiError,
    { comment: string; decision: ReplyDecision }
  >({
    mutationFn: (vars) =>
      api.post(`/api/v1/lobbies/${lobbyId}/replies`, vars),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({
        queryKey: ['lobby', 'replies', lobbyId],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.lobby.detail(lobbyId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.lobby.all() });
      const note = res.statusFlip
        ? ` (상태가 ${STATUS_LABEL[res.statusFlip] ?? res.statusFlip}(으)로 변경됨)`
        : '';
      toast.success(`회신을 등록했습니다${note}`);
      setReviewOpen(false);
      setComment('');
      setDecision('COMMENT');
    },
    onError: (err) => {
      toast.error('회신 실패', { description: err.message });
    },
  });

  const lobby = lobbyQuery.data;
  const replies = repliesQuery.data?.items ?? [];

  if (lobbyQuery.isPending) {
    return <DetailSkeleton />;
  }
  if (lobbyQuery.isError || !lobby) {
    return (
      <div className="m-6 rounded-md border border-border bg-bg p-10 text-center">
        <h2 className="text-lg font-semibold text-fg">패키지를 불러오지 못했습니다</h2>
        <p className="mt-2 text-sm text-fg-muted">
          {lobbyQuery.error?.message ?? '알 수 없는 오류'}
        </p>
        <Link href="/lobby" className="app-action-button mt-4">
          <ArrowLeft className="h-3.5 w-3.5" />
          로비함으로
        </Link>
      </div>
    );
  }

  const submitReply = () => {
    if (!comment.trim()) {
      toast.error('회신 내용을 입력해주세요.');
      return;
    }
    replyMutation.mutate({ comment: comment.trim(), decision });
  };

  return (
    <div className="flex-1 overflow-auto bg-bg">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
        <Link href="/lobby" className="app-icon-button h-8 w-8" aria-label="로비함으로 돌아가기">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="text-fg-muted">로비함</span>
        <span className="text-fg-subtle">/</span>
        <span className="font-medium text-fg">{lobby.id}</span>
      </div>

      <div className="border-b border-border px-6 py-5">
        <div className="app-kicker">Partner Package</div>
        <div className="mt-1 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-fg">{lobby.title}</h1>
            <p className="mt-1 text-sm text-fg-muted">
              {STATUS_LABEL[lobby.status] ?? lobby.status}
              {lobby.expiresAt
                ? ` · 만료 ${formatDateTime(lobby.expiresAt)}`
                : ''}
            </p>
            {lobby.description ? (
              <p className="mt-2 max-w-2xl text-sm text-fg-muted">{lobby.description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            className="app-action-button-primary h-9"
          >
            <Send className="h-4 w-4" />
            검토 회신
          </button>
        </div>
      </div>

      {reviewOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="검토 회신"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReviewOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-bg p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-fg">검토 회신</h2>
              <button
                type="button"
                aria-label="닫기"
                onClick={() => setReviewOpen(false)}
                className="app-icon-button h-7 w-7"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-xs text-fg-muted">
              협력업체/요청자에게 회신할 내용을 입력하세요. 결정을 함께 보내면
              패키지 상태가 자동으로 갱신됩니다.
            </p>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={5}
              placeholder="검토 의견 또는 요청사항…"
              className="w-full rounded-md border border-border bg-bg-subtle p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="mt-3">
              <span className="app-kicker mb-1 block">결정</span>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(DECISION_META) as ReplyDecision[]).map((d) => {
                  const meta = DECISION_META[d];
                  const Icon = meta.icon;
                  const active = decision === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDecision(d)}
                      aria-pressed={active}
                      className={cn(
                        'inline-flex h-7 items-center gap-1 rounded border px-2 text-[12px] transition-colors',
                        active
                          ? 'border-brand bg-brand/10 text-brand'
                          : 'border-border text-fg-muted hover:bg-bg-muted hover:text-fg',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReviewOpen(false)}
                disabled={replyMutation.isPending}
                className="app-action-button h-9"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitReply}
                disabled={replyMutation.isPending || !comment.trim()}
                className="app-action-button-primary h-9 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {replyMutation.isPending ? '전송 중…' : '회신 보내기'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 p-6 xl:grid-cols-[1fr_360px]">
        <section className="app-panel overflow-hidden">
          <div className="app-panel-header">
            <span className="app-kicker">첨부 자료</span>
            <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
              <Paperclip className="h-3.5 w-3.5" />
              {lobby.attachments.length}건
            </span>
          </div>
          {lobby.attachments.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-fg-muted">
              첨부된 자료가 없습니다.
            </div>
          ) : (
            <ul>
              {lobby.attachments.map((file) => (
                <li
                  key={file.id}
                  className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <FileText className="h-4 w-4 text-fg-muted" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">
                    {file.filename}
                  </span>
                  <span className="font-mono text-xs text-fg-muted">
                    {formatBytes(file.size)}
                  </span>
                  <a
                    href={`/api/v1/lobbies/${lobby.id}/attachments/${file.id}/file`}
                    download={file.filename}
                    aria-label="다운로드"
                    className="app-icon-button inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-4">
          <section className="app-panel p-4">
            <div className="app-kicker">패키지 정보</div>
            <dl className="mt-3 grid grid-cols-[88px_1fr] gap-y-2 text-sm">
              <dt className="text-fg-muted">상태</dt>
              <dd className="font-medium text-fg">
                {STATUS_LABEL[lobby.status] ?? lobby.status}
              </dd>
              <dt className="text-fg-muted">대상</dt>
              <dd className="text-fg">
                {lobby.targets.length === 0 ? '없음' : `${lobby.targets.length}곳`}
              </dd>
              <dt className="text-fg-muted">생성일</dt>
              <dd className="font-mono text-fg">{formatDateTime(lobby.createdAt)}</dd>
              <dt className="text-fg-muted">만료일</dt>
              <dd className="inline-flex items-center gap-1 font-mono text-fg">
                <Clock4 className="h-3.5 w-3.5 text-fg-muted" />
                {lobby.expiresAt ? formatDateTime(lobby.expiresAt) : '없음'}
              </dd>
            </dl>
          </section>

          <section className="app-panel overflow-hidden">
            <div className="app-panel-header">
              <span className="app-kicker">회신</span>
              <span className="text-[11px] text-fg-muted">
                {replies.length}건
              </span>
            </div>
            <ul className="divide-y divide-border">
              {repliesQuery.isPending ? (
                <li className="space-y-2 px-4 py-3" role="status" aria-busy="true">
                  {Array.from({ length: 3 }, (_, i) => (
                    <div
                      key={i}
                      className="h-12 animate-pulse rounded-md bg-bg-muted/60"
                    />
                  ))}
                </li>
              ) : replies.length === 0 ? (
                <li className="px-4 py-6 text-center text-xs text-fg-muted">
                  아직 회신이 없습니다.
                </li>
              ) : (
                replies.map((r) => {
                  const meta = DECISION_META[r.decision] ?? DECISION_META.COMMENT;
                  const Icon = meta.icon;
                  return (
                    <li key={r.id} className="px-4 py-3 text-sm">
                      <div className="mb-1 flex items-center gap-2">
                        <Icon className={cn('h-3.5 w-3.5', meta.tone)} />
                        <span className="font-medium text-fg">{r.author}</span>
                        <span className={cn('text-[11px]', meta.tone)}>
                          {meta.label}
                        </span>
                        <span className="ml-auto font-mono text-[11px] text-fg-subtle">
                          {formatDateTime(r.createdAt)}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-[13px] text-fg-muted">
                        {r.comment}
                      </p>
                    </li>
                  );
                })
              )}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex-1 overflow-auto bg-bg" role="status" aria-busy="true">
      <div className="border-b border-border px-6 py-5">
        <div className="h-3 w-24 animate-pulse rounded bg-bg-muted" />
        <div className="mt-2 h-7 w-72 animate-pulse rounded bg-bg-muted" />
      </div>
      <div className="grid grid-cols-1 gap-6 p-6 xl:grid-cols-[1fr_360px]">
        <div className="h-64 animate-pulse rounded bg-bg-muted" />
        <div className="h-64 animate-pulse rounded bg-bg-muted" />
      </div>
    </div>
  );
}
