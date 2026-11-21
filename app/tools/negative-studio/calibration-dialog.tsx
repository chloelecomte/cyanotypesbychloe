'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Download, FileImage, Pencil, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  drawCalChart, drawScan, loadScan, orderReadings, sampleScan, sheetGrid, stripGrid, summarizeReadings,
  type PatchGrid, type Readings, type Scan,
} from '@/lib/negative-studio/canvas';
import { lstar } from '@/lib/negative-studio/math';
import {
  bandName, download, fmtMin, MAX_BANDS, parseSheetTimes, pngWithDpi, printInWindow, sheetCanvas, sheetLinearPatches,
  sheetName, sheetSchedule, tabletCanvas, type SheetSize,
} from '@/lib/negative-studio/output';
import { isLinear, LINEAR, suggestExposure } from '@/lib/negative-studio/pipeline';
import type { Profile } from '@/lib/negative-studio/types';
import { cn } from '@/lib/utils';
import { BusyButton, Field, useBusy } from './controls';
import { useStudio } from './use-studio';

const TIMES_HINT = 'Enter one or more exposure times in minutes, e.g. 5, 10, 15, 20.';

export function CalibrationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const s = useStudio(), { profiles, settings, curve, profile } = s;
  // Kept while the dialog is closed, so a half-finished calibration isn't lost.
  const [timesText, setTimesText] = useState('5, 10, 15, 20'), [size, setSize] = useState<SheetSize>('letter');
  const [readings, setReadings] = useState<Readings | null>(null);
  const [target, setTarget] = useState('new');
  const [details, setDetails] = useState(NO_DETAILS);
  const [fields, setFields] = useState({ exposure: '', conditions: '' });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheetBusy, runSheet] = useBusy(), [printBusy, runPrint] = useBusy();
  const ids = { times: useId(), size: useId(), target: useId(), exposure: useId(), cond: useId() };
  const field = (k: keyof typeof fields) => ({ value: fields[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFields(f => ({ ...f, [k]: e.target.value })) });

  const times = parseSheetTimes(timesText);
  const sheetSpec = useMemo(() => { const t = parseSheetTimes(timesText); return t && { times: t, size }; }, [timesText, size]);
  const takeReadings = (r: Readings, minutes?: number) => {
    setReadings(r);
    if (minutes !== undefined) setFields(f => ({ ...f, exposure: String(minutes) }));
  };
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
        ? { kind: 'new', ...detailsOut(details) }
        : { kind: 'retest', profileId: target },
      readings, fields.exposure ? parseFloat(fields.exposure) : null, fields.conditions.trim() || null,
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
              <li>In the <b>linear</b> rows, compare the last few patches (19–21, clearest film) from band to band. They get darker with time, then stop. Pick the <b>shortest</b> time at which they&apos;re as dark as in the longer bands, while patches 1–2 stay paper white. A shorter band whose last patches have merged into a <i>lighter</i> blue is underexposed. Longer bands that are no darker only cost you highlights. This &ldquo;standard printing time&rdquo; idea is how Christina Z. Anderson approaches it in her cyanotype and digital-negative books. Step 3 can measure this and suggest the time for you.</li>
              <li>From now on always use that time, paper and chemistry.</li>
            </ol>
            <p className="mt-2">Don&apos;t worry if only a handful of linear patches differ before they all turn full blue. That&apos;s normal before calibrating, and it&apos;s what the curve corrects. Don&apos;t shorten the exposure to stretch the row out.</p>
            <p className="mt-2 text-xs text-muted-foreground">
              <b className="text-foreground">Whites tinted blue or lavender?</b> If patches 1–2 and the margins are tinted by about the same amount in every band, the cause is probably chemistry or paper, not exposure. Common causes are paper fogged by light while coating or drying, old sensitizer (it should be yellow-green), a short wash, or alkaline paper or water. An acidic first bath (a splash of vinegar or citric acid) helps. To check, coat a strip and develop one piece without exposing it. If that piece is tinted, it isn&apos;t your film.
            </p>
          </Section>

          <Section n={3} title="Read your print">
            <p>Scan the dry print on a flatbed with colour correction off (a photo works only in very even light).</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li><b>Whole sheet:</b> click patch 1 of the top band&apos;s <b>linear</b> row and patch 21 of the bottom band&apos;s. The studio reads every band and suggests the exposure time.</li>
              <li><b>One row:</b> click patch 1 and patch 21 of the <b>linear</b> row in the band you picked. Patch 1 is the lightest, patch 21 the darkest.</li>
            </ul>
            <Tabs defaultValue="sheet" className="mt-3">
              <TabsList>
                <TabsTrigger value="sheet">Whole sheet</TabsTrigger>
                <TabsTrigger value="scan">One row</TabsTrigger>
                <TabsTrigger value="type">Type values</TabsTrigger>
              </TabsList>
              <TabsContent value="sheet">
                <p className="pt-2 text-xs text-muted-foreground">
                  {sheetSpec
                    ? <>Reading a {size === 'a4' ? 'A4' : 'US Letter'} sheet with {sheetSpec.times.length} band{sheetSpec.times.length > 1 ? 's' : ''} ({sheetSpec.times.map((t, i) => `${bandName(i)} = ${fmtMin(t)}`).join(', ')}). If your sheet had other times or another size, change them in step 1 first.</>
                    : <span className="text-warning">{TIMES_HINT} They must match the sheet you printed.</span>}
                </p>
                {sheetSpec && <ScanReader sheet={sheetSpec} onReadings={takeReadings} />}
              </TabsContent>
              <TabsContent value="scan"><ScanReader sheet={null} onReadings={takeReadings} /></TabsContent>
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
            {target === 'new' && <ProfileDetails value={details} onChange={setDetails} className="mt-3" />}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Exposure of the band you read (minutes)" htmlFor={ids.exposure}><Input id={ids.exposure} type="number" min={0} step={0.5} {...field('exposure')} /></Field>
              <Field label="Conditions" htmlFor={ids.cond}><Input id={ids.cond} placeholder="e.g. clear sky, noon, July" {...field('conditions')} /></Field>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button onClick={save} disabled={!readings || saving}>Save &amp; use</Button>
              {profile && <Button variant="ghost" className="ml-auto text-muted-foreground" onClick={() => setEditing(true)}><Pencil />Edit selected profile</Button>}
              <Button variant="ghost" className={cn('text-muted-foreground hover:text-destructive', !profile && 'ml-auto')} onClick={s.deleteProfile}><Trash2 />Delete selected profile</Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">To check it, print a new sheet with times around your standard time (e.g. 9, 10, 11). The <b>current curve</b> rows should now step evenly from white to deep blue.</p>
          </Section>
        </div>
        {profile && <EditProfileDialog profile={profile} open={editing} onOpenChange={setEditing} />}
      </DialogContent>
    </Dialog>
  );
}

type Details = { name: string; paper: string; lightSource: string; sensitizer: string; printerFilm: string; rinse: string; notes: string };
const NO_DETAILS: Details = { name: '', paper: '', lightSource: '', sensitizer: '', printerFilm: '', rinse: '', notes: '' };
const detailsIn = (p: Profile): Details => Object.fromEntries(Object.keys(NO_DETAILS).map(k => [k, p[k as keyof Details] ?? ''])) as Details;
const detailsOut = (d: Details) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.trim() || null])) as { [K in keyof Details]: string | null };
const minutes = (seconds: number | null) => seconds != null ? String(+(seconds / 60).toFixed(2)) : '';

/** Name, paper, chemistry and the rest of a profile's description. */
function ProfileDetails({ value, onChange, className }: { value: Details; onChange: (d: Details) => void; className?: string }) {
  const ids = { name: useId(), paper: useId(), light: useId(), sens: useId(), printer: useId(), rinse: useId(), notes: useId() };
  const field = (k: keyof Details) => ({ value: value[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value }) });
  return (
    <div className={cn('grid grid-cols-2 gap-3', className)}>
      <Field label="Profile name" htmlFor={ids.name} className="col-span-2"><Input id={ids.name} placeholder="e.g. Arches Platine · sunlight" {...field('name')} /></Field>
      <Field label="Paper" htmlFor={ids.paper}><Input id={ids.paper} placeholder="e.g. Arches Platine" {...field('paper')} /></Field>
      <Field label="Light source" htmlFor={ids.light}><Input id={ids.light} placeholder="e.g. sunlight, UV lightbox 365 nm" {...field('lightSource')} /></Field>
      <Field label="Sensitizer" htmlFor={ids.sens}><Input id={ids.sens} placeholder="e.g. classic 2-part" {...field('sensitizer')} /></Field>
      <Field label="Printer & film" htmlFor={ids.printer}><Input id={ids.printer} placeholder="e.g. Epson P700 · Pictorico" {...field('printerFilm')} /></Field>
      <Field label="Rinse" htmlFor={ids.rinse} className="col-span-2"><Input id={ids.rinse} placeholder="e.g. water only, 5 min · vinegar first bath, then water · citric acid" {...field('rinse')} /></Field>
      <Field label="Notes" htmlFor={ids.notes} className="col-span-2"><Textarea id={ids.notes} placeholder="Anything else about developing: coating, drying, toning, what you'd change next time…" {...field('notes')} /></Field>
    </div>
  );
}

/**
 * Edits a profile in place: its details, and its current calibration's readings, exposure and conditions.
 * A new scan replaces the readings instead of adding a re-test to the history.
 */
export function EditProfileDialog({ profile, open, onOpenChange }: { profile: Profile; open: boolean; onOpenChange: (open: boolean) => void }) {
  const s = useStudio(), cal = profile.calibration;
  const [details, setDetails] = useState(() => detailsIn(profile));
  const [exposure, setExposure] = useState(''), [conditions, setConditions] = useState('');
  const [readings, setReadings] = useState<Readings | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { exposure: useId(), cond: useId() };
  const current: Readings | null = cal?.readingsLstar ? { L: cal.readingsLstar, colors: cal.colors } : null;

  // Start from the saved values each time the dialog opens.
  const [shown, setShown] = useState(false);
  if (open !== shown) {
    setShown(open);
    if (open) {
      setDetails(detailsIn(profile)); setReadings(null);
      setExposure(minutes(cal?.exposureSeconds ?? profile.exposureSeconds)); setConditions(cal?.conditions ?? '');
    }
  }
  async function save() {
    if (!details.name.trim()) return toast.error('Give the profile a name.');
    setSaving(true);
    const ok = await s.editProfile(profile.id, { ...detailsOut(details), name: details.name.trim() }, readings,
      exposure ? parseFloat(exposure) : null, conditions.trim() || null);
    setSaving(false);
    if (ok) { onOpenChange(false); toast.success(readings ? 'Profile saved with the new readings' : 'Profile saved'); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b py-4 pr-12 pl-6">
          <DialogTitle>Edit “{profile.name}”</DialogTitle>
          <DialogDescription>
            Changes are made in place. To keep the old readings as history, use a re-test in the calibration window instead.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-6 overflow-y-auto px-6 py-5 text-[13px] leading-relaxed text-foreground/85">
          <ProfileDetails value={details} onChange={setDetails} />
          <section>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Calibration</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Exposure (minutes)" htmlFor={ids.exposure}><Input id={ids.exposure} type="number" min={0} step={0.5} value={exposure} onChange={e => setExposure(e.target.value)} /></Field>
              <Field label="Conditions" htmlFor={ids.cond}><Input id={ids.cond} placeholder="e.g. clear sky, noon, July" value={conditions} onChange={e => setConditions(e.target.value)} /></Field>
            </div>
            <p className="mt-3">
              {readings
                ? <>New readings, replacing the ones from {cal && new Date(cal.measuredAt).toLocaleDateString()}. <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setReadings(null)}>Keep the old ones</button></>
                : <>Rescanned the print, or clicked the wrong patches? Read a new scan to replace the readings from {cal && new Date(cal.measuredAt).toLocaleDateString()}.</>}
            </p>
            <Tabs defaultValue="scan" className="mt-2">
              <TabsList>
                <TabsTrigger value="scan">From a scan</TabsTrigger>
                <TabsTrigger value="type">Type values</TabsTrigger>
              </TabsList>
              <TabsContent value="scan"><ScanReader sheet={null} onReadings={r => setReadings(r)} /></TabsContent>
              <TabsContent value="type"><TypedReadings onReadings={setReadings} /></TabsContent>
            </Tabs>
            <CalChart readings={readings ?? current} />
            {readings || current
              ? <ReadingsSummary readings={readings ?? current} />
              : <p className="mt-2 text-xs text-muted-foreground">This profile was imported without its raw readings, so there&apos;s nothing to chart until you read a new scan.</p>}
          </section>
        </div>
        <div className="flex justify-end gap-2 border-t px-6 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{readings ? 'Save & refit' : 'Save'}</Button>
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

type SheetSpec = { times: number[]; size: SheetSize };
type OnReadings = (r: Readings, minutes?: number) => void;

/** Picks a scan; `sheet` reads every band of a calibration sheet, null reads a single row. */
function ScanReader({ sheet, onReadings }: { sheet: SheetSpec | null; onReadings: OnReadings }) {
  const [scan, setScan] = useState<Scan | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function choose(f: File) {
    try { setScan(await loadScan(f)); }
    catch { toast.error("Couldn't open that scan", { description: 'Try a JPEG or PNG.' }); }
  }
  return (
    <div className="pt-2">
      <Button variant="outline" size="sm" onClick={() => file.current?.click()}><FileImage />Choose scan…</Button>
      <input ref={file} type="file" accept="image/*,.tif,.tiff" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) choose(f); }} />
      {/* A new scan or a different sheet layout starts the clicks over */}
      {scan && <ScanClicks key={sheet ? `${sheet.times.join()}|${sheet.size}` : 'row'} scan={scan} sheet={sheet} onReadings={onReadings} />}
    </div>
  );
}

function ScanClicks({ scan, sheet, onReadings }: { scan: Scan; sheet: SheetSpec | null; onReadings: OnReadings }) {
  const [clicks, setClicks] = useState<{ x: number; y: number }[]>([]);
  const [result, setResult] = useState<{ grid: PatchGrid; readings: Readings[]; suggestion: ReturnType<typeof suggestExposure> | null } | null>(null);
  const [chosen, setChosen] = useState(-1);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => drawScan(canvas.current!, scan, clicks, result?.grid ?? null, chosen), [scan, clicks, result, chosen]);

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const c = e.currentTarget, r = c.getBoundingClientRect();
    const p = { x: (e.clientX - r.left) / r.width * c.width, y: (e.clientY - r.top) / r.height * c.height };
    const next = clicks.length >= 2 ? [p] : [...clicks, p];
    setClicks(next); setChosen(-1); setResult(null);
    if (next.length < 2) return;
    const grid = sheet ? sheetGrid(next, sheetLinearPatches(sheet.times.length, sheet.size)) : stripGrid(next);
    const readings = sampleScan(scan, grid, lstar).map(orderReadings);
    const suggestion = sheet ? suggestExposure(readings.map((rd, i) => ({ minutes: sheet.times[i], L: rd.L }))) : null;
    setResult({ grid, readings, suggestion });
    if (!sheet) onReadings(readings[0]);
    else if (suggestion!.pick >= 0) { setChosen(suggestion!.pick); onReadings(readings[suggestion!.pick], sheet.times[suggestion!.pick]); }
  }
  function choose(i: number) {
    setChosen(i);
    onReadings(result!.readings[i], sheet!.times[i]);
  }
  const msg = sheet
    ? ['Click the centre of patch 1 in band A’s linear row.', `Now click the centre of patch 21 in band ${bandName(sheet.times.length - 1)}’s linear row.`, 'Done — click again to start over.']
    : ['Click the centre of patch 1 (lightest).', 'Now click the centre of patch 21 (darkest).', 'Done — click again to start over.'];

  return (
    <>
      <p className="mt-2 text-xs text-muted-foreground">{msg[Math.min(2, clicks.length)]}</p>
      <canvas ref={canvas} onClick={onClick} className="mt-2 block max-w-full cursor-crosshair rounded-md bg-[#111]"
        aria-label={sheet ? 'Your scan: click patch 1 of the first band, then patch 21 of the last band' : 'Your scan: click patch 1, then patch 21'} />
      {result?.suggestion && <ExposureSuggestion suggestion={result.suggestion} readings={result.readings} chosen={chosen} onChoose={choose} />}
    </>
  );
}

function ExposureSuggestion({ suggestion: { rows, pick, tryLonger, tryShorter }, readings, chosen, onChoose }: {
  suggestion: ReturnType<typeof suggestExposure>; readings: Readings[]; chosen: number; onChoose: (i: number) => void;
}) {
  if (pick < 0) return (
    <p className="mt-2 text-xs text-warning">
      These rows don&apos;t look like the sheet&apos;s linear tablets. Check that the exposure times and film size in step 1 match the sheet you printed, then click patch 1 and patch 21 again.
    </p>
  );
  const best = rows[pick], picked = rows[chosen];
  return (
    <div className="mt-3 grid gap-2">
      <div className="grid gap-1" role="radiogroup" aria-label="Band to calibrate from">
        {rows.map((b, i) => (
          <button key={i} type="button" role="radio" aria-checked={i === chosen} onClick={() => onChoose(i)}
            className={`flex items-center gap-3 rounded-md border px-2 py-1.5 text-left text-xs ${i === chosen ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted'}`}>
            <span className="w-20 shrink-0 font-medium text-foreground">{bandName(i)} · {fmtMin(b.minutes)}</span>
            <span className="flex h-4 min-w-0 flex-1 overflow-hidden rounded-sm" aria-hidden>
              {readings[i].colors?.map((c, k) => <span key={k} className="flex-1" style={{ background: `rgb(${c})` }} />)}
            </span>
            <span className="w-28 shrink-0 text-muted-foreground">{b.atDmax ? 'reaches full blue' : 'lighter blue'}{b.tinted ? ' · tinted' : ''}</span>
            <span className="w-16 shrink-0 text-right">{i === pick && <Badge variant="outline" className="border-success/40 text-success">Suggested</Badge>}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Suggested: <b className="text-foreground">{fmtMin(best.minutes)}</b> (band {bandName(pick)}), the shortest time whose clearest patches (19–21) reach the deepest blue on the sheet.
        {pick < rows.length - 1 && ' Longer bands are no darker; they only cost highlights.'}
        {tryLonger && <span className="text-warning"> Only the longest band got there, so more time might still darken it. Print another sheet with longer times to be sure.</span>}
        {tryShorter && <span className="text-warning"> Even the shortest band got there, so a shorter time might too. Print another sheet with shorter times to be sure.</span>}
        {picked?.tinted && <span className="text-warning"> Patches 1–2 of band {bandName(chosen)} are tinted compared with the whitest band, so highlights may print slightly blue.</span>}
        {' '}The readings below are from band {bandName(chosen)}; click another band to use it instead.
      </p>
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
