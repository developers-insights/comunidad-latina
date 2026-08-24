"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  CaretRight,
  Check,
  PlusCircle,
  Storefront,
  UserCircle,
  UserSwitch,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, BottomSheet, Spinner, buttonVariants, useToast } from "@/components/ui";
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
 *
 * ── LA SEGUNDA PUERTA (2026-08-24) ──────────────────────────────────────────
 * El cliente fue a buscar el cambiador en /perfil, no en el header — ahí es
 * donde su intuición lo esperaba. `PerfilCambiarIdentidad` abre esa puerta sin
 * escribir un segundo cambiador: comparte `useIdentitySwitcherState` y
 * `<IdentitySwitcherSheet>` con el `IdentitySwitcher` de acá arriba, así que hay
 * una sola función que decide con qué identidad se puede actuar y una sola hoja
 * que lo pinta. La promesa visual se sostiene también desde ahí: el botón
 * cambia de ícono y de color mientras se actúa como negocio (nunca solo de
 * color — ver `BusinessBadge` más abajo, mismo criterio).
 *
 * Sin ningún negocio, no hay nada que cambiar: la puerta ofrece CREARLO
 * (`/negocios/cuenta`) en vez de abrir una hoja vacía. Es el caso exacto del
 * cliente (Giovanni no tenía cuenta de negocio, así que nunca vio el avatar
 * cambiar) — antes esa puerta no existía en ningún lado.
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

/** Fila de la hoja: botón grande, misma clase para las tres filas de identidad. */
const filaClase = cn(
  "flex w-full items-center gap-3 rounded-lg p-2.5 text-left",
  "transition-colors duration-(--duration-fast) ease-(--ease-spring)",
  "hover:bg-surface-subtle active:scale-[0.99]",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
  "disabled:pointer-events-none disabled:opacity-60",
);

/**
 * El estado y la mutación, en un solo lugar. Los DOS disparadores de este
 * archivo (el avatar del header y la puerta de /perfil) llaman a este mismo
 * hook: una sola vez que se resuelve "con quién estoy actuando" y una sola
 * llamada a `cambiarIdentidad`, nunca dos implementaciones que puedan divergir.
 */
function useIdentitySwitcherState({ personal, negocios, activeBusinessId }: IdentitySwitcherProps) {
  const [open, setOpen] = useState(false);
  const [pendiente, setPendiente] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  const activo = negocios.find((negocio) => negocio.businessId === activeBusinessId);

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

  return { open, setOpen, pendiente, activo, elegir };
}

interface SheetProps extends IdentitySwitcherProps {
  open: boolean;
  onClose: () => void;
  pendiente: string | null;
  elegir: (businessId: string | null, nombre: string) => void;
}

/** El contenido de la hoja, igual para los dos disparadores. */
function IdentitySwitcherSheet({
  personal,
  negocios,
  activeBusinessId,
  open,
  onClose,
  pendiente,
  elegir,
}: SheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title={C.sheet.title}>
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
        <Link href="/perfil" onClick={onClose} className={filaClase}>
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

        <Link href="/negocios/cuenta" onClick={onClose} className={filaClase}>
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
  );
}

/** El avatar del header. Comportamiento sin cambios — ver el docblock de arriba. */
export function IdentitySwitcher(props: IdentitySwitcherProps) {
  const { personal } = props;
  const { open, setOpen, pendiente, activo, elegir } = useIdentitySwitcherState(props);
  const nombreActivo = activo?.nombre ?? personal.displayName;

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

      <IdentitySwitcherSheet
        {...props}
        open={open}
        onClose={() => setOpen(false)}
        pendiente={pendiente}
        elegir={elegir}
      />
    </>
  );
}

/** Ícono + estilo del botón de /perfil según con quién se está actuando. */
const puertaClase = (actuandoComoNegocio: boolean) =>
  cn(
    buttonVariants({ variant: "outline", size: "md" }),
    "flex-1",
    // Mientras se actúa como negocio, la puerta lo dice sin depender SOLO del
    // color (el ícono ya cambió de Storefront a UserSwitch): mismo tratamiento
    // que el aviso de Ajustes para la misma situación — una sola gramática
    // visual para "estás actuando como tu negocio" en toda la app.
    actuandoComoNegocio &&
      "border-brand/30 bg-brand-tint text-brand-ink hover:bg-brand-tint/80",
  );

/**
 * La puerta de /perfil cuando YA hay al menos un negocio: abre la MISMA hoja
 * que el avatar del header (ver el docblock del archivo, "LA SEGUNDA PUERTA").
 */
function CambiarIdentidadPuerta(props: IdentitySwitcherProps) {
  const { personal } = props;
  const { open, setOpen, pendiente, activo, elegir } = useIdentitySwitcherState(props);
  const actuandoComoNegocio = activo !== undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={C.switcherLabel(activo?.nombre ?? personal.displayName)}
        className={puertaClase(actuandoComoNegocio)}
      >
        {actuandoComoNegocio ? (
          <Storefront size={16} weight="fill" aria-hidden="true" />
        ) : (
          <UserSwitch size={16} aria-hidden="true" />
        )}
        {C.profileDoor.switchLabel}
      </button>

      <IdentitySwitcherSheet
        {...props}
        open={open}
        onClose={() => setOpen(false)}
        pendiente={pendiente}
        elegir={elegir}
      />
    </>
  );
}

/**
 * La puerta de /perfil cuando TODAVÍA no hay ningún negocio. No hay nada que
 * cambiar, así que no abre la hoja del cambiador: ofrece crear el primero. Es
 * el caso exacto del cliente (ver el docblock del archivo).
 */
function CrearNegocioPuerta() {
  return (
    <Link
      href="/negocios/cuenta"
      title={C.sheet.createBusinessHint}
      aria-label={`${C.sheet.createBusiness} — ${C.sheet.createBusinessHint}`}
      className={cn(buttonVariants({ variant: "outline", size: "md" }), "flex-1")}
    >
      <Storefront size={16} aria-hidden="true" />
      {C.sheet.createBusiness}
    </Link>
  );
}

/**
 * La puerta que va en /perfil, junto a "Editar perfil" / "Verificar" /
 * "Compartir perfil". Decide sola entre las dos puertas de arriba según si la
 * persona ya tiene una cuenta de negocio — el consumidor (`PerfilPage`) no
 * tiene que preguntarlo.
 */
export function PerfilCambiarIdentidad(props: IdentitySwitcherProps) {
  if (props.negocios.length === 0) return <CrearNegocioPuerta />;
  return <CambiarIdentidadPuerta {...props} />;
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
