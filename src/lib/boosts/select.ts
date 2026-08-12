import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { listingViewHref } from "@/lib/monetization/href";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/types/database.types";
import {
  boostIsOfferedOutside,
  boostReachesViewer,
  readBoostScopeTarget,
  type ViewerGeo,
} from "./scope";

/**
 * =============================================================================
 * QUÉ IMPULSOS SE SIRVEN EN ESTA PANTALLA, A ESTA PERSONA
 * =============================================================================
 *
 * Antes de este módulo, los cuatro listados que muestran avisos impulsados
 * (/propiedades, /negocios, /profesionales y /empleos) tenían el MISMO bloque
 * copiado cuatro veces: traer los boosts activos del tenant, ponerlos primero.
 * Cuatro copias es cuatro lugares donde arreglar un bug y tres donde olvidarse
 * — y el alcance geográfico iba a ser exactamente esa clase de bug.
 *
 * Acá vive una vez. Las dos preguntas son distintas y por eso son dos funciones:
 *
 *   `selectOwnBoosts`           ¿qué avisos DE ESTA COMUNIDAD se ponen primero,
 *                               para ESTE espectador? (el alcance decide)
 *   `selectCrossCommunityBoosts` ¿qué avisos DE OTRAS COMUNIDADES compraron el
 *                               derecho a mostrarse acá? (nacional y global)
 *
 * POR QUÉ LO DE AFUERA NO SE MEZCLA CON LO DE ADENTRO
 * ---------------------------------------------------
 * Un aviso de otra comunidad metido entre los resultados de ésta sería un link
 * roto: las páginas de detalle exigen `listing.tenant_id = tenant.id` y
 * devuelven 404 a cualquier otra cosa. Por eso lo de afuera se muestra en una
 * tira aparte, rotulada, con el nombre de la comunidad de origen y un enlace al
 * sitio de ESA comunidad. Además de funcionar, es más honesto: quien mira sabe
 * de dónde viene lo que está viendo.
 *
 * EL `tenant_id` SIEMPRE LO PONE EL SERVIDOR. Ninguna de estas funciones acepta
 * una comunidad por parámetro del cliente: el caller es un Server Component que
 * lo resolvió con `getTenant()` desde el Host.
 * =============================================================================
 */

type Supabase = SupabaseClient<Database>;

/** Cuántos lugares pagos entran en una pantalla. Es el techo de la 0016. */
export const BOOST_SLOTS = 4;

/**
 * Se piden más impulsos de los que se van a mostrar porque el alcance filtra
 * DESPUÉS, en memoria: un `local` de otra zona no le aplica a este espectador y
 * su lugar tiene que poder ocuparlo el siguiente. Sin este colchón, cuatro
 * impulsos locales de barrios ajenos dejaban la pantalla sin ningún patrocinio
 * aunque hubiera diez más esperando.
 *
 * ¿Por qué no filtrar en SQL? Porque la comparación de zonas es LAXA por token
 * ("Corona" alcanza a quien declaró "Corona, Queens") y la de países es
 * normalizada sin tildes. Meter eso en un `.or()` de PostgREST sería reescribir
 * `normalizeGeoLabel` en SQL y mantener las dos versiones sincronizadas para
 * siempre. El colchón cuesta unas filas; la duplicación costaría un bug.
 */
const OVERFETCH = 5;

// ---------------------------------------------------------------------------
// 0 · Dónde está parado quien mira
// ---------------------------------------------------------------------------

/**
 * La geografía del espectador, armada SÓLO con lo que ya declaró.
 *
 * La zona del FILTRO pesa más que la del perfil, y no es un detalle: si alguien
 * está mirando /propiedades?zona=Corona está mirando Corona, aunque en su
 * perfil diga Washington Heights. Ignorar eso haría que el impulso local no le
 * aplique a la persona que MÁS cerca está de querer ese aviso.
 *
 * Sin sesión y sin filtro, la zona es `null` y los impulsos locales no aplican.
 * Es la respuesta correcta: no sabemos dónde está, y adivinar sería convertir
 * el alcance más barato en el más grande.
 */
export async function resolveViewerGeo(
  supabase: Supabase,
  input: {
    /** Comunidad que muestra, resuelta por el servidor desde el Host. */
    tenantId: string;
    /** Zona del perfil, si la página ya la leyó (evita una consulta de más). */
    profileArea?: string | null;
    /** Si la página NO la leyó, se lee acá con este id. */
    userId?: string | null;
    /** Zona por la que está filtrando ahora mismo, si la hay. */
    zoneFilter?: string | null;
  },
): Promise<ViewerGeo> {
  let areaLabel = input.zoneFilter?.trim() || input.profileArea?.trim() || null;

  if (!areaLabel && input.userId && input.profileArea === undefined) {
    const { data } = await supabase
      .from("profiles")
      .select("area_label")
      .eq("id", input.userId)
      .maybeSingle();
    areaLabel = data?.area_label?.trim() || null;
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("country_focus")
    .eq("id", input.tenantId)
    .maybeSingle();

  return { areaLabel, country: tenant?.country_focus?.trim() || null };
}

// ---------------------------------------------------------------------------
// 1 · Los impulsos de la propia comunidad
// ---------------------------------------------------------------------------

export interface OwnBoostPlacement {
  /** Avisos que van primero, con lugar pago aplicado para este espectador. */
  listingIds: Set<string>;
  /** Impulsos efectivamente servidos — lo que se cuenta como impresión. */
  boostIds: string[];
}

const SIN_IMPULSOS: OwnBoostPlacement = { listingIds: new Set(), boostIds: [] };

/**
 * Los avisos de ESTA comunidad que se ponen primero para ESTE espectador.
 *
 * El alcance decide: un impulso `local` sólo ocupa lugar si el espectador está
 * en la zona objetivo; `nacional` y `global` le aplican a toda la comunidad.
 * Devuelve un `Set` porque el caller pregunta "¿este aviso está impulsado?" una
 * vez por tarjeta, y un `includes` sobre un array haría eso cuadrático.
 *
 * NUNCA lanza: si la consulta falla se registra el código y se devuelve vacío.
 * Un listado sin patrocinios es un listado; un listado que revienta no lo es.
 */
export async function selectOwnBoosts(
  supabase: Supabase,
  input: { tenantId: string; viewer: ViewerGeo; slots?: number },
): Promise<OwnBoostPlacement> {
  const slots = input.slots ?? BOOST_SLOTS;

  const { data, error } = await supabase
    .from("boosts")
    .select("id, listing_id, scope, scope_area, scope_country")
    .eq("tenant_id", input.tenantId)
    .eq("status", "active")
    .gt("ends_at", new Date().toISOString())
    .order("ends_at", { ascending: false })
    .limit(slots * OVERFETCH);

  if (error) {
    console.warn("[boosts] no se pudieron leer los impulsos de la comunidad", {
      code: error.code,
    });
    return SIN_IMPULSOS;
  }

  const listingIds = new Set<string>();
  const boostIds: string[] = [];
  for (const row of data ?? []) {
    if (listingIds.size >= slots) break;
    if (!boostReachesViewer(readBoostScopeTarget(row), input.viewer)) continue;
    // Dos impulsos vigentes del mismo aviso ocupan UN lugar, no dos: el aviso
    // ya está arriba. Se cuentan los dos como impresión igual, porque los dos
    // se sirvieron.
    if (!listingIds.has(row.listing_id)) listingIds.add(row.listing_id);
    boostIds.push(row.id);
  }

  return { listingIds, boostIds };
}

// ---------------------------------------------------------------------------
// 2 · Los impulsos que llegan de otras comunidades
// ---------------------------------------------------------------------------

export interface CrossCommunityBoost {
  boostId: string;
  listingId: string;
  title: string;
  areaLabel: string | null;
  /** Primera foto utilizable del aviso, o `null`. */
  photoPath: string | null;
  /** Nombre de la comunidad de origen — se muestra, no se esconde. */
  communityName: string;
  /**
   * URL ABSOLUTA al aviso en el sitio de su propia comunidad.
   *
   * `null` cuando esa comunidad no tiene ningún dominio activo cargado: en ese
   * caso el aviso NO se muestra. Un patrocinio que no lleva a ningún lado no es
   * un patrocinio, es una foto que frustra a quien la toca.
   */
  href: string | null;
}

/**
 * Los avisos de OTRAS comunidades que compraron alcance suficiente para
 * mostrarse acá.
 *
 * `nacional` entra si el país de la comunidad que muestra coincide con el país
 * objetivo; `global` entra siempre. `local` nunca sale de su casa.
 *
 * Las tres lecturas (impulsos, avisos, comunidades) van con el cliente del
 * usuario, no con el admin: la RLS ya deja leer los boosts ACTIVOS y los avisos
 * PUBLICADOS de cualquier comunidad —son públicos por transparencia FTC y por
 * ser contenido publicado—, así que no hay ninguna razón para saltearla.
 */
export async function selectCrossCommunityBoosts(
  supabase: Supabase,
  input: {
    /** Comunidad que MUESTRA, resuelta por el servidor desde el Host. */
    tenantId: string;
    /** `tenants.country_focus` de esa comunidad. */
    tenantCountry: string | null;
    /** Vertical de la pantalla (`property`, `business`, `professional`, `job`…). */
    kind: string;
    slots?: number;
  },
): Promise<CrossCommunityBoost[]> {
  const slots = input.slots ?? 2;

  const { data: boosts, error } = await supabase
    .from("boosts")
    .select("id, listing_id, tenant_id, scope, scope_area, scope_country")
    .neq("tenant_id", input.tenantId)
    .in("scope", ["nacional", "global"])
    .eq("status", "active")
    .gt("ends_at", new Date().toISOString())
    .order("ends_at", { ascending: false })
    .limit(slots * OVERFETCH);

  if (error) {
    console.warn("[boosts] no se pudieron leer los impulsos de otras comunidades", {
      code: error.code,
    });
    return [];
  }

  const elegibles = (boosts ?? []).filter((row) =>
    boostIsOfferedOutside(readBoostScopeTarget(row), input.tenantCountry),
  );
  if (elegibles.length === 0) return [];

  const { data: listings, error: listingsError } = await supabase
    .from("listings")
    .select("id, tenant_id, kind, title, area_label, photos")
    .in(
      "id",
      elegibles.map((row) => row.listing_id),
    )
    .eq("kind", input.kind)
    .eq("status", "published");

  if (listingsError) {
    console.warn("[boosts] no se pudieron leer los avisos impulsados de otras comunidades", {
      code: listingsError.code,
    });
    return [];
  }
  const porListing = new Map((listings ?? []).map((row) => [row.id, row]));
  if (porListing.size === 0) return [];

  // Comunidades de origen. `tenants_select` ya deja fuera las pausadas, y acá
  // se pide `active` explícito igual: una comunidad dada de baja no puede
  // seguir haciendo publicidad en las demás.
  const tenantIds = [
    ...new Set(
      elegibles
        .filter((row) => porListing.has(row.listing_id))
        .map((row) => row.tenant_id),
    ),
  ];
  const [{ data: tenants }, { data: domains }] = await Promise.all([
    supabase.from("tenants").select("id, name").in("id", tenantIds).eq("status", "active"),
    supabase
      .from("tenant_domains")
      .select("tenant_id, domain, is_primary")
      .in("tenant_id", tenantIds)
      .eq("status", "active")
      .order("is_primary", { ascending: false }),
  ]);

  const nombrePorTenant = new Map((tenants ?? []).map((row) => [row.id, row.name]));
  const dominioPorTenant = new Map<string, string>();
  for (const row of domains ?? []) {
    // El `order` de arriba pone los primarios primero; el primero que llega de
    // cada comunidad gana y los alias no lo pisan.
    if (!dominioPorTenant.has(row.tenant_id)) dominioPorTenant.set(row.tenant_id, row.domain);
  }

  const items: CrossCommunityBoost[] = [];
  const vistos = new Set<string>();
  for (const row of elegibles) {
    if (items.length >= slots) break;
    const listing = porListing.get(row.listing_id);
    if (!listing) continue;
    if (vistos.has(listing.id)) continue;

    const communityName = nombrePorTenant.get(row.tenant_id);
    const domain = dominioPorTenant.get(row.tenant_id);
    // Sin comunidad activa o sin dominio no se muestra: preferimos un espacio
    // vacío antes que una tarjeta que no lleva a ningún lado.
    if (!communityName || !domain) continue;

    vistos.add(listing.id);
    items.push({
      boostId: row.id,
      listingId: listing.id,
      title: listing.title,
      areaLabel: listing.area_label,
      photoPath: (listing.photos ?? []).find((p) => p && p.trim().length > 0) ?? null,
      communityName,
      href: `https://${domain}${listingViewHref(listing.kind, listing.id)}`,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// 3 · Las impresiones
// ---------------------------------------------------------------------------

/**
 * Suma una impresión del día a cada impulso que se acaba de servir.
 *
 * Va con el cliente ADMIN y no con el del usuario, y es la excepción bien
 * fundada a la regla de §6: `boost_impressions` tiene las tres policies de
 * escritura en false y la función está revocada de anon/authenticated, o sea
 * que NO existe un camino por el que un cliente pueda sumar impresiones. Si lo
 * hubiera, el primero que lo descubriera inflaría las propias y el número
 * dejaría de servir para decidir un gasto — que es lo único para lo que existe.
 *
 * BEST-EFFORT y ruidoso: nunca lanza (una métrica no puede tirar un listado)
 * pero cada falla queda en el log con su código. Un `catch` mudo acá sería un
 * contador que se congela sin que nadie se entere.
 */
export async function recordBoostImpressions(boostIds: readonly string[]): Promise<void> {
  if (boostIds.length === 0) return;

  // El tope lo vuelve a validar la función en la base (y ahí sí levanta
  // excepción). Acá se recorta antes de llamar porque el caller legítimo nunca
  // sirve más de un puñado: si pasa, es un bug nuestro, no un abuso.
  const ids = [...new Set(boostIds)].slice(0, 24);

  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("record_boost_impressions", { p_boost_ids: ids });
    if (error) {
      console.warn("[boosts] no se pudieron registrar las impresiones", { code: error.code });
    }
  } catch (error) {
    // Sin SUPABASE_SERVICE_ROLE_KEY (dev sin configurar) `createAdminClient`
    // lanza. Se registra y se sigue: el listado no depende de esto.
    console.warn(
      "[boosts] no se pudieron registrar las impresiones",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Cuántas veces se sirvió cada impulso de un aviso, sumado.
 *
 * Lo lee el panel de estadísticas del dueño con SU cliente: la policy de
 * `boost_impressions` sólo devuelve las filas de quien compró el impulso (o del
 * staff de esa comunidad). Devuelve `null` —y no cero— cuando no se pudo leer:
 * un cero es una afirmación ("no te vio nadie") y sería mentira.
 */
export async function fetchBoostImpressions(
  supabase: Supabase,
  boostIds: readonly string[],
): Promise<number | null> {
  if (boostIds.length === 0) return 0;

  const { data, error } = await supabase
    .from("boost_impressions")
    .select("impressions")
    .in("boost_id", [...boostIds]);

  if (error) {
    console.warn("[boosts] no se pudieron leer las impresiones", { code: error.code });
    return null;
  }

  return (data ?? []).reduce((total, row) => total + (row.impressions ?? 0), 0);
}
