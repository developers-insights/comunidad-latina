"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { codigoDeLlamada, DUPLICADO, type CodigoDeLlamada } from "@/lib/calls/errores";
import { KINDS, MAX_PARTICIPANTES, supabaseSinTiparLlamadas } from "@/lib/calls/tipos";

/**
 * =============================================================================
 * SERVER ACTIONS DE LLAMADAS (0139)
 * =============================================================================
 *
 * Regla del módulo, la misma que la de grupos: **la RLS es la frontera real**.
 * Todo pasa por el cliente del usuario (anon key + cookies) y no hay ni un `if`
 * acá que la base no vuelva a hacer por su cuenta. Los que se ven existen para
 * dar un mensaje que se entienda, no para autorizar.
 *
 * Lo que sí es responsabilidad de este archivo y de nadie más: que
 * **`ended_at` se escriba siempre**. Una llamada que queda en `en_curso` para
 * siempre no es sólo una fila fea — es una fila que la bandeja no sabe resumir y
 * una pantalla que alguien puede volver a abrir para reconectarse a un canal que
 * ya nadie escucha, pagando el minuto.
 */

export type ResultadoDeLlamada =
  | { ok: true; callId: string }
  | { ok: false; code: CodigoDeLlamada };

const iniciarSchema = z
  .object({
    kind: z.enum(KINDS),
    /** Llamada de a dos. */
    profileId: z.uuid().optional(),
    /** Llamada de un grupo de chat. */
    groupId: z.uuid().optional(),
  })
  // Una llamada es a una persona o a un grupo. Las dos cosas a la vez no
  // significa nada y la base no tiene forma de expresarlo.
  .refine((v) => Boolean(v.profileId) !== Boolean(v.groupId), {
    message: "profileId o groupId, uno de los dos",
  });

const soloIdSchema = z.object({ callId: z.uuid() });

const invitarSchema = z.object({
  callId: z.uuid(),
  profileIds: z.array(z.uuid()).min(1).max(MAX_PARTICIPANTES),
});

/** Diez llamadas por hora es holgado para alguien que llama de verdad. */
const LLAMADAS_POR_HORA = 20;
const INVITACIONES_POR_HORA = 60;

async function guard() {
  const resultado = await requireTenantMatch();
  if (resultado.ok) return { ...resultado, ok: true as const };
  if (resultado.reason === "unauthenticated") {
    return { ok: false as const, code: "unauthenticated" as CodigoDeLlamada };
  }
  if (resultado.reason === "tenant-mismatch") {
    return { ok: false as const, code: "tenant-mismatch" as CodigoDeLlamada };
  }
  return { ok: false as const, code: "error" as CodigoDeLlamada };
}

/**
 * Empezar a llamar.
 *
 * Nace `sonando`, sin `started_at` —lo exige `calls_insert`— y con quien llama
 * ya adentro, porque de eso se encarga el trigger de la base
 * (`app.la_llamada_nace_con_quien_llama`) en la misma transacción. Acá no se
 * inserta al que llama: hacerlo chocaría con ese trigger y sumaría una fila al
 * conteo del tope.
 *
 * ⚠️ El `canal` NO se manda. Lo pisa `app.forzar_canal_de_llamada()` en cada
 * INSERT y mandarlo sólo serviría para que alguien crea que se puede elegir.
 */
export async function iniciarLlamadaAction(input: {
  kind: string;
  profileId?: string;
  groupId?: string;
}): Promise<ResultadoDeLlamada> {
  const parsed = iniciarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const g = await guard();
  if (!g.ok) return { ok: false, code: g.code };
  const { tenant, supabase, user } = g;

  if (!limit(`llamada-iniciar:${user.id}`, LLAMADAS_POR_HORA, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  const db = supabaseSinTiparLlamadas(supabase);

  const { data: llamada, error } = await db
    .from("calls")
    .insert({
      tenant_id: tenant.id,
      iniciada_por: user.id,
      kind: parsed.data.kind,
      group_id: parsed.data.groupId ?? null,
      status: "sonando",
    })
    .select("id")
    .single();

  if (error || !llamada) return { ok: false, code: codigoDeLlamada(error) };
  const callId = String(llamada.id);

  // Llamada de a dos: se invita a la otra persona en el acto, para que le suene.
  // Llamada de grupo: no se invita a nadie todavía — la pantalla abre la hoja de
  // "Añadir" con los miembros, porque un grupo puede tener cuarenta personas y
  // la llamada entra diez. Elegir por la persona sería elegir mal.
  if (parsed.data.profileId) {
    const { error: errorInvitado } = await db.from("call_participants").insert({
      call_id: callId,
      profile_id: parsed.data.profileId,
      tenant_id: tenant.id,
    });

    if (errorInvitado) {
      // La llamada quedó sin destinatario: se cierra en el acto en vez de dejar
      // una fila `sonando` que nadie va a atender nunca.
      await db
        .from("calls")
        .update({ status: "terminada", ended_at: new Date().toISOString() })
        .eq("id", callId);
      return { ok: false, code: codigoDeLlamada(errorInvitado) };
    }
  }

  revalidatePath("/llamadas");
  return { ok: true, callId };
}

/**
 * Atender (o entrar a una que ya está en curso).
 *
 * Los dos UPDATE van en este orden a propósito: primero `joined_at` en MI fila
 * —que es lo que la RLS me deja escribir siempre— y después el estado de la
 * llamada. Al revés, si el segundo fallara, la llamada quedaría `en_curso` con
 * nadie adentro.
 *
 * `started_at` sólo se escribe si todavía estaba en `sonando`: el segundo que
 * atiende no puede correr el reloj de la llamada hacia adelante.
 */
export async function atenderLlamadaAction(input: {
  callId: string;
}): Promise<ResultadoDeLlamada> {
  const parsed = soloIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const g = await guard();
  if (!g.ok) return { ok: false, code: g.code };
  const { supabase, user } = g;
  const db = supabaseSinTiparLlamadas(supabase);
  const ahora = new Date().toISOString();

  const { error: errorMio } = await db
    .from("call_participants")
    .update({ joined_at: ahora, left_at: null })
    .eq("call_id", parsed.data.callId)
    .eq("profile_id", user.id);

  if (errorMio) return { ok: false, code: codigoDeLlamada(errorMio) };

  const { error } = await db
    .from("calls")
    .update({ status: "en_curso", started_at: ahora })
    .eq("id", parsed.data.callId)
    .eq("status", "sonando");

  if (error) return { ok: false, code: codigoDeLlamada(error) };

  revalidatePath("/llamadas");
  return { ok: true, callId: parsed.data.callId };
}

/** No quiero atender. La llamada muere para los dos. */
export async function rechazarLlamadaAction(input: {
  callId: string;
}): Promise<ResultadoDeLlamada> {
  const parsed = soloIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const g = await guard();
  if (!g.ok) return { ok: false, code: g.code };
  const { supabase } = g;
  const db = supabaseSinTiparLlamadas(supabase);
  const ahora = new Date().toISOString();

  /**
   * ⚠️ Acá NO se toca `call_participants`, y no es un olvido.
   *
   * `call_participants_fechas_coherentes` exige que `left_at` sólo exista si hay
   * `joined_at`, y rechazar es justamente no haber entrado nunca. Escribir
   * `left_at` haría fallar el CHECK, y escribir también `joined_at` para
   * satisfacerlo sería anotar que alguien atendió una llamada que rechazó.
   * La fila se queda como está; lo que apaga el timbre es el estado de la
   * llamada, que deja de ser `sonando`.
   */
  const { error } = await db
    .from("calls")
    .update({ status: "rechazada", ended_at: ahora })
    .eq("id", parsed.data.callId)
    .eq("status", "sonando");

  if (error) return { ok: false, code: codigoDeLlamada(error) };

  revalidatePath("/llamadas");
  return { ok: true, callId: parsed.data.callId };
}

/**
 * Colgar.
 *
 * Dos escrituras y las dos importan:
 *
 * 1 · MI `left_at`, siempre. Es lo único que cada quien puede escribir de sí
 *     mismo y es lo que hace que la lista de la pantalla deje de mostrarme.
 *
 * 2 · El cierre de la llamada CUANDO YA NO QUEDA NADIE HABLANDO. Se cuenta
 *     quién sigue adentro DESPUÉS de mi salida: si queda una persona o ninguna,
 *     la llamada termina. "Una" también cierra, y es a propósito — alguien solo
 *     en un canal de Agora no está en una llamada, está gastando minutos.
 *     Es la contraparte de la guarda de 60 segundos del motor: acá se cierra por
 *     la vía rápida, allá por la lenta si esta no llegó a correr.
 *
 * Si nunca se llegó a atender y la cortó quien llamó, el estado es `perdida` —
 * que es exactamente lo que la bandeja necesita para escribir "Llamada perdida".
 */
export async function terminarLlamadaAction(input: {
  callId: string;
}): Promise<ResultadoDeLlamada> {
  const parsed = soloIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const g = await guard();
  if (!g.ok) return { ok: false, code: g.code };
  const { supabase, user } = g;
  const db = supabaseSinTiparLlamadas(supabase);
  const ahora = new Date().toISOString();
  const { callId } = parsed.data;

  // `.not("joined_at", "is", null)` no es de más: el CHECK de la 0139 exige que
  // `left_at` sólo exista con `joined_at` puesto. Sin este filtro, colgar antes
  // de haber llegado a entrar —el motor lo hace si el permiso de micrófono
  // falla— rompería la restricción y la llamada no se cerraría nunca.
  await db
    .from("call_participants")
    .update({ left_at: ahora })
    .eq("call_id", callId)
    .eq("profile_id", user.id)
    .not("joined_at", "is", null)
    .is("left_at", null);

  const { data: vivos } = await db
    .from("call_participants")
    .select("profile_id")
    .eq("call_id", callId)
    .not("joined_at", "is", null)
    .is("left_at", null);

  if ((vivos?.length ?? 0) > 1) {
    revalidatePath("/llamadas");
    return { ok: true, callId };
  }

  const { data: llamada } = await db
    .from("calls")
    .select("status, started_at")
    .eq("id", callId)
    .maybeSingle();

  if (!llamada) return { ok: true, callId };

  // Sin `started_at` nadie llegó a atender: eso es una llamada PERDIDA, y es el
  // dato del que cuelga el "Llamada perdida" de la bandeja.
  const estadoFinal = llamada.started_at === null ? "perdida" : "terminada";

  const { error } = await db
    .from("calls")
    .update({ status: estadoFinal, ended_at: ahora })
    .eq("id", callId)
    .in("status", ["sonando", "en_curso"]);

  if (error) return { ok: false, code: codigoDeLlamada(error) };

  revalidatePath("/llamadas");
  return { ok: true, callId };
}

export type ResultadoDeInvitacion =
  | { ok: true; sumados: number }
  | { ok: false; code: CodigoDeLlamada };

/**
 * Sumar gente a una llamada en curso.
 *
 * Se inserta de a UNA fila y no en lote, a propósito: el trigger del tope
 * (§4.3 de la 0139) toma `for update` sobre la llamada y lanza `CALL_FULL` en la
 * primera que sobra. En un lote, esa excepción tira abajo el INSERT entero y
 * quien eligió cinco personas con lugar para tres no suma ninguna. De a una, se
 * suman las que entran y el resultado dice cuántas fueron.
 *
 * Una PK duplicada NO es un error acá: significa "ya estaba invitada", que es
 * exactamente lo que se quería.
 */
export async function invitarALlamadaAction(input: {
  callId: string;
  profileIds: string[];
}): Promise<ResultadoDeInvitacion> {
  const parsed = invitarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const g = await guard();
  if (!g.ok) return { ok: false, code: g.code };
  const { tenant, supabase, user } = g;

  if (!limit(`llamada-invitar:${user.id}`, INVITACIONES_POR_HORA, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  const db = supabaseSinTiparLlamadas(supabase);
  let sumados = 0;
  let ultimoCodigo: CodigoDeLlamada | null = null;

  for (const profileId of parsed.data.profileIds) {
    const { error } = await db.from("call_participants").insert({
      call_id: parsed.data.callId,
      profile_id: profileId,
      tenant_id: tenant.id,
    });

    if (!error) {
      sumados += 1;
      continue;
    }
    if (error.code === DUPLICADO) {
      sumados += 1;
      continue;
    }

    ultimoCodigo = codigoDeLlamada(error);
    // La llamada se llenó: las que siguen tampoco entran, no tiene sentido
    // pedirle a la base que rechace una por una.
    if (ultimoCodigo === "call-full") break;
  }

  if (sumados === 0 && ultimoCodigo) return { ok: false, code: ultimoCodigo };

  revalidatePath("/llamadas");
  return { ok: true, sumados };
}
