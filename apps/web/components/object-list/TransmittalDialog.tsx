'use client';

/**
 * TransmittalDialog — bundle the current selection into a Lobby package and
 * ship it to one or more target organizations (R18 / As-Is "트랜스미털").
 *
 * The dialog is admin-agnostic — any authenticated user can create a lobby
 * for objects they can VIEW. The BE drops un-permitted rows from the package
 * (`droppedFromSelection` count round-trips back so we can flag silent drops
 * in the success toast).
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';
import { cn } from '@/lib/cn';

interface OrganizationRow {
  id: string;
  name: string;
  parentId: string | null;
}

interface CreateLobbyResponse {
  id: string;
  attachmentCount: number;
  targetCount: number;
  droppedFromSelection: number;
}

export interface TransmittalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Object ids that go into the package. */
  objectIds: string[];
  /** Optional default folder id for the package metadata. */
  defaultFolderId?: string;
}

export function TransmittalDialog({
  open,
  onOpenChange,
  objectIds,
  defaultFolderId,
}: TransmittalDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [title, setTitle] = React.useState('');
  const [expiresAt, setExpiresAt] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [selectedOrgs, setSelectedOrgs] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [partnersOnly, setPartnersOnly] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setTitle(`${objectIds.length}건 자료 전달 - ${todayLabel()}`);
      // Default expiry: +7 days, formatted for `<input type="datetime-local">`
      // which wants `YYYY-MM-DDTHH:mm`.
      const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      setExpiresAt(formatLocalDateTime(d));
      setDescription('');
      setSelectedOrgs(new Set());
      setPartnersOnly(true);
      setErr(null);
    }
  }, [open, objectIds.length]);

  const orgsQuery = useQuery<OrganizationRow[], ApiError>({
    queryKey: ['organizations', partnersOnly ? 'partners' : 'all'],
    queryFn: () =>
      api.get<OrganizationRow[]>('/api/v1/organizations', {
        query: { partnersOnly: partnersOnly ? 'true' : undefined },
      }),
    enabled: open,
    staleTime: 60_000,
  });

  const orgs = orgsQuery.data ?? [];

  const toggleOrg = (id: string) => {
    setSelectedOrgs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const mutation = useMutation<
    CreateLobbyResponse,
    ApiError,
    {
      title: string;
      description?: string;
      expiresAt?: string;
      objectIds: string[];
      targetCompanyIds: string[];
      folderId?: string;
    }
  >({
    mutationFn: (vars) => api.post<CreateLobbyResponse>('/api/v1/lobbies', vars),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.lobby.all() });
      const droppedNote =
        res.droppedFromSelection > 0
          ? ` (${res.droppedFromSelection}건은 권한/첨부 부재로 제외)`
          : '';
      toast.success(
        `트랜스미털을 생성했습니다 — ${res.attachmentCount}건 첨부${droppedNote}`,
      );
      onOpenChange(false);
      router.push(`/lobby/${res.id}`);
    },
    onError: (err) => {
      setErr(err.message);
    },
  });

  const submit = () => {
    setErr(null);
    if (!title.trim()) {
      setErr('제목을 입력하세요.');
      return;
    }
    if (objectIds.length === 0) {
      setErr('전달할 자료가 없습니다.');
      return;
    }
    // Convert local datetime to ISO. Empty input → omit.
    const expiresIso = expiresAt
      ? new Date(expiresAt).toISOString()
      : undefined;
    mutation.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      expiresAt: expiresIso,
      objectIds,
      targetCompanyIds: Array.from(selectedOrgs),
      folderId: defaultFolderId,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>트랜스미털 생성</DialogTitle>
          <DialogDescription>
            선택한 {objectIds.length}건의 자료 마스터 파일을 패키지로 묶어 협력업체나
            팀에 배포합니다. 권한이 없는 자료는 자동으로 제외됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block">
            <span className="app-kicker mb-1 block">제목</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoFocus
              className="h-9 w-full rounded-md border border-border bg-bg px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="block">
            <span className="app-kicker mb-1 block">만료일</span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-bg px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="block">
            <span className="app-kicker mb-1 block">설명 (선택)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="검토 요청 내용 등"
              className="w-full rounded-md border border-border bg-bg-subtle p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="app-kicker">대상 조직</span>
              <label className="flex items-center gap-1.5 text-[11px] text-fg-muted">
                <input
                  type="checkbox"
                  checked={partnersOnly}
                  onChange={(e) => setPartnersOnly(e.target.checked)}
                  className="h-3 w-3 rounded border-border accent-brand"
                />
                협력업체만
              </label>
            </div>
            <div className="max-h-40 overflow-auto rounded-md border border-border bg-bg-subtle p-2">
              {orgsQuery.isPending ? (
                <div className="space-y-1">
                  {Array.from({ length: 4 }, (_, i) => (
                    <div
                      key={i}
                      className="h-7 animate-pulse rounded-md bg-bg-muted/60"
                    />
                  ))}
                </div>
              ) : orgs.length === 0 ? (
                <div className="px-2 py-3 text-xs text-fg-muted">
                  조직이 없습니다.
                </div>
              ) : (
                <ul className="space-y-0.5">
                  {orgs.map((o) => {
                    const checked = selectedOrgs.has(o.id);
                    return (
                      <li key={o.id}>
                        <label
                          className={cn(
                            'flex h-7 cursor-pointer items-center gap-2 rounded px-2 text-sm transition-colors',
                            checked ? 'bg-bg text-fg ring-1 ring-border' : 'hover:bg-bg-muted',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleOrg(o.id)}
                            className="h-3.5 w-3.5 rounded border-border accent-brand"
                          />
                          <span className="flex-1 truncate">{o.name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <p className="mt-1 text-[11px] text-fg-subtle">
              선택 {selectedOrgs.size}건. 비워두면 본인만 "상신함"에서 확인 가능합니다.
            </p>
          </div>

          {err ? (
            <p role="alert" className="text-xs text-danger">
              {err}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
            className="app-action-button h-9"
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={mutation.isPending}
            className="app-action-button-primary h-9"
          >
            {mutation.isPending ? '생성 중…' : `${objectIds.length}건 트랜스미털`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function todayLabel(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
