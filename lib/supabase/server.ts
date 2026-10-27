import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type { Database } from './database.types';
import { supabaseEnv } from './env';

// One client per request: it reads and refreshes the session from the request cookies.
export async function createClient() {
  // Supabase checks token expiry with Date.now(), which Cache Components won't allow while
  // prerendering (e.g. a partial prefetch). Wait for the real request first.
  await connection();
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes them instead.
        }
      },
    },
  });
}
