"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { requireTenantMatch } from "@/lib/tenant/guard";
import {
  COMUNIDAD_COPY,
  filaDeEspacio,
  filaDeLugar,
  filaDePedidoDeVoluntarios,
  filaDeVoluntario,
  ofrecimientoDeEspacioSchema,
  pedidoDeVoluntariosSchema,
  registroDeLugarSchema,
  registroVoluntarioSchema,
  supabaseSinTiparComunidad,
  type OfrecimientoDeEspacioInput,
  type PedidoDeVoluntariosInput,
  type RegistroDeLugarInput,
  type RegistroParaInsertar,
  type RegistroVoluntarioInput,
} from "@/lib/comunidad";

/**
 * =============================================================================
 * LOS CUATRO REGISTROS PRIVADOS (Comunidad, 0131)
 * =============================================================================
 *
 * Cinco acciones: los cuatro formularios y retirar lo que uno mismo dejó.
 *
 * Las cuatro altas hacen exactamente lo mismo con datos distintos, así que el
 * trabajo real está UNA vez, en `crearRegistro`. Lo propio de cada formulario
 * —qué campos tiene y qué va a `details`— vive en `src/lib/comunidad/registros.ts`
 * junto a su zod, para que el formulario del cliente valide con la misma regla
 * y para que los dos se puedan testear sin levantar esto.
 *
 * ── ACÁ NO CORRE `moderateText`, Y NO ES UN OLVIDO ──────────────────────────
 * En el tablón de pedidos la moderación automática ES el gate: la 0130 hizo que
 * un pedido se publique al toque, así que si nadie lo mira antes, algo tiene que
 * mirarlo. Acá no se publica NADA. Los cuatro formularios terminan en una cola
 * que una persona del equipo abre y lee entera antes de hacer nada — que es la
 * condición exacta bajo la cual aquella migración dijo que el gate automático no
 * hacía falta. Gastar una llamada a la API de moderación para revisar un texto
 * que sólo va a leer el equipo sería pagar por nada.
 *
 * La única salida pública posible es un `place` aprobado, y ahí la moderación es
 * humana y explícita: alguien del equipo confirma los datos, escribe de dónde los
 * confirmó y recién entonces existe la ficha (ver /admin/comunidad/registros).
 *
 * ── TAMPOCO CORRE EL DETECTOR DE DATOS DE CONTACTO ──────────────────────────
 * Es la asimetría deliberada del módulo, al revés que en el tablón: allá un
 * teléfono en el texto se rechaza porque el texto se publica; acá el teléfono es
 * el punto del formulario. Lo que protege el dato no es esconderlo, es que la
 * tabla no lo muestre a nadie más que a su dueño y al equipo (RLS de la 0131).
 *
 * TENANT: siempre del guard (JWT + host), jamás de un campo del formulario.
 * =============================================================================
 */

const C = COMUNIDAD_COPY.registros;

/** Todas las pantallas que cambian cuando alguien se registra o se retira. */
const RUTAS = [
  "/comunidad",
  "/comunidad/voluntarios/registrarme",
  "/comunidad/voluntarios/pedir",
  "/comunidad/recursos/registrar",
  "/comunidad/espacio",
  "/comunidad/espacio/ofrecer",
];

export type RegistroResult =
  | { ok: true; registroId: string }
  | { ok: false; error: string; needsAuth?: boolean };

/**
 * El alta, una sola vez para los cuatro.
 *
 * Recibe la fila YA validada y ya armada: quien la llama hizo el zod de su
 * formulario. Acá queda lo que es igual en los cuatro y lo que sólo se puede
 * hacer en el servidor — el tenant, el autor, la cuota y la traducción de lo
 * que diga la base.
 */
async function crearRegistro(fila: RegistroParaInsertar): Promise<RegistroResult> {
  // Guard ANTES de cualquier efecto colateral (regla del repo, lib/tenant/guard).
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  /**
   * Cuota diaria por persona, además del cupo de uno abierto por formulario.
   * Son dos cosas distintas: el cupo evita que la cola se llene de copias del
   * mismo registro, y esto evita que alguien registre, retire, registre, retire
   * — que el cupo por sí solo no frena.
   */
  if (!limit(`comunidad-registro:${user.id}`, 8, DAY_MS).ok) {
    return { ok: false, error: C.errores.abierto };
  }

  const { data, error } = await supabaseSinTiparComunidad(supabase)
    .from("community_registrations")
    .insert({
      tenant_id: tenant.id,
      created_by: user.id,
      ...fila,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.warn("[comunidad] alta de registro falló", { code: error?.code, kind: fila.kind });
    return { ok: false, error: traducirErrorDeBase(error?.code, error?.message) };
  }

  for (const ruta of RUTAS) revalidatePath(ruta);
  return { ok: true, registroId: (data as { id: string }).id };
}

// ===========================================================================
// 1. Me anoto de voluntario
// ===========================================================================

export async function registrarVoluntario(
  rawInput: RegistroVoluntarioInput,
): Promise<RegistroResult> {
  // Zod PURO primero (sin I/O): un payload roto no consume guard ni cuota.
  const parsed = registroVoluntarioSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: errorDeZod(parsed.error) };
  return crearRegistro(filaDeVoluntario(parsed.data));
}

// ===========================================================================
// 2. Necesito voluntarios
// ===========================================================================

export async function pedirVoluntarios(
  rawInput: PedidoDeVoluntariosInput,
): Promise<RegistroResult> {
  const parsed = pedidoDeVoluntariosSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: errorDeZod(parsed.error) };
  return crearRegistro(filaDePedidoDeVoluntarios(parsed.data));
}

// ===========================================================================
// 3. Registrar mi lugar
// ===========================================================================

export async function registrarLugar(rawInput: RegistroDeLugarInput): Promise<RegistroResult> {
  const parsed = registroDeLugarSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: errorDeZod(parsed.error) };
  return crearRegistro(filaDeLugar(parsed.data));
}

// ===========================================================================
// 4. Ofrecer mi espacio
// ===========================================================================

export async function ofrecerEspacio(
  rawInput: OfrecimientoDeEspacioInput,
): Promise<RegistroResult> {
  const parsed = ofrecimientoDeEspacioSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: errorDeZod(parsed.error) };
  return crearRegistro(filaDeEspacio(parsed.data));
}

// ===========================================================================
// 5. Retirar lo que dejé
// ===========================================================================

const retirarSchema = z.object({ registroId: z.uuid() });

export type RetirarResult = { ok: true } | { ok: false; error: string; needsAuth?: boolean };

/**
 * Borra el registro PROPIO. Borrado de verdad, no archivado.
 *
 * Es lo contrario de lo que hace el resto del módulo, donde una fila ocultada se
 * conserva porque es la evidencia de una decisión de moderación. Acá no hay nada
 * que auditar: es el teléfono de alguien que quiso que lo llamaran y ya no
 * quiere. Guardarlo «por las dudas» sería juntar un dato personal sin uso, que
 * es exactamente lo que §5.4 prohíbe.
 *
 * Quién puede lo decide la policy de DELETE (autor o equipo). El `eq` de autor
 * de acá es para que un id ajeno devuelva «ya no está» en vez de un error que
 * confirme que ese id existe.
 */
export async function retirarRegistro(rawInput: { registroId: string }): Promise<RetirarResult> {
  const parsed = retirarSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: C.errores.retirar };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  const { error } = await supabaseSinTiparComunidad(supabase)
    .from("community_registrations")
    .delete()
    .eq("id", parsed.data.registroId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id);

  if (error) {
    console.warn("[comunidad] retiro de registro falló", { code: error.code });
    return { ok: false, error: C.errores.retirar };
  }

  for (const ruta of RUTAS) revalidatePath(ruta);
  return { ok: true };
}

// ===========================================================================
// Traducción de errores
// ===========================================================================

/**
 * El zod del servidor corre sobre un payload que el formulario ya validó, así
 * que llegar acá con un error significa una de dos: alguien llamó a la action
 * sin pasar por la pantalla, o un campo que el cliente no chequea. Se contesta
 * con el mensaje del campo cuando se lo puede identificar, y con el genérico
 * cuando no — nunca con el texto crudo de zod, que está en inglés y habla de
 * "issues".
 */
function errorDeZod(error: z.ZodError): string {
  const campo = String(error.issues[0]?.path?.[0] ?? "");
  const porCampo: Record<string, string> = {
    name: C.errores.nombre,
    areaLabel: C.errores.zona,
    body: C.errores.detalle,
    contactPhone: C.errores.contacto,
    contactEmail: C.errores.email,
    aceptaReglas: C.errores.reglas,
    skills: C.errores.chips,
    availability: C.errores.chips,
    activities: C.errores.chips,
    address: C.errores.direccion,
    hoursLabel: C.errores.horarios,
    daysLabel: C.errores.horarios,
    whenLabel: C.errores.cuando,
    peopleNeeded: C.errores.personas,
    capacity: C.errores.capacidad,
  };
  return porCampo[campo] ?? C.errores.generic;
}

/**
 * Lo que dice la base, en castellano.
 *
 * `23505` es el índice único parcial de la 0131 ganando la carrera que el
 * trigger puede perder (dos envíos simultáneos). Los dos casos son el mismo para
 * la persona: ya hay un registro suyo esperando respuesta.
 */
function traducirErrorDeBase(code: string | undefined, mensaje: string | undefined): string {
  if (code === "23505") return C.errores.abierto;
  if (!mensaje) return C.errores.generic;
  if (mensaje.includes("ALREADY_OPEN")) return C.errores.abierto;
  if (mensaje.includes("ACCOUNT_SUSPENDED")) return C.errores.suspendida;
  if (mensaje.includes("DETAILS_SHAPE")) return C.errores.generic;
  return C.errores.generic;
}
