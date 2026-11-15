'use client';

// Print Studio: split one photo across prints that hang together, and save a full-resolution file
// for each print. The preview shows the prints on the wall at their real proportions.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { NO_VIEW, panBy, type Placement, type View } from '@/lib/panels/geometry';
import { DEFAULT_PRINT, drawPanel, photoPlacement, printLayout, resolveSize, type PrintDesign } from '@/lib/print-studio/print';
import { downscale, openImage, photoName } from '@/lib/post-studio/render';
import { cn } from '@/lib/utils';
import { PrintPanel } from './print-panel';

const STORE = 'print-studio.settings';
/** The preview draws from a smaller copy; exports always use the full photo. */
const PREVIEW_SIDE = 2400;

export type PrintPhoto = {
  name: string; thumb: string;
  full: ImageBitmap | HTMLImageElement; w: number; h: number;
  preview: CanvasImageSource; pw: number; ph: number;
};

const noSubscribe = () => () => {};
export function PrintStudio() {
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!inBrowser) return <div className="studio grid h-dvh place-items-center bg-background text-sm text-muted-foreground">Loading Print Studio…</div>;
  return <Studio />;
}

function Studio() {
  const s = usePrintState();
  return (
    <TooltipProvider delayDuration={300}>
      <div className="studio flex h-dvh flex-col bg-background text-sm text-foreground md:grid md:grid-cols-[340px_1fr] md:grid-rows-[48px_1fr]">
        <header className="flex h-12 shrink-0 items-center border-b bg-card px-4 md:col-span-2">
          {/* A full page load, so the studio's styles don't follow you to the public site. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="text-[15px] font-semibold tracking-tight">
            Cyanotype <span className="text-cyan-ink">Print</span> Studio
          </a>
          <span className="ml-auto hidden text-xs text-muted-foreground sm:block">Triptychs and split prints for your lab · photos stay on this device</span>
        </header>
        <aside className="order-3 min-h-0 flex-1 overflow-y-auto border-r bg-card md:order-none" aria-label="Settings">
          <PrintPanel s={s} />
        </aside>
        <Wall s={s} />
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}

export type PrintState = ReturnType<typeof usePrintState>;

function usePrintState() {
  // `settings` is what was chosen; `design` adds each print's size when sizing by the whole photo.
  const [settings, setSettings] = useState<PrintDesign>(loadSettings);
  const [photo, setPhoto] = useState<PrintPhoto | null>(null);
  const [view, setView] = useState<View>(NO_VIEW);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* private mode */ }
  }, [settings]);

  const { design, ok: sizeOk } = resolveSize(settings, photo ? photo.w / photo.h : undefined);
  const update = (patch: Partial<PrintDesign>) => setSettings(d => ({ ...d, ...patch }));
  const layout = printLayout(design);
  const placement = photo ? photoPlacement(photo.w, photo.h, layout, view) : null;

  async function open(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/') && !/\.(heic|heif|jpe?g|png|webp|tiff?)$/i.test(file.name)) return toast.error(`${file.name} isn't a photo.`);
    setLoading(true);
    try {
      const img = await openImage(file);
      const pv = downscale(img.src, img.w, img.h, PREVIEW_SIDE, true);
      setPhoto(old => {
        if (old) { URL.revokeObjectURL(old.thumb); if ('close' in old.full) old.full.close(); }
        return { name: photoName(file, 1), thumb: URL.createObjectURL(file), full: img.src, w: img.w, h: img.h, preview: pv.src, pw: pv.w, ph: pv.h };
      });
      setView(NO_VIEW);
    } catch (e) { toast.error((e as Error).message || `Couldn't open ${file.name}`); }
    finally { setLoading(false); }
  }

  return { design, sizeOk, update, photo, open, view, setView, layout, placement, loading };
}

function loadSettings(): PrintDesign {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (v && typeof v === 'object') return { ...DEFAULT_PRINT, ...v };
  } catch { /* private mode or bad JSON */ }
  return DEFAULT_PRINT;
}

/** A placement for the preview copy, which is smaller than the photo the placement was made for. */
const scaled = (q: Placement, k: number): Placement => ({ ...q, sx: q.sx * k, sy: q.sy * k, sw: q.sw * k, sh: q.sh * k });

function Wall({ s }: { s: PrintState }) {
  const { design: d, layout, photo, placement } = s;
  const wrap = useRef<HTMLElement>(null), canvas = useRef<HTMLCanvasElement>(null), picker = useRef<HTMLInputElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [dropping, setDropping] = useState(false);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);

  const pad = 32, labels = 28;
  const k = Math.max(0, Math.min((box.w - 2 * pad) / layout.wall.w, (box.h - 2 * pad - labels) / layout.wall.h)); // screen px per inch
  const dispW = Math.round(layout.wall.w * k), dispH = Math.round(layout.wall.h * k);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !dispW) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(dispW * dpr); c.height = Math.round(dispH * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(c.width / layout.wall.w, 0, 0, c.height / layout.wall.h, 0, 0);
    ctx.clearRect(0, 0, layout.wall.w, layout.wall.h);
    ctx.imageSmoothingQuality = 'high';
    if (!photo || !placement) {
      ctx.fillStyle = 'rgba(128,128,140,0.22)';
      for (const j of layout.jobs) ctx.fillRect(j.panel.x, j.panel.y, j.panel.w, j.panel.h);
      return;
    }
    const q = scaled(placement, photo.pw / photo.w);
    // The part hidden behind the gaps, faintly, so you can see what the crop skips.
    if (d.continuous) {
      ctx.globalAlpha = 0.18;
      ctx.drawImage(photo.preview, q.sx, q.sy, q.sw, q.sh, q.dx, q.dy, q.dw, q.dh);
      ctx.globalAlpha = 1;
    }
    for (const j of layout.jobs) {
      ctx.save();
      ctx.beginPath(); ctx.rect(j.panel.x, j.panel.y, j.panel.w, j.panel.h); ctx.clip();
      ctx.translate(j.panel.x - d.bleed, j.panel.y - d.bleed);
      drawPanel(ctx, d, j, photo.preview, q);
      ctx.restore();
    }
  });

  // Scrolling zooms the photo; React's wheel listener is passive, so this one is native.
  const latest = useRef(s);
  useEffect(() => { latest.current = s; });
  useEffect(() => {
    const el = canvas.current?.parentElement;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!latest.current.photo) return;
      e.preventDefault();
      latest.current.setView(v => ({ ...v, zoom: Math.min(5, Math.max(1, v.zoom * Math.exp(-e.deltaY * 0.002))) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // A photo dropped anywhere on the page opens.
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDropping(true); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDropping(false); };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault(); setDropping(false);
      latest.current.open(e.dataTransfer.files[0]);
    };
    window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, []);

  const u = d.unit === 'cm' ? 2.54 : 1, unit = d.unit;
  const len = (inches: number) => `${+(inches * u).toFixed(1)} ${unit}`;

  return (
    <main ref={wrap} className={cn('relative order-2 grid h-[55dvh] min-h-0 min-w-0 shrink-0 place-items-center overflow-hidden bg-neutral-800/40 md:order-none md:h-auto', dropping && 'bg-accent/40')}>
      <div>
        <div
          className={cn('relative touch-none select-none', photo ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer')}
          style={{ width: dispW, height: dispH }}
          title={photo ? 'Drag to choose what shows · scroll to zoom · double-click to recenter' : 'Choose a photo'}
          onPointerDown={e => {
            if (!photo) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, view: s.view };
          }}
          onPointerMove={e => {
            const g = drag.current;
            if (!g || !photo) return;
            s.setView(panBy(photo.w, photo.h, layout.cover, g.view, (e.clientX - g.x) / k, (e.clientY - g.y) / k));
          }}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
          onDoubleClick={() => s.setView(NO_VIEW)}
          onClick={() => { if (!photo) picker.current?.click(); }}
        >
          <canvas ref={canvas} className="absolute inset-0 size-full" role="img" aria-label="Prints on the wall" />
          {layout.jobs.map(j => (
            <div
              key={j.index} className="pointer-events-none absolute shadow-xl shadow-black/50 ring-1 ring-white/10"
              style={{ left: j.panel.x * k, top: j.panel.y * k, width: j.panel.w * k, height: j.panel.h * k }}
            >
              {layout.jobs.length > 1 && <span className="absolute top-1 left-1 rounded bg-black/55 px-1.5 text-[10px] text-white/90">{j.index + 1}</span>}
            </div>
          ))}
          {!photo && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-neutral-400">
              <span className="flex flex-col items-center gap-1 text-center text-xs"><ImagePlus className="size-6" />Drop a photo here<br />or click to choose</span>
            </div>
          )}
        </div>
        <div className="mt-2 text-center text-xs text-muted-foreground" style={{ height: labels }}>
          Each print {len(d.w)} × {len(d.h)}
          {layout.jobs.length > 1 && <> · {d.gap > 0 ? `${len(d.gap)} apart` : 'edge to edge'} · {len(layout.wall.w)} × {len(layout.wall.h)} on the wall</>}
        </div>
      </div>
      {s.loading && (
        <div className="absolute top-3 right-3 flex items-center gap-2 rounded-md bg-card px-3 py-1.5 text-xs text-muted-foreground shadow">
          <Loader2 className="size-3.5 animate-spin" />Opening photo…
        </div>
      )}
      <input ref={picker} type="file" accept="image/*" hidden onChange={e => { s.open(e.target.files?.[0]); e.target.value = ''; }} />
    </main>
  );
}
