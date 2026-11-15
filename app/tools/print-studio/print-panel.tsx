'use client';

// Print Studio's settings: the photo, how the prints are arranged and sized, the crop, and export.
import { useId, useRef } from 'react';
import { Download, ImagePlus, RotateCcw, RectangleHorizontal, RectangleVertical } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { withPhys } from '@/lib/negative-studio/files';
import { download } from '@/lib/negative-studio/output';
import { NO_VIEW } from '@/lib/panels/geometry';
import { downloadAll, encode, renderPanel } from '@/lib/panels/panels';
import {
  ARRANGEMENTS, DPIS, drawPanel, effectivePpi, fittingDpi, jpegWithDpi, overallSize, panelPixels, printName, RATIOS, SIZES,
  type PrintDesign, type RatioId, type SizeId,
} from '@/lib/print-studio/print';
import { cn } from '@/lib/utils';
import { BusyButton, Field, NumberField, SliderRow, SubHeading, Tip, useBusy } from '../negative-studio/controls';
import type { PrintState } from './print-studio';

const onItem = 'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground';
const BORDER_COLORS = [['#ffffff', 'White'], ['#f4efe4', 'Paper'], ['#000000', 'Black']] as const;
const BLEEDS = [[0, 'None'], [0.125, '⅛ in · 3 mm'], [0.25, '¼ in · 6 mm']] as const;

/**
 * The largest canvas this browser will draw. Safari (and every browser on iPhone and iPad) stops at
 * 16.7 megapixels; the others go much higher.
 */
function canvasLimit() {
  const ua = navigator.userAgent;
  const webkit = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
  return webkit ? { area: 16_777_216, side: 16_384 } : { area: 268_435_456, side: 32_767 };
}

export function PrintPanel({ s }: { s: PrintState }) {
  const { design: d } = s;
  const input = useRef<HTMLInputElement>(null);
  const u = d.unit === 'cm' ? 2.54 : 1;
  const ids = { w: useId(), h: useId(), gap: useId(), border: useId(), cont: useId() };
  const landscape = d.w > d.h, square = Math.abs(d.w - d.h) < 1e-6;
  // Lengths are stored in inches and shown in the chosen unit, rounded for typing.
  const shown = (inches: number) => +(inches * u).toFixed(2);
  const fromShown = (v: number) => v / u;

  function pickSize(id: SizeId) {
    if (id === 'custom') return s.update({ size: 'custom' });
    const p = SIZES.find(x => x.id === id)!;
    const [w, h] = landscape ? [Math.max(p.w, p.h), Math.min(p.w, p.h)] : [p.w, p.h];
    s.update({ size: id, w, h });
  }

  return (
    <div className="p-4">
      <SubHeading className="mt-0">Photo</SubHeading>
      <input ref={input} type="file" accept="image/*" hidden onChange={e => { s.open(e.target.files?.[0]); e.target.value = ''; }} />
      {s.photo
        ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
            <img src={s.photo.thumb} alt="" className="size-12 rounded object-cover" />
            <div className="min-w-0 flex-1 text-xs">
              <div className="truncate text-foreground">{s.photo.name}</div>
              <div className="text-muted-foreground">{s.photo.w} × {s.photo.h} px · {(s.photo.w * s.photo.h / 1e6).toFixed(1)} MP</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => input.current?.click()}>Change</Button>
          </div>
        )
        : (
          <button type="button" onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-1 rounded-md border border-dashed py-6 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            <ImagePlus className="size-5" />Choose a photo, or drop it anywhere
          </button>
        )}

      <SubHeading>Arrangement</SubHeading>
      <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Arrangement">
        {ARRANGEMENTS.map(a => {
          const on = d.cols === a.cols && d.rows === a.rows;
          return (
            <button
              key={a.id} type="button" role="radio" aria-checked={on} onClick={() => s.update({ cols: a.cols, rows: a.rows })}
              className={cn('flex flex-col items-center gap-1 rounded-md border py-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground', on && 'border-primary bg-primary/15 text-foreground')}
            >
              <span className="grid h-6 place-items-center">
                <span className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${a.cols}, 7px)` }}>
                  {Array.from({ length: a.cols * a.rows }, (_, i) => <span key={i} className="block h-[9px] border border-current" />)}
                </span>
              </span>
              {a.label}
            </button>
          );
        })}
      </div>
      <SliderRow label="Across" value={d.cols} min={1} max={6} step={1} def={3} format={String} onChange={v => s.update({ cols: v })} />
      <SliderRow label="Down" value={d.rows} min={1} max={4} step={1} def={1} format={String} onChange={v => s.update({ rows: v })} />

      <SubHeading className="flex items-center">
        Size
        <ToggleGroup type="single" size="sm" className="ml-auto h-6" value={d.unit} onValueChange={v => v && s.update({ unit: v as 'in' | 'cm' })} aria-label="Units">
          <ToggleGroupItem value="in" className={cn('h-6 px-2 text-[11px] normal-case', onItem)}>in</ToggleGroupItem>
          <ToggleGroupItem value="cm" className={cn('h-6 px-2 text-[11px] normal-case', onItem)}>cm</ToggleGroupItem>
        </ToggleGroup>
      </SubHeading>
      <ToggleGroup
        type="single" variant="outline" size="sm" className="mb-2 w-full" value={d.sizing} aria-label="Size by"
        onValueChange={v => {
          if (v === 'print') s.update({ sizing: 'print', size: 'custom', w: d.w, h: d.h }); // keep the sizes worked out
          if (v === 'overall') {
            const c = s.layout.cover, reach = d.border > 0 ? 0 : d.bleed;
            s.update({ sizing: 'overall', side: 'h', length: +(c.h - 2 * reach).toFixed(2) });
          }
        }}
      >
        <ToggleGroupItem value="print" className={cn('flex-1 text-xs', onItem)}>Each print</ToggleGroupItem>
        <ToggleGroupItem value="overall" className={cn('flex-1 text-xs', onItem)}>Whole photo</ToggleGroupItem>
      </ToggleGroup>
      {d.sizing === 'overall' ? <OverallSize s={s} /> : <>
        <div className="flex gap-2">
          <Select value={d.size} onValueChange={v => pickSize(v as SizeId)}>
            <SelectTrigger className="flex-1" aria-label="Print size"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SIZES.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
              <SelectItem value="custom">Custom size…</SelectItem>
            </SelectContent>
          </Select>
          <ToggleGroup
            type="single" variant="outline" value={landscape ? 'l' : 'p'} disabled={square} aria-label="Orientation"
            onValueChange={v => { if (v && (v === 'l') !== landscape) s.update({ w: d.h, h: d.w }); }}
          >
            <ToggleGroupItem value="p" aria-label="Portrait" title="Portrait" className={onItem}><RectangleVertical /></ToggleGroupItem>
            <ToggleGroupItem value="l" aria-label="Landscape" title="Landscape" className={onItem}><RectangleHorizontal /></ToggleGroupItem>
          </ToggleGroup>
        </div>
        {d.size === 'custom' && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label={`Width (${d.unit})`} htmlFor={ids.w}><NumberField id={ids.w} step="0.1" value={shown(d.w)} onChange={v => v > 0 && s.update({ w: fromShown(v) })} /></Field>
            <Field label={`Height (${d.unit})`} htmlFor={ids.h}><NumberField id={ids.h} step="0.1" value={shown(d.h)} onChange={v => v > 0 && s.update({ h: fromShown(v) })} /></Field>
          </div>
        )}
      </>}

      {d.cols * d.rows > 1 && <>
        <SubHeading>On the wall</SubHeading>
        <Field
          label={`Space between prints (${d.unit})`} htmlFor={ids.gap}
          help={<><p>How far apart you’ll hang the prints, frames included if they’re framed.</p><p>With <b>the photo continues behind the gaps</b> on, the crop skips that space, so a horizon or a straight line stays straight from one print to the next. Turn it off to cut the photo into pieces edge to edge.</p></>}
        >
          <NumberField id={ids.gap} step="0.25" value={shown(d.gap)} onChange={v => s.update({ gap: fromShown(v) })} />
        </Field>
        <div className="mt-2 flex items-center gap-2">
          <Checkbox id={ids.cont} checked={d.continuous} onCheckedChange={v => s.update({ continuous: v === true })} />
          <Label htmlFor={ids.cont} className="text-xs font-normal">The photo continues behind the gaps</Label>
        </div>
      </>}

      <SubHeading>Border</SubHeading>
      <div className="flex items-end gap-3">
        <Field label={`Width (${d.unit})`} htmlFor={ids.border} className="w-24">
          <NumberField id={ids.border} step="0.125" value={shown(d.border)} onChange={v => s.update({ border: fromShown(v) })} />
        </Field>
        <div className="flex items-center gap-2 pb-1.5">
          {BORDER_COLORS.map(([c, name]) => (
            <button
              key={c} type="button" title={name} aria-label={`${name} border`} aria-pressed={d.borderColor === c}
              onClick={() => s.update({ borderColor: c })}
              className={cn('size-6 rounded-full border border-white/20', d.borderColor === c && 'ring-2 ring-primary ring-offset-2 ring-offset-card')}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      <Tip className="mt-1.5">Printed on every print, around the photo. Leave it at 0 if the prints will be matted or framed.</Tip>

      <SubHeading>Bleed</SubHeading>
      <ToggleGroup type="single" variant="outline" size="sm" className="w-full" value={String(d.bleed)} onValueChange={v => v && s.update({ bleed: +v })} aria-label="Bleed">
        {BLEEDS.map(([v, label]) => <ToggleGroupItem key={v} value={String(v)} className={cn('flex-1 text-xs', onItem)}>{label}</ToggleGroupItem>)}
      </ToggleGroup>
      <Tip className="mt-1.5">Extra photo past every edge, trimmed off by the lab. Only add it if your lab asks for bleed; most photo labs print to the exact size.</Tip>

      <CropControls s={s} />
      <ExportControls s={s} />
    </div>
  );
}

/**
 * Sizing by the whole photo: its shape and one side's length. Each print's size follows from the
 * arrangement, gaps and borders, so a 3:2 photo 54 in wide becomes three 18 × 36 in prints.
 */
function OverallSize({ s }: { s: PrintState }) {
  const { design: d, photo } = s;
  const ids = { w: useId(), h: useId() };
  const u = d.unit === 'cm' ? 2.54 : 1, shown = (inches: number) => +(inches * u).toFixed(2);
  const aspect = photo ? photo.w / photo.h : undefined, o = overallSize(d, aspect);
  const turnable = d.ratio !== 'photo' && d.ratio !== '1:1';
  const ratioLabel = (r: RatioId) => {
    if (r !== 'photo') return turnable && d.tall ? r.split(':').reverse().join(':') : r;
    return photo ? `Photo’s shape (${simpleRatio(photo.w, photo.h)})` : 'Photo’s shape';
  };
  const n = d.cols * d.rows;
  return <>
    <div className="flex gap-2">
      <Select value={d.ratio} onValueChange={v => s.update({ ratio: v as RatioId })}>
        <SelectTrigger className="flex-1" aria-label="Shape of the whole photo"><SelectValue /></SelectTrigger>
        <SelectContent>{RATIOS.map(r => <SelectItem key={r} value={r}>{ratioLabel(r)}</SelectItem>)}</SelectContent>
      </Select>
      <ToggleGroup type="single" variant="outline" value={d.tall ? 't' : 'w'} disabled={!turnable} aria-label="Orientation" onValueChange={v => v && s.update({ tall: v === 't' })}>
        <ToggleGroupItem value="t" aria-label="Tall" title="Tall" className={onItem}><RectangleVertical /></ToggleGroupItem>
        <ToggleGroupItem value="w" aria-label="Wide" title="Wide" className={onItem}><RectangleHorizontal /></ToggleGroupItem>
      </ToggleGroup>
    </div>
    <div className="mt-2 grid grid-cols-2 gap-2">
      <Field label={`Width (${d.unit})`} htmlFor={ids.w}><NumberField id={ids.w} step="0.5" value={shown(o.w)} onChange={v => v > 0 && s.update({ side: 'w', length: v / u })} /></Field>
      <Field label={`Height (${d.unit})`} htmlFor={ids.h}><NumberField id={ids.h} step="0.5" value={shown(o.h)} onChange={v => v > 0 && s.update({ side: 'h', length: v / u })} /></Field>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">
      {n > 1 ? `Each of the ${n} prints` : 'The print'}: <b className="font-medium text-foreground">{shown(d.w)} × {shown(d.h)} {d.unit}</b>
      {d.continuous && d.gap > 0 && n > 1 && <>, with the photo continuing behind the {shown(d.gap)} {d.unit} gaps</>}.
    </p>
    {!s.sizeOk && <Tip className="mt-1 text-amber-300">The gaps or borders are too wide for a photo this size; make it larger or the gaps smaller.</Tip>}
    {!photo && d.ratio === 'photo' && <Tip className="mt-1">Until you choose a photo, this assumes 3:2.</Tip>}
  </>;
}

/** A photo's shape as a small ratio, like 3:2, or to one decimal (1.78:1) when it isn't a simple one. */
function simpleRatio(w: number, h: number) {
  const r = Math.max(w, h) / Math.min(w, h);
  for (let b = 1; b <= 8; b++) {
    const a = Math.round(r * b);
    if (Math.abs(a / b - r) < 0.01) return w >= h ? `${a}:${b}` : `${b}:${a}`;
  }
  return w >= h ? `${r.toFixed(2)}:1` : `1:${r.toFixed(2)}`;
}

function CropControls({ s }: { s: PrintState }) {
  const { photo, placement, layout, view } = s;
  if (!photo || !placement) return null;
  const ppi = Math.round(effectivePpi(placement, layout));
  const quality = ppi >= 240
    ? { text: 'sharp, even up close', cls: 'text-emerald-400' }
    : ppi >= 150
      ? { text: 'fine from a normal viewing distance', cls: 'text-amber-300' }
      : { text: 'likely to look soft; try smaller prints or less zoom', cls: 'text-red-400' };
  return <>
    <SubHeading>Crop</SubHeading>
    <SliderRow label="Zoom" value={view.zoom} min={1} max={5} step={0.01} def={1} format={v => `${v.toFixed(2)}×`} onChange={v => s.setView(x => ({ ...x, zoom: v }))} />
    <Button variant="ghost" size="sm" onClick={() => s.setView(NO_VIEW)}><RotateCcw />Recenter</Button>
    <Tip>Drag the photo on the wall to choose what shows, and scroll to zoom.</Tip>
    <p className="mt-2 text-xs text-muted-foreground">
      Photo resolution: <b className="font-medium text-foreground">{ppi} ppi</b> at this size, <span className={quality.cls}>{quality.text}</span>.
    </p>
  </>;
}

function ExportControls({ s }: { s: PrintState }) {
  const { design: d, photo, placement, layout } = s;
  const [busy, run] = useBusy();
  const limit = canvasLimit(), dpi = fittingDpi(d, limit), px = panelPixels(d, dpi);
  const n = layout.jobs.length;

  async function makeFile(index: number) {
    if (!photo || !placement) throw new Error('Choose a photo first.');
    const job = layout.jobs[index];
    // The print, bleed included, at `dpi` pixels per inch; drawPanel's (0, 0) is the bleed's corner.
    const c = renderPanel({ x: d.bleed, y: d.bleed, w: d.w, h: d.h }, dpi, ctx => drawPanel(ctx, d, job, photo.full, placement), d.bleed);
    // A canvas past the browser's limit fails quietly, as transparent pixels; check before saving.
    if (c.getContext('2d')!.getImageData(c.width - 1, c.height - 1, 1, 1).data[3] === 0) {
      const size = `${c.width} × ${c.height}`;
      c.width = c.height = 0;
      throw new Error(`This browser couldn't make a ${size} px image. Try a lower dpi.`);
    }
    const bytes = new Uint8Array(await (await encode(c, d.type)).arrayBuffer());
    const blob = new Blob([d.type === 'jpeg' ? jpegWithDpi(bytes, dpi) : withPhys(bytes, dpi)], { type: `image/${d.type}` });
    return { blob, name: printName(photo.name, d, index, dpi) };
  }

  async function save(which: number[]) {
    const files = [];
    for (const i of which) files.push(await makeFile(i));
    await downloadAll(files, download);
    if (files.length > 1) toast.success(`Saved ${files.length} prints`);
  }

  return <>
    <SubHeading className="mt-5">Export</SubHeading>
    <div className="grid gap-2">
      <ToggleGroup type="single" variant="outline" size="sm" className="w-full" value={String(d.dpi)} onValueChange={v => v && s.update({ dpi: +v })} aria-label="Resolution">
        {DPIS.map(v => <ToggleGroupItem key={v} value={String(v)} className={cn('flex-1 text-xs', onItem)}>{v} dpi</ToggleGroupItem>)}
      </ToggleGroup>
      <ToggleGroup type="single" variant="outline" size="sm" className="w-full" value={d.type} onValueChange={v => v && s.update({ type: v as PrintDesign['type'] })} aria-label="File type">
        <ToggleGroupItem value="jpeg" className={cn('flex-1 text-xs', onItem)}>JPEG</ToggleGroupItem>
        <ToggleGroupItem value="png" className={cn('flex-1 text-xs', onItem)}>PNG</ToggleGroupItem>
      </ToggleGroup>
      <Tip>
        Each file: {px.w} × {px.h} px at {dpi} dpi, sRGB{d.bleed > 0 && ', bleed included'}. 300 dpi suits most labs; check yours for their preferred size and format.
      </Tip>
      {dpi < d.dpi && (
        <Tip className="text-amber-300">
          This browser can only make images up to {(limit.area / 1e6).toFixed(1)} megapixels, so these save at {dpi} dpi. Chrome or Firefox can save the full {d.dpi} dpi.
        </Tip>
      )}
      <BusyButton busy={busy} icon={<Download />} disabled={!photo} onClick={() => run(() => save(layout.jobs.map(j => j.index)))}>
        {n > 1 ? `Download ${n} prints` : 'Download print'}
      </BusyButton>
      {n > 1 && photo && (
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          Or just print
          {layout.jobs.map(j => (
            <Button key={j.index} variant="outline" size="sm" className="h-6 min-w-6 px-1.5" disabled={busy} onClick={() => run(() => save([j.index]))}>{j.index + 1}</Button>
          ))}
        </div>
      )}
    </div>
  </>;
}
