import Link from 'next/link';
import { auth } from '@/auth';
import {
  CheckSquare,
  Lock,
  ArrowRight,
  Plus,
  Activity,
  Search,
  UploadCloud,
  Send,
  GitCompare,
  AlertTriangle,
  MapPin,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { PinnedPanel } from '@/components/workspace/PinnedPanel';

const STAT_CARDS = [
  {
    key: 'waiting',
    title: '내 결재 대기',
    count: 3,
    caption: '평균 지연 4.2h',
    href: '/approval?box=waiting',
    icon: CheckSquare,
    tone: 'text-brand',
  },
  {
    key: 'checkedout',
    title: '내 체크아웃',
    count: 2,
    caption: '오늘 1건 만료',
    href: '/workspace?tab=checkedout',
    icon: Lock,
    tone: 'text-warning',
  },
  {
    key: 'issues',
    title: '미해결 이슈',
    count: 7,
    caption: '도면 핀 4건',
    href: '/search?view=issues',
    icon: MapPin,
    tone: 'text-danger',
  },
  {
    key: 'transmittal',
    title: '최근 배포',
    count: 9,
    caption: '현장배포본 포함',
    href: '/workspace?tab=recent',
    icon: Send,
    tone: 'text-success',
  },
];

const WORK_QUEUE = [
  {
    kind: '결재',
    title: 'R3 메인롤러 어셈블리 승인',
    number: 'CGL-MEC-2026-00012',
    meta: '변경 비교 필요 · 마크업 2',
    due: '오늘',
    href: '/approval?box=waiting',
    tone: 'text-brand',
    icon: CheckSquare,
  },
  {
    kind: '체크아웃',
    title: '메인 컨트롤 패널 결선도',
    number: 'CGL-ELE-2026-00031',
    meta: '최정아 · 잠금 6h',
    due: 'D-1',
    href: '/search?owner=me&state=CHECKED_OUT',
    tone: 'text-warning',
    icon: Lock,
  },
  {
    kind: '이슈',
    title: '소둔로 P&ID 미해결 핀',
    number: 'BFM-PRC-2026-00008',
    meta: '담당자 지정 필요',
    due: 'D-3',
    href: '/search?view=issues',
    tone: 'text-danger',
    icon: AlertTriangle,
  },
  {
    kind: '배포',
    title: 'CGL-2 현장배포 패키지 확인',
    number: 'TR-2026-0041',
    meta: '홍성기계 · PDF 12건',
    due: 'D-5',
    href: '/lobby',
    tone: 'text-success',
    icon: Send,
  },
];

const SAVED_VIEWS = [
  { label: '내 체크아웃', count: 2, href: '/search?view=checkedout', icon: Lock },
  { label: '승인 대기 도면', count: 3, href: '/search?view=review', icon: CheckSquare },
  { label: '미해결 이슈 포함', count: 7, href: '/search?view=issues', icon: MapPin },
  { label: '현장배포본', count: 148, href: '/search?view=for-field', icon: ShieldCheck },
  { label: '리비전 비교 필요', count: 4, href: '/search?view=compare', icon: GitCompare },
];

// R7 — FAVORITES fixture removed; replaced by <PinnedPanel /> which fetches
// live `/api/v1/me/pins`. Kept the layout slot identical so the row of
// "Recent activity / Pinned" tiles still composes the same on load.

const RECENT_ACTIVITY = [
  { time: '10:23', no: 'CGL-MEC-2026-00012', action: '체크인', user: '박영호', actionColor: 'text-info' },
  { time: '09:55', no: 'CGL-ELE-2026-00031', action: '승인됨 (3/3)', user: '결재선', actionColor: 'text-success' },
  { time: '09:14', no: 'BFM-PRC-2026-00008', action: '신규등록', user: '김철수', actionColor: 'text-fg-muted' },
  { time: '08:41', no: 'CGL-MEC-2026-00009', action: '결재상신', user: '박영호', actionColor: 'text-brand' },
  { time: '08:02', no: 'CGL-INS-2026-00021', action: '체크아웃', user: '최정아', actionColor: 'text-warning' },
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
      <div className="mx-auto w-full max-w-[1500px] px-6 py-5">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="app-kicker">CDE Workspace</div>
            <h1 className="mt-1 text-2xl font-semibold text-fg">오늘의 도면 업무함</h1>
            <p className="mt-1 text-sm text-fg-muted">
              {name} 님 · {formatToday()} 기준 최신본, 결재, 이슈, 배포 상태입니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/search" className="app-action-button h-9">
              <Search className="h-4 w-4" />
              자료 검색
            </Link>
            <Link href="/search?action=bulk" className="app-action-button h-9">
              <UploadCloud className="h-4 w-4" />
              일괄 등록
            </Link>
            <Link href="/search?action=new" className="app-action-button-primary h-9">
              <Plus className="h-4 w-4" />
              신규 자료 등록
            </Link>
          </div>
        </header>

        <section aria-label="업무 요약" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {STAT_CARDS.map(({ key, ...card }) => (
            <MetricCard key={key} {...card} />
          ))}
        </section>

        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="app-panel overflow-hidden" aria-label="오늘 처리할 업무">
            <div className="app-panel-header">
              <div>
                <div className="app-kicker">Work Queue</div>
                <h2 className="text-sm font-semibold text-fg">오늘 처리할 항목</h2>
              </div>
              <Link href="/approval?box=waiting" className="text-[12px] font-medium text-brand hover:underline">
                전체 보기
              </Link>
            </div>
            <table className="app-table">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>문서</th>
                  <th>상태</th>
                  <th className="text-right">기한</th>
                </tr>
              </thead>
              <tbody>
                {WORK_QUEUE.map((item) => {
                  const Icon = item.icon;
                  return (
                    <tr key={item.number} className="hover:bg-bg-subtle">
                      <td>
                        <span className={cn('inline-flex items-center gap-1.5 text-[12px] font-semibold', item.tone)}>
                          <Icon className="h-3.5 w-3.5" />
                          {item.kind}
                        </span>
                      </td>
                      <td>
                        <Link href={item.href} className="group inline-flex min-w-0 flex-col">
                          <span className="truncate font-medium text-fg group-hover:text-brand">{item.title}</span>
                          <span className="font-mono text-[12px] text-fg-muted">{item.number}</span>
                        </Link>
                      </td>
                      <td className="text-[12px] text-fg-muted">{item.meta}</td>
                      <td className="text-right font-mono text-[12px] font-semibold text-fg">{item.due}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="app-panel overflow-hidden" aria-label="저장된 보기">
            <div className="app-panel-header">
              <div>
                <div className="app-kicker">Saved Views</div>
                <h2 className="text-sm font-semibold text-fg">빠른 문서 통제 보기</h2>
              </div>
            </div>
            <div className="divide-y divide-border">
              {SAVED_VIEWS.map((view) => {
                const Icon = view.icon;
                return (
                  <Link
                    key={view.label}
                    href={view.href}
                    className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-bg-subtle"
                  >
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-subtle text-fg-subtle">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-fg">{view.label}</span>
                      <span className="block text-[12px] text-fg-muted">저장된 필터</span>
                    </span>
                    <span className="font-mono text-sm font-semibold text-fg">{view.count}</span>
                    <ArrowRight className="h-4 w-4 text-fg-subtle" />
                  </Link>
                );
              })}
            </div>
          </section>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="app-panel overflow-hidden" aria-label="최근 활동">
            <div className="app-panel-header">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-fg-subtle" />
                <h2 className="text-sm font-semibold text-fg">최근 활동</h2>
              </div>
              <div className="hidden items-center gap-1 sm:flex">
                {['전체', '내 작업', '내 팀'].map((label, index) => (
                  <span key={label} className={cn('app-chip h-6', index === 0 && 'app-chip-active')}>
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <ul className="divide-y divide-border">
              {RECENT_ACTIVITY.map((a) => (
                <li key={`${a.time}-${a.no}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-12 font-mono text-xs text-fg-muted">{a.time}</span>
                  <Link href="/objects/obj-1" className="font-mono text-[12px] text-fg hover:text-brand">
                    {a.no}
                  </Link>
                  <span className={cn('text-[12px] font-medium', a.actionColor)}>[{a.action}]</span>
                  <span className="text-[12px] text-fg-muted">{a.user}</span>
                </li>
              ))}
            </ul>
          </section>

          <PinnedPanel />
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  count,
  caption,
  href,
  icon: Icon,
  tone,
}: {
  title: string;
  count: number;
  caption: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <Link href={href} className="app-data-card group flex min-h-24 items-center gap-3">
      <span className={cn('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-bg-subtle', tone)}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-fg-muted">{title}</span>
        <span className="mt-1 block text-2xl font-semibold text-fg">
          {count}<span className="ml-1 text-xs font-normal text-fg-muted">건</span>
        </span>
        <span className="block truncate text-[11px] text-fg-subtle">{caption}</span>
      </span>
      <ArrowRight className="h-4 w-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
