import { z } from "zod";
import { moduleAvailability, type ModuleAvailability } from "@/components/shell/module-access";

/**
 * Contrato de los TRES estados de un módulo (feedback 27/7).
 *
 * Vive en su PROPIO archivo y no en `actions.ts` por una regla dura de Next:
 * en un módulo `"use server"` **todo export tiene que ser una función async**.
 * Exportar de ahí un helper puro rompe la ruta entera en runtime (no lo agarra
 * `tsc`, solo se ve al renderizar). Acá, además, se puede testear sin arrastrar
 * el guard ni el cliente de Supabase.
 */

/**
 * Claves canónicas de módulos — la lista completa de lo que el panel gobierna.
 *
 * Son las mismas que declara cada ítem del menú en `moduleKey` (shell/modules.ts)
 * y las mismas que siembra `scripts/seed.mjs`. Tres listas en tres lenguajes
 * distintos (TS de la app, TS del panel, JS del seed) que no pueden divergir, y
 * que ya divergieron: el seed escribía `properties`/`businesses`/`jobs` en inglés
 * mientras la app leía las de acá, así que el tenant sembrado con ese seed no
 * matcheaba NINGUNA clave. Cada lista tiene su test de sincronía contra esta
 * (shell/modules.test.ts, admin/module-toggles.test.tsx, scripts/seed.test.ts).
 *
 * Las claves que no estén acá NO se borran al guardar (updateTenantModules
 * mergea sobre lo que ya hay), pero tampoco se pueden administrar desde esta
 * pantalla — si aparece una sección nueva, se suma en esta lista Y en MODULES de
 * module-toggles.tsx.
 */
export type ModuleKey =
  | "feed"
  | "propiedades"
  | "negocios"
  | "profesionales"
  | "eventos"
  | "empleos"
  | "mensajes"
  | "marketplace"
  | "creadores"
  | "videos";

export const MODULE_KEYS = [
  "feed",
  "propiedades",
  "negocios",
  "profesionales",
  "eventos",
  "empleos",
  "mensajes",
  "marketplace",
  "creadores",
  "videos",
] as const satisfies readonly ModuleKey[];

/**
 * `escudo` NO está en la lista a propósito. El Escudo Anti-Estafa está apagado
 * en el build (`ESCUDO_ENABLED = false` en las tres páginas de
 * `src/app/(app)/escudo/`) y está comentado fuera de MODULES en
 * `shell/modules.ts`: no existe ni en el menú ni en las rutas. Un interruptor
 * para eso no apaga nada — es el mismo engaño que este archivo evita con feed y
 * mensajes, en la dirección contraria. Cuando el módulo se encienda de verdad,
 * se agrega acá, en MODULES de module-toggles.tsx y en shell/modules.ts.
 */

/**
 * Lo que no parsea cae a "off" — nunca a "on": un valor raro no puede terminar
 * prendiendo una sección que el admin quería apagada.
 */
export const moduleStateSchema = z.enum(["on", "soon", "off"]).catch("off");

export type ModuleState = z.infer<typeof moduleStateSchema>;

/**
 * Traduce los tres estados a las DOS columnas del contrato (migración 0041):
 *
 *   modules[k] = true                      → Activo
 *   !modules[k] && modules_soon[k] = true  → Muy pronto
 *   !modules[k] && !modules_soon[k]        → Oculto
 *
 * Invariante que garantiza esta función: `soon` SOLO puede ser true cuando
 * `enabled` es false. La combinación `enabled && soon` no existe — "Muy pronto"
 * es un estado de lo apagado.
 */
export function toModuleColumns(states: Record<string, ModuleState>): {
  modules: Record<string, boolean>;
  modulesSoon: Record<string, boolean>;
} {
  const modules: Record<string, boolean> = {};
  const modulesSoon: Record<string, boolean> = {};
  for (const [key, state] of Object.entries(states)) {
    modules[key] = state === "on";
    modulesSoon[key] = state === "soon";
  }
  return { modules, modulesSoon };
}

/**
 * Los tres estados de la app, dichos en el idioma del panel. Es un renombre 1:1
 * y nada más — la traducción vive acá sola para que no se pueda desincronizar.
 */
const PANEL_STATE_OF: Record<ModuleAvailability, ModuleState> = {
  active: "on",
  soon: "soon",
  hidden: "off",
};

/**
 * Estado GUARDADO de un módulo, tal como lo tiene que mostrar el panel.
 *
 * Es la inversa exacta de `toModuleColumns`, y delega la decisión —incluido el
 * default de la clave ausente— en `moduleAvailability`, la misma función que usa
 * la app para decidir qué ve el usuario. Esa delegación es el punto: mientras el
 * panel derivaba su propio estado ("prendido salvo que diga false") podía marcar
 * "Activo" un módulo que la app estaba escondiendo, y el operador no tenía cómo
 * enterarse. Ahora la pantalla no puede mentir: si acá dice "Activo", la app lo
 * muestra; si dice "Oculto", no está.
 *
 * Bonus de honestidad: `feed` y `mensajes` (ALWAYS_ON_MODULE_KEYS) salen siempre
 * "on" aunque la base traiga un `false` viejo — que es exactamente lo que hace
 * la app con ellos.
 */
export function moduleStateOf(
  key: string,
  modules: Record<string, boolean> | null | undefined,
  modulesSoon: Record<string, boolean> | null | undefined,
): ModuleState {
  return PANEL_STATE_OF[moduleAvailability(key, modules, modulesSoon)];
}
