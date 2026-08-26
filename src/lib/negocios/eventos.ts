import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { eventDateParts, parseEventAttrs } from "@/components/directory";

/**
 * =============================================================================
 * LOS PRÓXIMOS EVENTOS DE UN NEGOCIO
 * =============================================================================
 *
 * Pedido del cliente: la ficha de un negocio tiene que mostrar sus próximos
 * eventos, igual que ya muestra sus puestos abiertos (`empleos.ts`, 0107).
 *
 * ── POR QUÉ ESTO NO ES UN COPY-PASTE DE `empleos.ts` ────────────────────────
 * Los puestos tienen una FK real: `listings.business_listing_id` (0107) vincula
 * el aviso de empleo a la ficha del negocio, con su propio índice. Los eventos
 * NO tienen ese vínculo, y no es un descuido — es una restricción de la base
 * que este frente no puede tocar (las migraciones son de otro frente, y
 * escribir a esa columna desde un evento no serviría de nada igual):
 * `app.check_business_listing_link()` (0107_campos_de_publicacion.sql) RECHAZA
 * el vínculo si `kind <> 'job'` — "por ahora el vínculo es exclusivo de los
 * empleos", dice el comentario de esa función, verificado en la migración.
 *
 * Sin FK, la señal que SÍ existe es `created_by`: los eventos publicados por la
 * MISMA persona que publicó la ficha del negocio. No es una regla inventada acá
 * — es el mismo criterio que ya usa cada detalle de aviso del repo para "esto
 * es tuyo" (`isOwner = listing.created_by === user.id`, repetido en
 * propiedades/profesionales/eventos/empleos/marketplace/negocios). Aplicarlo
 * acá es consistente, no una excepción.
 *
 * LÍMITE CONOCIDO Y DOCUMENTADO: si el negocio lo administran varias personas
 * (0031, multi-admin), un evento publicado por un admin que no sea el
 * `created_by` de la FICHA del negocio no va a aparecer acá. Resolverlo bien
 * pide la MISMA FK que ya tienen los empleos — eso es una migración, y una
 * migración está fuera del alcance de este frente (PROHIBIDO tocar
 * supabase/migrations/**). Se deja escrito en vez de fingir que el vínculo es
 * perfecto.
 */

export interface EventoDelNegocio {
  id: string;
  titulo: string;
  /** ISO de `attrs.starts_at`, tal cual — por si quien renderiza lo necesita crudo. */
  startsAt: string;
  /** "15 AGO", ya en la zona de quien mira (`eventDateParts`). */
  fechaCorta: string;
  /** "16:00", o `null` si el aviso no declaró hora (fecha sin horario). */
  horaLabel: string | null;
  areaLabel: string | null;
  gratis: boolean;
}

/**
 * "Vigente" para esta sección: hoy o más adelante, EN LA ZONA DE QUIEN MIRA.
 *
 * No se compara contra el instante exacto (`now.getTime()`): un evento que
 * empezó esta mañana y sigue en curso —la ficha no sabe cuánto dura si el
 * aviso no declaró `ends_at`— desaparecería a media tarde si se comparara así.
 * Se compara el DÍA CALENDARIO: mientras `starts_at` caiga hoy o después (en la
 * zona de quien mira, no en UTC ni en la del servidor), el evento se sigue
 * mostrando. Es la "tolerancia razonable" de la spec, sin inventar una
 * duración por defecto que ningún aviso declaró.
 *
 * Misma regla de fondo que `memberSinceLabel` (perfil/profile-tabs.ts): una
 * fecha se decide en la zona de quien LEE, no en la de quien escribió ni en la
 * del servidor — si no, un evento de "hoy" en Los Ángeles puede leerse "de
 * ayer" para el servidor en UTC y desaparecer antes de tiempo.
 */
export function eventoSigueVigente(startsAtIso: string, now: Date, timeZone: string): boolean {
  const startsAt = new Date(startsAtIso);
  if (Number.isNaN(startsAt.getTime())) return false;
  return localDateKey(startsAt, timeZone) >= localDateKey(now, timeZone);
}

/**
 * "2026-08-26" — el día calendario de `date` EN `timeZone`, como texto.
 * `en-CA` es el truco: es el único locale de `Intl` cuyo formato corto es
 * exactamente `YYYY-MM-DD`, que ordena bien como STRING (no hace falta
 * reconstruir un `Date` en esa zona para comparar).
 */
function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Candidatos que se piden ANTES de filtrar por fecha en JS. Generoso a
 * propósito: esta consulta ya está acotada a UN publicador (`created_by`, con
 * el índice `listings_tenant_owner_idx` de la 0004 detrás), no a todo el
 * tenant como el feed — un negocio real no acumula cientos de eventos
 * publicados, así que 100 candidatos cubren el caso real sin necesitar un
 * filtro de fecha en SQL (que sobre `attrs->>starts_at`, un JSONB sin índice
 * propio, sería un scan de todas formas).
 */
const CANDIDATOS_TOPE = 100;

/** Cuántos eventos entran en la sección, por default (mismo tope que empleos.ts). */
const EVENTOS_DEFAULT_LIMIT = 5;

interface EventoCandidato {
  id: string;
  title: string;
  areaLabel: string | null;
  startsAt: string;
  free: boolean;
}

export async function fetchEventosDelNegocio(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string;
    /** `listings.created_by` de la FICHA DEL NEGOCIO (no de un evento). */
    createdBy: string | null;
    locale: string;
    timeZone: string;
    limit?: number;
  },
): Promise<EventoDelNegocio[]> {
  const { tenantId, createdBy, locale, timeZone, limit = EVENTOS_DEFAULT_LIMIT } = args;

  // Ficha de negocio sin cuenta detrás (seed/API): no hay `created_by` con
  // quien cruzar eventos, y no hay nada más de dónde sacar el vínculo.
  if (!createdBy) return [];

  const { data, error } = await supabase
    .from("listings")
    .select("id, title, area_label, attrs")
    .eq("tenant_id", tenantId)
    .eq("kind", "event")
    .eq("created_by", createdBy)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(CANDIDATOS_TOPE);

  if (error) {
    // Tolerante, igual que fetchPuestosDelNegocio: la sección simplemente no
    // se dibuja en vez de tirar abajo la ficha entera del negocio.
    console.warn("[negocios] no se pudieron leer los eventos del negocio", {
      code: error.code,
    });
    return [];
  }

  const candidatos: EventoCandidato[] = (data ?? [])
    .map((row) => {
      const details = parseEventAttrs(row.attrs);
      return details.startsAt
        ? {
            id: row.id,
            title: row.title,
            areaLabel: row.area_label,
            startsAt: details.startsAt,
            free: details.free,
          }
        : null;
    })
    // Eventos viejos (anteriores a esta feature) sin `starts_at`: no hay fecha
    // con la que decidir "vigente", así que no entran — no es un error, es un
    // dato que ese aviso nunca declaró.
    .filter((c): c is EventoCandidato => c !== null);

  const now = new Date();

  return candidatos
    .filter((c) => eventoSigueVigente(c.startsAt, now, timeZone))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .slice(0, limit)
    .map((c) => {
      const parts = eventDateParts(c.startsAt, locale, timeZone);
      return {
        id: c.id,
        titulo: c.title,
        startsAt: c.startsAt,
        fechaCorta: parts ? `${parts.day} ${parts.month}` : "",
        horaLabel: parts?.time || null,
        areaLabel: c.areaLabel,
        gratis: c.free,
      };
    });
}
