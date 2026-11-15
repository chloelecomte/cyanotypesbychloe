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
] as const;
export type LayoutId = (typeof LAYOUTS)[number]['id'];

/** `layout` is the starting layout, or 'custom' once frames were moved by hand (then settings stop rearranging them). */
export type Carousel = { slides: number; margin: number; gap: number; layout: LayoutId | 'custom' };

export const MIN_SIZE = 0.04;

/** Frame boxes for a starting layout. `aspect` is slide height ÷ width. */
export function layoutBoxes(id: LayoutId, c: Pick<Carousel, 'slides' | 'margin' | 'gap'>, aspect: number): Box[] {
  const n = c.slides, m = c.margin, g = c.gap, my = m / aspect;
  const row = (x: number, w: number): Box => ({ x, y: my, w, h: 1 - 2 * my });
  if (id === 'panorama') return [row(m, n - 2 * m)];
  if (id === 'single') return Array.from({ length: n }, (_, i) => row(i + m, 1 - 2 * m));
  const half = 0.5 - g / 2 - m;
  return [
    row(m, half),
    ...Array.from({ length: n - 1 }, (_, j) => row(j + 0.5 + g / 2, 1 - g)),
    row(n - 0.5 + g / 2, half),
  ];
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
