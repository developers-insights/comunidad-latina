import { Suspense } from "react";
import Link from "next/link";
import { FilmSlate } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, Skeleton, buttonVariants } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import {
  ALL_CATEGORIES,
  categoryFilterValue,
  firstParamValue,
  parseVideoCategoryParam,
  type VideoCategoryFilter,
} from "../helpers";
import { VIDEOS_COPY, VIDEO_CATEGORY_LABELS, VIDEO_CATEGORY_ORDER } from "../copy";
import { LongVideoList } from "./long-video-list";
import { fetchLongVideosPage } from "./queries";
import { SectionTopBar } from "@/components/shell";

export const metadata = { title: "Videos largos" };

/**
 * /videos/largos — VIDEOS LARGOS.
 *
 * Pedido del cliente del 2026-09-03 (19:40–23:44 y 1:09–1:11): "una sección de
 * los videos largos donde la gente vaya a ver su video de 5 minutos". En el feed
 * y en Videos Cortos el video se frena a los 59 segundos y aparece "Ver video
 * completo"; ese botón termina acá.
 *
 * Un solo query param, `?cat=`, con el MISMO catálogo cerrado que el menú de
 * Videos Cortos (`video-policy`): los temas son los mismos videos vistos por
 * otra puerta, y dos catálogos que se separan es un tema que existe de un lado y
 * del otro no.
 *
 * Lo que NO hay acá, a diferencia de `/videos`: menú de entrada. La sección se
 * abre mostrando videos porque a Videos largos se llega BUSCANDO uno (desde el
 * botón del feed, o desde la tarjeta del menú), no para elegir un tema primero.
 * El filtro de temas está arriba de la lista, que es donde ayuda.
 */

const FIRST_PAGE_SIZE = 10;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LongVideosPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const category = parseVideoCategoryParam(firstParamValue(sp.cat)) ?? ALL_CATEGORIES;

  return (
    <div className="pb-10">
      <SectionTopBar fallbackHref="/videos" />

      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {VIDEOS_COPY.largos.title}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">
          {VIDEOS_COPY.largos.subtitle}
        </p>
      </header>

      <CategoryFilterRow active={category} />

      <Suspense key={category} fallback={<ListSkeleton />}>
        <LongVideosContent category={category} />
      </Suspense>
    </div>
  );
}

async function LongVideosContent({ category }: { category: VideoCategoryFilter }) {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const page = await fetchLongVideosPage({
    supabase,
    tenantId: tenant.id,
    viewerId: user?.id ?? null,
    category: categoryFilterValue(category),
    cursor: null,
    pageSize: FIRST_PAGE_SIZE,
  });

  if (page.items.length === 0) {
    const filtered = category !== ALL_CATEGORIES;
    const label = category === ALL_CATEGORIES ? "" : VIDEO_CATEGORY_LABELS[category];
    return (
      <EmptyState
        icon={<FilmSlate weight="duotone" />}
        title={
          filtered
            ? VIDEOS_COPY.largos.emptyCategoryTitle(label)
            : VIDEOS_COPY.largos.emptyTitle
        }
        message={
          filtered
            ? VIDEOS_COPY.largos.emptyCategoryMessage
            : VIDEOS_COPY.largos.emptyMessage
        }
        action={
          <Link
            href={filtered ? "/videos/largos" : `/videos?cat=${ALL_CATEGORIES}`}
            className={buttonVariants({ variant: "secondary", size: "md" })}
          >
            {filtered ? VIDEOS_COPY.largos.emptyCategoryCta : VIDEOS_COPY.largos.emptyCta}
          </Link>
        }
      />
    );
  }

  return (
    <LongVideoList
      className="mt-4"
      initialItems={page.items}
      initialCursor={page.nextCursor}
      category={category}
    />
  );
}

/**
 * Fila de temas. Enlaces y no un control con estado: cada tema es una URL
 * compartible, el servidor la resuelve y no hay hidratación que pagar en una
 * pantalla cuyo trabajo es mostrar miniaturas.
 *
 * El riel scrollea con el dedo (nunca solo — los carruseles automáticos están
 * vetados) y esconde su barra, igual que el resto de los rieles de la app.
 */
function CategoryFilterRow({ active }: { active: VideoCategoryFilter }) {
  const temas: { key: VideoCategoryFilter; label: string; href: string }[] = [
    {
      key: ALL_CATEGORIES,
      label: VIDEOS_COPY.largos.allLabel,
      href: "/videos/largos",
    },
    ...VIDEO_CATEGORY_ORDER.map((category) => ({
      key: category as VideoCategoryFilter,
      label: VIDEO_CATEGORY_LABELS[category],
      href: `/videos/largos?cat=${category}`,
    })),
  ];

  return (
    <nav
      aria-label={VIDEOS_COPY.largos.filterLabel}
      className="mt-4 -mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ul className="cl-print-hide flex w-max items-center gap-2">
        {temas.map((tema) => {
          const current = tema.key === active;
          return (
            <li key={tema.key}>
              <Link
                href={tema.href}
                // `aria-current` y no sólo el color: el tema activo se tiene que
                // poder saber sin ver el contraste del relleno.
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-semibold",
                  "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  current
                    ? "bg-brand text-brand-foreground"
                    : "bg-surface-subtle text-foreground-secondary hover:text-foreground",
                )}
              >
                {tema.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Silueta de la lista mientras el servidor resuelve la primera tanda. */
function ListSkeleton() {
  return (
    <ul
      aria-busy="true"
      aria-label={VIDEOS_COPY.largos.title}
      className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      {[0, 1, 2].map((index) => (
        <li key={index} className="overflow-hidden rounded-xl bg-surface shadow-bezel">
          <Skeleton className="aspect-video w-full rounded-none" />
          <div className="flex flex-col gap-2 p-3.5">
            <Skeleton className="h-4 w-4/5" />
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
