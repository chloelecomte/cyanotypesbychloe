// Types for the public schema. Matches supabase/migrations; regenerate after schema
// changes with `npm run db:types` (needs `npx supabase login` and a linked project).

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      process_profiles: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          paper: string | null;
          light_source: string | null;
          sensitizer: string | null;
          exposure_seconds: number | null;
          printer_film: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          name: string;
          paper?: string | null;
          light_source?: string | null;
          sensitizer?: string | null;
          exposure_seconds?: number | null;
          printer_film?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['process_profiles']['Insert']>;
        Relationships: [];
      };
      calibrations: {
        Row: {
          id: string;
          profile_id: string;
          user_id: string;
          readings_lstar: number[] | null;
          darkness: number[];
          colors: Json | null;
          exposure_seconds: number | null;
          conditions: string | null;
          scan_path: string | null;
          is_active: boolean;
          measured_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          user_id?: string;
          readings_lstar?: number[] | null;
          darkness: number[];
          colors?: Json | null;
          exposure_seconds?: number | null;
          conditions?: string | null;
          scan_path?: string | null;
          is_active?: boolean;
          measured_at?: string;
        };
        Update: Partial<Database['public']['Tables']['calibrations']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'calibrations_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'process_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      curves: {
        Row: {
          id: string;
          user_id: string;
          profile_id: string | null;
          name: string;
          points: Json;
          is_auto: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          profile_id?: string | null;
          name: string;
          points: Json;
          is_auto?: boolean;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['curves']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'curves_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'process_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      user_settings: {
        Row: { user_id: string; settings: Json; updated_at: string };
        Insert: { user_id?: string; settings?: Json; updated_at?: string };
        Update: { user_id?: string; settings?: Json; updated_at?: string };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      owns_profile: { Args: { pid: string }; Returns: boolean };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
