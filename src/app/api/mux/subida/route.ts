import { NextResponse } from "next/server";
import { isMuxConfigured } from "@/lib/config/services";
import { MUX_NEW_ASSET_SETTINGS, MUX_UPLOAD_TIMEOUT_SECONDS, getMux } from "@/lib/mux/client";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";

/**
 * =============================================================================
 * POST /api/mux/subida — pedir una Direct Upload para un video
 * =============================================================================
 *
 * CONTRATO (la UI depende de esto al pie de la letra):
 *
 *   POST /api/mux/subida
 *   → 200 { uploadId: string, uploadUrl: string, postDraftId: string }
 *   → 503 { error: "mux_no_configurado", message }   Mux sin claves
 *   → 401 { error: "sin_sesion", message }           sin sesión
 *   → 409 { error: "comunidad_distinta", message }   el JWT y el dominio no coinciden
 *   → 429 { error: "demasiadas_subidas", message }   techo por hora
 *   → 502 { error: "mux_falló", message }            Mux no respondió
 *
 * Después la UI hace `UpChunk.createUpload({ endpoint: uploadUrl, file })` y va
 * consultando el estado de la publicación `postDraftId` hasta que
 * `mux_status = 'ready'`.
 *
 * ── QUIÉN PUEDE ─────────────────────────────────────────────────────────────
 * CUALQUIER MIEMBRO con sesión. No es una ruta de admin: publicar un video es
 * lo que la gente viene a hacer. Lo que sí se exige es que la sesión exista y
 * que la comunidad del JWT coincida con el dominio desde el que se está
 * pidiendo, y las dos cosas las resuelve `requireTenantMatch()` — el mismo guard
 * que usa toda server action de escritura.
 *
 * ⚠️ EL `tenant_id` SALE DEL SERVIDOR Y DE NINGÚN OTRO LADO. No se lee del body,
 * no se lee de un query param, no se lee de un header. Sale de `guard.tenant.id`,
 * que a su vez sale del Host + el claim del JWT. Esta ruta ni siquiera parsea el
 * body: no hay un solo dato del cliente que entre a la fila que se escribe.
 *
 * ── ORDEN DE LOS PASOS, QUE NO ES ARBITRARIO ────────────────────────────────
 * 1. Chequeo de configuración. Es puro y no tiene efectos: va primero para que
 *    un 503 no consuma cupo de rate limit ni deje una fila colgada.
 * 2. `requireTenantMatch()` ANTES de cualquier efecto colateral, que es la regla
 *    escrita en `lib/tenant/guard.ts`: si el guard corriera después, el cupo
 *    consumido y el borrador creado quedarían huérfanos.
 * 3. Rate limit.
 * 4. Borrador → subida en Mux → id de la subida en el borrador.
 *
 * ── POR QUÉ EL BORRADOR VA ANTES QUE LA SUBIDA ──────────────────────────────
 * `passthrough` viaja a Mux cuando se crea la subida y vuelve en el webhook, así
 * que el id de la publicación tiene que existir ANTES. Y el id lo mintea la base
 * (`app.uuid_v7()`), no la app: los uuid v7 son ordenados en el tiempo y de ese
 * orden cuelga el índice del feed (`tenant_id, created_at desc, id desc`).
 * Inventar un v4 acá desordenaría el desempate del scroll infinito.
 *
 * Si Mux falla después del INSERT, el borrador se borra en el acto — un borrador
 * huérfano es invisible para todo el mundo, pero es basura, y basura que nadie
 * ve es basura que nadie limpia.
 */

export const runtime = "nodejs";

/**
 * Techo por hora y por persona.
 *
 * Más ajustado que el `post:` del composer (30/h) a propósito: publicar texto
 * cuesta una fila, y cada subida a Mux cuesta minutos de transcodificación que
 * se facturan aunque el video después no se publique. Diez por hora no lo nota
 * nadie subiendo videos de verdad y le pone piso a un script.
 *
 * Namespace propio (`mux-subida:`) y no compartido con `post:`: la regla del
 * limiter es una key por ACCIÓN. Compartirla haría que subir videos gastara el
 * cupo de escribir en el feed, que son dos cosas distintas.
 */
const SUBIDAS_POR_HORA = 10;

/**
 * De qué origen va a venir el PUT del navegador, para que Mux devuelva los CORS
 * correctos.
 *
 * Se arma con el host del propio request y NO con `NEXT_PUBLIC_SITE_URL`, porque
 * esto es multi-tenant: cada comunidad vive en su dominio y una constante de
 * build serviría a una sola. El `origin` que manda el navegador tampoco sirve
 * como fuente —lo elige el cliente—; el host sí llega normalizado por la
 * plataforma y es el mismo dato del que ya depende la resolución de comunidad.
 */
function origenDelRequest(request: Request): string {
  // Los `x-forwarded-*` pueden venir con varios valores separados por coma
  // cuando hay más de un proxy en la cadena; el primero es el del cliente.
  const primero = (valor: string | null) => valor?.split(",")[0]?.trim() || "";
  const host = primero(request.headers.get("x-forwarded-host")) || primero(request.headers.get("host"));
  if (!host) return process.env.NEXT_PUBLIC_SITE_URL ?? "";

  const reenviado = primero(request.headers.get("x-forwarded-proto"));
  // En local no hay proxy que setee el proto, y devolver `https://localhost:3000`
  // haría que el navegador descartara la respuesta CORS de Mux — o sea que el
  // camino de video andaría en producción y no en la máquina de quien lo escribe.
  const esLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const proto = reenviado || (esLocal ? "http" : "https");
  return `${proto}://${host}`;
}

export async function POST(request: Request) {
  // 1 · ¿Está encendido el camino de Mux? -----------------------------------
  if (!isMuxConfigured) {
    console.warn(
      "[mux:subida] Pedido de subida con Mux sin configurar (faltan MUX_TOKEN_ID y/o MUX_TOKEN_SECRET) — 503.",
    );
    return NextResponse.json(
      {
        error: "mux_no_configurado",
        message: "Estamos terminando de configurar la subida de videos. Probá de nuevo más tarde.",
      },
      { status: 503 },
    );
  }

  // 2 · Sesión y comunidad, las dos derivadas del servidor -------------------
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
  const { tenant, user } = guard;

  // 3 · Techo por hora -------------------------------------------------------
  if (!limit(`mux-subida:${user.id}`, SUBIDAS_POR_HORA, HOUR_MS).ok) {
    return NextResponse.json(
      {
        error: "demasiadas_subidas",
        message: "Subiste varios videos en poco tiempo. Esperá un rato y seguimos.",
      },
      { status: 429 },
    );
  }

  const admin = createAdminClient();

  /**
   * 4 · El borrador.
   *
   * Con `service_role` a propósito: `posts_insert` (0046) exige
   * `status in ('published','pending_review')`, o sea que un cliente NO puede
   * crear un borrador ni queriendo. Ese es el punto — el único camino a un
   * `draft` es éste, con el `tenant_id` y el `author_id` puestos por el servidor.
   *
   * `body: ""` porque el texto todavía no existe: la persona escribe el pie
   * mientras el video sube. El feed no lo ve (filtra `status='published'`) y su
   * autor sí (la rama de autor de `posts_select` no mira el status).
   *
   * `video_type` queda en NULL A PROPÓSITO. Decidir si el video es un corto
   * (≤ 90 s, va al scroll de Videos Cortos) o un video publicitario es una
   * decisión de la publicación, no de la subida, y 0046 la congela después del
   * INSERT: fijarla acá, antes de conocer la duración real, sería fijarla mal y
   * para siempre.
   */
  const { data: draft, error: draftError } = await admin
    .from("posts")
    .insert({
      tenant_id: tenant.id,
      author_id: user.id,
      body: "",
      kind: "post",
      status: "draft",
      mux_status: "uploading",
    })
    .select("id")
    .single();

  if (draftError || !draft) {
    console.error(
      `[mux:subida] No se pudo crear el borrador — code=${draftError?.code ?? "desconocido"}`,
    );
    return NextResponse.json(
      {
        error: "borrador_falló",
        message: "No pudimos preparar la publicación. Probá de nuevo en un momento.",
      },
      { status: 500 },
    );
  }

  // 5 · La subida en Mux -----------------------------------------------------
  let uploadId: string;
  let uploadUrl: string;
  try {
    const upload = await getMux().video.uploads.create({
      cors_origin: origenDelRequest(request),
      timeout: MUX_UPLOAD_TIMEOUT_SECONDS,
      new_asset_settings: {
        ...MUX_NEW_ASSET_SETTINGS,
        playback_policies: [...MUX_NEW_ASSET_SETTINGS.playback_policies],
        /**
         * El id del borrador vuelve tal cual en el webhook. Es una COMODIDAD,
         * no una credencial: en el webhook se trata como dato de afuera y la
         * correlación de verdad se hace por `mux_upload_id`, que es un id que
         * mintea Mux y que nosotros guardamos con nuestras propias manos.
         */
        passthrough: draft.id,
      },
    });

    if (!upload.url) {
      throw new Error(`Mux devolvió la subida ${upload.id} sin url`);
    }
    uploadId = upload.id;
    uploadUrl = upload.url;
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    console.error(`[mux:subida] Mux rechazó la creación de la subida: ${detalle}`);
    // El borrador ya no lleva a ningún lado: se borra acá y no se deja para un
    // barrido futuro que nadie escribió todavía.
    const { error: limpiezaError } = await admin.from("posts").delete().eq("id", draft.id);
    if (limpiezaError) {
      console.error(
        `[mux:subida] Quedó un borrador huérfano ${draft.id} — code=${limpiezaError.code}`,
      );
    }
    return NextResponse.json(
      {
        error: "mux_falló",
        message: "No pudimos preparar la subida del video. Probá de nuevo en un momento.",
      },
      { status: 502 },
    );
  }

  /**
   * 6 · El id de la subida en el borrador.
   *
   * Este UPDATE es lo que hace posible el webhook: sin `mux_upload_id` grabado,
   * el evento que llegue dentro de un minuto no tiene con qué encontrar esta
   * publicación. Por eso, si falla, no se sigue: se cancela la subida en Mux
   * (para que no quede una URL viva que produzca un asset que nadie va a poder
   * reclamar) y se borra el borrador.
   */
  const { error: enlaceError } = await admin
    .from("posts")
    .update({ mux_upload_id: uploadId })
    .eq("id", draft.id);

  if (enlaceError) {
    console.error(
      `[mux:subida] No se pudo enlazar la subida ${uploadId} con el borrador — code=${enlaceError.code}`,
    );
    try {
      await getMux().video.uploads.cancel(uploadId);
    } catch (cancelError) {
      const detalle = cancelError instanceof Error ? cancelError.message : String(cancelError);
      console.error(`[mux:subida] Tampoco se pudo cancelar la subida ${uploadId}: ${detalle}`);
    }
    const { error: limpiezaError } = await admin.from("posts").delete().eq("id", draft.id);
    if (limpiezaError) {
      console.error(
        `[mux:subida] Quedó un borrador huérfano ${draft.id} — code=${limpiezaError.code}`,
      );
    }
    return NextResponse.json(
      {
        error: "mux_falló",
        message: "No pudimos preparar la subida del video. Probá de nuevo en un momento.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ uploadId, uploadUrl, postDraftId: draft.id });
}
