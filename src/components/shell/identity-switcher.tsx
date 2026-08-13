"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  CaretRight,
  Check,
  PlusCircle,
  Storefront,
  UserCircle,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, BottomSheet, Spinner, useToast } from "@/components/ui";
import { cambiarIdentidad } from "@/lib/perfil-activo/actions";
import { PERFIL_ACTIVO_COPY as C } from "@/lib/perfil-activo/copy";
import type { RolDeNegocio } from "@/lib/perfil-activo/identidad";
import { cn } from "@/lib/utils";

/**
 * =============================================================================
 * CAMBIADOR DE PERFIL — el avatar del header dice con qué identidad estás
 * =============================================================================
 *
 * Pedido del cliente: «serían como tener 2 perfiles en la misma cuenta,
 * dependiendo la cuenta que quieras usar», con el cambiador de Instagram como
 * referencia.
 *
 * ── POR QUÉ ACÁ Y NO EN UN BOTÓN NUEVO ──────────────────────────────────────
 * El header ya lleva cuatro controles a 375px (zona, campana, mensajes, perfil):
 * un quinto no entra sin sacrificar el área táctil de los otros. Y no hace
 * falta, porque el control de identidad ya está: el avatar. Lo dice el propio
 * comentario del header cuando el avatar reemplazó al menú — «es el control de
 * identidad más reconocible que existe en una app social: dice de quién es la
 * sesión ANTES de tocarlo». Esto extiende esa idea: ahora dice de qué PERFIL es
 * la sesión.
 *
 * ── CERO REGRESIÓN PARA QUIEN NO TIENE NEGOCIO ──────────────────────────────
 * Sin cuentas de negocio, el header ni monta este componente: el avatar sigue
 * siendo un link directo a /perfil, igual que siempre (ver header.tsx). El
 * cambiador aparece recién cuando hay algo entre qué elegir — un menú con una
 * sola opción es un menú que estorba.
 *
 * ── LA PROMESA VISUAL ───────────────────────────────────────────────────────
 * Mientras se actúa como negocio, el avatar muestra la insignia del local. No es
 * decoración: es la única señal permanente de que lo que se publique NO va a
 * salir con el nombre propio. Por eso está siempre visible y no dentro de la
 * hoja.
 */

export interface IdentidadNegocioUI {
  businessId: string;
  nombre: string;
  rol: RolDeNegocio;
}

export interface IdentitySwitcherProps {
  personal: { displayName: string; avatarUrl: string | null };
  negocios: IdentidadNegocioUI[];
  /** null = está actuando con su perfil personal. */
  activeBusinessId: string | null;
}

/** Insignia de negocio sobre el avatar. El anillo la despega del fondo. */
function BusinessBadge({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        // `cl-print-hide`: el glifo es tinta `brand-foreground` (clara) sobre un
        // relleno que el papel no imprime — sin el hook queda 1.00:1. Y con qué
        // identidad estabas navegando no significa nada en una hoja impresa.
        "cl-print-hide flex items-center justify-center rounded-full bg-brand text-brand-foreground ring-2 ring-surface",
        small ? "size-3.5" : "size-4",
      )}
    >
      <Storefront size={small ? 9 : 11} weight="fill" />
    </span>
  );
}

export function IdentitySwitcher({
  personal,
  negocios,
  activeBusinessId,
}: IdentitySwitcherProps) {
  const [open, setOpen] = useState(false);
  const [pendiente, setPendiente] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  const activo = negocios.find((negocio) => negocio.businessId === activeBusinessId);
  const nombreActivo = activo?.nombre ?? personal.displayName;

  function elegir(businessId: string | null, nombre: string) {
    // Ya estás en ese perfil: cerrar y no gastar un round-trip.
    if (businessId === activeBusinessId) {
      setOpen(false);
      return;
    }
    setPendiente(businessId ?? "personal");
    startTransition(async () => {
      const resultado = await cambiarIdentidad({ businessId });
      setPendiente(null);
      if (!resultado.ok) {
        toast({ title: resultado.mensaje, variant: "danger" });
        return;
      }
      setOpen(false);
      toast({
        title:
          businessId === null
            ? C.toast.personal(personal.displayName)
            : C.toast.negocio(nombre),
      });
    });
  }

  const filaClase = cn(
    "flex w-full items-center gap-3 rounded-lg p-2.5 text-left",
    "transition-colors duration-(--duration-fast) ease-(--ease-spring)",
    "hover:bg-surface-subtle active:scale-[0.99]",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
    "disabled:pointer-events-none disabled:opacity-60",
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={C.switcherLabel(nombreActivo)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-(--duration-fast) hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        {activo ? (
          <Avatar size="sm" name={activo.nombre} badge={<BusinessBadge small />} />
        ) : (
          <Avatar size="sm" name={personal.displayName} src={personal.avatarUrl} />
        )}
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={C.sheet.title}>
        <p className="mb-3 text-xs text-foreground-secondary">{C.sheet.hint}</p>

        <ul className="flex flex-col gap-0.5">
          <li>
            <button
              type="button"
              onClick={() => elegir(null, personal.displayName)}
              disabled={pendiente !== null}
              aria-current={activeBusinessId === null}
              className={filaClase}
            >
              <Avatar size="md" name={personal.displayName} src={personal.avatarUrl} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {personal.displayName}
                </span>
                <span className="block text-xs text-foreground-secondary">
                  {C.sheet.personalHint}
                </span>
              </span>
              <EstadoDeFila
                activa={activeBusinessId === null}
                cargando={pendiente === "personal"}
              />
            </button>
          </li>

          {negocios.map((negocio) => (
            <li key={negocio.businessId}>
              <button
                type="button"
                onClick={() => elegir(negocio.businessId, negocio.nombre)}
                disabled={pendiente !== null}
                aria-current={negocio.businessId === activeBusinessId}
                className={filaClase}
              >
                <Avatar size="md" name={negocio.nombre} badge={<BusinessBadge />} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {negocio.nombre}
                  </span>
                  <span className="block text-xs text-foreground-secondary">
                    {C.roles[negocio.rol]}
                  </span>
                </span>
                <EstadoDeFila
                  activa={negocio.businessId === activeBusinessId}
                  cargando={pendiente === negocio.businessId}
                />
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-2 flex flex-col gap-0.5 border-t border-border-subtle pt-2 pb-2">
          <Link href="/perfil" onClick={() => setOpen(false)} className={filaClase}>
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-secondary"
            >
              <UserCircle size={20} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
              {C.sheet.personalLabel}
            </span>
            <CaretRight size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
          </Link>

          <Link
            href="/negocios/cuenta"
            onClick={() => setOpen(false)}
            className={filaClase}
          >
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-secondary"
            >
              <PlusCircle size={20} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
              {C.sheet.manage}
            </span>
            <CaretRight size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
          </Link>
        </div>
      </BottomSheet>
    </>
  );
}

/** "En uso" con tilde, o el spinner mientras el servidor confirma el cambio. */
function EstadoDeFila({ activa, cargando }: { activa: boolean; cargando: boolean }) {
  if (cargando) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-foreground-muted">
        <Spinner size={14} />
        {C.sheet.changing}
      </span>
    );
  }
  if (!activa) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-ink">
      <Check size={14} weight="bold" aria-hidden="true" />
      {C.sheet.activeBadge}
    </span>
  );
}
