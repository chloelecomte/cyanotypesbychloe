'use client';

// The right-hand side: photo tabs, view switcher, the preview and the tone strip.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Ellipsis, ImageIcon, ImagePlus, Plus, Redo2, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { aspectValue, drawStrip, predictedDistinct, renderCrop, renderView, type Crop } from '@/lib/negative-studio/canvas';
import { clamp } from '@/lib/negative-studio/math';
import { cyanotypePreview, download, jpeg, printDims } from '@/lib/negative-studio/output';
import type { View } from '@/lib/negative-studio/types';
import { cn } from '@/lib/utils';
import { BusyButton, IconButton, MOBILE, TOUCH, useBusy, useMedia } from './controls';
import { usePhotoPicker } from './steps';
import { useStudio } from './use-studio';

export function Workspace() {
  return (
    <main className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_1fr_auto]">
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
  const touch = useMedia(TOUCH);
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active?.id]);
  return (
    <div role="tablist" aria-label="Open photos" className="flex min-h-10 items-end gap-0.5 overflow-x-auto overscroll-x-contain border-b bg-card px-2 pt-1.5 [scrollbar-width:thin]">
      {tabs.map(t => {
        const on = t === active;
        return (
          <div
            key={t.id} ref={on ? activeRef : undefined} role="tab" aria-selected={on} tabIndex={0}
            title={`${t.info} · ${touch ? 'tap again' : 'double-click'} to rename`}
            // No double-click on touch screens: tapping the photo that's already showing renames it.
            onClick={() => { if (touch && on) setEditing(t.id); else activate(t.id); }} onDoubleClick={() => setEditing(t.id)}
            onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') activate(t.id); if (e.key === 'F2') setEditing(t.id); }}
            onAuxClick={e => { if (e.button === 1) closeTab(t.id); }}
            className={cn(
              'group flex max-w-52 shrink-0 cursor-pointer select-none items-center gap-1 rounded-t-md border border-b-0 border-transparent py-1.5 pr-1 pl-3 text-[13px] text-muted-foreground hover:bg-accent/60 hover:text-foreground max-md:max-w-40',
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
              className="rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100 pointer-coarse:-my-1.5 pointer-coarse:p-1.5"
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

const VIEWS: [View, string, string][] = [
  ['orig', 'Original', 'Photo'], ['bw', 'B&W', 'B&W'], ['neg', 'Negative', 'Neg.'], ['cyan', 'Cyanotype', 'Cyan'], ['compare', 'Compare', 'Compare'],
];

function ViewBar() {
  const { settings, setView, active, luts, canUndo, canRedo, undo, redo } = useStudio();
  const { wIn, hIn } = printDims(settings.print, active);
  const [saving, run] = useBusy();
  const mobile = useMedia(MOBILE);
  const mod = typeof navigator !== 'undefined' && /Mac|iP/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  function savePreview() {
    if (!active) return;
    run(async () => download(await jpeg(cyanotypePreview(active, settings.bw, luts.cyan)), `${active.name}_cyanotype-preview.jpg`));
  }
  return (
    <div className="flex items-center gap-3 border-b px-3 py-2 max-md:gap-1.5 max-md:px-2 max-md:py-1.5">
      <div className="flex shrink-0">
        <IconButton label={`Undo (${mod}Z)`} size="icon-sm" disabled={!canUndo} onClick={undo}><Undo2 /></IconButton>
        <IconButton label={`Redo (${mod === '⌘' ? '⇧⌘Z' : 'Ctrl+Y'})`} size="icon-sm" disabled={!canRedo} onClick={redo}><Redo2 /></IconButton>
      </div>
      <div className="min-w-0 overflow-x-auto [scrollbar-width:none]">
        <ToggleGroup type="single" variant="outline" size="sm" value={settings.view} onValueChange={v => v && setView(v as View)} aria-label="Preview">
          {VIEWS.map(([v, l, short]) => (
            <ToggleGroupItem key={v} value={v} aria-label={l} className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground max-md:px-1.5 max-md:text-[13px]">
              {mobile ? short : l}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {active && (mobile ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="ml-auto shrink-0" aria-label="More" disabled={saving}><Ellipsis /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-[calc(100vw-1.5rem)]">
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{active.name} · prints {wIn.toFixed(1)} × {hIn.toFixed(1)} in</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={savePreview}><Download />Save cyanotype preview</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : <>
        <span className="ml-auto truncate text-xs text-muted-foreground">{active.name} · prints {wIn.toFixed(1)} × {hIn.toFixed(1)} in</span>
        <BusyButton busy={saving} icon={<Download />} variant="outline" size="sm" onClick={savePreview}
          title="Save the simulated cyanotype print as a JPEG, for reference">Save preview</BusyButton>
      </>)}
    </div>
  );
}

type Drag =
  | { mode: 'move'; ox: number; oy: number; before: Crop | null }
  | { mode: 'new'; sx: number; sy: number; before: Crop | null }
  | { mode: 'split' }
  | { mode: 'pan'; x: number; y: number; zx: number; zy: number };
/** Magnification and offset of the preview, in screen pixels from where it sits when it fits the window. */
type Zoom = { k: number; x: number; y: number };
const FIT: Zoom = { k: 1, x: 0, y: 0 }, MAX_ZOOM = 6;

/** Keeps the zoomed preview covering the middle of the window: no zooming out past fit, no panning off the edge. */
function bound(z: Zoom, w: number, h: number): Zoom {
  const k = clamp(z.k, 1, MAX_ZOOM), mx = w * (k - 1) / 2, my = h * (k - 1) / 2;
  return { k, x: clamp(z.x, -mx, mx), y: clamp(z.y, -my, my) };
}

function Stage() {
  const { settings, active, cropping, cropDraft, oriented, preview, gidx, luts, setSplit, setCropDraft, finishCrop } = useStudio();
  const stage = useRef<HTMLDivElement>(null), view = useRef<HTMLCanvasElement>(null), drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; mx: number; my: number; z: Zoom } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(FIT);
  const touch = useMedia(TOUCH);
  const [picker, pick] = usePhotoPicker();

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(stage.current!);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (cropping && oriented) renderCrop(view.current!, oriented, cropDraft ?? null);
    else if (preview && gidx) renderView(view.current!, preview, gidx, luts, settings.view, settings.split);
  }, [cropping, oriented, cropDraft, preview, gidx, luts, settings.view, settings.split]);

  const dims = cropping && oriented ? { w: oriented.width, h: oriented.height } : preview;
  const scale = dims ? Math.min((box.w - 32) / dims.w, (box.h - 32) / dims.h) : 0;
  const shown = { w: (dims?.w ?? 0) * scale, h: (dims?.h ?? 0) * scale };

  // Back to fitting the window for another photo, a new shape, or when starting or finishing a crop.
  const fitKey = `${active?.id}:${cropping}:${dims?.w}x${dims?.h}`;
  const [zoomedFor, setZoomedFor] = useState(fitKey);
  if (fitKey !== zoomedFor) { setZoomedFor(fitKey); setZoom(FIT); }

  // Trackpad pinches (and ctrl + wheel) zoom around the pointer; other scrolling pans once zoomed in.
  // A native listener, since React's wheel listener is passive and can't stop the page zooming.
  const latest = useRef({ shown, zoom });
  useEffect(() => { latest.current = { shown, zoom }; });
  useEffect(() => {
    const el = stage.current!;
    const onWheel = (e: WheelEvent) => {
      const { shown: { w, h }, zoom: z } = latest.current;
      if (!w) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = el.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
        const k = clamp(z.k * Math.exp(-e.deltaY * 0.01), 1, MAX_ZOOM);
        setZoom(bound({ k, x: mx - k * (mx - z.x) / z.k, y: my - k * (my - z.y) / z.k }, w, h));
      } else if (z.k > 1) {
        e.preventDefault();
        setZoom(bound({ ...z, x: z.x - e.deltaX, y: z.y - e.deltaY }, w, h));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /** The pointer relative to the middle of the stage, in screen pixels. */
  function fromCentre(e: React.PointerEvent) {
    const r = stage.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  }
  /** The pointer on the image, 0–1 across and down. */
  function point(e: React.PointerEvent) {
    const r = view.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, w: r.width, h: r.height };
  }
  function startPinch() {
    const d = drag.current;
    if (d && (d.mode === 'move' || d.mode === 'new')) setCropDraft(d.before); // a second finger means zoom, not crop
    drag.current = null;
    const [a, b] = [...pointers.current.values()];
    pinch.current = { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, z: zoom };
  }
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!dims || (e.target as Element).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, fromCentre(e));
    if (pointers.current.size === 2) return startPinch();
    if (pointers.current.size > 2) return;
    const p = point(e);
    if (cropping) {
      const c = cropDraft || { x: 0, y: 0, w: 1, h: 1 }, before = cropDraft ?? null;
      // Grabbing a corner resizes: the same as drawing a new crop from the opposite corner.
      const reach = touch ? 28 : 12;
      const corner = cropDraft && [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]]
        .find(([x, y]) => Math.hypot((p.x - x) * p.w, (p.y - y) * p.h) < reach);
      const inside = cropDraft && p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h;
      drag.current = corner
        ? { mode: 'new', sx: corner[0] === c.x ? c.x + c.w : c.x, sy: corner[1] === c.y ? c.y + c.h : c.y, before }
        : inside ? { mode: 'move', ox: p.x - c.x, oy: p.y - c.y, before } : { mode: 'new', sx: clamp(p.x), sy: clamp(p.y), before };
    } else if (settings.view === 'compare') {
      drag.current = { mode: 'split' }; setSplit(clamp(p.x));
    } else if (zoom.k > 1) {
      drag.current = { mode: 'pan', x: e.clientX, y: e.clientY, zx: zoom.x, zy: zoom.y };
    }
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, fromCentre(e));
    const pz = pinch.current;
    if (pz && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const k = clamp(pz.z.k * Math.hypot(a.x - b.x, a.y - b.y) / pz.d, 1, MAX_ZOOM), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      return setZoom(bound({ k, x: mx - k * (pz.mx - pz.z.x) / pz.z.k, y: my - k * (pz.my - pz.z.y) / pz.z.k }, shown.w, shown.h));
    }
    const d = drag.current;
    if (!d || !dims) return;
    if (d.mode === 'pan') return setZoom(bound({ ...zoom, x: d.zx + e.clientX - d.x, y: d.zy + e.clientY - d.y }, shown.w, shown.h));
    const p = point(e);
    if (d.mode === 'split') return setSplit(clamp(p.x));
    const nx = clamp(p.x), ny = clamp(p.y), { w, h } = dims;
    if (d.mode === 'move') {
      const c = cropDraft!;
      return setCropDraft({ ...c, x: clamp(nx - d.ox, 0, 1 - c.w), y: clamp(ny - d.oy, 0, 1 - c.h) });
    }
    const r = active && aspectValue(settings.aspect, active.src, active.rot);
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
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    drag.current = null;
  }

  return (
    <div
      ref={stage}
      className={cn(
        'relative grid min-h-0 touch-none place-items-center overflow-hidden bg-[repeating-conic-gradient(#1c1e22_0_25%,#191b1e_0_50%)] bg-[length:24px_24px]',
        (cropping || settings.view === 'compare') ? 'cursor-crosshair' : zoom.k > 1 && 'cursor-grab active:cursor-grabbing',
      )}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
    >
      <canvas
        ref={view} width={10} height={10}
        className={cn('block shadow-[0_2px_16px_rgba(0,0,0,.5)]', !dims && 'invisible')}
        style={dims && scale > 0 ? { width: shown.w, height: shown.h, transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.k})` } : undefined}
      />
      {!active && (
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-muted-foreground">
          <div className="max-w-sm">
            <ImageIcon className="mx-auto mb-3 size-10 opacity-40 max-md:hidden" />
            <h2 className="mb-1.5 text-base font-medium text-foreground">Open a photo to begin</h2>
            <Button className="my-2" onClick={pick}><ImagePlus />Choose photos</Button>
            {picker}
            {!touch && <p>or drag them onto this window.</p>}
            <p className="mt-3 max-md:text-xs">You can already play with the curve: the strip below shows how a grey scale would print.</p>
          </div>
        </div>
      )}
      {cropping && (
        <div className="absolute top-3 left-1/2 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-lg border bg-popover py-1.5 pr-1.5 pl-3 text-xs text-muted-foreground shadow-lg">
          {touch ? 'Drag corners to resize, inside to move' : 'Drag to draw the crop · drag a corner to resize · drag inside to move'}
          <Button size="sm" onClick={finishCrop}><Check />Done</Button>
        </div>
      )}
      {zoom.k > 1 && (
        <Button size="sm" variant="secondary" className="absolute right-3 bottom-3 tabular-nums shadow-lg" onClick={() => setZoom(FIT)}
          title="Fit the preview to the window">{Math.round(zoom.k * 100)}% · Fit</Button>
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
    <div className="grid grid-cols-[110px_1fr_150px] items-center gap-3 border-t bg-card px-4 py-2.5 max-md:grid-cols-[52px_1fr_auto] max-md:gap-2 max-md:px-2 max-md:py-1.5">
      <div className="grid grid-rows-3 gap-[3px] text-right text-[11px] text-muted-foreground max-md:gap-0 max-md:text-[10px] max-md:leading-[14px]">
        <span><span className="max-md:hidden">Ideal print</span><span className="md:hidden">Ideal</span></span>
        <span><span className="max-md:hidden">Your negative</span><span className="md:hidden">Negative</span></span>
        <span><span className="max-md:hidden">Predicted print</span><span className="md:hidden">Predicted</span></span>
      </div>
      <canvas ref={canvas} width={1400} height={120} className="block h-[60px] w-full min-w-0 rounded-sm max-md:h-[42px]" aria-label="Tone strip" />
      <div className="text-xs text-muted-foreground max-md:text-right max-md:text-[10px] max-md:leading-tight">
        <b className="block text-xl font-semibold text-foreground tabular-nums max-md:text-base">{distinct}<span className="text-xs font-normal text-muted-foreground md:hidden">/21</span></b>
        <span className="max-md:hidden">distinct tones of 21 in the predicted print</span>
        <span className="md:hidden">tones</span>
      </div>
    </div>
  );
}
