'use client';

// "My negatives": the photos saved to the account with their edits, to reopen, re-export or delete.
import { useEffect, useRef, useState } from 'react';
import { FileArchive, FolderOpen, ImageIcon, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PROJECT_SUFFIX } from '@/lib/negative-studio/negatives';
import type { SavedNegative } from '@/lib/negative-studio/types';
import { IconButton } from './controls';
import { useStudio } from './use-studio';

export function LibraryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { negatives, negativesError, loadNegatives, openFiles } = useStudio();
  const file = useRef<HTMLInputElement>(null);
  // Fresh every time it opens: another computer may have saved something since.
  useEffect(() => { if (open) loadNegatives(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b py-4 pr-12 pl-6">
          <DialogTitle>My negatives</DialogTitle>
          <DialogDescription>
            Each one keeps the original photo and all its edits, so you can change it or print it at another size.
            Save one with <b>Save negative</b> above the preview.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {negativesError ? (
            <p className="text-sm text-warning">Couldn&apos;t load your negatives: {negativesError} <Button variant="link" className="h-auto p-0" onClick={loadNegatives}>Try again</Button></p>
          ) : !negatives ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading…</p>
          ) : !negatives.length ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <ImageIcon className="mx-auto mb-3 size-10 opacity-40" />
              <p>No saved negatives yet.</p>
              <p className="mt-1">Open a photo, edit it, then click <b>Save negative</b> (or press ⌘S / Ctrl+S).</p>
            </div>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {negatives.map(n => <NegativeCard key={n.id} n={n} onOpened={() => onOpenChange(false)} />)}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-3 border-t px-6 py-3 text-xs text-muted-foreground">
          <span className="mr-auto">A project file ({PROJECT_SUFFIX}) is a copy you keep yourself: the photo and its edits in one file.</span>
          <Button variant="outline" size="sm" onClick={() => file.current?.click()}><FolderOpen />Open a project file…</Button>
          <input
            ref={file} type="file" accept=".zip,application/zip" multiple hidden
            onChange={e => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) { onOpenChange(false); openFiles(files); } }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NegativeCard({ n, onOpened }: { n: SavedNegative; onOpened: () => void }) {
  const { openNegative, deleteNegative, exportSavedNegative, profileName, tabs } = useStudio();
  const [busy, setBusy] = useState<'open' | 'export' | null>(null);
  const isOpen = tabs.some(t => t.saved?.id === n.id);
  const profile = profileName(n.recipe.profile) ?? (n.recipe.profile === 'model' ? 'Generic profile' : null);
  async function open() {
    setBusy('open');
    try { if (await openNegative(n)) onOpened(); } finally { setBusy(null); }
  }
  async function exportFile() {
    setBusy('export');
    try { await exportSavedNegative(n); } finally { setBusy(null); }
  }
  return (
    <li className="group overflow-hidden rounded-lg border bg-card">
      <button type="button" onClick={open} disabled={!!busy} className="relative block aspect-[4/3] w-full bg-muted" title={isOpen ? 'Already open: switch to it' : 'Open in a new tab'}>
        {/* A data URL thumbnail, so next/image has nothing to optimize. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {n.thumbnail ? <img src={n.thumbnail} alt="" className="size-full object-contain" /> : <ImageIcon className="m-auto size-8 opacity-30" />}
        {busy === 'open' && <span className="absolute inset-0 grid place-items-center bg-background/60"><Loader2 className="size-6 animate-spin" /></span>}
      </button>
      <div className="flex items-start gap-1 p-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={n.name}>{n.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {n.recipe.settings.print.width} in wide · {new Date(n.updatedAt).toLocaleDateString()}{isOpen && ' · open'}
          </p>
          {profile && <p className="truncate text-xs text-muted-foreground" title={profile}>{profile}</p>}
        </div>
        <IconButton label="Download a project file" size="icon-sm" disabled={!!busy} onClick={exportFile}>
          {busy === 'export' ? <Loader2 className="animate-spin" /> : <FileArchive />}
        </IconButton>
        <IconButton label={`Delete “${n.name}”`} size="icon-sm" disabled={!!busy} onClick={() => deleteNegative(n)}><Trash2 /></IconButton>
      </div>
    </li>
  );
}
