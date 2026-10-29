'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Download, FileImage, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  drawCalChart, drawScan, loadScan, orderReadings, sampleScan, summarizeReadings, type Readings, type Scan,
} from '@/lib/negative-studio/canvas';
import { lstar } from '@/lib/negative-studio/math';
import {
  bandName, download, fmtMin, MAX_BANDS, parseSheetTimes, pngWithDpi, printInWindow, sheetCanvas, sheetName,
  sheetSchedule, tabletCanvas, type SheetSize,
} from '@/lib/negative-studio/output';
import { isLinear, LINEAR } from '@/lib/negative-studio/pipeline';
import { BusyButton, Field, useBusy } from './controls';
import { useStudio } from './use-studio';

const TIMES_HINT = 'Enter one or more exposure times in minutes, e.g. 5, 10, 15, 20.';

export function CalibrationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const s = useStudio(), { profiles, settings, curve, profile } = s;
  // Kept while the dialog is closed, so a half-finished calibration isn't lost.
  const [timesText, setTimesText] = useState('5, 10, 15, 20'), [size, setSize] = useState<SheetSize>('letter');
  const [readings, setReadings] = useState<Readings | null>(null);
  const [target, setTarget] = useState('new');
  const [fields, setFields] = useState({ name: '', paper: '', lightSource: '', sensitizer: '', printerFilm: '', rinse: '', notes: '', exposure: '', conditions: '' });
  const [saving, setSaving] = useState(false);
  const [sheetBusy, runSheet] = useBusy(), [printBusy, runPrint] = useBusy();
  const ids = { times: useId(), size: useId(), target: useId(), name: useId(), paper: useId(), light: useId(), sens: useId(), printer: useId(), rinse: useId(), notes: useId(), exposure: useId(), cond: useId() };
  const field = (k: keyof typeof fields) => ({ value: fields[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields(f => ({ ...f, [k]: e.target.value })) });
  const text = (v: string) => v.trim() || null;

  const times = parseSheetTimes(timesText);
  const sheet = () => sheetCanvas(times!, size, curve, isLinear(settings.curve || LINEAR), profile?.name ?? 'Generic cyanotype');

  function saveSheet() {
    if (!times) return toast.error(TIMES_HINT);
    runSheet(async () => download(await pngWithDpi(sheet(), 300), sheetName(times)));
  }
  function printSheet() {
    if (!times) return toast.error(TIMES_HINT);
    const win = window.open('', '_blank');
    if (!win) return toast.error('Allow pop-ups for this site to print.');
    runPrint(() => printInWindow(win, sheet(), 300, 'Calibration sheet', '0'));
  }
  async function save() {
    if (!readings) return;
    setSaving(true);
    const ok = await s.saveCalibration(
      target === 'new'
        ? { kind: 'new', name: text(fields.name), paper: text(fields.paper), lightSource: text(fields.lightSource), sensitizer: text(fields.sensitizer), printerFilm: text(fields.printerFilm), rinse: text(fields.rinse), notes: text(fields.notes) }
        : { kind: 'retest', profileId: target },
      readings, fields.exposure ? parseFloat(fields.exposure) : null, text(fields.conditions),
    );
    setSaving(false);
    if (ok) { onOpenChange(false); toast.success('Calibration saved and in use'); }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (o) setTarget('new'); onOpenChange(o); }}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b py-4 pr-12 pl-6">
          <DialogTitle>Calibrate for your paper, chemistry and light</DialogTitle>
          <DialogDescription>
            The built-in &ldquo;Generic cyanotype&rdquo; profile is only an estimate. Cyanotype results vary a lot with paper, sensitizer, UV source, printer and film. A calibration measures <i>your</i> process once, so the curve and the preview match your real prints.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-6 overflow-y-auto px-6 py-5 text-[13px] leading-relaxed text-foreground/85">
          <Section n={1} title="Print the calibration sheet">
            <p>One full page of film with a band for each exposure time. Every band has two 21-step tablets: a <b>linear</b> one (for calibrating) and one with your <b>current curve</b> (to check it — a good curve prints as even steps). It&apos;s already inverted and mirrored. Print it on transparency film at 100% scale, with exactly the settings you&apos;ll use for negatives.</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Exposure times (minutes)" htmlFor={ids.times}>
                <Input id={ids.times} value={timesText} onChange={e => setTimesText(e.target.value)} aria-invalid={!times} />
              </Field>
              <Field label="Film size" htmlFor={ids.size}>
                <Select value={size} onValueChange={v => setSize(v as SheetSize)}>
                  <SelectTrigger id={ids.size} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="letter">US Letter (8.5 × 11 in)</SelectItem>
                    <SelectItem value="a4">A4 (210 × 297 mm)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {!times ? <span className="text-warning">{TIMES_HINT}</span> : <>
                {times.length} band{times.length > 1 ? 's' : ''} ({times.map((t, i) => `${bandName(i)} = ${fmtMin(t)}`).join(', ')}).{' '}
                Start the clock with the sheet uncovered, then {sheetSchedule(times)}.
                {times.length === MAX_BANDS && ` At most ${MAX_BANDS} bands fit on a page.`}
              </>}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <BusyButton busy={sheetBusy} icon={<Download />} onClick={saveSheet}>Save calibration sheet</BusyButton>
              <BusyButton busy={printBusy} icon={<Printer />} variant="outline" onClick={printSheet}>Print sheet…</BusyButton>
              <span className="ml-2 text-xs text-muted-foreground">Single strips:</span>
              <Button variant="ghost" size="sm" onClick={async () => download(await pngWithDpi(tabletCanvas(curve, false), 300), 'step-tablet-21_linear_300dpi_mirrored.png')}>Linear</Button>
              <Button variant="ghost" size="sm" title="To check a finished calibration: should print as even steps"
                onClick={async () => download(await pngWithDpi(tabletCanvas(curve, true), 300), 'step-tablet-21_curve_300dpi_mirrored.png')}>Current curve</Button>
            </div>
          </Section>

          <Section n={2} title="Expose it and find your exposure time">
            <ol className="list-decimal space-y-1 pl-5">
              <li>Lay the film on the sensitized paper and expose the whole sheet. Each time on the list comes up, slide an opaque card down to the next marked line (the ticks in the margins), covering one more band. The top band gets the shortest time, the bottom band the longest.</li>
              <li>Develop and dry fully — cyanotype darkens as it dries.</li>
              <li>In the <b>linear</b> rows, compare the last few patches (19–21, clearest film) from band to band. They get darker with time, then stop. Pick the <b>shortest</b> time at which they&apos;re as dark as in the longer bands, while patches 1–2 stay paper white. A shorter band whose last patches have merged into a <i>lighter</i> blue is underexposed. Longer bands that are no darker only cost you highlights. This &ldquo;standard printing time&rdquo; idea is how Christina Z. Anderson approaches it in her cyanotype and digital-negative books.</li>
              <li>From now on always use that time, paper and chemistry.</li>
            </ol>
            <p className="mt-2">Don&apos;t worry if only a handful of linear patches differ before they all turn full blue. That&apos;s normal before calibrating, and it&apos;s what the curve corrects. Don&apos;t shorten the exposure to stretch the row out.</p>
            <p className="mt-2 text-xs text-muted-foreground">
              <b className="text-foreground">Whites tinted blue or lavender?</b> If patches 1–2 and the margins are tinted by about the same amount in every band, the cause is probably chemistry or paper, not exposure. Common causes are paper fogged by light while coating or drying, old sensitizer (it should be yellow-green), a short wash, or alkaline paper or water. An acidic first bath (a splash of vinegar or citric acid) helps. To check, coat a strip and develop one piece without exposing it. If that piece is tinted, it isn&apos;t your film.
            </p>
          </Section>

          <Section n={3} title="Read your print">
            <p>Scan the dry print on a flatbed with colour correction off (a photo works only in very even light). Then click patch 1 and patch 21 of the <b>linear</b> row in the band you picked. Patch 1 is the lightest, patch 21 the darkest.</p>
            <Tabs defaultValue="scan" className="mt-3">
              <TabsList>
                <TabsTrigger value="scan">From a scan</TabsTrigger>
                <TabsTrigger value="type">Type values</TabsTrigger>
              </TabsList>
              <TabsContent value="scan"><ScanReader onReadings={setReadings} /></TabsContent>
              <TabsContent value="type"><TypedReadings onReadings={setReadings} /></TabsContent>
            </Tabs>
            <CalChart readings={readings} />
            <ReadingsSummary readings={readings} />
          </Section>

          <Section n={4} title="Save it">
            <Field label="Save to" htmlFor={ids.target}>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger id={ids.target} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">A new process profile</SelectItem>
                  {profiles.map(p => <SelectItem key={p.id} value={p.id}>Re-test of “{p.name}” (keeps the history)</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            {target === 'new' && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Profile name" htmlFor={ids.name} className="col-span-2"><Input id={ids.name} placeholder="e.g. Arches Platine · sunlight" {...field('name')} /></Field>
                <Field label="Paper" htmlFor={ids.paper}><Input id={ids.paper} placeholder="e.g. Arches Platine" {...field('paper')} /></Field>
                <Field label="Light source" htmlFor={ids.light}><Input id={ids.light} placeholder="e.g. sunlight, UV lightbox 365 nm" {...field('lightSource')} /></Field>
                <Field label="Sensitizer" htmlFor={ids.sens}><Input id={ids.sens} placeholder="e.g. classic 2-part" {...field('sensitizer')} /></Field>
                <Field label="Printer & film" htmlFor={ids.printer}><Input id={ids.printer} placeholder="e.g. Epson P700 · Pictorico" {...field('printerFilm')} /></Field>
                <Field label="Rinse" htmlFor={ids.rinse} className="col-span-2"><Input id={ids.rinse} placeholder="e.g. water only, 5 min · vinegar first bath, then water · citric acid" {...field('rinse')} /></Field>
                <Field label="Notes" htmlFor={ids.notes} className="col-span-2"><Textarea id={ids.notes} placeholder="Anything else about developing: coating, drying, toning, what you'd change next time…" {...field('notes')} /></Field>
              </div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Exposure of the band you read (minutes)" htmlFor={ids.exposure}><Input id={ids.exposure} type="number" min={0} step={0.5} {...field('exposure')} /></Field>
              <Field label="Conditions" htmlFor={ids.cond}><Input id={ids.cond} placeholder="e.g. clear sky, noon, July" {...field('conditions')} /></Field>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button onClick={save} disabled={!readings || saving}>Save &amp; use</Button>
              <Button variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={s.deleteProfile}><Trash2 />Delete selected profile</Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">To check it, print a new sheet with times around your standard time (e.g. 9, 10, 11). The <b>current curve</b> rows should now step evenly from white to deep blue.</p>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="grid size-5 place-items-center rounded-full bg-primary text-[11px] text-primary-foreground">{n}</span>{title}
      </h3>
      {children}
    </section>
  );
}

function ScanReader({ onReadings }: { onReadings: (r: Readings) => void }) {
  const [scan, setScan] = useState<Scan | null>(null), [clicks, setClicks] = useState<{ x: number; y: number }[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null), file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (scan) drawScan(canvas.current!, scan, clicks); }, [scan, clicks]);

  async function choose(f: File) {
    try { setScan(await loadScan(f)); setClicks([]); }
    catch { toast.error("Couldn't open that scan", { description: 'Try a JPEG or PNG.' }); }
  }
  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!scan) return;
    const c = e.currentTarget, r = c.getBoundingClientRect();
    const p = { x: (e.clientX - r.left) / r.width * c.width, y: (e.clientY - r.top) / r.height * c.height };
    const next = clicks.length >= 2 ? [p] : [...clicks, p];
    setClicks(next);
    if (next.length === 2) onReadings(orderReadings(sampleScan(scan, next, lstar)));
  }
  const msg = ['Click the centre of patch 1 (lightest).', 'Now click the centre of patch 21 (darkest).', 'Done — click again to start over.'][Math.min(2, clicks.length)];

  return (
    <div className="pt-2">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => file.current?.click()}><FileImage />Choose scan…</Button>
        {scan && <span className="text-xs text-muted-foreground">{msg}</span>}
        <input ref={file} type="file" accept="image/*,.tif,.tiff" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) choose(f); }} />
      </div>
      {scan && <canvas ref={canvas} onClick={onClick} className="mt-2 block max-w-full cursor-crosshair rounded-md bg-[#111]" aria-label="Your scan: click patch 1, then patch 21" />}
    </div>
  );
}

function TypedReadings({ onReadings }: { onReadings: (r: Readings) => void }) {
  const [text, setText] = useState('');
  function use() {
    const vals = text.split(/[\s,;]+/).filter(Boolean).map(Number).filter(isFinite);
    if (vals.length !== 21) return toast.error(`Enter exactly 21 numbers (found ${vals.length}).`);
    onReadings(orderReadings({ L: vals, colors: null }));
  }
  return (
    <div className="grid gap-2 pt-2">
      <p className="text-xs text-muted-foreground">Enter 21 readings from patch 1 (lightest) to 21 (darkest), separated by commas or spaces. Use Lab &ldquo;L&rdquo; values (0–100) or grey values (0–255) from an eyedropper.</p>
      <Textarea value={text} onChange={e => setText(e.target.value)} placeholder="94, 93, 91, 88, 84, 79, …" aria-label="Readings" />
      <Button variant="outline" size="sm" className="justify-self-start" onClick={use}>Use these values</Button>
    </div>
  );
}

function CalChart({ readings }: { readings: Readings | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => drawCalChart(canvas.current!, readings), [readings]);
  return <canvas ref={canvas} width={1600} height={340} className="mt-3 block h-[170px] w-full rounded-md bg-[#121417]" aria-label="Your readings compared with an even tablet" />;
}

function ReadingsSummary({ readings }: { readings: Readings | null }) {
  if (!readings) return <p className="mt-2 text-xs text-muted-foreground">No readings yet. The dashed line is a perfectly even tablet.</p>;
  const r = summarizeReadings(readings);
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      Your print shows <b className="text-foreground">{r.distinct}</b> distinct tones out of 21. Tones start separating at patch {r.first} and reach full blue at patch {r.last}.
      {r.shortRange && <span className="text-warning"> That&apos;s a short tonal range. If patches 1–2 are paper white and a shorter time didn&apos;t reach the same deep blue, it isn&apos;t overexposure: your film only holds back UV under heavy ink, and the curve will spread the tones out. If patches 1–2 are tinted, try a shorter time.</span>}
      {r.underexposed && <span className="text-warning"> Many light patches stay white — the print may be underexposed.</span>}
    </p>
  );
}
