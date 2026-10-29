-- How the print was cleared after exposure: plain water, vinegar, citric acid, etc.
-- (Free-form development notes go in the existing process_profiles.notes column.)
alter table public.process_profiles add column rinse text;
