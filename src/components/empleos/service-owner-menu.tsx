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
  Trash,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { pausarAvisoAction } from "@/app/(app)/publicaciones/editar-actions";
import { eliminarAvisoAction } from "@/app/(app)/publicaciones/eliminar-action";
import { LISTING_MENU_COPY } from "@/components/listings/listing-owner-menu";
import { BottomSheet, Button, Dialog, useToast } from "@/components/ui";
import { EDICION_COPY, puedePausarse, puedeReactivarse } from "@/lib/listings/edicion";
import { listingViewHref } from "@/lib/monetization/href";
import { cn } from "@/lib/utils";
import { ServiceEditSheet, type ServicioGuardado } from "./service-edit-sheet";

/**
 * El ⋯ de un servicio propio. Existe aparte del menú genérico de avisos porque
 * "Editar" acá abre el formulario del servicio (modalidad, zona, días, horario,
 * precio), y el genérico sólo sabe de título, precio, descripción y fotos.
 *
 * `esMio` lo resuelve el servidor; la autorización real vive en las actions.
 */

const MENU_ROW = [
  "flex min-h-11 w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-medium",
  "transition-colors duration-(--duration-fast) hover:bg-surface-subtle",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
  "disabled:pointer-events-none disabled:opacity-50",
];

export interface ServiceOwnerMenuProps {
  listingId: string;
  title: string;
  esMio: boolean;
  status?: string;
  pausadoPorReportes?: boolean;
  onGuardado?: (valores: ServicioGuardado, currency: string) => void;
  className?: string;
}

export function ServiceOwnerMenu({
  listingId,
  title,
  esMio,
  status = "published",
  pausadoPorReportes = false,
  onGuardado,
  className,
}: ServiceOwnerMenuProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [statusActual, setStatusActual] = useState(status);
  const [isPending, startTransition] = useTransition();

  if (!esMio) return null;

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
          "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-secondary",
          "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
          "hover:bg-surface-subtle active:scale-[0.94]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
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
          <Link
            href={`/impulsar/${listingId}`}
            onClick={() => setMenuOpen(false)}
            className={cn(MENU_ROW, "text-sponsored-ink")}
          >
            <Megaphone size={18} weight="fill" aria-hidden="true" className="shrink-0" />
            {LISTING_MENU_COPY.promocionar}
          </Link>

          <MenuButton
            icon={PencilSimple}
            label={EDICION_COPY.menu.editar}
            disabled={isPending}
            onClick={() => {
              setMenuOpen(false);
              setEditOpen(true);
            }}
          />

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

          <a
            href={listingViewHref("service", listingId)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuOpen(false)}
            className={cn(MENU_ROW, "text-foreground")}
          >
            <ArrowSquareOut size={18} aria-hidden="true" className="shrink-0" />
            {LISTING_MENU_COPY.abrirEnOtraPestana}
          </a>

          <Link
            href="/publicaciones"
            onClick={() => setMenuOpen(false)}
            className={cn(MENU_ROW, "text-foreground-secondary")}
          >
            <ListBullets size={18} aria-hidden="true" className="shrink-0" />
            {EDICION_COPY.menu.verMisPublicaciones}
          </Link>

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
        </div>
      </BottomSheet>

      <ServiceEditSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        listingId={listingId}
        onGuardado={(valores, currency) => {
          setStatusActual(valores.status);
          onGuardado?.(valores, currency);
        }}
      />

      <EliminarDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} listingId={listingId} />
    </>
  );
}

function EliminarDialog({
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
