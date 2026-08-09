"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStaffContext, logAdminAction } from "../../guard";
import { canWriteTenant } from "../../scope";
import { ASSIGNABLE_ROLES } from "./staff-roles";

/**
 * Asignar y quitar roles de staff DESPUÉS del alta de la comunidad.
 *
 * POR QUÉ ESTO NECESITA EL ADMIN CLIENT (y no es una excepción cómoda)
 * -------------------------------------------------------------------
 * El rol que gobierna todo — el panel, y sobre todo las policies de RLS — es
 * `app_metadata.role` del JWT. Ese claim lo firma Supabase Auth y sólo se
 * escribe con la service role key: no hay policy que lo habilite, porque si la
 * hubiera cualquiera con una sesión podría intentar reescribir su propio rol.
 * `profiles.role` es la copia INFORMATIVA (la que se puede listar sin
 * privilegios) y tiene un trigger, `app.protect_profile_columns`, que rechaza
 * cualquier UPDATE que la toque si no viene de service_role.
 *
 * O sea: las dos escrituras son privilegiadas por diseño. El gate es el rol del
 * actor, verificado con `getUser()` contra Supabase Auth ANTES de instanciar el
 * admin client, más `canWriteTenant()`. Nunca al revés.
 *
 * ORDEN DE ESCRITURA. Primero el claim del JWT (el que manda), después la copia
 * en `profiles`. Si la segunda falla, el permiso YA rige y la lista de la
 * pantalla queda desfasada — molesto pero honesto. Al revés, la lista diría
 * "administra la comunidad" sobre alguien que no puede entrar al panel, que es
 * la mentira peor.
 */

const COPY = {
  notAllowed: "Esta acción es solo para el súper admin de la plataforma.",
  invalid: "No pudimos leer los datos — recargá la página e intentá de nuevo.",
  notFound: "Esa persona ya no está en esta comunidad — la lista se actualizó.",
  otherTenant: "Esa persona es de otra comunidad. Elegí a alguien de la que estás mirando.",
  self: "No podés cambiar tus propios permisos desde acá.",
  superAdmin:
    "Esa cuenta es del equipo de la plataforma. Sus permisos no se tocan desde esta pantalla.",
  authUnavailable:
    "No pudimos actualizar los permisos de la sesión. No quedó a medias: no se cambió nada.",
  genericError: "No pudimos guardar el cambio — no es tu culpa. Probá de nuevo en un momento.",
  granted: (name: string, role: string) =>
    role === "domain_admin"
      ? `Listo, ${name} ya administra esta comunidad. Va a ver el panel la próxima vez que entre.`
      : `Listo, ${name} ya puede moderar esta comunidad. Va a ver el panel la próxima vez que entre.`,
  revoked: (name: string) => `${name} vuelve a ser miembro. Ya no entra al panel.`,
} as const;

export type StaffActionState =
  | { status: "idle" }
  | { status: "invalid" | "error"; message: string }
  | { status: "success"; message: string };

const assignSchema = z.object({
  profileId: z.uuid(),
  tenantId: z.uuid(),
  role: z.enum(ASSIGNABLE_ROLES),
});

export async function assignStaffRole(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const parsed = assignSchema.safeParse({
    profileId: formData.get("profileId"),
    tenantId: formData.get("tenantId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { status: "invalid", message: COPY.invalid };
  const input = parsed.data;

  const ctx = await getStaffContext("global_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  if (!canWriteTenant(ctx, input.tenantId)) {
    return { status: "error", message: COPY.notAllowed };
  }
  const { supabase, user } = ctx;

  // Nadie se edita a sí mismo: sin esto, un súper admin podría degradarse por
  // accidente y dejar la plataforma sin quien la gobierne.
  if (input.profileId === user.id) return { status: "error", message: COPY.self };

  /**
   * El tenant del destinatario sale de la BASE, no del formulario. Si viniera
   * del form, un `tenantId` cualquiera junto a un `profileId` de otra comunidad
   * alcanzaría para mover a alguien de tenant por la puerta de atrás — que es
   * exactamente el cambio que `app.protect_profile_columns` existe para
   * impedir. `profiles` es de lectura pública, así que esto no necesita
   * privilegios: se lee con el cliente del propio admin.
   */
  const { data: target, error: readError } = await supabase
    .from("profiles")
    .select("id, tenant_id, display_name, role")
    .eq("id", input.profileId)
    .maybeSingle();

  if (readError) {
    console.error("[admin] no se pudo leer el perfil destino:", readError.message);
    return { status: "error", message: COPY.genericError };
  }
  if (!target) return { status: "error", message: COPY.notFound };
  if (target.tenant_id !== input.tenantId) {
    return { status: "error", message: COPY.otherTenant };
  }
  if (target.role === "global_admin") return { status: "error", message: COPY.superAdmin };

  try {
    const admin = createAdminClient();

    // 1. El claim del JWT — el que gobierna RLS y el panel.
    const { error: authError } = await admin.auth.admin.updateUserById(target.id, {
      app_metadata: { tenant_id: target.tenant_id, role: input.role },
    });
    if (authError) {
      console.error("[admin] no se pudo escribir app_metadata.role:", authError.message);
      return { status: "error", message: COPY.authUnavailable };
    }

    // 2. La copia informativa que esta pantalla lista.
    const { error: profileError } = await admin
      .from("profiles")
      .update({ role: input.role })
      .eq("id", target.id)
      .eq("tenant_id", input.tenantId);

    if (profileError) {
      // El permiso ya rige (paso 1). Se avisa, se audita igual y la lista se
      // repara sola en el próximo cambio — no se revierte el claim, porque
      // revertirlo sería quitarle un permiso que quizás ya está usando.
      console.error(
        "[admin] app_metadata quedó actualizado pero profiles.role no:",
        profileError.message,
      );
    }
  } catch (thrown) {
    console.error(
      "[admin] admin client no disponible para asignar rol:",
      thrown instanceof Error ? thrown.message : "error desconocido",
    );
    return { status: "error", message: COPY.authUnavailable };
  }

  await logAdminAction({
    actorId: user.id,
    action: input.role === "member" ? "staff.revoked" : "staff.granted",
    tenantId: input.tenantId,
    subjectKind: "profile",
    subjectId: target.id,
    meta: { from: target.role, to: input.role },
  });

  revalidatePath("/admin/global/administradores");
  revalidatePath("/admin/miembros");

  return {
    status: "success",
    message:
      input.role === "member"
        ? COPY.revoked(target.display_name)
        : COPY.granted(target.display_name, input.role),
  };
}
