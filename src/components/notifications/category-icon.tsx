import type { ReactNode } from "react";
import {
  Briefcase,
  Buildings,
  CalendarBlank,
  ChatCircle,
  ClockCountdown,
  CreditCard,
  Handshake,
  House,
  MagnifyingGlass,
  Megaphone,
  ShieldWarning,
  ShoppingBag,
  Sparkle,
  Storefront,
  Toolbox,
  UserCircle,
  UsersThree,
  Wrench,
} from "@phosphor-icons/react/dist/ssr";
import type { NotificationCategory } from "@/lib/notifications/categories";
import { cn } from "@/lib/utils";

/**
 * El ícono de cada categoría.
 *
 * Es un mapa de ELEMENTOS ya construidos, no de componentes: resolver un
 * componente adentro del render (`const Glyph = mapa[x]; <Glyph/>`) le hace
 * perder el estado en cada render y el compilador de React lo marca como error.
 * Acá los elementos se crean una vez, al cargar el módulo, y se reusan.
 *
 * El mapa vive en este archivo y no en `lib/notifications/categories.ts` a
 * propósito: ese módulo lo importan tests en entorno node y client components, y
 * no tiene por qué arrastrar el árbol de Phosphor.
 *
 * Un solo peso de trazo en toda la pantalla, como el resto de la app: mezclar
 * `fill` y `regular` en el mismo nivel jerárquico se lee desprolijo.
 */
const SIZE = 20;

const ICONS: Record<NotificationCategory, ReactNode> = {
  social: <UsersThree size={SIZE} />,
  mensajes: <ChatCircle size={SIZE} />,
  trabajos: <Briefcase size={SIZE} />,
  creator: <Handshake size={SIZE} />,
  marketplace: <Storefront size={SIZE} />,
  propiedades: <House size={SIZE} />,
  eventos: <CalendarBlank size={SIZE} />,
  negocios: <Buildings size={SIZE} />,
  publicidad: <Megaphone size={SIZE} />,
  pagos: <CreditCard size={SIZE} />,
  seguridad: <ShieldWarning size={SIZE} />,
  cuenta: <UserCircle size={SIZE} />,
  plataforma: <Sparkle size={SIZE} />,
  // Un reloj con cuenta regresiva, no un tacho ni un cartel de alerta: lo que
  // pasa es que se acaba un plazo, no que se destruya algo (0098).
  vencimientos: <ClockCountdown size={SIZE} />,
};

/**
 * El ícono del MÓDULO del que viene el aviso (0151).
 *
 * Pedido textual del cliente: «que le ponga el ícono dependiendo qué
 * notificación: si es por vivienda, eventos, negocios o un mensaje». La
 * categoría no alcanza para eso — los avisos de vencimiento de una casa, de un
 * empleo y de un evento caen los tres en `vencimientos` y mostraban el mismo
 * reloj. El vertical viaja en `entity_kind` desde 0151.
 *
 * Las claves son los valores reales de `listings.kind`. Un vertical que no esté
 * acá cae al ícono de la categoría, que sigue siendo una respuesta correcta.
 */
const ENTITY_KIND_ICONS: Record<string, ReactNode> = {
  property: <House size={SIZE} />,
  job: <Briefcase size={SIZE} />,
  event: <CalendarBlank size={SIZE} />,
  business: <Buildings size={SIZE} />,
  product: <ShoppingBag size={SIZE} />,
  service: <Wrench size={SIZE} />,
  professional: <Toolbox size={SIZE} />,
  creator_gig: <Handshake size={SIZE} />,
  lost_found: <MagnifyingGlass size={SIZE} />,
};

const BADGE_SIZE = 11;

/** Mismo mapa, en el tamaño del distintivo que va sobre la miniatura. */
const ENTITY_KIND_BADGES: Record<string, ReactNode> = {
  property: <House size={BADGE_SIZE} weight="fill" />,
  job: <Briefcase size={BADGE_SIZE} weight="fill" />,
  event: <CalendarBlank size={BADGE_SIZE} weight="fill" />,
  business: <Buildings size={BADGE_SIZE} weight="fill" />,
  product: <ShoppingBag size={BADGE_SIZE} weight="fill" />,
  service: <Wrench size={BADGE_SIZE} weight="fill" />,
  professional: <Toolbox size={BADGE_SIZE} weight="fill" />,
  creator_gig: <Handshake size={BADGE_SIZE} weight="fill" />,
  lost_found: <MagnifyingGlass size={BADGE_SIZE} weight="fill" />,
};

/**
 * Pastilla redonda con el ícono del módulo. Es la identidad visual de la fila:
 * sin foto de quien originó el aviso, el ícono es lo que deja reconocer de qué
 * se trata sin leer. Decorativo para el lector de pantalla — la categoría ya
 * viaja en el texto de la fila.
 *
 * `entityKind` gana sobre `category` cuando hay: es el dato más específico.
 */
export function CategoryIcon({
  category,
  entityKind,
  className,
}: {
  category: NotificationCategory;
  entityKind?: string | null;
  className?: string;
}) {
  const glyph = (entityKind ? ENTITY_KIND_ICONS[entityKind] : null) ?? ICONS[category];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full",
        "bg-surface-subtle text-foreground-secondary",
        className,
      )}
    >
      {glyph}
    </span>
  );
}

/**
 * LA IDENTIDAD DE LA FILA: miniatura + distintivo del módulo.
 *
 * El cliente pidió dos cosas que son la misma: «los logitos de dónde vienen las
 * publicaciones» (por escrito) y el ícono por vertical (en audio). Las dos se
 * resuelven en un solo objeto — la foto dice DE CUÁL publicación habla el aviso,
 * el distintivo dice DE QUÉ MÓDULO es. Con veinte avisos en la bandeja, la foto
 * es lo que se reconoce sin leer.
 *
 * Tres estados, en orden de cuánto contexto dan:
 *   1. foto + distintivo del módulo,
 *   2. sólo el ícono del módulo (la publicación no tiene fotos),
 *   3. el ícono de la categoría (avisos sin entidad: seguridad, pagos, sistema).
 *
 * Nada de sombras teñidas: el relieve lo da un anillo de borde sobre la foto y
 * el recorte del distintivo contra la superficie de la fila.
 */
export function NotificationAvatar({
  category,
  entityKind,
  imageUrl,
  unread,
  className,
}: {
  category: NotificationCategory;
  entityKind?: string | null;
  /**
   * URL YA RESUELTA. La base guarda el valor crudo de `listings.photos` y es el
   * servidor el que lo pasa por `listingPhotoUrl()`: este archivo lo importa el
   * panel, que es `"use client"`, y no tiene por qué arrastrar el barrel de
   * listings al bundle del navegador para resolver un prefijo.
   */
  imageUrl?: string | null;
  unread?: boolean;
  className?: string;
}) {
  if (!imageUrl) {
    return (
      <CategoryIcon
        category={category}
        entityKind={entityKind}
        className={cn(unread && "bg-brand-tint text-brand-ink", className)}
      />
    );
  }

  const badge = entityKind ? ENTITY_KIND_BADGES[entityKind] : null;

  return (
    <span aria-hidden="true" className={cn("relative size-10 shrink-0", className)}>
      {/* <img> pelado y no next/image: las fotos sembradas viven en hosts
          externos y next/image LANZA en runtime con un host fuera del allowlist.
          A este tamaño (40px, ya recortado por el navegador) la optimización no
          compra nada que justifique el riesgo de una pantalla caída. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- puede ser una URL externa de seed: host fuera del allowlist de next/image */}
      <img
        src={imageUrl}
        alt=""
        loading="lazy"
        // El fondo va en el <img> y no sólo en el contenedor: una foto que ya no
        // existe (el aviso se borró, el bucket se limpió) degrada a un cuadro
        // neutro con el distintivo del módulo encima, no a un ícono roto. Sin
        // `onError`, que obligaría a este archivo a ser "use client" y lo
        // importan también Server Components.
        className="size-full rounded-xl bg-surface-subtle object-cover ring-1 ring-border-subtle"
      />
      {badge && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 flex size-[18px] items-center justify-center rounded-full",
            "border-2 border-surface bg-surface-subtle text-foreground-secondary",
            unread && "bg-brand-tint text-brand-ink",
          )}
        >
          {badge}
        </span>
      )}
    </span>
  );
}
