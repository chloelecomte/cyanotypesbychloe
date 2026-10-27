// File formats: PNG resolution chunk, Photoshop .acv curves, 1D .cube / plain-number LUTs.
import { clamp, type Pt } from './math';

let crcTable: Uint32Array | null = null;
export function crc32(bytes: Uint8Array) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Insert a pHYs chunk right after IHDR so the PNG opens at the right physical size. */
export function withPhys(png: Uint8Array, dpi: number) {
  const ppm = Math.round(dpi / 0.0254), chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(png.length + 21);
  out.set(png.subarray(0, 33)); out.set(chunk, 33); out.set(png.subarray(33), 54);
  return out;
}

/** Photoshop .acv with our curve on the composite channel (points stored as output, input in 0..255). */
export function encodeAcv(points: Pt[]) {
  const ident = [[0, 0], [255, 255]];
  const curves = [points.map(p => [Math.round(p[1] * 255), Math.round(p[0] * 255)]), ident, ident, ident, ident];
  const len = 4 + curves.reduce((s, c) => s + 2 + c.length * 4, 0), dv = new DataView(new ArrayBuffer(len));
  let o = 0; dv.setInt16(o, 4); o += 2; dv.setInt16(o, curves.length); o += 2;
  for (const c of curves) { dv.setInt16(o, c.length); o += 2; for (const [out, inp] of c) { dv.setInt16(o, out); dv.setInt16(o + 2, inp); o += 4; } }
  return dv.buffer;
}

export function decodeAcv(buf: ArrayBuffer): Pt[] {
  const dv = new DataView(buf), n = dv.getInt16(4), pts: Pt[] = [];
  for (let i = 0; i < n; i++) pts.push([dv.getInt16(8 + i * 4) / 255, dv.getInt16(6 + i * 4) / 255]);
  return pts;
}

/** 1D LUT (.cube) or a plain list of numbers: use the first column, sampled to ~25 points. */
export function parseLutText(text: string): Pt[] {
  const rows = text.split(/\r?\n/).map(l => l.trim()).filter(l => /^[-\d.]/.test(l)).map(l => l.split(/[\s,;]+/).map(Number));
  const vals = rows.map(r => r[0]).filter(v => isFinite(v)), mx = Math.max(...vals) > 1.5 ? 255 : 1;
  if (vals.length < 2) throw new Error('not enough values');
  const step = Math.max(1, Math.round((vals.length - 1) / 24)), pts: Pt[] = [];
  for (let i = 0; i < vals.length; i += step) pts.push([i / (vals.length - 1), vals[i] / mx]);
  if (pts[pts.length - 1][0] < 1) pts.push([1, vals[vals.length - 1] / mx]);
  return pts;
}

/** Clamp, sort and de-duplicate imported points; flip curves made for the positive (as in EDN). */
export function normalizeImportedCurve(pts: Pt[], madeForPositive: boolean): Pt[] {
  if (madeForPositive) pts = pts.map(([x, y]) => [1 - x, 1 - y]);
  return pts
    .map(([x, y]): Pt => [clamp(x), clamp(y)])
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, a) => !i || p[0] - a[i - 1][0] > 0.004);
}
