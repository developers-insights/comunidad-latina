import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { computeCreatorRequirements, type CreatorRequirementsResult } from "@/components/creators";
import type { ServicePackage } from "@/lib/creators/service-packages";

/**
 * =============================================================================
 * DATOS REALES DE LOS REQUISITOS DEL CREADOR (spec §6)
 * =============================================================================
 *
 * De dónde sale cada número, y por qué de ahí:
 *
 *  - **Seguidores** → `follows` con `target_kind='profile'`. Es el mismo
 *    conteo que usa el perfil público, así que no puede divergir de lo que la
 *    persona ya ve en otra pantalla.
 *  - **Videos publicados** → `posts` con `video_type='short_video'` y
 *    `status='published'`. Se cuentan los publicados, no los borradores ni los
 *    que moderación bajó: el requisito habla de trabajo visible.
 *  - **Vistas acumuladas** → suma de `posts.view_count` de esos mismos videos.
 *    El contador lo mantiene la base (0046), no se recalcula acá.
 *  - **Antigüedad** → `profiles.created_at`.
 *  - **Creator Score** → NO SE LEE. `creator_scores` existe en la base
 *    (migración 0029) pero no está en `src/lib/types/database.types.ts`, que es
 *    el contrato tipado de este repo. Consultarla igual sería escribir contra
 *    un tipo que no existe. Va como "todavía no lo medimos" — ver la cabecera
 *    de `components/creators/requirements.ts`. Cuando los tipos se regeneren,
 *    el cambio es una consulta más acá y `creatorScore` en el input.
 *
 * TOPE DE LECTURA (`VIEWS_SAMPLE_LIMIT`): la suma de vistas se hace en la app
 * porque PostgREST no expone un `sum()` sin una vista o RPC dedicada, y este
 * módulo no puede crear migraciones. Traer filas sin techo sería una bomba de
 * memoria para un creador prolífico, así que se acota — con 500 videos ya se
 * superó el requisito de 20 y el de 50.000 vistas por varios órdenes.
 * Si algún día se necesita el total exacto, el lugar correcto es una vista
 * materializada, no subir este número.
 */

const VIDEO_TYPE_SHORT = "short_video";
const VIEWS_SAMPLE_LIMIT = 500;

export interface CreatorStats {
  requirements: CreatorRequirementsResult;
  followers: number;
}

export async function fetchCreatorRequirements(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  profileId: string,
  accountCreatedAt: string | null,
): Promise<CreatorStats> {
  const [followersResult, videosResult] = await Promise.all([
    supabase
      .from("follows")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("target_kind", "profile")
      .eq("target_id", profileId),
    supabase
      .from("posts")
      .select("id, view_count", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("author_id", profileId)
      .eq("video_type", VIDEO_TYPE_SHORT)
      .eq("status", "published")
      .limit(VIEWS_SAMPLE_LIMIT),
  ]);

  // Un error de lectura NO se convierte en 0: un 0 le diría al creador que no
  // tiene nada, que es una acusación falsa. `null` cae en "todavía no lo
  // medimos", que es exactamente lo que pasó.
  const followers = followersResult.error ? null : (followersResult.count ?? 0);

  const videoRows = videosResult.error ? null : (videosResult.data ?? []);
  // `count` es el total real aunque el `limit` haya recortado las filas.
  const videos = videosResult.error ? null : (videosResult.count ?? videoRows?.length ?? 0);
  const views = videoRows
    ? videoRows.reduce((sum, row) => sum + Math.max(0, row.view_count ?? 0), 0)
    : null;

  if (followersResult.error || videosResult.error) {
    console.warn("[creadores] no se pudieron leer los requisitos", {
      followers: followersResult.error?.code ?? null,
      videos: videosResult.error?.code ?? null,
    });
  }

  return {
    followers: followers ?? 0,
    requirements: computeCreatorRequirements({
      followers,
      videos,
      views,
      accountCreatedAt,
      // creatorScore: pendiente de que `creator_scores` entre a los tipos.
    }),
  };
}

/* ========================================================================== */
/* PAQUETES DE SERVICIO (0102)                                                */
/* ========================================================================== */

interface ServicePackageRow {
  id: string;
  title: string;
  description: string | null;
  includes: string[] | null;
  price_cents: number;
  currency: string;
  delivery_days: number;
  active: boolean;
  sort_order: number;
}

/**
 * Los paquetes de un creador, en el orden que él eligió.
 *
 * QUIÉN FILTRA QUÉ. El `activeOnly` NO es la protección — es una comodidad para
 * el perfil público. Quien decide si alguien puede ver un paquete apagado es la
 * policy `creator_service_packages_select` (0102): lo apagado sólo lo ve su
 * dueño y el staff de la comunidad. Aunque esta función pidiera todo, un
 * visitante no recibiría los apagados de otro. Se filtra igual acá porque
 * pedirle a la base filas que va a descartar es trabajo al pedo.
 *
 * `creator_service_packages` llega con la 0102 y `database.types.ts` se
 * regenera aparte: el cast es por el TIPO generado, no por el contrato — mismo
 * patrón que `createGigDraft` con `work_mode` (0087).
 *
 * Un error de lectura devuelve lista vacía y NO rompe el perfil: que no
 * carguen los paquetes no puede tumbar la página entera de alguien.
 */
export async function fetchServicePackages(
  supabase: SupabaseClient<Database>,
  creatorId: string,
  options: { activeOnly: boolean },
): Promise<ServicePackage[]> {
  const open = supabase as unknown as SupabaseClient;
  let query = open
    .from("creator_service_packages")
    .select("id, title, description, includes, price_cents, currency, delivery_days, active, sort_order")
    .eq("creator_id", creatorId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(12);

  if (options.activeOnly) query = query.eq("active", true);

  const { data, error } = await query.returns<ServicePackageRow[]>();

  if (error) {
    console.warn("[creadores] no se pudieron leer los paquetes", { code: error.code });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    // `description` es nullable en la base (ver 0102) pero la app la exige al
    // guardar. El `?? ""` cubre una fila cargada por fuera del formulario sin
    // que la pantalla explote.
    description: row.description ?? "",
    includes: row.includes ?? [],
    priceCents: row.price_cents,
    currency: row.currency,
    deliveryDays: row.delivery_days,
    active: row.active,
    sortOrder: row.sort_order,
  }));
}
