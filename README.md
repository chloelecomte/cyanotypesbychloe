# cyanotypesbychloe

Website for Cyanotypes by Chloé: a public homepage plus tools for cyanotype printing.
Built with Next.js, hosted on Vercel, with Supabase for the database and GitHub for sign-in.

- `/` is the public homepage (static, no sign-in).
- `/tools/negative-studio` is **Negative Studio**, which turns photos into corrected digital
  negatives (B&W conversion, adjustable negative curve, cyanotype preview, step-tablet calibration,
  print-ready PNG export). It requires signing in with GitHub, and saves process profiles,
  calibrations, curves and settings to your account. Photos never leave the browser.

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
app/tools/negative-studio/  the studio page (auth-gated)
lib/negative-studio/        pipeline, file formats, cloud persistence, UI controller
lib/supabase/               Supabase clients for server, browser and proxy
proxy.ts                    refreshes the session; sends signed-out visitors of /tools to /login
supabase/migrations/        database schema with row-level security
```

Background on the studio's design and data model: [docs/negative-studio-notes.md](docs/negative-studio-notes.md).
