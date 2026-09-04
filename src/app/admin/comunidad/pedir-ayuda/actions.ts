"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  isHelpReplyStatus,
  isHelpStatus,
  puedeTransicionar,
  puedeTransicionarRespuesta,
  supabaseSinTiparComunidad,
} from "@/lib/comunidad";
import { getStaffContext, logAdminAction } from "../../guard";
import {
  HELP_DECISIONS,
  NOTA_MAX,
  NOTA_MIN,
  REPLY_DECISIONS,
  decisionNecesitaNota,
} from "./decisiones";

/**
 * =============================================================================
 * MODERAR EL TABLÓN "PEDIR AYUDA" (0120 + 0130)
 * =============================================================================
 *
 * Dos acciones: resolver un PEDIDO (ocultar, restaurar, bajar) y resolver una
 * RESPUESTA (ocultar, restaurar).
 *
 * ── ES MODERACIÓN POSTERIOR, NO ADMISIÓN ────────────────────────────────────
 * Con la 0120 esta pantalla decidía si algo se publicaba. Con la 0130 el pedido
 * y la respuesta ya están publicados cuando llegan acá (§4 de la migración), y
 * eso cambia el peso de cada decisión: ocultar algo que la comunidad ya vio no
 * es lo mismo que no dejarlo entrar. Por eso el motivo es obligatorio y por eso
 * se le muestra a su autor en "Mis pedidos".
 *
 * -----------------------------------------------------------------------------
 * SE ESCRIBE CON EL CLIENTE DEL STAFF, NUNCA CON EL ADMIN CLIENT
 *
 * Y no es una preferencia: con `service_role` no hay `auth.uid()`, y los
 * triggers usan justamente `auth.uid()` para estampar quién decidió. Con el
 * admin client la decisión quedaría sin firma — o sea, sin la parte que la hace
 * auditable. El admin client aparece una sola vez en este archivo, dentro de
 * `logAdminAction`, que es donde corresponde (audit_log tiene el INSERT cerrado
 * para JWT de usuario).
 *
 * -----------------------------------------------------------------------------
 * TRES CANDADOS, NINGUNO EN LA UI
 *
 *  1. ROL. `getStaffContext("moderator")` revalida el token contra Supabase
 *     (`getUser()`, no la cookie). Esconder un botón no es un permiso: una
 *     server action es un POST al que se le puede pegar sin pasar por la
 *     pantalla.
 *  2. TENANT. Sale del JWT y jamás del formulario.
 *  3. LA BASE. Las policies de UPDATE exigen tenant + staff, y los triggers
 *     vuelven a validar la transición y congelan el contenido. Si los dos
 *     primeros candados fallaran, éste todavía sostiene.
 *
 * `moderator` y no `domain_admin`: ocultar contenido es moderación, que es
 * exactamente lo que hace un moderador — y la base pide lo mismo
 * (`app.is_staff()`).
 *
 * -----------------------------------------------------------------------------
 * EL TEXTO NO VIAJA A LA AUDITORÍA
 *
 * En `audit_log` van ids, estados y el LARGO del motivo, nunca el contenido
 * (§5.4). El texto vive donde tiene que vivir: en la fila que la persona puede
 * leer.
 * =============================================================================
 */

const COPY = {
  notAllowed:
    "Tu sesión no tiene permisos para moderar esta sección. Entrá de nuevo e intentá otra vez.",
  noTenant: "No pudimos identificar tu comunidad. Cerrá sesión y volvé a entrar.",
  invalid: "No pudimos leer la decisión — recargá la página e intentá de nuevo.",
  noteRequired: `Escribí un motivo (mínimo ${NOTA_MIN} caracteres): la persona lo va a leer en "Mis pedidos".`,
  notFound: "Eso ya no está en tu comunidad — la lista se actualizó.",
  alreadyResolved: "Ya lo resolvió otra persona del equipo — la lista se actualizó.",
  genericError: "No pudimos guardar la decisión — no es tu culpa. Probá de nuevo en un momento.",
  donePedido: {
    approved: "Listo. El pedido volvió al tablón.",
    rejected: "Listo. Lo sacamos del tablón y le avisamos el motivo.",
    archived: "Listo. Lo dimos por cerrado.",
  },
  doneRespuesta: {
    hidden: "Listo. La respuesta ya no se ve.",
    visible: "Listo. La respuesta volvió a verse.",
  },
} as const;

// ===========================================================================
// 1. Resolver un pedido
// ===========================================================================

const pedidoSchema = z.object({
  pedidoId: z.uuid(),
  decision: z.enum(HELP_DECISIONS),
  note: z.string().trim().max(NOTA_MAX).optional(),
});

export type ResolveState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

export async function resolverPedido(
  _prev: ResolveState,
  formData: FormData,
): Promise<ResolveState> {
  const rawNote = formData.get("note");
  const parsed = pedidoSchema.safeParse({
    pedidoId: formData.get("pedidoId"),
    decision: formData.get("decision"),
    note: typeof rawNote === "string" && rawNote.trim() ? rawNote : undefined,
  });
  if (!parsed.success) return { status: "error", message: COPY.invalid };
  const { pedidoId, decision, note } = parsed.data;

  // El motivo se valida en el SERVIDOR aunque el botón del cliente esté
  // deshabilitado sin él: el botón es una cortesía, esto es la regla.
  if (decisionNecesitaNota(decision) && (note?.length ?? 0) < NOTA_MIN) {
    return { status: "error", message: COPY.noteRequired };
  }

  const ctx = await getStaffContext("moderator");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user, tenantId } = ctx;
  if (!tenantId) return { status: "error", message: COPY.noTenant };

  const sinTipar = supabaseSinTiparComunidad(supabase);

  /**
   * Lectura previa. Hace falta para tres cosas, y las tres importan:
   *  · saber si la transición es legal ANTES de intentarla, y poder contestar
   *    con una frase en vez de con el `BAD_TRANSITION` del trigger;
   *  · guardar el estado anterior en la auditoría (una decisión sin su punto de
   *    partida no se puede reconstruir);
   *  · frenar la doble resolución cuando dos personas del equipo abrieron la
   *    misma cola.
   */
  const { data: actual, error: leerError } = await sinTipar
    .from("community_help_notices")
    .select("id, status, created_by")
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (leerError) {
    console.error("[admin/pedir-ayuda] no se pudo leer el pedido:", leerError.message);
    return { status: "error", message: COPY.genericError };
  }
  if (!actual) return { status: "error", message: COPY.notFound };

  const fila = actual as { id: string; status: string; created_by: string };
  if (!isHelpStatus(fila.status) || !puedeTransicionar(fila.status, decision, "staff")) {
    return { status: "error", message: COPY.alreadyResolved };
  }

  // Candado 3: la base. `reviewed_by` y `reviewed_at` NO se mandan desde acá —
  // los estampa el trigger con `auth.uid()` y `now()`, que es lo que hace que la
  // firma no dependa de que la app se acuerde de ponerla.
  const { data: resuelto, error: escribirError } = await sinTipar
    .from("community_help_notices")
    .update({ status: decision, review_note: note ?? null })
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    // Vuelve a exigir el estado que se leyó: si alguien resolvió en el medio,
    // este UPDATE no toca nada en vez de pisar su decisión.
    .eq("status", fila.status)
    .select("id")
    .maybeSingle();

  if (escribirError || !resuelto) {
    if (escribirError?.message.includes("BAD_TRANSITION")) {
      return { status: "error", message: COPY.alreadyResolved };
    }
    console.error(
      "[admin/pedir-ayuda] no se pudo guardar la decisión:",
      escribirError?.message ?? "sin filas",
    );
    return { status: "error", message: COPY.genericError };
  }

  await logAdminAction({
    actorId: user.id,
    action: `community_help_notice.${decision}`,
    tenantId,
    subjectKind: "community_help_notice",
    subjectId: pedidoId,
    meta: {
      from_status: fila.status,
      to_status: decision,
      author_id: fila.created_by,
      note_length: note?.length ?? 0,
    },
  });

  revalidatePath("/admin/comunidad/pedir-ayuda");
  // El tablón gana o pierde una tarjeta, y su autor tiene que ver el cambio de
  // estado (y el motivo) en "Mis pedidos".
  revalidatePath("/comunidad/pedir-ayuda");
  revalidatePath("/comunidad/pedir-ayuda/mios");
  revalidatePath(`/comunidad/pedir-ayuda/${pedidoId}`);

  return { status: "success", message: COPY.donePedido[decision] };
}

// ===========================================================================
// 2. Resolver una respuesta
// ===========================================================================

const respuestaSchema = z.object({
  respuestaId: z.uuid(),
  decision: z.enum(REPLY_DECISIONS),
  note: z.string().trim().max(NOTA_MAX).optional(),
});

/**
 * Ocultar y restaurar una respuesta.
 *
 * El motivo acá es INTERNO —no se le muestra a quien la escribió, a diferencia
 * del de un pedido— porque una respuesta ocultada no tiene camino de
 * corrección: no se edita ni se reenvía. Un reproche sin acción posible sería
 * sólo un reproche. Igual se pide al ocultar, para que la decisión quede
 * explicada de cara al equipo.
 *
 * Ocultarla resta del contador del pedido: lo hace el trigger
 * `app.help_replies_bump_count()`, no esta action. Si el número se mantuviera,
 * el tablón anunciaría respuestas que ya no están.
 */
export async function resolverRespuesta(
  _prev: ResolveState,
  formData: FormData,
): Promise<ResolveState> {
  const rawNote = formData.get("note");
  const parsed = respuestaSchema.safeParse({
    respuestaId: formData.get("respuestaId"),
    decision: formData.get("decision"),
    note: typeof rawNote === "string" && rawNote.trim() ? rawNote : undefined,
  });
  if (!parsed.success) return { status: "error", message: COPY.invalid };
  const { respuestaId, decision, note } = parsed.data;

  if (decision === "hidden" && (note?.length ?? 0) < NOTA_MIN) {
    return { status: "error", message: COPY.noteRequired };
  }

  const ctx = await getStaffContext("moderator");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user, tenantId } = ctx;
  if (!tenantId) return { status: "error", message: COPY.noTenant };

  const sinTipar = supabaseSinTiparComunidad(supabase);

  const { data: actual, error: leerError } = await sinTipar
    .from("community_help_replies")
    .select("id, status, created_by, notice_id")
    .eq("id", respuestaId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (leerError) {
    console.error("[admin/pedir-ayuda] no se pudo leer la respuesta:", leerError.message);
    return { status: "error", message: COPY.genericError };
  }
  if (!actual) return { status: "error", message: COPY.notFound };

  const fila = actual as {
    id: string;
    status: string;
    created_by: string;
    notice_id: string;
  };
  if (
    !isHelpReplyStatus(fila.status) ||
    !puedeTransicionarRespuesta(fila.status, decision, "staff")
  ) {
    return { status: "error", message: COPY.alreadyResolved };
  }

  const { data: resuelto, error: escribirError } = await sinTipar
    .from("community_help_replies")
    .update({ status: decision, moderation_note: note ?? null })
    .eq("id", respuestaId)
    .eq("tenant_id", tenantId)
    .eq("status", fila.status)
    .select("id")
    .maybeSingle();

  if (escribirError || !resuelto) {
    if (escribirError?.message.includes("BAD_TRANSITION")) {
      return { status: "error", message: COPY.alreadyResolved };
    }
    console.error(
      "[admin/pedir-ayuda] no se pudo guardar la decisión sobre la respuesta:",
      escribirError?.message ?? "sin filas",
    );
    return { status: "error", message: COPY.genericError };
  }

  await logAdminAction({
    actorId: user.id,
    action: `community_help_reply.${decision}`,
    tenantId,
    subjectKind: "community_help_reply",
    subjectId: respuestaId,
    meta: {
      from_status: fila.status,
      to_status: decision,
      author_id: fila.created_by,
      notice_id: fila.notice_id,
      note_length: note?.length ?? 0,
    },
  });

  revalidatePath("/admin/comunidad/pedir-ayuda");
  revalidatePath(`/comunidad/pedir-ayuda/${fila.notice_id}`);
  revalidatePath("/comunidad/pedir-ayuda");

  return { status: "success", message: COPY.doneRespuesta[decision] };
}
