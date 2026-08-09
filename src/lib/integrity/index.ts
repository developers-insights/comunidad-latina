/**
 * =============================================================================
 * CONTENT INTEGRITY — barril del módulo
 * =============================================================================
 *
 * Qué hay adentro, en orden de "qué necesito importar":
 *
 *   · `registerUploadedMedia` (register.ts) — LA llamada. Dado uno o varios
 *     archivos recién subidos, calcula huellas, deja la fila de procedencia y
 *     corre el escaneo. Devuelve si hace falta un humano y por qué.
 *   · `declarations.ts` — declaración de originalidad y de licencias: esquema,
 *     opciones y copy. Lo importan los formularios (no es server-only).
 *   · `phash.ts` — el núcleo puro (DCT, Hamming). Sin I/O, testeable solo.
 *   · `scan.ts`, `image.ts`, `video.ts`, `audio.ts`, `storage.ts` — las piezas.
 *
 * NO se re-exporta nada de `image.ts` / `video.ts` / `storage.ts` desde acá:
 * son server-only y arrastran `sharp`. Quien los necesita los importa por
 * ruta directa — igual que hace `src/lib/media/index.ts` con `measure-video`.
 */

export {
  registerUploadedMedia,
  INTEGRITY_REASONS,
  MAX_INLINE_BYTES,
  type IntegrityCheck,
  type MediaItem,
  type ContentMediaKind,
  type ContentSubjectKind,
  type RegisterUploadedMediaInput,
} from "./register";

export {
  DECLARATION_COPY,
  EMPTY_DECLARATION,
  LICENSE_KINDS,
  LICENSE_OPTIONS,
  declarationSchema,
  licenseLabel,
  normalizeDeclaration,
  type ContentDeclaration,
  type DeclarationInput,
  type LicenseKind,
  type LicenseOption,
} from "./declarations";

export { DEFAULT_MAX_DISTANCE, scanContentAsset, type ScanOutcome } from "./scan";

export {
  LUMA_SIZE,
  PHASH_BITS,
  VIDEO_FRAMES,
  VIDEO_PHASH_BITS,
  hammingDistance,
  isBitString,
  phash64,
  readBitString,
  videoPhash256,
} from "./phash";

export { byteaToHex, sha256Hex, shortHash, toByteaLiteral } from "./hash";
