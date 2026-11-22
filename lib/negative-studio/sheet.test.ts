import { describe, expect, it } from 'vitest';
import { DEFAULT_SHEET, LABEL_H, paperSize, sheetLabels, sheetLayout, type ContactSheet } from './sheet';

const sheet = (s: Partial<ContactSheet>): ContactSheet => ({ ...DEFAULT_SHEET, ...s });
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('paperSize', () => {
  it('turns the paper for landscape, whichever way a custom size was typed', () => {
    expect(paperSize(sheet({ paper: 'letter' }))).toEqual({ w: 8.5, h: 11 });
    expect(paperSize(sheet({ paper: 'letter', landscape: true }))).toEqual({ w: 11, h: 8.5 });
    expect(paperSize(sheet({ paper: 'custom', paperW: 9, paperH: 6 }))).toEqual({ w: 6, h: 9 });
  });
});

describe('sheetLayout', () => {
  it('fits a grid as large as it goes, keeping the photo ratio', () => {
    // 5:7 photos, 2 × 3 on letter with a 0.5 in border: width-limited (3.625 in), height 5.075 → too tall,
    // so height-limited: (10 − 0.5) / 3 = 3.1667 tall → 2.2619 wide.
    const l = sheetLayout(sheet({ cols: 2, rows: 3, gap: 0.25 }), 5 / 7, 0.5);
    expect(l.error).toBeNull();
    near(l.photo.h, 9.5 / 3);
    near(l.photo.w, (9.5 / 3) * 5 / 7);
    expect(l.cells).toHaveLength(6);
    // Centred: equal space left and right.
    const right = l.cells[1].x + l.photo.w;
    near(l.cells[0].x, 8.5 - right);
    near(l.cells[0].y, 0.5);
  });

  it('fits as many photos of a given size as the paper holds', () => {
    // 2 × 3 in photos (2:3) on letter, 0.5 in border, 0.25 in gap: 7.5 wide → 3 across; 10 tall → 3 down.
    const l = sheetLayout(sheet({ fit: 'size', photoW: 2, gap: 0.25 }), 2 / 3, 0.5);
    expect([l.cols, l.rows]).toEqual([3, 3]);
    near(l.photo.h, 3);
    near(l.cells[4].x - l.cells[3].x, 2.25);
  });

  it('makes room for labels under each photo', () => {
    const plain = sheetLayout(sheet({ fit: 'size', photoW: 2, gap: 0.25 }), 2 / 3, 0.5);
    const labelled = sheetLayout(sheet({ fit: 'size', photoW: 2, gap: 0.25, showLabels: true, labels: '15, 30' }), 2 / 3, 0.5);
    const off = sheetLayout(sheet({ fit: 'size', photoW: 2, gap: 0.25, showLabels: false, labels: '15, 30' }), 2 / 3, 0.5);
    expect(off.labelH).toBe(0);
    expect(labelled.labelH).toBe(LABEL_H);
    near(labelled.cells[3].y - labelled.cells[0].y, 3 + LABEL_H + 0.25);
    expect(plain.labelH).toBe(0);
  });

  it('says when nothing fits', () => {
    expect(sheetLayout(sheet({ fit: 'size', photoW: 9 }), 1, 0.5).error).toMatch(/doesn’t fit/);
    expect(sheetLayout(sheet({ cols: 60, rows: 60 }), 1, 0.5).error).toBeTruthy();
    expect(sheetLayout(sheet({}), 1, 5).error).toMatch(/border/);
  });
});

describe('sheetLabels', () => {
  it('gives bare numbers the last unit, and pads with blanks', () => {
    expect(sheetLabels('15, 30, 60, 90 min', 6)).toEqual(['15 min', '30 min', '60 min', '90 min', '', '']);
    expect(sheetLabels('control; 1h, 2h', 3)).toEqual(['control', '1h', '2h']);
    expect(sheetLabels('', 2)).toEqual(['', '']);
  });
});
