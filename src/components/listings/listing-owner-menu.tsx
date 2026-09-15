"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DotsThree,
  Eye,
  EyeSlash,
  ListBullets,
  PencilSimple,
  Storefront,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { pausarAvisoAction } from "@/app/(app)/publicaciones/editar-actions";
import { BottomSheet, useToast } from "@/components/ui";
import {
  EDICION_COPY,
  editaEnPaginaPropia,
  puedePausarse,
  puedeReactivarse,
} from "@/lib/listings/edicion";
import { cn } from "@/lib/utils";
import { ListingEditSheet } from "./listing-edit-sheet";

/**
 * =============================================================================
 * EL MENÚ ⋯ DE UN AVISO PROPIO
 * =============================================================================
 *
 * Pedido del dueño del producto: «falta ese botón para todas estas
 * publicaciones. Y el botón de edición, los tres dots ahí arriba». Es,
 * literalmente, el `PostMenu` del feed traído a las nueve tarjetas de aviso: el
 * mismo gesto, el mismo lugar, la misma hoja que se abre sobre el contenido sin
 * sacar a nadie de la grilla.
 *
 * ── QUE EL BOTÓN NO SE DIBUJE NO ES LA SEGURIDAD ───────────────────────────
 * `esMio` lo resuelve el SERVIDOR comparando `listings.created_by` contra la
 * sesión, y llega hasta acá como un booleano — no viaja ningún id de nadie.
 * La autorización real la deciden las server actions (releen la fila filtrando
 * por tenant y dueño) y la RLS. Acá sólo se evita ofrecer algo que iba a
 * rebotar, igual que en `PostMenu`.
 *
 * ── POR QUÉ NO ESTÁ "ELIMINAR" ─────────────────────────────────────────────
 * Porque el ciclo de vida de un aviso YA tiene su pantalla: /publicaciones, con
 * renovar, "marcar como alquilado/vendido" y los plazos. Un borrado suelto en
 * una grilla, a un toque de distancia de la foto que se estaba mirando, es
 * exactamente donde no debería estar lo irreversible. La última fila lleva ahí.
 *
 * ── PAUSAR NO CUESTA UNA REVISIÓN; EDITAR SÍ ───────────────────────────────
 * Y se dice antes de guardar, no después. El motivo completo está en el
 * encabezado de `lib/listings/edicion.ts`: el WITH CHECK de `listings_update`
 * no admite `published` para el dueño, así que un aviso editado vuelve a la
 * cola. Pausar no toca el contenido y por eso es el único gesto sin costo.
 */

/** Fila del menú: un solo lugar que define alto tocable, foco y ritmo. */
const MENU_ROW = [
  "flex min-h-11 w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-medium",
  "transition-colors duration-(--duration-fast) hover:bg-surface-subtle",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
  "disabled:pointer-events-none disabled:opacity-50",
];

/**
 * Lo que una tarjeta necesita saber para decidir si dibuja el menú.
 *
 * Es deliberadamente un BOOLEANO y no un id: el servidor ya comparó
 * `listings.created_by` contra la sesión, así que ningún identificador de nadie
 * baja al navegador por esta vía. Ausente en una superficie = esa superficie
 * todavía no resuelve la propiedad, y entonces no se ofrece el menú — el mismo
 * contrato de "ausente ≠ falso" que ya usa `ListingEngagement`.
 */
export interface ListingOwnerView {
  esMio: boolean;
  /** `listings.status`. Ver el default de `ListingOwnerMenuProps.status`. */
  status?: string;
  /** Pausa automática por denuncias (0118): el dueño no la levanta. */
  pausadoPorReportes?: boolean;
}

export interface ListingOwnerMenuProps {
  listingId: string;
  /** `product`, `property`, `job`… Decide qué campos ofrece la hoja. */
  kind: string;
  /** Entra en el nombre accesible del botón: en una grilla hay muchos ⋯. */
  title: string;
  /**
   * ¿El aviso es de quien está mirando? Lo resuelve el servidor. `false` o
   * ausente → no se dibuja nada, ni un hueco.
   */
  esMio?: boolean;
  /**
   * Estado de la fila. El default es `published` porque TODAS las grillas
   * públicas que montan este menú filtran por ese status; una superficie que
   * muestre otros (p. ej. el panel del perfil) tiene que pasarlo, o el menú
   * ofrecería "Pausar" sobre algo que ya está pausado.
   */
  status?: string;
  /** Pausa por denuncias (0118): no la levanta el dueño. */
  pausadoPorReportes?: boolean;
  /**
   * `true` cuando el botón va SOBRE la foto. Cambia sólo el vestido —fondo
   * oscuro translúcido para tener contraste contra cualquier imagen—, nunca el
   * área táctil, que son 44px en los dos casos.
   */
  sobreFoto?: boolean;
  className?: string;
}

export function ListingOwnerMenu({
  listingId,
  kind,
  title,
  esMio = false,
  status = "published",
  pausadoPorReportes = false,
  sobreFoto = false,
  className,
}: ListingOwnerMenuProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  /**
   * Eco del servidor, no optimismo: el rótulo cambia recién cuando la acción
   * volvió con `ok`. Existe para que "Pausar" pase a "Volver a publicar" en el
   * acto, sin esperar a que el server component se vuelva a renderizar — sin
   * esto la fila sigue diciendo "Pausar" un segundo largo y se toca de nuevo.
   */
  const [statusActual, setStatusActual] = useState(status);

  if (!esMio) return null;

  const paginaPropia = editaEnPaginaPropia(kind);
  const puedePausar = puedePausarse(statusActual);
  const puedeReactivar = puedeReactivarse(statusActual, pausadoPorReportes);

  function cambiarPausa(pausar: boolean) {
    if (isPending) return;
    setMenuOpen(false);
    startTransition(async () => {
      const result = await pausarAvisoAction({ listingId, pausar });
      if (!result.ok) {
        toast({
          title: EDICION_COPY.errores.generico,
          description: result.error,
          variant: "danger",
        });
        return;
      }
      setStatusActual(result.status);
      toast(
        pausar
          ? {
              title: EDICION_COPY.ok.pausadaTitulo,
              description: EDICION_COPY.ok.pausadaCuerpo,
              variant: "success",
            }
          : {
              title: EDICION_COPY.ok.reactivadaTitulo,
              description: EDICION_COPY.ok.reactivadaCuerpo,
              variant: "info",
            },
      );
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label={`${EDICION_COPY.menu.abrir} · ${title}`}
        aria-haspopup="dialog"
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full",
          // El feedback lo da el MOVIMIENTO —levantar y hundir—, nunca un
          // resplandor: nada de sombras teñidas con el color de marca.
          "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
          "active:scale-[0.94]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          sobreFoto
            ? "bg-media-shade/45 text-on-media backdrop-blur-sm hover:bg-media-shade/60"
            : "text-foreground-secondary hover:bg-surface-subtle",
          className,
        )}
      >
        <DotsThree size={22} weight="bold" aria-hidden="true" />
      </button>

      <BottomSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        ariaLabel={EDICION_COPY.menu.abrir}
      >
        <div className="flex flex-col pb-4">
          {paginaPropia ? (
            /* Negocios ya tiene su editor completo —rubro, servicios, horarios,
               logo y portada—: se enlaza, no se duplica en una hoja acotada. */
            <Link
              href={`/negocios/${listingId}/editar`}
              onClick={() => setMenuOpen(false)}
              className={cn(MENU_ROW, "text-foreground")}
            >
              <Storefront size={18} aria-hidden="true" className="shrink-0" />
              {EDICION_COPY.menu.editarNegocio}
            </Link>
          ) : (
            <MenuButton
              icon={PencilSimple}
              label={EDICION_COPY.menu.editar}
              disabled={isPending}
              onClick={() => {
                setMenuOpen(false);
                setEditOpen(true);
              }}
            />
          )}

          {puedePausar && (
            <MenuButton
              icon={EyeSlash}
              label={EDICION_COPY.menu.pausar}
              disabled={isPending}
              onClick={() => cambiarPausa(true)}
            />
          )}

          {puedeReactivar && (
            <MenuButton
              icon={Eye}
              label={EDICION_COPY.menu.reactivar}
              disabled={isPending}
              onClick={() => cambiarPausa(false)}
            />
          )}

          {/* La salida al resto del ciclo de vida: renovar, marcar como
              alquilado/vendido, ver cuánto le queda. Lo irreversible vive
              ahí, con su pantalla y su confirmación, no en esta hoja. */}
          <Link
            href="/publicaciones"
            onClick={() => setMenuOpen(false)}
            className={cn(MENU_ROW, "mt-1 border-t border-border pt-4 text-foreground-secondary")}
          >
            <ListBullets size={18} aria-hidden="true" className="shrink-0" />
            {EDICION_COPY.menu.verMisPublicaciones}
          </Link>
        </div>
      </BottomSheet>

      {!paginaPropia && (
        <ListingEditSheet
          open={editOpen}
          onClose={() => setEditOpen(false)}
          listingId={listingId}
          kind={kind}
          onGuardado={(nuevoStatus) => setStatusActual(nuevoStatus)}
        />
      )}
    </>
  );
}

/**
 * El mismo menú, ya posicionado arriba a la derecha de la media.
 *
 * NO va por el `overlayTopRight` de `CardMedia` y hay dos motivos concretos:
 *
 *  1. En varias tarjetas la foto entera ES un `<button>` (abre el visor). Un
 *     botón dentro de otro botón es HTML inválido y el clic del menú activaría
 *     también el visor. Montado como HERMANO del botón, cada gesto va a lo suyo.
 *  2. `overlayTopRight` ya está ocupado en dos tarjetas (la credencial del
 *     profesional, el chip de urgencia de una colaboración). Compartirlo
 *     obligaría a cada tarjeta a inventar su propio arreglo.
 *
 * Las coordenadas son las MISMAS que usa `CardMedia` para sus overlays
 * (`right-2.5 top-2.5`), así que el ⋯ cae donde caería si fuera uno de ellos.
 * Quien la monta sólo tiene que garantizar un ancestro `relative`.
 */
export function ListingOwnerMenuOverlay(props: ListingOwnerMenuProps) {
  if (!props.esMio) return null;
  return (
    <div className="absolute right-2.5 top-2.5 z-10">
      <ListingOwnerMenu {...props} sobreFoto />
    </div>
  );
}

/** Fila-botón del menú. Existe para que ícono, alto y foco no se repitan. */
function MenuButton({
  icon: MenuIcon,
  label,
  onClick,
  disabled,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(MENU_ROW, "text-foreground")}
    >
      <MenuIcon size={18} aria-hidden="true" className="shrink-0" />
      {label}
    </button>
  );
}
