import Link from "next/link";
import type { ReactNode } from "react";
import { bubbleStyle, bubbleVariants } from "./bubble";
import { cn } from "@/lib/utils";

/**
 * Tarjeta cuadrada de categoría: ícono grande arriba, etiqueta abajo, acento
 * pastel propio. Es el mismo cuadrado que ya dibuja `ModuleBubble` en modo
 * `tile` para /buscar y el menú lateral —EXTRAÍDO de ahí a propósito (pedido
 * del cliente, rediseño de Comunidad 2026-08-13: «mantener los cuadrados
 * iguales en la parte de búsqueda, pero en la sección de comunidad»)— para que
 * las dos superficies dibujen el mismo objeto desde el mismo lugar en vez de
 * mantener dos copias que un día se van a desalinear.
 *
 * `ModuleBubble` sigue siendo dueño de lo que es PROPIO de un módulo de
 * plataforma (el estado "muy pronto", el anillo de activo, el ícono 3D del set
 * Meshy) y delega acá el cuadrado en sí. Este componente no sabe nada de
 * `tenants.modules` ni de moderación de secciones: sólo sabe dibujar un link
 * cuadrado con acento — por eso le sirve igual a la grilla de plataforma que a
 * la grilla de categorías DENTRO de un módulo (Comunidad).
 */
export interface SquareTileProps {
  href: string;
  /** Lo único que se LEE en el cuadrado — sustantivo corto, como "Vivienda". */
  label: string;
  /**
   * Contexto accesible extra, invisible (`sr-only`). Un cuadrado sólo dice
   * "Guías" o "Voluntarios"; quien usa lector de pantalla se beneficia de una
   * frase más que aclare qué hay adentro ANTES de entrar. No se ve porque el
   * cuadrado visual tiene que quedar tan limpio como el de /buscar.
   */
  hint?: string;
  /**
   * Ícono Phosphor ya instanciado (28px), SIN color propio: toma el del chip
   * por herencia de `currentColor` (ver `--bubble-ink` más abajo). Se ignora
   * si `image` está presente.
   */
  icon?: ReactNode;
  /** Ícono 3D premium (Meshy), full-bleed en el chip. Mismo contrato que ModuleBubble. */
  image?: string;
  /** Acento del módulo — SIEMPRE una custom property (`var(--accent-…)`), nunca un color crudo. */
  accent: string;
  /**
   * Contenido extra bajo la etiqueta (ej. "3 casos abiertos"). Crece DENTRO de
   * la celda del grid: como el `<li>` de una fila CSS Grid estira parejo a
   * todos sus vecinos (`align-items: stretch` es el default), una tarjeta con
   * badge no empuja ni desalinea a las que no lo tienen — sólo dejan más aire
   * arriba y abajo del centro, que es donde vive todo el contenido (`justify-
   * center`).
   */
  badge?: ReactNode;
  className?: string;
  /** El menú lateral lo usa para cerrarse al navegar; el resto no lo pasa. */
  onNavigate?: () => void;
}

export function SquareTile({
  href,
  label,
  hint,
  icon,
  image,
  accent,
  badge,
  className,
  onNavigate,
}: SquareTileProps) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      prefetch={false}
      style={bubbleStyle(accent)}
      className={cn(
        bubbleVariants({ tone: "accentSoft", shape: "tile", size: "none", interactive: true }),
        "flex h-full min-h-[7.5rem] flex-col items-center justify-center gap-2 p-3 text-center",
        className,
      )}
    >
      {/* `--bubble-wash`/`--bubble-ink` los define `bubbleStyle(accent)` de
          arriba y bajan por herencia — mismo par que ya usa `ComunidadHeading`
          para su propio chip. Sin color propio en el ícono: lo hereda del
          `text-[var(--bubble-ink)]` de acá vía `currentColor`. */}
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--bubble-wash)] text-[var(--bubble-ink)]"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- ícono 3D local, mismo contrato que ModuleBubble
          <img src={image} alt="" width={56} height={56} loading="lazy" className="size-full object-cover" />
        ) : (
          icon
        )}
      </span>
      <span className="flex min-w-0 flex-col items-center gap-1 text-sm leading-tight">
        <span className="min-w-0 font-medium text-foreground">{label}</span>
        {badge}
        {/* Después del badge a propósito: si hay contador, se lee "Perdido y
            encontrado, 3 casos abiertos, Buscá por zona…" — el dato vivo antes
            que la descripción estática. */}
        {hint && <span className="sr-only">{hint}</span>}
      </span>
    </Link>
  );
}
