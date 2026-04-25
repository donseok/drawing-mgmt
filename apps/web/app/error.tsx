'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw, Mail } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // TODO: ship error to logging service (pino on backend / Sentry phase 2)
    // eslint-disable-next-line no-console
    console.error('[App error boundary]', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10 text-rose-500">
          <AlertTriangle className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold text-fg">오류가 발생했습니다</h1>
        <p className="text-sm text-fg-muted">
          요청을 처리하는 중 문제가 생겼습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.
        </p>

        {error.digest && (
          <p className="font-mono text-xs text-fg-subtle">
            에러 ID: <span className="text-fg-muted">{error.digest}</span>
          </p>
        )}

        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-3 text-sm font-medium text-brand-foreground hover:opacity-90"
          >
            <RotateCcw className="h-4 w-4" />
            다시 시도
          </button>
          <a
            href="mailto:admin@example.com"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm hover:bg-bg-muted"
          >
            <Mail className="h-4 w-4" />
            관리자 문의
          </a>
        </div>
      </div>
    </div>
  );
}
