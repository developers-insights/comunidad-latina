import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import {
  configFromRow,
  evaluateEligibility,
  type EligibilityConfig,
  type EligibilityResult,
  type EligibilitySubject,
} from "@/lib/creators/eligibility";

/**
 * =============================================================================
 * LA COLA DE SOLICITUDES DE CREADOR
 * =============================================================================
 *
 * `request_creator_activation` (0032) deja a la persona en
 * `platform_review_pending` y ahí se queda hasta que alguien decida. Este módulo
 * arma lo que ese alguien necesita para decidir sin adivinar: quién es, hace
 * cuánto espera, qué presentó y —lo importante— QUÉ REQUISITO CUMPLE Y CUÁL NO,
 * evaluado contra los umbrales que su propia comunidad tiene configurados hoy
 * (`creator_eligibility_config`, 0064).
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ SE VUELVE A EVALUAR EL GATE SI YA LO PASÓ AL SOLICITAR
 *
 * Porque entre el envío y la revisión pasan cosas: el admin puede haber subido
 * un umbral, la persona puede haber borrado medio portafolio, o le pueden haber
 * aplicado una restricción. Mostrar la foto del día que solicitó sería mostrar
 * una foto vieja. Lo que se ve acá es el estado AHORA.
 *
 * -----------------------------------------------------------------------------
 * SIN PRIVILEGIOS Y SIN N+1
 *
 * Todo se lee con el cliente del propio staff: la RLS gobierna (ARQUITECTURA §6
 * — el admin client no se usa para leer en un request de usuario). Y se lee POR
 * LOTE: una consulta por tabla y el cruce en memoria, igual que la cola de
 * integridad. Con 50 solicitudes, una consulta por persona serían ~450
 * round-trips.
 *
 * ⚠️ `creator_profiles_select` es `USING (true)` (0024): la tabla se lee entera,
 * de todos los tenants. El filtro por comunidad NO lo pone la RLS acá, lo pone
 * esta consulta — y por eso `tenant_id` aparece explícito en cada `eq`.
 *
 * -----------------------------------------------------------------------------
 * LO QUE EL PANEL NO PUEDE VER (y no inventa)
 *
 * `profiles_private` tiene RLS solo-dueño (0003): ni un domain_admin lee la
 * fecha de nacimiento ni el apellido de otra persona. Consultarla devolvería
 * cero filas en silencio, y leer ese cero como "no cumple" sería acusar de
 * incumplir a alguien que cumple. Esas dimensiones viajan como `null` y el
 * evaluador las marca `unknown`, que la pantalla muestra como "no lo podemos
 * verificar desde acá" — nunca como un incumplimiento.
 * =============================================================================
 */

/**
 * Tope de filas por consulta de conteo. PostgREST no expone `group by`, así que
 * portafolio, seguidores, videos y vistas se cuentan en la app. Si se alcanza el
 * tope el conteo deja de ser confiable y esas dimensiones se marcan como NO
 * MEDIDAS para todos, antes que mostrar un número corto y que alguien rechace
 * una solicitud por un dato nuestro que está mal.
 */
const COUNT_ROW_LIMIT = 5000;

/** Cuántas solicitudes se traen por página. Misma escala que la cola de integridad. */
export const QUEUE_LIMIT = 50;

/* -------------------------------------------------------------------------- */
/* Filtros                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Los tres estados de una solicitud desde el lado del que revisa. NO es la
 * máquina de 9 estados de la 0032 en crudo: `not_requested` y
 * `application_started` son "todavía no la mandó" y no tienen nada que decidir,
 * así que no aparecen en ninguna pestaña. Una cola que muestra lo que no se
 * puede resolver deja de ser una cola.
 */
export const QUEUE_FILTERS = [
  {
    id: "pendientes",
    label: "Para revisar",
    statuses: ["platform_review_pending", "documents_pending", "stripe_review_pending"],
  },
  {
    id: "esperando",
    label: "Esperando su respuesta",
    statuses: ["needs_info"],
  },
  {
    id: "resueltas",
    label: "Resueltas",
    statuses: ["approved", "rejected", "suspended"],
  },
] as const;

export type QueueFilterId = (typeof QUEUE_FILTERS)[number]["id"];

export const DEFAULT_FILTER: QueueFilterId = "pendientes";

/** Un `?estado=` inventado cae al default en vez de romper o mostrar vacío. */
export function resolveQueueFilter(value: string | string[] | undefined): QueueFilterId {
  const first = Array.isArray(value) ? value[0] : value;
  const found = QUEUE_FILTERS.find((filter) => filter.id === first);
  return found?.id ?? DEFAULT_FILTER;
}

function statusesOf(filter: QueueFilterId): string[] {
  const found = QUEUE_FILTERS.find((item) => item.id === filter) ?? QUEUE_FILTERS[0];
  return [...found.statuses];
}

/* -------------------------------------------------------------------------- */
/* La forma de una solicitud en pantalla                                      */
/* -------------------------------------------------------------------------- */

export interface CreatorRequestView {
  profileId: string;
  /** null ⇒ el perfil no se pudo leer (borrado o RLS). Se dice, no se rellena. */
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  /** `profiles.created_at` — la antigüedad en la comunidad. */
  memberSince: string | null;
  status: string;
  /** Cuándo entró a este estado. Con esto se sabe hace cuánto espera. */
  statusUpdatedAt: string | null;
  /**
   * Días en el estado actual. Se calcula ACÁ y no en el componente por dos
   * razones: un `Date.now()` durante el render es impuro (y el linter lo
   * frena), y si lo derivara la tarjeta cliente, el HTML del servidor y el de
   * la hidratación podrían no coincidir.
   */
  waitedDays: number | null;
  /** Lo que la persona presentó. */
  headline: string;
  categories: string[];
  rateHint: string | null;
  /** null ⇒ no se pudo contar (ver `COUNT_ROW_LIMIT`). */
  portfolioItems: number | null;
  creatorTermsAcceptedAt: string | null;
  /** El gate, evaluado AHORA contra los umbrales vigentes del tenant. */
  eligibility: EligibilityResult;
}

export interface CreatorRequestQueue {
  requests: CreatorRequestView[];
  /** Cuántas hay en cada pestaña, para que el nav no mienta. */
  counts: Record<QueueFilterId, number>;
  /** Los umbrales vigentes: la pantalla los cita, no los adivina. */
  config: EligibilityConfig;
  /**
   * `true` si la lectura de la configuración FALLÓ. No es lo mismo que "el
   * tenant no tiene fila" (ahí los defaults SON lo vigente): con un error, los
   * requisitos que se muestran pueden no ser los que la base va a evaluar.
   */
  configFailed: boolean;
  /** Qué no se pudo medir y por qué. Un panel que no sabe algo, lo dice. */
  blindSpots: string[];
  /** `true` si la lista se cortó en `QUEUE_LIMIT`. */
  truncated: boolean;
  /** `true` si la consulta principal falló: la pantalla avisa en vez de decir "no hay". */
  failed: boolean;
}

const EMPTY_COUNTS: Record<QueueFilterId, number> = {
  pendientes: 0,
  esperando: 0,
  resueltas: 0,
};

const DAY_MS = 86_400_000;

/** Días enteros desde un instante. `null` si la fecha no se puede leer. */
function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  // Una fecha en el futuro (reloj corrido, dato sembrado) es 0 días, no negativa.
  return Math.max(0, Math.floor((now - time) / DAY_MS));
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

/* -------------------------------------------------------------------------- */
/* La consulta                                                                */
/* -------------------------------------------------------------------------- */

export async function fetchCreatorRequestQueue(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  filter: QueueFilterId,
): Promise<CreatorRequestQueue> {
  const blindSpots: string[] = [
    "La fecha de nacimiento y el apellido son datos privados de cada persona: no se pueden leer desde el panel, ni siquiera con permisos de administración. Quien ya confirmó ser mayor de edad figura como que cumple.",
  ];

  const statuses = statusesOf(filter);
  // Las resueltas se miran de la más reciente a la más vieja (es un historial);
  // las abiertas al revés, la que más espera arriba — si no, quien lleva tres
  // semanas esperando queda sepultado bajo las que llegaron ayer.
  const oldestFirst = filter !== "resueltas";

  const [queueResult, tallyResult, configResult] = await Promise.all([
    supabase
      .from("creator_profiles")
      .select("profile_id, status, status_updated_at, headline, categories, rate_hint, creator_terms_accepted_at")
      .eq("tenant_id", tenantId)
      .in("status", statuses)
      .order("status_updated_at", { ascending: oldestFirst, nullsFirst: false })
      .limit(QUEUE_LIMIT),
    // Un solo viaje para los tres contadores del nav: `creator_profiles` tiene
    // una fila por creador de la comunidad, no por evento, así que la tabla
    // entera del tenant es chica y contar en memoria sale más barato que tres
    // `head: true` distintos.
    supabase.from("creator_profiles").select("status").eq("tenant_id", tenantId),
    supabase.from("creator_eligibility_config").select("*").eq("tenant_id", tenantId).maybeSingle(),
  ]);

  /**
   * OJO con el fallback de la configuración (misma trampa que en el panel de
   * umbrales): "no hay fila" y "la lectura falló" se ven igual y significan
   * cosas opuestas. Sin fila, los defaults SON lo vigente. Con error, lo que se
   * muestre puede no ser lo que la base evalúa — y eso se avisa en pantalla.
   */
  const configFailed = Boolean(configResult.error);
  const config = configFromRow(configResult.data);

  const counts = { ...EMPTY_COUNTS };
  for (const row of tallyResult.data ?? []) {
    for (const item of QUEUE_FILTERS) {
      if ((item.statuses as readonly string[]).includes(row.status)) counts[item.id] += 1;
    }
  }

  if (queueResult.error) {
    console.error("[admin/creadores] no se pudo leer la cola de solicitudes:", queueResult.error.message);
    return {
      requests: [],
      counts,
      config,
      configFailed,
      blindSpots,
      truncated: false,
      failed: true,
    };
  }

  const queueRows = queueResult.data ?? [];
  if (queueRows.length === 0) {
    return {
      requests: [],
      counts,
      config,
      configFailed,
      blindSpots,
      truncated: false,
      failed: false,
    };
  }

  const ids = queueRows.map((row) => row.profile_id);

  const [
    profilesResult,
    scoresResult,
    restrictionsResult,
    connectResult,
    portfolioResult,
    followsResult,
    postsResult,
  ] = await Promise.all([
    // Los `select` van en UNA línea a propósito: supabase-js deriva el tipo de
    // la fila parseando ese string literal, y una concatenación lo deja ciego.
    supabase
      .from("profiles")
      .select("id, display_name, username, avatar_url, bio, country_origin, identity_verified, phone_verified, email_verified, account_status, age_confirmed_at, created_at")
      .in("id", ids),
    supabase.from("trust_scores").select("profile_id, score").in("profile_id", ids),
    supabase
      .from("account_restrictions")
      .select("profile_id, expires_at")
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

  const followsTruncated =
    Boolean(followsResult.error) || (followsResult.data?.length ?? 0) >= COUNT_ROW_LIMIT;
  const postsTruncated =
    Boolean(postsResult.error) || (postsResult.data?.length ?? 0) >= COUNT_ROW_LIMIT;

  if (profilesResult.error) {
    blindSpots.push(
      "No pudimos leer los perfiles de quienes solicitaron, así que casi ningún requisito se puede verificar ahora mismo. Recargá la página antes de decidir.",
    );
  }
  if (followsTruncated && config.minFollowers > 0) {
    blindSpots.push(
      "Hay demasiados seguidores para contarlos acá sin arriesgar un número equivocado, así que ese requisito queda sin verificar.",
    );
  }
  if (postsTruncated && (config.minVideos > 0 || config.minViews > 0)) {
    blindSpots.push(
      "Hay demasiadas publicaciones para contarlas acá sin arriesgar un número equivocado, así que videos y vistas quedan sin verificar.",
    );
  }
  if (portfolioResult.error) {
    blindSpots.push("No pudimos contar los portafolios, así que ese requisito queda sin verificar.");
  }
  if (connectResult.error && config.requireStripeConnect) {
    blindSpots.push(
      "No pudimos leer el estado de las cuentas de cobro, así que ese requisito queda sin verificar.",
    );
  }

  const profileById = new Map((profilesResult.data ?? []).map((row) => [row.id, row] as const));
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
    viewSums.set(
      post.author_id,
      (viewSums.get(post.author_id) ?? 0) + Math.max(0, post.view_count ?? 0),
    );
  }

  const requests: CreatorRequestView[] = queueRows.map((creator) => {
    const profile = profileById.get(creator.profile_id);
    const readable = Boolean(profile);
    const portfolioItems = portfolioResult.error
      ? null
      : (portfolioCounts.get(creator.profile_id) ?? 0);

    const subject: EligibilitySubject = {
      exists: true,
      ageConfirmed: Boolean(profile?.age_confirmed_at),
      // Privados: nunca se consultan. Ver la cabecera.
      ageYears: null,
      hasLastName: null,
      profileCompletePublic: readable
        ? Boolean(
            profile?.display_name &&
              profile?.username &&
              profile?.avatar_url &&
              profile?.bio &&
              profile?.country_origin,
          )
        : null,
      phoneVerified: readable ? Boolean(profile?.phone_verified) : null,
      emailVerified: readable ? Boolean(profile?.email_verified) : null,
      identityVerified: readable ? Boolean(profile?.identity_verified) : null,
      userScore: scoresResult.error ? null : (scoreById.get(creator.profile_id) ?? 0),
      accountActive: readable ? profile?.account_status === "active" : null,
      marketplaceRestricted: restrictionsResult.error
        ? null
        : restrictedIds.has(creator.profile_id),
      stripeConnectReady: connectResult.error ? null : connectReadyIds.has(creator.profile_id),
      portfolioItems,
      followers: followsTruncated ? null : (followerCounts.get(creator.profile_id) ?? 0),
      videos: postsTruncated ? null : (videoCounts.get(creator.profile_id) ?? 0),
      views: postsTruncated ? null : (viewSums.get(creator.profile_id) ?? 0),
      creatorTermsAccepted: creator.creator_terms_accepted_at !== null,
    };

    return {
      profileId: creator.profile_id,
      displayName: profile?.display_name ?? null,
      username: profile?.username ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      memberSince: profile?.created_at ?? null,
      status: creator.status,
      statusUpdatedAt: creator.status_updated_at,
      waitedDays: daysSince(creator.status_updated_at, now),
      headline: creator.headline,
      categories: creator.categories ?? [],
      rateHint: creator.rate_hint,
      portfolioItems,
      creatorTermsAcceptedAt: creator.creator_terms_accepted_at,
      eligibility: evaluateEligibility(config, subject),
    };
  });

  return {
    requests,
    counts,
    config,
    configFailed,
    blindSpots,
    truncated: queueRows.length >= QUEUE_LIMIT,
    failed: false,
  };
}
