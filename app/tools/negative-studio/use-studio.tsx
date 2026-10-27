'use client';

// All of the studio's state, and every change to it. Components read it through useStudio().
// Image processing stays in the browser; photos are never uploaded. Only settings, profiles and
// curves go to Supabase through `repo`.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Autosaver, type SaveStatus } from '@/lib/negative-studio/autosave';
import {
  buildLuts, fitAspect, grayIndex, histogram, orientedCanvas, previewPixels, type Crop, type Readings, type Source,
} from '@/lib/negative-studio/canvas';
import { decodeAcv, encodeAcv, normalizeImportedCurve, parseLutText } from '@/lib/negative-studio/files';
import type { Pt, RGB } from '@/lib/negative-studio/math';
import { download, type Photo } from '@/lib/negative-studio/output';
import {
  curveFn, fitCurve as fitCurveFor, LINEAR, readingsToDarkness, responseFn as responseFor, toneFn as toneFor,
} from '@/lib/negative-studio/pipeline';
import type { NewCalibration, Repo } from '@/lib/negative-studio/repo';
import {
  DEFAULT_SETTINGS, mergeSettings, type Profile, type SavedCurve, type Settings, type StudioData, type StudioUser,
} from '@/lib/negative-studio/types';
import { useConfirm } from './confirm';

// The photo keys of `settings` belong to the active tab; the other tabs keep their own copy.
const PHOTO_KEYS = ['aspect', 'bw', 'tone', 'curve', 'curveAuto', 'print'] as const;
type PhotoSettings = Pick<Settings, typeof PHOTO_KEYS[number]>;
const photoSettings = (s: Settings) => structuredClone(Object.fromEntries(PHOTO_KEYS.map(k => [k, s[k]]))) as PhotoSettings;

export type Tab = Photo & { id: number; name: string; info: string; settings: PhotoSettings };

type State = {
  settings: Settings;
  profiles: Profile[];
  curves: SavedCurve[];
  tabs: Tab[];
  activeId: number | null;
  /** The crop being drawn, while crop mode is on. */
  cropDraft: Crop | null | undefined;
  nextId: number;
};

export type CalibrationTarget = { kind: 'new'; name: string | null; paper: string | null; lightSource: string | null; sensitizer: string | null; printerFilm: string | null } | { kind: 'retest'; profileId: string };

const calibrated = (profiles: Profile[], id: string) => id === 'model' ? null : profiles.find(p => p.id === id && p.calibration) ?? null;
const refit = (s: Settings, profiles: Profile[]): Settings =>
  ({ ...s, curve: fitCurveFor(responseFor(calibrated(profiles, s.profile)?.calibration ?? null, s.model)), curveAuto: true });

/** Leaves the active tab: its settings and crop go back into the tab list. */
function stash(st: State): Tab[] {
  return st.tabs.map(t => t.id !== st.activeId ? t
    : { ...t, settings: photoSettings(st.settings), crop: st.cropDraft !== undefined ? st.cropDraft : t.crop });
}
function activateState(st: State, id: number | null): Partial<State> {
  const tabs = stash(st), next = tabs.find(t => t.id === id) ?? null;
  let settings = st.settings;
  if (next) {
    settings = { ...settings, ...structuredClone(next.settings) };
    // The process profile is shared, so it may have changed since this tab was last shown.
    if (settings.curveAuto || !settings.curve) settings = refit(settings, st.profiles);
  }
  return { tabs, activeId: next?.id ?? null, settings, cropDraft: undefined };
}

function initialState(data: StudioData): State {
  let settings = mergeSettings(data.settings);
  if (!calibrated(data.profiles, settings.profile)) settings.profile = 'model';
  if (!settings.curve) settings = refit(settings, data.profiles);
  return { settings, profiles: data.profiles, curves: data.curves, tabs: [], activeId: null, cropDraft: undefined, nextId: 1 };
}

function useStudioState({ user, data, repo }: { user: StudioUser; data: StudioData; repo: Repo }) {
  const confirm = useConfirm();
  const [st, setSt] = useState(() => initialState(data));
  const set = (fn: (st: State) => Partial<State>) => setSt(s => ({ ...s, ...fn(s) }));
  const setSettings = (fn: (s: Settings, st: State) => Partial<Settings>) => set(st => ({ settings: { ...st.settings, ...fn(st.settings, st) } }));
  const { settings, profiles, tabs, activeId, cropDraft } = st;

  // ---------- Cloud saving ----------
  const [status, setStatus] = useState<SaveStatus>({ kind: 'ok', text: 'Saved to your account' });
  const [saver] = useState(() => new Autosaver(st.settings, s => repo.saveSettings(s), setStatus));
  useEffect(() => saver.update(settings), [saver, settings]);
  useEffect(() => {
    // Best effort: write pending changes when the tab is hidden or closed.
    const onHide = () => { if (document.visibilityState === 'hidden') saver.flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); saver.dispose(); };
  }, [saver]);
  // Something like a delete or a new profile: tell the user if the cloud call fails.
  async function cloud<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
    setStatus({ kind: 'busy', text: 'Saving…' });
    try { const r = await fn(); setStatus({ kind: 'ok', text: 'Saved' }); return r; }
    catch (e) { setStatus({ kind: 'err', text: 'Not saved' }); toast.error(`Couldn't ${what}`, { description: (e as Error).message }); return undefined; }
  }

  // ---------- Derived image data ----------
  const profile = useMemo(() => calibrated(profiles, settings.profile), [profiles, settings.profile]);
  const calibration = profile?.calibration ?? null;
  const response = useMemo(() => responseFor(calibration, settings.model), [calibration, settings.model]);
  const curve = useMemo(() => curveFn(settings.curve), [settings.curve]);
  const tone = useMemo(() => toneFor(settings.tone), [settings.tone]);
  const luts = useMemo(() => buildLuts(tone, curve, response, calibration), [tone, curve, response, calibration]);

  const active = tabs.find(t => t.id === activeId) ?? null;
  const src = active?.src ?? null, rot = active?.rot ?? 0, flip = active?.flip ?? false, crop = active?.crop ?? null;
  const cropping = cropDraft !== undefined;
  const preview = useMemo(() => src && previewPixels(src, { rot, flip }, crop), [src, rot, flip, crop]);
  const gidx = useMemo(() => preview && grayIndex(preview, settings.bw), [preview, settings.bw]);
  const oriented = useMemo(() => cropping && src ? orientedCanvas(src, { rot, flip }) : null, [cropping, src, rot, flip]);
  const hist = useMemo(() => gidx && histogram(gidx, tone), [gidx, tone]);

  // ---------- Photo tabs ----------
  async function loadFile(file: File) {
    let img: Source;
    try {
      try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch {
        img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
      }
    } catch {
      toast.error(`${file.name || 'This file'} couldn't be opened`, { description: 'Try exporting it as a JPEG, PNG or TIFF (TIFF works in Safari).' });
      return;
    }
    // A new photo starts from the current tab's edits, and opens after it.
    set(st => {
      const tabs = stash(st), at = st.activeId != null ? tabs.findIndex(t => t.id === st.activeId) + 1 : tabs.length;
      const tab: Tab = {
        id: st.nextId, src: img, name: (file.name || 'photo').replace(/\.[^.]+$/, ''), info: `${file.name || 'photo'} · ${img.width} × ${img.height} px`,
        rot: 0, flip: false, crop: fitAspect(null, st.settings.aspect, img, 0), settings: photoSettings(st.settings),
      };
      return { tabs: [...tabs.slice(0, at), tab, ...tabs.slice(at)], activeId: tab.id, nextId: st.nextId + 1, cropDraft: undefined };
    });
  }
  async function openFiles(files: File[]) {
    for (const f of files) await loadFile(f);
  }
  function closeTab(id: number) {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    set(st => {
      const i = st.tabs.findIndex(t => t.id === id);
      const patch = id === st.activeId ? activateState(st, (st.tabs[i + 1] ?? st.tabs[i - 1])?.id ?? null) : {};
      return { ...patch, tabs: (patch.tabs ?? st.tabs).filter(t => t.id !== id) };
    });
    if ('close' in tab.src) tab.src.close();
  }
  // Bitmaps are released when the studio goes away.
  const tabsRef = useRef(tabs);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => () => { for (const t of tabsRef.current) if ('close' in t.src) t.src.close(); }, []);

  // ---------- Crop & orientation ----------
  function rotate(quarterTurns: 1 | -1) {
    set(st => {
      const t = st.tabs.find(t => t.id === st.activeId); if (!t) return {};
      const rot = (t.rot + quarterTurns + 4) % 4, crop = fitAspect(null, st.settings.aspect, t.src, rot);
      return { tabs: st.tabs.map(x => x === t ? { ...t, rot, crop } : x), cropDraft: st.cropDraft === undefined ? undefined : crop };
    });
  }
  function flipPhoto() {
    const mirror = (c: Crop | null) => c && { ...c, x: 1 - c.x - c.w };
    set(st => ({
      tabs: st.tabs.map(t => t.id === st.activeId ? { ...t, flip: !t.flip, crop: mirror(t.crop) } : t),
      cropDraft: st.cropDraft === undefined ? undefined : mirror(st.cropDraft),
    }));
  }
  function setAspect(aspect: string) {
    set(st => {
      const t = st.tabs.find(t => t.id === st.activeId), settings = { ...st.settings, aspect };
      if (!t) return { settings };
      if (st.cropDraft !== undefined) return { settings, cropDraft: fitAspect(st.cropDraft, aspect, t.src, t.rot) };
      return { settings, tabs: st.tabs.map(x => x === t ? { ...t, crop: fitAspect(t.crop, aspect, t.src, t.rot) } : x) };
    });
  }
  const startCrop = () => set(st => ({ cropDraft: st.tabs.find(t => t.id === st.activeId)?.crop ?? null }));
  function finishCrop() {
    set(st => st.cropDraft === undefined ? {} : {
      tabs: st.tabs.map(t => t.id === st.activeId ? { ...t, crop: st.cropDraft ?? null } : t), cropDraft: undefined,
    });
  }
  function resetCrop() {
    set(st => {
      const t = st.tabs.find(t => t.id === st.activeId); if (!t) return {};
      const c = fitAspect(null, st.settings.aspect, t.src, t.rot);
      return st.cropDraft !== undefined ? { cropDraft: c } : { tabs: st.tabs.map(x => x === t ? { ...t, crop: c } : x) };
    });
  }
  const setCropDraft = (c: Crop | null) => set(() => ({ cropDraft: c }));

  // ---------- Curve ----------
  const fitCurve = () => setSettings((s, st) => refit(s, st.profiles));
  const linearCurve = () => setSettings(() => ({ curve: LINEAR.map(p => [...p] as Pt), curveAuto: false }));
  const setCurvePoints = (curve: Pt[]) => setSettings(() => ({ curve, curveAuto: false }));
  /** Changes the generic process model; an auto-fitted curve follows it. */
  const setModel = (model: Settings['model']) =>
    setSettings((s, st) => { const n = { ...s, model }; return n.curveAuto ? refit(n, st.profiles) : n; });
  // Remembers the curve per profile, so coming back to a profile restores a hand-tuned curve.
  function selectProfile(id: string) {
    setSettings((s, st) => {
      const curveByProfile = { ...s.curveByProfile, [s.profile]: { curve: s.curve, curveAuto: s.curveAuto } };
      const n = { ...s, profile: id, curveByProfile }, saved = curveByProfile[id];
      return saved && saved.curve && !saved.curveAuto ? { ...n, curve: structuredClone(saved.curve), curveAuto: false } : refit(n, st.profiles);
    });
  }
  const exportAcv = () => download(new Blob([encodeAcv(settings.curve || LINEAR)]), 'cyanotype-negative-curve.acv');
  async function importCurve(file: File, madeForPositive: boolean) {
    try {
      const pts = /\.acv$/i.test(file.name) ? decodeAcv(await file.arrayBuffer()) : parseLutText(await file.text());
      setCurvePoints(normalizeImportedCurve(pts, madeForPositive));
    } catch { toast.error("Couldn't read that curve file", { description: 'Supported: Photoshop .acv and 1D LUT .cube files.' }); }
  }
  function loadSavedCurve(id: string) {
    const c = st.curves.find(c => c.id === id);
    if (c) setCurvePoints(structuredClone(c.points));
  }
  async function saveCurve(name: string) {
    const saved = await cloud('save the curve', () => repo.createCurve({ name, points: settings.curve || LINEAR, profileId: profile?.id ?? null }));
    if (saved) set(st => ({ curves: [...st.curves, saved] }));
    return saved;
  }
  async function deleteCurve(id: string) {
    const c = st.curves.find(c => c.id === id);
    if (!c || !await confirm({ title: `Delete the curve “${c.name}”?`, action: 'Delete', destructive: true })) return false;
    if (!await cloud('delete the curve', () => repo.deleteCurve(id).then(() => true))) return false;
    set(st => ({ curves: st.curves.filter(x => x.id !== id) }));
    return true;
  }

  // ---------- Calibration ----------
  async function saveCalibration(target: CalibrationTarget, readings: Readings, exposureMinutes: number | null, conditions: string | null) {
    const exposureSeconds = exposureMinutes != null && isFinite(exposureMinutes) && exposureMinutes >= 0 ? Math.round(exposureMinutes * 60) : null;
    const cal: NewCalibration = {
      darkness: readingsToDarkness(readings.L), colors: readings.colors,
      readingsLstar: readings.L.map(v => +v.toFixed(2)), exposureSeconds, conditions,
    };
    let updated: Profile | undefined;
    if (target.kind === 'new') {
      updated = await cloud('save the profile', () => repo.createProfile({
        name: target.name || `Calibration ${new Date().toLocaleDateString()}`, paper: target.paper, lightSource: target.lightSource,
        sensitizer: target.sensitizer, printerFilm: target.printerFilm, exposureSeconds,
      }, cal));
    } else {
      const p = profiles.find(p => p.id === target.profileId)!;
      const c = await cloud('save the calibration', () => repo.addCalibration(p.id, cal));
      if (c) updated = { ...p, calibration: c, calibrationCount: p.calibrationCount + 1 };
    }
    if (!updated) return false;
    const u = updated;
    set(st => {
      const profiles = st.profiles.some(p => p.id === u.id) ? st.profiles.map(p => p.id === u.id ? u : p) : [...st.profiles, u];
      const s = st.settings, curveByProfile = { ...s.curveByProfile, [s.profile]: { curve: s.curve, curveAuto: s.curveAuto } };
      return { profiles, settings: refit({ ...s, profile: u.id, curveByProfile }, profiles) };
    });
    return true;
  }
  async function deleteProfile() {
    const p = profile;
    if (!p) { toast('Select a calibrated profile in step 4 first.'); return; }
    const history = p.calibrationCount > 1 ? ` and all ${p.calibrationCount} of its calibrations` : '';
    if (!await confirm({ title: `Delete the profile “${p.name}”${history}?`, description: 'Curves saved with it are kept.', action: 'Delete profile', destructive: true })) return;
    if (!await cloud('delete the profile', () => repo.deleteProfile(p.id).then(() => true))) return;
    set(st => {
      const profiles = st.profiles.filter(x => x.id !== p.id);
      const curveByProfile = { ...st.settings.curveByProfile }; delete curveByProfile[p.id];
      return {
        profiles, curves: st.curves.map(c => c.profileId === p.id ? { ...c, profileId: null } : c),
        settings: refit({ ...st.settings, profile: 'model', curveByProfile }, profiles),
      };
    });
  }

  // ---------- Data from the previous, browser-only version ----------
  const legacyChecked = useRef(false);
  useEffect(() => {
    if (legacyChecked.current) return;
    legacyChecked.current = true;
    const flag = 'cns.imported.' + user.id;
    const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem('cns.' + k); return v ? JSON.parse(v) : d; } catch { return d; } };
    if (read<string | null>('imported.' + user.id, null)) return;
    const cals = read<{ name: string; ds: number[]; colors: RGB[] | null }[]>('calibrations', [])
      .filter(c => c && Array.isArray(c.ds) && c.ds.length === 21);
    const legacyCurves = read<{ name: string; curve: Pt[] }[]>('curves', []).filter(c => c && Array.isArray(c.curve));
    const legacyState = data.settings ? null : read<Record<string, unknown> | null>('state', null);
    if (!cals.length && !legacyCurves.length && !legacyState) return;
    const what = [cals.length && `${cals.length} calibration${cals.length > 1 ? 's' : ''}`, legacyCurves.length && `${legacyCurves.length} curve${legacyCurves.length > 1 ? 's' : ''}`, legacyState && 'your settings']
      .filter(Boolean).join(', ');
    const remember = (v: string) => { try { localStorage.setItem(flag, JSON.stringify(v)); } catch { /* private mode */ } };
    (async () => {
      if (!await confirm({
        title: 'Copy your earlier data to your account?', action: 'Copy to my account', cancel: 'Not now',
        description: `This browser has ${what} from the earlier version of Negative Studio.`,
      })) return remember('declined');
      const ids: Record<string, string> = {}, newProfiles: Profile[] = [], newCurves: SavedCurve[] = [];
      const ok = await cloud('import your saved data', async () => {
        for (const [i, c] of cals.entries()) {
          const p = await repo.createProfile(
            { name: String(c.name || `Calibration ${i + 1}`).slice(0, 200), paper: null, lightSource: null, sensitizer: null, printerFilm: null, exposureSeconds: null },
            { darkness: c.ds, colors: Array.isArray(c.colors) && c.colors.length === 21 ? c.colors : null, readingsLstar: null, exposureSeconds: null, conditions: null },
          );
          newProfiles.push(p); ids['cal:' + i] = p.id;
        }
        for (const c of legacyCurves) newCurves.push(await repo.createCurve({ name: String(c.name || 'Imported curve').slice(0, 200), points: c.curve, profileId: null }));
        return true;
      });
      if (!ok) return;
      remember('done');
      set(st => {
        const profiles = [...st.profiles, ...newProfiles];
        let settings = st.settings;
        if (legacyState) {
          settings = mergeSettings(legacyState);
          settings.profile = ids[settings.profile] ?? 'model';
          settings.curveByProfile = {};
        }
        if (!settings.curve) settings = refit(settings, profiles);
        return { profiles, curves: [...st.curves, ...newCurves], settings };
      });
    })();
    // Runs once, on the data the page was loaded with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    user, status, settings, profiles, curves: st.curves, tabs, active, cropping, cropDraft,
    profile, calibration, response, curve, tone, luts, preview, gidx, oriented, hist,
    setSettings, setBw: (bw: Settings['bw']) => setSettings(() => ({ bw })),
    setTone: (tone: Settings['tone']) => setSettings(() => ({ tone })),
    resetTone: () => setSettings(() => ({ tone: structuredClone(DEFAULT_SETTINGS.tone) })),
    setPrint: (p: Partial<Settings['print']>) => setSettings(s => ({ print: { ...s.print, ...p } })),
    setView: (view: Settings['view']) => setSettings(() => ({ view })),
    setSplit: (split: number) => setSettings(() => ({ split })),
    openFiles, activate: (id: number) => set(st => id === st.activeId ? {} : activateState(st, id)), closeTab,
    rotate, flipPhoto, setAspect, startCrop, finishCrop, resetCrop, setCropDraft,
    fitCurve, linearCurve, setCurvePoints, setModel, selectProfile, exportAcv, importCurve, loadSavedCurve, saveCurve, deleteCurve,
    saveCalibration, deleteProfile,
  };
}

export type Studio = ReturnType<typeof useStudioState>;
const StudioContext = createContext<Studio | null>(null);

export function StudioProvider({ user, data, repo, children }: { user: StudioUser; data: StudioData; repo: Repo; children: React.ReactNode }) {
  const studio = useStudioState({ user, data, repo });
  return <StudioContext.Provider value={studio}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const s = useContext(StudioContext);
  if (!s) throw new Error('useStudio must be used inside <StudioProvider>');
  return s;
}
