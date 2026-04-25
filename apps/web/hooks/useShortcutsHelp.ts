'use client';

import { useUiStore } from '@/stores/uiStore';

/**
 * Tiny convenience hook for opening the shortcuts cheatsheet.
 * Use it in places that need an explicit "단축키 보기" affordance.
 */
export function useShortcutsHelp() {
  const open = useUiStore((s) => s.shortcutsHelpOpen);
  const setOpen = useUiStore((s) => s.setShortcutsHelpOpen);
  const toggle = useUiStore((s) => s.toggleShortcutsHelp);

  return { open, setOpen, toggle };
}
