"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DAY_MS, HOUR_MS, limit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/notify";
import {
  CATEGORIAS_DE_GRUPO,
  LIMITES,
  VISIBILIDADES,
  supabaseSinTiparGrupos,
} from "@/lib/messaging/grupos";

/**
 * =============================================================================
 * SERVER ACTIONS DE GRUPOS DE CHAT (0133)
 * =============================================================================
 *
 * Regla de este archivo, la misma que la del resto del módulo: **la RLS es la
 * frontera real**. Todo pasa por el cliente del usuario (anon key + cookies).
 * Acá no hay ni un chequeo de permisos que la base no vuelva a hacer: los
 * `if` que se ven existen para dar un mensaje que se entienda, no para
 * autorizar. Si mañana se borra uno, la operación falla igual — con un error
 * más feo, no con una puerta abierta.
 *
 * El admin client aparece SOLO para emitir notificaciones (`notifications`
 * tiene `insert with check (false)` para JWT de usuario: únicamente el sistema
 * notifica), que es el uso permitido por §6 del contrato.
 */

export type GrupoActionResult =
  | { ok: true; groupId?: string }
  | {
      ok: false;
      code:
        | "unauthenticated"
        | "tenant-mismatch"
        | "invalid"
        | "duplicate"
        | "flagged"
        | "rate-limited"
        | "forbidden"
        | "error";
      /** Copy ya listo para pantalla cuando el caso lo necesita. */
      message?: string;
    };

const uuid = z.uuid();

const fichaSchema = z.object({
  name: z
    .string()
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(LIMITES.nombreMin).max(LIMITES.nombreMax)),
  description: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().max(LIMITES.descripcionMax))
    .optional()
    .transform((v) => (v ? v : null)),
  category: z.enum(CATEGORIAS_DE_GRUPO),
  visibility: z.enum(VISIBILIDADES),
  /**
   * URL pública del bucket `avatars`. Se valida que sea una URL http(s) y nada
   * más: la ruta la entregó `prepareAvatarUploadAction` con el prefijo del
   * propio usuario y la policy `avatars_insert` (0012) ya la verificó contra el
   * JWT en el momento de subir. Un `avatar_url` apuntando a otro lado sería,
   * como mucho, una imagen rota en la tarjeta del grupo.
   */
  avatarUrl: z.url().max(500).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Foto del grupo
// ---------------------------------------------------------------------------

/**
 * Prefijo donde el navegador puede subir la foto del grupo.
 *
 * La foto va al bucket `avatars` bajo `{tenant_id}/{user_id}/…`, que es la ruta
 * canónica de la 0012 y la única que la policy `avatars_insert` acepta para
 * este JWT. O sea: el servidor entrega el prefijo y la BASE lo vuelve a
 * verificar — el cliente nunca elige dónde escribe.
 *
 * Es un gemelo de `prepareAvatarUploadAction` (perfil) y no un import de allá a
 * propósito: son diez líneas y son de otro módulo, así que compartirlas ataría
 * la pantalla de grupos a los cambios de la de perfil sin ganar nada.
 */
export async function prepararFotoDeGrupoAction(): Promise<
  { ok: true; tenantId: string; userId: string } | { ok: false }
> {
  const guard = await requireTenantMatch();
  if (!guard.ok) return { ok: false };
  return { ok: true, tenantId: guard.tenant.id, userId: guard.user.id };
}

// ---------------------------------------------------------------------------
// Crear
// ---------------------------------------------------------------------------
export async function crearGrupoAction(input: {
  name: string;
  description?: string;
  category: string;
  visibility: string;
  avatarUrl?: string | null;
}): Promise<GrupoActionResult> {
  const parsed = fichaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      ok: false,
      code: guard.reason === "unauthenticated" ? "unauthenticated" : "error",
    };
  }
  const { tenant, supabase, user } = guard;

  // Techo de altas. Un grupo es una entidad que aparece en el descubrimiento
  // de toda la comunidad: sin tope, una cuenta sola llena la pantalla de
  // "Para sumarte" con basura en dos minutos.
  if (!limit(`grupo-alta:${user.id}`, 5, DAY_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  // El nombre y la descripción se leen en el descubrimiento SIN que nadie haya
  // entrado al grupo: son contenido público de la comunidad y pasan por la
  // misma moderación que un mensaje. Degradación elegante §5.6: sin
  // OPENAI_API_KEY, `moderateText` devuelve `skipped` y se crea igual.
  const moderacion = await moderateText(
    `${parsed.data.name}\n${parsed.data.description ?? ""}`,
  );
  if (moderacion.flagged) return { ok: false, code: "flagged" };

  const { data, error } = await supabaseSinTiparGrupos(supabase)
    .from("chat_groups")
    .insert({
      tenant_id: tenant.id,
      created_by: user.id,
      name: parsed.data.name,
      description: parsed.data.description,
      category: parsed.data.category,
      visibility: parsed.data.visibility,
      avatar_url: parsed.data.avatarUrl ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 = el único de (tenant, nombre) para grupos activos. Es un caso
    // esperable y tiene copy propio: "ya hay un grupo con ese nombre".
    if (error.code === "23505") return { ok: false, code: "duplicate" };
    console.warn("[grupos] no se pudo crear el grupo", { code: error.code });
    return { ok: false, code: "error" };
  }

  const groupId = (data as { id: string } | null)?.id;
  if (!groupId) return { ok: false, code: "error" };

  revalidatePath("/mensajes/grupos");
  return { ok: true, groupId };
}

// ---------------------------------------------------------------------------
// Editar la ficha / cerrar
// ---------------------------------------------------------------------------
export async function editarGrupoAction(input: {
  groupId: string;
  name: string;
  description?: string;
  category: string;
  visibility: string;
  avatarUrl?: string | null;
}): Promise<GrupoActionResult> {
  const id = uuid.safeParse(input.groupId);
  const ficha = fichaSchema.safeParse(input);
  if (!id.success || !ficha.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      ok: false,
      code: guard.reason === "unauthenticated" ? "unauthenticated" : "error",
    };
  }

  const moderacion = await moderateText(
    `${ficha.data.name}\n${ficha.data.description ?? ""}`,
  );
  if (moderacion.flagged) return { ok: false, code: "flagged" };

  // Quién puede editar lo decide `chat_groups_update` (owner/admin). Si no lo
  // soy, el UPDATE no toca ninguna fila y `count` vuelve en 0.
  const { error, count } = await supabaseSinTiparGrupos(guard.supabase)
    .from("chat_groups")
    .update(
      {
        name: ficha.data.name,
        description: ficha.data.description,
        category: ficha.data.category,
        visibility: ficha.data.visibility,
        avatar_url: ficha.data.avatarUrl ?? null,
      },
      { count: "exact" },
    )
    .eq("id", id.data);

  if (error) {
    if (error.code === "23505") return { ok: false, code: "duplicate" };
    console.warn("[grupos] no se pudo editar el grupo", { code: error.code });
    return { ok: false, code: "error" };
  }
  if (count === 0) return { ok: false, code: "forbidden" };

  revalidatePath(`/mensajes/grupos/${id.data}`);
  revalidatePath(`/mensajes/grupos/${id.data}/info`);
  revalidatePath("/mensajes/grupos");
  return { ok: true, groupId: id.data };
}

export async function cerrarGrupoAction(groupId: string): Promise<GrupoActionResult> {
  const id = uuid.safeParse(groupId);
  if (!id.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      ok: false,
      code: guard.reason === "unauthenticated" ? "unauthenticated" : "error",
    };
  }

  const { error, count } = await supabaseSinTiparGrupos(guard.supabase)
    .from("chat_groups")
    .update({ status: "closed" }, { count: "exact" })
    .eq("id", id.data);

  if (error) {
    console.warn("[grupos] no se pudo cerrar el grupo", { code: error.code });
    return { ok: false, code: "error" };
  }
  if (count === 0) return { ok: false, code: "forbidden" };

  revalidatePath(`/mensajes/grupos/${id.data}`);
  revalidatePath("/mensajes/grupos");
  return { ok: true, groupId: id.data };
}

// ---------------------------------------------------------------------------
// Membresía
// ---------------------------------------------------------------------------

/**
 * Unirse a un grupo PÚBLICO. Que sea público, esté activo y sea de mi
 * comunidad lo verifica `chat_group_members_insert` (0133) — acá sólo se
 * traduce el resultado. `on conflict do nothing` no existe en PostgREST: si ya
 * soy miembro vuelve un 23505, que se contesta como éxito porque el resultado
 * que la persona quería (estar adentro) ya es cierto.
 */
export async function unirmeAlGrupoAction(groupId: string): Promise<GrupoActionResult> {
  const id = uuid.safeParse(groupId);
  if (!id.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      ok: false,
      code: guard.reason === "unauthenticated" ? "unauthenticated" : "error",
    };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`grupo-union:${user.id}`, 30, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  const { error } = await supabaseSinTiparGrupos(supabase)
    .from("chat_group_members")
    .insert({
      group_id: id.data,
      profile_id: user.id,
      tenant_id: tenant.id,
      role: "member",
    });

  if (error && error.code !== "23505") {
    console.warn("[grupos] no se pudo unir al grupo", { code: error.code });
    // 42501 = la policy dijo que no (privado, cerrado, u otra comunidad).
    return { ok: false, code: error.code === "42501" ? "forbidden" : "error" };
  }

  revalidatePath("/mensajes/grupos");
  revalidatePath(`/mensajes/grupos/${id.data}`);
  return { ok: true, groupId: id.data };
}

export async function salirDelGrupoAction(groupId: string): Promise<GrupoActionResult> {
  const id = uuid.safeParse(groupId);
  if (!id.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      ok: false,
      code: guard.reason === "unauthenticated" ? "unauthenticated" : "error",
    };
  }

  const { error, count } = await supabaseSinTiparGrupos(guard.supabase)
    .from("chat_group_members")
    .delete({ count: "exact" })
    .eq("group_id", id.data)
    .eq("profile_id", guard.user.id);

  if (error) {
    console.warn("[grupos] no se pudo salir del grupo", { code: error.code });
    return { ok: false, code: "error" };
  }
  // 0 filas = soy el owner, a quien la policy no le deja salir (0133). Es el
  // único caso posible acá, y tiene copy propio.
  if (count === 0) return { ok: false, code: "forbidden" };

  revalidatePath("/mensajes/grupos");
  return { ok: true };
}

export async function invitarAlGrupoAction(input: {
  groupId: string;
  profileId: string;
}): Promise<GrupoActionResult> {
  const id = uuid.safeParse(input.groupId);
  const perfil = uuid.safeParse(input.profileId);
  if (!id.success || !perfil.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      ok: false,
      code: guard.reason === "unauthenticated" ? "unauthenticated" : "error",
    };
  }
  const { tenant, supabase, user } = guard;

  // Invitar mete a alguien en una conversación sin pedirle permiso: es la
  // operación más fácil de convertir en spam de todo el módulo.
  if (!limit(`grupo-invita:${user.id}`, 40, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  const { error } = await supabaseSinTiparGrupos(supabase)
    .from("chat_group_members")
    .insert({
      group_id: id.data,
      profile_id: perfil.data,
      tenant_id: tenant.id,
      role: "member",
    });

  if (error) {
    if (error.code === "23505") return { ok: false, code: "duplicate" };
    console.warn("[grupos] no se pudo invitar", { code: error.code });
    // La policy rechaza también si hay bloqueo entre los dos (§4 de la 0133).
    return { ok: false, code: error.code === "42501" ? "forbidden" : "error" };
  }

  // Avisar a quien fue sumado. Sin esto, alguien aparece adentro de un grupo y
  // se entera la próxima vez que abre Mensajes de casualidad.
  try {
    const { data: grupo } = await supabaseSinTiparGrupos(supabase)
      .from("chat_groups")
      .select("name")
      .eq("id", id.data)
      .maybeSingle();
    const nombre = (grupo as { name: string } | null)?.name;
    await createNotification(createAdminClient(), {
      tenantId: tenant.id,
      profileId: perfil.data,
      kind: "group_message",
      category: "mensajes",
      title: nombre ? `Te sumaron a “${nombre}”` : "Te sumaron a un grupo",
      body: "Entrá para ver de qué se trata.",
      href: `/mensajes/grupos/${id.data}`,
      dedupeUnread: true,
    });
  } catch (notifyError) {
    // La invitación YA se hizo: un aviso que falla no cambia el resultado.
    console.warn("[grupos] no se pudo avisar de la invitación", {
      message: notifyError instanceof Error ? notifyError.message : "error desconocido",
    });
  }

  revalidatePath(`/mensajes/grupos/${id.data}/info`);
  return { ok: true, groupId: id.data };
}

export async function expulsarDelGrupoAction(input: {
  groupId: string;
  profileId: string;
}): Promise<GrupoActionResult> {
  const id = uuid.safeParse(input.groupId);
  const perfil = uuid.safeParse(input.profileId);
  if (!id.success || !perfil.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      ok: false,
      code: guard.reason === "unauthenticated" ? "unauthenticated" : "error",
    };
  }

  const { error, count } = await supabaseSinTiparGrupos(guard.supabase)
    .from("chat_group_members")
    .delete({ count: "exact" })
    .eq("group_id", id.data)
    .eq("profile_id", perfil.data);

  if (error) {
    console.warn("[grupos] no se pudo expulsar", { code: error.code });
    return { ok: false, code: "error" };
  }
  if (count === 0) return { ok: false, code: "forbidden" };

  revalidatePath(`/mensajes/grupos/${id.data}/info`);
  return { ok: true, groupId: id.data };
}

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------
const mensajeSchema = z.object({
  groupId: z.uuid(),
  body: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1).max(LIMITES.mensajeMax)),
});

export async function enviarMensajeAlGrupoAction(input: {
  groupId: string;
  body: string;
}): Promise<GrupoActionResult> {
  const parsed = mensajeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      ok: false,
      code: guard.reason === "unauthenticated" ? "unauthenticated" : "error",
    };
  }
  const { tenant, supabase, user } = guard;

  /**
   * EL MISMO BUCKET que los mensajes directos (`mensaje:<uid>`), a propósito.
   * Si fueran dos, el techo real sería el doble: la persona podría gastar 120
   * mensajes en el chat 1-a-1 y otros 120 en grupos, y cada uno cuesta una
   * llamada de moderación y dispara avisos. El presupuesto es de la persona,
   * no de la pantalla.
   */
  if (!limit(`mensaje:${user.id}`, 120, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  const moderacion = await moderateText(parsed.data.body);
  if (moderacion.flagged) return { ok: false, code: "flagged" };

  const sinTipar = supabaseSinTiparGrupos(supabase);
  const { error } = await sinTipar.from("chat_group_messages").insert({
    tenant_id: tenant.id,
    group_id: parsed.data.groupId,
    sender_id: user.id,
    body: parsed.data.body,
  });

  if (error) {
    console.warn("[grupos] no se pudo enviar el mensaje", { code: error.code });
    // 42501 = no soy miembro o el grupo está cerrado.
    return { ok: false, code: error.code === "42501" ? "forbidden" : "error" };
  }

  await avisarAlGrupo({
    sinTipar,
    tenantId: tenant.id,
    groupId: parsed.data.groupId,
    autorId: user.id,
  });

  revalidatePath(`/mensajes/grupos/${parsed.data.groupId}`);
  return { ok: true, groupId: parsed.data.groupId };
}

/**
 * AVISO DE MENSAJE NUEVO, SIN CONVERTIRLO EN UNA LLUVIA.
 *
 * Un grupo activo puede tener cien mensajes en una tarde. Tres decisiones
 * hacen que eso siga siendo UN aviso por persona:
 *
 *   · `dedupeUnread` con el href del grupo — mientras tenga una sin leer de
 *     ESTE grupo, no se apila otra. Es el mismo mecanismo que ya usa el chat
 *     1-a-1 (`sendMessageAction`).
 *   · SIN EMAIL. En un directo el mail tiene sentido (te escribieron a vos);
 *     en un grupo de treinta sería una campaña de correo por cada charla, con
 *     nuestro remitente. El aviso in-app alcanza.
 *   · Tope de 50 destinatarios. Un grupo más grande que eso necesita un job en
 *     background, no una server action que la persona espera con el dedo en la
 *     pantalla; hasta que exista, se avisa a los primeros 50 (por antigüedad)
 *     y el resto ve el mensaje al entrar. Preferimos un aviso de menos antes
 *     que un envío que tarda diez segundos.
 *
 * Best-effort de punta a punta: el mensaje YA se entregó, así que nada de acá
 * abajo puede cambiar el resultado de la acción.
 */
async function avisarAlGrupo(params: {
  sinTipar: ReturnType<typeof supabaseSinTiparGrupos>;
  tenantId: string;
  groupId: string;
  autorId: string;
}): Promise<void> {
  try {
    const [{ data: grupo }, { data: miembros }, { data: autor }] = await Promise.all([
      params.sinTipar
        .from("chat_groups")
        .select("name")
        .eq("id", params.groupId)
        .maybeSingle(),
      params.sinTipar
        .from("chat_group_members")
        .select("profile_id")
        .eq("group_id", params.groupId)
        .order("joined_at", { ascending: true })
        .limit(50),
      params.sinTipar
        .from("profiles")
        .select("display_name")
        .eq("id", params.autorId)
        .maybeSingle(),
    ]);

    const nombreGrupo = (grupo as { name: string } | null)?.name ?? "un grupo";
    const nombreAutor =
      (autor as { display_name: string | null } | null)?.display_name ?? "Alguien";
    const destinatarios = ((miembros ?? []) as { profile_id: string }[])
      .map((m) => m.profile_id)
      .filter((id) => id !== params.autorId);

    if (destinatarios.length === 0) return;

    const admin = createAdminClient();
    await Promise.all(
      destinatarios.map((profileId) =>
        createNotification(admin, {
          tenantId: params.tenantId,
          profileId,
          kind: "group_message",
          category: "mensajes",
          title: `${nombreAutor} escribió en “${nombreGrupo}”`,
          // PRIVACIDAD: el cuerpo NUNCA lleva el texto del mensaje — la bandeja
          // se lee de costado en pantallas compartidas. Mismo criterio que el
          // chat 1-a-1.
          body: "Abrí el grupo para leerlo.",
          href: `/mensajes/grupos/${params.groupId}`,
          dedupeUnread: true,
        }),
      ),
    );
  } catch (error) {
    console.warn("[grupos] no se pudo avisar al grupo", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
  }
}

/** Borrado suave: lo puede hacer su autor o quien administra (policy 0133). */
export async function borrarMensajeDeGrupoAction(input: {
  groupId: string;
  messageId: string;
}): Promise<GrupoActionResult> {
  const grupo = uuid.safeParse(input.groupId);
  const mensaje = uuid.safeParse(input.messageId);
  if (!grupo.success || !mensaje.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      ok: false,
      code: guard.reason === "unauthenticated" ? "unauthenticated" : "error",
    };
  }

  const { error, count } = await supabaseSinTiparGrupos(guard.supabase)
    .from("chat_group_messages")
    .update({ deleted_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", mensaje.data);

  if (error) {
    console.warn("[grupos] no se pudo borrar el mensaje", { code: error.code });
    return { ok: false, code: "error" };
  }
  if (count === 0) return { ok: false, code: "forbidden" };

  revalidatePath(`/mensajes/grupos/${grupo.data}`);
  return { ok: true, groupId: grupo.data };
}

const reporteSchema = z.object({
  messageId: z.uuid(),
  reason: z.string().min(1).max(80),
  details: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().max(1000))
    .optional(),
});

export async function reportarMensajeDeGrupoAction(input: {
  messageId: string;
  reason: string;
  details?: string;
}): Promise<GrupoActionResult> {
  const parsed = reporteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      ok: false,
      code: guard.reason === "unauthenticated" ? "unauthenticated" : "error",
    };
  }

  // MISMA key `reporte:` que el resto de las superficies: el presupuesto de 10
  // por día es de la persona, no de la pantalla desde la que reporta. (La base
  // vuelve a exigir el cupo en app.exigir_cupo_de_denuncias — esto es sólo
  // para dar el mensaje antes de ir hasta allá.)
  if (!limit(`reporte:${guard.user.id}`, 10, DAY_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  const { error } = await supabaseSinTiparGrupos(guard.supabase).rpc(
    "reportar_mensaje_de_grupo",
    {
      p_message_id: parsed.data.messageId,
      p_reason: parsed.data.reason,
      ...(parsed.data.details ? { p_details: parsed.data.details } : {}),
    },
  );

  if (error) {
    console.warn("[grupos] no se pudo reportar el mensaje", { code: error.code });
    return { ok: false, code: "error" };
  }

  return { ok: true };
}
