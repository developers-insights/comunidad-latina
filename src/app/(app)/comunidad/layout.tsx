import type { ReactNode } from "react";
import { ModuleGate } from "@/components/shell/module-gate";

/**
 * Guard de módulo: si el panel apagó "Comunidad", esta rama entera deja de
 * existir (404), y si quedó en "Muy pronto" sirve esa pantalla en esta misma
 * URL. Cubre el índice, los recursos, las guías y todo Perdido y encontrado.
 * Mismo archivo de cuatro líneas que /eventos, /empleos y el resto — ver la
 * cabecera de module-gate.tsx para por qué va acá y no en el layout de (app).
 *
 * NOTA PARA QUIEN ENGANCHE EL MÓDULO EN EL MENÚ: mientras `comunidad` no exista
 * como clave en `tenants.modules`, `moduleAvailability` devuelve "active" (el
 * default documentado en module-access.ts) y la sección se ve siempre. El
 * estado "Muy pronto" SÍ necesita que el registro de `shell/modules.ts` tenga
 * su ficha: sin ella, ModuleGate hace 404 en vez de la pantalla de espera.
 */
export default function ComunidadLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="comunidad">{children}</ModuleGate>;
}
