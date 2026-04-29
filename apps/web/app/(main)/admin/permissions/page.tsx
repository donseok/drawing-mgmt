import { redirect } from 'next/navigation';

// BUG-03 — older bookmarks / typed URLs land here. The canonical route is
// /admin/folder-permissions; redirect rather than 404 so the management
// console stays reachable from natural URL guesses.
export default function AdminPermissionsRedirect(): never {
  redirect('/admin/folder-permissions');
}
