import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Briefcase,
  CalendarBlank,
  ChatCircle,
  House,
  HourglassMedium,
  Megaphone,
  Play,
  ShoppingBagOpen,
  Sparkle,
  Storefront,
  UserGear,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { Chip, EmptyState, buttonVariants } from "@/components/ui";
import { AdChip } from "@/components/feed/card-ad-chip";
import { CrearParaPromocionarCta } from "@/components/boosts";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { SectionTopBar } from "@/components/shell";
import {
  esReciente,
  puedePromocionarse,
  toListingImpulsarItem,
  toPostImpulsarItem,
  type EstadoPromocion,
  type ImpulsarItem,
} from "./impulsar-items";

export const metadata = { title: "Boost" };

/**
 * Copy local del índice (feedback cliente Geovanny, 2026-08-05: falta un
 * lugar único desde donde promocionar CUALQUIER cosa propia — hoy /impulsar
 * solo existe con un [listingId] en la URL).
 *
 * TODO(integración): mover a feed/copy.ts — ese archivo lo está editando otro
 * agente en simultáneo, se declara acá para no pisarle el merge.
 */
const COPY = {
  /**
   * "Boost" y no "Impulsar" (pedido Manuel 2026-08-11: un solo nombre para la
   * misma compra en toda la app). El bottom nav ya dice Boost
   * (`i18n/es/nav.ts: moduleBoost`) y el tile del "+" también; esta pantalla
   * —la que los dos abren— era la única que seguía llamándose de otra manera,
   * así que el nombre cambiaba justo al tocar el botón. La RUTA sigue siendo
   * /impulsar: renombrarla rompería los links ya compartidos y los `next=` de
   * los redirect a /entrar, y no gana nada que la persona vea.
   */
  title: "Boost",
  subtitle: "Pagá para que un aviso o una publicación tuya llegue a más gente en tu zona.",
  listingsHeading: "Tus avisos",
  postsHeading: "Tus publicaciones",
  promoteCta: "Promocionar",
  recien: "Recién creado",
  emptyAllTitle: "Todavía no tenés nada para promocionar",
  emptyAllMessage:
    "Boost necesita que primero exista el aviso o la publicación. Empezá por el botón de arriba y volvé cuando esté listo.",
  emptyListings: "Todavía no publicaste ningún aviso.",
  emptyPosts: "Todavía no publicaste nada en el feed.",
  gestionarAvisos: "Ver el estado de todos tus avisos",
  shownLimit: (n: number) => `Mostrando tus ${n} más recientes.`,
} as const;

/**
 * Por qué esta fila NO se puede promocionar, en sus palabras.
 *
 * Hasta el 2026-09-07 los seis estados compartían un solo texto ("Todavía en
 * revisión") y, peor, conservaban el botón "Promocionar" en primario: llevaba
 * a `/impulsar/[listingId]`, que exige `status = 'published'`, sólo para
 * contestar que no. Un aviso pausado, uno vencido y un borrador leían todos que
 * los estaba mirando un moderador. Cada uno se destraba distinto, así que cada
 * uno lo dice.
 */
interface EstadoTrabado {
  etiqueta: string;
  nota: string;
  tono: "warning" | "neutral";
}

const ESTADO_NO_PROMOCIONABLE = {
  en_revision: {
    etiqueta: "En revisión",
    nota: "Lo estamos revisando. Te avisamos apenas se apruebe y ahí lo promocionás.",
    tono: "warning",
  },
  sin_terminar: {
    etiqueta: "Sin terminar",
    nota: "Te quedó a medio publicar. Terminalo y después volvé a promocionarlo.",
    tono: "neutral",
  },
  pausada: {
    etiqueta: "Pausado",
    nota: "Lo bajaste vos, así que ahora no se muestra. Volvé a publicarlo y promocionalo.",
    tono: "neutral",
  },
  vencida: {
    etiqueta: "Vencido",
    nota: "Se cumplió su plazo y dejó de mostrarse. Renovalo y después promocionalo.",
    tono: "warning",
  },
  cerrada: {
    etiqueta: "Cerrado",
    nota: "Lo cerraste vos. Si lo querés promocionar, publicalo de nuevo.",
    tono: "neutral",
  },
  no_disponible: {
    etiqueta: "No disponible",
    nota: "Ahora mismo no se puede promocionar.",
    tono: "neutral",
  },
  // `satisfies` y no una anotación: exige que estén los seis (agregar un estado
  // a `EstadoPromocion` rompe acá hasta que se le escriba el texto) sin
  // ensanchar las claves, así el acceso de `trabadaDe` se resuelve sin casts.
} satisfies Record<Exclude<EstadoPromocion, "activa" | "lista">, EstadoTrabado>;

/** El "por qué no" de esta fila, o null si sí se puede promocionar. */
function trabadaDe(estado: EstadoPromocion): EstadoTrabado | null {
  return estado === "activa" || estado === "lista" ? null : ESTADO_NO_PROMOCIONABLE[estado];
}

/** Tope por sección — el índice NUNCA lista sin límite. */
const LIMIT = 20;

/**
 * Íconos por `listings.kind`. Están los SIETE que escriben en la tabla:
 * marketplace guarda `product` y creadores `creator_gig` (ver el `insert` de
 * cada uno), y sin su entrada los dos caían al respaldo de Negocios — un
 * producto del Marketplace se dibujaba con la vidriera de un local.
 */
const LISTING_ICON: Record<string, Icon> = {
  property: House,
  business: Storefront,
  professional: UserGear,
  event: CalendarBlank,
  job: Briefcase,
  product: ShoppingBagOpen,
  creator_gig: Sparkle,
};

function listingIconFor(item: ImpulsarItem): Icon {
  return LISTING_ICON[item.subKind] ?? Storefront;
}

function postIconFor(): Icon {
  return ChatCircle;
}

/**
 * /impulsar (índice) — "Promocioná lo tuyo": todos los avisos y publicaciones
 * del usuario autenticado, cada uno con su botón "Promocionar" hacia
 * /impulsar/[listingId] o /impulsar-post/[postId] (que YA existían y hacen
 * todo el trabajo de cobro — acá solo se elige QUÉ promocionar).
 *
 * Y, desde el 2026-09-07, la salida hacia CREAR algo nuevo
 * (`CrearParaPromocionarCta` → /impulsar/crear). Iba dentro del `EmptyState`,
 * o sea que existía sólo mientras la pantalla estaba vacía: apenas tenías un
 * aviso, el único camino para hacer otro desaparecía. Es literal el reporte del
 * cliente ("en la sección de boost falta el botón de poder crear una
 * publicidad"), con una captura de siete avisos propios y ningún botón de
 * crear.
 *
 * Convive sin colisión con /impulsar/[listingId]: en el App Router de este
 * Next, un `page.tsx` en el segmento fijo y un `page.tsx` en su hijo
 * `[listingId]` resuelven rutas distintas (`/impulsar` vs. `/impulsar/algo`)
 * — no hay ambigüedad que resolver, cada URL matchea un solo archivo. Lo mismo
 * vale para el hermano `crear/`: un segmento estático le gana al dinámico, y
 * ningún id real puede llamarse "crear" (son UUID, y `[listingId]` lo valida
 * con su regex antes de tocar la base).
 */
export default async function ImpulsarIndexPage() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?next=/impulsar");

  // Lo propio del usuario en este tenant — nunca "removed" (nadie promociona
  // algo que ya se dio de baja). RLS ya aísla por dueño; el filtro explícito
  // es además la query eficiente (mismo patrón que el resto del repo).
  const [{ data: listingRows }, { data: postRows }] = await Promise.all([
    supabase
      .from("listings")
      .select("id, kind, title, status, photos, created_at")
      .eq("tenant_id", tenant.id)
      .eq("created_by", user.id)
      .neq("status", "removed")
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("posts")
      .select("id, kind, body, media, status, created_at")
      .eq("tenant_id", tenant.id)
      .eq("author_id", user.id)
      .neq("status", "removed")
      .order("created_at", { ascending: false })
      .limit(LIMIT),
  ]);

  const listings = listingRows ?? [];
  const posts = postRows ?? [];
  // Un solo instante para toda la pantalla: el corte de "vigente" de las dos
  // queries y el de "recién creado" de las filas tienen que ser el mismo, o dos
  // filas iguales se leerían distinto según cuánto tardó el render. Se lee con
  // `new Date()` y no con `Date.now()` porque `react-hooks/purity` prohíbe el
  // segundo por nombre; es el mismo reloj y es el que esta página ya usaba.
  const ahora = new Date();
  const ahoraMs = ahora.getTime();
  const now = ahora.toISOString();

  // Boost/campaña VIGENTE de cada uno, en dos queries batch (no una por fila).
  const [{ data: activeBoosts }, { data: activePromos }] = await Promise.all([
    listings.length > 0
      ? supabase
          .from("boosts")
          .select("listing_id, ends_at")
          .in(
            "listing_id",
            listings.map((row) => row.id),
          )
          .eq("status", "active")
          .gt("ends_at", now)
      : Promise.resolve({ data: [] as { listing_id: string; ends_at: string }[] }),
    posts.length > 0
      ? supabase
          .from("post_promotions")
          .select("post_id, ends_at")
          .in(
            "post_id",
            posts.map((row) => row.id),
          )
          .eq("status", "active")
          .gt("ends_at", now)
      : Promise.resolve({ data: [] as { post_id: string; ends_at: string }[] }),
  ]);

  const boostEndsByListing = new Map(
    (activeBoosts ?? []).map((row) => [row.listing_id, row.ends_at]),
  );
  const promoEndsByPost = new Map((activePromos ?? []).map((row) => [row.post_id, row.ends_at]));

  const listingItems: ImpulsarItem[] = listings.map((row) =>
    toListingImpulsarItem(row, boostEndsByListing.get(row.id) ?? null),
  );
  const postItems: ImpulsarItem[] = posts.map((row) =>
    toPostImpulsarItem(row, promoEndsByPost.get(row.id) ?? null),
  );

  const nothingToPromote = listingItems.length === 0 && postItems.length === 0;

  return (
    <div className="flex flex-col gap-6 pb-8">
      {/* Salida de la pantalla (feedback 2026-09-03, punto 3): la ruta tiene hijos, así que la barra va en la página y no en un layout. */}
      <SectionTopBar fallbackHref="/buscar" />
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.title}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.subtitle}</p>
      </header>

      {/* Fuera del condicional a propósito: es la mitad del pedido. Con lista o
          sin lista, el botón de crear está siempre en el mismo lugar. */}
      <CrearParaPromocionarCta />

      {nothingToPromote ? (
        /* Sin `action`: el CTA de crear está justo arriba y en el mismo lugar
           en el que va a seguir estando después. Repetirlo acá serían dos
           botones idénticos a diez píxeles de distancia. */
        <EmptyState
          icon={<Megaphone size={32} weight="fill" aria-hidden="true" />}
          title={COPY.emptyAllTitle}
          message={COPY.emptyAllMessage}
        />
      ) : (
        <>
          <ImpulsarSection
            heading={COPY.listingsHeading}
            items={listingItems}
            emptyMessage={COPY.emptyListings}
            iconFor={listingIconFor}
            ahoraMs={ahoraMs}
            gestionHref="/publicaciones"
          />
          <ImpulsarSection
            heading={COPY.postsHeading}
            items={postItems}
            emptyMessage={COPY.emptyPosts}
            iconFor={postIconFor}
            ahoraMs={ahoraMs}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sección (avisos / publicaciones) — misma forma que ProfilePostsGrid: título,
// lista o vacío chico, y una nota si se llegó al tope de LIMIT.
// ---------------------------------------------------------------------------

function ImpulsarSection({
  heading,
  items,
  emptyMessage,
  iconFor,
  ahoraMs,
  gestionHref,
}: {
  heading: string;
  items: ImpulsarItem[];
  emptyMessage: string;
  iconFor: (item: ImpulsarItem) => Icon;
  ahoraMs: number;
  /**
   * A dónde se destraba lo que no se puede promocionar (hoy /publicaciones,
   * que renueva y cierra avisos). Sólo la sección de avisos lo pasa: esa
   * pantalla lee `listings`, no `posts`.
   */
  gestionHref?: string;
}) {
  if (items.length === 0) {
    return (
      <section aria-label={heading} className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-bold text-foreground">{heading}</h2>
        <p className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-6 text-center text-sm text-foreground-muted">
          {emptyMessage}
        </p>
      </section>
    );
  }

  // El link de gestión aparece sólo cuando hay algo que gestionar: un pie fijo
  // debajo de una lista donde todo se puede promocionar no resuelve nada.
  const hayTrabadas = Boolean(gestionHref) && items.some((item) => !puedePromocionarse(item.estado));

  return (
    <section aria-label={heading} className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-bold text-foreground">{heading}</h2>
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => (
          <ImpulsarRow
            key={item.id}
            item={item}
            FallbackIcon={iconFor(item)}
            ahoraMs={ahoraMs}
          />
        ))}
      </ul>
      {hayTrabadas && gestionHref && (
        <Link
          href={gestionHref}
          className={cn(
            "flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-brand-ink",
            "transition-colors duration-(--duration-fast) hover:bg-surface-subtle",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          {COPY.gestionarAvisos}
        </Link>
      )}
      {items.length === LIMIT && (
        <p className="text-center text-xs text-foreground-muted">{COPY.shownLimit(LIMIT)}</p>
      )}
    </section>
  );
}

function ImpulsarRow({
  item,
  FallbackIcon,
  ahoraMs,
}: {
  item: ImpulsarItem;
  FallbackIcon: Icon;
  ahoraMs: number;
}) {
  const trabada = trabadaDe(item.estado);
  const esNuevo = esReciente(item.createdAt, ahoraMs);

  return (
    <li>
      <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-3">
        <span
          aria-hidden="true"
          className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-subtle"
        >
          {item.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- thumbnail chico (56px) de un bucket propio; no es LCP de esta página
            <img src={item.thumbnailUrl} alt="" className="size-full object-cover" />
          ) : (
            <FallbackIcon size={22} className="text-foreground-muted" />
          )}
          {item.thumbnailIsVideo && (
            <span className="cl-print-fill absolute inset-0 flex items-center justify-center bg-media-scrim">
              <Play size={14} weight="fill" className="text-on-media" />
            </span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>

          {(esNuevo || item.estado === "activa" || trabada) && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {/* Lo recién hecho, dicho en voz alta: es lo que reconoce quien
                  vuelve de crear algo por un camino que no lo trae de vuelta
                  solo (empleos, marketplace, creadores, el feed). */}
              {esNuevo && (
                <Chip variant="brand" size="sm">
                  {COPY.recien}
                </Chip>
              )}
              {item.estado === "activa" && <AdChip />}
              {trabada && (
                <Chip
                  variant={trabada.tono === "warning" ? "warning" : "neutral"}
                  size="sm"
                  icon={
                    item.estado === "en_revision" ? (
                      <HourglassMedium weight="fill" />
                    ) : undefined
                  }
                >
                  {trabada.etiqueta}
                </Chip>
              )}
            </div>
          )}

          {trabada && (
            <p className="mt-1 text-xs leading-relaxed text-foreground-muted">{trabada.nota}</p>
          )}
        </div>

        {trabada === null && (
          <Link
            href={item.href}
            aria-label={`${COPY.promoteCta}: ${item.title}`}
            className={cn(
              buttonVariants({
                variant: item.estado === "activa" ? "outline" : "primary",
                size: "sm",
              }),
              "shrink-0",
            )}
          >
            <Megaphone size={16} aria-hidden="true" />
            {COPY.promoteCta}
          </Link>
        )}
      </div>
    </li>
  );
}
