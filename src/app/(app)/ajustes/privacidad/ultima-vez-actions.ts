"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantMatch } from "@/lib/tenant/guard";

/**
 * Server action de "Mostrar cuándo estuviste en línea" (Ajustes › Privacidad).
 *
 * Mismas reglas que `tag-policy-actions.ts`: Zod primero, `requireTenantMatch()`
 * después y antes de cualquier efecto, y escritura con el cliente del USUARIO
 * —nunca admin— para que la RLS de `profiles` siga siendo la frontera real.
 *
 * `update` y no `upsert`: a diferencia de `profiles_private`, la fila de
 * `profiles` existe siempre (la crea el registro). Un `upsert` acá necesitaría
 * inventar el resto de las columnas obligatorias del perfil.
 */

type OpenClient = SupabaseClient;

const schema = z.boolean();

export type SaveMostrarUltimaVezResult =
  | { ok: true }
  | { ok: false; code: "invalid" | "unauthenticated" | "error" }
  | { ok: false; code: "tenant-mismatch"; message: string };

export async function saveMostrarUltimaVezAction(
  mostrar: boolean,
): Promise<SaveMostrarUltimaVezResult> {
  const parsed = schema.safeParse(mostrar);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error" };
  }
  const { supabase, user } = guard;

  const { error } = await (supabase as OpenClient)
    .from("profiles")
    .update({ mostrar_ultima_vez: parsed.data })
    .eq("id", user.id);

  if (error) {
    console.warn("[privacidad] guardado de mostrar_ultima_vez falló", { code: error.code });
    return { ok: false, code: "error" };
  }

  /**
   * También la bandeja: es la pantalla donde el cambio se ve, y sin esto quien
   * apaga el interruptor y vuelve a /mensajes se sigue encontrando la presencia
   * del resto pintada con la foto vieja del caché.
   */
  revalidatePath("/ajustes/privacidad");
  revalidatePath("/mensajes");
  return { ok: true };
}
