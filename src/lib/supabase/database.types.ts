export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      academic_years: {
        Row: {
          created_at: string
          ends_on: string
          id: string
          is_current: boolean
          name: string
          starts_on: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_on: string
          id?: string
          is_current?: boolean
          name: string
          starts_on: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_on?: string
          id?: string
          is_current?: boolean
          name?: string
          starts_on?: string
          updated_at?: string
        }
        Relationships: []
      }
      admit_card_overrides: {
        Row: {
          approved_at: string
          approved_by: string | null
          exam_id: string
          id: string
          overridden_checks: Json
          reason: string
          student_id: string
        }
        Insert: {
          approved_at?: string
          approved_by?: string | null
          exam_id: string
          id?: string
          overridden_checks?: Json
          reason: string
          student_id: string
        }
        Update: {
          approved_at?: string
          approved_by?: string | null
          exam_id?: string
          id?: string
          overridden_checks?: Json
          reason?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admit_card_overrides_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admit_card_overrides_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admit_card_overrides_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      admit_card_rules: {
        Row: {
          allow_override: boolean
          allowed_outstanding: number
          created_at: string
          exam_id: string
          feedback_campaign_id: string | null
          fees_cleared_through_month: number | null
          fees_cleared_through_year: number | null
          id: string
          require_exam_fee_paid: boolean
          require_feedback: boolean
          require_fees_cleared: boolean
          updated_at: string
        }
        Insert: {
          allow_override?: boolean
          allowed_outstanding?: number
          created_at?: string
          exam_id: string
          feedback_campaign_id?: string | null
          fees_cleared_through_month?: number | null
          fees_cleared_through_year?: number | null
          id?: string
          require_exam_fee_paid?: boolean
          require_feedback?: boolean
          require_fees_cleared?: boolean
          updated_at?: string
        }
        Update: {
          allow_override?: boolean
          allowed_outstanding?: number
          created_at?: string
          exam_id?: string
          feedback_campaign_id?: string | null
          fees_cleared_through_month?: number | null
          fees_cleared_through_year?: number | null
          id?: string
          require_exam_fee_paid?: boolean
          require_feedback?: boolean
          require_fees_cleared?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admit_card_rules_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: true
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admit_card_rules_feedback_campaign_id_fkey"
            columns: ["feedback_campaign_id"]
            isOneToOne: false
            referencedRelation: "feedback_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_context: string | null
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["user_role"] | null
          changed_fields: string[] | null
          id: number
          ip_address: unknown
          new_values: Json | null
          occurred_at: string
          old_values: Json | null
          reason: string | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_context?: string | null
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          changed_fields?: string[] | null
          id?: never
          ip_address?: unknown
          new_values?: Json | null
          occurred_at?: string
          old_values?: Json | null
          reason?: string | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          actor_context?: string | null
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          changed_fields?: string[] | null
          id?: never
          ip_address?: unknown
          new_values?: Json | null
          occurred_at?: string
          old_values?: Json | null
          reason?: string | null
          record_id?: string
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_attempts: {
        Row: {
          attempted_at: string
          id: number
          identifier: string
          ip_address: unknown
          kind: string
          succeeded: boolean
          user_agent: string | null
        }
        Insert: {
          attempted_at?: string
          id?: never
          identifier: string
          ip_address?: unknown
          kind: string
          succeeded?: boolean
          user_agent?: string | null
        }
        Update: {
          attempted_at?: string
          id?: never
          identifier?: string
          ip_address?: unknown
          kind?: string
          succeeded?: boolean
          user_agent?: string | null
        }
        Relationships: []
      }
      cancelled_periods: {
        Row: {
          cancelled_by: string | null
          created_at: string
          id: string
          occurs_on: string
          reason: string
          routine_period_id: string
        }
        Insert: {
          cancelled_by?: string | null
          created_at?: string
          id?: string
          occurs_on: string
          reason: string
          routine_period_id: string
        }
        Update: {
          cancelled_by?: string | null
          created_at?: string
          id?: string
          occurs_on?: string
          reason?: string
          routine_period_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cancelled_periods_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancelled_periods_routine_period_id_fkey"
            columns: ["routine_period_id"]
            isOneToOne: false
            referencedRelation: "routine_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      class_subjects: {
        Row: {
          academic_year_id: string
          class_id: string
          created_at: string
          id: string
          subject_id: string
        }
        Insert: {
          academic_year_id: string
          class_id: string
          created_at?: string
          id?: string
          subject_id: string
        }
        Update: {
          academic_year_id?: string
          class_id?: string
          created_at?: string
          id?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_subjects_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_subjects_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      class_test_marks: {
        Row: {
          class_test_id: string
          entered_at: string
          entered_by: string | null
          id: string
          is_absent: boolean
          marks_obtained: number | null
          student_id: string
          updated_at: string
        }
        Insert: {
          class_test_id: string
          entered_at?: string
          entered_by?: string | null
          id?: string
          is_absent?: boolean
          marks_obtained?: number | null
          student_id: string
          updated_at?: string
        }
        Update: {
          class_test_id?: string
          entered_at?: string
          entered_by?: string | null
          id?: string
          is_absent?: boolean
          marks_obtained?: number | null
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_test_marks_class_test_id_fkey"
            columns: ["class_test_id"]
            isOneToOne: false
            referencedRelation: "class_tests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_test_marks_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_test_marks_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      class_tests: {
        Row: {
          academic_year_id: string
          class_id: string
          created_at: string
          id: string
          max_marks: number
          name: string
          result_sent_at: string | null
          result_sent_by: string | null
          section_id: string
          status: Database["public"]["Enums"]["class_test_status"]
          subject_id: string
          teacher_id: string
          term_id: string | null
          test_date: string
          updated_at: string
        }
        Insert: {
          academic_year_id: string
          class_id: string
          created_at?: string
          id?: string
          max_marks: number
          name: string
          result_sent_at?: string | null
          result_sent_by?: string | null
          section_id: string
          status?: Database["public"]["Enums"]["class_test_status"]
          subject_id: string
          teacher_id: string
          term_id?: string | null
          test_date: string
          updated_at?: string
        }
        Update: {
          academic_year_id?: string
          class_id?: string
          created_at?: string
          id?: string
          max_marks?: number
          name?: string
          result_sent_at?: string | null
          result_sent_by?: string | null
          section_id?: string
          status?: Database["public"]["Enums"]["class_test_status"]
          subject_id?: string
          teacher_id?: string
          term_id?: string | null
          test_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_tests_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_tests_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_tests_result_sent_by_fkey"
            columns: ["result_sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_tests_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_tests_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_tests_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_tests_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          level_order: number
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          level_order: number
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          level_order?: number
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      device_users: {
        Row: {
          created_at: string
          device_id: string
          device_user_id: string
          enrolled_at: string | null
          enrolled_by: string | null
          enrolled_fingers: number
          id: string
          is_active: boolean
          last_verified_at: string | null
          notes: string | null
          teacher_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_id: string
          device_user_id: string
          enrolled_at?: string | null
          enrolled_by?: string | null
          enrolled_fingers?: number
          id?: string
          is_active?: boolean
          last_verified_at?: string | null
          notes?: string | null
          teacher_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_id?: string
          device_user_id?: string
          enrolled_at?: string | null
          enrolled_by?: string | null
          enrolled_fingers?: number
          id?: string
          is_active?: boolean
          last_verified_at?: string | null
          notes?: string | null
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_users_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_users_enrolled_by_fkey"
            columns: ["enrolled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_users_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          created_at: string
          id: string
          ip_address: unknown
          is_active: boolean
          last_event_at: string | null
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          location: string | null
          model: string
          name: string
          port: number | null
          serial_no: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address?: unknown
          is_active?: boolean
          last_event_at?: string | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          location?: string | null
          model?: string
          name: string
          port?: number | null
          serial_no?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: unknown
          is_active?: boolean
          last_event_at?: string | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          location?: string | null
          model?: string
          name?: string
          port?: number | null
          serial_no?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      document_templates: {
        Row: {
          config: Json
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          kind: Database["public"]["Enums"]["document_kind"]
          name: string
          orientation: Database["public"]["Enums"]["card_orientation"]
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          kind: Database["public"]["Enums"]["document_kind"]
          name: string
          orientation?: Database["public"]["Enums"]["card_orientation"]
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          kind?: Database["public"]["Enums"]["document_kind"]
          name?: string
          orientation?: Database["public"]["Enums"]["card_orientation"]
          updated_at?: string
        }
        Relationships: []
      }
      exam_subjects: {
        Row: {
          class_id: string
          created_at: string
          ends_at: string | null
          exam_date: string | null
          exam_id: string
          id: string
          max_marks: number
          pass_marks: number | null
          room: string | null
          starts_at: string | null
          subject_id: string
          updated_at: string
        }
        Insert: {
          class_id: string
          created_at?: string
          ends_at?: string | null
          exam_date?: string | null
          exam_id: string
          id?: string
          max_marks: number
          pass_marks?: number | null
          room?: string | null
          starts_at?: string | null
          subject_id: string
          updated_at?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          ends_at?: string | null
          exam_date?: string | null
          exam_id?: string
          id?: string
          max_marks?: number
          pass_marks?: number | null
          room?: string | null
          starts_at?: string | null
          subject_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_subjects_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_subjects_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          academic_year_id: string
          created_at: string
          created_by: string | null
          ends_on: string | null
          grading_scale_id: string | null
          id: string
          name: string
          results_published_at: string | null
          results_published_by: string | null
          routine_published_at: string | null
          routine_published_by: string | null
          starts_on: string | null
          status: Database["public"]["Enums"]["exam_status"]
          term_id: string
          updated_at: string
        }
        Insert: {
          academic_year_id: string
          created_at?: string
          created_by?: string | null
          ends_on?: string | null
          grading_scale_id?: string | null
          id?: string
          name: string
          results_published_at?: string | null
          results_published_by?: string | null
          routine_published_at?: string | null
          routine_published_by?: string | null
          starts_on?: string | null
          status?: Database["public"]["Enums"]["exam_status"]
          term_id: string
          updated_at?: string
        }
        Update: {
          academic_year_id?: string
          created_at?: string
          created_by?: string | null
          ends_on?: string | null
          grading_scale_id?: string | null
          id?: string
          name?: string
          results_published_at?: string | null
          results_published_by?: string | null
          routine_published_at?: string | null
          routine_published_by?: string | null
          starts_on?: string | null
          status?: Database["public"]["Enums"]["exam_status"]
          term_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exams_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_grading_scale_id_fkey"
            columns: ["grading_scale_id"]
            isOneToOne: false
            referencedRelation: "grading_scales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_results_published_by_fkey"
            columns: ["results_published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_routine_published_by_fkey"
            columns: ["routine_published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_charges: {
        Row: {
          academic_year_id: string
          amount: number
          amount_paid: number
          created_at: string
          created_by: string | null
          discount_amount: number
          due_on: string | null
          exam_id: string | null
          fee_type_id: string
          id: string
          note: string | null
          period_month: number | null
          period_year: number | null
          status: Database["public"]["Enums"]["fee_charge_status"]
          student_id: string
          updated_at: string
        }
        Insert: {
          academic_year_id: string
          amount: number
          amount_paid?: number
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          due_on?: string | null
          exam_id?: string | null
          fee_type_id: string
          id?: string
          note?: string | null
          period_month?: number | null
          period_year?: number | null
          status?: Database["public"]["Enums"]["fee_charge_status"]
          student_id: string
          updated_at?: string
        }
        Update: {
          academic_year_id?: string
          amount?: number
          amount_paid?: number
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          due_on?: string | null
          exam_id?: string | null
          fee_type_id?: string
          id?: string
          note?: string | null
          period_month?: number | null
          period_year?: number | null
          status?: Database["public"]["Enums"]["fee_charge_status"]
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_charges_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_charges_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_charges_fee_type_id_fkey"
            columns: ["fee_type_id"]
            isOneToOne: false
            referencedRelation: "fee_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_charges_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_rates: {
        Row: {
          academic_year_id: string
          amount: number
          class_id: string | null
          created_at: string
          fee_type_id: string
          id: string
          updated_at: string
        }
        Insert: {
          academic_year_id: string
          amount: number
          class_id?: string | null
          created_at?: string
          fee_type_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          academic_year_id?: string
          amount?: number
          class_id?: string | null
          created_at?: string
          fee_type_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_rates_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_rates_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_rates_fee_type_id_fkey"
            columns: ["fee_type_id"]
            isOneToOne: false
            referencedRelation: "fee_types"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_types: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_exam_fee: boolean
          is_monthly: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_exam_fee?: boolean
          is_monthly?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_exam_fee?: boolean
          is_monthly?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      feedback_campaigns: {
        Row: {
          academic_year_id: string
          blocks_admit_card: boolean
          closes_at: string | null
          created_at: string
          created_by: string | null
          id: string
          min_periods_taught: number
          name: string
          opens_at: string | null
          status: Database["public"]["Enums"]["feedback_campaign_status"]
          term_id: string
          updated_at: string
        }
        Insert: {
          academic_year_id: string
          blocks_admit_card?: boolean
          closes_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          min_periods_taught?: number
          name: string
          opens_at?: string | null
          status?: Database["public"]["Enums"]["feedback_campaign_status"]
          term_id: string
          updated_at?: string
        }
        Update: {
          academic_year_id?: string
          blocks_admit_card?: boolean
          closes_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          min_periods_taught?: number
          name?: string
          opens_at?: string | null
          status?: Database["public"]["Enums"]["feedback_campaign_status"]
          term_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_campaigns_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_campaigns_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_comments: {
        Row: {
          body: string
          campaign_id: string
          id: string
          section_id: string
          subject_id: string | null
          submitted_on: string
          teacher_id: string
        }
        Insert: {
          body: string
          campaign_id: string
          id?: string
          section_id: string
          subject_id?: string | null
          submitted_on?: string
          teacher_id: string
        }
        Update: {
          body?: string
          campaign_id?: string
          id?: string
          section_id?: string
          subject_id?: string | null
          submitted_on?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_comments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "feedback_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_comments_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_comments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_comments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_completions: {
        Row: {
          campaign_id: string
          completed_at: string | null
          created_at: string
          id: string
          student_id: string
          targets_done: number
          targets_total: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          student_id: string
          targets_done?: number
          targets_total?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          student_id?: string
          targets_done?: number
          targets_total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_completions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "feedback_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_completions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_questions: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          order_no: number
          prompt: string
          prompt_bn: string | null
          scale_max: number
          scale_min: number
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          order_no: number
          prompt: string
          prompt_bn?: string | null
          scale_max?: number
          scale_min?: number
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          order_no?: number
          prompt?: string
          prompt_bn?: string | null
          scale_max?: number
          scale_min?: number
        }
        Relationships: [
          {
            foreignKeyName: "feedback_questions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "feedback_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_responses: {
        Row: {
          campaign_id: string
          id: string
          question_id: string
          rating: number
          section_id: string
          subject_id: string
          submitted_on: string
          teacher_id: string
        }
        Insert: {
          campaign_id: string
          id?: string
          question_id: string
          rating: number
          section_id: string
          subject_id: string
          submitted_on?: string
          teacher_id: string
        }
        Update: {
          campaign_id?: string
          id?: string
          question_id?: string
          rating?: number
          section_id?: string
          subject_id?: string
          submitted_on?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_responses_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "feedback_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_responses_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "feedback_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_responses_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_responses_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_responses_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_targets: {
        Row: {
          answered_at: string | null
          campaign_id: string
          created_at: string
          id: string
          periods_taught: number
          section_id: string
          student_id: string
          subject_id: string
          teacher_id: string
        }
        Insert: {
          answered_at?: string | null
          campaign_id: string
          created_at?: string
          id?: string
          periods_taught?: number
          section_id: string
          student_id: string
          subject_id: string
          teacher_id: string
        }
        Update: {
          answered_at?: string | null
          campaign_id?: string
          created_at?: string
          id?: string
          periods_taught?: number
          section_id?: string
          student_id?: string
          subject_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "feedback_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_targets_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_targets_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_targets_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_targets_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_documents: {
        Row: {
          academic_year_id: string | null
          exam_id: string | null
          file_path: string | null
          generated_at: string
          generated_by: string | null
          id: string
          kind: Database["public"]["Enums"]["document_kind"]
          meta: Json
          page_count: number | null
          section_id: string | null
          student_id: string | null
          template_id: string | null
        }
        Insert: {
          academic_year_id?: string | null
          exam_id?: string | null
          file_path?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["document_kind"]
          meta?: Json
          page_count?: number | null
          section_id?: string | null
          student_id?: string | null
          template_id?: string | null
        }
        Update: {
          academic_year_id?: string | null
          exam_id?: string | null
          file_path?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["document_kind"]
          meta?: Json
          page_count?: number | null
          section_id?: string | null
          student_id?: string | null
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_documents_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      grade_bands: {
        Row: {
          created_at: string
          grade: string
          grade_point: number
          id: string
          is_pass: boolean
          max_pct: number
          min_pct: number
          scale_id: string
        }
        Insert: {
          created_at?: string
          grade: string
          grade_point: number
          id?: string
          is_pass?: boolean
          max_pct: number
          min_pct: number
          scale_id: string
        }
        Update: {
          created_at?: string
          grade?: string
          grade_point?: number
          id?: string
          is_pass?: boolean
          max_pct?: number
          min_pct?: number
          scale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grade_bands_scale_id_fkey"
            columns: ["scale_id"]
            isOneToOne: false
            referencedRelation: "grading_scales"
            referencedColumns: ["id"]
          },
        ]
      }
      grading_scales: {
        Row: {
          academic_year_id: string | null
          created_at: string
          id: string
          is_default: boolean
          name: string
          subject_pass_pct: number
          updated_at: string
        }
        Insert: {
          academic_year_id?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          subject_pass_pct?: number
          updated_at?: string
        }
        Update: {
          academic_year_id?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          subject_pass_pct?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grading_scales_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          ends_on: string
          id: string
          reason: string
          starts_on: string
          status: Database["public"]["Enums"]["leave_status"]
          teacher_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          ends_on: string
          id?: string
          reason: string
          starts_on: string
          status?: Database["public"]["Enums"]["leave_status"]
          teacher_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          ends_on?: string
          id?: string
          reason?: string
          starts_on?: string
          status?: Database["public"]["Enums"]["leave_status"]
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      library_books: {
        Row: {
          author: string | null
          category: string | null
          class_id: string | null
          cover_generated_at: string | null
          cover_image_path: string | null
          created_at: string
          created_by: string | null
          description: string | null
          drive_url: string
          id: string
          is_published: boolean
          link_checked_at: string | null
          link_ok: boolean | null
          title: string
          title_bn: string | null
          updated_at: string
        }
        Insert: {
          author?: string | null
          category?: string | null
          class_id?: string | null
          cover_generated_at?: string | null
          cover_image_path?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          drive_url: string
          id?: string
          is_published?: boolean
          link_checked_at?: string | null
          link_ok?: boolean | null
          title: string
          title_bn?: string | null
          updated_at?: string
        }
        Update: {
          author?: string | null
          category?: string | null
          class_id?: string | null
          cover_generated_at?: string | null
          cover_image_path?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          drive_url?: string
          id?: string
          is_published?: boolean
          link_checked_at?: string | null
          link_ok?: boolean | null
          title?: string
          title_bn?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_books_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_books_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mark_submissions: {
        Row: {
          exam_subject_id: string
          id: string
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          section_id: string
          submitted_at: string
          submitted_by: string | null
          teacher_id: string
        }
        Insert: {
          exam_subject_id: string
          id?: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          section_id: string
          submitted_at?: string
          submitted_by?: string | null
          teacher_id: string
        }
        Update: {
          exam_subject_id?: string
          id?: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          section_id?: string
          submitted_at?: string
          submitted_by?: string | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mark_submissions_exam_subject_id_fkey"
            columns: ["exam_subject_id"]
            isOneToOne: false
            referencedRelation: "exam_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mark_submissions_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mark_submissions_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mark_submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mark_submissions_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      marks: {
        Row: {
          created_at: string
          entered_at: string | null
          entered_by: string | null
          exam_subject_id: string
          id: string
          is_absent: boolean
          marks_obtained: number | null
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entered_at?: string | null
          entered_by?: string | null
          exam_subject_id: string
          id?: string
          is_absent?: boolean
          marks_obtained?: number | null
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entered_at?: string | null
          entered_by?: string | null
          exam_subject_id?: string
          id?: string
          is_absent?: boolean
          marks_obtained?: number | null
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marks_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marks_exam_subject_id_fkey"
            columns: ["exam_subject_id"]
            isOneToOne: false
            referencedRelation: "exam_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marks_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_jobs: {
        Row: {
          attempts: number
          body: string | null
          created_at: string
          dedupe_key: string
          id: string
          is_unicode: boolean
          job_date: string | null
          last_error: string | null
          payload: Json
          scheduled_for: string | null
          segments: number | null
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          student_id: string | null
          target_phone: string
          teacher_id: string | null
          type: Database["public"]["Enums"]["notification_type"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          body?: string | null
          created_at?: string
          dedupe_key: string
          id?: string
          is_unicode?: boolean
          job_date?: string | null
          last_error?: string | null
          payload?: Json
          scheduled_for?: string | null
          segments?: number | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          student_id?: string | null
          target_phone: string
          teacher_id?: string | null
          type: Database["public"]["Enums"]["notification_type"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          body?: string | null
          created_at?: string
          dedupe_key?: string
          id?: string
          is_unicode?: boolean
          job_date?: string | null
          last_error?: string | null
          payload?: Json
          scheduled_for?: string | null
          segments?: number | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          student_id?: string | null
          target_phone?: string
          teacher_id?: string | null
          type?: Database["public"]["Enums"]["notification_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_jobs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_jobs_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      otp_challenges: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          max_attempts: number
          phone: string
          purpose: Database["public"]["Enums"]["otp_purpose"]
          requested_ip: unknown
          student_id: string | null
          teacher_id: string | null
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          max_attempts?: number
          phone: string
          purpose: Database["public"]["Enums"]["otp_purpose"]
          requested_ip?: unknown
          student_id?: string | null
          teacher_id?: string | null
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          max_attempts?: number
          phone?: string
          purpose?: Database["public"]["Enums"]["otp_purpose"]
          requested_ip?: unknown
          student_id?: string | null
          teacher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "otp_challenges_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "otp_challenges_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_allocations: {
        Row: {
          amount: number
          created_at: string
          fee_charge_id: string
          id: string
          payment_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          fee_charge_id: string
          id?: string
          payment_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          fee_charge_id?: string
          id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_fee_charge_id_fkey"
            columns: ["fee_charge_id"]
            isOneToOne: false
            referencedRelation: "fee_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          paid_at: string
          received_by: string | null
          reference_no: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          student_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          paid_at?: string
          received_by?: string | null
          reference_no?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          student_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          paid_at?: string
          received_by?: string | null
          reference_no?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          activated_at: string | null
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          last_login_at: string | null
          must_set_password: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          last_login_at?: string | null
          must_set_password?: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          must_set_password?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      published_results: {
        Row: {
          attendance_pct: number | null
          enrollment_id: string
          exam_id: string
          gpa: number | null
          grade: string | null
          id: string
          is_pass: boolean
          percentage: number
          position_in_class: number | null
          published_at: string
          published_by: string | null
          snapshot: Json
          student_id: string
          total_max: number
          total_obtained: number
        }
        Insert: {
          attendance_pct?: number | null
          enrollment_id: string
          exam_id: string
          gpa?: number | null
          grade?: string | null
          id?: string
          is_pass: boolean
          percentage: number
          position_in_class?: number | null
          published_at?: string
          published_by?: string | null
          snapshot: Json
          student_id: string
          total_max: number
          total_obtained: number
        }
        Update: {
          attendance_pct?: number | null
          enrollment_id?: string
          exam_id?: string
          gpa?: number | null
          grade?: string | null
          id?: string
          is_pass?: boolean
          percentage?: number
          position_in_class?: number | null
          published_at?: string
          published_by?: string | null
          snapshot?: Json
          student_id?: string
          total_max?: number
          total_obtained?: number
        }
        Relationships: [
          {
            foreignKeyName: "published_results_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "student_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_results_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_results_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_results_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_tokens: {
        Row: {
          card_snapshot: Json
          id: string
          issued_at: string
          issued_by: string | null
          replaced_by_id: string | null
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          student_id: string
          template_id: string | null
          token: string
        }
        Insert: {
          card_snapshot: Json
          id?: string
          issued_at?: string
          issued_by?: string | null
          replaced_by_id?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          student_id: string
          template_id?: string | null
          token: string
        }
        Update: {
          card_snapshot?: Json
          id?: string
          issued_at?: string
          issued_by?: string | null
          replaced_by_id?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          student_id?: string
          template_id?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "qr_tokens_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_tokens_replaced_by_id_fkey"
            columns: ["replaced_by_id"]
            isOneToOne: false
            referencedRelation: "qr_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_tokens_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_tokens_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_tokens_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_punch_events: {
        Row: {
          dedupe_key: string
          device_id: string
          device_user_id: string
          id: number
          processed_at: string | null
          punch_state: number | null
          punched_at: string
          raw_payload: Json | null
          received_at: string
          teacher_id: string | null
          verify_mode: number | null
        }
        Insert: {
          dedupe_key: string
          device_id: string
          device_user_id: string
          id?: never
          processed_at?: string | null
          punch_state?: number | null
          punched_at: string
          raw_payload?: Json | null
          received_at?: string
          teacher_id?: string | null
          verify_mode?: number | null
        }
        Update: {
          dedupe_key?: string
          device_id?: string
          device_user_id?: string
          id?: never
          processed_at?: string | null
          punch_state?: number | null
          punched_at?: string
          raw_payload?: Json | null
          received_at?: string
          teacher_id?: string | null
          verify_mode?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_punch_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_punch_events_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          id: string
          issued_at: string
          issued_by: string | null
          payment_id: string
          pdf_path: string | null
          receipt_no: string
          snapshot: Json
        }
        Insert: {
          id?: string
          issued_at?: string
          issued_by?: string | null
          payment_id: string
          pdf_path?: string | null
          receipt_no: string
          snapshot?: Json
        }
        Update: {
          id?: string
          issued_at?: string
          issued_by?: string | null
          payment_id?: string
          pdf_path?: string | null
          receipt_no?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "receipts_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      routine_periods: {
        Row: {
          academic_year_id: string
          class_id: string
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          ends_at: string
          id: string
          period_no: number
          section_id: string
          starts_at: string
          subject_id: string
          teacher_id: string
          updated_at: string
          weekday: number
        }
        Insert: {
          academic_year_id: string
          class_id: string
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          ends_at: string
          id?: string
          period_no: number
          section_id: string
          starts_at: string
          subject_id: string
          teacher_id: string
          updated_at?: string
          weekday: number
        }
        Update: {
          academic_year_id?: string
          class_id?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          ends_at?: string
          id?: string
          period_no?: number
          section_id?: string
          starts_at?: string
          subject_id?: string
          teacher_id?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "routine_periods_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_periods_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_periods_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_periods_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_periods_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_periods_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      school_holidays: {
        Row: {
          academic_year_id: string
          class_id: string | null
          created_at: string
          created_by: string | null
          holiday_date: string
          id: string
          name: string
        }
        Insert: {
          academic_year_id: string
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          holiday_date: string
          id?: string
          name: string
        }
        Update: {
          academic_year_id?: string
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          holiday_date?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_holidays_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_holidays_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_holidays_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      school_settings: {
        Row: {
          address: string | null
          created_at: string
          currency: string
          daily_sms_earliest_time: string
          daily_sms_enabled: boolean
          daily_sms_grace_minutes: number
          default_locale: string
          email: string | null
          id: boolean
          logo_path: string | null
          name: string
          office_phone: string | null
          short_name: string | null
          signature_holder_name: string | null
          signature_holder_title: string | null
          signature_image_path: string | null
          timezone: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          currency?: string
          daily_sms_earliest_time?: string
          daily_sms_enabled?: boolean
          daily_sms_grace_minutes?: number
          default_locale?: string
          email?: string | null
          id?: boolean
          logo_path?: string | null
          name?: string
          office_phone?: string | null
          short_name?: string | null
          signature_holder_name?: string | null
          signature_holder_title?: string | null
          signature_image_path?: string | null
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          currency?: string
          daily_sms_earliest_time?: string
          daily_sms_enabled?: boolean
          daily_sms_grace_minutes?: number
          default_locale?: string
          email?: string | null
          id?: boolean
          logo_path?: string | null
          name?: string
          office_phone?: string | null
          short_name?: string | null
          signature_holder_name?: string | null
          signature_holder_title?: string | null
          signature_image_path?: string | null
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      school_weekends: {
        Row: {
          weekday: number
        }
        Insert: {
          weekday: number
        }
        Update: {
          weekday?: number
        }
        Relationships: []
      }
      sections: {
        Row: {
          capacity: number | null
          class_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          capacity?: number | null
          class_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          capacity?: number | null
          class_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sections_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_delivery_logs: {
        Row: {
          attempted_at: string
          cost: number | null
          currency: string | null
          error_code: string | null
          error_message: string | null
          id: string
          job_id: string
          mode: string
          provider: string
          provider_message_id: string | null
          request_payload: Json | null
          response_payload: Json | null
          segments: number | null
          status: string | null
        }
        Insert: {
          attempted_at?: string
          cost?: number | null
          currency?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          job_id: string
          mode?: string
          provider: string
          provider_message_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          segments?: number | null
          status?: string | null
        }
        Update: {
          attempted_at?: string
          cost?: number | null
          currency?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          job_id?: string
          mode?: string
          provider?: string
          provider_message_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          segments?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_delivery_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "notification_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      student_attendance: {
        Row: {
          id: string
          marked_at: string
          marked_by: string | null
          remark: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
          teaching_session_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          marked_at?: string
          marked_by?: string | null
          remark?: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
          teaching_session_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          marked_at?: string
          marked_by?: string | null
          remark?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          student_id?: string
          teaching_session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_attendance_marked_by_fkey"
            columns: ["marked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_attendance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_attendance_teaching_session_id_fkey"
            columns: ["teaching_session_id"]
            isOneToOne: false
            referencedRelation: "teaching_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      student_contacts: {
        Row: {
          created_at: string
          holder_name: string | null
          id: string
          is_sms_target: boolean
          label: string
          phone: string
          student_id: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          holder_name?: string | null
          id?: string
          is_sms_target?: boolean
          label?: string
          phone: string
          student_id: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          holder_name?: string | null
          id?: string
          is_sms_target?: boolean
          label?: string
          phone?: string
          student_id?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_contacts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_enrollments: {
        Row: {
          academic_year_id: string
          class_id: string
          created_at: string
          created_by: string | null
          enrolled_on: string
          id: string
          left_on: string | null
          promoted_from_id: string | null
          roll_no: number
          section_id: string
          status: Database["public"]["Enums"]["enrollment_status"]
          student_id: string
          updated_at: string
        }
        Insert: {
          academic_year_id: string
          class_id: string
          created_at?: string
          created_by?: string | null
          enrolled_on?: string
          id?: string
          left_on?: string | null
          promoted_from_id?: string | null
          roll_no: number
          section_id: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          student_id: string
          updated_at?: string
        }
        Update: {
          academic_year_id?: string
          class_id?: string
          created_at?: string
          created_by?: string | null
          enrolled_on?: string
          id?: string
          left_on?: string | null
          promoted_from_id?: string | null
          roll_no?: number
          section_id?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_enrollments_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_enrollments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_enrollments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_enrollments_promoted_from_id_fkey"
            columns: ["promoted_from_id"]
            isOneToOne: false
            referencedRelation: "student_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_enrollments_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_private_ids: {
        Row: {
          birth_certificate_no: string | null
          created_at: string
          father_nid: string | null
          mother_nid: string | null
          student_id: string
          updated_at: string
        }
        Insert: {
          birth_certificate_no?: string | null
          created_at?: string
          father_nid?: string | null
          mother_nid?: string | null
          student_id: string
          updated_at?: string
        }
        Update: {
          birth_certificate_no?: string | null
          created_at?: string
          father_nid?: string | null
          mother_nid?: string | null
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_private_ids_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          admitted_on: string
          auth_user_id: string | null
          blood_group: Database["public"]["Enums"]["blood_group"] | null
          created_at: string
          created_by: string | null
          date_of_birth: string
          father_name: string
          full_name: string
          full_name_bn: string | null
          gender: Database["public"]["Enums"]["gender"]
          id: string
          mother_name: string
          photo_bytes: number | null
          photo_path: string | null
          registration_no: string
          status: Database["public"]["Enums"]["enrollment_status"]
          updated_at: string
        }
        Insert: {
          admitted_on?: string
          auth_user_id?: string | null
          blood_group?: Database["public"]["Enums"]["blood_group"] | null
          created_at?: string
          created_by?: string | null
          date_of_birth: string
          father_name: string
          full_name: string
          full_name_bn?: string | null
          gender: Database["public"]["Enums"]["gender"]
          id?: string
          mother_name: string
          photo_bytes?: number | null
          photo_path?: string | null
          registration_no: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
        }
        Update: {
          admitted_on?: string
          auth_user_id?: string | null
          blood_group?: Database["public"]["Enums"]["blood_group"] | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string
          father_name?: string
          full_name?: string
          full_name_bn?: string | null
          gender?: Database["public"]["Enums"]["gender"]
          id?: string
          mother_name?: string
          photo_bytes?: number | null
          photo_path?: string | null
          registration_no?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          name_bn: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          name_bn?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          name_bn?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      teacher_assignments: {
        Row: {
          academic_year_id: string
          class_id: string
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          section_id: string
          subject_id: string
          teacher_id: string
          updated_at: string
        }
        Insert: {
          academic_year_id: string
          class_id: string
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          section_id: string
          subject_id: string
          teacher_id: string
          updated_at?: string
        }
        Update: {
          academic_year_id?: string
          class_id?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          section_id?: string
          subject_id?: string
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_assignments_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_assignments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_assignments_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_assignments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_assignments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_daily_attendance: {
        Row: {
          computed_at: string
          early_out_minutes: number
          first_in: string | null
          id: string
          is_manual_override: boolean
          last_out: string | null
          late_minutes: number
          leave_request_id: string | null
          overridden_at: string | null
          overridden_by: string | null
          override_reason: string | null
          override_status:
            | Database["public"]["Enums"]["teacher_day_status"]
            | null
          punch_count: number
          status: Database["public"]["Enums"]["teacher_day_status"]
          teacher_id: string
          updated_at: string
          work_date: string
          worked_minutes: number | null
        }
        Insert: {
          computed_at?: string
          early_out_minutes?: number
          first_in?: string | null
          id?: string
          is_manual_override?: boolean
          last_out?: string | null
          late_minutes?: number
          leave_request_id?: string | null
          overridden_at?: string | null
          overridden_by?: string | null
          override_reason?: string | null
          override_status?:
            | Database["public"]["Enums"]["teacher_day_status"]
            | null
          punch_count?: number
          status?: Database["public"]["Enums"]["teacher_day_status"]
          teacher_id: string
          updated_at?: string
          work_date: string
          worked_minutes?: number | null
        }
        Update: {
          computed_at?: string
          early_out_minutes?: number
          first_in?: string | null
          id?: string
          is_manual_override?: boolean
          last_out?: string | null
          late_minutes?: number
          leave_request_id?: string | null
          overridden_at?: string | null
          overridden_by?: string | null
          override_reason?: string | null
          override_status?:
            | Database["public"]["Enums"]["teacher_day_status"]
            | null
          punch_count?: number
          status?: Database["public"]["Enums"]["teacher_day_status"]
          teacher_id?: string
          updated_at?: string
          work_date?: string
          worked_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "teacher_daily_attendance_leave_request_id_fkey"
            columns: ["leave_request_id"]
            isOneToOne: false
            referencedRelation: "leave_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_daily_attendance_overridden_by_fkey"
            columns: ["overridden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_daily_attendance_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_private_ids: {
        Row: {
          created_at: string
          nid: string
          teacher_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          nid: string
          teacher_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          nid?: string
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_private_ids_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: true
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_shifts: {
        Row: {
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          shift_id: string
          teacher_id: string
        }
        Insert: {
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          shift_id: string
          teacher_id: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          shift_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_shifts_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "work_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_shifts_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          alternate_phone: string | null
          auth_user_id: string | null
          blood_group: Database["public"]["Enums"]["blood_group"] | null
          created_at: string
          created_by: string | null
          designation: string | null
          education: string | null
          email: string | null
          employee_code: string
          father_name: string | null
          full_name: string
          full_name_bn: string | null
          gender: Database["public"]["Enums"]["gender"]
          id: string
          is_active: boolean
          joined_on: string | null
          mother_name: string | null
          personal_phone: string
          photo_path: string | null
          updated_at: string
        }
        Insert: {
          alternate_phone?: string | null
          auth_user_id?: string | null
          blood_group?: Database["public"]["Enums"]["blood_group"] | null
          created_at?: string
          created_by?: string | null
          designation?: string | null
          education?: string | null
          email?: string | null
          employee_code: string
          father_name?: string | null
          full_name: string
          full_name_bn?: string | null
          gender: Database["public"]["Enums"]["gender"]
          id?: string
          is_active?: boolean
          joined_on?: string | null
          mother_name?: string | null
          personal_phone: string
          photo_path?: string | null
          updated_at?: string
        }
        Update: {
          alternate_phone?: string | null
          auth_user_id?: string | null
          blood_group?: Database["public"]["Enums"]["blood_group"] | null
          created_at?: string
          created_by?: string | null
          designation?: string | null
          education?: string | null
          email?: string | null
          employee_code?: string
          father_name?: string | null
          full_name?: string
          full_name_bn?: string | null
          gender?: Database["public"]["Enums"]["gender"]
          id?: string
          is_active?: boolean
          joined_on?: string | null
          mother_name?: string | null
          personal_phone?: string
          photo_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teachers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teaching_sessions: {
        Row: {
          class_id: string
          created_at: string
          ends_at: string
          id: string
          is_cancelled: boolean
          period_no: number
          routine_period_id: string
          section_id: string
          session_date: string
          starts_at: string
          subject_id: string
          submitted_at: string | null
          submitted_by: string | null
          teacher_id: string
          updated_at: string
        }
        Insert: {
          class_id: string
          created_at?: string
          ends_at: string
          id?: string
          is_cancelled?: boolean
          period_no: number
          routine_period_id: string
          section_id: string
          session_date: string
          starts_at: string
          subject_id: string
          submitted_at?: string | null
          submitted_by?: string | null
          teacher_id: string
          updated_at?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          is_cancelled?: boolean
          period_no?: number
          routine_period_id?: string
          section_id?: string
          session_date?: string
          starts_at?: string
          subject_id?: string
          submitted_at?: string | null
          submitted_by?: string | null
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teaching_sessions_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_sessions_routine_period_id_fkey"
            columns: ["routine_period_id"]
            isOneToOne: false
            referencedRelation: "routine_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_sessions_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_sessions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_sessions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_sessions_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      terms: {
        Row: {
          academic_year_id: string
          attendance_window_end: string | null
          attendance_window_start: string | null
          created_at: string
          ends_on: string
          id: string
          name: string
          sequence: number
          starts_on: string
          status: Database["public"]["Enums"]["term_status"]
          updated_at: string
        }
        Insert: {
          academic_year_id: string
          attendance_window_end?: string | null
          attendance_window_start?: string | null
          created_at?: string
          ends_on: string
          id?: string
          name: string
          sequence: number
          starts_on: string
          status?: Database["public"]["Enums"]["term_status"]
          updated_at?: string
        }
        Update: {
          academic_year_id?: string
          attendance_window_end?: string | null
          attendance_window_start?: string | null
          created_at?: string
          ends_on?: string
          id?: string
          name?: string
          sequence?: number
          starts_on?: string
          status?: Database["public"]["Enums"]["term_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "terms_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
        ]
      }
      work_shifts: {
        Row: {
          created_at: string
          earliest_in: string
          ends_at: string
          grace_minutes: number
          id: string
          is_default: boolean
          latest_out: string
          name: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          earliest_in?: string
          ends_at: string
          grace_minutes?: number
          id?: string
          is_default?: boolean
          latest_out?: string
          name: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          earliest_in?: string
          ends_at?: string
          grace_minutes?: number
          id?: string
          is_default?: boolean
          latest_out?: string
          name?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admit_card_eligibility: {
        Args: { p_exam_id: string; p_student_id: string }
        Returns: Json
      }
      feedback_analysis: {
        Args: { p_campaign_id: string; p_min_responses?: number }
        Returns: {
          average_rating: number
          below_sample_floor: boolean
          prompt: string
          question_id: string
          response_count: number
          teacher_id: string
          teacher_name: string
        }[]
      }
      get_public_card: { Args: { p_token: string }; Returns: Json }
      submit_feedback: {
        Args: {
          p_campaign_id: string
          p_comment?: string
          p_ratings: Json
          p_target_id: string
        }
        Returns: Json
      }
      timemultirange: { Args: never; Returns: unknown }
    }
    Enums: {
      attendance_status: "present" | "absent" | "late" | "excused"
      audit_action: "insert" | "update" | "delete"
      blood_group: "A+" | "A-" | "B+" | "B-" | "O+" | "O-" | "AB+" | "AB-"
      card_orientation: "portrait" | "landscape"
      class_test_status: "draft" | "marks_entered" | "sent"
      document_kind:
        | "admit_card"
        | "id_card"
        | "seat_token"
        | "result_sheet"
        | "fee_receipt"
        | "class_routine"
        | "school_routine"
      enrollment_status:
        | "active"
        | "promoted"
        | "transferred"
        | "withdrawn"
        | "graduated"
      exam_status:
        | "draft"
        | "scheduled"
        | "marks_open"
        | "marks_closed"
        | "published"
      fee_charge_status: "pending" | "partial" | "paid" | "waived" | "cancelled"
      feedback_campaign_status: "draft" | "open" | "closed"
      gender: "male" | "female" | "other"
      leave_status: "pending" | "approved" | "rejected" | "cancelled"
      notification_status:
        | "pending"
        | "queued"
        | "sent"
        | "failed"
        | "cancelled"
        | "skipped"
      notification_type:
        | "daily_attendance"
        | "exam_result"
        | "class_test_result"
        | "account_otp"
        | "attendance_correction"
        | "custom"
      otp_purpose: "activation" | "password_reset" | "phone_change"
      payment_method:
        | "cash"
        | "bkash"
        | "nagad"
        | "rocket"
        | "bank"
        | "cheque"
        | "other"
      teacher_day_status:
        | "present"
        | "absent"
        | "late"
        | "approved_leave"
        | "holiday"
        | "weekend"
        | "no_data"
      term_status: "upcoming" | "active" | "closed"
      user_role: "authority_admin" | "authority_staff" | "teacher" | "student"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      attendance_status: ["present", "absent", "late", "excused"],
      audit_action: ["insert", "update", "delete"],
      blood_group: ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"],
      card_orientation: ["portrait", "landscape"],
      class_test_status: ["draft", "marks_entered", "sent"],
      document_kind: [
        "admit_card",
        "id_card",
        "seat_token",
        "result_sheet",
        "fee_receipt",
        "class_routine",
        "school_routine",
      ],
      enrollment_status: [
        "active",
        "promoted",
        "transferred",
        "withdrawn",
        "graduated",
      ],
      exam_status: [
        "draft",
        "scheduled",
        "marks_open",
        "marks_closed",
        "published",
      ],
      fee_charge_status: ["pending", "partial", "paid", "waived", "cancelled"],
      feedback_campaign_status: ["draft", "open", "closed"],
      gender: ["male", "female", "other"],
      leave_status: ["pending", "approved", "rejected", "cancelled"],
      notification_status: [
        "pending",
        "queued",
        "sent",
        "failed",
        "cancelled",
        "skipped",
      ],
      notification_type: [
        "daily_attendance",
        "exam_result",
        "class_test_result",
        "account_otp",
        "attendance_correction",
        "custom",
      ],
      otp_purpose: ["activation", "password_reset", "phone_change"],
      payment_method: [
        "cash",
        "bkash",
        "nagad",
        "rocket",
        "bank",
        "cheque",
        "other",
      ],
      teacher_day_status: [
        "present",
        "absent",
        "late",
        "approved_leave",
        "holiday",
        "weekend",
        "no_data",
      ],
      term_status: ["upcoming", "active", "closed"],
      user_role: ["authority_admin", "authority_staff", "teacher", "student"],
    },
  },
} as const
