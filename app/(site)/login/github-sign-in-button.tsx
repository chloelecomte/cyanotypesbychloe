'use client';

import { useState } from 'react';
import { GitHubIcon } from '@/components/icons';
import { createClient } from '@/lib/supabase/client';

export function GitHubSignInButton({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    // The callback runs on whatever host served this page (localhost, a preview URL or production),
    // so each deploy ring signs in against its own Supabase project.
    const redirectTo = new URL('/auth/callback', window.location.origin);
    redirectTo.searchParams.set('next', next);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: redirectTo.toString() },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="button-link" onClick={signIn} disabled={busy}>
        <GitHubIcon title="GitHub logo" />
        <span>{busy ? 'Redirecting to GitHub…' : 'Sign in with GitHub'}</span>
      </button>
      {error && <span className="error"><br />{error}</span>}
    </>
  );
}
