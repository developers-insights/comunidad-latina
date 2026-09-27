"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowSquareOut,
  DotsThree,
  Eye,
  EyeSlash,
  ListBullets,
  Megaphone,
  PencilSimple,
  Storefront,
  Trash,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { pausarAvisoAction } from "@/app/(app)/publicaciones/editar-actions";
import { eliminarAvisoAction } from "@/app/(app)/publicaciones/eliminar-action";
import { AUTH_REASON, useRequireAuth } from "@/components/auth/auth-sheet";
import { ReportScamButton, ReportSheet } from "@/components/trust";
import { BottomSheet, Button, Dialog, useToast } from "@/components/ui";
import {
  EDICION_COPY,
  editaEnPaginaPropia,
  puedePausarse,
  puedeReactivarse,
} from "@/lib/listings/edicion";
import { listingViewHref } from "@/lib/monetization/href";
import { cn } from "@/lib/utils";
import { ListingEditSheet } from "./listing-edit-sheet";

/**
 * El menú ⋯ de un aviso: el mismo gesto y el mismo orden que `PostMenu`
 * (Nacho, 23/9: "en los anuncios del feed falta la sección de editarlo").
 *
 * `esMio` lo resuelve el SERVIDOR (o el feed comparando la sesión con el autor)
 * y sólo decide qué filas se dibujan: la autorización real vive en las server
 * actions (releen la fila por tenant y dueño) y en la RLS.
 *
 * Pausar no cuesta revisión; editar sí (ver `lib/listings/edicion.ts`: el WITH
 * CHECK de `listings_update` no deja al dueño escribir `published`).
 */

export const LISTING_MENU_COPY = {
  promocionar: "Promocionar",
  abrirEnOtraPestana: "Abrir en otra pestaña",
  eliminar: "Eliminar aviso",
  eliminarTitulo: "¿Eliminar este aviso?",
  eliminarCuerpo:
    "Deja de verse en el feed y en su sección, y se borran sus comentarios y me gusta. No se puede deshacer.",
  eliminarConfirmar: "Sí, eliminarlo",
  eliminando: "Eliminando…",
  eliminarCancelar: "No, dejarlo",
  eliminadoTitulo: "Aviso eliminado",
  eliminadoCuerpo: "Ya no aparece en la comunidad.",
} as const;

const MENU_ROW = [
  "flex min-h-11 w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-medium",
  "transition-colors duration-(--duration-fast) hover:bg-surface-subtle",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
  "disabled:pointer-events-none disabled:opacity-50",
];

/**
 * Lo que una tarjeta necesita saber para decidir si dibuja el menú. Un
 * BOOLEANO y no un id: ningún identificador de nadie baja por esta vía.
 * Ausente = esa superficie no resuelve la propiedad y no se ofrece el menú.
 */
export interface ListingOwnerView {
  esMio: boolean;
  /** `listings.status`. Ver el default de `ListingOwnerMenuProps.status`. */
  status?: string;
  /** Pausa automática por denuncias (0118): el dueño no la levanta. */
  pausadoPorReportes?: boolean;
  /** El feed ofrece Reportar a quien no es dueño; las grillas de módulo, no. */
  reportable?: boolean;
  haySesion?: boolean;
}

export interface ListingOwnerMenuProps {
  listingId: string;
  kind: string;
  /** Entra en el nombre accesible del botón: en una grilla hay muchos ⋯. */
  title: string;
  esMio?: boolean;
  /**
   * El default es `published` porque todas las grillas públicas filtran por
   * ese status; una superficie que muestre otros tiene que pasarlo.
   */
  status?: string;
  pausadoPorReportes?: boolean;
  reportable?: boolean;
  haySesion?: boolean;
  /** Cambia sólo el vestido del botón (contraste sobre la foto), no el área táctil. */
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
  reportable = false,
  haySesion = false,
  sobreFoto = false,
  className,
}: ListingOwnerMenuProps) {
  const router = useRouter();
  const requireAuth = useRequireAuth();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Eco del servidor, no optimismo: el rótulo cambia recién con el `ok`, para
  // que "Pausar" no siga diciendo "Pausar" un segundo largo y se toque de nuevo.
  const [statusActual, setStatusActual] = useState(status);

  if (!esMio && !reportable) return null;

  const paginaPropia = editaEnPaginaPropia(kind);
  const puedePausar = esMio && puedePausarse(statusActual);
  const puedeReactivar = esMio && puedeReactivarse(statusActual, pausadoPorReportes);
  const puedeEliminar = esMio && !paginaPropia;

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

  function abrirReporte() {
    setMenuOpen(false);
    if (!haySesion) {
      requireAuth({
        reason: AUTH_REASON.report,
        foldPostDetail: false,
        onAuthenticated: () => setReportOpen(true),
      });
      return;
    }
    setReportOpen(true);
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
          {esMio && (
            <Link
              href={`/impulsar/${listingId}`}
              onClick={() => setMenuOpen(false)}
              className={cn(MENU_ROW, "text-sponsored-ink")}
            >
              <Megaphone size={18} weight="fill" aria-hidden="true" className="shrink-0" />
              {LISTING_MENU_COPY.promocionar}
            </Link>
          )}

          {esMio &&
            (paginaPropia ? (
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
            ))}

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

          {/* Ancla de verdad y no window.open(): clic del medio, copiar enlace y
              ningún bloqueador de pop-ups en el medio. */}
          <a
            href={listingViewHref(kind, listingId)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuOpen(false)}
            className={cn(MENU_ROW, "text-foreground")}
          >
            <ArrowSquareOut size={18} aria-hidden="true" className="shrink-0" />
            {LISTING_MENU_COPY.abrirEnOtraPestana}
          </a>

          {!esMio && reportable && <ReportScamButton variant="menu-item" onReport={abrirReporte} />}

          {esMio && (
            <Link
              href="/publicaciones"
              onClick={() => setMenuOpen(false)}
              className={cn(MENU_ROW, "text-foreground-secondary")}
            >
              <ListBullets size={18} aria-hidden="true" className="shrink-0" />
              {EDICION_COPY.menu.verMisPublicaciones}
            </Link>
          )}

          {puedeEliminar && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setMenuOpen(false);
                setDeleteOpen(true);
              }}
              className={cn(MENU_ROW, "mt-1 border-t border-border pt-4 text-danger")}
            >
              <Trash size={18} aria-hidden="true" className="shrink-0" />
              {LISTING_MENU_COPY.eliminar}
            </button>
          )}
        </div>
      </BottomSheet>

      {esMio && !paginaPropia && (
        <ListingEditSheet
          open={editOpen}
          onClose={() => setEditOpen(false)}
          listingId={listingId}
          kind={kind}
          onGuardado={(nuevoStatus) => setStatusActual(nuevoStatus)}
        />
      )}

      {puedeEliminar && (
        <EliminarAvisoDialog
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          listingId={listingId}
        />
      )}

      {!esMio && reportable && (
        <ReportSheet
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          targetKind="listing"
          targetId={listingId}
          contextLabel={title}
        />
      )}
    </>
  );
}

function EliminarAvisoDialog({
  open,
  onClose,
  listingId,
}: {
  open: boolean;
  onClose: () => void;
  listingId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const errorId = useId();

  function confirmar() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await eliminarAvisoAction({ listingId, confirmed: true });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({
        title: LISTING_MENU_COPY.eliminadoTitulo,
        description: LISTING_MENU_COPY.eliminadoCuerpo,
        variant: "success",
      });
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onClose={isPending ? () => {} : onClose}
      highRisk
      title={LISTING_MENU_COPY.eliminarTitulo}
      description={LISTING_MENU_COPY.eliminarCuerpo}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
            className="sm:min-w-32"
          >
            {LISTING_MENU_COPY.eliminarCancelar}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={confirmar}
            loading={isPending}
            aria-describedby={error ? errorId : undefined}
            className="sm:min-w-36"
          >
            {isPending ? LISTING_MENU_COPY.eliminando : LISTING_MENU_COPY.eliminarConfirmar}
          </Button>
        </>
      }
    >
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/**
 * El mismo menú, arriba a la derecha de la media. Va como HERMANO del botón de
 * la foto (un botón dentro de otro es HTML inválido y el clic abriría también
 * el visor) y en las mismas coordenadas que los overlays de `CardMedia`. Quien
 * lo monta tiene que garantizar un ancestro `relative`.
 */
export function ListingOwnerMenuOverlay(props: ListingOwnerMenuProps) {
  if (!props.esMio && !props.reportable) return null;
  return (
    <div className="absolute right-2.5 top-2.5 z-10">
      <ListingOwnerMenu {...props} sobreFoto />
    </div>
  );
}

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
