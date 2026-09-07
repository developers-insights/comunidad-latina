import { NavTabs } from "@/components/ui";
import { getAuthUserId } from "@/lib/supabase/server";
import { contarSolicitudesPendientes } from "@/app/(app)/mensajes/bandeja-queries";
import { COPY } from "./copy";

/**
 * Personas · Grupos · Solicitudes.
 *
 * Va con `NavTabs` (enlaces con `aria-current`) y no con `Tabs` (el patrón
 * `tablist`/`tabpanel`) porque cada pestaña es OTRA URL con OTRA consulta:
 * `/mensajes` lista conversaciones, `/mensajes/grupos` lista grupos y
 * `/mensajes/solicitudes` los pedidos sin responder. La cabecera de
 * `ui/nav-tabs.tsx` deja escrito por qué a un enlace que navega no se le pone
 * `role="tab"`: `aria-selected` le promete a un lector de pantalla un panel que
 * se actualiza sin salir de la página, y acá la página se reemplaza entera.
 *
 * ── POR QUÉ EL CONTADOR SE PIDE ACÁ ADENTRO ─────────────────────────────────
 * El número de solicitudes tiene que estar bien en las TRES pestañas, no sólo
 * en la suya: quien está mirando Grupos también necesita ver que le llegaron
 * dos pedidos. Recibirlo por prop obligaría a que cada página que dibuja estas
 * pestañas se acuerde de contarlas —y `grupos/page.tsx` pertenece a otro
 * frente—. Es un `count` con `head: true`, y `contarSolicitudesPendientes`
 * nunca lanza: un contador caído dibuja la pestaña sin globito, no rompe la
 * navegación.
 */
export async function InboxTabs({
  active,
}: {
  active: "personas" | "grupos" | "solicitudes";
}) {
  const userId = await getAuthUserId();
  const pendientes = userId ? await contarSolicitudesPendientes(userId) : 0;

  return (
    <NavTabs
      className="mb-5"
      label={COPY.inbox.tabsLabel}
      active={active}
      items={[
        { id: "personas", label: COPY.inbox.tabPersonas, href: "/mensajes" },
        { id: "grupos", label: COPY.inbox.tabGrupos, href: "/mensajes/grupos" },
        {
          id: "solicitudes",
          label: COPY.inbox.tabSolicitudes,
          href: "/mensajes/solicitudes",
          // Cero no se dibuja: un "0" al lado de "Solicitudes" es ruido que
          // ocupa el mismo lugar que la única información que importa acá.
          ...(pendientes > 0 ? { count: pendientes } : {}),
        },
      ]}
    />
  );
}
