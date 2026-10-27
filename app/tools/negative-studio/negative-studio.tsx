'use client';

import { useEffect, useRef, useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createClient } from '@/lib/supabase/client';
import { createRepo } from '@/lib/negative-studio/repo';
import type { StudioData, StudioUser } from '@/lib/negative-studio/types';
import { CalibrationDialog } from './calibration-dialog';
import { ConfirmProvider } from './confirm';
import { HelpDialog } from './help-dialog';
import { StudioHeader } from './studio-header';
import { Steps } from './steps';
import { StudioProvider, useStudio } from './use-studio';
import { Workspace } from './workspace';

/** Makes the value on first use, so nothing browser-only runs while the page renders on the server. */
function lazy<T extends object>(make: () => T): T {
  let value: T | undefined;
  return new Proxy({} as T, { get: (_, key) => Reflect.get(value ??= make(), key) });
}

export function NegativeStudio({ user, data }: { user: StudioUser; data: StudioData }) {
  const [repo] = useState(() => lazy(() => createRepo(createClient(), user.id)));
  return (
    <TooltipProvider delayDuration={300}>
      <ConfirmProvider>
        <StudioProvider user={user} data={data} repo={repo}>
          <Studio />
        </StudioProvider>
      </ConfirmProvider>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}

function Studio() {
  const [calOpen, setCalOpen] = useState(false), [helpOpen, setHelpOpen] = useState(false);
  useDropToOpen(calOpen);
  return (
    <div className="studio grid h-screen grid-cols-[360px_1fr] grid-rows-[48px_1fr] bg-background text-sm text-foreground">
      <StudioHeader onCalibrate={() => setCalOpen(true)} onHelp={() => setHelpOpen(true)} />
      <aside className="overflow-y-auto border-r bg-card" aria-label="Steps">
        <Steps />
      </aside>
      <Workspace />
      <CalibrationDialog open={calOpen} onOpenChange={setCalOpen} />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

/** Photos dropped anywhere on the window open in new tabs (but not while calibrating, where a scan is expected). */
function useDropToOpen(paused: boolean) {
  const { openFiles } = useStudio();
  const latest = useRef({ openFiles, paused });
  useEffect(() => { latest.current = { openFiles, paused }; });
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      if (latest.current.paused) return;
      latest.current.openFiles([...(e.dataTransfer?.files ?? [])].filter(f => f.type.startsWith('image/') || /\.(tiff?|heic)$/i.test(f.name)));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, []);
}
