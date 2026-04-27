'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Mail, MessageCircle, Phone, Smartphone } from 'lucide-react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';

/**
 * NotificationsSection — R35 N-1 + R38 N-2.
 *
 * Surfaces the per-user notification channel preferences. R35 introduced the
 * email channel; R38 adds SMS and KakaoTalk. All three rows live side-by-side
 * so the user has one mental model of "channels".
 *
 * Channel state is owned by the `me` query (cache key `queryKeys.me()`); each
 * mutation invalidates that key so toggles re-sync from the server even if a
 * sibling tab raced.
 *
 * Optimistic update: PATCH succeeds in the common case, so we patch the `me`
 * cache eagerly and roll back on error. Keeps the toggle responsive (no
 * spinner flash) while still honoring server truth on failure.
 *
 * SMS / Kakao gating: both channels are wired to a single `phoneNumber` field.
 * The toggles are disabled until a saved phone number exists on the server,
 * and the input is validated client-side against the same regex shape the BE
 * accepts (한국 010-XXXX-XXXX 또는 E.164). Saving the phone is a separate
 * action so a partially-typed number can't accidentally toggle a channel.
 */

interface NotificationsSectionProps {
  notifyByEmail: boolean;
  notifyBySms: boolean;
  notifyByKakao: boolean;
  phoneNumber: string | null;
  /** Whether the user has an email on file. Email toggle is disabled when missing. */
  hasEmail: boolean;
}

// Same shape the BE preferences route accepts; widened so a single mutation
// covers email/SMS/Kakao/phone in one wire call.
interface MePatchVars {
  notifyByEmail?: boolean;
  notifyBySms?: boolean;
  notifyByKakao?: boolean;
  phoneNumber?: string | null;
}

// Shape we patch into the `me` cache during optimistic updates. Anything we
// don't touch is preserved via spread.
interface MeCacheShape {
  notifyByEmail?: boolean;
  notifyBySms?: boolean;
  notifyByKakao?: boolean;
  phoneNumber?: string | null;
  [key: string]: unknown;
}

// Phone validator — accepts:
//   - 한국 휴대폰 형식: 010-XXXX-XXXX (and 011/016/017/018/019 legacy)
//   - E.164 글로벌 형식: +<digits>, 8~15 digits total after the plus
//
// Why two patterns: domestic users almost always type the dashed Korean form,
// but partner / overseas users may already have an E.164 number stored upstream
// (예: HR 시스템). Matching both avoids forcing a normalization step.
const phoneSchema = z
  .string()
  .trim()
  .regex(
    /^(01[016789]-\d{3,4}-\d{4}|\+\d{8,15})$/,
    '010-1234-5678 또는 +821012345678 형식으로 입력하세요.',
  );

export function NotificationsSection({
  notifyByEmail,
  notifyBySms,
  notifyByKakao,
  phoneNumber,
  hasEmail,
}: NotificationsSectionProps) {
  const queryClient = useQueryClient();

  // Local draft for the phone input. We sync from props whenever the server
  // value changes so an external save (예: 다른 탭) doesn't strand the field
  // with stale text.
  const [phoneDraft, setPhoneDraft] = useState(phoneNumber ?? '');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  useEffect(() => {
    setPhoneDraft(phoneNumber ?? '');
    setPhoneError(null);
  }, [phoneNumber]);

  const mutation = useMutation<unknown, Error, MePatchVars, { previous?: MeCacheShape }>({
    mutationFn: (vars) => api.patch('/api/v1/me/preferences', vars),
    onMutate: async (vars) => {
      // Cancel any in-flight `me` queries so they don't race the optimistic
      // patch we are about to write into the cache.
      await queryClient.cancelQueries({ queryKey: queryKeys.me() });
      const previous = queryClient.getQueryData<MeCacheShape>(queryKeys.me());
      if (previous) {
        queryClient.setQueryData<MeCacheShape>(queryKeys.me(), {
          ...previous,
          ...(vars.notifyByEmail !== undefined
            ? { notifyByEmail: vars.notifyByEmail }
            : {}),
          ...(vars.notifyBySms !== undefined
            ? { notifyBySms: vars.notifyBySms }
            : {}),
          ...(vars.notifyByKakao !== undefined
            ? { notifyByKakao: vars.notifyByKakao }
            : {}),
          ...(vars.phoneNumber !== undefined
            ? { phoneNumber: vars.phoneNumber }
            : {}),
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
      // Surface a channel-specific success toast so the user sees what changed.
      if (vars.notifyByEmail !== undefined) {
        toast.success(
          vars.notifyByEmail
            ? '이메일 알림을 받습니다.'
            : '이메일 알림을 받지 않습니다.',
        );
      } else if (vars.notifyBySms !== undefined) {
        toast.success(
          vars.notifyBySms
            ? 'SMS 알림을 받습니다.'
            : 'SMS 알림을 받지 않습니다.',
        );
      } else if (vars.notifyByKakao !== undefined) {
        toast.success(
          vars.notifyByKakao
            ? '카카오톡 알림을 받습니다.'
            : '카카오톡 알림을 받지 않습니다.',
        );
      } else if (vars.phoneNumber !== undefined) {
        toast.success(
          vars.phoneNumber
            ? '전화번호가 저장되었습니다.'
            : '전화번호가 삭제되었습니다.',
        );
      }
    },
    onSettled: () => {
      // Re-sync from server regardless of outcome.
      queryClient.invalidateQueries({ queryKey: queryKeys.me() });
    },
  });

  const emailDisabled = mutation.isPending || !hasEmail;
  const phoneSaved = !!phoneNumber;
  // SMS/Kakao gating: only allow flipping on once a phone number is saved.
  // Allowing flip-off regardless prevents users from being stuck "on" if they
  // somehow lost the phone row.
  const phoneToggleDisabled = (current: boolean) =>
    mutation.isPending || (!phoneSaved && !current);

  // Phone form state. The save button is enabled iff the draft differs from
  // the server value AND parses cleanly (or is empty — empty means "삭제").
  const phoneDirty = phoneDraft.trim() !== (phoneNumber ?? '');
  const trimmedDraft = phoneDraft.trim();
  const draftValid =
    trimmedDraft === '' || phoneSchema.safeParse(trimmedDraft).success;

  const handlePhoneSave = () => {
    if (mutation.isPending) return;
    if (trimmedDraft === '') {
      // Saving an empty string clears the number; SMS/Kakao should fall back
      // to off so the user isn't paying for a channel that can no longer fire.
      mutation.mutate({
        phoneNumber: null,
        ...(notifyBySms ? { notifyBySms: false } : {}),
        ...(notifyByKakao ? { notifyByKakao: false } : {}),
      });
      return;
    }
    const parsed = phoneSchema.safeParse(trimmedDraft);
    if (!parsed.success) {
      setPhoneError(
        parsed.error.errors[0]?.message ??
          '전화번호 형식이 올바르지 않습니다.',
      );
      return;
    }
    setPhoneError(null);
    mutation.mutate({ phoneNumber: parsed.data });
  };

  return (
    <section>
      <h2 className="text-base font-semibold text-fg">알림 환경설정</h2>
      <p className="mt-1 text-sm text-fg-muted">
        결재·회신·시스템 알림을 받을 채널을 선택합니다.
      </p>

      <div className="mt-4 space-y-4 rounded-lg border border-border bg-bg p-5">
        {/* Email channel — R35 */}
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
                disabled={emailDisabled}
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

        <div className="border-t border-border" aria-hidden="true" />

        {/* Phone number — drives both SMS and Kakao gating. We always show the
            input so users can register a number before flipping a channel on
            (the alternative — hiding it until a toggle is on — produces a
            chicken-and-egg where the toggle is disabled because no phone). */}
        <div className="flex items-start gap-3">
          <Phone
            className="mt-0.5 h-5 w-5 shrink-0 text-fg-muted"
            aria-hidden="true"
          />
          <div className="flex-1 space-y-2">
            <Label htmlFor="notify-phone">전화번호</Label>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <Input
                  id="notify-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="010-1234-5678"
                  value={phoneDraft}
                  onChange={(e) => {
                    setPhoneDraft(e.target.value);
                    if (phoneError) setPhoneError(null);
                  }}
                  aria-invalid={!!phoneError || undefined}
                  aria-describedby="notify-phone-hint"
                  disabled={mutation.isPending}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handlePhoneSave}
                disabled={!phoneDirty || !draftValid || mutation.isPending}
              >
                {mutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                저장
              </Button>
            </div>
            {phoneError ? (
              <p className="text-xs text-danger" role="alert">
                {phoneError}
              </p>
            ) : (
              <p id="notify-phone-hint" className="text-xs text-fg-muted">
                SMS·카카오톡 알림은 이 번호로 발송됩니다. 한국 휴대폰
                010-1234-5678 또는 국제 형식(+821012345678)을 지원합니다.
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-border" aria-hidden="true" />

        {/* SMS channel — R38 */}
        <div className="flex items-start gap-3">
          <Smartphone
            className="mt-0.5 h-5 w-5 shrink-0 text-fg-muted"
            aria-hidden="true"
          />
          <div className="flex-1">
            <div className="flex items-center justify-between gap-4">
              <label
                htmlFor="notify-sms"
                className="text-sm font-medium text-fg"
              >
                SMS로 알림 받기
              </label>
              <Switch
                id="notify-sms"
                checked={notifyBySms}
                onCheckedChange={(next) =>
                  mutation.mutate({ notifyBySms: next })
                }
                disabled={phoneToggleDisabled(notifyBySms)}
                aria-label="SMS로 알림 받기"
              />
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              {phoneSaved
                ? '결재·회신 알림이 위 전화번호로 SMS 발송됩니다.'
                : '전화번호를 먼저 저장하면 SMS 알림을 켤 수 있습니다.'}
            </p>
          </div>
        </div>

        <div className="border-t border-border" aria-hidden="true" />

        {/* Kakao channel — R38 */}
        <div className="flex items-start gap-3">
          <MessageCircle
            className="mt-0.5 h-5 w-5 shrink-0 text-fg-muted"
            aria-hidden="true"
          />
          <div className="flex-1">
            <div className="flex items-center justify-between gap-4">
              <label
                htmlFor="notify-kakao"
                className="text-sm font-medium text-fg"
              >
                카카오톡으로 알림 받기
              </label>
              <Switch
                id="notify-kakao"
                checked={notifyByKakao}
                onCheckedChange={(next) =>
                  mutation.mutate({ notifyByKakao: next })
                }
                disabled={phoneToggleDisabled(notifyByKakao)}
                aria-label="카카오톡으로 알림 받기"
              />
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              {phoneSaved
                ? '카카오톡 알림톡 채널을 통해 결재·회신 알림을 받습니다. SMS와 동시 사용 가능합니다.'
                : '전화번호를 먼저 저장하면 카카오톡 알림을 켤 수 있습니다.'}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
