"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { getCaraActiva } from "@/lib/perfil-activo/cara";
import { puedeFirmarComo } from "@/lib/feed/autoria";
import {
  MAX_CARACTERES_RESENA,
  PUNTAJE_MAX,
  PUNTAJE_MIN,
  RESENAS_COPY as C,
  supabaseSinTipar,
} from "@/lib/resenas";
import type { ResenaState } from "./estado";

/**
 * =============================================================================
 * SERVER ACTIONS DE RESEÑAS (migración 0093)
 * =============================================================================
 *
 * ── DÓNDE VIVE CADA DEFENSA ─────────────────────────────────────────────────
 * Nada de lo que decide quién puede escribir qué vive acá. Está todo en la base:
 *
 *   · una reseña por persona por aviso  → índice único `listing_reviews_one_per_author`
 *   · no reseñás tu propio negocio      → `app.can_review_listing()` en la policy de INSERT
 *   · el negocio responde pero no corrige, el autor corrige pero no responde
 *                                       → trigger `app.listing_reviews_guard_columns()`
 *   · el promedio no lo escribe nadie   → trigger `app.refresh_listing_review_stats()`
 *
 * Este archivo hace tres cosas y ninguna es "autorizar": valida la forma con zod
 * para que el error se lea en español, corta el spam con un rate limit, y
 * TRADUCE los errores de Postgres a frases que una persona pueda entender. Si
 * alguien puentea la app y escribe contra PostgREST, se topa con exactamente las
 * mismas reglas.
 *
 * ── EL ORDEN NO ES CASUAL ───────────────────────────────────────────────────
 * `requireTenantMatch()` va PRIMERO, antes del rate limit: consumir el cupo de
 * alguien cuya escritura la RLS va a rechazar igual es cobrarle por nada.
 *
 * ── TENANT ──────────────────────────────────────────────────────────────────
 * `tenant_id` sale del guard (JWT + host), NUNCA de un campo del formulario.
 */



/** Cupos diarios por usuario. Generosos para el uso real, letales para el spam. */
const MAX_RESENAS_POR_DIA = 10;
const MAX_RESPUESTAS_POR_DIA = 40;
const MAX_REPORTES_POR_DIA = 10;

const textoOpcional = z
  .string()
  .transform((valor) => valor.trim())
  .pipe(z.string().max(MAX_CARACTERES_RESENA))
  .transform((valor) => (valor.length > 0 ? valor : null));

const publicarSchema = z.object({
  listingId: z.uuid(),
  rating: z.coerce.number().int().min(PUNTAJE_MIN).max(PUNTAJE_MAX),
  body: textoOpcional.nullable().optional(),
});

const responderSchema = z.object({
  reviewId: z.uuid(),
  listingId: z.uuid(),
  reply: textoOpcional.nullable().optional(),
});

const borrarSchema = z.object({
  reviewId: z.uuid(),
  listingId: z.uuid(),
});

const reportarSchema = z.object({
  reviewId: z.uuid(),
  listingId: z.uuid(),
  reason: z
    .string()
    .transform((valor) => valor.trim())
    .pipe(z.string().min(1).max(1000)),
});

/**
 * Una reseña puede colgar de un negocio o de un profesional y las dos fichas la
 * muestran. Revalidar las dos rutas es más barato —y mucho menos frágil— que
 * consultar el `kind` del aviso sólo para elegir una: la ruta que no existe se
 * ignora sola.
 */
function revalidarFichas(listingId: string): void {
  revalidatePath(`/negocios/${listingId}`);
  revalidatePath(`/profesionales/${listingId}`);
}

/** Traduce el error de Postgres a algo que una persona pueda leer y actuar. */
function mensajeDeError(
  error: { code?: string; message?: string },
  contexto: "publicar" | "responder" | "borrar",
): string {
  const codigo = error.code ?? "";
  const texto = error.message ?? "";

  if (codigo === "23505") return C.errores.duplicada;
  if (texto.includes("PUNTAJE_AJENO") || texto.includes("RESENA_AJENA")) {
    return C.errores.sinPermisoRespuesta;
  }
  if (texto.includes("RESPUESTA_AJENA")) return C.errores.sinPermisoRespuesta;
  if (texto.includes("ESTADO_MODERADO") || texto.includes("RESENA_INMUTABLE")) {
    return C.errores.generico;
  }
  // 42501 = row-level security. En "publicar" el motivo casi siempre es el que
  // `app.can_review_listing()` bloquea: es tu propio negocio.
  if (codigo === "42501" || codigo === "PGRST301") {
    return contexto === "publicar" ? C.errores.propioNegocio : C.errores.sinPermisoRespuesta;
  }
  return C.errores.generico;
}

/* ========================================================================== */
/* Publicar o editar MI reseña                                                */
/* ========================================================================== */

export async function publicarResenaAction(
  _prevState: ResenaState,
  formData: FormData,
): Promise<ResenaState> {
  const parsed = publicarSchema.safeParse({
    listingId: formData.get("listingId"),
    rating: formData.get("rating"),
    body: formData.get("body") ?? undefined,
  });

  if (!parsed.success) {
    const campos = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
    if (campos.has("rating")) return { status: "invalid", message: C.errores.sinPuntaje };
    if (campos.has("body")) return { status: "invalid", message: C.errores.textoLargo };
    return { status: "invalid", message: C.errores.noEncontrado };
  }

  const { listingId, rating, body } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      status: "error",
      message: guard.reason === "unauthenticated" ? C.errores.sinCuenta : guard.message,
    };
  }

  if (!limit(`resena:${guard.user.id}`, MAX_RESENAS_POR_DIA, DAY_MS).ok) {
    return { status: "error", message: C.errores.demasiadas };
  }

  const supabase = supabaseSinTipar(guard.supabase);

  // ¿Ya reseñé este aviso? La RLS sólo me deja ver la mía, así que no hace falta
  // filtrar por autor: si vuelve una fila, es mía.
  const { data: mia, error: errorLectura } = await supabase
    .from("listing_reviews")
    .select("id")
    .eq("listing_id", listingId)
    .eq("author_id", guard.user.id)
    .maybeSingle();

  if (errorLectura) {
    console.error("[resenas] no se pudo leer la reseña propia:", errorLectura.message);
    return { status: "error", message: C.errores.generico };
  }

  if (mia?.id) {
    const { error } = await supabase
      .from("listing_reviews")
      .update({ rating, body })
      .eq("id", mia.id);

    if (error) {
      console.error("[resenas] falló la edición:", error.code, error.message);
      return { status: "error", message: mensajeDeError(error, "publicar") };
    }

    revalidarFichas(listingId);
    return { status: "success", message: C.actualizada };
  }

  /**
   * La reseña también sale a nombre de la cara activa (0117). La unicidad NO
   * cambió —una reseña por persona y por negocio, se firme como se firme—: poder
   * calificar dos veces el mismo local, una como vos y otra como tu comercio,
   * sería el fraude de estrellas que las reseñas existen para evitar.
   *
   * La firma se revalida contra la base aunque la identidad activa ya haya
   * pasado su propio control: son dos hechos distintos —"podés actuar como este
   * negocio" y "esta ficha es tuya y está publicada"— y el que exige la policy
   * es el segundo.
   */
  const cara = await getCaraActiva();
  const entityListingId =
    cara.firmaListingId &&
    (await puedeFirmarComo(supabase, {
      tenantId: guard.tenant.id,
      userId: guard.user.id,
      listingId: cara.firmaListingId,
    }))
      ? cara.firmaListingId
      : null;

  const { error } = await supabase.from("listing_reviews").insert({
    tenant_id: guard.tenant.id,
    listing_id: listingId,
    author_id: guard.user.id,
    entity_listing_id: entityListingId,
    rating,
    body,
  });

  if (error) {
    console.error("[resenas] falló el alta:", error.code, error.message);
    return { status: "error", message: mensajeDeError(error, "publicar") };
  }

  revalidarFichas(listingId);
  return { status: "success", message: C.publicada };
}

/* ========================================================================== */
/* Borrar MI reseña                                                           */
/* ========================================================================== */

export async function borrarResenaAction(
  _prevState: ResenaState,
  formData: FormData,
): Promise<ResenaState> {
  const parsed = borrarSchema.safeParse({
    reviewId: formData.get("reviewId"),
    listingId: formData.get("listingId"),
  });
  if (!parsed.success) return { status: "invalid", message: C.errores.generico };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      status: "error",
      message: guard.reason === "unauthenticated" ? C.errores.sinCuenta : guard.message,
    };
  }

  // La policy de DELETE ya exige `author_id = auth.uid()`. El `.eq()` de autor
  // está igual: hace que un id ajeno borre CERO filas en vez de apoyarse sólo en
  // que la policy no falle.
  const { error } = await supabaseSinTipar(guard.supabase)
    .from("listing_reviews")
    .delete()
    .eq("id", parsed.data.reviewId)
    .eq("author_id", guard.user.id);

  if (error) {
    console.error("[resenas] falló el borrado:", error.code, error.message);
    return { status: "error", message: mensajeDeError(error, "borrar") };
  }

  revalidarFichas(parsed.data.listingId);
  return { status: "success", message: C.borrada };
}

/* ========================================================================== */
/* Responder una reseña (dueño o equipo del negocio)                          */
/* ========================================================================== */

export async function responderResenaAction(
  _prevState: ResenaState,
  formData: FormData,
): Promise<ResenaState> {
  const parsed = responderSchema.safeParse({
    reviewId: formData.get("reviewId"),
    listingId: formData.get("listingId"),
    reply: formData.get("reply") ?? undefined,
  });

  if (!parsed.success) {
    const campos = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
    if (campos.has("reply")) return { status: "invalid", message: C.errores.textoLargo };
    return { status: "invalid", message: C.errores.generico };
  }

  const { reviewId, listingId, reply } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      status: "error",
      message: guard.reason === "unauthenticated" ? C.errores.sinCuenta : guard.message,
    };
  }

  if (!limit(`resena-respuesta:${guard.user.id}`, MAX_RESPUESTAS_POR_DIA, DAY_MS).ok) {
    return { status: "error", message: C.errores.demasiadas };
  }

  // `owner_reply_by` y `owner_reply_at` NO se mandan: los deriva del JWT el
  // trigger de guarda. La autoría de una respuesta pública no se acepta por
  // parámetro, ni siquiera desde nuestro propio código.
  const { error } = await supabaseSinTipar(guard.supabase)
    .from("listing_reviews")
    .update({ owner_reply: reply ?? null })
    .eq("id", reviewId);

  if (error) {
    console.error("[resenas] falló la respuesta:", error.code, error.message);
    return { status: "error", message: mensajeDeError(error, "responder") };
  }

  revalidarFichas(listingId);
  return { status: "success", message: C.respuestaPublicada };
}

/* ========================================================================== */
/* Reportar una reseña — va a scam_reports, no a una cola nueva               */
/* ========================================================================== */

export async function reportarResenaAction(
  _prevState: ResenaState,
  formData: FormData,
): Promise<ResenaState> {
  const parsed = reportarSchema.safeParse({
    reviewId: formData.get("reviewId"),
    listingId: formData.get("listingId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { status: "invalid", message: C.errores.motivoRequerido };
  }

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      status: "error",
      message: guard.reason === "unauthenticated" ? C.errores.sinCuenta : guard.message,
    };
  }

  if (!limit(`resena-reporte:${guard.user.id}`, MAX_REPORTES_POR_DIA, DAY_MS).ok) {
    return { status: "error", message: C.errores.demasiadas };
  }

  // La RPC valida tenant y existencia, y el peso del reporte lo pone el trigger
  // según el Trust Score de quien reporta (0005). Nada de eso es forjable acá.
  const { error } = await supabaseSinTipar(guard.supabase).rpc("report_listing_review", {
    p_review_id: parsed.data.reviewId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    if (error.message.includes("TARGET_NOT_FOUND")) {
      return { status: "invalid", message: C.errores.noEncontrado };
    }
    if (error.message.includes("AUTH_REQUIRED")) {
      return { status: "error", message: C.errores.sinCuenta };
    }
    console.error("[resenas] falló el reporte:", error.code, error.message);
    return { status: "error", message: C.errores.generico };
  }

  return { status: "success", message: C.reportada };
}
