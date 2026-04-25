'use client';

import { CommandPalette } from './CommandPalette';
import { ChatToggle } from './ChatToggle';
import { ShortcutsDialog } from '@/components/ShortcutsDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

/**
 * Mounts global keyboard shortcuts + the floating widgets that must live
 * at the top of the (main) tree. Used by the (main) server layout so we
 * keep auth gating + RSC behavior while still enabling client-only globals.
 */
export function AppShellClient() {
  useKeyboardShortcuts();
  return (
    <>
      <CommandPalette />
      <ShortcutsDialog />
      <ChatToggle variant="fab" />
    </>
  );
}
