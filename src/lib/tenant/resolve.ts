import { cache } from "react";
import { unstable_cache } from "next/cache";
import { headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database.types";

/** Forma canónica del tenant que consume toda la app. */
export type Tenant = {
  id: string;
  slug: string;
  name: string;
  brandHex: string;
  logoUrl: string | null;
  locale: string;
  currency: string;
  modules: Record<string, boolean>;
  /**
   * `tenants.modules_soon` (migración 0041): el TERCER estado de un módulo.
   * Misma forma que `modules` y hermana suya, nunca su reemplazo — el contrato
   * de los tres estados, y el default de la clave ausente, viven en
   * `@/components/shell/module-access` y en ningún otro lado.
   *
   * Vacío `{}` cuando la columna trae basura: sin `modules_soon` nadie queda en
   * "muy pronto", que es la degradación correcta (el on/off de `modules` sigue
   * mandando igual).
   */
  modulesSoon: Record<string, boolean>;
  theme: Record<string, unknown> | null;
  /**
   * `true` cuando la fila NO vino de la DB y `id` es un placeholder (DB caída,
   * seed pendiente, slug inexistente). Sirve para pintar branding igual —
   * degradación elegante §7 — pero JAMÁS para comparar contra el `tenant_id`
   * del JWT: ver `classifyTenantMatch` en `./match`.
   */
  isFallback: boolean;
};

export const TENANT_COOKIE = "cl-tenant";
export const TENANT_SLUG_HEADER = "x-tenant-slug";

/**
 * Nombre del parámetro de query que lleva la PISTA DE TENANT en desarrollo.
 *
 * ── POR QUÉ SE LLAMA ASÍ Y NO `t` ────────────────────────────────────────────
 * Hasta el 2026-08-24 esto era `?t=`. El problema no era el nombre: era que
 * `?t=` YA SIGNIFICABA OTRA COSA. Los módulos que estrenaron el patrón
 * `NavTabs` —Perfil, Negocios, Profesionales y Marketplace— usan `?t=<pestaña>`
 * para decir en qué pestaña está la persona (`/negocios?t=ofertas`,
 * `/marketplace?t=tiendas`, …). Un solo parámetro, dos significados, y el
 * proxy leyendo el que no era.
 *
 * El daño, reproducido en local: abrir `/negocios?t=ofertas` hacía que el proxy
 * entendiera "servime la comunidad `ofertas`". Como `resolveTenantSlug` acepta
 * A PROPÓSITO cualquier slug no reservado —así una comunidad recién creada
 * resuelve sin deploy— el slug pasaba, `getTenant()` no encontraba la fila y
 * degradaba al fallback, y de ahí en más TODAS las pantallas quedaban vacías,
 * sin un solo error en consola. Peor: el paso 7 del proxy PERSISTÍA esa pista
 * en la cookie `cl-tenant` por 30 días, así que el destrozo sobrevivía a sacar
 * el `?t=` de la URL. Nadie adivina eso.
 *
 * Se renombró la pista y NO las pestañas, en ese orden de importancia: la pista
 * es una ayuda de desarrollo que se escribe a mano tres veces por semana; las
 * pestañas son URLs que ve y comparte quien usa la app, ya están en cuatro
 * módulos y tienen tests propios. El que se mueve es el barato.
 *
 * Se eligió el MISMO nombre que la cookie (`cl-tenant`) para que las dos mitades
 * del mecanismo se llamen igual y el prefijo `cl-` deje claro que es de la
 * plataforma, no de una pantalla. Ningún módulo puede volver a chocarlo por
 * accidente: una pestaña llamada `cl-tenant` no existe.
 *
 * Sigue apagado en producción y en previews — ver `clientTenantHintsAllowed()`,
 * que es una decisión de SEGURIDAD y no de comodidad. Renombrar no la afloja.
 */
export const TENANT_QUERY_PARAM = "cl-tenant";

/**
 * La pista de tenant que trae la query, o `null`.
 *
 * Existe como función —y no como un `searchParams.get(...)` suelto en el
 * proxy— para que el contrato "el parámetro de pestaña NO mueve el tenant"
 * se pueda testear sin levantar un `NextRequest`. Es el test que ancla la
 * regresión: ver `./query-hint.test.ts`.
 */
export function tenantHintFromSearchParams(
  searchParams: Pick<URLSearchParams, "get">,
): string | null {
  return searchParams.get(TENANT_QUERY_PARAM);
}

/**
 * Slugs reservados de MARCA/legal — NUNCA se resuelven como comunidad pública,
 * aunque tengan su propia fila en `tenants` y su propio dominio.
 *
 * Vive ACÁ ARRIBA, y no junto a `isActiveCommunitySlug()` donde estaba, porque
 * `sanitizeSlugAtBoot()` (unas líneas más abajo) lo consulta mientras se evalúa
 * el módulo: declarado después quedaría en zona muerta temporal.
 *
 * Hoy es solo `comunidadlatina`: es la MARCA y el panel de administración, con
 * una razón puntual de negocio detrás (specimen de marca registrada en curso,
 * PLAN_MAESTRO §11.1 — "uso GENUINO, no una transacción manufacturada") — el
 * cliente jamás debe verla como si fuera una comunidad más. Decisión original:
 * commit `d293119` (2026-07-09).
 *
 * Cualquier slug que NO esté en este set se resuelve DINÁMICAMENTE contra la
 * fila real de `tenants` (`getTenant()`, cacheada) apenas existe, sin tocar
 * este archivo — ese es el contrato que permite nacer una comunidad nueva
 * (`scripts/new-tenant.mjs`) sin reprogramar. Antes este set funcionaba al
 * revés (allowlist de UN solo slug activo): eso "resolvía" bien a
 * `comunidadlatina`, pero de yapa clampeaba a la comunidad por defecto a
 * CUALQUIER tenant nuevo — ninguna comunidad nacida después de `dominicanos`
 * iba a ser alcanzable ni siquiera con la pista de query (`?cl-tenant=<slug>`)
 * sin editar este archivo y
 * redeployar, que es exactamente el "todavía hay que reprogramar" que el
 * playbook de nacimiento de tenant (`docs/PLAYBOOK-TENANT.md`) viene a cerrar.
 * Sumar un slug ACÁ sigue siendo una decisión de marca/legal explícita sobre
 * UN tenant puntual — no un paso rutinario del alta.
 *
 * NO afecta al panel de admin: /admin usa el `tenant_id` del JWT, no este
 * (src/app/admin/guard.ts) — un global_admin siempre pudo administrar
 * `comunidadlatina` aunque el público no la vea como comunidad.
 *
 * El dominio propio ya NO es un paso de código: desde la migración 0060 vive en
 * `public.tenant_domains` y lo resuelve el proxy contra la base
 * (`./domain-lookup` + `./domain-routing`). Este set sigue mandando por encima
 * de lo que diga la base — un slug reservado nunca se sirve como comunidad
 * pública, tampoco si alguien le carga un dominio (`clampToPublicCommunity` en
 * `./domain-routing`).
 */
export const RESERVED_BRAND_SLUGS = new Set<string>(["comunidadlatina"]);

/**
 * Comunidad que se sirve cuando el host NO identifica a ninguna.
 *
 * Pasa en un solo caso, pero es el que todo el equipo usa todos los días: los
 * hosts de la plataforma (`*.vercel.app`, `localhost`) se saltean a propósito
 * la consulta a `tenant_domains` —cada deploy estrena hostname y ninguno va a
 * ser jamás el dominio de un tenant, ver `shouldSkipLookup` en
 * `./domain-lookup`— así que caen acá. Los dominios REALES
 * (`dominicanos.com`, `comunidadlatina.com`) nunca pasan por esta constante:
 * resuelven por tabla, y si la base se cae tienen su propio respaldo por
 * hostname.
 *
 * Es configurable por entorno porque decidir qué comunidad muestra el preview
 * es una decisión de operación, no de código: el cliente revisa el avance en
 * `comunidad-latina-sigma.vercel.app` y ahí veía "Dominicanos en USA", que es
 * la comunidad equivocada para mostrarle. Cambiar eso no puede exigir un
 * deploy — se setea `DEFAULT_TENANT_SLUG` en Vercel y listo. Mismo criterio
 * que `TENANT_PLATFORM_HOSTS` en `./domain-lookup`.
 *
 * El valor por defecto se mantiene en `dominicanos` para que nada cambie donde
 * la variable no esté definida.
 */
export const DEFAULT_TENANT_SLUG = sanitizeSlugAtBoot(
  process.env.DEFAULT_TENANT_SLUG ?? process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG,
);

/**
 * Un slug inválido en la variable de entorno NO puede tumbar el arranque ni
 * dejar la app sirviendo una comunidad inexistente: degrada al de siempre.
 * Mismo alfabeto que el CHECK de `tenants.slug`.
 *
 * Y TAMPOCO puede ser un slug RESERVADO de marca. Esto no es teoría: el
 * 2026-08-13 se seteó `DEFAULT_TENANT_SLUG=comunidadlatina` en Vercel y
 * producción pasó a servir el tenant de MARCA como si fuera una comunidad —
 * feed vacío (todo el contenido vive en `dominicanos`) y, para colmo, el aviso
 * de divergencia contra la cuenta de quien miraba. El clamp de
 * `resolveTenantSlug` no alcanzaba para atajarlo: devuelve `DEFAULT_TENANT_SLUG`
 * cuando el candidato está reservado, así que con el reservado ADENTRO de la
 * constante el clamp se volvía un no-op que devolvía justo lo que quería
 * bloquear. El corte tiene que estar acá, en el arranque, que es donde entra el
 * valor.
 *
 * Por eso `RESERVED_BRAND_SLUGS` se declara ARRIBA de `DEFAULT_TENANT_SLUG` y no
 * donde estaba: esta función corre durante la evaluación del módulo, así que un
 * set declarado después quedaría en zona muerta temporal y tiraría
 * `ReferenceError` en el arranque. Se testea en `resolve.test.ts`.
 */
function sanitizeSlugAtBoot(raw: string | undefined): string {
  const value = (raw ?? "").trim().toLowerCase();
  const wellFormed = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(value);
  return wellFormed && !RESERVED_BRAND_SLUGS.has(value) ? value : "dominicanos";
}

/**
 * Módulos del tenant de fallback: NINGUNA clave, o sea TODO activo.
 *
 * No está vacío por pereza — vacío ES la forma de decir "todo prendido", porque
 * el default de una clave ausente es "activo" (`moduleAvailability` en
 * @/components/shell/module-access, que es donde vive esa decisión y la única
 * donde vive). Antes esto era una lista escrita a mano con las 9 claves de
 * entonces, y envejeció mal: cuando llegaron `empleos` y `videos` nadie la
 * actualizó, así que un tenant en fallback mostraba la app CON DOS SECCIONES
 * MENOS. Una lista que hay que mantener sincronizada con MODULE_KEYS es una
 * lista que se va a desincronizar; no tenerla es la única forma de que no pase.
 *
 * Y es lo que corresponde: el fallback se usa cuando la DB no contesta o el seed
 * no corrió. Un tenant en fallback muestra la plataforma COMPLETA —degradación
 * elegante §7— porque una DB caída no puede parecerse a un lanzamiento por
 * etapas.
 */
const DEFAULT_MODULES: Record<string, boolean> = {};

/**
 * Fallback de `modules_soon`: NADIE en "muy pronto".
 *
 * Es lo correcto justamente porque el fallback se usa cuando la DB no contesta:
 * en ese escenario todo está activo, así que un módulo marcado "muy pronto" acá
 * jamás se leería (el estado "muy pronto" solo existe sobre lo apagado).
 */
const DEFAULT_MODULES_SOON: Record<string, boolean> = {};

/**
 * Fallback hardcodeado para dev / degradación elegante: si la DB no responde
 * o aún no está sembrada, la app igual renderiza con estos tenants.
 * Los `id` son placeholders — cuando la DB responde, SIEMPRE gana su id real.
 */
export const DEFAULT_TENANTS: Record<string, Tenant> = {
  dominicanos: {
    id: "00000000-0000-4000-8000-000000000001", // placeholder — el id real lo da la DB
    slug: "dominicanos",
    name: "Comunidad Latina",
    brandHex: "#1A5EDB",
    logoUrl: null,
    locale: "es-US",
    currency: "USD",
    modules: DEFAULT_MODULES,
    modulesSoon: DEFAULT_MODULES_SOON,
    theme: null,
    isFallback: true,
  },
  comunidadlatina: {
    id: "00000000-0000-4000-8000-000000000002", // placeholder — el id real lo da la DB
    slug: "comunidadlatina",
    name: "Comunidad Latina",
    brandHex: "#C2410C",
    logoUrl: null,
    locale: "es-US",
    currency: "USD",
    modules: DEFAULT_MODULES,
    modulesSoon: DEFAULT_MODULES_SOON,
    theme: null,
    isFallback: true,
  },
};

/**
 * RESPALDO de dominios → slug. **Ya no es la fuente de verdad.**
 *
 * Desde la migración 0060 el mapeo host→tenant vive en `public.tenant_domains`
 * y lo resuelve el RPC `public.resolve_tenant_domain(host)`, que el proxy llama
 * en cada request (con caché en memoria: ver `./domain-lookup`). Dar de alta un
 * dominio dejó de ser un commit — es una fila.
 *
 * Este mapa sobrevive con UN solo trabajo: sostener los dominios de producción
 * cuando la base NO CONTESTA. Se consulta únicamente en la rama `unavailable`
 * de `decideTenantRouting` (`./domain-routing`) — nunca cuando la base contestó,
 * porque si no suspender un dominio desde el panel no apagaría nada y el
 * `status` de 0060 sería decorativo.
 *
 * Corolario: NO hay que agregar acá los dominios nuevos. Un dominio dado de
 * alta hoy queda cubierto por el caché rancio de 24h de `./domain-lookup`, que
 * es un respaldo mejor porque conoce lo que se creó después del último deploy.
 * Estas cuatro entradas quedan porque son los dominios que ya estaban en
 * producción antes de 0060 y no cuesta nada tenerlos escritos.
 */
const DOMAIN_TENANTS: Record<string, string> = {
  "dominicanos.com": "dominicanos",
  "www.dominicanos.com": "dominicanos",
  "comunidadlatina.com": "comunidadlatina",
  "www.comunidadlatina.com": "comunidadlatina",
};

/**
 * El slug de respaldo para un host, o `null` si el mapa no lo conoce.
 *
 * Se exporta en vez de exportar `DOMAIN_TENANTS` entero para que quien lo use
 * no quede atado a la forma del mapa (mismo criterio que
 * `KNOWN_TENANT_DOMAINS`). Espera un host YA normalizado.
 */
export function domainFallbackSlug(hostname: string): string | null {
  return DOMAIN_TENANTS[hostname] ?? null;
}

/**
 * Los mismos dominios, como set, para quien necesita preguntar "¿este host es
 * NUESTRO?" sin que le importe a qué tenant mapea.
 *
 * Hoy lo usa `resolveOrigin()` (src/app/(auth)/recuperar/origin.ts) para decidir
 * si puede construir con el host del request la URL absoluta que viaja dentro de
 * un correo de confirmación. Se exporta el set y no `DOMAIN_TENANTS` entero para
 * que ese uso no quede atado a la forma del mapa.
 */
export const KNOWN_TENANT_DOMAINS: ReadonlySet<string> = new Set(
  Object.keys(DOMAIN_TENANTS),
);

/*
 * `RESERVED_BRAND_SLUGS` vivía acá. Se movió arriba, junto a
 * `DEFAULT_TENANT_SLUG`: `sanitizeSlugAtBoot()` lo consulta durante la
 * evaluación del módulo, y un `const` declarado después queda en zona muerta
 * temporal (`ReferenceError` en el arranque). El docblock viajó con él.
 */

/**
 * ¿Este slug puede resolver como comunidad pública (no está reservado de
 * marca/legal)? El nombre es historia (era "¿está en el allowlist de
 * activas?"); el contrato hoy es el inverso: todo pasa salvo lo reservado.
 */
export function isActiveCommunitySlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && slug.length > 0 && !RESERVED_BRAND_SLUGS.has(slug);
}

function sanitizeSlug(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim().toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(candidate) ? candidate : null;
}

/**
 * ¿Se pueden honrar las PISTAS DEL CLIENTE (`?cl-tenant=` y la cookie
 * `cl-tenant`)?
 * Solo FUERA de producción.
 *
 * Por qué existe esta función (auditoría 2026-08-02, reproducido en vivo):
 * `resolveTenantSlug` decía "en producción el dominio manda", pero eso solo era
 * cierto para un host que estuviera en `DOMAIN_TENANTS`. El host REAL de
 * producción hoy es `comunidad-latina-sigma.vercel.app` (único dominio del
 * proyecto en Vercel) y NO está en ese mapa — así que producción caía al
 * la pista de query/cookie, que las escribe quien visita. O sea: la pista de
 * desarrollo
 * gobernaba el tenant en producción.
 *
 * Por qué eso era crítico y no cosmético: el Asistente atiende a visitantes
 * ANÓNIMOS, y su búsqueda RAG (`searchChunksFts` → `match_chunks_fts`) corre con
 * `service_role`, que saltea RLS por completo. Adentro, la RPC filtra ÚNICAMENTE
 * por su argumento `p_tenant_id` (verificado con `pg_get_functiondef`: es
 * SECURITY DEFINER y no revalida nada contra el JWT). Un anónimo no tiene JWT,
 * así que abajo no hay red de contención: quien controla el slug controla qué
 * comunidad se lee. Con la pista apuntando a otra comunidad se leían sus
 * `rag_chunks`.
 *
 * El corte va acá y no en el asistente a propósito: pista y cookie alimentan el
 * tenant de TODA la app, no solo del RAG. Se arregla en el origen.
 *
 * TRADE-OFF, para que nadie lo reabra sin querer: en producción una comunidad
 * SIN dominio propio no es alcanzable por la pista de query; necesita SU
 * dominio. Desde la
 * migración 0060 eso es una fila en `public.tenant_domains` (la escribe
 * `scripts/new-tenant.mjs --domain=…`), no una línea de código: el paso de
 * deploy que este trade-off costaba ya no existe.
 *
 * ALCANCE REAL, medido (no asumido): Vercel corre los previews con
 * `NODE_ENV=production`, así que el primer término ya corta y los previews
 * TAMBIÉN quedan bloqueados. Es a propósito y no se afloja: un preview es una
 * URL pública apuntando a la MISMA base de producción, o sea que ahí `?t=`
 * sería el mismo agujero con otra puerta. La pista queda viva sólo en local
 * (`NODE_ENV=development`) y en los tests, que es donde de verdad hace falta.
 */
export function clientTenantHintsAllowed(): boolean {
  return !(
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production"
  );
}

/**
 * Resuelve el slug del tenant a partir del request, SIN tocar la base. Función
 * pura respecto de sus argumentos.
 *
 * DESDE 0060 ESTE YA NO ES EL CAMINO PRINCIPAL. El proxy resuelve el host
 * contra `public.tenant_domains` (`./domain-lookup`), y esta función quedó como
 * la rama de RESPALDO que `./domain-routing` usa cuando la base no contestó o
 * cuando el host es de la plataforma (localhost, previews, el deploy
 * compartido) — es decir, exactamente donde el mapa hardcodeado y las pistas de
 * dev siguen siendo lo correcto.
 *
 * - Producción: manda el HOST y NADA MÁS. Host en el respaldo `DOMAIN_TENANTS`
 *   → su comunidad; cualquier otro host → la comunidad por defecto. La pista de
 *   query y la
 *   cookie se IGNORAN (ver `clientTenantHintsAllowed`: son entrada del cliente y
 *   el RAG del asistente las consumía con service_role).
 * - Dev / previews: `?cl-tenant=<slug>` > cookie `cl-tenant` > 'dominicanos', como
 *   siempre — ahí sí son un ayudante de desarrollo legítimo.
 *
 * `allowClientHints` se puede pasar explícito para testear las dos ramas sin
 * ensuciar `process.env`; por defecto lo decide el entorno.
 */
export function resolveTenantSlug(
  host: string | null,
  searchParamT?: string | null,
  cookieT?: string | null,
  allowClientHints: boolean = clientTenantHintsAllowed(),
): string {
  const hostname = (host ?? "").split(":")[0].toLowerCase();
  const fromDomain = DOMAIN_TENANTS[hostname];
  // El host SIEMPRE tiene prioridad; las pistas del cliente solo se miran fuera
  // de producción, y solo si el host no dijo nada.
  const fromClientHint = allowClientHints
    ? (sanitizeSlug(searchParamT) ?? sanitizeSlug(cookieT))
    : null;
  const candidate = fromDomain ?? fromClientHint ?? DEFAULT_TENANT_SLUG;

  // Solo un slug reservado de marca/legal (RESERVED_BRAND_SLUGS) fuerza la
  // comunidad por defecto. Cualquier otro candidato —incluida una comunidad
  // recién nacida que todavía no tiene fila, o un slug con errores de
  // tipeo— pasa tal cual: getTenant() lo resuelve contra la DB o degrada con
  // elegancia (§7) si no existe. Así una comunidad nacida por
  // scripts/new-tenant.mjs resuelve al toque, sin deploy.
  return isActiveCommunitySlug(candidate) ? candidate : DEFAULT_TENANT_SLUG;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Mapea la fila de `tenants` a la forma canónica, con el fallback tapando huecos. */
function mapTenantRow(row: Record<string, unknown>, fallback: Tenant): Tenant {
  return {
    id: asString(row.id) ?? fallback.id,
    slug: asString(row.slug) ?? fallback.slug,
    name: asString(row.name) ?? fallback.name,
    brandHex: asString(row.brand_hex) ?? asString(row.brand_color) ?? fallback.brandHex,
    logoUrl: asString(row.logo_url) ?? fallback.logoUrl,
    locale: asString(row.locale) ?? fallback.locale,
    currency: asString(row.currency) ?? fallback.currency,
    modules: (asRecord(row.modules) as Record<string, boolean> | null) ?? fallback.modules,
    /**
     * Misma tolerancia que `modules`: si la columna trae basura (un array, un
     * string, un null) `asRecord` devuelve null y cae al `{}` del fallback —
     * sin "muy pronto", nunca a un estado inventado.
     */
    modulesSoon:
      (asRecord(row.modules_soon) as Record<string, boolean> | null) ?? fallback.modulesSoon,
    theme: asRecord(row.theme) ?? fallback.theme,
    // La fila vino de la DB: `id` es real, así que se puede comparar con el JWT.
    isFallback: false,
  };
}

/** Fallback derivado del slug (dev / degradación elegante), extraído para reusar. */
function fallbackForSlug(slug: string): Tenant {
  // El molde nunca puede ser `undefined`: desde que `DEFAULT_TENANT_SLUG` se
  // configura por entorno, alguien puede apuntarlo a una comunidad que existe
  // en la base pero no en este mapa hardcodeado. Sin esta red, el spread de
  // `undefined` devolvería un tenant sin marca ni módulos y la app renderizaría
  // rota justo cuando la base ya está caída — el peor momento posible.
  const molde = DEFAULT_TENANTS[DEFAULT_TENANT_SLUG] ?? DEFAULT_TENANTS.dominicanos;
  return (
    DEFAULT_TENANTS[slug] ?? {
      ...molde,
      slug,
      name: slug,
    }
  );
}

/**
 * Fila del tenant CACHEADA entre requests por slug (unstable_cache).
 *
 * getTenant() se llama en el root layout + generateViewport de CADA request →
 * antes esto era un SELECT a `tenants` por request en el camino crítico del
 * shell. La fila (nombre, brandHex, módulos, locale) cambia rarísimo, así que se
 * cachea 300s con tag "tenants".
 *
 * Cliente anon SIN cookies: headers()/cookies() NO se permiten dentro de una
 * cache scope (unstable_cache.md), y la fila del tenant es pública (no
 * user-bound). La cache key incluye el slug → JAMÁS se sirve la marca de un
 * tenant a otro (multi-tenant-safe). THROW en miss/error ⇒ el fallback NO se
 * cachea: si la DB se cae un instante, el próximo request reintenta y cachea la
 * fila real. Invalidación on-demand: revalidateTag("tenants") en el admin al
 * editar marca/dominio/módulos.
 */
const fetchTenantRow = unstable_cache(
  async (slug: string): Promise<Tenant> => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error("supabase-not-configured");
    const supabase = createServerClient<Database>(url, anonKey, {
      cookies: { getAll: () => [], setAll: () => {} },
    });
    const { data, error } = await supabase
      .from("tenants")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (error || !data) throw error ?? new Error("tenant-not-found");
    return mapTenantRow(data as Record<string, unknown>, fallbackForSlug(slug));
  },
  ["tenant-by-slug"],
  { revalidate: 300, tags: ["tenants"] },
);

/**
 * Tenant del request actual, para Server Components / actions.
 *
 * Lee el header x-tenant-slug (inyectado por el middleware) y resuelve la fila
 * real vía fetchTenantRow (cacheada entre requests). React cache() dedupe dentro
 * del mismo request. NUNCA lanza al usuario: ante cualquier falla (DB caída,
 * seed pendiente, header ausente) devuelve el fallback de DEFAULT_TENANTS —
 * degradación elegante, siempre hay un tenant usable.
 */
export const getTenant = cache(async (): Promise<Tenant> => {
  let slug = DEFAULT_TENANT_SLUG;
  try {
    const headerStore = await headers();
    slug = sanitizeSlug(headerStore.get(TENANT_SLUG_HEADER)) ?? DEFAULT_TENANT_SLUG;
  } catch {
    // Fuera de un request (build estático, etc.) → default.
  }

  try {
    return await fetchTenantRow(slug);
  } catch {
    // DB no disponible / sin sembrar / slug inexistente → degradación elegante.
    // `isFallback === true`: branding sí, comparación contra el JWT no.
    return fallbackForSlug(slug);
  }
});
