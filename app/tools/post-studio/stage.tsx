'use client';

// The live preview: the post drawn on a canvas, with a layer on top for picking, dragging and dropping.
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { format, NO_VIEW, panBy, type View } from '@/lib/post-studio/layout';
import { designRects, drawPost, type Cell } from '@/lib/post-studio/render';
import { cn } from '@/lib/utils';
import type { PostState } from './post-studio';

export const PHOTO_DRAG = 'application/x-post-studio-photo';

export function Stage({ s }: { s: PostState }) {
  const { design: d, cells, photoMap, borderPhoto, selected } = s;
  const wrap = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), layer = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null), pickInto = useRef<number | undefined>(undefined);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);

  const f = format(d.format), pad = 24;
  const k = Math.max(0, Math.min((box.w - 2 * pad) / f.w, (box.h - 2 * pad) / f.h));
  const dispW = Math.round(f.w * k), dispH = Math.round(f.h * k);
  const collage = d.mode === 'collage', fill = collage && d.collage.fit === 'fill';
  const shown: Cell[] = collage ? cells : [{ photoId: borderPhoto?.id ?? null, ...NO_VIEW }];
  const rects = designRects(d, f.w, f.h);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !dispW) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(dispW * dpr); c.height = Math.round(dispH * dpr);
    drawPost(c.getContext('2d')!, d, shown, photoMap, collage ? 'rgba(128,128,140,0.22)' : undefined);
  });

  // Scrolling over a cell zooms its photo. React's wheel listener is passive, so this one is native.
  const latest = useRef(s);
  useEffect(() => { latest.current = s; });
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const st = latest.current, t = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
      if (!t || st.design.mode !== 'collage' || st.design.collage.fit !== 'fill') return;
      const i = Number(t.dataset.cell);
      if (st.cells[i]?.photoId == null) return;
      e.preventDefault();
      st.zoomCell(i, Math.exp(-e.deltaY * 0.002));
      st.setSelected(i);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Files dropped anywhere on the page open; the browser shouldn't navigate to them.
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDropping(true); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDropping(false); };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault(); setDropping(false);
      latest.current.addFiles([...e.dataTransfer.files]);
    };
    window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, []);

  // Delete or Backspace empties the selected cell; Escape deselects.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = latest.current;
      if ((e.target as HTMLElement).closest('input, textarea, [role=slider]') || st.selected == null) return;
      if (e.key === 'Escape') st.setSelected(null);
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.design.mode === 'collage') { e.preventDefault(); st.clearCell(st.selected); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = (i?: number) => { pickInto.current = i; picker.current?.click(); };

  return (
    <main
      ref={wrap}
      className={cn('relative order-2 grid h-[55dvh] min-h-0 min-w-0 shrink-0 place-items-center overflow-hidden bg-background md:order-none md:h-auto', dropping && 'bg-accent/40')}
      onPointerDown={e => { if (e.target === e.currentTarget) s.setSelected(null); }}
    >
      <div className="relative shadow-2xl shadow-black/40" style={{ width: dispW, height: dispH }}>
        <canvas ref={canvas} className="absolute inset-0 size-full" aria-label="Post preview" role="img" />
        <div ref={layer} className="absolute inset-0">
          {rects.map((r, i) => (
            <CellLayer
              key={i} s={s} index={i} cell={shown[i]} fill={fill} collage={collage}
              rect={{ x: r.x, y: r.y, w: r.w, h: r.h }} scale={f.w / Math.max(1, dispW)}
              style={{ left: `${(r.x / f.w) * 100}%`, top: `${(r.y / f.h) * 100}%`, width: `${(r.w / f.w) * 100}%`, height: `${(r.h / f.h) * 100}%` }}
              selected={collage && selected === i} onPick={() => pick(collage ? i : undefined)}
            />
          ))}
        </div>
      </div>
      {s.loading > 0 && (
        <div className="absolute top-3 right-3 flex items-center gap-2 rounded-md bg-card px-3 py-1.5 text-xs text-muted-foreground shadow">
          <Loader2 className="size-3.5 animate-spin" />Opening {s.loading} photo{s.loading > 1 ? 's' : ''}…
        </div>
      )}
      <input
        ref={picker} type="file" accept="image/*" multiple hidden
        onChange={e => { s.addFiles([...(e.target.files ?? [])], pickInto.current); e.target.value = ''; }}
      />
    </main>
  );
}

function CellLayer({ s, index, cell, rect, scale, fill, collage, selected, style, onPick }: {
  s: PostState; index: number; cell: Cell; rect: { x: number; y: number; w: number; h: number }; scale: number;
  fill: boolean; collage: boolean; selected: boolean; style: React.CSSProperties; onPick: () => void;
}) {
  const photo = cell.photoId != null ? s.photoMap.get(cell.photoId) : undefined;
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  const [over, setOver] = useState(false);
  const canPan = fill && !!photo;

  return (
    <div
      data-cell={index} style={style}
      className={cn(
        'group absolute touch-none select-none',
        canPan ? 'cursor-grab active:cursor-grabbing' : !photo && 'cursor-pointer',
        selected && 'ring-2 ring-primary ring-offset-0',
        over && 'ring-2 ring-cyan-ink bg-cyan-ink/20',
      )}
      onPointerDown={e => {
        if (collage) s.setSelected(index);
        if (!canPan) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, view: cell };
      }}
      onPointerMove={e => {
        const g = drag.current;
        if (!g || !photo) return;
        s.setView(index, panBy(photo.w, photo.h, rect, g.view, (e.clientX - g.x) * scale, (e.clientY - g.y) * scale));
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onClick={() => { if (!photo) onPick(); }}
      onDoubleClick={() => { if (canPan) s.setView(index, NO_VIEW); }}
      onDragOver={e => { if (e.dataTransfer.types.includes(PHOTO_DRAG) || e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault(); e.stopPropagation(); setOver(false);
        const id = e.dataTransfer.getData(PHOTO_DRAG);
        if (e.dataTransfer.files.length) s.addFiles([...e.dataTransfer.files], collage ? index : undefined);
        else if (id && collage) s.assign(index, Number(id));
        else if (id) s.placeFromTray(Number(id));
      }}
    >
      {!photo && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-neutral-500">
          <span className="flex flex-col items-center gap-1 text-center text-xs">
            <ImagePlus className="size-5" />
            {!collage && <>Drop photos here<br />or click to choose</>}
          </span>
        </div>
      )}
      {photo && collage && (
        <button
          type="button" aria-label={`Empty cell ${index + 1}`} title="Take the photo out of this cell"
          onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); s.clearCell(index); }}
          className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        ><X className="size-3" /></button>
      )}
    </div>
  );
}
