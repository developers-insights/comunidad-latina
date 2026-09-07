"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  ChatCircle,
  MagnifyingGlass,
  PhoneCall,
  UserPlus,
  UsersThree,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, Input, Spinner, useToast } from "@/components/ui";
import { cn, timeAgo } from "@/lib/utils";
import { abrirChatDirectoAction } from "@/app/(app)/mensajes/direct-actions";
import type {
  BusquedaEnMensajeria,
  ResultadoDeMensajeria,
  TipoDeResultado,
} from "@/app/(app)/mensajes/api/buscar/route";
import { COPY } from "./copy";

/**
 * =============================================================================
 * UNA SOLA BARRA PARA TODO MENSAJES
 * =============================================================================
 *
 * Pedido del cliente, agregado sobre el final: «una barra de búsqueda que
 * encuentre chats individuales, grupales y llamadas en un solo lugar».
 *
 * Antes acá había un buscador de PERSONAS: servía para empezar una conversación
 * nueva, no para volver a una que ya existía. Poner una segunda barra al lado
 * habría dejado dos campos casi idénticos y la pregunta "¿en cuál busco?" en
 * cada uso. Es una sola barra y los resultados vienen agrupados por sección.
 *
 * ── QUÉ PASA AL ELEGIR ──────────────────────────────────────────────────────
 * Un chat o un grupo NAVEGAN (son enlaces de verdad: se pueden abrir en otra
 * pestaña, el back funciona). Una PERSONA es distinta: todavía no hay
 * conversación, así que se abre el chat directo y recién después se navega —el
 * mismo camino de siempre, incluido que la conversación nace pendiente cuando
 * corresponde (§9.2)—. Por eso esa fila es un botón y no un enlace: lo que hace
 * no es ir a una dirección, es crear algo. Una LLAMADA no es ninguna de las dos:
 * es el registro de algo que pasó y todavía no hay pantalla de historial, así
 * que se muestra y no se toca (ver `hrefDe` en la ruta).
 *
 * ── CANCELACIÓN ─────────────────────────────────────────────────────────────
 * Cada tecla aborta la búsqueda anterior. Sin esto, escribir rápido deja tres
 * respuestas en vuelo y gana la que vuelva última — que puede ser la de "Ram"
 * cuando en pantalla ya dice "Ramón".
 */

type Estado =
  | { fase: "vacio" }
  | { fase: "buscando" }
  | { fase: "listo"; resultados: ResultadoDeMensajeria[]; termino: string }
  | { fase: "error" };

const SECCIONES: { tipo: TipoDeResultado; titulo: string }[] = [
  { tipo: "chat", titulo: COPY.inbox.findSectionChats },
  { tipo: "grupo", titulo: COPY.inbox.findSectionGroups },
  { tipo: "llamada", titulo: COPY.inbox.findSectionCalls },
  { tipo: "persona", titulo: COPY.inbox.findSectionPeople },
];

const ICONO: Record<TipoDeResultado, React.ComponentType<{ size?: number }>> = {
  chat: ChatCircle,
  grupo: UsersThree,
  llamada: PhoneCall,
  persona: UserPlus,
};

export function InboxSearch() {
  const router = useRouter();
  const { toast } = useToast();
  const inputId = useId();
  const [valor, setValor] = useState("");
  const [estado, setEstado] = useState<Estado>({ fase: "vacio" });
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const abortRef = useRef<AbortController | null>(null);
  const reduceMotion = useReducedMotion();

  const termino = valor.trim();
  const buscable = termino.length >= 2;

  useEffect(() => {
    /**
     * El estado "vacío" NO se setea acá: se DERIVA más abajo (`vista`). Setear
     * estado sincrónicamente dentro de un efecto dispara un render en cascada
     * —y el lint del repo lo prohíbe— cuando lo único que hace falta es no
     * mostrar resultados de una búsqueda que ya no corresponde.
     */
    if (!buscable) {
      abortRef.current?.abort();
      return;
    }

    // 200 ms: por debajo se dispara una consulta por letra, por encima se
    // siente trabado. Mismo orden de magnitud que /buscar.
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setEstado({ fase: "buscando" });

      try {
        const respuesta = await fetch(
          `/mensajes/api/buscar?q=${encodeURIComponent(termino)}`,
          { signal: controller.signal },
        );
        if (!respuesta.ok) {
          setEstado({ fase: "error" });
          return;
        }
        const datos = (await respuesta.json()) as Partial<BusquedaEnMensajeria>;
        setEstado({ fase: "listo", resultados: datos.resultados ?? [], termino });
      } catch (error) {
        // Abortar es lo NORMAL acá (una tecla más), no una falla: si se pintara
        // el error, escribir rápido mostraría "no pudimos buscar" en cada letra.
        if (error instanceof DOMException && error.name === "AbortError") return;
        setEstado({ fase: "error" });
      }
    }, 200);

    return () => window.clearTimeout(timer);
  }, [termino, buscable]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function escribirle(persona: ResultadoDeMensajeria) {
    if (ocupadoId) return;
    setOcupadoId(persona.id);

    startTransition(async () => {
      const resultado = await abrirChatDirectoAction({ profileId: persona.id });

      if (resultado.ok) {
        router.push(`/mensajes/${resultado.conversationId}`);
        return;
      }

      setOcupadoId(null);

      if (resultado.code === "blocked" || resultado.code === "self") {
        // MISMO texto para bloqueo, ignorado y perfil inexistente: cuál de los
        // tres pasó no es información que tenga que volver a quien pregunta.
        toast({ title: COPY.inbox.directBlocked, variant: "warning" });
        return;
      }
      if (resultado.code === "rate-limited") {
        toast({
          title: COPY.composer.rateLimitedTitle,
          description: COPY.composer.rateLimitedBody,
          variant: "warning",
        });
        return;
      }
      toast({
        title: COPY.composer.errorTitle,
        description: COPY.inbox.directError,
        variant: "danger",
      });
    });
  }

  /**
   * Lo que se PINTA, derivado de lo que hay escrito. Mientras el término cambió
   * pero la respuesta no llegó se muestra "buscando" y no los resultados del
   * término anterior: ver una lista de "Ram" cuando en pantalla ya dice "Ramón"
   * es la forma más rápida de que un buscador parezca roto.
   */
  const vista: Estado = !buscable
    ? { fase: "vacio" }
    : estado.fase === "listo" && estado.termino !== termino
      ? { fase: "buscando" }
      : estado;

  const resultados = vista.fase === "listo" ? vista.resultados : [];
  const ahora = new Date();

  return (
    <div className="mb-5 flex flex-col gap-3">
      <div className="relative">
        <label htmlFor={inputId} className="sr-only">
          {COPY.inbox.findLabel}
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
          placeholder={COPY.inbox.findPlaceholder}
          className="h-12 rounded-full pl-11 pr-11"
        />
        {valor.length > 0 && (
          <button
            type="button"
            onClick={() => setValor("")}
            aria-label={COPY.inbox.searchClear}
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

      {/* La única promesa accesible que hacemos: cuántos resultados hay. */}
      <p role="status" aria-live="polite" className="sr-only">
        {vista.fase === "buscando"
          ? COPY.inbox.findHint
          : vista.fase === "listo"
            ? COPY.inbox.findResults(vista.resultados.length)
            : ""}
      </p>

      {vista.fase === "buscando" && (
        <p className="flex items-center gap-2 px-1 text-sm text-foreground-muted">
          <Spinner size={16} />
          {COPY.inbox.findHint}
        </p>
      )}

      {vista.fase === "error" && (
        <p className="px-1 text-sm text-foreground-secondary">{COPY.inbox.findError}</p>
      )}

      {vista.fase === "listo" && vista.resultados.length === 0 && (
        <p className="px-1 text-sm text-foreground-secondary">
          {COPY.inbox.findEmpty(vista.termino)}
        </p>
      )}

      <AnimatePresence initial={false}>
        {resultados.length > 0 && (
          <m.div
            // Sólo `opacity`/`transform`: el panel aparece encima de la lista y
            // animar su alto haría saltar la bandeja entera en cada tecla.
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-xs"
          >
            {SECCIONES.map((seccion) => {
              const items = resultados.filter((r) => r.tipo === seccion.tipo);
              if (items.length === 0) return null;
              return (
                <section key={seccion.tipo} className="border-b border-border-subtle last:border-b-0">
                  <h2 className="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-foreground-muted uppercase">
                    {seccion.titulo}
                  </h2>
                  <ul>
                    {items.map((item) => (
                      <li key={`${item.tipo}:${item.id}`}>
                        <FilaDeResultado
                          item={item}
                          ahora={ahora}
                          ocupado={ocupadoId === item.id}
                          bloqueado={ocupadoId !== null}
                          onEscribirle={() => escribirle(item)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const FILA_CLASE = "flex w-full items-center gap-3 px-4 py-3 text-left";

/** Lo que se le suma a la fila cuando de verdad se puede tocar. */
const FILA_INTERACTIVA = cn(
  "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
  "hover:bg-surface-subtle",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
  "disabled:opacity-60",
);

function FilaDeResultado({
  item,
  ahora,
  ocupado,
  bloqueado,
  onEscribirle,
}: {
  item: ResultadoDeMensajeria;
  ahora: Date;
  ocupado: boolean;
  bloqueado: boolean;
  onEscribirle: () => void;
}) {
  const Icono = ICONO[item.tipo];

  const contenido = (
    <>
      {/* Una llamada no tiene cara propia —es un evento, no alguien—, así que
          va con su ícono. Chats, grupos y personas sí: el avatar (o sus
          iniciales) es lo que se reconoce de un vistazo. */}
      {item.tipo === "llamada" ? (
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
        >
          <Icono size={18} />
        </span>
      ) : (
        <Avatar src={item.avatarUrl} name={item.titulo} size="sm" />
      )}

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {item.titulo}
          </span>
          {item.cuando && (
            <time
              dateTime={item.cuando}
              className="shrink-0 text-[11px] tabular-nums text-foreground-muted"
            >
              {timeAgo(item.cuando, ahora)}
            </time>
          )}
        </span>
        {item.fragmento && (
          <span className="mt-0.5 block truncate text-xs text-foreground-secondary">
            {item.fragmento}
          </span>
        )}
      </span>
    </>
  );

  if (item.tipo === "persona") {
    return (
      <button
        type="button"
        disabled={bloqueado}
        onClick={onEscribirle}
        className={cn(FILA_CLASE, FILA_INTERACTIVA)}
      >
        {contenido}
        <span className="shrink-0 text-sm font-medium text-brand-ink">
          {ocupado ? <Spinner size={16} /> : COPY.inbox.openChat}
        </span>
      </button>
    );
  }

  // Sin destino no hay enlace. Hoy es el caso de las llamadas: son un registro
  // de algo que pasó y todavía no existe una pantalla de historial adonde ir
  // (ver `hrefDe` en la ruta). Se pinta como registro —sin hover, sin foco— en
  // vez de fingir un enlace muerto.
  if (!item.href) {
    return <div className={FILA_CLASE}>{contenido}</div>;
  }

  return (
    <Link href={item.href} className={cn(FILA_CLASE, FILA_INTERACTIVA)}>
      {contenido}
    </Link>
  );
}
