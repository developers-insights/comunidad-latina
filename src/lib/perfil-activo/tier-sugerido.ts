import type { VerificacionTier } from "@/lib/verificacion/catalogo";
import type { IdentidadActiva } from "./identidad";

/**
 * =============================================================================
 * CON QUÉ ESCALÓN DEL CHECK AZUL COINCIDE LA IDENTIDAD ACTIVA
 * =============================================================================
 *
 * Pedido del cliente, en Ajustes: «para qué tipo de perfil puedan aplicar el
 * tick, el verificado azul» — que la persona vea cuál le corresponde según su
 * cuenta.
 *
 * ⚠️ ESTO NO ES UN REQUISITO NI UNA RESTRICCIÓN. `activarCheckAzul`
 * (src/app/(app)/verificacion/actions.ts) deja elegir cualquiera de los tres
 * escalones a propósito, con el motivo escrito ahí mismo: «no hay forma de que
 * el servidor sepa si alguien "es" un profesional o un negocio, y fingir que la
 * hay sería peor: el escalón es un precio, no una credencial». Esta función
 * tampoco lo intenta — sólo refleja lo ÚNICO que el servidor sabe con certeza:
 * con qué identidad está actuando la persona AHORA MISMO (`active_identities`,
 * 0103). Sirve para una nota de contexto en la pantalla de contratación
 * ("es el perfil con el que estás actuando ahora"), nunca para bloquear un
 * escalón ni preseleccionarlo por sobre lo que la persona toque.
 *
 * "profesional" nunca sale de acá. No existe una cuenta "profesional" en el
 * modelo — es una publicación del directorio (`listings.kind = 'professional'`),
 * no una identidad con la que se pueda actuar — así que no hay una señal del
 * servidor tan confiable como `active_identities` para sugerirla. Quien ofrece
 * servicios profesionales se reconoce solo, leyendo el "Para quién" de ese
 * plan (`VERIFICACION_PLANES.profesional.paraQuien`).
 */
export function tierDeIdentidadActiva(identidad: IdentidadActiva): VerificacionTier {
  return identidad.tipo === "negocio" ? "negocio" : "persona";
}
