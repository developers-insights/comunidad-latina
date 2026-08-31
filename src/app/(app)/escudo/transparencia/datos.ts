import "server-only";

import { unstable_cache } from "next/cache";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { leerCasos, type CasoDeSeguridad } from "@/lib/escudo/casos";
import { parseMetricas, type MetricasEscudo } from "@/lib/escudo/transparencia";

/**
 * =============================================================================
 * DE DÓNDE SALEN LOS NÚMEROS DE /escudo/transparencia
 * =============================================================================
 *
 * Dos lecturas por comunidad, cacheadas juntas 15 minutos:
 *
 *   · `public.escudo_transparencia(tenant)` (0122) — un jsonb con todos los
 *     contadores, agregados sobre scam_reports, audit_log, verification_checks
 *     y moderation_queue.
 *   · `public.security_cases` — los casos publicados de esta comunidad más los
 *     globales.
 *
 * ── POR QUÉ UN CLIENTE SIN COOKIES ──────────────────────────────────────────
 * `unstable_cache` no admite `cookies()` ni `headers()` adentro de su scope
 * (unstable_cache.md), y acá no hacen falta: la RPC es `security definer` —no
 * mira quién llama— y `security_cases_select` deja leer lo publicado a `anon`.
 * Lo que se cachea, entonces, no depende de ninguna sesión: es el mismo dato
 * para todo el mundo. Mismo molde que `fetchTenantRow` en `lib/tenant/resolve`.
 *
 * ── POR QUÉ 15 MINUTOS Y NO POR REQUEST ─────────────────────────────────────
 * La RPC hace cuatro agregaciones. Son baratas —todas apoyan en índices por
 * `tenant_id`, y la 0122 agrega los dos parciales que faltaban— pero son cuatro
 * y esta pantalla no cambia de un minuto al otro: una denuncia más no mueve
 * ninguna cifra visible. 15 minutos es lo que hace que el costo NO crezca con
 * las visitas, que es la única forma de que una pantalla pública sea sostenible.
 * La cache key incluye el tenant: jamás se sirven los números de una comunidad
 * en otra.
 *
 * ── EL ERROR NO SE CACHEA ───────────────────────────────────────────────────
 * Ante cualquier falla la función CACHEADA lanza, así que el fallo no queda
 * pegado quince minutos: el próximo request reintenta. Quien llama recibe
 * `metricas: null` y la pantalla lo dice con todas las letras en vez de mostrar
 * ceros, que en esta pantalla serían una mentira tranquilizadora.
 */

/** La función SQL todavía no existe en esta base (migración sin aplicar). */
const RPC_NO_EXISTE = "PGRST202";
/** La tabla todavía no existe / no está en el schema cache de PostgREST. */
const TABLA_NO_EXISTE = new Set(["PGRST205", "42P01"]);

const VIGENCIA_SEGUNDOS = 900;
export const TAG_TRANSPARENCIA = "escudo-transparencia";

export interface DatosDeTransparencia {
  /** `null` = no se pudieron leer. NUNCA ceros de relleno. */
  metricas: MetricasEscudo | null;
  casos: CasoDeSeguridad[];
}

const VACIO: DatosDeTransparencia = { metricas: null, casos: [] };

/**
 * El cliente tipado no conoce lo que todavía no está en `database.types.ts`. Se
 * abre SÓLO para el `.rpc()` y para la tabla nueva, igual que `feed-rpc.ts`.
 */
function abierto(supabase: SupabaseClient<Database>): SupabaseClient {
  return supabase as unknown as SupabaseClient;
}

function clienteAnonimo(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createServerClient<Database>(url, anonKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}

async function traerMetricas(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<MetricasEscudo | null> {
  const { data, error } = await abierto(supabase).rpc("escudo_transparencia", {
    p_tenant: tenantId,
  });
  if (error) {
    if (error.code === RPC_NO_EXISTE) {
      // Entorno sin la 0122 aplicada: es esperable, no es un incidente.
      console.info("[escudo] transparencia: la RPC todavía no existe en esta base");
      return null;
    }
    console.warn("[escudo] transparencia: falló la RPC de métricas", { code: error.code });
    return null;
  }
  const metricas = parseMetricas(data);
  if (metricas === null) {
    // La RPC contestó pero con una forma que no es la esperada. Se avisa fuerte:
    // significa que el contrato SQL ↔ TypeScript se rompió, y el modo de falla
    // sería mostrar una pantalla vacía sin ninguna pista de por qué.
    console.warn("[escudo] transparencia: la RPC devolvió una forma inesperada");
  }
  return metricas;
}

async function traerCasos(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<CasoDeSeguridad[]> {
  const { data, error } = await abierto(supabase)
    .from("security_cases")
    .select("id, slug, vertical, origin, occurred_month, title, summary, signal, response, advice")
    .eq("status", "published")
    // Los de esta comunidad MÁS los globales (`tenant_id is null`), igual que
    // `guides` y `community_resources`.
    .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
    .order("occurred_month", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    if (TABLA_NO_EXISTE.has(error.code ?? "")) {
      console.info("[escudo] transparencia: la tabla de casos todavía no existe en esta base");
      return [];
    }
    console.warn("[escudo] transparencia: falló la lectura de casos", { code: error.code });
    return [];
  }

  const { publicables, descartados } = leerCasos(data);
  if (descartados > 0) {
    // Se descarta en silencio para quien LEE (una tarjeta menos, no un error) y
    // se grita para quien lo CARGÓ: un caso con una arroba o un teléfono adentro
    // es contenido que hay que corregir, no un bug de la pantalla.
    console.warn(
      `[escudo] transparencia: ${descartados} caso(s) sin publicar por forma inválida o riesgo de reidentificación`,
    );
  }
  return publicables;
}

const leerCacheado = unstable_cache(
  async (tenantId: string): Promise<DatosDeTransparencia> => {
    const supabase = clienteAnonimo();
    if (!supabase) throw new Error("supabase-not-configured");
    const [metricas, casos] = await Promise.all([
      traerMetricas(supabase, tenantId),
      traerCasos(supabase, tenantId),
    ]);
    return { metricas, casos };
  },
  ["escudo-transparencia"],
  { revalidate: VIGENCIA_SEGUNDOS, tags: [TAG_TRANSPARENCIA] },
);

/**
 * Los datos de la pantalla. NUNCA lanza: ante cualquier falla devuelve el estado
 * vacío y la pantalla explica qué pasó — degradación elegante (§5.6).
 *
 * ⚠️ RECIBE EL TENANT ENTERO Y NO SU id, y no es un detalle de firma.
 * `getTenant()` degrada a un tenant de relleno cuando la DB no contesta o el
 * slug no existe (`isFallback`), y ese relleno trae un id PLACEHOLDER que es un
 * UUID perfectamente válido: `00000000-0000-4000-8000-000000000001`. Consultarlo
 * no da error — da CERO de todo. O sea: exactamente la mentira que esta pantalla
 * existe para no decir, y encima presentada como un dato duro. Con el tenant
 * completo la regla se aplica acá y no depende de que cada llamador se acuerde.
 */
export async function getDatosDeTransparencia(tenant: {
  id: string;
  isFallback: boolean;
}): Promise<DatosDeTransparencia> {
  if (tenant.isFallback) return VACIO;
  try {
    return await leerCacheado(tenant.id);
  } catch {
    return VACIO;
  }
}
