"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { supabaseSinTiparGrupos } from "@/lib/messaging/grupos";
import {
  MAX_REACTION_KIND_LEN,
  SUBJECT_KIND_POR_AMBITO,
  TABLA_POR_AMBITO,
} from "@/lib/messaging/reacciones";
import { reportScamAction } from "./actions";
import {
  borrarMensajeDeGrupoAction,
  reportarMensajeDeGrupoAction,
} from "./grupos/actions";

/**
 * =============================================================================
 * QUÉ SE PUEDE HACER CON UN MENSAJE YA ENVIADO (0136 + 0138)
 * =============================================================================
 *
 * Reaccionar, corregir, bajar y reportar — para el chat de dos y para el de
 * grupo, con el MISMO contrato. La pantalla de chat es una sola: si cada ámbito
 * tuviera su action con su forma, cada componente tendría que saber en cuál de
 * los dos está parado.
 *
 * ─── LA RLS SIGUE SIENDO LA FRONTERA ────────────────────────────────────────
 * Todo pasa por el cliente del usuario (anon key + cookies). Acá no hay ni un
 * chequeo de permisos que la base no vuelva a hacer: quién puede corregir un
 * mensaje lo decide `app.proteger_columnas_del_mensaje_*` (0136 §5), quién
 * puede bajarlo la policy de `messages` / `chat_group_messages`, y quién puede
 * reaccionar `reactions_insert` (0138 §2). Los `if` de este archivo existen
 * para dar un mensaje que se entienda, no para autorizar. Si mañana se borra
 * uno, la operación falla igual — con un error más feo, no con una puerta
 * abierta.
 *
 * `tenant_id` sale SIEMPRE del guard del servidor, nunca de un parámetro.
 */

export type AccionDeMensajeResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "unauthenticated"
        | "tenant-mismatch"
        | "invalid"
        | "rate-limited"
        | "flagged"
        /** No soy el autor: la base lo rechazó, la pantalla no lo ofrecía. */
        | "not-author"
        /** Pasaron los 15 minutos de la 0136. Reintentar no lo destraba. */
        | "edit-window-closed"
        /** El mensaje ya estaba bajado cuando llegó la orden. */
        | "deleted"
        /** La policy no devolvió filas: no puedo tocar este mensaje. */
        | "forbidden"
        | "error";
    };

const ambitoSchema = z.enum(["directo", "grupo"]);

/**
 * Traduce el "no" de los triggers de la 0136 por TOKEN de prefijo
 * (`EDIT_WINDOW_CLOSED: …`), nunca por string-match del texto en español: el
 * mensaje del trigger se puede reescribir sin avisar, el token no.
 * Mismo criterio que `errorDelRpc` en direct-actions.ts.
 */
function codigoDelTrigger(message: string | undefined): AccionDeMensajeResult {
  const token = message?.match(/^\s*([A-Z_]+)\s*:/)?.[1] ?? "";
  switch (token) {
    case "EDIT_WINDOW_CLOSED":
      return { ok: false, code: "edit-window-closed" };
    case "NOT_MESSAGE_AUTHOR":
      return { ok: false, code: "not-author" };
    case "MESSAGE_DELETED":
      return { ok: false, code: "deleted" };
    default:
      return { ok: false, code: "error" };
  }
}

function rutaDelHilo(ambito: "directo" | "grupo", hiloId: string): string {
  return ambito === "grupo" ? `/mensajes/grupos/${hiloId}` : `/mensajes/${hiloId}`;
}

/**
 * Las actions de las que ésta se apoya devuelven su propio catálogo de códigos
 * (`GrupoActionResult`, `ActionResult`). Se traducen a UNO para que la pantalla
 * de chat no tenga que saber por cuál de las dos puertas entró: un `switch`
 * exhaustivo por ámbito en cada componente es exactamente lo que este archivo
 * existe para evitar.
 */
function traducirResultadoDeGrupo(
  resultado: { ok: true } | { ok: false; code: string },
): AccionDeMensajeResult {
  if (resultado.ok) return { ok: true };
  switch (resultado.code) {
    case "unauthenticated":
      return { ok: false, code: "unauthenticated" };
    case "tenant-mismatch":
      return { ok: false, code: "tenant-mismatch" };
    case "invalid":
      return { ok: false, code: "invalid" };
    case "rate-limited":
      return { ok: false, code: "rate-limited" };
    case "flagged":
      return { ok: false, code: "flagged" };
    case "forbidden":
    case "banned":
      return { ok: false, code: "forbidden" };
    default:
      return { ok: false, code: "error" };
  }
}

// ---------------------------------------------------------------------------
// Reaccionar
// ---------------------------------------------------------------------------

const reaccionSchema = z.object({
  ambito: ambitoSchema,
  mensajeId: z.uuid(),
  hiloId: z.uuid(),
  /**
   * `null` = sacar la mía. Un string = dejar ESTA y ninguna otra.
   *
   * El tope de 64 espeja `reactions_kind_check` (0138 §1). No se valida que un
   * `:slug:` exista en `community_emojis`, y es la misma decisión que tomó la
   * migración: quien pinta ya deja como texto el slug que no resuelve, y un
   * chequeo acá sería una consulta extra en un camino caliente.
   */
  kind: z
    .string()
    .transform((valor) => valor.trim())
    .pipe(z.string().min(1).max(MAX_REACTION_KIND_LEN))
    .nullable(),
});

/**
 * DEJA MI REACCIÓN EN EL ESTADO QUE PIDE LA PANTALLA.
 *
 * No es un toggle del lado del servidor: el cliente manda el estado FINAL que
 * quiere (`kind` o `null`) y acá se lo hace cumplir. Con un toggle, dos toques
 * rápidos —o la misma cuenta en dos pestañas— dejan el resultado al azar del
 * orden de llegada.
 *
 * ─── POR QUÉ BORRAR Y VOLVER A INSERTAR, Y NO UN UPSERT ─────────────────────
 * `reactions_update` está en `using(false) with check(false)` desde la 0007
 * («Una reacción no se edita: se quita y se pone»). Un `.upsert()` de PostgREST
 * es `insert … on conflict do update`, o sea que pide UPDATE: contra esa policy
 * falla siempre. El DELETE previo además es lo que hace cumplir "una sola
 * reacción por persona" cuando se CAMBIA de emoji.
 */
export async function reaccionarAMensajeAction(input: {
  ambito: "directo" | "grupo";
  mensajeId: string;
  hiloId: string;
  kind: string | null;
}): Promise<AccionDeMensajeResult> {
  const parsed = reaccionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const { ambito, mensajeId, kind } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") return { ok: false, code: "tenant-mismatch" };
    return { ok: false, code: "error" };
  }
  const { tenant, supabase, user } = guard;

  /**
   * Techo propio y generoso: reaccionar es barato y se hace de a muchos
   * mientras se lee un hilo hacia arriba. Lo que ataja son las 5.000 filas por
   * minuto de un script, no a alguien poniéndole corazón a diez mensajes.
   */
  if (!limit(`reaccion-mensaje:${user.id}`, 150, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  const cliente = supabaseSinTiparGrupos(supabase);
  const subjectKind = SUBJECT_KIND_POR_AMBITO[ambito];

  const { error: errorAlBorrar } = await cliente
    .from("reactions")
    .delete()
    .eq("subject_kind", subjectKind)
    .eq("subject_id", mensajeId)
    .eq("profile_id", user.id);

  if (errorAlBorrar) {
    console.warn("[mensajes] no se pudo sacar la reacción", { code: errorAlBorrar.code });
    return { ok: false, code: "error" };
  }

  if (kind === null) return { ok: true };

  const { error } = await cliente.from("reactions").insert({
    tenant_id: tenant.id,
    subject_kind: subjectKind,
    subject_id: mensajeId,
    profile_id: user.id,
    kind,
    // `entity_listing_id` NO se manda: la 0138 §2 prohíbe reaccionar con la
    // cara de un negocio adentro de un chat. Ni siquiera se ofrece.
  });

  if (error) {
    // 23505 = otra pestaña ganó la carrera y ya hay una reacción mía. El estado
    // que la persona quería —"tengo una reacción puesta"— es el que quedó.
    if (error.code === "23505") return { ok: true };
    // 42501 = la policy no me deja: el mensaje no es de un chat que yo vea.
    if (error.code === "42501") return { ok: false, code: "forbidden" };
    console.warn("[mensajes] no se pudo guardar la reacción", { code: error.code });
    return { ok: false, code: "error" };
  }

  /**
   * SIN `revalidatePath` A PROPÓSITO.
   *
   * La pastilla ya se pintó de forma optimista y el hilo se refresca solo
   * (`ThreadRefresh` / `GroupLive`). Revalidar acá volvería a renderizar la
   * conversación entera en cada toque de emoji — el costo de un hilo completo
   * para mover un número de 2 a 3, en la pantalla por la que ya hay un reclamo
   * de lentitud. Editar y eliminar SÍ revalidan: ahí cambia el contenido.
   */
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Corregir
// ---------------------------------------------------------------------------

const edicionSchema = z.object({
  ambito: ambitoSchema,
  mensajeId: z.uuid(),
  hiloId: z.uuid(),
  body: z
    .string()
    .transform((valor) => valor.trim())
    .pipe(z.string().min(1).max(2000)),
});

/**
 * CORREGIR UN DEDAZO. La ventana de 15 minutos y la marca `editado_at` las pone
 * la BASE, no este archivo (0136 §5): un reloj de navegador se cambia desde
 * Configuración, y `editado_at` escrito por el cliente permitiría marcar como
 * editado algo que nunca cambió — o dejar sin marca una corrección real.
 */
export async function editarMensajeAction(input: {
  ambito: "directo" | "grupo";
  mensajeId: string;
  hiloId: string;
  body: string;
}): Promise<AccionDeMensajeResult> {
  const parsed = edicionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const { ambito, mensajeId, hiloId, body } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") return { ok: false, code: "tenant-mismatch" };
    return { ok: false, code: "error" };
  }
  const { supabase, user } = guard;

  if (!limit(`editar-mensaje:${user.id}`, 60, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  // El texto corregido lo va a leer otra persona: pasa por la misma moderación
  // que pasó al enviarse. Sin esto, editar sería la puerta de atrás del filtro.
  const moderacion = await moderateText(body);
  if (moderacion.flagged) return { ok: false, code: "flagged" };

  const { error, count } = await supabaseSinTiparGrupos(supabase)
    .from(TABLA_POR_AMBITO[ambito])
    .update({ body }, { count: "exact" })
    .eq("id", mensajeId);

  if (error) {
    console.warn("[mensajes] no se pudo corregir el mensaje", { code: error.code });
    return codigoDelTrigger(error.message);
  }
  // Cero filas y sin error = la policy no me dejó ver la fila para tocarla.
  if (count === 0) return { ok: false, code: "forbidden" };

  revalidatePath(rutaDelHilo(ambito, hiloId));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Bajar
// ---------------------------------------------------------------------------

const bajarSchema = z.object({
  ambito: ambitoSchema,
  mensajeId: z.uuid(),
  hiloId: z.uuid(),
});

/**
 * BAJAR UN MENSAJE. Es para siempre: el trigger de la 0136 conserva
 * `deleted_at` una vez puesto, así que nadie puede devolverlo a la vista
 * después de que la otra persona creyó que no estaba.
 *
 * En GRUPOS delega en `borrarMensajeDeGrupoAction`, que ya existe y ya está
 * testeada. Copiar sus diez líneas acá sería tener dos verdades sobre quién
 * puede moderar un grupo; la que importa es la de allá.
 */
export async function eliminarMensajeAction(input: {
  ambito: "directo" | "grupo";
  mensajeId: string;
  hiloId: string;
}): Promise<AccionDeMensajeResult> {
  const parsed = bajarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const { ambito, mensajeId, hiloId } = parsed.data;

  if (ambito === "grupo") {
    return traducirResultadoDeGrupo(
      await borrarMensajeDeGrupoAction({ groupId: hiloId, messageId: mensajeId }),
    );
  }

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") return { ok: false, code: "tenant-mismatch" };
    return { ok: false, code: "error" };
  }
  const { supabase, user } = guard;

  if (!limit(`borrar-mensaje:${user.id}`, 60, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  const { error, count } = await supabaseSinTiparGrupos(supabase)
    .from("messages")
    .update({ deleted_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", mensajeId);

  if (error) {
    console.warn("[mensajes] no se pudo eliminar el mensaje", { code: error.code });
    return codigoDelTrigger(error.message);
  }
  /**
   * `messages_update` (0136 §6.2) exige `sender_id = auth.uid()` y NO tiene
   * rama de moderación: en un chat de dos, el contenido no lo toca nadie más
   * que su autor. Cero filas acá es exactamente eso.
   */
  if (count === 0) return { ok: false, code: "forbidden" };

  revalidatePath(rutaDelHilo("directo", hiloId));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reportar
// ---------------------------------------------------------------------------

const reporteSchema = z.object({
  ambito: ambitoSchema,
  mensajeId: z.uuid(),
  reason: z.string().min(1).max(80),
  details: z
    .string()
    .transform((valor) => valor.trim())
    .pipe(z.string().max(1000))
    .optional(),
});

/**
 * REPORTAR, con el catálogo de motivos de siempre y el mismo cupo diario.
 *
 * Las dos ramas son actions que ya existen y ya están testeadas —`report_scam`
 * para el chat de dos, `reportar_mensaje_de_grupo` para los grupos— y las dos
 * consumen la MISMA key `reporte:` del rate limit: el presupuesto de denuncias
 * es de la persona, no de la pantalla desde la que reporta.
 */
export async function reportarMensajeAction(input: {
  ambito: "directo" | "grupo";
  mensajeId: string;
  reason: string;
  details?: string;
}): Promise<AccionDeMensajeResult> {
  const parsed = reporteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const { ambito, mensajeId, reason, details } = parsed.data;

  return traducirResultadoDeGrupo(
    ambito === "grupo"
      ? await reportarMensajeDeGrupoAction({ messageId: mensajeId, reason, details })
      : await reportScamAction({
          targetKind: "message",
          targetId: mensajeId,
          reason,
          details,
        }),
  );
}
