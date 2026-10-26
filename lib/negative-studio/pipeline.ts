// Pure image-pipeline functions. No DOM, so they run (and are tested) anywhere.
//
// sRGB pixel → grey (weighted R,G,B) → tone LUT → positive P
// negative n = 1 − P → correction curve C(n) = n′  ← this is what gets printed
// predicted print darkness d = R(n′)  (R = process response, 0 = paper, 1 = Dmax)
import { clamp, hex, l2s, monotone, s2l, type Pt, type RGB } from './math';

export type Tone = { exposure: number; contrast: number; highlights: number; shadows: number; black: number; white: number; mid: number };
export type ProcessModel = { exposure: number; range: number };
/** What the pipeline needs from a calibration: 21 darkness values, optionally the scanned colours. */
export type Response = { darkness: number[]; colors: RGB[] | null };

export const LINEAR: Pt[] = [[0, 0], [1, 1]];

// darkness 0 = paper white, 1 = deepest blue (Dmax). Input: negative value 0 = dense ink, 1 = clear film.
export const GENERIC_GRADIENT: [number, RGB][] = [
  [0, hex('#f3efe4')], [0.12, hex('#e1e7ec')], [0.35, hex('#9db9d6')], [0.6, hex('#4f7fb5')], [0.82, hex('#21497f')], [1, hex('#0e2550')],
];

export function responseFn(cal: Response | null, model: ProcessModel): (n: number) => number {
  if (cal) return monotone(cal.darkness.map((_, i) => i / 20), cal.darkness);
  // Generic estimate: only a window of the negative's range prints; more exposure shifts the window toward denser ink
  const { exposure, range } = model;
  const c = 0.5 - 0.1 * exposure, lo = c - range / 2, hi = c + range / 2;
  return n => {
    const t = clamp((n - lo) / (hi - lo));
    return 0.5 * t * t * (3 - 2 * t) + 0.5 * Math.pow(t, 0.7);
  };
}

export function gradientStops(cal: Response | null): [number, RGB][] {
  if (!cal || !cal.colors) return GENERIC_GRADIENT;
  const colors = cal.colors;
  const stops: [number, RGB][] = [];
  cal.darkness.forEach((d, i) => { if (!stops.length || d > stops[stops.length - 1][0] + 1e-4) stops.push([d, colors[i]]); });
  if (stops.length < 2) return GENERIC_GRADIENT;
  stops[0][0] = 0; stops[stops.length - 1][0] = 1;
  return stops;
}

/** 1024-entry RGB lookup from darkness to display colour, blended in linear light. */
export function makeGradientLUT(stops: [number, RGB][]) {
  const lut = new Uint8ClampedArray(1024 * 3);
  for (let i = 0; i < 1024; i++) {
    const d = i / 1023;
    let k = 0; while (k < stops.length - 2 && stops[k + 1][0] < d) k++;
    const [p0, c0] = stops[k], [p1, c1] = stops[k + 1];
    const t = clamp((d - p0) / (p1 - p0 || 1));
    for (let j = 0; j < 3; j++) lut[i * 3 + j] = l2s(s2l(c0[j] / 255) * (1 - t) + s2l(c1[j] / 255) * t) * 255;
  }
  return lut;
}

export function curveFn(points: Pt[] | null) {
  const pts = points || LINEAR;
  return monotone(pts.map(p => p[0]), pts.map(p => p[1]));
}

/** Auto-fit: C = R⁻¹, so that R(C(n)) = n and the print tones come out even. */
export function fitCurve(R: (n: number) => number): Pt[] {
  const M = 2048, rs = new Float64Array(M);
  let run = -Infinity;
  for (let k = 0; k < M; k++) { run = Math.max(run, R(k / (M - 1))); rs[k] = run; }
  const rmin = rs[0], rmax = rs[M - 1];
  const inv = (t: number) => {
    const target = rmin + t * (rmax - rmin);
    let lo = 0, hi = M - 1;
    if (rs[0] >= target) return 0;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rs[mid] >= target) hi = mid; else lo = mid; }
    const f = (target - rs[lo]) / ((rs[hi] - rs[lo]) || 1);
    return (lo + f) / (M - 1);
  };
  const xs = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1];
  return xs.map(x => [x, +inv(x).toFixed(4)]);
}

export function toneFn(t: Tone) {
  const ev = Math.pow(2, t.exposure), b = t.black / 100, w = t.white / 100;
  const c = t.contrast / 100, sh = t.shadows / 100, hl = t.highlights / 100, g = t.mid;
  return (x: number) => {
    x = l2s(clamp(s2l(x) * ev));
    x = clamp((x - b) / Math.max(1e-3, w - b));
    x = Math.pow(x, 1 / g);
    x = clamp(x + sh * 0.25 * 6.75 * x * (1 - x) * (1 - x) + hl * 0.25 * 6.75 * x * x * (1 - x));
    return clamp(x - c * Math.sin(2 * Math.PI * x) / (2 * Math.PI));
  };
}

/** Raw L* (lightest → darkest patch) to normalized, monotone darkness 0..1. */
export function readingsToDarkness(L: number[]) {
  const mx = Math.max(...L), mn = Math.min(...L);
  let run = 0;
  return L.map(v => (run = Math.max(run, (mx - v) / ((mx - mn) || 1)), +run.toFixed(4)));
}

/** Number of visibly different neighbouring steps in a 21-step scale. */
export function countDistinct(values: number[], threshold = 0.015) {
  let distinct = 1;
  for (let i = 1; i < values.length; i++) if (Math.abs(values[i] - values[i - 1]) > threshold) distinct++;
  return distinct;
}

export const isLinear = (pts: Pt[]) =>
  pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1;
