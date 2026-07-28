import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { Bubble, EmptyState } from "@/components/ui";
import { ModuleBubble } from "@/components/shell/module-bubble";
import { visibleModules } from "@/components/shell/module-access";
import { BROWSE_MODULES } from "@/components/shell/modules";
import { getTenant } from "@/lib/tenant/resolve";
import { t } from "@/lib/i18n";

export const metadata = { title: "Buscar" };

/**
 * Buscar — la pestaña que reemplazó a "Propiedades" en el bottom nav
 * (feedback cliente 2026-07-27; el catálogo de módulos «está como medio
 * escondido» adentro del menú de arriba).
 *
 * NO es una caja de texto global, y eso fue explícito del cliente: «si pones
 * search, no te da opción a buscar lo que realmente estás buscando… pero
 * cuando le dan clic en vivienda, ahí dentro hay un search: qué buscás,
 * apartamento, cuarto, de cuánto a cuánto». Así que Buscar muestra las
 * CATEGORÍAS en cápsulas y el buscador con filtros propios vive adentro de
 * cada una — donde ya existe (vivienda, marketplace, profesionales, empleos).
 *
 * Es una RUTA y no un drawer a propósito: una pestaña del bottom nav es un
 * destino de primer nivel, tiene que soportar el botón atrás del sistema,
 * compartirse por link y marcar `aria-current`. Un modal disparado desde una
 * pestaña rompe las tres cosas. El menú lateral sigue siendo la navegación
 * secundaria (cuenta, notificaciones, tema): esa separación no se toca.
 *
 * Qué categorías se ven lo decide el panel (`tenants.modules` /
 * `modules_soon`), no este archivo: la grilla se arma con `visibleModules`, la
 * misma función que usa el menú. Server Component: sin estado ni JS propio, y
 * `getTenant()` ya está resuelto y memoizado por el layout de este request.
 */
export default async function BuscarPage() {
  const { modules, modulesSoon } = await getTenant();
  const categories = visibleModules(BROWSE_MODULES, modules, modulesSoon);

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

      {categories.length === 0 ? (
        /* El admin apagó todo: nunca una grilla vacía y muda. */
        <EmptyState
          className="mt-2"
          icon={<MagnifyingGlass size={32} weight="light" />}
          title={t("sections", "searchEmptyTitle")}
          message={t("sections", "searchEmptyMessage")}
        />
      ) : (
        <nav aria-label={t("sections", "searchCategories")} className="mt-4">
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
