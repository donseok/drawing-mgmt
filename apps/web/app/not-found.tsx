import Link from 'next/link';
import { FileQuestion, Home, Search } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-bg-muted text-fg-muted">
          <FileQuestion className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold text-fg">페이지를 찾을 수 없습니다</h1>
        <p className="text-sm text-fg-muted">
          요청하신 자료 또는 페이지가 이동되었거나 권한이 없을 수 있습니다.
        </p>
        <div className="mt-2 flex gap-2">
          <Link
            href="/"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-3 text-sm font-medium text-brand-foreground hover:opacity-90"
          >
            <Home className="h-4 w-4" />홈으로
          </Link>
          <Link
            href="/search"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm hover:bg-bg-muted"
          >
            <Search className="h-4 w-4" />자료 검색
          </Link>
        </div>
      </div>
    </div>
  );
}
