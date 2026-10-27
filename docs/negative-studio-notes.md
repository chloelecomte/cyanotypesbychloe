# Negative Studio — notes for the Next.js / Vercel / Supabase revamp

> **Status (Oct 2026):** the rebuild described here is implemented: see `lib/negative-studio/`,
> `supabase/migrations/` and [cloud-setup.md](cloud-setup.md). Signed-out local mode was dropped on
> purpose: the tools require a GitHub sign-in.

Context for whoever (human or agent) picks up the rebuild. The current app is a single
self-contained file, [`negative-studio/index.html`](../negative-studio/index.html), with no
dependencies and no backend.

## What the app does today

1. **Open** a photo (JPEG/PNG/WebP; TIFF/HEIC in Safari). Nothing is uploaded.
2. **Crop & rotate** (aspect presets, 90° rotation, flip).
3. **Black & white + tone**: RGB channel mix with filter presets, then exposure,
   contrast, highlights, shadows, black/white point, midtones.
4. **Negative & curve**: invert, then apply an editable correction curve to the
   negative. "Auto-fit" builds the curve by inverting the selected process profile's
   response. Curves can be saved, exported as Photoshop `.acv`, and imported from
   `.acv` / 1D `.cube`.
5. **Preview**: simulated cyanotype print, a B&W/cyanotype compare split, and a
   21-step "ideal vs. predicted" strip with a count of distinct tones.
6. **Print**: mirrored PNG at a chosen width/DPI (DPI embedded in a `pHYs` chunk),
   with a border and an optional 21-step tablet. A Print button is included too.
7. **Calibrate**: download a linear 21-step tablet, print it, scan the result, click
   patch 1 and patch 21, and the app samples all 21 patches. Readings can also be typed.
   The result is saved as a named process profile.

### Image pipeline (all client-side, per pixel via lookup tables)

```
sRGB pixel → grey (weighted R,G,B) → tone LUT → positive P
negative n = 1 − P → correction curve C(n) = n′  ← this is what gets printed
predicted print darkness d = R(n′)  (R = process response, 0 = paper, 1 = Dmax)
display colour = gradient(d)  (paper → blues; measured colours if calibrated)
```

- Auto-fit: `C = R⁻¹`, so that `R(C(n)) = n` and the print tones come out even.
- The generic profile (no calibration) is a model with two knobs, exposure and
  tonal range. It's an estimate, not measured data.
- Curves use monotone cubic (Fritsch–Carlson) interpolation, so they never overshoot.

## Current data (browser `localStorage` only)

| Key | Shape |
| --- | --- |
| `cns.state` | `{ aspect, bw:{r,g,b}, tone:{exposure,contrast,highlights,shadows,black,white,mid}, curve:[[x,y]…], curveAuto, profile:'model' \| 'cal:<index>', model:{exposure,range}, view, split, print:{width,dpi,border,borderType,mirror,tablet,tabletCorr} }` |
| `cns.calibrations` | `[{ name, ds:number[21], colors:[[r,g,b]×21] \| null, date }]`. `ds` is normalized, monotone darkness from 0 to 1. |
| `cns.curves` | `[{ name, curve:[[x,y]…] }]` |

Curve points are `[input, output]` in 0–1 and apply to the **negative**
(0 = dense ink / paper white, 1 = clear film / deep blue).

### Known limitations to fix in the rebuild

- **A profile is only a name and 21 readings.** Paper, light source, exposure time and
  chemistry exist only if typed into the name, so profiles can't be filtered or compared.
- **Raw readings are thrown away.** Only the normalized `ds` is stored. The raw L\* values
  should be kept so profiles can be re-normalized later.
- **Saved curves aren't linked to profiles.** Switching profiles re-runs auto-fit and
  replaces a hand-tuned curve.
- **Profiles are referenced by array index** (`cal:2`), so deleting one shifts the others.
  Use UUIDs instead.
- **Storage is one browser only.** There's no sync or backup, and clearing site data
  loses everything.
- **One calibration per setup.** There's no history (e.g. a summer vs. winter sun
  re-test) and no "active" calibration per setup.

## Proposed Supabase data model

One **process profile** per paper + light + chemistry combination
(e.g. "Watercolor paper · lightbox", "Platinum Rag · sunlight"). Each profile has one
or more **calibrations** over time, plus any number of **curves**.

```sql
create table process_profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  name          text not null,
  paper         text,              -- e.g. 'Arches Platine', 'Hahnemühle Platinum Rag'
  light_source  text,              -- e.g. 'sunlight', 'UV lightbox 365nm'
  sensitizer    text,              -- e.g. 'classic 2-part', 'new cyanotype (Ware)'
  exposure_seconds integer,        -- standard printing time for this setup
  printer_film  text,              -- printer + film + print settings used for negatives
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table calibrations (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references process_profiles on delete cascade,
  user_id       uuid not null references auth.users on delete cascade,
  readings_lstar real[] not null,  -- raw L* for patches 1..21 (lightest → darkest)
  darkness      real[] not null,   -- normalized, monotone 0..1 (derived; cache)
  colors        jsonb,             -- [[r,g,b] × 21] sampled from scan, nullable
  exposure_seconds integer,        -- time actually used for this tablet
  conditions    text,              -- e.g. 'clear sky, noon, July'
  scan_path     text,              -- optional: Supabase Storage path of the scan
  is_active     boolean default true,
  measured_at   timestamptz default now()
);

create table curves (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  profile_id    uuid references process_profiles on delete set null,
  name          text not null,
  points        jsonb not null,    -- [[x,y], …] in 0..1, applied to the negative
  is_auto       boolean default false,
  created_at    timestamptz default now()
);

create table user_settings (
  user_id       uuid primary key references auth.users on delete cascade,
  settings      jsonb not null default '{}'  -- tone defaults, print defaults, last profile
);
```

- **Row-level security:** enable it on every table with `user_id = auth.uid()`
  policies for select, insert, update and delete.
- **Scans:** an optional private Storage bucket (`scans/<user_id>/…`).
- **Active calibration:** at most one per profile, enforced with a partial unique index
  on `(profile_id) where is_active`.

## Notes for the Next.js rebuild

- **Image processing stays in the browser.** Use canvas plus typed arrays in a client
  component (`'use client'`). Photos never need to be uploaded; only profiles, curves
  and settings go to Supabase. This keeps the app private, fast, and cheap on Vercel.
- **Split the single file into modules:**
  - `lib/pipeline/` holds pure functions (`toneFn`, `monotone`, `responseFn`,
    `fitCurve`, gradient, LUT building) and is easy to unit-test.
  - `lib/export/` holds PNG `pHYs` injection, the step-tablet generator and `.acv`
    read/write.
  - Components: viewer (with crop and compare), curve editor, tone strip,
    calibration wizard, step panels.
- **Large exports** (e.g. 8×10 in at 720 dpi ≈ 41 MP) can block the UI. Consider a
  Web Worker with `OffscreenCanvas` for the full-resolution export.
- **First login:** import any existing `cns.calibrations` / `cns.curves` from
  `localStorage` into the user's account.
- **Signed out:** keep a local-only mode working without an account, as it does today.
- **Hosting:** the site currently uses GitHub Pages with a `CNAME`. Moving to Vercel
  means moving the custom domain's DNS there and retiring the Pages config.

## Feature ideas for later

- Several calibrations per profile, averaged for accuracy (EDN does this).
- "Verify" flow: print the tablet through the current curve, scan it, and show how close
  to linear it came; optionally apply a second-pass correction.
- Coloured negatives (inks that block UV better than grey) as a per-profile option.
- Image library / project history (would need Storage for photos, opt-in).
- Optional: exposure-time calculator or notes per print session.
