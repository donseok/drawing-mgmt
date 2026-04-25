'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ChevronRight,
  Maximize2,
  Edit3,
  GitBranch,
  Send,
  Download,
  Share2,
  MoreHorizontal,
  Image as ImageIcon,
  FileText,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ObjectState } from '@/components/object-list/ObjectTable';

// MOCK detail — TODO: api.get(`/api/v1/objects/${id}`)
const MOCK_OBJECT = {
  id: 'obj-1',
  number: 'CGL-MEC-2026-00012',
  name: '메인롤러 어셈블리',
  state: 'APPROVED' as ObjectState,
  revision: 3,
  version: '0.2',
  classLabel: '기계 / 조립도',
  folderPath: '본사 / 기계 / CGL-2 / 메인라인',
  securityLevel: 3,
  registrant: '박영호',
  registeredAt: '2026-04-12',
  modifiedAt: '2026-04-15',
  masterFile: 'CGL-MEC-2026-00012.dwg',
  masterAttachmentId: 'att-1',
  attributes: [
    { label: '라인', value: 'CGL-2' },
    { label: '부위', value: '메인롤러' },
    { label: '재질', value: 'SS400' },
  ],
  attachments: [
    { id: 'att-1', name: 'CGL-MEC-2026-00012.dwg', size: '2.4MB', master: true },
    { id: 'att-2', name: 'spec.pdf', size: '890KB', master: false },
    { id: 'att-3', name: 'bom.xlsx', size: '120KB', master: false },
  ],
  history: [
    {
      revision: 'R3',
      registrant: '박영호',
      registeredAt: '2026-04-15',
      versions: [
        { version: 'v0.2', label: '체크인됨', current: true },
        { version: 'v0.1', label: '—', current: false },
      ],
    },
    { revision: 'R2', registrant: '박영호', registeredAt: '2026-03-02', versions: [] },
    { revision: 'R1', registrant: '박영호', registeredAt: '2026-02-10', versions: [] },
  ],
  approval: {
    current: [
      { step: 1, name: '김지원', status: 'APPROVED', at: '2026-04-12 09:12' },
      { step: 2, name: '박상민', status: 'APPROVED', at: '2026-04-12 14:33' },
      { step: 3, name: '최정아', status: 'APPROVED', at: '2026-04-13 10:01' },
    ],
  },
  links: [
    { id: 'obj-9', number: 'CGL-MEC-2026-00009', name: '냉각롤러 조립도', direction: 'out' },
    { id: 'obj-2', number: 'CGL-MEC-2026-00013', name: '가이드롤러 베이스', direction: 'in' },
  ],
  activity: [
    { time: '2026-04-15 10:23', action: '체크인', user: '박영호', ip: '10.0.1.42' },
    { time: '2026-04-13 10:01', action: '승인', user: '최정아', ip: '10.0.1.18' },
    { time: '2026-04-12 14:33', action: '승인', user: '박상민', ip: '10.0.1.7' },
    { time: '2026-04-12 09:12', action: '승인', user: '김지원', ip: '10.0.1.3' },
    { time: '2026-04-12 09:00', action: '결재상신', user: '박영호', ip: '10.0.1.42' },
  ],
};

const TABS = [
  { key: 'info', label: '정보' },
  { key: 'history', label: '이력' },
  { key: 'approval', label: '결재' },
  { key: 'links', label: '연결문서' },
  { key: 'activity', label: '활동' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const ACTION_VISIBILITY: Record<ObjectState, Record<string, boolean>> = {
  NEW: { open: true, checkout: true, checkin: false, revise: false, submit: false, cancel: false, delete: true, download: true },
  CHECKED_OUT: { open: true, checkout: false, checkin: true, revise: false, submit: false, cancel: false, delete: false, download: true },
  CHECKED_IN: { open: true, checkout: true, checkin: false, revise: false, submit: true, cancel: false, delete: true, download: true },
  IN_APPROVAL: { open: true, checkout: false, checkin: false, revise: false, submit: false, cancel: true, delete: false, download: true },
  APPROVED: { open: true, checkout: false, checkin: false, revise: true, submit: false, cancel: false, delete: true, download: true },
  DELETED: { open: true, checkout: false, checkin: false, revise: false, submit: false, cancel: false, delete: false, download: true },
};

const STATUS_DOT: Record<ObjectState, string> = {
  NEW: 'bg-status-new',
  CHECKED_OUT: 'bg-status-checkedOut',
  CHECKED_IN: 'bg-status-checkedIn',
  IN_APPROVAL: 'bg-status-inApproval',
  APPROVED: 'bg-status-approved',
  DELETED: 'bg-status-deleted',
};

const STATUS_LABEL: Record<ObjectState, string> = {
  NEW: 'NEW',
  CHECKED_OUT: 'CHECKED_OUT',
  CHECKED_IN: 'CHECKED_IN',
  IN_APPROVAL: 'IN_APPROVAL',
  APPROVED: 'APPROVED',
  DELETED: 'DELETED',
};

export default function ObjectDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();

  // TODO: const { data: obj } = useQuery(['object', params.id], () => api.get(`/api/v1/objects/${params.id}`));
  const obj = MOCK_OBJECT;

  const tabFromUrl = (searchParams?.get('tab') as TabKey | null) ?? 'info';
  const tab: TabKey = TABS.some((t) => t.key === tabFromUrl) ? tabFromUrl : 'info';

  const setTab = (next: TabKey) => {
    const sp = new URLSearchParams(searchParams?.toString());
    sp.set('tab', next);
    router.replace(`/objects/${params.id}?${sp.toString()}`, { scroll: false });
  };

  const vis = ACTION_VISIBILITY[obj.state];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-auto">
      {/* Header bar — breadcrumb + actions */}
      <div className="flex items-center gap-2 border-b border-border bg-bg px-4 py-2 text-xs">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="뒤로"
          className="inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Breadcrumb path={obj.folderPath} number={obj.number} />
        <span
          className={cn(
            'ml-1 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5',
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[obj.state])} aria-hidden />
          <span className="font-medium text-fg">{STATUS_LABEL[obj.state]}</span>
        </span>
        <button
          type="button"
          aria-label="더보기"
          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {/* Title + actions */}
      <div className="border-b border-border bg-bg px-6 py-5">
        <h1 className="text-xl font-bold text-fg">{obj.name}</h1>
        <p className="mt-1 text-xs text-fg-muted">
          R{obj.revision} v{obj.version} · 등록 {obj.registrant} · {obj.registeredAt} · 보안 {obj.securityLevel}급
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <ActionButton
            primary
            href={`/viewer/${obj.masterAttachmentId}`}
            icon={<Maximize2 className="h-3.5 w-3.5" />}
            label="열기"
            visible={vis.open}
          />
          <ActionButton icon={<GitBranch className="h-3.5 w-3.5" />} label="개정" visible={vis.revise} />
          <ActionButton icon={<Edit3 className="h-3.5 w-3.5" />} label="체크아웃" visible={vis.checkout} />
          <ActionButton icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="체크인" visible={vis.checkin} />
          <ActionButton icon={<Send className="h-3.5 w-3.5" />} label="결재상신" visible={vis.submit} />
          <ActionButton icon={<Send className="h-3.5 w-3.5" />} label="결재취소" visible={vis.cancel} />
          <ActionButton icon={<Download className="h-3.5 w-3.5" />} label="다운로드" visible={vis.download} dropdown />
          <ActionButton icon={<Share2 className="h-3.5 w-3.5" />} label="공유" visible />
        </div>
      </div>

      {/* Tabs */}
      <div className="sticky top-0 z-10 border-b border-border bg-bg px-6">
        <nav role="tablist" className="flex gap-2 text-sm">
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={cn(
                  'relative h-10 px-3 font-medium transition-colors',
                  active ? 'text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {t.label}
                {active && (
                  <span aria-hidden className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-brand-500" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab body */}
      <div className="flex-1 overflow-auto p-6">
        {tab === 'info' && <InfoTab obj={obj} />}
        {tab === 'history' && <HistoryTab obj={obj} />}
        {tab === 'approval' && <ApprovalTab obj={obj} />}
        {tab === 'links' && <LinksTab obj={obj} />}
        {tab === 'activity' && <ActivityTab obj={obj} />}
      </div>
    </div>
  );
}

function Breadcrumb({ path, number }: { path: string; number: string }) {
  const parts = path.split(' / ');
  return (
    <ol className="flex flex-wrap items-center gap-1 text-fg-muted">
      <li className="font-medium">폴더:</li>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          <li className="text-fg-muted hover:text-fg">{p}</li>
          {i < parts.length - 1 && <ChevronRight className="h-3 w-3 opacity-60" />}
        </React.Fragment>
      ))}
      <ChevronRight className="h-3 w-3 opacity-60" />
      <li className="font-mono text-fg">{number}</li>
    </ol>
  );
}

interface BtnProps {
  label: string;
  icon?: React.ReactNode;
  visible?: boolean;
  primary?: boolean;
  href?: string;
  dropdown?: boolean;
}
function ActionButton({ label, icon, visible = true, primary, href, dropdown }: BtnProps) {
  if (!visible) return null;
  const cls = cn(
    'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors',
    primary
      ? 'bg-brand text-brand-foreground hover:opacity-90'
      : 'border border-border bg-bg text-fg hover:bg-bg-muted',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  );
  const inner = (
    <>
      {icon}
      <span>{label}</span>
      {dropdown && <ChevronRight className="h-3 w-3 rotate-90 opacity-70" />}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" className={cls}>
      {inner}
    </button>
  );
}

function InfoTab({ obj }: { obj: typeof MOCK_OBJECT }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {/* Preview */}
        <div className="overflow-hidden rounded-lg border border-border bg-bg">
          <div className="flex h-10 items-center justify-between border-b border-border px-3 text-xs text-fg-muted">
            <span className="font-semibold uppercase tracking-wide">미리보기</span>
            <Link
              href={`/viewer/${obj.masterAttachmentId}`}
              className="inline-flex h-7 items-center gap-1 rounded text-fg-muted hover:text-fg"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              전체화면
            </Link>
          </div>
          <div className="flex h-[420px] items-center justify-center bg-bg-muted text-fg-subtle">
            {/* TODO: embed PDF.js / dxf-viewer thumbnail */}
            <ImageIcon className="h-12 w-12" />
          </div>
        </div>

        {/* Attachments */}
        <div className="overflow-hidden rounded-lg border border-border bg-bg">
          <div className="flex h-10 items-center border-b border-border px-3 text-xs">
            <span className="font-semibold uppercase tracking-wide text-fg-muted">
              첨부파일 ({obj.attachments.length})
            </span>
          </div>
          <ul>
            {obj.attachments.map((a, i) => (
              <li
                key={a.id}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 text-sm',
                  i !== obj.attachments.length - 1 && 'border-b border-border',
                )}
              >
                {a.master ? (
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-brand text-[10px] font-bold text-brand-foreground">
                    M
                  </span>
                ) : (
                  <FileText className="h-4 w-4 text-fg-muted" />
                )}
                <span className="font-mono text-[12px] text-fg">{a.name}</span>
                <span className="ml-auto font-mono text-xs text-fg-muted">{a.size}</span>
                <button
                  type="button"
                  aria-label="다운로드"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Properties */}
      <aside className="space-y-4">
        <div className="overflow-hidden rounded-lg border border-border bg-bg">
          <div className="flex h-10 items-center border-b border-border px-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            속성
          </div>
          <dl className="grid grid-cols-[100px_1fr] gap-y-2 px-3 py-3 text-[12px]">
            <DT>도면번호</DT><DD mono>{obj.number}</DD>
            <DT>자료유형</DT><DD>{obj.classLabel}</DD>
            <DT>폴더</DT><DD>{obj.folderPath}</DD>
            <DT>보안등급</DT><DD>{obj.securityLevel}급</DD>
            <DT>마스터</DT><DD mono>{obj.masterFile}</DD>
            <DT>등록자</DT><DD>{obj.registrant}</DD>
            <DT>등록일</DT><DD mono>{obj.registeredAt}</DD>
            <DT>수정일</DT><DD mono>{obj.modifiedAt}</DD>
          </dl>
          <div className="border-t border-border px-3 py-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
              자료유형 속성
            </div>
            <dl className="grid grid-cols-[100px_1fr] gap-y-2 text-[12px]">
              {obj.attributes.map((a) => (
                <React.Fragment key={a.label}>
                  <DT>{a.label}</DT>
                  <DD>{a.value}</DD>
                </React.Fragment>
              ))}
            </dl>
          </div>
        </div>
      </aside>
    </div>
  );
}

function HistoryTab({ obj }: { obj: typeof MOCK_OBJECT }) {
  // TODO: Designer is providing a `RevisionTree` component — replace this inline tree with it.
  return (
    <div className="space-y-3">
      {obj.history.map((rev) => (
        <div key={rev.revision} className="rounded-lg border border-border bg-bg p-4">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-mono font-bold text-fg">{rev.revision}</span>
            <span className="font-mono text-xs text-fg-muted">{rev.registeredAt}</span>
            <span className="text-xs text-fg-muted">{rev.registrant}</span>
          </div>
          {rev.versions.length > 0 && (
            <ul className="mt-2 space-y-1.5 border-l border-border pl-4">
              {rev.versions.map((v) => (
                <li
                  key={v.version}
                  className="flex items-center gap-3 text-sm text-fg-muted"
                >
                  <span className="font-mono">{v.version}</span>
                  <span>{v.label}</span>
                  {v.current && (
                    <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand-500">
                      현재
                    </span>
                  )}
                  <button
                    type="button"
                    className="ml-auto rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-bg-muted"
                  >
                    열기
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-bg-muted"
                  >
                    되돌리기
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function ApprovalTab({ obj }: { obj: typeof MOCK_OBJECT }) {
  // TODO: Designer is providing an `ApprovalLine` component — swap once available.
  return (
    <div className="rounded-lg border border-border bg-bg p-4">
      <h3 className="mb-3 text-sm font-semibold text-fg">현재 결재선</h3>
      <ol className="space-y-2">
        {obj.approval.current.map((step) => (
          <li key={step.step} className="flex items-center gap-3 text-sm">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            <span className="font-medium text-fg">{step.step}단계 — {step.name}</span>
            <span className="ml-auto font-mono text-xs text-fg-muted">{step.at}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function LinksTab({ obj }: { obj: typeof MOCK_OBJECT }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-fg">이 자료가 연결한 문서</h3>
        <ul className="space-y-1.5">
          {obj.links.filter((l) => l.direction === 'out').map((l) => (
            <li key={l.id} className="rounded-md border border-border bg-bg px-3 py-2 text-sm">
              <Link href={`/objects/${l.id}`} className="font-mono text-xs text-fg hover:underline">
                {l.number}
              </Link>
              <span className="ml-2 text-xs text-fg-muted">{l.name}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-fg">이 자료를 연결한 문서</h3>
        <ul className="space-y-1.5">
          {obj.links.filter((l) => l.direction === 'in').map((l) => (
            <li key={l.id} className="rounded-md border border-border bg-bg px-3 py-2 text-sm">
              <Link href={`/objects/${l.id}`} className="font-mono text-xs text-fg hover:underline">
                {l.number}
              </Link>
              <span className="ml-2 text-xs text-fg-muted">{l.name}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ActivityTab({ obj }: { obj: typeof MOCK_OBJECT }) {
  return (
    <ol className="space-y-2">
      {obj.activity.map((a, i) => (
        <li key={i} className="flex items-center gap-3 rounded-md border border-border bg-bg px-3 py-2 text-sm">
          <Clock className="h-4 w-4 text-fg-muted" />
          <span className="font-mono text-xs text-fg-muted">{a.time}</span>
          <span className="rounded bg-bg-muted px-1.5 py-0.5 text-[11px] text-fg">{a.action}</span>
          <span className="text-fg">{a.user}</span>
          <span className="ml-auto font-mono text-xs text-fg-subtle">{a.ip}</span>
        </li>
      ))}
    </ol>
  );
}

function DT({ children }: { children: React.ReactNode }) {
  return <dt className="text-fg-muted">{children}</dt>;
}
function DD({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <dd className={cn('text-fg', mono && 'font-mono')}>{children}</dd>;
}
