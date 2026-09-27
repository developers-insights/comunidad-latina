import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/types/database.types";
import { MAX_PATROCINADOS } from "./modelo";

export interface PerfilPatrocinado {
  impulsoId: string;
  creatorId: string;
}

/**
 * Los perfiles de creador con un impulso vigente en esta comunidad, en orden
 * de llegada (el que pagó primero, primero). Lee sólo columnas del grant
 * público: que un perfil está patrocinado es transparencia, no un secreto.
 * Nunca lanza: un directorio sin patrocinados sigue siendo un directorio.
 */
export async function leerPerfilesPatrocinados(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<PerfilPatrocinado[]> {
  const { data, error } = await supabase
    .from("creator_profile_boosts")
    .select("id, creator_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .gt("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(MAX_PATROCINADOS * 2);

  if (error) {
    console.warn("[impulso-perfil] no se pudieron leer los perfiles patrocinados", {
      code: error.code,
    });
    return [];
  }

  const vistos = new Set<string>();
  const salida: PerfilPatrocinado[] = [];
  for (const fila of data ?? []) {
    if (vistos.has(fila.creator_id)) continue;
    vistos.add(fila.creator_id);
    salida.push({ impulsoId: fila.id, creatorId: fila.creator_id });
  }
  return salida;
}

/**
 * Suma una vez mostrada a cada impulso servido. Con service_role porque la
 * función está revocada para todo JWT de usuario: si un cliente pudiera
 * sumarse impresiones, el número dejaría de servir para decidir un gasto.
 * Best-effort y ruidoso, igual que `recordBoostImpressions`.
 */
export async function registrarImpresionesDePerfil(impulsoIds: readonly string[]): Promise<void> {
  if (impulsoIds.length === 0) return;
  const ids = [...new Set(impulsoIds)].slice(0, 24);
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("record_creator_profile_boost_impressions", { p_ids: ids });
    if (error) {
      console.warn("[impulso-perfil] no se pudieron registrar las impresiones", {
        code: error.code,
      });
    }
  } catch (error) {
    console.warn(
      "[impulso-perfil] no se pudieron registrar las impresiones",
      error instanceof Error ? error.message : error,
    );
  }
}
