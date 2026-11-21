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
import { LibraryDialog } from './library-dialog';
import { StudioHeader } from './studio-header';
import { Steps } from './steps';
import { isProjectFile, StudioProvider, useStudio } from './use-studio';
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
  const [calOpen, setCalOpen] = useState(false), [helpOpen, setHelpOpen] = useState(false), [libOpen, setLibOpen] = useState(false);
  useDropToOpen(calOpen);
  useShortcuts();
  return (
    <div className="studio grid h-screen grid-cols-[360px_1fr] grid-rows-[48px_1fr] bg-background text-sm text-foreground">
      <StudioHeader onCalibrate={() => setCalOpen(true)} onHelp={() => setHelpOpen(true)} onLibrary={() => setLibOpen(true)} />
      <aside className="overflow-y-auto border-r bg-card" aria-label="Steps">
        <Steps />
      </aside>
      <Workspace />
      <CalibrationDialog open={calOpen} onOpenChange={setCalOpen} />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <LibraryDialog open={libOpen} onOpenChange={setLibOpen} />
    </div>
  );
}

/**
 * ⌘S / Ctrl+S saves the negative to the library. ⌘Z / Ctrl+Z undoes, ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y
 * redoes, except while typing in a field (which has its own undo).
 */
function useShortcuts() {
  const { undo, redo, saveNegative, active } = useStudio();
  const latest = useRef({ undo, redo, saveNegative, active });
  useEffect(() => { latest.current = { undo, redo, saveNegative, active }; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      // Instead of the browser saving the page.
      if (e.key.toLowerCase() === 's' && !e.shiftKey) {
        e.preventDefault();
        if (latest.current.active && !document.querySelector('[role="dialog"], [role="alertdialog"]')) latest.current.saveNegative();
        return;
      }
      const t = e.target;
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]')) return;
      const key = e.key.toLowerCase();
      if (key === 'z') { e.preventDefault(); (e.shiftKey ? latest.current.redo : latest.current.undo)(); }
      else if (key === 'y' && e.ctrlKey) { e.preventDefault(); latest.current.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Photos (and negative project files) dropped anywhere on the window open in new tabs. */
function useDropToOpen(paused: boolean) {
  const { openFiles } = useStudio();
  const latest = useRef({ openFiles, paused });
  useEffect(() => { latest.current = { openFiles, paused }; });
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      // Not while calibrating or editing a profile, where a scan is expected.
      if (latest.current.paused || document.querySelector('[role="dialog"]')) return;
      latest.current.openFiles([...(e.dataTransfer?.files ?? [])].filter(f => f.type.startsWith('image/') || /\.(tiff?|heic)$/i.test(f.name) || isProjectFile(f)));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, []);
}
