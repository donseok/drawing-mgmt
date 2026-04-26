'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  sidebarOpen: boolean;
  sidebarWidth: number; // px, 240 default
  chatOpen: boolean;
  paletteOpen: boolean;
  shortcutsHelpOpen: boolean;
  detailPanelOpen: boolean;

  // R8 — global folder sidebar (left-of-page nav). Distinct from `sidebarOpen`,
  // which still controls the per-page SubSidebar. The folder sidebar is a
  // workspace-wide drill-in; per-page sidebars are page-local context.
  globalFolderSidebarOpen: boolean;
  globalFolderSidebarWidth: number;

  // R8 — folder tree expansion persisted across sessions. Stored as an array
  // because Zustand persist + JSON.stringify can't roundtrip a Set. Helpers
  // expose the Set view callers actually want.
  folderTreeExpanded: string[];

  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (px: number) => void;

  setChatOpen: (open: boolean) => void;
  toggleChat: () => void;

  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;

  setShortcutsHelpOpen: (open: boolean) => void;
  toggleShortcutsHelp: () => void;

  setDetailPanelOpen: (open: boolean) => void;
  toggleDetailPanel: () => void;

  // Global folder sidebar.
  setGlobalFolderSidebarOpen: (open: boolean) => void;
  toggleGlobalFolderSidebar: () => void;
  setGlobalFolderSidebarWidth: (px: number) => void;

  // Folder expansion. Setters keep the array sorted so the snapshot is
  // stable across renders (otherwise insert/remove would churn the persisted
  // value even when the visible state didn't change).
  setFolderExpanded: (id: string, expanded: boolean) => void;
  /** Replace the full set — used by "expand all" / "collapse all". */
  replaceFolderExpanded: (ids: string[]) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      sidebarWidth: 240,
      chatOpen: false,
      paletteOpen: false,
      shortcutsHelpOpen: false,
      detailPanelOpen: false,
      globalFolderSidebarOpen: false,
      globalFolderSidebarWidth: 248,
      folderTreeExpanded: [],

      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarWidth: (px) => set({ sidebarWidth: Math.min(Math.max(px, 200), 480) }),

      setChatOpen: (open) => set({ chatOpen: open }),
      toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),

      setPaletteOpen: (open) => set({ paletteOpen: open }),
      togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

      setShortcutsHelpOpen: (open) => set({ shortcutsHelpOpen: open }),
      toggleShortcutsHelp: () => set((s) => ({ shortcutsHelpOpen: !s.shortcutsHelpOpen })),

      setDetailPanelOpen: (open) => set({ detailPanelOpen: open }),
      toggleDetailPanel: () => set((s) => ({ detailPanelOpen: !s.detailPanelOpen })),

      setGlobalFolderSidebarOpen: (open) => set({ globalFolderSidebarOpen: open }),
      toggleGlobalFolderSidebar: () =>
        set((s) => ({ globalFolderSidebarOpen: !s.globalFolderSidebarOpen })),
      setGlobalFolderSidebarWidth: (px) =>
        set({ globalFolderSidebarWidth: Math.min(Math.max(px, 180), 480) }),

      setFolderExpanded: (id, expanded) =>
        set((s) => {
          const has = s.folderTreeExpanded.includes(id);
          if (expanded && !has) {
            return { folderTreeExpanded: [...s.folderTreeExpanded, id].sort() };
          }
          if (!expanded && has) {
            return {
              folderTreeExpanded: s.folderTreeExpanded.filter((x) => x !== id),
            };
          }
          return s;
        }),
      replaceFolderExpanded: (ids) =>
        set({ folderTreeExpanded: [...new Set(ids)].sort() }),
    }),
    {
      name: 'dgcm-ui',
      partialize: (s) => ({
        sidebarOpen: s.sidebarOpen,
        sidebarWidth: s.sidebarWidth,
        detailPanelOpen: s.detailPanelOpen,
        globalFolderSidebarOpen: s.globalFolderSidebarOpen,
        globalFolderSidebarWidth: s.globalFolderSidebarWidth,
        folderTreeExpanded: s.folderTreeExpanded,
      }),
    },
  ),
);
