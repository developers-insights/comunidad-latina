"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { listingViewHref } from "@/lib/monetization/href";
import { puedeCerrarPublicacion } from "./puede-cerrar";
import {
  VENCIMIENTO_COPY,
  closedReasonForKind,
  isMotivoNoRenovable,
  supabaseSinTiparListings,
  type ClosedReason,
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
  /**
   * `true` sólo cuando la persona ya contestó "sigue disponible" en el
   * diálogo de `RenovarBoton` (0117). Con `false`/ausente, la RPC se comporta
   * exactamente como antes de la 0117 — el default también es `false` del
   * lado de la base, así que este campo es un refuerzo, no la única guarda.
   */
  confirmaDisponibilidad: z.boolean().optional(),
});

export type RenovarResult =
  | { ok: true; expiresAt: string | null; renewalCount: number; diasDeVigencia: number }
  | {
      ok: false;
      error: string;
      motivo?: MotivoNoRenovable;
      needsAuth?: boolean;
      /** Sólo viene con `motivo === "necesita_confirmar_disponibilidad"`. */
      diasPublicada?: number;
    };

const C = VENCIMIENTO_COPY.renovar;

export async function renovarPublicacion(rawInput: {
  listingId: string;
  kind?: string;
  confirmaDisponibilidad?: boolean;
}): Promise<RenovarResult> {
  // Zod PURO primero (sin I/O): un payload roto no consume guard ni cuota.
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: C.errorGenerico };
  const { listingId, kind, confirmaDisponibilidad } = parsed.data;

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
    { p_listing: listingId, p_confirma_disponibilidad: confirmaDisponibilidad ?? false },
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
    dias_publicada?: unknown;
  };

  if (respuesta.ok !== true) {
    // El motivo viene de la base y se traduce con el mismo diccionario que usa
    // la pantalla para decidir si dibuja el botón: si los dos dicen lo mismo,
    // nadie aprieta un botón que no iba a funcionar.
    const motivo = isMotivoNoRenovable(respuesta.motivo) ? respuesta.motivo : null;
    return {
      ok: false,
      ...(motivo ? { motivo } : {}),
      // `dias_publicada` sólo viene con este motivo puntual (0117); el resto
      // de las respuestas de error no lo trae, así que el chequeo del motivo
      // ANTES de leerlo evita colarlo en un resultado que no lo espera.
      ...(motivo === "necesita_confirmar_disponibilidad" &&
      typeof respuesta.dias_publicada === "number"
        ? { diasPublicada: respuesta.dias_publicada }
        : {}),
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

// =============================================================================
// CERRAR UNA PUBLICACIÓN — "ya se alquiló / cubrió / vendió / terminó" (0117)
// =============================================================================
//
// A diferencia de renovar, ACÁ SÍ hay un UPDATE directo en vez de una RPC: la
// 0117 no le agregó una función a la base para esto — el comentario de la
// migración dice textualmente "la policy listings_update ya lo permite al
// dueño". La autorización real sigue sin vivir en la action: es la RLS
// (`.eq` de tenant/dueño en el WHERE + el WITH CHECK que sólo deja escribir
// `'closed'` al dueño de la fila, nunca `'published'` ni `'expired'`) la que
// de verdad decide. Lo único que hace esta función es resolver el motivo y
// preservar el resto de `attrs` — mismo criterio de "releer antes de confiar"
// que el resto del archivo: el `kind` del payload es sólo para revalidar.
const CERRABLES = ["published", "paused", "expired"] as const;

const cerrarSchema = z.object({
  listingId: z.uuid(),
  kind: z.string().max(40).optional(),
});

export type CerrarPublicacionResult =
  | { ok: true; closedReason: ClosedReason }
  | { ok: false; error: string; needsAuth?: boolean };

const CC = VENCIMIENTO_COPY.cerrar;

export async function cerrarPublicacion(rawInput: {
  listingId: string;
  kind?: string;
}): Promise<CerrarPublicacionResult> {
  const parsed = cerrarSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: CC.error };
  const { listingId, kind } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: CC.necesitaCuenta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`cerrar-publicacion:${user.id}`, 60, DAY_MS).ok) {
    return { ok: false, error: CC.error };
  }

  const sinTipar = supabaseSinTiparListings(supabase);

  // Se relee la fila (kind y attrs reales) en vez de confiar en lo que mandó
  // el cliente. El `.eq` de tenant/dueño no es la autorización (eso lo hace
  // la RLS en el UPDATE de abajo) — es para no confundir "no es tuyo" con "no
  // existe" en el error, mismo criterio que el resto del módulo.
  const { data: row, error: readError } = await sinTipar
    .from("listings")
    .select("id, kind, status, attrs")
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .maybeSingle();

  if (readError || !row) {
    console.warn("[publicaciones] no se encontró la publicación a cerrar", {
      listingId,
      code: readError?.code,
    });
    return { ok: false, error: CC.error };
  }

  // LA MISMA regla que decide si la pantalla ofrece el botón
  // (`puedeCerrarPublicacion`): 'draft'/'pending_review'/'removed' no se
  // cierran (moderación no se resuelve sola) y una pausa por reportes
  // tampoco — el trigger `listings_guard_cierre` (0117) lo rechazaría igual
  // con INVALID_TRANSITION; acá se corta antes para que un payload armado a
  // mano reciba el error SIN pegarle a la base, y para que UI, action y
  // trigger digan exactamente lo mismo.
  const attrsLeidos =
    row.attrs && typeof row.attrs === "object" && !Array.isArray(row.attrs)
      ? (row.attrs as Record<string, unknown>)
      : {};
  const pausadaPorReportes =
    row.status === "paused" && attrsLeidos["paused_reason"] === "reports";
  if (!puedeCerrarPublicacion(row.status as string, pausadaPorReportes)) {
    return { ok: false, error: CC.error };
  }

  const closedReason = closedReasonForKind(row.kind as string);
  const attrsActuales =
    row.attrs && typeof row.attrs === "object" && !Array.isArray(row.attrs)
      ? (row.attrs as Record<string, unknown>)
      : {};

  const { data: updated, error: updateError } = await sinTipar
    .from("listings")
    .update({
      status: "closed",
      attrs: {
        ...attrsActuales,
        closed_reason: closedReason,
        closed_at: new Date().toISOString(),
      },
    })
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    // Repite el filtro de status del SELECT: si algo lo movió entremedio (el
    // trigger de 0118 pausándolo, otra pestaña cerrándolo ya), el UPDATE no
    // encuentra fila en vez de pisar un estado que cambió bajo los pies.
    .in("status", [...CERRABLES])
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    console.warn("[publicaciones] no se pudo cerrar la publicación", {
      listingId,
      code: updateError?.code,
    });
    return { ok: false, error: CC.error };
  }

  revalidatePath("/publicaciones");
  if (kind) revalidatePath(listingViewHref(kind, listingId));

  return { ok: true, closedReason };
}
