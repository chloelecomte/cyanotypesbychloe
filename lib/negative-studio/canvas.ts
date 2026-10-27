// Canvas work for the studio: lookup tables, the photo preview, and the editor's drawings.
// Everything here is a plain function of its arguments, so the React components can call it from effects.
import { clamp, type Pt, type RGB } from './math';
import { countDistinct, gradientStops, makeGradientLUT, readingsToDarkness } from './pipeline';
import type { Calibration, Settings, View } from './types';

export const N = 4096;              // LUT resolution
export const PREVIEW_MAX = 1600;    // preview long edge in px

export type Crop = { x: number; y: number; w: number; h: number };
export type Source = ImageBitmap | HTMLImageElement;
/** How the photo is turned before cropping: quarter turns clockwise, then a left–right flip. */
export type Orientation = { rot: number; flip: boolean };
export type Fn = (x: number) => number;

// ---------- LUTs ----------
export type Luts = { pos: Uint8ClampedArray; neg: Uint8ClampedArray; cyan: Uint8ClampedArray; grad: Uint8ClampedArray };

export function buildLuts(tone: Fn, curve: Fn, response: Fn, calibration: Calibration | null): Luts {
  const pos = new Uint8ClampedArray(N), neg = new Uint8ClampedArray(N), cyan = new Uint8ClampedArray(N * 3);
  const grad = makeGradientLUT(gradientStops(calibration));
  for (let i = 0; i < N; i++) {
    const P = tone(i / (N - 1));
    pos[i] = P * 255 + 0.5;
    const n2 = clamp(curve(1 - P));
    neg[i] = n2 * 255 + 0.5;
    const gi = Math.round(clamp(response(n2)) * 1023) * 3;
    cyan[i * 3] = grad[gi]; cyan[i * 3 + 1] = grad[gi + 1]; cyan[i * 3 + 2] = grad[gi + 2];
  }
  return { pos, neg, cyan, grad };
}

/** CSS colour of print darkness d (0 = paper, 1 = full blue) on the gradient LUT. */
export function inkColor(grad: Uint8ClampedArray, d: number) {
  const gi = Math.round(clamp(d) * 1023) * 3;
  return `rgb(${grad[gi]},${grad[gi + 1]},${grad[gi + 2]})`;
}

// ---------- Orientation & crop ----------
export function orientedSize(src: Source, rot: number) {
  return rot % 2 ? { W: src.height, H: src.width } : { W: src.width, H: src.height };
}
export function cropPx(src: Source, rot: number, crop: Crop | null) {
  const { W, H } = orientedSize(src, rot), c = crop || { x: 0, y: 0, w: 1, h: 1 };
  return { x: c.x * W, y: c.y * H, w: c.w * W, h: c.h * H };
}
/** Draws the oriented (rotated/flipped) source into ctx at scale s, offset by the crop origin. */
export function drawOriented(ctx: CanvasRenderingContext2D, src: Source, o: Orientation, s: number, cx: number, cy: number) {
  const W = src.width, H = src.height, { W: Wo } = orientedSize(src, o.rot);
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.scale(s, s); ctx.translate(-cx, -cy);
  if (o.flip) { ctx.translate(Wo, 0); ctx.scale(-1, 1); }
  if (o.rot === 1) { ctx.translate(H, 0); ctx.rotate(Math.PI / 2); }
  else if (o.rot === 2) { ctx.translate(W, H); ctx.rotate(Math.PI); }
  else if (o.rot === 3) { ctx.translate(0, W); ctx.rotate(-Math.PI / 2); }
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}
export function aspectValue(aspect: string, src: Source, rot: number) {
  if (aspect === 'free') return null;
  if (aspect === 'orig') { const { W, H } = orientedSize(src, rot); return W / H; }
  return +aspect;
}
/** Shrinks the crop around its centre to the aspect ratio. Free aspect leaves it as it is. */
export function fitAspect(crop: Crop | null, aspect: string, src: Source, rot: number): Crop | null {
  const r = aspectValue(aspect, src, rot);
  if (!r) return crop;
  const { W, H } = orientedSize(src, rot), c = crop || { x: 0, y: 0, w: 1, h: 1 };
  let pw = c.w * W, ph = c.h * H; const cx = (c.x + c.w / 2) * W, cy = (c.y + c.h / 2) * H;
  if (pw / ph > r) pw = ph * r; else ph = pw / r;
  return { x: clamp((cx - pw / 2) / W, 0, 1 - pw / W), y: clamp((cy - ph / 2) / H, 0, 1 - ph / H), w: pw / W, h: ph / H };
}

// ---------- Preview ----------
export type Preview = { w: number; h: number; rgb: Uint8ClampedArray };

/** The whole oriented photo at preview size, shown while cropping. */
export function orientedCanvas(src: Source, o: Orientation) {
  const { W, H } = orientedSize(src, o.rot), s = Math.min(1, PREVIEW_MAX / Math.max(W, H));
  const c = document.createElement('canvas'); c.width = Math.round(W * s); c.height = Math.round(H * s);
  drawOriented(c.getContext('2d')!, src, o, s, 0, 0);
  return c;
}
/** The cropped photo at preview size, as RGBA pixels. */
export function previewPixels(src: Source, o: Orientation, crop: Crop | null): Preview {
  const cp = cropPx(src, o.rot, crop), s = Math.min(1, PREVIEW_MAX / Math.max(cp.w, cp.h));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(cp.w * s)); c.height = Math.max(1, Math.round(cp.h * s));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  drawOriented(ctx, src, o, s, cp.x, cp.y);
  return { w: c.width, h: c.height, rgb: ctx.getImageData(0, 0, c.width, c.height).data };
}
export function grayWeights(bw: Settings['bw']) {
  const { r, g, b } = bw, s = Math.max(1, r + g + b);
  return [r / s, g / s, b / s];
}
/** Each pixel's black & white value as an index into the LUTs. */
export function grayIndex(p: Preview, bw: Settings['bw']) {
  const [wr, wg, wb] = grayWeights(bw), { rgb } = p, k = (N - 1) / 255, gidx = new Uint16Array(p.w * p.h);
  for (let i = 0, j = 0; i < gidx.length; i++, j += 4) {
    gidx[i] = clamp(wr * rgb[j] + wg * rgb[j + 1] + wb * rgb[j + 2], 0, 255) * k + 0.5;
  }
  return gidx;
}

function sizeCanvas(c: HTMLCanvasElement, w: number, h: number) {
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
}
export function renderView(c: HTMLCanvasElement, p: Preview, gidx: Uint16Array, luts: Luts, view: View, split: number) {
  const { w, h, rgb } = p, ctx = c.getContext('2d')!;
  sizeCanvas(c, w, h);
  const img = ctx.createImageData(w, h), d = img.data, splitX = Math.round(split * w);
  for (let i = 0, j = 0; i < gidx.length; i++, j += 4) {
    let mode: View = view;
    if (view === 'compare') mode = (i % w) < splitX ? 'bw' : 'cyan';
    if (mode === 'orig') { d[j] = rgb[j]; d[j + 1] = rgb[j + 1]; d[j + 2] = rgb[j + 2]; }
    else if (mode === 'cyan') { const k = gidx[i] * 3; d[j] = luts.cyan[k]; d[j + 1] = luts.cyan[k + 1]; d[j + 2] = luts.cyan[k + 2]; }
    else { const g = mode === 'neg' ? luts.neg[gidx[i]] : luts.pos[gidx[i]]; d[j] = d[j + 1] = d[j + 2] = g; }
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (view === 'compare') {
    ctx.fillStyle = '#fff'; ctx.fillRect(splitX - 1, 0, 2, h);
    ctx.font = `${Math.max(12, w / 60)}px -apple-system,sans-serif`; ctx.fillStyle = 'rgba(0,0,0,.55)';
    const pad = w / 100;
    ctx.fillRect(pad, pad, w / 9, w / 40); ctx.fillRect(w - pad - w / 7, pad, w / 7, w / 40);
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
    ctx.fillText('B&W', pad * 2, pad + w / 80); ctx.fillText('Cyanotype', w - pad - w / 7 + pad, pad + w / 80);
  }
}
export function renderCrop(c: HTMLCanvasElement, oriented: HTMLCanvasElement, crop: Crop | null) {
  const w = oriented.width, h = oriented.height, ctx = c.getContext('2d')!;
  sizeCanvas(c, w, h);
  ctx.drawImage(oriented, 0, 0);
  const cr = crop || { x: 0, y: 0, w: 1, h: 1 };
  const x = cr.x * w, y = cr.y * h, cw = cr.w * w, ch = cr.h * h;
  ctx.fillStyle = 'rgba(0,0,0,.6)';
  ctx.fillRect(0, 0, w, y); ctx.fillRect(0, y + ch, w, h - y - ch); ctx.fillRect(0, y, x, ch); ctx.fillRect(x + cw, y, w - x - cw, ch);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, w / 600); ctx.strokeRect(x, y, cw, ch);
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.beginPath();
  for (let k = 1; k < 3; k++) { ctx.moveTo(x + cw * k / 3, y); ctx.lineTo(x + cw * k / 3, y + ch); ctx.moveTo(x, y + ch * k / 3); ctx.lineTo(x + cw, y + ch * k / 3); }
  ctx.stroke();
}

// ---------- Curve editor ----------
const CURVE_PAD = 14;
const GRID = '#2b3037', DIAGONAL = '#4a515b', LINE = '#8fb6ee', DOT = '#17191c';

/** Where the photo's tones sit on the curve's input axis, as 64 bars scaled to the tallest. */
export function histogram(gidx: Uint16Array, tone: Fn) {
  const h = new Float32Array(64), toneIdx = new Uint8Array(N);
  for (let i = 0; i < N; i++) toneIdx[i] = Math.min(63, (1 - tone(i / (N - 1))) * 64);
  for (let i = 0; i < gidx.length; i += 3) h[toneIdx[gidx[i]]]++;
  let mx = 0; for (let i = 0; i < 64; i++) mx = Math.max(mx, h[i]);
  for (let i = 0; i < 64; i++) h[i] /= mx || 1;
  return h;
}
export function drawCurve(c: HTMLCanvasElement, o: {
  hist: Float32Array | null; response: Fn; grad: Uint8ClampedArray; curve: Fn; points: Pt[]; active: number; hover: number;
}) {
  const ctx = c.getContext('2d')!, W = c.width, H = c.height, P = CURVE_PAD, S = W - 2 * P;
  const X = (x: number) => P + x * S, Y = (y: number) => P + (1 - y) * S;
  ctx.clearRect(0, 0, W, H);
  if (o.hist) {
    ctx.fillStyle = 'rgba(120,140,170,.18)';
    for (let i = 0; i < 64; i++) { const bh = o.hist[i] * S * 0.9; ctx.fillRect(X(i / 64), Y(0) - bh, S / 64 - 1, bh); }
  }
  // print-tone gradient bar along the bottom
  for (let i = 0; i < S; i++) { ctx.fillStyle = inkColor(o.grad, o.response(i / S)); ctx.fillRect(P + i, H - 8, 1, 6); }
  ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.beginPath();
  for (let k = 0; k <= 4; k++) { ctx.moveTo(X(k / 4), Y(0)); ctx.lineTo(X(k / 4), Y(1)); ctx.moveTo(X(0), Y(k / 4)); ctx.lineTo(X(1), Y(k / 4)); }
  ctx.stroke();
  ctx.setLineDash([6, 6]); ctx.strokeStyle = DIAGONAL; ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(1), Y(1)); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = LINE; ctx.lineWidth = 3; ctx.beginPath();
  for (let i = 0; i <= S; i++) { const x = i / S, y = clamp(o.curve(x)); if (i) ctx.lineTo(X(x), Y(y)); else ctx.moveTo(X(x), Y(y)); }
  ctx.stroke();
  o.points.forEach((p, i) => {
    ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), i === o.active || i === o.hover ? 9 : 7, 0, 7);
    ctx.fillStyle = i === o.active ? '#fff' : DOT; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = LINE; ctx.stroke();
  });
}
/** The pointer position in curve coordinates (0–1 inside the box). */
export function curvePoint(c: HTMLCanvasElement, e: { clientX: number; clientY: number }) {
  const r = c.getBoundingClientRect(), P = CURVE_PAD / c.width;
  return { x: ((e.clientX - r.left) / r.width - P) / (1 - 2 * P), y: 1 - ((e.clientY - r.top) / r.height - P) / (1 - 2 * P) };
}

// ---------- Tone strip ----------
/** How many of a 21-step scale's tones stay distinct in the predicted print. */
export function predictedDistinct(curve: Fn, response: Fn) {
  return countDistinct(Array.from({ length: 21 }, (_, i) => clamp(response(clamp(curve(1 - i / 20))))));
}
/** Ideal print, negative and predicted print of a 21-step scale. */
export function drawStrip(c: HTMLCanvasElement, curve: Fn, response: Fn, grad: Uint8ClampedArray) {
  const ctx = c.getContext('2d')!, W = c.width, H = c.height, rowH = H / 3 - 4, pw = W / 21;
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < 21; i++) {
    const P = i / 20, n = 1 - P, n2 = clamp(curve(n)), d = clamp(response(n2));
    const x = Math.round(i * pw), w = Math.round((i + 1) * pw) - x;
    ctx.fillStyle = inkColor(grad, n); ctx.fillRect(x, 0, w, rowH);
    const g = Math.round(n2 * 255); ctx.fillStyle = `rgb(${g},${g},${g})`; ctx.fillRect(x, rowH + 6, w, rowH);
    ctx.fillStyle = inkColor(grad, d); ctx.fillRect(x, 2 * rowH + 12, w, rowH);
  }
}

// ---------- Calibration ----------
export type Readings = { L: number[]; colors: RGB[] | null };

export function drawCalChart(c: HTMLCanvasElement, readings: Readings | null) {
  const ctx = c.getContext('2d')!, W = c.width, H = c.height, P = 40;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.beginPath();
  for (let i = 0; i <= 20; i++) { const x = P + i * (W - 2 * P) / 20; ctx.moveTo(x, P / 2); ctx.lineTo(x, H - P); }
  ctx.stroke();
  ctx.fillStyle = '#9aa3ad'; ctx.font = '20px -apple-system,sans-serif'; ctx.textAlign = 'center';
  for (let i = 0; i < 21; i++) ctx.fillText(String(i + 1), P + i * (W - 2 * P) / 20, H - P + 26);
  ctx.setLineDash([8, 8]); ctx.strokeStyle = DIAGONAL; ctx.beginPath(); ctx.moveTo(P, H - P); ctx.lineTo(W - P, P / 2); ctx.stroke(); ctx.setLineDash([]);
  if (!readings) return;
  const ds = readingsToDarkness(readings.L), colors = readings.colors;
  const pt = (d: number, i: number) => [P + i * (W - 2 * P) / 20, H - P - d * (H - 1.5 * P)] as const;
  ctx.strokeStyle = LINE; ctx.lineWidth = 3; ctx.beginPath();
  ds.forEach((d, i) => { const [x, y] = pt(d, i); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.stroke();
  ds.forEach((d, i) => {
    const [x, y] = pt(d, i);
    ctx.beginPath(); ctx.arc(x, y, 9, 0, 7);
    ctx.fillStyle = colors ? `rgb(${colors[i]})` : LINE; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  });
}
/** What the readings say about the print: distinct tones, where they start and end, and exposure warnings. */
export function summarizeReadings(r: Readings) {
  const ds = readingsToDarkness(r.L), distinct = countDistinct(ds);
  const first = ds.findIndex(d => d > 0.015) + 1, last = ds.findIndex(d => d > 0.985) + 1;
  return { distinct, first: Math.max(1, first), last: last || 21, overexposed: !!last && last < 15, underexposed: first > 7 };
}

export type Scan = { canvas: HTMLCanvasElement; data: ImageData };
type P2 = { x: number; y: number };
const sampleRadius = ([a, b]: P2[]) => Math.max(1, Math.hypot(b.x - a.x, b.y - a.y) / 20 * 0.28);

export async function loadScan(file: File): Promise<Scan> {
  const img = await createImageBitmap(file);
  const s = Math.min(1, 1800 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(img, 0, 0, c.width, c.height);
  img.close();
  return { canvas: c, data: ctx.getImageData(0, 0, c.width, c.height) };
}
export function drawScan(c: HTMLCanvasElement, scan: Scan, clicks: P2[]) {
  sizeCanvas(c, scan.canvas.width, scan.canvas.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(scan.canvas, 0, 0);
  const r = Math.max(4, c.width / 300);
  ctx.lineWidth = r / 2; ctx.strokeStyle = '#ff4d6d'; ctx.fillStyle = '#ff4d6d';
  if (clicks.length === 2) {
    const [a, b] = clicks, rad = sampleRadius(clicks);
    for (let i = 0; i < 21; i++) {
      const x = a.x + (b.x - a.x) * i / 20, y = a.y + (b.y - a.y) * i / 20;
      ctx.strokeRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  } else clicks.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill(); });
}
/** Averages 21 patches evenly spaced between the two clicked centres. */
export function sampleScan(scan: Scan, clicks: P2[], lstar: (r: number, g: number, b: number) => number): Readings {
  const [a, b] = clicks, rad = Math.round(sampleRadius(clicks)), { data, width, height } = scan.data;
  const L: number[] = [], colors: RGB[] = [];
  for (let i = 0; i < 21; i++) {
    const cx = Math.round(a.x + (b.x - a.x) * i / 20), cy = Math.round(a.y + (b.y - a.y) * i / 20);
    let R = 0, G = 0, B = 0, n = 0;
    for (let y = Math.max(0, cy - rad); y <= Math.min(height - 1, cy + rad); y++)
      for (let x = Math.max(0, cx - rad); x <= Math.min(width - 1, cx + rad); x++) { const k = (y * width + x) * 4; R += data[k]; G += data[k + 1]; B += data[k + 2]; n++; }
    colors.push([R / n, G / n, B / n].map(Math.round) as RGB); L.push(lstar(R / n, G / n, B / n));
  }
  return { L, colors };
}
/** Readings always run from the lightest patch to the darkest, whichever end was clicked first. */
export function orderReadings({ L, colors }: Readings): Readings {
  return L[0] < L[20] ? { L: L.slice().reverse(), colors: colors && colors.slice().reverse() } : { L, colors };
}
