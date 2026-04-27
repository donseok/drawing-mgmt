'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail } from 'lucide-react';

import { Switch } from '@/components/ui/switch';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';

/**
 * NotificationsSection — R35 N-1.
 *
 * Surfaces the per-user notification channel preferences. Today there is just
 * one toggle (이메일로 알림 받기 → `notifyByEmail`), but the section is
 * structured so future channels (예: 카카오톡/Slack/SMS) drop in as additional
 * rows without a re-layout.
 *
 * Channel state is owned by the `me` query (cache key `queryKeys.me()`); the
 * mutation invalidates that key so the toggle re-syncs from the server even if
 * the request raced with another tab.
 *
 * Optimistic update: contract §3.3 says PATCH succeeds in the common case, so
 * we patch the `me` cache eagerly and roll back on error. Keeps the toggle
 * responsive (no spinner flash) while still honoring server truth.
 */

interface NotificationsSectionProps {
  notifyByEmail: boolean;
  /** Whether the user has an email on file. Toggle is disabled when missing. */
  hasEmail: boolean;
}

interface MePatchVars {
  notifyByEmail: boolean;
}

export function NotificationsSection({
  notifyByEmail,
  hasEmail,
}: NotificationsSectionProps) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (vars: MePatchVars) =>
      api.patch('/api/v1/me/preferences', vars),
    onMutate: async (vars) => {
      // Cancel any in-flight `me` queries so they don't race the optimistic
      // patch we are about to write into the cache.
      await queryClient.cancelQueries({ queryKey: queryKeys.me() });
      const previous = queryClient.getQueryData<Record<string, unknown>>(
        queryKeys.me(),
      );
      if (previous) {
        queryClient.setQueryData(queryKeys.me(), {
          ...previous,
          notifyByEmail: vars.notifyByEmail,
        });
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      // Roll back the optimistic patch.
      if (ctx?.previous) {
        queryClient.setQueryData(queryKeys.me(), ctx.previous);
      }
      const msg =
        err instanceof ApiError ? err.message : '환경설정 저장에 실패했습니다.';
      toast.error(msg);
    },
    onSuccess: (_data, vars) => {
      toast.success(
        vars.notifyByEmail
          ? '이메일 알림을 받습니다.'
          : '이메일 알림을 받지 않습니다.',
      );
    },
    onSettled: () => {
      // Re-sync from server regardless of outcome.
      queryClient.invalidateQueries({ queryKey: queryKeys.me() });
    },
  });

  const disabled = mutation.isPending || !hasEmail;

  return (
    <section>
      <h2 className="text-base font-semibold text-fg">알림 환경설정</h2>
      <p className="mt-1 text-sm text-fg-muted">
        결재·회신·시스템 알림을 받을 채널을 선택합니다.
      </p>

      <div className="mt-4 rounded-lg border border-border bg-bg p-5">
        <div className="flex items-start gap-3">
          <Mail
            className="mt-0.5 h-5 w-5 shrink-0 text-fg-muted"
            aria-hidden="true"
          />
          <div className="flex-1">
            <div className="flex items-center justify-between gap-4">
              <label
                htmlFor="notify-email"
                className="text-sm font-medium text-fg"
              >
                이메일로 알림 받기
              </label>
              <Switch
                id="notify-email"
                checked={notifyByEmail}
                onCheckedChange={(next) =>
                  mutation.mutate({ notifyByEmail: next })
                }
                disabled={disabled}
                aria-label="이메일로 알림 받기"
              />
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              {hasEmail ? (
                <>
                  중요한 결재·회신 알림이 사이트 알림과 별도로 등록된 이메일로
                  발송됩니다. 끄면 사이트 알림(종 아이콘)만 받습니다.
                </>
              ) : (
                <>
                  이메일이 등록되어 있지 않아 이 기능을 사용할 수 없습니다.
                  먼저 프로필 탭에서 이메일을 입력하세요.
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
