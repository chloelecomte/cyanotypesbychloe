// Post layout: Instagram formats, where each photo goes on the canvas, and which part of it shows.
// Every distance is a fraction of the canvas width, so the preview and the export match exactly.
import type { Rect } from '@/lib/panels/geometry';

export { NO_VIEW, panBy, place, type Fit, type Placement, type Rect, type View } from '@/lib/panels/geometry';

export const FORMATS = [
  { id: 'portrait', label: 'Portrait', ratio: '4:5', w: 1080, h: 1350 },
  { id: 'grid', label: 'Tall', ratio: '3:4', w: 1080, h: 1440 },
  { id: 'square', label: 'Square', ratio: '1:1', w: 1080, h: 1080 },
  { id: 'landscape', label: 'Landscape', ratio: '1.91:1', w: 1080, h: 566 },
  { id: 'story', label: 'Story', ratio: '9:16', w: 1080, h: 1920 },
] as const;
export type FormatId = (typeof FORMATS)[number]['id'];
export const format = (id: FormatId) => FORMATS.find(f => f.id === id) ?? FORMATS[0];

/** Fixed width:height for collage cells, or 'auto' to fill the space left by the margins. */
export const CELL_RATIOS = ['auto', '1:1', '4:5', '3:4', '2:3', '3:2'] as const;
export type CellRatio = (typeof CELL_RATIOS)[number];
const ratioValue = (r: CellRatio) => { const [w, h] = r.split(':').map(Number); return w / h; };

export type Grid = { rows: number; cols: number; margin: number; gap: number; cellRatio: CellRatio };

/** Cell rectangles in row order, centered on a W×H canvas. */
export function gridRects(W: number, H: number, g: Grid): Rect[] {
  const m = g.margin * W, gap = g.gap * W;
  let cw = Math.max(1, (W - 2 * m - (g.cols - 1) * gap) / g.cols);
  let ch = Math.max(1, (H - 2 * m - (g.rows - 1) * gap) / g.rows);
  if (g.cellRatio !== 'auto') {
    const r = ratioValue(g.cellRatio);
    if (cw / ch > r) cw = ch * r; else ch = cw / r;
  }
  const x0 = (W - (g.cols * cw + (g.cols - 1) * gap)) / 2, y0 = (H - (g.rows * ch + (g.rows - 1) * gap)) / 2;
  const rects: Rect[] = [];
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) rects.push({ x: x0 + c * (cw + gap), y: y0 + r * (ch + gap), w: cw, h: ch });
  return rects;
}

/** Rows × columns that hold n photos with the least empty space, preferring tall grids for tall posts. */
export function gridFor(n: number, W: number, H: number): { rows: number; cols: number } {
  let best = { rows: 1, cols: 1 }, bestScore = Infinity;
  for (let cols = 1; cols <= 6; cols++) for (let rows = 1; rows <= 6; rows++) {
    if (rows * cols < n) continue;
    const empty = rows * cols - n, shape = Math.abs(Math.log((W / cols) / (H / rows)));
    const score = empty * 2 + shape;
    if (score < bestScore) { best = { rows, cols }; bestScore = score; }
  }
  return best;
}
