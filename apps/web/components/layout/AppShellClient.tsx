'use client';

import { CommandPalette } from './CommandPalette';
import { ChatFab } from '@/components/chat';
import { ShortcutsDialog } from '@/components/ShortcutsDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

/**
 * Mounts global keyboard shortcuts + the floating widgets that must live
 * at the top of the (main) tree. Used by the (main) server layout so we
 * keep auth gating + RSC behavior while still enabling client-only globals.
 *
 * R36 — replaced legacy ChatToggle with ChatFab + ChatPanel split.
 */
export function AppShellClient() {
  useKeyboardShortcuts();
  return (
    <>
      <CommandPalette />
      <ShortcutsDialog />
      <ChatFab />
    </>
  );
}
