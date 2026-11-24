// Squaring up a phone photo of a print: finding the paper's corners, working out the print's true
// shape, and a perspective warp that turns the tilted paper back into a flat rectangle.
// Everything works on plain pixel arrays, so it runs (and is tested) without a canvas.

export type Pt = { x: number; y: number };
/** The paper's corners, clockwise on screen: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];
export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

/** Paper sizes offered for the output shape, as width : height in portrait. */
export const PAPER_RATIOS = [
  { id: 'auto', label: 'As measured', w: 0, h: 0 },
  { id: '4x6', label: '4 × 6 in', w: 4, h: 6 },
  { id: '5x7', label: '5 × 7 in', w: 5, h: 7 },
  { id: '8x10', label: '8 × 10 in', w: 8, h: 10 },
  { id: '9x12', label: '9 × 12 in', w: 9, h: 12 },
  { id: '11x14', label: '11 × 14 in', w: 11, h: 14 },
  { id: 'letter', label: 'Letter', w: 8.5, h: 11 },
  { id: 'a5', label: 'A5', w: 148, h: 210 },
  { id: 'a4', label: 'A4', w: 210, h: 297 },
  { id: 'a3', label: 'A3', w: 297, h: 420 },
  { id: 'square', label: 'Square', w: 1, h: 1 },
] as const;
export type RatioId = (typeof PAPER_RATIOS)[number]['id'];

export const wholeImage = (w: number, h: number): Quad => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Puts four points in Quad order (clockwise from the top-left). */
export function orderQuad(pts: Pt[]): Quad {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4, cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const byAngle = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let first = 0;
  byAngle.forEach((p, i) => { if (p.x + p.y < byAngle[first].x + byAngle[first].y) first = i; });
  return [0, 1, 2, 3].map(i => byAngle[(first + i) % 4]) as Quad;
}

/** Turns the output a quarter turn clockwise: the corner that was bottom-left becomes the top-left. */
export const turnQuad = (q: Quad): Quad => [q[3], q[0], q[1], q[2]];

/**
 * Finds the paper in a photo, expected small (about 500 px across). It looks for the biggest region
 * that differs from the background along the photo's edges, then fits a straight line to each side.
 * Returns null if nothing paper-shaped stands out.
 */
export function detectQuad(img: Pixels): Quad | null {
  const { data, width: w, height: h } = img, n = w * h;
  // The background: the median colour of a thin ring around the edge of the photo.
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
    const i = (y * w + x) * 4; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
  }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  const bg = [med(rs), med(gs), med(bs)];

  // How far each pixel is from the background, split into paper / not paper by Otsu's threshold.
  const d = new Uint8Array(n), hist = new Float64Array(256);
  for (let i = 0; i < n; i++) {
    const v = Math.min(255, Math.round(Math.hypot(data[i * 4] - bg[0], data[i * 4 + 1] - bg[1], data[i * 4 + 2] - bg[2]) * 0.75));
    d[i] = v; hist[v]++;
  }
  const t = Math.max(18, otsu(hist, n));
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = d[i] > t ? 1 : 0;
  // An opening wipes out thin things like veins in a countertop or the grain of a table.
  const r = Math.max(1, Math.round(Math.min(w, h) / 250));
  mask = dilate(erode(mask, w, h, r), w, h, r);

  const comp = largestComponent(mask, w, h);
  if (!comp || comp.size < n * 0.08 || comp.size > n * 0.97) return null;

  // The region's outline: every pixel of it with a neighbour outside. Using all of them (not just
  // the outermost) keeps the paper's real edges even where something touching it sticks out.
  const outline: Pt[] = [], m = comp.mask;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!m[i]) continue;
    if (x === 0 || x === w - 1 || y === 0 || y === h - 1 || !m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w]) outline.push({ x: x + 0.5, y: y + 0.5 });
  }
  const hull = convexHull(outline);
  if (hull.length < 4) return null;
  const rough = orderQuad(reduceTo4(hull));
  const { quad: fine, support } = refine(rough, outline, Math.max(w, h));
  // Paper has four straight edges along their whole length; a subject cut out of a photo that's
  // already cropped (or of a scan) doesn't. And a sliver isn't a print.
  if (support < 0.75 || !(quadArea(fine) > n * 0.06)) return null;
  return fine;
}

function otsu(hist: Float64Array, total: number) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, at = 0;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; at = i; }
  }
  return at;
}

/** A square erosion, done as a row pass then a column pass. */
function erode(m: Uint8Array, w: number, h: number, r: number) { return morph(m, w, h, r, 0); }
function dilate(m: Uint8Array, w: number, h: number, r: number) { return morph(m, w, h, r, 1); }
function morph(m: Uint8Array, w: number, h: number, r: number, want: 0 | 1) {
  const a = new Uint8Array(m.length), b = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 1 - want;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (m[y * w + k] === want) { v = want; break; }
    a[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 1 - want;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (a[k * w + x] === want) { v = want; break; }
    b[y * w + x] = v;
  }
  return b;
}

function largestComponent(m: Uint8Array, w: number, h: number) {
  const label = new Int32Array(m.length), stack = new Int32Array(m.length);
  let best = 0, bestSize = 0, next = 0;
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || label[s]) continue;
    next++; let top = 0, size = 0;
    stack[top++] = s; label[s] = next;
    while (top) {
      const i = stack[--top]; size++;
      const x = i % w, y = (i - x) / w;
      if (x > 0 && m[i - 1] && !label[i - 1]) { label[i - 1] = next; stack[top++] = i - 1; }
      if (x < w - 1 && m[i + 1] && !label[i + 1]) { label[i + 1] = next; stack[top++] = i + 1; }
      if (y > 0 && m[i - w] && !label[i - w]) { label[i - w] = next; stack[top++] = i - w; }
      if (y < h - 1 && m[i + w] && !label[i + w]) { label[i + w] = next; stack[top++] = i + w; }
    }
    if (size > bestSize) { bestSize = size; best = next; }
  }
  if (!best) return null;
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = label[i] === best ? 1 : 0;
  return { mask: out, size: bestSize };
}

function convexHull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Drops hull points one at a time, always the one whose loss shrinks the shape least, until four are left. */
function reduceTo4(hull: Pt[]): Pt[] {
  const p = [...hull];
  const tri = (a: Pt, b: Pt, c: Pt) => Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  while (p.length > 4) {
    let at = 0, least = Infinity;
    for (let i = 0; i < p.length; i++) {
      const loss = tri(p[(i + p.length - 1) % p.length], p[i], p[(i + 1) % p.length]);
      if (loss < least) { least = loss; at = i; }
    }
    p.splice(at, 1);
  }
  return p;
}

export function quadArea(q: Quad) {
  let a = 0;
  for (let i = 0; i < 4; i++) { const p = q[i], r = q[(i + 1) % 4]; a += p.x * r.y - r.x * p.y; }
  return Math.abs(a) / 2;
}

/**
 * Fits a straight line through the outline points along each side (ignoring the ends, where a
 * bent or torn corner would pull it off) and puts the corners where those lines cross.
 */
function refine(q: Quad, outline: Pt[], size: number): { quad: Quad; support: number } {
  const tol = size * 0.012, BINS = 20;
  let support = 1;
  const lines = q.map((a, k) => {
    const b = q[(k + 1) % 4], len = dist(a, b), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const hit = new Uint8Array(BINS);
    const near = outline.filter(p => {
      const t = ((p.x - a.x) * ux + (p.y - a.y) * uy) / len;
      const on = t > 0.12 && t < 0.88 && Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux) < tol;
      if (on) hit[Math.min(BINS - 1, Math.floor(((t - 0.12) / 0.76) * BINS))] = 1;
      return on;
    });
    // The share of the side that has the outline running along it.
    support = Math.min(support, hit.reduce((s, v) => s + v, 0) / BINS);
    return near.length >= 8 ? fitLine(near) : null;
  });
  const out = q.map((corner, k) => {
    const l1 = lines[(k + 3) % 4], l2 = lines[k];
    const x = l1 && l2 && intersect(l1, l2);
    return x && dist(x, corner) < size * 0.05 ? x : corner;
  });
  return { quad: out as Quad, support };
}

/** A total-least-squares line: a point on it and its direction. */
function fitLine(pts: Pt[]) {
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const angle = Math.atan2(2 * sxy, sxx - syy) / 2;
  return { x: mx, y: my, dx: Math.cos(angle), dy: Math.sin(angle) };
}

function intersect(a: ReturnType<typeof fitLine>, b: ReturnType<typeof fitLine>): Pt | null {
  const den = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / den;
  return { x: a.x + t * a.dx, y: a.y + t * a.dy };
}

/**
 * The print's true width : height, worked out from how its corners are foreshortened (Zhang & He's
 * whiteboard method, which also recovers the camera's focal length). A photo taken almost straight on
 * doesn't pin down the focal length, so a typical phone lens is assumed then, which matters little.
 */
export function measureRatio(q: Quad, imgW: number, imgH: number): number {
  const naive = (dist(q[0], q[1]) + dist(q[3], q[2])) / (dist(q[0], q[3]) + dist(q[1], q[2]));
  const cx = imgW / 2, cy = imgH / 2;
  const m = (p: Pt) => [p.x - cx, p.y - cy, 1];
  const [m1, m2, m4, m3] = q.map(m); // m1 top-left, m2 top-right, m3 bottom-left, m4 bottom-right
  const k2 = dot(cross3(m1, m4), m3) / dot(cross3(m2, m4), m3);
  const k3 = dot(cross3(m1, m4), m2) / dot(cross3(m3, m4), m2);
  const n2 = m2.map((v, i) => k2 * v - m1[i]), n3 = m3.map((v, i) => k3 * v - m1[i]);
  const diag = Math.hypot(imgW, imgH);
  let f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  if (!(f2 > (0.3 * diag) ** 2 && f2 < (4 * diag) ** 2)) f2 = (0.8 * diag) ** 2;
  const r = Math.sqrt((n2[0] ** 2 + n2[1] ** 2 + f2 * n2[2] ** 2) / (n3[0] ** 2 + n3[1] ** 2 + f2 * n3[2] ** 2));
  return isFinite(r) && r > naive / 1.6 && r < naive * 1.6 ? r : naive;
}
const cross3 = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Width : height of the output: a paper size (turned to match the measured shape) or the measured ratio. */
export function outputRatio(id: RatioId, measured: number) {
  const p = PAPER_RATIOS.find(r => r.id === id);
  if (!p || p.id === 'auto') return measured;
  const portrait = p.w / p.h;
  return measured > 1 ? 1 / portrait : portrait;
}

/** The paper sizes within 2.5% of a measured shape, closest first. */
export function nearestPaper(measured: number): (typeof PAPER_RATIOS)[number][] {
  const r = measured > 1 ? 1 / measured : measured, err = (p: (typeof PAPER_RATIOS)[number]) => Math.abs(Math.log(r / (p.w / p.h)));
  return PAPER_RATIOS.filter(p => p.id !== 'auto' && err(p) < 0.025).sort((a, b) => err(a) - err(b));
}

/** Output size in pixels: about as sharp as the paper is in the photo, at the given shape, no bigger than `max`. */
export function outputSize(q: Quad, ratio: number, trim: number, max: number) {
  const across = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), down = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const long = Math.min(max, Math.max(across, down) * (1 - 2 * trim));
  return ratio >= 1
    ? { w: Math.round(long), h: Math.max(1, Math.round(long / ratio)) }
    : { w: Math.max(1, Math.round(long * ratio)), h: Math.round(long) };
}

/** The 3×3 projective map (row-major) taking the unit square's corners (0,0),(1,0),(1,1),(0,1) to the quad. */
export function squareToQuad(q: Quad): number[] {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
  }
  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h, 1,
  ];
}

/**
 * Warps the paper inside `q` (in `src` pixels) to a flat outW × outH image, cutting `trim` (a share of
 * each side) off every edge. Sampling is bilinear.
 */
export function warp(src: Pixels, q: Quad, outW: number, outH: number, trim = 0): Pixels {
  const m = squareToQuad(q), out = new Uint8ClampedArray(outW * outH * 4);
  const { data, width: sw, height: shh } = src, span = 1 - 2 * trim;
  for (let y = 0; y < outH; y++) {
    const v = trim + span * (y + 0.5) / outH;
    for (let x = 0; x < outW; x++) {
      const u = trim + span * (x + 0.5) / outW;
      const z = m[6] * u + m[7] * v + 1;
      const fx = (m[0] * u + m[1] * v + m[2]) / z - 0.5, fy = (m[3] * u + m[4] * v + m[5]) / z - 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(shh - 1, Math.floor(fy)));
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(shh - 1, y0 + 1);
      const ax = Math.max(0, Math.min(1, fx - x0)), ay = Math.max(0, Math.min(1, fy - y0));
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const o = (y * outW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * ax;
        const bot = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * ax;
        out[o + c] = top + (bot - top) * ay;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}

/**
 * Sharpens corners found on a small image using a bigger one (`q` in `img`'s pixels): along each
 * side it looks across the edge at many points for the sharpest step between paper and table, fits a
 * line through those, and puts the corners where the lines cross. Sides it can't place stay as they were.
 */
export function snapEdges(img: Pixels, q: Quad): Quad {
  const { data, width: w, height: h } = img, size = Math.max(w, h), reach = Math.max(4, size * 0.012);
  const lum = (x: number, y: number) => {
    const x0 = Math.max(0, Math.min(w - 2, Math.floor(x))), y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
    const ax = Math.max(0, Math.min(1, x - x0)), ay = Math.max(0, Math.min(1, y - y0));
    const at = (xx: number, yy: number) => { const i = (yy * w + xx) * 4; return data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11; };
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * ax, bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * ax;
    return top + (bot - top) * ay;
  };
  const cx = q.reduce((s, p) => s + p.x, 0) / 4, cy = q.reduce((s, p) => s + p.y, 0) / 4;
  const lines = q.map((a, k) => {
    const b = q[(k + 1) % 4], len = dist(a, b), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    // The normal, pointing out of the paper.
    let nx = uy, ny = -ux;
    if ((a.x - cx) * nx + (a.y - cy) * ny < 0) { nx = -nx; ny = -ny; }
    const hits: { p: Pt; g: number }[] = [];
    for (let i = 0; i < 48; i++) {
      const t = 0.08 + (0.84 * i) / 47, px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      // A profile across the edge, a little smoothed, from inside the paper to outside.
      const steps = Math.ceil(reach * 4), prof: number[] = [];
      for (let s = 0; s <= steps; s++) {
        const d = -reach + (2 * reach * s) / steps;
        let v = 0;
        for (const o of [-1, 0, 1]) v += lum(px + nx * d + ux * o, py + ny * d + uy * o);
        prof.push(v / 3);
      }
      let best = 0, at = -1;
      for (let s = 2; s < prof.length - 2; s++) {
        const g = prof[s + 2] + prof[s + 1] - prof[s - 1] - prof[s - 2];
        if (Math.abs(g) > Math.abs(best)) { best = g; at = s; }
      }
      if (at < 0 || Math.abs(best) < 24) continue;
      // Sub-step accuracy from a parabola through the neighbouring gradients.
      const g = (s: number) => Math.abs(prof[Math.min(prof.length - 1, s + 1)] - prof[Math.max(0, s - 1)]);
      const l = g(at - 1), c = g(at), r = g(at + 1), off = l - 2 * c + r !== 0 ? Math.max(-0.5, Math.min(0.5, (l - r) / (2 * (l - 2 * c + r)))) : 0;
      const d = -reach + (2 * reach * (at + off)) / steps;
      hits.push({ p: { x: px + nx * d, y: py + ny * d }, g: best });
    }
    // Keep the steps that go the usual way (paper lighter than the table, or darker) and lie on a line.
    const sign = Math.sign(hits.reduce((s, x) => s + Math.sign(x.g), 0)) || 1;
    let pts = hits.filter(x => Math.sign(x.g) === sign).map(x => x.p);
    if (pts.length < 12) return null;
    for (let pass = 0; pass < 2; pass++) {
      const l = fitLine(pts), off = pts.map(p => Math.abs((p.x - l.x) * l.dy - (p.y - l.y) * l.dx));
      const mad = [...off].sort((m, n) => m - n)[off.length >> 1] || 0.5;
      const keep = pts.filter((_, i) => off[i] <= Math.max(1, 3 * mad));
      if (keep.length < 12) break;
      pts = keep;
    }
    return fitLine(pts);
  });
  return q.map((corner, k) => {
    const l1 = lines[(k + 3) % 4], l2 = lines[k];
    const x = l1 && l2 && intersect(l1, l2);
    return x && dist(x, corner) < size * 0.03 ? x : corner;
  }) as Quad;
}
