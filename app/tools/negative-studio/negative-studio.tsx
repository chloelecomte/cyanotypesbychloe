'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { mountStudio } from '@/lib/negative-studio/controller';
import { createRepo } from '@/lib/negative-studio/repo';
import type { StudioData, StudioUser } from '@/lib/negative-studio/types';

export function NegativeStudio({ user, data }: { user: StudioUser; data: StudioData }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The studio is a canvas-heavy imperative UI, so it manages its own DOM inside this element.
    return mountStudio(root.current!, { user, data, repo: createRepo(createClient(), user.id) });
  }, [user, data]);

  return <div className="ns" ref={root}><div className="loading">Loading Negative Studio…</div></div>;
}
