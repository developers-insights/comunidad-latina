import { NavTabs } from "@/components/ui";
import { COPY } from "./copy";

/**
 * Personas · Grupos.
 *
 * Va con `NavTabs` (enlaces con `aria-current`) y no con `Tabs` (el patrón
 * `tablist`/`tabpanel`) porque cada pestaña es OTRA URL con OTRA consulta:
 * `/mensajes` lista conversaciones, `/mensajes/grupos` lista grupos. La
 * cabecera de `ui/nav-tabs.tsx` deja escrito por qué a un enlace que navega no
 * se le pone `role="tab"`: `aria-selected` le promete a un lector de pantalla
 * un panel que se actualiza sin salir de la página, y acá la página se
 * reemplaza entera.
 */
export function InboxTabs({ active }: { active: "personas" | "grupos" }) {
  return (
    <NavTabs
      className="mb-5"
      label={COPY.inbox.tabsLabel}
      active={active}
      items={[
        { id: "personas", label: COPY.inbox.tabPersonas, href: "/mensajes" },
        { id: "grupos", label: COPY.inbox.tabGrupos, href: "/mensajes/grupos" },
      ]}
    />
  );
}
