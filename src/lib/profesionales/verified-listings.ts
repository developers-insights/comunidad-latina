import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

/**
 * Ids de fichas con un `verification_check` `found_active` vigente, para el
 * filtro "Verificados" del directorio de Profesionales.
 *
 * Tope de seguridad (mismo criterio que FOLLOWED_LISTINGS_CAP/BLOCKED_PROFILES_CAP
 * en feed/queries.ts): estos ids se inlinean en un `.in(...)` de la query
 * principal y viajan por la URL — sin tope, un tenant con muchísimas fichas
 * verificadas arriesgaría el mismo 414 que ese módulo ya documentó. `checked_at
 * desc` para que, si algún día se corta, sobrevivan las verificaciones MÁS
 * recientes.
 *
 * No se filtra por `kind='professional'` acá: la query principal ya lo hace, y
 * un id de otro vertical que colara en esta lista simplemente no matchea nada
 * en el `.in("id", …)` de esa query. Mantenerlo genérico evita una dependencia
 * cruzada con el resto del esquema de `attrs`.
 */
const VERIFIED_LISTINGS_CAP = 500;

export async function fetchVerifiedProfessionalListingIds(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("verification_checks")
    .select("subject_id")
    .eq("tenant_id", tenantId)
    .eq("subject_kind", "listing")
    .eq("result", "found_active")
    .order("checked_at", { ascending: false })
    .limit(VERIFIED_LISTINGS_CAP);

  if (error) {
    console.warn("[profesionales] no se pudo leer el filtro de verificados", {
      code: error.code,
    });
    return [];
  }
  return [
    ...new Set((data ?? []).map((row) => row.subject_id).filter((id): id is string => Boolean(id))),
  ];
}
