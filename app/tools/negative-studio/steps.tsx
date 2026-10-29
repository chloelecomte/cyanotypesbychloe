'use client';

// The sidebar: the five steps from photo to printable negative.
import { useId, useRef, useState } from 'react';
import {
  Crop as CropIcon, Download, FlipHorizontal2, ImagePlus, Printer, RotateCcw, RotateCw, Save, Sparkles, Trash2, Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { buildNegative, download, negativeName, pngWithDpi, printDims, printInWindow } from '@/lib/negative-studio/output';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/negative-studio/types';
import { cn } from '@/lib/utils';
import { BusyButton, Field, HelpTip, NumberField, SliderRow, SubHeading, Tip, useBusy } from './controls';
import { CurveEditor } from './curve-editor';
import { useStudio } from './use-studio';

const STEPS = ['open', 'crop', 'bw', 'neg', 'print'];

export function Steps() {
  return (
    <Accordion type="multiple" defaultValue={STEPS}>
      <Step value="open" n={1} title="Open a photo"><OpenStep /></Step>
      <Step value="crop" n={2} title="Crop & rotate"><CropStep /></Step>
      <Step value="bw" n={3} title="Black & white and tone"><ToneStep /></Step>
      <Step value="neg" n={4} title="Negative & curve"><CurveStep /></Step>
      <Step value="print" n={5} title="Print the negative"><PrintStep /></Step>
    </Accordion>
  );
}

function Step({ value, n, title, children }: { value: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <AccordionItem value={value} className="px-4">
      <AccordionTrigger className="py-3 hover:no-underline">
        <span className="flex items-center gap-2.5">
          <span className="grid size-5 place-items-center rounded-full bg-primary text-[11px] text-primary-foreground">{n}</span>
          {title}
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-4">{children}</AccordionContent>
    </AccordionItem>
  );
}

const IMAGE_TYPES = 'image/*,.tif,.tiff,.heic';

/** Opens the photo picker. Every chosen photo gets its own tab. */
export function usePhotoPicker() {
  const { openFiles } = useStudio();
  const input = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={input} type="file" accept={IMAGE_TYPES} multiple hidden
      onChange={e => { const files = [...(e.target.files ?? [])]; e.target.value = ''; openFiles(files); }}
    />
  );
  return [element, () => input.current?.click()] as const;
}

function OpenStep() {
  const { active } = useStudio();
  const [picker, pick] = usePhotoPicker();
  return (
    <>
      <button
        type="button" onClick={pick}
        className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-input px-4 py-5 text-center text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
      >
        <ImagePlus className="mb-1 size-6" />
        <span className="text-sm">Click to choose photos</span>
        <span className="text-xs">or drag them anywhere onto this window — each opens in its own tab</span>
      </button>
      {picker}
      <Tip className="mt-2 break-all">
        {active ? active.info : 'JPEG, PNG, WebP. TIFF and HEIC open in Safari. (RAW files: export a JPEG/TIFF from Lightroom first.)'}
      </Tip>
    </>
  );
}

// Values are width ÷ height. Each portrait ratio's landscape twin is listed as its reciprocal.
const PORTRAIT: [string, string][] = [
  ['0.8', '4:5 (8×10)'], ['0.75', '3:4 (6×8, 9×12, 12×16)'], ['0.7857', '11:14'], ['0.7333', '11:15'],
  ['0.7143', '5:7'], ['0.7071', 'A sizes (A4, A3…)'], ['0.6667', '2:3 (4×6, 8×12)'], ['0.5625', '9:16'],
];
const LANDSCAPE: [string, string][] = [
  ['1.25', '5:4 (10×8)'], ['1.3333', '4:3 (8×6, 12×9, 16×12)'], ['1.2727', '14:11'], ['1.3636', '15:11'],
  ['1.4', '7:5'], ['1.4142', 'A sizes, landscape'], ['1.5', '3:2 (6×4, 12×8)'], ['1.7778', '16:9'],
];

function CropStep() {
  const { settings, active, cropping, rotate, flipPhoto, setAspect, startCrop, finishCrop, resetCrop } = useStudio();
  const id = useId(), off = !active;
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" disabled={off} onClick={() => rotate(-1)}><RotateCcw />Rotate left</Button>
        <Button variant="outline" size="sm" disabled={off} onClick={() => rotate(1)}><RotateCw />Rotate right</Button>
        <Button variant="outline" size="sm" disabled={off} onClick={flipPhoto} title="Flip the photo itself (not the print mirror)"><FlipHorizontal2 />Flip</Button>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2">
        <Field label="Aspect ratio" htmlFor={id}>
          <Select value={settings.aspect} onValueChange={setAspect}>
            <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="orig">Original</SelectItem>
              <SelectItem value="1">Square 1:1</SelectItem>
              {([['Portrait', PORTRAIT], ['Landscape', LANDSCAPE]] as const).map(([label, items]) => (
                <SelectGroup key={label}>
                  <SelectSeparator />
                  <SelectLabel>{label}</SelectLabel>
                  {items.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex gap-1.5">
          <Button variant={cropping ? 'default' : 'outline'} disabled={off} onClick={cropping ? finishCrop : startCrop}><CropIcon />Crop</Button>
          <Button variant="ghost" disabled={off} onClick={resetCrop}>Reset</Button>
        </div>
      </div>
    </>
  );
}

const FILTERS: [string, Settings['bw']][] = [
  ['Neutral', { r: 30, g: 59, b: 11 }], ['Red', { r: 80, g: 20, b: 0 }], ['Orange', { r: 60, g: 35, b: 5 }],
  ['Yellow', { r: 45, g: 50, b: 5 }], ['Green', { r: 20, g: 70, b: 10 }], ['Blue', { r: 10, g: 20, b: 70 }],
];
const pct = (v: number) => Math.round(v) + '%', signed = (v: number) => (v > 0 ? '+' : '') + Math.round(v);
const TONE: [keyof Settings['tone'], string, number, number, number, (v: number) => string][] = [
  ['exposure', 'Exposure', -2, 2, 0.05, v => (v > 0 ? '+' : '') + v.toFixed(2) + ' EV'],
  ['contrast', 'Contrast', -100, 100, 1, signed],
  ['highlights', 'Highlights', -100, 100, 1, signed],
  ['shadows', 'Shadows', -100, 100, 1, signed],
  ['black', 'Black point', 0, 50, 1, v => String(Math.round(v))],
  ['white', 'White point', 50, 100, 1, v => String(Math.round(v))],
  ['mid', 'Midtones', 0.5, 2, 0.01, v => v.toFixed(2)],
];

function ToneStep() {
  const { settings: { bw, tone }, setBw, setTone, resetTone } = useStudio();
  return (
    <>
      <Tip>Like a coloured filter on a film camera: choose which colours become light or dark. <b>Red</b> darkens blue skies, <b>green</b> lightens foliage.</Tip>
      <div className="my-2.5 flex flex-wrap gap-1.5">
        {FILTERS.map(([name, f]) => {
          const on = f.r === bw.r && f.g === bw.g && f.b === bw.b;
          return <Button key={name} size="xs" variant={on ? 'default' : 'outline'} aria-pressed={on} onClick={() => setBw(f)}>{name}</Button>;
        })}
      </div>
      {(['r', 'g', 'b'] as const).map((k, i) => (
        <SliderRow key={k} label={['Red', 'Green', 'Blue'][i]} value={bw[k]} min={0} max={150} step={1} def={DEFAULT_SETTINGS.bw[k]}
          format={pct} onChange={v => setBw({ ...bw, [k]: v })} />
      ))}
      <SubHeading>Tone</SubHeading>
      <Tip>Make the black &amp; white look the way you want the final print to look. The negative curve (step 4) takes care of the cyanotype&apos;s quirks.</Tip>
      {TONE.map(([k, label, min, max, step, format]) => (
        <SliderRow key={k} label={label} value={tone[k]} min={min} max={max} step={step} def={DEFAULT_SETTINGS.tone[k]}
          format={format} onChange={v => setTone({ ...tone, [k]: v })} />
      ))}
      <Button variant="outline" size="xs" className="mt-2" onClick={resetTone}>Reset tone</Button>
    </>
  );
}

function CurveStep() {
  const s = useStudio(), { settings, profiles, profile, curves } = s;
  const profileId = useId(), curvesId = useId(), positiveId = useId();
  const [savedId, setSavedId] = useState('');
  const curveFile = useRef<HTMLInputElement>(null);
  const [madeForPositive, setMadeForPositive] = useState(false);

  const meta = (() => {
    if (!profile?.calibration) return '';
    const mins = profile.calibration.exposureSeconds ?? profile.exposureSeconds;
    return [profile.paper, profile.lightSource, profile.sensitizer, profile.rinse && `rinse: ${profile.rinse}`, mins != null ? `${+(mins / 60).toFixed(1)} min` : null,
      `calibrated ${new Date(profile.calibration.measuredAt).toLocaleDateString()}`,
      profile.calibrationCount > 1 ? `${profile.calibrationCount} calibrations` : null].filter(Boolean).join(' · ');
  })();
  const curveLabel = (id: string) => {
    const c = curves.find(c => c.id === id), p = c?.profileId && profiles.find(p => p.id === c.profileId);
    return c ? c.name + (p ? ` · ${p.name}` : '') : '';
  };

  return (
    <>
      <Tip>Cyanotype only reproduces part of the tonal range of an uncorrected negative — the lightest and darkest tones merge. The curve stretches your tones to fit. Check the <b>Cyanotype</b> view and the strip at the bottom.</Tip>
      <Field label="Process profile" htmlFor={profileId} className="mt-3" help={<>
        <h4>Process profile</h4>
        <p>The process the preview and the auto-fit curve are based on.</p>
        <p><b>Generic cyanotype</b> is an estimate of a typical print, which you can nudge with the two sliders below it.</p>
        <p>After you calibrate (the gauge button at the top), your measured profile appears in this list. It replaces the estimate, so the sliders go away: your own prints answer those questions.</p>
      </>}>
        <Select value={settings.profile} onValueChange={s.selectProfile}>
          <SelectTrigger id={profileId} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="model">Generic cyanotype (estimate)</SelectItem>
            {profiles.filter(p => p.calibration).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      {meta && <Tip className="mt-1.5">{meta}</Tip>}
      {profile?.calibration && profile.notes && <Tip className="mt-1 whitespace-pre-line">{profile.notes}</Tip>}
      {settings.profile === 'model' && (
        <div className="mt-3">
          <div className="flex items-center gap-1">
            <SubHeading className="m-0">Generic estimate</SubHeading>
            <HelpTip label="About the generic estimate sliders"><ModelHelp /></HelpTip>
          </div>
          <SliderRow
            label="Print exposure" value={settings.model.exposure} min={-2} max={2} step={0.1} def={0}
            format={v => v === 0 ? 'normal' : (v > 0 ? '+' : '') + v.toFixed(1) + ' stops'}
            onChange={v => s.setModel({ ...settings.model, exposure: v })}
            hint="Longer exposure than standard makes everything darker and pushes highlight detail out of reach"
          />
          <SliderRow
            label="Tonal range of the process" value={settings.model.range} min={0.4} max={1} step={0.01} def={0.75}
            format={v => '≈ ' + Math.round(v * 21) + ' of 21 steps'}
            onChange={v => s.setModel({ ...settings.model, range: v })}
            hint="How many steps of an uncorrected 21-step tablet show as distinct tones in your prints"
          />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" onClick={s.fitCurve} title="Build the curve that makes the predicted print match your black & white"><Sparkles />Auto-fit curve</Button>
        <Button size="sm" variant="outline" onClick={s.linearCurve} title="No correction: a plain inverted image">Linear</Button>
      </div>
      <CurveEditor />
      <Tip className="mt-2">Click to add a point, drag to move, double-click (or drag off the box) to remove. The faint bars show where your photo&apos;s tones sit.</Tip>

      <SubHeading>My curves</SubHeading>
      <div className="flex gap-1.5">
        <Select value={savedId} onValueChange={id => { setSavedId(id); s.loadSavedCurve(id); }}>
          <SelectTrigger id={curvesId} aria-label="My curves" className="min-w-0 flex-1">
            <SelectValue placeholder={curves.length ? 'Load a saved curve' : 'No saved curves yet'}>{curveLabel(savedId)}</SelectValue>
          </SelectTrigger>
          <SelectContent>{curves.map(c => <SelectItem key={c.id} value={c.id}>{curveLabel(c.id)}</SelectItem>)}</SelectContent>
        </Select>
        <SaveCurveButton defaultName={profile?.name || 'My cyanotype curve'} onSaved={setSavedId} />
        <Button variant="outline" size="icon" aria-label="Delete the selected curve" title="Delete the selected curve" disabled={!savedId}
          onClick={async () => { if (await s.deleteCurve(savedId)) setSavedId(''); }}><Trash2 /></Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" onClick={s.exportAcv} title="Photoshop curve file, applied after inverting"><Download />Export .acv</Button>
        <Button variant="outline" size="sm" onClick={() => curveFile.current?.click()}><Upload />Import .acv / .cube…</Button>
        <input ref={curveFile} type="file" accept=".acv,.cube,.txt,.csv" hidden
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) s.importCurve(f, madeForPositive); }} />
      </div>
      <CheckRow id={positiveId} checked={madeForPositive} onChange={setMadeForPositive}>
        Imported curve was made for the positive (applied before inverting, as in EDN)
      </CheckRow>
    </>
  );
}

function ModelHelp() {
  return <>
    <h4>Print exposure</h4>
    <p>How your exposure compares with your <b>standard printing time</b>: the shortest time that turns clear film fully blue. &ldquo;Normal&rdquo; assumes you print at that time.</p>
    <p>Move it <b>up</b> if you expose longer, for example on a very sunny day or with a longer timer. The whole print darkens and the palest highlights pick up blue, so the auto-fit curve adds ink there to keep them white. Move it <b>down</b> if you expose for less: shadows then stop reaching full blue.</p>
    <h4>Tonal range of the process</h4>
    <p>How many of the 21 steps of an uncorrected (linear) step tablet print as different tones. Cyanotype only shows part of that range; the default assumes about 16.</p>
    <p><b>Lower</b> it if your prints look harsh, with highlights blown out to paper white and shadows blocked up into solid blue. The curve then squeezes your photo&apos;s tones into a narrower band. <b>Raise</b> it if prints look flat. If you&apos;ve printed a linear tablet, count its distinct steps and use that.</p>
    <h4>Why change them</h4>
    <p>They get the preview and the curve closer to your real prints before you calibrate. They only affect the preview and the auto-fit curve: if you&apos;ve edited the curve by hand, click <b>Auto-fit curve</b> to apply them.</p>
  </>;
}

function SaveCurveButton({ defaultName, onSaved }: { defaultName: string; onSaved: (id: string) => void }) {
  const { saveCurve } = useStudio();
  const [open, setOpen] = useState(false), [name, setName] = useState(defaultName), [saving, setSaving] = useState(false);
  const id = useId();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const saved = await saveCurve(name.trim());
    setSaving(false);
    if (saved) { onSaved(saved.id); setOpen(false); toast.success(`Saved “${saved.name}”`); }
  }
  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (o) setName(defaultName); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Save this curve" title="Save this curve"><Save /></Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <form onSubmit={submit} className="grid gap-3">
          <Field label="Name for this curve" htmlFor={id}>
            <Input id={id} value={name} onChange={e => setName(e.target.value)} autoFocus />
          </Field>
          <Button type="submit" size="sm" disabled={saving || !name.trim()}>Save curve</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function CheckRow({ id, checked, onChange, disabled, className, children }: {
  id: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={cn('mt-2.5 flex items-start gap-2', className)}>
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={v => onChange(v === true)} className="mt-0.5" />
      <Label htmlFor={id} className="text-[13px] leading-snug font-normal">{children}</Label>
    </div>
  );
}

function PrintStep() {
  const s = useStudio(), { settings: { print: p, bw }, active, luts, curve } = s;
  const ids = { width: useId(), dpi: useId(), border: useId(), type: useId(), mirror: useId(), tablet: useId(), corr: useId() };
  const [saving, runSave] = useBusy(), [printing, runPrint] = useBusy();
  const { wIn, hIn, Wpx, Hpx } = printDims(p, active), tw = wIn + 2 * p.border, th = hIn + 2 * p.border + (p.tablet ? 0.55 : 0);

  function savePng() {
    if (!active) return toast('Open a photo first.');
    runSave(async () => download(await pngWithDpi(buildNegative(active, p, bw, luts.neg, curve), +p.dpi), negativeName(active.name, p, active)));
  }
  function printNow() {
    if (!active) return toast('Open a photo first.');
    const win = window.open('', '_blank');
    if (!win) return toast.error('Allow pop-ups for this site to print.');
    runPrint(() => printInWindow(win, buildNegative(active, p, bw, luts.neg, curve), +p.dpi, 'Negative', '0.25in'));
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-x-2 gap-y-3">
        <Field label="Image width (inches)" htmlFor={ids.width}>
          <NumberField id={ids.width} min={1} max={40} step={0.25} value={p.width} onChange={width => s.setPrint({ width })} />
        </Field>
        <Field label="Resolution" htmlFor={ids.dpi}>
          <Select value={String(p.dpi)} onValueChange={v => s.setPrint({ dpi: +v })}>
            <SelectTrigger id={ids.dpi} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{[300, 360, 600, 720].map(d => <SelectItem key={d} value={String(d)}>{d} dpi</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Border (inches)" htmlFor={ids.border}>
          <NumberField id={ids.border} min={0} max={3} step={0.125} value={p.border} onChange={border => s.setPrint({ border })} />
        </Field>
        <Field label="Border type" htmlFor={ids.type}>
          <Select value={p.borderType} onValueChange={v => s.setPrint({ borderType: v as typeof p.borderType })}>
            <SelectTrigger id={ids.type} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="black">Black → white paper edge</SelectItem>
              <SelectItem value="clear">Clear → blue edge</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Tip className="mt-2.5">
        {active ? <>
          Image {wIn.toFixed(2)} × {hIn.toFixed(2)} in ({(wIn * 2.54).toFixed(1)} × {(hIn * 2.54).toFixed(1)} cm) · {Wpx} × {Hpx} px<br />
          Whole negative incl. border{p.tablet ? ' & tablet' : ''}: {tw.toFixed(2)} × {th.toFixed(2)} in
        </> : 'Open a photo to see print sizes.'}
      </Tip>
      <CheckRow id={ids.mirror} checked={p.mirror} onChange={mirror => s.setPrint({ mirror })}>Mirror (flip) for printing — ink side touches the paper</CheckRow>
      <CheckRow id={ids.tablet} checked={p.tablet} onChange={tablet => s.setPrint({ tablet })}>Add a 21-step tablet below the image</CheckRow>
      <CheckRow id={ids.corr} checked={p.tabletCorr} onChange={tabletCorr => s.setPrint({ tabletCorr })} disabled={!p.tablet} className="pl-6">
        Apply the curve to the tablet (prints as even steps when calibrated)
      </CheckRow>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <BusyButton busy={saving} icon={<Download />} onClick={savePng}>Save negative (PNG)</BusyButton>
        <BusyButton busy={printing} icon={<Printer />} variant="outline" onClick={printNow}>Print…</BusyButton>
      </div>
      <Tip className="mt-3">
        <b>Printing tips:</b> print on inkjet transparency film, on the rough (coated) side. Use your printer&apos;s best quality, <b>colour</b> mode (not greyscale), and turn colour management off (&ldquo;Printer manages colours&rdquo; or &ldquo;No colour adjustment&rdquo;). Always print negatives with the same settings you used for your calibration tablet. Let the ink dry before contact printing.
      </Tip>
    </>
  );
}
