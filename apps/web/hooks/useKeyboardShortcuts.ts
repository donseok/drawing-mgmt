'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useUiStore } from '@/stores/uiStore';

const G_NAV: Record<string, string> = {
  h: '/',
  s: '/search',
  a: '/approval',
  l: '/lobby',
  m: '/admin',
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  // cmdk Command.Input renders as input — covered above
  return false;
}

/**
 * Registers global keyboard shortcuts per DESIGN.md §9.1.
 * Mount once in the (main) layout.
 */
export function useKeyboardShortcuts() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const togglePalette = useUiStore((s) => s.togglePalette);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleChat = useUiStore((s) => s.toggleChat);
  const setShortcutsHelpOpen = useUiStore((s) => s.setShortcutsHelpOpen);

  const lastG = useRef<number>(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // ⌘K — palette
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePalette();
        return;
      }

      // ⌘B — sidebar
      if (meta && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // ⌘. — chat
      if (meta && e.key === '.') {
        e.preventDefault();
        toggleChat();
        return;
      }

      // ⌘\ — theme toggle
      if (meta && e.key === '\\') {
        e.preventDefault();
        setTheme(theme === 'dark' ? 'light' : 'dark');
        return;
      }

      // skip text-input contexts for the rest
      if (isEditableTarget(e.target)) return;

      // ESC — close palette/help
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        return;
      }

      // ? — shortcuts help (Shift+/)
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setShortcutsHelpOpen(true);
        return;
      }

      // g+x vim-style nav (1500ms window)
      if (e.key === 'g' && !meta && !e.altKey) {
        lastG.current = Date.now();
        return;
      }

      const now = Date.now();
      if (now - lastG.current < 1500 && !meta) {
        const target = G_NAV[e.key.toLowerCase()];
        if (target) {
          e.preventDefault();
          lastG.current = 0;
          router.push(target);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    router,
    theme,
    setTheme,
    togglePalette,
    setPaletteOpen,
    toggleSidebar,
    toggleChat,
    setShortcutsHelpOpen,
  ]);
}
