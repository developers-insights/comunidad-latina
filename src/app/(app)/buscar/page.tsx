import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { Bubble, EmptyState } from "@/components/ui";
import { GlobalSearch, historyStorageKey } from "@/components/search";
import { ModuleBubble } from "@/components/shell/module-bubble";
import { visibleModules } from "@/components/shell/module-access";
import { BROWSE_MODULES } from "@/components/shell/modules";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { t } from "@/lib/i18n";

export const metadata = { title: "Buscar" };

/** Techo de zonas leídas para armar las sugerencias. Ver `loadZones`. */
const ZONES_SCAN_LIMIT = 400;

/**
 * Buscar — la pestaña que reemplazó a "Propiedades" en el bottom nav
 * (feedback cliente 2026-07-27; el catálogo de módulos «está como medio
 * escondido» adentro del menú de arriba).
 *
 * LAS DOS COSAS, Y NO UNA (decisión revisada el 2026-07-30)
 * ---------------------------------------------------------
 * Esta pantalla nació SIN caja de texto, y fue explícito del cliente: «si pones
 * search, no te da opción a buscar lo que realmente estás buscando… pero cuando
 * le dan clic en vivienda, ahí dentro hay un search». En la call del 29/7
 * (9:20–10:00) y en la spec escrita nº1 el pedido cambió a las DOS cosas: la
 * barra global arriba, siempre visible, y los accesos a los módulos debajo.
 *
 * La spec nueva es un SUPERCONJUNTO de la vieja, así que no se deshace nada: la
 * grilla de categorías queda tal como estaba —es lo primero que se ve mientras
 * no se escribió nada— y la barra se le suma arriba. Y la preocupación original
 * del cliente sigue en pie: la barra global lleva a resultados, y cada resultado
 * abre el buscador CON FILTROS de su módulo, que es donde se afina "apartamento,
 * cuarto, de cuánto a cuánto". El conflicto está resuelto y anotado como nº2 en
 * `docs/feedback/2026-07-30-feedback-consolidado.md`.
 *
 * Es una RUTA y no un drawer a propósito: una pestaña del bottom nav es un
 * destino de primer nivel, tiene que soportar el botón atrás del sistema,
 * compartirse por link y marcar `aria-current`. Un modal disparado desde una
 * pestaña rompe las tres cosas. El menú lateral sigue siendo la navegación
 * secundaria (cuenta, notificaciones, tema): esa separación no se toca.
 *
 * Qué categorías se ven lo decide el panel (`tenants.modules` /
 * `modules_soon`), no este archivo: la grilla se arma con `visibleModules`, la
 * misma función que usa el menú.
 *
 * Sigue siendo Server Component: la única parte con JS es `<GlobalSearch>`, una
 * isla. Quien entra a mirar categorías no descarga el buscador para nada.
 */
export default async function BuscarPage() {
  const [{ modules, modulesSoon, slug, id }, userId] = await Promise.all([
    getTenant(),
    getAuthUserId(),
  ]);
  const categories = visibleModules(BROWSE_MODULES, modules, modulesSoon);
  const zones = await loadZones(id);

  return (
    <>
      <Bubble tone="brand" shape="tile" size="none" className="flex items-center gap-3 p-3">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-md bg-surface text-brand-ink"
        >
          <MagnifyingGlass size={26} weight="bold" />
        </span>
        <span className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-bold leading-tight tracking-tight text-foreground sm:text-2xl">
            {t("sections", "searchTitle")}
          </h1>
          <span className="mt-0.5 block text-sm leading-snug text-foreground-secondary">
            {t("sections", "searchSubtitle")}
          </span>
        </span>
      </Bubble>

      {/* La clave del historial se arma ACÁ, en el servidor, porque es el único
          lugar que conoce el tenant y a la persona. Ver el bloque de arriba de
          components/search/history.ts: en un teléfono compartido, un historial
          de búsquedas global es un problema de privacidad, no un detalle. */}
      <GlobalSearch
        className="mt-3"
        historyKey={historyStorageKey(slug, userId)}
        zones={zones}
      />

      {categories.length === 0 ? (
        /* El admin apagó todo: nunca una grilla vacía y muda. */
        <EmptyState
          className="mt-2"
          icon={<MagnifyingGlass size={32} weight="light" />}
          title={t("sections", "searchEmptyTitle")}
          message={t("sections", "searchEmptyMessage")}
        />
      ) : (
        <nav aria-label={t("sections", "searchCategories")} className="mt-5">
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            {t("sections", "searchBrowseTitle")}
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {categories.map(({ item, state }) => (
              <li key={item.href}>
                <ModuleBubble item={item} layout="tile" state={state} />
              </li>
            ))}
          </ul>
        </nav>
      )}
    </>
  );
}

/**
 * Zonas REALES para las sugerencias: los `area_label` distintos de los avisos
 * publicados de esta comunidad.
 *
 * Se resuelven una sola vez al cargar la pantalla y viajan a la isla como
 * props — la alternativa (consultar por cada tecla) es una query por pulsación
 * para un dato que casi no cambia. Se leen 400 filas y se deduplican en
 * memoria: son cadenas cortas, y sin una vista materializada de zonas es más
 * barato que un `distinct` sobre toda la tabla.
 *
 * Si falla, se devuelve vacío: las sugerencias son una ayuda, no la búsqueda.
 * Que no haya sugerencias no puede impedir buscar.
 */
async function loadZones(tenantId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("listings")
    .select("area_label")
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .not("area_label", "is", null)
    .limit(ZONES_SCAN_LIMIT);

  if (error) {
    console.warn("[buscar] no se pudieron leer las zonas", { code: error.code });
    return [];
  }

  const zones = new Set<string>();
  for (const row of data ?? []) {
    const zone = row.area_label?.trim();
    if (zone) zones.add(zone);
  }
  return [...zones].sort((a, b) => a.localeCompare(b, "es"));
}
