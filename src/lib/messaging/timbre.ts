import "server-only";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EVENTO_MENSAJE, type TipoDeAviso } from "./en-vivo";
import { topicoDeDirecto, topicoDeGrupo } from "./escribiendo";

/**
 * EL TIMBRE LO TOCA EL SERVIDOR, DESPUÉS DEL INSERT.
 *
 * Por qué así y no de otra forma:
 *  · No depende de que `messages` / `chat_group_messages` estén publicadas en
 *    `supabase_realtime` (no lo están) ni de la RLS por fila de
 *    `postgres_changes`, que evalúa cada cambio contra cada suscriptor.
 *  · Sale con la sesión de QUIEN ESCRIBIÓ, no con service role: la policy de
 *    insert de la 0148 vuelve a exigir que sea participante (y la conversación
 *    aceptada) o miembro del grupo. Nadie puede tocar un timbre ajeno.
 *  · El payload es sólo `{de, tipo}`. Lo que se pinta lo va a buscar cada
 *    navegador a la base con su sesión (ver `lib/messaging/en-vivo.ts`).
 *
 * Arranca YA, en paralelo con el resto de la action, y `after` sólo mantiene
 * viva la función hasta que termine: esperar al final de la respuesta le
 * sumaba al otro lado la latencia del render del hilo propio.
 */
export function tocarTimbre(
  supabase: unknown,
  destino: { ambito: "directo" | "grupo"; id: string },
  de: string,
  tipo: TipoDeAviso,
): void {
  const topico =
    destino.ambito === "directo" ? topicoDeDirecto(destino.id) : topicoDeGrupo(destino.id);
  const envio = emitir(supabase as SupabaseClient, topico, { de, tipo });
  after(() => envio);
}

async function emitir(
  supabase: SupabaseClient,
  topico: string,
  payload: { de: string; tipo: TipoDeAviso },
): Promise<void> {
  try {
    // Sin el token en el socket, la llamada REST va como `anon` y la policy de
    // la 0148 (`to authenticated`) la rechaza en silencio.
    await supabase.realtime.setAuth();
    const canal = supabase.channel(topico, { config: { private: true } });
    try {
      const resultado = await canal.httpSend(EVENTO_MENSAJE, payload, { timeout: 4_000 });
      if (!resultado.success) {
        console.warn("[mensajes] el timbre no salió", { status: resultado.status });
      }
    } finally {
      await supabase.removeChannel(canal);
    }
  } catch (error) {
    console.warn("[mensajes] el timbre falló", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
  }
}
