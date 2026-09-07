"use server";

import { z } from "zod";
import { getAuthUserId } from "@/lib/supabase/server";
import {
  SOLAPAS_DE_GALERIA,
  armarCursor,
  parsearCursor,
  type ItemDeGaleria,
} from "@/lib/messaging/galeria";
import { armarGaleria } from "./armar";
import { leerGaleriaDelGrupo } from "./queries";

/**
 * "VER MÁS" DE LA GALERÍA DEL GRUPO.
 *
 * ─── POR QUÉ UNA ACTION Y NO UN `<Link>` CON EL CURSOR EN LA URL ────────────
 * Con un enlace, cada tanda REEMPLAZA a la anterior: quien está mirando fotos
 * pierde de vista las que ya bajó y tiene que volver con el back. Una galería
 * se recorre acumulando. La primera tanda igual la sirve el servidor ya
 * pintada —la pantalla nunca aparece vacía esperando la red—, así que esto no
 * es "cargar datos con un efecto": es una tanda más, pedida a mano.
 *
 * ─── QUIÉN DECIDE QUÉ SE PUEDE VER ──────────────────────────────────────────
 * La RLS de `chat_group_messages` (0133/0135), como en el resto del módulo. No
 * se repite acá la comprobación de membresía: a quien no está adentro del
 * grupo, la consulta le devuelve cero filas. Lo único que se exige de este lado
 * es que haya sesión, para cortar antes de viajar.
 */

const schema = z.object({
  groupId: z.uuid(),
  solapa: z.enum(SOLAPAS_DE_GALERIA),
  cursor: z.string().min(1).max(120),
});

export type CargarMasResult =
  | { ok: true; items: ItemDeGaleria[]; siguiente: string | null }
  | { ok: false; code: "unauthenticated" | "invalid" | "error" };

export async function cargarMasDeLaGaleriaAction(input: {
  groupId: string;
  solapa: string;
  cursor: string;
}): Promise<CargarMasResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const cursor = parsearCursor(parsed.data.cursor);
  if (!cursor) return { ok: false, code: "invalid" };

  const userId = await getAuthUserId();
  if (!userId) return { ok: false, code: "unauthenticated" };

  try {
    const { mensajes, siguiente } = await leerGaleriaDelGrupo({
      groupId: parsed.data.groupId,
      solapa: parsed.data.solapa,
      cursor,
    });
    const items = await armarGaleria({ solapa: parsed.data.solapa, mensajes });
    return { ok: true, items, siguiente: siguiente ? armarCursor(siguiente) : null };
  } catch (error) {
    console.warn(
      "[grupos] no se pudo traer más galería:",
      error instanceof Error ? error.message : "error desconocido",
    );
    return { ok: false, code: "error" };
  }
}
