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
    }),
    {
      name: 'dgcm-ui',
      partialize: (s) => ({
        sidebarOpen: s.sidebarOpen,
        sidebarWidth: s.sidebarWidth,
        detailPanelOpen: s.detailPanelOpen,
      }),
    },
  ),
);
