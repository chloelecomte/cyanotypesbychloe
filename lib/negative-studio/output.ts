// Full-resolution output: the printable negative, step tablets and the calibration sheet, plus
// saving and printing them.
import { clamp } from './math';
import { cropPx, drawOriented, grayWeights, N, type Crop, type Fn, type Orientation, type Source } from './canvas';
import { withPhys } from './files';
import type { PrintSettings, Settings } from './types';

export async function pngWithDpi(canvas: HTMLCanvasElement, dpi: number) {
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('could not encode PNG');
  return new Blob([withPhys(new Uint8Array(await blob.arrayBuffer()), dpi)], { type: 'image/png' });
}
export function download(blob: Blob, name: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
/** Shows the canvas at its true size in a pop-up and opens the print dialog. */
export async function printInWindow(win: Window, c: HTMLCanvasElement, dpi: number, title: string, margin: string) {
  const url = URL.createObjectURL(await pngWithDpi(c, dpi));
  const wi = c.width / dpi, hi = c.height / dpi;
  win.document.write(`<!doctype html><title>${title}</title><style>@page{margin:${margin}}html,body{margin:0;background:#fff}img{display:block;width:${wi}in;height:${hi}in}</style>
    <p style="font:13px sans-serif;margin:10px" class="np">Print at <b>100% scale</b> (not "fit to page"). ${wi.toFixed(2)} × ${hi.toFixed(2)} in.</p>
    <style>@media print{.np{display:none}}</style><img src="${url}" onload="setTimeout(()=>print(),300)">`);
  win.document.close();
}

export type Photo = Orientation & { src: Source; crop: Crop | null };

export function printDims(p: PrintSettings, photo: Photo | null) {
  const cp = photo ? cropPx(photo.src, photo.rot, photo.crop) : { w: 4, h: 5 };
  const wIn = +p.width, hIn = wIn * cp.h / cp.w;
  return { wIn, hIn, Wpx: Math.round(wIn * p.dpi), Hpx: Math.round(hIn * p.dpi) };
}

function drawTablet(ctx: CanvasRenderingContext2D, curve: Fn, x: number, y: number, w: number, h: number, corrected: boolean, labelSize: number) {
  for (let i = 0; i < 21; i++) {
    const n = i / 20, v = Math.round(clamp(corrected ? curve(n) : n) * 255);
    const x0 = Math.round(x + i * w / 21), x1 = Math.round(x + (i + 1) * w / 21);
    ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x0, y, x1 - x0, h);
    if (labelSize) {
      ctx.fillStyle = v < 128 ? '#bbb' : '#444'; ctx.font = `${labelSize}px Helvetica,Arial,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(String(i + 1), (x0 + x1) / 2, y + labelSize * 0.4);
    }
  }
}
function mirrored(canvas: HTMLCanvasElement) {
  const m = document.createElement('canvas'); m.width = canvas.width; m.height = canvas.height;
  const ctx = m.getContext('2d')!; ctx.translate(m.width, 0); ctx.scale(-1, 1); ctx.drawImage(canvas, 0, 0);
  return m;
}

/** The negative at print resolution: border, inverted and curved image, optional tablet, mirrored if asked. */
export function buildNegative(photo: Photo, p: PrintSettings, bw: Settings['bw'], neg: Uint8ClampedArray, curve: Fn) {
  const dpi = +p.dpi, { Wpx, Hpx } = printDims(p, photo);
  const b = Math.round(p.border * dpi), gap = Math.round(0.15 * dpi), tH = Math.round(0.4 * dpi);
  const TW = Wpx + 2 * b, TH = Hpx + 2 * b + (p.tablet ? gap + tH : 0);
  if (TW * TH > 120e6) throw new Error('That negative is too large to build. Reduce the width or resolution.');
  const out = document.createElement('canvas'); out.width = TW; out.height = TH;
  const octx = out.getContext('2d')!;
  octx.fillStyle = p.borderType === 'black' ? '#000' : '#fff'; octx.fillRect(0, 0, TW, TH);
  const tmp = document.createElement('canvas'); tmp.width = Wpx; tmp.height = Hpx;
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!, cp = cropPx(photo.src, photo.rot, photo.crop);
  drawOriented(tctx, photo.src, photo, Wpx / cp.w, cp.x, cp.y);
  const id = tctx.getImageData(0, 0, Wpx, Hpx), d = id.data, [wr, wg, wb] = grayWeights(bw), k = (N - 1) / 255;
  for (let j = 0; j < d.length; j += 4) {
    const v = neg[(clamp(wr * d[j] + wg * d[j + 1] + wb * d[j + 2], 0, 255) * k + 0.5) | 0];
    d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255;
  }
  octx.putImageData(id, b, b);
  if (p.tablet) drawTablet(octx, curve, b, b + Hpx + gap, Wpx, tH, p.tabletCorr, Math.round(tH * 0.28));
  return p.mirror ? mirrored(out) : out;
}
export function negativeName(name: string, p: PrintSettings, photo: Photo) {
  const { wIn, hIn } = printDims(p, photo);
  return `${name}_negative_${wIn.toFixed(1)}x${hIn.toFixed(1)}in_${p.dpi}dpi${p.mirror ? '_mirrored' : ''}.png`;
}

/** The simulated cyanotype print, for reference: up to `maxEdge` px on the long side, not mirrored. */
export function cyanotypePreview(photo: Photo, bw: Settings['bw'], cyan: Uint8ClampedArray, maxEdge = 3000) {
  const cp = cropPx(photo.src, photo.rot, photo.crop), s = Math.min(1, maxEdge / Math.max(cp.w, cp.h));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(cp.w * s)); c.height = Math.max(1, Math.round(cp.h * s));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  drawOriented(ctx, photo.src, photo, s, cp.x, cp.y);
  const id = ctx.getImageData(0, 0, c.width, c.height), d = id.data, [wr, wg, wb] = grayWeights(bw), k = (N - 1) / 255;
  for (let j = 0; j < d.length; j += 4) {
    const i = ((clamp(wr * d[j] + wg * d[j + 1] + wb * d[j + 2], 0, 255) * k + 0.5) | 0) * 3;
    d[j] = cyan[i]; d[j + 1] = cyan[i + 1]; d[j + 2] = cyan[i + 2]; d[j + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}
export async function jpeg(canvas: HTMLCanvasElement, quality = 0.92) {
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', quality));
  if (!blob) throw new Error('could not encode JPEG');
  return blob;
}

/** A single 21-step tablet strip at 300 dpi, mirrored. */
export function tabletCanvas(curve: Fn, corrected: boolean) {
  const dpi = 300, pw = Math.round(0.35 * dpi), ph = Math.round(0.9 * dpi), m = Math.round(0.3 * dpi), lab = Math.round(0.25 * dpi);
  const c = document.createElement('canvas'); c.width = pw * 21 + 2 * m; c.height = ph + 2 * m + lab;
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  drawTablet(ctx, curve, m, m + lab, pw * 21, ph, corrected, 0);
  ctx.fillStyle = '#fff'; ctx.font = `${Math.round(lab * 0.6)}px Helvetica,Arial,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 21; i++) ctx.fillText(String(i + 1), m + (i + 0.5) * pw, m + lab / 2);
  ctx.textAlign = 'left'; ctx.font = `${Math.round(lab * 0.45)}px Helvetica,Arial,sans-serif`;
  ctx.fillText(corrected ? 'Step tablet · current curve' : 'Step tablet · linear (for calibration)', m, c.height - m / 2);
  return mirrored(c);
}

// ---------- Calibration sheet: a band per exposure time, each with a linear and a current-curve tablet ----------
export const SHEETS = { letter: [8.5, 11], a4: [8.27, 11.69] } as const;
export type SheetSize = keyof typeof SHEETS;
export const MAX_BANDS = 6;
export const fmtMin = (v: number) => `${+v.toFixed(2)} min`;
export const bandName = (i: number) => String.fromCharCode(65 + i);

/** Exposure times in minutes, sorted and de-duplicated, or null if any entry isn't a positive number. */
export function parseSheetTimes(text: string) {
  const vals = text.split(/[\s,;]+/).filter(Boolean).map(Number);
  if (!vals.length || vals.some(v => !isFinite(v) || v <= 0)) return null;
  return [...new Set(vals)].sort((a, b) => a - b).slice(0, MAX_BANDS);
}
export function sheetSchedule(times: number[]) {
  return times.map((t, i) => i < times.length - 1 ? `${fmtMin(t)}: cover ${bandName(i)}` : `${fmtMin(t)}: stop`).join(' · ');
}
export function sheetCanvas(times: number[], size: SheetSize, curve: Fn, linearCurve: boolean, profileName: string) {
  const dpi = 300, px = (inches: number) => Math.round(inches * dpi);
  const [wIn, hIn] = SHEETS[size], c = document.createElement('canvas'); c.width = px(wIn); c.height = px(hIn);
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  const m = px(0.4), pw = Math.min(px(0.35), Math.floor((c.width - 2 * m) / 21)), tw = pw * 21, x0 = Math.round((c.width - tw) / 2);
  const font = (inches: number, bold = false) => { ctx.font = `${bold ? 'bold ' : ''}${px(inches)}px Helvetica,Arial,sans-serif`; };
  const head = px(0.55), foot = px(0.3), n = times.length, bandH = (c.height - 2 * m - head - foot) / n;
  // Each band: [gap for the cover edge][band label][numbers][caption + linear row][caption + curve row]
  const gap = px(0.25), lab = px(0.24), nums = px(0.17), cap = px(0.15), rowGap = px(0.05);
  const rowH = Math.min(px(0.9), Math.floor((bandH - gap - lab - nums - 2 * cap - rowGap) / 2));
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  font(0.17, true); ctx.fillText('Cyanotype calibration sheet · linear vs. current curve', x0, m + px(0.12));
  font(0.11); ctx.fillText(`${profileName} · ${new Date().toLocaleDateString()} · print at 100%, ink side down`, x0, m + px(0.34));
  for (let b = 0; b < n; b++) {
    const top = Math.round(m + head + b * bandH);
    // Cover line above this band: the card edge goes here once band b-1's time is up (ticks in both margins, centred in the gap)
    if (b > 0) {
      const line = top + Math.round(gap / 2), tick = Math.max(2, px(0.012));
      ctx.fillRect(0, line - tick / 2, m - px(0.08), tick); ctx.fillRect(c.width - m + px(0.08), line - tick / 2, m - px(0.08), tick);
      font(0.1); ctx.textAlign = 'right'; ctx.fillText(`cover ${bandName(b - 1)} to here ▲`, x0 + tw, line);
    }
    let y = top + gap;
    font(0.16, true); ctx.textAlign = 'left'; ctx.fillText(`${bandName(b)}  ·  ${fmtMin(times[b])}`, x0, y + lab / 2); y += lab;
    font(0.1); ctx.textAlign = 'center';
    for (let i = 0; i < 21; i++) ctx.fillText(String(i + 1), x0 + (i + 0.5) * pw, y + nums / 2);
    y += nums;
    for (const corrected of [false, true]) {
      font(0.095); ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
      ctx.fillText(corrected ? `Current curve${linearCurve ? ' (linear — same as above)' : ''}` : 'Linear · use this row to calibrate', x0, y + cap / 2);
      y += cap; drawTablet(ctx, curve, x0, y, tw, rowH, corrected, 0); y += rowH + rowGap;
    }
  }
  ctx.fillStyle = '#fff'; font(0.1); ctx.textAlign = 'left';
  ctx.fillText(`Expose all, then slide a card down: ${sheetSchedule(times)}`, x0, c.height - m - foot / 2);
  return mirrored(c);
}
export const sheetName = (times: number[]) => `calibration-sheet_${times.join('-')}min_300dpi_mirrored.png`;
