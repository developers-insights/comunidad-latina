import { NextResponse } from "next/server";
import { z } from "zod";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { requireTenantMatch } from "@/lib/tenant/guard";
import {
  agoraEstaConfigurado,
  emitirTokenRtc,
  TOKEN_TTL_SEGUNDOS,
} from "@/lib/calls/token-de-agora";
import { estaViva, esEstadoDeLlamada, supabaseSinTiparLlamadas } from "@/lib/calls/tipos";

/**
 * =============================================================================
 * POST /api/llamadas/token — la única puerta a una sala de Agora
 * =============================================================================
 *
 * CONTRATO (el motor de la llamada depende de esto tal cual):
 *
 *   POST /api/llamadas/token   { callId }
 *   → 200 { token, canal, uid, appId, expiraEn }
 *   → 400 { error: "pedido_invalido" }
 *   → 401 { error: "sin_sesion" }
 *   → 403 { error: "no_sos_participante" }   no figura en call_participants, o ya salió (left_at)
 *   → 409 { error: "comunidad_distinta" }    el JWT y el dominio no coinciden
 *   → 409 { error: "llamada_terminada" }     la llamada ya no está viva
 *   → 429 { error: "demasiados_pedidos" }
 *   → 503 { error: "llamadas_no_configuradas" }
 *
 * ── LAS TRES COSAS QUE ESTA RUTA GARANTIZA ──────────────────────────────────
 *
 * 1 · EL CERTIFICADO NO SALE DE ACÁ. `@/lib/calls/token-de-agora` lleva
 *     `server-only`: si alguien lo importa desde un componente de cliente, el
 *     build se cae. Es la única protección que no depende de acordarse.
 *
 * 2 · LA PERTENENCIA LA DECIDE LA BASE, NO EL BODY. Del cliente llega UN dato
 *     —el id de la llamada— y ese dato no autoriza nada: se consulta
 *     `call_participants` con el cliente del USUARIO (anon key + cookies), así
 *     que la RLS de la 0139 vuelve a hacer la pregunta por su cuenta. Ni el
 *     `canal` ni el `uid` ni el `tenant_id` se leen del pedido: el canal sale de
 *     la fila, el uid es el id de perfil de la sesión y el tenant lo pone el
 *     guard. Un pedido con el canal de otra llamada adentro no cambia nada,
 *     porque el canal del body no se lee.
 *
 * 3 · UNA LLAMADA MUERTA NO EMITE TOKEN. Sin esto, alguien a quien sacaron de la
 *     llamada —o cuya llamada ya terminó— podría seguir renovando su entrada al
 *     canal, y cada renovación es un minuto de participante facturado. El estado
 *     se relee en CADA emisión, no sólo en la primera: por eso el TTL corto no
 *     es sólo una defensa contra el robo del token, también es el intervalo con
 *     el que se revisa que la llamada siga existiendo.
 */

export const runtime = "nodejs";

/**
 * Techo por hora y por persona.
 *
 * Una llamada larga renueva cada ~4 minutos y medio (TTL de 5 minutos menos el
 * margen), o sea ~13 emisiones por hora de conversación. Sesenta deja lugar a
 * varias llamadas seguidas, a reconexiones y a tener dos pestañas, y le pone
 * piso a un script que pida tokens en loop.
 */
const TOKENS_POR_HORA = 60;

const cuerpoSchema = z.object({ callId: z.uuid() });

export async function POST(request: Request) {
  // 1 · ¿Está encendido el camino de llamadas? Puro y sin efectos: va primero
  //     para que un 503 no consuma cupo ni toque la base.
  if (!agoraEstaConfigurado()) {
    console.warn(
      "[llamadas:token] Pedido con Agora sin configurar (faltan NEXT_PUBLIC_AGORA_APP_ID y/o AGORA_APP_CERTIFICATE) — 503.",
    );
    return NextResponse.json(
      {
        error: "llamadas_no_configuradas",
        message: "Estamos terminando de configurar las llamadas. Probá de nuevo más tarde.",
      },
      { status: 503 },
    );
  }

  // 2 · Sesión y comunidad, las dos derivadas del servidor.
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return NextResponse.json({ error: "sin_sesion", message: guard.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: "comunidad_distinta", message: guard.message },
      { status: 409 },
    );
  }
  const { supabase, user } = guard;

  let callId: string;
  try {
    const cuerpo: unknown = await request.json();
    const parsed = cuerpoSchema.safeParse(cuerpo);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "pedido_invalido", message: "No pudimos identificar la llamada." },
        { status: 400 },
      );
    }
    callId = parsed.data.callId;
  } catch {
    return NextResponse.json(
      { error: "pedido_invalido", message: "No pudimos identificar la llamada." },
      { status: 400 },
    );
  }

  if (!limit(`llamada-token:${user.id}`, TOKENS_POR_HORA, HOUR_MS).ok) {
    return NextResponse.json(
      {
        error: "demasiados_pedidos",
        message: "Hubo demasiados intentos de conexión. Esperá un momento y probá de nuevo.",
      },
      { status: 429 },
    );
  }

  const db = supabaseSinTiparLlamadas(supabase);

  // 3 · ¿Está invitada esta persona? La pregunta se la hace la base.
  const { data: participante } = await db
    .from("call_participants")
    .select("profile_id, left_at")
    .eq("call_id", callId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!participante || participante.left_at !== null) {
    // Mismo cuerpo para "no existe", "existe y no sos participante" y "ya
    // saliste de la llamada": son hechos distintos y distinguirlos
    // convertiría este endpoint en una forma de averiguar qué llamadas
    // existen, o quién sigue adentro, probando ids.
    return NextResponse.json(
      { error: "no_sos_participante", message: "Esta llamada ya no está disponible." },
      { status: 403 },
    );
  }

  // 4 · El canal y el estado salen de la fila. `canal` NO viaja por ningún otro
  //     lado de la app (ver LLAMADA_COLUMNS en lib/calls/tipos.ts).
  const { data: llamada } = await db
    .from("calls")
    .select("id, canal, status")
    .eq("id", callId)
    .maybeSingle();

  const estado = llamada?.status;
  if (
    !llamada ||
    typeof llamada.canal !== "string" ||
    !esEstadoDeLlamada(estado) ||
    !estaViva(estado)
  ) {
    return NextResponse.json(
      { error: "llamada_terminada", message: "Esta llamada ya terminó." },
      { status: 409 },
    );
  }

  const emitido = emitirTokenRtc({ canal: llamada.canal, uid: user.id });

  return NextResponse.json(
    {
      token: emitido.token,
      canal: llamada.canal,
      uid: user.id,
      appId: emitido.appId,
      expiraEn: emitido.expiraEn,
      ttlSegundos: TOKEN_TTL_SEGUNDOS,
    },
    // Un token con nombre y apellido no se guarda en ninguna caché, ni la del
    // navegador ni la del borde.
    { headers: { "cache-control": "no-store" } },
  );
}
