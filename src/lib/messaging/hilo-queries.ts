import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { supabaseSinTiparMensajes, type Adjunto } from "./adjuntos";

/**
 * Las dos lecturas que arrancan el hilo 1-a-1, con `cache()` del request.
 *
 * La página las dispara ANTES de su `Suspense` —necesita la conversación para
 * decidir el `notFound()` con el status correcto— y `HiloDirecto` vuelve a
 * pedirlas adentro: con `cache()` es la misma promesa, no un segundo viaje. Los
 * mensajes salen en paralelo con la conversación porque la RLS ya filtra: a
 * quien no participa le vuelve una lista vacía, no un error.
 */

type ProfileLite = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  identity_verified: boolean;
};

export type ConversacionDelHilo = {
  id: string;
  status: string;
  created_at: string;
  created_by: string;
  counterpart_id: string;
  listing: {
    id: string;
    title: string;
    kind: string;
    photos: string[] | null;
    price_amount: number | null;
    price_currency: string | null;
    price_period: string | null;
  } | null;
  creator: ProfileLite | null;
  counterpart: ProfileLite | null;
};

/**
 * Las columnas de la 0136 son OPCIONALES en el tipo a propósito: mientras esa
 * migración no esté aplicada en un entorno, no vienen y el hilo se lee como
 * texto.
 */
export type MensajeDelHilo = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  kind?: string | null;
  reply_to?: string | null;
  editado_at?: string | null;
  deleted_at?: string | null;
  compartido_kind?: string | null;
  compartido_id?: string | null;
  adjunto?: Adjunto | null;
  ubicacion?: { lat: number; lng: number; etiqueta?: string } | null;
};

export const LIMITE_MENSAJES_DEL_HILO = 200;

export const leerConversacion = cache(
  async (id: string): Promise<ConversacionDelHilo | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("conversations")
      .select(
        `id, status, created_at, created_by, counterpart_id,
         listing:listings(id, title, kind, photos, price_amount, price_currency, price_period),
         creator:profiles!conversations_created_by_fkey(id, display_name, avatar_url, identity_verified),
         counterpart:profiles!conversations_counterpart_id_fkey(id, display_name, avatar_url, identity_verified)`,
      )
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.warn("[mensajes] no se pudo leer la conversación", { code: error.code });
      return null;
    }
    return data as unknown as ConversacionDelHilo | null;
  },
);

/**
 * Los últimos mensajes, en orden de lectura.
 *
 * Se piden los MÁS NUEVOS (`descending`) y se dan vuelta en memoria: con
 * `ascending` el LIMIT devolvía los doscientos PRIMEROS y, pasado ese número,
 * los mensajes nuevos de una charla larga no aparecían nunca. Mismo arreglo
 * que `listarMensajesDelGrupo`.
 */
export const leerMensajesDelHilo = cache(async (id: string): Promise<MensajeDelHilo[]> => {
  const supabase = await createClient();
  const { data, error } = await supabaseSinTiparMensajes(supabase)
    .from("messages")
    .select(
      "id, sender_id, body, created_at, kind, reply_to, editado_at, deleted_at, compartido_kind, compartido_id, adjunto, ubicacion",
    )
    .eq("conversation_id", id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LIMITE_MENSAJES_DEL_HILO);
  if (error) {
    console.warn("[mensajes] no se pudieron leer los mensajes del hilo", { code: error.code });
    return [];
  }
  return ((data ?? []) as MensajeDelHilo[]).slice().reverse();
});
