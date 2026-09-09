"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  ArrowBendUpLeft,
  Copy,
  DotsThreeVertical,
  PaperPlaneTilt,
  PencilSimple,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import {
  Button,
  Dialog,
  Field,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import { useBodyScrollLock, useFocusTrap, useMounted } from "@/lib/design/use-overlay";
import { CompartirSheet } from "@/components/share";
import {
  accionesDisponibles,
  type AmbitoDeMensaje,
} from "@/lib/messaging/reacciones";
import {
  editarMensajeAction,
  eliminarMensajeAction,
  reportarMensajeAction,
} from "@/app/(app)/mensajes/mensaje-actions";
import { COPY } from "./copy";
import { ACCIONES_COPY } from "./copy-acciones";
import { ReactionBar } from "./reaction-bar";
import { useResponder } from "./reply-quote";
import { resumenDeMensaje } from "./helpers-de-mensaje";

/**
 * =============================================================================
 * QUÉ PASA AL MANTENER PRESIONADO UN MENSAJE
 * =============================================================================
 *
 * ─── DOS PUERTAS, NO UNA ────────────────────────────────────────────────────
 * El cliente pidió el toque largo, y la versión anterior de este menú había
 * elegido a propósito un botón visible, con un argumento que sigue siendo
 * cierto: «un gesto que no se ve es un gesto que no existe», y un lector de
 * pantalla no puede anunciar un toque largo.
 *
 * No se pisa esa decisión: se le SUMA la otra. El botón de tres puntos sigue
 * ahí —visible, tabulable, con `aria-label`— y además mantener presionada la
 * burbuja abre el mismo menú. En escritorio, el clic derecho hace lo mismo.
 * Tres caminos a un solo panel; ninguno es el único.
 *
 * ─── EL BUG CLÁSICO DEL TOQUE LARGO ES EL SCROLL ────────────────────────────
 * Un temporizador que sólo mira el tiempo dispara el menú mientras la persona
 * está deslizando el hilo hacia arriba con el dedo apoyado. Por eso hay DOS
 * condiciones: 480 ms Y no haberse movido más de 10 px. El movimiento cancela
 * antes que el reloj, así que scrollear nunca abre nada.
 *
 * Los 480 ms no son arbitrarios: es el umbral que usan iOS y Android para su
 * propio menú contextual. Más corto se dispara al apoyar el dedo para leer;
 * más largo se siente trabado.
 */

const UMBRAL_TOQUE_LARGO_MS = 480;
const TOLERANCIA_MOVIMIENTO_PX = 10;

/** Margen entre el panel y el borde de la pantalla. */
const MARGEN_VIEWPORT_PX = 12;

function useLongPress({
  onLongPress,
  habilitado,
}: {
  onLongPress: () => void;
  habilitado: boolean;
}) {
  const timer = useRef<number | null>(null);
  const origen = useRef<{ x: number; y: number } | null>(null);
  const disparado = useRef(false);

  const cancelar = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origen.current = null;
  }, []);

  useEffect(() => cancelar, [cancelar]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      // El mouse tiene el botón visible y el clic derecho; el toque largo es
      // para el dedo. Con mouse, además, "mantener apretado" es el comienzo de
      // una selección de texto y robársela sería peor que no tener el gesto.
      if (!habilitado || (event.pointerType !== "touch" && event.pointerType !== "pen")) {
        return;
      }
      cancelar();
      disparado.current = false;
      origen.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        disparado.current = true;
        try {
          navigator.vibrate?.(12);
        } catch {
          // sin soporte háptico: nada que hacer
        }
        onLongPress();
      }, UMBRAL_TOQUE_LARGO_MS);
    },
    [cancelar, habilitado, onLongPress],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const inicio = origen.current;
      if (!inicio || timer.current === null) return;
      const dx = Math.abs(event.clientX - inicio.x);
      const dy = Math.abs(event.clientY - inicio.y);
      if (dx > TOLERANCIA_MOVIMIENTO_PX || dy > TOLERANCIA_MOVIMIENTO_PX) cancelar();
    },
    [cancelar],
  );

  /**
   * El `click` que llega después de un toque largo se traga acá. Sin esto, en
   * una burbuja que además es un enlace (una tarjeta compartida), abrir el menú
   * navegaría a otra pantalla en el mismo gesto.
   */
  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!disparado.current) return;
    disparado.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const onContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!habilitado) return;
      // Siempre se frena: en el teléfono es el menú nativo de "copiar/buscar"
      // pisándose con el nuestro; en escritorio es la puerta del clic derecho.
      event.preventDefault();
      /**
       * Android dispara `contextmenu` alrededor de los 500 ms, o sea DESPUÉS de
       * que nuestro temporizador ya abrió el panel a los 480. Sin este freno el
       * menú se abriría dos veces en el mismo gesto y volvería a medirse — un
       * salto visible por una carrera de 20 ms.
       */
      if (disparado.current) return;
      cancelar();
      onLongPress();
    },
    [cancelar, habilitado, onLongPress],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancelar,
    onPointerCancel: cancelar,
    onPointerLeave: cancelar,
    onClickCapture,
    onContextMenu,
  };
}

// ---------------------------------------------------------------------------
// El anfitrión: la burbuja + sus dos puertas + el panel
// ---------------------------------------------------------------------------

export interface MessageActionsProps {
  ambito: AmbitoDeMensaje;
  mensajeId: string;
  /** `conversation_id` o `group_id`, según el ámbito. */
  hiloId: string;
  /** Lo escribí yo. Decide el lado y habilita editar/eliminar. */
  isOwn: boolean;
  /** Administro el grupo o soy del equipo: puedo bajar mensajes ajenos. */
  administro?: boolean;
  /** `messages.kind` — sólo `texto` se puede corregir (0136 §5). */
  kind?: string;
  /** ISO. Lo usa la ventana de edición de 15 minutos. */
  createdAt: string;
  body: string;
  deletedAt?: string | null;
  autorNombre: string;
  /** Metadatos de compatibilidad para las tarjetas compartidas. */
  compartido?: { kind: string; id: string; titulo: string; url: string } | null;
  /**
   * La burbuja, ya renderizada en el servidor. Es OBLIGATORIA: es lo que este
   * componente envuelve para que el toque largo tenga sobre qué dispararse.
   * Existió una variante sin ella —sólo el botón, al costado de la burbuja—
   * para que la página de grupos migrara en dos pasos; se eliminó con el
   * segundo paso. Un menú sin su mensaje es el menú a medias que este archivo
   * existe para no tener.
   */
  children: ReactNode;
  className?: string;
}

export function MessageActions({
  ambito,
  mensajeId,
  hiloId,
  isOwn,
  administro = false,
  kind = "texto",
  createdAt,
  body,
  deletedAt = null,
  autorNombre,
  children,
  className,
}: MessageActionsProps) {
  const mounted = useMounted();
  const router = useRouter();
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();
  const responder = useResponder();

  const [abierto, setAbierto] = useState(false);
  const [modo, setModo] = useState<"menu" | "editar" | "eliminar" | "reportar" | "reenviar">(
    "menu",
  );
  const anclaRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [caja, setCaja] = useState<{ top: number; bottom: number } | null>(null);
  const [top, setTop] = useState<number | null>(null);

  const permitido = accionesDisponibles({
    esAutor: isOwn,
    administro,
    kind,
    createdAt,
    deletedAt,
    body,
  });

  const abrir = useCallback(() => {
    const rect = anclaRef.current?.getBoundingClientRect();
    if (rect) setCaja({ top: rect.top, bottom: rect.bottom });
    setModo("menu");
    setTop(null);
    setAbierto(true);
  }, []);

  const cerrar = useCallback(() => {
    setAbierto(false);
    setModo("menu");
  }, []);

  const gestos = useLongPress({ onLongPress: abrir, habilitado: !deletedAt });

  const enMenu = abierto && modo === "menu";
  useFocusTrap(panelRef, enMenu, cerrar);
  useBodyScrollLock(enMenu);

  /**
   * ARRIBA SI ENTRA ARRIBA, SI NO ABAJO, Y SI NO ENCAJA EN NINGÚN LADO,
   * PEGADO AL BORDE.
   *
   * Se mide DESPUÉS de montar porque el alto del panel depende de cuántas
   * acciones quedaron habilitadas — no es el mismo panel para un mensaje propio
   * de hace un minuto que para uno ajeno de ayer. `useLayoutEffect` corre antes
   * de pintar, así que nunca se ve el panel en la posición provisoria.
   */
  useLayoutEffect(() => {
    if (!enMenu || !caja) return;
    const nodo = panelRef.current;
    if (!nodo) return;

    function reubicar() {
      if (!caja || !nodo) return;
      const alto = nodo.offsetHeight;
      const vh = window.innerHeight;
      const espacioArriba = caja.top - MARGEN_VIEWPORT_PX;
      const espacioAbajo = vh - caja.bottom - MARGEN_VIEWPORT_PX;

      if (espacioArriba >= alto) {
        setTop(caja.top - alto - 8);
      } else if (espacioAbajo >= alto) {
        setTop(caja.bottom + 8);
      } else {
        // No entra ni arriba ni abajo (mensaje largo en pantalla chica): se
        // apoya contra el borde y el panel scrollea por dentro (`max-h`).
        setTop(Math.max(MARGEN_VIEWPORT_PX, vh - alto - MARGEN_VIEWPORT_PX));
      }
    }

    reubicar();

    /**
     * EL PANEL CAMBIA DE ALTO MIENTRAS ESTÁ ABIERTO: tocar "Más emojis" lo
     * convierte de una fila de 56 px en el catálogo entero. Medir una sola vez
     * al abrir dejaba el catálogo colgando fuera de la pantalla justo en el
     * caso donde más se necesita ver — que es el pedido del cliente, reaccionar
     * con los emojis de la comunidad.
     */
    const observador = new ResizeObserver(reubicar);
    observador.observe(nodo);
    return () => observador.disconnect();
  }, [caja, enMenu]);

  function accion(siguiente: typeof modo) {
    setModo(siguiente);
  }

  function alResponder() {
    if (!responder) return;
    responder.responderA({
      id: mensajeId,
      autorNombre,
      esPropio: isOwn,
      resumen: resumenDeMensaje(kind, body, Boolean(deletedAt)),
    });
    cerrar();
  }

  async function alCopiar() {
    try {
      await navigator.clipboard.writeText(body);
      toast({ title: ACCIONES_COPY.copiar.listo });
    } catch {
      toast({ title: ACCIONES_COPY.copiar.error, variant: "danger" });
    }
    cerrar();
  }

  const panel = enMenu && mounted && caja !== null && (
    <div className="fixed inset-0 z-50">
      <m.div
        className="absolute inset-0 bg-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.15 } }}
        transition={{ duration: 0.22 }}
        onClick={cerrar}
        aria-hidden="true"
      />

      {/* El carril ocupa el ancho entero con margen: así el panel NUNCA se sale
          de la pantalla aunque la burbuja esté pegada al borde, y no hace falta
          medir su ancho para saberlo. */}
      <div
        className={cn(
          "pointer-events-none absolute flex px-3",
          isOwn ? "justify-end" : "justify-start",
        )}
        style={{
          left: 0,
          right: 0,
          top: top ?? 0,
          visibility: top === null ? "hidden" : "visible",
        }}
      >
        <m.div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={ACCIONES_COPY.menu.title}
          tabIndex={-1}
          className="pointer-events-auto flex max-h-[70dvh] w-[min(19rem,100%)] flex-col gap-2 overflow-y-auto focus-visible:outline-none"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 6 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          style={{ transformOrigin: isOwn ? "top right" : "top left" }}
          transition={{ type: "spring", stiffness: 460, damping: 32, mass: 0.7 }}
        >
          {permitido.reaccionar && (
            <ReactionBar isOwn={isOwn} onElegido={cerrar} className="self-start" />
          )}

          <MessageMenu
            permitido={permitido}
            // Es MI mensaje de texto y sigue vivo, pero se pasó la ventana. Se
            // muestra apagado con el motivo: hacerlo desaparecer dejaría
            // pensando si alguna vez estuvo.
            editarVencido={
              !permitido.editar && isOwn && !deletedAt && kind === "texto"
            }
            hayResponder={responder !== null}
            onResponder={alResponder}
            onCopiar={() => void alCopiar()}
            onReenviar={() => accion("reenviar")}
            onEditar={() => accion("editar")}
            onEliminar={() => accion("eliminar")}
            onReportar={() => accion("reportar")}
          />
        </m.div>
      </div>
    </div>
  );

  return (
    <>
      <div
        ref={anclaRef}
        className={cn("flex min-w-0 items-end gap-1", className)}
        {...gestos}
        // Sin esto, en iOS el toque largo levanta el menú nativo de selección
        // ANTES que el nuestro. El texto se sigue pudiendo seleccionar con un
        // arrastre; lo que se apaga es el globo de "Copiar / Buscar".
        style={{ WebkitTouchCallout: "none", touchAction: "pan-y pinch-zoom" }}
      >
        {isOwn && !deletedAt && <BotonDeMenu onClick={abrir} />}
        {children}
        {!isOwn && !deletedAt && <BotonDeMenu onClick={abrir} />}
      </div>

      {mounted && createPortal(<AnimatePresence>{panel}</AnimatePresence>, document.body)}

      <DialogoDeEdicion
        open={abierto && modo === "editar"}
        onClose={cerrar}
        ambito={ambito}
        mensajeId={mensajeId}
        hiloId={hiloId}
        body={body}
      />

      <DialogoDeBorrado
        open={abierto && modo === "eliminar"}
        onClose={cerrar}
        onHecho={() => {
          cerrar();
          router.refresh();
        }}
        ambito={ambito}
        mensajeId={mensajeId}
        hiloId={hiloId}
      />

      <DialogoDeReporte
        open={abierto && modo === "reportar"}
        onClose={cerrar}
        ambito={ambito}
        mensajeId={mensajeId}
      />

      <CompartirSheet
        open={abierto && modo === "reenviar"}
        onClose={cerrar}
        mensajeOrigen={{ ambito, mensajeId, hiloId }}
        titulo={resumenDeMensaje(kind, body, Boolean(deletedAt))}
      />
    </>
  );
}

function BotonDeMenu({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ACCIONES_COPY.menu.trigger}
      onClick={onClick}
      className={cn(
        // 44px de área táctil con un ícono chico adentro: el peso visual es el
        // de un detalle, el objetivo es el de un botón (§3.2).
        "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-muted",
        "opacity-60 transition-[opacity,transform,background-color,color] duration-(--duration-fast) ease-(--ease-spring)",
        "hover:bg-surface-subtle hover:text-foreground hover:opacity-100 active:scale-[0.9]",
        "focus-visible:opacity-100 motion-reduce:transition-none motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        className,
      )}
    >
      <DotsThreeVertical size={18} weight="bold" aria-hidden="true" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// La lista de las seis acciones
// ---------------------------------------------------------------------------

export interface MessageMenuProps {
  permitido: ReturnType<typeof accionesDisponibles>;
  /** Mío, de texto y vivo, pero pasados los 15 minutos: se apaga con el motivo. */
  editarVencido?: boolean;
  /** El hilo montó `ResponderProvider`. Sin él, responder no lleva a ningún lado. */
  hayResponder: boolean;
  onResponder: () => void;
  onCopiar: () => void;
  onReenviar: () => void;
  onEditar: () => void;
  onEliminar: () => void;
  onReportar: () => void;
}

/**
 * LAS SEIS ACCIONES, CADA UNA HABILITADA SÓLO CUANDO CORRESPONDE.
 *
 * Las que no aplican por PERMISO se van (editar un mensaje ajeno no existe);
 * las que no aplican por MOMENTO se quedan apagadas CON el motivo escrito
 * debajo (la ventana de edición vencida). La diferencia importa: un botón que
 * desaparece deja pensando si estuvo alguna vez, y uno apagado sin explicación
 * se lee como una falla de la app.
 */
export function MessageMenu({
  permitido,
  editarVencido = false,
  hayResponder,
  onResponder,
  onCopiar,
  onReenviar,
  onEditar,
  onEliminar,
  onReportar,
}: MessageMenuProps) {
  return (
    <div
      role="group"
      aria-label={ACCIONES_COPY.menu.title}
      className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-raised shadow-lg"
    >
      {permitido.responder && hayResponder && (
        <FilaDeAccion icono={<ArrowBendUpLeft size={18} />} onClick={onResponder}>
          {ACCIONES_COPY.menu.responder}
        </FilaDeAccion>
      )}

      <FilaDeAccion
        icono={<Copy size={18} />}
        onClick={onCopiar}
        disabled={!permitido.copiar}
        nota={!permitido.copiar ? ACCIONES_COPY.menu.copiarSinTexto : undefined}
      >
        {ACCIONES_COPY.menu.copiar}
      </FilaDeAccion>

      {permitido.reenviar && (
        <FilaDeAccion
          icono={<PaperPlaneTilt size={18} />}
          onClick={onReenviar}
        >
          {ACCIONES_COPY.menu.reenviar}
        </FilaDeAccion>
      )}

      {(permitido.editar || editarVencido) && (
        <FilaDeAccion
          icono={<PencilSimple size={18} />}
          onClick={onEditar}
          disabled={!permitido.editar}
          nota={permitido.editar ? undefined : ACCIONES_COPY.menu.editarVencido}
        >
          {ACCIONES_COPY.menu.editar}
        </FilaDeAccion>
      )}

      {permitido.eliminar && (
        <FilaDeAccion icono={<Trash size={18} />} onClick={onEliminar} tono="danger">
          {ACCIONES_COPY.menu.eliminar}
        </FilaDeAccion>
      )}

      {permitido.reportar && (
        <FilaDeAccion icono={<WarningCircle size={18} />} onClick={onReportar} tono="danger">
          {ACCIONES_COPY.menu.reportar}
        </FilaDeAccion>
      )}
    </div>
  );
}

function FilaDeAccion({
  icono,
  children,
  onClick,
  disabled = false,
  nota,
  tono = "normal",
}: {
  icono: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  nota?: string;
  tono?: "normal" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium",
        "border-b border-border-subtle last:border-b-0",
        "transition-colors duration-(--duration-fast)",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
        disabled
          ? "cursor-not-allowed text-foreground-muted opacity-60"
          : tono === "danger"
            ? "text-danger hover:bg-danger/8"
            : "text-foreground hover:bg-surface-hover",
      )}
    >
      <span aria-hidden="true" className="shrink-0">
        {icono}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">{children}</span>
        {nota && (
          <span className="mt-0.5 block text-[11px] font-normal text-foreground-muted">
            {nota}
          </span>
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------

function DialogoDeEdicion({
  open,
  onClose,
  ambito,
  mensajeId,
  hiloId,
  body,
}: {
  open: boolean;
  onClose: () => void;
  ambito: AmbitoDeMensaje;
  mensajeId: string;
  hiloId: string;
  body: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const campoId = useId();
  const [texto, setTexto] = useState(body);
  const [abiertoAntes, setAbiertoAntes] = useState(open);
  const [guardando, startTransition] = useTransition();

  /**
   * Al REABRIR se arranca de lo que dice el mensaje hoy, no de lo que quedó
   * tipeado en un intento anterior que se canceló. Se ajusta durante el render
   * —el patrón documentado de React para "un prop cambió"— y no en un efecto:
   * un `setState` sincrónico adentro de un efecto encadena renders.
   */
  if (open !== abiertoAntes) {
    setAbiertoAntes(open);
    if (open) setTexto(body);
  }

  function guardar() {
    const limpio = texto.trim();
    if (!limpio) {
      toast({ title: ACCIONES_COPY.editar.vacio, variant: "warning" });
      return;
    }
    if (limpio === body.trim()) {
      onClose();
      return;
    }

    startTransition(async () => {
      const resultado = await editarMensajeAction({
        ambito,
        mensajeId,
        hiloId,
        body: limpio,
      });
      if (resultado.ok) {
        toast({ title: ACCIONES_COPY.editar.guardado });
        onClose();
        router.refresh();
        return;
      }
      onClose();
      toast(mensajeDeError(resultado.code));
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={ACCIONES_COPY.editar.title}
      description={ACCIONES_COPY.editar.intro}
      footer={
        <>
          <Button variant="outline" disabled={guardando} onClick={onClose}>
            {ACCIONES_COPY.menu.cancel}
          </Button>
          <Button loading={guardando} onClick={guardar}>
            {ACCIONES_COPY.editar.guardar}
          </Button>
        </>
      }
    >
      <Field htmlFor={campoId} label={ACCIONES_COPY.editar.label}>
        <Textarea
          id={campoId}
          rows={4}
          maxLength={2000}
          value={texto}
          onChange={(event) => setTexto(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Eliminar
// ---------------------------------------------------------------------------

function DialogoDeBorrado({
  open,
  onClose,
  onHecho,
  ambito,
  mensajeId,
  hiloId,
}: {
  open: boolean;
  onClose: () => void;
  onHecho: () => void;
  ambito: AmbitoDeMensaje;
  mensajeId: string;
  hiloId: string;
}) {
  const { toast } = useToast();
  const [borrando, startTransition] = useTransition();

  function borrar() {
    startTransition(async () => {
      const resultado = await eliminarMensajeAction({ ambito, mensajeId, hiloId });
      if (resultado.ok) {
        toast({ title: ACCIONES_COPY.eliminar.listo });
        onHecho();
        return;
      }
      onClose();
      toast(mensajeDeError(resultado.code));
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      highRisk
      title={ACCIONES_COPY.eliminar.title}
      description={ACCIONES_COPY.eliminar.body}
      footer={
        <>
          <Button variant="outline" disabled={borrando} onClick={onClose}>
            {ACCIONES_COPY.menu.cancel}
          </Button>
          <Button variant="danger" loading={borrando} onClick={borrar}>
            {ACCIONES_COPY.eliminar.confirmar}
          </Button>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Reportar
// ---------------------------------------------------------------------------

function DialogoDeReporte({
  open,
  onClose,
  ambito,
  mensajeId,
}: {
  open: boolean;
  onClose: () => void;
  ambito: AmbitoDeMensaje;
  mensajeId: string;
}) {
  const { toast } = useToast();
  const idMotivo = useId();
  const idDetalle = useId();
  const [motivo, setMotivo] = useState<string>(COPY.report.reasons[0].value);
  const [detalle, setDetalle] = useState("");
  const [enviando, startTransition] = useTransition();

  function enviar() {
    startTransition(async () => {
      const resultado = await reportarMensajeAction({
        ambito,
        mensajeId,
        reason: motivo,
        details: detalle.trim() || undefined,
      });
      setDetalle("");
      onClose();

      if (resultado.ok) {
        toast({
          title: COPY.report.successTitle,
          description: COPY.report.successBody,
        });
        return;
      }
      if (resultado.code === "rate-limited") {
        toast({
          title: COPY.report.rateLimitedTitle,
          description: COPY.report.rateLimitedBody,
          variant: "warning",
        });
        return;
      }
      toast({
        title: COPY.report.errorTitle,
        description: COPY.report.errorBody,
        variant: "danger",
      });
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      highRisk
      title={COPY.report.sheetTitle}
      description={COPY.report.intro}
      footer={
        <>
          <Button variant="outline" disabled={enviando} onClick={onClose}>
            {ACCIONES_COPY.menu.cancel}
          </Button>
          <Button variant="danger" loading={enviando} onClick={enviar}>
            {COPY.report.submit}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field htmlFor={idMotivo} label={COPY.report.reasonLabel}>
          <Select
            id={idMotivo}
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
          >
            {COPY.report.reasons.map((opcion) => (
              <option key={opcion.value} value={opcion.value}>
                {opcion.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field htmlFor={idDetalle} label={COPY.report.detailsLabel} optional>
          <Textarea
            id={idDetalle}
            rows={3}
            maxLength={1000}
            value={detalle}
            placeholder={COPY.report.detailsPlaceholder}
            onChange={(event) => setDetalle(event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/**
 * Un código del servidor → lo que se lee en pantalla. Cada "no" que la persona
 * PUEDE entender tiene su propio texto; el resto cae en el genérico. Nunca se
 * muestra el mensaje crudo de la base.
 */
function mensajeDeError(code: string): {
  title: string;
  description?: string;
  variant: "danger" | "warning";
} {
  switch (code) {
    case "edit-window-closed":
      return {
        title: ACCIONES_COPY.editar.vencidoTitle,
        description: ACCIONES_COPY.editar.vencidoBody,
        variant: "warning",
      };
    case "not-author":
      return {
        title: ACCIONES_COPY.editar.noAutorTitle,
        description: ACCIONES_COPY.editar.noAutorBody,
        variant: "warning",
      };
    case "flagged":
      return {
        title: ACCIONES_COPY.editar.flaggedTitle,
        description: ACCIONES_COPY.editar.flaggedBody,
        variant: "warning",
      };
    case "deleted":
      return { title: ACCIONES_COPY.errores.yaNoEsta, variant: "warning" };
    case "forbidden":
      return { title: ACCIONES_COPY.errores.forbidden, variant: "warning" };
    case "rate-limited":
      return {
        title: ACCIONES_COPY.reacciones.rateLimitedTitle,
        description: ACCIONES_COPY.reacciones.rateLimitedBody,
        variant: "warning",
      };
    default:
      return { title: ACCIONES_COPY.errores.generic, variant: "danger" };
  }
}
