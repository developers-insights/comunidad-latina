/**
 * Barril de "Tu zona" (UI). Los dos son client components y no arrastran nada
 * del servidor: la lógica vive en `@/lib/zona` y las escrituras pasan por su
 * action.
 */
export { ZonaSelector, type ZonaSelectorProps } from "./zona-selector";
export { ZonaVacia } from "./zona-vacia";
