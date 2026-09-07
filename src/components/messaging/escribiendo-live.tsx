"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  EVENTO_ESCRIBIENDO,
  MAX_HILOS_ESCUCHADOS,
  THROTTLE_MS,
  VIGENCIA_MS,
  esAvisoDeEscritura,
  esTopicoDeEscritura,
  resolverQuienEscribe,
} from "@/lib/messaging/escribiendo";
import { COPY } from "./copy";

/**
 * =============================================================================
 * "ESTÁ ESCRIBIENDO…" EN VIVO — Supabase Realtime broadcast (0143 + 0148)
 * =============================================================================
 *
 * La objeción que tenía este indicador hasta hoy —escrita en `inbox-row.tsx` y
 * en `lib/messaging/presencia.ts`— era correcta y ya no aplica: derivarlo del
 * refresco de 15 s producía un cartel que aparecía cuando la persona ya había
 * dejado de escribir. Con la 0143 el proyecto tiene Realtime, así que el dato
 * llega en el momento o no llega.
 *
 * ─── UN SOLO PROVIDER PARA LAS TRES PANTALLAS ───────────────────────────────
 * El hilo 1-a-1 y el de grupo montan un tópico; la bandeja monta varios. Es el
 * mismo mecanismo con distinto largo de lista, así que es el mismo componente:
 * dos implementaciones se habrían separado en el primer arreglo.
 *
 * ─── LAS TRES GARANTÍAS QUE ESTE ARCHIVO TIENE QUE CUMPLIR ──────────────────
 *
 *  1. NUNCA QUEDA PEGADO. Cada id activo tiene su propio reloj de
 *     `VIGENCIA_MS` que se reinicia con cada aviso. Quien cierra la pestaña de
 *     golpe no manda ninguna despedida, y el cartel se apaga solo igual.
 *  2. NUNCA MIENTE CON EL NOMBRE. El payload viaja con el id pelado y el nombre
 *     lo resuelve el mapa que bajó el servidor (ver `resolverQuienEscribe`).
 *  3. NUNCA SE ESCUCHA A SÍ MISMO. `broadcast.self` queda en `false` y además
 *     se descarta el propio id al recibir: dos pestañas de la misma persona no
 *     se hacen escribir la una a la otra.
 *
 * ⚠️ `setAuth()` ANTES DE `subscribe()`, SIEMPRE. Los canales son privados
 * (`config.private`), así que Realtime evalúa las policies de la 0148 con el
 * token de la sesión. Sin esa línea el canal conecta y no llega un solo aviso
 * — el mismo silencio que describe `lib/calls/vigilancia.ts`.
 */

interface Contexto {
  /** Ids activos por tópico, en orden de llegada. */
  porTopico: Readonly<Record<string, string[]>>;
  principal: string | null;
  avisar: (activo: boolean, topico?: string) => void;
}

const EscribiendoContext = createContext<Contexto | null>(null);

export interface EscribiendoProviderProps {
  /** Uno en un hilo, varios en la bandeja. Se ignoran los mal formados. */
  topicos: readonly string[];
  miId: string;
  children: ReactNode;
}

export function EscribiendoProvider({ topicos, miId, children }: EscribiendoProviderProps) {
  const [porTopico, setPorTopico] = useState<Record<string, string[]>>({});
  const canalesRef = useRef<Map<string, RealtimeChannel>>(new Map());
  const relojesRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const ultimoAvisoRef = useRef<Map<string, { cuando: number; activo: boolean }>>(new Map());

  /**
   * La lista se identifica por su CONTENIDO y no por identidad de objeto: sin
   * esto, un array literal en la página reabriría todos los canales en cada
   * render. Mismo cuidado que `useSeñal` en `lib/calls/vigilancia.ts`.
   */
  const clave = useMemo(() => {
    const validos = topicos.filter(esTopicoDeEscritura).slice(0, MAX_HILOS_ESCUCHADOS);
    return [...new Set(validos)].join("|");
  }, [topicos]);

  const principal = clave ? clave.split("|")[0] : null;

  useEffect(() => {
    if (!clave || !miId) return;

    const lista = clave.split("|");
    const supabase = createClient();
    const canales = canalesRef.current;
    const relojes = relojesRef.current;
    const ultimosAvisos = ultimoAvisoRef.current;
    let vivo = true;

    const olvidar = (topico: string, de: string) => {
      relojes.delete(`${topico}|${de}`);
      setPorTopico((previo) => {
        const actuales = previo[topico];
        if (!actuales?.includes(de)) return previo;
        const quedan = actuales.filter((id) => id !== de);
        const siguiente = { ...previo };
        if (quedan.length === 0) delete siguiente[topico];
        else siguiente[topico] = quedan;
        return siguiente;
      });
    };

    const recibir = (topico: string, payload: unknown) => {
      if (!vivo || !esAvisoDeEscritura(payload)) return;
      if (payload.de === miId) return;

      const llave = `${topico}|${payload.de}`;
      const reloj = relojes.get(llave);
      if (reloj) clearTimeout(reloj);

      if (!payload.activo) {
        olvidar(topico, payload.de);
        return;
      }

      relojes.set(
        llave,
        setTimeout(() => olvidar(topico, payload.de), VIGENCIA_MS),
      );

      setPorTopico((previo) => {
        const actuales = previo[topico] ?? [];
        if (actuales.includes(payload.de)) return previo;
        return { ...previo, [topico]: [...actuales, payload.de] };
      });
    };

    for (const topico of lista) {
      const canal = supabase.channel(topico, {
        config: { private: true, broadcast: { self: false } },
      });
      canal.on("broadcast", { event: EVENTO_ESCRIBIENDO }, (mensaje) =>
        recibir(topico, (mensaje as { payload?: unknown }).payload),
      );
      canales.set(topico, canal);
    }

    void (async () => {
      await supabase.realtime.setAuth().catch(() => undefined);
      if (!vivo) return;
      for (const canal of canales.values()) canal.subscribe();
    })();

    return () => {
      vivo = false;
      for (const reloj of relojes.values()) clearTimeout(reloj);
      relojes.clear();
      ultimosAvisos.clear();
      for (const canal of canales.values()) void supabase.removeChannel(canal);
      canales.clear();
      setPorTopico({});
    };
  }, [clave, miId]);

  const avisar = useCallback(
    (activo: boolean, topico?: string) => {
      const destino = topico ?? (clave ? clave.split("|")[0] : null);
      if (!destino || !miId) return;
      const canal = canalesRef.current.get(destino);
      if (!canal) return;

      const ahora = Date.now();
      const previo = ultimoAvisoRef.current.get(destino);

      if (activo) {
        if (previo?.activo && ahora - previo.cuando < THROTTLE_MS) return;
      } else {
        /**
         * El "dejé de escribir" NO se throttlea —apaga el cartel del otro lado
         * antes de que venza solo— pero tampoco se repite: el composer llama a
         * esto en cada tecla, así que con el campo vacío mandaría una señal por
         * pulsación. Sin sesión activa que apagar, no hay nada que avisar.
         */
        if (!previo?.activo) return;
      }

      ultimoAvisoRef.current.set(destino, { cuando: ahora, activo });

      void canal.send({
        type: "broadcast",
        event: EVENTO_ESCRIBIENDO,
        payload: { de: miId, activo },
      });
    },
    [clave, miId],
  );

  const valor = useMemo<Contexto>(
    () => ({ porTopico, principal, avisar }),
    [porTopico, principal, avisar],
  );

  return <EscribiendoContext.Provider value={valor}>{children}</EscribiendoContext.Provider>;
}

/**
 * Los ids que están tecleando en un tópico. Sin argumento devuelve los del
 * tópico principal, que es lo que necesitan las dos pantallas de hilo.
 *
 * Fuera del provider devuelve una lista vacía y quien lo use no dibuja nada:
 * ninguna pantalla puede caerse porque falte un adorno.
 */
export function useQuienEscribe(topico?: string): string[] {
  const ctx = useContext(EscribiendoContext);
  if (!ctx) return VACIO;
  const destino = topico ?? ctx.principal;
  if (!destino) return VACIO;
  return ctx.porTopico[destino] ?? VACIO;
}

/** Identidad estable: un `[]` nuevo por render reejecutaría cada `useMemo` de arriba. */
const VACIO: string[] = [];

/**
 * Lo que llama el composer en cada tecla. El throttle vive adentro, así que
 * llamarlo de más no cuesta nada — que es justo lo que hace un `onChange`.
 */
export function useAvisoDeEscritura(): (activo: boolean) => void {
  const ctx = useContext(EscribiendoContext);
  return useCallback((activo: boolean) => ctx?.avisar(activo), [ctx]);
}

/* -------------------------------------------------------------------------- */
/* Lo que se ve                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Los tres puntitos.
 *
 * Con `animate-pulse` de Tailwind y tres retardos, y no con un `@keyframes`
 * propio: el único lugar donde vive una animación global es `app/globals.css`,
 * y este adorno no justifica sumarle una regla que después hay que recordar.
 * `prefers-reduced-motion` los deja quietos y el texto sigue diciendo lo mismo:
 * el movimiento acá es decoración, no información.
 */
function Puntitos({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center gap-0.5", className)}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{ animationDelay: `${i * 180}ms` }}
          className="size-1 animate-pulse rounded-full bg-current motion-reduce:animate-none"
        />
      ))}
    </span>
  );
}

export interface QuienEscribeProps {
  /** Omitido, escucha el tópico principal del provider. */
  topico?: string;
  /**
   * `id → nombre` para el hilo de grupo. Sin mapa —el 1-a-1— el renglón dice
   * "Está escribiendo…" sin nombrar a nadie, que es lo correcto cuando del
   * otro lado hay una sola persona y su nombre ya está arriba.
   */
  nombres?: Readonly<Record<string, string>>;
  className?: string;
}

/**
 * El renglón. Devuelve `null` cuando no hay nadie tecleando, así que quien lo
 * monta puede dejarlo fijo en el layout sin reservar lugar.
 */
export function QuienEscribe({ topico, nombres, className }: QuienEscribeProps) {
  const ids = useQuienEscribe(topico);
  if (ids.length === 0) return null;

  const texto = describir(ids, nombres);

  return (
    <span
      // `polite` y no `assertive`: alguien tecleando no interrumpe lo que se
      // esté leyendo. Es la misma cortesía que en pantalla.
      aria-live="polite"
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-brand-ink",
        className,
      )}
    >
      <Puntitos />
      <span className="min-w-0 truncate">{texto}</span>
    </span>
  );
}

function describir(ids: readonly string[], nombres?: Readonly<Record<string, string>>): string {
  const E = COPY.escribiendo;
  if (!nombres) return E.solo;

  const mapa = new Map(Object.entries(nombres));
  const resueltos = resolverQuienEscribe(ids, mapa, E.generico);
  if (resueltos.length === 1) return E.una(resueltos[0]);
  if (resueltos.length === 2) return E.dos(resueltos[0], resueltos[1]);
  return E.varias;
}

/**
 * UN RENGLÓN QUE SE REEMPLAZA MIENTRAS ALGUIEN ESCRIBE.
 *
 * Recibe como `children` lo que el SERVIDOR ya pintó —el resumen de la fila de
 * la bandeja, el "N miembros" del grupo— y lo tapa nada más que mientras dura
 * el aviso. Se resuelve con un slot y no moviendo el bloque entero al cliente:
 * `inbox-row.tsx` arma el ícono, el tilde de leído y el texto con datos que el
 * servidor ya tiene, y bajarlos todos al navegador para tapar un renglón dos
 * segundos sería pagar la fila completa por el adorno.
 */
export function RenglonEnVivo({
  topico,
  nombres,
  children,
  className,
}: {
  topico: string;
  nombres?: Readonly<Record<string, string>>;
  children: ReactNode;
  className?: string;
}) {
  const ids = useQuienEscribe(topico);
  if (ids.length === 0) return <>{children}</>;
  return <QuienEscribe topico={topico} nombres={nombres} className={className} />;
}
