import Link from 'next/link';
import { auth } from '@/auth';
import {
  CheckSquare,
  Lock,
  Clock,
  Megaphone,
  ArrowRight,
  Plus,
  FileText,
  Folder,
  Activity,
} from 'lucide-react';
import { cn } from '@/lib/cn';

// MOCK helpers — TODO: replace with real /api/v1/me + /api/v1/workspace/* calls.
// All sample data uses Korean realistic content per spec.
const STAT_CARDS = [
  {
    key: 'waiting',
    title: '내 결재 대기',
    count: 3,
    href: '/approval?box=waiting',
    icon: CheckSquare,
    accent: 'text-violet-500',
  },
  {
    key: 'checkedout',
    title: '체크아웃 중',
    count: 2,
    href: '/search?owner=me&state=CHECKED_OUT',
    icon: Lock,
    accent: 'text-amber-500',
  },
  {
    key: 'recent',
    title: '최근 본 자료',
    count: 12,
    href: '/workspace?view=recent',
    icon: Clock,
    accent: 'text-sky-500',
  },
  {
    key: 'notice',
    title: '활성 공지',
    count: 1,
    href: '#notices',
    icon: Megaphone,
    accent: 'text-emerald-500',
  },
];

// MOCK
const FAVORITES = [
  { id: 'obj-1', kind: 'object', number: 'CGL-MEC-2026-00012', name: '메인롤러 어셈블리' },
  { id: 'obj-2', kind: 'object', number: 'CGL-MEC-2026-00013', name: '가이드롤러 베이스' },
  { id: 'f-cgl2', kind: 'folder', name: 'CGL-2 / 메인라인', code: 'CGL-2' },
  { id: 'obj-3', kind: 'object', number: 'CGL-ELE-2026-00031', name: '메인 컨트롤 패널' },
  { id: 'obj-4', kind: 'object', number: 'BFM-PRC-2026-00008', name: '소둔로 공정 P&ID' },
] as const;

// MOCK
const RECENT_ACTIVITY = [
  { time: '10:23', no: 'CGL-MEC-2026-00012', action: '체크인', user: '박영호', actionColor: 'text-sky-500' },
  { time: '09:55', no: 'CGL-ELE-2026-00031', action: '승인됨 (3/3)', user: '결재선', actionColor: 'text-emerald-500' },
  { time: '09:14', no: 'BFM-PRC-2026-00008', action: '신규등록', user: '김철수', actionColor: 'text-slate-500' },
  { time: '08:41', no: 'CGL-MEC-2026-00009', action: '결재상신', user: '박영호', actionColor: 'text-violet-500' },
  { time: '08:02', no: 'CGL-INS-2026-00021', action: '체크아웃', user: '최정아', actionColor: 'text-amber-500' },
];

// MOCK
const NOTICES = [
  {
    id: 'n-1',
    severity: '중요',
    title: '4/27 02:00~04:00 시스템 점검 — 자세히 보기',
  },
];

function formatToday() {
  const d = new Date();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

export default async function WorkspaceHomePage() {
  const session = await auth();
  const name = session?.user?.name ?? session?.user?.username ?? '사용자';

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-7xl px-8 py-6">
        {/* Greeting */}
        <header className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="app-kicker">Workspace</div>
            <h1 className="mt-1 text-2xl font-semibold text-fg">안녕하세요, {name} 님</h1>
            <p className="mt-1 text-sm text-fg-muted">오늘 {formatToday()} 기준 업무 현황입니다.</p>
          </div>
          <Link
            href="/search?action=new"
            className="app-action-button-primary h-9"
          >
            <Plus className="h-4 w-4" />
            신규 자료 등록
          </Link>
        </header>

        {/* Stat cards */}
        <section aria-label="요약" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {STAT_CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <Link
                key={c.key}
                href={c.href}
                className={cn(
                  'group flex h-24 items-center gap-3 rounded-lg border border-border bg-bg px-4 transition-colors',
                  'hover:border-border-strong hover:bg-bg-subtle',
                )}
              >
                <span className={cn('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-bg-subtle', c.accent)}>
                    <Icon className="h-4 w-4" />
                  </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-fg-muted">{c.title}</span>
                  <span className="mt-1 block text-2xl font-semibold text-fg">{c.count}<span className="ml-1 text-xs font-normal text-fg-muted">건</span></span>
                </span>
                <ArrowRight className="h-4 w-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
              </Link>
            );
          })}
        </section>

        {/* Favorites */}
        <section aria-label="즐겨찾기" className="mt-8">
          <div className="mb-2 flex items-end justify-between">
            <div>
              <div className="app-kicker">Pinned</div>
              <h2 className="mt-1 text-base font-semibold text-fg">즐겨찾기</h2>
            </div>
            <button
              type="button"
              className="app-action-button h-8 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              추가
            </button>
          </div>

          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
            {FAVORITES.map((f) => (
              <li key={f.id}>
                <Link
                  href={f.kind === 'object' ? `/objects/${f.id}` : `/search?folder=${f.id}`}
                  className="flex h-32 flex-col overflow-hidden rounded-lg border border-border bg-bg transition-colors hover:border-border-strong hover:bg-bg-subtle"
                >
                  <div className="flex flex-1 items-center justify-center bg-bg-subtle text-fg-subtle">
                    {f.kind === 'object' ? <FileText className="h-7 w-7" /> : <Folder className="h-7 w-7" />}
                  </div>
                  <div className="border-t border-border px-2 py-2">
                    {f.kind === 'object' ? (
                      <>
                        <div className="font-mono text-[11px] text-fg-muted">{f.number}</div>
                        <div className="truncate text-xs font-medium text-fg">{f.name}</div>
                      </>
                    ) : (
                      <>
                        <div className="font-mono text-[11px] text-fg-muted">{f.code}</div>
                        <div className="truncate text-xs font-medium text-fg">{f.name}</div>
                      </>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Recent activity + Notices */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section aria-label="최근 활동" className="lg:col-span-2">
            <div className="mb-2 flex items-center gap-2">
              <Activity className="h-4 w-4 text-fg-subtle" />
              <h2 className="text-base font-semibold text-fg">최근 활동</h2>
            </div>
            <ul className="app-panel overflow-hidden">
              {RECENT_ACTIVITY.map((a, i) => (
                <li
                  key={i}
                  className={cn(
                    'flex items-center gap-3 px-4 py-2.5 text-sm',
                    i !== RECENT_ACTIVITY.length - 1 && 'border-b border-border',
                  )}
                >
                  <span className="font-mono text-xs text-fg-muted">{a.time}</span>
                  <Link
                    href="/objects/obj-1"
                    className="font-mono text-[12px] text-fg hover:underline"
                  >
                    {a.no}
                  </Link>
                  <span className={cn('text-[12px] font-medium', a.actionColor)}>[{a.action}]</span>
                  <span className="text-[12px] text-fg-muted">{a.user}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="공지" id="notices">
            <h2 className="mb-2 text-base font-semibold text-fg">공지사항</h2>
            <ul className="space-y-2">
              {NOTICES.map((n) => (
                <li
                  key={n.id}
                  className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"
                >
                  <span className="mr-1 inline-flex h-5 items-center rounded bg-warning/15 px-1.5 text-[11px] font-semibold text-warning">
                    {n.severity}
                  </span>
                  <span className="text-fg">{n.title}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
