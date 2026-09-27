import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { moduleAvailability } from "@/components/shell/module-access";
import type { Database } from "@/lib/types/database.types";
import { impulsoVigente, situacionDelCreador, type SituacionDelCreador } from "./modelo";

export interface SituacionParaBoost {
  situacion: SituacionDelCreador;
  /** ISO del fin del impulso de perfil vigente, o null. */
  vigenteHasta: string | null;
}

/**
 * Qué le corresponde ver en Boost a quien mira, como creador. `null` si la
 * comunidad tiene Creadores apagado: ofrecer promocionarse en un directorio que
 * no existe sería prometer una pantalla que no está.
 */
export async function leerSituacionParaBoost(
  supabase: SupabaseClient<Database>,
  tenant: { id: string; modules: Record<string, boolean>; modulesSoon: Record<string, boolean> },
  userId: string,
): Promise<SituacionParaBoost | null> {
  if (moduleAvailability("creadores", tenant.modules, tenant.modulesSoon) !== "active") {
    return null;
  }

  const [perfilRes, impulsosRes] = await Promise.all([
    supabase
      .from("creator_profiles")
      .select("tenant_id, status")
      .eq("profile_id", userId)
      .maybeSingle(),
    supabase
      .from("creator_profile_boosts")
      .select("status, ends_at")
      .eq("creator_id", userId)
      .eq("tenant_id", tenant.id)
      .eq("status", "active")
      .gt("ends_at", new Date().toISOString())
      .limit(1),
  ]);

  if (perfilRes.error) {
    // Sin saber si ya es creador, invitarlo a "sumarse" podría decírselo a
    // alguien aprobado. Mejor no mostrar la entrada que mostrar la equivocada.
    console.warn("[impulso-perfil] no se pudo leer el perfil de creador", {
      code: perfilRes.error.code,
    });
    return null;
  }
  if (impulsosRes.error) {
    console.warn("[impulso-perfil] no se pudo leer el impulso vigente", {
      code: impulsosRes.error.code,
    });
  }

  const perfil = perfilRes.data && perfilRes.data.tenant_id === tenant.id ? perfilRes.data : null;
  return {
    situacion: situacionDelCreador(perfil?.status),
    vigenteHasta: impulsoVigente(impulsosRes.data ?? [], new Date().getTime()),
  };
}
