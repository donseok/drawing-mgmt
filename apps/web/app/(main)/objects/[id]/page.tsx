'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
  Lock,
  Undo2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ObjectState } from '@/components/object-list/ObjectTable';
import { StatusBadge } from '@/components/StatusBadge';
import { ApprovalLine } from '@/components/ApprovalLine';
import { RevisionTree } from '@/components/RevisionTree';
import { DrawingPlaceholder } from '@/components/DrawingPlaceholder';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { queryKeys } from '@/lib/queries';
import { api, ApiError } from '@/lib/api-client';

// ─────────────────────────────────────────────────────────────────────────
// Detail DTO — shape returned by GET /api/v1/objects/:id (route.ts
// `detailInclude`). BigInt and Decimal columns serialize as strings via
// safeJsonStringify in lib/api-response.ts, so `size`, `currentVersion`, and
// `ver` are all `string` on the wire.
// ─────────────────────────────────────────────────────────────────────────
interface AttachmentDTO {
  id: string;
  filename: string;
  size: string; // BigInt → string
  mimeType: string;
  isMaster: boolean;
}

interface VersionDTO {
  id: string;
  ver: string; // Decimal → string (e.g. "0.2")
  createdAt: string;
  createdBy: string;
  attachments: AttachmentDTO[];
}

interface RevisionDTO {
  id: string;
  rev: number;
  createdAt: string;
  versions: VersionDTO[];
}

interface ObjectLinkRefDTO {
  id: string;
  number: string;
  name: string;
  state: ObjectState;
}

interface ObjectAttributeValueDTO {
  attributeId: string;
  value: string;
  attribute: {
    id: string;
    code: string;
    label: string;
    dataType: string;
    required: boolean;
    sortOrder: number;
  };
}

interface ObjectDetailDTO {
  id: string;
  number: string;
  name: string;
  description: string | null;
  state: ObjectState;
  currentRevision: number;
  currentVersion: string; // Decimal → string
  securityLevel: number;
  classId: string;
  folderId: string;
  ownerId: string;
  lockedById: string | null;
  createdAt: string;
  updatedAt: string;
  folder: { id: string; name: string; folderCode: string };
  class: { id: string; code: string; name: string };
  owner: {
    id: string;
    username: string;
    fullName: string | null;
    organizationId: string | null;
  };
  lockedBy: { id: string; username: string; fullName: string | null } | null;
  attributes: ObjectAttributeValueDTO[];
  links: Array<{ id: string; targetId: string; target: ObjectLinkRefDTO }>;
  linkedFrom: Array<{ id: string; sourceId: string; source: ObjectLinkRefDTO }>;
  revisions: RevisionDTO[];
}

// ObjectVM — the page's render shape. Kept stable so the tab subcomponents
// (InfoTab/HistoryTab/ApprovalTab/LinksTab/ActivityTab) read fields with the
// same names regardless of how the DTO shifts.
interface ObjectVM {
  id: string;
  number: string;
  name: string;
  state: ObjectState;
  revision: number;
  version: string;
  classLabel: string;
  folderPath: string;
  securityLevel: number;
  registrant: string;
  registeredAt: string;
  modifiedAt: string;
  masterFile: string | null;
  masterAttachmentId: string | null;
  lockedBy: { id: string; name: string } | null;
  attributes: Array<{ label: string; value: string }>;
  attachments: Array<{ id: string; name: string; size: string; master: boolean }>;
  history: Array<{
    revision: string;
    registrant: string;
    registeredAt: string;
    versions: Array<{ version: string; label: string; current: boolean }>;
  }>;
  approval: {
    current: Array<{ step: number; name: string; status: string; at: string }>;
  };
  links: Array<{ id: string; number: string; name: string; direction: 'in' | 'out' }>;
  activity: Array<{ time: string; action: string; user: string; ip: string }>;
}

function formatDate(iso: string): string {
  // ISO timestamp → YYYY-MM-DD. Keeps the existing UI format.
  return iso ? iso.slice(0, 10) : '';
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function adaptObjectDetail(dto: ObjectDetailDTO): ObjectVM {
  const latestRevision = dto.revisions[0];
  const latestVersion = latestRevision?.versions[0];
  const latestAttachments = latestVersion?.attachments ?? [];
  const masterAttachment = latestAttachments.find((a) => a.isMaster) ?? null;

  // History: each revision shows its versions; flag the current one (top of
  // the latest revision). Empty `versions` is fine — RevisionTree handles it.
  const history = dto.revisions.map((rev, revIdx) => ({
    revision: `R${rev.rev}`,
    registrant: dto.owner.fullName ?? dto.owner.username,
    registeredAt: formatDate(rev.createdAt),
    versions: rev.versions.map((v, vIdx) => ({
      version: `v${v.ver}`,
      label: revIdx === 0 && vIdx === 0 ? '최신' : '—',
      current: revIdx === 0 && vIdx === 0,
    })),
  }));

  const folderPath = `${dto.folder.folderCode} / ${dto.folder.name}`;

  return {
    id: dto.id,
    number: dto.number,
    name: dto.name,
    state: dto.state,
    revision: dto.currentRevision,
    version: dto.currentVersion,
    classLabel: dto.class.name,
    folderPath,
    securityLevel: dto.securityLevel,
    registrant: dto.owner.fullName ?? dto.owner.username,
    registeredAt: formatDate(dto.createdAt),
    modifiedAt: formatDate(dto.updatedAt),
    masterFile: masterAttachment?.filename ?? null,
    masterAttachmentId: masterAttachment?.id ?? null,
    lockedBy: dto.lockedBy
      ? {
          id: dto.lockedBy.id,
          name: dto.lockedBy.fullName ?? dto.lockedBy.username,
        }
      : null,
    attributes: dto.attributes
      .slice()
      .sort((a, b) => a.attribute.sortOrder - b.attribute.sortOrder)
      .map((a) => ({ label: a.attribute.label, value: a.value })),
    attachments: latestAttachments.map((a) => ({
      id: a.id,
      name: a.filename,
      size: formatBytes(Number(a.size)),
      master: a.isMaster,
    })),
    history,
    // R3c: separate query for current approval steps. Empty for now — the
    // tab still renders, just with no rows.
    approval: { current: [] },
    links: [
      ...dto.links.map((l) => ({
        id: l.target.id,
        number: l.target.number,
        name: l.target.name,
        direction: 'out' as const,
      })),
      ...dto.linkedFrom.map((l) => ({
        id: l.source.id,
        number: l.source.number,
        name: l.source.name,
        direction: 'in' as const,
      })),
    ],
    // R3c: separate activity query. Empty array keeps ActivityTab safe.
    activity: [],
  };
}

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
  CHECKED_OUT: { open: true, checkout: false, checkin: true, revise: false, submit: false, cancel: true, delete: false, download: true },
  CHECKED_IN: { open: true, checkout: true, checkin: false, revise: false, submit: true, cancel: false, delete: true, download: true },
  IN_APPROVAL: { open: true, checkout: false, checkin: false, revise: false, submit: false, cancel: false, delete: false, download: true },
  APPROVED: { open: true, checkout: true, checkin: false, revise: false, submit: false, cancel: false, delete: true, download: true },
  DELETED: { open: true, checkout: false, checkin: false, revise: false, submit: false, cancel: false, delete: false, download: true },
};

// /api/v1/me payload — only the field we use for lock-ownership checks.
interface MeResponse {
  id: string;
}

// Object mutation actions wired in BUG-05 + R3 SIDE-A.
// `release` is approval submission (CHECKED_IN → IN_APPROVAL) — wired to
// "결재상신" in a later round.
// `cancelCheckout` is the dedicated unlock endpoint added in R3 SIDE-A.
type ObjectAction = 'checkout' | 'checkin' | 'release' | 'cancelCheckout';

// Endpoint paths use kebab-case; the action union stays camelCase to read
// well at call sites. Keep both aligned via this map.
const ACTION_PATH: Record<ObjectAction, string> = {
  checkout: 'checkout',
  checkin: 'checkin',
  release: 'release',
  cancelCheckout: 'cancel-checkout',
};

const ACTION_LABEL: Record<ObjectAction, string> = {
  checkout: '체크아웃',
  checkin: '체크인',
  release: '결재상신',
  cancelCheckout: '개정 취소',
};

export default function ObjectDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // R3b — live detail query. Mutation invalidate of `objects.detail(id)`
  // (in `useObjectMutation` below) drives auto-refetch, so state-badge
  // refresh after checkout/checkin (BUG-08) is now automatic.
  const detailQuery = useQuery<ObjectDetailDTO, ApiError>({
    queryKey: queryKeys.objects.detail(params.id),
    queryFn: () => api.get<ObjectDetailDTO>(`/api/v1/objects/${params.id}`),
    staleTime: 30_000,
    retry: (failureCount, err) => {
      // Don't hammer 404/403 — they aren't transient.
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        return false;
      }
      return failureCount < 2;
    },
  });

  const obj = React.useMemo<ObjectVM | null>(
    () => (detailQuery.data ? adaptObjectDetail(detailQuery.data) : null),
    [detailQuery.data],
  );

  // Surface non-404 fetch failures via toast once per error instance.
  // 404 stays silent — DetailError already explains it inline.
  const fetchErr = detailQuery.error;
  React.useEffect(() => {
    if (!fetchErr) return;
    const isNotFound =
      fetchErr instanceof ApiError &&
      (fetchErr.code === 'E_NOT_FOUND' || fetchErr.status === 404);
    if (isNotFound) return;
    toast.error('자료 조회 실패', { description: fetchErr.message });
  }, [fetchErr]);

  // Current user — used to gate CHECKED_OUT actions (only the locker can
  // checkin / cancel-revision). SessionProvider isn't wired yet, so we read
  // the session through the existing /api/v1/me endpoint.
  const { data: me } = useQuery<MeResponse>({
    queryKey: queryKeys.me(),
    queryFn: () => api.get<MeResponse>('/api/v1/me'),
    staleTime: 5 * 60 * 1000,
  });

  const tabFromUrl = (searchParams?.get('tab') as TabKey | null) ?? 'info';
  const tab: TabKey = TABS.some((t) => t.key === tabFromUrl) ? tabFromUrl : 'info';

  const setTab = (next: TabKey) => {
    const sp = new URLSearchParams(searchParams?.toString());
    sp.set('tab', next);
    router.replace(`/objects/${params.id}?${sp.toString()}`, { scroll: false });
  };

  // Mutation factory: same invalidation set for every state transition we
  // wire here. On success: refresh detail + grid; on error: surface the BE
  // message via toast.
  const useObjectMutation = (action: ObjectAction) =>
    useMutation<unknown, ApiError, void>({
      mutationFn: () =>
        api.post(`/api/v1/objects/${params.id}/${ACTION_PATH[action]}`),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.objects.detail(params.id),
        });
        void queryClient.invalidateQueries({ queryKey: queryKeys.objects.all() });
        toast.success(`${ACTION_LABEL[action]} 완료`);
      },
      onError: (err) => {
        toast.error(`${ACTION_LABEL[action]} 실패`, {
          description: err.message,
        });
      },
    });

  const checkoutMutation = useObjectMutation('checkout');
  const checkinMutation = useObjectMutation('checkin');
  const cancelCheckoutMutation = useObjectMutation('cancelCheckout');

  const [confirmCancelOpen, setConfirmCancelOpen] = React.useState(false);

  // Loading / error gates land AFTER all hooks. The fetch error code drives
  // 404 vs generic-error UI; the data-shaped path runs on success.
  if (detailQuery.isPending) {
    return <DetailSkeleton />;
  }

  if (detailQuery.isError || !obj) {
    const err = detailQuery.error;
    const notFound =
      err instanceof ApiError && (err.code === 'E_NOT_FOUND' || err.status === 404);
    return <DetailError notFound={notFound} message={err?.message} />;
  }

  // From here `obj` is non-null.
  const vis = ACTION_VISIBILITY[obj.state];

  // BUG-05 — lock ownership determines whether CHECKED_OUT actions are
  // available. When the object is locked by someone else, we show a lock
  // banner instead of action buttons.
  const isLocker =
    obj.state === 'CHECKED_OUT' && !!obj.lockedBy && obj.lockedBy.id === me?.id;
  const lockedByOther =
    obj.state === 'CHECKED_OUT' && !!obj.lockedBy && obj.lockedBy.id !== me?.id;
  const isInApproval = obj.state === 'IN_APPROVAL';

  const pendingMutation =
    checkoutMutation.isPending ||
    checkinMutation.isPending ||
    cancelCheckoutMutation.isPending;

  const showCheckout = vis.checkout && !lockedByOther && !isInApproval;
  const showCheckin = vis.checkin && isLocker;
  const showCancel = vis.cancel && isLocker;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-auto">
      {/* Header bar — breadcrumb + actions */}
      <div className="flex items-center gap-2 border-b border-border bg-bg px-4 py-2 text-xs">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="뒤로"
          className="app-icon-button h-7 w-7"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Breadcrumb path={obj.folderPath} number={obj.number} />
        <StatusBadge status={obj.state} size="sm" className="ml-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="더보기"
              className="app-icon-button ml-auto h-7 w-7"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          {/* Items are placeholders — wiring the trigger is the BUG-09 fix
              (menu must open). Real handlers land in later rounds. */}
          <DropdownMenuContent align="end" sideOffset={4} className="min-w-[10rem]">
            <DropdownMenuItem onSelect={() => toast('다운로드 (준비 중)')}>
              <Download className="text-fg-muted" />
              다운로드
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toast('공유 링크 복사 (준비 중)')}>
              <Share2 className="text-fg-muted" />
              공유
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toast('이동 (준비 중)')}>
              <ChevronRight className="text-fg-muted" />
              이동
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>삭제</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Title + actions */}
      <div className="border-b border-border bg-bg px-6 py-5">
        <div className="app-kicker">Drawing Detail</div>
        <h1 className="mt-1 text-xl font-semibold text-fg">{obj.name}</h1>
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
          <ActionButton
            icon={<Edit3 className="h-3.5 w-3.5" />}
            label={checkoutMutation.isPending ? '체크아웃 중…' : '체크아웃'}
            visible={showCheckout}
            disabled={pendingMutation}
            onClick={() => checkoutMutation.mutate()}
          />
          <ActionButton
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            label={checkinMutation.isPending ? '체크인 중…' : '체크인'}
            visible={showCheckin}
            disabled={pendingMutation}
            onClick={() => checkinMutation.mutate()}
          />
          <ActionButton icon={<Send className="h-3.5 w-3.5" />} label="결재상신" visible={vis.submit} />
          <ActionButton
            icon={<Undo2 className="h-3.5 w-3.5" />}
            label={cancelCheckoutMutation.isPending ? '개정 취소 중…' : '개정 취소'}
            visible={showCancel}
            disabled={pendingMutation}
            onClick={() => setConfirmCancelOpen(true)}
          />
          <ActionButton icon={<Download className="h-3.5 w-3.5" />} label="다운로드" visible={vis.download} dropdown />
          <ActionButton icon={<Share2 className="h-3.5 w-3.5" />} label="공유" visible />
        </div>

        {lockedByOther && obj.lockedBy ? (
          <div
            role="status"
            className="mt-3 flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-fg"
          >
            <Lock className="h-3.5 w-3.5 text-warning" />
            <span className="font-medium">{obj.lockedBy.name}</span>
            <span className="text-fg-muted">
              님이 체크아웃 중입니다. 체크인 또는 개정 취소는 잠금 소유자만 수행할 수 있습니다.
            </span>
          </div>
        ) : null}

        {isInApproval ? (
          <div
            role="status"
            className="mt-3 flex items-center gap-2 rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-fg"
          >
            <Send className="h-3.5 w-3.5 text-info" />
            <span className="text-fg-muted">결재 진행 중입니다. 결과 확정까지 액션이 제한됩니다.</span>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmCancelOpen}
        onOpenChange={setConfirmCancelOpen}
        title="개정을 취소하시겠습니까?"
        description="체크아웃이 해제되고 작업 중인 변경 내용이 사라질 수 있습니다."
        confirmText="개정 취소"
        variant="destructive"
        disabled={cancelCheckoutMutation.isPending}
        onConfirm={async () => {
          await cancelCheckoutMutation.mutateAsync();
          setConfirmCancelOpen(false);
        }}
      />

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
  disabled?: boolean;
  onClick?: () => void;
}
function ActionButton({
  label,
  icon,
  visible = true,
  primary,
  href,
  dropdown,
  disabled,
  onClick,
}: BtnProps) {
  if (!visible) return null;
  const cls = cn(
    primary ? 'app-action-button-primary' : 'app-action-button',
    disabled && 'pointer-events-none opacity-60',
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
      <Link href={href} className={cls} aria-disabled={disabled || undefined}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} disabled={disabled} onClick={onClick}>
      {inner}
    </button>
  );
}

function InfoTab({ obj }: { obj: ObjectVM }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        {/* Preview */}
        <div className="app-panel overflow-hidden">
          <div className="app-panel-header">
            <span className="app-kicker">미리보기</span>
            <Link
              href={`/viewer/${obj.masterAttachmentId}`}
              className="app-action-button h-7 px-2 text-xs"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              전체화면
            </Link>
          </div>
          {/* TODO: embed PDF.js / dxf-viewer thumbnail */}
          <DrawingPlaceholder
            gridSize={28}
            tone="border"
            cardClassName="h-20 w-20"
            className="h-[420px]"
          />
        </div>

        {/* Attachments */}
        <div className="app-panel overflow-hidden">
          <div className="app-panel-header">
            <span className="app-kicker">
              첨부파일 ({obj.attachments.length})
            </span>
          </div>
          <ul>
            {obj.attachments.map((a, i) => {
              // BUG-07 — DWG/DXF/PDF attachments open in the viewer when their
              // name is clicked (mirrors ObjectTable double-click + preview
              // panel "열기"). Other formats stay non-clickable for now.
              const ext = a.name.split('.').pop()?.toLowerCase();
              const viewable = ext === 'dwg' || ext === 'dxf' || ext === 'pdf';
              const nameClass = 'font-mono text-[12px] text-fg';
              return (
                <li
                  key={a.id}
                  className={cn(
                    'flex items-center gap-3 px-4 py-2.5 text-sm',
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
                  {viewable ? (
                    <Link
                      href={`/viewer/${a.id}`}
                      className={cn(nameClass, 'hover:underline')}
                    >
                      {a.name}
                    </Link>
                  ) : (
                    <span className={nameClass}>{a.name}</span>
                  )}
                  <span className="ml-auto font-mono text-xs text-fg-muted">{a.size}</span>
                  <button
                    type="button"
                    aria-label="다운로드"
                    className="app-icon-button h-7 w-7"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Properties */}
      <aside className="space-y-4">
        <div className="app-panel overflow-hidden">
          <div className="app-panel-header">
            <span className="app-kicker">속성</span>
          </div>
          <dl className="grid grid-cols-[100px_1fr] gap-y-2 px-4 py-4 text-[12px]">
            <DT>도면번호</DT><DD mono>{obj.number}</DD>
            <DT>상태</DT><DD><StatusBadge status={obj.state} size="sm" /></DD>
            <DT>자료유형</DT><DD>{obj.classLabel}</DD>
            <DT>폴더</DT><DD>{obj.folderPath}</DD>
            <DT>보안등급</DT><DD>{obj.securityLevel}급</DD>
            <DT>마스터</DT><DD mono>{obj.masterFile}</DD>
            <DT>등록자</DT><DD>{obj.registrant}</DD>
            <DT>등록일</DT><DD mono>{obj.registeredAt}</DD>
            <DT>수정일</DT><DD mono>{obj.modifiedAt}</DD>
          </dl>
          <div className="border-t border-border px-4 py-4">
            <div className="app-kicker mb-2">
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

function HistoryTab({ obj }: { obj: ObjectVM }) {
  return (
    <RevisionTree
      revisions={obj.history.map((rev) => ({
        rev: rev.revision,
        createdAt: rev.registeredAt,
        createdBy: rev.registrant,
        versions: rev.versions.map((version) => ({
          version: version.version,
          state: version.label,
          current: version.current,
          createdAt: rev.registeredAt,
          createdBy: rev.registrant,
        })),
      }))}
      versionActions={() => (
        <>
          <button type="button" className="app-action-button h-7 px-2 text-xs">
            열기
          </button>
          <button type="button" className="app-action-button h-7 px-2 text-xs">
            되돌리기
          </button>
        </>
      )}
    />
  );
}

function ApprovalTab({ obj }: { obj: ObjectVM }) {
  return (
    <div className="app-panel p-4">
      <h3 className="mb-3 text-sm font-semibold text-fg">현재 결재선</h3>
      <ApprovalLine
        steps={obj.approval.current.map((step) => ({
          order: step.step,
          approver: step.name,
          status: step.status as 'APPROVED',
          actedAt: step.at,
        }))}
      />
    </div>
  );
}

function LinksTab({ obj }: { obj: ObjectVM }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-fg">이 자료가 연결한 문서</h3>
        <ul className="space-y-1.5">
          {obj.links.filter((l) => l.direction === 'out').map((l) => (
            <li key={l.id} className="rounded-md border border-border bg-bg px-3 py-2 text-sm transition-colors hover:bg-bg-subtle">
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
            <li key={l.id} className="rounded-md border border-border bg-bg px-3 py-2 text-sm transition-colors hover:bg-bg-subtle">
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

function ActivityTab({ obj }: { obj: ObjectVM }) {
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

// ─────────────────────────────────────────────────────────────────────────
// Loading / error UIs — only the main content area; the chrome (header bar,
// breadcrumb, tabs) needs the loaded object so we render a placeholder for
// the entire page during the first fetch. Subsequent refetches keep the old
// data via React Query's cache, so this only flashes on first navigation.
// ─────────────────────────────────────────────────────────────────────────
function DetailSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex h-full min-w-0 flex-1 flex-col overflow-auto"
    >
      <div className="flex items-center gap-2 border-b border-border bg-bg px-4 py-2 text-xs">
        <div className="h-7 w-7 animate-pulse rounded bg-bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded bg-bg-muted" />
        <div className="ml-auto h-7 w-7 animate-pulse rounded bg-bg-muted" />
      </div>
      <div className="border-b border-border bg-bg px-6 py-5">
        <div className="h-3 w-24 animate-pulse rounded bg-bg-muted" />
        <div className="mt-2 h-6 w-72 animate-pulse rounded bg-bg-muted" />
        <div className="mt-2 h-3 w-96 animate-pulse rounded bg-bg-muted" />
        <div className="mt-3 flex gap-1.5">
          <div className="h-8 w-20 animate-pulse rounded bg-bg-muted" />
          <div className="h-8 w-24 animate-pulse rounded bg-bg-muted" />
          <div className="h-8 w-24 animate-pulse rounded bg-bg-muted" />
        </div>
      </div>
      <div className="flex-1 p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <div className="h-[420px] animate-pulse rounded bg-bg-muted" />
            <div className="h-32 animate-pulse rounded bg-bg-muted" />
          </div>
          <div className="h-72 animate-pulse rounded bg-bg-muted" />
        </div>
      </div>
      <span className="sr-only">자료를 불러오는 중입니다.</span>
    </div>
  );
}

function DetailError({
  notFound,
  message,
}: {
  notFound: boolean;
  message?: string;
}) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-auto">
      <div className="flex items-center gap-2 border-b border-border bg-bg px-4 py-2 text-xs">
        <Link
          href="/search"
          aria-label="검색으로 돌아가기"
          className="app-icon-button h-7 w-7"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="text-fg-muted">자료 상세</span>
      </div>
      <div
        role="alert"
        className="m-6 flex flex-col items-center gap-3 rounded-md border border-border bg-bg p-10 text-center"
      >
        <h2 className="text-lg font-semibold text-fg">
          {notFound ? '자료를 찾을 수 없습니다' : '자료를 불러오지 못했습니다'}
        </h2>
        <p className="max-w-md text-sm text-fg-muted">
          {notFound
            ? '요청하신 자료가 존재하지 않거나 접근 권한이 없습니다. 검색 페이지에서 다른 자료를 확인해 주세요.'
            : (message ?? '잠시 후 다시 시도해 주세요.')}
        </p>
        <Link href="/search" className="app-action-button mt-2">
          <ArrowLeft className="h-3.5 w-3.5" />
          검색으로 이동
        </Link>
      </div>
    </div>
  );
}
