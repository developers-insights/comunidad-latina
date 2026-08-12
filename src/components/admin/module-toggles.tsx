"use client";

import { useActionState } from "react";
import {
  updateTenantModules,
  type DomainActionState,
} from "@/app/admin/dominio/actions";
// El estado de un módulo NO se deriva acá: se lee con el mismo helper que usa la
// app para decidir qué muestra (ver el docblock de `moduleStateOf`). Cuando esta
// pantalla tenía su propia versión, las dos se separaron y el panel terminó
// marcando "Activo" secciones que el usuario no veía por ningún lado.
import { moduleStateOf, type ModuleState } from "@/app/admin/dominio/modules";
import { cn } from "@/lib/utils";
import { PendingButton } from "./pending-button";

/**
 * Módulos de la comunidad, con TRES estados por módulo (feedback 27/7).
 *
 * El contrato de datos son dos columnas hermanas de `tenants` (migración 0041):
 *
 *   modules[k] = true                      → Activo   (se ve y se usa)
 *   !modules[k] && modules_soon[k] = true  → Muy pronto (se ve, no se entra)
 *   !modules[k] && !modules_soon[k]        → Oculto   (no aparece)
 *
 * Por eso el control es un RADIO GROUP por módulo y no dos checkboxes: los tres
 * estados son excluyentes, y con radios "Activo + Muy pronto" ni siquiera se
 * puede expresar. La combinación imposible se corta igual server-side
 * (dominio/actions.ts), pero la UI no debería poder proponerla.
 *
 * Accesibilidad: cada módulo es un <fieldset> con su <legend>, así el lector de
 * pantalla anuncia "Vivienda — Activo, opción 1 de 3". Targets ≥44px.
 */

/**
 * `fijo` = la app NO honra el apagado de esta sección, y el panel no puede
 * fingir que sí. Ofrecer un interruptor inerte es peor que no ofrecerlo: el
 * operador cree que apagó algo y se entera cuando un usuario le escribe.
 *
 * `feed` y `mensajes` son infraestructura, no secciones: el logo del header
 * lleva a Inicio y cada CTA de contacto lleva a Mensajes, así que apagarlos
 * dejaría la app con enlaces rotos en vez de con una sección menos
 * (ALWAYS_ON_MODULE_KEYS en shell/module-access.ts es la contraparte).
 */
/**
 * Los módulos que esta pantalla ofrece. Tiene que ser EXACTAMENTE MODULE_KEYS,
 * y hay un test que lo exige en las dos direcciones — no es cosmético:
 *
 *  · Falta acá una clave que sí está en MODULE_KEYS → `updateTenantModules` la
 *    recorre igual, `formData.get()` devuelve null, el zod la lleva a "off" y el
 *    módulo se APAGA SOLO en el próximo guardado, sin que nadie lo haya tocado.
 *  · Sobra acá una clave que no está en MODULE_KEYS → el interruptor se dibuja,
 *    el operador lo mueve y no pasa nada: la action ni la mira.
 */
const MODULES: { key: string; label: string; hint: string; fijo?: string }[] = [
  {
    key: "feed",
    label: "Comunidad",
    hint: "Feed de publicaciones y preguntas",
    fijo: "Es la pantalla de inicio: no se puede apagar.",
  },
  { key: "propiedades", label: "Vivienda", hint: "Avisos de habitaciones y apartamentos" },
  { key: "negocios", label: "Negocios", hint: "Directorio de negocios locales" },
  { key: "profesionales", label: "Profesionales", hint: "Oficios y servicios verificables" },
  { key: "eventos", label: "Eventos", hint: "Agenda de la comunidad" },
  { key: "empleos", label: "Empleos", hint: "Avisos de trabajo y postulaciones" },
  {
    key: "mensajes",
    label: "Mensajes",
    hint: "Contacto protegido entre miembros",
    fijo: "Todo botón de contacto termina acá: no se puede apagar.",
  },
  // El Escudo Anti-Estafa no figura: está apagado en el build y fuera del menú,
  // así que su interruptor no apagaba nada (ver MODULE_KEYS en dominio/modules.ts).
  { key: "marketplace", label: "Marketplace", hint: "Productos de las tiendas de la comunidad" },
  { key: "creadores", label: "Creadores", hint: "Trabajos, contratos y portfolios de creadores" },
  { key: "videos", label: "Videos", hint: "Videos cortos de la comunidad" },
  {
    key: "comunidad",
    label: "Comunidad",
    hint: "Perdido y encontrado, clínicas, bancos de comida y consulados",
  },
];

const OPTIONS: { value: ModuleState; label: string; hint: string }[] = [
  { value: "on", label: "Activo", hint: "Se ve y se usa" },
  { value: "soon", label: "Muy pronto", hint: "Se ve, pero todavía no se entra" },
  { value: "off", label: "Oculto", hint: "No aparece en la app" },
];

const COPY = {
  save: "Guardar módulos",
  saved: "Listo — los cambios ya están activos en esta comunidad.",
  legendHint: "Elegí cómo se ve esta sección",
  alwaysOn: "Siempre activo",
} as const;

/** Píldora de opción — mismo patrón de radio-card que el form del Escudo. */
const optionCardClass = cn(
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground-secondary",
  "transition-[border-color,background-color,color] duration-(--duration-fast) ease-(--ease-out-premium)",
  "hover:border-border-strong",
  "has-[:checked]:border-brand has-[:checked]:bg-brand-tint has-[:checked]:font-semibold has-[:checked]:text-brand-ink",
  "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-focus-ring",
);

/** Misma píldora, pero leída como estado y no como opción elegible. */
const lockedPillClass = "cursor-default border-brand bg-brand-tint font-semibold text-brand-ink";

const initialState: DomainActionState = { status: "idle" };

export interface ModuleTogglesProps {
  modules: Record<string, boolean>;
  /** `tenants.modules_soon` — la columna hermana con el estado "Muy pronto". */
  modulesSoon?: Record<string, boolean>;
  /**
   * Comunidad sobre la que se guarda. Va en el form porque un `global_admin`
   * puede estar mirando una comunidad que no es la suya (selector del panel).
   *
   * Es una PROPUESTA, no una orden: la action la contrasta con `canWriteTenant`
   * contra el rol real del JWT y rechaza lo que no corresponda. Mandar acá el
   * id de otra comunidad desde la consola no cambia nada.
   */
  tenantId?: string | null;
}

export function ModuleToggles({ modules, modulesSoon = {}, tenantId }: ModuleTogglesProps) {
  const [state, formAction] = useActionState(updateTenantModules, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      {tenantId && <input type="hidden" name="tenantId" value={tenantId} />}
      <ul className="divide-y divide-border-subtle rounded-lg border border-border bg-surface shadow-xs">
        {MODULES.map((moduleDef) => {
          const current = moduleStateOf(moduleDef.key, modules, modulesSoon);
          return (
            <li key={moduleDef.key}>
              <fieldset className="px-4 py-3">
                <legend className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-foreground">{moduleDef.label}</span>
                  <span className="text-xs text-foreground-muted">{moduleDef.hint}</span>
                  <span className="sr-only">. {moduleDef.fijo ?? COPY.legendHint}</span>
                </legend>

                {moduleDef.fijo ? (
                  // Se envía igual para que un `false` viejo en la base se
                  // normalice al guardar y deje de contradecir a la app.
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name={`module:${moduleDef.key}`} value="on" />
                    <span className={cn(optionCardClass, lockedPillClass)}>{COPY.alwaysOn}</span>
                    <span className="text-xs text-foreground-muted">{moduleDef.fijo}</span>
                  </div>
                ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {OPTIONS.map((option) => {
                    const id = `module-${moduleDef.key}-${option.value}`;
                    return (
                      <label
                        key={option.value}
                        htmlFor={id}
                        title={option.hint}
                        className={optionCardClass}
                      >
                        <input
                          type="radio"
                          id={id}
                          name={`module:${moduleDef.key}`}
                          value={option.value}
                          defaultChecked={current === option.value}
                          className="size-4 shrink-0 accent-[var(--color-brand)]"
                        />
                        {option.label}
                      </label>
                    );
                  })}
                </div>
                )}
              </fieldset>
            </li>
          );
        })}
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
