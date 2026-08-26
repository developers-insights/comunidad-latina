import { NextResponse } from "next/server";
import { verifyMuxSignature } from "@/lib/mux/webhook";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/types/database.types";
import type { MuxStatus } from "@/lib/mux/urls";

/**
 * =============================================================================
 * POST /api/mux/webhook — Mux avisa en qué anda el video
 * =============================================================================
 *
 * CONTRATO: 200 siempre que la firma sea válida. Un evento que no reconocemos,
 * uno duplicado y uno que no correlaciona con ninguna publicación devuelven 200
 * igual — para Mux "no era para mí" no es un error, y un no-2xx lo mete en la
 * cola de reintentos con backoff hasta que alguien mire por qué.
 *
 *   → 200 { received: true }                 procesado
 *   → 200 { received: true, duplicated }     ya lo estaba procesando otro
 *   → 401 { error }                          firma ausente / inválida / vencida
 *   → 400 { error }                          firma OK pero el body no es JSON
 *   → 500 { error }                          reventó el handler (Mux reintenta)
 *   → 503 { error }                          falta MUX_WEBHOOK_SECRET
 *
 * ── LAS TRES GARANTÍAS ──────────────────────────────────────────────────────
 *
 * 1. FIRMA SOBRE EL BODY CRUDO, ANTES DE PARSEAR NADA. El HMAC se calcula sobre
 *    los bytes tal cual llegaron: parsear y re-serializar cambia un espacio o el
 *    orden de una clave y la firma deja de cerrar. Es también la única
 *    autorización que tiene este endpoint — no hay sesión ni cookie.
 *
 * 2. IDEMPOTENCIA CON RECLAMO ATÓMICO. `(provider, event_id)` es UNIQUE, así que
 *    ante dos entregas simultáneas una gana el INSERT y la otra recibe 23505. La
 *    que pierde NO puede limitarse a leer `processed`: `false` es también el
 *    estado MIENTRAS la ganadora trabaja, y esa confusión hace que las dos
 *    procesen. Se resuelve con un UPDATE condicional sobre `claimed_at` — el
 *    mismo mecanismo, los mismos 5 minutos y el mismo razonamiento que el
 *    webhook de Stripe desde 0111.
 *
 * 3. EL PAYLOAD ES DATO DE AFUERA, INCLUIDO `passthrough`. Ver abajo.
 *
 * ── POR QUÉ `passthrough` NO ES UNA CREDENCIAL ──────────────────────────────
 * `passthrough` es un string que nosotros le mandamos a Mux al crear la subida y
 * que Mux nos devuelve tal cual. Vuelve DESDE AFUERA, así que se trata como
 * cualquier input: se valida que sea un uuid antes de meterlo en un `WHERE`
 * (sin eso, `eq("id", "chau")` es un error de Postgres, no un "no encontré").
 *
 * La correlación DE VERDAD es `mux_upload_id`: ese id lo mintea Mux al crear la
 * subida, lo guarda nuestro propio servidor en la fila que nuestro propio
 * servidor creó, y tiene UNIQUE parcial (0116). El `passthrough` queda como
 * camino secundario para el caso en que un evento llegue sin `upload_id`, y ese
 * camino está acotado a filas que YA están en el circuito de Mux
 * (`mux_upload_id is not null`) y en un estado esperable. Consecuencia buscada:
 * un evento no puede tocar una publicación que no entró por acá — de nadie, de
 * ninguna comunidad.
 *
 * El `tenant_id` que queda en la bandeja de eventos se LEE de la publicación
 * tocada, nunca del payload.
 */

export const runtime = "nodejs";

/** Igual que en el webhook de Stripe: 5 min contra el techo de 300 s de Vercel. */
const RECLAMO_VENCE_MS = 5 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* --------------------------- Forma de los eventos -------------------------- */

/**
 * Sólo los campos que se leen. El SDK trae tipos completos
 * (`Mux.Webhooks.UnwrapWebhookEvent`), pero son una unión de más de cien
 * variantes que obligaría a un narrowing enorme para usar cinco campos — y
 * además vendrían de un parseo que acá no se hace (el body se parsea a mano,
 * después de verificar la firma).
 */
interface EventoMux {
  id?: unknown;
  type?: unknown;
  data?: {
    /** Asset: id del asset. Direct Upload: id de la subida. */
    id?: unknown;
    /** Sólo en eventos de Direct Upload. */
    asset_id?: unknown;
    /** Sólo en eventos de Asset. */
    upload_id?: unknown;
    passthrough?: unknown;
    duration?: unknown;
    playback_ids?: unknown;
  };
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

/**
 * El playback id PÚBLICO del asset.
 *
 * Se filtra por política y no se agarra el primero: los assets se crean con
 * `playback_policies: ["public"]`, así que si aparece uno `signed` o `drm` es
 * que algo cambió del lado de Mux — y guardarlo como si fuera público dejaría
 * una URL de reproducción que devuelve 403 para todo el mundo, con la
 * publicación diciendo "listo".
 */
function playbackIdPublico(valor: unknown): string | null {
  if (!Array.isArray(valor)) return null;
  for (const entrada of valor) {
    if (typeof entrada !== "object" || entrada === null) continue;
    const { id, policy } = entrada as { id?: unknown; policy?: unknown };
    if (policy === "public" && typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

/** Duración con 3 decimales, que es la precisión de `posts.mux_duration_seconds`. */
function duracion(valor: unknown): number | null {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) return null;
  return Math.round(valor * 1000) / 1000;
}

/* ------------------------- Aplicar el evento al post ----------------------- */

type ParcheDeMux = {
  mux_status: MuxStatus;
  mux_asset_id?: string;
  mux_playback_id?: string;
  mux_duration_seconds?: number;
};

interface PostTocado {
  id: string;
  tenant_id: string;
}

/**
 * Aplica el parche a la publicación que corresponde al evento y devuelve cuál
 * tocó (o null si ninguna).
 *
 * `estadosPermitidos` va en el WHERE del UPDATE, no en un `if` previo: es lo que
 * hace que dos entregas fuera de orden no se pisen. Mux no garantiza el orden, y
 * sin este predicado un `video.upload.asset_created` que llega tarde devolvería
 * a `processing` un video que ya estaba `ready`.
 */
async function aplicarAlPost(
  admin: ReturnType<typeof createAdminClient>,
  correlacion: { uploadId: string | null; passthrough: string | null },
  parche: ParcheDeMux,
  estadosPermitidos: MuxStatus[],
): Promise<PostTocado | null> {
  const { uploadId, passthrough } = correlacion;

  if (uploadId) {
    const { data, error } = await admin
      .from("posts")
      .update(parche)
      .eq("mux_upload_id", uploadId)
      .in("mux_status", estadosPermitidos)
      .select("id, tenant_id");
    if (error) {
      console.error(`[mux:webhook] UPDATE por mux_upload_id falló — code=${error.code}`);
      throw new Error(`update_por_upload_id: ${error.code}`);
    }
    if (data && data.length > 0) return data[0];
  }

  // Camino secundario: sólo si el evento no trajo `upload_id`. Acotado a filas
  // que ya están en el circuito de Mux y en un estado esperable.
  if (passthrough && UUID.test(passthrough)) {
    const { data, error } = await admin
      .from("posts")
      .update(parche)
      .eq("id", passthrough)
      .not("mux_upload_id", "is", null)
      .in("mux_status", estadosPermitidos)
      .select("id, tenant_id");
    if (error) {
      console.error(`[mux:webhook] UPDATE por passthrough falló — code=${error.code}`);
      throw new Error(`update_por_passthrough: ${error.code}`);
    }
    if (data && data.length > 0) return data[0];
  }

  return null;
}

/* --------------------------------- Handler --------------------------------- */

export async function POST(request: Request) {
  const secreto = process.env.MUX_WEBHOOK_SECRET;
  if (!secreto) {
    console.warn(
      "[mux:webhook] Entrega recibida sin MUX_WEBHOOK_SECRET configurado — 503, no se procesa nada.",
    );
    return NextResponse.json({ error: "Mux no configurado" }, { status: 503 });
  }

  // 1 · Firma sobre el body CRUDO, antes de parsear.
  const rawBody = await request.text();
  const firma = verifyMuxSignature(rawBody, request.headers.get("mux-signature"), secreto);
  if (!firma.ok) {
    console.warn(`[mux:webhook] Firma rechazada (${firma.reason}) — 401.`);
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let evento: EventoMux;
  try {
    evento = JSON.parse(rawBody) as EventoMux;
  } catch {
    console.warn("[mux:webhook] Firma válida pero el body no es JSON — 400.");
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const eventId = texto(evento.id);
  const eventType = texto(evento.type);
  if (!eventId || !eventType) {
    console.warn("[mux:webhook] Evento sin id o sin type — 400.");
    return NextResponse.json({ error: "Evento incompleto" }, { status: 400 });
  }

  const admin = createAdminClient();

  // 2 · Idempotencia. `claimed_at` va desde el INSERT: quien gana la carrera
  //     queda marcado como el que está procesando, que es justo lo que la rama
  //     del 23505 necesita poder distinguir.
  const { error: insertError } = await admin.from("mux_webhook_events").insert({
    provider: "mux",
    event_id: eventId,
    event_type: eventType,
    payload: JSON.parse(rawBody) as Json,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      const vencimiento = new Date(Date.now() - RECLAMO_VENCE_MS).toISOString();
      const { data: reclamado } = await admin
        .from("mux_webhook_events")
        .update({ claimed_at: new Date().toISOString() })
        .eq("provider", "mux")
        .eq("event_id", eventId)
        .eq("processed", false)
        .or(`claimed_at.is.null,claimed_at.lt.${vencimiento}`)
        .select("id")
        .maybeSingle();

      if (!reclamado) {
        // Hay alguien adentro, o ya terminó. 200 y no se toca nada.
        return NextResponse.json({ received: true, duplicated: true });
      }
      // Nos lo llevamos: el intento anterior murió a mitad. Seguimos.
    } else {
      console.error(
        `[mux:webhook] No se pudo registrar el evento ${eventId} — code=${insertError.code}`,
      );
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  }

  // 3 · Procesamiento.
  try {
    const data = evento.data ?? {};
    let tocado: PostTocado | null = null;

    switch (eventType) {
      /**
       * Mux terminó de recibir el archivo y creó el asset. Todavía no se puede
       * reproducir, pero ya hay un asset id que guardar.
       * `data` es la Direct Upload: `data.id` es la subida, `data.asset_id` el asset.
       */
      case "video.upload.asset_created": {
        const assetId = texto(data.asset_id);
        if (!assetId) break;
        tocado = await aplicarAlPost(
          admin,
          { uploadId: texto(data.id), passthrough: null },
          { mux_status: "processing", mux_asset_id: assetId },
          ["uploading"],
        );
        break;
      }

      /**
       * El video está listo. `data` es el Asset: `data.id` es el asset,
       * `data.upload_id` la subida de la que salió.
       */
      case "video.asset.ready": {
        const assetId = texto(data.id);
        const playbackId = playbackIdPublico(data.playback_ids);
        if (!assetId || !playbackId) {
          console.warn(
            `[mux:webhook] ${eventType} sin asset id o sin playback id público — se ignora.`,
          );
          break;
        }
        const segundos = duracion(data.duration);
        tocado = await aplicarAlPost(
          admin,
          { uploadId: texto(data.upload_id), passthrough: texto(data.passthrough) },
          {
            mux_status: "ready",
            mux_asset_id: assetId,
            mux_playback_id: playbackId,
            ...(segundos === null ? {} : { mux_duration_seconds: segundos }),
          },
          // `ready` incluido: una re-entrega escribe los mismos valores y es
          // inocua. `errored` NO: un duplicado tardío no resucita un video que
          // ya se dio por perdido.
          ["uploading", "processing", "ready"],
        );
        break;
      }

      /** Mux no pudo con el archivo. `data` es el Asset. */
      case "video.asset.errored": {
        tocado = await aplicarAlPost(
          admin,
          { uploadId: texto(data.upload_id), passthrough: texto(data.passthrough) },
          { mux_status: "errored" },
          ["uploading", "processing"],
        );
        break;
      }

      /**
       * La subida se canceló o venció sin que llegara el archivo. `data` es la
       * Direct Upload, así que acá NO hay `passthrough` que mirar.
       */
      case "video.upload.errored":
      case "video.upload.cancelled": {
        tocado = await aplicarAlPost(
          admin,
          { uploadId: texto(data.id), passthrough: null },
          { mux_status: "errored" },
          ["uploading"],
        );
        break;
      }

      default:
        // Mux manda decenas de eventos (tracks, subtítulos, analytics). Se
        // aceptan, quedan registrados en la bandeja y no hacen nada.
        break;
    }

    if (!tocado && eventType.startsWith("video.")) {
      // Sin PII: sólo el tipo de evento. Es esperable (subida abandonada, otro
      // entorno de Mux apuntando al mismo endpoint, evento fuera de orden), pero
      // una racha de estos es la primera señal de que la correlación se rompió.
      console.info(`[mux:webhook] ${eventType} no correlacionó con ninguna publicación.`);
    }

    await admin
      .from("mux_webhook_events")
      .update({ processed: true, ...(tocado ? { tenant_id: tocado.tenant_id } : {}) })
      .eq("provider", "mux")
      .eq("event_id", eventId);

    return NextResponse.json({ received: true });
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    console.error(`[mux:webhook] El handler de ${eventType} falló: ${detalle}`);
    /**
     * Se suelta el reclamo además de guardar el error. El de Stripe deja
     * `claimed_at` puesto y el reintento tiene que esperar los 5 minutos de
     * vencimiento; acá no hace falta esa espera: si estamos en el catch, el
     * proceso que reclamó el evento ya terminó y falló. Liberarlo deja que el
     * reintento de Mux —que llega en segundos— lo tome enseguida.
     */
    await admin
      .from("mux_webhook_events")
      .update({ processed: false, claimed_at: null, error: detalle })
      .eq("provider", "mux")
      .eq("event_id", eventId);

    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
