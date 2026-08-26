import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * =============================================================================
 * "TU ZONA" EN EL FEED (0115) — el contrato entre el SQL y la app
 * =============================================================================
 *
 * Este archivo no prueba Postgres: prueba que las decisiones que sólo viven en
 * el SQL sigan ahí, y que el TypeScript que las llama hable el mismo idioma.
 * Es el mismo patrón con el que `listings/vencimiento.test.ts` y
 * `notifications/categories.test.ts` fijan sus migraciones.
 *
 * Las tres cosas que se rompen solas si nadie las mira:
 *   1. la zona de un post se DERIVA en el servidor (si algún día la escribe el
 *      cliente, elegir barrio pasa a ser un campo de formulario = spam),
 *   2. lo promocionado esquiva el filtro SÓLO hasta donde compró,
 *   3. la app manda `p_area_labels` con el nombre exacto del parámetro.
 */

function leer(ruta: string): string {
  return readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
}

const MIGRACION = leer("../../../../supabase/migrations/0115_zona_del_feed.sql");
const MIGRACION_SIGUIENDO = leer("../../../../supabase/migrations/0119_feed_siguiendo.sql");
const FEED_RPC = leer("./feed-rpc.ts");
const LOAD_MORE = leer("./load-more.ts");

describe("0115 — la zona de una publicación", () => {
  it("posts gana su propia columna de zona", () => {
    expect(MIGRACION).toMatch(/alter table public\.posts\s+add column if not exists area_label text/);
  });

  it("la deriva un trigger BEFORE INSERT OR UPDATE, no el insert de la app", () => {
    expect(MIGRACION).toContain("before insert or update on public.posts");
    expect(MIGRACION).toContain("execute function app.posts_area_label()");
  });

  it("la función corre con search_path fijo (nunca mutable)", () => {
    const cuerpo = MIGRACION.slice(MIGRACION.indexOf("create or replace function app.posts_area_label"));
    expect(cuerpo).toContain("security definer");
    expect(cuerpo).toContain("set search_path = ''");
  });

  it("la zona de una ficha gana sobre la del perfil del autor", () => {
    const cuerpo = MIGRACION.slice(
      MIGRACION.indexOf("create or replace function app.posts_area_label"),
      MIGRACION.indexOf("drop trigger if exists posts_set_area_label"),
    );
    expect(cuerpo.indexOf("public.listings l")).toBeLessThan(cuerpo.indexOf("public.profiles p"));
  });

  it("en UPDATE la conserva: la zona de lo publicado no se edita", () => {
    expect(MIGRACION).toContain("new.area_label := old.area_label;");
  });

  /** Sin backfill, el feed filtrado arranca vacío para toda la comunidad. */
  it("rellena lo ya publicado con la misma regla", () => {
    expect(MIGRACION).toMatch(/update public\.posts p\s+set area_label/);
    expect(MIGRACION).toContain("where p.area_label is null");
  });

  /**
   * REGRESIÓN, y de las que no se ven leyendo: con el trigger ya creado, el
   * backfill dispara el BEFORE UPDATE, que conserva la zona vieja (null) y deja
   * la tabla igual. Se detectó corriendo la migración contra la base real con
   * rollback: 0 de 54 filas actualizadas. El orden ES la corrección.
   */
  it("el backfill corre ANTES de crear el trigger", () => {
    expect(MIGRACION.indexOf("update public.posts p")).toBeLessThan(
      MIGRACION.indexOf("create trigger posts_set_area_label"),
    );
  });

  it("quien declara su zona después de publicar recupera esas publicaciones", () => {
    expect(MIGRACION).toContain("after update of area_label on public.profiles");
    expect(MIGRACION).toContain("execute function app.profiles_zona_a_sus_posts()");
    // Sólo de vacía a puesta: mudarse no reescribe lo ya publicado.
    const disparador = MIGRACION.slice(
      MIGRACION.indexOf("create trigger profiles_zona_a_sus_posts"),
    );
    expect(disparador).toContain("coalesce(old.area_label, '')), '') is null");
    expect(disparador).toContain("coalesce(new.area_label, '')), '') is not null");
  });

  it("y sólo toca las publicaciones que quedaron sin zona", () => {
    const funcion = MIGRACION.slice(
      MIGRACION.indexOf("create or replace function app.profiles_zona_a_sus_posts"),
      MIGRACION.indexOf("comment on function app.profiles_zona_a_sus_posts"),
    );
    expect(funcion).toContain("and p.area_label is null");
  });

  it("deja el índice que sirve al feed con zona", () => {
    expect(MIGRACION).toContain("create index if not exists posts_zona_feed_idx");
    expect(MIGRACION).toContain("where status = 'published'");
  });
});

describe("0115 — las dos funciones del feed", () => {
  it("las dos reciben p_area_labels con default null", () => {
    expect(MIGRACION).toMatch(/create function public\.feed_posts_page[\s\S]*?p_area_labels\s+text\[\]\s+default null/);
    expect(MIGRACION).toMatch(/create function public\.feed_listings_page[\s\S]*?p_area_labels\s+text\[\]\s+default null/);
  });

  it("siguen siendo security invoker (la RLS decide, no la función)", () => {
    // Las dos declaraciones, no las menciones del encabezado.
    expect(MIGRACION.split("\nsecurity invoker\n").length - 1).toBe(2);
  });

  it("se dropean antes de recrearse: cambió la firma", () => {
    expect(MIGRACION).toContain("drop function if exists public.feed_posts_page(uuid, timestamptz, uuid, int, text);");
    expect(MIGRACION).toContain("drop function if exists public.feed_listings_page(uuid, timestamptz, uuid, int);");
  });

  it("null = no filtrar (la rama vive en el where de las dos)", () => {
    expect(MIGRACION).toContain("p_area_labels is null");
    expect(MIGRACION).toContain("(p_area_labels is null or l.area_label = any(p_area_labels))");
  });

  /**
   * La excepción es de lo PROMOCIONADO y llega hasta donde compró: `all` pasa
   * siempre, `zones` sólo si alguna de sus zonas es la que se está mirando.
   */
  it("los posts promocionados esquivan la zona según su audience", () => {
    const rama = MIGRACION.slice(
      MIGRACION.indexOf("-- ZONA (0115). null = sin zona elegida"),
      MIGRACION.indexOf("-- BLOQUEOS (0020)"),
    );
    expect(rama).toContain("public.post_promotions pr");
    expect(rama).toContain("coalesce(pr.audience->>'scope', 'all') <> 'zones'");
    expect(rama).toContain("jsonb_array_elements_text");
  });

  /** Un aviso impulsado NO compra domicilio en otro barrio. */
  it("el carril de avisos no tiene excepción de campaña", () => {
    const listings = MIGRACION.slice(MIGRACION.indexOf("create function public.feed_listings_page"));
    expect(listings).not.toContain("post_promotions");
  });

  it("los grants se re-otorgan con la firma nueva", () => {
    expect(MIGRACION).toContain(
      "grant execute on function public.feed_posts_page(uuid, timestamptz, uuid, int, text, text[])",
    );
    expect(MIGRACION).toContain(
      "grant execute on function public.feed_listings_page(uuid, timestamptz, uuid, int, text[])",
    );
  });
});

describe("la app y el SQL hablan el mismo idioma", () => {
  it("feed-rpc manda el parámetro con el nombre que declara la migración", () => {
    expect(FEED_RPC.match(/p_area_labels: zonaParam\(args\.areaLabels\)/g)?.length).toBe(2);
  });

  /**
   * La zona se resuelve en la PUERTA de la action, no adentro de cada camino:
   * el scroll infinito entra por acá, y una página 2 sin filtro arriba de una
   * página 1 filtrada es la forma más confusa posible de romper esto.
   */
  it("load-more resuelve la zona una sola vez, en fetchFeedPageAction", () => {
    expect(LOAD_MORE.match(/resolverVistaZona\(/g)?.length).toBe(1);
    const entrada = LOAD_MORE.slice(
      LOAD_MORE.indexOf("export async function fetchFeedPageAction"),
      LOAD_MORE.indexOf("async function loadParaTiPage"),
    );
    expect(entrada).toContain("const { areaLabels } = await resolverVistaZona(tenant.id, null)");
    expect(entrada.match(/areaLabels,/g)?.length).toBe(2); // los dos caminos
  });

  it("los cuatro tabs de avisos recortan por area_label", () => {
    const tabs = LOAD_MORE.slice(LOAD_MORE.indexOf("async function loadListingsPage"));
    expect(tabs).toContain('query.in("area_label", [...areaLabels])');
  });

  it("el camino legado filtra igual que el RPC (zona + campañas que alcanzan)", () => {
    expect(LOAD_MORE).toContain("campanaAlcanzaZona(");
    expect(LOAD_MORE).toContain("feedZoneFilter(areaLabels, promocionadosQueAlcanzan)");
    expect(LOAD_MORE).toContain('listingsQuery.in("area_label", [...areaLabels])');
  });
});

/**
 * =============================================================================
 * "SIGUIENDO" (0119) NO TIENE ZONA — y esa AUSENCIA es la parte fácil de
 * romper sin querer: alguien que vea el `.in("area_label", …)` de los otros
 * cuatro tabs y lo copie "por consistencia" a `loadSiguiendoPage` estaría
 * deshaciendo una decisión de producto explícita (ver el §"SIN ZONA" de la
 * migración), no arreglando un olvido.
 * =============================================================================
 */
describe('0119 — "Siguiendo" no filtra por zona', () => {
  it("las dos funciones NO reciben p_area_labels (a diferencia de las de 0115)", () => {
    const posts = MIGRACION_SIGUIENDO.slice(
      MIGRACION_SIGUIENDO.indexOf("create or replace function public.feed_siguiendo_posts_page"),
      MIGRACION_SIGUIENDO.indexOf("create or replace function public.feed_siguiendo_listings_page"),
    );
    const listings = MIGRACION_SIGUIENDO.slice(
      MIGRACION_SIGUIENDO.indexOf("create or replace function public.feed_siguiendo_listings_page"),
    );
    expect(posts).not.toContain("p_area_labels");
    expect(listings).not.toContain("p_area_labels");
  });

  it("sin grant a anon: sin sesión no hay \"Siguiendo\" (a diferencia de las de 0115)", () => {
    // Desde el primer REVOKE real hasta el final: el bloque ejecutable, sin
    // la prosa de arriba que SÍ menciona "to anon" al explicar por qué la
    // 0115 (la otra migración) se lo da a sus propias funciones.
    const grants = MIGRACION_SIGUIENDO.slice(
      MIGRACION_SIGUIENDO.indexOf("revoke execute on function public.feed_siguiendo_posts_page"),
    );
    expect(grants).toContain(
      "revoke execute on function public.feed_siguiendo_posts_page(uuid, timestamptz, uuid, int)\n  from public, anon;",
    );
    expect(grants).toContain(
      "revoke execute on function public.feed_siguiendo_listings_page(uuid, timestamptz, uuid, int)\n  from public, anon;",
    );
    expect(grants).not.toContain("to anon");
    expect(grants).toContain("to authenticated, service_role;");
  });

  it("feed-rpc: los wrappers de Siguiendo no mandan p_area_labels ni p_entity_kind", () => {
    // Los dos `.rpc(…, { … })` de esta sección — no la prosa del docblock, que
    // los NOMBRA (entre backticks) justamente para explicar por qué faltan.
    // `:` es lo que distingue "se está mandando como parámetro" de "se está
    // mencionando en un comentario".
    const bloque = FEED_RPC.slice(FEED_RPC.indexOf('"Siguiendo" (0119)'));
    expect(bloque).not.toContain("p_area_labels:");
    expect(bloque).not.toContain("p_entity_kind:");
    // Y que de verdad mande los cuatro escalares que sí lleva.
    expect(bloque.match(/p_tenant_id: args\.tenantId,/g)?.length).toBe(2);
    expect(bloque.match(/p_limit: args\.limit,/g)?.length).toBe(2);
  });

  it("load-more: loadSiguiendoPage no recorta por area_label ni recibe areaLabels", () => {
    const bloque = LOAD_MORE.slice(LOAD_MORE.indexOf("async function loadSiguiendoPage"));
    expect(bloque).not.toContain("area_label");
    expect(bloque).not.toContain("areaLabels");
  });

  it('fetchFeedPageAction no le pasa areaLabels a loadSiguiendoPage (la llamada NO suma al conteo "los dos caminos")', () => {
    const entrada = LOAD_MORE.slice(
      LOAD_MORE.indexOf("export async function fetchFeedPageAction"),
      LOAD_MORE.indexOf("async function loadParaTiPage"),
    );
    expect(entrada).toContain('if (tab === "siguiendo")');
    expect(entrada).toContain("return loadSiguiendoPage({");
    // El conteo de "los dos caminos" (test de arriba) sigue en 2: si esto
    // cambiara a 3, alguien le empezó a pasar areaLabels a "Siguiendo".
    expect(entrada.match(/areaLabels,/g)?.length).toBe(2);
  });
});
