"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { requireTenantMatch } from "@/lib/tenant/guard";
import {
  COMUNIDAD_COPY,
  HELP_AREA_MAX,
  HELP_AREA_MIN,
  HELP_AVAILABILITY_MAX,
  HELP_BODY_MAX,
  HELP_BODY_MIN,
  HELP_DIRECTIONS,
  HELP_LANGUAGES,
  HELP_ORG_MAX,
  HELP_STATUSES,
  HELP_TITLE_MAX,
  HELP_TITLE_MIN,
  HELP_TOPICS,
  isHelpStatus,
  primerDatoDeContacto,
  puedeTransicionar,
  supabaseSinTiparComunidad,
  type HelpStatus,
} from "@/lib/comunidad";

/**
 * =============================================================================
 * SERVER ACTIONS DEL TABLÓN DE AYUDA MUTUA (Comunidad, migración 0120)
 * =============================================================================
 *
 * Dos acciones y nada más: una escribe el aviso y lo manda a revisión, la otra
 * lo mueve de estado. Todo lo demás —quién puede, desde dónde, hacia dónde— lo
 * decide la base (policy + trigger de la 0120), y acá se vuelve a chequear no
 * por desconfianza sino para poder contestar con una frase que se entienda en
 * vez de con un error de Postgres.
 *
 * ── LAS DOS FASES, Y POR QUÉ SIGUEN SIENDO DOS SIN FOTOS DE POR MEDIO ────────
 * Perdido y encontrado hace borrador → subir fotos → cerrar, porque la policy
 * del bucket exige que el aviso exista para poder subirle imágenes. Acá no hay
 * fotos y aun así la fila NACE `draft` y recién después pasa a `pending`. Es
 * deliberado:
 *
 *   · La RLS de INSERT sólo admite `status = 'draft'` (0120). Nada entra
 *     publicado ni pendiente de una: es el candado que hace imposible fabricar
 *     un aviso "ya en cola" saltándose la app.
 *   · Entre el INSERT y el paso a `pending` hay una llamada de red (la
 *     moderación de texto). Si el proceso se cae ahí, lo que queda es un
 *     borrador que sólo ve su autor — no un aviso a medio nacer en la cola de
 *     Geovanny.
 *   · Y da el camino de "corregir": un aviso rechazado vuelve a `draft`, se
 *     edita y se reenvía por esta MISMA función, sin duplicar la fila ni
 *     perder el texto que costó escribir.
 *
 * ── NADA SE PUBLICA SOLO ────────────────────────────────────────────────────
 * A diferencia de Perdido y encontrado, acá NO hay rama que escriba
 * `published`. El pedido del cliente es textual: «todo esto se verifica vía
 * geovanny con la cuenta de admin». El techo de esta action es `pending`, y
 * ni siquiera con el admin client se sube más: `approved` lo escribe la cola
 * del panel, con nombre y fecha en `reviewed_by`/`reviewed_at`.
 *
 * ── DÓNDE SE USA LA MODERACIÓN AUTOMÁTICA, Y DÓNDE NO ───────────────────────
 * `moderateText` se llama, pero NO para decidir si se publica: eso ya lo
 * decide una persona. Se llama para que esa persona no tenga que leer lo peor
 * de internet. Si el texto viene `flagged`, el aviso se queda en `draft` y a
 * quien lo escribió se le dice que lo cuente con otras palabras.
 *
 * Es un desvío consciente del patrón del repo (flagged → cola humana) y el
 * motivo es que acá la cola humana es UNA persona: es el recurso escaso de
 * todo este diseño, y protegerlo es parte del diseño. El texto no se pierde
 * —la fila queda como borrador— así que un falso positivo cuesta una
 * reescritura, no el trabajo entero.
 *
 * Sin `OPENAI_API_KEY` (`moderation.skipped`) no bloquea nada: igual lo va a
 * leer una persona antes de que se publique. Degradación elegante §5.6.
 *
 * TENANT: siempre del guard (JWT + host), jamás de un campo del formulario.
 * =============================================================================
 */

const C = COMUNIDAD_COPY.ofrecerse;
const CONTACTO = COMUNIDAD_COPY.ayudaMutua.card.escribirErrores;

// ===========================================================================
// 1. Escribir / corregir y mandar a revisión
// ===========================================================================

const avisoSchema = z
  .object({
    /** Presente sólo cuando se está corrigiendo un borrador que ya existe. */
    avisoId: z.uuid().optional(),
    direction: z.enum(HELP_DIRECTIONS),
    topic: z.enum(HELP_TOPICS),
    resourceId: z.uuid().nullable().optional(),
    title: z.string().trim().min(HELP_TITLE_MIN).max(HELP_TITLE_MAX),
    body: z.string().trim().min(HELP_BODY_MIN).max(HELP_BODY_MAX),
    areaLabel: z.string().trim().min(HELP_AREA_MIN).max(HELP_AREA_MAX),
    availability: z.string().trim().max(HELP_AVAILABILITY_MAX).nullable().optional(),
    orgName: z.string().trim().max(HELP_ORG_MAX).nullable().optional(),
    /**
     * Lista CERRADA. Con texto libre, "español" y "Español" son dos idiomas
     * distintos y el filtro deja de servir; y un campo de texto más es un
     * campo más donde alguien puede meter su teléfono.
     */
    languages: z.array(z.enum(HELP_LANGUAGES)).max(HELP_LANGUAGES.length).optional(),
  })
  // El nombre del lugar sólo existe del lado que PIDE manos. Espeja el CHECK
  // `community_help_notices_org_solo_si_pide` de la 0120.
  .refine((value) => value.direction === "need" || !value.orgName, {
    message: "org_name sólo aplica a un pedido de manos",
  });

export type AvisoDeAyudaInput = z.input<typeof avisoSchema>;

export type PublicarAvisoResult =
  | { ok: true; avisoId: string }
  | { ok: false; error: string; needsAuth?: boolean };

export async function guardarYEnviarAvisoDeAyuda(
  rawInput: AvisoDeAyudaInput,
): Promise<PublicarAvisoResult> {
  // Zod PURO primero (sin I/O): un payload roto no consume guard ni cuota.
  const parsed = avisoSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: C.errors.generic };
  }
  const input = parsed.data;

  /**
   * El detector de datos de contacto corre ANTES de tocar la base, y es lo
   * único de esta action que le contesta al usuario con un texto distinto
   * según qué encontró. La tabla no tiene columna de teléfono a propósito
   * (§2 de la 0120): el texto libre es el único agujero por el que un dato de
   * contacto puede entrar, y taparlo acá es taparlo entero.
   */
  const contacto = primerDatoDeContacto(
    input.title,
    input.body,
    input.availability,
    input.orgName,
  );
  if (contacto) {
    return { ok: false, error: C.errors[contacto] };
  }

  // Guard ANTES de cualquier efecto colateral (regla del repo, lib/tenant/guard).
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`comunidad-ayuda:${user.id}`, 10, DAY_MS).ok) {
    return { ok: false, error: C.errors.cupo };
  }

  const sinTipar = supabaseSinTiparComunidad(supabase);
  const contenido = {
    direction: input.direction,
    topic: input.topic,
    resource_id: input.resourceId ?? null,
    title: input.title,
    body: input.body,
    area_label: input.areaLabel,
    availability: input.availability || null,
    org_name: input.direction === "need" ? input.orgName || null : null,
    languages: input.languages ?? [],
  };

  // ---- Fase 1: la fila existe como borrador (nueva o la que se corrige).
  let avisoId: string;
  if (input.avisoId) {
    // `.eq("status", "draft")` es load-bearing: es lo que impide reescribir el
    // texto de un aviso YA aprobado (el trigger lo rechazaría igual, pero acá
    // se convierte en un mensaje que se entiende en vez de en un error crudo).
    const { data, error } = await sinTipar
      .from("community_help_notices")
      .update(contenido)
      .eq("id", input.avisoId)
      .eq("tenant_id", tenant.id)
      .eq("created_by", user.id)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();

    if (error || !data) {
      return { ok: false, error: traducirErrorDeBase(error?.message, C.errors.estado) };
    }
    avisoId = (data as { id: string }).id;
  } else {
    const { data, error } = await sinTipar
      .from("community_help_notices")
      .insert({ ...contenido, tenant_id: tenant.id, created_by: user.id, status: "draft" })
      .select("id")
      .maybeSingle();

    if (error || !data) {
      console.warn("[comunidad] alta de aviso de ayuda falló", { code: error?.code });
      return { ok: false, error: traducirErrorDeBase(error?.message, C.errors.generic) };
    }
    avisoId = (data as { id: string }).id;
  }

  // ---- Moderación de texto. Ver la cabecera: no decide si se publica, decide
  // si a una persona le toca leer esto.
  const moderation = await moderateText(`${input.title}\n${input.body}`);
  if (moderation.flagged) {
    // La fila queda como borrador: lo escrito no se pierde y se puede corregir.
    return { ok: false, error: C.errors.moderacion };
  }

  // ---- Fase 2: a la cola. `approved` no aparece por ningún lado, a propósito.
  const { data: enviado, error: enviarError } = await sinTipar
    .from("community_help_notices")
    .update({ status: "pending" })
    .eq("id", avisoId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (enviarError || !enviado) {
    console.warn("[comunidad] envío a revisión del aviso falló", { code: enviarError?.code });
    return { ok: false, error: traducirErrorDeBase(enviarError?.message, C.errors.generic) };
  }

  revalidatePath("/comunidad/ayuda-mutua");
  revalidatePath("/comunidad/ayuda-mutua/mios");
  return { ok: true, avisoId };
}

// ===========================================================================
// 2. Mover el aviso de estado (retirar, corregir, dar de baja)
// ===========================================================================

const estadoSchema = z.object({
  avisoId: z.uuid(),
  hasta: z.enum(HELP_STATUSES),
});

export type CambiarEstadoResult =
  | { ok: true; estado: HelpStatus }
  | { ok: false; error: string; needsAuth?: boolean };

/**
 * Las tres cosas que puede hacer alguien con un aviso propio: retirarlo de la
 * cola, devolver a borrador uno rechazado para corregirlo, y darlo de baja
 * cuando ya consiguió lo que buscaba.
 *
 * NO hay una action por cada una. La transición válida la decide
 * `puedeTransicionar(...,'autor')` —el espejo exacto del trigger— así que tres
 * actions serían tres copias de la misma verificación, y la cuarta que alguien
 * escriba mañana se olvidaría de alguna. La lista de lo permitido vive en UN
 * lugar (`src/lib/comunidad/ayuda-mutua.ts`) y se testea sola.
 *
 * `approved` y `rejected` no son alcanzables desde acá aunque lleguen en el
 * payload: no están entre las transiciones del autor. Es la tercera vez que se
 * dice lo mismo (policy, trigger, esto) y las tres son a propósito.
 */
export async function cambiarEstadoDeAvisoDeAyuda(rawInput: {
  avisoId: string;
  hasta: string;
}): Promise<CambiarEstadoResult> {
  const parsed = estadoSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: C.errors.estado };
  }
  const { avisoId, hasta } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`comunidad-ayuda-estado:${user.id}`, 60, DAY_MS).ok) {
    return { ok: false, error: C.errors.generic };
  }

  const sinTipar = supabaseSinTiparComunidad(supabase);

  // Lectura previa: hace falta el estado ACTUAL para saber si la transición es
  // legal, y de paso convierte "no existe" y "no es tuyo" en la misma
  // respuesta — desde acá no se confirma la existencia de un aviso ajeno.
  const { data: actual, error: leerError } = await sinTipar
    .from("community_help_notices")
    .select("id, status")
    .eq("id", avisoId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .maybeSingle();

  if (leerError || !actual) {
    return { ok: false, error: C.errors.estado };
  }

  const desde = (actual as { status: string }).status;
  if (!isHelpStatus(desde) || !puedeTransicionar(desde, hasta, "autor")) {
    return { ok: false, error: C.errors.estado };
  }

  const { data: movido, error: moverError } = await sinTipar
    .from("community_help_notices")
    .update({ status: hasta })
    .eq("id", avisoId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    // Vuelve a exigir el estado que se leyó: si alguien del equipo lo resolvió
    // en el medio, este UPDATE no toca nada en vez de pisar su decisión.
    .eq("status", desde)
    .select("id")
    .maybeSingle();

  if (moverError || !movido) {
    console.warn("[comunidad] cambio de estado del aviso falló", { code: moverError?.code });
    return { ok: false, error: traducirErrorDeBase(moverError?.message, C.errors.estado) };
  }

  revalidatePath("/comunidad/ayuda-mutua");
  revalidatePath("/comunidad/ayuda-mutua/mios");
  return { ok: true, estado: hasta };
}

// ===========================================================================
// Helper local (no exportado: este módulo es "use server")
// ===========================================================================

/**
 * Los `raise exception` de la 0120 llevan un prefijo estable justamente para
 * esto. Traducirlos acá es lo que separa "TOO_MANY_OPEN: ya tenés 5 avisos…"
 * —que es un mensaje para quien lee logs— de una frase que le dice a la
 * persona qué puede hacer al respecto.
 *
 * Lo que no se reconoce cae al mensaje por defecto: nunca se le muestra a
 * nadie el texto crudo de un error de Postgres.
 */
function traducirErrorDeBase(mensaje: string | undefined, porDefecto: string): string {
  if (!mensaje) return porDefecto;
  if (mensaje.includes("TOO_MANY_OPEN")) return C.errors.cupo;
  if (mensaje.includes("ACCOUNT_SUSPENDED")) return C.errors.suspendida;
  if (mensaje.includes("BAD_RESOURCE")) return C.errors.resource;
  if (mensaje.includes("CONTENT_FROZEN") || mensaje.includes("BAD_TRANSITION")) {
    return C.errors.estado;
  }
  return porDefecto;
}

// ===========================================================================
// 3. Escribirle a quien publicó
// ===========================================================================

const contactoSchema = z.object({ avisoId: z.uuid() });

export type ContactarAvisoResult =
  | { ok: true; conversationId: string }
  | { ok: false; error: string; needsAuth?: boolean };

/**
 * Abre (o recupera) la conversación privada con quien publicó el aviso.
 *
 * Toda la autorización vive en `public.contactar_aviso_de_ayuda` (0120): que
 * el aviso esté aprobado, que sea de esta comunidad, que no sea el propio, y
 * que no haya bloqueo entre las partes. Acá no se repite ninguna de esas
 * verificaciones —se repetirían mal— y sólo se traducen sus errores.
 *
 * Es el ÚNICO camino de contacto que tiene esta sección, por diseño: la tabla
 * no guarda teléfonos (§2 de la migración). Un mensaje adentro de la app deja
 * rastro, se puede reportar y se puede bloquear; un número publicado, no.
 */
export async function contactarAvisoDeAyuda(rawInput: {
  avisoId: string;
}): Promise<ContactarAvisoResult> {
  const parsed = contactoSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: CONTACTO.generic };
  }

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { supabase, user } = guard;

  if (!limit(`comunidad-ayuda-contacto:${user.id}`, 40, DAY_MS).ok) {
    return { ok: false, error: CONTACTO.generic };
  }

  const { data, error } = await supabaseSinTiparComunidad(supabase).rpc(
    "contactar_aviso_de_ayuda",
    { p_notice: parsed.data.avisoId },
  );

  if (error || typeof data !== "string") {
    const mensaje = error?.message ?? "";
    if (mensaje.includes("NOTICE_NOT_FOUND")) {
      return { ok: false, error: CONTACTO.noDisponible };
    }
    if (mensaje.includes("CANNOT_CONTACT_SELF")) {
      return { ok: false, error: CONTACTO.propio };
    }
    if (mensaje.includes("USER_BLOCKED")) {
      return { ok: false, error: CONTACTO.bloqueado };
    }
    if (mensaje.includes("AUTH_REQUIRED")) {
      return { ok: false, needsAuth: true, error: C.needLogin };
    }
    console.warn("[comunidad] no se pudo abrir el contacto del aviso", { code: error?.code });
    return { ok: false, error: CONTACTO.generic };
  }

  return { ok: true, conversationId: data };
}
