'use client';

/**
 * MfaSection — R39 A-3 (settings 탭).
 *
 * Two states:
 *   1) Disabled (totpEnabledAt is null)
 *      - Shows "활성화" CTA → opens `EnrollDialog`.
 *      - EnrollDialog flow:
 *          a) POST /api/v1/me/mfa/enroll → { secret, otpauthUrl, qrcode }
 *          b) Render QR PNG + base32 secret (copy button) + 6-digit code input.
 *          c) On confirm: POST /api/v1/me/mfa/confirm { code } → { recoveryCodes[10] }
 *          d) Render recovery codes; user must check "복사·다운로드 완료" before
 *             closing — recovery codes are shown only once (BE stores hashes).
 *
 *   2) Enabled (totpEnabledAt is a timestamp)
 *      - Status panel showing 활성 since … + "비활성화" CTA.
 *      - DisableDialog: 6자리 코드 또는 비밀번호 (둘 중 하나) → POST /disable.
 *
 * Cache:
 *   - The toggle state lives on the `me` query (single source of truth).
 *   - Each mutation invalidates `queryKeys.me()`. We do NOT optimistically
 *     toggle: enroll succeeds in two phases (enroll → confirm) and a stale
 *     cache during the gap would mis-render the UI.
 *
 * Accessibility:
 *   - QR image has alt text describing it as the otpauth URL preview.
 *   - 6-digit code input is `inputmode="numeric"` + `autoComplete="one-time-code"`.
 *   - Recovery codes are rendered in a <pre> with role="region" + aria-label.
 *
 * BE contract — api_contract.md §3.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2,
  ClipboardCopy,
  Download,
  Loader2,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';

interface EnrollResponse {
  secret: string;
  otpauthUrl: string;
  qrcode: string; // PNG dataURL
}

interface ConfirmResponse {
  recoveryCodes: string[];
}

interface MfaSectionProps {
  enabled: boolean;
  enabledAt: string | null;
}

export function MfaSection({ enabled, enabledAt }: MfaSectionProps) {
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  const enabledLabel =
    enabledAt && !Number.isNaN(new Date(enabledAt).getTime())
      ? new Date(enabledAt).toLocaleString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

  return (
    <section>
      <h2 className="text-base font-semibold text-fg">2단계 인증 (MFA)</h2>
      <p className="mt-1 text-sm text-fg-muted">
        TOTP 앱(Google Authenticator, 1Password 등)으로 로그인 시 추가 인증을
        요구합니다. 비밀번호가 유출되어도 두 번째 단계가 계정을 보호합니다.
      </p>

      <div className="mt-4 rounded-lg border border-border bg-bg p-5">
        <div className="flex items-start gap-3">
          {enabled ? (
            <ShieldCheck
              className="mt-0.5 h-5 w-5 shrink-0 text-success"
              aria-hidden="true"
            />
          ) : (
            <ShieldOff
              className="mt-0.5 h-5 w-5 shrink-0 text-fg-muted"
              aria-hidden="true"
            />
          )}
          <div className="flex-1">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-fg">
                  {enabled ? '활성' : '비활성'}
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {enabled
                    ? enabledLabel
                      ? `${enabledLabel}에 활성화됨`
                      : 'TOTP 인증을 사용 중입니다.'
                    : 'TOTP 인증을 사용하지 않습니다.'}
                </p>
              </div>
              {enabled ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDisableOpen(true)}
                >
                  비활성화
                </Button>
              ) : (
                <Button type="button" onClick={() => setEnrollOpen(true)}>
                  활성화
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {enrollOpen ? (
        <EnrollDialog open={enrollOpen} onOpenChange={setEnrollOpen} />
      ) : null}
      {disableOpen ? (
        <DisableDialog open={disableOpen} onOpenChange={setDisableOpen} />
      ) : null}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// EnrollDialog
// ──────────────────────────────────────────────────────────────────────────

function EnrollDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [enrollData, setEnrollData] = useState<EnrollResponse | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [ackCopied, setAckCopied] = useState(false);

  const enrollMutation = useMutation<EnrollResponse, ApiError>({
    mutationFn: () => api.post<EnrollResponse>('/api/v1/me/mfa/enroll'),
    onSuccess: (data) => setEnrollData(data),
    onError: (err) => {
      toast.error('MFA 활성화에 실패했습니다.', { description: err.message });
    },
  });

  const confirmMutation = useMutation<ConfirmResponse, ApiError, { code: string }>({
    mutationFn: (vars) => api.post<ConfirmResponse>('/api/v1/me/mfa/confirm', vars),
    onSuccess: (data) => {
      setRecoveryCodes(data.recoveryCodes);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me() });
    },
    onError: (err) => {
      // BE returns INVALID_CODE on the typical wrong-code case. Surface a
      // friendly message instead of the generic envelope.
      if (err.code === 'INVALID_CODE' || err.status === 401) {
        toast.error('인증 코드가 올바르지 않습니다.');
        return;
      }
      toast.error('인증 확인에 실패했습니다.', { description: err.message });
    },
  });

  // Trigger enroll exactly once when the dialog mounts. The parent only
  // mounts <EnrollDialog> while `enrollOpen === true`, so a fresh mount
  // (next time the user clicks 활성화) re-fires this effect and gets a
  // fresh secret/QR.
  useEffect(() => {
    enrollMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirm = () => {
    if (code.trim().length !== 6) return;
    confirmMutation.mutate({ code: code.trim() });
  };

  const handleClose = () => {
    if (recoveryCodes && !ackCopied) return;
    onOpenChange(false);
    setEnrollData(null);
    setCode('');
    setRecoveryCodes(null);
    setAckCopied(false);
  };

  const handleCopySecret = async () => {
    if (!enrollData) return;
    try {
      await navigator.clipboard.writeText(enrollData.secret);
      toast.success('시크릿을 복사했습니다.');
    } catch {
      toast.error('복사에 실패했습니다.');
    }
  };

  const handleCopyRecovery = async () => {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      toast.success('복구 코드를 복사했습니다.');
    } catch {
      toast.error('복사에 실패했습니다.');
    }
  };

  const handleDownloadRecovery = () => {
    if (!recoveryCodes) return;
    const blob = new Blob(
      [
        `# 도면관리시스템 복구 코드\n# ${new Date().toISOString()}\n# 각 코드는 한 번만 사용할 수 있습니다.\n\n${recoveryCodes.join('\n')}\n`,
      ],
      { type: 'text/plain;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mfa-recovery-codes-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : handleClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>2단계 인증 활성화</DialogTitle>
          <DialogDescription>
            {recoveryCodes
              ? '복구 코드를 안전한 곳에 보관하세요. 이 화면을 떠나면 다시 볼 수 없습니다.'
              : 'TOTP 앱으로 QR을 스캔하고, 앱이 표시한 6자리 코드를 입력하세요.'}
          </DialogDescription>
        </DialogHeader>

        {recoveryCodes ? (
          <RecoveryCodesPanel
            codes={recoveryCodes}
            ackCopied={ackCopied}
            onAckChange={setAckCopied}
            onCopy={handleCopyRecovery}
            onDownload={handleDownloadRecovery}
          />
        ) : enrollMutation.isPending || !enrollData ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>QR 코드를 생성하는 중...</span>
          </div>
        ) : enrollMutation.isError ? (
          <div className="rounded-md border border-danger/25 bg-danger/10 p-3 text-sm text-danger">
            QR 코드를 생성하지 못했습니다. 닫고 다시 시도해 주세요.
          </div>
        ) : (
          <div className="space-y-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enrollData.qrcode}
              alt="TOTP 등록을 위한 QR 코드. 인증 앱으로 스캔하세요."
              className="mx-auto h-44 w-44 rounded-md border border-border bg-bg-elevated p-2"
            />
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wide text-fg-subtle">
                수동 입력용 시크릿
              </Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-md border border-border bg-bg-muted px-3 py-2 text-xs text-fg">
                  {enrollData.secret}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleCopySecret}
                  aria-label="시크릿 복사"
                  title="시크릿 복사"
                >
                  <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mfa-enroll-code" required>
                인증 앱이 표시한 6자리 코드
              </Label>
              <Input
                id="mfa-enroll-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                disabled={confirmMutation.isPending}
                autoFocus
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {recoveryCodes ? (
            <Button
              type="button"
              onClick={handleClose}
              disabled={!ackCopied}
            >
              완료
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={handleClose}>
                취소
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={
                  code.length !== 6 ||
                  confirmMutation.isPending ||
                  enrollMutation.isPending ||
                  !enrollData
                }
              >
                {confirmMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                확인
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// RecoveryCodesPanel — shown once after confirm.
// ──────────────────────────────────────────────────────────────────────────

function RecoveryCodesPanel({
  codes,
  ackCopied,
  onAckChange,
  onCopy,
  onDownload,
}: {
  codes: string[];
  ackCopied: boolean;
  onAckChange: (next: boolean) => void;
  onCopy: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          이 화면을 떠나면 복구 코드를 다시 볼 수 없습니다. 인증 앱을 사용할 수
          없을 때 코드 하나로 1회 로그인할 수 있습니다.
        </p>
      </div>

      <pre
        role="region"
        aria-label="복구 코드"
        className="rounded-md border border-border bg-bg-muted p-3 text-xs font-mono leading-6 text-fg"
      >
        {codes.join('\n')}
      </pre>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onCopy}
          aria-label="복구 코드 복사"
        >
          <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
          복사
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onDownload}
          aria-label="복구 코드 텍스트 파일로 다운로드"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          다운로드
        </Button>
      </div>

      <label className="flex items-start gap-2 text-sm text-fg">
        <Checkbox
          checked={ackCopied}
          onCheckedChange={(v) => onAckChange(v === true)}
          aria-label="복구 코드를 안전한 곳에 보관했는지 확인"
        />
        <span>
          복구 코드를 비밀번호 매니저나 안전한 위치에 저장했습니다. (체크해야 닫을
          수 있습니다)
        </span>
      </label>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// DisableDialog
// ──────────────────────────────────────────────────────────────────────────

function DisableDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'code' | 'password'>('code');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation<unknown, ApiError, { code?: string; password?: string }>({
    mutationFn: (vars) => api.post('/api/v1/me/mfa/disable', vars),
    onSuccess: () => {
      toast.success('2단계 인증을 비활성화했습니다.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.me() });
      onOpenChange(false);
    },
    onError: (err) => {
      if (err.code === 'INVALID_CODE' || err.status === 401) {
        toast.error('인증 코드 또는 비밀번호가 올바르지 않습니다.');
        return;
      }
      toast.error('비활성화에 실패했습니다.', { description: err.message });
    },
  });

  const submitDisabled =
    mutation.isPending ||
    (mode === 'code' ? code.length !== 6 : password.length === 0);

  const handleSubmit = () => {
    if (submitDisabled) return;
    mutation.mutate(
      mode === 'code' ? { code: code.trim() } : { password },
    );
  };

  const handleClose = () => {
    if (mutation.isPending) return;
    onOpenChange(false);
    setCode('');
    setPassword('');
    setMode('code');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : handleClose())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>2단계 인증 비활성화</DialogTitle>
          <DialogDescription>
            인증 앱의 6자리 코드 또는 계정 비밀번호로 본인 확인을 합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div
            role="tablist"
            aria-label="확인 방법"
            className="grid grid-cols-2 gap-2 rounded-md border border-border p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'code'}
              onClick={() => setMode('code')}
              className={
                mode === 'code'
                  ? 'rounded-sm bg-bg-muted px-3 py-1.5 text-xs font-medium text-fg ring-1 ring-border'
                  : 'rounded-sm px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-muted/60'
              }
            >
              인증 코드
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'password'}
              onClick={() => setMode('password')}
              className={
                mode === 'password'
                  ? 'rounded-sm bg-bg-muted px-3 py-1.5 text-xs font-medium text-fg ring-1 ring-border'
                  : 'rounded-sm px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-muted/60'
              }
            >
              비밀번호
            </button>
          </div>

          {mode === 'code' ? (
            <div className="space-y-2">
              <Label htmlFor="mfa-disable-code" required>
                6자리 코드
              </Label>
              <Input
                id="mfa-disable-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                disabled={mutation.isPending}
                autoFocus
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="mfa-disable-password" required>
                비밀번호
              </Label>
              <Input
                id="mfa-disable-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={mutation.isPending}
                autoFocus
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose} disabled={mutation.isPending}>
            취소
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleSubmit}
            disabled={submitDisabled}
          >
            {mutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            비활성화
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
