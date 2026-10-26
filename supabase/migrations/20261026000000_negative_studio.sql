-- Negative Studio: process profiles, calibrations, curves and per-user settings.
-- Every row belongs to one user and is only visible to that user (row-level security).

-- ---------- Tables ----------

-- One profile per paper + light + chemistry setup, e.g. "Platinum Rag · sunlight".
create table public.process_profiles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  name             text not null check (char_length(name) between 1 and 200),
  paper            text,
  light_source     text,
  sensitizer       text,
  exposure_seconds integer check (exposure_seconds >= 0),
  printer_film     text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- A profile keeps every step-tablet reading over time; one of them is the active one.
create table public.calibrations (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references public.process_profiles on delete cascade,
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  readings_lstar   real[] check (readings_lstar is null or cardinality(readings_lstar) = 21),
                   -- raw L* for patches 1..21; null for calibrations imported from the old app
  darkness         real[] not null check (cardinality(darkness) = 21),
                   -- normalized, monotone 0..1 (derived from the readings)
  colors           jsonb,           -- [[r,g,b] × 21] sampled from the scan
  exposure_seconds integer check (exposure_seconds >= 0),
  conditions       text,
  scan_path        text,
  is_active        boolean not null default true,
  measured_at      timestamptz not null default now()
);

create unique index calibrations_one_active_per_profile
  on public.calibrations (profile_id) where is_active;
create index calibrations_profile_id_idx on public.calibrations (profile_id);

-- Saved negative curves. Points are [input, output] in 0..1 and apply to the negative.
create table public.curves (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  profile_id  uuid references public.process_profiles on delete set null,
  name        text not null check (char_length(name) between 1 and 200),
  points      jsonb not null check (jsonb_typeof(points) = 'array'),
  is_auto     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index curves_user_id_idx on public.curves (user_id);
create index curves_profile_id_idx on public.curves (profile_id);
create index process_profiles_user_id_idx on public.process_profiles (user_id);

-- Editor state: tone, print settings, selected profile, curve per profile…
create table public.user_settings (
  user_id     uuid primary key default auth.uid() references auth.users on delete cascade,
  settings    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ---------- updated_at ----------

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger process_profiles_touch before update on public.process_profiles
  for each row execute function public.touch_updated_at();
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- ---------- Row-level security ----------

alter table public.process_profiles enable row level security;
alter table public.calibrations     enable row level security;
alter table public.curves           enable row level security;
alter table public.user_settings    enable row level security;

-- True when the profile exists and belongs to the signed-in user.
create function public.owns_profile(pid uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.process_profiles p
    where p.id = pid and p.user_id = (select auth.uid())
  );
$$;

create policy "own profiles" on public.process_profiles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "own calibrations" on public.calibrations
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_profile(profile_id));

create policy "own curves" on public.curves
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (profile_id is null or public.owns_profile(profile_id)));

create policy "own settings" on public.user_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Signed-in users only; anonymous visitors get no access to these tables.
revoke all on public.process_profiles, public.calibrations, public.curves, public.user_settings from anon;
grant select, insert, update, delete
  on public.process_profiles, public.calibrations, public.curves, public.user_settings
  to authenticated;
revoke execute on function public.owns_profile(uuid) from public, anon;
grant execute on function public.owns_profile(uuid) to authenticated;
