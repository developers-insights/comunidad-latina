import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import type { EligibilitySubject } from "@/lib/creators/eligibility";

/**
 * =============================================================================
 * LOS PROPIOS DATOS DE QUIEN QUIERE SER CREADOR
 * =============================================================================
 *
 * Acá NO hay puntos ciegos: cada quien puede leer todo lo suyo, incluida la
 * fecha de nacimiento y el apellido de `profiles_private` (RLS solo-dueño). Por
 * eso esta consulta arma un `EligibilitySubject` completo y la pantalla puede
 * decir exactamente qué falta, sin "no lo sabemos".
 *
 * Lo que sí se mantiene es la regla de `null`: una consulta que FALLA no se
 * convierte en 0. Un 0 le diría a la persona que no tiene nada —que puede ser
 * mentira— y encima la dejaría "no elegible" por un error nuestro. Un `null`
 * cae en "no lo pudimos leer", que es lo que realmente pasó.
 *
 * TOPE DE LECTURA: la suma de vistas se hace en la app porque PostgREST no
 * expone `sum()` sin una vista dedicada, y este módulo no crea migraciones. Se
 * acota igual que en `creadores/perfil/queries.ts`.
 */

const POSTS_SAMPLE_LIMIT = 500;

/** Años cumplidos, o null si la fecha no es legible. */
export function ageInYears(birthdate: string | null | undefined, now: Date = new Date()): number | null {
  if (!birthdate) return null;
  const born = new Date(birthdate);
  const time = born.getTime();
  if (!Number.isFinite(time)) return null;

  let years = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < born.getUTCDate())) {
    years -= 1;
  }
  return years < 0 ? null : years;
}

export interface OwnCreatorFacts {
  subject: EligibilitySubject;
  /** null ⇒ todavía no existe el perfil de creador (hay que crearlo primero). */
  creatorStatus: string | null;
  creatorTermsAcceptedAt: string | null;
  creatorTermsVersion: string | null;
}

export async function fetchOwnCreatorFacts(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  profileId: string,
): Promise<OwnCreatorFacts> {
  const [
    profileResult,
    privateResult,
    phoneResult,
    scoreResult,
    restrictionResult,
    connectResult,
    creatorResult,
    portfolioResult,
    followersResult,
    videosResult,
    postsResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "display_name, username, avatar_url, bio, country_origin, identity_verified, phone_verified, email_verified, account_status, age_confirmed_at",
      )
      .eq("id", profileId)
      .maybeSingle(),
    supabase
      .from("profiles_private")
      .select("birthdate, last_name")
      .eq("profile_id", profileId)
      .maybeSingle(),
    // Legado de 0030: quien cargó la fecha ahí sigue valiendo (así lo evalúa el SQL).
    supabase.from("user_phones").select("birthdate").eq("profile_id", profileId).maybeSingle(),
    supabase.from("trust_scores").select("score").eq("profile_id", profileId).maybeSingle(),
    supabase
      .from("account_restrictions")
      .select("id, expires_at")
      .eq("profile_id", profileId)
      .in("scope", ["marketplace", "total"])
      .is("lifted_at", null),
    supabase
      .from("connected_accounts")
      .select("charges_enabled, payouts_enabled")
      .eq("owner_type", "creator")
      .eq("owner_ref", profileId),
    supabase
      .from("creator_profiles")
      .select("status, creator_terms_accepted_at, creator_terms_version")
      .eq("profile_id", profileId)
      .maybeSingle(),
    supabase
      .from("creator_portfolio_items")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", profileId),
    supabase
      .from("follows")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("target_kind", "profile")
      .eq("target_id", profileId),
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("author_id", profileId)
      .eq("status", "published")
      .not("video_type", "is", null),
    // Las vistas del SQL suman TODAS las publicaciones publicadas, no solo los
    // videos. Se traen las filas porque no hay `sum()` disponible.
    supabase
      .from("posts")
      .select("view_count")
      .eq("tenant_id", tenantId)
      .eq("author_id", profileId)
      .eq("status", "published")
      .limit(POSTS_SAMPLE_LIMIT),
  ]);

  const profile = profileResult.data;
  const now = new Date();
  const birthdate = privateResult.data?.birthdate ?? phoneResult.data?.birthdate ?? null;

  const viewRows = postsResult.error ? null : (postsResult.data ?? []);
  const views = viewRows
    ? viewRows.reduce((sum, row) => sum + Math.max(0, row.view_count ?? 0), 0)
    : null;

  const subject: EligibilitySubject = {
    exists: Boolean(profile),
    ageConfirmed: Boolean(profile?.age_confirmed_at),
    ageYears: ageInYears(birthdate, now),
    profileCompletePublic: profile
      ? Boolean(
          profile.display_name &&
            profile.username &&
            profile.avatar_url &&
            profile.bio &&
            profile.country_origin,
        )
      : null,
    hasLastName: privateResult.error ? null : Boolean(privateResult.data?.last_name),
    phoneVerified: profile ? Boolean(profile.phone_verified) : null,
    emailVerified: profile ? Boolean(profile.email_verified) : null,
    identityVerified: profile ? Boolean(profile.identity_verified) : null,
    userScore: scoreResult.error ? null : (scoreResult.data?.score ?? 0),
    accountActive: profile ? profile.account_status === "active" : null,
    marketplaceRestricted: restrictionResult.error
      ? null
      : (restrictionResult.data ?? []).some(
          (row) => !row.expires_at || new Date(row.expires_at).getTime() > now.getTime(),
        ),
    stripeConnectReady: connectResult.error
      ? null
      : (connectResult.data ?? []).some((row) => row.charges_enabled && row.payouts_enabled),
    portfolioItems: portfolioResult.error ? null : (portfolioResult.count ?? 0),
    followers: followersResult.error ? null : (followersResult.count ?? 0),
    videos: videosResult.error ? null : (videosResult.count ?? 0),
    views,
    creatorTermsAccepted: creatorResult.error
      ? null
      : Boolean(creatorResult.data?.creator_terms_accepted_at),
  };

  return {
    subject,
    creatorStatus: creatorResult.data?.status ?? null,
    creatorTermsAcceptedAt: creatorResult.data?.creator_terms_accepted_at ?? null,
    creatorTermsVersion: creatorResult.data?.creator_terms_version ?? null,
  };
}

/** Los umbrales vigentes del tenant. Cualquier miembro puede leerlos (0064). */
export async function fetchEligibilityConfigRow(
  supabase: SupabaseClient<Database>,
  tenantId: string,
) {
  const { data, error } = await supabase
    .from("creator_eligibility_config")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.warn("[creadores] no se pudo leer la configuración de elegibilidad", {
      code: error.code,
    });
  }
  return data;
}
