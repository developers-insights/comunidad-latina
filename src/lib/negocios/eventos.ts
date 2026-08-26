import "server-only";

import { supabaseSinTipar } from "@/lib/resenas";
import { EVENT_STARTS_ATTR } from "@/lib/eventos/detalles";

/**
 * =============================================================================
 * LOS EVENTOS DE UN NEGOCIO (migración 0117)
 * =============================================================================
 *
 * Hermana exacta de `fetchPuestosDelNegocio` (0107) y por el mismo motivo: la
 * 0117 amplió `listings.business_listing_id` a los eventos, así que ahora un
 * evento sabe de qué comercio sale. Sin ese vínculo, «página del organizador»
 * (spec §6) no tenía forma de existir para un negocio: `created_by` apunta a la
 * persona, y una persona puede tener dos fichas distintas.
 *
 * La consulta es la que el índice `listings_business_link_idx` (0107) ya cubre
 * —`tenant_id` + `business_listing_id` + `status='published'`— sin agregar uno
 * nuevo: ese índice nunca filtró por `kind`, así que sirve para los dos
 * verticales.
 *
 * ── ORDEN: POR CUÁNDO PASA, NO POR CUÁNDO SE PUBLICÓ ────────────────────────
 * Es la única diferencia de fondo con los puestos. Un puesto abierto hace tres
 * meses sigue siendo un puesto abierto; un evento de hace tres meses ya pasó.
 * Lo que alguien necesita ver en la ficha es LO QUE VIENE, así que se ordena por
 * `attrs->>starts_at` ascendente y se descartan los que ya ocurrieron.
 *
 * ── LOS QUE NO DECLARARON FECHA ─────────────────────────────────────────────
 * Entran igual, al final. La fecha vive en `attrs` (JSONB) y un aviso viejo
 * puede no tenerla; esconderlo sería hacer desaparecer un evento real por un
 * campo que su formulario todavía no pedía. Lo que NO se hace es inventarle una
 * fecha para poder ordenarlo.
 *
 * ⚠️ Nunca lanza: en un entorno sin la migración la consulta falla, se devuelve
 * vacío y la sección no se muestra. Mismo criterio que su hermana.
 */

export interface EventoDelNegocio {
  id: string;
  titulo: string;
  /** ISO de `attrs.starts_at`, o `null` si el aviso no la declaró. */
  empiezaEn: string | null;
  areaLabel: string | null;
  /** Primera foto ya resuelta, o `null`. */
  fotoPath: string | null;
}

export async function fetchEventosDelNegocio(
  client: unknown,
  args: { tenantId: string; businessListingId: string; limit?: number },
): Promise<EventoDelNegocio[]> {
  const supabase = supabaseSinTipar(client);
  const { data, error } = await supabase
    .from("listings")
    .select("id, title, area_label, photos, attrs")
    .eq("tenant_id", args.tenantId)
    .eq("kind", "event")
    .eq("business_listing_id", args.businessListingId)
    .eq("status", "published")
    // Se piden más de los que se van a mostrar porque el descarte de los que ya
    // pasaron ocurre en memoria: `attrs->>starts_at` es texto y compararlo
    // contra `now()` en SQL pediría un cast por fila que ningún índice cubre.
    // El tope de 20 acota el trabajo sin que se pierda nada real: una ficha con
    // más de veinte eventos vivos no existe hoy.
    .limit(20);

  if (error) {
    console.warn("[negocios] no se pudieron leer los eventos del negocio", {
      code: (error as { code?: string }).code,
    });
    return [];
  }

  const ahora = Date.now();
  const filas = ((data ?? []) as Array<{
    id: string;
    title: string;
    area_label: string | null;
    photos: string[] | null;
    attrs: unknown;
  }>).map((fila) => {
    const attrs =
      fila.attrs && typeof fila.attrs === "object" && !Array.isArray(fila.attrs)
        ? (fila.attrs as Record<string, unknown>)
        : {};
    const crudo = attrs[EVENT_STARTS_ATTR];
    const empiezaEn = typeof crudo === "string" && crudo.length > 0 ? crudo : null;
    return {
      id: fila.id,
      titulo: fila.title,
      empiezaEn,
      areaLabel: fila.area_label,
      fotoPath: (fila.photos ?? []).find((path) => path && path.trim().length > 0) ?? null,
    };
  });

  return filas
    .filter((evento) => {
      if (!evento.empiezaEn) return true; // sin fecha declarada: no se descarta
      const inicio = Date.parse(evento.empiezaEn);
      return !Number.isFinite(inicio) || inicio >= ahora;
    })
    .sort((a, b) => {
      // Los que tienen fecha van primero y en orden; los que no, al final y por
      // título, que es arbitrario pero ESTABLE.
      if (a.empiezaEn && b.empiezaEn) return a.empiezaEn.localeCompare(b.empiezaEn);
      if (a.empiezaEn) return -1;
      if (b.empiezaEn) return 1;
      return a.titulo.localeCompare(b.titulo, "es");
    })
    .slice(0, args.limit ?? 5);
}
