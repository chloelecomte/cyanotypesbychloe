import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/safe-next';
import { GitHubSignInButton } from './github-sign-in-button';

export const metadata: Metadata = { title: 'Sign in · Cyanotypes by Chloé' };

export default function LoginPage({ searchParams }: PageProps<'/login'>) {
  return (
    <section className="cover">
      <h2>Sign in</h2>
      <p>The tools save your process profiles, curves and settings to your account,<br />so they follow you to any computer.</p>
      <Suspense fallback={<p>Loading…</p>}>
        <LoginForm searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function LoginForm({ searchParams }: Pick<PageProps<'/login'>, 'searchParams'>) {
  const params = await searchParams;
  const next = safeNext(params.next);

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect(next);

  return (
    <>
      {params.error && <p className="error">Sign-in didn&apos;t work. Please try again.</p>}
      <p><GitHubSignInButton next={next} /></p>
    </>
  );
}
