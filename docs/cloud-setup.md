# Cloud setup (free tier)

Everything here fits the free plans of Vercel (Hobby), Supabase (Free) and GitHub.
It takes about 30–45 minutes, done once.

## How the two rings fit together

| Ring | Git | Vercel environment | URL | Supabase project | GitHub OAuth app |
| --- | --- | --- | --- | --- | --- |
| **dev** | any branch / pull request | Preview | `cyanotypesbychloe-git-<branch>-<you>.vercel.app` | `cyanotypes-dev` | "Cyanotypes (dev)" |
| **prod** | `main` | Production | `cyanotypesbychloe.com` | `cyanotypes-prod` | "Cyanotypes" |

- Every push to a branch gets its own preview URL, wired to the **dev** database. Test there,
  then merge the PR. `main` deploys to production with the **prod** database.
- Database changes live in `supabase/migrations/`. The *Database migrations* GitHub Action
  applies them to dev when a PR touches them, and to prod when they land on `main`.
- Local development (`npm run dev`) also uses the dev project.

Why two Supabase projects: Supabase branching needs a paid plan, but the free plan allows two
projects. Data in dev and prod is completely separate, so a broken migration on a branch can't
hurt your real profiles and curves.

> **Free-tier caveats**
> - Supabase pauses a free project after 7 days without traffic. The dev project will pause
>   when you're not working on the site; un-pause it from the Supabase dashboard (takes ~1 min).
>   Data is kept.
> - Vercel Hobby is for non-commercial use. If the site starts selling prints, Vercel asks you to
>   move to Pro.

---

## 1. Supabase: two projects

Do this twice, once named `cyanotypes-dev` and once `cyanotypes-prod`:

1. Go to <https://supabase.com/dashboard> → **New project**. Pick a region close to you.
2. Set a strong **database password** and save it in your password manager. The migration
   action needs it.
3. When it's ready, open **Project Settings → General** and note the **Project ID** (the
   `abcdefghijklmnop` part of `https://abcdefghijklmnop.supabase.co`).
4. Open **Project Settings → API Keys** and note the **Project URL** and the **publishable key**
   (`sb_publishable_…`). If the project only shows legacy keys, the `anon` key works too.

## 2. GitHub: two OAuth apps

A GitHub OAuth app allows one callback URL, so make one per Supabase project.

For each project, go to <https://github.com/settings/developers> → **OAuth Apps → New OAuth App**:

| Field | dev | prod |
| --- | --- | --- |
| Application name | `Cyanotypes (dev)` | `Cyanotypes by Chloé` |
| Homepage URL | `http://localhost:3000` | `https://cyanotypesbychloe.com` |
| Authorization callback URL | `https://<dev-project-id>.supabase.co/auth/v1/callback` | `https://<prod-project-id>.supabase.co/auth/v1/callback` |

Then **Generate a new client secret** and copy the Client ID and secret.

## 3. Supabase: turn on GitHub sign-in

In each Supabase project:

1. **Authentication → Sign In / Providers → GitHub**: enable it, paste that ring's Client ID and
   secret, save.
2. **Authentication → URL Configuration**:

   **dev project**
   - Site URL: `http://localhost:3000`
   - Redirect URLs:
     - `http://localhost:3000/**`
     - `https://*-<your-vercel-account-slug>.vercel.app/**` (fill this in after step 5, once you
       have a preview URL. For a preview at
       `cyanotypesbychloe-git-main-chloelecomtes-projects.vercel.app`, the slug is
       `chloelecomtes-projects`.)

   **prod project**
   - Site URL: `https://cyanotypesbychloe.com`
   - Redirect URLs: `https://cyanotypesbychloe.com/**`, `https://www.cyanotypesbychloe.com/**`

## 4. Create the tables

The fastest way the first time is the CLI from your computer (it's already a dev dependency):

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <dev-project-id>
```

```bash
npx supabase db push
```

Repeat `link` + `db push` with the prod project ID. (From now on the GitHub Action does this for
you.) Check in the Supabase **Table Editor** that `process_profiles`, `calibrations`, `curves`
and `user_settings` exist, each marked with RLS enabled.

## 5. Vercel project

1. Go to <https://vercel.com/new>, sign in with GitHub, and import
   `chloelecomte/cyanotypesbychloe`. Framework preset: **Next.js** (auto-detected). Don't deploy
   yet if it offers; add the variables first.
2. **Settings → Environments → Production → Branch Tracking**: production branch is `main`.
3. **Settings → Environment Variables**: add each variable twice, scoped by environment:

   | Name | Production (prod project) | Preview + Development (dev project) |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<prod-id>.supabase.co` | `https://<dev-id>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | prod publishable key | dev publishable key |

   These are public values by design (row-level security protects the data), but keeping them
   per environment is what separates the rings.
4. Push any branch (e.g. this one) or redeploy. Open the preview URL from the PR's Vercel comment
   and note the domain, then finish the dev **Redirect URLs** in step 3.

Previews are protected by Vercel Authentication by default, so only you (signed in to Vercel)
can open them. That's fine for testing.

## 6. GitHub Actions secrets for migrations

In the repo: **Settings → Environments**, create two environments, `development` and
`production`. In each one add:

- Variable `SUPABASE_PROJECT_ID` = that ring's project ID
- Secret `SUPABASE_DB_PASSWORD` = that ring's database password

Optionally add a **required reviewer** (yourself) on `production`, so prod migrations wait for a
click.

Then **Settings → Secrets and variables → Actions → New repository secret**:
`SUPABASE_ACCESS_TOKEN`, created at <https://supabase.com/dashboard/account/tokens>.

Finally, in **Settings → Branches**, add a rule for `main` requiring the **CI / check** status
check, so nothing merges with a broken build.

## 7. Go live on cyanotypesbychloe.com

The domain points at GitHub Pages today. Switch it over once the preview works end to end:

1. Merge the PR. Vercel deploys `main` to production at `<project>.vercel.app`. Sign in there
   and open Negative Studio to confirm it works against the prod project.
2. Vercel → **Settings → Domains** → add `cyanotypesbychloe.com` and `www.cyanotypesbychloe.com`.
   Vercel shows the DNS records to set (an `A` record for the apex and a `CNAME` for `www`).
   Update them at your domain registrar, replacing the GitHub Pages records.
3. Once Vercel shows the domain as valid (minutes to a few hours), go to the GitHub repo
   **Settings → Pages** and unpublish the Pages site.

Between merging and the DNS switch, the old Pages site no longer has its `index.html` (this PR
removes it), so do steps 1–2 back to back.

The first time you open Negative Studio on `cyanotypesbychloe.com` with the same browser you used
for the old version, it offers to copy the calibrations, curves and settings saved in that
browser into your account.

---

## Day-to-day workflow

```bash
git switch -c my-feature
```

…make changes, test with `npm run dev`, push, open a PR. Vercel posts a preview URL (dev
database) on the PR, and CI runs lint, types, tests and a build. Merge when happy; `main` goes
to production.

### Changing the database

```bash
npx supabase migration new add_something
```

Write SQL in the new file under `supabase/migrations/`, and refresh the TypeScript types:

```bash
npm run db:types
```

(`db:types` reads the currently linked project, so link the dev project first.) The PR applies
the migration to dev; merging applies it to prod.

Don't edit a migration after it has been applied to dev; add another one instead. To start over
on dev, use **Database → Reset** in the dev project's dashboard, then rerun the action
(**Actions → Database migrations → Run workflow → development**).
