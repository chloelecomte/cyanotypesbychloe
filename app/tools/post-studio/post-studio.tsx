'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { format, gridFor, NO_VIEW, type View } from '@/lib/post-studio/layout';
import { decodePhoto, type Cell, type Design, type ExportSettings, type Photo } from '@/lib/post-studio/render';
import { Panel } from './panel';
import { Stage } from './stage';

const DEFAULT_DESIGN: Design = {
  mode: 'border',
  format: 'portrait',
  background: '#ffffff',
  border: { margin: 0.08 },
  collage: { rows: 2, cols: 2, margin: 0.06, gap: 0.025, cellRatio: 'auto', fit: 'fill' },
};
const DEFAULT_EXPORT: ExportSettings = { scale: 3, type: 'jpeg' };
const EMPTY: Cell = { photoId: null, ...NO_VIEW };
const STORE = 'post-studio.settings';

// Everything here needs the browser (canvas, saved settings), so it renders only there.
const noSubscribe = () => () => {};
export function PostStudio() {
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!inBrowser) return <div className="studio grid h-dvh place-items-center bg-background text-sm text-muted-foreground">Loading Post Studio…</div>;
  return <Studio />;
}

function Studio() {
  const s = usePostState();
  return (
    <TooltipProvider delayDuration={300}>
      <div className="studio flex h-dvh flex-col bg-background text-sm text-foreground md:grid md:grid-cols-[340px_1fr] md:grid-rows-[48px_1fr]">
        <header className="flex h-12 shrink-0 items-center border-b bg-card px-4 md:col-span-2">
          {/* A full page load, so the studio's styles don't follow you to the public site. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="text-[15px] font-semibold tracking-tight">
            Cyanotype <span className="text-cyan-ink">Post</span> Studio
          </a>
          <span className="ml-auto hidden text-xs text-muted-foreground sm:block">Borders and collages for Instagram · photos stay on this device</span>
        </header>
        <aside className="order-3 min-h-0 flex-1 overflow-y-auto border-r bg-card md:order-none" aria-label="Settings">
          <Panel s={s} />
        </aside>
        <Stage s={s} />
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}

export type PostState = ReturnType<typeof usePostState>;

function usePostState() {
  const [design, setDesign] = useState(() => loadSettings().design);
  const [ex, setEx] = useState(() => loadSettings().ex);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [stored, setCells] = useState<Cell[]>([]);
  const [borderId, setBorderId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(0);
  const nextId = useRef(1);

  // Settings (not photos) are remembered in this browser.
  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ design, ex })); } catch { /* private mode */ }
  }, [design, ex]);

  const { rows, cols } = design.collage;
  const n = rows * cols;
  // Cells beyond the grid are kept, so making the grid smaller and back again loses nothing.
  const cells = useMemo(() => Array.from({ length: n }, (_, i) => stored[i] ?? EMPTY), [stored, n]);
  const photoMap = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos]);
  const borderPhoto = (borderId != null && photoMap.get(borderId)) || photos[0] || null;

  const update = (fn: (d: Design) => Design) => setDesign(fn);
  const setCollage = (patch: Partial<Design['collage']>) => update(d => ({ ...d, collage: { ...d.collage, ...patch } }));

  /** Opens the files; in a collage they go into empty cells, starting with cell `at` if given. */
  async function addFiles(files: File[], at?: number) {
    files = files.filter(f => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|tiff?)$/i.test(f.name));
    if (!files.length) return;
    setLoading(l => l + files.length);
    const added: Photo[] = [];
    for (const f of files) {
      try { added.push(await decodePhoto(f, nextId.current++)); }
      catch (e) { toast.error((e as Error).message || `Couldn't open ${f.name}`); }
      finally { setLoading(l => l - 1); }
    }
    if (!added.length) return;
    setPhotos(ps => [...ps, ...added]);
    setBorderId(added[0].id);
    if (design.mode !== 'collage') return;

    // An empty collage grows to hold everything dropped on it.
    let size = n;
    if (!cells.some(c => c.photoId != null) && added.length > n) {
      const f = format(design.format), g = gridFor(added.length, f.w, f.h);
      setCollage(g);
      size = g.rows * g.cols;
    }
    setCells(prev => {
      const next = Array.from({ length: Math.max(prev.length, size) }, (_, i) => prev[i] ?? EMPTY);
      const queue = [...added];
      if (at != null && at < size) next[at] = { ...EMPTY, photoId: queue.shift()!.id };
      for (let i = 0; i < size && queue.length; i++) if (next[i].photoId == null) next[i] = { ...EMPTY, photoId: queue.shift()!.id };
      return next;
    });
  }

  /** Puts a photo in a cell. If it was already in another cell, the two swap. */
  function assign(i: number, photoId: number) {
    setCells(prev => {
      const next = Array.from({ length: Math.max(prev.length, n) }, (_, k) => prev[k] ?? EMPTY);
      const from = next.findIndex((c, k) => k < n && c.photoId === photoId);
      if (from === i) return prev;
      if (from >= 0) [next[from], next[i]] = [next[i], next[from]];
      else next[i] = { ...EMPTY, photoId };
      return next;
    });
    setSelected(i);
  }

  const setCell = (i: number, fn: (c: Cell) => Cell) =>
    setCells(prev => Array.from({ length: Math.max(prev.length, n) }, (_, k) => (k === i ? fn(prev[k] ?? EMPTY) : prev[k] ?? EMPTY)));
  const setView = (i: number, v: Partial<View>) => setCell(i, c => ({ ...c, ...v }));
  const zoomCell = (i: number, by: number) => setCell(i, c => ({ ...c, zoom: Math.min(5, Math.max(1, c.zoom * by)) }));
  const clearCell = (i: number) => setCell(i, () => EMPTY);

  function removePhoto(id: number) {
    const p = photoMap.get(id);
    if (p) { URL.revokeObjectURL(p.thumb); if ('close' in p.src) (p.src as ImageBitmap).close(); }
    setPhotos(ps => ps.filter(q => q.id !== id));
    setCells(prev => prev.map(c => (c.photoId === id ? EMPTY : c)));
  }

  /** Sizes the grid for every open photo and puts the ones not yet placed into the empty cells. */
  function fitGrid() {
    const f = format(design.format), g = gridFor(photos.length, f.w, f.h), size = g.rows * g.cols;
    setCollage(g);
    setCells(prev => {
      const next = Array.from({ length: size }, (_, i) => prev[i] ?? EMPTY);
      const placed = new Set(next.map(c => c.photoId));
      const queue = photos.filter(p => !placed.has(p.id));
      for (let i = 0; i < size && queue.length; i++) if (next[i].photoId == null) next[i] = { ...EMPTY, photoId: queue.shift()!.id };
      return next;
    });
  }

  /** Puts a photo from the tray into the selected cell, or the first empty one. */
  function placeFromTray(id: number) {
    if (design.mode === 'border') return setBorderId(id);
    const target = selected ?? cells.findIndex(c => c.photoId == null);
    if (target >= 0 && target < n) assign(target, id);
  }

  return {
    design, update, setCollage, ex, setEx, photos, photoMap, cells, borderPhoto, selected, setSelected, loading,
    addFiles, assign, fitGrid, setView, zoomCell, clearCell, removePhoto, placeFromTray, clearCells: () => setCells([]),
  };
}

function loadSettings(): { design: Design; ex: ExportSettings } {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (v?.design) return {
      design: { ...DEFAULT_DESIGN, ...v.design, border: { ...DEFAULT_DESIGN.border, ...v.design.border }, collage: { ...DEFAULT_DESIGN.collage, ...v.design.collage } },
      ex: { ...DEFAULT_EXPORT, ...v.ex },
    };
  } catch { /* private mode or bad JSON: keep the defaults */ }
  return { design: DEFAULT_DESIGN, ex: DEFAULT_EXPORT };
}
