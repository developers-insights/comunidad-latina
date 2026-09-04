import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  REGISTRATION_COLUMNS,
  REGISTRATION_DICCIONARIOS,
  REGISTRATION_KINDS,
  REGISTRATION_STATUSES,
  isRegistrationStatus,
  supabaseSinTiparComunidad,
  toRegistrationView,
  type RegistrationKind,
  type RegistrationRow,
  type RegistrationStatus,
  type RegistrationView,
} from "@/lib/comunidad";

/**
 * =============================================================================
 * LA COLA DE LOS REGISTROS PRIVADOS (0131)
 * =============================================================================
 *
 * Cuatro pestañas —una por formulario— y dentro de cada una, filtro por estado.
 * Lo más NUEVO primero: acá no hay nada publicado esperando que alguien lo baje,
 * hay gente esperando que la llamen, y el que acaba de dejar sus datos es el que
 * todavía se acuerda de que los dejó.
 *
 * ── SIN PRIVILEGIOS Y SIN N+1 ───────────────────────────────────────────────
 * Todo con el cliente del propio staff: la RLS gobierna (ARQUITECTURA §6 — el
 * admin client no se usa para LEER en un request de usuario). La policy de
 * SELECT de la 0131 sólo deja entrar a `domain_admin`/`global_admin`, así que el
 * `eq("tenant_id")` de acá es para no traer de más, no para proteger.
 *
 * Y por lote: una consulta para las filas y una para los nombres —de quien se
 * registró y de quien del equipo lo resolvió—.
 *
 * ── ESTA PANTALLA SÍ VE DATOS PERSONALES ────────────────────────────────────
 * Al revés que la cola de "Pedir ayuda", que a propósito no puede ver más que el
 * nombre público de quien escribió. Acá el teléfono ES el contenido: sin él no
 * se puede hacer lo único que la sección promete, que es llamar. Por eso el
 * panel entero pide `domain_admin` y no `moderator` — mismo criterio que
 * /admin/empleos con los currículums.
 */

/** Tope de filas por consulta. Misma escala que el resto de las colas. */
export const QUEUE_LIMIT = 50;

export const KIND_TABS = [
  { id: "volunteer", label: "Voluntarios" },
  { id: "volunteer_request", label: "Piden voluntarios" },
  { id: "place", label: "Lugares" },
  { id: "space", label: "Espacios" },
] as const satisfies readonly { id: RegistrationKind; label: string }[];

export const DEFAULT_KIND: RegistrationKind = "volunteer";

export const STATUS_FILTERS = [
  { id: "abiertos", label: "Sin resolver" },
  { id: "new", label: "Sin mirar" },
  { id: "contacted", label: "Contactados" },
  { id: "approved", label: "Aprobados" },
  { id: "discarded", label: "Descartados" },
] as const;

export type StatusFilterId = (typeof STATUS_FILTERS)[number]["id"];
export const DEFAULT_STATUS: StatusFilterId = "abiertos";

function primerValor(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function resolveKind(value: string | string[] | undefined): RegistrationKind {
  const raw = primerValor(value);
  return (REGISTRATION_KINDS as readonly string[]).includes(raw)
    ? (raw as RegistrationKind)
    : DEFAULT_KIND;
}

export function resolveStatusFilter(value: string | string[] | undefined): StatusFilterId {
  const raw = primerValor(value);
  const match = STATUS_FILTERS.find((item) => item.id === raw);
  return match ? match.id : DEFAULT_STATUS;
}

export interface RegistrosQueue {
  items: RegistrationView[];
  /** Cuántos hay de cada formulario SIN resolver — el número de cada pestaña. */
  pendientesPorKind: Record<RegistrationKind, number>;
  truncated: boolean;
  /** true cuando la consulta falló: la pantalla distingue "no hay" de "no pudimos". */
  failed: boolean;
}

async function nombresPorPerfil(
  supabase: SupabaseClient,
  ids: readonly string[],
): Promise<Map<string, string | null>> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map();
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", unicos);
  return new Map(
    ((data ?? []) as { id: string; display_name: string | null }[]).map((row) => [
      row.id,
      row.display_name,
    ]),
  );
}

/**
 * Los contadores de las cuatro pestañas, en UNA lectura.
 *
 * Trae sólo `kind` de lo que está sin resolver: son cuatro números y pedirlos
 * con cuatro `head: true` serían cuatro round-trips. El tope de 500 es de
 * sanidad — si una comunidad tiene más de quinientos registros sin resolver, el
 * problema no es el contador.
 */
async function contarPendientes(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<Record<RegistrationKind, number>> {
  const vacio: Record<RegistrationKind, number> = {
    volunteer: 0,
    volunteer_request: 0,
    place: 0,
    space: 0,
  };

  const { data, error } = await supabaseSinTiparComunidad(supabase)
    .from("community_registrations")
    .select("kind")
    .eq("tenant_id", tenantId)
    .in("status", ["new", "contacted"])
    .limit(500);

  if (error) return vacio;

  for (const fila of (data ?? []) as { kind: string }[]) {
    if (fila.kind in vacio) vacio[fila.kind as RegistrationKind] += 1;
  }
  return vacio;
}

export async function fetchRegistrosQueue(
  supabase: SupabaseClient,
  tenantId: string,
  kind: RegistrationKind,
  filtro: StatusFilterId,
): Promise<RegistrosQueue> {
  const sinTipar = supabaseSinTiparComunidad(supabase);
  const pendientesPorKind = await contarPendientes(supabase, tenantId);

  let query = sinTipar
    .from("community_registrations")
    .select(REGISTRATION_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(QUEUE_LIMIT + 1);

  if (filtro === "abiertos") {
    query = query.in("status", ["new", "contacted"]);
  } else if (isRegistrationStatus(filtro)) {
    query = query.eq("status", filtro);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[admin/registros] query falló", { code: error.code, kind });
    return { items: [], pendientesPorKind, truncated: false, failed: true };
  }

  const filas = (data ?? []) as unknown as RegistrationRow[];
  const pagina = filas.slice(0, QUEUE_LIMIT);

  const nombres = await nombresPorPerfil(supabase, [
    ...pagina.map((fila) => fila.created_by),
    ...pagina.flatMap((fila) => (fila.reviewed_by ? [fila.reviewed_by] : [])),
  ]);

  const ahora = new Date();
  const items = pagina.flatMap((fila) => {
    const vista = toRegistrationView(fila, {
      nombrePorPerfil: nombres,
      dic: REGISTRATION_DICCIONARIOS,
      now: ahora,
    });
    return vista ? [vista] : [];
  });

  return {
    items,
    pendientesPorKind,
    truncated: filas.length > QUEUE_LIMIT,
    failed: false,
  };
}

/** Todos los estados posibles, para armar los botones de decisión de la ficha. */
export const ESTADOS: readonly RegistrationStatus[] = REGISTRATION_STATUSES;
