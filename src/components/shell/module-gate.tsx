import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTenant } from "@/lib/tenant/resolve";
import { moduleAvailability } from "./module-access";
import { ModuleSoon } from "./module-soon";
import { MODULES } from "./modules";

/**
 * Guard de navegación de un módulo apagable. Va en el `layout.tsx` de la
 * carpeta del módulo, así cubre la sección ENTERA (el listado, el detalle
 * `[id]`, `publicar`, `tienda`…) y no solo su `page.tsx`: apagar Marketplace y
 * dejar `/marketplace/abc-123` abierto sería apagarlo solo de la vista.
 *
 * Por qué acá y no en el layout de `(app)`: en el App Router los layouts NO
 * reciben el pathname —"Layouts do not re-render on navigation, so they do not
 * access pathname which would otherwise become stale" (docs de Next 16,
 * file-conventions/layout)— así que un guard único arriba necesitaría que el
 * middleware inyectara la ruta en un header. Un `layout.tsx` por módulo evita
 * ese acoplamiento, es puramente ADITIVO (ninguna de esas carpetas tenía uno) y
 * cada archivo son cuatro líneas.
 *
 * Costo de datos: cero. `getTenant()` ya se llamó en `(app)/layout.tsx` de este
 * mismo request y está memoizado con `cache()` sobre un `unstable_cache` de 300s
 * — el guard no agrega ni una consulta.
 *
 * Los tres estados, sin ambigüedad:
 *   active → pasa
 *   soon   → la pantalla de "Muy pronto" EN SU PROPIA URL (el día que abra, el
 *            mismo link sirve el módulo de verdad)
 *   hidden → 404, igual que cualquier ruta que no existe. Un módulo escondido no
 *            puede confirmar que existe: un 403 o un "no disponible" le contaría
 *            al curioso que hay algo ahí.
 */
export async function ModuleGate({
  moduleKey,
  children,
}: {
  moduleKey: string;
  children: ReactNode;
}) {
  const { modules, modulesSoon } = await getTenant();
  const state = moduleAvailability(moduleKey, modules, modulesSoon);

  if (state === "hidden") notFound();

  if (state === "soon") {
    const item = MODULES.find((candidate) => candidate.moduleKey === moduleKey);
    // Sin ficha en el registro no hay ni nombre ni ícono que mostrar; 404 antes
    // que una pantalla de "Muy pronto" anónima y descolgada.
    if (!item) notFound();
    return <ModuleSoon item={item} />;
  }

  return <>{children}</>;
}
