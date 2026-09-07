import Link from "next/link";
import {
  ArrowUpRight,
  Briefcase,
  ImageSquare,
  Storefront,
  UserCircle,
  UsersThree,
  VideoCamera,
} from "@phosphor-icons/react/dist/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { firstPhotoUrl, formatListingPrice } from "@/components/listings";
import { postMediaUrl } from "@/components/feed/helpers";
import { parseEventAttrs } from "@/components/directory/helpers";
import {
  hrefDeCompartido,
  type CompartidoKind,
  type EnlaceInterno,
} from "@/components/share/enlace-interno";
import { SHARED_CARD_COPY } from "@/components/share/copy";
import { cn, formatDate } from "@/lib/utils";

/**
 * =============================================================================
 * LA TARJETA DE UNA PUBLICACIÓN COMPARTIDA, DENTRO DEL CHAT
 * =============================================================================
 *
 * Lo que el cliente pidió con la frase «compartir es más que un link»: cuando
 * alguien te manda una propiedad, no ves una URL azul — ves la foto, el título y
 * el precio, y la abrís de un toque. La misma tarjeta se pinta en los dos
 * caminos que llevan hasta acá:
 *
 *  · el panel de Compartir, que guarda `compartido_kind` + `compartido_id`;
 *  · alguien que PEGA el link a mano, que se parsea al mismo par
 *    (`enlaceInternoDelCuerpo`).
 *
 * Server Component: es data, no interacción.
 *
 * ── CUANDO EL ORIGINAL YA NO ESTÁ ───────────────────────────────────────────
 * Las columnas no tienen FK a propósito (así lo fija la migración): si borran la
 * publicación, el mensaje sigue existiendo. Ahí la tarjeta dice que ya no está
 * disponible, y ese mismo estado cubre —sin distinguirlos— el caso de que la
 * publicación exista pero quien la mira no pueda verla. Distinguirlos sería
 * filtrar la existencia de algo privado: "esto existe pero no es para vos" ya es
 * información.
 */

/** Una fila de `listings` reducida a lo que la tarjeta pinta. */
type ListingRow = {
  id: string;
  kind: string;
  title: string | null;
  photos: string[] | null;
  price_amount: number | null;
  price_currency: string | null;
  price_period: string | null;
  attrs: unknown;
  area_label: string | null;
};

type PostRow = {
  id: string;
  body: string | null;
  media: string[] | null;
  video_poster_path: string | null;
  author_id: string | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  area_label: string | null;
};

type GroupRow = {
  id: string;
  name: string;
  avatar_url: string | null;
  member_count: number | null;
};

export interface CompartidoResuelto {
  kind: CompartidoKind;
  id: string;
  titulo: string;
  /** El dato que hace que valga la pena abrirlo: precio, fecha, sueldo, zona. */
  detalle: string | null;
  imagenUrl: string | null;
  href: string;
}

/** La clave con la que se pide y se devuelve cada tarjeta. */
export function claveCompartido(item: EnlaceInterno): string {
  return `${item.kind}:${item.id}`;
}

/** Primeras palabras de un texto, sin cortar una palabra por la mitad. */
function excerpt(texto: string | null | undefined, max = 90): string | null {
  const limpio = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!limpio) return null;
  if (limpio.length <= max) return limpio;
  const cortado = limpio.slice(0, max);
  const ultimoEspacio = cortado.lastIndexOf(" ");
  return `${(ultimoEspacio > 40 ? cortado.slice(0, ultimoEspacio) : cortado).trimEnd()}…`;
}

/** La primera foto de un post, sea del array de medios o el póster del video. */
function portadaDePost(row: PostRow): string | null {
  const primera = (row.media ?? []).find((path) => path && path.trim().length > 0);
  if (primera && !/\.(mp4|mov|webm|m4v)$/i.test(primera)) return postMediaUrl(primera);
  if (row.video_poster_path) return postMediaUrl(row.video_poster_path);
  return primera ? postMediaUrl(primera) : null;
}

/**
 * El dato principal de un aviso, que cambia según el vertical: un empleo se
 * mira por el sueldo, un evento por la fecha y una propiedad por el precio.
 * Cuando el aviso no lo tiene, cae a la zona — que sigue siendo más útil que
 * una línea vacía.
 */
function detalleDeListing(row: ListingRow, locale: string): string | null {
  if (row.kind === "event") {
    const startsAt = parseEventAttrs(
      (row.attrs ?? null) as Parameters<typeof parseEventAttrs>[0],
    ).startsAt;
    if (startsAt) return formatDate(startsAt, { locale, style: "long" });
    return row.area_label;
  }

  const precio = formatListingPrice(
    row.price_amount,
    row.price_currency ?? "usd",
    row.price_period,
    locale,
  );
  return precio ?? row.area_label;
}

/**
 * =============================================================================
 * RESOLVER MUCHAS TARJETAS SIN UNA CONSULTA POR TARJETA
 * =============================================================================
 *
 * Un hilo con veinte tarjetas tiene que costar lo mismo que uno con dos. Por eso
 * la agrupación NO es por `kind` sino POR TABLA: `listing`, `job` y `business`
 * son los tres el mismo `listings`, así que van en un solo `in()`; `post` y
 * `video` son los dos `posts`. Y los autores de esos posts se piden en la MISMA
 * consulta de `profiles` que los perfiles compartidos, en vez de en una propia.
 *
 * Resultado: 4 consultas como techo —`listings`, `posts`, `profiles`,
 * `chat_groups`— sin importar cuántas tarjetas haya, y sólo las de los tipos que
 * realmente aparecen en el hilo.
 *
 * No hay ni un `.eq('tenant_id', …)`: la RLS ya lo aplica en las cuatro tablas y
 * además resuelve la visibilidad. Una fila que no vuelve es una tarjeta "ya no
 * está disponible", que es exactamente lo que hay que mostrar.
 */
export async function resolverCompartidos(
  supabase: SupabaseClient,
  items: readonly EnlaceInterno[],
  opciones: { locale: string },
): Promise<Map<string, CompartidoResuelto>> {
  const resueltos = new Map<string, CompartidoResuelto>();
  if (items.length === 0) return resueltos;

  // Deduplicado antes de consultar: la misma propiedad compartida tres veces en
  // el hilo es UNA fila, no tres.
  const porTabla = {
    listings: new Set<string>(),
    posts: new Set<string>(),
    profiles: new Set<string>(),
    chat_groups: new Set<string>(),
  };

  for (const item of items) {
    switch (item.kind) {
      case "listing":
      case "job":
      case "business":
        porTabla.listings.add(item.id);
        break;
      case "post":
      case "video":
        porTabla.posts.add(item.id);
        break;
      case "profile":
        porTabla.profiles.add(item.id);
        break;
      case "group":
        porTabla.chat_groups.add(item.id);
        break;
    }
  }

  const sinTipar = supabase as SupabaseClient;

  const pedir = async <T,>(
    tabla: string,
    columnas: string,
    ids: Set<string>,
  ): Promise<T[]> => {
    if (ids.size === 0) return [];
    const { data, error } = await sinTipar
      .from(tabla)
      .select(columnas)
      .in("id", [...ids]);
    if (error) {
      // Sin PII: sólo la tabla y el código. Una tarjeta que no resuelve se pinta
      // como "ya no está disponible" y el hilo sigue funcionando.
      console.warn("[compartir] no se pudo resolver una tanda", {
        tabla,
        code: error.code,
      });
      return [];
    }
    return (data ?? []) as T[];
  };

  // Las cuatro tandas son independientes: van juntas, nunca encadenadas.
  const [listings, posts, gruposFilas] = await Promise.all([
    pedir<ListingRow>(
      "listings",
      "id, kind, title, photos, price_amount, price_currency, price_period, attrs, area_label",
      porTabla.listings,
    ),
    pedir<PostRow>("posts", "id, body, media, video_poster_path, author_id", porTabla.posts),
    pedir<GroupRow>(
      "chat_groups",
      "id, name, avatar_url, member_count",
      porTabla.chat_groups,
    ),
  ]);

  // Los autores se suman a la MISMA tanda de perfiles: un hilo con quince posts
  // de tres autores sigue siendo una sola consulta a `profiles`.
  for (const post of posts) {
    if (post.author_id) porTabla.profiles.add(post.author_id);
  }
  const perfiles = await pedir<ProfileRow>(
    "profiles",
    "id, display_name, avatar_url, area_label",
    porTabla.profiles,
  );

  const listingById = new Map(listings.map((row) => [row.id, row]));
  const postById = new Map(posts.map((row) => [row.id, row]));
  const perfilById = new Map(perfiles.map((row) => [row.id, row]));
  const grupoById = new Map(gruposFilas.map((row) => [row.id, row]));

  for (const item of items) {
    const clave = claveCompartido(item);
    if (resueltos.has(clave)) continue;

    switch (item.kind) {
      case "listing":
      case "job":
      case "business": {
        const row = listingById.get(item.id);
        if (!row) break;
        resueltos.set(clave, {
          kind: item.kind,
          id: item.id,
          titulo: row.title ?? SHARED_CARD_COPY.etiqueta[item.kind],
          detalle: detalleDeListing(row, opciones.locale),
          imagenUrl: firstPhotoUrl(row.photos),
          // El vertical sale de la BASE y no del kind guardado: un aviso que
          // cambió de sección sigue abriendo donde vive hoy.
          href: hrefDeCompartido("listing", item.id, row.kind),
        });
        break;
      }
      case "post":
      case "video": {
        const row = postById.get(item.id);
        if (!row) break;
        const autor = row.author_id ? perfilById.get(row.author_id) : undefined;
        resueltos.set(clave, {
          kind: item.kind,
          id: item.id,
          titulo:
            excerpt(row.body) ??
            autor?.display_name ??
            SHARED_CARD_COPY.sinTitulo[item.kind],
          detalle: autor?.display_name ?? null,
          imagenUrl: portadaDePost(row),
          href: hrefDeCompartido(item.kind, item.id),
        });
        break;
      }
      case "profile": {
        const row = perfilById.get(item.id);
        if (!row) break;
        resueltos.set(clave, {
          kind: "profile",
          id: item.id,
          titulo: row.display_name ?? SHARED_CARD_COPY.sinTitulo.profile,
          detalle: row.area_label,
          imagenUrl: row.avatar_url,
          href: hrefDeCompartido("profile", item.id),
        });
        break;
      }
      case "group": {
        const row = grupoById.get(item.id);
        if (!row) break;
        resueltos.set(clave, {
          kind: "group",
          id: item.id,
          titulo: row.name,
          detalle:
            row.member_count === null
              ? null
              : `${row.member_count} ${row.member_count === 1 ? "integrante" : "integrantes"}`,
          imagenUrl: row.avatar_url,
          href: hrefDeCompartido("group", item.id),
        });
        break;
      }
    }
  }

  return resueltos;
}

/** Un ícono por tipo: la tarjeta se lee de un vistazo aun sin foto. */
const ICONO: Record<CompartidoKind, typeof ImageSquare> = {
  post: ImageSquare,
  listing: Storefront,
  job: Briefcase,
  business: Storefront,
  video: VideoCamera,
  profile: UserCircle,
  group: UsersThree,
};

export interface SharedCardProps {
  /** `null` cuando el original no existe o quien mira no puede verlo. */
  compartido: CompartidoResuelto | null;
  /** Tipo guardado en el mensaje. Se usa para la etiqueta del estado vacío. */
  kind: CompartidoKind;
  /** true en la burbuja propia: la tarjeta se apoya sobre `brand-tint`. */
  isOwn?: boolean;
  className?: string;
}

/**
 * La tarjeta dentro de la burbuja.
 *
 * Se apoya en los tokens del tema y no en colores propios, porque vive sobre dos
 * superficies distintas —`brand-tint` en la burbuja propia, `surface-subtle` en
 * la ajena— y tiene que sostener el contraste en las dos, en claro y en oscuro.
 */
export function SharedCard({ compartido, kind, isOwn = false, className }: SharedCardProps) {
  if (!compartido) {
    const IconoVacio = ICONO[kind];
    return (
      <div
        className={cn(
          "flex items-start gap-2.5 rounded-xl border border-dashed border-border px-3 py-2.5",
          "bg-surface/60",
          className,
        )}
      >
        <IconoVacio
          size={18}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-foreground-muted"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground-secondary">
            {SHARED_CARD_COPY.noDisponible[kind]}
          </span>
          <span className="mt-0.5 block text-xs text-foreground-muted">
            {SHARED_CARD_COPY.noDisponibleBody}
          </span>
        </span>
      </div>
    );
  }

  const Icono = ICONO[compartido.kind];

  return (
    <Link
      href={compartido.href}
      aria-label={SHARED_CARD_COPY.abrirEtiqueta(compartido.titulo)}
      className={cn(
        "group flex w-full items-stretch gap-3 overflow-hidden rounded-xl border p-2",
        isOwn ? "border-brand-subtle bg-surface/70" : "border-border-subtle bg-surface",
        // Sólo transform y colores: nada que provoque reflow dentro de una lista
        // de mensajes que puede tener cientos de burbujas.
        "transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
        "hover:border-brand hover:bg-brand-tint active:scale-[0.985]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        className,
      )}
    >
      <span className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-surface-subtle">
        {compartido.imagenUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- miniatura de 64px dentro de una lista larga: next/image no aporta y suma un round-trip al optimizador por cada burbuja
          <img src={compartido.imagenUrl} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-foreground-muted">
            <Icono size={22} aria-hidden="true" />
          </span>
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col justify-center py-0.5">
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
          <Icono size={12} weight="fill" aria-hidden="true" />
          {SHARED_CARD_COPY.etiqueta[compartido.kind]}
        </span>
        <span className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-foreground group-hover:text-brand-ink">
          {compartido.titulo}
        </span>
        {compartido.detalle && (
          <span className="numeric mt-0.5 truncate text-sm font-bold text-brand-ink">
            {compartido.detalle}
          </span>
        )}
      </span>

      <span className="flex shrink-0 items-center pr-1 text-foreground-muted">
        <ArrowUpRight
          size={16}
          aria-hidden="true"
          className="transition-transform duration-(--duration-fast) group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand"
        />
      </span>
    </Link>
  );
}

/**
 * Íconos que la tarjeta usa según el tipo, expuestos para que quien arme la
 * burbuja pueda pintar el mismo símbolo en otro lado (una vista previa, un
 * resumen de la bandeja) sin volver a decidir el mapeo.
 */
export { ICONO as ICONO_DE_COMPARTIDO };

/** Lo que la bandeja muestra como último mensaje cuando el mensaje es una tarjeta. */
export function resumenDeCompartido(kind: CompartidoKind): string {
  return SHARED_CARD_COPY.resumen[kind];
}

/** Reexport por comodidad de quien pinta el hilo. */
export type { CompartidoKind, EnlaceInterno };
