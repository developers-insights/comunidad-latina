// GENERADO desde Supabase (proyecto ktmbtpuhqqofdkisqseq) — NO editar a mano.
// Regenerar: MCP generate_typescript_types o `npx supabase gen types typescript`.
//
// REGENERADO ÍNTEGRAMENTE 2026-08-24, contra la base con la migración 0108
// aplicada. La regeneración anterior (2026-08-08) se había quedado en la 0076, y
// esos 32 números de diferencia eran la causa raíz de una familia entera de
// parches: cada tabla o columna nueva llegaba a la app como `never`, y el
// arreglo de turno era un `as unknown as` con un comentario prometiendo borrarlo
// "cuando se regeneren los tipos". Esta regeneración es ese momento.
//
// Lo que entra ahora y antes no existía para TypeScript:
//   · 0086–0088  integridad de contenido, disputas, `work_mode` en empleos y la
//                comisión por comunidad (`creator_commission_config`).
//   · 0089–0090  `post_tags`, `post_music` y `music_tracks`.
//   · 0093–0095  reseñas y horarios de negocio (`listing_reviews`,
//                `listing_review_stats`, `listing_hours`, `listing_hours_slots`).
//   · 0096–0099  módulo comunidad (`community_resources`), menú de publicación y
//                vencimiento de avisos (`listing_expiry_config`).
//   · 0101–0103  verificación paga (`verification_subscriptions`,
//                `verification_boost_grants`) y paquetes de servicio.
//   · 0105–0107  centro de acopio, `post_offers` y los campos de publicación
//                (`business_listing_id` en `posts`).
//
// POR QUÉ APARECEN TABLAS `*_caughtcode`. El proyecto de Supabase está
// COMPARTIDO con otro producto: su esquema vive en la misma base, en el mismo
// `public`, así que el generador lo trae. NO se borran a mano — un archivo
// generado que alguien editó deja de ser generado, y la próxima regeneración las
// devuelve igual. La app nunca las consulta.
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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_restrictions: {
        Row: {
          applied_by: string | null
          created_at: string
          expires_at: string | null
          id: string
          lifted_at: string | null
          lifted_by: string | null
          profile_id: string
          reason: string
          scope: string
          tenant_id: string
        }
        Insert: {
          applied_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          lifted_at?: string | null
          lifted_by?: string | null
          profile_id: string
          reason: string
          scope: string
          tenant_id: string
        }
        Update: {
          applied_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          lifted_at?: string | null
          lifted_by?: string | null
          profile_id?: string
          reason?: string
          scope?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_restrictions_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_restrictions_lifted_by_fkey"
            columns: ["lifted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_restrictions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_restrictions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      account_sanctions: {
        Row: {
          actor_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          kind: string
          profile_id: string
          reason: string
          scope: string
          tenant_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          kind: string
          profile_id: string
          reason: string
          scope?: string
          tenant_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          kind?: string
          profile_id?: string
          reason?: string
          scope?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_sanctions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_sanctions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_sanctions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      active_identities: {
        Row: {
          business_id: string
          profile_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          business_id: string
          profile_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          profile_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "active_identities_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "active_identities_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "active_identities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_sessions_caughtcode: {
        Row: {
          analysis_run_id: string
          conclusion_plain: string
          cost_usd: number
          created_at: string
          duration_ms: number
          id: string
          outcome: string
          recording_url: string | null
          steps: Json
          task_id: string
        }
        Insert: {
          analysis_run_id: string
          conclusion_plain: string
          cost_usd?: number
          created_at?: string
          duration_ms?: number
          id?: string
          outcome: string
          recording_url?: string | null
          steps?: Json
          task_id: string
        }
        Update: {
          analysis_run_id?: string
          conclusion_plain?: string
          cost_usd?: number
          created_at?: string
          duration_ms?: number
          id?: string
          outcome?: string
          recording_url?: string | null
          steps?: Json
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_sessions_caughtcode_analysis_run_id_fkey"
            columns: ["analysis_run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs_caughtcode"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_runs_caughtcode: {
        Row: {
          cost_breakdown: Json | null
          coverage: Json | null
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          progress: number
          project_id: string
          stage: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          cost_breakdown?: Json | null
          coverage?: Json | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          progress?: number
          project_id: string
          stage?: string | null
          started_at?: string | null
          status?: string
        }
        Update: {
          cost_breakdown?: Json | null
          coverage?: Json | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          progress?: number
          project_id?: string
          stage?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_runs_caughtcode_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_caughtcode"
            referencedColumns: ["id"]
          },
        ]
      }
      appeals: {
        Row: {
          created_at: string
          evidence_urls: string[]
          id: string
          profile_id: string
          reason: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          subject_ref: string | null
          subject_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          evidence_urls?: string[]
          id?: string
          profile_id: string
          reason: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject_ref?: string | null
          subject_type: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          evidence_urls?: string[]
          id?: string
          profile_id?: string
          reason?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject_ref?: string | null
          subject_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appeals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appeals_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appeals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_queries: {
        Row: {
          created_at: string
          expires_at: string
          helpful: boolean | null
          id: string
          profile_id: string | null
          question_hash: string
          sources_used: Json
          tenant_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          helpful?: boolean | null
          id?: string
          profile_id?: string | null
          question_hash: string
          sources_used?: Json
          tenant_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          helpful?: boolean | null
          id?: string
          profile_id?: string | null
          question_hash?: string
          sources_used?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_queries_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_queries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          meta: Json
          subject_id: string | null
          subject_kind: string | null
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          meta?: Json
          subject_id?: string | null
          subject_kind?: string | null
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          meta?: Json
          subject_id?: string | null
          subject_kind?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      boost_impressions: {
        Row: {
          boost_id: string
          impressions: number
          seen_on: string
          tenant_id: string
        }
        Insert: {
          boost_id: string
          impressions?: number
          seen_on?: string
          tenant_id: string
        }
        Update: {
          boost_id?: string
          impressions?: number
          seen_on?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "boost_impressions_boost_id_fkey"
            columns: ["boost_id"]
            isOneToOne: false
            referencedRelation: "boosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boost_impressions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      boosts: {
        Row: {
          amount_cents: number
          buyer_id: string
          created_at: string
          currency: string
          duration_days: number
          ends_at: string | null
          id: string
          listing_id: string
          origin: string
          package: string
          scope: string
          scope_area: string | null
          scope_country: string | null
          starts_at: string | null
          status: string
          stripe_checkout_session_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          buyer_id: string
          created_at?: string
          currency?: string
          duration_days: number
          ends_at?: string | null
          id?: string
          listing_id: string
          origin?: string
          package: string
          scope?: string
          scope_area?: string | null
          scope_country?: string | null
          starts_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          buyer_id?: string
          created_at?: string
          currency?: string
          duration_days?: number
          ends_at?: string | null
          id?: string
          listing_id?: string
          origin?: string
          package?: string
          scope?: string
          scope_area?: string | null
          scope_country?: string | null
          starts_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boosts_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boosts_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boosts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_receipts: {
        Row: {
          broadcast_id: string
          profile_id: string
          seen_at: string
        }
        Insert: {
          broadcast_id: string
          profile_id: string
          seen_at?: string
        }
        Update: {
          broadcast_id?: string
          profile_id?: string
          seen_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_receipts_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_receipts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_targets: {
        Row: {
          broadcast_id: string
          tenant_id: string
        }
        Insert: {
          broadcast_id: string
          tenant_id: string
        }
        Update: {
          broadcast_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_targets_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_targets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          body: string
          created_at: string
          created_by: string
          cta_url: string | null
          ends_at: string | null
          id: string
          severity: string
          starts_at: string
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          cta_url?: string | null
          ends_at?: string | null
          id?: string
          severity?: string
          starts_at?: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          cta_url?: string | null
          ends_at?: string | null
          id?: string
          severity?: string
          starts_at?: string
          title?: string
        }
        Relationships: []
      }
      business_accounts: {
        Row: {
          category: string | null
          created_at: string
          id: string
          listing_id: string | null
          name: string
          owner_id: string
          plan: string
          plan_status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tenant_id: string
          updated_at: string
          verified_presence: boolean
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          listing_id?: string | null
          name: string
          owner_id: string
          plan?: string
          plan_status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id: string
          updated_at?: string
          verified_presence?: boolean
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          listing_id?: string | null
          name?: string
          owner_id?: string
          plan?: string
          plan_status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id?: string
          updated_at?: string
          verified_presence?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "business_accounts_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      business_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          business_id: string
          created_at: string
          id: string
          metadata: Json
          target_ref: string | null
          target_type: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          business_id: string
          created_at?: string
          id?: string
          metadata?: Json
          target_ref?: string | null
          target_type?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          business_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          target_ref?: string | null
          target_type?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_audit_log_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      business_members: {
        Row: {
          business_id: string
          created_at: string
          id: string
          invited_by: string | null
          profile_id: string
          role: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          invited_by?: string | null
          profile_id: string
          role: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          profile_id?: string
          role?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      business_scores: {
        Row: {
          business_id: string
          computed_at: string
          factors: Json
          level: number
          score: number
          score_previous: number | null
          score_version: number
          tenant_id: string
        }
        Insert: {
          business_id: string
          computed_at?: string
          factors?: Json
          level?: number
          score?: number
          score_previous?: number | null
          score_version?: number
          tenant_id: string
        }
        Update: {
          business_id?: string
          computed_at?: string
          factors?: Json
          level?: number
          score?: number
          score_previous?: number | null
          score_version?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_scores_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_scores_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      business_verifications: {
        Row: {
          account_verified: boolean
          business_id: string
          commercial_info_status: string
          created_at: string
          documental_status: string
          platform_review_status: string
          stripe_status: string
          tenant_id: string
          updated_at: string
          verification_status: string
          verification_updated_at: string | null
        }
        Insert: {
          account_verified?: boolean
          business_id: string
          commercial_info_status?: string
          created_at?: string
          documental_status?: string
          platform_review_status?: string
          stripe_status?: string
          tenant_id: string
          updated_at?: string
          verification_status?: string
          verification_updated_at?: string | null
        }
        Update: {
          account_verified?: boolean
          business_id?: string
          commercial_info_status?: string
          created_at?: string
          documental_status?: string
          platform_review_status?: string
          stripe_status?: string
          tenant_id?: string
          updated_at?: string
          verification_status?: string
          verification_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_verifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_verifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          age_max: number | null
          age_min: number | null
          budget_cents: number
          cities: string[]
          countries: string[]
          created_at: string
          created_by: string
          currency: string
          duration_days: number
          ends_at: string | null
          id: string
          interests: string[]
          languages: string[]
          listing_id: string | null
          objective: string
          post_id: string | null
          review_note: string | null
          starts_at: string | null
          status: string
          stripe_checkout_session_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          age_max?: number | null
          age_min?: number | null
          budget_cents: number
          cities?: string[]
          countries?: string[]
          created_at?: string
          created_by: string
          currency?: string
          duration_days: number
          ends_at?: string | null
          id?: string
          interests?: string[]
          languages?: string[]
          listing_id?: string | null
          objective: string
          post_id?: string | null
          review_note?: string | null
          starts_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          age_max?: number | null
          age_min?: number | null
          budget_cents?: number
          cities?: string[]
          countries?: string[]
          created_at?: string
          created_by?: string
          currency?: string
          duration_days?: number
          ends_at?: string | null
          id?: string
          interests?: string[]
          languages?: string[]
          listing_id?: string | null
          objective?: string
          post_id?: string | null
          review_note?: string | null
          starts_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages_caughtcode: {
        Row: {
          citations: Json | null
          content: string
          created_at: string
          id: string
          role: string
          thread_id: string
        }
        Insert: {
          citations?: Json | null
          content: string
          created_at?: string
          id?: string
          role: string
          thread_id: string
        }
        Update: {
          citations?: Json | null
          content?: string
          created_at?: string
          id?: string
          role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_caughtcode_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads_caughtcode"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads_caughtcode: {
        Row: {
          created_at: string
          id: string
          project_id: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          title?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_threads_caughtcode_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_caughtcode"
            referencedColumns: ["id"]
          },
        ]
      }
      code_index_caughtcode: {
        Row: {
          analysis_run_id: string
          created_at: string
          db_schema: Json
          id: string
          ranked_files: Json
          routes: Json
          stats: Json
          symbol_graph: Json
        }
        Insert: {
          analysis_run_id: string
          created_at?: string
          db_schema?: Json
          id?: string
          ranked_files?: Json
          routes?: Json
          stats?: Json
          symbol_graph?: Json
        }
        Update: {
          analysis_run_id?: string
          created_at?: string
          db_schema?: Json
          id?: string
          ranked_files?: Json
          routes?: Json
          stats?: Json
          symbol_graph?: Json
        }
        Relationships: [
          {
            foreignKeyName: "code_index_caughtcode_analysis_run_id_fkey"
            columns: ["analysis_run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs_caughtcode"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_cleanups_caughtcode: {
        Row: {
          comments_removed: number
          created_at: string
          files_changed: number
          id: string
          mode: string
          patch_path: string | null
          project_id: string
          scan_id: string
          status: string
        }
        Insert: {
          comments_removed?: number
          created_at?: string
          files_changed?: number
          id?: string
          mode: string
          patch_path?: string | null
          project_id: string
          scan_id: string
          status?: string
        }
        Update: {
          comments_removed?: number
          created_at?: string
          files_changed?: number
          id?: string
          mode?: string
          patch_path?: string | null
          project_id?: string
          scan_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_cleanups_caughtcode_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_caughtcode"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_cleanups_caughtcode_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "comment_scans_caughtcode"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_scans_caughtcode: {
        Row: {
          analysis_run_id: string | null
          created_at: string
          exposed_count: number
          hits: Json
          id: string
          project_id: string
          removable_count: number
          risky_count: number
          scanned_files: number
        }
        Insert: {
          analysis_run_id?: string | null
          created_at?: string
          exposed_count?: number
          hits?: Json
          id?: string
          project_id: string
          removable_count?: number
          risky_count?: number
          scanned_files?: number
        }
        Update: {
          analysis_run_id?: string | null
          created_at?: string
          exposed_count?: number
          hits?: Json
          id?: string
          project_id?: string
          removable_count?: number
          risky_count?: number
          scanned_files?: number
        }
        Relationships: [
          {
            foreignKeyName: "comment_scans_caughtcode_analysis_run_id_fkey"
            columns: ["analysis_run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs_caughtcode"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_scans_caughtcode_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_caughtcode"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          post_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          post_id: string
          status?: string
          tenant_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          post_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      community_resources: {
        Row: {
          address: string | null
          area_label: string | null
          cost_note: string | null
          created_at: string
          description: string | null
          hours_note: string | null
          id: string
          languages: string[]
          name: string
          phone: string | null
          requirements_note: string | null
          source_checked_at: string
          source_name: string
          source_url: string
          status: string
          tenant_id: string | null
          topic: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          area_label?: string | null
          cost_note?: string | null
          created_at?: string
          description?: string | null
          hours_note?: string | null
          id?: string
          languages?: string[]
          name: string
          phone?: string | null
          requirements_note?: string | null
          source_checked_at: string
          source_name: string
          source_url: string
          status?: string
          tenant_id?: string | null
          topic: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          area_label?: string | null
          cost_note?: string | null
          created_at?: string
          description?: string | null
          hours_note?: string | null
          id?: string
          languages?: string[]
          name?: string
          phone?: string | null
          requirements_note?: string | null
          source_checked_at?: string
          source_name?: string
          source_url?: string
          status?: string
          tenant_id?: string | null
          topic?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_resources_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      connected_accounts: {
        Row: {
          capabilities: Json
          charges_enabled: boolean
          created_at: string
          details_submitted: boolean
          disabled_reason: string | null
          id: string
          owner_ref: string
          owner_type: string
          payouts_enabled: boolean
          requirements_due: Json
          requirements_past_due: Json
          stripe_account_id: string | null
          tenant_id: string
          updated_at: string
          verification_status: string
          verification_updated_at: string | null
        }
        Insert: {
          capabilities?: Json
          charges_enabled?: boolean
          created_at?: string
          details_submitted?: boolean
          disabled_reason?: string | null
          id?: string
          owner_ref: string
          owner_type: string
          payouts_enabled?: boolean
          requirements_due?: Json
          requirements_past_due?: Json
          stripe_account_id?: string | null
          tenant_id: string
          updated_at?: string
          verification_status?: string
          verification_updated_at?: string | null
        }
        Update: {
          capabilities?: Json
          charges_enabled?: boolean
          created_at?: string
          details_submitted?: boolean
          disabled_reason?: string | null
          id?: string
          owner_ref?: string
          owner_type?: string
          payouts_enabled?: boolean
          requirements_due?: Json
          requirements_past_due?: Json
          stripe_account_id?: string | null
          tenant_id?: string
          updated_at?: string
          verification_status?: string
          verification_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connected_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      content_asset_versions: {
        Row: {
          asset_id: string
          byte_size: number | null
          change_reason: string | null
          changed_by: string | null
          created_at: string
          id: string
          phash: unknown
          sha256: string
          storage_path: string
          tenant_id: string
          version: number
        }
        Insert: {
          asset_id: string
          byte_size?: number | null
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          id?: string
          phash?: unknown
          sha256: string
          storage_path: string
          tenant_id: string
          version: number
        }
        Update: {
          asset_id?: string
          byte_size?: number | null
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          id?: string
          phash?: unknown
          sha256?: string
          storage_path?: string
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_asset_versions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "content_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_asset_versions_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_asset_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      content_assets: {
        Row: {
          audio_phash: unknown
          byte_size: number | null
          commercial_cleared_at: string | null
          commercial_cleared_by: string | null
          commercial_intent: boolean
          created_at: string
          first_uploaded_at: string
          id: string
          license_kind: string
          license_statement: string | null
          license_url: string | null
          media_kind: string
          mime_type: string | null
          original_filename: string | null
          originality_declared: boolean
          originality_statement: string | null
          phash: unknown
          retired_from_subject_at: string | null
          review_note: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          sha256: string
          source_domain_id: string | null
          source_host: string
          storage_bucket: string
          storage_path: string
          subject_id: string | null
          subject_kind: string
          supersedes_id: string | null
          tenant_id: string
          updated_at: string
          uploader_id: string
          version: number
          video_phash: unknown
        }
        Insert: {
          audio_phash?: unknown
          byte_size?: number | null
          commercial_cleared_at?: string | null
          commercial_cleared_by?: string | null
          commercial_intent?: boolean
          created_at?: string
          first_uploaded_at?: string
          id?: string
          license_kind?: string
          license_statement?: string | null
          license_url?: string | null
          media_kind: string
          mime_type?: string | null
          original_filename?: string | null
          originality_declared?: boolean
          originality_statement?: string | null
          phash?: unknown
          retired_from_subject_at?: string | null
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sha256: string
          source_domain_id?: string | null
          source_host: string
          storage_bucket: string
          storage_path: string
          subject_id?: string | null
          subject_kind: string
          supersedes_id?: string | null
          tenant_id: string
          updated_at?: string
          uploader_id: string
          version?: number
          video_phash?: unknown
        }
        Update: {
          audio_phash?: unknown
          byte_size?: number | null
          commercial_cleared_at?: string | null
          commercial_cleared_by?: string | null
          commercial_intent?: boolean
          created_at?: string
          first_uploaded_at?: string
          id?: string
          license_kind?: string
          license_statement?: string | null
          license_url?: string | null
          media_kind?: string
          mime_type?: string | null
          original_filename?: string | null
          originality_declared?: boolean
          originality_statement?: string | null
          phash?: unknown
          retired_from_subject_at?: string | null
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sha256?: string
          source_domain_id?: string | null
          source_host?: string
          storage_bucket?: string
          storage_path?: string
          subject_id?: string | null
          subject_kind?: string
          supersedes_id?: string | null
          tenant_id?: string
          updated_at?: string
          uploader_id?: string
          version?: number
          video_phash?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "content_assets_commercial_cleared_by_fkey"
            columns: ["commercial_cleared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_assets_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_assets_source_domain_id_fkey"
            columns: ["source_domain_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_assets_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "content_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_assets_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_disputes: {
        Row: {
          asset_id: string
          claim_kind: string
          claim_text: string
          claimant_id: string
          created_at: string
          evidence_urls: string[]
          id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          respondent_id: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          asset_id: string
          claim_kind: string
          claim_text: string
          claimant_id: string
          created_at?: string
          evidence_urls?: string[]
          id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          respondent_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          asset_id?: string
          claim_kind?: string
          claim_text?: string
          claimant_id?: string
          created_at?: string
          evidence_urls?: string[]
          id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          respondent_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_disputes_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "content_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_disputes_claimant_id_fkey"
            columns: ["claimant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_disputes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_disputes_respondent_id_fkey"
            columns: ["respondent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_disputes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      content_integrity_alerts: {
        Row: {
          asset_id: string
          created_at: string
          detail: string | null
          dispute_id: string | null
          id: string
          kind: string
          match_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source_report_id: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          detail?: string | null
          dispute_id?: string | null
          id?: string
          kind: string
          match_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source_report_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          detail?: string | null
          dispute_id?: string | null
          id?: string
          kind?: string
          match_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source_report_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_integrity_alerts_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "content_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_integrity_alerts_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "content_disputes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_integrity_alerts_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "content_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_integrity_alerts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_integrity_alerts_source_report_id_fkey"
            columns: ["source_report_id"]
            isOneToOne: false
            referencedRelation: "scam_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_integrity_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      content_integrity_settings: {
        Row: {
          bloquear_duplicado_de_otro_usuario: boolean
          created_at: string
          max_distance_audio_bits: number
          max_distance_exacto_bits: number
          max_distance_similar_bits: number
          max_distance_video_bits: number
          revision_humana_obligatoria_comercial: boolean
          tenant_id: string
          umbral_bloqueo_bits: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bloquear_duplicado_de_otro_usuario?: boolean
          created_at?: string
          max_distance_audio_bits?: number
          max_distance_exacto_bits?: number
          max_distance_similar_bits?: number
          max_distance_video_bits?: number
          revision_humana_obligatoria_comercial?: boolean
          tenant_id: string
          umbral_bloqueo_bits?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bloquear_duplicado_de_otro_usuario?: boolean
          created_at?: string
          max_distance_audio_bits?: number
          max_distance_exacto_bits?: number
          max_distance_similar_bits?: number
          max_distance_video_bits?: number
          revision_humana_obligatoria_comercial?: boolean
          tenant_id?: string
          umbral_bloqueo_bits?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_integrity_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_integrity_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_matches: {
        Row: {
          algorithm: string
          asset_id: string
          detected_at: string
          distance: number
          id: string
          match_type: string
          matched_asset_id: string
          tenant_id: string
        }
        Insert: {
          algorithm: string
          asset_id: string
          detected_at?: string
          distance?: number
          id?: string
          match_type: string
          matched_asset_id: string
          tenant_id: string
        }
        Update: {
          algorithm?: string
          asset_id?: string
          detected_at?: string
          distance?: number
          id?: string
          match_type?: string
          matched_asset_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_matches_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "content_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_matches_matched_asset_id_fkey"
            columns: ["matched_asset_id"]
            isOneToOne: false
            referencedRelation: "content_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_matches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          accepted_at: string | null
          counterpart_id: string
          created_at: string
          created_by: string
          id: string
          listing_id: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          accepted_at?: string | null
          counterpart_id: string
          created_at?: string
          created_by: string
          id?: string
          listing_id?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          accepted_at?: string | null
          counterpart_id?: string
          created_at?: string
          created_by?: string
          id?: string
          listing_id?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_counterpart_id_fkey"
            columns: ["counterpart_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_commission_config: {
        Row: {
          created_at: string
          fee_pct: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          fee_pct?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          fee_pct?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creator_commission_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_commission_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_eligibility_config: {
        Row: {
          created_at: string
          min_age: number
          min_followers: number
          min_portfolio_items: number
          min_user_score: number
          min_videos: number
          min_views: number
          require_creator_terms: boolean
          require_email_verified: boolean
          require_identity_verified: boolean
          require_no_active_suspension: boolean
          require_phone_verified: boolean
          require_profile_complete: boolean
          require_stripe_connect: boolean
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          min_age?: number
          min_followers?: number
          min_portfolio_items?: number
          min_user_score?: number
          min_videos?: number
          min_views?: number
          require_creator_terms?: boolean
          require_email_verified?: boolean
          require_identity_verified?: boolean
          require_no_active_suspension?: boolean
          require_phone_verified?: boolean
          require_profile_complete?: boolean
          require_stripe_connect?: boolean
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          min_age?: number
          min_followers?: number
          min_portfolio_items?: number
          min_user_score?: number
          min_videos?: number
          min_views?: number
          require_creator_terms?: boolean
          require_email_verified?: boolean
          require_identity_verified?: boolean
          require_no_active_suspension?: boolean
          require_phone_verified?: boolean
          require_profile_complete?: boolean
          require_stripe_connect?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creator_eligibility_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_eligibility_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_portfolio_items: {
        Row: {
          caption: string | null
          created_at: string
          creator_id: string
          id: string
          is_verified_work: boolean
          kind: string
          sort_order: number
          tenant_id: string
          url: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          creator_id: string
          id?: string
          is_verified_work?: boolean
          kind: string
          sort_order?: number
          tenant_id: string
          url?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          creator_id?: string
          id?: string
          is_verified_work?: boolean
          kind?: string
          sort_order?: number
          tenant_id?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creator_portfolio_items_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creator_profiles"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "creator_portfolio_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_profiles: {
        Row: {
          available: boolean
          bio: string | null
          categories: string[]
          completed_jobs: number
          created_at: string
          creator_terms_accepted_at: string | null
          creator_terms_version: string | null
          headline: string
          portfolio_photos: string[]
          profile_id: string
          rate_hint: string | null
          rating_avg: number | null
          rating_count: number
          skills: string[]
          status: string
          status_updated_at: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          available?: boolean
          bio?: string | null
          categories?: string[]
          completed_jobs?: number
          created_at?: string
          creator_terms_accepted_at?: string | null
          creator_terms_version?: string | null
          headline: string
          portfolio_photos?: string[]
          profile_id: string
          rate_hint?: string | null
          rating_avg?: number | null
          rating_count?: number
          skills?: string[]
          status?: string
          status_updated_at?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          available?: boolean
          bio?: string | null
          categories?: string[]
          completed_jobs?: number
          created_at?: string
          creator_terms_accepted_at?: string | null
          creator_terms_version?: string | null
          headline?: string
          portfolio_photos?: string[]
          profile_id?: string
          rate_hint?: string | null
          rating_avg?: number | null
          rating_count?: number
          skills?: string[]
          status?: string
          status_updated_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_profiles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_scores: {
        Row: {
          computed_at: string
          factors: Json
          is_provisional: boolean
          level: number
          profile_id: string
          score: number
          score_previous: number | null
          score_version: number
          tenant_id: string
        }
        Insert: {
          computed_at?: string
          factors?: Json
          is_provisional?: boolean
          level?: number
          profile_id: string
          score?: number
          score_previous?: number | null
          score_version?: number
          tenant_id: string
        }
        Update: {
          computed_at?: string
          factors?: Json
          is_provisional?: boolean
          level?: number
          profile_id?: string
          score?: number
          score_previous?: number | null
          score_version?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_scores_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "creator_profiles"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "creator_scores_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_service_packages: {
        Row: {
          active: boolean
          created_at: string
          creator_id: string
          currency: string
          delivery_days: number
          description: string | null
          id: string
          includes: string[]
          price_cents: number
          sort_order: number
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          creator_id: string
          currency?: string
          delivery_days: number
          description?: string | null
          id?: string
          includes?: string[]
          price_cents: number
          sort_order?: number
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          creator_id?: string
          currency?: string
          delivery_days?: number
          description?: string | null
          id?: string
          includes?: string[]
          price_cents?: number
          sort_order?: number
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_service_packages_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_service_packages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cta_clicks: {
        Row: {
          clicked_on: string
          clicks: number
          cta_kind: string
          listing_id: string
          tenant_id: string
        }
        Insert: {
          clicked_on?: string
          clicks?: number
          cta_kind: string
          listing_id: string
          tenant_id: string
        }
        Update: {
          clicked_on?: string
          clicks?: number
          cta_kind?: string
          listing_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cta_clicks_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cta_clicks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      findings_caughtcode: {
        Row: {
          analysis_run_id: string
          check_id: string
          confidence: string
          created_at: string
          evidence: Json
          explanation_plain: string
          fix_prompt: string
          id: string
          impact_plain: string
          pillar: string
          project_id: string
          rank: number
          resolved_at: string | null
          severity: string
          status: string
          title_plain: string
          video_id: string | null
        }
        Insert: {
          analysis_run_id: string
          check_id: string
          confidence: string
          created_at?: string
          evidence: Json
          explanation_plain: string
          fix_prompt: string
          id?: string
          impact_plain: string
          pillar: string
          project_id: string
          rank?: number
          resolved_at?: string | null
          severity: string
          status?: string
          title_plain: string
          video_id?: string | null
        }
        Update: {
          analysis_run_id?: string
          check_id?: string
          confidence?: string
          created_at?: string
          evidence?: Json
          explanation_plain?: string
          fix_prompt?: string
          id?: string
          impact_plain?: string
          pillar?: string
          project_id?: string
          rank?: number
          resolved_at?: string | null
          severity?: string
          status?: string
          title_plain?: string
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "findings_caughtcode_analysis_run_id_fkey"
            columns: ["analysis_run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs_caughtcode"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "findings_caughtcode_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_caughtcode"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "findings_video_id_fkey_caughtcode"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos_caughtcode"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string
          follower_id: string
          id: string
          target_id: string
          target_kind: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          follower_id: string
          id?: string
          target_id: string
          target_kind: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          follower_id?: string
          id?: string
          target_id?: string
          target_kind?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      gig_applications: {
        Row: {
          created_at: string
          creator_id: string
          gig_id: string
          id: string
          message: string
          proposed_amount_cents: number | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          gig_id: string
          id?: string
          message: string
          proposed_amount_cents?: number | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          gig_id?: string
          id?: string
          message?: string
          proposed_amount_cents?: number | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gig_applications_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_applications_gig_id_fkey"
            columns: ["gig_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_applications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      gig_contracts: {
        Row: {
          accepted_at: string | null
          amount_cents: number
          application_id: string | null
          approved_at: string | null
          canceled_at: string | null
          changes_requested_at: string | null
          client_id: string
          closed_at: string | null
          code: string
          code_legacy: string | null
          created_at: string
          creator_id: string
          creator_net_cents: number | null
          currency: string
          delivered_at: string | null
          delivery_days: number
          fee_pct: number
          final_delivery_at: string | null
          funded_at: string | null
          gig_id: string | null
          id: string
          payment_mode: string
          platform_fee_cents: number | null
          rejected_at: string | null
          released_at: string | null
          scope: string
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          stripe_transfer_id: string | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          amount_cents: number
          application_id?: string | null
          approved_at?: string | null
          canceled_at?: string | null
          changes_requested_at?: string | null
          client_id: string
          closed_at?: string | null
          code?: string
          code_legacy?: string | null
          created_at?: string
          creator_id: string
          creator_net_cents?: number | null
          currency?: string
          delivered_at?: string | null
          delivery_days: number
          fee_pct?: number
          final_delivery_at?: string | null
          funded_at?: string | null
          gig_id?: string | null
          id?: string
          payment_mode?: string
          platform_fee_cents?: number | null
          rejected_at?: string | null
          released_at?: string | null
          scope: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          amount_cents?: number
          application_id?: string | null
          approved_at?: string | null
          canceled_at?: string | null
          changes_requested_at?: string | null
          client_id?: string
          closed_at?: string | null
          code?: string
          code_legacy?: string | null
          created_at?: string
          creator_id?: string
          creator_net_cents?: number | null
          currency?: string
          delivered_at?: string | null
          delivery_days?: number
          fee_pct?: number
          final_delivery_at?: string | null
          funded_at?: string | null
          gig_id?: string | null
          id?: string
          payment_mode?: string
          platform_fee_cents?: number | null
          rejected_at?: string | null
          released_at?: string | null
          scope?: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gig_contracts_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "gig_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_contracts_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_contracts_gig_id_fkey"
            columns: ["gig_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_contracts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      gig_reviews: {
        Row: {
          body: string | null
          contract_id: string
          created_at: string
          id: string
          ratee_id: string
          rating: number
          reviewer_id: string
          tenant_id: string
          visible: boolean
          visible_at: string | null
        }
        Insert: {
          body?: string | null
          contract_id: string
          created_at?: string
          id?: string
          ratee_id: string
          rating: number
          reviewer_id: string
          tenant_id: string
          visible?: boolean
          visible_at?: string | null
        }
        Update: {
          body?: string | null
          contract_id?: string
          created_at?: string
          id?: string
          ratee_id?: string
          rating?: number
          reviewer_id?: string
          tenant_id?: string
          visible?: boolean
          visible_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gig_reviews_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "gig_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_reviews_ratee_id_fkey"
            columns: ["ratee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      github_installations_caughtcode: {
        Row: {
          account_id: number | null
          account_login: string
          account_type: string
          all_repositories: boolean
          created_at: string
          installation_id: number
          installed_by: string | null
          org_id: string
          removed_at: string | null
          updated_at: string
        }
        Insert: {
          account_id?: number | null
          account_login: string
          account_type?: string
          all_repositories?: boolean
          created_at?: string
          installation_id: number
          installed_by?: string | null
          org_id: string
          removed_at?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: number | null
          account_login?: string
          account_type?: string
          all_repositories?: boolean
          created_at?: string
          installation_id?: number
          installed_by?: string | null
          org_id?: string
          removed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_installations_caughtcode_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_caughtcode"
            referencedColumns: ["id"]
          },
        ]
      }
      guides: {
        Row: {
          body_md: string
          city: string | null
          created_at: string
          id: string
          published_at: string | null
          reading_minutes: number | null
          slug: string
          sources: Json
          status: string
          summary: string | null
          tenant_id: string | null
          title: string
          topics: string[]
          updated_at: string
        }
        Insert: {
          body_md: string
          city?: string | null
          created_at?: string
          id?: string
          published_at?: string | null
          reading_minutes?: number | null
          slug: string
          sources?: Json
          status?: string
          summary?: string | null
          tenant_id?: string | null
          title: string
          topics?: string[]
          updated_at?: string
        }
        Update: {
          body_md?: string
          city?: string | null
          created_at?: string
          id?: string
          published_at?: string | null
          reading_minutes?: number | null
          slug?: string
          sources?: Json
          status?: string
          summary?: string | null
          tenant_id?: string | null
          title?: string
          topics?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_application_notes: {
        Row: {
          application_id: string
          author_id: string
          created_at: string
          note: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          application_id: string
          author_id: string
          created_at?: string
          note: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          author_id?: string
          created_at?: string
          note?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_application_notes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_application_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_application_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_applications: {
        Row: {
          answers: Json
          applicant_id: string
          created_at: string
          cv_url: string | null
          id: string
          job_id: string
          message: string | null
          portfolio_links: string[]
          share_profile: boolean
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          answers?: Json
          applicant_id: string
          created_at?: string
          cv_url?: string | null
          id?: string
          job_id: string
          message?: string | null
          portfolio_links?: string[]
          share_profile?: boolean
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          answers?: Json
          applicant_id?: string
          created_at?: string
          cv_url?: string | null
          id?: string
          job_id?: string
          message?: string | null
          portfolio_links?: string[]
          share_profile?: boolean
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_applications_applicant_id_fkey"
            columns: ["applicant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_deliverables: {
        Row: {
          contract_id: string
          created_at: string
          files: string[]
          id: string
          is_final: boolean
          kind: string
          note: string | null
          submitted_by: string
          tenant_id: string
          version: number
        }
        Insert: {
          contract_id: string
          created_at?: string
          files?: string[]
          id?: string
          is_final?: boolean
          kind?: string
          note?: string | null
          submitted_by: string
          tenant_id: string
          version?: number
        }
        Update: {
          contract_id?: string
          created_at?: string
          files?: string[]
          id?: string
          is_final?: boolean
          kind?: string
          note?: string | null
          submitted_by?: string
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_deliverables_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "gig_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_deliverables_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_deliverables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_revisions: {
        Row: {
          contract_id: string
          created_at: string
          id: string
          note: string
          requested_by: string
          tenant_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          id?: string
          note: string
          requested_by: string
          tenant_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          id?: string
          note?: string
          requested_by?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_revisions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "gig_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_revisions_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_revisions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs_caughtcode: {
        Row: {
          analysis_run_id: string | null
          attempts: number
          created_at: string
          id: string
          kind: string
          last_error: string | null
          lease_until: string | null
          max_attempts: number
          org_id: string
          payload: Json
          progress: number
          project_id: string | null
          run_after: string
          stage: string | null
          status: string
          updated_at: string
        }
        Insert: {
          analysis_run_id?: string | null
          attempts?: number
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          lease_until?: string | null
          max_attempts?: number
          org_id: string
          payload?: Json
          progress?: number
          project_id?: string | null
          run_after?: string
          stage?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          analysis_run_id?: string | null
          attempts?: number
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          lease_until?: string | null
          max_attempts?: number
          org_id?: string
          payload?: Json
          progress?: number
          project_id?: string | null
          run_after?: string
          stage?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_caughtcode_analysis_run_id_fkey"
            columns: ["analysis_run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs_caughtcode"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_caughtcode_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_caughtcode"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_caughtcode_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_caughtcode"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          listing_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          listing_id: string
          status?: string
          tenant_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          listing_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_comments_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_comments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_expiry_config: {
        Row: {
          created_at: string
          dias_de_aviso: number
          dias_de_vigencia: number
          kinds_que_vencen: string[]
          renovaciones_maximas: number | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          dias_de_aviso?: number
          dias_de_vigencia?: number
          kinds_que_vencen?: string[]
          renovaciones_maximas?: number | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          dias_de_aviso?: number
          dias_de_vigencia?: number
          kinds_que_vencen?: string[]
          renovaciones_maximas?: number | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_expiry_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_expiry_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_hours: {
        Row: {
          created_at: string
          listing_id: string
          tenant_id: string
          time_zone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          listing_id: string
          tenant_id: string
          time_zone: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          listing_id?: string
          tenant_id?: string
          time_zone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_hours_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_hours_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_hours_slots: {
        Row: {
          closes_at: string
          created_at: string
          id: string
          listing_id: string
          opens_at: string
          tenant_id: string
          weekday: number
        }
        Insert: {
          closes_at: string
          created_at?: string
          id?: string
          listing_id: string
          opens_at: string
          tenant_id: string
          weekday: number
        }
        Update: {
          closes_at?: string
          created_at?: string
          id?: string
          listing_id?: string
          opens_at?: string
          tenant_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "listing_hours_slots_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listing_hours"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "listing_hours_slots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_premiums: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          ctas_snapshot: Json | null
          currency: string
          current_period_end: string | null
          id: string
          listing_id: string
          owner_id: string
          price_cents: number
          status: string
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          ctas_snapshot?: Json | null
          currency?: string
          current_period_end?: string | null
          id?: string
          listing_id: string
          owner_id: string
          price_cents?: number
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          ctas_snapshot?: Json | null
          currency?: string
          current_period_end?: string | null
          id?: string
          listing_id?: string
          owner_id?: string
          price_cents?: number
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_premiums_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_premiums_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_premiums_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_private_details: {
        Row: {
          contact_notes: string | null
          created_at: string
          exact_address: string | null
          listing_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          contact_notes?: string | null
          created_at?: string
          exact_address?: string | null
          listing_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          contact_notes?: string | null
          created_at?: string
          exact_address?: string | null
          listing_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_private_details_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_private_details_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_review_stats: {
        Row: {
          listing_id: string
          rating_avg: number | null
          rating_count: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          listing_id: string
          rating_avg?: number | null
          rating_count?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          listing_id?: string
          rating_avg?: number | null
          rating_count?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_review_stats_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_review_stats_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_reviews: {
        Row: {
          author_id: string
          body: string | null
          created_at: string
          id: string
          listing_id: string
          owner_reply: string | null
          owner_reply_at: string | null
          owner_reply_by: string | null
          rating: number
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body?: string | null
          created_at?: string
          id?: string
          listing_id: string
          owner_reply?: string | null
          owner_reply_at?: string | null
          owner_reply_by?: string | null
          rating: number
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string | null
          created_at?: string
          id?: string
          listing_id?: string
          owner_reply?: string | null
          owner_reply_at?: string | null
          owner_reply_by?: string | null
          rating?: number
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_reviews_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_reviews_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_reviews_owner_reply_by_fkey"
            columns: ["owner_reply_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_shares: {
        Row: {
          listing_id: string
          shared_on: string
          shares: number
          tenant_id: string
        }
        Insert: {
          listing_id: string
          shared_on?: string
          shares?: number
          tenant_id: string
        }
        Update: {
          listing_id?: string
          shared_on?: string
          shares?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_shares_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_shares_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_views: {
        Row: {
          listing_id: string
          tenant_id: string
          viewed_on: string
          viewer_id: string
        }
        Insert: {
          listing_id: string
          tenant_id: string
          viewed_on?: string
          viewer_id: string
        }
        Update: {
          listing_id?: string
          tenant_id?: string
          viewed_on?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_views_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_views_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          area_label: string | null
          attrs: Json
          business_listing_id: string | null
          comment_count: number
          contact_protected: boolean
          created_at: string
          created_by: string | null
          cta_address: string | null
          cta_booking_url: string | null
          cta_phone: string | null
          cta_purchase_url: string | null
          cta_tickets_url: string | null
          cta_website: string | null
          cta_whatsapp: string | null
          description: string | null
          expired_at: string | null
          expires_at: string | null
          expiry_warn_at: string | null
          expiry_warned_at: string | null
          geo_zone: string | null
          id: string
          kind: string
          photos: string[]
          price_amount: number | null
          price_currency: string
          price_period: string | null
          published_at: string | null
          publisher_kind: string | null
          publisher_name: string | null
          renewal_count: number
          renewed_at: string | null
          search: unknown
          source: string
          status: string
          store_active: boolean
          store_verified: boolean
          tenant_id: string
          tier: string
          title: string
          updated_at: string
          view_count: number
          work_mode: string | null
        }
        Insert: {
          area_label?: string | null
          attrs?: Json
          business_listing_id?: string | null
          comment_count?: number
          contact_protected?: boolean
          created_at?: string
          created_by?: string | null
          cta_address?: string | null
          cta_booking_url?: string | null
          cta_phone?: string | null
          cta_purchase_url?: string | null
          cta_tickets_url?: string | null
          cta_website?: string | null
          cta_whatsapp?: string | null
          description?: string | null
          expired_at?: string | null
          expires_at?: string | null
          expiry_warn_at?: string | null
          expiry_warned_at?: string | null
          geo_zone?: string | null
          id?: string
          kind: string
          photos?: string[]
          price_amount?: number | null
          price_currency?: string
          price_period?: string | null
          published_at?: string | null
          publisher_kind?: string | null
          publisher_name?: string | null
          renewal_count?: number
          renewed_at?: string | null
          search?: unknown
          source?: string
          status?: string
          store_active?: boolean
          store_verified?: boolean
          tenant_id: string
          tier?: string
          title: string
          updated_at?: string
          view_count?: number
          work_mode?: string | null
        }
        Update: {
          area_label?: string | null
          attrs?: Json
          business_listing_id?: string | null
          comment_count?: number
          contact_protected?: boolean
          created_at?: string
          created_by?: string | null
          cta_address?: string | null
          cta_booking_url?: string | null
          cta_phone?: string | null
          cta_purchase_url?: string | null
          cta_tickets_url?: string | null
          cta_website?: string | null
          cta_whatsapp?: string | null
          description?: string | null
          expired_at?: string | null
          expires_at?: string | null
          expiry_warn_at?: string | null
          expiry_warned_at?: string | null
          geo_zone?: string | null
          id?: string
          kind?: string
          photos?: string[]
          price_amount?: number | null
          price_currency?: string
          price_period?: string | null
          published_at?: string | null
          publisher_kind?: string | null
          publisher_name?: string | null
          renewal_count?: number
          renewed_at?: string | null
          search?: unknown
          source?: string
          status?: string
          store_active?: boolean
          store_verified?: boolean
          tenant_id?: string
          tier?: string
          title?: string
          updated_at?: string
          view_count?: number
          work_mode?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listings_business_listing_id_fkey"
            columns: ["business_listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          cipher_envelope: Json | null
          conversation_id: string
          created_at: string
          expires_at: string
          id: string
          sender_id: string
          tenant_id: string
        }
        Insert: {
          body: string
          cipher_envelope?: Json | null
          conversation_id: string
          created_at?: string
          expires_at?: string
          id?: string
          sender_id: string
          tenant_id: string
        }
        Update: {
          body?: string
          cipher_envelope?: Json | null
          conversation_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          sender_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_queue: {
        Row: {
          ai_score: number | null
          assigned_to: string | null
          created_at: string
          id: string
          reasons: Json
          resolved_at: string | null
          resolved_by: string | null
          status: string
          subject_id: string
          subject_kind: string
          tenant_id: string
          tier: number
        }
        Insert: {
          ai_score?: number | null
          assigned_to?: string | null
          created_at?: string
          id?: string
          reasons?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject_id: string
          subject_kind: string
          tenant_id: string
          tier: number
        }
        Update: {
          ai_score?: number | null
          assigned_to?: string | null
          created_at?: string
          id?: string
          reasons?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject_id?: string
          subject_kind?: string
          tenant_id?: string
          tier?: number
        }
        Relationships: [
          {
            foreignKeyName: "moderation_queue_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_queue_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      music_tracks: {
        Row: {
          artist: string
          attribution_required: boolean
          attribution_text: string | null
          category: string
          created_at: string
          duration_seconds: number
          id: string
          is_active: boolean
          license_kind: string
          license_url: string | null
          sort_order: number
          source_url: string | null
          storage_path: string
          tenant_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          artist: string
          attribution_required?: boolean
          attribution_text?: string | null
          category?: string
          created_at?: string
          duration_seconds: number
          id?: string
          is_active?: boolean
          license_kind?: string
          license_url?: string | null
          sort_order?: number
          source_url?: string | null
          storage_path: string
          tenant_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          artist?: string
          attribution_required?: boolean
          attribution_text?: string | null
          category?: string
          created_at?: string
          duration_seconds?: number
          id?: string
          is_active?: boolean
          license_kind?: string
          license_url?: string | null
          sort_order?: number
          source_url?: string | null
          storage_path?: string
          tenant_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "music_tracks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          category: string
          created_at: string
          email: boolean
          frequency: string
          in_app: boolean
          profile_id: string
          push: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          email?: boolean
          frequency?: string
          in_app?: boolean
          profile_id: string
          push?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          email?: boolean
          frequency?: string
          in_app?: boolean
          profile_id?: string
          push?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_prefs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_prefs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          category: string
          created_at: string
          dismissed_at: string | null
          expires_at: string
          group_key: string | null
          href: string | null
          id: string
          kind: string
          priority: string
          profile_id: string
          read_at: string | null
          tenant_id: string
          title: string
        }
        Insert: {
          body?: string | null
          category?: string
          created_at?: string
          dismissed_at?: string | null
          expires_at?: string
          group_key?: string | null
          href?: string | null
          id?: string
          kind: string
          priority?: string
          profile_id: string
          read_at?: string | null
          tenant_id: string
          title: string
        }
        Update: {
          body?: string | null
          category?: string
          created_at?: string
          dismissed_at?: string | null
          expires_at?: string
          group_key?: string | null
          href?: string | null
          id?: string
          kind?: string
          priority?: string
          profile_id?: string
          read_at?: string | null
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members_caughtcode: {
        Row: {
          created_at: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_caughtcode_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_caughtcode"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations_caughtcode: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          plan: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          plan?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          plan?: string
        }
        Relationships: []
      }
      payment_accounts: {
        Row: {
          brand: string | null
          connected_account_id: string
          created_at: string
          id: string
          is_default: boolean
          kind: string
          last4: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          brand?: string | null
          connected_account_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          kind: string
          last4?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          brand?: string | null
          connected_account_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          kind?: string
          last4?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_accounts_connected_account_id_fkey"
            columns: ["connected_account_id"]
            isOneToOne: false
            referencedRelation: "connected_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          claimed_at: string | null
          error: string | null
          event_id: string
          event_type: string
          id: string
          payload: Json
          processed: boolean
          provider: string
          received_at: string
          tenant_id: string | null
        }
        Insert: {
          claimed_at?: string | null
          error?: string | null
          event_id: string
          event_type: string
          id?: string
          payload: Json
          processed?: boolean
          provider?: string
          received_at?: string
          tenant_id?: string | null
        }
        Update: {
          claimed_at?: string | null
          error?: string | null
          event_id?: string
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean
          provider?: string
          received_at?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_verification_codes: {
        Row: {
          attempts: number
          channel: string
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          max_attempts: number
          phone_e164: string
          profile_id: string | null
          tenant_id: string
        }
        Insert: {
          attempts?: number
          channel?: string
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          max_attempts?: number
          phone_e164: string
          profile_id?: string | null
          tenant_id: string
        }
        Update: {
          attempts?: number
          channel?: string
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          max_attempts?: number
          phone_e164?: string
          profile_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_verification_codes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_verification_codes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      post_music: {
        Row: {
          created_at: string
          post_id: string
          start_seconds: number
          tenant_id: string
          track_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          post_id: string
          start_seconds?: number
          tenant_id: string
          track_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          post_id?: string
          start_seconds?: number
          tenant_id?: string
          track_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_music_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_music_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_music_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "music_tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      post_offers: {
        Row: {
          codigo_cupon: string | null
          created_at: string
          expires_at: string
          moneda: string
          post_id: string
          starts_at: string
          tenant_id: string
          terminos: string | null
          tipo: string
          titulo: string
          updated_at: string
          valor: number | null
          valor_tipo: string | null
        }
        Insert: {
          codigo_cupon?: string | null
          created_at?: string
          expires_at: string
          moneda?: string
          post_id: string
          starts_at?: string
          tenant_id: string
          terminos?: string | null
          tipo: string
          titulo: string
          updated_at?: string
          valor?: number | null
          valor_tipo?: string | null
        }
        Update: {
          codigo_cupon?: string | null
          created_at?: string
          expires_at?: string
          moneda?: string
          post_id?: string
          starts_at?: string
          tenant_id?: string
          terminos?: string | null
          tipo?: string
          titulo?: string
          updated_at?: string
          valor?: number | null
          valor_tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_offers_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_offers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      post_poll_votes: {
        Row: {
          choice: boolean
          created_at: string
          post_id: string
          tenant_id: string
          voter_id: string
        }
        Insert: {
          choice: boolean
          created_at?: string
          post_id: string
          tenant_id?: string
          voter_id: string
        }
        Update: {
          choice?: boolean
          created_at?: string
          post_id?: string
          tenant_id?: string
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_poll_votes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_poll_votes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_poll_votes_voter_id_fkey"
            columns: ["voter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_promotions: {
        Row: {
          amount_cents: number
          audience: Json
          buyer_id: string
          created_at: string
          cta_whatsapp: string | null
          currency: string
          duration_days: number
          ends_at: string | null
          id: string
          package: string
          post_id: string
          starts_at: string | null
          status: string
          stripe_checkout_session_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          audience?: Json
          buyer_id: string
          created_at?: string
          cta_whatsapp?: string | null
          currency?: string
          duration_days: number
          ends_at?: string | null
          id?: string
          package: string
          post_id: string
          starts_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          audience?: Json
          buyer_id?: string
          created_at?: string
          cta_whatsapp?: string | null
          currency?: string
          duration_days?: number
          ends_at?: string | null
          id?: string
          package?: string
          post_id?: string
          starts_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_promotions_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_promotions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_promotions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      post_tags: {
        Row: {
          created_at: string
          post_id: string
          profile_id: string
          tagged_by: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          profile_id: string
          tagged_by?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          profile_id?: string
          tagged_by?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_tags_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_tags_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_tags_tagged_by_fkey"
            columns: ["tagged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_tags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      post_views: {
        Row: {
          post_id: string
          tenant_id: string
          viewed_on: string
          viewer_id: string
        }
        Insert: {
          post_id: string
          tenant_id: string
          viewed_on?: string
          viewer_id: string
        }
        Update: {
          post_id?: string
          tenant_id?: string
          viewed_on?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_views_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_views_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_id: string | null
          body: string
          comment_count: number
          comments_locked_at: string | null
          created_at: string
          duration_seconds: number | null
          edited_at: string | null
          eligible_for_short_feed: boolean
          entity_listing_id: string | null
          hidden_at: string | null
          id: string
          is_paid_ad: boolean
          kind: string
          like_count: number
          media: string[]
          media_filters: Json
          pinned_at: string | null
          poll_kind: string | null
          poll_no_count: number
          poll_yes_count: number
          search: unknown
          status: string
          tenant_id: string
          updated_at: string
          video_category: string | null
          video_type: string | null
          view_count: number
        }
        Insert: {
          author_id?: string | null
          body: string
          comment_count?: number
          comments_locked_at?: string | null
          created_at?: string
          duration_seconds?: number | null
          edited_at?: string | null
          eligible_for_short_feed?: boolean
          entity_listing_id?: string | null
          hidden_at?: string | null
          id?: string
          is_paid_ad?: boolean
          kind?: string
          like_count?: number
          media?: string[]
          media_filters?: Json
          pinned_at?: string | null
          poll_kind?: string | null
          poll_no_count?: number
          poll_yes_count?: number
          search?: unknown
          status?: string
          tenant_id: string
          updated_at?: string
          video_category?: string | null
          video_type?: string | null
          view_count?: number
        }
        Update: {
          author_id?: string | null
          body?: string
          comment_count?: number
          comments_locked_at?: string | null
          created_at?: string
          duration_seconds?: number | null
          edited_at?: string | null
          eligible_for_short_feed?: boolean
          entity_listing_id?: string | null
          hidden_at?: string | null
          id?: string
          is_paid_ad?: boolean
          kind?: string
          like_count?: number
          media?: string[]
          media_filters?: Json
          pinned_at?: string | null
          poll_kind?: string | null
          poll_no_count?: number
          poll_yes_count?: number
          search?: unknown
          status?: string
          tenant_id?: string
          updated_at?: string
          video_category?: string | null
          video_type?: string | null
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_entity_listing_id_fkey"
            columns: ["entity_listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_privacy: {
        Row: {
          created_at: string
          profile_id: string
          show_bio: string
          show_birthdate: string
          show_country_origin: string
          show_followers: string
          show_languages: string
          show_last_name: string
          show_location: string
          show_posts: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          profile_id: string
          show_bio?: string
          show_birthdate?: string
          show_country_origin?: string
          show_followers?: string
          show_languages?: string
          show_last_name?: string
          show_location?: string
          show_posts?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          profile_id?: string
          show_bio?: string
          show_birthdate?: string
          show_country_origin?: string
          show_followers?: string
          show_languages?: string
          show_last_name?: string
          show_location?: string
          show_posts?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_privacy_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_privacy_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_status: string
          age_confirmed_at: string | null
          area_label: string | null
          avatar_url: string | null
          bio: string | null
          country_origin: string | null
          cover_url: string | null
          created_at: string
          display_name: string
          email_verified: boolean
          id: string
          identity_verified: boolean
          identity_verified_at: string | null
          locale: string
          phone_verified: boolean
          role: string
          suspended_until: string | null
          tenant_id: string
          terms_accepted_at: string | null
          terms_version: string | null
          timezone: string | null
          updated_at: string
          username: string | null
          verified_badge: boolean
          verified_badge_type: string | null
        }
        Insert: {
          account_status?: string
          age_confirmed_at?: string | null
          area_label?: string | null
          avatar_url?: string | null
          bio?: string | null
          country_origin?: string | null
          cover_url?: string | null
          created_at?: string
          display_name: string
          email_verified?: boolean
          id: string
          identity_verified?: boolean
          identity_verified_at?: string | null
          locale?: string
          phone_verified?: boolean
          role?: string
          suspended_until?: string | null
          tenant_id: string
          terms_accepted_at?: string | null
          terms_version?: string | null
          timezone?: string | null
          updated_at?: string
          username?: string | null
          verified_badge?: boolean
          verified_badge_type?: string | null
        }
        Update: {
          account_status?: string
          age_confirmed_at?: string | null
          area_label?: string | null
          avatar_url?: string | null
          bio?: string | null
          country_origin?: string | null
          cover_url?: string | null
          created_at?: string
          display_name?: string
          email_verified?: boolean
          id?: string
          identity_verified?: boolean
          identity_verified_at?: string | null
          locale?: string
          phone_verified?: boolean
          role?: string
          suspended_until?: string | null
          tenant_id?: string
          terms_accepted_at?: string | null
          terms_version?: string | null
          timezone?: string | null
          updated_at?: string
          username?: string | null
          verified_badge?: boolean
          verified_badge_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles_private: {
        Row: {
          birthdate: string | null
          city: string | null
          country_residence: string | null
          created_at: string
          languages: string[]
          last_name: string | null
          needs: Json
          profile_id: string
          tag_policy: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          birthdate?: string | null
          city?: string | null
          country_residence?: string | null
          created_at?: string
          languages?: string[]
          last_name?: string | null
          needs?: Json
          profile_id: string
          tag_policy?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          birthdate?: string | null
          city?: string | null
          country_residence?: string | null
          created_at?: string
          languages?: string[]
          last_name?: string | null
          needs?: Json
          profile_id?: string
          tag_policy?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_private_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_private_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_connections_caughtcode: {
        Row: {
          created_at: string
          credentials_ref: string
          id: string
          project_id: string
          provider: string
          scopes: string[]
        }
        Insert: {
          created_at?: string
          credentials_ref: string
          id?: string
          project_id: string
          provider: string
          scopes?: string[]
        }
        Update: {
          created_at?: string
          credentials_ref?: string
          id?: string
          project_id?: string
          provider?: string
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "project_connections_caughtcode_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_caughtcode"
            referencedColumns: ["id"]
          },
        ]
      }
      projects_caughtcode: {
        Row: {
          client_name: string | null
          created_at: string
          deleted_at: string | null
          deployed_url: string | null
          id: string
          name: string
          org_id: string
          repo_ref: string | null
          repo_url: string | null
          retention_days: number
          source_type: string
          stack_detected: Json | null
          storage_path: string | null
        }
        Insert: {
          client_name?: string | null
          created_at?: string
          deleted_at?: string | null
          deployed_url?: string | null
          id?: string
          name: string
          org_id: string
          repo_ref?: string | null
          repo_url?: string | null
          retention_days?: number
          source_type: string
          stack_detected?: Json | null
          storage_path?: string | null
        }
        Update: {
          client_name?: string | null
          created_at?: string
          deleted_at?: string | null
          deployed_url?: string | null
          id?: string
          name?: string
          org_id?: string
          repo_ref?: string | null
          repo_url?: string | null
          retention_days?: number
          source_type?: string
          stack_detected?: Json | null
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_caughtcode_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_caughtcode"
            referencedColumns: ["id"]
          },
        ]
      }
      rag_chunks: {
        Row: {
          chunk_index: number
          content: string
          content_hash: string
          created_at: string
          embedding: string
          id: string
          metadata: Json
          source_id: string
          source_kind: string
          tenant_id: string | null
        }
        Insert: {
          chunk_index?: number
          content: string
          content_hash: string
          created_at?: string
          embedding: string
          id?: string
          metadata?: Json
          source_id: string
          source_kind: string
          tenant_id?: string | null
        }
        Update: {
          chunk_index?: number
          content?: string
          content_hash?: string
          created_at?: string
          embedding?: string
          id?: string
          metadata?: Json
          source_id?: string
          source_kind?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rag_chunks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reactions: {
        Row: {
          created_at: string
          id: string
          kind: string
          profile_id: string
          subject_id: string
          subject_kind: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          profile_id: string
          subject_id: string
          subject_kind: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          profile_id?: string
          subject_id?: string
          subject_kind?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_candidates: {
        Row: {
          candidate_id: string
          created_at: string
          employer_id: string
          source_application_id: string | null
          tenant_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          employer_id: string
          source_application_id?: string | null
          tenant_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          employer_id?: string
          source_application_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_candidates_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_candidates_employer_id_fkey"
            columns: ["employer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_candidates_source_application_id_fkey"
            columns: ["source_application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_candidates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      saves: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          subject_id: string
          subject_kind: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          subject_id: string
          subject_kind: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          subject_id?: string
          subject_kind?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saves_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saves_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      scam_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          reason: string
          reporter_id: string | null
          status: string
          target_id: string
          target_kind: string
          tenant_id: string
          weight: number
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reporter_id?: string | null
          status?: string
          target_id: string
          target_kind: string
          tenant_id: string
          weight?: number
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reporter_id?: string | null
          status?: string
          target_id?: string
          target_kind?: string
          tenant_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "scam_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scam_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      score_history: {
        Row: {
          actor_id: string | null
          created_at: string
          delta: number | null
          id: string
          level_after: string | null
          level_before: string | null
          reason: string | null
          score_after: number
          score_before: number | null
          source: string
          subject_id: string
          subject_type: string
          tenant_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          delta?: number | null
          id?: string
          level_after?: string | null
          level_before?: string | null
          reason?: string | null
          score_after: number
          score_before?: number | null
          source?: string
          subject_id: string
          subject_type: string
          tenant_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          delta?: number | null
          id?: string
          level_after?: string | null
          level_before?: string | null
          reason?: string | null
          score_after?: number
          score_before?: number | null
          source?: string
          subject_id?: string
          subject_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "score_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      score_penalties: {
        Row: {
          applied_by: string | null
          category: string
          created_at: string
          id: string
          is_reverted: boolean
          points: number
          reason: string
          reverted_at: string | null
          reverted_by: string | null
          source: string
          subject_id: string
          subject_type: string
          tenant_id: string
        }
        Insert: {
          applied_by?: string | null
          category: string
          created_at?: string
          id?: string
          is_reverted?: boolean
          points: number
          reason: string
          reverted_at?: string | null
          reverted_by?: string | null
          source?: string
          subject_id: string
          subject_type: string
          tenant_id: string
        }
        Update: {
          applied_by?: string | null
          category?: string
          created_at?: string
          id?: string
          is_reverted?: boolean
          points?: number
          reason?: string
          reverted_at?: string | null
          reverted_by?: string | null
          source?: string
          subject_id?: string
          subject_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "score_penalties_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_penalties_reverted_by_fkey"
            columns: ["reverted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_penalties_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      security_signals: {
        Row: {
          created_at: string
          device_hash: string | null
          event_type: string
          id: string
          ip_hash: string | null
          profile_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          device_hash?: string | null
          event_type: string
          id?: string
          ip_hash?: string | null
          profile_id?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          device_hash?: string | null
          event_type?: string
          id?: string
          ip_hash?: string | null
          profile_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_signals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_signals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      store_memberships: {
        Row: {
          created_at: string
          currency: string
          current_period_end: string | null
          id: string
          owner_id: string
          price_cents: number
          status: string
          store_id: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          current_period_end?: string | null
          id?: string
          owner_id: string
          price_cents?: number
          status?: string
          store_id: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          current_period_end?: string | null
          id?: string
          owner_id?: string
          price_cents?: number
          status?: string
          store_id?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_memberships_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_memberships_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions_caughtcode: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          org_id: string
          plan: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          org_id: string
          plan?: string
          status?: string
          stripe_customer_id: string
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          org_id?: string
          plan?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_caughtcode_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_caughtcode"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_domains: {
        Row: {
          created_at: string
          domain: string
          id: string
          is_primary: boolean
          notes: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          is_primary?: boolean
          notes?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          is_primary?: boolean
          notes?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_domains_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_price_history: {
        Row: {
          billing_interval: string
          changed_at: string
          changed_by: string | null
          id: string
          new_active: boolean
          new_amount_cents: number
          new_currency: string
          old_active: boolean | null
          old_amount_cents: number | null
          old_currency: string | null
          price_id: string | null
          product: string
          tenant_id: string
          variant: string
        }
        Insert: {
          billing_interval: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_active: boolean
          new_amount_cents: number
          new_currency: string
          old_active?: boolean | null
          old_amount_cents?: number | null
          old_currency?: string | null
          price_id?: string | null
          product: string
          tenant_id: string
          variant: string
        }
        Update: {
          billing_interval?: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_active?: boolean
          new_amount_cents?: number
          new_currency?: string
          old_active?: boolean | null
          old_amount_cents?: number | null
          old_currency?: string | null
          price_id?: string | null
          product?: string
          tenant_id?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_price_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_price_history_price_id_fkey"
            columns: ["price_id"]
            isOneToOne: false
            referencedRelation: "tenant_prices"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_prices: {
        Row: {
          active: boolean
          amount_cents: number
          billing_interval: string
          created_at: string
          currency: string
          id: string
          product: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          variant: string
        }
        Insert: {
          active?: boolean
          amount_cents: number
          billing_interval: string
          created_at?: string
          currency: string
          id?: string
          product: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          variant: string
        }
        Update: {
          active?: boolean
          amount_cents?: number
          billing_interval?: string
          created_at?: string
          currency?: string
          id?: string
          product?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_prices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_prices_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          brand_hex: string
          city_seed: string | null
          country_focus: string | null
          created_at: string
          currency: string
          id: string
          locale: string
          logo_url: string | null
          modules: Json
          modules_soon: Json
          name: string
          slug: string
          status: string
          theme: Json
          updated_at: string
        }
        Insert: {
          brand_hex?: string
          city_seed?: string | null
          country_focus?: string | null
          created_at?: string
          currency?: string
          id?: string
          locale?: string
          logo_url?: string | null
          modules?: Json
          modules_soon?: Json
          name: string
          slug: string
          status?: string
          theme?: Json
          updated_at?: string
        }
        Update: {
          brand_hex?: string
          city_seed?: string | null
          country_focus?: string | null
          created_at?: string
          currency?: string
          id?: string
          locale?: string
          logo_url?: string | null
          modules?: Json
          modules_soon?: Json
          name?: string
          slug?: string
          status?: string
          theme?: Json
          updated_at?: string
        }
        Relationships: []
      }
      trust_scores: {
        Row: {
          computed_at: string
          factors: Json
          level: string
          profile_id: string
          score: number
          score_previous: number | null
          score_version: number
          signals: Json
          tenant_id: string
        }
        Insert: {
          computed_at?: string
          factors?: Json
          level?: string
          profile_id: string
          score?: number
          score_previous?: number | null
          score_version?: number
          signals?: Json
          tenant_id: string
        }
        Update: {
          computed_at?: string
          factors?: Json
          level?: string
          profile_id?: string
          score?: number
          score_previous?: number | null
          score_version?: number
          signals?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trust_scores_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trust_scores_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events_caughtcode: {
        Row: {
          analysis_run_id: string | null
          cost_usd: number
          created_at: string
          detail: string | null
          id: string
          kind: string
          org_id: string
          project_id: string | null
          unit_label: string
          units: number
        }
        Insert: {
          analysis_run_id?: string | null
          cost_usd?: number
          created_at?: string
          detail?: string | null
          id?: string
          kind: string
          org_id: string
          project_id?: string | null
          unit_label: string
          units?: number
        }
        Update: {
          analysis_run_id?: string | null
          cost_usd?: number
          created_at?: string
          detail?: string | null
          id?: string
          kind?: string
          org_id?: string
          project_id?: string | null
          unit_label?: string
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_analysis_run_id_fkey_caughtcode"
            columns: ["analysis_run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs_caughtcode"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_caughtcode_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_caughtcode"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_caughtcode_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_caughtcode"
            referencedColumns: ["id"]
          },
        ]
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          tenant_id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          tenant_id: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_phones: {
        Row: {
          birthdate: string | null
          created_at: string
          phone_e164: string
          phone_verified: boolean
          phone_verified_at: string | null
          profile_id: string
          tenant_id: string
          updated_at: string
          verification_channel: string
        }
        Insert: {
          birthdate?: string | null
          created_at?: string
          phone_e164: string
          phone_verified?: boolean
          phone_verified_at?: string | null
          profile_id: string
          tenant_id: string
          updated_at?: string
          verification_channel?: string
        }
        Update: {
          birthdate?: string | null
          created_at?: string
          phone_e164?: string
          phone_verified?: boolean
          phone_verified_at?: string | null
          profile_id?: string
          tenant_id?: string
          updated_at?: string
          verification_channel?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_phones_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_phones_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          activated_at: string
          created_at: string
          id: string
          profile_id: string
          role: string
          source: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          activated_at?: string
          created_at?: string
          id?: string
          profile_id: string
          role: string
          source?: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          activated_at?: string
          created_at?: string
          id?: string
          profile_id?: string
          role?: string
          source?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_boost_grants: {
        Row: {
          boost_id: string | null
          created_at: string
          duration_days: number
          expires_at: string
          granted_at: string
          id: string
          period_start: string
          profile_id: string
          redeemed_at: string | null
          status: string
          subscription_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          boost_id?: string | null
          created_at?: string
          duration_days?: number
          expires_at: string
          granted_at?: string
          id?: string
          period_start: string
          profile_id: string
          redeemed_at?: string | null
          status?: string
          subscription_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          boost_id?: string | null
          created_at?: string
          duration_days?: number
          expires_at?: string
          granted_at?: string
          id?: string
          period_start?: string
          profile_id?: string
          redeemed_at?: string | null
          status?: string
          subscription_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_boost_grants_boost_id_fkey"
            columns: ["boost_id"]
            isOneToOne: false
            referencedRelation: "boosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_boost_grants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_boost_grants_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "verification_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_boost_grants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_checks: {
        Row: {
          checked_at: string
          created_at: string
          disclaimer_version: string
          evidence: Json
          id: string
          license_number: string | null
          registry: string
          registry_url: string | null
          result: string
          subject_id: string | null
          subject_kind: string
          tenant_id: string
        }
        Insert: {
          checked_at?: string
          created_at?: string
          disclaimer_version?: string
          evidence?: Json
          id?: string
          license_number?: string | null
          registry: string
          registry_url?: string | null
          result: string
          subject_id?: string | null
          subject_kind: string
          tenant_id: string
        }
        Update: {
          checked_at?: string
          created_at?: string
          disclaimer_version?: string
          evidence?: Json
          id?: string
          license_number?: string | null
          registry?: string
          registry_url?: string | null
          result?: string
          subject_id?: string | null
          subject_kind?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_checks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_subscriptions: {
        Row: {
          canceled_at: string | null
          created_at: string
          currency: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          price_cents: number
          profile_id: string
          started_at: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subject_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          canceled_at?: string | null
          created_at?: string
          currency: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          price_cents: number
          profile_id: string
          started_at?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subject_type: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          canceled_at?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          price_cents?: number
          profile_id?: string
          started_at?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subject_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      videos_caughtcode: {
        Row: {
          cost_usd: number
          created_at: string
          duration_s: number | null
          error: string | null
          finding_id: string | null
          id: string
          kind: string
          module_id: string | null
          project_id: string | null
          script: Json | null
          status: string
          transcript: string | null
          url: string | null
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          duration_s?: number | null
          error?: string | null
          finding_id?: string | null
          id?: string
          kind: string
          module_id?: string | null
          project_id?: string | null
          script?: Json | null
          status?: string
          transcript?: string | null
          url?: string | null
        }
        Update: {
          cost_usd?: number
          created_at?: string
          duration_s?: number | null
          error?: string | null
          finding_id?: string | null
          id?: string
          kind?: string
          module_id?: string | null
          project_id?: string | null
          script?: Json | null
          status?: string
          transcript?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "videos_caughtcode_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "findings_caughtcode"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "videos_caughtcode_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_caughtcode"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_locks_caughtcode: {
        Row: {
          acquired_at: string
          expires_at: string
          holder: string
          name: string
        }
        Insert: {
          acquired_at?: string
          expires_at: string
          holder: string
          name: string
        }
        Update: {
          acquired_at?: string
          expires_at?: string
          holder?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      abrir_disputa_de_contenido: {
        Args: {
          p_asset_id: string
          p_claim_kind: string
          p_claim_text: string
          p_evidence_urls?: string[]
        }
        Returns: string
      }
      accept_conversation: {
        Args: { p_conversation_id: string }
        Returns: Json
      }
      admin_ban_user: {
        Args: { p_profile_id: string; p_reason: string }
        Returns: undefined
      }
      admin_lift_restriction: {
        Args: { p_profile_id: string; p_scope: string }
        Returns: undefined
      }
      admin_metrics_overview: {
        Args: { p_days?: number; p_tenant_id?: string }
        Returns: Json
      }
      admin_reactivate_user: {
        Args: { p_profile_id: string }
        Returns: undefined
      }
      admin_resolve_creator_activation: {
        Args: { p_decision: string; p_note?: string; p_profile_id: string }
        Returns: string
      }
      admin_restrict_user: {
        Args: {
          p_days: number
          p_profile_id: string
          p_reason: string
          p_scope: string
        }
        Returns: undefined
      }
      admin_revenue_events: {
        Args: {
          p_cursor_at?: string
          p_cursor_id?: string
          p_from: string
          p_limit?: number
          p_product?: string
          p_tenant: string
          p_to: string
        }
        Returns: {
          amount_cents: number
          currency: string
          event_type: string
          failed: boolean
          id: string
          processed: boolean
          product: string
          received_at: string
          tenant_id: string
        }[]
      }
      admin_revenue_summary: {
        Args: { p_from: string; p_tenant: string; p_to: string }
        Returns: {
          currency: string
          net_cents: number
          payments: number
          product: string
          refunds: number
          tenant_id: string
          unreadable: number
        }[]
      }
      admin_suspend_user: {
        Args: { p_days: number; p_profile_id: string; p_reason: string }
        Returns: undefined
      }
      block_user: { Args: { p_profile_id: string }; Returns: undefined }
      claim_job_caughtcode: {
        Args: { p_kinds?: string[]; p_lease_seconds?: number }
        Returns: {
          analysis_run_id: string | null
          attempts: number
          created_at: string
          id: string
          kind: string
          last_error: string | null
          lease_until: string | null
          max_attempts: number
          org_id: string
          payload: Json
          progress: number
          project_id: string | null
          run_after: string
          stage: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs_caughtcode"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      delete_account_caughtcode: { Args: { p_user_id: string }; Returns: Json }
      delete_project_cascade_caughtcode: {
        Args: { p_project_id: string }
        Returns: Json
      }
      emit_social_notification: {
        Args: {
          p_actor: string
          p_body: string
          p_href: string
          p_kind: string
          p_recipient: string
          p_subject_id: string
          p_subject_kind: string
          p_tenant: string
          p_title: string
        }
        Returns: string
      }
      ensure_org_caughtcode: { Args: { p_user_id?: string }; Returns: string }
      fijar_publicacion: {
        Args: { p_fijar?: boolean; p_post: string }
        Returns: string
      }
      find_similar_content: {
        Args: {
          p_asset_id: string
          p_limit?: number
          p_max_distance?: number
          p_max_distance_audio?: number
          p_max_distance_video?: number
        }
        Returns: {
          algorithm: string
          asset_id: string
          distance: number
          subject_id: string
          subject_kind: string
          uploaded_at: string
          uploader_id: string
        }[]
      }
      get_content_integrity_settings: {
        Args: never
        Returns: {
          bloquear_duplicado_de_otro_usuario: boolean
          created_at: string
          max_distance_audio_bits: number
          max_distance_exacto_bits: number
          max_distance_similar_bits: number
          max_distance_video_bits: number
          revision_humana_obligatoria_comercial: boolean
          tenant_id: string
          umbral_bloqueo_bits: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "content_integrity_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_creator_commission: { Args: never; Returns: number }
      get_tenant_by_domain: { Args: { p_domain: string }; Returns: Json }
      global_search: {
        Args: { limit_per_type?: number; q: string }
        Returns: {
          href: string
          id: string
          image_url: string
          rank: number
          result_type: string
          subtitle: string
          title: string
        }[]
      }
      guardar_horario_de_aviso: {
        Args: { p_listing: string; p_time_zone: string; p_tramos: Json }
        Returns: undefined
      }
      identidades_disponibles: {
        Args: never
        Returns: {
          business_id: string
          categoria: string
          es_propietario: boolean
          listing_id: string
          nombre: string
          rol: string
        }[]
      }
      integrity_penalty_for_user: {
        Args: { p_user_id: string }
        Returns: number
      }
      is_org_admin_caughtcode: { Args: { org: string }; Returns: boolean }
      is_org_member_caughtcode: { Args: { org: string }; Returns: boolean }
      job_application_tally: {
        Args: { p_job_ids: string[] }
        Returns: {
          job_id: string
          pending: number
          total: number
        }[]
      }
      listing_reach: { Args: { p_listing_id: string }; Returns: number }
      marcar_caso_resuelto: {
        Args: { p_listing: string; p_resuelto?: boolean }
        Returns: boolean
      }
      match_chunks: {
        Args: {
          p_match_count?: number
          p_min_similarity?: number
          p_query_embedding: string
          p_tenant_id: string
        }
        Returns: {
          content: string
          metadata: Json
          similarity: number
          source_id: string
          source_kind: string
        }[]
      }
      match_chunks_fts: {
        Args: { p_match_count?: number; p_query: string; p_tenant_id: string }
        Returns: {
          content: string
          metadata: Json
          similarity: number
          source_id: string
          source_kind: string
        }[]
      }
      notification_counts: {
        Args: never
        Returns: {
          category: string
          unread: number
        }[]
      }
      org_of_finding_caughtcode: {
        Args: { p_finding_id: string }
        Returns: string
      }
      org_of_project_caughtcode: {
        Args: { p_project_id: string }
        Returns: string
      }
      org_of_run_caughtcode: {
        Args: { p_analysis_run_id: string }
        Returns: string
      }
      org_of_thread_caughtcode: {
        Args: { p_thread_id: string }
        Returns: string
      }
      phone_verification_can_send: {
        Args: { p_phone: string; p_tenant: string }
        Returns: string
      }
      phone_verification_consume: {
        Args: { p_code_hash: string; p_phone: string; p_tenant: string }
        Returns: string
      }
      profile_card: {
        Args: { p_profile_id: string }
        Returns: {
          age: number
          area_label: string
          avatar_url: string
          bio: string
          birthdate: string
          can_see_followers: boolean
          can_see_posts: boolean
          city: string
          country_origin: string
          country_residence: string
          cover_url: string
          created_at: string
          display_name: string
          id: string
          identity_verified: boolean
          languages: string[]
          last_name: string
          username: string
          viewer_is_follower: boolean
          viewer_is_owner: boolean
        }[]
      }
      puedo_administrar_aviso: { Args: { p_listing: string }; Returns: boolean }
      puedo_publicar_vertical: {
        Args: { p_kind: string; p_price?: number }
        Returns: boolean
      }
      quitar_foto_de_publicacion: {
        Args: { p_path: string; p_post: string }
        Returns: string
      }
      record_boost_impressions: {
        Args: { p_boost_ids: string[] }
        Returns: number
      }
      record_cta_click: {
        Args: { p_cta_kind: string; p_listing_id: string }
        Returns: undefined
      }
      record_listing_share: {
        Args: { p_listing_id: string }
        Returns: undefined
      }
      release_worker_lock_caughtcode: {
        Args: { p_holder: string; p_name: string }
        Returns: boolean
      }
      renovar_publicacion: { Args: { p_listing: string }; Returns: Json }
      report_listing_review: {
        Args: { p_details?: string; p_reason: string; p_review_id: string }
        Returns: string
      }
      report_scam: {
        Args: {
          p_details?: string
          p_reason: string
          p_target_id: string
          p_target_kind: string
        }
        Returns: string
      }
      request_contact: { Args: { p_listing_id: string }; Returns: string }
      request_creator_activation: {
        Args: { p_profile_id: string }
        Returns: string
      }
      requeue_expired_jobs_caughtcode: {
        Args: never
        Returns: {
          analysis_run_id: string
          id: string
          status: string
        }[]
      }
      resolve_tenant_domain: {
        Args: { p_host: string }
        Returns: {
          is_primary: boolean
          matched_domain: string
          primary_domain: string
          tenant_id: string
          tenant_name: string
          tenant_slug: string
        }[]
      }
      save_listing_ctas: {
        Args: {
          p_address?: string
          p_booking_url?: string
          p_listing_id: string
          p_phone?: string
          p_purchase_url?: string
          p_tickets_url?: string
          p_website?: string
          p_whatsapp?: string
        }
        Returns: undefined
      }
      scan_content_asset: {
        Args: {
          p_asset_id: string
          p_max_distance?: number
          p_max_distance_audio?: number
          p_max_distance_video?: number
        }
        Returns: number
      }
      search_taggable_members: {
        Args: { max_results?: number; q: string }
        Returns: {
          avatar_url: string
          display_name: string
          id: string
        }[]
      }
      set_application_share_profile: {
        Args: { p_application_id: string; p_share: boolean }
        Returns: undefined
      }
      set_finding_status_caughtcode: {
        Args: { p_finding_id: string; p_status: string }
        Returns: {
          analysis_run_id: string
          check_id: string
          confidence: string
          created_at: string
          evidence: Json
          explanation_plain: string
          fix_prompt: string
          id: string
          impact_plain: string
          pillar: string
          project_id: string
          rank: number
          resolved_at: string | null
          severity: string
          status: string
          title_plain: string
          video_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "findings_caughtcode"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tenant_public_prices: {
        Args: { p_tenant_id: string }
        Returns: {
          amount_cents: number
          billing_interval: string
          currency: string
          product: string
          variant: string
        }[]
      }
      try_acquire_worker_lock_caughtcode: {
        Args: { p_holder: string; p_name: string; p_ttl_seconds?: number }
        Returns: boolean
      }
      unblock_user: { Args: { p_profile_id: string }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
