import { ZonaSelector } from "@/components/zona";
import { getZonaActiva } from "@/lib/zona/server";

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
 */
export async function HeaderActions() {
  const zona = await getZonaActiva();
  return <ZonaSelector zonaActiva={zona.label} />;
}
