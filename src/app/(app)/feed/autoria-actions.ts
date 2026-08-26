"use server";

import {
  listarAutoriasDelComposer,
  type AutoriasDelComposer,
} from "@/lib/feed/autoria";

/**
 * =============================================================================
 * "¿CON QUÉ PERFIL PUEDO PUBLICAR?" — la pregunta que hace el composer
 * =============================================================================
 *
 * ── POR QUÉ UNA ACTION Y NO UNA PROP DEL LAYOUT ─────────────────────────────
 * `PostComposerHost` se monta UNA vez en `(app)/layout.tsx`, o sea en TODAS las
 * pantallas de la app autenticada. Bajarle las fichas por prop desde ahí
 * significaría una consulta más a `listings` en cada navegación de cada
 * persona, incluida la enorme mayoría que en esa navegación no va a publicar
 * nada. El composer, en cambio, se abre por un gesto explícito y contado.
 *
 * Así que la pregunta se hace cuando se abre el menú de crear: UNA vez por
 * apertura del composer, nunca por render (el resultado vive en el estado del
 * host y se reusa mientras la hoja está abierta). Y como se pregunta de nuevo
 * en cada apertura, la respuesta refleja siempre la identidad activa de AHORA
 * —si alguien cambió de perfil en el header un segundo antes, el composer ya lo
 * sabe— sin que haya un segundo estado que mantener sincronizado.
 *
 * ── ESTO NO AUTORIZA NADA ───────────────────────────────────────────────────
 * Devuelve lo que se puede OFRECER. Quién puede firmar de verdad lo decide
 * `puedeFirmarComo()` dentro de `createPostAction`, y detrás la policy
 * `posts_insert`. Que esta lista viaje al navegador no le da permiso a nadie:
 * son fichas propias y públicas, y el `listingId` que vuelva por el body se
 * vuelve a validar entero contra la base.
 *
 * ── NUNCA TIRA ──────────────────────────────────────────────────────────────
 * `listarAutoriasDelComposer()` ya degrada a "sólo tu perfil personal" ante
 * cualquier falla. El composer distingue igual los dos casos —todavía
 * cargando vs. resuelto— para no publicar a nombre de nadie mientras no sepa
 * la respuesta.
 */
export async function getAutoriasAction(): Promise<AutoriasDelComposer> {
  return listarAutoriasDelComposer();
}
