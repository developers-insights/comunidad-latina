// GENERADO desde Supabase (proyecto ktmbtpuhqqofdkisqseq) — NO editar a mano.
// Regenerar: MCP generate_typescript_types o `npx supabase gen types typescript`.
// EXCEPCIÓN 2026-07-19: los bloques de 0023–0025 (follows, post_promotions,
// creator_profiles, gig_*, posts.entity_listing_id) se escribieron a mano con
// el formato generado — el MCP no tiene permiso sobre este proyecto y el CLI
// requiere Docker. Una regeneración futura los reemplaza sin drama.
// EXCEPCIÓN 2026-07-26 (misma razón): 0038 — saves, post_views, listing_comments,
// posts.view_count, listings.comment_count, post_promotions.cta_whatsapp.
// EXCEPCIÓN 2026-07-26 bis: 0039 — listings.store_verified (espejo público).
// EXCEPCIÓN 2026-07-27 (misma razón): 0040 — job_applications (empleos).
// EXCEPCIÓN 2026-07-27 bis: 0041 — posts.poll_* + post_poll_votes (encuestas
// Sí/No), tenants.modules_soon ("Muy pronto") y broadcasts.severity (alerta
// urgente); y 0042 — la función job_application_tally.
// EXCEPCIÓN 2026-07-30 (misma razón): 0044–0049 — posts.search + las RPC
// global_search / notification_counts / record_cta_click; notifications.category
// /priority/group_key/dismissed_at + notification_prefs; posts.video_type /
// duration_seconds / is_paid_ad / eligible_for_short_feed / video_category;
// job_applications.cv_url/portfolio_links/share_profile + job_application_notes
// + saved_candidates; listings.tier/store_active/cta_* + campaigns + cta_clicks
// + store_memberships.
// EXCEPCIÓN 2026-07-31 (misma razón): 0050 — listing_views + listings.view_count,
// listing_shares y las RPC listing_reach / record_listing_share.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/** @deprecated compat con el placeholder inicial; usar Tables<'...'> */
export type TableRow = Record<string, Json | undefined>

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_sanctions: {
        Row: {
          actor_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          kind: string
          profile_id: string
          reason: string
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
          package: string
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
          package: string
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
          package?: string
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
      creator_profiles: {
        Row: {
          available: boolean
          bio: string | null
          completed_jobs: number
          created_at: string
          headline: string
          portfolio_photos: string[]
          profile_id: string
          rate_hint: string | null
          rating_avg: number | null
          rating_count: number
          skills: string[]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          available?: boolean
          bio?: string | null
          completed_jobs?: number
          created_at?: string
          headline: string
          portfolio_photos?: string[]
          profile_id: string
          rate_hint?: string | null
          rating_avg?: number | null
          rating_count?: number
          skills?: string[]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          available?: boolean
          bio?: string | null
          completed_jobs?: number
          created_at?: string
          headline?: string
          portfolio_photos?: string[]
          profile_id?: string
          rate_hint?: string | null
          rating_avg?: number | null
          rating_count?: number
          skills?: string[]
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
          canceled_at: string | null
          client_id: string
          code: string
          created_at: string
          creator_id: string
          creator_net_cents: number | null
          currency: string
          delivered_at: string | null
          delivery_days: number
          fee_pct: number
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
          canceled_at?: string | null
          client_id: string
          code?: string
          created_at?: string
          creator_id: string
          currency?: string
          delivered_at?: string | null
          delivery_days: number
          fee_pct?: number
          funded_at?: string | null
          gig_id?: string | null
          id?: string
          payment_mode?: string
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
          canceled_at?: string | null
          client_id?: string
          code?: string
          created_at?: string
          creator_id?: string
          currency?: string
          delivered_at?: string | null
          delivery_days?: number
          fee_pct?: number
          funded_at?: string | null
          gig_id?: string | null
          id?: string
          payment_mode?: string
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
        }
        Insert: {
          area_label?: string | null
          attrs?: Json
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
        }
        Update: {
          area_label?: string | null
          attrs?: Json
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
        }
        Relationships: [
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
      payment_events: {
        Row: {
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
      posts: {
        Row: {
          author_id: string | null
          body: string
          comment_count: number
          created_at: string
          duration_seconds: number | null
          eligible_for_short_feed: boolean
          entity_listing_id: string | null
          id: string
          is_paid_ad: boolean
          kind: string
          like_count: number
          media: string[]
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
          created_at?: string
          duration_seconds?: number | null
          eligible_for_short_feed?: boolean
          entity_listing_id?: string | null
          id?: string
          is_paid_ad?: boolean
          kind?: string
          like_count?: number
          media?: string[]
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
          created_at?: string
          duration_seconds?: number | null
          eligible_for_short_feed?: boolean
          entity_listing_id?: string | null
          id?: string
          is_paid_ad?: boolean
          kind?: string
          like_count?: number
          media?: string[]
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
            foreignKeyName: "posts_entity_listing_id_fkey"
            columns: ["entity_listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "post_poll_votes_voter_id_fkey"
            columns: ["voter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_poll_votes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      profiles: {
        Row: {
          account_status: string
          age_confirmed_at: string | null
          area_label: string | null
          avatar_url: string | null
          bio: string | null
          country_origin: string | null
          created_at: string
          display_name: string
          id: string
          identity_verified: boolean
          identity_verified_at: string | null
          locale: string
          role: string
          suspended_until: string | null
          tenant_id: string
          terms_accepted_at: string | null
          terms_version: string | null
          updated_at: string
        }
        Insert: {
          account_status?: string
          age_confirmed_at?: string | null
          area_label?: string | null
          avatar_url?: string | null
          bio?: string | null
          country_origin?: string | null
          created_at?: string
          display_name: string
          id: string
          identity_verified?: boolean
          identity_verified_at?: string | null
          locale?: string
          role?: string
          suspended_until?: string | null
          tenant_id: string
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Update: {
          account_status?: string
          age_confirmed_at?: string | null
          area_label?: string | null
          avatar_url?: string | null
          bio?: string | null
          country_origin?: string | null
          created_at?: string
          display_name?: string
          id?: string
          identity_verified?: boolean
          identity_verified_at?: string | null
          locale?: string
          role?: string
          suspended_until?: string | null
          tenant_id?: string
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
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
          created_at: string
          needs: Json
          profile_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          needs?: Json
          profile_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          needs?: Json
          profile_id?: string
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
      tenant_domains: {
        Row: {
          created_at: string
          domain: string
          id: string
          is_primary: boolean
          tenant_id: string
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          is_primary?: boolean
          tenant_id: string
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          is_primary?: boolean
          tenant_id?: string
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
          level: string
          profile_id: string
          score: number
          signals: Json
          tenant_id: string
        }
        Insert: {
          computed_at?: string
          level?: string
          profile_id: string
          score?: number
          signals?: Json
          tenant_id: string
        }
        Update: {
          computed_at?: string
          level?: string
          profile_id?: string
          score?: number
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_conversation: {
        Args: { p_conversation_id: string }
        Returns: Json
      }
      admin_ban_user: {
        Args: { p_profile_id: string; p_reason: string }
        Returns: undefined
      }
      admin_reactivate_user: {
        Args: { p_profile_id: string }
        Returns: undefined
      }
      admin_suspend_user: {
        Args: { p_days: number; p_profile_id: string; p_reason: string }
        Returns: undefined
      }
      block_user: { Args: { p_profile_id: string }; Returns: undefined }
      get_tenant_by_domain: { Args: { p_domain: string }; Returns: Json }
      global_search: {
        Args: { limit_per_type?: number; q: string }
        Returns: {
          href: string
          id: string
          image_url: string | null
          rank: number
          result_type: string
          subtitle: string | null
          title: string
        }[]
      }
      job_application_tally: {
        Args: { p_job_ids: string[] }
        Returns: {
          job_id: string
          pending: number
          total: number
        }[]
      }
      listing_reach: {
        Args: { p_listing_id: string }
        Returns: number
      }
      notification_counts: {
        Args: Record<PropertyKey, never>
        Returns: {
          category: string
          unread: number
        }[]
      }
      record_cta_click: {
        Args: { p_cta_kind: string; p_listing_id: string }
        Returns: undefined
      }
      record_listing_share: {
        Args: { p_listing_id: string }
        Returns: undefined
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
