"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { listingViewHref } from "@/lib/monetization/href";
import {
  VENCIMIENTO_COPY,
  isMotivoNoRenovable,
  supabaseSinTiparListings,
  type MotivoNoRenovable,
} from "@/lib/listings";

/**
 * =============================================================================
 * RENOVAR UNA PUBLICACIÓN (0098)
 * =============================================================================
 *
 * NO HAY UPDATE ACÁ, y es lo importante de este archivo. Toda la autorización
 * vive en `public.renovar_publicacion()`, que es `security definer` y verifica
 * adentro de la base: que sea tuya, de tu comunidad, que esté publicada o
 * vencida, que su categoría venza, que no hayas llegado al tope y que
 * efectivamente esté por vencer.
 *
 * Es el mismo criterio que `toggleLostFoundResolved` (0096) y por el mismo
 * motivo: si alguien puentea la app y llama a la función desde PostgREST con su
 * propio token, se topa exactamente con las mismas reglas. Una server action que
 * hiciera el UPDATE por su cuenta tendría que reimplementar seis condiciones, y
 * la implementación de la app y la de la base se separarían el primer día.
 *
 * Lo que sí hace la action: guard de tenant, cuota, traducir el motivo a algo
 * que una persona entienda, y revalidar.
 */

const schema = z.object({
  listingId: z.uuid(),
  /**
   * Sólo para revalidar la pantalla correcta. NO se usa para autorizar ni se le
   * cree: la base resuelve el kind real de la fila. Si llegara uno inventado, lo
   * único que pasa es que se revalida una ruta de más.
   */
  kind: z.string().max(40).optional(),
});

export type RenovarResult =
  | { ok: true; expiresAt: string | null; renewalCount: number; diasDeVigencia: number }
  | { ok: false; error: string; motivo?: MotivoNoRenovable; needsAuth?: boolean };

const C = VENCIMIENTO_COPY.renovar;

export async function renovarPublicacion(rawInput: {
  listingId: string;
  kind?: string;
}): Promise<RenovarResult> {
  // Zod PURO primero (sin I/O): un payload roto no consume guard ni cuota.
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: C.errorGenerico };
  const { listingId, kind } = parsed.data;

  // Guard ANTES de cualquier efecto (regla del repo, lib/tenant/guard): si el
  // tenant del JWT no coincide con el del request, la función de la base va a
  // rechazar igual — no se quema cuota por una escritura muerta.
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.necesitaCuenta };
    }
    return { ok: false, error: guard.message };
  }
  const { supabase, user } = guard;

  // Renovar es barato y legítimo, pero no infinito: sin cuota sería el motor de
  // un bucle de escritura sobre `listings` (y de notificaciones limpiadas) a
  // costo cero para quien lo dispare.
  if (!limit(`renovar-publicacion:${user.id}`, 60, DAY_MS).ok) {
    return { ok: false, error: C.errorGenerico };
  }

  const { data, error } = await supabaseSinTiparListings(supabase).rpc(
    "renovar_publicacion",
    { p_listing: listingId },
  );

  if (error || !data || typeof data !== "object") {
    console.warn("[publicaciones] la renovación falló", {
      listingId,
      code: error?.code,
    });
    return { ok: false, error: C.errorGenerico };
  }

  const respuesta = data as {
    ok?: unknown;
    motivo?: unknown;
    expires_at?: unknown;
    renewal_count?: unknown;
    dias_de_vigencia?: unknown;
  };

  if (respuesta.ok !== true) {
    // El motivo viene de la base y se traduce con el mismo diccionario que usa
    // la pantalla para decidir si dibuja el botón: si los dos dicen lo mismo,
    // nadie aprieta un botón que no iba a funcionar.
    const motivo = isMotivoNoRenovable(respuesta.motivo) ? respuesta.motivo : null;
    return {
      ok: false,
      ...(motivo ? { motivo } : {}),
      error: motivo ? C.motivos[motivo] : C.errorGenerico,
    };
  }

  // La lista propia y el detalle público: el aviso vuelve a estar visible, así
  // que la página del módulo también tiene que dejar de estar cacheada vieja.
  revalidatePath("/publicaciones");
  if (kind) revalidatePath(listingViewHref(kind, listingId));

  return {
    ok: true,
    expiresAt: typeof respuesta.expires_at === "string" ? respuesta.expires_at : null,
    renewalCount:
      typeof respuesta.renewal_count === "number" ? respuesta.renewal_count : 0,
    diasDeVigencia:
      typeof respuesta.dias_de_vigencia === "number" ? respuesta.dias_de_vigencia : 30,
  };
}

/**
 * =============================================================================
 * CONFIRMAR QUE SIGUE DISPONIBLE (0116) — spec §4
 * =============================================================================
 *
 * MISMO REPARTO QUE `renovarPublicacion`, y por el mismo motivo: no hay UPDATE
 * acá. `public.confirmar_disponibilidad()` es `security definer` y verifica
 * adentro de la base que el aviso sea tuyo, de tu comunidad, que sea una
 * propiedad y que esté en un estado con disponibilidad que confirmar. Una action
 * que hiciera el UPDATE por su cuenta tendría que reimplementar las cuatro
 * condiciones, y las dos implementaciones se separarían el primer día.
 */

export type ConfirmarDisponibilidadResult =
  | { ok: true }
  | { ok: false; error: string; needsAuth?: boolean };

const D = VENCIMIENTO_COPY.disponibilidad;

export async function confirmarDisponibilidad(rawInput: {
  listingId: string;
  kind?: string;
}): Promise<ConfirmarDisponibilidadResult> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: D.errorGenerico };
  const { listingId, kind } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: D.necesitaCuenta };
    }
    return { ok: false, error: guard.message };
  }
  const { supabase, user } = guard;

  // Misma cuota que renovar y por lo mismo: es barato y legítimo, pero no
  // infinito — sin techo sería un motor de escritura sobre `listings` gratis.
  if (!limit(`confirmar-disponibilidad:${user.id}`, 60, DAY_MS).ok) {
    return { ok: false, error: D.errorGenerico };
  }

  const { data, error } = await supabaseSinTiparListings(supabase).rpc(
    "confirmar_disponibilidad",
    { p_listing: listingId },
  );

  if (error || !data || typeof data !== "object") {
    console.warn("[publicaciones] la confirmación de disponibilidad falló", {
      listingId,
      code: error?.code,
    });
    return { ok: false, error: D.errorGenerico };
  }

  const respuesta = data as { ok?: unknown; motivo?: unknown };
  if (respuesta.ok !== true) {
    const motivo = typeof respuesta.motivo === "string" ? respuesta.motivo : "";
    const mensaje =
      motivo in D.motivos
        ? D.motivos[motivo as keyof typeof D.motivos]
        : D.errorGenerico;
    return { ok: false, error: mensaje };
  }

  revalidatePath("/publicaciones");
  if (kind) revalidatePath(listingViewHref(kind, listingId));
  return { ok: true };
}

/**
 * =============================================================================
 * MARCAR COMO ALQUILADO (0116) — spec §4
 * =============================================================================
 *
 * ── ACÁ SÍ HAY UPDATE, Y ES LA EXCEPCIÓN QUE CONFIRMA LA REGLA ──────────────
 * Las otras dos acciones de este archivo pasan por una función `definer` porque
 * tienen reglas que verificar (plazos, topes, estados, categorías). Esta no
 * tiene ninguna: la autorización entera es «es tuyo y es de tu comunidad», que
 * es literalmente lo que ya dice la policy `listings_update`. Envolverla en una
 * función de la base sería agregar una capa que no decide nada.
 *
 * Lo que la 0116 SÍ bajó a la base son las dos cosas que no se pueden confiar al
 * cliente: que sólo una propiedad pueda estar `rented` (CHECK) y que la fecha la
 * escriba un trigger y no el dueño. Así que este UPDATE puede mandar un solo
 * campo y no puede mentir sobre nada.
 */

export type MarcarAlquiladoResult =
  | { ok: true }
  | { ok: false; error: string; needsAuth?: boolean };

const A = VENCIMIENTO_COPY.alquilado;

export async function marcarAlquilado(rawInput: {
  listingId: string;
  kind?: string;
}): Promise<MarcarAlquiladoResult> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: A.errorGenerico };
  const { listingId, kind } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: A.necesitaCuenta };
    }
    return { ok: false, error: guard.message };
  }
  const { supabase, user } = guard;

  if (!limit(`marcar-alquilado:${user.id}`, 60, DAY_MS).ok) {
    return { ok: false, error: A.errorGenerico };
  }

  /**
   * `.eq("created_by")` y `.eq("kind")` NO autorizan —eso lo hace la policy— y
   * tampoco están de adorno: acotan el UPDATE a la fila esperada para que un id
   * de otra vertical devuelva "no se pudo" en vez de topar contra el CHECK
   * `listings_rented_solo_propiedades` con un 23514 crudo.
   */
  const { error, count } = await supabaseSinTiparListings(supabase)
    .from("listings")
    .update({ status: "rented" }, { count: "exact" })
    .eq("id", listingId)
    .eq("created_by", user.id)
    .eq("kind", "property")
    .in("status", ["published", "paused", "expired"]);

  if (error) {
    console.warn("[publicaciones] no se pudo marcar como alquilado", {
      listingId,
      code: error.code,
    });
    return { ok: false, error: A.errorGenerico };
  }
  // `count = 0` no es un error de la base: es un aviso que no era de esta
  // persona, no era una propiedad o ya no estaba en un estado que se pueda
  // alquilar. Los tres se le dicen igual — no se le confirma a nadie que un
  // aviso ajeno existe (criterio de 0096).
  if (count === 0) return { ok: false, error: A.errorGenerico };

  revalidatePath("/publicaciones");
  if (kind) revalidatePath(listingViewHref(kind, listingId));
  return { ok: true };
}
