# cyanotypesbychloe

Website for Cyanotypes by Chloé: a public homepage plus tools for cyanotype printing.
Built with Next.js, hosted on Vercel, with Supabase for the database and GitHub for sign-in.

- `/` is the public homepage (static, no sign-in).
- `/tools/negative-studio` is **Negative Studio**, which turns photos into corrected digital
  negatives (B&W conversion, adjustable negative curve, cyanotype preview, step-tablet calibration,
  print-ready PNG export). It requires signing in with GitHub, and saves process profiles,
  calibrations, curves and settings to your account. Photos never leave the browser.
- `/tools/post-studio` is **Post Studio**, which makes Instagram posts: one photo centered on a border
  (several at once for a carousel), a grid collage with adjustable margins, gaps and crops, or a spanning
  carousel whose photo frames can cross from one slide onto the next. It runs entirely in the browser;
  only its settings are remembered, in local storage. Also behind sign-in.
- `/tools/print-studio` is **Print Studio**, which splits one photo across prints hung together (diptych,
  triptych, grids), cropping across the wall gaps, with optional borders and bleed, and saves a
  full-resolution JPEG or PNG per print with its dpi set. Browser-only and behind sign-in, like Post Studio.

## Development

Needs Node 22+.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill `.env.local` with the **dev** Supabase project's URL and publishable key, then:

```bash
npm run dev
```

Open <http://localhost:3000>.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm test` | Unit tests (image pipeline, file formats, settings) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run build` | Production build |
| `npm run db:types` | Regenerate `lib/supabase/database.types.ts` from the linked Supabase project |

## Deploy rings

| Ring | Branch | Hosting | Database |
| --- | --- | --- | --- |
| dev | any branch / PR | Vercel preview URL | Supabase `cyanotypes-dev` |
| prod | `main` | cyanotypesbychloe.com | Supabase `cyanotypes-prod` |

Setup steps: [docs/cloud-setup.md](docs/cloud-setup.md).

## Layout

```
app/(site)/                 public pages (homepage, login)
app/auth/                   OAuth callback and sign-out
app/tools/negative-studio/  the studio page (auth-gated): React components and state
app/tools/post-studio/      Post Studio (auth-gated, browser-only); shares the studio's theme and controls
app/tools/print-studio/     Print Studio (auth-gated, browser-only); same theme and controls
components/ui/              shadcn/ui components (Tailwind), used by the studio
lib/negative-studio/        pipeline, canvas drawing, file formats, cloud persistence
lib/panels/                 shared: photo crop geometry, and cutting one scene into panels (slides, prints)
lib/post-studio/            Instagram formats, collage and carousel layout, drawing and export
lib/print-studio/           print sizes, wall layout across gaps, per-print drawing, dpi in JPEG/PNG
lib/supabase/               Supabase clients for server, browser and proxy
proxy.ts                    refreshes the session; sends signed-out visitors of /tools to /login
supabase/migrations/        database schema with row-level security
```

Background on the studio's design and data model: [docs/negative-studio-notes.md](docs/negative-studio-notes.md).
