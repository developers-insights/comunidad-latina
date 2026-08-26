/**
 * =============================================================================
 * MUX — barril del módulo
 * =============================================================================
 *
 * ⚠️ ESTE BARRIL ES DE SERVIDOR. Re-exporta `isMuxConfigured`, que vive en
 * `lib/config/services.ts` y arrastra `server-only`.
 *
 * Desde un CLIENT COMPONENT hay que importar del módulo puro:
 *
 *     import { muxStreamUrl, muxThumbnailUrl, type MuxStatus } from "@/lib/mux/urls";
 *
 * y recibir el booleano como prop desde un server component, que es la
 * convención que ya usan las demás superficies con flag (`lib/config/services.ts`
 * explica por qué: en el bundle del cliente las env de servidor son `undefined`,
 * así que el flag no fallaría — MENTIRÍA, diciendo "no configurado" con Mux
 * andando perfecto).
 */

export { isMuxConfigured } from "@/lib/config/services";

export {
  MUX_STATUSES,
  isMuxStatus,
  muxAnimatedPreviewUrl,
  muxStreamUrl,
  muxThumbnailUrl,
  type MuxStatus,
} from "./urls";
