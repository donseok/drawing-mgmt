'use client';

import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, Loader2, Search, UserRound, UsersRound } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';

/**
 * PrincipalPicker — DESIGN r28 §A.5 / §C.2.
 *
 * Dialog that lets an admin search USER / ORG / GROUP and add one row at a
 * time to the parent permission matrix. Uses the unified
 *   GET /api/v1/principals?type=&q=&limit=
 * endpoint (api_contract.md §3.3).
 *
 * - Tabs persist the search input between switches.
 * - 250 ms debounce on `q`.
 * - "이미 추가됨" pill replaces the action button when the parent already
 *   has the principal in the matrix (de-duped via a composite key
 *   `${type}:${id}`).
 * - Dialog stays open after each add — admins typically grant several rows
 *   in one sitting.
 */

export type PrincipalKind = 'USER' | 'ORG' | 'GROUP';

export interface PrincipalPickerCandidate {
  type: PrincipalKind;
  id: string;
  label: string;
  subLabel?: string;
}

export interface PrincipalPickerProps {
  open: boolean;
  /** composite ids `${type}:${id}` already represented in the matrix. */
  excludeKeys: ReadonlySet<string>;
  /** Fired once per add click. Caller appends the row to the matrix. */
  onAdd: (candidate: PrincipalPickerCandidate) => void;
  onClose: () => void;
}

// Wire shape for /api/v1/principals?type=...&q=... (api_contract.md §3.3).
// `type` arrives in lowercase per the contract; we normalize at the boundary.
interface PrincipalSearchHit {
  id: string;
  type: 'USER' | 'ORG' | 'GROUP' | 'user' | 'org' | 'organization' | 'group';
  label: string;
  sublabel?: string | null;
}

const TAB_LABEL: Record<PrincipalKind, string> = {
  USER: '사용자',
  ORG: '조직',
  GROUP: '그룹',
};

const PLACEHOLDER: Record<PrincipalKind, string> = {
  USER: '이름 또는 사번 (예: 박영호, kim.young-ho)',
  ORG: '조직명 또는 코드 (예: 냉연 1팀)',
  GROUP: '그룹명 (예: drawing-editors)',
};

const ICON: Record<PrincipalKind, React.ComponentType<{ className?: string }>> = {
  USER: UserRound,
  ORG: Building2,
  GROUP: UsersRound,
};

// Backend uses `user | organization | group` per contract §3.3. We send
// lowercase and normalize the response shape upstream.
function tabToWire(tab: PrincipalKind): 'user' | 'organization' | 'group' {
  switch (tab) {
    case 'USER':
      return 'user';
    case 'ORG':
      return 'organization';
    case 'GROUP':
      return 'group';
  }
}

function normalizeType(t: PrincipalSearchHit['type']): PrincipalKind {
  const upper = String(t).toUpperCase();
  if (upper === 'USER') return 'USER';
  if (upper === 'GROUP') return 'GROUP';
  return 'ORG';
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function PrincipalPicker({
  open,
  excludeKeys,
  onAdd,
  onClose,
}: PrincipalPickerProps): JSX.Element {
  const [tab, setTab] = React.useState<PrincipalKind>('USER');
  const [q, setQ] = React.useState('');
  const [addedThisSession, setAddedThisSession] = React.useState(0);

  // Reset transient counters every time the dialog opens. Search text persists
  // across tab switches but resets on a fresh open so admins start clean.
  React.useEffect(() => {
    if (open) {
      setAddedThisSession(0);
      setQ('');
      setTab('USER');
    }
  }, [open]);

  const debouncedQ = useDebouncedValue(q, 250);
  const trimmedQ = debouncedQ.trim();

  const searchQuery = useQuery<PrincipalSearchHit[], ApiError>({
    queryKey: queryKeys.admin.principals({ type: tab, q: trimmedQ }),
    queryFn: () =>
      api.get<PrincipalSearchHit[]>('/api/v1/principals', {
        query: { type: tabToWire(tab), q: trimmedQ || undefined, limit: 30 },
      }),
    enabled: open,
    placeholderData: keepPreviousData, // v5 — see frontend.md §4
    staleTime: 30_000,
  });

  const items: PrincipalPickerCandidate[] = React.useMemo(() => {
    const raw = searchQuery.data ?? [];
    return raw.map((hit) => ({
      type: normalizeType(hit.type),
      id: hit.id,
      label: hit.label,
      subLabel: hit.sublabel ?? undefined,
    }));
  }, [searchQuery.data]);

  const handleAdd = (cand: PrincipalPickerCandidate) => {
    onAdd(cand);
    setAddedThisSession((n) => n + 1);
  };

  const Icon = ICON[tab];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>권한 추가</DialogTitle>
          <DialogDescription>
            검색 후 [+ 추가]를 누르면 매트릭스에 신규 행으로 들어갑니다. 권한 비트는 매트릭스에서
            직접 체크하세요.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as PrincipalKind)}>
          <TabsList aria-label="대상 종류">
            <TabsTrigger value="USER">{TAB_LABEL.USER}</TabsTrigger>
            <TabsTrigger value="ORG">{TAB_LABEL.ORG}</TabsTrigger>
            <TabsTrigger value="GROUP">{TAB_LABEL.GROUP}</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-3">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={PLACEHOLDER[tab]}
            prefix={<Search className="h-4 w-4" aria-hidden="true" />}
            autoFocus
            aria-label={`${TAB_LABEL[tab]} 검색`}
          />
        </div>

        <div
          className="mt-3 max-h-[50vh] min-h-[160px] overflow-auto rounded-md border border-border bg-bg"
          aria-busy={searchQuery.isFetching}
        >
          {searchQuery.isPending ? (
            <div className="flex h-32 items-center justify-center text-sm text-fg-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              불러오는 중…
            </div>
          ) : searchQuery.isError ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-rose-600">
              검색에 실패했습니다.
              <Button
                size="sm"
                variant="outline"
                onClick={() => void searchQuery.refetch()}
              >
                재시도
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-32 items-center justify-center px-4 text-center text-sm text-fg-muted">
              {trimmedQ
                ? `'${trimmedQ}'에 대한 검색 결과가 없습니다.`
                : `검색어를 입력하세요. (예: ${PLACEHOLDER[tab].split('(')[1]?.replace(')', '') ?? ''})`}
            </div>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {items.map((cand) => {
                const key = `${cand.type}:${cand.id}`;
                const alreadyIn = excludeKeys.has(key);
                return (
                  <li
                    key={key}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 transition-colors',
                      !alreadyIn && 'hover:bg-bg-subtle',
                      alreadyIn && 'opacity-60',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-fg">
                          {cand.label}
                        </span>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {cand.type}
                        </Badge>
                      </div>
                      {cand.subLabel ? (
                        <div className="mt-0.5 truncate text-xs text-fg-muted">
                          {cand.subLabel}
                        </div>
                      ) : null}
                    </div>
                    {alreadyIn ? (
                      <span className="text-xs text-fg-muted">이미 추가됨</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAdd(cand)}
                      >
                        + 추가
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
          <Button onClick={onClose}>
            {addedThisSession > 0 ? `완료 (${addedThisSession}건 추가됨)` : '완료'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
