"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantMatch } from "@/lib/tenant/guard";
import {
  COMMUNITY_EMOJI_COLUMNS,
  toCommunityEmoji,
  type CommunityEmoji,
  type CommunityEmojiRow,
} from "./catalog";

/**
 * EL CATÁLOGO PARA ELEGIR (migración 0125).
 *
 * Es el camino del PICKER, y sale de un gesto: la persona toca la carita y
 * recién ahí se pide el catálogo. Quien escribe un comentario sin emojis no
 * paga esta consulta — misma decisión que `MusicPicker`, que pide las pistas al
 * abrir la hoja y no al montar el composer.
 *
 * El otro camino, el de PINTAR (`queries.ts`), corre en el servidor dentro del
 * render del comentario. Son dos porque los momentos son distintos, pero leen
 * las MISMAS columnas y usan el MISMO mapeo (`toCommunityEmoji`).
 *
 * `requireTenantMatch()` y no una lectura anónima: el picker sólo aparece
 * donde ya hay que estar identificado (comentar, publicar, reaccionar), y el
 * guard es lo que además resuelve el tenant del SERVIDOR. El tenant nunca
 * llega por parámetro — es la regla del repo y acá se cumple sola: la policy
 * de la 0125 filtra con `app.current_tenant_id()`, que sale de la sesión.
 *
 * `community_emojis` todavía no está en `database.types.ts` (llega con la
 * 0125) → cliente de schema abierto. Mismo patrón que `music_tracks`.
 */
type OpenClient = SupabaseClient;

export type ListCommunityEmojisResult =
  | { ok: true; emojis: CommunityEmoji[] }
  | { ok: false; code: "unauthenticated" | "error" }
  | { ok: false; code: "tenant-mismatch"; message: string };

const CATALOG_LIMIT = 300;

export async function listCommunityEmojisAction(): Promise<ListCommunityEmojisResult> {
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error" };
  }

  const open = guard.supabase as unknown as OpenClient;
  const { data, error } = await open
    .from("community_emojis")
    .select(COMMUNITY_EMOJI_COLUMNS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true })
    .limit(CATALOG_LIMIT);

  if (error) {
    console.warn("[emojis] lectura del catálogo falló", { code: error.code });
    return { ok: false, code: "error" };
  }

  // Lista VACÍA no es un error: es el estado real de la feature hasta que
  // alguien cargue y encienda los dibujos. El picker tiene un estado vacío que
  // lo dice con todas las letras.
  return { ok: true, emojis: ((data ?? []) as CommunityEmojiRow[]).map(toCommunityEmoji) };
}
