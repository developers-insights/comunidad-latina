import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RESOURCE_COLUMNS,
  isResourceTopic,
  supabaseSinTiparComunidad,
  type ResourceRow,
  type ResourceTopic,
} from "@/lib/comunidad";

/**
 * =============================================================================
 * EL DIRECTORIO, VISTO DESDE EL PANEL (0131)
 * =============================================================================
 *
 * `community_resources` existe desde la 0096 y hasta hoy sólo se podía cargar
 * por SQL: no había ni una pantalla. Por eso el directorio está vacío en
 * producción y las tres tarjetas de la portada llevan a una lista sin fichas.
 *
 * Esta lectura es la que le da al equipo la pantalla que faltaba, y el uso que
 * la pide es concreto: «ahí va el listado de todos los bancos de comida del área
 * de Nueva York; esa información la sacamos de la alcaldía» (cliente,
 * 2026-09-03, 45:20). Son decenas de fichas cargadas a mano.
 *
 * ── SOLO LAS FICHAS DE ESTA COMUNIDAD ───────────────────────────────────────
 * `community_resources` admite fichas GLOBALES (`tenant_id is null`): un
 * consulado le sirve a todas las comunidades y duplicarlo garantizaría que una
 * copia quede vieja. Esas NO se listan acá, y no es un descuido: la policy de
 * UPDATE de la 0096 sólo deja tocar las del propio tenant, así que mostrarlas
 * sería mostrar filas con botones que no funcionan.
 *
 * ── TODOS LOS ESTADOS, INCLUIDO `removed` ───────────────────────────────────
 * Al revés que el lado público, que sólo lee `published`. Un borrador a medio
 * cargar y una ficha que se bajó tienen que poder encontrarse: si desaparecieran
 * del panel, la única forma de recuperarlas sería volver a escribirlas.
 */

export interface RecursoAdminRow extends ResourceRow {
  topicValido: ResourceTopic | null;
}

export async function fetchRecursosDelPanel(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ items: RecursoAdminRow[]; failed: boolean }> {
  const { data, error } = await supabaseSinTiparComunidad(supabase)
    .from("community_resources")
    .select(RESOURCE_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("topic", { ascending: true })
    .order("name", { ascending: true })
    .limit(400);

  if (error) {
    console.warn("[admin/recursos] query falló", { code: error.code });
    return { items: [], failed: true };
  }

  const filas = (data ?? []) as unknown as ResourceRow[];
  return {
    items: filas.map((fila) => ({
      ...fila,
      // El tema se valida acá y no se descarta la fila: una ficha con un tema
      // que la app no conoce NO se ve en el directorio público (lo filtra
      // `toCommunityResource`), así que el panel es el único lugar donde se
      // puede encontrar para arreglarla. Esconderla acá también sería dejarla
      // invisible en todos lados.
      topicValido: isResourceTopic(fila.topic) ? fila.topic : null,
    })),
    failed: false,
  };
}
