"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  isHelpStatus,
  puedeTransicionar,
  supabaseSinTiparComunidad,
} from "@/lib/comunidad";
import { getStaffContext, logAdminAction } from "../../guard";
import { HELP_DECISIONS, NOTA_MAX, NOTA_MIN, decisionNecesitaNota } from "./decisiones";

/**
 * =============================================================================
 * RESOLVER UN AVISO DE AYUDA MUTUA (Comunidad, migración 0120)
 * =============================================================================
 *
 * Es la cola que pidió el cliente: «todo esto se verifica vía geovanny con la
 * cuenta de admin». Acá se aprueba, se rechaza y se baja del tablón.
 *
 * -----------------------------------------------------------------------------
 * SE ESCRIBE CON EL CLIENTE DEL STAFF, NUNCA CON EL ADMIN CLIENT
 *
 * Y no es una preferencia: con `service_role` no hay `auth.uid()`, y el trigger
 * `app.community_help_notices_guard()` (0120) usa justamente `auth.uid()` para
 * estampar `reviewed_by`. Con el admin client la decisión quedaría sin firma —
 * o sea, sin la parte que la hace auditable. El admin client aparece una sola
 * vez en este archivo, dentro de `logAdminAction`, que es donde corresponde
 * (audit_log tiene el INSERT cerrado para JWT de usuario).
 *
 * -----------------------------------------------------------------------------
 * TRES CANDADOS, NINGUNO EN LA UI
 *
 *  1. ROL. `getStaffContext("moderator")` revalida el token contra Supabase
 *     (`getUser()`, no la cookie). Esconder un botón no es un permiso: una
 *     server action es un POST al que se le puede pegar sin pasar por la
 *     pantalla.
 *  2. TENANT. Sale del JWT y jamás del formulario.
 *  3. LA BASE. La policy de UPDATE exige tenant + staff, y el trigger vuelve a
 *     validar la transición y congela el contenido. Si los dos primeros
 *     candados fallaran, éste todavía sostiene.
 *
 * `moderator` y no `domain_admin`: decidir si un texto se publica es moderación
 * de contenido, que es exactamente lo que hace un moderador — y la base pide lo
 * mismo (`app.is_staff()`). Pedir un rango más alto acá sólo lograría que la
 * cola dependa de una sola persona, que es el cuello de botella que este diseño
 * ya tiene bastante.
 *
 * -----------------------------------------------------------------------------
 * EL MOTIVO DEL RECHAZO SÍ LLEGA A SU DESTINATARIO
 *
 * A diferencia de la nota de una solicitud de creador (que hoy no se persiste,
 * ver ese archivo), acá el texto se guarda en `community_help_notices.review_note`
 * y se muestra en "Mis avisos", junto al botón de corregir. Por eso se exige y
 * por eso se valida en el servidor aunque el botón del cliente ya lo pida.
 *
 * En `audit_log` NO viaja el texto: sólo su largo (§5.4 — el registro guarda
 * ids, no contenido). El texto vive donde tiene que vivir, que es en la fila
 * que la persona puede leer.
 * =============================================================================
 */

const COPY = {
  notAllowed:
    "Tu sesión no tiene permisos para resolver avisos de ayuda. Entrá de nuevo e intentá otra vez.",
  noTenant: "No pudimos identificar tu comunidad. Cerrá sesión y volvé a entrar.",
  invalid: "No pudimos leer la decisión — recargá la página e intentá de nuevo.",
  noteRequired: `Escribí un motivo (mínimo ${NOTA_MIN} caracteres): la persona lo va a leer y necesita saber qué corregir.`,
  notFound: "Ese aviso ya no está en tu comunidad — la lista se actualizó.",
  alreadyResolved: "Ese aviso ya lo resolvió otra persona del equipo — la lista se actualizó.",
  genericError: "No pudimos guardar la decisión — no es tu culpa. Probá de nuevo en un momento.",
  done: {
    approved: "Listo. Ya se ve en el tablón de la comunidad.",
    rejected: "Listo. Le avisamos el motivo para que pueda corregirlo.",
    archived: "Listo. Lo bajamos del tablón.",
  },
} as const;

const schema = z.object({
  avisoId: z.uuid(),
  decision: z.enum(HELP_DECISIONS),
  note: z.string().trim().max(NOTA_MAX).optional(),
});

export type ResolveHelpNoticeState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

export async function resolverAvisoDeAyuda(
  _prev: ResolveHelpNoticeState,
  formData: FormData,
): Promise<ResolveHelpNoticeState> {
  const rawNote = formData.get("note");
  const parsed = schema.safeParse({
    avisoId: formData.get("avisoId"),
    decision: formData.get("decision"),
    note: typeof rawNote === "string" && rawNote.trim() ? rawNote : undefined,
  });
  if (!parsed.success) return { status: "error", message: COPY.invalid };
  const { avisoId, decision, note } = parsed.data;

  // El motivo se valida en el SERVIDOR aunque el botón del cliente esté
  // deshabilitado sin él: el botón es una cortesía, esto es la regla.
  if (decisionNecesitaNota(decision) && (note?.length ?? 0) < NOTA_MIN) {
    return { status: "error", message: COPY.noteRequired };
  }

  // Candado 1: rol verificado contra el servidor de auth, antes de tocar nada.
  const ctx = await getStaffContext("moderator");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user, tenantId } = ctx;

  // Candado 2: la comunidad es la del JWT. El formulario no opina.
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
    .eq("id", avisoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (leerError) {
    console.error("[admin/ayuda-mutua] no se pudo leer el aviso:", leerError.message);
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
    .eq("id", avisoId)
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
      "[admin/ayuda-mutua] no se pudo guardar la decisión:",
      escribirError?.message ?? "sin filas",
    );
    return { status: "error", message: COPY.genericError };
  }

  /**
   * Auditoría. Queda con nombre, fecha, de qué estado salió y a cuál fue, más
   * a quién le pertenecía el aviso — porque una decisión de moderación sobre
   * contenido de una persona tiene que poder reconstruirse.
   *
   * El TEXTO del motivo no viaja: `audit_log.meta` guarda ids, nunca contenido
   * (§5.4). Sí queda constancia de que hubo motivo y de su largo, que es lo que
   * permite auditar el proceso sin construir un archivo citable.
   */
  await logAdminAction({
    actorId: user.id,
    action: `community_help_notice.${decision}`,
    tenantId,
    subjectKind: "community_help_notice",
    subjectId: avisoId,
    meta: {
      from_status: fila.status,
      to_status: decision,
      author_id: fila.created_by,
      note_length: note?.length ?? 0,
    },
  });

  revalidatePath("/admin/comunidad/ayuda-mutua");
  // El tablón gana o pierde una tarjeta, y su autor tiene que ver el cambio de
  // estado (y el motivo) en "Mis avisos".
  revalidatePath("/comunidad/ayuda-mutua");
  revalidatePath("/comunidad/ayuda-mutua/mios");

  return { status: "success", message: COPY.done[decision] };
}
