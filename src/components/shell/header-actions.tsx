import { ZonaSelector } from "@/components/zona";
import { getRadioActivo, getZonaActiva } from "@/lib/zona/server";

/**
 * Selector de "Tu zona" del header (la campana real vive en
 * components/notifications/NotificationBell).
 *
 * Hasta el 2026-08-24 esto era un botón que abría un toast de "muy pronto"
 * (patrón AlertButton §5.6 — nunca un botón muerto). Ya no: la feature existe.
 * El componente quedó como un Server Component finito cuyo único trabajo es
 * resolver QUÉ zona se está viendo; el control en sí es `<ZonaSelector>`, que
 * es lo que necesita estado del navegador.
 *
 * `getZonaActiva()` está `cache()`-eada por request y NO toca la base cuando la
 * cookie ya dice algo — así que en la navegación normal de alguien que ya eligió
 * su zona, este header no agrega ni una consulta.
 *
 * El radio en millas viaja al lado de la zona porque el header es el único lugar
 * donde se ve SIEMPRE. Sin él, alguien mirando 25 millas a la redonda lee "Corona"
 * y concluye que está viendo sólo Corona — el recorte estaría aplicado y nada lo
 * diría. `getRadioActivo()` también está `cache()`-eada y sale de una cookie, así
 * que sumarlo tampoco cuesta una consulta.
 */
export async function HeaderActions() {
  const [zona, radio] = await Promise.all([getZonaActiva(), getRadioActivo()]);
  return <ZonaSelector zonaActiva={zona.label} radioActivo={radio} />;
}
