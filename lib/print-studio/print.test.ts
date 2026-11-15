import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT, effectivePpi, fittingDpi, jpegWithDpi, photoPlacement, printLayout, printName, type PrintDesign } from './print';

const tri: PrintDesign = { ...DEFAULT_PRINT, w: 8, h: 10, cols: 3, rows: 1, gap: 2 };

describe('printLayout', () => {
  it('crops a continuous triptych across the gaps', () => {
    const l = printLayout(tri);
    expect(l.wall).toEqual({ w: 28, h: 10 });
    expect(l.cover).toEqual({ x: 0, y: 0, w: 28, h: 10 });
    expect(l.jobs[1].window).toEqual({ x: 10, y: 0, w: 8, h: 10 });
    expect(l.jobs[1].dest).toEqual({ x: 0, y: 0, w: 8, h: 10 });
  });
  it('packs the pieces edge to edge when the photo does not continue behind the gaps', () => {
    const l = printLayout({ ...tri, continuous: false });
    expect(l.cover.w).toBe(24);
    expect(l.jobs[2].window.x).toBe(16);
  });
  it('carries photo into the bleed, and keeps a border free of it', () => {
    const bleed = printLayout({ ...tri, bleed: 0.125 });
    expect(bleed.jobs[0].dest).toEqual({ x: 0, y: 0, w: 8.25, h: 10.25 });
    expect(bleed.jobs[1].window).toEqual({ x: 9.875, y: -0.125, w: 8.25, h: 10.25 });
    const border = printLayout({ ...tri, bleed: 0.125, border: 1 });
    expect(border.jobs[0].dest).toEqual({ x: 1.125, y: 1.125, w: 6, h: 8 });
    expect(border.jobs[1].window).toEqual({ x: 11, y: 1, w: 6, h: 8 });
  });
});

describe('resolution', () => {
  it('reports photo pixels per printed inch', () => {
    const l = printLayout(tri);
    expect(effectivePpi(photoPlacement(5600, 2000, l), l)).toBe(200);
  });
  it('lowers the dpi to fit the canvas limits', () => {
    expect(fittingDpi({ ...tri, w: 16, h: 20 }, { area: 16_777_216, side: 32767 })).toBe(228);
    expect(fittingDpi(tri, { area: 268_435_456, side: 32767 })).toBe(300);
  });
});

describe('files', () => {
  it('writes dpi into an existing JFIF header', () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
    const out = jpegWithDpi(jpg, 300);
    expect([...out.subarray(13, 18)]).toEqual([1, 1, 44, 1, 44]);
    expect(out.length).toBe(jpg.length);
  });
  it('adds a JFIF header when there is none', () => {
    const out = jpegWithDpi(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 2, 0xff, 0xd9]), 240);
    expect([...out.subarray(2, 4)]).toEqual([0xff, 0xe0]);
    expect([...out.subarray(15, 18)]).toEqual([240, 0, 240]);
    expect([...out.subarray(20)]).toEqual([0xff, 0xe1, 0, 2, 0xff, 0xd9]);
  });
  it('names files by arrangement, size and dpi', () => {
    expect(printName('Ferns!', tri, 0, 300)).toBe('Ferns - triptych 1 of 3 - 8x10in 300dpi.jpg');
    expect(printName('x', { ...tri, cols: 1, unit: 'cm', w: 300 / 25.4, h: 400 / 25.4, type: 'png' }, 0, 240)).toBe('x - single - 30x40cm 240dpi.png');
  });
});
