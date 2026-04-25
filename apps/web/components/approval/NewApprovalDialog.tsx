'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, Plus, Search, X } from 'lucide-react';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';

/**
 * NewApprovalDialog — "결재 상신" form, wraps `<Modal>`.
 *
 * Submitted payload mirrors the BE contract for
 * `POST /api/v1/objects/:id/release`:
 *
 *   { title: string, approvers: Array<{ userId: string; order: number }> }
 *
 * Approver picker uses an in-memory candidate list (mocked) until BE-2's
 * generic user-search endpoint lands. The picker supports:
 *   - typeahead filter on name / username
 *   - add to the bottom of the line
 *   - remove
 *   - reorder (move up / move down)
 *
 * Title is pre-populated with `[number] name — 결재 상신` when the consumer
 * passes objectNumber / objectName.
 *
 * @example
 *   <NewApprovalDialog
 *     open={!!releaseTarget}
 *     onOpenChange={(o) => { if (!o) setReleaseTarget(null); }}
 *     objectId={releaseTarget?.id}
 *     objectNumber={releaseTarget?.number}
 *     objectName={releaseTarget?.name}
 *     onSubmit={async ({ title, approvers }) => {
 *       await api.post(`/api/v1/objects/${releaseTarget!.id}/release`, {
 *         title, approvers,
 *       });
 *     }}
 *   />
 */

export interface ApproverInput {
  userId: string;
  order: number;
}

export interface NewApprovalSubmitPayload {
  title: string;
  approvers: ApproverInput[];
}

export interface NewApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Object whose new revision is being submitted. */
  objectId?: string;
  /** Optional pre-fill cues for the title field. */
  objectNumber?: string;
  objectName?: string;
  /**
   * Called with the validated payload. The dialog awaits the promise and
   * closes itself only on resolve. On reject it leaves the dialog open so
   * the caller can surface a toast and let the user retry.
   */
  onSubmit?: (payload: NewApprovalSubmitPayload) => Promise<void> | void;
}

// ── Mock approver candidate list ─────────────────────────────────────────
// Until BE-2 ships a generic user-search endpoint we ship a small in-memory
// candidate roster. The signed-in admin can already search via
// `/api/v1/admin/users` but that endpoint is admin-only — using it here
// would 403 for regular users. R3c will wire a real picker.
interface ApproverCandidate {
  id: string;
  username: string;
  fullName: string;
  role: string; // freeform display label
}
const MOCK_APPROVERS: ApproverCandidate[] = [
  { id: 'usr_kim_jw',  username: 'kim.jw',  fullName: '김지원', role: '품질 / 그룹장' },
  { id: 'usr_park_sm', username: 'park.sm', fullName: '박상민', role: '설계 / 책임' },
  { id: 'usr_choi_ja', username: 'choi.ja', fullName: '최정아', role: '공정 / 팀장' },
  { id: 'usr_lee_dh',  username: 'lee.dh',  fullName: '이도현', role: '기계 / 매니저' },
  { id: 'usr_jung_yj', username: 'jung.yj', fullName: '정유진', role: '전기 / 매니저' },
  { id: 'usr_son_hj',  username: 'son.hj',  fullName: '손현주', role: '계장 / 책임' },
  { id: 'usr_oh_jh',   username: 'oh.jh',   fullName: '오재현', role: '안전 / 매니저' },
  { id: 'usr_ryu_th',  username: 'ryu.th',  fullName: '류태형', role: '생산기술 / 책임' },
];

function defaultTitle(objectNumber?: string, objectName?: string): string {
  if (objectNumber && objectName) return `${objectNumber} ${objectName} — 결재 상신`;
  if (objectName) return `${objectName} — 결재 상신`;
  if (objectNumber) return `${objectNumber} — 결재 상신`;
  return '';
}

export function NewApprovalDialog({
  open,
  onOpenChange,
  objectId,
  objectNumber,
  objectName,
  onSubmit,
}: NewApprovalDialogProps): JSX.Element {
  const [title, setTitle] = React.useState('');
  const [picker, setPicker] = React.useState('');
  const [approvers, setApprovers] = React.useState<ApproverCandidate[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset state on each open.
  React.useEffect(() => {
    if (open) {
      setTitle(defaultTitle(objectNumber, objectName));
      setPicker('');
      setApprovers([]);
      setSubmitting(false);
      setError(null);
    }
  }, [open, objectNumber, objectName]);

  const filteredCandidates = React.useMemo(() => {
    const q = picker.trim().toLowerCase();
    const chosen = new Set(approvers.map((a) => a.id));
    return MOCK_APPROVERS.filter(
      (c) =>
        !chosen.has(c.id) &&
        (q === '' ||
          c.username.toLowerCase().includes(q) ||
          c.fullName.toLowerCase().includes(q) ||
          c.role.toLowerCase().includes(q)),
    ).slice(0, 6);
  }, [picker, approvers]);

  const addApprover = (cand: ApproverCandidate) => {
    setApprovers((prev) =>
      prev.some((a) => a.id === cand.id) ? prev : [...prev, cand],
    );
    setPicker('');
  };
  const removeApprover = (id: string) => {
    setApprovers((prev) => prev.filter((a) => a.id !== id));
  };
  const moveApprover = (id: string, dir: -1 | 1) => {
    setApprovers((prev) => {
      const idx = prev.findIndex((a) => a.id === id);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(next, 0, item!);
      return copy;
    });
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError('결재 제목을 입력하세요.');
      return;
    }
    if (trimmed.length > 200) {
      setError('제목은 200자 이내로 입력하세요.');
      return;
    }
    if (approvers.length === 0) {
      setError('결재자 한 명 이상을 선택하세요.');
      return;
    }
    const payload: NewApprovalSubmitPayload = {
      title: trimmed,
      approvers: approvers.map((a, i) => ({ userId: a.id, order: i + 1 })),
    };
    try {
      setSubmitting(true);
      await onSubmit?.(payload);
      onOpenChange(false);
    } catch (err) {
      // Caller surfaces its own toast via the React Query mutation; keep
      // the dialog open so the user can adjust + retry.
      setError(err instanceof Error ? err.message : '상신에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
      }}
      title="결재 상신"
      size="lg"
      description={
        objectNumber
          ? `${objectNumber} 의 신규 리비전을 상신합니다.`
          : '결재선을 지정하고 신규 리비전을 상신합니다.'
      }
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            취소
          </Button>
          <Button type="submit" form="new-approval-form" disabled={submitting}>
            {submitting ? '상신 중…' : '상신'}
          </Button>
        </>
      }
    >
      <form id="new-approval-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {/* hidden — the BE never reads this from the body, but consumers may
            want to mirror it back for analytics or debugging. */}
        <input type="hidden" value={objectId ?? ''} readOnly />

        <Field label="결재 제목" required htmlFor="approval-title">
          <Input
            id="approval-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: CGL 1호기 라인 배치도 Rev.B 승인 요청"
            maxLength={200}
            autoFocus
          />
        </Field>

        <div className="flex flex-col gap-2">
          <Label required>결재선</Label>
          <p className="text-xs text-fg-subtle">
            위에서 아래 순서로 결재가 진행됩니다. 사용자명/이름/조직으로 검색할 수 있습니다.
          </p>

          {/* Selected approvers */}
          {approvers.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-bg-subtle px-3 py-4 text-center text-xs text-fg-muted">
              아직 선택된 결재자가 없습니다.
            </div>
          ) : (
            <ol className="flex flex-col gap-1">
              {approvers.map((a, i) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
                >
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-brand-foreground">
                    {i + 1}
                  </span>
                  <span className="font-medium text-fg">{a.fullName}</span>
                  <span className="text-xs text-fg-muted">@{a.username}</span>
                  <span className="ml-auto text-[11px] text-fg-subtle">{a.role}</span>
                  <button
                    type="button"
                    aria-label="위로"
                    disabled={i === 0}
                    onClick={() => moveApprover(a.id, -1)}
                    className="app-icon-button h-7 w-7 disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="아래로"
                    disabled={i === approvers.length - 1}
                    onClick={() => moveApprover(a.id, 1)}
                    className="app-icon-button h-7 w-7 disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="제거"
                    onClick={() => removeApprover(a.id)}
                    className="app-icon-button h-7 w-7"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ol>
          )}

          {/* Picker */}
          <div className="relative">
            <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1.5">
              <Search className="h-4 w-4 text-fg-muted" />
              <input
                type="text"
                value={picker}
                onChange={(e) => setPicker(e.target.value)}
                placeholder="결재자 추가… (이름/아이디/부서)"
                className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
                aria-label="결재자 검색"
              />
            </div>
            {picker.trim() && filteredCandidates.length > 0 ? (
              <ul className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-auto rounded-md border border-border bg-bg shadow-lg">
                {filteredCandidates.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => addApprover(c)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-bg-subtle"
                    >
                      <Plus className="h-3.5 w-3.5 text-fg-muted" />
                      <span className="font-medium text-fg">{c.fullName}</span>
                      <span className="text-xs text-fg-muted">@{c.username}</span>
                      <span className="ml-auto text-[11px] text-fg-subtle">{c.role}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {picker.trim() && filteredCandidates.length === 0 ? (
              <div className="mt-1 rounded-md border border-dashed border-border bg-bg-subtle px-3 py-2 text-center text-xs text-fg-muted">
                일치하는 사용자가 없습니다.
              </div>
            ) : null}
          </div>
          <p className="text-[11px] text-fg-subtle">
            * 사용자 정식 검색 API는 R3c에서 연결됩니다. 현재는 데모 후보 목록을 사용합니다.
          </p>
        </div>

        {error ? (
          <p role="alert" className={cn('text-xs text-danger')}>
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

// ── tiny field wrapper ───────────────────────────────────────────────────

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
    </div>
  );
}
