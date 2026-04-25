'use client';

import * as React from 'react';
import { Plus, Search, Settings2 } from 'lucide-react';

/**
 * Interactive bits for /admin/[section] split out of the server component
 * so handlers actually fire on hydration. Real wiring (create dialog, view
 * settings popover) belongs to a later round.
 */

export function SectionAddButton() {
  return (
    <button
      type="button"
      onClick={() => {
        // TODO: open create dialog
      }}
      className="app-action-button-primary h-9"
    >
      <Plus className="h-4 w-4" />
      추가
    </button>
  );
}

export function SectionPanelHeader({ title }: { title: string }) {
  const [search, setSearch] = React.useState('');
  return (
    <div className="app-panel-header">
      <div className="relative w-80">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`${title} 검색...`}
          className="h-8 w-full rounded-md border border-border bg-bg px-8 text-sm placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <button
        type="button"
        onClick={() => {
          // TODO: view settings popover
        }}
        className="app-action-button h-8"
      >
        <Settings2 className="h-4 w-4" />
        보기 설정
      </button>
    </div>
  );
}
