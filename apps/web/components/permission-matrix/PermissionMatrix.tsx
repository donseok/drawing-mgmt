'use client';

import * as React from 'react';
import {
  Building2,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';
import { PrincipalPicker } from '@/components/principal-picker/PrincipalPicker';
import type { PrincipalPickerCandidate } from '@/components/principal-picker/PrincipalPicker';

/**
 * PermissionMatrix — DESIGN r28 §A.4 / §C.1.
 *
 * 9-column folder permission editor. Tracks four row states:
 *   normal | dirty | new | removed
 * State is a reducer; the reducer is the only mutation channel so footer
 * counters (`dirtyCount`, `principalCount`) and Undo / Save semantics stay in
 * sync.
 *
 * Save is full-replace: the parent feeds `onSave(rows)` with every non-removed
 * row and the BE wipes-then-inserts the folder's permission set. The matrix
 * does NOT submit `removed` rows (removing a row IS deleting it).
 */

// ── Wire shape (api_contract.md §3.1) ─────────────────────────────────────
export type PrincipalType = 'USER' | 'ORG' | 'GROUP';

export const PERMISSION_BIT_KEYS = [
  'viewFolder',
  'editFolder',
  'viewObject',
  'editObject',
  'deleteObject',
  'approveObject',
  'download',
  'print',
] as const;
export type PermissionBitKey = (typeof PERMISSION_BIT_KEYS)[number];
export type PermissionBits = Record<PermissionBitKey, boolean>;

export const ALL_OFF: PermissionBits = {
  viewFolder: false,
  editFolder: false,
  viewObject: false,
  editObject: false,
  deleteObject: false,
  approveObject: false,
  download: false,
  print: false,
};

// PM-DECISION-1 default = view-only (least-privilege but immediately useful).
// Newly-added rows default to viewFolder + viewObject ON, all other bits OFF.
const NEW_ROW_DEFAULT: PermissionBits = {
  ...ALL_OFF,
  viewFolder: true,
  viewObject: true,
};

export interface PermissionMatrixServerRow {
  // The wire row carries an `id` only for existing permissions; new rows
  // never have one (they're synthesized client-side and assigned by the BE
  // after PUT).
  id?: string;
  principalType: PrincipalType;
  principalId: string;
  principalLabel: string;
  principalSublabel?: string | null;
  viewFolder: boolean;
  editFolder: boolean;
  viewObject: boolean;
  editObject: boolean;
  deleteObject: boolean;
  approveObject: boolean;
  download: boolean;
  print: boolean;
}

// ── Internal row shape (form-state, NOT wire) ────────────────────────────
type RowState = 'normal' | 'dirty' | 'new' | 'removed';

export interface MatrixRow {
  /** local identity, stable across saves; new rows use uuid-ish strings. */
  localId: string;
  /** server id when known. Absent for `new` rows. */
  serverId?: string;
  principalType: PrincipalType;
  principalId: string;
  principalLabel: string;
  principalSublabel?: string;
  bits: PermissionBits;
  /** snapshot at load time. null for `new` rows. drives dirty derivation. */
  origin: PermissionBits | null;
  state: RowState;
}

// ── Submitted shape — what onSave receives ───────────────────────────────
export interface PermissionMatrixSubmitRow {
  principalType: PrincipalType;
  principalId: string;
  viewFolder: boolean;
  editFolder: boolean;
  viewObject: boolean;
  editObject: boolean;
  deleteObject: boolean;
  approveObject: boolean;
  download: boolean;
  print: boolean;
}

// ── Column metadata (api_contract.md §8 — Korean labels) ─────────────────
interface ColumnSpec {
  key: PermissionBitKey;
  short: string; // header label (8/9 columns are tight)
  full: string; // tooltip + aria-label
}

const COLUMNS: ColumnSpec[] = [
  { key: 'viewFolder', short: '폴더', full: '폴더 보기 (트리에 노출)' },
  { key: 'editFolder', short: '편집', full: '폴더 편집 (이름·코드·이동)' },
  { key: 'viewObject', short: '자료', full: '자료 보기' },
  { key: 'editObject', short: '수정', full: '자료 편집 (체크아웃·체크인·개정)' },
  { key: 'deleteObject', short: '삭제', full: '자료 삭제 (폐기/복원)' },
  { key: 'approveObject', short: '승인', full: '결재 승인/반려' },
  { key: 'download', short: '다운', full: '다운로드 (원본/변환본)' },
  { key: 'print', short: '인쇄', full: '인쇄 (워터마크 포함)' },
];

const TYPE_ICON: Record<PrincipalType, React.ComponentType<{ className?: string }>> = {
  USER: UserRound,
  ORG: Building2,
  GROUP: UsersRound,
};

// ── Reducer ──────────────────────────────────────────────────────────────
type Action =
  | {
      type: 'LOAD_FROM_SERVER';
      rows: PermissionMatrixServerRow[];
    }
  | {
      type: 'TOGGLE_BIT';
      localId: string;
      bit: PermissionBitKey;
    }
  | {
      type: 'TOGGLE_COLUMN';
      bit: PermissionBitKey;
      next: boolean;
    }
  | {
      type: 'ADD_ROW';
      candidate: PrincipalPickerCandidate;
    }
  | {
      type: 'REMOVE_ROW';
      localId: string;
    }
  | {
      type: 'RESTORE_ROW';
      localId: string;
    }
  | {
      type: 'REVERT_ROW';
      localId: string;
    }
  | { type: 'REVERT_ALL' };

// Stable (per-session) local id for new rows. crypto.randomUUID is not
// universally available in older Edge runtimes, so we fall back to a
// timestamp + counter combination that is unique inside a single browser tab.
let __localCounter = 0;
function newLocalId(): string {
  __localCounter += 1;
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `local-${Date.now()}-${__localCounter}`;
}

function bitsEqual(a: PermissionBits, b: PermissionBits): boolean {
  for (const k of PERMISSION_BIT_KEYS) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function deriveDirtyState(row: MatrixRow): RowState {
  if (row.state === 'removed') return 'removed';
  if (row.state === 'new') return 'new';
  if (!row.origin) return 'new';
  return bitsEqual(row.bits, row.origin) ? 'normal' : 'dirty';
}

function adaptServerRow(r: PermissionMatrixServerRow): MatrixRow {
  const bits: PermissionBits = {
    viewFolder: r.viewFolder,
    editFolder: r.editFolder,
    viewObject: r.viewObject,
    editObject: r.editObject,
    deleteObject: r.deleteObject,
    approveObject: r.approveObject,
    download: r.download,
    print: r.print,
  };
  return {
    localId: newLocalId(),
    serverId: r.id,
    principalType: r.principalType,
    principalId: r.principalId,
    principalLabel: r.principalLabel,
    principalSublabel: r.principalSublabel ?? undefined,
    bits,
    origin: { ...bits },
    state: 'normal',
  };
}

function reducer(state: MatrixRow[], action: Action): MatrixRow[] {
  switch (action.type) {
    case 'LOAD_FROM_SERVER':
      return action.rows.map(adaptServerRow);

    case 'TOGGLE_BIT': {
      return state.map((row) => {
        if (row.localId !== action.localId) return row;
        if (row.state === 'removed') return row; // disabled
        const nextBits: PermissionBits = { ...row.bits, [action.bit]: !row.bits[action.bit] };
        const next: MatrixRow = { ...row, bits: nextBits };
        next.state = deriveDirtyState(next);
        return next;
      });
    }

    case 'TOGGLE_COLUMN': {
      // Apply to every non-removed row. The caller has already computed the
      // target value (next) so all touched rows end up identical for this bit.
      return state.map((row) => {
        if (row.state === 'removed') return row;
        const nextBits: PermissionBits = { ...row.bits, [action.bit]: action.next };
        const next: MatrixRow = { ...row, bits: nextBits };
        next.state = deriveDirtyState(next);
        return next;
      });
    }

    case 'ADD_ROW': {
      const composite = `${action.candidate.type}:${action.candidate.id}`;
      // De-dupe: if a removed row exists for this principal, restore it
      // instead of stacking duplicates.
      const removedIdx = state.findIndex(
        (r) =>
          r.state === 'removed' &&
          `${r.principalType}:${r.principalId}` === composite,
      );
      if (removedIdx >= 0) {
        const next = [...state];
        const r = next[removedIdx]!;
        next[removedIdx] = {
          ...r,
          state: deriveDirtyState({ ...r, state: r.origin ? 'normal' : 'new' }),
        };
        return next;
      }
      // Skip if already present non-removed (PrincipalPicker normally guards
      // this but defense-in-depth keeps the reducer correct).
      const exists = state.some(
        (r) =>
          r.state !== 'removed' &&
          `${r.principalType}:${r.principalId}` === composite,
      );
      if (exists) return state;

      const newRow: MatrixRow = {
        localId: newLocalId(),
        principalType: action.candidate.type,
        principalId: action.candidate.id,
        principalLabel: action.candidate.label,
        principalSublabel: action.candidate.subLabel,
        bits: { ...NEW_ROW_DEFAULT },
        origin: null,
        state: 'new',
      };
      return [...state, newRow];
    }

    case 'REMOVE_ROW': {
      const next: MatrixRow[] = [];
      for (const row of state) {
        if (row.localId !== action.localId) {
          next.push(row);
          continue;
        }
        // A purely-new row that's removed disappears outright (origin === null).
        if (row.origin === null) continue;
        next.push({ ...row, state: 'removed' });
      }
      return next;
    }

    case 'RESTORE_ROW': {
      // 🧹 정리 — pull a `removed` row back to its prior state. If origin
      // exists we recompute dirty vs normal; if it doesn't, the row was new
      // and we simply mark it `new`.
      return state.map((row) => {
        if (row.localId !== action.localId) return row;
        if (row.state !== 'removed') return row;
        if (!row.origin) return { ...row, state: 'new' as const };
        const next: MatrixRow = { ...row, state: 'normal' };
        next.state = deriveDirtyState(next);
        return next;
      });
    }

    case 'REVERT_ROW': {
      return state.map((row) => {
        if (row.localId !== action.localId) return row;
        if (!row.origin) return row;
        return { ...row, bits: { ...row.origin }, state: 'normal' as const };
      });
    }

    case 'REVERT_ALL': {
      const next: MatrixRow[] = [];
      for (const row of state) {
        if (row.state === 'new') continue; // discard newly-added rows
        if (!row.origin) continue;
        next.push({ ...row, bits: { ...row.origin }, state: 'normal' });
      }
      return next;
    }

    default:
      return state;
  }
}

// ── Component ────────────────────────────────────────────────────────────
export interface PermissionMatrixProps {
  /** Folder header info (breadcrumb). */
  folder: { id: string; name: string; pathLabel?: string };
  /** Server payload, freshly loaded. Caller passes `[]` until ready. */
  initialPermissions: PermissionMatrixServerRow[];
  /** Read-only mode (e.g. <1280 viewport fallback). */
  readOnly?: boolean;
  /** True while the parent is fetching new data — disables interactions
   *  visually but does not block reducer dispatches. */
  refetching?: boolean;
  /** Save handler. Caller wires the PUT and the success toast. */
  onSave: (rows: PermissionMatrixSubmitRow[]) => Promise<void>;
  /** ✕ 닫기. The parent should also handle the unsaved-changes guard. */
  onClose: () => void;
  /** Callback so the parent can hook the unsaved-changes guard. */
  onDirtyCountChange?: (count: number) => void;
}

export function PermissionMatrix({
  folder,
  initialPermissions,
  readOnly,
  refetching,
  onSave,
  onClose,
  onDirtyCountChange,
}: PermissionMatrixProps): JSX.Element {
  const [rows, dispatch] = React.useReducer(reducer, initialPermissions, (init) =>
    init.map(adaptServerRow),
  );
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [revertConfirm, setRevertConfirm] = React.useState(false);

  // When the parent reloads data (folder change, save success, manual refetch)
  // re-seed the reducer. We compare a stable reference to avoid loops on
  // every render.
  const initialPermissionsRef = React.useRef(initialPermissions);
  React.useEffect(() => {
    if (initialPermissionsRef.current !== initialPermissions) {
      initialPermissionsRef.current = initialPermissions;
      dispatch({ type: 'LOAD_FROM_SERVER', rows: initialPermissions });
    }
  }, [initialPermissions]);

  // Derive principal/dirty counters once per render. Used by header buttons
  // and surfaced to the parent so the page-level beforeunload guard can read
  // the same number we display.
  const principalCount = rows.filter((r) => r.state !== 'removed').length;
  const dirtyCount = rows.filter((r) => r.state !== 'normal').length;

  React.useEffect(() => {
    onDirtyCountChange?.(dirtyCount);
  }, [dirtyCount, onDirtyCountChange]);

  // Composite-key set drives the PrincipalPicker's "이미 추가됨" disable.
  const excludeKeys = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.state === 'removed') continue;
      set.add(`${r.principalType}:${r.principalId}`);
    }
    return set;
  }, [rows]);

  const handleAddPrincipal = React.useCallback((cand: PrincipalPickerCandidate) => {
    dispatch({ type: 'ADD_ROW', candidate: cand });
  }, []);

  const handleSave = React.useCallback(async () => {
    if (dirtyCount === 0 || saving || readOnly) return;
    const submitRows: PermissionMatrixSubmitRow[] = rows
      .filter((r) => r.state !== 'removed')
      .map((r) => ({
        principalType: r.principalType,
        principalId: r.principalId,
        viewFolder: r.bits.viewFolder,
        editFolder: r.bits.editFolder,
        viewObject: r.bits.viewObject,
        editObject: r.bits.editObject,
        deleteObject: r.bits.deleteObject,
        approveObject: r.bits.approveObject,
        download: r.bits.download,
        print: r.bits.print,
      }));
    try {
      setSaving(true);
      await onSave(submitRows);
      // Parent owns the refetch → this hook's effect on `initialPermissions`
      // will re-seed the reducer once new data arrives.
    } finally {
      setSaving(false);
    }
  }, [dirtyCount, onSave, readOnly, rows, saving]);

  const handleRevertAll = React.useCallback(() => {
    if (dirtyCount === 0) return;
    setRevertConfirm(true);
  }, [dirtyCount]);

  const confirmRevertAll = React.useCallback(() => {
    dispatch({ type: 'REVERT_ALL' });
    setRevertConfirm(false);
  }, []);

  // Column header click = bulk toggle. Rule: mixed → ON, all-on → OFF, all-off
  // → ON. Computed against non-removed rows.
  const handleHeaderClick = React.useCallback(
    (bit: PermissionBitKey) => {
      if (readOnly) return;
      const editable = rows.filter((r) => r.state !== 'removed');
      if (editable.length === 0) return;
      const allOn = editable.every((r) => r.bits[bit]);
      const next = !allOn; // mixed or all-off → on; all-on → off
      dispatch({ type: 'TOGGLE_COLUMN', bit, next });
    },
    [readOnly, rows],
  );

  // aria-pressed state for screen readers.
  const headerPressed = React.useMemo(() => {
    const map = {} as Record<PermissionBitKey, boolean | 'mixed'>;
    const editable = rows.filter((r) => r.state !== 'removed');
    for (const c of COLUMNS) {
      if (editable.length === 0) {
        map[c.key] = false;
        continue;
      }
      const allOn = editable.every((r) => r.bits[c.key]);
      const allOff = editable.every((r) => !r.bits[c.key]);
      map[c.key] = allOn ? true : allOff ? false : 'mixed';
    }
    return map;
  }, [rows]);

  const breadcrumb = folder.pathLabel ?? folder.name;

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col">
        {/* Header (sticky) */}
        <div className="sticky top-0 z-20 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="app-kicker">폴더 권한 매트릭스</div>
              <h2 className="mt-0.5 truncate font-mono-num text-[13px] text-fg" title={breadcrumb}>
                {breadcrumb}
              </h2>
              <div className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
                <span>
                  {principalCount} principals
                </span>
                {dirtyCount > 0 ? (
                  <span className="font-medium text-amber-700 dark:text-amber-400">
                    ▴ {dirtyCount} 변경
                  </span>
                ) : null}
                {refetching ? (
                  <Loader2
                    className="h-3 w-3 animate-spin text-fg-subtle"
                    aria-label="새로고침 중"
                  />
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPickerOpen(true)}
                disabled={readOnly}
              >
                <Plus className="h-4 w-4" /> 추가
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRevertAll}
                disabled={readOnly || dirtyCount === 0 || saving}
              >
                <RotateCcw className="h-4 w-4" /> 되돌리기 {dirtyCount > 0 ? `(${dirtyCount})` : ''}
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={readOnly || dirtyCount === 0 || saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> 저장 중…
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" /> 저장 {dirtyCount > 0 ? `(${dirtyCount})` : ''}
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onClose}
                aria-label="매트릭스 닫기"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Matrix table — wrapped in a horizontal-scroll container for 1280
            viewports where 9 columns + sidebar + tree exceed available width. */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-bg-subtle shadow-[inset_0_-1px_0] shadow-border">
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 min-w-[240px] border-r border-border bg-bg-subtle px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted"
                >
                  Principal
                </th>
                {COLUMNS.map((col) => {
                  const pressed = headerPressed[col.key];
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      className="w-[64px] px-1 py-2 text-center"
                      aria-label={col.full}
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => handleHeaderClick(col.key)}
                            disabled={readOnly}
                            aria-pressed={pressed === 'mixed' ? 'mixed' : pressed}
                            className={cn(
                              'mx-auto flex h-7 w-full items-center justify-center rounded-sm text-[11px] font-semibold uppercase tracking-wide text-fg-muted',
                              'hover:bg-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              pressed === true && 'text-brand',
                              pressed === 'mixed' && 'text-amber-700',
                              readOnly && 'cursor-not-allowed opacity-60',
                            )}
                          >
                            {col.short}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{col.full}</TooltipContent>
                      </Tooltip>
                    </th>
                  );
                })}
                <th scope="col" className="w-[44px] px-1 py-2" aria-label="행 동작" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <MatrixRowView
                  key={row.localId}
                  row={row}
                  readOnly={readOnly}
                  onToggleBit={(bit) =>
                    dispatch({ type: 'TOGGLE_BIT', localId: row.localId, bit })
                  }
                  onRemove={() => dispatch({ type: 'REMOVE_ROW', localId: row.localId })}
                  onRestore={() =>
                    dispatch({ type: 'RESTORE_ROW', localId: row.localId })
                  }
                  onRevert={() =>
                    dispatch({ type: 'REVERT_ROW', localId: row.localId })
                  }
                />
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={COLUMNS.length + 2}
                    className="px-3 py-12 text-center text-sm text-fg-muted"
                  >
                    이 폴더에는 명시된 권한이 없습니다. [+ 추가]를 눌러 첫 권한을 등록하세요.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Footer alert — shows whenever dirty > 0. aria-live so SR users hear
            the change as soon as the first edit lands. */}
        {dirtyCount > 0 ? (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-between gap-3 border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <span>
              ▴ 변경사항 <strong className="tabular-nums">{dirtyCount}</strong>건이 저장되지
              않았습니다.
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={handleRevertAll} disabled={saving}>
                되돌리기
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? '저장 중…' : '저장'}
              </Button>
            </div>
          </div>
        ) : null}

        {/* Revert-all confirm — full alert because it is destructive. */}
        {revertConfirm ? (
          <div
            role="alertdialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setRevertConfirm(false)}
          >
            <div
              className="w-full max-w-sm rounded-lg border border-border bg-bg p-5 elevation-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-semibold text-fg">변경사항을 모두 되돌리시겠습니까?</h3>
              <p className="mt-1 text-sm text-fg-muted">
                저장하지 않은 변경 {dirtyCount}건이 사라집니다. 추가했던 신규 행도 제거됩니다.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setRevertConfirm(false)}>
                  취소
                </Button>
                <Button variant="destructive" onClick={confirmRevertAll}>
                  모두 되돌리기
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <PrincipalPicker
          open={pickerOpen}
          excludeKeys={excludeKeys}
          onAdd={handleAddPrincipal}
          onClose={() => setPickerOpen(false)}
        />
      </div>
    </TooltipProvider>
  );
}

// ── Row subcomponent ─────────────────────────────────────────────────────
interface MatrixRowViewProps {
  row: MatrixRow;
  readOnly?: boolean;
  onToggleBit: (bit: PermissionBitKey) => void;
  onRemove: () => void;
  onRestore: () => void;
  onRevert: () => void;
}

function MatrixRowView({
  row,
  readOnly,
  onToggleBit,
  onRemove,
  onRestore,
  onRevert,
}: MatrixRowViewProps): JSX.Element {
  const Icon = TYPE_ICON[row.principalType];
  const isRemoved = row.state === 'removed';
  const isDirtyOrNew = row.state === 'dirty' || row.state === 'new';
  const isDeletedPrincipal = row.principalLabel === '(삭제됨)';
  const cellsDisabled = isRemoved || readOnly;

  return (
    <tr
      data-state={row.state}
      className={cn(
        'group relative border-b border-border transition-colors',
        // amber strip for dirty/new
        isDirtyOrNew &&
          'bg-amber-50/60 shadow-[inset_2px_0_0] shadow-amber-400 dark:bg-amber-950/30 dark:shadow-amber-500/60',
        // rose strip for removed
        isRemoved &&
          'bg-rose-50/40 shadow-[inset_2px_0_0] shadow-rose-400 dark:bg-rose-950/20 dark:shadow-rose-500/60',
        !isDirtyOrNew && !isRemoved && 'hover:bg-bg-subtle',
      )}
    >
      <td
        className={cn(
          'sticky left-0 z-[5] min-w-[240px] border-r border-border bg-inherit px-3 py-2',
          isDeletedPrincipal && 'text-fg-subtle',
        )}
      >
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              'h-4 w-4 shrink-0',
              isDeletedPrincipal ? 'text-fg-subtle' : 'text-fg-muted',
            )}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'truncate text-sm font-medium',
                  isRemoved && 'line-through text-fg-subtle',
                )}
              >
                {row.principalLabel}
              </span>
              <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
                {row.principalType}
              </Badge>
              {row.state === 'new' ? (
                <span className="shrink-0 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  ▴ 신규
                </span>
              ) : row.state === 'dirty' ? (
                <span className="shrink-0 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  ▴ 수정됨
                </span>
              ) : isRemoved ? (
                <span className="shrink-0 text-[11px] font-medium text-rose-700 dark:text-rose-400">
                  ─ 삭제됨
                </span>
              ) : null}
            </div>
            {row.principalSublabel ? (
              <div
                className={cn(
                  'mt-0.5 truncate text-xs',
                  isRemoved ? 'text-fg-subtle line-through' : 'text-fg-muted',
                )}
              >
                {row.principalSublabel}
              </div>
            ) : null}
          </div>
        </div>
      </td>
      {COLUMNS.map((col) => (
        <td key={col.key} className="px-1 py-2 text-center align-middle">
          <Checkbox
            checked={row.bits[col.key]}
            disabled={cellsDisabled}
            onCheckedChange={() => onToggleBit(col.key)}
            aria-label={`${row.principalLabel}의 ${col.full}`}
          />
        </td>
      ))}
      <td className="px-1 py-2 text-center align-middle">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={`${row.principalLabel} 행 동작`}
              disabled={readOnly}
            >
              <span aria-hidden="true">⋮</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isRemoved ? (
              <DropdownMenuItem onSelect={onRestore}>
                <Undo2 className="h-4 w-4" /> 정리 (복원)
              </DropdownMenuItem>
            ) : (
              <>
                {row.state === 'dirty' && row.origin ? (
                  <DropdownMenuItem onSelect={onRevert}>
                    <Undo2 className="h-4 w-4" /> 행 되돌리기
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={onRemove} destructive>
                  <Trash2 className="h-4 w-4" /> 삭제
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
