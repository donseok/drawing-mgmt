'use client';

import * as React from 'react';
import { ArrowLeft, MessageSquarePlus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ChatSessionSummary } from '@/lib/chat-types';
import { RobotAvatar } from './RobotAvatar';

interface Props {
  /** Whether the sidebar is currently visible (drives data-state animation). */
  open: boolean;
  /** Mobile mode renders a back arrow + full-width layout. */
  mobile?: boolean;
  sessions: ChatSessionSummary[];
  loading?: boolean;
  activeSessionId?: string;
  onPickSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  /** Mobile back/close. */
  onClose?: () => void;
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return '방금';
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분 전`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}일 전`;
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  } catch {
    return '';
  }
}

export function SessionSidebar({
  open,
  mobile,
  sessions,
  loading,
  activeSessionId,
  onPickSession,
  onNewSession,
  onDeleteSession,
  onClose,
}: Props) {
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);

  if (!open) return null;

  return (
    <aside
      aria-label="이전 대화 목록"
      className={cn(
        'flex flex-col border-r border-border bg-bg-subtle',
        mobile
          ? 'absolute inset-0 z-20 w-full'
          : 'absolute inset-y-0 left-0 z-10 w-[220px]',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        {mobile ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="뒤로"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : null}
        <span className="flex-1 text-xs font-semibold text-fg-muted">
          이전 대화 ({sessions.length})
        </span>
      </div>

      <div className="px-2 py-2">
        <button
          type="button"
          onClick={onNewSession}
          className={cn(
            'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md',
            'border border-dashed border-border bg-bg text-xs font-medium text-fg',
            'hover:border-brand hover:text-brand',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />새 대화
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1 pb-2">
        {loading ? (
          <div className="space-y-1 px-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-bg-muted" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 pt-6 text-center">
            <RobotAvatar size="header" />
            <div className="text-[11px] text-fg-muted">
              아직 대화가 없어요. 새 대화로 시작해보세요.
            </div>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((s) => {
              const active = s.id === activeSessionId;
              const confirming = confirmingId === s.id;
              return (
                <li key={s.id}>
                  <div
                    className={cn(
                      'group relative flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left',
                      'hover:bg-bg-muted',
                      active && 'border-l-2 border-brand bg-surface-selected pl-1.5',
                    )}
                    onClick={() => !confirming && onPickSession(s.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (!confirming && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        onPickSession(s.id);
                      }
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-fg">
                        {s.title || '(제목 없음)'}
                      </div>
                      <div className="text-[10px] text-fg-subtle">
                        {formatRelative(s.updatedAt)} · {s.messageCount}개 메시지
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="대화 삭제"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirming) {
                          onDeleteSession(s.id);
                          setConfirmingId(null);
                        } else {
                          setConfirmingId(s.id);
                          window.setTimeout(() => {
                            setConfirmingId((prev) => (prev === s.id ? null : prev));
                          }, 3000);
                        }
                      }}
                      className={cn(
                        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle',
                        'opacity-0 group-hover:opacity-100 hover:bg-danger/15 hover:text-danger',
                        'focus:opacity-100',
                        confirming && 'opacity-100 bg-danger/15 text-danger',
                      )}
                      title={confirming ? '한 번 더 클릭해 삭제' : '삭제'}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
