'use client';

import * as React from 'react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  FileText,
  Folder,
  Home,
  Inbox,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Moon,
  Plus,
  HelpCircle,
} from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/cn';

// MOCK datasets — TODO: replace with real API calls.
// drawings via /api/v1/objects?q=...
// folders  via /api/v1/folders?q=...
// users    via /api/v1/admin/users?q=... (Phase 2)
const MOCK_DRAWINGS = [
  { id: 'obj-1', number: 'CGL-MEC-2026-00012', name: '메인롤러 어셈블리', state: 'APPROVED' },
  { id: 'obj-2', number: 'CGL-MEC-2026-00013', name: '가이드롤러 베이스', state: 'CHECKED_OUT' },
  { id: 'obj-3', number: 'CGL-ELE-2026-00031', name: '메인 컨트롤 패널', state: 'IN_APPROVAL' },
  { id: 'obj-4', number: 'BFM-PRC-2026-00008', name: '소둔로 공정 P&ID', state: 'NEW' },
];

const MOCK_FOLDERS = [
  { id: 'f-cgl', code: 'CGL', name: '본사 / 기계 / CGL-2 / 메인라인' },
  { id: 'f-bfm', code: 'BFM', name: '본사 / 공정 / BFM-1' },
  { id: 'f-ele', code: 'ELE', name: '본사 / 전기' },
];

export function CommandPalette() {
  const router = useRouter();
  const { setTheme, theme } = useTheme();
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleChat = useUiStore((s) => s.toggleChat);

  const [query, setQuery] = React.useState('');

  // R55 [QA-P2-6] — ⌘K / Ctrl+K is owned by `useKeyboardShortcuts` (mounted
  // once in <AppShellClient>). Previously we registered a *second* keydown
  // listener here which raced the first: both called `setPaletteOpen`/`!open`
  // back-to-back, net-zero, so the palette never appeared on Mac (and
  // double-toggled on Windows/Linux when the listeners disagreed about the
  // current state). Now this component only watches ESC for the modal close.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const mode: 'drawings' | 'folders' | 'commands' | 'users' =
    query.startsWith('>') ? 'commands' :
    query.startsWith('#') ? 'folders' :
    query.startsWith('@') ? 'users' :
    'drawings';

  const trimmed = query.replace(/^[>#@]\s*/, '').toLowerCase();

  const drawingMatches = MOCK_DRAWINGS.filter(
    (d) => !trimmed || d.number.toLowerCase().includes(trimmed) || d.name.toLowerCase().includes(trimmed),
  );
  const folderMatches = MOCK_FOLDERS.filter(
    (f) => !trimmed || f.code.toLowerCase().includes(trimmed) || f.name.toLowerCase().includes(trimmed),
  );

  const commandFilter = (label: string) =>
    !trimmed || label.toLowerCase().includes(trimmed);

  const go = React.useCallback(
    (path: string) => {
      setOpen(false);
      router.push(path);
    },
    [router, setOpen],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="명령 팔레트"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <Command
        loop
        // We do our own filtering (mode-aware on >, #, @ prefixes) — disable
        // cmdk's default scorer so the input value drives the displayed list
        // exactly. Fixes BUG-005 (typing wasn't reflected in results).
        shouldFilter={false}
        className={cn(
          'w-full max-w-xl overflow-hidden rounded-lg border border-border bg-bg shadow-2xl',
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 text-fg-muted" aria-hidden />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="도면번호·키워드…  (>명령  #폴더  @사용자)"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
          />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-fg-muted sm:inline-block">
            ESC
          </kbd>
        </div>

        <Command.List className="max-h-[60vh] overflow-y-auto p-2 text-sm">
          <Command.Empty className="px-3 py-8 text-center text-sm text-fg-muted">
            결과가 없습니다.
          </Command.Empty>

          {mode === 'drawings' && drawingMatches.length > 0 && (
            <Command.Group heading="도면" className="px-1 py-1 text-xs uppercase text-fg-subtle">
              {drawingMatches.map((d) => (
                <Command.Item
                  key={d.id}
                  value={`drawing:${d.number} ${d.name}`}
                  onSelect={() => go(`/objects/${d.id}`)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-bg-muted"
                >
                  <FileText className="h-4 w-4 text-fg-muted" />
                  <span className="font-mono text-fg">{d.number}</span>
                  <span className="truncate text-fg-muted">{d.name}</span>
                  <span className="ml-auto text-[11px] text-fg-subtle">{d.state}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {(mode === 'folders' || (mode === 'drawings' && folderMatches.length > 0)) && folderMatches.length > 0 && (
            <Command.Group heading="폴더" className="px-1 py-1 text-xs uppercase text-fg-subtle">
              {folderMatches.map((f) => (
                <Command.Item
                  key={f.id}
                  value={`folder:${f.code} ${f.name}`}
                  onSelect={() => go(`/search?folder=${f.id}`)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-bg-muted"
                >
                  <Folder className="h-4 w-4 text-fg-muted" />
                  <span className="font-mono text-fg">{f.code}</span>
                  <span className="truncate text-fg-muted">{f.name}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {mode === 'users' && (
            <div className="px-3 py-6 text-center text-xs text-fg-muted">
              사용자 검색은 Phase 2에서 제공됩니다.
            </div>
          )}

          {(() => {
            const allCommands: { label: string; icon: React.ReactNode; onSelect: () => void }[] = [
              { label: '홈으로', icon: <Home className="h-4 w-4" />, onSelect: () => go('/') },
              { label: '자료 검색', icon: <Search className="h-4 w-4" />, onSelect: () => go('/search') },
              { label: '내 결재함', icon: <Inbox className="h-4 w-4" />, onSelect: () => go('/approval') },
              { label: '로비함', icon: <Inbox className="h-4 w-4" />, onSelect: () => go('/lobby') },
              { label: '신규 자료 등록', icon: <Plus className="h-4 w-4" />, onSelect: () => go('/search?action=new') },
              { label: '관리자', icon: <ShieldCheck className="h-4 w-4" />, onSelect: () => go('/admin') },
              {
                label: theme === 'dark' ? '라이트 모드 전환' : '다크 모드 전환',
                icon: theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />,
                onSelect: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
              },
              { label: '사이드바 토글 (⌘B)', icon: <Settings className="h-4 w-4" />, onSelect: toggleSidebar },
              { label: '챗봇 토글 (⌘.)', icon: <HelpCircle className="h-4 w-4" />, onSelect: toggleChat },
            ];
            const visible = allCommands.filter((c) => commandFilter(c.label));
            // Hide command group entirely when user is in drawings/folders mode
            // and is actively typing (avoids the menu becoming a long static list).
            const showGroup =
              mode === 'commands' || !trimmed || visible.length > 0;
            if (!showGroup || visible.length === 0) return null;
            return (
              <Command.Group heading="명령" className="px-1 py-1 text-xs uppercase text-fg-subtle">
                {visible.map((c) => (
                  <PaletteCommand
                    key={c.label}
                    label={c.label}
                    icon={c.icon}
                    onSelect={c.onSelect}
                  />
                ))}
              </Command.Group>
            );
          })()}
        </Command.List>

        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-fg-subtle">
          <div className="flex items-center gap-3">
            <span><kbd className="rounded border border-border px-1">↑↓</kbd> 이동</span>
            <span><kbd className="rounded border border-border px-1">Enter</kbd> 실행</span>
            <span><kbd className="rounded border border-border px-1">⌘Enter</kbd> 새 탭</span>
          </div>
          <span>{mode === 'drawings' ? '도면 검색' : mode === 'folders' ? '폴더' : mode === 'commands' ? '명령' : '사용자'}</span>
        </div>
      </Command>
    </div>
  );
}

function PaletteCommand({
  label,
  icon,
  onSelect,
}: {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={`cmd:${label}`}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-bg-muted"
    >
      <span className="text-fg-muted">{icon}</span>
      <span className="text-fg">{label}</span>
    </Command.Item>
  );
}
