import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import type { EligibilitySubject } from "@/lib/creators/eligibility";

/**
 * =============================================================================
 * LOS HECHOS DE LOS CREADORES ACTUALES, PARA SIMULAR UN CAMBIO DE UMBRALES
 * =============================================================================
 *
 * El panel promete algo concreto: antes de guardar, decir a cuánta gente deja
 * fuera la configuración nueva. Para eso hay que evaluar a CADA creador
 * aprobado contra unos umbrales que todavía no existen en la base — algo que
 * `app.creator_activation_eligible()` no puede hacer, porque solo sabe leer la
 * configuración ya guardada. Así que los hechos se traen crudos acá y el
 * evaluador de `lib/creators/eligibility.ts` (espejo exacto del SQL) hace la
 * cuenta.
 *
 * -----------------------------------------------------------------------------
 * SIN PRIVILEGIOS Y SIN NOMBRES
 *
 * Todo se lee con el cliente del PROPIO admin: la RLS gobierna, igual que en el
 * resto del panel (ARQUITECTURA §6 — el admin client es solo para webhooks,
 * cron y moderación server-side, jamás para leer datos en un request de
 * usuario).
 *
 * Y lo que sale de acá NO lleva identidad: ni id, ni nombre, ni usuario. El
 * panel necesita CONTAR, no señalar. Un snapshot anónimo alcanza para responder
 * "cuántos quedan fuera" y no convierte una pantalla de configuración en un
 * listado de personas evaluadas.
 *
 * -----------------------------------------------------------------------------
 * LO QUE EL ADMIN NO PUEDE VER (y no se inventa)
 *
 * `profiles_private` tiene RLS SOLO-DUEÑO (0003): ni un domain_admin lee la
 * fecha de nacimiento ni el apellido de otra persona. Está bien que así sea.
 * Consultarla igual devolvería CERO filas —RLS filtra en silencio, no falla— y
 * leer ese cero como "no tiene apellido" sería acusar de incumplir a gente que
 * cumple. Por eso esas dos dimensiones NI SE CONSULTAN y viajan como `null`,
 * que el evaluador trata como "no se sabe" y el panel muestra aparte.
 *
 * `profiles.age_confirmed_at` sí es legible, y alcanza para cualquier edad
 * mínima: quien confirmó ser mayor pasa el requisito sin que haga falta la
 * fecha exacta.
 * =============================================================================
 */

/**
 * Tope de filas por consulta de conteo. PostgREST no expone `group by`, así que
 * seguidores, videos y vistas se cuentan en la app. Sin techo, una comunidad
 * grande convertiría esta pantalla en una descarga de medio millón de filas.
 *
 * Si el tope se alcanza, el conteo deja de ser confiable y las dimensiones que
 * dependen de él se marcan como NO MEDIDAS para todos — antes que mostrar un
 * número redondeado hacia abajo y que el admin decida sobre datos falsos. El
 * arreglo de verdad, el día que haga falta, es una vista agregada en la base.
 */
const COUNT_ROW_LIMIT = 5000;

/** Estados de `creator_profiles` que cuentan como "creador actual". */
const ACTIVE_CREATOR_STATUS = "approved";

export interface EligibilitySnapshots {
  /** Un snapshot anónimo por creador aprobado. */
  subjects: EligibilitySubject[];
  /**
   * Dimensiones que este panel no puede medir, con el motivo. Se muestran tal
   * cual: un panel que no puede saber algo lo dice.
   */
  blindSpots: string[];
}

interface CountLimits {
  followersTruncated: boolean;
  postsTruncated: boolean;
}

function countBy<T>(rows: readonly T[], keyOf: (row: T) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export async function fetchEligibilitySnapshots(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<EligibilitySnapshots> {
  const blindSpots: string[] = [
    "La edad exacta y el apellido viven en los datos privados de cada persona: ni vos ni nadie del equipo puede leerlos desde acá. Quien ya confirmó ser mayor de edad sí se cuenta como que cumple.",
  ];

  const { data: creatorRows, error: creatorsError } = await supabase
    .from("creator_profiles")
    .select("profile_id, creator_terms_accepted_at")
    .eq("tenant_id", tenantId)
    .eq("status", ACTIVE_CREATOR_STATUS);

  if (creatorsError || !creatorRows || creatorRows.length === 0) {
    if (creatorsError) {
      console.warn("[admin/creadores] no se pudo leer la lista de creadores", {
        code: creatorsError.code,
      });
      blindSpots.push(
        "No pudimos leer la lista de creadores en este momento, así que el impacto de abajo no se puede calcular. Recargá la página.",
      );
    }
    return { subjects: [], blindSpots };
  }

  const ids = creatorRows.map((row) => row.profile_id);

  const [
    profilesResult,
    scoresResult,
    restrictionsResult,
    connectResult,
    portfolioResult,
    followsResult,
    postsResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, display_name, username, avatar_url, bio, country_origin, identity_verified, phone_verified, email_verified, account_status, age_confirmed_at",
      )
      .in("id", ids),
    supabase.from("trust_scores").select("profile_id, score").in("profile_id", ids),
    supabase
      .from("account_restrictions")
      .select("profile_id, scope, lifted_at, expires_at")
      .eq("tenant_id", tenantId)
      .in("profile_id", ids)
      .in("scope", ["marketplace", "total"])
      .is("lifted_at", null),
    supabase
      .from("connected_accounts")
      .select("owner_ref, charges_enabled, payouts_enabled")
      .eq("tenant_id", tenantId)
      .eq("owner_type", "creator")
      .in("owner_ref", ids),
    supabase
      .from("creator_portfolio_items")
      .select("creator_id")
      .eq("tenant_id", tenantId)
      .in("creator_id", ids)
      .limit(COUNT_ROW_LIMIT),
    supabase
      .from("follows")
      .select("target_id")
      .eq("tenant_id", tenantId)
      .eq("target_kind", "profile")
      .in("target_id", ids)
      .limit(COUNT_ROW_LIMIT),
    supabase
      .from("posts")
      .select("author_id, video_type, view_count")
      .eq("tenant_id", tenantId)
      .in("author_id", ids)
      .eq("status", "published")
      .limit(COUNT_ROW_LIMIT),
  ]);

  const limits: CountLimits = {
    followersTruncated:
      Boolean(followsResult.error) || (followsResult.data?.length ?? 0) >= COUNT_ROW_LIMIT,
    postsTruncated:
      Boolean(postsResult.error) || (postsResult.data?.length ?? 0) >= COUNT_ROW_LIMIT,
  };

  if (limits.followersTruncated) {
    blindSpots.push(
      "Hay demasiados seguidores para contarlos acá sin arriesgar un número equivocado, así que ese requisito queda sin medir en la simulación.",
    );
  }
  if (limits.postsTruncated) {
    blindSpots.push(
      "Hay demasiadas publicaciones para contarlas acá sin arriesgar un número equivocado, así que videos y vistas quedan sin medir en la simulación.",
    );
  }
  if (portfolioResult.error) {
    blindSpots.push("No pudimos contar los portafolios, así que ese requisito queda sin medir.");
  }
  if (connectResult.error) {
    blindSpots.push(
      "No pudimos leer el estado de las cuentas de cobro, así que ese requisito queda sin medir.",
    );
  }

  const profileById = new Map(
    (profilesResult.data ?? []).map((row) => [row.id, row] as const),
  );
  const scoreById = new Map(
    (scoresResult.data ?? []).map((row) => [row.profile_id, row.score] as const),
  );

  const now = Date.now();
  const restrictedIds = new Set(
    (restrictionsResult.data ?? [])
      .filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > now)
      .map((row) => row.profile_id),
  );

  const connectReadyIds = new Set(
    (connectResult.data ?? [])
      .filter((row) => row.charges_enabled && row.payouts_enabled)
      .map((row) => row.owner_ref),
  );

  const portfolioCounts = countBy(portfolioResult.data ?? [], (row) => row.creator_id);
  const followerCounts = countBy(followsResult.data ?? [], (row) => row.target_id);

  const videoCounts = new Map<string, number>();
  const viewSums = new Map<string, number>();
  for (const post of postsResult.data ?? []) {
    if (!post.author_id) continue;
    if (post.video_type !== null) {
      videoCounts.set(post.author_id, (videoCounts.get(post.author_id) ?? 0) + 1);
    }
    viewSums.set(post.author_id, (viewSums.get(post.author_id) ?? 0) + Math.max(0, post.view_count ?? 0));
  }

  const subjects: EligibilitySubject[] = creatorRows.map((creator) => {
    const profile = profileById.get(creator.profile_id);
    const readable = Boolean(profile);

    return {
      exists: true,
      // Sin fila de perfil legible no se puede afirmar nada: todo va a null.
      ageConfirmed: Boolean(profile?.age_confirmed_at),
      // La fecha de nacimiento es privada — ver la cabecera. Nunca se consulta.
      ageYears: null,
      profileCompletePublic: readable
        ? Boolean(
            profile?.display_name &&
              profile?.username &&
              profile?.avatar_url &&
              profile?.bio &&
              profile?.country_origin,
          )
        : null,
      // El apellido también es privado.
      hasLastName: null,
      phoneVerified: readable ? Boolean(profile?.phone_verified) : null,
      emailVerified: readable ? Boolean(profile?.email_verified) : null,
      identityVerified: readable ? Boolean(profile?.identity_verified) : null,
      userScore: scoresResult.error ? null : (scoreById.get(creator.profile_id) ?? 0),
      accountActive: readable ? profile?.account_status === "active" : null,
      marketplaceRestricted: restrictionsResult.error
        ? null
        : restrictedIds.has(creator.profile_id),
      stripeConnectReady: connectResult.error ? null : connectReadyIds.has(creator.profile_id),
      portfolioItems: portfolioResult.error
        ? null
        : (portfolioCounts.get(creator.profile_id) ?? 0),
      followers: limits.followersTruncated ? null : (followerCounts.get(creator.profile_id) ?? 0),
      videos: limits.postsTruncated ? null : (videoCounts.get(creator.profile_id) ?? 0),
      views: limits.postsTruncated ? null : (viewSums.get(creator.profile_id) ?? 0),
      creatorTermsAccepted: creator.creator_terms_accepted_at !== null,
    };
  });

  return { subjects, blindSpots };
}
