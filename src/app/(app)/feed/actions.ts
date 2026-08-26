"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { getCaraActiva } from "@/lib/perfil-activo/cara";
import { isVisionConfigured } from "@/lib/config/services";
import {
  DEFAULT_VIDEO_CATEGORY,
  VIDEO_CATEGORIES,
  VIDEO_TYPES,
  checkVideoDuration,
  type DurationRejection,
} from "@/lib/media/video-policy";
import {
  MAX_PHOTOS,
  MAX_VIDEOS,
  checkPhotoPayload,
} from "@/lib/media/post-media-limits";
import { VIDEO_FILENAME_PATTERN } from "@/lib/media/video-upload-limits";
import { parseMediaFilterRef, type MediaFilterRef } from "@/lib/media/photo-filters";
import {
  TIER_HUMAN,
  TIER_REVIEW,
  enqueueModeration,
  moderateText,
  moderationTier,
  TIER_AUTO,
} from "@/lib/moderation";
import {
  normalizeDeclaration,
  registerUploadedMedia,
  type MediaItem,
} from "@/lib/integrity";
import { currentSourceHost } from "@/lib/integrity/source-host";
import { puedeFirmarComo } from "@/lib/feed/autoria";
import { notifyPostComment, notifyPostReaction } from "./social-notifications";

/**
 * Server actions del módulo FEED SOCIAL.
 *
 * Reglas que gobiernan este archivo:
 * - Todo INSERT/UPDATE de contenido va con el cliente server del usuario
 *   (anon + cookies): RLS es la frontera real. La foto del post ahora sube al
 *   bucket post-media (0025) con el cliente del USUARIO (path {tenant}/{user}/…),
 *   así que ya no hay desvío por admin client para storage.
 * - Todo texto pasa por moderateText ANTES de decidir el status (§8).
 * - El admin client aparece SOLO para encolar en moderation_queue (RLS
 *   insert=false para usuarios) — uso permitido §6.
 *
 * FLUJO DE MODERACIÓN (feedback cliente 2026-07-19):
 * - Publicación INSTANTÁNEA de posts con foto: sin Vision configurado el post
 *   NACE 'published' y se encola para revisión asíncrona (tier humano). El
 *   pending_review con foto mataba el feed visual; la red de seguridad son
 *   reporte en 2 taps, bloqueos, sanciones y el panel /admin/moderacion.
 * - Si Vision SÍ está configurado, se mantiene el screening síncrono actual (la
 *   foto no fuerza revisión acá). El TEXTO sí gobierna pending_review: flagged
 *   o tier humano NO se publica hasta que un humano lo resuelva.
 *
 * DESVÍO DOCUMENTADO (gana el contrato de la DB):
 * - Comentario flagged: la policy comments_insert solo permite nacer
 *   'published' — no existe 'pending_review' para el JWT del autor. Se sigue
 *   el precedente de MENSAJES: el comentario NO se inserta, el intento se
 *   encola (tier 3, body en reasons) y el usuario recibe un aviso cálido
 *   para reformular.
 */

const GENERIC_INVALID = "invalid" as const;

// ---------------------------------------------------------------------------
// Crear post (composer del feed)
// ---------------------------------------------------------------------------

const postSchema = z.object({
  /**
   * El cuerpo puede venir VACÍO (feedback cliente 2026-08-05: "si la persona no
   * quiere subir ningún texto relacionado, que le deje publicar"). El esquema
   * ya no puede exigir un mínimo acá porque el mínimo DEPENDE de si la
   * publicación trae medio, y eso recién se sabe después de leer las fotos y
   * los paths de video del FormData: la regla real vive abajo, en
   * `bodyIsPublishable`, y este pipe se queda solo con el techo de 2000.
   */
  body: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(2000)),
  kind: z.enum(["post", "question", "text"]),
  /**
   * Encuesta Sí/No de una PREGUNTA (contrato 0041). Ausente = pregunta sin
   * encuesta. El check de la DB solo acepta 'yes_no'; que un post común no
   * pueda traerla se valida abajo, después de parsear.
   */
  pollKind: z.enum(["yes_no"]).optional(),
  /** Publicar COMO esta entidad (listing propio published) — RLS lo valida. */
  entityId: z.uuid().optional(),
  /**
   * DECLARACIÓN DE VIDEO (contrato 0046). Todo post con media de video tiene
   * que declarar QUÉ es y CUÁNTO dura o el INSERT rebota contra el CHECK
   * `posts_video_declaration`. Los tres campos son opcionales en el borde
   * porque la mayoría de las publicaciones no traen video; abajo se exigen
   * cuando corresponde.
   */
  videoType: z.enum(VIDEO_TYPES).optional(),
  /** Duración DECLARADA por el navegador (metadata del archivo), en segundos. */
  durationSeconds: z.coerce.number().finite().positive().max(36_000).optional(),
  videoCategory: z.enum(VIDEO_CATEGORIES).optional(),
});

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
/**
 * El CUPO y el PESO de las fotos NO se escriben acá: viven en
 * `@/lib/media/post-media-limits`, que es el mismo módulo que importa el
 * composer. Estuvieron duplicados (10 en el cliente, 4 acá) y publicar con
 * fotos quedó roto; que sea un solo lugar es lo que impide que vuelva a pasar.
 * `checkPhotoPayload` es la regla completa —cupo, techo por archivo y techo del
 * conjunto—: acá corre sobre lo que REALMENTE llegó, que es lo único que vale.
 */

/**
 * Path de video en post-media que este server ACEPTA en posts.media:
 * exactamente {tenant}/{user}/{archivo}.{extensión}, sin traversal posible.
 * El prefijo se valida contra el tenant del guard y el user del JWT — el
 * cliente no puede colar un path ajeno (y la policy 0025 ya lo habría
 * rechazado al subir; esto es defensa en profundidad al PERSISTIR).
 *
 * Las extensiones válidas salen de `VIDEO_FILENAME_PATTERN`
 * (`@/lib/media/video-upload-limits`) — el MISMO catálogo que decide qué
 * deja elegir el `accept` del composer. Estuvo hardcodeado acá como
 * `(mp4|webm)` mientras el composer ya aceptaba más formatos (.mov de
 * iPhone, entre otros): el picker dejaba elegir el archivo y esta regex lo
 * rechazaba en silencio recién al publicar, con un `code: "photo"` genérico
 * que no explicaba nada.
 */
function isOwnVideoPath(path: string, tenantId: string, userId: string): boolean {
  const segments = path.split("/");
  if (segments.length !== 3) return false;
  const [tenantSegment, userSegment, filename] = segments;
  return (
    tenantSegment === tenantId &&
    userSegment === userId &&
    VIDEO_FILENAME_PATTERN.test(filename) &&
    !filename.includes("..")
  );
}

/**
 * ¿ESTE CUERPO SE PUEDE PUBLICAR? La frontera real de la regla "el texto es
 * opcional cuando hay foto o video" (feedback cliente 2026-08-05).
 *
 *  · Sin medio no hay publicación posible sin texto: una pregunta, un texto o
 *    un post vacíos no son nada. Sigue el mínimo histórico de 2 caracteres.
 *  · Con medio, el vacío es una respuesta válida —la foto ES la publicación,
 *    igual que en Instagram— pero un cuerpo de UN carácter no: es casi siempre
 *    un roce sin querer, y aceptarlo llenaría el feed de pies "a".
 *
 * `body` llega ya trimmeado por el esquema. NO se exporta: este archivo es
 * `"use server"` y Next sólo admite exports async (serían endpoints).
 */
function bodyIsPublishable(body: string, hasMedia: boolean): boolean {
  if (body.length === 0) return hasMedia;
  return body.length >= 2;
}

/** Orden de los medios tal como los eligió el usuario ("photo" | "video"). */
const mediaOrderSchema = z.array(z.enum(["photo", "video"])).max(MAX_PHOTOS + MAX_VIDEOS);

/**
 * Reconstruye posts.media respetando el orden de selección del usuario.
 * Si el orden no cuadra con lo recibido (cliente viejo o payload raro), cae
 * al orden natural: fotos primero, video al final. Nunca pierde un medio.
 */
function buildMediaInOrder(
  order: Array<"photo" | "video">,
  photoPaths: string[],
  videoPaths: string[],
): string[] {
  const photoCount = order.filter((kind) => kind === "photo").length;
  const videoCount = order.filter((kind) => kind === "video").length;
  if (photoCount !== photoPaths.length || videoCount !== videoPaths.length) {
    return [...photoPaths, ...videoPaths];
  }
  const photos = [...photoPaths];
  const videos = [...videoPaths];
  return order
    .map((kind) => (kind === "photo" ? photos.shift() : videos.shift()))
    .filter((path): path is string => Boolean(path));
}

export type CreatePostResult =
  | {
      ok: true;
      status: "published" | "pending_review";
      /** Id del post creado — el composer arma el link a /impulsar-post. */
      postId: string;
      /** true si se publicó COMO una entidad (ofrecer promoción). */
      entity: boolean;
    }
  | {
      ok: false;
      /**
       * `entity`: se pidió firmar la publicación con una ficha que no es de
       * quien firma, que no está publicada o que no es de esta comunidad (ver
       * `puedeFirmarComo`). Es un código PROPIO y no `invalid` a propósito: son
       * dos arreglos distintos —uno se arregla escribiendo más, el otro
       * eligiendo otro perfil— y un solo código obligaría al composer a
       * adivinar cuál de los dos mensajes mostrar.
       */
      code:
        | "invalid"
        | "unauthenticated"
        | "photo"
        | "entity"
        | "error"
        | "rate-limited";
    }
  /**
   * El video no cumple la política de duración (`src/lib/media/video-policy.ts`).
   * `reason` viaja para que el composer muestre el mensaje EXACTO de la spec en
   * vez de un "no se pudo publicar" genérico: son dos problemas distintos —el
   * video es muy largo, o no se pudo saber cuánto dura— y tienen dos salidas
   * distintas para la persona.
   */
  | { ok: false; code: "video"; reason: DurationRejection }
  /** El JWT y el header apuntan a comunidades distintas — copy ya resuelto. */
  | { ok: false; code: "tenant-mismatch"; message: string };

function devAutoApprove(): boolean {
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  return process.env.MODERATION_DEV_AUTO_APPROVE === "true" && !isProduction;
}

// ---------------------------------------------------------------------------
// Subida directa de video (sprint reels 2026-07-21)
// ---------------------------------------------------------------------------

export type PrepareMediaUploadResult =
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; code: "unauthenticated" | "error" }
  | { ok: false; code: "tenant-mismatch"; message: string };

/**
 * El video se sube DIRECTO del navegador al bucket post-media (evita el límite
 * de body de las server actions), pero el prefijo {tenant}/{user} del path
 * sale de ACÁ — del guard y del JWT — nunca del cliente. La policy
 * post_media_insert (0025) re-valida ambos segmentos al subir; esto además
 * corta ANTES el caso tenant-mismatch, sin gastar el intento de storage.
 */
export async function prepareMediaUploadAction(): Promise<PrepareMediaUploadResult> {
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error" };
  }
  return { ok: true, tenantId: guard.tenant.id, userId: guard.user.id };
}

export async function createPostAction(formData: FormData): Promise<CreatePostResult> {
  const parsed = postSchema.safeParse({
    body: formData.get("body"),
    kind: formData.get("kind"),
    pollKind: formData.get("pollKind") || undefined,
    entityId: formData.get("entityId") || undefined,
    videoType: formData.get("videoType") || undefined,
    durationSeconds: formData.get("durationSeconds") || undefined,
    videoCategory: formData.get("videoCategory") || undefined,
  });
  if (!parsed.success) return { ok: false, code: GENERIC_INVALID };
  const { body, kind, entityId } = parsed.data;
  // Solo una PREGUNTA puede llevar encuesta: en cualquier otro kind el campo se
  // ignora (no se confía en el cliente ni para esto).
  const pollKind = kind === "question" ? (parsed.data.pollKind ?? null) : null;

  // Fotos: hasta `MAX_PHOTOS` por publicación (2026-08-11, antes 4). Se acepta
  // el campo legado `photo` (singular) por si un cliente viejo sigue en vuelo.
  const photoEntries = [...formData.getAll("photos"), formData.get("photo")];
  const photos = photoEntries.filter(
    (entry): entry is File => entry instanceof File && entry.size > 0,
  );
  // Cupo + peso (por archivo y del conjunto) con la MISMA función que corre el
  // navegador antes de mandar. Allá es cortesía —para que el aviso sea legible—
  // y acá es la frontera: el cliente no es confiable. Corre ANTES del guard, de
  // la moderación y de Storage: un payload que no se puede publicar no gasta
  // plata ajena.
  if (!checkPhotoPayload(photos.map((photo) => photo.size)).ok) {
    return { ok: false, code: "photo" };
  }
  for (const photo of photos) {
    if (!PHOTO_TYPES[photo.type]) return { ok: false, code: "photo" };
  }

  // Video: el navegador ya lo subió DIRECTO a post-media (la policy 0025 validó
  // el prefijo {tenant}/{user} con el JWT); acá llega solo el path. La
  // pertenencia real se re-valida tras el guard, cuando conocemos tenant/user.
  let videoPaths: string[] = [];
  try {
    const raw = formData.get("videoPaths");
    if (typeof raw === "string" && raw.length > 0) {
      const parsedPaths = z.array(z.string().min(3).max(300)).max(MAX_VIDEOS).parse(
        JSON.parse(raw),
      );
      videoPaths = parsedPaths;
    }
  } catch {
    return { ok: false, code: "photo" };
  }

  /**
   * FILTRO DEL VIDEO (0104) — un arreglo PARALELO a `videoPaths`, cada entrada
   * `null` o `{ id, intensity }`.
   *
   * Es paralelo a los paths y no un objeto ya armado por el cliente para que la
   * clave —la ruta dentro del bucket— la escriba SIEMPRE este servidor, con los
   * mismos paths que ya validó como propios más abajo (`isOwnVideoPath`). Si el
   * cliente mandara el objeto, podría poner de clave la ruta del video de otra
   * persona y pintarle un filtro encima.
   *
   * SE RECHAZA, NO SE LIMPIA. Un id fuera del catálogo o una intensidad fuera de
   * rango no es un usuario: es un cliente que no es el nuestro. Publicar igual
   * sin el filtro le enseñaría que puede mandar cualquier cosa mientras el
   * servidor lo tape. Y un largo que no coincide con los videos recibidos
   * significa que ya no sabemos qué filtro es de qué archivo — eso tampoco se
   * adivina.
   */
  let videoFilters: Array<MediaFilterRef | null> = [];
  try {
    const raw = formData.get("videoFilters");
    if (typeof raw === "string" && raw.length > 0) {
      const decoded: unknown = JSON.parse(raw);
      if (!Array.isArray(decoded) || decoded.length !== videoPaths.length) {
        return { ok: false, code: GENERIC_INVALID };
      }
      const validated: Array<MediaFilterRef | null> = [];
      for (const entry of decoded) {
        const parsed = parseMediaFilterRef(entry);
        if (!parsed.ok) return { ok: false, code: GENERIC_INVALID };
        validated.push(parsed.value);
      }
      videoFilters = validated;
    }
  } catch {
    // JSON ilegible: no hay forma de saber qué se quiso mandar.
    return { ok: false, code: GENERIC_INVALID };
  }

  // Orden de selección del usuario (foto/video intercalados). Opcional.
  let mediaOrder: Array<"photo" | "video"> = [];
  try {
    const raw = formData.get("mediaOrder");
    if (typeof raw === "string" && raw.length > 0) {
      mediaOrder = mediaOrderSchema.parse(JSON.parse(raw));
    }
  } catch {
    mediaOrder = []; // orden inválido → fallback fotos-primero, nunca se pierde un medio
  }

  // ---- Insumos de Content Integrity ---------------------------------------
  // Fotogramas del video muestreados por el navegador (32×32 en gris, ~4 KB).
  // Ausentes = el video queda sin huella perceptual y va a revisión humana; eso
  // lo decide el pipeline, no este parseo.
  let videoFrames: unknown = null;
  try {
    const raw = formData.get("videoFrames");
    if (typeof raw === "string" && raw.length > 0) videoFrames = JSON.parse(raw);
  } catch {
    videoFrames = null;
  }

  /**
   * PCM mono de la pista de audio (base64 de Int16, 8 kHz). Mismo reparto que
   * los fotogramas y con la misma advertencia: lo extrae el navegador, así que
   * un cliente modificado puede falsearlo. No abre un agujero de autoría — el
   * SHA-256 lo calcula siempre el servidor leyendo el archivo real del bucket.
   *
   * El tope de tamaño no es una defensa criptográfica sino de memoria: 120 s a
   * 8 kHz en base64 son ~2,6 MB, y cualquier cosa mucho mayor que eso no es la
   * pista de audio de un video corto sino alguien probando qué aguanta.
   */
  const MAX_AUDIO_PCM_CHARS = 4_000_000;
  let videoAudioPcm: unknown = null;
  const rawAudio = formData.get("videoAudioPcm");
  if (typeof rawAudio === "string" && rawAudio.length > 0) {
    videoAudioPcm = rawAudio.length <= MAX_AUDIO_PCM_CHARS ? rawAudio : null;
  }

  // Declaración de originalidad y licencia. Si el composer todavía no la manda,
  // `normalizeDeclaration` devuelve "no declaró nada" — que NO es lo mismo que
  // "es propio", y por eso el escaneo va a levantar su alerta de licencia.
  const declaration = normalizeDeclaration({
    originalityDeclared: formData.get("originalityDeclared"),
    licenseKind: formData.get("licenseKind"),
    licenseStatement: formData.get("licenseStatement"),
    licenseUrl: formData.get("licenseUrl"),
  });

  // ---- DECLARACIÓN Y TOPE DEL VIDEO (contrato 0046 + spec nº4) ------------
  //
  // Se resuelve ACÁ, antes del guard, de la moderación y de tocar storage: si
  // el video no puede publicarse, nada más tiene por qué pasar.
  //
  // QUÉ PUEDE Y QUÉ NO PUEDE HACER ESTE SERVIDOR. No mide el archivo: el video
  // viaja del navegador DIRECTO al bucket (por el límite de body de las server
  // actions), así que acá nunca hay bytes que abrir — medirlo pediría ffprobe
  // sobre el objeto ya subido, que es otro proyecto. Lo que sí hace, y es lo
  // que pide el contrato, es RE-VALIDAR el número declarado contra la misma
  // política que usó el navegador: un cliente modificado que mande 600 no
  // publica, y uno que no mande nada tampoco. La última línea sigue siendo el
  // CHECK de la base, que rechaza el INSERT sin declaración.
  let declaredVideoType: "short_video" | null = null;
  let declaredDuration: number | null = null;
  let declaredCategory: string | null = null;

  if (videoPaths.length > 0) {
    // Un post NUNCA nace publicitario: la campaña referencia al post, así que
    // en el INSERT todavía no puede existir (trigger app.posts_validate_video +
    // policy posts_insert). Declararse `advertising_video` acá es un cliente
    // mintiendo, no un caso de uso.
    if (parsed.data.videoType && parsed.data.videoType !== "short_video") {
      return { ok: false, code: "video", reason: "too-long" };
    }
    const duration = checkVideoDuration("short_video", parsed.data.durationSeconds);
    if (!duration.ok) return { ok: false, code: "video", reason: duration.reason };
    declaredVideoType = "short_video";
    declaredDuration = duration.seconds;
    // Categoría opcional con default sensato. Sólo viaja si hay video: una
    // categoría sin video no significa nada y la base lo rechaza (constraint
    // `posts_video_category_needs_video`).
    declaredCategory = parsed.data.videoCategory ?? DEFAULT_VIDEO_CATEGORY;
  }

  const hasMedia = photos.length > 0 || videoPaths.length > 0;

  // ALGÚN medio obligatorio en posts (feedback cliente 2026-07-19: feed
  // visual; desde el sprint reels el video también cuenta), no en preguntas.
  // Defensa en profundidad: la UX del composer ya lo evita y el trigger
  // MEDIA_REQUIRED (0023) es la última línea; acá fallamos antes de tocar
  // storage/DB para no dejar basura ni una foto huérfana.
  if (kind === "post" && !hasMedia) {
    return { ok: false, code: "photo" };
  }

  // TEXTO OPCIONAL CON MEDIO (2026-08-05). Va acá y no en el esquema porque la
  // regla depende de si hay foto o video, que recién se sabe después de leer el
  // FormData. Sigue devolviendo `invalid` — el composer ya lo traduce a
  // "Contanos un poquito más" — y sigue corriendo ANTES del guard, de la
  // moderación y de Storage: un cuerpo inválido no gasta plata ajena.
  if (!bodyIsPublishable(body, hasMedia)) {
    return { ok: false, code: GENERIC_INVALID };
  }

  // Guard ANTES de moderar y ANTES de subir la foto. Sin este chequeo, la foto
  // de un usuario cuyo JWT es de otro tenant intentaría escribir en el prefijo
  // {tenant_id} equivocado del bucket (la policy post_media_insert la rechaza,
  // pero mejor no gastar el intento) y recién después fallaría el insert.
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error" };
  }
  const { tenant, supabase, user } = guard;

  // Pertenencia del video: el path DEBE ser del prefijo {tenant}/{user} del
  // que firma el request. Un path ajeno no se persiste jamás (la policy 0025
  // ya lo habría rechazado al subir; esto es la misma regla al guardar).
  if (videoPaths.some((path) => !isOwnVideoPath(path, tenant.id, user.id))) {
    return { ok: false, code: "photo" };
  }

  /**
   * ---- LA FIRMA DE LA PUBLICACIÓN (`entity_listing_id`, 0023) --------------
   *
   * MISMA CATEGORÍA QUE LA LÍNEA DE ARRIBA: el cliente dice "esto es mío" y el
   * servidor lo comprueba contra la base. `entityId` llega por el body, así que
   * persistirlo sin validar es dejar que cualquiera con un token de la
   * comunidad publique a nombre del negocio de otro — el `listings.id` de una
   * ficha es público, está en su propia URL.
   *
   * La policy `posts_insert` ya lo rechazaría. Esto corta ANTES, por dos
   * motivos: para no gastar Storage ni la llamada de moderación en algo que no
   * se va a poder guardar, y para poder devolver un motivo que el composer sepa
   * explicar en vez de un código de PostgREST.
   */
  if (entityId) {
    const puede = await puedeFirmarComo(supabase, {
      tenantId: tenant.id,
      userId: user.id,
      listingId: entityId,
    });
    if (!puede) {
      // Sin PII: no se registra qué ficha se intentó usar ni desde qué cuenta.
      console.warn("[feed] intento de publicar con una ficha no disponible", {
        tenant: tenant.slug,
      });
      return { ok: false, code: "entity" };
    }
  }

  // Techo de publicación, ANTES de la moderación y de tocar Storage. Es el
  // único camino del feed que gasta plata ajena por request: `moderateText`
  // llama a OpenAI y cada foto sube bytes al bucket. 30 por hora no lo nota
  // nadie escribiendo de verdad, y le pone piso a un script.
  if (!limit(`post:${user.id}`, 30, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  // ---- Moderación de texto ANTES de publicar (§8) -------------------------
  const moderation = await moderateText(body);
  const tier = moderation.flagged ? TIER_HUMAN : moderationTier(moderation.score);
  /**
   * `moderateText("")` devuelve `skipped: true` porque no llama a nadie — pero
   * "no había texto que moderar" NO es lo mismo que "no pudimos moderar el
   * texto", que es lo que significa `moderation_skipped` en la cola. Desde que
   * una foto puede ir sin pie, sin esta distinción CADA foto sin pie entraría a
   * revisión humana con una razón que miente sobre por qué está ahí. La foto
   * sigue teniendo su propio camino de revisión (`mediaNeedsAsyncReview`).
   */
  const textUnmoderated = body.length > 0 && moderation.skipped;

  // ---- Media: publicación instantánea + revisión asíncrona ----------------
  // Sin Vision, la foto/el video YA NO fuerzan pending_review (mataba el feed
  // visual): el post nace published y la imagen entra a la cola humana para
  // revisarse después. Con Vision configurado se mantiene el screening
  // síncrono actual. El TEXTO sigue gobernando pending_review.
  const autoApprove = devAutoApprove();
  const mediaNeedsAsyncReview = hasMedia && !isVisionConfigured && !autoApprove;

  const status: "published" | "pending_review" =
    moderation.flagged || tier === TIER_HUMAN ? "pending_review" : "published";

  // ---- Subida de fotos: bucket post-media con el CLIENTE DEL USUARIO (0025).
  // La policy post_media_insert exige path {tenant_id}/{user_id}/… — ya no hace
  // falta el admin client (terminó el desvío histórico a listing-photos).
  // Secuencial a propósito: el conjunto entero ya está acotado por
  // `checkPhotoPayload` y así el primer fallo corta
  // sin dejar una ráfaga de huérfanos.
  const photoPaths: string[] = [];
  // Los bytes se guardan para Content Integrity: el SHA-256 y la huella
  // perceptual se calculan sobre el archivo ORIGINAL, y acá es el único momento
  // del flujo en que el servidor lo tiene en la mano (después vive en el bucket
  // y habría que volver a bajarlo).
  const integrityItems: MediaItem[] = [];
  for (const photo of photos) {
    const extension = PHOTO_TYPES[photo.type];
    const path = `${tenant.id}/${user.id}/post-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("post-media")
      .upload(path, photo, { contentType: photo.type, upsert: false });
    if (uploadError) {
      console.warn("[feed] subida de foto de post falló", {
        message: uploadError.message,
      });
      return { ok: false, code: "photo" };
    }
    photoPaths.push(path);
    integrityItems.push({
      mediaKind: "imagen",
      storageBucket: "post-media",
      storagePath: path,
      mimeType: photo.type,
      originalFilename: photo.name,
      bytes: new Uint8Array(await photo.arrayBuffer()),
    });
  }

  // El video NO pasó por el servidor (subida directa al bucket): sus bytes se
  // leen de storage para el SHA-256, y los fotogramas los muestreó el navegador
  // (`sampleVideoLumaFrames`). El porqué de ese reparto —y su límite— está en
  // `src/lib/integrity/video.ts`.
  for (const path of videoPaths) {
    integrityItems.push({
      mediaKind: "video",
      storageBucket: "post-media",
      storagePath: path,
      videoLumaFrames: videoFrames,
      audioPcm: videoAudioPcm,
    });
  }

  // posts.media en el ORDEN en que el usuario eligió los medios.
  const mediaPaths: string[] = buildMediaInOrder(mediaOrder, photoPaths, videoPaths);

  /**
   * `posts.media_filters` (0104): el filtro elegido, indexado por la RUTA del
   * archivo. Las claves salen de `videoPaths`, que a esta altura ya pasó por
   * `isOwnVideoPath` — el cliente nunca escribe una clave.
   *
   * Las FOTOS no entran acá y no es un olvido: su filtro ya está quemado en los
   * píxeles del archivo que se acaba de subir (`bake-photo.ts`). Guardarlo
   * además como metadato lo aplicaría DOS veces al pintar.
   */
  const mediaFilters: Record<string, MediaFilterRef> = {};
  videoPaths.forEach((path, index) => {
    const filter = videoFilters[index];
    if (filter) mediaFilters[path] = filter;
  });

  // ---- Insert con el JWT del usuario: la RLS valida tenant/autor/status y,
  // si viene entity_listing_id, que el listing sea propio y published (0023).
  const basePayload = {
    tenant_id: tenant.id,
    author_id: user.id,
    body,
    kind,
    media: mediaPaths,
    status,
    entity_listing_id: entityId ?? null,
    // Declaración de video (0046). Null cuando la publicación no trae video —
    // que es lo que la columna significa, no "un video sin tipo".
    video_type: declaredVideoType,
    duration_seconds: declaredDuration,
    video_category: declaredCategory,
  };
  type PostInsert = typeof basePayload;

  /**
   * Ni `poll_kind` (0041) ni `media_filters` (0104) están todavía en
   * database.types.ts —el archivo se regenera aparte—, así que el cast es por el
   * TIPO generado, no por el contrato: las dos columnas existen en la base desde
   * su migración. Al regenerar los tipos, esto se cae solo.
   *
   * `media_filters` viaja SIEMPRE, incluso vacío: es lo mismo que el default de
   * la columna, y mandarlo explícito deja el insert diciendo la verdad completa
   * de la publicación en vez de depender de un default que alguien podría tocar.
   */
  const insertPayload = {
    ...basePayload,
    media_filters: mediaFilters,
    ...(pollKind ? { poll_kind: pollKind } : {}),
  } as PostInsert;

  const { data: created, error: insertError } = await supabase
    .from("posts")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insertError || !created) {
    console.warn("[feed] insert de post falló", { code: insertError?.code });
    return { ok: false, code: "error" };
  }

  // ---- Content Integrity: huella de cada archivo (§ pliego) ----------------
  // Corre DESPUÉS del insert porque necesita el id del post como `subject_id`.
  // Nunca lanza y nunca deshace la publicación: lo único que puede hacer es
  // pedir ojos humanos, y eso viaja a la cola junto con el resto de los motivos.
  const integrity = await registerUploadedMedia({
    tenantId: tenant.id,
    uploaderId: user.id,
    subjectKind: "post",
    subjectId: created.id,
    sourceHost: await currentSourceHost(tenant.slug),
    declaration,
    items: integrityItems,
  });

  // ---- Cola de moderación (admin, uso permitido §6) ------------------------
  const shouldEnqueue =
    moderation.flagged ||
    textUnmoderated ||
    tier > TIER_AUTO ||
    mediaNeedsAsyncReview ||
    integrity.needsHumanReview;
  if (shouldEnqueue) {
    try {
      const reasons = [
        ...(textUnmoderated ? ["moderation_skipped"] : moderation.categories),
        // Clave histórica "photo_async_review" (el panel ya la conoce); el
        // video suma la suya propia para que el equipo sepa qué mirar.
        ...(mediaNeedsAsyncReview && photos.length > 0 ? ["photo_async_review"] : []),
        ...(mediaNeedsAsyncReview && videoPaths.length > 0 ? ["video_async_review"] : []),
        ...integrity.reasons,
      ];
      // pending_review → cola humana; publicado con media sin Vision → cola
      // humana igual (la imagen/el video necesita ojos), pero ya está visible.
      // Una alerta de integridad —o un archivo que no se pudo analizar— también
      // pide un humano: un duplicado exacto no lo resuelve un score de IA.
      const enqueueTier =
        status === "pending_review" || mediaNeedsAsyncReview || integrity.needsHumanReview
          ? TIER_HUMAN
          : TIER_REVIEW;
      const outcome = await enqueueModeration(createAdminClient(), {
        tenantId: tenant.id,
        subjectKind: "post",
        subjectId: created.id,
        aiScore: moderation.skipped ? null : moderation.score,
        reasons,
        tier: enqueueTier,
      });
      if (!outcome.ok) {
        console.warn("[feed] no se pudo encolar moderación del post", {
          postId: created.id,
        });
      }
    } catch {
      console.warn("[feed] admin client no disponible para encolar moderación");
    }
  }

  revalidatePath("/feed");
  return { ok: true, status, postId: created.id, entity: Boolean(entityId) };
}

// ---------------------------------------------------------------------------
// Crear comentario (detalle de post) — misma moderación
// ---------------------------------------------------------------------------

const commentSchema = z.object({
  postId: z.uuid(),
  body: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(1000)),
});

export type CreateCommentResult =
  | {
      ok: true;
      /**
       * Con qué firma quedó guardado. `null` = a nombre de la persona. La hoja
       * lo usa para reconciliar el comentario optimista: si se pintó con un
       * nombre y el servidor guardó otro, gana el servidor.
       */
      entityListingId?: string | null;
    }
  | { ok: false; code: "invalid" | "unauthenticated" | "flagged" | "error" }
  /** El JWT y el header apuntan a comunidades distintas — copy ya resuelto. */
  | { ok: false; code: "tenant-mismatch"; message: string };

export async function createCommentAction(input: {
  postId: string;
  body: string;
}): Promise<CreateCommentResult> {
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: GENERIC_INVALID };
  const { postId, body } = parsed.data;

  // Guard antes de moderar: sin coincidencia de tenant, `comments_insert` va a
  // rechazar igual — no gastamos una llamada a la API de moderación.
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error" };
  }
  const { tenant, supabase, user } = guard;

  const moderation = await moderateText(body);

  if (moderation.flagged) {
    // Desvío documentado #1: comments_insert solo permite 'published' — el
    // comentario flagged NO se inserta; el intento queda en la cola humana
    // (precedente del módulo MENSAJES) y el autor recibe aviso cálido.
    try {
      const admin = createAdminClient();
      const { error: queueError } = await admin.from("moderation_queue").insert({
        tenant_id: tenant.id,
        subject_kind: "comment",
        subject_id: crypto.randomUUID(), // nunca se insertó: id sintético del intento
        tier: TIER_HUMAN,
        ai_score: moderation.score,
        reasons: {
          source: "openai_omni_moderation",
          categories: moderation.categories,
          body,
          post_id: postId,
          author_id: user.id,
        },
      });
      if (queueError) {
        console.warn("[feed] no se pudo encolar comentario flagged", {
          code: queueError.code,
        });
      }
    } catch {
      console.warn("[feed] admin client no disponible para encolar comentario");
    }
    return { ok: false, code: "flagged" };
  }

  /**
   * ── CON QUÉ NOMBRE SALE EL COMENTARIO ────────────────────────────────────
   * Lo decide el SERVIDOR a partir de la identidad activa (0103), nunca un
   * campo del body: si el cliente pudiera mandar el `entityId`, comentar como
   * un negocio ajeno sería una llamada de fetch. Así, lo peor que puede hacer
   * quien puentee la app es comentar como él mismo.
   *
   * A diferencia de PUBLICAR, acá no hay selector de autoría. Comentar es un
   * acto corto y frecuente dentro de una conversación ajena; meterle un
   * desplegable de "¿a nombre de quién?" a cada respuesta sería fricción en el
   * lugar equivocado. El interruptor global ya lo dijo, y la hoja lo muestra.
   *
   * `puedeFirmarComo` vuelve a preguntarle a la base —con el cliente del
   * usuario— aunque `getIdentidadActiva()` ya revalidó la membresía: son dos
   * hechos distintos. Uno es "podés actuar como este negocio"; el otro, "esta
   * ficha es tuya y está publicada", que es lo que exige la policy. Un negocio
   * cuya ficha se despublicó pasa el primero y falla el segundo, y entonces el
   * comentario sale a nombre de la persona en vez de fallar con un 42501.
   */
  const cara = await getCaraActiva();
  const firmaCandidata = cara.firmaListingId;
  const entityListingId =
    firmaCandidata &&
    (await puedeFirmarComo(supabase, {
      tenantId: tenant.id,
      userId: user.id,
      listingId: firmaCandidata,
    }))
      ? firmaCandidata
      : null;

  // RLS: valida autor, tenant, que el post exista published en este tenant y
  // —desde la 0116— que la ficha con la que se firma sea propia y publicada.
  const { data: created, error: insertError } = await supabase
    .from("comments")
    .insert({
      tenant_id: tenant.id,
      post_id: postId,
      author_id: user.id,
      body,
      status: "published",
      entity_listing_id: entityListingId,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    console.warn("[feed] insert de comentario falló", { code: insertError?.code });
    return { ok: false, code: "error" };
  }

  // ---- Aviso al autor de la publicación (0068) -----------------------------
  // Va DESPUÉS del insert: se avisa por un comentario que existe, nunca por un
  // intento. El autor se lee acá y no antes porque hasta este punto no había
  // nada que notificar. `notifyPostComment` corta solo si el autor es quien
  // comentó, y nunca lanza: un aviso caído no puede desarmar el comentario.
  const { data: commentedPost } = await supabase
    .from("posts")
    .select("author_id")
    .eq("id", postId)
    .maybeSingle();

  if (commentedPost?.author_id) {
    await notifyPostComment({
      tenantId: tenant.id,
      postId,
      authorId: commentedPost.author_id,
      actorId: user.id,
      body,
      // Sólo si la firma sobrevivió a `puedeFirmarComo`: si el comentario quedó
      // guardado a nombre de la persona, el aviso tiene que decir su nombre.
      firmadoComo: entityListingId ? cara.negocio?.nombre ?? null : null,
    });
  }

  // Score intermedio o moderación saltada → publica pero entra a monitoreo.
  const tier = moderationTier(moderation.score);
  if (moderation.skipped || tier > TIER_AUTO) {
    try {
      await enqueueModeration(createAdminClient(), {
        tenantId: tenant.id,
        subjectKind: "comment",
        subjectId: created.id,
        aiScore: moderation.skipped ? null : moderation.score,
        reasons: moderation.skipped ? ["moderation_skipped"] : moderation.categories,
        tier: TIER_REVIEW,
      });
    } catch {
      console.warn("[feed] admin client no disponible para encolar comentario");
    }
  }

  revalidatePath(`/feed/${postId}`);
  return { ok: true, entityListingId };
}

// ---------------------------------------------------------------------------
// Aviso de "me gusta" (0068)
// ---------------------------------------------------------------------------

const reactionNotifySchema = z.object({ postId: z.uuid() });

/**
 * Avisa al autor de una publicación que a alguien le gustó.
 *
 * POR QUÉ ES UNA ACTION APARTE Y NO PARTE DEL "ME GUSTA": el me gusta se
 * escribe desde el navegador con el cliente del usuario (`reactions` tiene RLS
 * propia y el corazón es optimista, sin round-trip al servidor). Meterlo en una
 * server action para poder notificar haría que cada tap esperara al servidor —
 * exactamente lo que el módulo evitó a propósito. Así que el aviso viaja por su
 * cuenta, fire-and-forget, después de que la reacción ya quedó.
 *
 * LO QUE IMPIDE QUE ESTO SEA UN EMISOR DE NOTIFICACIONES A PEDIDO: la reacción
 * tiene que EXISTIR. Sin esa relectura, cualquiera podría llamar a esta action
 * en loop y llenarle la campana a otra persona sin haber tocado nada. Se lee
 * con el cliente del usuario (RLS aplica) y se corta si no hay fila.
 *
 * Devuelve siempre un booleano y jamás lanza: es telemetría social, no una
 * operación cuyo fracaso alguien tenga que ver.
 */
export async function notifyPostReactionAction(input: {
  postId: string;
}): Promise<{ ok: boolean }> {
  try {
    const parsed = reactionNotifySchema.safeParse(input);
    if (!parsed.success) return { ok: false };
    const { postId } = parsed.data;

    const guard = await requireTenantMatch();
    if (!guard.ok) return { ok: false };
    const { tenant, supabase, user } = guard;

    // Techo generoso: notificar 120 me gusta por hora es más de lo que hace
    // nadie con el pulgar, y le pone piso a un script.
    if (!limit(`react-notify:${user.id}`, 120, HOUR_MS).ok) return { ok: false };

    // `entity_listing_id` sale de la FILA ya escrita, no de un parámetro: el
    // aviso dice a nombre de quién quedó guardado el me gusta, que es lo que va
    // a ver quien abra la publicación. Un nombre que llegue por el body sería un
    // aviso falsificable.
    const { data: reaction } = await supabase
      .from("reactions")
      .select("profile_id, entity_listing_id")
      .eq("subject_kind", "post")
      .eq("subject_id", postId)
      .eq("profile_id", user.id)
      .maybeSingle();

    if (!reaction) return { ok: false };

    const { data: post } = await supabase
      .from("posts")
      .select("author_id")
      .eq("id", postId)
      .maybeSingle();

    // Sin autor (cuenta borrada) o me gusta propio: no hay a quién avisarle.
    if (!post?.author_id || post.author_id === user.id) return { ok: false };

    let firmadoComo: string | null = null;
    if (reaction.entity_listing_id) {
      const { data: ficha } = await supabase
        .from("listings")
        .select("title")
        .eq("id", reaction.entity_listing_id)
        .maybeSingle();
      firmadoComo = ficha?.title ?? null;
    }

    await notifyPostReaction({
      tenantId: tenant.id,
      postId,
      authorId: post.author_id,
      actorId: user.id,
      firmadoComo,
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
