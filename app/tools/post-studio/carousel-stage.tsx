'use client';

// The carousel preview: every slide side by side on one strip, with frames you can move, resize and
// crop. Dashed lines mark where Instagram cuts the strip into slides.
import { useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { moveBox, resizeBox, snapTargets, type Box, type Frame, type Handle } from '@/lib/post-studio/carousel';
import { format, NO_VIEW, panBy, type View } from '@/lib/post-studio/layout';
import { drawCarousel } from '@/lib/post-studio/render';
import { cn } from '@/lib/utils';
import type { PostState } from './post-studio';
import { PHOTO_DRAG } from './stage';

const MIN_SLIDE_PX = 220; // narrower than this and the strip scrolls sideways instead
const SNAP_PX = 7;
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function CarouselStage({ s, box, onPick }: { s: PostState; box: { w: number; h: number }; onPick: (frameId?: number) => void }) {
  const { design: d, frames, photoMap } = s, n = d.carousel.slides;
  const f = format(d.format), pad = 24, labels = 22;
  const k = Math.max(0, Math.min((box.h - 2 * pad - labels) / f.h, Math.max((box.w - 2 * pad) / (n * f.w), MIN_SLIDE_PX / f.w)));
  const slideW = Math.round(f.w * k), dispW = slideW * n, dispH = Math.round(f.h * k);
  const canvas = useRef<HTMLCanvasElement>(null), layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !dispW) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(dispW * dpr); c.height = Math.round(dispH * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(c.width / (n * f.w), 0, 0, c.height / f.h, 0, 0);
    drawCarousel(ctx, d, frames, photoMap, 'rgba(128,128,140,0.22)');
  });

  // Scrolling over a frame zooms its photo. React's wheel listener is passive, so this one is native.
  const latest = useRef(s);
  useEffect(() => { latest.current = s; });
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const st = latest.current, t = (e.target as HTMLElement).closest<HTMLElement>('[data-frame]');
      if (!t) return;
      const id = Number(t.dataset.frame);
      if (st.frames.find(x => x.id === id)?.photoId == null) return;
      e.preventDefault();
      st.zoomFrame(id, Math.exp(-e.deltaY * 0.002));
      st.setSelectedFrame(id);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const aspect = f.h / f.w;
  // Pointer movement in screen pixels → slide units (x in slide widths, y in slide heights).
  const toUnits = (dx: number, dy: number) => ({ x: dx / Math.max(1, slideW), y: dy / Math.max(1, dispH) });
  const targetsFor = (id: number) => snapTargets(d.carousel, aspect, frames.filter(x => x.id !== id));
  const tol = { x: SNAP_PX / Math.max(1, slideW), y: SNAP_PX / Math.max(1, dispH) };

  return (
    <div className="absolute inset-0 overflow-x-auto overflow-y-hidden" onPointerDown={e => { if (e.target === e.currentTarget) { s.setSelectedFrame(null); s.setCropping(null); } }}>
      <div className="mx-auto flex min-h-full flex-col justify-center" style={{ width: dispW + 2 * pad, padding: `0 ${pad}px` }} onPointerDown={e => { if (e.target === e.currentTarget) { s.setSelectedFrame(null); s.setCropping(null); } }}>
        <div className="relative shadow-2xl shadow-black/40" style={{ width: dispW, height: dispH }}>
          <canvas ref={canvas} className="absolute inset-0 size-full" aria-label="Carousel preview" role="img" />
          <div
            ref={layer} className="absolute inset-0"
            onPointerDown={e => { if (e.target === e.currentTarget) { s.setSelectedFrame(null); s.setCropping(null); } }}
          >
            {frames.map(fr => (
              <FrameLayer
                key={fr.id} s={s} frame={fr} slides={n} aspect={aspect}
                toUnits={toUnits} targets={() => targetsFor(fr.id)} tol={tol}
                postPx={{ W: f.w, H: f.h, perScreenPx: f.w / Math.max(1, slideW) }}
                onPick={() => onPick(fr.id)}
              />
            ))}
          </div>
          {/* Seams between slides, drawn over the photos but never exported. */}
          {Array.from({ length: n - 1 }, (_, i) => (
            <div key={i} className="pointer-events-none absolute inset-y-0 border-l border-dashed border-cyan-ink/80 mix-blend-difference" style={{ left: (i + 1) * slideW }} />
          ))}
        </div>
        <div className="flex text-[11px] text-muted-foreground" style={{ width: dispW, height: labels }}>
          {Array.from({ length: n }, (_, i) => <span key={i} className="grid flex-1 place-items-center">{i + 1}</span>)}
        </div>
      </div>
    </div>
  );
}

type Drag =
  | { kind: 'move' | 'resize'; handle?: Handle; x: number; y: number; start: Box; moved: boolean }
  | { kind: 'pan'; x: number; y: number; view: View; moved: boolean };

function FrameLayer({ s, frame, slides, aspect, toUnits, targets, tol, postPx, onPick }: {
  s: PostState; frame: Frame; slides: number; aspect: number;
  toUnits: (dx: number, dy: number) => { x: number; y: number };
  targets: () => ReturnType<typeof snapTargets>; tol: { x: number; y: number };
  postPx: { W: number; H: number; perScreenPx: number }; onPick: () => void;
}) {
  const photo = frame.photoId != null ? s.photoMap.get(frame.photoId) : undefined;
  const selected = s.selectedFrame === frame.id, cropping = s.cropping === frame.id && !!photo;
  const drag = useRef<Drag | null>(null), snaps = useRef<ReturnType<typeof snapTargets> | null>(null);
  const [over, setOver] = useState(false);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  function begin(e: React.PointerEvent, kind: 'move' | 'resize', handle?: Handle) {
    e.stopPropagation();
    s.setSelectedFrame(frame.id);
    if (s.cropping !== frame.id) s.setCropping(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    snaps.current = targets();
    drag.current = cropping && kind === 'move'
      ? { kind: 'pan', x: e.clientX, y: e.clientY, view: frame, moved: false }
      : { kind, handle, x: e.clientX, y: e.clientY, start: { x: frame.x, y: frame.y, w: frame.w, h: frame.h }, moved: false };
  }
  function moveTo(e: React.PointerEvent) {
    const g = drag.current;
    if (!g) return;
    const dxPx = e.clientX - g.x, dyPx = e.clientY - g.y;
    if (!g.moved && Math.hypot(dxPx, dyPx) < 3) return;
    g.moved = true;
    if (g.kind === 'pan') {
      if (!photo) return;
      const rect = { x: 0, y: 0, w: frame.w * postPx.W, h: frame.h * postPx.H };
      s.setFrameView(frame.id, panBy(photo.w, photo.h, rect, g.view, dxPx * postPx.perScreenPx, dyPx * postPx.perScreenPx));
      return;
    }
    const u = toUnits(dxPx, dyPx), t = snaps.current!;
    // Holding Alt (Option) turns snapping off for fine placement.
    const tx = e.altKey ? 0 : tol.x, ty = e.altKey ? 0 : tol.y;
    s.setBox(frame.id, g.kind === 'move' ? moveBox(g.start, u.x, u.y, t, tx, ty) : resizeBox(g.start, g.handle!, u.x, u.y, t, tx, ty, aspect));
  }
  function end() {
    const g = drag.current;
    drag.current = null;
    if (g && !g.moved && !photo && g.kind === 'move') onPick();
  }

  const crosses = Math.floor(frame.x + 1e-6) !== Math.floor(frame.x + frame.w - 1e-6) && frame.x + frame.w > 0 && frame.x < slides;
  return (
    <div
      data-frame={frame.id}
      style={{ left: pct(frame.x, slides), top: pct(frame.y, 1), width: pct(frame.w, slides), height: pct(frame.h, 1) }}
      className={cn(
        'group absolute touch-none select-none',
        cropping ? 'cursor-grab active:cursor-grabbing ring-2 ring-amber-400' : 'cursor-move',
        selected && !cropping && 'ring-2 ring-primary',
        !selected && 'hover:ring-1 hover:ring-white/40',
        over && 'ring-2 ring-cyan-ink bg-cyan-ink/20',
      )}
      title={photo ? (cropping ? 'Drag to choose what shows · scroll to zoom · double-click when done' : 'Drag to move · double-click to crop · scroll to zoom') : 'Drag to move · click to add a photo'}
      onPointerDown={e => begin(e, 'move')}
      onPointerMove={moveTo}
      onPointerUp={end}
      onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={() => { if (photo) s.setCropping(cropping ? null : frame.id); }}
      onDragOver={e => { if (e.dataTransfer.types.includes(PHOTO_DRAG) || e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault(); e.stopPropagation(); setOver(false);
        const id = e.dataTransfer.getData(PHOTO_DRAG);
        if (e.dataTransfer.files.length) s.addFiles([...e.dataTransfer.files], frame.id);
        else if (id) s.assignFrame(frame.id, Number(id));
      }}
    >
      {!photo && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-neutral-500">
          <ImagePlus className="size-5" />
        </div>
      )}
      {selected && crosses && !cropping && (
        <span className="pointer-events-none absolute top-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          Spans slides {Math.max(1, Math.floor(frame.x) + 1)}–{Math.min(slides, Math.ceil(frame.x + frame.w))}
        </span>
      )}
      {selected && !cropping && HANDLES.map(h => (
        <span
          key={h} role="presentation"
          onPointerDown={e => begin(e, 'resize', h)} onPointerMove={moveTo} onPointerUp={end}
          onPointerCancel={() => { drag.current = null; }}
          className="absolute z-10 size-2.5 rounded-[2px] border border-primary bg-white"
          style={{
            left: h.includes('w') ? -5 : h.includes('e') ? 'calc(100% - 5px)' : 'calc(50% - 5px)',
            top: h.includes('n') ? -5 : h.includes('s') ? 'calc(100% - 5px)' : 'calc(50% - 5px)',
            cursor: `${h}-resize`,
          }}
        />
      ))}
      {cropping && (
        <button
          type="button" onPointerDown={e => e.stopPropagation()} onClick={() => s.setCropping(null)}
          className="absolute right-1 bottom-1 rounded bg-amber-400 px-2 py-0.5 text-[11px] font-medium text-black"
        >Done</button>
      )}
      {cropping && (frame.zoom !== 1 || frame.panX !== 0 || frame.panY !== 0) && (
        <button
          type="button" onPointerDown={e => e.stopPropagation()} onClick={() => s.setFrameView(frame.id, NO_VIEW)}
          className="absolute bottom-1 left-1 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white"
        >Recenter</button>
      )}
    </div>
  );
}
