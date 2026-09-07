"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LLAMADA_COLUMNS, supabaseSinTiparLlamadas, type LlamadaRow } from "./tipos";

/**
 * =============================================================================
 * LA SEÑALIZACIÓN: CÓMO SE ENTERA UN TELÉFONO DE QUE LO ESTÁN LLAMANDO
 * =============================================================================
 *
 * Agora transporta audio y video, y nada más. No avisa que hay una llamada
 * esperando: para eso ya tenés que estar adentro del canal, y para estar adentro
 * del canal ya te tenías que haber enterado. Ese timbre lo tiene que poner la
 * app, y este archivo ES el timbre.
 *
 * ── CAMINO ELEGIDO: SUPABASE REALTIME, CON SONDEO COMO RED ──────────────────
 * El repo hasta hoy refresca con `router.refresh()` cada 15 segundos
 * (`thread-refresh.tsx`) y eso alcanza para un chat. Para un timbre no: un
 * teléfono que suena quince segundos tarde es un teléfono que suena cuando la
 * otra persona ya cortó. Así que la vía principal es `postgres_changes` sobre
 * `calls` y `call_participants` — llega en menos de un segundo y no consume una
 * consulta por persona cada pocos segundos.
 *
 * El sondeo NO es el plan B por si Realtime "falla a veces": es el plan B
 * mientras la publicación no esté habilitada en la base (hace falta un
 * `alter publication supabase_realtime add table …`, que es una migración). Sin
 * eso, `subscribe()` conecta igual y no llega ni un evento — un silencio que se
 * ve idéntico a "no pasó nada". Por eso el fallback no espera un error: si en
 * `ESPERA_DE_REALTIME_MS` no hubo confirmación de suscripción, arranca a sondear
 * igual, y si Realtime después confirma, el sondeo se apaga.
 *
 * Cuando la publicación esté puesta, esto no cambia: el sondeo simplemente no
 * llega a arrancar.
 */

/** Cuánto se espera la confirmación de Realtime antes de encender el sondeo. */
const ESPERA_DE_REALTIME_MS = 4_000;

/** Cada cuánto se pregunta cuando el timbre depende del sondeo. */
const SONDEO_MS = 5_000;

/**
 * Cuánto tiempo una llamada `sonando` sigue siendo un timbre.
 *
 * Pasado eso es una llamada perdida y no tiene sentido que suene: sin este
 * techo, abrir la app a la mañana haría sonar el teléfono por una llamada de
 * anoche que nadie atendió, porque la fila sigue en `sonando` hasta que alguien
 * la cierre.
 */
export const VENTANA_DE_TIMBRE_MS = 60_000;

export type ViaDeSeñalizacion = "conectando" | "realtime" | "sondeo";

interface Suscripcion {
  tabla: "calls" | "call_participants";
  filtro: string;
}

/**
 * Núcleo compartido: intenta Realtime sobre las suscripciones que le pasen y
 * cae al sondeo si no se confirma. Devuelve por qué vía está andando, que es
 * dato de diagnóstico y no de pantalla.
 */
function useSeñal(suscripciones: Suscripcion[], alAvisar: () => void): ViaDeSeñalizacion {
  const [via, setVia] = useState<ViaDeSeñalizacion>("conectando");
  const alAvisarRef = useRef(alAvisar);
  useEffect(() => {
    alAvisarRef.current = alAvisar;
  }, [alAvisar]);

  // Las suscripciones se identifican por su contenido y no por identidad de
  // objeto: sin esto, un array literal en el caller reconstruiría el canal en
  // cada render.
  const clave = suscripciones.map((s) => `${s.tabla}:${s.filtro}`).join("|");

  useEffect(() => {
    if (!clave) return;
    const supabase = createClient();
    let vivo = true;
    let sondeo: number | null = null;

    const partes = clave.split("|").map((entrada) => {
      const corte = entrada.indexOf(":");
      return { tabla: entrada.slice(0, corte), filtro: entrada.slice(corte + 1) };
    });

    const canal = supabase.channel(`llamadas:${clave}`);
    for (const parte of partes) {
      canal.on(
        "postgres_changes",
        { event: "*", schema: "public", table: parte.tabla, filter: parte.filtro },
        () => alAvisarRef.current(),
      );
    }

    const encenderSondeo = () => {
      if (!vivo || sondeo !== null) return;
      setVia("sondeo");
      sondeo = window.setInterval(() => {
        // Una pestaña en segundo plano no necesita preguntar: no hay nadie
        // mirándola y la consulta se paga igual.
        if (document.visibilityState === "visible") alAvisarRef.current();
      }, SONDEO_MS);
    };

    const reloj = window.setTimeout(encenderSondeo, ESPERA_DE_REALTIME_MS);

    void (async () => {
      // Realtime evalúa la RLS con el token de la sesión. Sin esto, un canal
      // sobre una tabla protegida conecta y no recibe una sola fila.
      await supabase.realtime.setAuth().catch(() => undefined);
      if (!vivo) return;

      canal.subscribe((estado) => {
        if (!vivo) return;
        if (estado === "SUBSCRIBED") {
          window.clearTimeout(reloj);
          if (sondeo !== null) {
            window.clearInterval(sondeo);
            sondeo = null;
          }
          setVia("realtime");
          // Entre que se montó y que la suscripción quedó lista pudo pasar algo.
          alAvisarRef.current();
          return;
        }
        if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT" || estado === "CLOSED") {
          encenderSondeo();
        }
      });
    })();

    return () => {
      vivo = false;
      window.clearTimeout(reloj);
      if (sondeo !== null) window.clearInterval(sondeo);
      void supabase.removeChannel(canal);
    };
  }, [clave]);

  return via;
}

/**
 * Mientras estás ADENTRO de una llamada: avisa cuando cambia su estado o su
 * lista de participantes. Es lo que hace que "fulano se sumó" y "cortaron"
 * aparezcan solos.
 */
export function useVigilanciaDeLlamada(callId: string, alCambiar: () => void): ViaDeSeñalizacion {
  const suscripciones = useMemo<Suscripcion[]>(
    () => [
      { tabla: "calls", filtro: `id=eq.${callId}` },
      { tabla: "call_participants", filtro: `call_id=eq.${callId}` },
    ],
    [callId],
  );
  return useSeñal(suscripciones, alCambiar);
}

export interface LlamadaEntrante {
  id: string;
  kind: string;
  groupId: string | null;
  iniciadaPor: string;
  createdAt: string;
  quienLlama: { displayName: string; avatarUrl: string | null } | null;
  grupoNombre: string | null;
}

/**
 * Fuera de una llamada: ¿me están llamando ahora?
 *
 * La consulta va contra `calls` y NO contra `call_participants`, aunque el
 * evento de Realtime sea la fila de participante. Es a propósito: `calls_select`
 * ya sólo devuelve las llamadas en las que estoy invitado, así que la pregunta
 * "¿hay una llamada sonando para mí?" es literalmente un `where status =
 * 'sonando'`. Preguntarlo del otro lado obligaría a traer mis filas de
 * participante de los últimos 90 días para descartarlas casi todas.
 */
export function useLlamadaEntrante(miId: string): {
  entrante: LlamadaEntrante | null;
  descartar: (callId: string) => void;
  via: ViaDeSeñalizacion;
} {
  const [entrante, setEntrante] = useState<LlamadaEntrante | null>(null);
  const descartadasRef = useRef<Set<string>>(new Set());

  const buscar = useCallback(() => {
    void (async () => {
      const supabase = createClient();
      const db = supabaseSinTiparLlamadas(supabase);
      const desde = new Date(Date.now() - VENTANA_DE_TIMBRE_MS).toISOString();

      const { data } = await db
        .from("calls")
        .select(LLAMADA_COLUMNS)
        .eq("status", "sonando")
        .neq("iniciada_por", miId)
        .gt("created_at", desde)
        .order("created_at", { ascending: false })
        .limit(1);

      const llamada = ((data ?? []) as unknown as LlamadaRow[])[0];
      if (!llamada || descartadasRef.current.has(llamada.id)) {
        setEntrante(null);
        return;
      }

      // Ya la atendí en otra pestaña: no vuelve a sonar acá.
      const { data: miFila } = await db
        .from("call_participants")
        .select("joined_at, left_at")
        .eq("call_id", llamada.id)
        .eq("profile_id", miId)
        .maybeSingle();

      if (!miFila || miFila.joined_at !== null || miFila.left_at !== null) {
        setEntrante(null);
        return;
      }

      const { data: perfil } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", llamada.iniciada_por)
        .maybeSingle();

      let grupoNombre: string | null = null;
      if (llamada.group_id) {
        const { data: grupo } = await db
          .from("chat_groups")
          .select("name")
          .eq("id", llamada.group_id)
          .maybeSingle();
        if (grupo) grupoNombre = String(grupo.name);
      }

      setEntrante({
        id: llamada.id,
        kind: llamada.kind,
        groupId: llamada.group_id,
        iniciadaPor: llamada.iniciada_por,
        createdAt: llamada.created_at,
        quienLlama: perfil
          ? { displayName: perfil.display_name, avatarUrl: perfil.avatar_url }
          : null,
        grupoNombre,
      });
    })();
  }, [miId]);

  const suscripciones = useMemo<Suscripcion[]>(
    () => [{ tabla: "call_participants", filtro: `profile_id=eq.${miId}` }],
    [miId],
  );
  const via = useSeñal(suscripciones, buscar);

  // Un timbre no suena para siempre: al vencer la ventana se apaga solo, sin
  // esperar a que alguien cierre la fila del otro lado.
  useEffect(() => {
    if (!entrante) return;
    const vence = Date.parse(entrante.createdAt) + VENTANA_DE_TIMBRE_MS - Date.now();
    const id = window.setTimeout(() => setEntrante(null), Math.max(1000, vence));
    return () => window.clearTimeout(id);
  }, [entrante]);

  const descartar = useCallback((callId: string) => {
    descartadasRef.current.add(callId);
    setEntrante(null);
  }, []);

  return { entrante, descartar, via };
}
