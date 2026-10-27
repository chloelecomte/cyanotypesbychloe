import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';
import { supabaseEnv } from './env';

export type BrowserSupabase = ReturnType<typeof createClient>;

export function createClient() {
  const { url, key } = supabaseEnv();
  return createBrowserClient<Database>(url, key);
}
