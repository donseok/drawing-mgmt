import Link from 'next/link';
import { Clock3, FileText, Lock, Star, ArrowRight } from 'lucide-react';

const WORK_ITEMS = [
  {
    title: '체크아웃 중',
    count: 2,
    icon: Lock,
    href: '/search?owner=me&state=CHECKED_OUT',
    rows: ['CGL-ELE-2026-00031', 'CGL-INS-2026-00021'],
  },
  {
    title: '최근 열람',
    count: 12,
    icon: Clock3,
    href: '/search?view=recent',
    rows: ['CGL-MEC-2026-00012', 'BFM-PRC-2026-00008'],
  },
  {
    title: '즐겨찾기',
    count: 5,
    icon: Star,
    href: '/search?view=favorites',
    rows: ['CGL-2 / 메인라인', 'CGL-MEC-2026-00009'],
  },
];

export default function WorkspacePage() {
  return (
    <div className="flex-1 overflow-auto bg-bg">
      <div className="border-b border-border px-6 py-5">
        <div className="app-kicker">My Workspace</div>
        <h1 className="mt-1 text-2xl font-semibold text-fg">내 작업공간</h1>
        <p className="mt-1 text-sm text-fg-muted">담당 중인 도면, 최근 작업, 즐겨찾기를 빠르게 확인합니다.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 p-6 xl:grid-cols-3">
        {WORK_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <section key={item.title} className="app-panel overflow-hidden">
              <div className="app-panel-header">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-subtle text-fg-muted">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-fg">{item.title}</h2>
                    <p className="text-xs text-fg-muted">{item.count}건</p>
                  </div>
                </div>
                <Link href={item.href} className="app-icon-button">
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              <ul>
                {item.rows.map((row) => (
                  <li key={row} className="flex items-center gap-2 border-b border-border px-4 py-2.5 last:border-b-0">
                    <FileText className="h-4 w-4 text-fg-subtle" />
                    <span className="truncate font-mono text-[12px] text-fg">{row}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
