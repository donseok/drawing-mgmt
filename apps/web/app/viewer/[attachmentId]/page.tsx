/**
 * Fullscreen viewer page (`/viewer/[attachmentId]`).
 *
 * Server component: reads the route param + auth state, then hands off to
 * <ViewerShell /> (client) which orchestrates everything else. We deliberately
 * keep this thin — most of the work is browser-only (PDF.js + dxf-viewer).
 */

import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { auth } from '@/auth';
import { ViewerShell } from '@/components/viewer/ViewerShell';
import ViewerLoading from '@/app/viewer/loading';

interface Props {
  params: { attachmentId: string };
}

export const dynamic = 'force-dynamic';

export default async function ViewerPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) {
    // Preserve return path so the user is taken back to the viewer after login.
    const from = `/viewer/${encodeURIComponent(params.attachmentId)}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(from)}`);
  }
  return (
    <Suspense fallback={<ViewerLoading />}>
      <ViewerShell attachmentId={params.attachmentId} />
    </Suspense>
  );
}
