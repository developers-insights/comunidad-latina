import { Suspense } from "react";
import Link from "next/link";
import { CaretDown, MagnifyingGlass, Plus } from "@phosphor-icons/react/dist/ssr";
import { Bubble, EmptyState, SectionCta, buttonVariants } from "@/components/ui";
import { ModuleFilterChips, type FilterOption } from "@/components/search";
import {
  CasoCard,
  CasoListSkeleton,
  COMUNIDAD_ACCENT,
  ComunidadHeading,
  ZonaBuscador,
} from "@/components/comunidad";
import {
  COMUNIDAD_COPY,
  LOST_FOUND_CATEGORIES,
  LOST_FOUND_CATEGORY_LABEL,
  toLostFoundCategory,
  toLostFoundType,
  type LostFoundCategory,
  type LostFoundType,
} from "@/lib/comunidad";
import { getAuthUserId } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { fetchLostFoundPage } from "../../queries";

export const metadata = { title: "Perdido y encontrado" };

const C = COMUNIDAD_COPY.perdidos;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface Filtros {
  zona: string;
  tipo: LostFoundType | null;
  categoria: LostFoundCategory | null;
  cursor: string;
}

function primerValor(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseFiltros(sp: Record<string, string | string[] | undefined>): Filtros {
  return {
    zona: primerValor(sp.zona).slice(0, 80),
    tipo: toLostFoundType(primerValor(sp.tipo)),
    categoria: toLostFoundCategory(primerValor(sp.cat)),
    cursor: primerValor(sp.cursor).slice(0, 200),
  };
}

const OPCIONES_TIPO: readonly FilterOption[] = [
  { value: "", label: C.filters.all },
  { value: "lost", label: C.filters.lost },
  { value: "found", label: C.filters.found },
];

const OPCIONES_CATEGORIA: readonly FilterOption[] = [
  { value: "", label: C.filters.allCategories },
  ...LOST_FOUND_CATEGORIES.map((categoria) => ({
    value: categoria,
    label: LOST_FOUND_CATEGORY_LABEL[categoria],
  })),
];

/**
 * PERDIDO Y ENCONTRADO — el listado.
 *
 * ── LA ZONA ES EL FILTRO, NO UN FILTRO ──────────────────────────────────────
 * El pedido del cliente lo dice así: «si alguien pierde algo lo busca aquí por
 * área donde él crea que perdió algo». Por eso el campo de zona va PRIMERO,
 * grande y con su ayuda visible, y los chips de tipo/categoría van debajo: son
 * el refinamiento, no la entrada.
 *
 * Todo el estado vive en la URL (?zona=&tipo=&cat=&cursor=), como en el resto
 * de los listados: se comparte por link, sobrevive al botón atrás y el Server
 * Component lo lee sin sincronizar nada.
 *
 * La `key` del Suspense es el JSON de los filtros: cada cambio remonta el
 * árbol, así vuelve el skeleton en vez de quedar la lista vieja congelada
 * mientras llega la nueva.
 */
export default async function PerdidosPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const filtros = parseFiltros(sp);

  return (
    <>
      <ComunidadHeading
        className="mt-2"
        icon={<MagnifyingGlass size={30} weight="bold" aria-hidden="true" />}
        title={C.title}
        subtitle={C.subtitle}
      />

      <SectionCta
        accent={COMUNIDAD_ACCENT}
        href="/comunidad/perdidos/publicar"
        title={C.publishTitle}
        hint={C.publishHint}
        className="mb-4 mt-3"
      />

      {/* Bandeja de filtros: la zona primero, los chips después. */}
      <Bubble tone="tray" shape="tile" size="none" className="mb-5 space-y-4 p-4">
        <ZonaBuscador />
        <ModuleFilterChips param="tipo" label={C.filters.typeLabel} options={OPCIONES_TIPO} />
        <ModuleFilterChips
          param="cat"
          label={C.filters.categoryLabel}
          options={OPCIONES_CATEGORIA}
        />
      </Bubble>

      <p className="mb-5 text-sm leading-relaxed text-foreground-muted">{C.privacyNote}</p>

      <Suspense key={JSON.stringify(filtros)} fallback={<CasoListSkeleton />}>
        <Listado filtros={filtros} />
      </Suspense>
    </>
  );
}

async function Listado({ filtros }: { filtros: Filtros }) {
  const [tenant, viewerId] = await Promise.all([getTenant(), getAuthUserId()]);

  const { items, nextCursor } = await fetchLostFoundPage({
    tenantId: tenant.id,
    viewerId,
    type: filtros.tipo,
    category: filtros.categoria,
    area: filtros.zona || null,
    cursor: filtros.cursor || null,
  });

  const hayFiltro = Boolean(filtros.zona || filtros.tipo || filtros.categoria);

  if (items.length === 0) {
    return (
      <EmptyState
        illustration="/images/empty-state-search.png"
        title={hayFiltro ? C.empty.filteredTitle : C.empty.title}
        message={hayFiltro ? C.empty.filteredMessage : C.empty.message}
        action={
          <Link
            href="/comunidad/perdidos/publicar"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            <Plus size={18} aria-hidden="true" />
            {C.empty.cta}
          </Link>
        }
      />
    );
  }

  // El "ver más" tiene que arrastrar los filtros: sin esto la segunda página
  // vuelve al listado completo y parece que la búsqueda se rompió.
  const siguiente = new URLSearchParams();
  if (filtros.zona) siguiente.set("zona", filtros.zona);
  if (filtros.tipo) siguiente.set("tipo", filtros.tipo);
  if (filtros.categoria) siguiente.set("cat", filtros.categoria);
  if (nextCursor) siguiente.set("cursor", nextCursor);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {items.map((caso) => (
          <CasoCard key={caso.id} caso={caso} />
        ))}
      </div>

      {nextCursor && (
        <Link
          href={`/comunidad/perdidos?${siguiente.toString()}`}
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
        >
          Ver más casos
          <CaretDown size={16} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
