'use client';

/**
 * NotificationPanelTrigger
 * ------------------------
 * Thin wrapper around the bell + popover pair so callers can opt into the
 * dedicated panel without knowing whether Designer-2's
 * `@/components/notifications/NotificationPanel` has landed yet.
 *
 * Today: re-exports `NotificationBell` (which renders an inline popover with
 * mock notifications, see `NotificationBell.tsx`).
 *
 * When Designer-2's panel lands, swap the popover body here for
 * `<NotificationPanel />` while keeping the bell trigger from
 * `NotificationBell.tsx`. Header.tsx imports `NotificationBell` directly, so
 * this trigger is the migration seam — Header is owned by another agent.
 */

export { NotificationBell as NotificationPanelTrigger } from './NotificationBell';
