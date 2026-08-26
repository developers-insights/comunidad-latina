"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { getCaraActiva } from "./cara";
import { PERFIL_ACTIVO_COPY } from "./copy";
import { listarIdentidadesDeNegocio } from "./identidad";

/**
 * =============================================================================
 * CAMBIAR DE PERFIL — la única puerta para elegir con qué identidad se actúa
 * =============================================================================
 *
 * ── DÓNDE VIVE LA AUTORIZACIÓN ──────────────────────────────────────────────
 * En la base, no acá. El WITH CHECK de `active_identities` (0103) exige
 * `app.business_role(business_id, auth.uid()) is not null`: la escritura de una
 * identidad ajena la rechaza Postgres, no este archivo. Lo que hace esta action
 * es cortar ANTES para poder devolver una frase en español en vez de un código
 * de error de PostgREST — y para no dejar pasar el caso de un negocio de otra
 * comunidad, que la policy también rechaza pero con un mensaje ilegible.
 *
 * O sea: si alguien puentea la app y escribe contra PostgREST, se topa con
 * exactamente la misma regla. Este chequeo es redundante A PROPÓSITO.
 *
 * ── VOLVER A TU PERFIL ES BORRAR LA FILA ────────────────────────────────────
 * No hay un `business_id = null`: la ausencia de fila ES la identidad personal
 * (ver el comentario de la tabla en la 0103). Así nadie puede quedar en un
 * tercer estado indefinido.
 *
 * ── POR QUÉ SE REVALIDA TODO ────────────────────────────────────────────────
 * `revalidatePath("/", "layout")` y no una ruta puntual: la identidad activa se
 * pinta en el header, que es layout de la app entera. Revalidar solo la pantalla
 * donde se tocó el botón dejaría el avatar de arriba mostrando la identidad
 * vieja — el peor bug posible en esta feature, porque el header es justamente
 * la promesa de "acá dice con qué perfil estás".
 */

const cambiarSchema = z.object({
  /** null = volver al perfil personal. */
  businessId: z.uuid().nullable(),
});

export type CambiarIdentidadResult =
  | { ok: true; nombre: string; tipo: "personal" | "negocio" }
  | { ok: false; mensaje: string };

/** Ver el aviso de ESCAPE DE TIPOS en identidad.ts. */
function clienteSinTipar(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

export async function cambiarIdentidad(
  input: unknown,
): Promise<CambiarIdentidadResult> {
  const parsed = cambiarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, mensaje: PERFIL_ACTIVO_COPY.sheet.error };
  }

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return { ok: false, mensaje: guard.message };
  }
  const { supabase, user, tenant } = guard;
  const { businessId } = parsed.data;

  // Volver a ser vos: borrar la fila. Idempotente — sin fila también es "vos".
  if (businessId === null) {
    const { error } = await clienteSinTipar(supabase)
      .from("active_identities")
      .delete()
      .eq("profile_id", user.id);
    if (error) {
      console.error("[perfil-activo] no se pudo volver al perfil personal", {
        code: error.code,
      });
      return { ok: false, mensaje: PERFIL_ACTIVO_COPY.sheet.error };
    }
    revalidatePath("/", "layout");
    return { ok: true, tipo: "personal", nombre: "" };
  }

  // Redundante a propósito: la policy ya lo impide (ver el encabezado).
  const disponibles = await listarIdentidadesDeNegocio();
  const negocio = disponibles.find((item) => item.businessId === businessId);
  if (!negocio) {
    // Sin PII: no se registra qué negocio se intentó usar ni desde qué cuenta.
    console.warn("[perfil-activo] intento de usar una identidad no disponible", {
      tenant: tenant.slug,
    });
    return { ok: false, mensaje: PERFIL_ACTIVO_COPY.sheet.error };
  }

  const { error } = await clienteSinTipar(supabase)
    .from("active_identities")
    .upsert(
      { profile_id: user.id, tenant_id: tenant.id, business_id: businessId },
      { onConflict: "profile_id" },
    );

  if (error) {
    console.error("[perfil-activo] no se pudo cambiar de identidad", {
      code: error.code,
    });
    return { ok: false, mensaje: PERFIL_ACTIVO_COPY.sheet.error };
  }

  revalidatePath("/", "layout");
  return { ok: true, tipo: "negocio", nombre: negocio.nombre };
}

/**
 * =============================================================================
 * LA FIRMA ACTIVA — para el comentario optimista de la hoja del feed
 * =============================================================================
 *
 * La hoja de comentarios pinta el comentario ANTES de que el servidor conteste
 * (es la razón de existir de esa hoja: «después de comentar no debería salirme
 * del feed»). Para pintarlo tiene que saber con qué nombre y qué foto va a
 * salir, y eso lo decide el servidor.
 *
 * Podría resolverlo sola —`active_identities` la puede leer su dueño y la RPC
 * es ejecutable por `authenticated`—, pero serían dos consultas y, sobre todo,
 * una SEGUNDA implementación de "con qué identidad estoy actuando" viviendo en
 * el navegador. El día que las dos difieran, el comentario se vería con un
 * nombre y se guardaría con otro. Un viaje, una sola verdad.
 *
 * Devuelve `null` cuando se está actuando como uno mismo (el caso normal) o
 * cuando el negocio activo todavía no tiene ficha con la que firmar.
 */
export interface FirmaActiva {
  /** `listings.id` — lo que va a `entity_listing_id`. */
  listingId: string;
  nombre: string;
  avatarUrl: string | null;
}

export async function leerFirmaActiva(): Promise<FirmaActiva | null> {
  try {
    const cara = await getCaraActiva();
    if (!cara.negocio || !cara.firmaListingId) return null;
    return {
      listingId: cara.firmaListingId,
      nombre: cara.negocio.nombre,
      avatarUrl: cara.negocio.avatarUrl,
    };
  } catch {
    // Sos vos: el default seguro de toda esta carpeta.
    return null;
  }
}
