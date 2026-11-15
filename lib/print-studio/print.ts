// Print Studio: one photo split across prints hung side by side (a diptych, triptych, or a grid),
// ready to send to a lab. Every length here is in inches; the UI converts to cm when asked.
//
// The panels sit in a shared "wall" scene with real gaps between them. When `continuous` is on, the
// photo runs on behind those gaps, so lines in the picture stay straight from one print to the next.
// When it's off, the pieces are cut edge to edge, as if the photo were sliced with no gap.
import { NO_VIEW, place, type Placement, type Rect, type View } from '@/lib/panels/geometry';
import { bounds, inset, panelRects, sceneSize } from '@/lib/panels/panels';

export const SIZES = [
  { id: '4x6', label: '4 × 6 in', w: 4, h: 6 },
  { id: '5x7', label: '5 × 7 in', w: 5, h: 7 },
  { id: '8x8', label: '8 × 8 in', w: 8, h: 8 },
  { id: '8x10', label: '8 × 10 in', w: 8, h: 10 },
  { id: 'letter', label: '8.5 × 11 in', w: 8.5, h: 11 },
  { id: '11x14', label: '11 × 14 in', w: 11, h: 14 },
  { id: '12x12', label: '12 × 12 in', w: 12, h: 12 },
  { id: '12x18', label: '12 × 18 in', w: 12, h: 18 },
  { id: '16x20', label: '16 × 20 in', w: 16, h: 20 },
  { id: '18x24', label: '18 × 24 in', w: 18, h: 24 },
  { id: '20x30', label: '20 × 30 in', w: 20, h: 30 },
  { id: '24x36', label: '24 × 36 in', w: 24, h: 36 },
  { id: 'a5', label: 'A5', w: 148 / 25.4, h: 210 / 25.4 },
  { id: 'a4', label: 'A4', w: 210 / 25.4, h: 297 / 25.4 },
  { id: 'a3', label: 'A3', w: 297 / 25.4, h: 420 / 25.4 },
  { id: 'a2', label: 'A2', w: 420 / 25.4, h: 594 / 25.4 },
  { id: '30x40cm', label: '30 × 40 cm', w: 300 / 25.4, h: 400 / 25.4 },
  { id: '50x70cm', label: '50 × 70 cm', w: 500 / 25.4, h: 700 / 25.4 },
] as const;
export type SizeId = (typeof SIZES)[number]['id'] | 'custom';

export const ARRANGEMENTS = [
  { id: 'single', label: 'Single', cols: 1, rows: 1 },
  { id: 'diptych', label: 'Diptych', cols: 2, rows: 1 },
  { id: 'triptych', label: 'Triptych', cols: 3, rows: 1 },
  { id: 'quad', label: '2 × 2', cols: 2, rows: 2 },
] as const;

export const DPIS = [150, 240, 300, 360] as const;

export type PrintDesign = {
  size: SizeId;
  /** The size of one print, in inches, as it hangs (already turned for landscape). */
  w: number; h: number;
  cols: number; rows: number;
  /** Space between prints on the wall. */
  gap: number;
  /** Crop as if the photo continues behind the gaps. */
  continuous: boolean;
  /** A plain border printed around the photo on each print. */
  border: number;
  borderColor: string;
  /** Extra photo past each trimmed edge, for labs that ask for it. */
  bleed: number;
  dpi: number;
  type: 'jpeg' | 'png';
  unit: 'in' | 'cm';
};

export const DEFAULT_PRINT: PrintDesign = {
  size: '8x10', w: 8, h: 10, cols: 3, rows: 1, gap: 2, continuous: true,
  border: 0, borderColor: '#ffffff', bleed: 0, dpi: 300, type: 'jpeg', unit: 'in',
};

export const arrangementName = (d: Pick<PrintDesign, 'cols' | 'rows'>) => {
  const n = d.cols * d.rows;
  return ARRANGEMENTS.find(a => a.cols === d.cols && a.rows === d.rows)?.label.toLowerCase().replace(' × ', 'x') ?? `${n}-panel`;
};

/**
 * One print: where it hangs on the wall (`panel`), where the photo shows on it in the print's own
 * coordinates including bleed (`dest`), and which part of the photo's layout that is (`window`).
 */
export type PanelJob = { index: number; panel: Rect; dest: Rect; window: Rect };

export type PrintLayout = {
  wall: { w: number; h: number };
  jobs: PanelJob[];
  /** The area the photo is cropped to cover: every window together. */
  cover: Rect;
};

export function printLayout(d: PrintDesign): PrintLayout {
  const grid = { rows: d.rows, cols: d.cols, w: d.w, h: d.h, gapX: d.gap, gapY: d.gap };
  const panels = panelRects(grid);
  const b = Math.min(d.border, d.w / 2 - 0.05, d.h / 2 - 0.05);
  // Bleed only carries photo when the photo reaches the trim; under a border it's just border color.
  const reach = b > 0 ? 0 : d.bleed;
  const iw = d.w - 2 * b, ih = d.h - 2 * b;
  // Where each photo area sits in the photo's own layout: on the wall, or packed edge to edge.
  const windows = d.continuous
    ? panels.map(p => inset(p, b))
    : panelRects({ ...grid, w: iw, h: ih, gapX: 0, gapY: 0 });
  const jobs = panels.map((panel, index) => ({
    index, panel,
    dest: inset({ x: d.bleed + b, y: d.bleed + b, w: iw, h: ih }, -reach),
    window: inset(windows[index], -reach),
  }));
  return { wall: sceneSize(grid), jobs, cover: bounds(jobs.map(j => j.window)) };
}

/** Where the photo lands in the photo layout (cropped to cover it, with zoom and pan). */
export const photoPlacement = (iw: number, ih: number, l: PrintLayout, v: View = NO_VIEW): Placement => place(iw, ih, l.cover, 'fill', v);

/** Photo pixels per printed inch, at the current crop. Under ~200 the print starts to look soft up close. */
export const effectivePpi = (q: Placement, l: PrintLayout) => q.sw / l.cover.w;

/** Pixel size of one exported print, including bleed. */
export const panelPixels = (d: PrintDesign, dpi = d.dpi) => ({ w: Math.round((d.w + 2 * d.bleed) * dpi), h: Math.round((d.h + 2 * d.bleed) * dpi) });

/** The highest dpi (at most the chosen one) whose prints fit the browser's canvas limits. */
export function fittingDpi(d: PrintDesign, limit: { area: number; side: number }) {
  const w = d.w + 2 * d.bleed, h = d.h + 2 * d.bleed;
  return Math.min(d.dpi, Math.floor(Math.sqrt(limit.area / (w * h))), Math.floor(limit.side / Math.max(w, h)));
}

/**
 * Draws one print in its own inch coordinates (0,0 is the top-left corner of the bleed): border
 * color everywhere, then the photo in its area, taken from that print's window of the photo layout.
 */
export function drawPanel(ctx: CanvasRenderingContext2D, d: PrintDesign, job: PanelJob, src: CanvasImageSource, q: Placement) {
  ctx.fillStyle = d.borderColor;
  ctx.fillRect(0, 0, d.w + 2 * d.bleed, d.h + 2 * d.bleed);
  ctx.save();
  ctx.beginPath(); ctx.rect(job.dest.x, job.dest.y, job.dest.w, job.dest.h); ctx.clip();
  ctx.translate(job.dest.x - job.window.x, job.dest.y - job.window.y);
  ctx.drawImage(src, q.sx, q.sy, q.sw, q.sh, q.dx, q.dy, q.dw, q.dh);
  ctx.restore();
}

/** Writes the print resolution into a JPEG's JFIF header (adding one if the encoder left it out). */
export function jpegWithDpi(jpg: Uint8Array, dpi: number) {
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  const isJfif = jpg[2] === 0xff && jpg[3] === 0xe0 && String.fromCharCode(...jpg.subarray(6, 11)) === 'JFIF\0';
  if (isJfif) {
    const out = jpg.slice();
    out[13] = 1; // dots per inch
    out[14] = d >> 8; out[15] = d & 255; out[16] = d >> 8; out[17] = d & 255;
    return out;
  }
  const app0 = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, d >> 8, d & 255, d >> 8, d & 255, 0, 0]);
  const out = new Uint8Array(jpg.length + app0.length);
  out.set(jpg.subarray(0, 2)); out.set(app0, 2); out.set(jpg.subarray(2), 2 + app0.length);
  return out;
}

const fmt = (inches: number, unit: 'in' | 'cm') => unit === 'cm' ? `${+(inches * 2.54).toFixed(1)}cm` : `${+inches.toFixed(2)}in`;

export function printName(base: string, d: PrintDesign, index: number, dpi: number) {
  const safe = base.replace(/[^\w\- ]+/g, '').trim() || 'print';
  const n = d.cols * d.rows, part = n > 1 ? ` ${index + 1} of ${n}` : '';
  const size = `${fmt(d.w, d.unit).replace(/(in|cm)$/, '')}x${fmt(d.h, d.unit)}`;
  return `${safe} - ${arrangementName(d)}${part} - ${size} ${dpi}dpi${d.bleed > 0 ? ' bleed' : ''}.${d.type === 'jpeg' ? 'jpg' : 'png'}`;
}
