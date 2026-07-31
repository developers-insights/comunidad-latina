import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { computeCreatorRequirements, type CreatorRequirementsResult } from "@/components/creators";

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
