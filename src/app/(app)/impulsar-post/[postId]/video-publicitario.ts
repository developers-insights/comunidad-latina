"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isVisionConfigured } from "@/lib/config/services";
import { registerUploadedMedia, type MediaItem } from "@/lib/integrity";
import { currentSourceHost } from "@/lib/integrity/source-host";
import { isOwnPosterPath, isOwnVideoPath } from "@/lib/media/own-media-path";
import { POST_MEDIA_BUCKET } from "@/lib/media/upload-video";
import {
  MAX_VIDEO_BYTES,
  formatVideoTooBigMessage,
} from "@/lib/media/video-upload-limits";
import {
  DEFAULT_VIDEO_CATEGORY,
  VIDEO_CATEGORIES,
  checkVideoDuration,
} from "@/lib/media/video-policy";
import { TIER_HUMAN, enqueueModeration } from "@/lib/moderation";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { mediaKindOf } from "@/components/feed/helpers";
import { COPY_VIDEO_PUBLICITARIO as COPY } from "./copy-video";

/**
 * =============================================================================
 * EL VIDEO LARGO DE UNA CAMPAÑA PAGA — la única puerta que existe
 * =============================================================================
 *
 * «Cuando alguien va a publicidad puede subir un video de 5 minutos… tú ves
 *  cuando van a hacer un boost, una campaña, que dice que puede subir cierta
 *  cantidad de fotos y un video de 5 minutos.»
 * «Solamente el que paga la publicidad puede subir un video de hasta 5 minutos.»
 *                                    (Cliente, 2026-09-03, 19:40–23:44.)
 *
 * ---- POR QUÉ ESTO NO PUEDE VIVIR EN EL COMPOSER ---------------------------
 *
 * No es una decisión de diseño: la base no lo permite, y con razón. Un post NO
 * PUEDE NACER publicitario —`app.posts_validate_video()` (0046, re-creada en
 * 0048) rechaza el INSERT con `video_type='advertising_video'` SIEMPRE, incluso
 * con service_role— porque la campaña referencia al post y en el INSERT todavía
 * no existe. Declararse publicitario es una TRANSICIÓN posterior y sólo vale si
 * la campaña ya está.
 *
 * Y como el CHECK `posts_short_video_duration` clava los cortos en 90 s, un
 * video de cinco minutos NO TIENE NINGUNA FORMA LEGAL de entrar por el
 * composer. Ofrecerlo ahí sería un botón que rebota contra un 23514.
 *
 * Tampoco hay "autor premium" del que colgar el permiso: `tier.ts` es el tier de
 * un AVISO (`listings.tier`), no de una persona. Los 300 s de premium son el
 * video del detalle de un aviso; los 600 s son los del video publicitario, que
 * es lo que se está creando acá.
 *
 * ---- LAS CUATRO COLUMNAS VAN JUNTAS O NO VA NINGUNA -----------------------
 *
 * `posts_advertising_video_rules` exige las tres cosas a la vez: duración ≤600,
 * `is_paid_ad = true` y `eligible_for_short_feed = false`. No es burocracia —
 * es lo que garantiza que un video de diez minutos pagado NO se cuele en el
 * scroll de Videos Cortos, que es la superficie que la 0046 vino a proteger.
 *
 * ---- POR QUÉ EL UPDATE VA CON EL ADMIN CLIENT -----------------------------
 *
 * `app.protect_post_counters()` congela las cuatro columnas para `authenticated`
 * con un mensaje que dice exactamente esto: «pasar a publicitario es una
 * transición de campaña (server-side)». El admin client NO es acá un atajo de
 * permisos: es el rol que la migración eligió para esta transición, igual que
 * para `boosts.status` o `listings.tier`. Todo lo que decide QUIÉN puede —dueño
 * del post, post publicado, campaña activa— se comprueba ARRIBA, con el cliente
 * del usuario y su RLS.
 *
 * ---- QUÉ NO HACE ESTA ACTION ----------------------------------------------
 *
 * No cobra nada. El pago ya ocurrió: `crearCampanaPost` (actions.ts) lleva al
 * Checkout y el webhook activa la campaña. Acá sólo se exige que ESA campaña
 * esté activa y vigente. Inventar un segundo cobro por el video sería cobrar dos
 * veces lo mismo.
 */

/** Techo horario: cada intento sube un archivo grande al bucket. */
const AD_VIDEO_HOURLY_LIMIT = 6;

/**
 * Techo del PCM de audio que se acepta para la huella (mismo número que
 * `feed/actions.ts`): 4 millones de caracteres son ~3 MB de base64. Lo que pase
 * de ahí no es la pista de un video sino alguien probando qué aguanta.
 */
const MAX_AUDIO_PCM_CHARS = 4_000_000;

const schema = z.object({
  postId: z.uuid(),
  /** Ruta ya subida en post-media. Se comprueba que sea del prefijo propio. */
  videoPath: z.string().min(3).max(300),
  /** Duración MEDIDA por el navegador antes de subir. Se re-valida acá. */
  durationSeconds: z.coerce.number().finite().positive().max(36_000),
  /** Fotograma de portada (0132). Opcional: sin él la superficie cae a su respaldo. */
  posterPath: z.string().min(3).max(300).nullish(),
  videoCategory: z.enum(VIDEO_CATEGORIES).optional(),
  /**
   * Insumos de Content Integrity, los MISMOS que manda el composer: los
   * fotogramas en gris y la pista de audio muestreados en el navegador sobre el
   * archivo original. Ausentes = el video queda sin huella perceptual y va a
   * revisión humana — que es exactamente lo que hace el feed, y por eso viajan.
   * Un video publicitario que esquive el pipeline que revisa a los demás sería
   * el único contenido de la plataforma sin huella, y encima uno pago.
   */
  videoFrames: z.string().max(2_000_000).nullish(),
  audioPcm: z.string().max(MAX_AUDIO_PCM_CHARS).nullish(),
});

export type AdjuntarVideoResult =
  | { status: "ok" }
  | { status: "sin_sesion" }
  /** Sin campaña activa: el video largo es de quien paga la publicidad. */
  | { status: "sin_campana" }
  | { status: "error"; message: string };

/**
 * Fila de `posts` que esta action necesita mirar. Se escribe a mano porque el
 * SELECT pide columnas que `database.types.ts` todavía no conoce
 * (`video_poster_path`, 0132) y el archivo se regenera aparte.
 */
interface PostRowParaVideo {
  id: string;
  tenant_id: string;
  author_id: string | null;
  status: string;
  media: string[] | null;
  mux_status: string | null;
}

export async function adjuntarVideoPublicitario(
  input: unknown,
): Promise<AdjuntarVideoResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: COPY.errorGenerico };
  }
  const { postId, videoPath, posterPath, videoCategory } = parsed.data;

  /**
   * LA DURACIÓN, ANTES QUE NADA. Es lo único que puede rechazar el pedido sin
   * mirar la base, y el motivo por el que existe toda esta pantalla. El tope es
   * el del TIPO que se va a guardar (`advertising_video` ⇒ 600 s), no un número
   * escrito acá: `video-policy.ts` es el único lugar donde viven los cuatro.
   *
   * Se re-valida en el servidor aunque el navegador ya lo hizo, por lo mismo que
   * lo hace `createPostAction`: un cliente modificado que mande 3600 no publica.
   *
   * LO QUE ESTE CHEQUEO NO PUEDE HACER, DICHO SIN ADORNOS: no mide el archivo.
   * `durationSeconds` es un valor DECLARADO por el navegador (lo dice la propia
   * 0046) y el servidor sólo puede comprobar que el número declarado entre en el
   * tope. Un cliente modificado que suba un video de veinte minutos y declare
   * 300 pasa. Medirlo de verdad pide transcodificar del lado del servidor, que
   * es exactamente lo que hace Mux — y hasta que Mux cubra esta ruta, esto es un
   * tope declarativo y no una medición. El PESO, en cambio, sí se mide sobre el
   * objeto ya subido (paso 2.bis), porque Storage sí sabe cuánto pesa.
   */
  const duracion = checkVideoDuration("advertising_video", parsed.data.durationSeconds);
  if (!duracion.ok) {
    return {
      status: "error",
      message: duracion.reason === "too-long" ? COPY.errorMuyLargo : COPY.errorDuracion,
    };
  }

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { status: "sin_sesion" };
    return { status: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`adVideo:${user.id}`, AD_VIDEO_HOURLY_LIMIT, HOUR_MS).ok) {
    return { status: "error", message: COPY.errorMuchosIntentos };
  }

  /**
   * PERTENENCIA DE LOS ARCHIVOS. `videoPath` y `posterPath` llegan por el body:
   * el bucket es público de lectura, así que sin este chequeo cualquiera con un
   * token de la comunidad podría colgarle a SU publicación el archivo de otra
   * persona. Misma regla —y mismo módulo— que usa el composer al publicar.
   */
  if (!isOwnVideoPath(videoPath, tenant.id, user.id)) {
    return { status: "error", message: COPY.errorGenerico };
  }
  if (posterPath && !isOwnPosterPath(posterPath, tenant.id, user.id)) {
    return { status: "error", message: COPY.errorGenerico };
  }

  try {
    // 1. La publicación, con la RLS del usuario: si no es suya, para él no existe.
    const { data, error: postError } = await supabase
      .from("posts")
      .select("id, tenant_id, author_id, status, media, mux_status")
      .eq("id", postId)
      .maybeSingle();
    const post = data as unknown as PostRowParaVideo | null;

    if (postError || !post || post.tenant_id !== tenant.id || post.author_id !== user.id) {
      return { status: "error", message: COPY.errorNoEsTuyo };
    }
    if (post.status !== "published") {
      return { status: "error", message: COPY.errorNoPublicado };
    }
    /**
     * UN VIDEO POR PUBLICACIÓN, Y UNA SOLA RUTA DE ENTREGA. Si el video de esta
     * publicación viaja por Mux, el archivo del bucket sería un SEGUNDO video
     * sobre la misma fila: dos fuentes, dos duraciones y una tarjeta que no sabe
     * cuál pintar. Se dice que no, con nombre y apellido, en vez de dejar que la
     * superficie elija por su cuenta.
     */
    if (post.mux_status) {
      return { status: "error", message: COPY.errorYaTieneMux };
    }

    /**
     * 2. LA CAMPAÑA — el gate que sostiene toda la feature.
     *
     * ACTIVA Y VIGENTE, no "existe una fila". El trigger de la base se conforma
     * con que haya una `post_promotions` de cualquier estado, y eso alcanzaría
     * para que alguien empiece un Checkout, lo abandone y se quede con el video
     * de diez minutos gratis. La regla del producto es la que dijo el cliente:
     * el video largo es de quien PAGÓ la publicidad.
     *
     * Es la MISMA consulta que hace la página para decidir si muestra el panel;
     * está en los dos lados a propósito — allá es UX, acá es la que manda.
     */
    const { data: campana } = await supabase
      .from("post_promotions")
      .select("id")
      .eq("post_id", post.id)
      .eq("tenant_id", tenant.id)
      .eq("status", "active")
      .gt("ends_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();
    if (!campana) return { status: "sin_campana" };

    /**
     * 2.bis EL PESO DEL ARCHIVO, MEDIDO SOBRE EL OBJETO QUE YA ESTÁ EN EL BUCKET.
     *
     * Esta action no recibe el archivo: recibe la RUTA de algo que el navegador
     * subió por su cuenta (`uploadVideoWithProgress`, XHR directo a Storage).
     * O sea que el tope de 200 MB que chequea `checkVideoFile` vivía ENTERO en
     * el JavaScript del cliente, y saltearlo era escribir el `fetch` a mano.
     *
     * `list` con `search` es la forma de leer el tamaño de UN objeto: la API de
     * Storage no expone un "stat". Va con el admin client porque lo único que
     * decide es un número —el permiso ya se resolvió arriba, con el cliente del
     * usuario y su RLS— y porque un `list` sobre la carpeta ajena con el
     * cliente del usuario devolvería vacío y no "no existe", que son dos cosas
     * distintas y acá conviene distinguirlas.
     *
     * Un objeto que NO ESTÁ también se rechaza: sin esto, alguien podría colgar
     * de su publicación una ruta inventada de su propia carpeta y dejar la
     * tarjeta con un video roto para toda la comunidad.
     *
     * `MAX_VIDEO_BYTES` es el mismo número que la 0135 le puso al bucket
     * (`file_size_limit`). Son tres candados sobre la misma regla y ninguno
     * sobra: el navegador da el mensaje escrito, Storage rechaza la subida, y
     * esto impide que un archivo que entró por otra puerta se publique.
     */
    const admin = createAdminClient();
    const carpeta = videoPath.slice(0, videoPath.lastIndexOf("/"));
    const archivo = videoPath.slice(videoPath.lastIndexOf("/") + 1);
    const { data: objetos, error: listError } = await admin.storage
      .from(POST_MEDIA_BUCKET)
      .list(carpeta, { search: archivo, limit: 100 });

    if (listError) {
      console.error(
        `[video-publicitario] no se pudo leer el objeto — tenant=${tenant.slug}`,
        listError.message,
      );
      return { status: "error", message: COPY.errorGenerico };
    }

    // `search` es un LIKE, no una igualdad: "clip.mp4" también matchea
    // "clip.mp4.bak". Se busca el nombre exacto.
    const objeto = (objetos ?? []).find((item) => item.name === archivo);
    if (!objeto) {
      return { status: "error", message: COPY.errorGenerico };
    }

    const bytes = objeto.metadata?.size;
    if (typeof bytes !== "number" || bytes > MAX_VIDEO_BYTES) {
      return {
        status: "error",
        message:
          typeof bytes === "number"
            ? formatVideoTooBigMessage(bytes)
            : COPY.errorGenerico,
      };
    }

    /**
     * 3. EL NUEVO `media`: las fotos que ya estaban, y este video al final.
     *
     * El video ANTERIOR (si lo había) se reemplaza y no se acumula: el composer
     * acepta un video por publicación y la tarjeta pinta uno. Su archivo queda
     * en el bucket, dentro del prefijo de su propio dueño — borrarlo desde acá
     * sería destruir el original de alguien por un cambio que puede querer
     * deshacer, y no hay pantalla para deshacerlo.
     */
    const fotos = (post.media ?? []).filter(
      (path) => typeof path === "string" && path.trim() && mediaKindOf(path) !== "video",
    );
    const media = [...fotos, videoPath];

    /**
     * 4. LA TRANSICIÓN. Las cuatro columnas de la 0046 se escriben JUNTAS o el
     * CHECK `posts_advertising_video_rules` rebota — y ese rebote es correcto:
     * un video publicitario que no esté marcado como pago, o que no esté fuera
     * del scroll, no es un video publicitario.
     */
    const payload = {
      media,
      video_type: "advertising_video",
      duration_seconds: duracion.seconds,
      is_paid_ad: true,
      eligible_for_short_feed: false,
      video_category: videoCategory ?? DEFAULT_VIDEO_CATEGORY,
      // 0132. Va explícito incluso en null: es un UPDATE, y un campo ausente
      // dejaría el poster del video ANTERIOR pintado sobre el nuevo.
      video_poster_path: posterPath ?? null,
    };
    const { data: actualizadas, error: updateError } = await (
      admin as unknown as SupabaseClient
    )
      .from("posts")
      .update(payload)
      .eq("id", post.id)
      .eq("tenant_id", tenant.id)
      .select("id");

    if (updateError || (actualizadas ?? []).length === 0) {
      console.error(
        `[video-publicitario] no se pudo adjuntar el video — tenant=${tenant.slug} code=${updateError?.code ?? "sin-filas"}`,
      );
      return { status: "error", message: COPY.errorGenerico };
    }

    /**
     * 5. CONTENT INTEGRITY Y REVISIÓN — el mismo pipeline que el composer.
     *
     * Best-effort de punta a punta: el video YA está publicado y nada de esto
     * puede deshacerlo. Lo único que puede pasar es que pida ojos humanos, y eso
     * viaja a la cola con su motivo. Que un video PAGO no pasara por acá lo
     * convertiría en el único contenido de la plataforma sin huella.
     */
    await revisarVideo({
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      userId: user.id,
      postId: post.id,
      videoPath,
      videoFrames: parsed.data.videoFrames ?? null,
      audioPcm: parsed.data.audioPcm ?? null,
    });

    revalidatePath(`/feed/${post.id}`);
    revalidatePath(`/impulsar-post/${post.id}`);
    revalidatePath("/videos/largos");
    return { status: "ok" };
  } catch (error) {
    console.error(
      `[video-publicitario] error adjuntando el video — tenant=${tenant.slug}`,
      error instanceof Error ? error.message : error,
    );
    return { status: "error", message: COPY.errorGenerico };
  }
}

/**
 * Huella del archivo + cola de moderación. Separada de la action por una razón
 * concreta: acá adentro NADA puede romper la publicación, y tener el `try`
 * alrededor de todo el bloque lo deja escrito de una forma que no se puede
 * confundir al leerla.
 *
 * Sin Vision configurado el video se publica igual y entra a la cola humana —
 * exactamente el mismo trato que le da el composer a cualquier foto o video, y
 * por el mismo motivo: la revisión previa mataba el feed visual.
 */
async function revisarVideo(args: {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  postId: string;
  videoPath: string;
  videoFrames: string | null;
  audioPcm: string | null;
}): Promise<void> {
  try {
    let frames: unknown = null;
    if (args.videoFrames) {
      try {
        frames = JSON.parse(args.videoFrames);
      } catch {
        frames = null;
      }
    }

    const item: MediaItem = {
      mediaKind: "video",
      storageBucket: POST_MEDIA_BUCKET,
      storagePath: args.videoPath,
      videoLumaFrames: frames,
      audioPcm: args.audioPcm,
    };

    const integrity = await registerUploadedMedia({
      tenantId: args.tenantId,
      uploaderId: args.userId,
      subjectKind: "post",
      subjectId: args.postId,
      sourceHost: await currentSourceHost(args.tenantSlug),
      items: [item],
    });

    const necesitaOjos = !isVisionConfigured || integrity.needsHumanReview;
    if (!necesitaOjos) return;

    await enqueueModeration(createAdminClient(), {
      tenantId: args.tenantId,
      subjectKind: "post",
      subjectId: args.postId,
      aiScore: null,
      // La misma clave que usa el feed para un video sin screening previo, más
      // los motivos que devuelva la huella. El equipo ve por qué está ahí.
      reasons: ["video_async_review", ...integrity.reasons],
      tier: TIER_HUMAN,
    });
  } catch (error) {
    console.error(
      "[video-publicitario] el video quedó publicado pero no se pudo revisar",
      error instanceof Error ? error.message : error,
    );
  }
}
