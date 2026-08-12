import { getTenant } from "@/lib/tenant/resolve";
import { ModuleCircles } from "./module-circles";
import type { FeedTabId } from "./helpers";

/**
 * La fila de módulos del feed, con la configuración del tenant ya resuelta.
 *
 * Existe para que el filtrado por comunidad ocurra en el SERVIDOR: qué módulos
 * están prendidos, cuáles en "muy pronto" y cuáles apagados sale de
 * `tenants.modules` (ver shell/module-access.ts), y un módulo apagado no puede
 * llegar al navegador ni siquiera oculto por CSS.
 *
 * No agrega latencia: `getTenant` está cacheada por request con `cache()` y el
 * layout de (app) ya la resolvió antes de renderizar esta página, así que acá
 * la promesa ya está cumplida.
 */
export async function FeedModules({ active }: { active: FeedTabId }) {
  const tenant = await getTenant();
  return (
    <ModuleCircles
      active={active}
      modules={tenant.modules}
      modulesSoon={tenant.modulesSoon}
    />
  );
}
