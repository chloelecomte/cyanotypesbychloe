-- Saved negatives: a photo plus everything needed to rebuild its negative at any size.
-- The original photo goes in the private `negatives` Storage bucket, under <user id>/<negative id>/.

create table public.negatives (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null check (char_length(name) between 1 and 200),
  -- Crop, rotation, tone, curve, print size… (see lib/negative-studio/negatives.ts)
  recipe      jsonb not null check (jsonb_typeof(recipe) = 'object'),
  -- The profile it was made with, for reference; the curve itself is in the recipe.
  profile_id  uuid references public.process_profiles on delete set null,
  photo_path  text not null,
  photo_info  text,
  -- A small JPEG data URL of the simulated print, for the library.
  thumbnail   text check (thumbnail is null or char_length(thumbnail) <= 200000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index negatives_user_id_idx on public.negatives (user_id, updated_at desc);
create index negatives_profile_id_idx on public.negatives (profile_id);

create trigger negatives_touch before update on public.negatives
  for each row execute function public.touch_updated_at();

alter table public.negatives enable row level security;

create policy "own negatives" on public.negatives
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (profile_id is null or public.owns_profile(profile_id))
    and photo_path like (select auth.uid())::text || '/%'
  );

revoke all on public.negatives from anon;
grant select, insert, update, delete on public.negatives to authenticated;

-- ---------- Storage for the original photos ----------

insert into storage.buckets (id, name, public, file_size_limit)
values ('negatives', 'negatives', false, 52428800)
on conflict (id) do nothing;

-- Each user reads and writes only the files in their own folder.
create policy "own negative photos: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'negatives' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own negative photos: add" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'negatives' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own negative photos: replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'negatives' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own negative photos: delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'negatives' and (storage.foldername(name))[1] = (select auth.uid())::text);
