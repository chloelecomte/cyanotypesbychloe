// Supabase persistence for the studio. Works with the server client (initial load) and the
// browser client (saves). Row-level security limits every query to the signed-in user's rows.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/database.types';
import type { Pt, RGB } from './math';
import type { Calibration, Profile, SavedCurve, Settings, StudioData } from './types';

type DB = SupabaseClient<Database>;
type ProfileRow = Database['public']['Tables']['process_profiles']['Row'];
type CalibrationRow = Database['public']['Tables']['calibrations']['Row'];
type CurveRow = Database['public']['Tables']['curves']['Row'];

export type ProfileFields = Pick<Profile, 'name' | 'paper' | 'lightSource' | 'sensitizer' | 'exposureSeconds' | 'printerFilm' | 'rinse' | 'notes'>;
export type NewCalibration = Omit<Calibration, 'id' | 'measuredAt'>;

const toCalibration = (r: CalibrationRow): Calibration => ({
  id: r.id,
  darkness: r.darkness,
  colors: (r.colors as RGB[] | null) ?? null,
  readingsLstar: r.readings_lstar,
  exposureSeconds: r.exposure_seconds,
  conditions: r.conditions,
  measuredAt: r.measured_at,
});

const toProfile = (r: ProfileRow, cals: CalibrationRow[]): Profile => {
  const active = cals.find(c => c.is_active) ?? null;
  return {
    id: r.id,
    name: r.name,
    paper: r.paper,
    lightSource: r.light_source,
    sensitizer: r.sensitizer,
    exposureSeconds: r.exposure_seconds,
    printerFilm: r.printer_film,
    rinse: r.rinse,
    notes: r.notes,
    calibration: active && toCalibration(active),
    calibrationCount: cals.length,
  };
};

const toCurve = (r: CurveRow): SavedCurve => ({ id: r.id, name: r.name, points: r.points as Pt[], profileId: r.profile_id });

const calibrationInsert = (profileId: string, c: NewCalibration) => ({
  profile_id: profileId,
  darkness: c.darkness,
  colors: c.colors as Json,
  readings_lstar: c.readingsLstar,
  exposure_seconds: c.exposureSeconds,
  conditions: c.conditions,
  is_active: true,
});

function check<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  if (res.data == null) throw new Error('No data returned');
  return res.data as NonNullable<T>;
}

export async function loadStudioData(db: DB): Promise<StudioData> {
  const [settings, profiles, curves] = await Promise.all([
    db.from('user_settings').select('settings').maybeSingle(),
    db.from('process_profiles').select('*, calibrations(*)').order('created_at'),
    db.from('curves').select('*').order('created_at'),
  ]);
  for (const r of [settings, profiles, curves]) if (r.error) throw new Error(r.error.message);
  return {
    settings: (settings.data?.settings as Partial<Settings> | undefined) ?? null,
    profiles: (profiles.data ?? []).map(({ calibrations, ...p }) => toProfile(p, calibrations)),
    curves: (curves.data ?? []).map(toCurve),
  };
}

export function createRepo(db: DB, userId: string) {
  return {
    async saveSettings(settings: Settings) {
      const { error } = await db.from('user_settings').upsert({ user_id: userId, settings: settings as unknown as Json });
      if (error) throw new Error(error.message);
    },

    async createProfile(fields: ProfileFields, cal: NewCalibration): Promise<Profile> {
      const p = check(await db.from('process_profiles').insert({
        name: fields.name,
        paper: fields.paper,
        light_source: fields.lightSource,
        sensitizer: fields.sensitizer,
        exposure_seconds: fields.exposureSeconds,
        printer_film: fields.printerFilm,
        rinse: fields.rinse,
        notes: fields.notes,
      }).select().single());
      const c = check(await db.from('calibrations').insert(calibrationInsert(p.id, cal)).select().single());
      return toProfile(p, [c]);
    },

    /** Adds a new reading to an existing profile and makes it the active one; older ones stay as history. */
    async addCalibration(profileId: string, cal: NewCalibration): Promise<Calibration> {
      const off = await db.from('calibrations').update({ is_active: false }).eq('profile_id', profileId).eq('is_active', true);
      if (off.error) throw new Error(off.error.message);
      return toCalibration(check(await db.from('calibrations').insert(calibrationInsert(profileId, cal)).select().single()));
    },

    async deleteProfile(id: string) {
      const { error } = await db.from('process_profiles').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },

    async createCurve(curve: Omit<SavedCurve, 'id'>): Promise<SavedCurve> {
      return toCurve(check(await db.from('curves').insert({
        name: curve.name,
        points: curve.points as Json,
        profile_id: curve.profileId,
      }).select().single()));
    },

    async deleteCurve(id: string) {
      const { error } = await db.from('curves').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
