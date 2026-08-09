import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, TablesInsert } from "@/lib/types/database.types";
import { EMPTY_DECLARATION, type ContentDeclaration } from "./declarations";
import { sha256Hex, toByteaLiteral } from "./hash";
import { imagePhash } from "./image";
import { scanContentAsset, DEFAULT_MAX_DISTANCE } from "./scan";
import { hashStorageObject } from "./storage";
import { videoPhashFromLumaFrames } from "./video";

/**
 * =============================================================================
 * PIPELINE DE CONTENT INTEGRITY — registrar un archivo y analizarlo
 * =============================================================================
 *
 * Un archivo entra y sale: (1) SHA-256 de los bytes ORIGINALES, (2) huella
 * perceptual según el medio, (3) una fila en `content_assets` con quién, cuándo,
 * desde qué dominio y con qué declaración, (4) el escaneo que levanta matches y
 * alertas.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ `service_role` Y POR QUÉ ESTÁ BIEN ACÁ
 * -----------------------------------------------------------------------------
 * Las policies de INSERT de las cuatro tablas de la 0061 están en `false` a
 * propósito: "un cliente que pudiera insertar su propio sha256/phash podría
 * declararse autor de cualquier cosa, que es justo lo que este módulo existe
 * para impedir". O sea que el único camino es el admin client — y es un uso
 * PERMITIDO (ARQUITECTURA §6: "moderación server-side"), no un atajo: acá no se
 * lee ni un dato de usuario para mostrarlo, se escriben huellas calculadas por
 * el servidor.
 *
 * -----------------------------------------------------------------------------
 * DEGRADACIÓN ELEGANTE (§7) — LA REGLA QUE GOBIERNA TODO ESTE ARCHIVO
 * -----------------------------------------------------------------------------
 * Nada de lo que pasa acá puede romper una publicación, y nada de lo que falla
 * acá puede dejar contenido publicado sin control. Las dos mitades:
 *
 *   · NUNCA LANZA. Cualquier error —sharp ausente, storage caído, admin sin
 *     configurar, escaneo que no corre— devuelve un resultado, no una excepción.
 *     La persona que publica jamás ve un error técnico.
 *   · SIEMPRE DICE LA VERDAD SOBRE LO QUE NO PUDO. Si algo no se pudo analizar,
 *     `needsHumanReview` es true y viaja un motivo. Quien llama traduce eso a
 *     "esto no se publica solo / esto va a la cola humana". El silencio no es
 *     una opción: un archivo sin analizar y uno analizado y limpio no pueden
 *     verse igual desde afuera.
 *
 * -----------------------------------------------------------------------------
 * CÓMO SE ENGANCHA UNA SUPERFICIE NUEVA (es una llamada)
 * -----------------------------------------------------------------------------
 * ```ts
 * const integrity = await registerUploadedMedia({
 *   tenantId: tenant.id,
 *   uploaderId: user.id,
 *   subjectKind: "listing",
 *   subjectId: listingId,
 *   declaration,                      // del formulario, o EMPTY_DECLARATION
 *   items: photoPaths.map((path) => ({
 *     mediaKind: "imagen",
 *     storageBucket: "listing-photos",
 *     storagePath: path,
 *   })),
 * });
 *
 * if (integrity.needsHumanReview) {
 *   // no publicar solo + encolar con integrity.reasons
 * }
 * ```
 */

/** Espeja el CHECK de `content_assets.subject_kind` (0061). */
export type ContentSubjectKind =
  | "post"
  | "listing"
  | "portfolio"
  | "avatar"
  | "cover"
  | "guide"
  | "otro";

/** Espeja el CHECK de `content_assets.media_kind` (0061). */
export type ContentMediaKind = "imagen" | "video" | "audio" | "documento";

/**
 * Tope de bytes que este pipeline lee de storage para hashear.
 *
 * No es una cifra de seguridad sino de LATENCIA: los bytes se leen dentro del
 * request de publicación, así que un archivo grande se paga en el tiempo que la
 * persona mira el spinner. 24 MB cubre con holgura cualquier foto y la mayoría
 * de los videos cortos; por encima de eso el archivo NO se hashea y el
 * contenido va a revisión humana con el motivo correspondiente — que es
 * exactamente lo que tiene que pasar, no un silencio.
 */
export const MAX_INLINE_BYTES = 24 * 1024 * 1024;

export interface MediaItem {
  mediaKind: ContentMediaKind;
  storageBucket: string;
  storagePath: string;
  /**
   * Los bytes, si el servidor YA los tiene (el caso del feed: las fotos llegan
   * como File en el FormData). Si no vienen, se leen del bucket.
   */
  bytes?: Uint8Array | null;
  originalFilename?: string | null;
  mimeType?: string | null;
  /**
   * Matrices de luminancia de los fotogramas muestreados por el navegador
   * (`src/lib/media/video-frames.ts`). Sólo tiene sentido con `mediaKind:
   * "video"` — ver el docblock de `./video.ts` para el porqué y su límite.
   */
  videoLumaFrames?: unknown;
}

export interface RegisterUploadedMediaInput {
  tenantId: string;
  uploaderId: string;
  subjectKind: ContentSubjectKind;
  subjectId: string | null;
  /** Host desde el que se cargó. Se congela como texto (columna `source_host`). */
  sourceHost: string;
  declaration?: ContentDeclaration;
  items: MediaItem[];
  maxDistance?: number;
}

/**
 * Motivos que viajan a `moderation_queue.reasons`. Son ETIQUETAS, nunca
 * contenido: el panel las muestra y nadie tiene que abrir un JSON para
 * entenderlas.
 */
export const INTEGRITY_REASONS = {
  /** El pipeline no pudo correr (sin admin, storage caído, escaneo fallido). */
  failed: "integrity_pipeline_failed",
  /** Se registró el archivo pero sin huella perceptual (sharp ausente, etc.). */
  notFingerprinted: "integrity_sin_huella",
  /** El archivo era demasiado grande para hashearlo dentro del request. */
  tooLarge: "integrity_archivo_grande",
  /** El escaneo encontró un archivo idéntico anterior en esta comunidad. */
  duplicate: "integrity_duplicado_exacto",
  /** El escaneo encontró un archivo parecido anterior en esta comunidad. */
  similar: "integrity_coincidencia_similar",
  /** Se cargó sin declarar originalidad ni licencia. */
  missingLicense: "integrity_sin_declaracion",
} as const;

export interface IntegrityCheck {
  /**
   * true si algo quedó sin analizar O si el escaneo abrió alertas. Quien llama
   * lo traduce a su propia regla de publicación — este módulo no decide si algo
   * se publica, sólo dice si un humano tiene que mirarlo.
   */
  needsHumanReview: boolean;
  /** Etiquetas para `moderation_queue.reasons`. Sin duplicados, orden estable. */
  reasons: string[];
  /** Ids de `content_assets` creados. Vacío si no se pudo registrar ninguno. */
  assetIds: string[];
}

const CLEAN: IntegrityCheck = { needsHumanReview: false, reasons: [], assetIds: [] };

/** Resultado de registrar UN archivo. */
type SingleOutcome =
  | { ok: true; assetId: string; fingerprinted: boolean }
  | { ok: false; reason: string };

/**
 * Registra los archivos de una publicación y corre el análisis de integridad.
 *
 * NUNCA lanza. Sin archivos devuelve el resultado limpio sin tocar la red.
 */
export async function registerUploadedMedia(
  input: RegisterUploadedMediaInput,
): Promise<IntegrityCheck> {
  if (input.items.length === 0) return CLEAN;

  let admin: SupabaseClient<Database>;
  try {
    admin = createAdminClient();
  } catch {
    // Admin no configurado (entorno sin service role): el contenido NO puede
    // pasar como analizado. Va a revisión humana con el motivo explícito.
    console.warn("[integrity] admin client no disponible: el contenido va a revisión");
    return { needsHumanReview: true, reasons: [INTEGRITY_REASONS.failed], assetIds: [] };
  }

  const declaration = input.declaration ?? EMPTY_DECLARATION;
  const sourceDomainId = await resolveSourceDomainId(admin, input.tenantId, input.sourceHost);

  const reasons = new Set<string>();
  const assetIds: string[] = [];
  let needsHumanReview = false;

  for (const item of input.items) {
    // El try envuelve CADA archivo y no el lote entero: una foto que explota no
    // puede tirar abajo el análisis de las otras tres. Y envuelve de verdad —
    // "nunca lanza" no es una promesa que se cumpla sola: una excepción
    // inesperada acá (cliente mal armado, red rara) subiría hasta la server
    // action y le rompería la publicación a la persona.
    let outcome: SingleOutcome;
    try {
      outcome = await registerOne(admin, input, item, declaration, sourceDomainId);
    } catch (error) {
      console.warn("[integrity] el registro de un archivo falló de forma inesperada", {
        message: error instanceof Error ? error.message : "error desconocido",
      });
      outcome = { ok: false, reason: INTEGRITY_REASONS.failed };
    }

    if (!outcome.ok) {
      needsHumanReview = true;
      reasons.add(outcome.reason);
      continue;
    }
    assetIds.push(outcome.assetId);
    if (!outcome.fingerprinted) {
      needsHumanReview = true;
      reasons.add(INTEGRITY_REASONS.notFingerprinted);
    }

    const scan = await scanContentAsset(
      admin,
      outcome.assetId,
      input.maxDistance ?? DEFAULT_MAX_DISTANCE,
    ).catch(() => ({ ok: false as const, error: "excepción" }));

    if (!scan.ok) {
      needsHumanReview = true;
      reasons.add(INTEGRITY_REASONS.failed);
    }
  }

  // Un solo viaje para saber QUÉ levantó el escaneo en todos los archivos.
  if (assetIds.length > 0) {
    const alertReasons = await readOpenAlertReasons(admin, assetIds);
    for (const reason of alertReasons) reasons.add(reason);
    if (alertReasons.length > 0) needsHumanReview = true;
  }

  return { needsHumanReview, reasons: [...reasons], assetIds };
}

/* -------------------------------------------------------------------------- */

async function registerOne(
  admin: SupabaseClient<Database>,
  input: RegisterUploadedMediaInput,
  item: MediaItem,
  declaration: ContentDeclaration,
  sourceDomainId: string | null,
): Promise<SingleOutcome> {
  // --- 1. Bytes y SHA-256 ---------------------------------------------------
  let sha256: string;
  let byteSize: number;
  let bytes: Uint8Array | null = null;

  if (item.bytes && item.bytes.byteLength > 0) {
    // El servidor ya tiene el archivo (feed: llega como File en el FormData).
    bytes = item.bytes;
    byteSize = item.bytes.byteLength;
    sha256 = sha256Hex(item.bytes);
  } else {
    // El navegador lo subió directo al bucket: se lee de ahí, con tope.
    const read = await hashStorageObject(admin, item.storageBucket, item.storagePath, {
      maxBytes: MAX_INLINE_BYTES,
      // Los bytes completos sólo hacen falta para la huella de imagen.
      keepBytes: item.mediaKind === "imagen",
    });
    if (!read.ok) {
      console.warn("[integrity] no se pudo leer el archivo para su huella", {
        bucket: item.storageBucket,
        reason: read.reason,
      });
      return {
        ok: false,
        reason:
          read.reason === "demasiado-grande"
            ? INTEGRITY_REASONS.tooLarge
            : INTEGRITY_REASONS.failed,
      };
    }
    sha256 = read.sha256;
    byteSize = read.byteSize;
    bytes = read.bytes;
  }

  // --- 2. Huella perceptual según el medio ----------------------------------
  let phash: string | null = null;
  let videoPhash: string | null = null;

  if (item.mediaKind === "imagen" && bytes) {
    phash = await imagePhash(bytes);
  } else if (item.mediaKind === "video") {
    videoPhash = videoPhashFromLumaFrames(item.videoLumaFrames);
  }
  // audio: ver `./audio.ts` — no hay extractor, la columna queda NULL y eso
  // significa "no se analizó", nunca "no coincide".

  const fingerprinted = phash !== null || videoPhash !== null;

  // --- 3. La fila de procedencia --------------------------------------------
  const row: TablesInsert<"content_assets"> = {
    tenant_id: input.tenantId,
    uploader_id: input.uploaderId,
    subject_kind: input.subjectKind,
    subject_id: input.subjectId,
    media_kind: item.mediaKind,
    storage_bucket: item.storageBucket,
    storage_path: item.storagePath,
    original_filename: item.originalFilename ?? null,
    mime_type: item.mimeType ?? null,
    byte_size: byteSize,
    sha256: toByteaLiteral(sha256),
    phash,
    video_phash: videoPhash,
    source_host: input.sourceHost,
    source_domain_id: sourceDomainId,
    originality_declared: declaration.originalityDeclared,
    license_kind: declaration.licenseKind,
    license_statement: declaration.licenseStatement,
    license_url: declaration.licenseUrl,
  };

  const { data, error } = await admin
    .from("content_assets")
    .insert(row)
    .select("id")
    .single();

  if (error || !data) {
    console.warn("[integrity] no se pudo registrar el archivo", { code: error?.code });
    return { ok: false, reason: INTEGRITY_REASONS.failed };
  }

  return { ok: true, assetId: data.id, fingerprinted };
}

/**
 * `source_domain_id` es un lujo, no un requisito: `source_host` ya congeló el
 * dominio como TEXTO justamente para que la evidencia sobreviva aunque la fila
 * de `tenant_domains` se archive (comentario de la columna en la 0061). Si la
 * búsqueda falla, se sigue con null.
 */
async function resolveSourceDomainId(
  admin: SupabaseClient<Database>,
  tenantId: string,
  host: string,
): Promise<string | null> {
  const domain = host.split(":")[0]?.toLowerCase();
  if (!domain) return null;
  try {
    const { data } = await admin
      .from("tenant_domains")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("domain", domain)
      .maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

/** Traduce los `kind` de las alertas abiertas a motivos de la cola. */
async function readOpenAlertReasons(
  admin: SupabaseClient<Database>,
  assetIds: string[],
): Promise<string[]> {
  try {
    const { data, error } = await admin
      .from("content_integrity_alerts")
      .select("kind")
      .in("asset_id", assetIds)
      .eq("status", "abierta");

    if (error || !data) return [];

    const reasons = new Set<string>();
    for (const row of data) {
      if (row.kind === "duplicado_exacto") reasons.add(INTEGRITY_REASONS.duplicate);
      else if (row.kind === "coincidencia_similar") reasons.add(INTEGRITY_REASONS.similar);
      else if (row.kind === "licencia_faltante") reasons.add(INTEGRITY_REASONS.missingLicense);
    }
    return [...reasons];
  } catch {
    return [];
  }
}
