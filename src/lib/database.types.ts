export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      appointment_services: {
        Row: {
          appointment_id: string
          duration_minutes: number
          id: string
          price_cents: number
          processing_window_minutes: number
          service_id: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          appointment_id: string
          duration_minutes: number
          id?: string
          price_cents: number
          processing_window_minutes?: number
          service_id: string
          sort_order?: number
          tenant_id: string
        }
        Update: {
          appointment_id?: string
          duration_minutes?: number
          id?: string
          price_cents?: number
          processing_window_minutes?: number
          service_id?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_services_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          arrived_at: string | null
          buffer_ends_at: string
          buffer_starts_at: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          child_age: number | null
          child_first_name: string | null
          client_id: string
          client_record_id: string
          created_at: string
          ends_at: string
          id: string
          is_for_child: boolean
          redo_of_appointment_id: string | null
          service_ended_at: string | null
          service_started_at: string | null
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          stylist_id: string
          tenant_id: string
          total_price_cents: number
          updated_at: string
        }
        Insert: {
          arrived_at?: string | null
          buffer_ends_at: string
          buffer_starts_at: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          child_age?: number | null
          child_first_name?: string | null
          client_id: string
          client_record_id: string
          created_at?: string
          ends_at: string
          id?: string
          is_for_child?: boolean
          redo_of_appointment_id?: string | null
          service_ended_at?: string | null
          service_started_at?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          stylist_id: string
          tenant_id: string
          total_price_cents?: number
          updated_at?: string
        }
        Update: {
          arrived_at?: string | null
          buffer_ends_at?: string
          buffer_starts_at?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          child_age?: number | null
          child_first_name?: string | null
          client_id?: string
          client_record_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          is_for_child?: boolean
          redo_of_appointment_id?: string | null
          service_ended_at?: string | null
          service_started_at?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          stylist_id?: string
          tenant_id?: string
          total_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_client_record_id_fkey"
            columns: ["client_record_id"]
            isOneToOne: false
            referencedRelation: "client_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_redo_of_appointment_id_fkey"
            columns: ["redo_of_appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_stylist_id_fkey"
            columns: ["stylist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_requests: {
        Row: {
          appointment_id: string | null
          child_age: number | null
          child_first_name: string | null
          client_counters_used: number
          client_id: string
          client_record_id: string
          created_at: string
          deposit_amount_cents: number
          deposit_required: boolean
          global_deadline: string
          id: string
          is_for_child: boolean
          proposed_ends_at: string
          proposed_starts_at: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["booking_request_status"]
          step_deadline: string
          stripe_payment_intent_id: string | null
          stylist_id: string
          stylist_offers_used: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          child_age?: number | null
          child_first_name?: string | null
          client_counters_used?: number
          client_id: string
          client_record_id: string
          created_at?: string
          deposit_amount_cents?: number
          deposit_required?: boolean
          global_deadline: string
          id?: string
          is_for_child?: boolean
          proposed_ends_at: string
          proposed_starts_at: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["booking_request_status"]
          step_deadline: string
          stripe_payment_intent_id?: string | null
          stylist_id: string
          stylist_offers_used?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          child_age?: number | null
          child_first_name?: string | null
          client_counters_used?: number
          client_id?: string
          client_record_id?: string
          created_at?: string
          deposit_amount_cents?: number
          deposit_required?: boolean
          global_deadline?: string
          id?: string
          is_for_child?: boolean
          proposed_ends_at?: string
          proposed_starts_at?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["booking_request_status"]
          step_deadline?: string
          stripe_payment_intent_id?: string | null
          stylist_id?: string
          stylist_offers_used?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_requests_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requests_client_record_id_fkey"
            columns: ["client_record_id"]
            isOneToOne: false
            referencedRelation: "client_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requests_stylist_id_fkey"
            columns: ["stylist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      business_hours: {
        Row: {
          closes_at: string
          id: string
          opens_at: string
          tenant_id: string
          weekday: number
        }
        Insert: {
          closes_at: string
          id?: string
          opens_at: string
          tenant_id: string
          weekday: number
        }
        Update: {
          closes_at?: string
          id?: string
          opens_at?: string
          tenant_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_hours_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_invites: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          tenant_id: string
          token: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          tenant_id: string
          token?: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_invites_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_records: {
        Row: {
          client_id: string
          created_at: string
          first_seen_at: string
          id: string
          invited_by: string | null
          last_seen_at: string | null
          no_show_count: number
          requires_prepay: boolean
          safety_flag: string | null
          tenant_id: string
          updated_at: string
          visit_count: number
        }
        Insert: {
          client_id: string
          created_at?: string
          first_seen_at?: string
          id?: string
          invited_by?: string | null
          last_seen_at?: string | null
          no_show_count?: number
          requires_prepay?: boolean
          safety_flag?: string | null
          tenant_id: string
          updated_at?: string
          visit_count?: number
        }
        Update: {
          client_id?: string
          created_at?: string
          first_seen_at?: string
          id?: string
          invited_by?: string | null
          last_seen_at?: string | null
          no_show_count?: number
          requires_prepay?: boolean
          safety_flag?: string | null
          tenant_id?: string
          updated_at?: string
          visit_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_records_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_records_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tags: {
        Row: {
          client_record_id: string
          created_at: string
          created_by: string | null
          id: string
          tag: Database["public"]["Enums"]["client_tag_kind"]
          tenant_id: string
        }
        Insert: {
          client_record_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          tag: Database["public"]["Enums"]["client_tag_kind"]
          tenant_id: string
        }
        Update: {
          client_record_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          tag?: Database["public"]["Enums"]["client_tag_kind"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tags_client_record_id_fkey"
            columns: ["client_record_id"]
            isOneToOne: false
            referencedRelation: "client_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          phone: string | null
          profile_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          phone?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          appointment_id: string | null
          client_record_id: string
          contraindications_disclosed: boolean | null
          created_at: string
          document_version: string
          expires_at: string | null
          id: string
          kind: Database["public"]["Enums"]["consent_kind"]
          proceeded: boolean | null
          product_tested: string | null
          result: Database["public"]["Enums"]["patch_test_result"] | null
          signature_path: string | null
          signed_at: string
          signed_by_guardian: boolean
          signed_by_name: string
          tenant_id: string
        }
        Insert: {
          appointment_id?: string | null
          client_record_id: string
          contraindications_disclosed?: boolean | null
          created_at?: string
          document_version: string
          expires_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["consent_kind"]
          proceeded?: boolean | null
          product_tested?: string | null
          result?: Database["public"]["Enums"]["patch_test_result"] | null
          signature_path?: string | null
          signed_at?: string
          signed_by_guardian?: boolean
          signed_by_name: string
          tenant_id: string
        }
        Update: {
          appointment_id?: string | null
          client_record_id?: string
          contraindications_disclosed?: boolean | null
          created_at?: string
          document_version?: string
          expires_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["consent_kind"]
          proceeded?: boolean | null
          product_tested?: string | null
          result?: Database["public"]["Enums"]["patch_test_result"] | null
          signature_path?: string | null
          signed_at?: string
          signed_by_guardian?: boolean
          signed_by_name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consents_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_client_record_id_fkey"
            columns: ["client_record_id"]
            isOneToOne: false
            referencedRelation: "client_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      formula_photos: {
        Row: {
          appointment_id: string
          consent_granted_at: string | null
          consent_revoked_at: string | null
          consented_to_publish: boolean
          created_at: string
          formula_id: string | null
          id: string
          stage: Database["public"]["Enums"]["photo_stage"]
          storage_path: string
          tenant_id: string
        }
        Insert: {
          appointment_id: string
          consent_granted_at?: string | null
          consent_revoked_at?: string | null
          consented_to_publish?: boolean
          created_at?: string
          formula_id?: string | null
          id?: string
          stage?: Database["public"]["Enums"]["photo_stage"]
          storage_path: string
          tenant_id: string
        }
        Update: {
          appointment_id?: string
          consent_granted_at?: string | null
          consent_revoked_at?: string | null
          consented_to_publish?: boolean
          created_at?: string
          formula_id?: string | null
          id?: string
          stage?: Database["public"]["Enums"]["photo_stage"]
          storage_path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "formula_photos_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formula_photos_formula_id_fkey"
            columns: ["formula_id"]
            isOneToOne: false
            referencedRelation: "formulas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formula_photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      formulas: {
        Row: {
          appointment_id: string
          client_record_id: string
          components: Json
          created_at: string
          created_by: string | null
          developer_volume: string | null
          id: string
          processing_time_minutes: number | null
          technique_notes: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          client_record_id: string
          components?: Json
          created_at?: string
          created_by?: string | null
          developer_volume?: string | null
          id?: string
          processing_time_minutes?: number | null
          technique_notes?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          client_record_id?: string
          components?: Json
          created_at?: string
          created_by?: string | null
          developer_volume?: string | null
          id?: string
          processing_time_minutes?: number | null
          technique_notes?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "formulas_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formulas_client_record_id_fkey"
            columns: ["client_record_id"]
            isOneToOne: false
            referencedRelation: "client_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formulas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formulas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          brand: string | null
          cost_cents: number | null
          created_at: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["stock_kind"]
          name: string
          price_cents: number | null
          quantity_on_hand: number
          reorder_point: number | null
          tenant_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          brand?: string | null
          cost_cents?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["stock_kind"]
          name: string
          price_cents?: number | null
          quantity_on_hand?: number
          reorder_point?: number | null
          tenant_id: string
          unit?: string
          updated_at?: string
        }
        Update: {
          brand?: string | null
          cost_cents?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["stock_kind"]
          name?: string
          price_cents?: number | null
          quantity_on_hand?: number
          reorder_point?: number | null
          tenant_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiation_events: {
        Row: {
          action: Database["public"]["Enums"]["negotiation_action"]
          actor: Database["public"]["Enums"]["negotiation_actor"]
          actor_profile_id: string | null
          created_at: string
          id: string
          note: string | null
          proposed_ends_at: string | null
          proposed_starts_at: string | null
          request_id: string
          tenant_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["negotiation_action"]
          actor: Database["public"]["Enums"]["negotiation_actor"]
          actor_profile_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          proposed_ends_at?: string | null
          proposed_starts_at?: string | null
          request_id: string
          tenant_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["negotiation_action"]
          actor?: Database["public"]["Enums"]["negotiation_actor"]
          actor_profile_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          proposed_ends_at?: string | null
          proposed_starts_at?: string | null
          request_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "booking_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          appointment_id: string | null
          authorized_at: string | null
          booking_request_id: string | null
          captured_at: string | null
          client_id: string | null
          created_at: string
          fee_cents: number
          id: string
          kind: Database["public"]["Enums"]["payment_kind"]
          released_at: string | null
          status: Database["public"]["Enums"]["payment_status"]
          stripe_charge_id: string | null
          stripe_payment_intent_id: string | null
          tenant_id: string
          tip_cents: number
          updated_at: string
        }
        Insert: {
          amount_cents: number
          appointment_id?: string | null
          authorized_at?: string | null
          booking_request_id?: string | null
          captured_at?: string | null
          client_id?: string | null
          created_at?: string
          fee_cents?: number
          id?: string
          kind: Database["public"]["Enums"]["payment_kind"]
          released_at?: string | null
          status: Database["public"]["Enums"]["payment_status"]
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          tenant_id: string
          tip_cents?: number
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          appointment_id?: string | null
          authorized_at?: string | null
          booking_request_id?: string | null
          captured_at?: string | null
          client_id?: string | null
          created_at?: string
          fee_cents?: number
          id?: string
          kind?: Database["public"]["Enums"]["payment_kind"]
          released_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          tenant_id?: string
          tip_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_booking_request_id_fkey"
            columns: ["booking_request_id"]
            isOneToOne: false
            referencedRelation: "booking_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      services: {
        Row: {
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          name: string
          price_cents: number
          processing_starts_after_minutes: number
          processing_window_minutes: number
          requires_patch_test: boolean
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_minutes: number
          id?: string
          is_active?: boolean
          name: string
          price_cents: number
          processing_starts_after_minutes?: number
          processing_window_minutes?: number
          requires_patch_test?: boolean
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          price_cents?: number
          processing_starts_after_minutes?: number
          processing_window_minutes?: number
          requires_patch_test?: boolean
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stylist_invitations: {
        Row: {
          booth_rent_cents: number
          chair_id: string
          claimed_at: string | null
          claimed_by: string | null
          classification: Database["public"]["Enums"]["worker_classification"]
          created_at: string
          display_name: string
          email: string
          id: string
          invited_by: string | null
          rent_interval: string
          salon_id: string
        }
        Insert: {
          booth_rent_cents?: number
          chair_id: string
          claimed_at?: string | null
          claimed_by?: string | null
          classification: Database["public"]["Enums"]["worker_classification"]
          created_at?: string
          display_name: string
          email: string
          id?: string
          invited_by?: string | null
          rent_interval?: string
          salon_id: string
        }
        Update: {
          booth_rent_cents?: number
          chair_id?: string
          claimed_at?: string | null
          claimed_by?: string | null
          classification?: Database["public"]["Enums"]["worker_classification"]
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          invited_by?: string | null
          rent_interval?: string
          salon_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stylist_invitations_chair_id_fkey"
            columns: ["chair_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stylist_invitations_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stylist_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stylist_invitations_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stylist_profiles: {
        Row: {
          avatar_path: string | null
          bio: string | null
          created_at: string
          display_name: string
          headline: string | null
          instagram_handle: string | null
          is_published: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string
          headline?: string | null
          instagram_handle?: string | null
          is_published?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string
          headline?: string | null
          instagram_handle?: string | null
          is_published?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stylist_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stylist_settings: {
        Row: {
          arrival_note: string
          buffer_minutes: number
          created_at: string
          deposit_min_cents: number
          deposit_percent: number
          free_cancel_hours: number
          gap_buffer_minutes: number
          late_cancel_hours: number
          no_show_grace_minutes: number
          prepay_after_no_shows: number
          redo_window_days: number
          requires_deposit: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          arrival_note?: string
          buffer_minutes?: number
          created_at?: string
          deposit_min_cents?: number
          deposit_percent?: number
          free_cancel_hours?: number
          gap_buffer_minutes?: number
          late_cancel_hours?: number
          no_show_grace_minutes?: number
          prepay_after_no_shows?: number
          redo_window_days?: number
          requires_deposit?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          arrival_note?: string
          buffer_minutes?: number
          created_at?: string
          deposit_min_cents?: number
          deposit_percent?: number
          free_cancel_hours?: number
          gap_buffer_minutes?: number
          late_cancel_hours?: number
          no_show_grace_minutes?: number
          prepay_after_no_shows?: number
          redo_window_days?: number
          requires_deposit?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stylist_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_members: {
        Row: {
          classification:
            | Database["public"]["Enums"]["worker_classification"]
            | null
          id: string
          is_active: boolean
          joined_at: string
          profile_id: string
          role: Database["public"]["Enums"]["member_role"]
          tenant_id: string
        }
        Insert: {
          classification?:
            | Database["public"]["Enums"]["worker_classification"]
            | null
          id?: string
          is_active?: boolean
          joined_at?: string
          profile_id: string
          role: Database["public"]["Enums"]["member_role"]
          tenant_id: string
        }
        Update: {
          classification?:
            | Database["public"]["Enums"]["worker_classification"]
            | null
          id?: string
          is_active?: boolean
          joined_at?: string
          profile_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["tenant_kind"]
          name: string
          parent_salon_id: string | null
          timezone: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["tenant_kind"]
          name: string
          parent_salon_id?: string | null
          timezone?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["tenant_kind"]
          name?: string
          parent_salon_id?: string | null
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenants_parent_salon_id_fkey"
            columns: ["parent_salon_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      time_blocks: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          reason: string | null
          starts_at: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          reason?: string | null
          starts_at: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          reason?: string | null
          starts_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_blocks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_entries: {
        Row: {
          claimed_at: string | null
          client_id: string
          created_at: string
          id: string
          offer_expires_at: string | null
          offered_at: string | null
          service_id: string | null
          tenant_id: string
          window_ends_on: string
          window_starts_on: string
        }
        Insert: {
          claimed_at?: string | null
          client_id: string
          created_at?: string
          id?: string
          offer_expires_at?: string | null
          offered_at?: string | null
          service_id?: string | null
          tenant_id: string
          window_ends_on: string
          window_starts_on: string
        }
        Update: {
          claimed_at?: string | null
          client_id?: string
          created_at?: string
          id?: string
          offer_expires_at?: string | null
          offered_at?: string | null
          service_id?: string | null
          tenant_id?: string
          window_ends_on?: string
          window_starts_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_tenant_ids: { Args: never; Returns: string[] }
      administered_child_tenant_ids: { Args: never; Returns: string[] }
      claim_client_invite: { Args: { p_token: string }; Returns: string }
      claim_stylist_invitation: { Args: never; Returns: string }
      create_salon: {
        Args: { salon_name: string; salon_timezone?: string }
        Returns: string
      }
      current_client_ids: { Args: never; Returns: string[] }
      current_tenant_ids: { Args: never; Returns: string[] }
      invite_stylist: {
        Args: {
          p_booth_rent_cents?: number
          p_classification: Database["public"]["Enums"]["worker_classification"]
          p_display_name: string
          p_email: string
          p_rent_interval?: string
        }
        Returns: string
      }
      offboard_stylist: { Args: { p_chair_id: string }; Returns: undefined }
    }
    Enums: {
      appointment_status:
        | "confirmed"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "no_show"
      booking_request_status:
        | "awaiting_stylist"
        | "awaiting_client"
        | "accepted"
        | "declined"
        | "cancelled"
        | "expired"
      client_tag_kind:
        | "needs_extra_time"
        | "talker"
        | "runs_late"
        | "punctual"
        | "prefers_morning"
        | "prefers_afternoon"
        | "prefers_evening"
        | "sensitive_scalp"
        | "no_show_risk"
      consent_kind:
        | "patch_test"
        | "service_intake"
        | "photo_release"
        | "policy_ack"
      member_role: "admin" | "stylist"
      negotiation_action:
        | "request"
        | "accept"
        | "decline"
        | "cancel"
        | "reschedule"
        | "counter"
        | "expire"
        | "hold_released"
      negotiation_actor: "client" | "stylist" | "system"
      patch_test_result: "pass" | "fail" | "reaction"
      payment_kind: "deposit" | "service" | "retail" | "booth_rent" | "refund"
      payment_status:
        | "authorized"
        | "captured"
        | "released"
        | "refunded"
        | "failed"
      photo_stage: "before" | "processing" | "after" | "reference"
      stock_kind: "backbar" | "retail"
      tenant_kind: "salon" | "stylist"
      worker_classification:
        | "contractor_1099"
        | "employee_w2"
        | "owner_operator"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      appointment_status: [
        "confirmed",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
      ],
      booking_request_status: [
        "awaiting_stylist",
        "awaiting_client",
        "accepted",
        "declined",
        "cancelled",
        "expired",
      ],
      client_tag_kind: [
        "needs_extra_time",
        "talker",
        "runs_late",
        "punctual",
        "prefers_morning",
        "prefers_afternoon",
        "prefers_evening",
        "sensitive_scalp",
        "no_show_risk",
      ],
      consent_kind: [
        "patch_test",
        "service_intake",
        "photo_release",
        "policy_ack",
      ],
      member_role: ["admin", "stylist"],
      negotiation_action: [
        "request",
        "accept",
        "decline",
        "cancel",
        "reschedule",
        "counter",
        "expire",
        "hold_released",
      ],
      negotiation_actor: ["client", "stylist", "system"],
      patch_test_result: ["pass", "fail", "reaction"],
      payment_kind: ["deposit", "service", "retail", "booth_rent", "refund"],
      payment_status: [
        "authorized",
        "captured",
        "released",
        "refunded",
        "failed",
      ],
      photo_stage: ["before", "processing", "after", "reference"],
      stock_kind: ["backbar", "retail"],
      tenant_kind: ["salon", "stylist"],
      worker_classification: [
        "contractor_1099",
        "employee_w2",
        "owner_operator",
      ],
    },
  },
} as const

