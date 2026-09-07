"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui";
import { CommunityEmojiImage } from "@/components/emojis";
import { useCommunityEmojis } from "@/lib/emojis/use-community-emojis";
import { indexBySlug, type CommunityEmoji } from "@/lib/emojis/catalog";
import {
  aplicarReaccion,
  emojiUnicodeDeReaccion,
  miReaccion,
  slugDeReaccion,
  type AmbitoDeMensaje,
  type ReaccionAgrupada,
} from "@/lib/messaging/reacciones";
import { reaccionarAMensajeAction } from "@/app/(app)/mensajes/mensaje-actions";
import { ACCIONES_COPY } from "./copy-acciones";

/**
 * =============================================================================
 * LAS REACCIONES DE UN MENSAJE — estado optimista + las pastillas
 * =============================================================================
 *
 * El estado vive en un contexto y no adentro de las pastillas porque hay DOS
 * superficies que lo tocan y tienen que moverse juntas: la barra de emojis que
 * aparece al abrir el menú (en un portal, arriba de todo) y las pastillas de
 * abajo de la burbuja. Sin contexto compartido, poner un corazón desde la barra
 * dejaría el conteo de abajo sin enterarse hasta el próximo refresco.
 *
 * ─── SE VE EN EL MISMO FRAME ────────────────────────────────────────────────
 * La pastilla cambia antes de que el servidor conteste y vuelve atrás si la
 * base rechaza. Es la misma decisión (y el mismo mecanismo) que el me gusta del
 * feed: `useState` + reversión explícita, no `useOptimistic`, porque acá el
 * estado base NO se revalida en cada toque — reaccionar no vuelve a renderizar
 * el hilo entero (ver `reaccionarAMensajeAction`).
 */

interface ReaccionesDelMensaje {
  reacciones: ReaccionAgrupada[];
  /** Qué puse yo, o `null`. Una sola: lo garantiza la unicidad de la 0007. */
  mia: string | null;
  /** Deja mi reacción en `kind`; con el mismo `kind` que ya tengo, la saca. */
  alternar: (kind: string) => void;
  /** Puedo reaccionar (el mensaje está vivo y tengo sesión). */
  habilitado: boolean;
}

const ReaccionesContext = createContext<ReaccionesDelMensaje | null>(null);

export function useReaccionesDelMensaje(): ReaccionesDelMensaje | null {
  return useContext(ReaccionesContext);
}

export interface ReaccionesProviderProps {
  ambito: AmbitoDeMensaje;
  mensajeId: string;
  hiloId: string;
  /** Cómo me llamo, para el "quién reaccionó" optimista. */
  nombrePropio: string;
  iniciales: readonly ReaccionAgrupada[];
  habilitado?: boolean;
  children: ReactNode;
}

export function ReaccionesProvider({
  ambito,
  mensajeId,
  hiloId,
  nombrePropio,
  iniciales,
  habilitado = true,
  children,
}: ReaccionesProviderProps) {
  const { toast } = useToast();
  const [reacciones, setReacciones] = useState<ReaccionAgrupada[]>(() => [...iniciales]);
  const [, startTransition] = useTransition();

  /**
   * Cuántas escrituras hay en vuelo. Mientras haya alguna, lo que llega del
   * servidor se ignora: el hilo se refresca solo cada 15 segundos
   * (`ThreadRefresh`) y ese refresco puede traer la foto ANTERIOR al toque que
   * todavía está viajando. Sin este freno, la pastilla se pintaba, el poll la
   * borraba, y la respuesta del servidor la volvía a pintar — un parpadeo que
   * parece un bug de la app y es una carrera.
   *
   * Va en ESTADO y no en un ref porque se lee durante el render, y un ref leído
   * en render no dispara la actualización cuando cambia (`react-hooks/refs`).
   */
  const [enVuelo, setEnVuelo] = useState(0);
  const [firmaDelServidor, setFirmaDelServidor] = useState(() => firmaDe(iniciales));

  /**
   * ADOPTAR LO QUE TRAE EL SERVIDOR, ajustando el estado durante el render — el
   * patrón que React documenta para "un prop cambió y el estado deriva de él".
   * Hace falta de verdad: sin esto, la reacción que pone OTRA persona nunca
   * aparecería, porque el estado local se quedó con la foto del primer render.
   */
  const firmaEntrante = firmaDe(iniciales);
  if (firmaEntrante !== firmaDelServidor && enVuelo === 0) {
    setFirmaDelServidor(firmaEntrante);
    setReacciones([...iniciales]);
  }

  const alternar = useCallback(
    (kind: string) => {
      if (!habilitado) return;

      const previas = reacciones;
      const objetivo = miReaccion(previas) === kind ? null : kind;
      setReacciones(aplicarReaccion(previas, objetivo, nombrePropio));

      try {
        navigator.vibrate?.(8);
      } catch {
        // sin soporte háptico: nada que hacer
      }

      setEnVuelo((cuantas) => cuantas + 1);
      startTransition(async () => {
        const resultado = await reaccionarAMensajeAction({
          ambito,
          mensajeId,
          hiloId,
          kind: objetivo,
        });
        setEnVuelo((cuantas) => Math.max(0, cuantas - 1));
        if (resultado.ok) return;

        setReacciones(previas);
        if (resultado.code === "rate-limited") {
          toast({
            title: ACCIONES_COPY.reacciones.rateLimitedTitle,
            description: ACCIONES_COPY.reacciones.rateLimitedBody,
            variant: "warning",
          });
          return;
        }
        toast({ title: ACCIONES_COPY.reacciones.error, variant: "danger" });
      });
    },
    [ambito, habilitado, hiloId, mensajeId, nombrePropio, reacciones, toast],
  );

  const valor = useMemo<ReaccionesDelMensaje>(
    () => ({ reacciones, mia: miReaccion(reacciones), alternar, habilitado }),
    [alternar, habilitado, reacciones],
  );

  return (
    <ReaccionesContext.Provider value={valor}>{children}</ReaccionesContext.Provider>
  );
}

/** Firma barata de lo que trajo el servidor: cambia sólo si cambió algo real. */
function firmaDe(reacciones: readonly ReaccionAgrupada[]): string {
  return reacciones.map((r) => `${r.kind}:${r.total}:${r.mia ? 1 : 0}`).join("|");
}

// ---------------------------------------------------------------------------
// Un emoji de reacción, resuelto
// ---------------------------------------------------------------------------

/**
 * EL CATÁLOGO DE LA COMUNIDAD, PEDIDO UNA SOLA VEZ POR PESTAÑA.
 *
 * `useCommunityEmojis` guarda la promesa a nivel de módulo, así que veinte
 * mensajes con reacciones `:klk:` comparten UNA consulta. Se pide sólo si hay
 * alguna reacción que la necesite: un hilo con puros emojis del teclado no
 * toca la red.
 */
function useEmojisDeComunidad(hace: boolean): ReadonlyMap<string, CommunityEmoji> {
  const { state, load } = useCommunityEmojis();

  useEffect(() => {
    if (hace) load();
  }, [hace, load]);

  return useMemo(
    () => (state.status === "ready" ? indexBySlug(state.emojis) : new Map()),
    [state],
  );
}

function EmojiDeReaccion({
  kind,
  catalogo,
  lado,
}: {
  kind: string;
  catalogo: ReadonlyMap<string, CommunityEmoji>;
  lado: number;
}) {
  const slug = slugDeReaccion(kind);
  const emoji = slug ? catalogo.get(slug) : undefined;

  if (emoji) {
    return (
      <CommunityEmojiImage
        emoji={emoji}
        decorative
        style={{ width: lado, height: lado }}
        className="shrink-0"
      />
    );
  }

  /**
   * Un `:slug:` que todavía no resolvió —o que ya no está en el catálogo—
   * vuelve como TEXTO tal cual, igual que hace `parseEmojiText`. Nunca
   * desaparece: una pastilla vacía con un número al lado no se entiende.
   */
  return (
    <span aria-hidden="true" className="shrink-0 leading-none" style={{ fontSize: lado }}>
      {emojiUnicodeDeReaccion(kind)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Las pastillas
// ---------------------------------------------------------------------------

/**
 * LAS REACCIONES DEBAJO DE LA BURBUJA.
 *
 * Van pegadas al borde inferior de la burbuja y del lado que le corresponda —
 * es lo que hace que se lean como parte del mensaje y no como una fila suelta.
 * Tocar una pastilla suma o saca la tuya, que es lo que la gente espera de un
 * chat sin que nadie se lo explique.
 */
export function MessageReactions({
  isOwn,
  className,
}: {
  isOwn: boolean;
  className?: string;
}) {
  const estado = useReaccionesDelMensaje();
  const reduceMotion = useReducedMotion();

  const necesitaCatalogo = (estado?.reacciones ?? []).some(
    (reaccion) => slugDeReaccion(reaccion.kind) !== null,
  );
  const catalogo = useEmojisDeComunidad(necesitaCatalogo);

  if (!estado || estado.reacciones.length === 0) return null;

  const total = estado.reacciones.reduce((suma, reaccion) => suma + reaccion.total, 0);

  return (
    <ul
      aria-label={ACCIONES_COPY.reacciones.resumen(total)}
      className={cn(
        "-mt-1.5 flex flex-wrap items-center gap-1",
        isOwn ? "justify-end pr-1" : "justify-start pl-1",
        className,
      )}
    >
      <AnimatePresence initial={false}>
        {estado.reacciones.map((reaccion) => (
          <m.li
            key={reaccion.kind}
            layout={reduceMotion ? false : "position"}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={
              reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.6, transition: { duration: 0.12 } }
            }
            transition={{ type: "spring", stiffness: 520, damping: 26, mass: 0.6 }}
          >
            <button
              type="button"
              disabled={!estado.habilitado}
              onClick={() => estado.alternar(reaccion.kind)}
              aria-pressed={reaccion.mia}
              aria-label={`${
                reaccion.mia
                  ? ACCIONES_COPY.reacciones.quitar(reaccion.kind)
                  : ACCIONES_COPY.reacciones.poner(reaccion.kind)
              } · ${ACCIONES_COPY.reacciones.quienes(
                reaccion.mia
                  ? [ACCIONES_COPY.vos, ...reaccion.nombres.slice(1)]
                  : reaccion.nombres,
                reaccion.total,
              )}`}
              className={cn(
                "flex h-7 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold tabular-nums",
                "transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
                "active:scale-[0.92] motion-reduce:transition-none motion-reduce:active:scale-100",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                "disabled:pointer-events-none disabled:opacity-60",
                reaccion.mia
                  ? "border-brand/40 bg-brand-tint text-brand-ink"
                  : "border-border-subtle bg-surface-raised text-foreground-secondary hover:border-border",
              )}
            >
              <EmojiDeReaccion kind={reaccion.kind} catalogo={catalogo} lado={14} />
              {reaccion.total > 1 && <span aria-hidden="true">{reaccion.total}</span>}
            </button>
          </m.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/** Reexportado para que la barra de reacciones pinte el mismo emoji. */
export { EmojiDeReaccion, useEmojisDeComunidad };
