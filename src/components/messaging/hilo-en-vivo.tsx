"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { supabaseSinTiparGrupos } from "@/lib/messaging/grupos";
import { masReciente, type MensajeEntrante } from "@/lib/messaging/en-vivo";
import {
  marcarConversacionLeidaAction,
  marcarGrupoLeidoAction,
} from "@/app/(app)/mensajes/lecturas";
import { useSenalesDelHilo } from "./escribiendo-live";
import { useRecibirEntrantes } from "./en-vuelo";

/**
 * EL HILO SE ENTERA SOLO — reemplaza al sondeo de 15 s (`ThreadRefresh` /
 * `GroupLive`), que re-renderizaba la conversación entera por pestaña abierta
 * aunque nadie escribiera.
 *
 * Cuando suena el timbre (`lib/messaging/timbre.ts`):
 *  1. se piden a la base SOLO los mensajes posteriores al último que se ve, con
 *     la sesión de quien mira — la RLS decide, el timbre no trae contenido;
 *  2. se pintan ya como burbujas provisorias (`MensajesEnVuelo`);
 *  3. un único `router.refresh()` agrupado trae después la burbuja completa
 *     (menú, reacciones, foto firmada) y retira la provisoria por id.
 *
 * Al (re)conectar el canal y al volver a la pestaña se hace el paso 1 igual:
 * lo que se escribió con el socket caído no tuvo timbre.
 */

const PAUSA_REFRESCO_MS = 1_200;
/**
 * Marcar leído es una server action: comparten cola con el envío y un techo de
 * 600 por hora. En un grupo activo, una por tanda lo agotaba en silencio.
 */
const INTERVALO_LECTURA_MS = 5_000;
const TOPE_POR_TANDA = 50;
const AUTOR_GENERICO = "Miembro de la comunidad";

type FilaNueva = {
  id: string;
  sender_id: string;
  body: string | null;
  created_at: string;
  kind: string | null;
  adjunto: unknown;
};

export function HiloEnVivo({
  ambito,
  hiloId,
  miId,
  ultimoCreadoEn,
  nombres,
  marcarLeido,
}: {
  ambito: "directo" | "grupo";
  hiloId: string;
  miId: string;
  /** El `created_at` del último mensaje que pintó el servidor. */
  ultimoCreadoEn: string | null;
  /** `id → nombre` de los autores ya conocidos (grupo). */
  nombres?: Readonly<Record<string, string>>;
  /** En la llamada el panel puede estar cerrado: ahí no se da nada por leído. */
  marcarLeido: boolean;
}) {
  const router = useRouter();
  const recibir = useRecibirEntrantes();
  const cursor = useRef<string | null>(ultimoCreadoEn);
  const enCurso = useRef(false);
  const otraVez = useRef(false);
  const reloj = useRef<number | null>(null);
  const ultimaLectura = useRef(0);
  const lecturaPendiente = useRef<number | null>(null);
  const nombresRef = useRef(nombres);

  useEffect(() => {
    cursor.current = masReciente(cursor.current, ultimoCreadoEn);
  }, [ultimoCreadoEn]);
  useEffect(() => {
    nombresRef.current = nombres;
  }, [nombres]);

  const marcarAhora = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    ultimaLectura.current = Date.now();
    const accion =
      ambito === "directo"
        ? marcarConversacionLeidaAction({ conversationId: hiloId })
        : marcarGrupoLeidoAction({ groupId: hiloId });
    void accion.then((resultado) => {
      if (!resultado.ok && resultado.code !== "rate-limited") {
        console.warn("[mensajes] no se pudo marcar como leído", { code: resultado.code });
      }
    });
  }, [ambito, hiloId]);

  /** Como mucho una cada `INTERVALO_LECTURA_MS`, y una última al cerrar la ráfaga. */
  const leer = useCallback(() => {
    if (!marcarLeido || lecturaPendiente.current !== null) return;
    const espera = INTERVALO_LECTURA_MS - (Date.now() - ultimaLectura.current);
    if (espera <= 0) {
      marcarAhora();
      return;
    }
    lecturaPendiente.current = window.setTimeout(() => {
      lecturaPendiente.current = null;
      marcarAhora();
    }, espera);
  }, [marcarLeido, marcarAhora]);

  const programarRefresco = useCallback(() => {
    if (reloj.current !== null) window.clearTimeout(reloj.current);
    reloj.current = window.setTimeout(() => {
      reloj.current = null;
      router.refresh();
    }, PAUSA_REFRESCO_MS);
  }, [router]);

  const traer = useCallback(async () => {
    if (enCurso.current) {
      otraVez.current = true;
      return;
    }
    enCurso.current = true;
    try {
      do {
        otraVez.current = false;
        const supabase = supabaseSinTiparGrupos(createClient());
        let consulta =
          ambito === "directo"
            ? supabase
                .from("messages")
                .select("id, sender_id, body, created_at, kind, adjunto")
                .eq("conversation_id", hiloId)
            : supabase
                .from("chat_group_messages")
                .select("id, sender_id, body, created_at, kind, adjunto")
                .eq("group_id", hiloId)
                .is("deleted_at", null);
        if (cursor.current) consulta = consulta.gt("created_at", cursor.current);
        const { data, error } = await consulta
          .order("created_at", { ascending: false })
          .limit(TOPE_POR_TANDA);

        if (error) {
          console.warn("[mensajes] no se pudieron traer los mensajes nuevos", {
            code: error.code,
          });
          programarRefresco();
          return;
        }

        const filas = ((data ?? []) as FilaNueva[]).slice().reverse();
        if (filas.length === 0) continue;

        cursor.current = masReciente(cursor.current, filas[filas.length - 1].created_at);
        recibir?.(
          filas.map(
            (fila): MensajeEntrante => ({
              id: fila.id,
              body: fila.body ?? "",
              created_at: fila.created_at,
              kind: fila.kind,
              adjunto: fila.adjunto,
              propio: fila.sender_id === miId,
              autorNombre: nombresRef.current?.[fila.sender_id] ?? AUTOR_GENERICO,
            }),
          ),
        );
        if (filas.some((fila) => fila.sender_id !== miId)) leer();
        programarRefresco();
      } while (otraVez.current);
    } finally {
      enCurso.current = false;
    }
  }, [ambito, hiloId, miId, recibir, leer, programarRefresco]);

  useSenalesDelHilo((_topico, senal) => {
    if (senal.tipo === "cambio") {
      programarRefresco();
      return;
    }
    void traer();
    /**
     * Al conectar, además, un refresco agrupado: el hilo pudo venir del cache
     * del router (prefetch de la bandeja, hasta 300 s) y las ediciones,
     * borrados y reacciones de ese lapso no tienen otra forma de llegar. Se
     * pinta primero lo cacheado y después se reconcilia.
     */
    if (senal.tipo === "conectado") programarRefresco();
  });

  useEffect(() => {
    leer();
  }, [leer]);

  useEffect(() => {
    function alVolver() {
      if (document.visibilityState !== "visible") return;
      void traer();
      leer();
    }
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      if (reloj.current !== null) window.clearTimeout(reloj.current);
      if (lecturaPendiente.current !== null) {
        window.clearTimeout(lecturaPendiente.current);
        lecturaPendiente.current = null;
      }
    };
  }, [traer, leer]);

  return null;
}
