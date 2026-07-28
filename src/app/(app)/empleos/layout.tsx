import type { ReactNode } from "react";
import { ModuleGate } from "@/components/shell/module-gate";

/**
 * Guard de módulo: si el panel apagó "Empleos" esta rama entera deja de
 * existir (404), y si quedó en "Muy pronto" sirve esa pantalla en esta misma
 * URL. Cubre el listado y todo lo que cuelga debajo. Ver module-gate.tsx.
 */
export default function EmpleosLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="empleos">{children}</ModuleGate>;
}
