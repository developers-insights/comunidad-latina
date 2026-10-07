"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import {
  sumarEntrantes as combinarEntrantes,
  textoDeEntrante,
  type MensajeEntrante,
} from "@/lib/messaging/en-vivo";
import { COPY } from "./copy";

/**
 * MENSAJES EN VUELO — lo que se ve antes de que el servidor vuelva a pintar.
 *
 * Dos cosas viven acá y por el mismo motivo (el hilo es un Server Component y
 * re-renderizarlo cuesta un viaje entero):
 *
 *  · PENDIENTES: lo que acabo de mandar. Aparece en el mismo frame del Enter;
 *    si la action falla, el composer lo retira y devuelve el texto al campo.
 *  · ENTRANTES: lo que llegó por el timbre (`hilo-en-vivo.tsx`) y ya se leyó
 *    de la base, pero todavía no volvió en el render del servidor.
 *
 * Las server actions no devuelven el id del mensaje creado, así que una
 * pendiente no se casa por id: se retira en orden (FIFO) a medida que aparecen
 * mensajes PROPIOS nuevos, vengan del servidor o del timbre. El temporizador de
 * `confirmar` es la red por si ninguno de los dos lo trae.
 *
 * Lo montan el hilo de la página y el chat de la llamada; fuera del provider
 * todo esto es inerte y el composer espera como siempre.
 */

export interface MensajeEnVuelo {
  tempId: string;
  body: string;
}

interface EnVueloCtx {
  pendientes: MensajeEnVuelo[];
  entrantes: MensajeEntrante[];
  agregar: (body: string) => string;
  confirmar: (tempId: string) => void;
  quitar: (tempId: string) => void;
  reportar: (mensajes: { id: string; propio: boolean }[]) => void;
  recibir: (mensajes: MensajeEntrante[]) => void;
}

const Ctx = createContext<EnVueloCtx | null>(null);

const RED_DE_SEGURIDAD_MS = 10_000;

export function EnVueloProvider({
  children,
  onNuevosAjenos,
}: {
  children: React.ReactNode;
  /** Cuántos mensajes de otras personas llegaron desde el último reporte. */
  onNuevosAjenos?: (cantidad: number) => void;
}) {
  const [pendientes, setPendientes] = useState<MensajeEnVuelo[]>([]);
  const [entrantes, setEntrantes] = useState<MensajeEntrante[]>([]);
  const delServidor = useRef<Set<string> | null>(null);
  const vistos = useRef(new Set<string>());
  const contador = useRef(0);
  const temporizadores = useRef(new Map<string, number>());
  const alNuevos = useRef(onNuevosAjenos);
  useEffect(() => {
    alNuevos.current = onNuevosAjenos;
  }, [onNuevosAjenos]);

  useEffect(() => {
    const mapa = temporizadores.current;
    return () => mapa.forEach((id) => window.clearTimeout(id));
  }, []);

  const quitar = useCallback((tempId: string) => {
    const id = temporizadores.current.get(tempId);
    if (id !== undefined) window.clearTimeout(id);
    temporizadores.current.delete(tempId);
    setPendientes((lista) => lista.filter((p) => p.tempId !== tempId));
  }, []);

  const agregar = useCallback((body: string) => {
    contador.current += 1;
    const tempId = `en-vuelo-${contador.current}`;
    setPendientes((lista) => [...lista, { tempId, body }]);
    return tempId;
  }, []);

  const confirmar = useCallback(
    (tempId: string) => {
      const id = window.setTimeout(() => quitar(tempId), RED_DE_SEGURIDAD_MS);
      temporizadores.current.set(tempId, id);
    },
    [quitar],
  );

  /** Lo nuevo de verdad: retira pendientes propias y avisa las ajenas. */
  const contar = useCallback((mensajes: { id: string; propio: boolean }[]) => {
    const nuevos = mensajes.filter((m) => !vistos.current.has(m.id));
    if (nuevos.length === 0) return;
    for (const m of nuevos) vistos.current.add(m.id);

    const propios = nuevos.filter((m) => m.propio).length;
    const ajenos = nuevos.length - propios;
    if (propios > 0) {
      setPendientes((lista) => {
        for (const p of lista.slice(0, propios)) {
          const id = temporizadores.current.get(p.tempId);
          if (id !== undefined) window.clearTimeout(id);
          temporizadores.current.delete(p.tempId);
        }
        return lista.slice(propios);
      });
    }
    if (ajenos > 0) alNuevos.current?.(ajenos);
  }, []);

  const reportar = useCallback(
    (mensajes: { id: string; propio: boolean }[]) => {
      const ids = new Set(mensajes.map((m) => m.id));
      // El primer reporte es la línea de base: lo que ya estaba al abrir el
      // hilo no es "nuevo" y no debe prender ningún contador.
      if (delServidor.current === null) {
        delServidor.current = ids;
        for (const id of ids) vistos.current.add(id);
        return;
      }
      delServidor.current = ids;
      contar(mensajes);
      setEntrantes((lista) =>
        lista.some((m) => ids.has(m.id)) ? lista.filter((m) => !ids.has(m.id)) : lista,
      );
    },
    [contar],
  );

  const recibir = useCallback(
    (mensajes: MensajeEntrante[]) => {
      const conocidos = delServidor.current ?? new Set<string>();
      const nuevos = mensajes.filter((m) => !conocidos.has(m.id));
      if (nuevos.length === 0) return;
      contar(nuevos.map((m) => ({ id: m.id, propio: m.propio })));
      setEntrantes((lista) => combinarEntrantes(lista, nuevos, conocidos));
    },
    [contar],
  );

  const valor = useMemo(
    () => ({ pendientes, entrantes, agregar, confirmar, quitar, reportar, recibir }),
    [pendientes, entrantes, agregar, confirmar, quitar, reportar, recibir],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

/**
 * El provider sólo si nadie lo puso antes. El chat de la llamada monta el suyo
 * —con el contador de no leídos del botón— y el hilo no puede taparlo con otro.
 */
export function EnVueloSiFalta({ children }: { children: React.ReactNode }) {
  const ctx = useContext(Ctx);
  if (ctx) return <>{children}</>;
  return <EnVueloProvider>{children}</EnVueloProvider>;
}

export function useEnvioOptimista() {
  const ctx = useContext(Ctx);
  return ctx
    ? { agregar: ctx.agregar, confirmar: ctx.confirmar, quitar: ctx.quitar }
    : null;
}

/** Para `hilo-en-vivo.tsx`: entrega lo que el timbre trajo de la base. */
export function useRecibirEntrantes(): ((mensajes: MensajeEntrante[]) => void) | null {
  return useContext(Ctx)?.recibir ?? null;
}

/**
 * Va al final de la lista del hilo: reporta qué mensajes pintó el servidor y
 * dibuja lo que todavía no volvió de él.
 */
export function MensajesEnVuelo({
  mensajes,
  conAutor = false,
}: {
  mensajes: { id: string; propio: boolean }[];
  /** En un grupo, la burbuja ajena dice de quién es. */
  conAutor?: boolean;
}) {
  const ctx = useContext(Ctx);
  const reportar = ctx?.reportar;
  const firma = mensajes.map((m) => m.id).join(",");

  useEffect(() => {
    reportar?.(mensajes);
    // `firma` resume la lista: el arreglo llega nuevo en cada refresco del
    // servidor aunque no haya cambiado nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma, reportar]);

  const cantidad = (ctx?.pendientes.length ?? 0) + (ctx?.entrantes.length ?? 0);
  const finRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (cantidad === 0) return;
    const fin = finRef.current;
    const scroller = fin?.closest<HTMLElement>("[data-chat-scroller]");
    if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    else fin?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [cantidad]);

  if (!ctx || cantidad === 0) return null;

  return (
    <>
      {ctx.entrantes.map((m) => (
        <BurbujaEntrante key={m.id} mensaje={m} conAutor={conAutor} />
      ))}
      {ctx.pendientes.map((p) => (
        <div key={p.tempId} className="flex justify-end" data-en-vuelo="true">
          <div className="max-w-[80%] rounded-2xl rounded-br-md bg-brand-tint px-4 py-2.5 text-foreground opacity-75">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {p.body}
            </p>
            <p className="mt-1 text-right text-[11px] text-foreground-secondary">
              {COPY.composer.enviando}
            </p>
          </div>
        </div>
      ))}
      <div ref={finRef} aria-hidden="true" />
    </>
  );
}

const HORA = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/**
 * La burbuja provisoria: el texto como llegó, o el resumen ("Foto") cuando es
 * un adjunto, hasta que el refresco traiga la de verdad con su menú, sus
 * reacciones y la imagen firmada.
 */
function BurbujaEntrante({
  mensaje,
  conAutor,
}: {
  mensaje: MensajeEntrante;
  conAutor: boolean;
}) {
  const { texto, esResumen } = textoDeEntrante(mensaje);
  const fecha = new Date(mensaje.created_at);
  return (
    <div
      className={cn("flex", mensaje.propio ? "justify-end" : "justify-start")}
      data-entrante="true"
    >
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-foreground",
          mensaje.propio ? "rounded-br-md bg-brand-tint" : "rounded-bl-md bg-surface-subtle",
        )}
      >
        {conAutor && !mensaje.propio && mensaje.autorNombre && (
          <p className="mb-0.5 truncate text-xs font-semibold text-foreground-secondary">
            {mensaje.autorNombre}
          </p>
        )}
        <p
          className={cn(
            "whitespace-pre-wrap break-words text-sm leading-relaxed",
            esResumen && "italic text-foreground-secondary",
          )}
        >
          {texto}
        </p>
        <p
          className={cn(
            "mt-1 text-[10px] text-foreground-secondary",
            mensaje.propio ? "text-right" : "text-left",
          )}
        >
          {Number.isNaN(fecha.getTime()) ? "" : HORA.format(fecha)}
        </p>
      </div>
    </div>
  );
}
