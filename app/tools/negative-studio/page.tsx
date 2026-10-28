import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loadStudioData } from '@/lib/negative-studio/repo';
import { NegativeStudio } from './negative-studio';
import './studio.css';

export const metadata: Metadata = { title: 'Cyanotype Negative Studio' };
// Edge to edge on notched phones (the layout pads itself), and the on-screen keyboard shrinks the layout rather than covering it.
export const viewport: Viewport = { viewportFit: 'cover', interactiveWidget: 'resizes-content' };

export default function NegativeStudioPage() {
  return (
    <Suspense fallback={<div className="studio grid h-dvh place-items-center text-sm text-muted-foreground">Loading Negative Studio…</div>}>
      <Studio />
    </Suspense>
  );
}

// Reads the session, so it renders per request behind the Suspense boundary.
async function Studio() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // The proxy already redirects signed-out visitors; this is the authoritative check.
  if (!user) redirect('/login?next=/tools/negative-studio');

  const data = await loadStudioData(supabase);
  const meta = user.user_metadata ?? {};
  const name = meta.user_name || meta.preferred_username || meta.full_name || meta.name || user.email || 'Signed in';
  return <NegativeStudio user={{ id: user.id, name, avatarUrl: meta.avatar_url ?? null }} data={data} />;
}
