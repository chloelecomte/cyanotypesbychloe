// Supabase persistence for the studio. Works with the server client (initial load) and the
// browser client (saves). Row-level security limits every query to the signed-in user's rows.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/database.types';
import type { Pt, RGB } from './math';
import { parseRecipe, photoFileName, photoLayout, photoObjects, photoTypeOf, type NegativeRecipe } from './negatives';
import type { Calibration, Profile, SavedCurve, SavedNegative, Settings, StudioData } from './types';

type DB = SupabaseClient<Database>;
type ProfileRow = Database['public']['Tables']['process_profiles']['Row'];
type CalibrationRow = Database['public']['Tables']['calibrations']['Row'];
type CurveRow = Database['public']['Tables']['curves']['Row'];
type NegativeRow = Database['public']['Tables']['negatives']['Row'];

const BUCKET = 'negatives';
const toNegative = (r: NegativeRow): SavedNegative => ({
  id: r.id, name: r.name, recipe: parseRecipe(r.recipe), profileId: r.profile_id, photoPath: r.photo_path,
  info: r.photo_info, thumbnail: r.thumbnail, createdAt: r.created_at, updatedAt: r.updated_at,
});
/** What a negative is saved with besides its photo. */
export type NegativeFields = { name: string; recipe: NegativeRecipe; info: string | null; thumbnail: string | null };
const negativeColumns = (f: NegativeFields) => ({
  name: f.name.slice(0, 200), recipe: f.recipe as unknown as Json, photo_info: f.info, thumbnail: f.thumbnail,
  // Only a real profile id can be referenced; the generic model is kept in the recipe.
  profile_id: f.recipe.profile === 'model' ? null : f.recipe.profile,
});

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

    async updateProfile(id: string, fields: ProfileFields) {
      const { error } = await db.from('process_profiles').update({
        name: fields.name,
        paper: fields.paper,
        light_source: fields.lightSource,
        sensitizer: fields.sensitizer,
        exposure_seconds: fields.exposureSeconds,
        printer_film: fields.printerFilm,
        rinse: fields.rinse,
        notes: fields.notes,
      }).eq('id', id);
      if (error) throw new Error(error.message);
    },

    /** Changes a calibration in place (no new history entry). New readings also reset its date. */
    async updateCalibration(id: string, cal: NewCalibration, remeasured: boolean): Promise<Calibration> {
      return toCalibration(check(await db.from('calibrations').update({
        darkness: cal.darkness,
        colors: cal.colors as Json,
        readings_lstar: cal.readingsLstar,
        exposure_seconds: cal.exposureSeconds,
        conditions: cal.conditions,
        ...remeasured && { measured_at: new Date().toISOString() },
      }).eq('id', id).select().single()));
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

    // ---------- Saved negatives ----------
    async listNegatives(): Promise<SavedNegative[]> {
      return check(await db.from('negatives').select('*').order('updated_at', { ascending: false })).map(toNegative);
    },

    /** Uploads the original photo (in parts if it's over the per-file limit), then records the negative. */
    async createNegative(fields: NegativeFields, photo: Blob, photoName: string): Promise<SavedNegative> {
      const id = crypto.randomUUID(), { photoPath, objects } = photoLayout(`${userId}/${id}/${photoFileName(photo, photoName)}`, photo.size);
      const uploaded: string[] = [], cleanUp = () => uploaded.length ? db.storage.from(BUCKET).remove(uploaded) : null;
      for (const o of objects) {
        const part = objects.length === 1 ? photo : photo.slice(o.start, o.end, 'application/octet-stream');
        const up = await db.storage.from(BUCKET).upload(o.path, part, { contentType: part.type || undefined, upsert: false });
        if (up.error) { await cleanUp(); throw new Error(up.error.message); }
        uploaded.push(o.path);
      }
      const res = await db.from('negatives').insert({ id, photo_path: photoPath, ...negativeColumns(fields) }).select().single();
      if (res.error) { await cleanUp(); throw new Error(res.error.message); }
      return toNegative(check(res));
    },

    async updateNegative(id: string, fields: NegativeFields): Promise<SavedNegative> {
      // A profile deleted since is simply left out.
      const cols = negativeColumns(fields);
      let res = await db.from('negatives').update(cols).eq('id', id).select().single();
      if (res.error && cols.profile_id) res = await db.from('negatives').update({ ...cols, profile_id: null }).eq('id', id).select().single();
      return toNegative(check(res));
    },

    async downloadNegativePhoto(photoPath: string): Promise<Blob> {
      const { path, objects } = photoObjects(photoPath), parts: Blob[] = [];
      for (const o of objects) {
        const { data, error } = await db.storage.from(BUCKET).download(o);
        if (error) throw new Error(error.message);
        parts.push(data);
      }
      return parts.length === 1 ? parts[0] : new Blob(parts, { type: photoTypeOf(path) });
    },

    async deleteNegative(n: SavedNegative) {
      const { error } = await db.from('negatives').delete().eq('id', n.id);
      if (error) throw new Error(error.message);
      // The row is gone, so a photo left behind is only wasted space.
      await db.storage.from(BUCKET).remove(photoObjects(n.photoPath).objects);
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
