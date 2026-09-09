"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Check,
  FacebookLogo,
  InstagramLogo,
  Link as LinkIcon,
  MagnifyingGlass,
  ShareNetwork,
  UsersThree,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, BottomSheet, Input, Skeleton, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { compartirEnChatAction } from "@/app/(app)/mensajes/compartir-actions";
import { reenviarMensajeAction } from "./reenviar-mensaje-action";
import type { Destino } from "@/app/(app)/mensajes/api/destinos/route";
import { SHARE_COPY } from "./copy";
import type { CompartidoKind } from "./enlace-interno";

/**
 * =============================================================================
 * EL PANEL DE COMPARTIR — UNO SOLO PARA TODA LA APP
 * =============================================================================
 *
 * Reemplaza las cinco copias del mismo `navigator.share` + portapapeles que
 * vivían sueltas en el feed, el detalle de aviso, los eventos y los dos
 * reproductores de video. Aquellas compartían el CÓDIGO por accidente (copiado)
 * y no el COMPORTAMIENTO: cada una tenía su propio toast, su propio manejo del
 * cancel y su propia idea de qué es un error.
 *
 * ── EL ORDEN DE LOS DOS BLOQUES ES EL PRODUCTO ──────────────────────────────
 * Primero "enviar a alguien de la comunidad", después "compartir afuera". Al
 * revés —que es como lo hacen TikTok y Xbox, donde la fila de apps externas va
 * arriba— el panel diría que lo natural es sacar el contenido de la app. Acá la
 * apuesta es la contraria: la gente que necesita esa propiedad ya está adentro,
 * y mandársela es el camino corto.
 *
 * ── SELECCIÓN MÚLTIPLE, UN SOLO ENVÍO ───────────────────────────────────────
 * Las referencias de Mobbin resuelven esto con un botón "Enviar" POR FILA
 * (TikTok) — que sirve para mandarle a uno. Acá se marcan varios y se envía una
 * vez, así que la fila es un `checkbox` y el envío vive en una barra fija abajo
 * con el contador. Es la decisión que hace que "se lo mando a los tres que están
 * buscando departamento" sea un gesto y no tres.
 */

interface CompartirSheetBaseProps {
  open: boolean;
  onClose: () => void;
  /**
   * Qué se está compartiendo, para la cabecera del panel. OPCIONAL: cuando
   * quien abre el panel no tiene el dato a mano (hoy el feed, porque
   * `post-card.tsx` es de otro agente), la cabecera NO se pinta. Un recuadro con
   * un ícono genérico y la palabra "Compartir" adentro no informa nada y encima
   * repite el título de la hoja.
   */
  titulo?: string | null;
  imagenUrl?: string | null;
  detalle?: string | null;
  /**
   * Se llama después de un compartir hacia AFUERA que salió bien (hoja nativa
   * aceptada o enlace copiado). Existe para la métrica de avisos
   * (`record_listing_share`), que hoy sólo cuenta ese camino.
   */
}

interface CompartirContenidoProps extends CompartirSheetBaseProps {
  mensajeOrigen?: never;
  kind: CompartidoKind;
  id: string;
  url: string;
  onCompartidoAfuera?: () => void;
}

interface ReenviarMensajeProps extends CompartirSheetBaseProps {
  mensajeOrigen: {
    ambito: "directo" | "grupo";
    mensajeId: string;
    hiloId: string;
  };
  kind?: never;
  id?: never;
  url?: never;
  onCompartidoAfuera?: never;
}

export type CompartirSheetProps = CompartirContenidoProps | ReenviarMensajeProps;

type Estado =
  | { fase: "cargando" }
  | { fase: "listo"; destinos: Destino[]; recientes: boolean; termino: string }
  | { fase: "error" };

const claveDe = (destino: Destino) => `${destino.tipo}:${destino.id}`;

export function CompartirSheet(props: CompartirSheetProps) {
  const { open, onClose, titulo, imagenUrl, detalle } = props;
  const esReenvio = props.mensajeOrigen !== undefined;
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();
  const inputId = useId();

  const [valor, setValor] = useState("");
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [nota, setNota] = useState("");
  const [enviando, startEnviar] = useTransition();
  const abortRef = useRef<AbortController | null>(null);

  const termino = valor.trim();

  /**
   * CADA TECLA ABORTA LA BÚSQUEDA ANTERIOR. Sin esto, escribir rápido deja tres
   * respuestas en vuelo y gana la que vuelva última — que puede ser la de "Ram"
   * cuando en pantalla ya dice "Ramón". Mismo patrón que `people-search.tsx`.
   */
  useEffect(() => {
    if (!open) return;

    // 200 ms: por debajo se dispara una consulta por letra, por encima se siente
    // trabado. Con el campo vacío no hay espera: los recientes se piden ya.
    const espera = termino.length >= 2 ? 200 : 0;

    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setEstado({ fase: "cargando" });

      try {
        const respuesta = await fetch(
          `/mensajes/api/destinos?q=${encodeURIComponent(termino.length >= 2 ? termino : "")}`,
          { signal: controller.signal },
        );
        if (!respuesta.ok) {
          setEstado({ fase: "error" });
          return;
        }
        const datos = (await respuesta.json()) as {
          destinos?: Destino[];
          recientes?: boolean;
        };
        setEstado({
          fase: "listo",
          destinos: datos.destinos ?? [],
          recientes: datos.recientes !== false,
          termino,
        });
      } catch (error) {
        // Abortar es lo NORMAL acá (una tecla más), no una falla: pintar el
        // error mostraría "no pudimos buscar" en cada letra.
        if (error instanceof DOMException && error.name === "AbortError") return;
        setEstado({ fase: "error" });
      }
    }, espera);

    return () => window.clearTimeout(timer);
  }, [termino, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Al cerrar se vuelve a foja cero: reabrir el panel con tres personas todavía
  // marcadas de la vez anterior es la forma más rápida de mandar algo sin querer.
  useEffect(() => {
    if (open) return;
    const raf = requestAnimationFrame(() => {
      setElegidos(new Set());
      setNota("");
      setValor("");
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const alternar = useCallback((destino: Destino) => {
    const clave = claveDe(destino);
    setElegidos((previos) => {
      const siguiente = new Set(previos);
      if (siguiente.has(clave)) siguiente.delete(clave);
      else siguiente.add(clave);
      return siguiente;
    });
    try {
      navigator.vibrate?.(8);
    } catch {
      // sin soporte háptico: nada que hacer
    }
  }, []);

  /**
   * ENVÍO OPTIMISTA. La hoja se cierra y el toast confirma en el mismo frame en
   * que se toca "Enviar": nadie mira una hoja de compartir esperando a que el
   * servidor conteste. Si el server rechaza, el segundo toast lo corrige — que
   * es el rollback posible acá, porque lo que se "deshace" no está en esta
   * pantalla sino en el chat de la otra persona.
   */
  function enviar() {
    const seleccion = [...elegidos].map((clave) => {
      const [tipo, destinoId] = clave.split(":");
      return { tipo: tipo as "persona" | "grupo", id: destinoId };
    });
    if (seleccion.length === 0) return;

    const cantidad = seleccion.length;
    const notaAEnviar = nota.trim();

    onClose();
    toast({
      title: SHARE_COPY.enviadoTitle(cantidad),
      description: SHARE_COPY.enviadoBody,
      variant: "success",
    });

    startEnviar(async () => {
      const resultado = props.mensajeOrigen
        ? await reenviarMensajeAction({
            origen: props.mensajeOrigen,
            destinos: seleccion,
          })
        : await compartirEnChatAction({
            destinos: seleccion,
            compartidoKind: props.kind,
            compartidoId: props.id,
            ...(notaAEnviar ? { nota: notaAEnviar } : {}),
          });

      if (resultado.ok) {
        // Salió todo: el toast optimista ya dijo la verdad, no se repite.
        if (resultado.fallidos === 0) return;
        toast({
          title: SHARE_COPY.parcialTitle(resultado.enviados, cantidad),
          description: SHARE_COPY.parcialBody,
          variant: "warning",
        });
        return;
      }

      if (resultado.code === "unauthenticated") {
        toast({
          title: SHARE_COPY.errorSesionTitle,
          description: SHARE_COPY.errorSesionBody,
          variant: "danger",
        });
        return;
      }
      if (resultado.code === "rate-limited") {
        toast({
          title: SHARE_COPY.errorLimiteTitle,
          description: SHARE_COPY.errorLimiteBody,
          variant: "danger",
        });
        return;
      }
      toast({
        title: SHARE_COPY.errorTitle,
        description: SHARE_COPY.errorBody,
        variant: "danger",
      });
    });
  }

  async function compartirAfuera() {
    if (props.mensajeOrigen) return;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ ...(titulo ? { title: titulo } : {}), url: props.url });
        props.onCompartidoAfuera?.();
        onClose();
        return;
      }
      await copiarEnlace();
    } catch {
      // La persona canceló la hoja del sistema. No es un error y no se cuenta.
    }
  }

  async function copiarEnlace() {
    if (props.mensajeOrigen) return;
    try {
      await navigator.clipboard.writeText(props.url);
      props.onCompartidoAfuera?.();
      toast({
        title: SHARE_COPY.copiadoTitle,
        description: SHARE_COPY.copiadoBody,
        variant: "success",
      });
      onClose();
    } catch {
      toast({
        title: SHARE_COPY.copiarErrorTitle,
        description: SHARE_COPY.copiarErrorBody,
        variant: "danger",
      });
    }
  }

  function compartirFacebook() {
    if (props.mensajeOrigen) return;
    const destino = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(props.url)}`;
    window.open(destino, "_blank", "noopener,noreferrer");
    props.onCompartidoAfuera?.();
    onClose();
  }

  async function compartirInstagram() {
    if (props.mensajeOrigen) return;
    const pestaña = window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
    try {
      await navigator.clipboard.writeText(props.url);
      props.onCompartidoAfuera?.();
      toast({
        title: SHARE_COPY.copiadoTitle,
        description: SHARE_COPY.copiadoBody,
        variant: "success",
      });
      onClose();
    } catch {
      pestaña?.close();
      toast({
        title: SHARE_COPY.copiarErrorTitle,
        description: SHARE_COPY.copiarErrorBody,
        variant: "danger",
      });
    }
  }

  const cantidad = elegidos.size;
  const listos = estado.fase === "listo" ? estado.destinos : [];
  // Mientras el término cambió pero la respuesta no llegó, se muestra el
  // esqueleto y no los resultados viejos: una lista de "Ram" cuando en pantalla
  // dice "Ramón" es la forma más rápida de que un buscador parezca roto.
  const desactualizado = estado.fase === "listo" && estado.termino !== termino;
  const cargando = estado.fase === "cargando" || desactualizado;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={SHARE_COPY.sheetTitle}
      size="tall"
      keyboardAware
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
    >
      {/* Lo que se está compartiendo, arriba de todo: quien abre el panel tiene
          que ver qué está por mandar antes de elegir a quién. Sin título no se
          pinta nada — ver el doc de `titulo`. */}
      {titulo && (
        <div className="flex items-center gap-3 border-b border-border-subtle px-6 pb-4">
          <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-surface-subtle">
            {imagenUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- miniatura de 48px ya cargada en la pantalla de atrás
              <img src={imagenUrl} alt="" className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-foreground-muted">
                <ShareNetwork size={20} aria-hidden="true" />
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">
              {titulo}
            </span>
            {detalle && (
              <span className="numeric block truncate text-sm font-bold text-brand-ink">
                {detalle}
              </span>
            )}
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-4">
        {/* ── Bloque 1: adentro ────────────────────────────────────────────── */}
        <h3 className="font-display text-base font-bold text-foreground">
          {SHARE_COPY.dentroTitle}
        </h3>
        <p className="mt-0.5 text-sm text-foreground-secondary">
          {esReenvio ? SHARE_COPY.reenviarHint : SHARE_COPY.dentroHint}
        </p>

        <div className="relative mt-3">
          <label htmlFor={inputId} className="sr-only">
            {SHARE_COPY.buscarLabel}
          </label>
          <MagnifyingGlass
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted"
          />
          <Input
            id={inputId}
            type="search"
            inputMode="search"
            autoComplete="off"
            value={valor}
            onChange={(event) => setValor(event.target.value)}
            placeholder={SHARE_COPY.buscarPlaceholder}
            className="h-12 rounded-full pl-11 pr-11"
          />
          {valor.length > 0 && (
            <button
              type="button"
              onClick={() => setValor("")}
              aria-label={SHARE_COPY.buscarLimpiar}
              className={cn(
                "absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full",
                "text-foreground-muted transition-colors hover:bg-surface-subtle hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              )}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        <p role="status" aria-live="polite" className="sr-only">
          {cargando
            ? SHARE_COPY.buscando
            : estado.fase === "listo"
              ? SHARE_COPY.seleccionados(cantidad)
              : ""}
        </p>

        {cargando ? (
          /* Esqueleto que CALCA la fila real (avatar 40px + dos líneas + caja de
             selección), no un spinner: al llegar los datos nada se mueve de lugar. */
          <ul className="mt-3 flex flex-col gap-1" aria-hidden="true">
            {[0, 1, 2, 3].map((fila) => (
              <li key={fila} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <span className="min-w-0 flex-1">
                  <Skeleton className="h-3.5 w-32 rounded" />
                  <Skeleton className="mt-1.5 h-3 w-20 rounded" />
                </span>
                <Skeleton className="size-6 shrink-0 rounded-md" />
              </li>
            ))}
          </ul>
        ) : estado.fase === "error" ? (
          <p className="mt-4 px-1 text-sm text-foreground-secondary">
            {SHARE_COPY.buscarError}
          </p>
        ) : listos.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-6 text-center">
            <p className="text-sm font-semibold text-foreground">
              {estado.fase === "listo" && !estado.recientes
                ? SHARE_COPY.buscarVacio(estado.termino)
                : SHARE_COPY.vacioTitle}
            </p>
            {estado.fase === "listo" && estado.recientes && (
              <p className="mt-1 text-sm text-foreground-secondary">
                {SHARE_COPY.vacioBody}
              </p>
            )}
          </div>
        ) : (
          <>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              {estado.fase === "listo" && estado.recientes
                ? SHARE_COPY.recientesTitle
                : SHARE_COPY.resultadosTitle}
            </p>
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {listos.map((destino) => (
                <FilaDestino
                  key={claveDe(destino)}
                  destino={destino}
                  elegido={elegidos.has(claveDe(destino))}
                  onToggle={() => alternar(destino)}
                  reduceMotion={Boolean(reduceMotion)}
                />
              ))}
            </ul>
          </>
        )}

        {/* La nota aparece SÓLO cuando ya hay a quién mandársela: un campo de
            texto sobre una lista vacía es una pregunta que todavía no toca. */}
        <AnimatePresence initial={false}>
          {cantidad > 0 && !esReenvio && (
            <m.div
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
              transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
              className="mt-4"
            >
              <label htmlFor={`${inputId}-nota`} className="sr-only">
                {SHARE_COPY.notaLabel}
              </label>
              <Input
                id={`${inputId}-nota`}
                value={nota}
                onChange={(event) => setNota(event.target.value)}
                placeholder={SHARE_COPY.notaPlaceholder}
                maxLength={2000}
                className="h-12 rounded-xl"
              />
            </m.div>
          )}
        </AnimatePresence>

        {/* ── Bloque 2: afuera ─────────────────────────────────────────────── */}
        {!esReenvio && <div className="mt-6 border-t border-border-subtle pt-4">
          <h3 className="font-display text-base font-bold text-foreground">
            {SHARE_COPY.afueraTitle}
          </h3>
          <p className="mt-0.5 text-sm text-foreground-secondary">
            {SHARE_COPY.afueraHint}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2 pb-4">
            <BotonAfuera
              onClick={compartirFacebook}
              icon={<FacebookLogo size={20} aria-hidden="true" />}
              label={SHARE_COPY.facebook}
              ariaLabel={SHARE_COPY.facebookLabel}
            />
            <BotonAfuera
              onClick={() => void compartirInstagram()}
              icon={<InstagramLogo size={20} aria-hidden="true" />}
              label={SHARE_COPY.instagram}
              ariaLabel={SHARE_COPY.instagramLabel}
            />
            <BotonAfuera
              onClick={compartirAfuera}
              icon={<ShareNetwork size={20} aria-hidden="true" />}
              label={SHARE_COPY.compartirNativo}
              ariaLabel={SHARE_COPY.compartirNativoLabel}
            />
            <BotonAfuera
              onClick={copiarEnlace}
              icon={<LinkIcon size={20} aria-hidden="true" />}
              label={SHARE_COPY.copiarEnlace}
            />
          </div>
        </div>}
      </div>

      {/* BARRA DE ENVÍO ANCLADA. Entra desde abajo cuando hay algo seleccionado
          y se va cuando no queda nada: ocupar ese espacio siempre le robaría una
          fila a la lista en las pantallas de 375px. */}
      <AnimatePresence>
        {cantidad > 0 && (
          <m.div
            initial={reduceMotion ? { opacity: 0 } : { y: "100%" }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
            exit={
              reduceMotion
                ? { opacity: 0, transition: { duration: 0.15 } }
                : { y: "100%", transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }
            }
            transition={{ duration: 0.34, ease: [0.32, 0.72, 0, 1] }}
            className="shrink-0 border-t border-border-subtle bg-surface-raised px-6 pb-1 pt-3"
          >
            <button
              type="button"
              onClick={enviar}
              disabled={enviando}
              className={cn(
                "flex h-12 w-full items-center justify-center gap-2 rounded-full",
                "bg-brand text-brand-foreground",
                "font-semibold",
                "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
                "hover:bg-brand-hover active:scale-[0.98]",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                "disabled:opacity-60",
              )}
            >
              {enviando ? SHARE_COPY.enviando : SHARE_COPY.enviarA(cantidad)}
              {!enviando && <ArrowRight size={18} weight="bold" aria-hidden="true" />}
            </button>
          </m.div>
        )}
      </AnimatePresence>
    </BottomSheet>
  );
}

/**
 * Una fila de la lista de destinos.
 *
 * Es un `checkbox` de verdad (`role="checkbox"` + `aria-checked`) y no un botón
 * que cambia de color: quien navega con lector de pantalla tiene que oír que
 * esto se marca y se desmarca, no que "se activa".
 */
function FilaDestino({
  destino,
  elegido,
  onToggle,
  reduceMotion,
}: {
  destino: Destino;
  elegido: boolean;
  onToggle: () => void;
  reduceMotion: boolean;
}) {
  const esGrupo = destino.tipo === "grupo";
  const subtitulo = esGrupo
    ? SHARE_COPY.grupoMiembros(destino.miembros)
    : destino.detalle;

  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={elegido}
        aria-label={SHARE_COPY.seleccionar(destino.nombre)}
        onClick={onToggle}
        className={cn(
          // 44px de área táctil mínima: la fila mide 64px de alto.
          "flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left",
          "transition-colors duration-(--duration-fast)",
          elegido ? "bg-brand-tint" : "hover:bg-surface-subtle",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
        )}
      >
        <span className="relative shrink-0">
          <Avatar src={destino.avatarUrl} name={destino.nombre} size="md" />
          {esGrupo && (
            <span
              aria-hidden="true"
              className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-surface-raised text-foreground-muted ring-2 ring-surface-raised"
            >
              <UsersThree size={11} weight="fill" />
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">
            {destino.nombre}
          </span>
          {subtitulo && (
            <span className="block truncate text-xs text-foreground-muted">
              {subtitulo}
            </span>
          )}
        </span>

        {/* La caja de selección. El tilde entra con un rebote corto — es el
            único momento del panel donde el movimiento dice algo ("quedó
            marcado"), así que es el único que lo tiene. */}
        <span
          aria-hidden="true"
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md border-2",
            "transition-[background-color,border-color] duration-(--duration-fast)",
            elegido ? "border-brand bg-brand" : "border-border bg-transparent",
          )}
        >
          <AnimatePresence initial={false}>
            {elegido && (
              <m.span
                initial={reduceMotion ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
                animate={reduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                transition={{ duration: 0.28, ease: [0.34, 1.56, 0.64, 1] }}
                className="flex text-brand-foreground"
              >
                <Check size={14} weight="bold" />
              </m.span>
            )}
          </AnimatePresence>
        </span>
      </button>
    </li>
  );
}

/** Los dos botones del bloque de afuera: mismo peso visual, ninguno es el primario. */
function BotonAfuera({
  onClick,
  icon,
  label,
  ariaLabel,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  /** El texto completo cuando la etiqueta visible se acortó para que entre. */
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
      className={cn(
        "flex h-12 items-center justify-center gap-2 rounded-xl border border-border px-3",
        "text-sm font-semibold text-foreground",
        "transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
        "hover:border-brand hover:bg-brand-tint active:scale-[0.97]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
      )}
    >
      <span className="shrink-0 text-foreground-secondary">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
