"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getStaffContext, logAdminAction } from "../../guard";
import {
  CREATOR_DECISIONS,
  NOTE_MAX_LENGTH,
  NOTE_MIN_LENGTH,
  decisionNeedsNote,
} from "./decisiones";

/**
 * =============================================================================
 * RESOLVER UNA SOLICITUD DE CREADOR
 * =============================================================================
 *
 * Quien decide de verdad es la base: `public.admin_resolve_creator_activation`
 * (0032). Su firma real, verificada contra la migración, es
 *
 *     admin_resolve_creator_activation(
 *       p_profile_id uuid,
 *       p_decision   text,   -- 'approved'|'needs_info'|'rejected'|'suspended'
 *       p_note       text default null
 *     ) returns text
 *
 * y adentro hace tres cosas que esta action NO repite ni intenta suplir: exige
 * `auth.uid()` y `app.is_staff()` contra el JWT, acota el UPDATE al tenant que
 * sale de `app.current_tenant_id()`, y mueve `user_roles` a `revoked` cuando la
 * decisión es rechazo o suspensión.
 *
 * -----------------------------------------------------------------------------
 * SE LLAMA CON EL CLIENTE DEL STAFF, NUNCA CON EL ADMIN CLIENT
 *
 * Es lo contrario de `request_creator_activation`, su hermana del lado del
 * usuario, que SÍ va con admin client. Acá la RPC empieza con
 * `if auth.uid() is null ... raise AUTH_REQUIRED`: bajo `service_role` no hay
 * `auth.uid()` ni tenant, así que el admin client no es "más potente", es un
 * fallo garantizado. El grant existe (`to authenticated, service_role`) pero el
 * cuerpo pide sesión — y está bien que la pida: aprobar creadores tiene que
 * quedar firmado por una persona.
 *
 * -----------------------------------------------------------------------------
 * TRES CANDADOS, NINGUNO EN LA UI
 *
 *  1. ROL. `getStaffContext("domain_admin")` revalida el token contra Supabase
 *     (`getUser()`, no la cookie). Esconder el botón no es un permiso: una
 *     server action es un POST al que se le puede pegar sin pasar por la
 *     pantalla. Se pide `domain_admin` —y no el `moderator` que le alcanzaría a
 *     la RPC— por coherencia con el panel hermano de umbrales: decidir quién
 *     cobra en la comunidad es la misma decisión de negocio.
 *  2. TENANT. Sale del JWT y jamás del formulario.
 *  3. LA BASE. La RPC vuelve a verificar rol y tenant por su cuenta. Si los dos
 *     primeros candados fallaran, este todavía sostiene.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL MOTIVO NO SE PERSISTE HOY (limitación conocida de la 0032)
 *
 * `p_decision` viaja con el motivo en `p_note`, que es el canal que declara el
 * contrato… pero el cuerpo de la función NO lo escribe en ningún lado: no hay
 * columna de resolución en `creator_profiles`. Se manda igual —usar el
 * parámetro correcto es lo que hace que el día que la migración lo guarde esto
 * ya funcione— y en la auditoría queda que hubo motivo y de qué largo, nunca su
 * texto (§5.4: el audit_log guarda ids, no contenido). La pantalla se lo dice al
 * moderador con todas las letras en vez de fingir que la persona lo va a
 * recibir.
 * =============================================================================
 */

const COPY = {
  notAllowed:
    "Tu sesión no tiene permisos para resolver solicitudes de creador. Entrá de nuevo e intentá otra vez.",
  noTenant: "No pudimos identificar tu comunidad. Cerrá sesión y volvé a entrar.",
  invalid: "No pudimos leer la decisión — recargá la página e intentá de nuevo.",
  noteRequired: "Escribí un motivo antes de continuar: la persona merece saber qué pasó.",
  notFound: "Esta solicitud ya no está en tu comunidad — la lista se actualizó.",
  alreadyResolved: "Esta solicitud ya la resolvió otra persona del equipo — la lista se actualizó.",
  forbidden: "La base rechazó la operación por permisos. Cerrá sesión y volvé a entrar.",
  genericError:
    "No pudimos guardar la decisión — no es tu culpa. Probá de nuevo en un momento.",
  done: {
    approved: "Listo. Ya puede recibir trabajos pagos en tu comunidad.",
    needs_info: "Le pedimos más datos. La solicitud queda esperando su respuesta.",
    rejected: "Solicitud rechazada. Puede volver a intentarlo cuando complete los requisitos.",
    suspended: "Cuenta de creador suspendida. Dejó de poder recibir trabajos.",
  },
} as const;

/**
 * Estados sobre los que todavía tiene sentido decidir. Una solicitud que ya
 * está en el estado pedido no se vuelve a escribir: no es un error del sistema,
 * es que alguien llegó primero, y se dice así.
 */
const RESOLVABLE_STATUSES = new Set([
  "platform_review_pending",
  "documents_pending",
  "stripe_review_pending",
  "needs_info",
  "approved",
  "rejected",
  "suspended",
]);

const schema = z.object({
  profileId: z.uuid(),
  decision: z.enum(CREATOR_DECISIONS),
  note: z.string().trim().max(NOTE_MAX_LENGTH).optional(),
});

export type ResolveCreatorState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

export async function resolveCreatorActivation(
  _prev: ResolveCreatorState,
  formData: FormData,
): Promise<ResolveCreatorState> {
  const rawNote = formData.get("note");
  const parsed = schema.safeParse({
    profileId: formData.get("profileId"),
    decision: formData.get("decision"),
    note: typeof rawNote === "string" && rawNote.trim() ? rawNote : undefined,
  });
  if (!parsed.success) return { status: "error", message: COPY.invalid };
  const { profileId, decision, note } = parsed.data;

  // El motivo se valida en el SERVIDOR aunque el botón del cliente esté
  // deshabilitado sin él: el botón es una cortesía, esto es la regla.
  if (decisionNeedsNote(decision) && (note?.length ?? 0) < NOTE_MIN_LENGTH) {
    return { status: "error", message: COPY.noteRequired };
  }

  // Candado 1: rol verificado contra el servidor de auth, antes de tocar nada.
  const ctx = await getStaffContext("domain_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user, tenantId } = ctx;

  // Candado 2: la comunidad es la del JWT. El formulario no opina.
  if (!tenantId) return { status: "error", message: COPY.noTenant };

  /**
   * Lectura previa. `creator_profiles_select` es `USING (true)` (0024), o sea
   * que sin el `eq("tenant_id")` explícito esta consulta leería el perfil de
   * CUALQUIER comunidad. El filtro está para que "no existe acá" y "existe en
   * otra comunidad" sean la misma respuesta desde este panel.
   *
   * Sirve además para dos cosas más: guardar el estado anterior en la auditoría
   * (una decisión sin su punto de partida no se puede reconstruir) y frenar la
   * doble resolución.
   */
  const { data: creator, error: readError } = await supabase
    .from("creator_profiles")
    .select("profile_id, status")
    .eq("profile_id", profileId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (readError) {
    console.error("[admin/creadores] no se pudo leer la solicitud:", readError.message);
    return { status: "error", message: COPY.genericError };
  }
  if (!creator) return { status: "error", message: COPY.notFound };
  if (!RESOLVABLE_STATUSES.has(creator.status) || creator.status === decision) {
    return { status: "error", message: COPY.alreadyResolved };
  }

  // Candado 3: la RPC, con el cliente del staff. Ver la cabecera.
  const { error: rpcError } = await supabase.rpc("admin_resolve_creator_activation", {
    p_profile_id: profileId,
    p_decision: decision,
    p_note: note ?? undefined,
  });

  if (rpcError) {
    // Los mensajes crudos del SQL no llegan a la pantalla: se traducen a lo que
    // el moderador puede hacer al respecto.
    if (rpcError.message.includes("FORBIDDEN") || rpcError.message.includes("AUTH_REQUIRED")) {
      return { status: "error", message: COPY.forbidden };
    }
    if (rpcError.message.includes("NO_CREATOR_PROFILE")) {
      return { status: "error", message: COPY.notFound };
    }
    console.error("[admin/creadores] la RPC de activación falló:", rpcError.message);
    return { status: "error", message: COPY.genericError };
  }

  /**
   * Auditoría. Aprobar a alguien para que cobre en la comunidad es de las
   * decisiones más caras que se toman desde el panel, así que queda con nombre,
   * fecha, de qué estado salió y a cuál fue. El TEXTO del motivo no viaja —
   * `audit_log.meta` guarda ids, nunca contenido (§5.4)—; sí queda constancia
   * de que hubo motivo y de su largo, que es lo que permite auditar el proceso
   * sin construir un archivo citable.
   */
  await logAdminAction({
    actorId: user.id,
    action: `creator_activation.${decision}`,
    tenantId,
    subjectKind: "creator_profile",
    subjectId: profileId,
    meta: { from_status: creator.status, to_status: decision, note_length: note?.length ?? 0 },
  });

  revalidatePath("/admin/creadores/solicitudes");
  // La pantalla de la persona muestra el estado de SU solicitud: sin esto
  // seguiría diciendo "en revisión" después de que ya se resolvió.
  revalidatePath("/creadores/solicitud");
  // Y el directorio de creadores gana o pierde una ficha según la decisión.
  revalidatePath("/creadores");

  return { status: "success", message: COPY.done[decision] };
}
