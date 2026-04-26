'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
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
  Star,
  Undo2,
  UploadCloud,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ObjectState } from '@/components/object-list/ObjectTable';
import { StatusBadge } from '@/components/StatusBadge';
import { ApprovalLine } from '@/components/ApprovalLine';
import { RevisionTree } from '@/components/RevisionTree';
import { DrawingPlaceholder } from '@/components/DrawingPlaceholder';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { AttachmentUploadDialog } from '@/components/object-list/AttachmentUploadDialog';
import { EditObjectDialog } from '@/components/object-list/EditObjectDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { queryKeys } from '@/lib/queries';
import { api, ApiError } from '@/lib/api-client';
import { activityLabel } from '@/lib/activity-labels';

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
  description: string | null;
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
  links: Array<{ id: string; number: string; name: string; direction: 'in' | 'out' }>;
}

// R3c — activity DTO returned by GET /api/v1/objects/:id/activity.
// `metadata` is the raw ActivityLog.metadata JSON column; we don't read it
// today but keep the shape so future fields (revision, ver, comment) stay
// reachable without another contract pass.
interface ActivityItemDTO {
  id: string;
  action: string;
  actor: { id: string; username: string; fullName: string | null };
  ip: string | null;
  metadata: unknown;
  at: string;
}
interface ActivityResponseDTO {
  items: ActivityItemDTO[];
  nextCursor: string | null;
}

// R3c — approval DTO returned by GET /api/v1/objects/:id/approval.
// Mirrors the BE's Approval + ApprovalSteps join exactly.
interface ApprovalApproverDTO {
  id: string;
  username: string;
  fullName: string | null;
}
interface ApprovalStepDTO {
  order: number;
  approver: ApprovalApproverDTO;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  actedAt: string | null;
  comment: string | null;
}
interface ApprovalEntryDTO {
  id: string;
  title: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  revision: number;
  requestedBy: ApprovalApproverDTO;
  requestedAt: string;
  steps: ApprovalStepDTO[];
}
interface ApprovalResponseDTO {
  current: ApprovalEntryDTO | null;
  history: ApprovalEntryDTO[];
}

// Render shapes for the two lazy-loaded tabs. The tab components take VMs
// instead of DTOs so the `obj` shape stays small and the activity / approval
// queries stay independent.
interface ApprovalStepVM {
  step: number;
  name: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | 'SKIPPED';
  at: string;
  comment: string | null;
}
interface ApprovalEntryVM {
  id: string;
  title: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  revision: number;
  requestedBy: string;
  requestedAt: string;
  steps: ApprovalStepVM[];
}
interface ApprovalVM {
  current: ApprovalEntryVM | null;
  history: ApprovalEntryVM[];
}

interface ActivityItemVM {
  id: string;
  time: string;
  action: string;
  actionRaw: string;
  user: string;
  ip: string;
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
    description: dto.description,
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
  };
}

// ─────────────────────────────────────────────────────────────────────────
// R3c — adapters for the two lazy tab queries.
// ─────────────────────────────────────────────────────────────────────────

// Activity action → 한국어 표시 라벨은 `lib/activity-labels.ts`로 통합됨
// (F4-05). FE 활동 탭과 BE 알림 라우트가 같은 매핑을 공유한다.

function formatActivityTime(iso: string): string {
  // YYYY-MM-DD HH:MM — readable inline timestamp for the activity rail.
  // We avoid date-fns to keep this page free of new deps.
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function adaptActivity(dto: ActivityResponseDTO): ActivityItemVM[] {
  return dto.items.map((it) => ({
    id: it.id,
    time: formatActivityTime(it.at),
    action: activityLabel(it.action),
    actionRaw: it.action,
    user: it.actor.fullName ?? it.actor.username,
    ip: it.ip ?? '—',
  }));
}

// R4a (F4-01/F4-02) — schema is now 1:1 with the contract; no IN_PROGRESS
// synthesis needed. The "진행 중" visual marker is derived purely from step
// state inside <ApprovalLine> (any APPROVED step + a later PENDING step).
function mapApprovalEntry(entry: ApprovalEntryDTO): ApprovalEntryVM {
  const firstPendingIdx = entry.steps.findIndex((s) => s.status === 'PENDING');
  return {
    id: entry.id,
    title: entry.title,
    status: entry.status,
    revision: entry.revision,
    requestedBy: entry.requestedBy.fullName ?? entry.requestedBy.username,
    requestedAt: formatDate(entry.requestedAt),
    steps: entry.steps.map((s, i) => ({
      step: s.order,
      name: s.approver.fullName ?? s.approver.username,
      // First PENDING step of an in-flight (PENDING) approval becomes
      // IN_PROGRESS so the UI highlights "진행 중" inline. History entries
      // (APPROVED/REJECTED/CANCELLED) skip this — they're already done.
      status:
        entry.status === 'PENDING' && i === firstPendingIdx
          ? 'IN_PROGRESS'
          : (s.status as ApprovalStepVM['status']),
      at: s.actedAt ? formatActivityTime(s.actedAt) : '',
      comment: s.comment,
    })),
  };
}

function adaptApproval(dto: ApprovalResponseDTO): ApprovalVM {
  return {
    current: dto.current ? mapApprovalEntry(dto.current) : null,
    history: dto.history.map((e) => mapApprovalEntry(e)),
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

// R6 — `me` is now derived from `useSession()`. The /api/v1/me endpoint stays
// available for fields not on the JWT (e.g. signatureFile) but the lock-owner
// gate only needs the id which the session already carries.

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
  // checkin / cancel-revision). R6: server-hydrated SessionProvider gives us
  // the session synchronously on first render, so isLocker resolves immediately
  // instead of flickering "no actions available" while /api/v1/me round-trips.
  const { data: session } = useSession();
  const me = React.useMemo(
    () => (session?.user ? { id: session.user.id } : undefined),
    [session?.user],
  );

  const tabFromUrl = (searchParams?.get('tab') as TabKey | null) ?? 'info';
  const tab: TabKey = TABS.some((t) => t.key === tabFromUrl) ? tabFromUrl : 'info';

  const setTab = (next: TabKey) => {
    const sp = new URLSearchParams(searchParams?.toString());
    sp.set('tab', next);
    router.replace(`/objects/${params.id}?${sp.toString()}`, { scroll: false });
  };

  // R3c — activity & approval feeds. Lazy: each query only fires once the
  // user opens the corresponding tab, so the cold detail render stays
  // single-fetch. staleTime mirrors the detail query (30s) and the retry
  // policy avoids hammering 404/403 the same way.
  const skipTransientRetry = (failureCount: number, err: ApiError) => {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
      return false;
    }
    return failureCount < 2;
  };

  const activityQuery = useQuery<ActivityResponseDTO, ApiError>({
    queryKey: queryKeys.objects.activity(params.id),
    queryFn: () =>
      api.get<ActivityResponseDTO>(
        `/api/v1/objects/${params.id}/activity?limit=50`,
      ),
    enabled: tab === 'activity',
    staleTime: 30_000,
    retry: skipTransientRetry,
  });

  const approvalQuery = useQuery<ApprovalResponseDTO, ApiError>({
    queryKey: queryKeys.objects.approvals(params.id),
    queryFn: () =>
      api.get<ApprovalResponseDTO>(`/api/v1/objects/${params.id}/approval`),
    enabled: tab === 'approval',
    staleTime: 30_000,
    retry: skipTransientRetry,
  });

  // Empty-array fallbacks — keep the tab body safe to render while the
  // query is pending or errored. The tabs themselves render the explicit
  // loading / error states; this just guarantees `.map`/`.length` never
  // explode on `undefined`.
  const activityList = React.useMemo<ActivityItemVM[]>(
    () => (activityQuery.data ? adaptActivity(activityQuery.data) : []),
    [activityQuery.data],
  );
  const approvalVM = React.useMemo<ApprovalVM>(
    () =>
      approvalQuery.data
        ? adaptApproval(approvalQuery.data)
        : { current: null, history: [] },
    [approvalQuery.data],
  );

  // Surface non-404 fetch failures via toast. We dedupe on error identity
  // so re-renders don't keep firing toasts for the same failure.
  const activityErr = activityQuery.error;
  React.useEffect(() => {
    if (!activityErr) return;
    const isNotFound =
      activityErr instanceof ApiError &&
      (activityErr.code === 'E_NOT_FOUND' || activityErr.status === 404);
    if (isNotFound) return;
    toast.error('활동 이력 조회 실패', { description: activityErr.message });
  }, [activityErr]);

  const approvalErr = approvalQuery.error;
  React.useEffect(() => {
    if (!approvalErr) return;
    const isNotFound =
      approvalErr instanceof ApiError &&
      (approvalErr.code === 'E_NOT_FOUND' || approvalErr.status === 404);
    if (isNotFound) return;
    toast.error('결재 이력 조회 실패', { description: approvalErr.message });
  }, [approvalErr]);

  // Mutation factory: same invalidation set for every state transition we
  // wire here. On success: refresh detail + grid + activity/approval feeds
  // (every action writes an ActivityLog row, and `release` also creates an
  // Approval); on error: surface the BE message via toast.
  const useObjectMutation = (action: ObjectAction) =>
    useMutation<unknown, ApiError, void>({
      mutationFn: () =>
        api.post(`/api/v1/objects/${params.id}/${ACTION_PATH[action]}`),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.objects.detail(params.id),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.objects.activity(params.id),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.objects.approvals(params.id),
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
  // R23 — edit dialog state. Wired to the action-bar 수정 button (BUG-06).
  const [editOpen, setEditOpen] = React.useState(false);

  // R7 — pin state for the current object. We piggy-back on the global pins
  // list (already cached when the home tile or sidebar fetched it) so the
  // star reflects the current value without a dedicated request.
  type PinObjectItem = {
    kind: 'object';
    pinId: string;
    sortOrder: number;
    object: { id: string; number: string; name: string; state: string };
  };
  const objectPinsQuery = useQuery<{ items: PinObjectItem[] }, ApiError>({
    queryKey: queryKeys.pins.list('object'),
    queryFn: () =>
      api.get<{ items: PinObjectItem[] }>('/api/v1/me/pins', {
        query: { type: 'object' },
      }),
    staleTime: 60_000,
  });
  const currentPin = objectPinsQuery.data?.items.find(
    (p) => p.object.id === params.id,
  );
  const togglePinMutation = useMutation<unknown, ApiError, void>({
    mutationFn: () => {
      if (currentPin) {
        return api.delete(`/api/v1/me/pins/${currentPin.pinId}`);
      }
      return api.post('/api/v1/me/pins', {
        type: 'object',
        targetId: params.id,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pins.all() });
      toast.success(currentPin ? '즐겨찾기에서 제외했습니다.' : '즐겨찾기에 추가했습니다.');
    },
    onError: (err) => {
      toast.error(currentPin ? '핀 해제 실패' : '핀 고정 실패', {
        description: err.message,
      });
    },
  });

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
            <DropdownMenuItem
              onSelect={(e) => {
                if (!obj.masterAttachmentId) {
                  e.preventDefault();
                  toast('다운로드할 마스터 파일이 없습니다.');
                  return;
                }
                // Use a real anchor click so the browser handles the
                // download — onSelect runs *before* the menu unmounts so
                // calling .click() inline is safe.
                const a = document.createElement('a');
                a.href = `/api/v1/attachments/${obj.masterAttachmentId}/file?download=1`;
                a.download = `${obj.number}`;
                document.body.appendChild(a);
                a.click();
                a.remove();
              }}
            >
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
            label="수정"
            visible={isLocker}
            disabled={pendingMutation}
            onClick={() => setEditOpen(true)}
          />
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
          <ActionButton
            icon={<Download className="h-3.5 w-3.5" />}
            label="다운로드"
            visible={vis.download}
            disabled={!obj.masterAttachmentId}
            onClick={() => {
              if (!obj.masterAttachmentId) return;
              const a = document.createElement('a');
              a.href = `/api/v1/attachments/${obj.masterAttachmentId}/file?download=1`;
              a.download = obj.number;
              document.body.appendChild(a);
              a.click();
              a.remove();
            }}
          />
          <ActionButton icon={<Share2 className="h-3.5 w-3.5" />} label="공유" visible />
          {/* R7 — 즐겨찾기 토글. 이미 핀된 자료라면 채워진 별로 표시. */}
          <ActionButton
            icon={
              <Star
                className={cn(
                  'h-3.5 w-3.5',
                  currentPin && 'fill-current text-amber-500',
                )}
              />
            }
            label={currentPin ? '핀 해제' : '핀 고정'}
            visible
            disabled={togglePinMutation.isPending}
            onClick={() => togglePinMutation.mutate()}
          />
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

      {/* R23 — name/description/securityLevel edit. Mounted alongside the
          page so the dialog can stay open across re-renders triggered by
          the post-save invalidation. */}
      <EditObjectDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        objectId={obj.id}
        initial={{
          name: obj.name,
          description: obj.description,
          securityLevel: obj.securityLevel,
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
        {tab === 'approval' && (
          <ApprovalTab
            data={approvalVM}
            isLoading={approvalQuery.isPending && approvalQuery.fetchStatus !== 'idle'}
            isError={approvalQuery.isError}
          />
        )}
        {tab === 'links' && <LinksTab obj={obj} />}
        {tab === 'activity' && (
          <ActivityTab
            items={activityList}
            isLoading={activityQuery.isPending && activityQuery.fetchStatus !== 'idle'}
            isError={activityQuery.isError}
          />
        )}
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
  // R21 — local upload-dialog state. The button is gated on the same state
  // machine the BE enforces (NEW / CHECKED_IN / CHECKED_OUT-by-self) so the
  // user doesn't see an enabled button that always errors.
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<{
    id: string;
    name: string;
  } | null>(null);
  const canAddAttachment =
    obj.state === 'NEW' || obj.state === 'CHECKED_IN' || obj.state === 'CHECKED_OUT';
  const canMutateAttachment = canAddAttachment;
  const queryClient = useQueryClient();

  // R22 — attachment master toggle + delete. Same edit gate as upload.
  const setMasterMutation = useMutation<unknown, ApiError, string>({
    mutationFn: (attachmentId) =>
      api.patch(`/api/v1/attachments/${attachmentId}`, { isMaster: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.objects.detail(obj.id),
      });
      toast.success('마스터로 지정했습니다.');
    },
    onError: (err) => {
      toast.error('마스터 변경 실패', { description: err.message });
    },
  });

  const deleteAttachmentMutation = useMutation<unknown, ApiError, string>({
    mutationFn: (attachmentId) =>
      api.delete(`/api/v1/attachments/${attachmentId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.objects.detail(obj.id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.objects.activity(obj.id),
      });
      toast.success('첨부를 삭제했습니다.');
      setPendingDelete(null);
    },
    onError: (err) => {
      toast.error('첨부 삭제 실패', { description: err.message });
    },
  });

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
            {canAddAttachment ? (
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="app-action-button h-7 px-2 text-xs"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                첨부 추가
              </button>
            ) : null}
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
                  <a
                    href={`/api/v1/attachments/${a.id}/file?download=1`}
                    download={a.name}
                    aria-label="다운로드"
                    className="app-icon-button inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                  {canMutateAttachment ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label="첨부 메뉴"
                          className="app-icon-button inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        sideOffset={4}
                        className="min-w-[10rem]"
                      >
                        <DropdownMenuItem
                          disabled={a.master || setMasterMutation.isPending}
                          onSelect={() => setMasterMutation.mutate(a.id)}
                        >
                          마스터로 지정
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled={deleteAttachmentMutation.isPending}
                          onSelect={(e) => {
                            e.preventDefault();
                            setPendingDelete({ id: a.id, name: a.name });
                          }}
                        >
                          삭제
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        {canAddAttachment ? (
          <AttachmentUploadDialog
            open={uploadOpen}
            onOpenChange={setUploadOpen}
            objectId={obj.id}
            isFirstAttachment={obj.attachments.length === 0}
          />
        ) : null}

        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => {
            if (!o) setPendingDelete(null);
          }}
          title={`'${pendingDelete?.name ?? ''}' 첨부를 삭제하시겠습니까?`}
          description="삭제된 파일은 되돌릴 수 없습니다. 마스터 첨부는 다른 첨부를 마스터로 지정한 뒤에만 삭제할 수 있습니다."
          confirmText="삭제"
          variant="destructive"
          disabled={deleteAttachmentMutation.isPending}
          onConfirm={async () => {
            if (pendingDelete) {
              await deleteAttachmentMutation.mutateAsync(pendingDelete.id);
            }
          }}
        />
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

function ApprovalTab({
  data,
  isLoading,
  isError,
}: {
  data: ApprovalVM;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) return <TabBlockSkeleton lines={4} />;
  if (isError) {
    return (
      <EmptyState message="결재 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." />
    );
  }

  const hasCurrent = !!data.current;
  const hasHistory = data.history.length > 0;

  if (!hasCurrent && !hasHistory) {
    return <EmptyState message="이 자료에는 결재 이력이 없습니다." />;
  }

  return (
    <div className="space-y-4">
      <div className="app-panel p-4">
        <h3 className="mb-3 text-sm font-semibold text-fg">현재 결재선</h3>
        {data.current ? (
          <>
            <div className="mb-3 text-xs text-fg-muted">
              <span className="font-medium text-fg">{data.current.title}</span>
              <span className="mx-2">·</span>
              <span>R{data.current.revision}</span>
              <span className="mx-2">·</span>
              <span>
                상신 {data.current.requestedBy} · {data.current.requestedAt}
              </span>
            </div>
            <ApprovalLine
              steps={data.current.steps.map((step) => ({
                order: step.step,
                approver: step.name,
                status: step.status,
                actedAt: step.at || null,
                comment: step.comment,
              }))}
            />
          </>
        ) : (
          <p className="text-xs text-fg-muted">진행 중인 결재가 없습니다.</p>
        )}
      </div>

      {hasHistory ? (
        <div className="app-panel p-4">
          <h3 className="mb-3 text-sm font-semibold text-fg">결재 이력</h3>
          <ul className="space-y-3">
            {data.history.map((entry) => (
              <li key={entry.id} className="rounded-md border border-border bg-bg p-3">
                <div className="mb-2 flex items-center gap-2 text-xs text-fg-muted">
                  <span className="font-medium text-fg">{entry.title}</span>
                  <span>·</span>
                  <span>R{entry.revision}</span>
                  <span>·</span>
                  <span>
                    상신 {entry.requestedBy} · {entry.requestedAt}
                  </span>
                  <span className="ml-auto rounded bg-bg-muted px-1.5 py-0.5 text-[11px] text-fg">
                    {APPROVAL_STATUS_LABEL[entry.status]}
                  </span>
                </div>
                <ApprovalLine
                  steps={entry.steps.map((step) => ({
                    order: step.step,
                    approver: step.name,
                    status: step.status,
                    actedAt: step.at || null,
                    comment: step.comment,
                  }))}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const APPROVAL_STATUS_LABEL: Record<ApprovalEntryVM['status'], string> = {
  PENDING: '진행 중',
  APPROVED: '승인',
  REJECTED: '반려',
  CANCELLED: '취소',
};

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

function ActivityTab({
  items,
  isLoading,
  isError,
}: {
  items: ActivityItemVM[];
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) return <TabBlockSkeleton lines={6} />;
  if (isError) {
    return (
      <EmptyState message="활동 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." />
    );
  }
  if (items.length === 0) {
    return <EmptyState message="기록된 활동이 없습니다." />;
  }
  return (
    <ol className="space-y-2">
      {items.map((a) => (
        <li
          key={a.id}
          className="flex items-center gap-3 rounded-md border border-border bg-bg px-3 py-2 text-sm"
        >
          <Clock className="h-4 w-4 text-fg-muted" />
          <span className="font-mono text-xs text-fg-muted">{a.time}</span>
          <span className="rounded bg-bg-muted px-1.5 py-0.5 text-[11px] text-fg">
            {a.action}
          </span>
          <span className="text-fg">{a.user}</span>
          <span className="ml-auto font-mono text-xs text-fg-subtle">{a.ip}</span>
        </li>
      ))}
    </ol>
  );
}

// Shared block-level skeleton for the lazy tabs. Cheap and matches the
// detail page chrome already rendered around it.
function TabBlockSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-2">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="h-10 w-full animate-pulse rounded-md border border-border bg-bg-muted/60"
        />
      ))}
      <span className="sr-only">불러오는 중입니다.</span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-bg-subtle px-4 py-8 text-center text-sm text-fg-muted">
      {message}
    </div>
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
