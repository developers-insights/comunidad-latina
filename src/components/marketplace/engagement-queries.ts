import type { createClient } from "@/lib/supabase/server";

/**
 * Lecturas de engagement de un LISTING (migración 0038).
 *
 * Server-only por uso: recibe el cliente ya creado, con las cookies del
 * visitante y RLS aplicada. NO se exporta desde `./index` a propósito — ese
 * barrel lo importan client components.
 */

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * ¿El visitante ya guardó este aviso? (`saves` — RLS: sólo filas propias.)
 *
 * Devuelve `false` sin sesión y ante CUALQUIER error: el estado inicial de un
 * botón de guardar no justifica romperle la pantalla a nadie (y si la 0038 no
 * corrió todavía en un entorno, el detalle sigue de pie).
 */
export async function fetchListingSaved(
  supabase: ServerClient,
  tenantId: string,
  listingId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await supabase
      .from("saves")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("subject_kind", "listing")
      .eq("subject_id", listingId)
      .eq("profile_id", userId)
      .maybeSingle();
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

/**
 * Lo mismo que `fetchListingSaved` pero para UNA PÁGINA ENTERA de avisos, en
 * una sola consulta.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 * Las ocho grillas por módulo (product, job, service, professional, event,
 * business, listing, gig) dibujan `ListingActions`, que acepta un `engagement`
 * OPCIONAL. Hoy ninguna se lo pasa, así que la barra sale sin números — y el
 * camino obvio para llenarla es llamar a `fetchListingSaved` dentro del `.map()`
 * de las tarjetas. Eso son N consultas por grilla: con 12 tarjetas y ~200 ms de
 * ida y vuelta a Supabase medidos desde fuera de la región, son 12 viajes que
 * ninguna de las dos puntas ve como un problema — cada query tarda menos de un
 * milisegundo en Postgres. El costo no está en la base, está en el viaje.
 *
 * Esta función hace UN viaje para toda la página. Devuelve un Set en vez de un
 * array para que el `.map()` de las tarjetas resuelva cada id en O(1).
 *
 * `commentCount` NO se pide acá a propósito: `listings.comment_count` es una
 * columna denormalizada (0038) que ya viaja en la fila del listado. Sumarla al
 * `.select()` de la grilla cuesta CERO viajes; pedirla por separado costaría uno
 * más. Quien cablee la barra debería agregarla al select, no llamar a nada.
 *
 * ── TENANT ──────────────────────────────────────────────────────────────────
 * `tenantId` lo deriva el server (`getTenant()`), nunca llega por parámetro del
 * cliente. El filtro por tenant va ADEMÁS de la RLS, no en su lugar.
 *
 * Ante cualquier error devuelve un Set vacío, igual que su hermana de a una:
 * que el estado inicial de un botón falle no puede vaciar una grilla.
 */
export async function fetchListingSavedBatch(
  supabase: ServerClient,
  tenantId: string,
  listingIds: readonly string[],
  userId: string | null | undefined,
): Promise<Set<string>> {
  if (!userId || listingIds.length === 0) return new Set();
  try {
    const { data, error } = await supabase
      .from("saves")
      .select("subject_id")
      .eq("tenant_id", tenantId)
      .eq("subject_kind", "listing")
      .eq("profile_id", userId)
      .in("subject_id", listingIds);
    if (error) return new Set();
    return new Set((data ?? []).map((row) => row.subject_id));
  } catch {
    return new Set();
  }
}
