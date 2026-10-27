'use client';

// The right-hand side: photo tabs, view switcher, the preview and the tone strip.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ImageIcon, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { aspectValue, drawStrip, predictedDistinct, renderCrop, renderView } from '@/lib/negative-studio/canvas';
import { clamp } from '@/lib/negative-studio/math';
import { printDims } from '@/lib/negative-studio/output';
import type { View } from '@/lib/negative-studio/types';
import { cn } from '@/lib/utils';
import { IconButton } from './controls';
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
  const { tabs, active, activate, closeTab } = useStudio();
  const [picker, pick] = usePhotoPicker();
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active?.id]);
  return (
    <div role="tablist" aria-label="Open photos" className="flex items-end gap-0.5 overflow-x-auto border-b bg-card px-2 pt-1.5 [scrollbar-width:thin]">
      {tabs.map(t => {
        const on = t === active;
        return (
          <div
            key={t.id} ref={on ? activeRef : undefined} role="tab" aria-selected={on} title={t.info} tabIndex={0}
            onClick={() => activate(t.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') activate(t.id); }}
            onAuxClick={e => { if (e.button === 1) closeTab(t.id); }}
            className={cn(
              'group flex max-w-52 shrink-0 cursor-pointer select-none items-center gap-1 rounded-t-md border border-b-0 border-transparent py-1.5 pr-1 pl-3 text-[13px] text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              on && '-mb-px border-border bg-background pb-[7px] text-foreground hover:bg-background',
            )}
          >
            <ImageIcon className="size-3.5 shrink-0 opacity-60" />
            <span className="truncate">{t.name}</span>
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

const VIEWS: [View, string][] = [['orig', 'Original'], ['bw', 'B&W'], ['neg', 'Negative'], ['cyan', 'Cyanotype'], ['compare', 'Compare']];

function ViewBar() {
  const { settings, setView, active } = useStudio();
  const { wIn, hIn } = printDims(settings.print, active);
  return (
    <div className="flex items-center gap-3 border-b px-3 py-2">
      <ToggleGroup type="single" variant="outline" size="sm" value={settings.view} onValueChange={v => v && setView(v as View)} aria-label="Preview">
        {VIEWS.map(([v, l]) => <ToggleGroupItem key={v} value={v} className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{l}</ToggleGroupItem>)}
      </ToggleGroup>
      {active && <span className="ml-auto truncate text-xs text-muted-foreground">{active.name} · prints {wIn.toFixed(1)} × {hIn.toFixed(1)} in</span>}
    </div>
  );
}

type Drag = { mode: 'move'; ox: number; oy: number } | { mode: 'new'; sx: number; sy: number } | { mode: 'split' };

function Stage() {
  const { settings, active, cropping, cropDraft, oriented, preview, gidx, luts, setSplit, setCropDraft, finishCrop } = useStudio();
  const stage = useRef<HTMLDivElement>(null), view = useRef<HTMLCanvasElement>(null), drag = useRef<Drag | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

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

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = e.currentTarget, r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dims) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    if (cropping) {
      const c = cropDraft || { x: 0, y: 0, w: 1, h: 1 };
      const inside = cropDraft && p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h;
      drag.current = inside ? { mode: 'move', ox: p.x - c.x, oy: p.y - c.y } : { mode: 'new', sx: p.x, sy: p.y };
    } else if (settings.view === 'compare') {
      drag.current = { mode: 'split' }; setSplit(clamp(p.x));
    }
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d || !dims) return;
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

  return (
    <div ref={stage} className="relative grid min-h-0 place-items-center overflow-hidden bg-[repeating-conic-gradient(#1c1e22_0_25%,#191b1e_0_50%)] bg-[length:24px_24px]">
      <canvas
        ref={view} width={10} height={10}
        className={cn('block touch-none shadow-[0_2px_16px_rgba(0,0,0,.5)]', !dims && 'invisible', (cropping || settings.view === 'compare') && 'cursor-crosshair')}
        style={dims && scale > 0 ? { width: dims.w * scale, height: dims.h * scale } : undefined}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }}
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
          Drag to draw the crop · drag inside to move
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
