"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { supabaseSinTiparGrupos } from "@/lib/messaging/grupos";
import {
  COMPARTIDO_KINDS,
  hrefDeCompartido,
  type CompartidoKind,
} from "@/components/share/enlace-interno";

/**
 * =============================================================================
 * MANDAR UNA PUBLICACIÓN POR CHAT
 * =============================================================================
 *
 * El corazón de "compartir adentro": alguien ve una propiedad, un evento o un
 * trabajo, elige a quién le sirve, y le llega al chat como una tarjeta que se
 * abre de un toque. Un envío puede ir a varias personas y a varios grupos a la
 * vez, así que esta action recibe una LISTA de destinos y no uno.
 *
 * ── CADA DESTINO ES SU PROPIA HISTORIA ──────────────────────────────────────
 * Un destino que falla no cancela a los demás. Si alguien bloqueó al remitente
 * o dejó un grupo, ese envío no sale y los otros cinco sí — y la respuesta dice
 * CUÁNTOS salieron, nunca cuáles ni por qué. El motivo es dato de otra persona:
 * "a Fulano no se pudo" confirmaría un bloqueo, que es exactamente lo que el
 * contacto protegido (§9.2) no revela.
 *
 * ── LA RLS SIGUE SIENDO LA FRONTERA ─────────────────────────────────────────
 * Todo pasa por el cliente del usuario. Acá no hay un solo chequeo de permisos
 * que la base no vuelva a hacer: escribirle a una persona lo autoriza
 * `messages_insert`, y al grupo la policy de `chat_group_messages`. Si mañana
 * se borra un `if` de este archivo, la operación falla igual — con un error más
 * feo, no con una puerta abierta.
 */

const DestinoSchema = z.object({
  tipo: z.enum(["persona", "grupo"]),
  id: z.uuid(),
});

/**
 * Tope de destinos por envío. No es una restricción de producto —compartirle
 * algo a diez personas es un uso legítimo— sino el techo que evita que un solo
 * request se convierta en cincuenta inserts y cincuenta notificaciones.
 */
const MAX_DESTINOS = 12;

const CompartirSchema = z.object({
  destinos: z.array(DestinoSchema).min(1).max(MAX_DESTINOS),
  compartidoKind: z.enum(COMPARTIDO_KINDS),
  compartidoId: z.uuid(),
  nota: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(2000))
    .optional()
    .transform((value) => value ?? ""),
});

export type CompartirResult =
  | {
      ok: true;
      /** Cuántos destinos recibieron la tarjeta. */
      enviados: number;
      /** Cuántos no. Sin detalle: ver la nota de arriba. */
      fallidos: number;
    }
  | {
      ok: false;
      code:
        | "unauthenticated"
        | "tenant-mismatch"
        | "invalid"
        | "rate-limited"
        | "flagged"
        | "error";
    };

type Destino = z.infer<typeof DestinoSchema>;

/**
 * La columna todavía no existe en este entorno (migración sin aplicar).
 * `42703` lo dice Postgres; `PGRST204` lo dice PostgREST desde su schema cache,
 * que es quien contesta primero en un insert. Mismo vocabulario que ya usan
 * `tag-policy.ts` (42703) y `feed-rpc.ts` (PGRST202) para el caso hermano.
 */
const COLUMNA_NO_EXISTE = new Set(["42703", "PGRST204"]);

function faltaLaMigracion(code: string | undefined): boolean {
  return code !== undefined && COLUMNA_NO_EXISTE.has(code);
}

/**
 * IDEMPOTENCIA: ¿YA MANDÉ ESTO MISMO ACÁ HACE UN RATO?
 *
 * El caso real no es un ataque, es el doble toque: la persona toca "Enviar", la
 * red tarda, y toca otra vez. Sin esto, la misma tarjeta aparece dos veces en el
 * chat de la otra persona.
 *
 * La ventana es corta a propósito. Compartir DOS VECES la misma propiedad con la
 * misma persona es legítimo —"mirá, bajó el precio"— así que lo que se descarta
 * es la repetición inmediata, no la repetición.
 */
const VENTANA_IDEMPOTENCIA_MS = 60_000;

/** Techo de mensajería, compartido con el chat 1-a-1 y con los grupos. */
const MENSAJES_POR_HORA = 120;

export async function compartirEnChatAction(input: {
  destinos: { tipo: "persona" | "grupo"; id: string }[];
  compartidoKind: CompartidoKind;
  compartidoId: string;
  nota?: string;
}): Promise<CompartirResult> {
  const parsed = CompartirSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const { compartidoKind, compartidoId, nota } = parsed.data;

  // Duplicados de la misma tanda (tocar dos veces la misma fila antes de
  // enviar) se colapsan acá y no en la base: así "enviados" cuenta chats y no
  // inserts.
  const destinos = [
    ...new Map(
      parsed.data.destinos.map((destino) => [`${destino.tipo}:${destino.id}`, destino]),
    ).values(),
  ];

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") return { ok: false, code: "tenant-mismatch" };
    return { ok: false, code: "error" };
  }
  const { tenant, supabase, user } = guard;

  /**
   * EL MISMO BUCKET que los mensajes directos y los de grupo (`mensaje:<uid>`),
   * por el motivo que documenta `enviarMensajeAlGrupoAction`: el presupuesto es
   * de la PERSONA, no de la pantalla.
   *
   * Y se consume UNA VEZ POR DESTINO. Un compartir a ocho personas son ocho
   * mensajes reales en ocho chats reales; si contara uno solo, este panel sería
   * justo el agujero por donde se saltea el techo de mensajería. Se cobra por
   * adelantado —antes de escribir nada— para que el "no" llegue antes que los
   * efectos, no en la mitad.
   */
  for (let i = 0; i < destinos.length; i += 1) {
    if (!limit(`mensaje:${user.id}`, MENSAJES_POR_HORA, HOUR_MS).ok) {
      return { ok: false, code: "rate-limited" };
    }
  }

  // La nota es texto libre de un usuario que va a parar a chats ajenos: pasa por
  // la misma moderación que cualquier mensaje. Sin nota no hay nada que moderar
  // — la tarjeta sale del contenido, que ya pasó por su propio filtro al
  // publicarse.
  if (nota) {
    const moderacion = await moderateText(nota);
    if (moderacion.flagged) return { ok: false, code: "flagged" };
  }

  const sinTipar = supabaseSinTiparGrupos(supabase);

  /**
   * RESPALDO CUANDO LA 0136 NO ESTÁ APLICADA.
   *
   * Si las columnas nuevas no existen todavía, el mensaje igual sale: en vez de
   * `compartido_kind`/`compartido_id` viaja la URL de la publicación como
   * cuerpo. No es un parche de compromiso — es exactamente lo que pasa cuando
   * alguien pega el link a mano, y la burbuja lo pinta con LA MISMA tarjeta (ver
   * `enlaceInternoDelCuerpo`). O sea: el destinatario ve lo mismo, y el día que
   * la migración entre, los envíos nuevos usan las columnas sin tocar nada.
   *
   * `usarColumnas` se apaga una sola vez por request: si la primera fila rebota
   * por columna inexistente, las once siguientes van a rebotar igual.
   */
  const sitio = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  const enlace = sitio ? `${sitio}${hrefDeCompartido(compartidoKind, compartidoId)}` : "";
  let usarColumnas = true;

  const desde = new Date(Date.now() - VENTANA_IDEMPOTENCIA_MS).toISOString();

  /**
   * La fila que se inserta, igual para los dos destinos salvo la columna que los
   * distingue.
   */
  function filaDelMensaje(destinoColumna: Record<string, string>) {
    if (!usarColumnas) {
      return {
        tenant_id: tenant.id,
        sender_id: user.id,
        ...destinoColumna,
        body: nota ? `${nota}\n${enlace}` : enlace,
      };
    }
    return {
      tenant_id: tenant.id,
      sender_id: user.id,
      ...destinoColumna,
      /**
       * Compartir una PERSONA tiene su propio `kind` en la 0136, y el CHECK
       * `messages_compartido_segun_kind` lo hace cumplir en un solo sentido:
       * `kind = 'perfil'` obliga a `compartido_kind = 'profile'`. O sea que un
       * perfil entraría igual como 'contenido' — pero entonces la tarjeta de
       * una persona quedaría indistinguible de la de un aviso para cualquier
       * pantalla que filtre por `kind`, que es justo lo que esa columna existe
       * para permitir.
       */
      kind: compartidoKind === "profile" ? "perfil" : "contenido",
      compartido_kind: compartidoKind,
      compartido_id: compartidoId,
      // Cadena vacía y no null: el mensaje ES la tarjeta. `body` es NOT NULL y
      // el CHECK de la 0136 sólo exige texto cuando `kind = 'texto'`; el tope de
      // 2000 es el mismo que valida zod acá arriba.
      body: nota,
    };
  }

  /**
   * ¿La misma tarjeta ya está en este chat desde hace menos de un minuto?
   *
   * Best-effort a propósito: si la lectura falla —o si las columnas todavía no
   * existen— se sigue adelante y se manda. Un duplicado ocasional es un problema
   * chico; no mandar lo que la persona pidió mandar es el grande.
   */
  async function yaLoMande(
    tabla: string,
    columna: string,
    valor: string,
  ): Promise<boolean> {
    if (!usarColumnas) return false;
    try {
      const { data, error } = await sinTipar
        .from(tabla)
        .select("id")
        .eq(columna, valor)
        .eq("sender_id", user.id)
        .eq("compartido_kind", compartidoKind)
        .eq("compartido_id", compartidoId)
        .gte("created_at", desde)
        .limit(1);
      if (error) return false;
      return Array.isArray(data) && data.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Un insert que, si rebota porque falta la migración, baja la bandera y
   * reintenta UNA vez con la fila de respaldo. Cualquier otro error es un "no"
   * de la base (42501: no soy miembro, el hilo está bloqueado) y se respeta.
   */
  async function insertarMensaje(
    tabla: string,
    destinoColumna: Record<string, string>,
  ): Promise<boolean> {
    const { error } = await sinTipar.from(tabla).insert(filaDelMensaje(destinoColumna));
    if (!error) return true;

    if (!faltaLaMigracion(error.code)) {
      console.warn("[compartir] el mensaje no se pudo insertar", {
        tabla,
        code: error.code,
      });
      return false;
    }

    /**
     * Sin `NEXT_PUBLIC_SITE_URL` no hay respaldo posible y el envío falla acá.
     *
     * Es a propósito y no una omisión: el respaldo consiste en mandar el ENLACE
     * como cuerpo, y sin un origin configurado ese cuerpo sería la cadena vacía
     * — que además rebota contra `messages_body_check` (la 0136 exige texto
     * cuando `kind = 'texto'`). Mandar un mensaje vacío sería peor que no
     * mandarlo: la otra persona vería una burbuja en blanco y nadie sabría por
     * qué. Esa variable ya estuvo mal en producción 39 días sin un solo síntoma
     * visible; que acá falle fuerte es la señal que aquella vez no existió.
     */
    if (!enlace) {
      console.warn(
        "[compartir] falta la 0136 y no hay NEXT_PUBLIC_SITE_URL para el respaldo",
        { tabla },
      );
      return false;
    }

    usarColumnas = false;
    const { error: reintento } = await sinTipar
      .from(tabla)
      .insert(filaDelMensaje(destinoColumna));
    if (reintento) {
      console.warn("[compartir] el mensaje no se pudo insertar (respaldo)", {
        tabla,
        code: reintento.code,
      });
      return false;
    }
    return true;
  }

  const conversacionesTocadas = new Set<string>();
  const gruposTocados = new Set<string>();

  async function enviarAPersona(profileId: string): Promise<boolean> {
    // Idempotente por contrato del RPC (0134): si ya hay hilo con esta persona
    // devuelve el mismo id en vez de abrir otro. Es también la única puerta
    // legítima — valida tenant, auto-contacto, bloqueo y "ya me ignoraste una
    // vez", y ninguna de esas cuatro se puede chequear desde acá.
    const { data, error } = await sinTipar.rpc("solicitar_contacto_directo", {
      p_profile_id: profileId,
    });
    if (error) {
      // Sin PII: ni el id de la otra persona ni su nombre.
      console.warn("[compartir] no se pudo abrir la conversación", { code: error.code });
      return false;
    }

    const conversationId = typeof data === "string" ? data : "";
    if (!conversationId) return false;

    if (await yaLoMande("messages", "conversation_id", conversationId)) {
      // Ya está en el chat: cuenta como enviado, porque desde donde mira la
      // persona lo está.
      conversacionesTocadas.add(conversationId);
      return true;
    }

    if (!(await insertarMensaje("messages", { conversation_id: conversationId }))) {
      return false;
    }
    conversacionesTocadas.add(conversationId);
    return true;
  }

  async function enviarAGrupo(groupId: string): Promise<boolean> {
    if (await yaLoMande("chat_group_messages", "group_id", groupId)) {
      gruposTocados.add(groupId);
      return true;
    }
    if (!(await insertarMensaje("chat_group_messages", { group_id: groupId }))) {
      return false;
    }
    gruposTocados.add(groupId);
    return true;
  }

  async function enviarA(destino: Destino): Promise<boolean> {
    try {
      return destino.tipo === "persona"
        ? await enviarAPersona(destino.id)
        : await enviarAGrupo(destino.id);
    } catch (error) {
      console.warn("[compartir] un destino no salió", {
        tipo: destino.tipo,
        message: error instanceof Error ? error.message : "error desconocido",
      });
      return false;
    }
  }

  /**
   * EN SERIE Y NO EN PARALELO, a propósito.
   *
   * `Promise.all` sobre doce destinos abriría doce conversaciones y haría doce
   * inserts a la vez sobre la misma conexión, y —lo que importa— dejaría a
   * `usarColumnas` decidiéndose en carrera: las doce filas saldrían con las
   * columnas nuevas antes de que la primera pueda avisar que no existen. Doce
   * idas y vueltas seguidas es un panel que confirma en el acto igual, porque la
   * UI ya respondió de forma optimista.
   */
  let enviados = 0;
  for (const destino of destinos) {
    if (await enviarA(destino)) enviados += 1;
  }
  const fallidos = destinos.length - enviados;

  if (enviados === 0) return { ok: false, code: "error" };

  revalidatePath("/mensajes");
  for (const id of conversacionesTocadas) revalidatePath(`/mensajes/${id}`);
  for (const id of gruposTocados) revalidatePath(`/mensajes/grupos/${id}`);

  return { ok: true, enviados, fallidos };
}
