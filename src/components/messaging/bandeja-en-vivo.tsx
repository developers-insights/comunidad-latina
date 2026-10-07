"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { supabaseSinTiparGrupos } from "@/lib/messaging/grupos";
import { useAvisosEnVivo } from "@/lib/notifications/en-vivo";
import type { FilaDeBandeja, FiltroDePersonas, MensajeDeBandeja } from "@/lib/messaging/bandeja";
import type { EstadoDePresencia } from "@/lib/messaging/presencia";
import {
  aplicarMensajesALaBandeja,
  hiloDeTopico,
  marcarFilaLeida,
  masReciente,
  sumarNoLeidos,
} from "@/lib/messaging/en-vivo";
import { useSenalesDelHilo } from "./escribiendo-live";
import { InboxFiltros } from "./inbox-filtros";
import { InboxRow } from "./inbox-row";

/**
 * LA BANDEJA SE ACTUALIZA SOLA, FILA POR FILA.
 *
 * El servidor la pinta completa una vez. Después:
 *  · El timbre de una conversación (los `MAX_HILOS_ESCUCHADOS` de arriba, los
 *    mismos canales del "está escribiendo…") trae SOLO sus mensajes nuevos con
 *    la sesión de quien mira, y la fila se parchea en memoria: resumen, hora,
 *    globito y lugar en la lista. Nada de volver a pedir la bandeja entera.
 *  · Lo que no tiene canal —una conversación nueva, una fila de más abajo—
 *    llega por la notificación (`notifications`, publicada en la 0176) o al
 *    volver a la pestaña, y ahí sí se refresca la lista: es la única forma de
 *    saber que existe una fila que no estaba.
 */

const PAUSA_REFRESCO_MS = 600;
const KINDS_DE_BANDEJA = new Set(["message", "contact_request"]);

type Estado = {
  base: FilaDeBandeja[];
  filas: FilaDeBandeja[];
  ahora: Date;
};

export function BandejaEnVivo({
  filasIniciales,
  presencias,
  miId,
  ahoraIso,
  filtro,
  totalNoLeidos,
  ocultarNoLeidos,
  precargadas,
}: {
  filasIniciales: FilaDeBandeja[];
  presencias: Readonly<Record<string, EstadoDePresencia>>;
  miId: string;
  ahoraIso: string;
  filtro: FiltroDePersonas;
  totalNoLeidos: number;
  ocultarNoLeidos: boolean;
  /** Cuántas filas de arriba con mensajes sin leer se precargan sin esperar intención. */
  precargadas: number;
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>(() => ({
    base: filasIniciales,
    filas: filasIniciales,
    ahora: new Date(ahoraIso),
  }));

  // Un refresco del servidor trae una bandeja nueva: manda ella, no el parche.
  let actual = estado;
  if (estado.base !== filasIniciales) {
    actual = { base: filasIniciales, filas: filasIniciales, ahora: new Date(ahoraIso) };
    setEstado(actual);
  }

  const filasRef = useRef(actual.filas);
  useEffect(() => {
    filasRef.current = actual.filas;
  }, [actual.filas]);

  const aplicados = useRef(new Set<string>());
  const yaConectados = useRef(new Set<string>());
  const reloj = useRef<number | null>(null);

  const refrescar = useCallback(() => {
    if (reloj.current !== null) window.clearTimeout(reloj.current);
    reloj.current = window.setTimeout(() => {
      reloj.current = null;
      router.refresh();
    }, PAUSA_REFRESCO_MS);
  }, [router]);

  useEffect(
    () => () => {
      if (reloj.current !== null) window.clearTimeout(reloj.current);
    },
    [],
  );

  const traerUnaVez = useCallback(
    async (conversacionId: string) => {
      const fila = filasRef.current.find((f) => f.conversacionIds.includes(conversacionId));
      if (!fila) {
        refrescar();
        return;
      }
      const desde = masReciente(fila.ultimaActividad, fila.ultimoMensaje?.created_at ?? null);

      let consulta = supabaseSinTiparGrupos(createClient())
        .from("messages")
        .select("id, conversation_id, sender_id, body, created_at, kind, adjunto")
        .eq("conversation_id", conversacionId);
      if (desde) consulta = consulta.gt("created_at", desde);
      const { data, error } = await consulta
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        console.warn("[mensajes] la bandeja no pudo traer el mensaje nuevo", {
          code: error.code,
        });
        refrescar();
        return;
      }

      const nuevos = ((data ?? []) as (MensajeDeBandeja & { id: string })[]).filter(
        (mensaje) => !aplicados.current.has(mensaje.id),
      );
      if (nuevos.length === 0) return;
      for (const mensaje of nuevos) aplicados.current.add(mensaje.id);

      setEstado((previo) => ({
        ...previo,
        filas: aplicarMensajesALaBandeja(previo.filas, nuevos, miId),
        ahora: new Date(),
      }));
    },
    [miId, refrescar],
  );

  const enCurso = useRef(new Set<string>());
  const otraVez = useRef(new Set<string>());

  /**
   * Una consulta por conversación a la vez: los timbres que llegan mientras
   * tanto se juntan en UNA vuelta más. Quien participa de la charla puede tocar
   * el timbre las veces que quiera; no puede multiplicar las consultas.
   */
  const traer = useCallback(
    async (conversacionId: string) => {
      if (enCurso.current.has(conversacionId)) {
        otraVez.current.add(conversacionId);
        return;
      }
      enCurso.current.add(conversacionId);
      try {
        do {
          otraVez.current.delete(conversacionId);
          await traerUnaVez(conversacionId);
        } while (otraVez.current.has(conversacionId));
      } finally {
        enCurso.current.delete(conversacionId);
      }
    },
    [traerUnaVez],
  );

  useSenalesDelHilo((topico, senal) => {
    const hilo = hiloDeTopico(topico);
    if (!hilo || hilo.ambito !== "directo") return;
    if (senal.tipo === "conectado") {
      // La primera conexión es la de montar: la bandeja recién llegó del
      // servidor. Una RE-conexión sí pudo perderse mensajes.
      if (yaConectados.current.has(topico)) refrescar();
      else yaConectados.current.add(topico);
      return;
    }
    if (senal.tipo === "cambio") {
      refrescar();
      return;
    }
    void traer(hilo.id);
  });

  useAvisosEnVivo(
    miId,
    (aviso) => {
      if (aviso.tipo === "volvio") refrescar();
      else if (aviso.tipo === "nuevo" && aviso.kind && KINDS_DE_BANDEJA.has(aviso.kind)) {
        refrescar();
      }
    },
    "bandeja",
  );

  const abrir = useCallback((personaId: string) => {
    setEstado((previo) => ({ ...previo, filas: marcarFilaLeida(previo.filas, personaId) }));
  }, []);

  const delta = sumarNoLeidos(actual.filas) - sumarNoLeidos(actual.base);
  const precargar = new Set(
    actual.filas
      .filter((fila) => fila.noLeidos > 0)
      .slice(0, precargadas)
      .map((fila) => fila.personaId),
  );

  return (
    <>
      <InboxFiltros
        activo={filtro}
        noLeidos={Math.max(0, totalNoLeidos + delta)}
        ocultarNoLeidos={ocultarNoLeidos}
      />
      <ul className="flex flex-col gap-3">
        {actual.filas.map((fila) => (
          <InboxRow
            key={fila.personaId}
            fila={fila}
            miId={miId}
            ahora={actual.ahora}
            presencia={presencias[fila.personaId]}
            precargar={precargar.has(fila.personaId)}
            onAbrir={() => abrir(fila.personaId)}
          />
        ))}
      </ul>
    </>
  );
}
