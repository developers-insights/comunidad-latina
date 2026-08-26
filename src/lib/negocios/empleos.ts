import "server-only";

import { workModeLabel } from "@/lib/creators/work-mode";
import { readJobDetails } from "@/lib/empleos/detalles";
import { supabaseSinTipar } from "@/lib/resenas";
import { etiquetaDeSalario } from "@/lib/empleos/salario";

/**
 * =============================================================================
 * LOS PUESTOS ABIERTOS DE UN NEGOCIO (migración 0107)
 * =============================================================================
 *
 * La 0107 agrega `listings.business_listing_id`: una FK real de un aviso de
 * empleo a la ficha del negocio que lo publica, con su índice
 * (`listings_business_link_idx`). Antes esa relación no existía en ningún lado —
 * el negocio y sus vacantes eran dos avisos sin nada que los uniera— y por eso
 * la ficha no podía decir "este comercio está tomando gente".
 *
 * La consulta es exactamente la que el índice cubre: `business_listing_id = $1`
 * + `status = 'published'`, ordenado por `published_at desc, id desc`.
 *
 * ⚠️ `business_listing_id` no está en `database.types.ts` (la 0107 es posterior
 * a la última regeneración) → escape acotado `supabaseSinTipar()`, igual que el
 * resto de las superficies de 0093/0106/0107. Y por eso mismo esto NUNCA lanza:
 * en un entorno sin la migración aplicada la consulta falla, se devuelve la
 * lista vacía y la sección simplemente no se muestra.
 */

export interface PuestoDelNegocio {
  id: string;
  titulo: string;
  /** "US$ 18/hora" o "US$ 18 a US$ 22/hora" cuando el aviso declaró rango. */
  salarioEtiqueta: string | null;
  /** presencial | remoto | híbrido, ya en palabras. `null` si no lo declaró. */
  modalidad: string | null;
  areaLabel: string | null;
}

/*
 * La modalidad se lee con `workModeLabel` de `lib/creators/work-mode` — el
 * vocabulario CANÓNICO de `listings.work_mode` (0087), con su normalizador
 * defensivo y sus etiquetas pensadas ("A distancia", no "Remoto"). Escribir un
 * segundo mapa acá sería la deriva clásica: el mismo hecho con dos nombres
 * según la pantalla.
 */

/* El salario con rango vive en `@/lib/empleos/salario` — módulo PURO, porque lo comparte
 * la tarjeta de empleo (`components/empleos/job-card`). Se re-exporta acá para
 * que quien lee estos puestos no tenga que saber en qué archivo quedó. */
export { etiquetaDeSalario } from "@/lib/empleos/salario";

export async function fetchPuestosDelNegocio(
  client: unknown,
  args: { tenantId: string; businessListingId: string; limit?: number },
): Promise<PuestoDelNegocio[]> {
  const supabase = supabaseSinTipar(client);
  const { data, error } = await supabase
    .from("listings")
    .select("id, title, price_amount, price_currency, price_period, area_label, attrs, work_mode")
    .eq("tenant_id", args.tenantId)
    .eq("kind", "job")
    .eq("business_listing_id", args.businessListingId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(args.limit ?? 5);

  if (error) {
    // Entorno sin la 0107 aplicada, o RLS: la sección no se muestra y listo.
    console.warn("[negocios] no se pudieron leer los puestos del negocio", {
      code: (error as { code?: string }).code,
    });
    return [];
  }

  return ((data ?? []) as Array<{
    id: string;
    title: string;
    price_amount: number | null;
    price_currency: string | null;
    price_period: string | null;
    area_label: string | null;
    attrs: unknown;
    work_mode: string | null;
  }>).map((fila) => ({
    id: fila.id,
    titulo: fila.title,
    salarioEtiqueta: etiquetaDeSalario(
      fila.price_amount,
      fila.price_currency ?? "USD",
      fila.price_period,
      readJobDetails(fila.attrs).salaryMax,
    ),
    modalidad: workModeLabel(fila.work_mode),
    areaLabel: fila.area_label,
  }));
}
