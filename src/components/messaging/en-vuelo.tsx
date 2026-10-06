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
import { COPY } from "./copy";

/**
 * MENSAJES EN VUELO — envío optimista y aviso de mensajes nuevos.
 *
 * Lo usa el chat que vive adentro de la pantalla de llamada. Ahí cada envío
 * espera la server action y después un `router.refresh()` de la página ENTERA
 * de la llamada; sin burbuja optimista, el mensaje tardaba un segundo largo en
 * aparecer y parecía que no había salido.
 *
 * Las server actions no devuelven el id del mensaje creado, así que la burbuja
 * en vuelo no se puede casar por id: se retira en orden (FIFO) a medida que
 * aparecen mensajes PROPIOS que no estaban en la lista anterior. El
 * temporizador de `confirmar` es la red por si el refresco no trae el mensaje
 * (por ejemplo, el hilo ya estaba en su tope de mensajes cargados).
 *
 * Fuera del provider todo esto es inerte: `useEnvioOptimista()` da `null` y el
 * composer se comporta como en la página del hilo.
 */

export interface MensajeEnVuelo {
  tempId: string;
  body: string;
}

interface EnVueloCtx {
  pendientes: MensajeEnVuelo[];
  agregar: (body: string) => string;
  confirmar: (tempId: string) => void;
  quitar: (tempId: string) => void;
  reportar: (mensajes: { id: string; propio: boolean }[]) => void;
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
  const conocidos = useRef<Set<string> | null>(null);
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

  const reportar = useCallback(
    (mensajes: { id: string; propio: boolean }[]) => {
      // El primer reporte es la línea de base: lo que ya estaba al abrir la
      // llamada no es "nuevo" y no debe prender el contador.
      if (conocidos.current === null) {
        conocidos.current = new Set(mensajes.map((m) => m.id));
        return;
      }
      const vistos = conocidos.current;
      const nuevos = mensajes.filter((m) => !vistos.has(m.id));
      if (nuevos.length === 0) return;
      for (const m of nuevos) vistos.add(m.id);

      const propios = nuevos.filter((m) => m.propio).length;
      const ajenos = nuevos.length - propios;
      if (propios > 0) {
        setPendientes((lista) => {
          const salen = lista.slice(0, propios);
          for (const p of salen) {
            const id = temporizadores.current.get(p.tempId);
            if (id !== undefined) window.clearTimeout(id);
            temporizadores.current.delete(p.tempId);
          }
          return lista.slice(propios);
        });
      }
      if (ajenos > 0) alNuevos.current?.(ajenos);
    },
    [],
  );

  const valor = useMemo(
    () => ({ pendientes, agregar, confirmar, quitar, reportar }),
    [pendientes, agregar, confirmar, quitar, reportar],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useEnvioOptimista() {
  const ctx = useContext(Ctx);
  return ctx
    ? { agregar: ctx.agregar, confirmar: ctx.confirmar, quitar: ctx.quitar }
    : null;
}

/**
 * Va al final de la lista del hilo: reporta qué mensajes hay (para el contador
 * de no leídos y para retirar las burbujas en vuelo) y pinta las que todavía
 * no volvieron del servidor.
 */
export function MensajesEnVuelo({
  mensajes,
}: {
  mensajes: { id: string; propio: boolean }[];
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

  const cantidad = ctx?.pendientes.length ?? 0;
  const finRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (cantidad === 0) return;
    const scroller = finRef.current?.closest<HTMLElement>(
      "[data-chat-scroller]",
    );
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, [cantidad]);

  if (!ctx || cantidad === 0) return null;

  return (
    <>
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
