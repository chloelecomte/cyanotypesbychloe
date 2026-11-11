'use client';

// The left-hand side: layout, background, photos and export.
import { useRef, useState } from 'react';
import { Download, Images, LayoutGrid, Plus, RotateCcw, Share, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CELL_RATIOS, FORMATS, format, NO_VIEW, type CellRatio, type FormatId } from '@/lib/post-studio/layout';
import { exportName, exportPost, type Cell, type ExportSettings, type Photo } from '@/lib/post-studio/render';
import { download } from '@/lib/negative-studio/output';
import { cn } from '@/lib/utils';
import { BusyButton, SliderRow, SubHeading, Tip, useBusy } from '../negative-studio/controls';
import type { PostState } from './post-studio';
import { PHOTO_DRAG } from './stage';

const BACKGROUNDS = [
  ['#ffffff', 'White'], ['#f4efe4', 'Paper'], ['#e6e6e6', 'Light gray'], ['#1f2a44', 'Cyan night'], ['#000000', 'Black'],
] as const;
const pct = (v: number) => `${(v * 100).toFixed(1).replace(/\.0$/, '')}%`;
const onItem = 'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground';

export function Panel({ s }: { s: PostState }) {
  const { design: d } = s;
  return (
    <div className="p-4">
      <ToggleGroup
        type="single" variant="outline" className="w-full" value={d.mode} aria-label="Kind of post"
        onValueChange={v => v && s.update(x => ({ ...x, mode: v as typeof d.mode }))}
      >
        <ToggleGroupItem value="border" className={cn('flex-1', onItem)}><Square />Border</ToggleGroupItem>
        <ToggleGroupItem value="collage" className={cn('flex-1', onItem)}><LayoutGrid />Collage</ToggleGroupItem>
      </ToggleGroup>

      <SubHeading>Post shape</SubHeading>
      <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Post shape">
        {FORMATS.map(f => (
          <button
            key={f.id} type="button" role="radio" aria-checked={d.format === f.id} title={`${f.label} · ${f.w} × ${f.h}`}
            onClick={() => s.update(x => ({ ...x, format: f.id as FormatId }))}
            className={cn(
              'flex flex-col items-center gap-1 rounded-md border py-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground',
              d.format === f.id && 'border-primary bg-primary/15 text-foreground',
            )}
          >
            <span className="grid h-7 place-items-center">
              <span className="block border border-current" style={{ width: 22 * Math.min(1, f.w / f.h), height: 22 * Math.min(1, f.h / f.w) }} />
            </span>
            {f.ratio}
          </button>
        ))}
      </div>
      <Tip className="mt-1.5">{format(d.format).label}, {format(d.format).w} × {format(d.format).h}. Portrait 4:5 fills the most of the feed.</Tip>

      {d.mode === 'border' ? <BorderControls s={s} /> : <CollageControls s={s} />}

      <SubHeading>Background</SubHeading>
      <div className="flex items-center gap-2">
        {BACKGROUNDS.map(([c, name]) => (
          <button
            key={c} type="button" title={name} aria-label={`${name} background`} aria-pressed={d.background === c}
            onClick={() => s.update(x => ({ ...x, background: c }))}
            className={cn('size-7 rounded-full border border-white/20', d.background === c && 'ring-2 ring-primary ring-offset-2 ring-offset-card')}
            style={{ background: c }}
          />
        ))}
        <label className="relative ml-1 flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-white/30" title="Pick any color">
          <Plus className="size-3.5" />
          <input type="color" value={d.background} onChange={e => s.update(x => ({ ...x, background: e.target.value }))} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Custom background color" />
        </label>
      </div>

      <PhotoTray s={s} />
      <ExportControls s={s} />
    </div>
  );
}

function BorderControls({ s }: { s: PostState }) {
  const { design: d } = s;
  return <>
    <SubHeading>Border</SubHeading>
    <SliderRow
      label="Border width" value={d.border.margin} min={0} max={0.25} step={0.0025} def={0.08} format={pct}
      onChange={v => s.update(x => ({ ...x, border: { margin: v } }))}
      hint="The narrowest edge around the photo, as a share of the post's width. The photo is centered, so the other edges are wider when its shape differs from the post's."
    />
    <Tip>Add several photos to give them all the same border, then download them together for a carousel.</Tip>
  </>;
}

function CollageControls({ s }: { s: PostState }) {
  const { design: d, cells, photos } = s, c = d.collage;
  const sel = s.selected != null && s.selected < cells.length ? cells[s.selected] : null;
  return <>
    <SubHeading>Grid</SubHeading>
    <SliderRow label="Columns" value={c.cols} min={1} max={6} step={1} def={2} format={String} onChange={v => s.setCollage({ cols: v })} />
    <SliderRow label="Rows" value={c.rows} min={1} max={6} step={1} def={2} format={String} onChange={v => s.setCollage({ rows: v })} />
    {photos.length > 1 && (
      <Button variant="outline" size="sm" className="mt-1 w-full" onClick={s.fitGrid}>
        Fit the grid to {photos.length} photos
      </Button>
    )}
    <SliderRow label="Outer border" value={c.margin} min={0} max={0.2} step={0.0025} def={0.06} format={pct} onChange={v => s.setCollage({ margin: v })} />
    <SliderRow label="Space between" value={c.gap} min={0} max={0.1} step={0.0025} def={0.025} format={pct} onChange={v => s.setCollage({ gap: v })} />

    <SubHeading>Cell shape</SubHeading>
    <ToggleGroup type="single" variant="outline" size="sm" className="w-full" value={c.cellRatio} onValueChange={v => v && s.setCollage({ cellRatio: v as CellRatio })} aria-label="Cell shape">
      {CELL_RATIOS.map(r => <ToggleGroupItem key={r} value={r} className={cn('flex-1 px-0 text-xs', onItem)}>{r === 'auto' ? 'Auto' : r}</ToggleGroupItem>)}
    </ToggleGroup>
    <Tip className="mt-1.5">Auto stretches the cells to fill the post; a fixed shape centers the grid and makes the border wider where needed.</Tip>

    <SubHeading>Photos in cells</SubHeading>
    <ToggleGroup type="single" variant="outline" size="sm" className="w-full" value={c.fit} onValueChange={v => v && s.setCollage({ fit: v as 'fit' | 'fill' })} aria-label="Photos in cells">
      <ToggleGroupItem value="fill" className={cn('flex-1', onItem)}>Fill (crop)</ToggleGroupItem>
      <ToggleGroupItem value="fit" className={cn('flex-1', onItem)}>Whole photo</ToggleGroupItem>
    </ToggleGroup>
    <Tip className="mt-1.5">
      {c.fit === 'fill'
        ? <>Drag a photo to choose what shows, scroll over it to zoom, double-click to recenter. Drag photos from the list below onto cells to swap them.</>
        : <>Each photo is shown whole and centered in its cell. Drag photos from the list below onto cells to swap them.</>}
    </Tip>

    {sel?.photoId != null && c.fit === 'fill' && <>
      <SliderRow label={`Zoom, cell ${s.selected! + 1}`} value={sel.zoom} min={1} max={5} step={0.01} def={1} format={v => `${v.toFixed(2)}×`} onChange={v => s.setView(s.selected!, { zoom: v })} />
      <Button variant="ghost" size="sm" onClick={() => s.setView(s.selected!, NO_VIEW)}><RotateCcw />Recenter</Button>
    </>}
    {cells.some(x => x.photoId != null) && (
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={s.clearCells}><X />Empty all cells</Button>
    )}
  </>;
}

function PhotoTray({ s }: { s: PostState }) {
  const { photos, design: d, cells, borderPhoto } = s;
  const input = useRef<HTMLInputElement>(null);
  const used = new Set(cells.map(c => c.photoId));
  return <>
    <SubHeading className="mt-5 flex items-center">
      Photos{photos.length > 0 && ` · ${photos.length}`}
      <Button variant="ghost" size="sm" className="ml-auto h-6 normal-case tracking-normal" onClick={() => input.current?.click()}><Plus />Add</Button>
    </SubHeading>
    <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => { s.addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
    {photos.length === 0
      ? (
        <button type="button" onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-1 rounded-md border border-dashed py-6 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
          <Images className="size-5" />Add photos, or drop them anywhere
        </button>
      )
      : (
        <div className="grid grid-cols-4 gap-1.5">
          {photos.map(p => {
            const on = d.mode === 'border' ? borderPhoto?.id === p.id : used.has(p.id);
            return (
              <div key={p.id} className="group relative">
                <button
                  type="button" draggable title={d.mode === 'border' ? `Show ${p.name}` : `${p.name} · drag onto a cell, or click to place it`}
                  onDragStart={e => { e.dataTransfer.setData(PHOTO_DRAG, String(p.id)); e.dataTransfer.effectAllowed = 'move'; }}
                  onClick={() => s.placeFromTray(p.id)}
                  className={cn('block aspect-square w-full overflow-hidden rounded-md border-2 border-transparent bg-muted', on && 'border-primary', d.mode === 'collage' && !on && 'opacity-60')}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                  <img src={p.thumb} alt={p.name} className="size-full object-cover" draggable={false} />
                </button>
                <button
                  type="button" aria-label={`Remove ${p.name}`} title="Remove this photo"
                  onClick={() => s.removePhoto(p.id)}
                  className="absolute -top-1.5 -right-1.5 rounded-full bg-card p-0.5 text-muted-foreground opacity-0 shadow ring-1 ring-border transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
                ><X className="size-3" /></button>
              </div>
            );
          })}
        </div>
      )}
  </>;
}

function ExportControls({ s }: { s: PostState }) {
  const { design: d, ex, cells, photos, photoMap, borderPhoto } = s;
  const [busy, run] = useBusy();
  const [canShare] = useState(() => {
    try { return !!navigator.canShare?.({ files: [new File([''], 'post.jpg', { type: 'image/jpeg' })] }); } catch { return false; }
  });
  const f = format(d.format);
  const empty = d.mode === 'border' ? !borderPhoto : !cells.some(c => c.photoId != null);

  const jobs = (all: boolean): { cells: Cell[]; name: string }[] => {
    if (d.mode === 'collage') {
      const first = cells.find(c => c.photoId != null);
      return [{ cells, name: (first && photoMap.get(first.photoId!)?.name) || 'collage' }];
    }
    const list: Photo[] = all ? photos : borderPhoto ? [borderPhoto] : [];
    return list.map(p => ({ cells: [{ photoId: p.id, ...NO_VIEW }], name: p.name }));
  };

  async function save(all: boolean) {
    const list = jobs(all);
    for (const [i, j] of list.entries()) {
      download(await exportPost(d, j.cells, photoMap, ex), exportName(j.name, d, ex));
      // Browsers drop rapid-fire downloads; a short pause lets each one start.
      if (i < list.length - 1) await new Promise(r => setTimeout(r, 400));
    }
    if (list.length > 1) toast.success(`Saved ${list.length} posts`);
  }

  // Sharing needs a recent tap, which a slow export can outlast; then the file is kept for a second tap.
  const ready = useRef<{ key: string; files: File[] } | null>(null);
  async function share() {
    const key = JSON.stringify([d, ex, cells, borderPhoto?.id]);
    let files = ready.current?.key === key ? ready.current.files : null;
    if (!files) {
      files = [];
      for (const j of jobs(false)) {
        const blob = await exportPost(d, j.cells, photoMap, ex);
        files.push(new File([blob], exportName(j.name, d, ex), { type: blob.type }));
      }
      ready.current = { key, files };
    }
    try { await navigator.share({ files }); ready.current = null; }
    catch (e) {
      if ((e as Error).name === 'NotAllowedError') toast('Your post is ready', { description: 'Tap Share again to send it to Photos or Instagram.' });
      else if ((e as Error).name !== 'AbortError') throw e;
    }
  }

  return <>
    <SubHeading className="mt-5">Export</SubHeading>
    <div className="grid gap-2">
      <ToggleGroup type="single" variant="outline" size="sm" className="w-full" value={String(ex.scale)} onValueChange={v => v && s.setEx(x => ({ ...x, scale: +v as ExportSettings['scale'] }))} aria-label="Size">
        {([1, 2, 3] as const).map(k => (
          <ToggleGroupItem key={k} value={String(k)} className={cn('flex-1 text-xs', onItem)}>{f.w * k} × {f.h * k}</ToggleGroupItem>
        ))}
      </ToggleGroup>
      <ToggleGroup type="single" variant="outline" size="sm" className="w-full" value={ex.type} onValueChange={v => v && s.setEx(x => ({ ...x, type: v as ExportSettings['type'] }))} aria-label="File type">
        <ToggleGroupItem value="jpeg" className={cn('flex-1 text-xs', onItem)}>JPEG</ToggleGroupItem>
        <ToggleGroupItem value="png" className={cn('flex-1 text-xs', onItem)}>PNG</ToggleGroupItem>
      </ToggleGroup>
      <Tip>Instagram shows posts {f.w} px wide; a larger file keeps a little more detail after Instagram compresses it.</Tip>
      <BusyButton busy={busy} icon={<Download />} disabled={empty} onClick={() => run(() => save(false))}>Download</BusyButton>
      {d.mode === 'border' && photos.length > 1 && (
        <Button variant="outline" disabled={busy} onClick={() => run(() => save(true))}><Images />Download all {photos.length}</Button>
      )}
      {canShare && <Button variant="outline" disabled={busy || empty} onClick={() => run(share)}><Share />Share…</Button>}
    </div>
  </>;
}
