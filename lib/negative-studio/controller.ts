// The Negative Studio UI: wires the static markup to the image pipeline and to cloud persistence.
// Image processing stays in the browser; photos are never uploaded. Only settings, profiles and
// curves go to Supabase through `repo`.
import { clamp, lstar, type Pt, type RGB } from './math';
import {
  countDistinct, curveFn, fitCurve as fitCurveFor, gradientStops, isLinear, LINEAR, makeGradientLUT,
  readingsToDarkness, responseFn as responseFor, toneFn as toneFor,
} from './pipeline';
import { decodeAcv, encodeAcv, normalizeImportedCurve, parseLutText, withPhys } from './files';
import { icon } from './icons';
import { MARKUP } from './markup';
import type { NewCalibration, Repo } from './repo';
import { DEFAULT_SETTINGS, mergeSettings, type Profile, type SavedCurve, type Settings, type StudioData, type StudioUser, type View } from './types';

const N = 4096;              // LUT resolution
const PREVIEW_MAX = 1600;    // preview long edge in px
const SAVE_DELAY = 800;      // ms of quiet before settings are written to the cloud

type Crop = { x: number; y: number; w: number; h: number };
type Source = ImageBitmap | HTMLImageElement;

export function mountStudio(root: HTMLElement, opts: { user: StudioUser; data: StudioData; repo: Repo }): () => void {
  const { user, data, repo } = opts;
  root.innerHTML = MARKUP;
  const ac = new AbortController(), signal = ac.signal;
  let destroyed = false;

  const $ = <T extends Element = HTMLElement>(s: string): T => {
    const el = root.querySelector<T>(s);
    if (!el) throw new Error(`Negative Studio: missing element ${s}`);
    return el;
  };
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  // ---------- State ----------
  let state: Settings = mergeSettings(data.settings);
  // These belong to a specific photo and are never saved.
  let rot = 0, flip = false, crop: Crop | null = null;
  const profiles: Profile[] = data.profiles.slice();
  const savedCurves: SavedCurve[] = data.curves.slice();

  // ---------- Cloud saving ----------
  let saveTimer: ReturnType<typeof setTimeout> | undefined, dirty = false, saving = false;
  const status = $('#saveStatus');
  // An icon on its own when things are fine; the text stays visible when saving failed.
  const STATUS = { busy: 'spinner', ok: 'cloudOk', err: 'cloudErr' } as const;
  const setStatus = (text: string, kind: keyof typeof STATUS) => {
    status.innerHTML = icon(STATUS[kind], 18) + `<span${kind === 'err' ? '' : ' class="sr-only"'}>${esc(text)}</span>`;
    status.title = text; status.className = 'savestatus ' + kind;
  };
  function saveState() {
    dirty = true; clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DELAY);
  }
  async function flushSave() {
    if (!dirty || saving) return;
    dirty = false; saving = true; setStatus('Saving…', 'busy');
    try { await repo.saveSettings(state); if (!destroyed) setStatus(dirty ? 'Saving…' : 'Saved', dirty ? 'busy' : 'ok'); }
    catch { dirty = true; if (!destroyed) setStatus('Not saved — will retry', 'err'); saveTimer = setTimeout(flushSave, 5000); }
    finally { saving = false; if (dirty && !destroyed) saveState(); }
  }
  // Something like a delete or a new profile: tell the user if the cloud call fails.
  async function cloud<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
    setStatus('Saving…', 'busy');
    try { const r = await fn(); setStatus('Saved', 'ok'); return r; }
    catch (e) { setStatus('Not saved', 'err'); alert(`Couldn't ${what}: ${(e as Error).message}`); return undefined; }
  }

  // ---------- Process model ----------
  function currentProfile() {
    return state.profile === 'model' ? null : profiles.find(p => p.id === state.profile && p.calibration) || null;
  }
  const currentCalibration = () => currentProfile()?.calibration ?? null;
  const responseFn = () => responseFor(currentCalibration(), state.model);
  const curve = () => curveFn(state.curve);
  const toneFn = () => toneFor(state.tone);
  function fitCurve() { state.curve = fitCurveFor(responseFn()); state.curveAuto = true; }

  // ---------- LUTs ----------
  const posLUT = new Uint8ClampedArray(N), negLUT = new Uint8ClampedArray(N), cyanLUT = new Uint8ClampedArray(N * 3);
  let gradLUT = makeGradientLUT(gradientStops(null));
  function buildLUTs() {
    const tone = toneFn(), C = curve(), R = responseFn();
    gradLUT = makeGradientLUT(gradientStops(currentCalibration()));
    for (let i = 0; i < N; i++) {
      const P = tone(i / (N - 1));
      posLUT[i] = P * 255 + 0.5;
      const n2 = clamp(C(1 - P));
      negLUT[i] = n2 * 255 + 0.5;
      const gi = Math.round(clamp(R(n2)) * 1023) * 3;
      cyanLUT[i * 3] = gradLUT[gi]; cyanLUT[i * 3 + 1] = gradLUT[gi + 1]; cyanLUT[i * 3 + 2] = gradLUT[gi + 2];
    }
  }

  // ---------- Image loading & orientation ----------
  let src: Source | null = null, srcName = '';
  let prev: { w: number; h: number; rgb: Uint8ClampedArray; gidx: Uint16Array } | null = null;
  let orientPrev: { canvas: HTMLCanvasElement; w: number; h: number } | null = null; // uncropped oriented preview (for crop mode)

  function orientedSize() {
    const s = src!;
    return rot % 2 ? { W: s.height, H: s.width } : { W: s.width, H: s.height };
  }
  function cropPx() {
    const { W, H } = orientedSize(), c = crop || { x: 0, y: 0, w: 1, h: 1 };
    return { x: c.x * W, y: c.y * H, w: c.w * W, h: c.h * H };
  }
  // Draw the oriented (rotated/flipped) source into ctx at scale s, offset by the crop origin
  function drawOriented(ctx: CanvasRenderingContext2D, s: number, cx: number, cy: number) {
    const img = src!, W = img.width, H = img.height, { W: Wo } = orientedSize();
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.scale(s, s); ctx.translate(-cx, -cy);
    if (flip) { ctx.translate(Wo, 0); ctx.scale(-1, 1); }
    if (rot === 1) { ctx.translate(H, 0); ctx.rotate(Math.PI / 2); }
    else if (rot === 2) { ctx.translate(W, H); ctx.rotate(Math.PI); }
    else if (rot === 3) { ctx.translate(0, W); ctx.rotate(-Math.PI / 2); }
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }
  function rebuildPreview() {
    if (!src) return;
    const { W, H } = orientedSize();
    // uncropped oriented preview
    const so = Math.min(1, PREVIEW_MAX / Math.max(W, H));
    const oc = document.createElement('canvas'); oc.width = Math.round(W * so); oc.height = Math.round(H * so);
    drawOriented(oc.getContext('2d')!, so, 0, 0);
    orientPrev = { canvas: oc, w: oc.width, h: oc.height };
    // cropped preview
    const cp = cropPx(), s = Math.min(1, PREVIEW_MAX / Math.max(cp.w, cp.h));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(cp.w * s)); c.height = Math.max(1, Math.round(cp.h * s));
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    drawOriented(ctx, s, cp.x, cp.y);
    const rgb = ctx.getImageData(0, 0, c.width, c.height).data;
    prev = { w: c.width, h: c.height, rgb, gidx: new Uint16Array(c.width * c.height) };
    recomputeGray();
  }
  function grayWeights() {
    const { r, g, b } = state.bw, s = Math.max(1, r + g + b);
    return [r / s, g / s, b / s];
  }
  function recomputeGray() {
    if (!prev) return;
    const [wr, wg, wb] = grayWeights(), { rgb, gidx } = prev, k = (N - 1) / 255;
    for (let i = 0, j = 0; i < gidx.length; i++, j += 4) {
      gidx[i] = clamp(wr * rgb[j] + wg * rgb[j + 1] + wb * rgb[j + 2], 0, 255) * k + 0.5;
    }
  }
  async function loadFile(file: File) {
    try {
      let img: Source;
      try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch {
        img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
      }
      if (destroyed) return;
      // A new photo starts from the current tab's edits, like the old single-photo studio did.
      openTab({
        id: nextTabId++, src: img, name: (file.name || 'photo').replace(/\.[^.]+$/, ''),
        info: `${file.name || 'photo'} · ${img.width} × ${img.height} px`,
        rot: 0, flip: false, crop: null, prev: null, orientPrev: null, settings: structuredClone(photoSettings()),
      });
    } catch {
      alert(`Sorry, ${file.name || 'this file'} couldn't be opened. Try exporting it as a JPEG, PNG or TIFF (TIFF works in Safari).`);
    }
  }
  async function loadFiles(files: File[]) {
    for (const f of files) { if (destroyed) return; await loadFile(f); }
  }

  // ---------- Photo tabs ----------
  // The live variables above (src, rot, crop, prev…) and the photo keys of `state` always belong to
  // the active tab; the other tabs keep their own copy until they are activated again.
  const PHOTO_KEYS = ['aspect', 'bw', 'tone', 'curve', 'curveAuto', 'print'] as const;
  type PhotoSettings = Pick<Settings, typeof PHOTO_KEYS[number]>;
  type Tab = {
    id: number; src: Source; name: string; info: string; rot: number; flip: boolean; crop: Crop | null;
    prev: typeof prev; orientPrev: typeof orientPrev; settings: PhotoSettings;
  };
  const tabs: Tab[] = [];
  let active: Tab | null = null, nextTabId = 1;
  const fileinfoDefault = $('#fileinfo').innerHTML;
  const photoSettings = () => Object.fromEntries(PHOTO_KEYS.map(k => [k, state[k]])) as PhotoSettings;
  function stashActive() {
    if (!active) return;
    if (cropMode) setCropMode(false);
    Object.assign(active, { src, name: srcName, rot, flip, crop, prev, orientPrev, settings: photoSettings() });
  }
  function activate(tab: Tab | null) {
    if (tab === active) return;
    stashActive(); drag = null; active = tab;
    if (tab) {
      ({ src, name: srcName, rot, flip, crop, prev, orientPrev } = tab);
      Object.assign(state, tab.settings);
      // The process profile is shared, so it may have changed since this tab was last shown.
      if (state.curveAuto || !state.curve) fitCurve();
      if (!prev) { applyAspect(); rebuildPreview(); }
    } else {
      src = null; srcName = ''; rot = 0; flip = false; crop = null; prev = null; orientPrev = null;
    }
    $('#fileinfo').innerHTML = tab ? esc(tab.info) : fileinfoDefault;
    $('#empty').classList.toggle('hidden', !!tab);
    syncControls(); renderTabs(); update('lut', false);
  }
  function openTab(tab: Tab) {
    // Every photo gets its own tab, placed after the active one.
    tabs.splice(active ? tabs.indexOf(active) + 1 : tabs.length, 0, tab);
    activate(tab);
  }
  function closeTab(tab: Tab) {
    const i = tabs.indexOf(tab);
    if (tab === active) activate(tabs[i + 1] ?? tabs[i - 1] ?? null);
    tabs.splice(i, 1);
    if ('close' in tab.src) tab.src.close();
    renderTabs();
  }
  function renderTabs() {
    const bar = $('#photoTabs');
    bar.querySelectorAll('.phototab').forEach(el => el.remove());
    for (const t of tabs) {
      const el = document.createElement('div');
      el.className = 'phototab' + (t === active ? ' on' : ''); el.role = 'tab'; el.ariaSelected = String(t === active);
      el.title = t.info;
      el.innerHTML = `<span class="name">${esc(t.name)}</span><button class="close" title="Close this photo" aria-label="Close ${esc(t.name)}">${icon('close', 14)}</button>`;
      el.onclick = () => activate(t);
      el.onauxclick = e => { if (e.button === 1) closeTab(t); };
      el.querySelector<HTMLButtonElement>('.close')!.onclick = e => { e.stopPropagation(); closeTab(t); };
      bar.insertBefore(el, $('#newTab'));
    }
    if (active) bar.querySelector('.phototab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ---------- Rendering ----------
  const view = $<HTMLCanvasElement>('#view'), vctx = view.getContext('2d')!;
  let cropMode = false, rafPending = false;
  type Kind = 'preview' | 'gray' | 'lut' | 'print';
  function update(kind: Kind, persist = true) {
    if (kind === 'preview') rebuildPreview();
    if (kind === 'gray') recomputeGray();
    if (kind !== 'print') buildLUTs();
    if (persist) saveState();
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => { rafPending = false; if (destroyed) return; render(); drawCurve(); drawStrip(); printInfo(); });
    }
  }
  function render() {
    if (cropMode && orientPrev) return renderCrop();
    if (!prev) { view.width = 10; view.height = 10; fitView(); return; }
    const { w, h, rgb, gidx } = prev, v = state.view;
    if (view.width !== w || view.height !== h) { view.width = w; view.height = h; fitView(); }
    const img = vctx.createImageData(w, h), d = img.data;
    const splitX = Math.round(state.split * w);
    for (let i = 0, j = 0; i < gidx.length; i++, j += 4) {
      let mode: View = v;
      if (v === 'compare') mode = (i % w) < splitX ? 'bw' : 'cyan';
      if (mode === 'orig') { d[j] = rgb[j]; d[j + 1] = rgb[j + 1]; d[j + 2] = rgb[j + 2]; }
      else if (mode === 'cyan') { const k = gidx[i] * 3; d[j] = cyanLUT[k]; d[j + 1] = cyanLUT[k + 1]; d[j + 2] = cyanLUT[k + 2]; }
      else { const g = mode === 'neg' ? negLUT[gidx[i]] : posLUT[gidx[i]]; d[j] = d[j + 1] = d[j + 2] = g; }
      d[j + 3] = 255;
    }
    vctx.putImageData(img, 0, 0);
    if (v === 'compare') {
      vctx.fillStyle = '#fff'; vctx.fillRect(splitX - 1, 0, 2, h);
      vctx.font = `${Math.max(12, w / 60)}px -apple-system,sans-serif`; vctx.fillStyle = 'rgba(0,0,0,.55)';
      const pad = w / 100;
      vctx.fillRect(pad, pad, w / 9, w / 40); vctx.fillRect(w - pad - w / 7, pad, w / 7, w / 40);
      vctx.fillStyle = '#fff'; vctx.textBaseline = 'middle';
      vctx.fillText('B&W', pad * 2, pad + w / 80); vctx.fillText('Cyanotype', w - pad - w / 7 + pad, pad + w / 80);
    }
  }
  function fitView() {
    const st = $('#stage'), pad = 32;
    const aw = st.clientWidth - pad, ah = st.clientHeight - pad;
    const s = Math.min(aw / view.width, ah / view.height);
    view.style.width = Math.max(1, view.width * s) + 'px'; view.style.height = Math.max(1, view.height * s) + 'px';
    view.style.visibility = (prev || cropMode) ? 'visible' : 'hidden';
  }
  const resizeObserver = new ResizeObserver(fitView);
  resizeObserver.observe($('#stage'));

  function viewPoint(e: PointerEvent) {
    const r = view.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * view.width, y: (e.clientY - r.top) / r.height * view.height };
  }

  // ---------- Crop mode ----------
  function aspectValue() {
    const a = state.aspect;
    if (a === 'free') return null;
    if (a === 'orig') { const { W, H } = orientedSize(); return W / H; }
    return +a;
  }
  function applyAspect() {
    if (!src) return;
    const r = aspectValue();
    if (!r) return;
    const { W, H } = orientedSize(), c = crop || { x: 0, y: 0, w: 1, h: 1 };
    let pw = c.w * W, ph = c.h * H; const cx = (c.x + c.w / 2) * W, cy = (c.y + c.h / 2) * H;
    if (pw / ph > r) pw = ph * r; else ph = pw / r;
    crop = { x: clamp((cx - pw / 2) / W, 0, 1 - pw / W), y: clamp((cy - ph / 2) / H, 0, 1 - ph / H), w: pw / W, h: ph / H };
  }
  function renderCrop() {
    const { canvas, w, h } = orientPrev!;
    if (view.width !== w || view.height !== h) { view.width = w; view.height = h; fitView(); }
    vctx.drawImage(canvas, 0, 0);
    const c = crop || { x: 0, y: 0, w: 1, h: 1 };
    const x = c.x * w, y = c.y * h, cw = c.w * w, ch = c.h * h;
    vctx.fillStyle = 'rgba(0,0,0,.6)';
    vctx.fillRect(0, 0, w, y); vctx.fillRect(0, y + ch, w, h - y - ch); vctx.fillRect(0, y, x, ch); vctx.fillRect(x + cw, y, w - x - cw, ch);
    vctx.strokeStyle = '#fff'; vctx.lineWidth = Math.max(1, w / 600); vctx.strokeRect(x, y, cw, ch);
    vctx.strokeStyle = 'rgba(255,255,255,.35)'; vctx.beginPath();
    for (let k = 1; k < 3; k++) { vctx.moveTo(x + cw * k / 3, y); vctx.lineTo(x + cw * k / 3, y + ch); vctx.moveTo(x, y + ch * k / 3); vctx.lineTo(x + cw, y + ch * k / 3); }
    vctx.stroke();
  }
  function setCropMode(on: boolean) {
    if (!src) return;
    cropMode = on;
    $('#cropbar').style.display = on ? 'flex' : 'none';
    $('#cropBtn').classList.toggle('on', on);
    if (!on) rebuildPreview();
    update('lut', false);
  }
  type Drag = { mode: 'move'; ox: number; oy: number } | { mode: 'new'; sx: number; sy: number } | { mode: 'split' };
  let drag: Drag | null = null;
  view.addEventListener('pointerdown', e => {
    if (!prev && !cropMode) return;
    view.setPointerCapture(e.pointerId);
    const p = viewPoint(e);
    if (cropMode) {
      const { w, h } = orientPrev!, c = crop || { x: 0, y: 0, w: 1, h: 1 };
      const nx = p.x / w, ny = p.y / h;
      const inside = crop && nx > c.x && nx < c.x + c.w && ny > c.y && ny < c.y + c.h;
      drag = inside ? { mode: 'move', ox: nx - c.x, oy: ny - c.y } : { mode: 'new', sx: nx, sy: ny };
    } else if (state.view === 'compare') {
      drag = { mode: 'split' }; state.split = clamp(p.x / view.width); render();
    }
  });
  view.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = viewPoint(e);
    if (drag.mode === 'split') { state.split = clamp(p.x / view.width); render(); return; }
    const { w, h } = orientPrev!, nx = clamp(p.x / w), ny = clamp(p.y / h);
    if (drag.mode === 'move') {
      const c = crop!;
      c.x = clamp(nx - drag.ox, 0, 1 - c.w); c.y = clamp(ny - drag.oy, 0, 1 - c.h);
    } else {
      const r = aspectValue();
      const x0 = drag.sx, y0 = drag.sy;
      let cw = Math.abs(nx - x0) * w, ch = Math.abs(ny - y0) * h;
      if (r) { if (cw / Math.max(ch, 1) > r) ch = cw / r; else cw = ch * r; }
      const dirx = nx < x0 ? -1 : 1, diry = ny < y0 ? -1 : 1;
      // keep inside the image
      const maxW = (dirx > 0 ? 1 - x0 : x0) * w, maxH = (diry > 0 ? 1 - y0 : y0) * h;
      const k = Math.min(1, maxW / Math.max(cw, 1e-6), maxH / Math.max(ch, 1e-6));
      if (r) { cw *= k; ch *= k; } else { cw = Math.min(cw, maxW); ch = Math.min(ch, maxH); }
      if (cw > 4 && ch > 4) crop = { x: dirx > 0 ? x0 : x0 - cw / w, y: diry > 0 ? y0 : y0 - ch / h, w: cw / w, h: ch / h };
    }
    renderCrop();
  });
  view.addEventListener('pointerup', () => { if (drag && drag.mode === 'split') saveState(); drag = null; });

  // ---------- Curve editor ----------
  const cv = $<HTMLCanvasElement>('#curve'), cctx = cv.getContext('2d')!;
  let hist: Float32Array | null = null, curveDrag = -1, hoverPt = -1, dragOff = false;
  function computeHist() {
    hist = null;
    if (!prev) return;
    const h = new Float32Array(64);
    const tone = toneFn(), toneIdx = new Uint8Array(N);
    for (let i = 0; i < N; i++) toneIdx[i] = Math.min(63, (1 - tone(i / (N - 1))) * 64);
    const g = prev.gidx;
    for (let i = 0; i < g.length; i += 3) h[toneIdx[g[i]]]++;
    let mx = 0; for (let i = 0; i < 64; i++) mx = Math.max(mx, h[i]);
    for (let i = 0; i < 64; i++) h[i] /= mx || 1;
    hist = h;
  }
  function drawCurve() {
    const W = cv.width, H = cv.height, P = 14, S = W - 2 * P;
    const X = (x: number) => P + x * S, Y = (y: number) => P + (1 - y) * S;
    cctx.clearRect(0, 0, W, H);
    computeHist();
    if (hist) {
      cctx.fillStyle = 'rgba(120,140,170,.18)';
      for (let i = 0; i < 64; i++) { const bh = hist[i] * S * 0.9; cctx.fillRect(X(i / 64), Y(0) - bh, S / 64 - 1, bh); }
    }
    // print-tone gradient bar along the bottom
    const R = responseFn();
    for (let i = 0; i < S; i++) {
      const gi = Math.round(clamp(R(i / S)) * 1023) * 3;
      cctx.fillStyle = `rgb(${gradLUT[gi]},${gradLUT[gi + 1]},${gradLUT[gi + 2]})`; cctx.fillRect(P + i, H - 8, 1, 6);
    }
    cctx.strokeStyle = '#2b3037'; cctx.lineWidth = 1; cctx.beginPath();
    for (let k = 0; k <= 4; k++) { cctx.moveTo(X(k / 4), Y(0)); cctx.lineTo(X(k / 4), Y(1)); cctx.moveTo(X(0), Y(k / 4)); cctx.lineTo(X(1), Y(k / 4)); }
    cctx.stroke();
    cctx.setLineDash([6, 6]); cctx.strokeStyle = '#4a515b'; cctx.beginPath(); cctx.moveTo(X(0), Y(0)); cctx.lineTo(X(1), Y(1)); cctx.stroke(); cctx.setLineDash([]);
    const C = curve();
    cctx.strokeStyle = '#8fb6ee'; cctx.lineWidth = 3; cctx.beginPath();
    for (let i = 0; i <= S; i++) { const x = i / S, y = clamp(C(x)); if (i) cctx.lineTo(X(x), Y(y)); else cctx.moveTo(X(x), Y(y)); }
    cctx.stroke();
    const pts = state.curve || LINEAR;
    pts.forEach((p, i) => {
      cctx.beginPath(); cctx.arc(X(p[0]), Y(p[1]), i === curveDrag || i === hoverPt ? 9 : 7, 0, 7);
      cctx.fillStyle = i === curveDrag ? '#fff' : '#17191c'; cctx.fill(); cctx.lineWidth = 2.5; cctx.strokeStyle = '#8fb6ee'; cctx.stroke();
    });
    const b = $('#curveBadge'), linear = isLinear(pts);
    b.textContent = linear ? 'Linear (no correction)' : state.curveAuto ? 'Auto-fitted' : 'Edited';
    b.className = 'badge' + (state.curveAuto && !linear ? ' auto' : '');
  }
  function curvePoint(e: MouseEvent) {
    const r = cv.getBoundingClientRect(), P = 14 / cv.width;
    return { x: ((e.clientX - r.left) / r.width - P) / (1 - 2 * P), y: 1 - ((e.clientY - r.top) / r.height - P) / (1 - 2 * P) };
  }
  function nearestPt(p: { x: number; y: number }) {
    const pts = state.curve || LINEAR; let best = -1, bd = 0.045;
    pts.forEach((q, i) => { const d = Math.hypot(q[0] - p.x, q[1] - p.y); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  cv.addEventListener('pointerdown', e => {
    if (!state.curve) state.curve = LINEAR.map(p => [...p] as Pt);
    const p = curvePoint(e); cv.setPointerCapture(e.pointerId);
    let i = nearestPt(p);
    if (i < 0) {
      const x = clamp(p.x), pts = state.curve;
      if (pts.some(q => Math.abs(q[0] - x) < 0.02)) return;
      pts.push([x, clamp(p.y)]); pts.sort((a, b) => a[0] - b[0]); i = pts.findIndex(q => q[0] === x);
    }
    curveDrag = i; dragOff = false; state.curveAuto = false; update('lut');
  });
  cv.addEventListener('pointermove', e => {
    const p = curvePoint(e);
    $('#curveReadout').textContent = (p.x >= 0 && p.x <= 1) ? `in ${Math.round(clamp(p.x) * 100)}% → out ${Math.round(clamp(curve()(clamp(p.x))) * 100)}%` : '';
    if (curveDrag < 0) { const h = state.curve ? nearestPt(p) : -1; if (h !== hoverPt) { hoverPt = h; drawCurve(); } return; }
    const pts = state.curve!, i = curveDrag, last = pts.length - 1;
    const minX = i === 0 ? 0 : pts[i - 1][0] + 0.01, maxX = i === last ? 1 : pts[i + 1][0] - 0.01;
    pts[i] = [+clamp(p.x, minX, maxX).toFixed(4), +clamp(p.y).toFixed(4)];
    dragOff = i > 0 && i < last && (p.y < -0.1 || p.y > 1.1);
    update('lut');
  });
  cv.addEventListener('pointerup', () => {
    if (curveDrag >= 0 && dragOff) state.curve!.splice(curveDrag, 1);
    curveDrag = -1; dragOff = false; update('lut');
  });
  cv.addEventListener('dblclick', e => {
    const i = nearestPt(curvePoint(e));
    if (state.curve && i > 0 && i < state.curve.length - 1) { state.curve.splice(i, 1); state.curveAuto = false; update('lut'); }
  });
  cv.addEventListener('pointerleave', () => { $('#curveReadout').textContent = ''; hoverPt = -1; drawCurve(); });

  // ---------- Tone strip ----------
  const stripC = $<HTMLCanvasElement>('#strip'), sctx = stripC.getContext('2d')!;
  function drawStrip() {
    const W = stripC.width, H = stripC.height, rowH = H / 3 - 4, C = curve(), R = responseFn(), pw = W / 21;
    const col = (d: number) => { const gi = Math.round(clamp(d) * 1023) * 3; return `rgb(${gradLUT[gi]},${gradLUT[gi + 1]},${gradLUT[gi + 2]})`; };
    sctx.clearRect(0, 0, W, H);
    const pred: number[] = [];
    for (let i = 0; i < 21; i++) {
      const P = i / 20, n = 1 - P, n2 = clamp(C(n)), d = clamp(R(n2)); pred.push(d);
      const x = Math.round(i * pw), w = Math.round((i + 1) * pw) - x;
      sctx.fillStyle = col(n); sctx.fillRect(x, 0, w, rowH);
      const g = Math.round(n2 * 255); sctx.fillStyle = `rgb(${g},${g},${g})`; sctx.fillRect(x, rowH + 6, w, rowH);
      sctx.fillStyle = col(d); sctx.fillRect(x, 2 * rowH + 12, w, rowH);
    }
    $('#distinct').textContent = String(countDistinct(pred));
  }

  // ---------- Export ----------
  async function pngWithDpi(canvas: HTMLCanvasElement, dpi: number) {
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('could not encode PNG');
    return new Blob([withPhys(new Uint8Array(await blob.arrayBuffer()), dpi)], { type: 'image/png' });
  }
  function download(blob: Blob, name: string) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  function printDims() {
    const p = state.print, cp = src ? cropPx() : { w: 4, h: 5 };
    const wIn = +p.width, hIn = wIn * cp.h / cp.w;
    return { wIn, hIn, Wpx: Math.round(wIn * p.dpi), Hpx: Math.round(hIn * p.dpi) };
  }
  function printInfo() {
    const p = state.print, { wIn, hIn, Wpx, Hpx } = printDims(), b = +p.border;
    const tw = wIn + 2 * b, th = hIn + 2 * b + (p.tablet ? 0.55 : 0);
    $('#printInfo').innerHTML = src
      ? `Image ${wIn.toFixed(2)} × ${hIn.toFixed(2)} in (${(wIn * 2.54).toFixed(1)} × ${(hIn * 2.54).toFixed(1)} cm) · ${Wpx} × ${Hpx} px<br>Whole negative incl. border${p.tablet ? ' &amp; tablet' : ''}: ${tw.toFixed(2)} × ${th.toFixed(2)} in`
      : 'Open a photo to see print sizes.';
    $('#viewInfo').textContent = src ? `${srcName} · prints ${wIn.toFixed(1)} × ${hIn.toFixed(1)} in` : '';
  }
  function drawTablet(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, corrected: boolean, labelSize: number) {
    const C = curve();
    for (let i = 0; i < 21; i++) {
      const n = i / 20, v = Math.round(clamp(corrected ? C(n) : n) * 255);
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
  async function buildNegative() {
    const p = state.print, dpi = +p.dpi, { Wpx, Hpx } = printDims();
    const b = Math.round(p.border * dpi), gap = Math.round(0.15 * dpi), tH = Math.round(0.4 * dpi);
    const TW = Wpx + 2 * b, TH = Hpx + 2 * b + (p.tablet ? gap + tH : 0);
    if (TW * TH > 120e6) throw new Error('too big');
    const out = document.createElement('canvas'); out.width = TW; out.height = TH;
    const octx = out.getContext('2d')!;
    octx.fillStyle = p.borderType === 'black' ? '#000' : '#fff'; octx.fillRect(0, 0, TW, TH);
    // image
    const tmp = document.createElement('canvas'); tmp.width = Wpx; tmp.height = Hpx;
    const tctx = tmp.getContext('2d', { willReadFrequently: true })!, cp = cropPx();
    drawOriented(tctx, Wpx / cp.w, cp.x, cp.y);
    const id = tctx.getImageData(0, 0, Wpx, Hpx), d = id.data, [wr, wg, wb] = grayWeights(), k = (N - 1) / 255;
    for (let j = 0; j < d.length; j += 4) {
      const v = negLUT[(clamp(wr * d[j] + wg * d[j + 1] + wb * d[j + 2], 0, 255) * k + 0.5) | 0];
      d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255;
    }
    octx.putImageData(id, b, b);
    if (p.tablet) drawTablet(octx, b, b + Hpx + gap, Wpx, tH, p.tabletCorr, Math.round(tH * 0.28));
    return p.mirror ? mirrored(out) : out;
  }
  async function withBusy(btn: HTMLButtonElement, fn: () => Promise<void>) {
    const t = btn.innerHTML; btn.disabled = true; btn.innerHTML = icon('spinner', 14) + 'Working…';
    await new Promise(r => setTimeout(r, 30));
    try { await fn(); }
    catch (e) { const m = (e as Error).message; alert(m === 'too big' ? 'That negative is too large to build — reduce the width or resolution.' : 'Something went wrong: ' + m); }
    finally { btn.disabled = false; btn.innerHTML = t; }
  }
  $<HTMLButtonElement>('#exportPng').onclick = e => {
    if (!src) return alert('Open a photo first.');
    withBusy(e.currentTarget as HTMLButtonElement, async () => {
      const c = await buildNegative(), p = state.print, { wIn, hIn } = printDims();
      download(await pngWithDpi(c, +p.dpi), `${srcName}_negative_${wIn.toFixed(1)}x${hIn.toFixed(1)}in_${p.dpi}dpi${p.mirror ? '_mirrored' : ''}.png`);
    });
  };
  $<HTMLButtonElement>('#printNow').onclick = e => {
    if (!src) return alert('Open a photo first.');
    const win = window.open('', '_blank');
    if (!win) return alert('Please allow pop-ups for this site to print.');
    withBusy(e.currentTarget as HTMLButtonElement, async () => printInWindow(win, await buildNegative(), +state.print.dpi, 'Negative', '0.25in'));
  };
  /** Shows the canvas at its true size in a pop-up and opens the print dialog. */
  async function printInWindow(win: Window, c: HTMLCanvasElement, dpi: number, title: string, margin: string) {
    const url = URL.createObjectURL(await pngWithDpi(c, dpi));
    const wi = c.width / dpi, hi = c.height / dpi;
    win.document.write(`<!doctype html><title>${title}</title><style>@page{margin:${margin}}html,body{margin:0;background:#fff}img{display:block;width:${wi}in;height:${hi}in}</style>
      <p style="font:13px sans-serif;margin:10px" class="np">Print at <b>100% scale</b> (not "fit to page"). ${wi.toFixed(2)} × ${hi.toFixed(2)} in.</p>
      <style>@media print{.np{display:none}}</style><img src="${url}" onload="setTimeout(()=>print(),300)">`);
    win.document.close();
  }
  function tabletCanvas(corrected: boolean) {
    const dpi = 300, pw = Math.round(0.35 * dpi), ph = Math.round(0.9 * dpi), m = Math.round(0.3 * dpi), lab = Math.round(0.25 * dpi);
    const c = document.createElement('canvas'); c.width = pw * 21 + 2 * m; c.height = ph + 2 * m + lab;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
    drawTablet(ctx, m, m + lab, pw * 21, ph, corrected, 0);
    ctx.fillStyle = '#fff'; ctx.font = `${Math.round(lab * 0.6)}px Helvetica,Arial,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < 21; i++) ctx.fillText(String(i + 1), m + (i + 0.5) * pw, m + lab / 2);
    ctx.textAlign = 'left'; ctx.font = `${Math.round(lab * 0.45)}px Helvetica,Arial,sans-serif`;
    ctx.fillText(corrected ? 'Step tablet · current curve' : 'Step tablet · linear (for calibration)', m, c.height - m / 2);
    return mirrored(c);
  }
  $('#dlTablet').onclick = async () => download(await pngWithDpi(tabletCanvas(false), 300), 'step-tablet-21_linear_300dpi_mirrored.png');
  $('#dlTabletCorr').onclick = async () => download(await pngWithDpi(tabletCanvas(true), 300), 'step-tablet-21_curve_300dpi_mirrored.png');

  // ---------- Calibration sheet: a band per exposure time, each with a linear and a current-curve tablet ----------
  const SHEETS = { letter: [8.5, 11], a4: [8.27, 11.69] } as const;
  const MAX_BANDS = 6;
  const fmtMin = (v: number) => `${+v.toFixed(2)} min`;
  const bandName = (i: number) => String.fromCharCode(65 + i);
  function sheetTimes() {
    const vals = $<HTMLInputElement>('#sheetTimes').value.split(/[\s,;]+/).filter(Boolean).map(Number);
    if (!vals.length || vals.some(v => !isFinite(v) || v <= 0)) return null;
    return [...new Set(vals)].sort((a, b) => a - b).slice(0, MAX_BANDS);
  }
  function sheetSchedule(times: number[]) {
    return times.map((t, i) => i < times.length - 1 ? `${fmtMin(t)}: cover ${bandName(i)}` : `${fmtMin(t)}: stop`).join(' · ');
  }
  function refreshSheetPlan() {
    const times = sheetTimes();
    $('#sheetPlan').innerHTML = !times
      ? '<span style="color:var(--warn)">Enter one or more exposure times in minutes, e.g. 5, 10, 15, 20.</span>'
      : `${times.length} band${times.length > 1 ? 's' : ''} (${times.map((t, i) => `${bandName(i)} = ${fmtMin(t)}`).join(', ')}). ` +
        `Start the clock with the sheet uncovered, then ${esc(sheetSchedule(times))}.` +
        (times.length === MAX_BANDS ? ` At most ${MAX_BANDS} bands fit on a page.` : '');
  }
  function sheetCanvas(times: number[], size: keyof typeof SHEETS) {
    const dpi = 300, px = (inches: number) => Math.round(inches * dpi);
    const [wIn, hIn] = SHEETS[size], c = document.createElement('canvas'); c.width = px(wIn); c.height = px(hIn);
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
    const m = px(0.4), pw = Math.min(px(0.35), Math.floor((c.width - 2 * m) / 21)), tw = pw * 21, x0 = Math.round((c.width - tw) / 2);
    const font = (inches: number, bold = false) => { ctx.font = `${bold ? 'bold ' : ''}${px(inches)}px Helvetica,Arial,sans-serif`; };
    const head = px(0.55), foot = px(0.3), n = times.length, bandH = (c.height - 2 * m - head - foot) / n;
    // Each band: [gap for the cover edge][band label][numbers][caption + linear row][caption + curve row]
    const gap = px(0.25), lab = px(0.24), nums = px(0.17), cap = px(0.15), rowGap = px(0.05);
    const rowH = Math.min(px(0.9), Math.floor((bandH - gap - lab - nums - 2 * cap - rowGap) / 2));
    const linearCurve = isLinear(state.curve || LINEAR), profileName = currentProfile()?.name ?? 'Generic cyanotype';
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
        y += cap; drawTablet(ctx, x0, y, tw, rowH, corrected, 0); y += rowH + rowGap;
      }
    }
    ctx.fillStyle = '#fff'; font(0.1); ctx.textAlign = 'left';
    ctx.fillText(`Expose all, then slide a card down: ${sheetSchedule(times)}`, x0, c.height - m - foot / 2);
    return mirrored(c);
  }
  const sheetName = (times: number[]) => `calibration-sheet_${times.join('-')}min_300dpi_mirrored.png`;
  $('#sheetTimes').addEventListener('input', refreshSheetPlan, { signal });
  refreshSheetPlan();
  $<HTMLButtonElement>('#dlSheet').onclick = e => {
    const times = sheetTimes(); if (!times) return alert('Enter one or more exposure times in minutes, e.g. 5, 10, 15, 20.');
    withBusy(e.currentTarget as HTMLButtonElement, async () =>
      download(await pngWithDpi(sheetCanvas(times, $<HTMLSelectElement>('#sheetSize').value as keyof typeof SHEETS), 300), sheetName(times)));
  };
  $<HTMLButtonElement>('#printSheet').onclick = e => {
    const times = sheetTimes(); if (!times) return alert('Enter one or more exposure times in minutes, e.g. 5, 10, 15, 20.');
    const win = window.open('', '_blank');
    if (!win) return alert('Please allow pop-ups for this site to print.');
    withBusy(e.currentTarget as HTMLButtonElement, async () =>
      printInWindow(win, sheetCanvas(times, $<HTMLSelectElement>('#sheetSize').value as keyof typeof SHEETS), 300, 'Calibration sheet', '0'));
  };

  // ---------- Curve files (.acv / .cube) ----------
  $('#exportAcv').onclick = () => download(new Blob([encodeAcv(state.curve || LINEAR)]), 'cyanotype-negative-curve.acv');
  $('#importCurve').onclick = () => $('#curveFile').click();
  $<HTMLInputElement>('#curveFile').onchange = async e => {
    const input = e.target as HTMLInputElement, f = input.files?.[0]; input.value = ''; if (!f) return;
    try {
      const pts = /\.acv$/i.test(f.name) ? decodeAcv(await f.arrayBuffer()) : parseLutText(await f.text());
      state.curve = normalizeImportedCurve(pts, $<HTMLInputElement>('#importPositive').checked);
      state.curveAuto = false; update('lut');
    } catch { alert("Couldn't read that curve file. Supported: Photoshop .acv and 1D LUT .cube files."); }
  };
  function refreshSavedCurves(selectId = '') {
    const s = $<HTMLSelectElement>('#savedCurves');
    const label = (c: SavedCurve) => {
      const p = c.profileId && profiles.find(p => p.id === c.profileId);
      return esc(c.name) + (p ? ` · ${esc(p.name)}` : '');
    };
    s.innerHTML = '<option value="">—</option>' + savedCurves.map(c => `<option value="${c.id}">${label(c)}</option>`).join('');
    s.value = selectId;
  }
  $('#saveCurve').onclick = async () => {
    const name = prompt('Name for this curve:', currentProfile()?.name || 'My cyanotype curve'); if (!name) return;
    const saved = await cloud('save the curve', () => repo.createCurve({ name, points: state.curve || LINEAR, profileId: currentProfile()?.id ?? null }));
    if (saved) { savedCurves.push(saved); refreshSavedCurves(saved.id); }
  };
  $<HTMLSelectElement>('#savedCurves').onchange = e => {
    const c = savedCurves.find(c => c.id === (e.target as HTMLSelectElement).value);
    if (c) { state.curve = structuredClone(c.points); state.curveAuto = false; update('lut'); }
  };
  $('#delCurve').onclick = async () => {
    const id = $<HTMLSelectElement>('#savedCurves').value, c = savedCurves.find(c => c.id === id);
    if (!c || !confirm(`Delete curve "${c.name}"?`)) return;
    if (await cloud('delete the curve', () => repo.deleteCurve(id).then(() => true))) {
      savedCurves.splice(savedCurves.indexOf(c), 1); refreshSavedCurves();
    }
  };

  // ---------- Controls ----------
  type SliderOpts = {
    label: string; min: number; max: number; step: number; def: number; kind: Kind;
    get: () => number; set: (v: number) => void; fmt: (v: number) => string; after?: () => void; title?: string;
  };
  const refreshers: (() => void)[] = [];
  function addSlider(parent: HTMLElement, o: SliderOpts) {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<label><span>${o.label}</span><output></output></label><input type="range" min="${o.min}" max="${o.max}" step="${o.step}">`;
    const inp = row.querySelector('input')!, out = row.querySelector('output')!;
    const sync = () => { inp.value = String(o.get()); out.textContent = o.fmt(o.get()); };
    inp.oninput = () => { o.set(+inp.value); out.textContent = o.fmt(+inp.value); o.after?.(); update(o.kind); };
    inp.ondblclick = () => { o.set(o.def); sync(); o.after?.(); update(o.kind); };
    if (o.title) row.title = o.title;
    sync(); refreshers.push(sync); parent.appendChild(row);
  }
  const pct = (v: number) => Math.round(v) + '%', signed = (v: number) => (v > 0 ? '+' : '') + Math.round(v);
  const FILTERS: Record<string, [number, number, number]> = { Neutral: [30, 59, 11], Red: [80, 20, 0], Orange: [60, 35, 5], Yellow: [45, 50, 5], Green: [20, 70, 10], Blue: [10, 20, 70] };
  for (const [name, [r, g, b]] of Object.entries(FILTERS)) {
    const btn = document.createElement('button'); btn.textContent = name;
    btn.onclick = () => { state.bw = { r, g, b }; refreshers.forEach(f => f()); update('gray'); };
    $('#filters').appendChild(btn);
  }
  (['r', 'g', 'b'] as const).forEach((k, i) =>
    addSlider($('#bwSliders'), { label: ['Red', 'Green', 'Blue'][i], min: 0, max: 150, step: 1, def: DEFAULT_SETTINGS.bw[k], get: () => state.bw[k], set: v => state.bw[k] = v, fmt: pct, kind: 'gray' }));
  const TONE: [keyof Settings['tone'], string, number, number, number, (v: number) => string][] = [
    ['exposure', 'Exposure', -2, 2, 0.05, v => (v > 0 ? '+' : '') + v.toFixed(2) + ' EV'],
    ['contrast', 'Contrast', -100, 100, 1, signed],
    ['highlights', 'Highlights', -100, 100, 1, signed],
    ['shadows', 'Shadows', -100, 100, 1, signed],
    ['black', 'Black point', 0, 50, 1, v => String(Math.round(v))],
    ['white', 'White point', 50, 100, 1, v => String(Math.round(v))],
    ['mid', 'Midtones', 0.5, 2, 0.01, v => v.toFixed(2)],
  ];
  TONE.forEach(([k, label, min, max, step, fmt]) =>
    addSlider($('#toneSliders'), { label, min, max, step, fmt, def: DEFAULT_SETTINGS.tone[k], get: () => state.tone[k], set: v => state.tone[k] = v, kind: 'lut' }));
  $('#toneReset').onclick = () => { state.tone = structuredClone(DEFAULT_SETTINGS.tone); refreshers.forEach(f => f()); update('lut'); };
  const refit = () => { if (state.curveAuto) fitCurve(); };
  addSlider($('#modelSliders'), {
    label: 'Print exposure', min: -2, max: 2, step: 0.1, def: 0, get: () => state.model.exposure, set: v => state.model.exposure = v,
    fmt: v => v === 0 ? 'normal' : (v > 0 ? '+' : '') + v.toFixed(1) + ' stops', kind: 'lut', after: refit,
    title: 'Longer exposure than standard makes everything darker and pushes highlight detail out of reach',
  });
  addSlider($('#modelSliders'), {
    label: 'Tonal range of the process', min: 0.4, max: 1, step: 0.01, def: 0.75, get: () => state.model.range, set: v => state.model.range = v,
    fmt: v => '≈ ' + Math.round(v * 21) + ' of 21 steps', kind: 'lut', after: refit,
    title: 'How many steps of an uncorrected 21-step tablet show as distinct tones in your prints',
  });

  function refreshProfiles() {
    const s = $<HTMLSelectElement>('#profile');
    s.innerHTML = '<option value="model">Generic cyanotype (estimate)</option>' +
      profiles.filter(p => p.calibration).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    if (!currentProfile()) state.profile = 'model';
    s.value = state.profile;
    $('#modelSliders').classList.toggle('hidden', state.profile !== 'model');
    const p = currentProfile(), meta = $('#profileMeta');
    if (p && p.calibration) {
      const mins = p.calibration.exposureSeconds ?? p.exposureSeconds;
      const bits = [p.paper, p.lightSource, p.sensitizer, mins != null ? `${+(mins / 60).toFixed(1)} min` : null,
        `calibrated ${new Date(p.calibration.measuredAt).toLocaleDateString()}`,
        p.calibrationCount > 1 ? `${p.calibrationCount} calibrations` : null];
      meta.textContent = bits.filter(Boolean).join(' · ');
    } else meta.textContent = '';
  }
  // Remembers the curve per profile, so coming back to a profile restores a hand-tuned curve.
  function selectProfile(id: string) {
    state.curveByProfile[state.profile] = { curve: state.curve, curveAuto: state.curveAuto };
    state.profile = id; refreshProfiles();
    const saved = state.curveByProfile[state.profile];
    if (saved && saved.curve && !saved.curveAuto) { state.curve = structuredClone(saved.curve); state.curveAuto = false; }
    else fitCurve();
    update('lut');
  }
  $<HTMLSelectElement>('#profile').onchange = e => selectProfile((e.target as HTMLSelectElement).value);
  $('#fitCurve').onclick = () => { fitCurve(); update('lut'); };
  $('#linCurve').onclick = () => { state.curve = LINEAR.map(p => [...p] as Pt); state.curveAuto = false; update('lut'); };

  // crop / rotate
  $('#rotL').onclick = () => { if (!src) return; rot = (rot + 3) % 4; crop = null; applyAspect(); update('preview', false); };
  $('#rotR').onclick = () => { if (!src) return; rot = (rot + 1) % 4; crop = null; applyAspect(); update('preview', false); };
  $('#flipH').onclick = () => { if (!src) return; flip = !flip; if (crop) crop.x = 1 - crop.x - crop.w; update('preview', false); };
  $<HTMLSelectElement>('#aspect').onchange = e => { state.aspect = (e.target as HTMLSelectElement).value; applyAspect(); update(cropMode ? 'lut' : 'preview'); };
  $('#cropBtn').onclick = () => setCropMode(!cropMode);
  $('#cropDone').onclick = () => setCropMode(false);
  $('#cropReset').onclick = () => { crop = null; applyAspect(); update(cropMode ? 'lut' : 'preview', false); };

  // print settings
  type PrintKey = keyof Settings['print'];
  const printSyncers: (() => void)[] = [];
  const bindInput = (id: string, key: PrintKey, num = false) => {
    const el = $<HTMLInputElement | HTMLSelectElement>(id), isCheck = el instanceof HTMLInputElement && el.type === 'checkbox';
    const sync = () => { if (isCheck) el.checked = !!state.print[key]; else el.value = String(state.print[key]); };
    el.onchange = el.oninput = () => {
      (state.print as Record<PrintKey, unknown>)[key] = isCheck ? (el as HTMLInputElement).checked : num ? Math.max(0, +el.value || 0) : el.value;
      update('print');
    };
    sync(); printSyncers.push(sync);
  };
  bindInput('#pWidth', 'width', true); bindInput('#pDpi', 'dpi', true); bindInput('#pBorder', 'border', true); bindInput('#pBorderType', 'borderType');
  bindInput('#pMirror', 'mirror'); bindInput('#pTablet', 'tablet'); bindInput('#pTabletCorr', 'tabletCorr');

  // views
  const viewButtons = [...root.querySelectorAll<HTMLButtonElement>('#views button')];
  const syncViews = () => viewButtons.forEach(x => x.classList.toggle('on', x.dataset.v === state.view));
  viewButtons.forEach(b => b.onclick = () => { state.view = b.dataset.v as View; syncViews(); update('print'); });

  // accordion
  root.querySelectorAll<HTMLElement>('section.step>h2').forEach(h => h.onclick = () => h.parentElement!.classList.toggle('closed'));

  // file open
  $('#drop').onclick = $('#newTab').onclick = () => $('#file').click();
  $<HTMLInputElement>('#file').onchange = e => { const input = e.target as HTMLInputElement; loadFiles([...(input.files ?? [])]); input.value = ''; };
  window.addEventListener('dragover', e => { e.preventDefault(); }, { signal });
  window.addEventListener('drop', e => {
    e.preventDefault();
    if ($<HTMLDialogElement>('#calDlg').open) return;
    loadFiles([...(e.dataTransfer?.files ?? [])].filter(f => f.type.startsWith('image/') || /\.(tiff?|heic)$/i.test(f.name)));
  }, { signal });

  // ---------- Calibration ----------
  let calReadings: { L: number[]; colors: RGB[] | null } | null = null;
  let scan: { canvas: HTMLCanvasElement; data: ImageData } | null = null, scanClicks: { x: number; y: number }[] = [];
  const calDlg = $<HTMLDialogElement>('#calDlg'), calTarget = $<HTMLSelectElement>('#calTarget');
  function refreshCalTargets() {
    calTarget.innerHTML = '<option value="new">A new process profile</option>' +
      profiles.map(p => `<option value="${p.id}">Re-test of “${esc(p.name)}” (keeps the history)</option>`).join('');
    calTarget.value = 'new';
    $('#calNewFields').classList.remove('hidden');
  }
  calTarget.onchange = () => $('#calNewFields').classList.toggle('hidden', calTarget.value !== 'new');
  $('#btnCalibrate').onclick = () => { refreshCalTargets(); calDlg.showModal(); drawCalChart(); };
  $('#calClose').onclick = () => calDlg.close();
  $('#btnHelp').onclick = () => $<HTMLDialogElement>('#helpDlg').showModal();
  $('#helpClose').onclick = () => $<HTMLDialogElement>('#helpDlg').close();
  $('#tabScan').onclick = () => { $('#tabScan').classList.add('on'); $('#tabType').classList.remove('on'); $('#paneScan').classList.remove('hidden'); $('#paneType').classList.add('hidden'); };
  $('#tabType').onclick = () => { $('#tabType').classList.add('on'); $('#tabScan').classList.remove('on'); $('#paneType').classList.remove('hidden'); $('#paneScan').classList.add('hidden'); };
  $('#loadScan').onclick = () => $('#scanFile').click();
  $<HTMLInputElement>('#scanFile').onchange = async e => {
    const input = e.target as HTMLInputElement, f = input.files?.[0]; input.value = ''; if (!f) return;
    try {
      const img = await createImageBitmap(f);
      const s = Math.min(1, 1800 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(img, 0, 0, c.width, c.height);
      scan = { canvas: c, data: ctx.getImageData(0, 0, c.width, c.height) }; scanClicks = [];
      const sc = $<HTMLCanvasElement>('#scanCanvas'); sc.width = c.width; sc.height = c.height; sc.classList.remove('hidden');
      drawScan();
    } catch { alert("Couldn't open that scan. Try a JPEG or PNG."); }
  };
  const sampleRadius = () => { const [a, b] = scanClicks; return Math.max(1, Math.hypot(b.x - a.x, b.y - a.y) / 20 * 0.28); };
  function drawScan() {
    if (!scan) return;
    const sc = $<HTMLCanvasElement>('#scanCanvas'), ctx = sc.getContext('2d')!;
    ctx.drawImage(scan.canvas, 0, 0);
    const msg = ['Click the centre of patch 1 (lightest).', 'Now click the centre of patch 21 (darkest).', 'Done — click again to start over.'][Math.min(2, scanClicks.length)];
    $('#scanStatus').textContent = msg;
    const r = Math.max(4, sc.width / 300);
    ctx.lineWidth = r / 2; ctx.strokeStyle = '#ff4d6d'; ctx.fillStyle = '#ff4d6d';
    if (scanClicks.length === 2) {
      const [a, b] = scanClicks, rad = sampleRadius();
      for (let i = 0; i < 21; i++) {
        const x = a.x + (b.x - a.x) * i / 20, y = a.y + (b.y - a.y) * i / 20;
        ctx.strokeRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    } else scanClicks.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill(); });
  }
  $<HTMLCanvasElement>('#scanCanvas').addEventListener('click', e => {
    if (!scan) return;
    const sc = e.currentTarget as HTMLCanvasElement, r = sc.getBoundingClientRect();
    const p = { x: (e.clientX - r.left) / r.width * sc.width, y: (e.clientY - r.top) / r.height * sc.height };
    if (scanClicks.length >= 2) scanClicks = [];
    scanClicks.push(p);
    if (scanClicks.length === 2) {
      const [a, b] = scanClicks, rad = Math.round(sampleRadius()), { data, width, height } = scan.data;
      const L: number[] = [], colors: RGB[] = [];
      for (let i = 0; i < 21; i++) {
        const cx = Math.round(a.x + (b.x - a.x) * i / 20), cy = Math.round(a.y + (b.y - a.y) * i / 20);
        let R = 0, G = 0, B = 0, n = 0;
        for (let y = Math.max(0, cy - rad); y <= Math.min(height - 1, cy + rad); y++)
          for (let x = Math.max(0, cx - rad); x <= Math.min(width - 1, cx + rad); x++) { const k = (y * width + x) * 4; R += data[k]; G += data[k + 1]; B += data[k + 2]; n++; }
        colors.push([R / n, G / n, B / n].map(Math.round) as RGB); L.push(lstar(R / n, G / n, B / n));
      }
      setReadings(L, colors);
    }
    drawScan();
  });
  $('#useTyped').onclick = () => {
    const vals = $<HTMLTextAreaElement>('#typedVals').value.split(/[\s,;]+/).filter(Boolean).map(Number).filter(isFinite);
    if (vals.length !== 21) return alert(`Please enter exactly 21 numbers (found ${vals.length}).`);
    setReadings(vals, null);
  };
  function setReadings(L: number[], colors: RGB[] | null) {
    if (L[0] < L[20]) { L = L.slice().reverse(); colors = colors && colors.slice().reverse(); } // clicked in the other direction
    calReadings = { L, colors };
    $<HTMLButtonElement>('#calSave').disabled = false;
    drawCalChart();
  }
  function drawCalChart() {
    const c = $<HTMLCanvasElement>('#calChart'), ctx = c.getContext('2d')!, W = c.width, H = c.height, P = 40;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#2b3037'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i <= 20; i++) { const x = P + i * (W - 2 * P) / 20; ctx.moveTo(x, P / 2); ctx.lineTo(x, H - P); }
    ctx.stroke();
    ctx.fillStyle = '#9aa3ad'; ctx.font = '20px -apple-system,sans-serif'; ctx.textAlign = 'center';
    for (let i = 0; i < 21; i++) ctx.fillText(String(i + 1), P + i * (W - 2 * P) / 20, H - P + 26);
    ctx.setLineDash([8, 8]); ctx.strokeStyle = '#4a515b'; ctx.beginPath(); ctx.moveTo(P, H - P); ctx.lineTo(W - P, P / 2); ctx.stroke(); ctx.setLineDash([]);
    if (!calReadings) { $('#calSummary').textContent = 'No readings yet. The dashed line is a perfectly even tablet.'; return; }
    const ds = readingsToDarkness(calReadings.L), colors = calReadings.colors;
    ctx.strokeStyle = '#8fb6ee'; ctx.lineWidth = 3; ctx.beginPath();
    ds.forEach((d, i) => { const x = P + i * (W - 2 * P) / 20, y = H - P - d * (H - 1.5 * P); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
    ds.forEach((d, i) => {
      const x = P + i * (W - 2 * P) / 20, y = H - P - d * (H - 1.5 * P);
      ctx.beginPath(); ctx.arc(x, y, 9, 0, 7);
      ctx.fillStyle = colors ? `rgb(${colors[i]})` : '#8fb6ee'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    });
    const distinct = countDistinct(ds);
    const first = ds.findIndex(d => d > 0.015) + 1, last = ds.findIndex(d => d > 0.985) + 1;
    $('#calSummary').innerHTML = `Your print shows <b>${distinct}</b> distinct tones out of 21. Tones start separating at patch ${Math.max(1, first)} and reach full blue at patch ${last || 21}. ` +
      (last && last < 15 ? '<span style="color:var(--warn)">Full blue is reached very early — the print may be overexposed.</span> ' : '') +
      (first > 7 ? '<span style="color:var(--warn)">Many light patches stay white — the print may be underexposed.</span>' : '');
  }
  const text = (id: string) => $<HTMLInputElement>(id).value.trim() || null;
  $<HTMLButtonElement>('#calSave').onclick = async e => {
    if (!calReadings) return;
    const btn = e.currentTarget as HTMLButtonElement;
    const minutes = parseFloat($<HTMLInputElement>('#calExposure').value);
    const exposureSeconds = isFinite(minutes) && minutes >= 0 ? Math.round(minutes * 60) : null;
    const cal: NewCalibration = {
      darkness: readingsToDarkness(calReadings.L), colors: calReadings.colors,
      readingsLstar: calReadings.L.map(v => +v.toFixed(2)), exposureSeconds, conditions: text('#calConditions'),
    };
    btn.disabled = true;
    let profileId: string | undefined;
    if (calTarget.value === 'new') {
      const p = await cloud('save the profile', () => repo.createProfile({
        name: text('#calName') || `Calibration ${new Date().toLocaleDateString()}`,
        paper: text('#calPaper'), lightSource: text('#calLight'), sensitizer: text('#calSensitizer'),
        printerFilm: text('#calPrinter'), exposureSeconds,
      }, cal));
      if (p) { profiles.push(p); profileId = p.id; }
    } else {
      const p = profiles.find(p => p.id === calTarget.value)!;
      const c = await cloud('save the calibration', () => repo.addCalibration(p.id, cal));
      if (c) { p.calibration = c; p.calibrationCount++; profileId = p.id; }
    }
    btn.disabled = false;
    if (!profileId) return;
    state.curveByProfile[state.profile] = { curve: state.curve, curveAuto: state.curveAuto };
    state.profile = profileId;
    refreshProfiles(); refreshSavedCurves(); fitCurve(); update('lut');
    calDlg.close();
  };
  $('#calDelete').onclick = async () => {
    const p = currentProfile(); if (!p) return alert('Select a calibrated profile in step 4 first.');
    const history = p.calibrationCount > 1 ? ` and all ${p.calibrationCount} of its calibrations` : '';
    if (!confirm(`Delete the profile "${p.name}"${history}? Curves saved with it are kept.`)) return;
    if (!(await cloud('delete the profile', () => repo.deleteProfile(p.id).then(() => true)))) return;
    profiles.splice(profiles.indexOf(p), 1);
    savedCurves.forEach(c => { if (c.profileId === p.id) c.profileId = null; });
    delete state.curveByProfile[p.id];
    state.profile = 'model'; refreshProfiles(); refreshSavedCurves(); fitCurve(); update('lut');
  };

  // ---------- Data from the previous, browser-only version ----------
  async function importLegacy() {
    const flag = 'cns.imported.' + user.id;
    const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem('cns.' + k); return v ? JSON.parse(v) : d; } catch { return d; } };
    if (read<string | null>('imported.' + user.id, null)) return;
    const cals = read<{ name: string; ds: number[]; colors: RGB[] | null }[]>('calibrations', [])
      .filter(c => c && Array.isArray(c.ds) && c.ds.length === 21);
    const curves = read<{ name: string; curve: Pt[] }[]>('curves', []).filter(c => c && Array.isArray(c.curve));
    const legacyState = data.settings ? null : read<Record<string, unknown> | null>('state', null);
    if (!cals.length && !curves.length && !legacyState) return;
    const what = [cals.length && `${cals.length} calibration${cals.length > 1 ? 's' : ''}`, curves.length && `${curves.length} curve${curves.length > 1 ? 's' : ''}`, legacyState && 'your settings']
      .filter(Boolean).join(', ');
    const remember = (v: string) => { try { localStorage.setItem(flag, JSON.stringify(v)); } catch { /* private mode */ } };
    if (!confirm(`This browser has ${what} from the earlier version of Negative Studio. Copy them to your account?`)) return remember('declined');
    const ids: Record<string, string> = {};
    const ok = await cloud('import your saved data', async () => {
      for (const [i, c] of cals.entries()) {
        const p = await repo.createProfile(
          { name: String(c.name || `Calibration ${i + 1}`).slice(0, 200), paper: null, lightSource: null, sensitizer: null, printerFilm: null, exposureSeconds: null },
          { darkness: c.ds, colors: Array.isArray(c.colors) && c.colors.length === 21 ? c.colors : null, readingsLstar: null, exposureSeconds: null, conditions: null },
        );
        profiles.push(p); ids['cal:' + i] = p.id;
      }
      for (const c of curves) savedCurves.push(await repo.createCurve({ name: String(c.name || 'Imported curve').slice(0, 200), points: c.curve, profileId: null }));
      return true;
    });
    if (!ok || destroyed) return;
    remember('done');
    if (legacyState) {
      const s = mergeSettings(legacyState);
      s.profile = ids[s.profile] ?? 'model';
      s.curveByProfile = {};
      state = s;
    }
    syncControls(); refreshSavedCurves();
    if (!state.curve) fitCurve();
    update('lut');
  }

  // ---------- Init ----------
  function syncControls() {
    refreshers.forEach(f => f()); printSyncers.forEach(f => f()); syncViews();
    $<HTMLSelectElement>('#aspect').value = state.aspect;
    refreshProfiles();
  }
  $('#userName').textContent = user.name;
  $('#userInitial').textContent = user.name.trim().charAt(0).toUpperCase();
  if (user.avatarUrl) { const img = $<HTMLImageElement>('#userAvatar'); img.src = user.avatarUrl; img.hidden = false; }
  syncControls(); refreshSavedCurves();
  if (!state.curve) fitCurve();
  update('lut', false);
  setStatus('Saved to your account', 'ok');
  importLegacy();

  // Best effort: write pending changes when the tab is hidden or closed.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { clearTimeout(saveTimer); flushSave(); } }, { signal });

  return () => {
    clearTimeout(saveTimer);
    if (dirty) flushSave();
    destroyed = true;
    ac.abort();
    resizeObserver.disconnect();
    for (const t of tabs) if ('close' in t.src) t.src.close();
  };
}
