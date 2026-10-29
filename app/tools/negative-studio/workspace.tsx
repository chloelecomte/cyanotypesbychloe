'use client';

// The right-hand side: photo tabs, view switcher, the preview and the tone strip.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, ImageIcon, Plus, Redo2, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { aspectValue, drawStrip, predictedDistinct, renderCrop, renderView, type Crop } from '@/lib/negative-studio/canvas';
import { clamp } from '@/lib/negative-studio/math';
import { cyanotypePreview, download, jpeg, printDims } from '@/lib/negative-studio/output';
import type { View } from '@/lib/negative-studio/types';
import { cn } from '@/lib/utils';
import { BusyButton, IconButton, useBusy } from './controls';
import { usePhotoPicker } from './steps';
import { useStudio } from './use-studio';

export function Workspace() {
  return (
    <main className="grid min-h-0 min-w-0 grid-rows-[auto_auto_1fr_auto]">
      <PhotoTabs />
      <ViewBar />
      <Stage />
      <ToneStrip />
    </main>
  );
}

function PhotoTabs() {
  const { tabs, active, activate, closeTab, renameTab } = useStudio();
  const [picker, pick] = usePhotoPicker();
  const [editing, setEditing] = useState<number | null>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active?.id]);
  return (
    <div role="tablist" aria-label="Open photos" className="flex items-end gap-0.5 overflow-x-auto border-b bg-card px-2 pt-1.5 [scrollbar-width:thin]">
      {tabs.map(t => {
        const on = t === active;
        return (
          <div
            key={t.id} ref={on ? activeRef : undefined} role="tab" aria-selected={on} title={`${t.info} · double-click to rename`} tabIndex={0}
            onClick={() => activate(t.id)} onDoubleClick={() => setEditing(t.id)}
            onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') activate(t.id); if (e.key === 'F2') setEditing(t.id); }}
            onAuxClick={e => { if (e.button === 1) closeTab(t.id); }}
            className={cn(
              'group flex max-w-52 shrink-0 cursor-pointer select-none items-center gap-1 rounded-t-md border border-b-0 border-transparent py-1.5 pr-1 pl-3 text-[13px] text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              on && '-mb-px border-border bg-background pb-[7px] text-foreground hover:bg-background',
            )}
          >
            <ImageIcon className="size-3.5 shrink-0 opacity-60" />
            {editing === t.id
              ? <TabNameInput name={t.name} onDone={name => { if (name) renameTab(t.id, name); setEditing(null); }} />
              : <span className="truncate">{t.name}</span>}
            <button
              type="button" aria-label={`Close ${t.name}`} title="Close this photo"
              onClick={e => { e.stopPropagation(); closeTab(t.id); }}
              className="rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100"
            ><X className="size-3.5" /></button>
          </div>
        );
      })}
      <IconButton label="Open another photo in a new tab" size="icon-sm" className="mb-1 self-center text-muted-foreground" onClick={pick}><Plus /></IconButton>
      {picker}
    </div>
  );
}

/** Renames a tab in place: Enter or clicking away keeps the name, Escape cancels. */
function TabNameInput({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name);
  return (
    <input
      autoFocus value={value} aria-label="Photo name" onFocus={e => e.target.select()}
      onChange={e => setValue(e.target.value)} onClick={e => e.stopPropagation()}
      onBlur={() => onDone(value.trim() || null)}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') onDone(null); }}
      className="w-36 rounded-sm bg-input/40 px-1 text-foreground outline-none ring-1 ring-ring"
    />
  );
}

const VIEWS: [View, string][] = [['orig', 'Original'], ['bw', 'B&W'], ['neg', 'Negative'], ['cyan', 'Cyanotype'], ['compare', 'Compare']];

function ViewBar() {
  const { settings, setView, active, luts, canUndo, canRedo, undo, redo } = useStudio();
  const { wIn, hIn } = printDims(settings.print, active);
  const [saving, run] = useBusy();
  const mod = typeof navigator !== 'undefined' && /Mac|iP/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  function savePreview() {
    if (!active) return;
    run(async () => download(await jpeg(cyanotypePreview(active, settings.bw, luts.cyan)), `${active.name}_cyanotype-preview.jpg`));
  }
  return (
    <div className="flex items-center gap-3 border-b px-3 py-2">
      <div className="flex">
        <IconButton label={`Undo (${mod}Z)`} size="icon-sm" disabled={!canUndo} onClick={undo}><Undo2 /></IconButton>
        <IconButton label={`Redo (${mod === '⌘' ? '⇧⌘Z' : 'Ctrl+Y'})`} size="icon-sm" disabled={!canRedo} onClick={redo}><Redo2 /></IconButton>
      </div>
      <ToggleGroup type="single" variant="outline" size="sm" value={settings.view} onValueChange={v => v && setView(v as View)} aria-label="Preview">
        {VIEWS.map(([v, l]) => <ToggleGroupItem key={v} value={v} className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{l}</ToggleGroupItem>)}
      </ToggleGroup>
      {active && <>
        <span className="ml-auto truncate text-xs text-muted-foreground">{active.name} · prints {wIn.toFixed(1)} × {hIn.toFixed(1)} in</span>
        <BusyButton busy={saving} icon={<Download />} variant="outline" size="sm" onClick={savePreview}
          title="Save the simulated cyanotype print as a JPEG, for reference">Save preview</BusyButton>
      </>}
    </div>
  );
}

type Side = -1 | 0 | 1;
type Drag =
  | { mode: 'move'; ox: number; oy: number }
  | { mode: 'new'; sx: number; sy: number }
  | { mode: 'edge'; horiz: boolean; anchor: number; c0: Crop }
  | { mode: 'split' };

/** How far from a crop corner or edge, in screen pixels, a press still grabs it. */
const GRAB = { mouse: 14, touch: 26 };
const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

/** Which corner or edge of the crop is under the pointer: ex/ey are -1 (left/top), 1 (right/bottom) or 0. */
function handleAt(p: { x: number; y: number }, c: Crop, rw: number, rh: number, tol: number): { ex: Side; ey: Side } | null {
  const side = (v: number, lo: number, hi: number, size: number): Side => {
    const dl = Math.abs(v - lo) * size, dh = Math.abs(v - hi) * size;
    return Math.min(dl, dh) > tol ? 0 : dl < dh ? -1 : 1;
  };
  const ex = side(p.x, c.x, c.x + c.w, rw), ey = side(p.y, c.y, c.y + c.h, rh);
  const inX = p.x * rw > c.x * rw - tol && p.x * rw < (c.x + c.w) * rw + tol;
  const inY = p.y * rh > c.y * rh - tol && p.y * rh < (c.y + c.h) * rh + tol;
  if (ex && ey) return { ex, ey };
  if (ex && inY) return { ex, ey: 0 };
  if (ey && inX) return { ex: 0, ey };
  return null;
}
function cursorFor(h: { ex: Side; ey: Side } | null, inside: boolean) {
  if (h?.ex && h.ey) return h.ex === h.ey ? 'nwse-resize' : 'nesw-resize';
  if (h?.ex) return 'ew-resize';
  if (h?.ey) return 'ns-resize';
  return inside ? 'move' : 'crosshair';
}

function Stage() {
  const { settings, active, cropping, cropDraft, oriented, preview, gidx, luts, setSplit, setCropDraft, finishCrop } = useStudio();
  const stage = useRef<HTMLDivElement>(null), view = useRef<HTMLCanvasElement>(null), drag = useRef<Drag | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [cursor, setCursor] = useState('crosshair');

  const dims = cropping && oriented ? { w: oriented.width, h: oriented.height } : preview;
  const scale = dims ? Math.min((box.w - 32) / dims.w, (box.h - 32) / dims.h) : 0;

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(stage.current!);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (cropping && oriented) renderCrop(view.current!, oriented, cropDraft ?? null, scale);
    else if (preview && gidx) renderView(view.current!, preview, gidx, luts, settings.view, settings.split);
  }, [cropping, oriented, cropDraft, scale, preview, gidx, luts, settings.view, settings.split]);

  // Pointer events land on the whole stage, so a crop corner at the photo's edge can be grabbed from just outside it.
  function point(e: React.PointerEvent) {
    const r = view.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, rw: r.width, rh: r.height };
  }
  function cropTarget(e: React.PointerEvent) {
    const p = point(e), c = cropDraft || FULL;
    const h = handleAt(p, c, p.rw, p.rh, e.pointerType === 'touch' ? GRAB.touch : GRAB.mouse);
    // A crop that already fills the photo can't move, so a drag inside it draws a new one instead.
    const canMove = c.w < 0.999 || c.h < 0.999;
    const inside = canMove && p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h;
    return { p, c, h, inside };
  }
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const onPhoto = e.target === view.current;
    if (!dims || e.button !== 0 || (!onPhoto && e.target !== e.currentTarget)) return;
    if (cropping) {
      const { p, c, h, inside } = cropTarget(e);
      if (h?.ex && h.ey) drag.current = { mode: 'new', sx: h.ex < 0 ? c.x + c.w : c.x, sy: h.ey < 0 ? c.y + c.h : c.y };
      else if (h?.ex) drag.current = { mode: 'edge', horiz: true, anchor: h.ex < 0 ? c.x + c.w : c.x, c0: c };
      else if (h?.ey) drag.current = { mode: 'edge', horiz: false, anchor: h.ey < 0 ? c.y + c.h : c.y, c0: c };
      else if (!onPhoto) return;
      else if (inside) drag.current = { mode: 'move', ox: p.x - c.x, oy: p.y - c.y };
      else drag.current = { mode: 'new', sx: clamp(p.x), sy: clamp(p.y) };
    } else if (settings.view === 'compare' && onPhoto) {
      drag.current = { mode: 'split' }; setSplit(clamp(point(e).x));
    } else return;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!dims) return;
    if (!d) {
      if (cropping) { const { h, inside } = cropTarget(e); setCursor(cursorFor(h, inside)); }
      return;
    }
    const p = point(e);
    if (d.mode === 'split') return setSplit(clamp(p.x));
    const nx = clamp(p.x), ny = clamp(p.y), { w, h } = dims;
    const r = active && aspectValue(settings.aspect, active.src, active.rot);
    if (d.mode === 'move') {
      const c = cropDraft!;
      return setCropDraft({ ...c, x: clamp(nx - d.ox, 0, 1 - c.w), y: clamp(ny - d.oy, 0, 1 - c.h) });
    }
    if (d.mode === 'edge') {
      // Work along the dragged axis (a) and the other one (b); with a fixed aspect, b follows a around its centre.
      const A = d.horiz ? w : h, B = d.horiz ? h : w, pa = d.horiz ? nx : ny, dir = pa < d.anchor ? -1 : 1;
      let la = Math.min(Math.abs(pa - d.anchor), dir > 0 ? 1 - d.anchor : d.anchor) * A;
      const b0 = d.horiz ? d.c0.y : d.c0.x, lb0 = d.horiz ? d.c0.h : d.c0.w;
      let lb = lb0 * B;
      if (r) { const k = d.horiz ? 1 / r : r; lb = la * k; if (lb > B) { lb = B; la = lb / k; } }
      if (la <= 4 || lb <= 4) return;
      const a = dir > 0 ? d.anchor : d.anchor - la / A, b = clamp(b0 + lb0 / 2 - lb / B / 2, 0, 1 - lb / B);
      return setCropDraft(d.horiz ? { x: a, y: b, w: la / A, h: lb / B } : { x: b, y: a, w: lb / B, h: la / A });
    }
    const x0 = d.sx, y0 = d.sy;
    let cw = Math.abs(nx - x0) * w, ch = Math.abs(ny - y0) * h;
    if (r) { if (cw / Math.max(ch, 1) > r) ch = cw / r; else cw = ch * r; }
    const dirx = nx < x0 ? -1 : 1, diry = ny < y0 ? -1 : 1;
    // keep inside the image
    const maxW = (dirx > 0 ? 1 - x0 : x0) * w, maxH = (diry > 0 ? 1 - y0 : y0) * h;
    const k = Math.min(1, maxW / Math.max(cw, 1e-6), maxH / Math.max(ch, 1e-6));
    if (r) { cw *= k; ch *= k; } else { cw = Math.min(cw, maxW); ch = Math.min(ch, maxH); }
    if (cw > 4 && ch > 4) setCropDraft({ x: dirx > 0 ? x0 : x0 - cw / w, y: diry > 0 ? y0 : y0 - ch / h, w: cw / w, h: ch / h });
  }

  return (
    <div
      // While cropping, the top padding keeps the photo clear of the crop bar, so its top edge and corners stay reachable.
      ref={stage} className={cn('relative grid min-h-0 touch-none place-items-center overflow-hidden bg-[repeating-conic-gradient(#1c1e22_0_25%,#191b1e_0_50%)] bg-[length:24px_24px]', cropping && 'pt-14')}
      style={cropping ? { cursor } : undefined}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    >
      <canvas
        ref={view} width={10} height={10}
        className={cn('block shadow-[0_2px_16px_rgba(0,0,0,.5)]', !dims && 'invisible', !cropping && settings.view === 'compare' && 'cursor-crosshair')}
        style={dims && scale > 0 ? { width: dims.w * scale, height: dims.h * scale } : undefined}
      />
      {!active && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center text-sm text-muted-foreground">
          <div className="max-w-sm">
            <ImageIcon className="mx-auto mb-3 size-10 opacity-40" />
            <h2 className="mb-1.5 text-base font-medium text-foreground">Open a photo to begin</h2>
            <p>Choose a file on the left, or drag one onto this window.</p>
            <p className="mt-3">You can already play with the curve: the strip below shows how a grey scale would print.</p>
          </div>
        </div>
      )}
      {cropping && (
        <div className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-popover py-1.5 pr-1.5 pl-3 text-xs text-muted-foreground shadow-lg">
          Drag the corners or edges to resize · drag inside to move
          <Button size="sm" onClick={finishCrop}><Check />Done</Button>
        </div>
      )}
    </div>
  );
}

function ToneStrip() {
  const { curve, response, luts } = useStudio();
  const canvas = useRef<HTMLCanvasElement>(null);
  const distinct = useMemo(() => predictedDistinct(curve, response), [curve, response]);
  useEffect(() => drawStrip(canvas.current!, curve, response, luts.grad), [curve, response, luts.grad]);
  return (
    <div className="grid grid-cols-[110px_1fr_150px] items-center gap-3 border-t bg-card px-4 py-2.5">
      <div className="grid grid-rows-3 gap-[3px] text-right text-[11px] text-muted-foreground">
        <span>Ideal print</span><span>Your negative</span><span>Predicted print</span>
      </div>
      <canvas ref={canvas} width={1400} height={120} className="block h-[60px] w-full rounded-sm" aria-label="Tone strip" />
      <div className="text-xs text-muted-foreground">
        <b className="block text-xl font-semibold text-foreground tabular-nums">{distinct}</b>
        distinct tones of 21 in the predicted print
      </div>
    </div>
  );
}
