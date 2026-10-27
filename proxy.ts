import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export function proxy(request: NextRequest) {
  return updateSession(request);
}

// Only pages that read the session. Public pages stay fully static and never touch Supabase.
export const config = {
  matcher: ['/tools', '/tools/:path*', '/login'],
};
