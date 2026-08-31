/**
 * Barril de "Tu zona" (UI). Son todos client components y no arrastran nada
 * del servidor: la lógica vive en `@/lib/zona` y las escrituras pasan por su
 * action.
 *
 * `ZonaRadio` y `ZonaUbicacion` se exportan aunque hoy sólo los use la hoja del
 * selector: son las dos mitades del pedido del cliente (compartir ubicación y
 * filtrar por millas) y cualquier pantalla que en el futuro quiera ofrecerlas
 * sin abrir el header las tiene acá, con su contrato ya resuelto.
 */
export { ZonaRadio, type ZonaRadioProps } from "./zona-radio";
export { ZonaSelector, type ZonaSelectorProps } from "./zona-selector";
export { ZonaUbicacion, type ZonaUbicacionProps } from "./zona-ubicacion";
export { ZonaVacia } from "./zona-vacia";
