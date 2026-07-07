"use client";

import { useActionState } from "react";
import {
  updateTenantModules,
  type DomainActionState,
} from "@/app/admin/dominio/actions";
import { PendingButton } from "./pending-button";

/**
 * Módulos on/off del tenant (panel Dominio). Checkboxes accesibles con target
 * ≥44px; el guardado es una server action (admin gateado + audit_log — la RLS
 * de tenants es global_admin-only, ver dominio/actions.ts).
 */

const MODULES: { key: string; label: string; hint: string }[] = [
  { key: "feed", label: "Comunidad", hint: "Feed de publicaciones y preguntas" },
  { key: "propiedades", label: "Vivienda", hint: "Avisos de habitaciones y apartamentos" },
  { key: "negocios", label: "Negocios", hint: "Directorio de negocios locales" },
  { key: "profesionales", label: "Profesionales", hint: "Oficios y servicios verificables" },
  { key: "eventos", label: "Eventos", hint: "Agenda de la comunidad" },
  { key: "mensajes", label: "Mensajes", hint: "Contacto protegido entre miembros" },
  { key: "escudo", label: "Escudo Anti-Estafa", hint: "Verificador y reportes de la comunidad" },
];

const COPY = {
  save: "Guardar módulos",
  saved: "Listo — los cambios ya están activos para tu comunidad.",
} as const;

const initialState: DomainActionState = { status: "idle" };

export function ModuleToggles({ modules }: { modules: Record<string, boolean> }) {
  const [state, formAction] = useActionState(updateTenantModules, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <ul className="divide-y divide-border-subtle rounded-lg border border-border bg-surface shadow-xs">
        {MODULES.map((moduleDef) => (
          <li key={moduleDef.key}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-3">
              <input
                type="checkbox"
                name={`module:${moduleDef.key}`}
                defaultChecked={modules[moduleDef.key] !== false}
                className="size-5 shrink-0 accent-[var(--color-brand)]"
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-foreground">{moduleDef.label}</span>
                <span className="text-xs text-foreground-muted">{moduleDef.hint}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {state.status === "error" && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="mt-2 text-sm text-success">
          {COPY.saved}
        </p>
      )}

      <div className="mt-3 flex justify-end">
        <PendingButton variant="secondary" size="sm" type="submit">
          {COPY.save}
        </PendingButton>
      </div>
    </form>
  );
}
