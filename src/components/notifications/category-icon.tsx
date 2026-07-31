import type { ReactNode } from "react";
import {
  Briefcase,
  Buildings,
  CalendarBlank,
  ChatCircle,
  CreditCard,
  Handshake,
  House,
  Megaphone,
  ShieldWarning,
  Sparkle,
  Storefront,
  UserCircle,
  UsersThree,
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
};

/**
 * Pastilla redonda con el ícono del módulo. Es la identidad visual de la fila:
 * sin foto de quien originó el aviso (la tabla no guarda actor), el ícono es lo
 * que deja reconocer de qué se trata sin leer. Decorativo para el lector de
 * pantalla — la categoría ya viaja en el texto de la fila.
 */
export function CategoryIcon({
  category,
  className,
}: {
  category: NotificationCategory;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full",
        "bg-surface-subtle text-foreground-secondary",
        className,
      )}
    >
      {ICONS[category]}
    </span>
  );
}
