import type { Pt, RGB } from './math';
import type { ProcessModel, Tone } from './pipeline';

export type View = 'orig' | 'bw' | 'neg' | 'cyan' | 'compare';
export type PrintSettings = {
  width: number; dpi: number; border: number; borderType: 'black' | 'clear';
  mirror: boolean; tablet: boolean; tabletCorr: boolean;
};
export type CurveState = { curve: Pt[] | null; curveAuto: boolean };

/** Editor settings saved to the user's account (user_settings.settings). */
export type Settings = CurveState & {
  aspect: string;
  bw: { r: number; g: number; b: number };
  tone: Tone;
  /** 'model' (generic estimate) or a process profile id. */
  profile: string;
  model: ProcessModel;
  view: View;
  split: number;
  print: PrintSettings;
  /** Last curve used with each profile, so switching profiles doesn't throw away a hand-tuned curve. */
  curveByProfile: Record<string, CurveState>;
};

export type Calibration = {
  id: string;
  darkness: number[];
  colors: RGB[] | null;
  readingsLstar: number[] | null;
  exposureSeconds: number | null;
  conditions: string | null;
  measuredAt: string;
};

export type Profile = {
  id: string;
  name: string;
  paper: string | null;
  lightSource: string | null;
  sensitizer: string | null;
  exposureSeconds: number | null;
  printerFilm: string | null;
  /** Water, vinegar, citric acid… */
  rinse: string | null;
  notes: string | null;
  /** The active calibration, if the profile has one. */
  calibration: Calibration | null;
  calibrationCount: number;
};

export type SavedCurve = { id: string; name: string; points: Pt[]; profileId: string | null };

export type StudioData = { settings: Partial<Settings> | null; profiles: Profile[]; curves: SavedCurve[] };

export type StudioUser = { id: string; name: string; avatarUrl: string | null };

export const DEFAULT_SETTINGS: Settings = {
  aspect: 'free',
  bw: { r: 30, g: 59, b: 11 },
  tone: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, black: 0, white: 100, mid: 1 },
  curve: null, curveAuto: true,
  profile: 'model',
  model: { exposure: 0, range: 0.75 },
  view: 'cyan', split: 0.5,
  print: { width: 8, dpi: 360, border: 0.5, borderType: 'black', mirror: true, tablet: true, tabletCorr: true },
  curveByProfile: {},
};

/** Fills in defaults for anything missing; ignores unknown keys. Records (curveByProfile) are taken as-is. */
export function mergeSettings(saved: unknown): Settings {
  const out = structuredClone(DEFAULT_SETTINGS);
  if (!saved || typeof saved !== 'object') return out;
  deepMerge(out as unknown as Record<string, unknown>, saved as Record<string, unknown>);
  return out;
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>) {
  for (const k in b) {
    if (!(k in a)) continue;
    const av = a[k], bv = b[k];
    const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
    if (isObj(av) && isObj(bv) && Object.keys(av).length) deepMerge(av, bv);
    else if (bv !== undefined && (av === null || bv === null || typeof av === typeof bv || Array.isArray(bv))) a[k] = bv;
  }
  return a;
}
