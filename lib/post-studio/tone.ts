// Colour correction for a photo of a print: evening out the light, using the paper as the white
// reference, and the usual sliders on top. Works on plain pixel arrays, like straighten.ts.
import type { Pixels } from './straighten';

/** Paper brightness across the photo, as c0 + c1·u + c2·v + c3·u² + c4·uv + c5·v², u and v from −1 to 1. */
export type Light = { c: number[]; ref: number };

export type Edit = {
  /** The paper's colour in the photo (0–255), which becomes near-white; null leaves colours as they are. */
  white: [number, number, number] | null;
  /** The level (0–255) that becomes the deepest tone. */
  black: number;
  light: Light | null;
  /** How much of the uneven light to take out, 0–1. */
  flatten: number;
  exposure: number; contrast: number; highlights: number; shadows: number;
  warmth: number; tint: number; saturation: number;
};

export const NO_EDIT: Edit = {
  white: null, black: 0, light: null, flatten: 0,
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, warmth: 0, tint: 0, saturation: 0,
};

/** Where the paper ends up: a touch under pure white, so the paper's texture survives. */
const PAPER = 246;
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** How blue a colour is next to its red and green. Bare paper is about neutral; cyanotype tones are well above. */
const blueness = (r: number, g: number, b: number) => b - (r + g) / 2;

/**
 * Works out a starting edit from the photo: the light's unevenness, the paper colour and a
 * black point. The paper is taken from the brightest areas that aren't blue, so a print with
 * little bare paper isn't turned grey trying to neutralize its pale blues.
 */
export function autoEdit(px: Pixels): Edit {
  const light = fitLight(px);
  const { data, width: w, height: h } = px, n = w * h;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) * lightGain(light, 1, i % w, Math.floor(i / w), w, h);
  const sorted = Float32Array.from(L).sort();
  const at = (p: number) => sorted[Math.min(n - 1, Math.floor(p * n))];

  // The paper: the brightest few percent, skipping glare and anything clearly blue.
  const lo = at(0.95), hi = at(0.997);
  let sr = 0, sg = 0, sb = 0, k = 0;
  for (let i = 0; i < n; i++) {
    if (L[i] < lo || L[i] > hi) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (Math.max(r, g, b) >= 252 || blueness(r, g, b) > 18) continue;
    const f = lightGain(light, 1, i % w, Math.floor(i / w), w, h);
    sr += r * f; sg += g * f; sb += b * f; k++;
  }
  let white: Edit['white'] = null;
  if (k > n * 0.002) {
    white = [sr / k, sg / k, sb / k];
  } else {
    // No bare paper to go by: just bring the brightest tones up, leaving the colour alone.
    const top = at(0.995);
    white = [top, top, top];
  }
  // Don't let a stray colour swing things too far: each channel moves at most 15% against the others.
  const mean = (white[0] + white[1] + white[2]) / 3;
  white = white.map(v => Math.min(mean * 1.15, Math.max(mean / 1.15, v))) as Edit['white'];

  // The black point: a little under the darkest tones (after the white balance), so the deepest
  // blues go deep without clipping. Phones lift the shadows with flare, which this takes back out.
  const g = white!.map(v => PAPER / v);
  const dark = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = lightGain(light, 1, i % w, Math.floor(i / w), w, h);
    dark[i] = luma(data[i * 4] * g[0], data[i * 4 + 1] * g[1], data[i * 4 + 2] * g[2]) * f;
  }
  dark.sort();
  const black = Math.max(0, Math.min(70, dark[Math.floor(n * 0.002)] * 0.7));

  return { ...NO_EDIT, white, black, light, flatten: light ? 1 : 0 };
}

/**
 * Fits a smooth surface to the paper's brightness, using blocks of the photo whose brightest tones
 * look like bare paper. Returns null if there's too little paper to tell.
 */
export function fitLight(px: Pixels): Light | null {
  const { data, width: w, height: h } = px;
  const across = 12, bw = Math.max(1, Math.floor(Math.min(w, h) / across));
  const samples: { u: number; v: number; l: number }[] = [];
  for (let by = 0; by + bw <= h; by += bw) for (let bx = 0; bx + bw <= w; bx += bw) {
    const ls: number[] = [], items: number[] = [];
    for (let y = by; y < by + bw; y += 2) for (let x = bx; x < bx + bw; x += 2) {
      const i = (y * w + x) * 4; ls.push(luma(data[i], data[i + 1], data[i + 2])); items.push(i);
    }
    const order = ls.map((_, j) => j).sort((a, b) => ls[a] - ls[b]);
    // The block's brighter tones (80th–95th percentile), if they're paper-coloured.
    let sum = 0, blue = 0, c = 0;
    for (let j = Math.floor(order.length * 0.8); j < Math.floor(order.length * 0.95); j++) {
      const i = items[order[j]]; sum += ls[order[j]]; blue += blueness(data[i], data[i + 1], data[i + 2]); c++;
    }
    if (!c || blue / c > 12 || sum / c < 90) continue;
    // And fairly even, so it's paper, not the edge of something.
    const spread = ls[order[Math.floor(order.length * 0.95)]] - ls[order[Math.floor(order.length * 0.5)]];
    if (spread > 35) continue;
    samples.push({ u: ((bx + bw / 2) / w) * 2 - 1, v: ((by + bw / 2) / h) * 2 - 1, l: sum / c });
  }
  const blocks = Math.floor(w / bw) * Math.floor(h / bw);
  if (samples.length < 8) return null;
  // A tilted plane unless the paper shows across enough of the photo to trust a curved surface.
  const quad = samples.length >= Math.max(16, blocks * 0.3);
  const terms = (u: number, v: number) => (quad ? [1, u, v, u * u, u * v, v * v] : [1, u, v]);
  let use = samples, c: number[] | null = null;
  for (let pass = 0; pass < 3; pass++) {
    c = leastSquares(use.map(s => terms(s.u, s.v)), use.map(s => s.l));
    if (!c) return null;
    const res = use.map(s => s.l - dot(c!, terms(s.u, s.v)));
    const sd = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / res.length) || 1;
    const keep = use.filter((_, i) => Math.abs(res[i]) < 2 * sd);
    if (keep.length === use.length || keep.length < 8) break;
    use = keep;
  }
  const full = quad ? c! : [...c!, 0, 0, 0];
  // The reference: the brightest the paper gets anywhere in the photo.
  let ref = 0;
  for (let v = -1; v <= 1.001; v += 0.1) for (let u = -1; u <= 1.001; u += 0.1) ref = Math.max(ref, surface(full, u, v));
  return ref > 0 ? { c: full, ref } : null;
}

const surface = (c: number[], u: number, v: number) => c[0] + c[1] * u + c[2] * v + c[3] * u * u + c[4] * u * v + c[5] * v * v;
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

/** How much to brighten pixel (x, y) to even out the light, at the given strength. Never darkens; at most 1.6×. */
export function lightGain(light: Light | null, amount: number, x: number, y: number, w: number, h: number) {
  if (!light || amount <= 0) return 1;
  const s = surface(light.c, ((x + 0.5) / w) * 2 - 1, ((y + 0.5) / h) * 2 - 1);
  const g = s > 1 ? Math.min(1.6, Math.max(1, light.ref / s)) : 1;
  return 1 + (g - 1) * amount;
}

function leastSquares(rows: number[][], ys: number[]): number[] | null {
  const k = rows[0].length, A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  rows.forEach((r, n) => { for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] += r[i] * r[j]; A[i][k] += r[i] * ys[n]; } });
  return solve(A);
}

/** Gaussian elimination with partial pivoting on an augmented k × (k+1) matrix. */
function solve(A: number[][]): number[] | null {
  const k = A.length;
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((row, i) => row[k] / row[i]);
}

/** The tone curve for contrast, highlights and shadows, as a 1024-step lookup from 0–1 to 0–1. */
function toneCurve(e: Edit) {
  const lut = new Float32Array(1024), k = Math.pow(2, e.contrast);
  for (let i = 0; i < 1024; i++) {
    let v = i / 1023;
    // Contrast: an S-curve around the middle that keeps black and white where they are.
    v = v < 0.5 ? 0.5 * Math.pow(2 * v, k) : 1 - 0.5 * Math.pow(2 - 2 * v, k);
    // Highlights and shadows: gentle bumps centred on the light and dark thirds.
    v += e.shadows * 0.18 * v * (1 - v) ** 2 * 6.75;
    v += e.highlights * 0.18 * v * v * (1 - v) * 6.75;
    lut[i] = Math.max(0, Math.min(1, v));
  }
  return lut;
}

/** Applies an edit to a photo of the paper, returning a new image. */
export function applyEdit(px: Pixels, e: Edit): Pixels {
  const { data, width: w, height: h } = px, out = new Uint8ClampedArray(data.length);
  const base = e.white ? e.white.map(v => PAPER / Math.max(1, v)) : [1, 1, 1];
  const gain = [
    base[0] * (1 + 0.12 * e.warmth) * (1 + 0.04 * e.tint),
    base[1] * (1 - 0.08 * e.tint),
    base[2] * (1 - 0.12 * e.warmth) * (1 + 0.04 * e.tint),
  ];
  const black = e.black / 255, span = 1 / Math.max(0.05, 1 - black), ev = Math.pow(2, e.exposure / 2.2);
  const lut = toneCurve(e), sat = 1 + e.saturation;
  const flat = e.light && e.flatten > 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, f = flat ? lightGain(e.light, e.flatten, x, y, w, h) : 1;
      let r = data[i] * gain[0] * f / 255, g = data[i + 1] * gain[1] * f / 255, b = data[i + 2] * gain[2] * f / 255;
      r = lut[clampIdx((r - black) * span * ev)];
      g = lut[clampIdx((g - black) * span * ev)];
      b = lut[clampIdx((b - black) * span * ev)];
      if (sat !== 1) {
        const l = luma(r, g, b);
        r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
      }
      out[i] = r * 255; out[i + 1] = g * 255; out[i + 2] = b * 255; out[i + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}
const clampIdx = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1023 : Math.round(v * 1023));

/**
 * The paper colour at a point the user clicked: the average of a small patch, with the light
 * evened out as the current edit would.
 */
export function whiteAt(px: Pixels, e: Edit, x: number, y: number): [number, number, number] {
  const { data, width: w, height: h } = px, r = Math.max(2, Math.round(Math.min(w, h) / 200));
  const s = [0, 0, 0];
  let k = 0;
  for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
    const i = (yy * w + xx) * 4, f = lightGain(e.light, e.flatten, xx, yy, w, h);
    s[0] += data[i] * f; s[1] += data[i + 1] * f; s[2] += data[i + 2] * f; k++;
  }
  return s.map(v => v / k) as [number, number, number];
}
