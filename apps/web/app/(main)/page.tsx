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
import { prisma } from '@/lib/prisma';
import { PinnedPanel } from '@/components/workspace/PinnedPanel';

// R55 [QA-P1-3] — replace hardcoded STAT_CARDS counts with live prisma reads.
// Counts are computed from the same predicates that `/api/v1/approvals?box=waiting`
// and the search/lobby pages use, so the dashboard stays in sync with the
// destination pages users click into. Running here on the server side keeps
// the home tile fast (single DB round-trip on render, no client fetch storm).
async function loadStatCounts(userId: string | null): Promise<{
  waiting: number;
  checkedOut: number;
  issues: number;
  recent: number;
}> {
  if (!userId) {
    return { waiting: 0, checkedOut: 0, issues: 0, recent: 0 };
  }
  // BUG-02 — `waiting` must match the `/approval?box=waiting` definition:
  // the user has the *active* (lowest-order PENDING) step on a PENDING
  // approval. The earlier shortcut counted any PENDING step and over-counted
  // approvals where it wasn't yet the user's turn, so the home tile said
  // "1건" while the inbox showed 0.
  const sevenDaysAgoMs = Date.now() - 1000 * 60 * 60 * 24 * 7;
  const sevenDaysAgo = new Date(sevenDaysAgoMs);
  try {
    const [waitingCandidates, checkedOut, recent] = await Promise.all([
      prisma.approval.findMany({
        where: {
          status: 'PENDING',
          steps: { some: { approverId: userId, status: 'PENDING' } },
        },
        select: {
          steps: { select: { approverId: true, order: true, status: true } },
        },
        // Bound the read — typical approver inboxes are <50; cap matches
        // /approval default page size.
        take: 200,
      }),
      prisma.objectEntity.count({
        where: { lockedById: userId },
      }),
      prisma.lobby.count({
        where: { createdAt: { gte: sevenDaysAgo } },
      }),
    ]);
    const waiting = waitingCandidates.filter((a) => {
      const pendingOrders = a.steps
        .filter((s) => s.status === 'PENDING')
        .map((s) => s.order);
      if (pendingOrders.length === 0) return false;
      const minOrder = Math.min(...pendingOrders);
      return a.steps.some(
        (s) =>
          s.order === minOrder &&
          s.approverId === userId &&
          s.status === 'PENDING',
      );
    }).length;
    // No `Issue` model in the schema yet — the home tile keeps the slot
    // visible (so the layout is stable for users who expect 4 cards) but
    // pins the count to 0 until an issue surface lands.
    return { waiting, checkedOut, issues: 0, recent };
  } catch {
    // Dev fallback users (the seed `dev-<username>` ids) don't have a User
    // row, so the queries are empty but never throw. If something *does*
    // explode (DB down) we render zeros instead of crashing the home page.
    return { waiting: 0, checkedOut: 0, issues: 0, recent: 0 };
  }
}

interface StatCardSpec {
  key: string;
  title: string;
  count: number;
  caption: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}

function buildStatCards(counts: {
  waiting: number;
  checkedOut: number;
  issues: number;
  recent: number;
}): StatCardSpec[] {
  return [
    {
      key: 'waiting',
      title: '내 결재 대기',
      count: counts.waiting,
      caption: counts.waiting === 0 ? '대기 중인 결재 없음' : '결재 대기',
      href: '/approval?box=waiting',
      icon: CheckSquare,
      tone: 'text-brand',
    },
    {
      key: 'checkedout',
      title: '내 체크아웃',
      count: counts.checkedOut,
      caption: counts.checkedOut === 0 ? '잠금 중인 자료 없음' : '체크아웃 자료',
      href: '/search?view=checkedout',
      icon: Lock,
      tone: 'text-warning',
    },
    {
      key: 'issues',
      title: '미해결 이슈',
      count: counts.issues,
      caption: '추후 추가 예정',
      href: '/search?view=issues',
      icon: MapPin,
      tone: 'text-danger',
    },
    {
      key: 'transmittal',
      title: '최근 배포',
      count: counts.recent,
      caption: '최근 7일',
      href: '/lobby',
      icon: Send,
      tone: 'text-success',
    },
  ];
}

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

  // R55 [QA-P1-3] — live counts. Server-rendered, so no client fetch waterfall.
  const counts = await loadStatCounts(session?.user?.id ?? null);
  const statCards = buildStatCards(counts);

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-[1500px] px-6 py-5">
        {/* R55 [QA-P0-1] — `break-keep` keeps Korean phrases (한글) from
            wrapping mid-word into vertical columns at narrow widths. The flex
            child also gets `min-w-0` so the truncation chain works when the
            action button cluster wraps below at 375px. */}
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 break-keep">
            <div className="app-kicker">CDE Workspace</div>
            <h1 className="mt-1 break-keep text-2xl font-semibold text-fg">
              오늘의 도면 업무함
            </h1>
            <p className="mt-1 break-keep text-sm text-fg-muted">
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

        {/* R55 [QA-P0-1] — at 375px the original `grid-cols-2` squeezed the
            카드 to ~165px which was too narrow for the Korean labels (they
            were wrapping char-by-char). Drop to a single column on phone, two
            from sm (≥640px), four from lg (≥1024px). */}
        <section
          aria-label="업무 요약"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {statCards.map(({ key, ...card }) => (
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
                        <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold', item.tone)}>
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
        {/* R55 [QA-P0-1] — `whitespace-nowrap` + `break-keep` prevents the
            한글 label from collapsing into one-character-per-line at the
            ~165px viewport. `truncate` falls back to ellipsis if the column
            ever gets narrower than the label itself. */}
        <span className="block truncate whitespace-nowrap break-keep text-xs text-fg-muted">
          {title}
        </span>
        <span className="mt-1 block text-2xl font-semibold text-fg">
          {count}
          <span className="ml-1 break-keep text-xs font-normal text-fg-muted">건</span>
        </span>
        <span className="block truncate break-keep text-[11px] text-fg-subtle">
          {caption}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
