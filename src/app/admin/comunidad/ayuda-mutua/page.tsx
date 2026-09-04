import { permanentRedirect } from "next/navigation";

/**
 * /admin/comunidad/ayuda-mutua → /admin/comunidad/pedir-ayuda
 *
 * La sección cambió de nombre y de trabajo con la 0130 (de cola de admisión a
 * moderación posterior). El redirect existe porque el panel se usa desde
 * favoritos del navegador y porque `audit_log` guarda acciones viejas cuyo
 * contexto alguien puede querer volver a mirar.
 */
export default function AyudaMutuaAdminRedirect() {
  permanentRedirect("/admin/comunidad/pedir-ayuda");
}
