import { describe, expect, it } from 'vitest';
import { buildProjectFile, parseRecipe, photoFileName, photoSettings, restoredPhotoSettings, photoLayout, photoObjects, photoTypeOf, readProjectFile, recipeKey, recipeOf, safeFileName, unzip, zip } from './negatives';
import { DEFAULT_SETTINGS, type Settings } from './types';

const edited: Settings = {
  ...structuredClone(DEFAULT_SETTINGS),
  tone: { ...DEFAULT_SETTINGS.tone, contrast: 12 },
  curve: [[0, 0], [0.4, 0.55], [1, 1]], curveAuto: true, profile: 'abc',
  print: { ...DEFAULT_SETTINGS.print, width: 12, dpi: 720 },
};
const photo = { rot: 1, flip: true, crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 } };

describe('restoredPhotoSettings', () => {
  it('fills in print settings a tab saved by an older version lacks', () => {
    const oldPrint: Partial<Settings['print']> = { ...edited.print };
    delete oldPrint.layout; delete oldPrint.sheet;
    const r = restoredPhotoSettings({ ...photoSettings(edited), print: oldPrint }, photoSettings(DEFAULT_SETTINGS));
    expect(r.print.sheet).toEqual(DEFAULT_SETTINGS.print.sheet);
    expect(r.print.layout).toBe('single');
    expect(r.print.width).toBe(12);
    expect(r.tone.contrast).toBe(12);
    expect(r.curve).toEqual(edited.curve);
  });
  it('keeps everything a current tab saved', () => {
    const s = photoSettings({ ...edited, print: { ...edited.print, layout: 'sheet', sheet: { ...edited.print.sheet, cols: 4, labels: '1, 2' } } });
    expect(restoredPhotoSettings(JSON.parse(JSON.stringify(s)), photoSettings(DEFAULT_SETTINGS))).toEqual(s);
  });
});

describe('recipes', () => {
  it('keeps the edits, and freezes the curve', () => {
    const r = recipeOf(photo, edited);
    expect(r.settings.curve).toEqual(edited.curve);
    expect(r.settings.curveAuto).toBe(false);
    expect(r.settings.print.width).toBe(12);
    expect(r.profile).toBe('abc');
    expect(r).not.toHaveProperty('settings.view');
  });

  it('reads back what it wrote', () => {
    const r = recipeOf(photo, edited);
    expect(parseRecipe(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(recipeKey('a', parseRecipe(r))).toBe(recipeKey('a', r));
  });

  it('fills in defaults for missing or broken values', () => {
    const r = parseRecipe({ rot: 7, flip: 'yes', crop: { x: 0.8, y: 0, w: 0.5, h: 1 }, settings: { curve: [[0, 0], ['x', 1]], print: { width: 'big', dpi: 360 } } });
    expect(r.rot).toBe(0);
    expect(r.flip).toBe(false);
    expect(r.crop).toBeNull();
    expect(r.settings.curve).toBe(DEFAULT_SETTINGS.curve);
    expect(r.settings.print.width).toBe(DEFAULT_SETTINGS.print.width);
    expect(r.profile).toBe('model');
    expect(parseRecipe(null).settings.tone).toEqual(DEFAULT_SETTINGS.tone);
  });
});

describe('project files', () => {
  it('zips and unzips', async () => {
    const a = new TextEncoder().encode('héllo'), b = new Uint8Array(1000).map((_, i) => i % 251);
    const files = await unzip(new Uint8Array(await zip([{ name: 'a.txt', data: a }, { name: 'dir/b.bin', data: b }]).arrayBuffer()));
    expect(files.get('a.txt')).toEqual(a);
    expect(files.get('b.bin')).toEqual(b);
  });

  it('round-trips a negative', async () => {
    const recipe = recipeOf(photo, edited), bytes = new Uint8Array([0xff, 0xd8, 1, 2, 3]);
    const file = await buildProjectFile({ name: 'Foggy forest', recipe, photo: new Blob([bytes], { type: 'image/jpeg' }), photoName: 'IMG_1.JPG', info: 'IMG_1.JPG · 10 × 10 px', profileName: 'Arches' });
    const p = await readProjectFile(file);
    expect(p.name).toBe('Foggy forest');
    expect(p.recipe).toEqual(recipe);
    expect(p.photoName).toBe('original.jpg');
    expect(p.photo.type).toBe('image/jpeg');
    expect(new Uint8Array(await p.photo.arrayBuffer())).toEqual(bytes);
    expect(p.profileName).toBe('Arches');
  });

  it('opens a project file that was unzipped and re-zipped (deflated, in a folder, with macOS extras)', async () => {
    const b64 = 'UEsDBBQAAAAIAN15dV1gb8CEWgAAAG4AAAATAAAARm9nZ3kvbmVnYXRpdmUuanNvbhWMQQqAMAwEvyI5q6BHH+A/QokxYJMSS6GIf9ccd2bYBw7zjBW2AVJHtdoLTUqMVRrBOEAjv8X0D5Z/KWaKdjfmHrqcVi2IubAoXnNRDuGUpET7gFv8r+/7AVBLAwQUAAAACADdeXVdP5kaGwkAAADMAAAAEgAAAEZvZ2d5L29yaWdpbmFsLnBuZ+sM8HNPHCYAAFBLAwQUAAAACADdeXVdOZz7BgYAAAAEAAAAHQAAAF9fTUFDT1NYL0ZvZ2d5Ly5fb3JpZ2luYWwucG5nyyrNywYAUEsBAhQDFAAAAAgA3Xl1XWBvwIRaAAAAbgAAABMAAAAAAAAAAAAAAIABAAAAAEZvZ2d5L25lZ2F0aXZlLmpzb25QSwECFAMUAAAACADdeXVdP5kaGwkAAADMAAAAEgAAAAAAAAAAAAAAgAGLAAAARm9nZ3kvb3JpZ2luYWwucG5nUEsBAhQDFAAAAAgA3Xl1XTmc+wYGAAAABAAAAB0AAAAAAAAAAAAAAIABxAAAAF9fTUFDT1NYL0ZvZ2d5Ly5fb3JpZ2luYWwucG5nUEsFBgAAAAADAAMAzAAAAAUBAAAAAA==';
    const p = await readProjectFile(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))]));
    expect(p.name).toBe('Foggy');
    expect(p.recipe.rot).toBe(2);
    expect(p.photo.type).toBe('image/png');
    expect(p.photo.size).toBe(204);
  });

  it('rejects other zips', async () => {
    const other = zip([{ name: 'readme.txt', data: new Uint8Array([1]) }]);
    await expect(readProjectFile(other)).rejects.toThrow(/not a negative project/);
    await expect(readProjectFile(new Blob([new Uint8Array(40)]))).rejects.toThrow(/not a zip/);
  });

  it('names files safely', () => {
    expect(photoFileName(new Blob([], { type: 'image/png' }))).toBe('original.png');
    expect(photoFileName(new Blob([]), 'scan.TIFF')).toBe('original.tiff');
    expect(photoFileName(new Blob([]))).toBe('original.jpg');
    expect(safeFileName('a/b:c?')).toBe('a-b-c-');
    expect(safeFileName('  ')).toBe('negative');
  });
});

describe('photos in Storage', () => {
  it('stores a small photo as one file', () => {
    expect(photoLayout('u/n/original.tif', 100, 100)).toEqual({ photoPath: 'u/n/original.tif', objects: [{ path: 'u/n/original.tif', start: 0, end: 100 }] });
    expect(photoObjects('u/n/original.tif')).toEqual({ path: 'u/n/original.tif', objects: ['u/n/original.tif'] });
  });
  it('splits a large photo into parts that cover every byte', () => {
    const l = photoLayout('u/n/original.tif', 250, 100);
    expect(l.photoPath).toBe('u/n/original.tif#3');
    expect(l.objects).toEqual([
      { path: 'u/n/original.tif.part1', start: 0, end: 100 },
      { path: 'u/n/original.tif.part2', start: 100, end: 200 },
      { path: 'u/n/original.tif.part3', start: 200, end: 250 },
    ]);
    expect(photoObjects(l.photoPath)).toEqual({ path: 'u/n/original.tif', objects: l.objects.map(o => o.path) });
  });
  it('knows the photo type from its name', () => {
    expect(photoTypeOf('u/n/original.TIF')).toBe('image/tiff');
    expect(photoTypeOf('original')).toBe('');
  });
});
