// GENERADO desde Supabase (proyecto ktmbtpuhqqofdkisqseq) — NO editar a mano.
// Regenerar: MCP generate_typescript_types o `npx supabase gen types typescript`.
// EXCEPCIÓN 2026-07-19: los bloques de 0023–0025 (follows, post_promotions,
// creator_profiles, gig_*, posts.entity_listing_id) se escribieron a mano con
// el formato generado — el MCP no tiene permiso sobre este proyecto y el CLI
// requiere Docker. Una regeneración futura los reemplaza sin drama.
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
      listings: {
        Row: {
          area_label: string | null
          attrs: Json
          contact_protected: boolean
          created_at: string
          created_by: string | null
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
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          area_label?: string | null
          attrs?: Json
          contact_protected?: boolean
          created_at?: string
          created_by?: string | null
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
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          area_label?: string | null
          attrs?: Json
          contact_protected?: boolean
          created_at?: string
          created_by?: string | null
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
          tenant_id?: string
          title?: string
          updated_at?: string
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
      notifications: {
        Row: {
          body: string | null
          created_at: string
          expires_at: string
          href: string | null
          id: string
          kind: string
          profile_id: string
          read_at: string | null
          tenant_id: string
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          expires_at?: string
          href?: string | null
          id?: string
          kind: string
          profile_id: string
          read_at?: string | null
          tenant_id: string
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          expires_at?: string
          href?: string | null
          id?: string
          kind?: string
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
          entity_listing_id: string | null
          id: string
          kind: string
          like_count: number
          media: string[]
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          comment_count?: number
          created_at?: string
          entity_listing_id?: string | null
          id?: string
          kind?: string
          like_count?: number
          media?: string[]
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          comment_count?: number
          created_at?: string
          entity_listing_id?: string | null
          id?: string
          kind?: string
          like_count?: number
          media?: string[]
          status?: string
          tenant_id?: string
          updated_at?: string
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
      post_promotions: {
        Row: {
          amount_cents: number
          audience: Json
          buyer_id: string
          created_at: string
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
      profiles: {
        Row: {
          account_status: string
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
          updated_at: string
        }
        Insert: {
          account_status?: string
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
          updated_at?: string
        }
        Update: {
          account_status?: string
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
