'use client';

// Straighten & edit: square up a phone photo of a print, then correct its colour, before it goes into a post.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Maximize, Pipette, RotateCcw, RotateCw, ScanSearch, Undo2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DEFAULT_FIX, fixRatio, pixelsOf, renderFix, straightened, toCanvas, type Fix, type Original } from '@/lib/post-studio/fix';
import type { Photo } from '@/lib/post-studio/render';
import { detectQuad, measureRatio, snapEdges, nearestPaper, PAPER_RATIOS, turnQuad, wholeImage, type Pixels, type Pt, type Quad, type RatioId } from '@/lib/post-studio/straighten';
import { applyEdit, autoEdit, NO_EDIT, whiteAt, type Edit } from '@/lib/post-studio/tone';
import { cn } from '@/lib/utils';
import { BusyButton, SliderRow, SubHeading, Tip, useBusy } from '../negative-studio/controls';

const PAPER_STORE = 'post-studio.paper';
const onItem = 'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground';
const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;

export type ApplyFix = (id: number, orig: Original, fix: Fix, out: HTMLCanvasElement) => Promise<void>;

export function FixDialog({ photo, onClose, onApply, onRevert }: {
  photo: Photo | null; onClose: () => void; onApply: ApplyFix; onRevert: (id: number) => void;
}) {
  return (
    <Dialog open={!!photo} onOpenChange={o => !o && onClose()}>
      <DialogContent className="flex h-[94dvh] max-h-[94dvh] flex-col gap-0 p-0 sm:max-w-6xl">
        {photo && <Editor key={photo.id} photo={photo} onClose={onClose} onApply={onApply} onRevert={onRevert} />}
      </DialogContent>
    </Dialog>
  );
}

function Editor({ photo, onClose, onApply, onRevert }: { photo: Photo; onClose: () => void; onApply: ApplyFix; onRevert: (id: number) => void }) {
  // Everything starts from the photo as it was opened, however many times it's been edited since.
  const [orig] = useState<Original>(() => photo.original ?? { src: photo.src, w: photo.w, h: photo.h, thumb: photo.thumb });
  const [view] = useState(() => pixelsOf(orig.src, orig.w, orig.h, 1600));
  const [found] = useState<Quad | null>(() => (photo.fix ? null : findCorners(orig, view)));
  const [fix, setFix] = useState<Fix>(() => photo.fix ?? {
    ...DEFAULT_FIX, quad: found, trim: found ? DEFAULT_FIX.trim : 0, ratio: found ? lastPaper() : 'auto',
  });
  const [step, setStep] = useState<'shape' | 'colour'>('shape');
  const [busy, run] = useBusy();
  const set = (patch: Partial<Fix>) => setFix(f => ({ ...f, ...patch }));
  const setEdit = (patch: Partial<Edit>) => setFix(f => ({ ...f, edit: { ...f.edit, ...patch } }));

  // The first visit to the colour step starts from the automatic edit (unless the photo was edited before).
  const autoDone = useRef(!!photo.fix);
  const base = useMemo(() => (step === 'colour' ? straightened(view, fix, orig.w, orig.h, 1400) : null), [step, view, fix.quad, fix.ratio, fix.trim, orig]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!base || autoDone.current) return;
    autoDone.current = true;
    const e = autoEdit(pixelsOf(toCanvas(base), base.width, base.height, 600));
    setFix(f => ({ ...f, edit: e }));
  }, [base]);

  useEffect(() => {
    if (step === 'shape' && !photo.fix && !found) toast('Couldn’t find the paper’s edges', { description: 'Drag the four corners onto the corners of your print.' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function apply() {
    run(async () => {
      if (fix.ratio !== 'auto' && fix.quad) try { localStorage.setItem(PAPER_STORE, fix.ratio); } catch { /* private mode */ }
      await onApply(photo.id, orig, fix, renderFix(orig, fix, 4096));
      onClose();
    });
  }

  return <>
    <DialogHeader className="flex-row items-center gap-3 border-b px-4 py-3 pr-12 text-left">
      <div className="min-w-0">
        <DialogTitle className="truncate text-base">Straighten &amp; edit · {photo.name}</DialogTitle>
        <DialogDescription className="sr-only">Square up a photo of a print and correct its colours.</DialogDescription>
      </div>
      <ToggleGroup type="single" variant="outline" size="sm" className="ml-auto" value={step} onValueChange={v => v && setStep(v as typeof step)} aria-label="Step">
        <ToggleGroupItem value="shape" className={cn('px-3', onItem)}>1 · Straighten</ToggleGroupItem>
        <ToggleGroupItem value="colour" className={cn('px-3', onItem)}>2 · Colour</ToggleGroupItem>
      </ToggleGroup>
    </DialogHeader>

    {step === 'shape'
      ? <ShapeStep orig={orig} view={view} fix={fix} set={set} />
      : <ColourStep base={base} edit={fix.edit} setEdit={setEdit} />}

    <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
      {photo.original && (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { onRevert(photo.id); onClose(); }}>
          <Undo2 />Back to the original photo
        </Button>
      )}
      <div className="ml-auto flex gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        {step === 'shape'
          ? <Button onClick={() => setStep('colour')}>Next: colour<ArrowRight /></Button>
          : <Button variant="outline" onClick={() => setStep('shape')}><ArrowLeft />Straighten</Button>}
        {step === 'colour' && <BusyButton busy={busy} icon={<Check />} onClick={apply}>Use this</BusyButton>}
      </div>
    </div>
  </>;
}

function lastPaper(): RatioId {
  try {
    const v = localStorage.getItem(PAPER_STORE);
    if (PAPER_RATIOS.some(r => r.id === v)) return v as RatioId;
  } catch { /* private mode */ }
  return 'auto';
}

/** The fitted size of a w × h image inside the element `ref`, leaving `pad` pixels all round. */
function useFit(ref: React.RefObject<HTMLElement | null>, w: number, h: number, pad: number) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  const s = box.w > 2 * pad && box.h > 2 * pad ? Math.min((box.w - 2 * pad) / w, (box.h - 2 * pad) / h) : 0;
  return { scale: s, w: Math.floor(w * s), h: Math.floor(h * s) };
}

/** The paper's corners in the original's pixels: found roughly on a small copy, then placed exactly on `view`. */
function findCorners(orig: Original, view: Pixels): Quad | null {
  const small = pixelsOf(orig.src, orig.w, orig.h, 500), rough = detectQuad(small);
  if (!rough) return null;
  const up = view.width / small.width, s = orig.w / view.width;
  return snapEdges(view, rough.map(p => ({ x: p.x * up, y: p.y * up })) as Quad).map(p => ({ x: p.x * s, y: p.y * s })) as Quad;
}

function ShapeStep({ orig, view, fix, set }: {
  orig: Original; view: Pixels; fix: Fix; set: (p: Partial<Fix>) => void;
}) {
  const area = useRef<HTMLDivElement>(null), loupe = useRef<HTMLCanvasElement>(null);
  const preview = useRef<HTMLCanvasElement>(null), previewArea = useRef<HTMLDivElement>(null);
  const pad = 28; // room around the photo, so the corners can be grabbed right at its edges
  const scale = useFit(area, orig.w, orig.h, pad).scale;
  const q = fix.quad ?? wholeImage(orig.w, orig.h);
  const [drag, setDrag] = useState<number | null>(null);
  const measured = fix.quad ? measureRatio(fix.quad, orig.w, orig.h) : orig.w / orig.h, papers = nearestPaper(measured);

  // The straightened result beside the photo, kept up to date as the corners move: a quick, smaller
  // version while dragging, then a sharp one when you let go.
  const ratio = fixRatio(fix, orig.w, orig.h);
  const shown = useFit(previewArea, ratio, 1, 16);
  const size = Math.max(shown.w, shown.h) * (typeof devicePixelRatio === 'number' ? Math.min(2, devicePixelRatio) : 1);
  useEffect(() => {
    if (!preview.current || !size) return;
    const id = requestAnimationFrame(() => {
      const out = straightened(view, fix, orig.w, orig.h, Math.min(drag != null ? 500 : 1400, size));
      if (preview.current) toCanvas(out, preview.current);
    });
    return () => cancelAnimationFrame(id);
  }, [view, fix, orig, drag, size]);

  // The loupe: a close-up of the corner being dragged, from the full-size photo.
  useEffect(() => {
    const c = loupe.current;
    if (drag == null || !c) return;
    const ctx = c.getContext('2d')!, p = q[drag], span = 150 / (scale * 4);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(orig.src, p.x - span / 2, p.y - span / 2, span, span, 0, 0, c.width, c.height);
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(c.width / 2, 0); ctx.lineTo(c.width / 2, c.height); ctx.moveTo(0, c.height / 2); ctx.lineTo(c.width, c.height / 2); ctx.stroke();
  });

  function toPhoto(e: React.PointerEvent): Pt {
    const r = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / scale) - pad / scale, y = ((e.clientY - r.top) / scale) - pad / scale;
    return { x: Math.max(0, Math.min(orig.w, x)), y: Math.max(0, Math.min(orig.h, y)) };
  }
  const grab = useRef({ dx: 0, dy: 0 });
  function down(e: React.PointerEvent, k: number) {
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = toPhoto(e);
    grab.current = { dx: q[k].x - p.x, dy: q[k].y - p.y };
    setDrag(k);
  }
  function move(e: React.PointerEvent, k: number) {
    if (drag !== k) return;
    const p = toPhoto(e), next = [...q] as Quad;
    next[k] = { x: Math.max(0, Math.min(orig.w, p.x + grab.current.dx)), y: Math.max(0, Math.min(orig.h, p.y + grab.current.dy)) };
    set({ quad: next });
  }
  function nudge(e: React.KeyboardEvent, k: number) {
    const step = (e.shiftKey ? 10 : 1) / scale, d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const next = [...q] as Quad;
    next[k] = { x: Math.max(0, Math.min(orig.w, q[k].x + d[0] * step)), y: Math.max(0, Math.min(orig.h, q[k].y + d[1] * step)) };
    set({ quad: next });
  }

  /** Runs the corner finding again, from scratch. */
  function findAgain() {
    const q = findCorners(orig, view);
    if (!q) {
      toast('Couldn’t find the paper’s edges', { description: 'Drag the four corners onto the corners of your print instead.' });
      return;
    }
    set({ quad: q, trim: Math.max(fix.trim, DEFAULT_FIX.trim), ratio: fix.quad ? fix.ratio : lastPaper() });
  }

  const W = orig.w * scale, H = orig.h * scale;
  const pts = q.map(p => `${pad + p.x * scale},${pad + p.y * scale}`).join(' ');
  const r = 11, leftHalf = drag != null && q[drag].x < orig.w / 2;
  const names = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

  return (
    <div className="grid min-h-0 flex-1 md:grid-cols-[1fr_1fr_290px]">
      <div ref={area} className="relative grid min-h-[35vh] place-items-center overflow-hidden bg-muted/60">
        <span className="pointer-events-none absolute top-2 left-2 z-10 rounded bg-black/60 px-2 py-0.5 text-xs text-white">Your photo · drag the corners</span>
        {scale > 0 && (
          <div className="relative" style={{ width: W + 2 * pad, height: H + 2 * pad }}>
            <canvas ref={el => { if (el && el.width !== view.width) toCanvas(view, el); }} className="absolute" style={{ left: pad, top: pad, width: W, height: H }} />
            <svg className="absolute inset-0 touch-none select-none" width={W + 2 * pad} height={H + 2 * pad}>
              <path d={`M${pad},${pad}h${W}v${H}h${-W}Z M${pts.split(' ').join(' L')}Z`} fillRule="evenodd" fill="rgb(0 0 0 / 0.45)" />
              <polygon points={pts} fill="none" stroke="#22d3ee" strokeWidth={1.5} />
              {q.map((p, k) => (
                <circle
                  key={k} cx={pad + p.x * scale} cy={pad + p.y * scale} r={r} tabIndex={0} role="slider"
                  aria-label={`${names[k]} corner (arrow keys to nudge)`} aria-valuetext={`${Math.round(p.x)}, ${Math.round(p.y)}`}
                  className="cursor-grab fill-cyan-400/25 stroke-cyan-300 outline-none focus-visible:stroke-white active:cursor-grabbing"
                  strokeWidth={2}
                  onPointerDown={e => down(e, k)} onPointerMove={e => move(e, k)}
                  onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)} onKeyDown={e => nudge(e, k)}
                />
              ))}
            </svg>
          </div>
        )}
        {drag != null && (
          <canvas ref={loupe} width={150} height={150} className={cn('pointer-events-none absolute top-9 size-[150px] rounded-full border-2 border-cyan-300 shadow-lg', leftHalf ? 'right-3' : 'left-3')} />
        )}
      </div>

      <div ref={previewArea} className="relative grid min-h-[35vh] place-items-center overflow-hidden border-t bg-muted/60 md:border-t-0 md:border-l">
        <span className="pointer-events-none absolute top-2 left-2 z-10 rounded bg-black/60 px-2 py-0.5 text-xs text-white">Straightened &amp; cropped</span>
        {shown.w > 0 && <canvas ref={preview} className="shadow-md" style={{ width: shown.w, height: shown.h }} />}
      </div>

      <aside className="overflow-y-auto border-t p-4 md:border-t-0 md:border-l">
        <Tip>
          {fix.quad
            ? <>Drag the four corners on the left onto the corners of your print (a close-up appears as you drag; arrow keys nudge a selected corner). The photo is squared up from them, so it doesn’t matter how it was tilted.</>
            : <>Using the whole photo, as for a scan. To straighten a photo of a print, use <b>Find the corners</b>, or drag the four corners onto the print’s corners.</>}
        </Tip>

        <SubHeading>Paper size</SubHeading>
        <Select value={fix.ratio} onValueChange={v => set({ ratio: v as RatioId })} disabled={!fix.quad}>
          <SelectTrigger className="w-full" aria-label="Paper size"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAPER_RATIOS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Tip className="mt-1.5">
          {fix.quad
            ? <>Measured from the corners: 1 : {(Math.max(measured, 1 / measured)).toFixed(3)}{papers.length > 0 && <> (close to {papers.map(p => p.label).join(', ')})</>}. Pick your paper size to get its shape exactly.</>
            : <>The whole photo keeps its own shape.</>}
        </Tip>

        <SliderRow
          label="Trim the edges" value={fix.trim} min={0} max={0.05} step={0.001} def={fix.quad ? DEFAULT_FIX.trim : 0}
          format={v => `${(v * 100).toFixed(1)}%`} onChange={v => set({ trim: v })}
          hint="Cuts a little off every side, to lose a sliver of table along the edge or the paper's brushed border."
        />

        <div className="mt-2 grid gap-1">
          <Button variant="outline" size="sm" onClick={() => fix.quad && set({ quad: turnQuad(fix.quad) })} disabled={!fix.quad}>
            <RotateCw />Turn a quarter turn
          </Button>
          <Button variant="outline" size="sm" onClick={findAgain}><ScanSearch />Find the corners</Button>
          {fix.quad && <Button variant="ghost" size="sm" onClick={() => set({ quad: null, trim: 0, ratio: 'auto' })}><Maximize />Use the whole photo (a scan)</Button>}
        </div>
        <Tip className="mt-3">Check the result in the middle: there should be no table along its edges. Then go on to the colour.</Tip>
      </aside>
    </div>
  );
}

function ColourStep({ base, edit, setEdit }: { base: Pixels | null; edit: Edit; setEdit: (p: Partial<Edit>) => void }) {
  const area = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const fit = useFit(area, base?.width ?? 1, base?.height ?? 1, 12);
  const [compare, setCompare] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!base || !canvas.current) return;
    const id = requestAnimationFrame(() => { if (canvas.current) toCanvas(compare ? base : applyEdit(base, edit), canvas.current); });
    return () => cancelAnimationFrame(id);
  }, [base, edit, compare]);

  function pick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!picking || !base) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * base.width), y = Math.round(((e.clientY - r.top) / r.height) * base.height);
    setEdit({ white: whiteAt(base, edit, x, y) });
    setPicking(false);
  }
  function auto() {
    if (!base) return;
    const e = autoEdit(pixelsOf(toCanvas(base), base.width, base.height, 600));
    setEdit(e);
  }

  return (
    <div className="grid min-h-0 flex-1 md:grid-cols-[1fr_290px]">
      <div ref={area} className="relative grid min-h-[45vh] place-items-center overflow-hidden bg-muted/60">
        {base && fit.scale > 0 && (
          <canvas
            ref={canvas} onClick={pick}
            className={cn('shadow-md', picking && 'cursor-crosshair')}
            style={{ width: fit.w, height: fit.h }}
          />
        )}
        {compare && <span className="absolute top-3 left-3 rounded bg-black/60 px-2 py-0.5 text-xs text-white">Before</span>}
      </div>

      <aside className="overflow-y-auto border-t p-4 md:border-t-0 md:border-l">
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" onClick={auto}><Wand2 />Auto</Button>
          <Button variant="outline" size="sm" onClick={() => setEdit({ ...NO_EDIT, light: edit.light })}><RotateCcw />Reset</Button>
          <Button
            variant={picking ? 'default' : 'outline'} size="sm" onClick={() => setPicking(p => !p)}
            title="Click a spot of bare paper to make it the white"
          ><Pipette />{picking ? 'Click the paper' : 'Pick the paper'}</Button>
          <Button
            variant="outline" size="sm" className="select-none"
            onPointerDown={() => setCompare(true)} onPointerUp={() => setCompare(false)} onPointerLeave={() => setCompare(false)}
            onKeyDown={e => e.key === ' ' && setCompare(true)} onKeyUp={() => setCompare(false)}
          >Hold: before</Button>
        </div>
        <Tip className="mt-2">
          Auto evens out the light, makes the bare paper white and sets the deepest blue. If the paper still looks tinted,
          use <b>Pick the paper</b> and click a spot of unexposed paper. Double-click a slider to reset it.
        </Tip>

        <SubHeading>Light</SubHeading>
        <SliderRow
          label="Even out the light" value={edit.flatten} min={0} max={1} step={0.01} def={edit.light ? 1 : 0}
          format={v => (edit.light ? `${Math.round(v * 100)}%` : 'n/a')} onChange={v => setEdit({ flatten: v })}
          hint={edit.light ? 'Brightens the parts of the paper that were in shade when you took the photo.' : 'Auto found too little bare paper to measure the light by.'}
        />
        <SliderRow label="Exposure" value={edit.exposure} min={-1.5} max={1.5} step={0.01} def={0} format={v => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV`} onChange={v => setEdit({ exposure: v })} />
        <SliderRow label="Contrast" value={edit.contrast} min={-1} max={1} step={0.01} def={0} format={signed} onChange={v => setEdit({ contrast: v })} />
        <SliderRow label="Highlights" value={edit.highlights} min={-1} max={1} step={0.01} def={0} format={signed} onChange={v => setEdit({ highlights: v })} />
        <SliderRow label="Shadows" value={edit.shadows} min={-1} max={1} step={0.01} def={0} format={signed} onChange={v => setEdit({ shadows: v })} />

        <SubHeading>Colour</SubHeading>
        <SliderRow label="Warmth" value={edit.warmth} min={-1} max={1} step={0.01} def={0} format={signed} onChange={v => setEdit({ warmth: v })} hint="Left is cooler and bluer, right warmer and yellower." />
        <SliderRow label="Tint" value={edit.tint} min={-1} max={1} step={0.01} def={0} format={signed} onChange={v => setEdit({ tint: v })} hint="Left is greener, right more magenta." />
        <SliderRow label="Saturation" value={edit.saturation} min={-1} max={1} step={0.01} def={0} format={signed} onChange={v => setEdit({ saturation: v })} />
        <SliderRow label="Black point" value={edit.black} min={0} max={90} step={1} def={0} format={v => String(Math.round(v))} onChange={v => setEdit({ black: v })} hint="Darkens the deepest tones. Phone photos lift the shadows a little; this takes it back out." />
      </aside>
    </div>
  );
}
