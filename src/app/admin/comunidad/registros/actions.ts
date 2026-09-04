"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  REGISTRATION_NOTES_MAX,
  REGISTRATION_NOTES_MIN,
  REGISTRATION_STATUSES,
  fuenteConfirmadaSchema,
  isRegistrationStatus,
  puedeTransicionarRegistro,
  recursoDesdeRegistro,
  supabaseSinTiparComunidad,
  type RegistrationRow,
} from "@/lib/comunidad";
import { getStaffContext, logAdminAction } from "../../guard";

/**
 * =============================================================================
 * RESOLVER LOS REGISTROS PRIVADOS (0131)
 * =============================================================================
 *
 * Dos acciones: mover un registro de estado (con notas internas) y —sólo para
 * los lugares— aprobarlo publicando su ficha en el directorio.
 *
 * -----------------------------------------------------------------------------
 * SE ESCRIBE CON EL CLIENTE DEL STAFF, NUNCA CON EL ADMIN CLIENT
 *
 * Y no es una preferencia: con `service_role` no hay `auth.uid()`, y el trigger
 * de la 0131 usa justamente `auth.uid()` para estampar quién resolvió. Con el
 * admin client la decisión quedaría sin firma — o sea, sin la parte que la hace
 * auditable. El admin client aparece una sola vez acá, dentro de
 * `logAdminAction`, que es donde corresponde.
 *
 * -----------------------------------------------------------------------------
 * TRES CANDADOS, NINGUNO EN LA UI
 *
 *  1. ROL. `getStaffContext("domain_admin")` revalida el token contra Supabase.
 *     Y es `domain_admin` y no `moderator` a propósito: esta pantalla muestra
 *     teléfonos y correos de vecinos. Mismo criterio que /admin/empleos.
 *  2. TENANT. Sale del JWT y jamás del formulario.
 *  3. LA BASE. La policy de UPDATE exige tenant + domain_admin, y el trigger
 *     congela el contenido y prohíbe volver a `new`.
 *
 * -----------------------------------------------------------------------------
 * EL TELÉFONO NO VIAJA A LA AUDITORÍA
 *
 * En `audit_log` van ids, estados y a lo sumo el LARGO de la nota, nunca el
 * contenido ni el dato de contacto (§5.4). Sería absurdo purgar el registro a
 * los 180 días y dejar el teléfono copiado en un log que dura 365.
 * =============================================================================
 */

const RUTA = "/admin/comunidad/registros";

const COPY = {
  notAllowed:
    "Tu sesión no tiene permisos para esta sección. Entrá de nuevo e intentá otra vez.",
  noTenant: "No pudimos identificar tu comunidad. Cerrá sesión y volvé a entrar.",
  invalid: "No pudimos leer la decisión — recargá la página e intentá de nuevo.",
  notFound: "Ese registro ya no está en tu comunidad — la lista se actualizó.",
  badTransition: "Ese registro ya está en ese estado. Recargá la página y fijate cómo quedó.",
  noteTooShort: `La nota tiene que tener al menos ${REGISTRATION_NOTES_MIN} caracteres.`,
  genericError: "No pudimos guardar la decisión — no es tu culpa. Probá de nuevo en un momento.",
  // Publicación de un lugar
  notAPlace: "Sólo se puede publicar una ficha desde el registro de un lugar.",
  yaPublicado: "Ese lugar ya tiene su ficha en el directorio.",
  faltanDatos:
    "A ese registro le falta la dirección o el teléfono, así que la ficha no se puede publicar. Pedíselos antes de aprobar.",
  fuenteInvalida:
    "Escribí quién publica esa información y el enlace donde la confirmaste (tiene que empezar con http o https).",
  publicado: "Listo. El lugar ya aparece en el directorio de la comunidad.",
  resuelto: {
    new: "",
    contacted: "Listo. Quedó marcado como contactado.",
    approved: "Listo. Quedó aprobado.",
    discarded: "Listo. Quedó descartado.",
  },
} as const;

export type RegistroActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

// ===========================================================================
// 1. Mover de estado (y dejar notas)
// ===========================================================================

const resolverSchema = z.object({
  registroId: z.uuid(),
  hasta: z.enum(REGISTRATION_STATUSES),
  notas: z.string().trim().max(REGISTRATION_NOTES_MAX).optional(),
});

/**
 * Mueve un registro y, si vino, guarda la nota interna.
 *
 * La nota es OPCIONAL en las cuatro transiciones, al revés que en la moderación
 * del tablón —donde el motivo es obligatorio porque se le muestra a su autor—.
 * Acá nadie más que el equipo la lee, así que exigirla sólo lograría que se
 * escriban notas vacías con tal de poder apretar el botón.
 */
export async function resolverRegistro(
  _prev: RegistroActionState,
  formData: FormData,
): Promise<RegistroActionState> {
  const rawNotas = formData.get("notas");
  const parsed = resolverSchema.safeParse({
    registroId: formData.get("registroId"),
    hasta: formData.get("hasta"),
    notas: typeof rawNotas === "string" && rawNotas.trim() ? rawNotas : undefined,
  });
  if (!parsed.success) return { status: "error", message: COPY.invalid };
  const { registroId, hasta, notas } = parsed.data;

  if (notas && notas.length < REGISTRATION_NOTES_MIN) {
    return { status: "error", message: COPY.noteTooShort };
  }

  const ctx = await getStaffContext("domain_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user, tenantId } = ctx;
  if (!tenantId) return { status: "error", message: COPY.noTenant };

  const sinTipar = supabaseSinTiparComunidad(supabase);

  /**
   * Lectura previa. Hace falta para tres cosas y las tres importan: saber si la
   * transición es legal ANTES de intentarla (y poder contestar con una frase en
   * vez de con el `BAD_TRANSITION` del trigger), guardar el estado anterior en
   * la auditoría, y frenar la doble resolución cuando dos personas del equipo
   * abrieron la misma cola.
   */
  const { data, error: errorLectura } = await sinTipar
    .from("community_registrations")
    .select("id, kind, status")
    .eq("id", registroId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (errorLectura) return { status: "error", message: COPY.genericError };
  if (!data) return { status: "error", message: COPY.notFound };

  const actual = data as { id: string; kind: string; status: string };
  if (!isRegistrationStatus(actual.status) || !puedeTransicionarRegistro(actual.status, hasta)) {
    return { status: "error", message: COPY.badTransition };
  }

  const { error } = await sinTipar
    .from("community_registrations")
    .update({ status: hasta, ...(notas ? { admin_notes: notas } : {}) })
    .eq("id", registroId)
    .eq("tenant_id", tenantId);

  if (error) {
    console.warn("[admin/registros] update falló", { code: error.code });
    return { status: "error", message: COPY.genericError };
  }

  await logAdminAction({
    actorId: user.id,
    action: "community_registration.resolve",
    tenantId,
    subjectKind: "community_registration",
    subjectId: registroId,
    // Sin teléfono, sin correo y sin el texto de la nota: sólo su largo.
    meta: { kind: actual.kind, desde: actual.status, hasta, notaLargo: notas?.length ?? 0 },
  });

  revalidatePath(RUTA);
  return { status: "success", message: COPY.resuelto[hasta] || COPY.resuelto.approved };
}

// ===========================================================================
// 2. Aprobar un lugar y publicar su ficha
// ===========================================================================

const publicarSchema = z.object({
  registroId: z.uuid(),
  fuenteName: z.string(),
  fuenteUrl: z.string(),
  fuenteCheckedAt: z.string(),
});

/**
 * Convierte un registro `place` aprobado en una ficha de `community_resources`.
 *
 * ── POR QUÉ PIDE UNA FUENTE Y NO LA INVENTA ─────────────────────────────────
 * Porque el directorio (0096) exige procedencia verificable en tres capas —el
 * NOT NULL de la migración, el filtro de `toCommunityResource` y la card— y no
 * por burocracia: una ficha sin fuente se lee como si el consejo lo diera la
 * plataforma. Rellenar acá un `source_name: "lo dijo el propio negocio"` con una
 * URL cualquiera sería saltear esa regla desde adentro. Lo que corresponde es
 * que alguien del equipo abra algo real —la página del lugar, el listado de la
 * alcaldía— y escriba qué abrió y qué día.
 *
 * ── DOS ESCRITURAS QUE NO SON UNA TRANSACCIÓN ───────────────────────────────
 * PostgREST no da transacción entre dos tablas, así que se hace en orden y con
 * limpieza: primero la ficha, después el registro. Si lo segundo falla, se borra
 * la ficha recién creada — un registro sin ficha se puede volver a aprobar, pero
 * una ficha publicada que nadie sabe de dónde salió queda en la app de la gente.
 */
export async function publicarLugar(
  _prev: RegistroActionState,
  formData: FormData,
): Promise<RegistroActionState> {
  const parsed = publicarSchema.safeParse({
    registroId: formData.get("registroId"),
    fuenteName: formData.get("fuenteName"),
    fuenteUrl: formData.get("fuenteUrl"),
    fuenteCheckedAt: formData.get("fuenteCheckedAt"),
  });
  if (!parsed.success) return { status: "error", message: COPY.invalid };

  const fuente = fuenteConfirmadaSchema.safeParse({
    name: parsed.data.fuenteName,
    url: parsed.data.fuenteUrl,
    checkedAt: parsed.data.fuenteCheckedAt,
  });
  if (!fuente.success) return { status: "error", message: COPY.fuenteInvalida };

  const ctx = await getStaffContext("domain_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user, tenantId } = ctx;
  if (!tenantId) return { status: "error", message: COPY.noTenant };

  const sinTipar = supabaseSinTiparComunidad(supabase);
  const { registroId } = parsed.data;

  const { data, error: errorLectura } = await sinTipar
    .from("community_registrations")
    .select("id, kind, name, contact_phone, area_label, body, details, resource_id")
    .eq("id", registroId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (errorLectura) return { status: "error", message: COPY.genericError };
  if (!data) return { status: "error", message: COPY.notFound };

  const registro = data as Pick<
    RegistrationRow,
    "id" | "kind" | "name" | "contact_phone" | "area_label" | "body" | "details" | "resource_id"
  >;
  if (registro.kind !== "place") return { status: "error", message: COPY.notAPlace };
  if (registro.resource_id) return { status: "error", message: COPY.yaPublicado };

  const ficha = recursoDesdeRegistro(registro, fuente.data);
  if (!ficha) return { status: "error", message: COPY.faltanDatos };

  // 1) La ficha. `tenant_id` del JWT: la policy de INSERT de la 0096 exige que
  //    coincida con app.current_tenant_id(), así que un tenant de formulario no
  //    entraría igual — pero acá directamente no existe esa posibilidad.
  const { data: creada, error: errorFicha } = await sinTipar
    .from("community_resources")
    .insert({ tenant_id: tenantId, languages: [], ...ficha })
    .select("id")
    .maybeSingle();

  if (errorFicha || !creada) {
    console.warn("[admin/registros] alta de ficha falló", { code: errorFicha?.code });
    return { status: "error", message: COPY.genericError };
  }
  const recursoId = (creada as { id: string }).id;

  // 2) El registro, apuntando a la ficha. Si esto falla, la ficha se va con él.
  const { error: errorVinculo } = await sinTipar
    .from("community_registrations")
    .update({ status: "approved", resource_id: recursoId })
    .eq("id", registroId)
    .eq("tenant_id", tenantId);

  if (errorVinculo) {
    console.warn("[admin/registros] vínculo con la ficha falló, se revierte", {
      code: errorVinculo.code,
    });
    await sinTipar.from("community_resources").delete().eq("id", recursoId);
    return { status: "error", message: COPY.genericError };
  }

  await logAdminAction({
    actorId: user.id,
    action: "community_registration.publish_place",
    tenantId,
    subjectKind: "community_registration",
    subjectId: registroId,
    // El id de la ficha y el tema: reconstruye la decisión sin copiar el
    // teléfono ni la dirección, que ya viven en la ficha publicada.
    meta: { recursoId, topic: ficha.topic },
  });

  revalidatePath(RUTA);
  revalidatePath("/admin/comunidad/recursos");
  revalidatePath("/comunidad/recursos");
  return { status: "success", message: COPY.publicado };
}
