'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Maximize2,
  X,
  Image as ImageIcon,
  Download,
  GitCompare,
  Send,
  Lock,
  History,
  MessageSquare,
  MapPin,
  CheckCircle2,
} from 'lucide-react';
import type { ObjectRow } from './ObjectTable';
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/StatusBadge';

interface ObjectPreviewPanelProps {
  row: ObjectRow | null;
  onClose?: () => void;
}

export function ObjectPreviewPanel({ row, onClose }: ObjectPreviewPanelProps) {
  const [tab, setTab] = React.useState<'info' | 'history' | 'markup' | 'issue' | 'dist'>('info');
  const issueCount = row?.issueCount ?? (row ? row.revision % 3 : 0);
  const markupCount = row?.markupCount ?? (row ? row.revision + 2 : 0);

  return (
    <aside
      aria-label="자료 미리보기"
      className={cn(
        'flex h-full w-[420px] shrink-0 flex-col border-l border-border bg-bg',
      )}
    >
      <div className="app-panel-header min-h-11">
        <span className="app-kicker">도면 미리보기</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="app-icon-button h-7 w-7"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {!row ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-fg-muted">
          <ImageIcon className="h-8 w-8 text-fg-subtle" />
          <p>자료를 선택하면 미리보기가 표시됩니다.</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-auto">
          <div className="m-3 overflow-hidden rounded-lg border border-border bg-bg">
            <div className="flex h-9 items-center justify-between gap-2 border-b border-border px-3">
              <span className="truncate font-mono text-[12px] font-medium text-fg">{row.number}</span>
              <StatusBadge status={row.state} size="sm" />
            </div>
            <div className="aspect-[4/3] bg-[hsl(var(--viewer-canvas))]">
              {row.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.thumbnailUrl} alt="" className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(90deg,hsl(var(--viewer-grid))_1px,transparent_1px),linear-gradient(0deg,hsl(var(--viewer-grid))_1px,transparent_1px)] bg-[size:24px_24px] text-fg-subtle">
                  <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-bg/90 shadow-sm">
                    <ImageIcon className="h-8 w-8" />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="px-4 pb-3">
            <div className="mb-3 flex items-center gap-1.5">
              {Array.from({ length: Math.max(row.revision + 1, 3) }).map((_, index) => {
                const current = index === row.revision;
                return (
                  <span key={index} className="flex items-center gap-1">
                    <span
                      className={cn(
                        'inline-flex h-6 min-w-9 items-center justify-center rounded-md border px-2 font-mono text-[11px] font-semibold',
                        current
                          ? 'border-brand/25 bg-brand/10 text-brand'
                          : 'border-border bg-bg-subtle text-fg-muted',
                      )}
                    >
                      R{index}
                    </span>
                    {index < Math.max(row.revision, 2) && <span className="h-px w-3 bg-border" />}
                  </span>
                );
              })}
            </div>

            <div className="grid grid-cols-3 gap-2 text-[12px]">
              <Signal icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="통제 상태" value={row.controlState ?? '작업중'} />
              <Signal icon={<MapPin className="h-3.5 w-3.5" />} label="이슈" value={`${issueCount}건`} />
              <Signal icon={<MessageSquare className="h-3.5 w-3.5" />} label="마크업" value={`${markupCount}건`} />
            </div>
          </div>

          <div className="border-y border-border px-3 py-2">
            <div className="grid grid-cols-4 gap-2">
              {row.masterAttachmentId && (
                <Link href={`/viewer/${row.masterAttachmentId}`} className="app-action-button-primary h-8">
                  <Maximize2 className="h-3.5 w-3.5" /> 열기
                </Link>
              )}
              <button type="button" className="app-action-button h-8 px-2">
                <GitCompare className="h-3.5 w-3.5" /> 비교
              </button>
              <button type="button" className="app-action-button h-8 px-2">
                <Lock className="h-3.5 w-3.5" /> 체크아웃
              </button>
              <button type="button" className="app-action-button h-8 px-2">
                <Send className="h-3.5 w-3.5" /> 배포
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1 border-b border-border px-3 py-2">
            {[
              ['info', '정보'],
              ['history', '이력'],
              ['markup', '마크업'],
              ['issue', '이슈'],
              ['dist', '배포'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key as typeof tab)}
                className={cn(
                  'h-7 rounded-md px-2 text-[12px] font-medium transition-colors',
                  tab === key ? 'bg-brand/10 text-brand' : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="px-4 py-3">
            {tab === 'info' && (
              <dl className="grid grid-cols-[88px_1fr] gap-y-2 text-[12px]">
                <dt className="text-fg-muted">도면번호</dt>
                <dd className="font-mono text-fg">{row.number}</dd>
                <dt className="text-fg-muted">자료명</dt>
                <dd className="font-medium text-fg">{row.name}</dd>
                <dt className="text-fg-muted">자료유형</dt>
                <dd className="text-fg">{row.classLabel}</dd>
                <dt className="text-fg-muted">상태</dt>
                <dd><StatusBadge status={row.state} size="sm" /></dd>
                <dt className="text-fg-muted">Rev / Ver</dt>
                <dd className="font-mono text-fg">R{row.revision} v{row.version}</dd>
                <dt className="text-fg-muted">등록자</dt>
                <dd className="text-fg">{row.registrant}</dd>
                <dt className="text-fg-muted">등록일</dt>
                <dd className="font-mono text-fg">{row.registeredAt}</dd>
              </dl>
            )}
            {tab === 'history' && (
              <PanelList
                icon={<History className="h-3.5 w-3.5" />}
                rows={[
                  ['현재 리비전', `R${row.revision} 승인 검토 중`],
                  ['이전 리비전', row.revision > 0 ? `R${row.revision - 1} 기준 비교 가능` : '이전 리비전 없음'],
                  ['마지막 변경', row.transmittedAt ?? row.registeredAt],
                ]}
              />
            )}
            {tab === 'markup' && (
              <PanelList
                icon={<MessageSquare className="h-3.5 w-3.5" />}
                rows={[
                  ['미검토 마크업', `${markupCount}건`],
                  ['최근 작성자', row.registrant],
                  ['상태', markupCount > 0 ? '검토 필요' : '정리됨'],
                ]}
              />
            )}
            {tab === 'issue' && (
              <PanelList
                icon={<MapPin className="h-3.5 w-3.5" />}
                rows={[
                  ['미해결 이슈', `${issueCount}건`],
                  ['담당', issueCount > 0 ? row.registrant : '없음'],
                  ['기한', issueCount > 0 ? 'D-3' : '-'],
                ]}
              />
            )}
            {tab === 'dist' && (
              <PanelList
                icon={<Send className="h-3.5 w-3.5" />}
                rows={[
                  ['배포 상태', row.controlState === '현장배포본' ? 'For Field' : '내부 검토'],
                  ['최근 배포', row.transmittedAt ?? '-'],
                  ['패키지', row.masterAttachmentId ? 'PDF 포함' : '마스터 첨부 없음'],
                ]}
              />
            )}
          </div>

          <div className="mt-auto flex gap-2 border-t border-border bg-bg p-3">
            <Link
              href={`/objects/${row.id}`}
              className="app-action-button h-9 flex-1"
            >
              상세
            </Link>
            <button
              type="button"
              aria-label="다운로드"
              className="app-icon-button h-9 w-9 border border-border bg-bg"
            >
              <Download className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function Signal({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border bg-bg-subtle p-2">
      <div className="flex items-center gap-1 text-fg-subtle">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 truncate font-semibold text-fg">{value}</div>
    </div>
  );
}

function PanelList({
  icon,
  rows,
}: {
  icon: React.ReactNode;
  rows: [string, string][];
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      {rows.map(([label, value], index) => (
        <div
          key={label}
          className={cn('flex items-center gap-3 px-3 py-2 text-[12px]', index > 0 && 'border-t border-border')}
        >
          <span className="text-fg-subtle">{index === 0 ? icon : null}</span>
          <span className="w-24 shrink-0 text-fg-muted">{label}</span>
          <span className="min-w-0 truncate font-medium text-fg">{value}</span>
        </div>
      ))}
    </div>
  );
}
