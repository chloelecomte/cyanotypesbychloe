'use client';

// All of the studio's state, and every change to it. Components read it through useStudio().
// Image processing stays in the browser; photos are never uploaded. Only settings, profiles and
// curves go to Supabase through `repo`. Open photos are kept in this browser by `photo-store`.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Autosaver, type SaveStatus } from '@/lib/negative-studio/autosave';
import {
  buildLuts, fitAspect, grayIndex, histogram, orientedCanvas, previewPixels, type Crop, type Readings, type Source,
} from '@/lib/negative-studio/canvas';
import { decodeAcv, encodeAcv, normalizeImportedCurve, parseLutText } from '@/lib/negative-studio/files';
import type { Pt, RGB } from '@/lib/negative-studio/math';
import { download, type Photo } from '@/lib/negative-studio/output';
import { deleteFile, loadSession, saveFile, saveSession, type StoredSession } from '@/lib/negative-studio/photo-store';
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

/** A point to go back to: the editor settings and how the photo is turned and cropped. */
type Snapshot = { settings: Settings; photo: Pick<Photo, 'rot' | 'flip' | 'crop'> | null };
/** Undo history. Edits with the same key in quick succession (one slider drag) make one step. */
type History = { past: Snapshot[]; future: Snapshot[]; key: string; at: number };
const NO_HISTORY: History = { past: [], future: [], key: '', at: 0 };
const HISTORY_LIMIT = 100, COALESCE_MS = 1000;

/** `key` names the tab's file in the browser's photo store; `id` only lasts until the page is reloaded. */
export type Tab = Photo & { id: number; key: string; name: string; info: string; settings: PhotoSettings; history: History };

type State = {
  settings: Settings;
  profiles: Profile[];
  curves: SavedCurve[];
  tabs: Tab[];
  activeId: number | null;
  /** The crop being drawn, while crop mode is on. */
  cropDraft: Crop | null | undefined;
  /** The active tab's undo history; the other tabs keep their own. */
  history: History;
  nextId: number;
};

export type CalibrationTarget = { kind: 'new'; name: string | null; paper: string | null; lightSource: string | null; sensitizer: string | null; printerFilm: string | null; rinse: string | null; notes: string | null } | { kind: 'retest'; profileId: string };

const calibrated = (profiles: Profile[], id: string) => id === 'model' ? null : profiles.find(p => p.id === id && p.calibration) ?? null;
const refit = (s: Settings, profiles: Profile[]): Settings =>
  ({ ...s, curve: fitCurveFor(responseFor(calibrated(profiles, s.profile)?.calibration ?? null, s.model)), curveAuto: true });

/** Leaves the active tab: its settings and crop go back into the tab list. */
function stash(st: State): Tab[] {
  return st.tabs.map(t => t.id !== st.activeId ? t
    : { ...t, settings: photoSettings(st.settings), crop: st.cropDraft !== undefined ? st.cropDraft : t.crop, history: st.history });
}
function activateState(st: State, id: number | null): Partial<State> {
  const tabs = stash(st), next = tabs.find(t => t.id === id) ?? null;
  let settings = st.settings;
  if (next) {
    settings = { ...settings, ...structuredClone(next.settings) };
    // The process profile is shared, so it may have changed since this tab was last shown.
    if (settings.curveAuto || !settings.curve) settings = refit(settings, st.profiles);
  }
  return { tabs, activeId: next?.id ?? null, settings, cropDraft: undefined, history: next?.history ?? NO_HISTORY };
}

/** Every new photo starts from the default edits; the print setup (size, resolution, mirror…) carries over. */
function newPhotoSettings(st: State): Settings {
  const d = structuredClone(DEFAULT_SETTINGS);
  return refit({ ...st.settings, aspect: d.aspect, bw: d.bw, tone: d.tone }, st.profiles);
}

// Names some apps give files they hand over (Continuity Camera, pasted images) instead of a real file name.
const PLACEHOLDER_NAME = /^(tempImage\w*|image|img|photo|blob|untitled|screenshot)$/i;
function photoName(file: File, id: number) {
  const base = (file.name || '').replace(/\.[^.]+$/, '').trim();
  return base && !PLACEHOLDER_NAME.test(base) ? base : `Photo ${id}`;
}

async function decode(file: Blob): Promise<Source> {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    return new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
}

/** What the browser keeps of the open photos: everything but the pixels and the undo history. */
function storedSession(st: State): StoredSession {
  const tabs = stash(st).map(({ key, name, info, rot, flip, crop, settings }) => ({ key, name, info, rot, flip, crop, settings }));
  return { tabs, activeKey: st.tabs.find(t => t.id === st.activeId)?.key ?? null };
}

function snapshot(st: State): Snapshot {
  const t = st.tabs.find(t => t.id === st.activeId);
  return { settings: st.settings, photo: t ? { rot: t.rot, flip: t.flip, crop: t.crop } : null };
}
/** Goes back to a snapshot, keeping what isn't an edit: which view is shown and where the split is. */
function restore(st: State, snap: Snapshot): Partial<State> {
  let settings = { ...snap.settings, view: st.settings.view, split: st.settings.split };
  if (!calibrated(st.profiles, settings.profile)) settings = refit({ ...settings, profile: 'model' }, st.profiles);
  const tabs = snap.photo ? st.tabs.map(t => t.id === st.activeId ? { ...t, ...snap.photo } : t) : st.tabs;
  return { settings, tabs, cropDraft: undefined };
}

/** Which field changed, so drags of different sliders become separate undo steps. */
function changedKey<T extends object>(a: T, b: T) {
  return (Object.keys(b) as (keyof T)[]).find(k => a[k] !== b[k])?.toString() ?? '';
}

function initialState(data: StudioData): State {
  let settings = mergeSettings(data.settings);
  if (!calibrated(data.profiles, settings.profile)) settings.profile = 'model';
  if (!settings.curve) settings = refit(settings, data.profiles);
  return { settings, profiles: data.profiles, curves: data.curves, tabs: [], activeId: null, cropDraft: undefined, history: NO_HISTORY, nextId: 1 };
}

function useStudioState({ user, data, repo }: { user: StudioUser; data: StudioData; repo: Repo }) {
  const confirm = useConfirm();
  const [st, setSt] = useState(() => initialState(data));
  const set = (fn: (st: State) => Partial<State>) => setSt(s => ({ ...s, ...fn(s) }));
  /** An undoable change. Changes with the same key less than a second apart are undone together. */
  const edit = (key: string, fn: (st: State) => Partial<State>) => setSt(s => {
    const patch = fn(s);
    if (!Object.keys(patch).length) return s;
    const now = Date.now(), h = s.history, coalesce = key === h.key && now - h.at < COALESCE_MS;
    const past = coalesce ? h.past : [...h.past, snapshot(s)].slice(-HISTORY_LIMIT);
    return { ...s, ...patch, history: { past, future: [], key, at: now } };
  });
  const setSettings = (key: string, fn: (s: Settings, st: State) => Partial<Settings>) =>
    edit(key, st => ({ settings: { ...st.settings, ...fn(st.settings, st) } }));
  const undo = () => set(st => {
    const h = st.history, prev = h.past.at(-1);
    return prev ? { ...restore(st, prev), history: { past: h.past.slice(0, -1), future: [snapshot(st), ...h.future], key: '', at: 0 } } : {};
  });
  const redo = () => set(st => {
    const h = st.history, next = h.future[0];
    return next ? { ...restore(st, next), history: { past: [...h.past, snapshot(st)], future: h.future.slice(1), key: '', at: 0 } } : {};
  });
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
    try { img = await decode(file); } catch {
      toast.error(`${file.name || 'This file'} couldn't be opened`, { description: 'Try exporting it as a JPEG, PNG or TIFF (TIFF works in Safari).' });
      return;
    }
    const key = crypto.randomUUID();
    saveFile(user.id, key, file).catch(storageFailed);
    // A new photo starts from the default edits, and opens after the current tab.
    set(st => {
      const tabs = stash(st), at = st.activeId != null ? tabs.findIndex(t => t.id === st.activeId) + 1 : tabs.length;
      const settings = newPhotoSettings(st);
      const tab: Tab = {
        id: st.nextId, key, src: img, name: photoName(file, st.nextId), info: `${file.name || 'Pasted image'} · ${img.width} × ${img.height} px`,
        rot: 0, flip: false, crop: null, settings: photoSettings(settings), history: NO_HISTORY,
      };
      return { tabs: [...tabs.slice(0, at), tab, ...tabs.slice(at)], activeId: tab.id, nextId: st.nextId + 1, settings, cropDraft: undefined, history: NO_HISTORY };
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
    deleteFile(user.id, tab.key).catch(() => { /* removed on the next load */ });
  }
  const renameTab = (id: number, name: string) =>
    set(st => ({ tabs: st.tabs.map(t => t.id === id ? { ...t, name } : t) }));
  // Bitmaps are released when the studio goes away.
  const tabsRef = useRef(tabs);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => () => { for (const t of tabsRef.current) if ('close' in t.src) t.src.close(); }, []);

  // ---------- Keeping open photos across reloads ----------
  const storageWarned = useRef(false);
  function storageFailed() {
    if (storageWarned.current) return;
    storageWarned.current = true;
    toast.error("Your photos can't be kept in this browser", { description: 'They will be gone if you reload or close the page. The browser may be out of space or in private mode.' });
  }
  // Nothing is written until the saved photos are back, so an empty studio can't overwrite them.
  const [restoring, setRestoring] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadSession(user.id);
        if (!saved || cancelled) return;
        const restored: Omit<Tab, 'id'>[] = [];
        for (const t of saved.session.tabs) {
          try { restored.push({ ...t, src: await decode(saved.files.get(t.key)!), settings: t.settings as PhotoSettings, history: NO_HISTORY }); }
          catch { /* a file the browser can no longer open */ }
        }
        if (cancelled) { for (const t of restored) if ('close' in t.src) t.src.close(); return; }
        set(st => {
          // Photos opened while these were loading stay open, after them.
          const back = restored.map((t, i): Tab => ({ ...t, id: st.nextId + i, settings: { ...photoSettings(st.settings), ...t.settings } }));
          const withBack = { ...st, tabs: [...back, ...st.tabs], nextId: st.nextId + back.length };
          const activeId = st.activeId ?? back.find(t => t.key === saved.session.activeKey)?.id ?? back[0]?.id ?? null;
          return { tabs: withBack.tabs, nextId: withBack.nextId, ...(activeId !== st.activeId ? activateState(withBack, activeId) : {}) };
        });
      } catch { storageFailed(); }
      finally { if (!cancelled) setRestoring(false); }
    })();
    return () => { cancelled = true; };
    // Runs once, for the signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const stRef = useRef(st);
  useEffect(() => { stRef.current = st; }, [st]);
  useEffect(() => {
    if (restoring) return;
    const t = setTimeout(() => saveSession(user.id, storedSession(st)).catch(storageFailed), 500);
    return () => clearTimeout(t);
  }, [restoring, st, user.id]);
  useEffect(() => {
    if (restoring) return;
    // A reload right after an edit: write it now rather than after the delay.
    const now = () => { if (document.visibilityState === 'hidden') saveSession(user.id, storedSession(stRef.current)).catch(() => {}); };
    document.addEventListener('visibilitychange', now);
    window.addEventListener('pagehide', now);
    return () => { document.removeEventListener('visibilitychange', now); window.removeEventListener('pagehide', now); };
  }, [restoring, user.id]);

  // ---------- Crop & orientation ----------
  function rotate(quarterTurns: 1 | -1) {
    edit('rotate', st => {
      const t = st.tabs.find(t => t.id === st.activeId); if (!t) return {};
      const rot = (t.rot + quarterTurns + 4) % 4, crop = fitAspect(null, st.settings.aspect, t.src, rot);
      return { tabs: st.tabs.map(x => x === t ? { ...t, rot, crop } : x), cropDraft: st.cropDraft === undefined ? undefined : crop ?? fullCrop({ ...t, rot }, st.settings.aspect) };
    });
  }
  function flipPhoto() {
    const mirror = (c: Crop | null) => c && { ...c, x: 1 - c.x - c.w };
    edit('flip', st => ({
      tabs: st.tabs.map(t => t.id === st.activeId ? { ...t, flip: !t.flip, crop: mirror(t.crop) } : t),
      cropDraft: st.cropDraft === undefined ? undefined : mirror(st.cropDraft),
    }));
  }
  function setAspect(aspect: string) {
    edit('aspect', st => {
      const t = st.tabs.find(t => t.id === st.activeId), settings = { ...st.settings, aspect };
      if (!t) return { settings };
      if (st.cropDraft !== undefined) return { settings, cropDraft: fitAspect(st.cropDraft, aspect, t.src, t.rot) };
      return { settings, tabs: st.tabs.map(x => x === t ? { ...t, crop: fitAspect(t.crop, aspect, t.src, t.rot) } : x) };
    });
  }
  /** The largest crop the aspect ratio allows: where a new crop starts, so it can be shrunk from there. */
  const fullCrop = (t: Tab, aspect: string): Crop => fitAspect(null, aspect, t.src, t.rot) ?? { x: 0, y: 0, w: 1, h: 1 };
  const startCrop = () => set(st => {
    const t = st.tabs.find(t => t.id === st.activeId);
    return { cropDraft: t ? t.crop ?? fullCrop(t, st.settings.aspect) : null };
  });
  function finishCrop() {
    edit('crop', st => st.cropDraft === undefined ? {} : {
      tabs: st.tabs.map(t => t.id === st.activeId ? { ...t, crop: st.cropDraft ?? null } : t), cropDraft: undefined,
    });
  }
  function resetCrop() {
    edit('reset-crop', st => {
      const t = st.tabs.find(t => t.id === st.activeId); if (!t) return {};
      if (st.cropDraft !== undefined) return { cropDraft: fullCrop(t, st.settings.aspect) };
      const c = fitAspect(null, st.settings.aspect, t.src, t.rot);
      return { tabs: st.tabs.map(x => x === t ? { ...t, crop: c } : x) };
    });
  }
  const setCropDraft = (c: Crop | null) => set(() => ({ cropDraft: c }));

  // ---------- Curve ----------
  const fitCurve = () => setSettings('fit', (s, st) => refit(s, st.profiles));
  const linearCurve = () => setSettings('linear', () => ({ curve: LINEAR.map(p => [...p] as Pt), curveAuto: false }));
  const setCurvePoints = (curve: Pt[], key = 'curve') => setSettings(key, () => ({ curve, curveAuto: false }));
  /** Changes the generic process model; an auto-fitted curve follows it. */
  const setModel = (model: Settings['model']) =>
    setSettings('model:' + changedKey(settings.model, model), (s, st) => { const n = { ...s, model }; return n.curveAuto ? refit(n, st.profiles) : n; });
  // Remembers the curve per profile, so coming back to a profile restores a hand-tuned curve.
  function selectProfile(id: string) {
    setSettings('profile', (s, st) => {
      const curveByProfile = { ...s.curveByProfile, [s.profile]: { curve: s.curve, curveAuto: s.curveAuto } };
      const n = { ...s, profile: id, curveByProfile }, saved = curveByProfile[id];
      return saved && saved.curve && !saved.curveAuto ? { ...n, curve: structuredClone(saved.curve), curveAuto: false } : refit(n, st.profiles);
    });
  }
  const exportAcv = () => download(new Blob([encodeAcv(settings.curve || LINEAR)]), 'cyanotype-negative-curve.acv');
  async function importCurve(file: File, madeForPositive: boolean) {
    try {
      const pts = /\.acv$/i.test(file.name) ? decodeAcv(await file.arrayBuffer()) : parseLutText(await file.text());
      setCurvePoints(normalizeImportedCurve(pts, madeForPositive), 'import');
    } catch { toast.error("Couldn't read that curve file", { description: 'Supported: Photoshop .acv and 1D LUT .cube files.' }); }
  }
  function loadSavedCurve(id: string) {
    const c = st.curves.find(c => c.id === id);
    if (c) setCurvePoints(structuredClone(c.points), 'load-curve');
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
        sensitizer: target.sensitizer, printerFilm: target.printerFilm, rinse: target.rinse, notes: target.notes, exposureSeconds,
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
            { name: String(c.name || `Calibration ${i + 1}`).slice(0, 200), paper: null, lightSource: null, sensitizer: null, printerFilm: null, rinse: null, notes: null, exposureSeconds: null },
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
    canUndo: st.history.past.length > 0, canRedo: st.history.future.length > 0, undo, redo,
    setBw: (bw: Settings['bw']) => setSettings('bw:' + changedKey(settings.bw, bw), () => ({ bw })),
    setTone: (tone: Settings['tone']) => setSettings('tone:' + changedKey(settings.tone, tone), () => ({ tone })),
    resetTone: () => setSettings('reset-tone', () => ({ tone: structuredClone(DEFAULT_SETTINGS.tone) })),
    setPrint: (p: Partial<Settings['print']>) => setSettings('print:' + Object.keys(p).join(), s => ({ print: { ...s.print, ...p } })),
    // Not edits, so they stay out of the undo history.
    setView: (view: Settings['view']) => set(st => ({ settings: { ...st.settings, view } })),
    setSplit: (split: number) => set(st => ({ settings: { ...st.settings, split } })),
    openFiles, activate: (id: number) => set(st => id === st.activeId ? {} : activateState(st, id)), closeTab, renameTab,
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
