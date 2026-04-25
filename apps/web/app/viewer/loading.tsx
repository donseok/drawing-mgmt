/**
 * Suspense fallback for the viewer route. We render the same chrome the real
 * viewer shows (toolbar bar + canvas area + sidebar) so there's minimal
 * layout shift when the actual data arrives.
 */

export default function ViewerLoading() {
  return (
    <div
      role="status"
      aria-label="뷰어 로딩 중"
      className="flex h-full w-full flex-col bg-bg text-fg"
    >
      {/* Toolbar skeleton */}
      <div className="flex h-12 items-center justify-between border-b border-border bg-bg-subtle px-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 animate-pulse rounded bg-bg-muted" />
          <div className="h-5 w-64 animate-pulse rounded bg-bg-muted" />
        </div>
        <div className="flex items-center gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-7 w-7 animate-pulse rounded bg-bg-muted"
            />
          ))}
        </div>
      </div>
      {/* Canvas + sidebar skeleton */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-border border-t-brand" />
            <p className="text-sm text-fg-muted">도면 엔진 초기화 중…</p>
          </div>
        </div>
        <div className="hidden w-80 border-l border-border bg-bg-subtle md:block">
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-6 w-full animate-pulse rounded bg-bg-muted"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
