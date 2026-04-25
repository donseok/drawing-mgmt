import Link from 'next/link';
import { ArrowLeft, Clock4, Download, FileText, Paperclip, Send } from 'lucide-react';

const LOBBY = {
  id: 'lobby-1',
  title: 'CGL-2 메인롤러 전면 작업',
  company: '동성기계',
  status: '확인 대기',
  expiresAt: '2026-05-02',
  files: [
    { name: 'CGL-MEC-2026-00012.dwg', size: '2.4MB' },
    { name: '검토요청서.pdf', size: '640KB' },
    { name: 'BOM.xlsx', size: '120KB' },
  ],
};

export default function LobbyDetailPage() {
  return (
    <div className="flex-1 overflow-auto bg-bg">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
        <Link href="/lobby" className="app-icon-button h-8 w-8" aria-label="로비함으로 돌아가기">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="text-fg-muted">로비함</span>
        <span className="text-fg-subtle">/</span>
        <span className="font-medium text-fg">{LOBBY.id}</span>
      </div>

      <div className="border-b border-border px-6 py-5">
        <div className="app-kicker">Partner Package</div>
        <div className="mt-1 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-fg">{LOBBY.title}</h1>
            <p className="mt-1 text-sm text-fg-muted">{LOBBY.company} · {LOBBY.status}</p>
          </div>
          <button type="button" className="app-action-button-primary h-9">
            <Send className="h-4 w-4" />
            검토 회신
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 p-6 xl:grid-cols-[1fr_360px]">
        <section className="app-panel overflow-hidden">
          <div className="app-panel-header">
            <span className="app-kicker">첨부 자료</span>
            <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
              <Paperclip className="h-3.5 w-3.5" />
              {LOBBY.files.length}건
            </span>
          </div>
          <ul>
            {LOBBY.files.map((file) => (
              <li key={file.name} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <FileText className="h-4 w-4 text-fg-muted" />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">{file.name}</span>
                <span className="font-mono text-xs text-fg-muted">{file.size}</span>
                <button type="button" className="app-icon-button" aria-label="다운로드">
                  <Download className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <aside className="app-panel p-4">
          <div className="app-kicker">패키지 정보</div>
          <dl className="mt-3 grid grid-cols-[88px_1fr] gap-y-2 text-sm">
            <dt className="text-fg-muted">상태</dt>
            <dd className="font-medium text-fg">{LOBBY.status}</dd>
            <dt className="text-fg-muted">협력업체</dt>
            <dd className="text-fg">{LOBBY.company}</dd>
            <dt className="text-fg-muted">만료일</dt>
            <dd className="inline-flex items-center gap-1 font-mono text-fg">
              <Clock4 className="h-3.5 w-3.5 text-fg-muted" />
              {LOBBY.expiresAt}
            </dd>
          </dl>
        </aside>
      </div>
    </div>
  );
}
