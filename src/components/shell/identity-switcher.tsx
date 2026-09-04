"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  CaretRight,
  Check,
  GearSix,
  PlusCircle,
  SealCheck,
  Storefront,
  UserCircle,
  UserSwitch,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, BottomSheet, Spinner, buttonVariants, useToast } from "@/components/ui";
import { cambiarIdentidad } from "@/lib/perfil-activo/actions";
import { PERFIL_ACTIVO_COPY as C } from "@/lib/perfil-activo/copy";
import type { RolDeNegocio } from "@/lib/perfil-activo/identidad";
import { contarNegociosPropios, lugaresDeNegocio } from "@/lib/perfil-activo/tope";
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
 * Mientras se actúa como negocio, el control del header muestra el NOMBRE del
 * negocio junto a su foto. No es decoración: es la única señal permanente de
 * que lo que se publique NO va a salir con el nombre propio. Por eso está
 * siempre visible y no dentro de la hoja.
 *
 * Hasta el 2026-09-03 esa señal era una insignia de local sobre el avatar
 * PERSONAL, y el cliente la leyó como lo que era —su cara con otra cosa
 * encima—: «debería quedar solamente el nombre de la página». Ver el docblock
 * de `IdentitySwitcher`, abajo.
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
 *
 * ── HASTA DIEZ NEGOCIOS (2026-08-26) ────────────────────────────────────────
 * «Falta agregar otro negocio, ya que la persona puede crear hasta 10 perfiles
 * diferentes.» El cliente mandó una captura de ESTA hoja abierta: la última
 * fila decía "Administrar tu cuenta de negocio" y no había ninguna que dijera
 * agregar. Tres cosas cambian por eso:
 *
 *   1. Una fila propia para AGREGAR, con su verbo y su ícono. No alcanzaba con
 *      renombrar la de administrar: son dos intenciones distintas y quien busca
 *      la primera no lee la segunda. Van a rutas distintas a propósito
 *      (`/negocios/cuenta#nuevo` cae en el formulario, ya scrolleado).
 *   2. La hoja dice cuántos lugares quedan, y cuando no queda ninguno lo dice
 *      con todas las letras en vez de ofrecer un botón que va a fallar.
 *   3. LA LISTA SCROLLEA POR DENTRO. Con diez negocios más el perfil personal
 *      son once filas: a 375 px eso empuja "Agregar" y "Administrar" fuera de
 *      la pantalla, y la persona ve una lista que parece no tener final. La
 *      hoja pasa a ser una columna con la lista scrolleable en el medio y las
 *      acciones ancladas abajo — siempre visibles, no importa cuántos negocios
 *      haya. (`BottomSheet` lo soporta con `bodyClassName`, documentado ahí.)
 *
 * ── LA INSIGNIA DE VERIFICADO, SÓLO EN POSITIVO ─────────────────────────────
 * Cada perfil tiene su propia verificación (0121) y la fila la muestra cuando
 * la tiene. Cuando NO la tiene no se muestra nada, y es deliberado: hoy no hay
 * ninguna identidad verificada en la base, así que el aviso aparecería en las
 * once filas a la vez y la hoja pasaría de ser un cambiador a ser una lista de
 * pendientes. Lo que falta se dice en /perfil/verificar, que es la pantalla que
 * existe para eso.
 */

export interface IdentidadNegocioUI {
  businessId: string;
  nombre: string;
  /**
   * La foto del negocio (primera de su ficha, 0116). `null` → inicial. Sin
   * esto el avatar del header seguía siendo la foto de la PERSONA con una
   * insignia encima, que es lo que hacía que cambiar de perfil se sintiera
   * decorativo: la cara no cambiaba, sólo le aparecía un sello.
   */
  avatarUrl: string | null;
  rol: RolDeNegocio;
  /**
   * ¿Es TUYO o lo administrás para otra persona? Sólo los propios consumen
   * lugares del tope de diez (0103: administrar negocios ajenos no tiene tope).
   *
   * OPCIONAL a propósito: los tres consumidores de este componente
   * (`shell/header.tsx`, `perfil/(lista)/page.tsx`, `perfil/perfil-de-negocio.tsx`)
   * mapean campo por campo, y agregarlo obligatorio los rompería a los tres.
   * Sin el dato no se muestra el contador de lugares y la fila de agregar queda
   * siempre habilitada: el tope lo aplica la base igual, con un mensaje humano.
   * Ofrecer un lugar de más es recuperable; decirle a alguien que llegó al tope
   * sin saberlo, no.
   */
  esPropietario?: boolean;
  /** ¿Este perfil tiene su identidad verificada? (0121) Ver el docblock. */
  verificada?: boolean;
}

export interface IdentitySwitcherProps {
  personal: { displayName: string; avatarUrl: string | null };
  negocios: IdentidadNegocioUI[];
  /** null = está actuando con su perfil personal. */
  activeBusinessId: string | null;
}

/**
 * Insignia de negocio sobre el avatar, DENTRO DE LA HOJA. Ahí las filas son
 * círculos parecidos entre sí y la insignia es lo que separa un negocio del
 * perfil personal de un vistazo. En el header ya no va: el nombre escrito al
 * lado dice lo mismo y mejor (ver el docblock de `IdentitySwitcher`).
 */
function BusinessBadge() {
  return (
    <span
      aria-hidden="true"
      className={cn(
        // `cl-print-hide`: el glifo es tinta `brand-foreground` (clara) sobre un
        // relleno que el papel no imprime — sin el hook queda 1.00:1. Y con qué
        // identidad estabas navegando no significa nada en una hoja impresa.
        "cl-print-hide flex size-4 items-center justify-center rounded-full bg-brand text-brand-foreground ring-2 ring-surface",
      )}
    >
      <Storefront size={11} weight="fill" />
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
  // Sólo los negocios PROPIOS ocupan lugares (ver `IdentidadNegocioUI`). Si
  // ningún consumidor manda `esPropietario`, el conteo da 0 y el contador no se
  // muestra: la fila de agregar queda igual y decide la base.
  const propios = contarNegociosPropios(negocios);
  const lugares = lugaresDeNegocio(propios);
  const sabemosCuantosPropios = propios > 0;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={C.sheet.title}
      // La lista scrollea por dentro y las acciones quedan ancladas abajo. Con
      // el `overflow-y-auto` por default del BottomSheet, once filas empujaban
      // "Agregar otro negocio" fuera de la pantalla a 375 px. Ver el docblock.
      bodyClassName="flex min-h-0 flex-col overflow-hidden px-6 pb-2 pt-4"
    >
      <p className="mb-3 shrink-0 text-xs text-foreground-secondary">{C.sheet.hint}</p>

      {/* `min-h-0` es lo que permite que este hijo del flex se achique por
          debajo de su contenido; sin él el navegador le da min-height:auto y no
          scrollea nunca. `overscroll-contain` evita que el scroll se encadene a
          la página de atrás cuando la lista llega al final. */}
      <ul className="-mx-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain px-1">
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
              <Avatar
                size="md"
                name={negocio.nombre}
                src={negocio.avatarUrl}
                badge={<BusinessBadge />}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {negocio.nombre}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-foreground-secondary">
                  <span className="truncate">{C.roles[negocio.rol]}</span>
                  {negocio.verificada && <VerificadaChip />}
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

      {/* Acciones. `shrink-0` para que no se compriman cuando la lista es larga
          —son justamente las que tienen que quedar visibles siempre—. */}
      <div className="mt-2 flex shrink-0 flex-col gap-0.5 border-t border-border-subtle pt-2 pb-2">
        <Link href="/perfil" onClick={onClose} className={filaClase}>
          <IconoDeAccion>
            <UserCircle size={20} />
          </IconoDeAccion>
          <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
            {C.sheet.personalLabel}
          </span>
          <CaretRight size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
        </Link>

        {lugares.puedeCrear || !sabemosCuantosPropios ? (
          <Link
            // `#nuevo` cae directo en el formulario de alta: la misma pantalla
            // sirve para agregar y para administrar, y sin el ancla las dos
            // filas de acá abajo llevarían al mismo lugar.
            href="/negocios/cuenta#nuevo"
            onClick={onClose}
            className={filaClase}
          >
            <IconoDeAccion>
              <PlusCircle size={20} weight="bold" />
            </IconoDeAccion>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">
                {C.sheet.addBusiness}
              </span>
              <span className="block truncate text-xs text-foreground-secondary">
                {sabemosCuantosPropios
                  ? C.sheet.slotsLeft(lugares.restantes, lugares.tope)
                  : C.sheet.addBusinessHint}
              </span>
            </span>
            <CaretRight size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
          </Link>
        ) : (
          // Sin lugares no hay botón: un control que sólo puede fallar es peor
          // que decir la verdad. No manda a borrar nada — dar de baja una cuenta
          // de negocio no tiene pantalla hoy, y pedir algo imposible es un
          // callejón sin salida.
          <p className="flex items-center gap-3 rounded-lg bg-surface-subtle p-2.5" role="status">
            <IconoDeAccion>
              <Storefront size={20} />
            </IconoDeAccion>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">
                {C.sheet.capReached(lugares.tope)}
              </span>
              <span className="block text-xs text-foreground-secondary">
                {C.sheet.capReachedHint}
              </span>
            </span>
          </p>
        )}

        <Link href="/negocios/cuenta" onClick={onClose} className={filaClase}>
          <IconoDeAccion>
            <GearSix size={20} />
          </IconoDeAccion>
          <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
            {C.sheet.manage}
          </span>
          <CaretRight size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
        </Link>
      </div>
    </BottomSheet>
  );
}

/** El círculo gris de las filas de acción. Estaba copiado tres veces. */
function IconoDeAccion({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-secondary"
    >
      {children}
    </span>
  );
}

/**
 * "Verificado" al lado del rol. Ícono + PALABRA, nunca sólo un color ni sólo un
 * glifo: es la misma regla que ya siguen `BusinessBadge` y la puerta de
 * /perfil. `cl-print-hide` no va acá — a diferencia de la insignia de negocio,
 * que sólo dice con qué identidad estabas navegando, esto es un hecho sobre el
 * perfil y sí significa algo impreso.
 */
function VerificadaChip() {
  return (
    <span className="flex shrink-0 items-center gap-0.5 font-semibold text-success">
      <SealCheck size={12} weight="fill" aria-hidden="true" />
      {C.sheet.verifiedBadge}
    </span>
  );
}

/**
 * El control de identidad del header.
 *
 * ── ACTUANDO COMO NEGOCIO SE VE EL NEGOCIO, Y NADA MÁS (2026-09-03) ─────────
 * Pedido textual del cliente, mirando su propia pantalla arriba a la derecha:
 * «debería quedar solamente el nombre de la página». Lo que había era el avatar
 * de la PERSONA con la insignia del local encima —dos caras superpuestas en 32
 * píxeles—, que es exactamente lo que él describió y lo que hacía que cambiar
 * de perfil se sintiera decorativo.
 *
 * Ahora, con un negocio activo, el control es un chip: la foto del negocio (o
 * su inicial) y SU NOMBRE, truncado. Con el perfil personal no cambia nada —
 * sigue siendo el avatar redondo de siempre, sin regresión para quien no tiene
 * ningún negocio.
 *
 * La insignia de local se va del chip a propósito. Existía para desambiguar
 * cuando la única señal era un círculo; con el nombre escrito al lado no
 * desambigua nada y compite con la foto que el negocio acaba de subir (0127).
 * La regla de §3.2 —nunca depender sólo del color— se cumple mejor que antes:
 * ahora hay una PALABRA, que es la señal más fuerte que existe. Adentro de la
 * hoja, donde las filas sí son círculos parecidos, la insignia se queda.
 *
 * El ancho está acotado (`max-w-[7.5rem]`): a 375 px el header lleva logo,
 * zona, campana y mensajes, y un nombre largo no puede empujarlos. El header
 * colabora escondiendo el wordmark mientras hay negocio activo, igual que ya
 * hacía con la zona elegida (ver `header.tsx`).
 */
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
        className={cn(
          "flex h-11 items-center justify-center rounded-full",
          "transition-colors duration-(--duration-fast) hover:bg-surface-hover",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          activo
            ? // Puede ENCOGERSE (no `shrink-0`) y el nombre trunca: a 375 px el
              // header lleva además logo, zona, campana y mensajes, y un chip
              // rígido con un nombre largo provocaría scroll horizontal — que es
              // la única cosa que no se negocia en esta barra. El avatar de
              // adentro sí es rígido, así que nunca se deforma.
              "min-w-0 max-w-[9rem] shrink gap-1.5 border border-brand/25 bg-brand-tint pl-1 pr-2.5"
            : "size-11 shrink-0",
        )}
      >
        {activo ? (
          <>
            <Avatar
              size="sm"
              name={activo.nombre}
              src={activo.avatarUrl}
              className="shrink-0"
            />
            <span className="min-w-0 truncate text-sm font-semibold text-brand-ink">
              {activo.nombre}
            </span>
          </>
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
