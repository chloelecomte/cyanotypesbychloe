// A saved negative: the original photo plus its "recipe", everything needed to rebuild the
// negative at any size. Saved to the account (Supabase) or to a project file (.zip).
import type { Crop } from './canvas';
import { crc32 } from './files';
import type { Pt } from './math';
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from './types';

/** The edits that belong to one photo; the other settings (view, split…) are the editor's. */
export const PHOTO_KEYS = ['aspect', 'bw', 'tone', 'curve', 'curveAuto', 'print'] as const;
export type PhotoSettings = Pick<Settings, typeof PHOTO_KEYS[number]>;
export const photoSettings = (s: Settings) => structuredClone(Object.fromEntries(PHOTO_KEYS.map(k => [k, s[k]]))) as PhotoSettings;

export type NegativeRecipe = {
  version: 1;
  rot: number;
  flip: boolean;
  crop: Crop | null;
  settings: PhotoSettings;
  /** The process profile it was made with ('model' for the generic one), and the generic model's knobs. */
  profile: string;
  model: Settings['model'];
};

/**
 * The recipe of a photo. The curve is always kept as it is (not auto-fitted): a negative that
 * printed well shouldn't change because a profile was recalibrated. Auto-fit refits it on request.
 */
export function recipeOf(photo: { rot: number; flip: boolean; crop: Crop | null }, settings: Settings): NegativeRecipe {
  const s = photoSettings(settings);
  return {
    version: 1, rot: photo.rot, flip: photo.flip, crop: photo.crop ? { ...photo.crop } : null,
    settings: { ...s, curveAuto: false }, profile: settings.profile, model: { ...settings.model },
  };
}

/** Compares recipes (and names), to tell whether a saved negative has unsaved changes. */
export const recipeKey = (name: string, r: NegativeRecipe) => JSON.stringify([name, r]);

const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
function parseCrop(c: unknown): Crop | null {
  if (!c || typeof c !== 'object') return null;
  const { x, y, w, h } = c as Record<string, unknown>;
  if (!num(x, 0, 1) || !num(y, 0, 1) || !num(w, 0, 1) || !num(h, 0, 1)) return null;
  const crop = { x, y, w, h } as Crop;
  return crop.w > 0 && crop.h > 0 && crop.x + crop.w <= 1.0001 && crop.y + crop.h <= 1.0001 ? crop : null;
}
function parseCurve(c: unknown): Pt[] | null {
  if (!Array.isArray(c) || c.length < 2) return null;
  const pts = c.filter((p): p is Pt => Array.isArray(p) && p.length === 2 && num(p[0], 0, 1) && num(p[1], 0, 1));
  return pts.length === c.length ? pts.map(([x, y]) => [x, y] as Pt) : null;
}

/** Reads a recipe from the database or a project file, filling in defaults for anything missing or invalid. */
export function parseRecipe(raw: unknown): NegativeRecipe {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (r.settings && typeof r.settings === 'object' ? r.settings : {}) as Record<string, unknown>;
  const merged = mergeSettings({ ...s, model: r.model });
  return {
    version: 1,
    rot: Number.isInteger(r.rot) && num(r.rot, 0, 3) ? r.rot as number : 0,
    flip: r.flip === true,
    crop: parseCrop(r.crop),
    settings: { ...photoSettings(merged), curve: parseCurve(s.curve) ?? DEFAULT_SETTINGS.curve, curveAuto: false },
    profile: typeof r.profile === 'string' && r.profile ? r.profile : 'model',
    model: merged.model,
  };
}

// ---------- Project files: a .zip with negative.json and the original photo ----------

export const PROJECT_FORMAT = 'cyanotype-negative';
export const PROJECT_SUFFIX = '.negative.zip';
const MANIFEST = 'negative.json';

export type Project = { name: string; recipe: NegativeRecipe; photo: Blob; photoName: string; info: string | null; profileName: string | null };

const PHOTO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/tiff': 'tif', 'image/heic': 'heic', 'image/heif': 'heif', 'image/gif': 'gif', 'image/avif': 'avif',
};
const PHOTO_TYPE = Object.fromEntries([...Object.entries(PHOTO_EXT).map(([t, e]) => [e, t]), ['jpeg', 'image/jpeg'], ['tiff', 'image/tiff']]);

/** A file name for the original photo: `original.<ext>`, from its type or its own name. */
export function photoFileName(photo: Blob, name?: string) {
  const fromName = name?.match(/\.([a-z0-9]{2,5})$/i)?.[1].toLowerCase();
  return `original.${PHOTO_EXT[photo.type] ?? fromName ?? 'jpg'}`;
}
/** A file name without characters that file systems reject. */
/** The MIME type a photo file name implies, or '' if unknown. */
export const photoTypeOf = (name: string) => PHOTO_TYPE[name.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() ?? ''] ?? '';

// ---------- Photos in account Storage ----------
// Storage takes at most 50 MB per file, so a bigger photo is stored as parts (`<path>.part1`…)
// and recorded as `<path>#<count>`. A path without `#` is a single file.

/** Part size, with room to spare under the 50 MB per-file limit. */
export const PHOTO_PART_BYTES = 40 * 1024 * 1024;
/** The photo's own path, and the Storage objects that hold it. */
export function photoObjects(photoPath: string) {
  const m = photoPath.match(/^(.*)#(\d+)$/);
  if (!m) return { path: photoPath, objects: [photoPath] };
  return { path: m[1], objects: Array.from({ length: +m[2] }, (_, i) => `${m[1]}.part${i + 1}`) };
}
/** How to store a photo of `size` bytes at `path`: the recorded path, and each object's byte range. */
export function photoLayout(path: string, size: number, partBytes = PHOTO_PART_BYTES) {
  if (size <= partBytes) return { photoPath: path, objects: [{ path, start: 0, end: size }] };
  const n = Math.ceil(size / partBytes), photoPath = `${path}#${n}`;
  return { photoPath, objects: photoObjects(photoPath).objects.map((o, i) => ({ path: o, start: i * partBytes, end: Math.min(size, (i + 1) * partBytes) })) };
}

export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim().slice(0, 120) || 'negative';

export async function buildProjectFile(p: Project): Promise<Blob> {
  const photoName = photoFileName(p.photo, p.photoName);
  const manifest = {
    format: PROJECT_FORMAT, version: 1, name: p.name, savedAt: new Date().toISOString(),
    photo: photoName, info: p.info, profileName: p.profileName, recipe: p.recipe,
  };
  return zip([
    { name: MANIFEST, data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
    { name: photoName, data: new Uint8Array(await p.photo.arrayBuffer()) },
  ]);
}

export async function readProjectFile(file: Blob): Promise<Project> {
  const files = await unzip(new Uint8Array(await file.arrayBuffer()));
  const manifestBytes = files.get(MANIFEST);
  if (!manifestBytes) throw new Error('This zip is not a negative project file.');
  let m: Record<string, unknown>;
  try { m = JSON.parse(new TextDecoder().decode(manifestBytes)); } catch { throw new Error('The project file is damaged.'); }
  if (m.format !== PROJECT_FORMAT) throw new Error('This zip is not a negative project file.');
  const photoName = typeof m.photo === 'string' ? m.photo : '';
  const bytes = files.get(photoName);
  if (!bytes) throw new Error('The project file has no photo in it.');
  return {
    name: typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 200) : 'Negative',
    recipe: parseRecipe(m.recipe),
    photo: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: photoTypeOf(photoName) }),
    photoName,
    info: typeof m.info === 'string' ? m.info : null,
    profileName: typeof m.profileName === 'string' ? m.profileName : null,
  };
}

// ---------- A minimal zip: writes stored (uncompressed) entries; reads stored and deflated ones ----------

type Entry = { name: string; data: Uint8Array };

export function zip(entries: Entry[]): Blob {
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name), crc = crc32(e.data), size = e.data.length;
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint32(14, crc, true); lv.setUint32(18, size, true); lv.setUint32(22, size, true); lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length), cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true); cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true); cd.set(name, 46);
    parts.push(local, e.data); central.push(cd);
    offset += local.length + size;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end].map(p => p as Uint8Array<ArrayBuffer>), { type: 'application/zip' });
}

export async function unzip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), out = new Map<string, Uint8Array>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This file is not a zip.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('The zip file is damaged.');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true), raw = buf.subarray(start, start + csize);
    // Archive tools put entries in a folder named after the zip; only the file name matters.
    const base = name.split('/').pop()!;
    if (method === 0) out.set(base, raw);
    else if (method === 8) out.set(base, await inflate(raw));
    else throw new Error('The zip uses a compression this app can’t read.');
  }
  return out;
}

async function inflate(data: Uint8Array) {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
