// Contact sheets: many copies of the same photo on one negative, e.g. for toning tests (one copy
// per toning time). Pure layout math in inches; output.ts draws it.

export const PAPERS = {
  letter: { label: 'Letter (8.5 × 11 in)', w: 8.5, h: 11 },
  a4: { label: 'A4 (210 × 297 mm)', w: 8.27, h: 11.69 },
  '5x7': { label: '5 × 7 in', w: 5, h: 7 },
  '8x10': { label: '8 × 10 in', w: 8, h: 10 },
  '11x14': { label: '11 × 14 in', w: 11, h: 14 },
  a3: { label: 'A3 (297 × 420 mm)', w: 11.69, h: 16.54 },
} as const;
export type Paper = keyof typeof PAPERS | 'custom';

export type ContactSheet = {
  paper: Paper;
  /** Only used for a custom paper size, in inches. */
  paperW: number; paperH: number;
  landscape: boolean;
  /** 'grid': fit `cols` × `rows` photos as large as they go. 'size': as many `photoW`-wide photos as fit. */
  fit: 'grid' | 'size';
  cols: number; rows: number;
  photoW: number;
  /** Space between photos, in inches. */
  gap: number;
  /** Whether to print `labels` under the photos (the text is kept either way). */
  showLabels: boolean;
  /** One label per photo, comma-separated, printed under it ("15, 30, 60, 90 min"). */
  labels: string;
};

export const DEFAULT_SHEET: ContactSheet = {
  paper: 'letter', paperW: 8.5, paperH: 11, landscape: false,
  fit: 'grid', cols: 2, rows: 3, photoW: 2.5, gap: 0.25, showLabels: false, labels: '',
};

export const MAX_SHEET_PHOTOS = 200;
/** Height reserved under each photo for its label, and the label's text size, in inches. */
export const LABEL_H = 0.26, LABEL_TEXT = 0.14;

/** The paper's width and height in inches, turned if landscape. */
export function paperSize(s: ContactSheet) {
  const { w, h } = s.paper === 'custom' ? { w: s.paperW, h: s.paperH } : PAPERS[s.paper] ?? PAPERS.letter;
  const [a, b] = [Math.min(w, h), Math.max(w, h)];
  return s.landscape ? { w: b, h: a } : { w: a, h: b };
}

/** The label text that gets printed: none when labels are turned off. */
export const printedLabels = (s: ContactSheet) => (s.showLabels ? s.labels : '');

/**
 * The labels for `count` photos. Bare numbers pick up the unit written after the last one, so
 * "15, 30, 60, 90 min" labels them "15 min", "30 min"… Photos without a label get ''.
 */
export function sheetLabels(text: string, count: number) {
  const parts = text.split(/[,;\n]+/).map(t => t.trim()).filter(Boolean);
  const unit = parts.length ? parts[parts.length - 1].match(/^[\d.]+\s*([^\d\s.].*)$/)?.[1] : undefined;
  return Array.from({ length: count }, (_, i) => {
    const t = parts[i] ?? '';
    return unit && /^[\d.]+$/.test(t) ? `${t} ${unit}` : t;
  });
}

export type SheetLayout = {
  /** Paper size, in inches. */
  paper: { w: number; h: number };
  cols: number; rows: number;
  /** Each photo's size, in inches (labels go below, in `labelH`). */
  photo: { w: number; h: number };
  labelH: number;
  /** Top-left corner of each photo, row by row, in inches. */
  cells: { x: number; y: number }[];
  /** Why nothing fits, if it doesn't. */
  error: string | null;
};

/**
 * Where the photos go on the sheet. `ratio` is the cropped photo's width ÷ height, `margin` the
 * empty space kept around the edge of the paper. The grid is centred on the paper.
 */
export function sheetLayout(s: ContactSheet, ratio: number, margin: number): SheetLayout {
  const paper = paperSize(s), gap = Math.max(0, s.gap), labelH = printedLabels(s).trim() ? LABEL_H : 0;
  const aw = paper.w - 2 * margin, ah = paper.h - 2 * margin;
  let cols: number, rows: number, w: number;
  if (s.fit === 'grid') {
    cols = Math.max(1, Math.round(s.cols)); rows = Math.max(1, Math.round(s.rows));
    w = Math.min((aw - (cols - 1) * gap) / cols, ((ah - (rows - 1) * gap) / rows - labelH) * ratio);
  } else {
    w = s.photoW;
    cols = Math.floor((aw + gap) / (w + gap) + 1e-9);
    rows = Math.floor((ah + gap) / (w / ratio + labelH + gap) + 1e-9);
  }
  const h = w / ratio;
  const fail = (error: string): SheetLayout => ({ paper, cols: 0, rows: 0, photo: { w: 0, h: 0 }, labelH, cells: [], error });
  if (!(aw > 0 && ah > 0)) return fail('The border is wider than the paper.');
  if (!(w > 0.1) || cols < 1 || rows < 1) {
    return fail(s.fit === 'grid' ? 'That many photos don’t fit on this paper.' : 'A photo that size doesn’t fit on this paper.');
  }
  if (cols * rows > MAX_SHEET_PHOTOS) return fail(`That’s more than ${MAX_SHEET_PHOTOS} photos. Make them bigger.`);
  const gw = cols * w + (cols - 1) * gap, gh = rows * (h + labelH) + (rows - 1) * gap;
  const x0 = (paper.w - gw) / 2, y0 = (paper.h - gh) / 2;
  const cells = Array.from({ length: cols * rows }, (_, i) => ({
    x: x0 + (i % cols) * (w + gap), y: y0 + Math.floor(i / cols) * (h + labelH + gap),
  }));
  return { paper, cols, rows, photo: { w, h }, labelH, cells, error: null };
}
