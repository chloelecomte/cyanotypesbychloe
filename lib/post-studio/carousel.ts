// Spanning carousels: photo frames laid out on one long strip of slides, free to cross from one slide
// to the next. Frames are stored in slide units (x and w in slide widths, y and h in slide heights),
// so changing the post's shape keeps the layout. Margin and gap are shares of a slide's width, as in collages.
import type { Rect, View } from '@/lib/panels/geometry';

export type Box = { x: number; y: number; w: number; h: number };
export type Frame = Box & View & { id: number; photoId: number | null };

export const LAYOUTS = [
  { id: 'bridge', label: 'Bridge', hint: 'A photo crosses every seam: half a slide on each side, with half-slide photos at the ends.' },
  { id: 'panorama', label: 'Panorama', hint: 'One photo across every slide.' },
  { id: 'single', label: 'One each', hint: 'One photo per slide, with even borders that line up as you swipe.' },
  { id: 'mosaic', label: 'Mosaic', hint: 'Photos of mixed sizes tiled across the whole strip, crossing the seams at different points. Shuffle for another arrangement; set the space between to 0 for a seamless look.' },
] as const;
export type LayoutId = (typeof LAYOUTS)[number]['id'];

/** `layout` is the starting layout, or 'custom' once frames were moved by hand (then settings stop rearranging them). */
export type Carousel = {
  slides: number; margin: number; gap: number; layout: LayoutId | 'custom';
  /** Mosaic only: how many tiles, and which shuffle. */
  count: number; seed: number;
};
export type LayoutParams = Pick<Carousel, 'slides' | 'margin' | 'gap'> & Partial<Pick<Carousel, 'count' | 'seed'>>;

export const MIN_SIZE = 0.04;

/** Frame boxes for a starting layout. `aspect` is slide height ÷ width. */
export function layoutBoxes(id: LayoutId, c: LayoutParams, aspect: number): Box[] {
  const n = c.slides, m = c.margin, g = c.gap, my = m / aspect;
  const row = (x: number, w: number): Box => ({ x, y: my, w, h: 1 - 2 * my });
  if (id === 'panorama') return [row(m, n - 2 * m)];
  if (id === 'mosaic') return mosaicBoxes(row(m, n - 2 * m), c.count ?? n * 2, c.seed ?? 1, g, aspect, n);
  if (id === 'single') return Array.from({ length: n }, (_, i) => row(i + m, 1 - 2 * m));
  const half = 0.5 - g / 2 - m;
  return [
    row(m, half),
    ...Array.from({ length: n - 1 }, (_, j) => row(j + 0.5 + g / 2, 1 - g)),
    row(n - 0.5 + g / 2, half),
  ];
}

/** A small seeded random generator, so a shuffle always gives the same mosaic. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` tiles filling `area` with `gap` between them, by cutting it in two again and again: across
 * its longer side, at an uneven point, with the tiles shared out by size. Cuts close to a seam are
 * moved off it, so photos run across the seams instead of stopping at them.
 */
export function mosaicBoxes(area: Box, count: number, seed: number, gap: number, aspect: number, slides: number): Box[] {
  const rand = random(seed), gy = gap / aspect, out: Box[] = [];
  const cut = (r: Box, k: number) => {
    if (k <= 1) { out.push(r); return; }
    const physW = r.w, physH = r.h * aspect; // in slide widths, so shapes compare fairly
    const across = physW > physH * (0.75 + rand() * 0.5);
    const k1 = Math.max(1, Math.min(k - 1, Math.round(k * (0.35 + rand() * 0.3))));
    let f = Math.min(0.75, Math.max(0.25, k1 / k + (rand() - 0.5) * 0.16));
    if (across) {
      let x = r.x + r.w * f;
      const seam = Math.round(x);
      if (seam > 0 && seam < slides && Math.abs(x - seam) < 0.1) {
        const away = x < seam ? seam - 0.18 : seam + 0.18;
        if (away > r.x + r.w * 0.2 && away < r.x + r.w * 0.8) x = away;
      }
      f = (x - r.x) / r.w;
      cut({ x: r.x, y: r.y, w: r.w * f - gap / 2, h: r.h }, k1);
      cut({ x: x + gap / 2, y: r.y, w: r.w * (1 - f) - gap / 2, h: r.h }, k - k1);
    } else {
      cut({ x: r.x, y: r.y, w: r.w, h: r.h * f - gy / 2 }, k1);
      cut({ x: r.x, y: r.y + r.h * f + gy / 2, w: r.w, h: r.h * (1 - f) - gy / 2 }, k - k1);
    }
  };
  cut(area, Math.max(1, Math.round(count)));
  return out;
}

/** A frame cut in two, down the middle ('v', side by side) or across it ('h', one above the other). */
export function splitBox(b: Box, dir: 'v' | 'h', gap: number, aspect: number): [Box, Box] {
  if (dir === 'v') {
    const w = Math.max(MIN_SIZE, (b.w - gap) / 2);
    return [{ ...b, w }, { ...b, x: b.x + b.w - w, w }];
  }
  const h = Math.max(MIN_SIZE / aspect, (b.h - gap / aspect) / 2);
  return [{ ...b, h }, { ...b, y: b.y + b.h - h, h }];
}

/**
 * A frame reshaped to a photo's shape (`photoAspect` = width ÷ height), so the whole photo shows
 * uncropped. It keeps its height and center.
 */
export function boxForPhoto(b: Box, photoAspect: number, aspect: number): Box {
  const w = Math.max(MIN_SIZE, photoAspect * b.h * aspect);
  return { ...b, x: b.x + b.w / 2 - w / 2, w };
}

/** A new frame shaped like a photo, centered on a point (in slide units), a little over half a slide tall. */
export function boxAt(x: number, y: number, photoAspect: number, aspect: number): Box {
  const h = 0.6, w = photoAspect * h * aspect;
  return { x: x - w / 2, y: Math.min(1 - h, Math.max(0, y - h / 2)), w, h };
}

/** Frames for new boxes, keeping the photos (and their crops) of the old frames in order. */
export function refill(boxes: Box[], old: Frame[], newId: () => number): Frame[] {
  const placed = old.filter(f => f.photoId != null);
  return boxes.map((b, i) => {
    const o = placed[i];
    return { ...b, id: newId(), photoId: o?.photoId ?? null, zoom: o?.zoom ?? 1, panX: o?.panX ?? 0, panY: o?.panY ?? 0 };
  });
}

export const frameRect = (b: Box, W: number, H: number): Rect => ({ x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H });

/** The slides a frame shows on, as slide indexes. */
export const slidesOf = (b: Box, slides: number) => {
  const out: number[] = [];
  for (let i = Math.max(0, Math.floor(b.x)); i < Math.min(slides, Math.ceil(b.x + b.w)); i++) out.push(i);
  return out;
};

export type Targets = { xs: number[]; ys: number[] };

/** Lines a moving frame's edges are drawn to: slide edges, centers and margins, and other frames' edges (and one gap beyond them). */
export function snapTargets(c: Carousel, aspect: number, frames: Box[]): Targets {
  const m = c.margin, my = m / aspect, gy = c.gap / aspect;
  const xs: number[] = [], ys = [0, 1, 0.5, my, 1 - my];
  for (let i = 0; i <= c.slides; i++) xs.push(i);
  for (let i = 0; i < c.slides; i++) xs.push(i + m, i + 1 - m, i + 0.5);
  for (const f of frames) {
    xs.push(f.x, f.x + f.w, f.x - c.gap, f.x + f.w + c.gap);
    ys.push(f.y, f.y + f.h, f.y - gy, f.y + f.h + gy);
  }
  return { xs, ys };
}

/** How far to move so one of `edges` lands on a target, if one is within `tol`. */
function nearest(edges: number[], targets: number[], tol: number) {
  let best = 0, dist = tol;
  for (const e of edges) for (const t of targets) if (Math.abs(t - e) <= dist) { dist = Math.abs(t - e); best = t - e; }
  return best;
}

/** A frame moved by (dx, dy), snapped to the nearest target lines. */
export function moveBox(start: Box, dx: number, dy: number, t: Targets, tolX: number, tolY: number): Box {
  const b = { ...start, x: start.x + dx, y: start.y + dy };
  return { ...b, x: b.x + nearest([b.x, b.x + b.w], t.xs, tolX), y: b.y + nearest([b.y, b.y + b.h], t.ys, tolY) };
}

/** Handles are compass points: 'n', 'se', 'w'… */
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** A frame resized by dragging one handle by (dx, dy), with the moving edges snapped. */
export function resizeBox(start: Box, h: Handle, dx: number, dy: number, t: Targets, tolX: number, tolY: number, aspect: number): Box {
  let l = start.x, r = start.x + start.w, top = start.y, bot = start.y + start.h;
  const minY = MIN_SIZE / aspect;
  const snap = (v: number, ts: number[], tol: number) => v + nearest([v], ts, tol);
  if (h.includes('w')) l = Math.min(snap(l + dx, t.xs, tolX), r - MIN_SIZE);
  if (h.includes('e')) r = Math.max(snap(r + dx, t.xs, tolX), l + MIN_SIZE);
  if (h.includes('n')) top = Math.min(snap(top + dy, t.ys, tolY), bot - minY);
  if (h.includes('s')) bot = Math.max(snap(bot + dy, t.ys, tolY), top + minY);
  return { x: l, y: top, w: r - l, h: bot - top };
}

/** A new frame in the middle of a slide: half a slide wide, as tall as the margins allow. */
export function newBox(slide: number, c: Carousel, aspect: number): Box {
  const w = Math.max(MIN_SIZE, 0.5 - c.margin), h = Math.max(MIN_SIZE / aspect, 1 - 2 * c.margin / aspect);
  return { x: slide + 0.5 - w / 2, y: (1 - h) / 2, w, h };
}
