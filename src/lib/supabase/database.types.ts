export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      chunks: {
        Row: {
          audio_key: string | null;
          caption: string;
          course_id: string;
          duration_ms: number | null;
          hash: string;
          id: string;
          idx: number;
          pause_after_ms: number;
          section_id: string;
          start_ms: number | null;
          status: string;
          style: string;
          text: string;
        };
        ComputedFields: never;
        Insert: {
          audio_key?: string | null;
          caption: string;
          course_id: string;
          duration_ms?: number | null;
          hash: string;
          id?: string;
          idx: number;
          pause_after_ms?: number;
          section_id: string;
          start_ms?: number | null;
          status?: string;
          style: string;
          text: string;
        };
        Update: {
          audio_key?: string | null;
          caption?: string;
          course_id?: string;
          duration_ms?: number | null;
          hash?: string;
          id?: string;
          idx?: number;
          pause_after_ms?: number;
          section_id?: string;
          start_ms?: number | null;
          status?: string;
          style?: string;
          text?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chunks_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chunks_section_id_fkey";
            columns: ["section_id"];
            isOneToOne: false;
            referencedRelation: "sections";
            referencedColumns: ["id"];
          },
        ];
      };
      courses: {
        Row: {
          actual_cost_usd: number;
          address_form: string;
          ambience: string;
          ambience_gain_db: number;
          batch_job_id: string | null;
          batch_submitted_at: string | null;
          chunk_takes: Json;
          created_at: string;
          duration_ms: number | null;
          error: string | null;
          est_cost_usd: number | null;
          id: string;
          mode: Database["public"]["Enums"]["voice_mode"];
          progress: number;
          quality: Database["public"]["Enums"]["tts_quality"];
          source_chars: number | null;
          source_keys: string[];
          source_kind: string;
          status: Database["public"]["Enums"]["course_status"];
          tier: Database["public"]["Enums"]["tts_tier"];
          title: string;
          trigger_run_id: string | null;
          updated_at: string;
          user_id: string;
          voice_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          actual_cost_usd?: number;
          address_form?: string;
          ambience: string;
          ambience_gain_db?: number;
          batch_job_id?: string | null;
          batch_submitted_at?: string | null;
          chunk_takes?: Json;
          created_at?: string;
          duration_ms?: number | null;
          error?: string | null;
          est_cost_usd?: number | null;
          id?: string;
          mode: Database["public"]["Enums"]["voice_mode"];
          progress?: number;
          quality: Database["public"]["Enums"]["tts_quality"];
          source_chars?: number | null;
          source_keys?: string[];
          source_kind: string;
          status?: Database["public"]["Enums"]["course_status"];
          tier: Database["public"]["Enums"]["tts_tier"];
          title: string;
          trigger_run_id?: string | null;
          updated_at?: string;
          user_id: string;
          voice_id?: string | null;
        };
        Update: {
          actual_cost_usd?: number;
          address_form?: string;
          ambience?: string;
          ambience_gain_db?: number;
          batch_job_id?: string | null;
          batch_submitted_at?: string | null;
          chunk_takes?: Json;
          created_at?: string;
          duration_ms?: number | null;
          error?: string | null;
          est_cost_usd?: number | null;
          id?: string;
          mode?: Database["public"]["Enums"]["voice_mode"];
          progress?: number;
          quality?: Database["public"]["Enums"]["tts_quality"];
          source_chars?: number | null;
          source_keys?: string[];
          source_kind?: string;
          status?: Database["public"]["Enums"]["course_status"];
          tier?: Database["public"]["Enums"]["tts_tier"];
          title?: string;
          trigger_run_id?: string | null;
          updated_at?: string;
          user_id?: string;
          voice_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "courses_voice_id_fkey";
            columns: ["voice_id"];
            isOneToOne: false;
            referencedRelation: "voices";
            referencedColumns: ["id"];
          },
        ];
      };
      course_folders: {
        Row: {
          course_id: string;
          created_at: string;
          folder_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          created_at?: string;
          folder_id: string;
          user_id: string;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          folder_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_folders_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "course_folders_folder_id_user_id_fkey";
            columns: ["folder_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      course_launches: {
        Row: {
          created_at: string;
          id: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: never;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          user_id?: string;
        };
        Relationships: [];
      };
      course_shares: {
        Row: {
          course_id: string;
          created_at: string;
          owner_email: string;
          owner_id: string;
          recipient_email: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          created_at?: string;
          owner_email: string;
          owner_id: string;
          recipient_email: string;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          owner_email?: string;
          owner_id?: string;
          recipient_email?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_shares_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      folders: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      passage_marks: {
        Row: {
          caption: string;
          course_id: string;
          created_at: string;
          id: string;
          position_ms: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          caption: string;
          course_id: string;
          created_at?: string;
          id?: string;
          position_ms: number;
          user_id: string;
        };
        Update: {
          caption?: string;
          course_id?: string;
          created_at?: string;
          id?: string;
          position_ms?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "passage_marks_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      playback_progress: {
        Row: {
          course_id: string;
          position_ms: number;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          position_ms?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          course_id?: string;
          position_ms?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "playback_progress_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          address_form: string;
          created_at: string;
          default_ambience: string;
          default_mode: Database["public"]["Enums"]["voice_mode"];
          default_quality: Database["public"]["Enums"]["tts_quality"];
          default_tier: Database["public"]["Enums"]["tts_tier"];
          default_voice_id: string | null;
          display_name: string | null;
          id: string;
          monthly_budget_usd: number;
        };
        ComputedFields: never;
        Insert: {
          address_form?: string;
          created_at?: string;
          default_ambience?: string;
          default_mode?: Database["public"]["Enums"]["voice_mode"];
          default_quality?: Database["public"]["Enums"]["tts_quality"];
          default_tier?: Database["public"]["Enums"]["tts_tier"];
          default_voice_id?: string | null;
          display_name?: string | null;
          id: string;
          monthly_budget_usd?: number;
        };
        Update: {
          address_form?: string;
          created_at?: string;
          default_ambience?: string;
          default_mode?: Database["public"]["Enums"]["voice_mode"];
          default_quality?: Database["public"]["Enums"]["tts_quality"];
          default_tier?: Database["public"]["Enums"]["tts_tier"];
          default_voice_id?: string | null;
          display_name?: string | null;
          id?: string;
          monthly_budget_usd?: number;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_default_voice_fk";
            columns: ["default_voice_id"];
            isOneToOne: false;
            referencedRelation: "voices";
            referencedColumns: ["id"];
          },
        ];
      };
      renders: {
        Row: {
          ambience: string | null;
          bytes: number | null;
          course_id: string;
          created_at: string;
          duration_ms: number;
          id: string;
          key: string;
          kind: string;
        };
        ComputedFields: never;
        Insert: {
          ambience?: string | null;
          bytes?: number | null;
          course_id: string;
          created_at?: string;
          duration_ms: number;
          id?: string;
          key: string;
          kind: string;
        };
        Update: {
          ambience?: string | null;
          bytes?: number | null;
          course_id?: string;
          created_at?: string;
          duration_ms?: number;
          id?: string;
          key?: string;
          kind?: string;
        };
        Relationships: [
          {
            foreignKeyName: "renders_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      sections: {
        Row: {
          course_id: string;
          duration_ms: number | null;
          id: string;
          idx: number;
          key_facts: NonNullable<Json>;
          key_terms: NonNullable<Json>;
          script: Json | null;
          source_text: string;
          start_ms: number | null;
          title: string;
          verified: boolean;
          verify_report: Json | null;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          duration_ms?: number | null;
          id?: string;
          idx: number;
          key_facts?: NonNullable<Json>;
          key_terms?: NonNullable<Json>;
          script?: Json | null;
          source_text: string;
          start_ms?: number | null;
          title: string;
          verified?: boolean;
          verify_report?: Json | null;
        };
        Update: {
          course_id?: string;
          duration_ms?: number | null;
          id?: string;
          idx?: number;
          key_facts?: NonNullable<Json>;
          key_terms?: NonNullable<Json>;
          script?: Json | null;
          source_text?: string;
          start_ms?: number | null;
          title?: string;
          verified?: boolean;
          verify_report?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "sections_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      usage_events: {
        Row: {
          audio_seconds: number;
          cost_usd: number;
          course_id: string | null;
          created_at: string;
          id: number;
          input_tokens: number;
          model: string;
          output_tokens: number;
          step: string;
          thinking_tokens: number;
          tier: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          audio_seconds?: number;
          cost_usd: number;
          course_id?: string | null;
          created_at?: string;
          id?: never;
          input_tokens?: number;
          model: string;
          output_tokens?: number;
          step: string;
          thinking_tokens?: number;
          tier: string;
          user_id: string;
        };
        Update: {
          audio_seconds?: number;
          cost_usd?: number;
          course_id?: string | null;
          created_at?: string;
          id?: never;
          input_tokens?: number;
          model?: string;
          output_tokens?: number;
          step?: string;
          thinking_tokens?: number;
          tier?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usage_events_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      voices: {
        Row: {
          created_at: string;
          description: string | null;
          env: string;
          id: string;
          kind: string;
          label: string;
          last_used_at: string | null;
          provider: string;
          provider_voice_id: string;
          sample_key: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          description?: string | null;
          env: string;
          id?: string;
          kind: string;
          label: string;
          last_used_at?: string | null;
          provider?: string;
          provider_voice_id: string;
          sample_key?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          env?: string;
          id?: string;
          kind?: string;
          label?: string;
          last_used_at?: string | null;
          provider?: string;
          provider_voice_id?: string;
          sample_key?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      course_costs: {
        Row: {
          cost_usd: number | null;
          course_id: string | null;
        };
        ComputedFields: never;
        Relationships: [];
      };
      monthly_spend: {
        Row: {
          month: string | null;
          spent_usd: number | null;
          user_id: string | null;
        };
        ComputedFields: never;
        Relationships: [];
      };
    };
    Functions: {
      admin_course_counts: {
        Args: never;
        Returns: {
          courses: number;
          duration_ms: number;
          status: Database["public"]["Enums"]["course_status"];
          user_id: string;
        }[];
      };
      admin_spend_breakdown: {
        Args: { p_course_id?: string; p_since?: string };
        Returns: {
          audio_seconds: number;
          cost_usd: number;
          events: number;
          input_tokens: number;
          model: string;
          output_tokens: number;
          step: string;
          thinking_tokens: number;
          tier: string;
        }[];
      };
      admin_spend_by_month: {
        Args: { p_months?: number };
        Returns: {
          cost_usd: number;
          events: number;
          month: string;
        }[];
      };
      admin_spend_by_user: {
        Args: { p_since: string };
        Returns: {
          cost_usd: number;
          courses: number;
          user_id: string;
        }[];
      };
      course_cost: {
        Args: { p_course_id: string };
        Returns: number;
      };
      spend_since: {
        Args: { p_since: string; p_user_id?: string };
        Returns: number;
      };
    };
    Enums: {
      course_status:
        | "queued"
        | "extracting"
        | "rewriting"
        | "verifying"
        | "synthesizing"
        | "waiting_batch"
        | "assembling"
        | "mastering"
        | "ready"
        | "failed";
      tts_quality: "standard" | "economy";
      tts_tier: "eco" | "express";
      voice_mode: "whisper" | "soft";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      course_status: [
        "queued",
        "extracting",
        "rewriting",
        "verifying",
        "synthesizing",
        "waiting_batch",
        "assembling",
        "mastering",
        "ready",
        "failed",
      ],
      tts_quality: ["standard", "economy"],
      tts_tier: ["eco", "express"],
      voice_mode: ["whisper", "soft"],
    },
  },
} as const;
