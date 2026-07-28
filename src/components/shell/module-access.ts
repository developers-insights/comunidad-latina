/**
 * Los TRES estados de un módulo, resueltos en un solo lugar.
 *
 * El cliente lo pidió en la call del 27/7: «cada uno va a estar apagado en la
 * parte de atrás del administrador… cuando le dan al Creator Marketplace, dice:
 * viene muy pronto. O le puedo apagar completo que no lo vean ellos». La idea es
 * lanzar con secciones apagadas y prenderlas como campaña, sin redeploy
 * («cuando ya hay unos mil usuarios, prendemos el Marketplace»).
 *
 * El panel (/admin/dominio) YA escribía las dos columnas; lo que faltaba era que
 * la app las leyera. Este archivo es esa lectura —la de la app Y la del panel— y
 * es a propósito PURO: sin React, sin íconos, sin Supabase. Así lo pueden
 * importar por igual el menú (cliente), /buscar (servidor), el guard de cada ruta
 * y la propia pantalla de administración, y así se puede testear el contrato
 * entero sin montar nada.
 *
 * Contrato (espejo de `toModuleColumns` en src/app/admin/dominio/modules.ts):
 *
 *   modules[k] === true                       → "active"  se ve y se entra
 *   modules[k] === false && soon[k] === true   → "soon"    se ve, no se entra
 *   modules[k] === false                       → "hidden"  no aparece
 *   la clave no está en ninguna de las dos     → "active"  nadie decidió nada
 *
 * Ese último renglón es el default, y vive acá y en NINGÚN otro lado: el panel
 * lee el estado guardado con esta misma función (ver `moduleStateOf` en
 * src/app/admin/dominio/modules.ts). Cuando eran dos constantes separadas se
 * separaron de verdad, y la app terminó escondiendo secciones que el panel
 * mostraba en "Activo" (28/7).
 */

export type ModuleAvailability = "active" | "soon" | "hidden";

/**
 * Módulos que la app NO apaga aunque el panel diga lo contrario.
 *
 * Son DOS, y no porque sean pestañas del bottom nav —Videos también lo es y sí
 * se apaga— sino porque son la infraestructura sobre la que se apoya el resto:
 *
 *  · `feed` es Inicio: el destino del logo del header, adonde aterriza todo el
 *    mundo al entrar y adonde vuelve el botón atrás desde media app. Apagarlo
 *    deja la plataforma sin casa.
 *  · `mensajes` es la bandeja a la que apunta CADA CTA de contacto (la tarjeta
 *    de un negocio, la de una propiedad, el mensaje inline del feed). Esos
 *    caminos ni pasan por la barra: esconder la sección los rompería sin que
 *    nadie lo vea venir en el panel.
 *
 * El pedido del cliente nunca incluyó a estos dos: fue poder abrir Marketplace y
 * Creadores como campaña. No es una excepción silenciosa —está acá, con nombre y
 * testeada— y el hand-off pide que el panel deje de ofrecer dos interruptores
 * que la app no puede honrar.
 */
export const ALWAYS_ON_MODULE_KEYS: ReadonlySet<string> = new Set(["feed", "mensajes"]);

/**
 * Estado de UN módulo. **Fuente única del default** para los dos lados.
 *
 * Esta función es la que responde la pregunta difícil: ¿qué pasa cuando la clave
 * NO está en ninguna de las dos columnas? Hasta el 28/7 se contestaba en dos
 * lugares y con dos respuestas opuestas — la app escondía y el panel mostraba
 * "Activo" — así que una comunidad podía quedarse sin secciones mientras su
 * administrador veía todo prendido, sin forma de notar la contradicción. Por eso
 * ahora hay UNA sola implementación y el panel la consume (`moduleStateOf` en
 * src/app/admin/dominio/modules.ts): si el default cambia, cambia para los dos o
 * no cambia para ninguno.
 *
 * **Ausente = ACTIVO.** Apagar una sección es un ACTO: alguien entra al panel y
 * elige "Oculto", y eso escribe un `false`. Sin ese acto no hay decisión que
 * respetar, y ante la duda la app muestra la plataforma completa. El default
 * contrario esconde de más en los tres escenarios que de verdad ocurren: una
 * comunidad recién sembrada (jsonb vacío o con claves viejas), un tenant en
 * fallback porque la DB no contestó, y —el más traicionero— una sección NUEVA,
 * que nacería invisible en todas las comunidades hasta que alguien entre al
 * panel a prenderla a mano. Ninguno de esos tres es un lanzamiento por etapas:
 * son huecos, y un hueco no puede parecerse a una decisión de producto.
 *
 * Los dos riesgos van en direcciones muy distintas: de más se ve una sección que
 * el operador ve marcada "Activo" y apaga en dos clics; de menos desaparece la
 * app entera sin que nadie sepa por qué.
 *
 * `key` opcional entra por la misma puerta: un módulo sin clave es uno que el
 * panel todavía no ofrece. Nadie decidió nunca nada sobre él → se muestra. El
 * día que la clave entre al panel, este mismo helper empieza a gobernarlo sin
 * tocar una línea más (ver el test de sincronía en modules.test).
 *
 * Qué SIGUE siendo estricto: solo un booleano de verdad cuenta como decisión.
 * `modules[k] === true` prende y `=== false` apaga; un `"true"` (string), un `1`
 * o un `null` no son ninguna de las dos cosas y caen al default, igual que si la
 * clave faltara. Y "muy pronto" exige `=== true` estricto en `modulesSoon`, así
 * que basura en esa columna no puede fabricar el estado intermedio.
 */
export function moduleAvailability(
  key: string | undefined,
  modules: Record<string, boolean> | null | undefined,
  modulesSoon: Record<string, boolean> | null | undefined,
): ModuleAvailability {
  if (!key) return "active";
  if (ALWAYS_ON_MODULE_KEYS.has(key)) return "active";
  if (modules?.[key] === true) return "active";
  // "Muy pronto" se chequea antes que el apagado porque es un estado DE lo
  // apagado: `modules[k] = false` + `modules_soon[k] = true` es la combinación
  // que escribe el panel para anunciar una sección que todavía no abre.
  if (modulesSoon?.[key] === true) return "soon";
  if (modules?.[key] === false) return "hidden";
  return "active";
}

/** Lo que ve el usuario: un módulo visible es o "active" o "soon", nunca "hidden". */
export type VisibleModuleState = Exclude<ModuleAvailability, "hidden">;

/** Mínimo que necesita un módulo para pasar por el gate. */
export interface GatedModule {
  /** Clave canónica en `tenants.modules`. Ausente = el panel no lo gobierna. */
  moduleKey?: string;
}

export interface VisibleModule<T extends GatedModule> {
  item: T;
  state: VisibleModuleState;
}

/**
 * Filtra una lista de módulos a lo que el usuario puede ver, conservando el
 * ORDEN original y adjuntando el estado de cada uno.
 *
 * Devuelve el estado en vez de dos listas separadas porque las dos superficies
 * que enumeran módulos (el menú y /buscar) tienen que pintar "muy pronto"
 * intercalado en su lugar, no en un bloque aparte: un módulo que va a abrir
 * ocupa el mismo casillero que va a ocupar cuando abra, y así el día del
 * lanzamiento la grilla no se reordena bajo el dedo de la gente.
 */
export function visibleModules<T extends GatedModule>(
  items: readonly T[],
  modules: Record<string, boolean> | null | undefined,
  modulesSoon: Record<string, boolean> | null | undefined,
): VisibleModule<T>[] {
  const out: VisibleModule<T>[] = [];
  for (const item of items) {
    const state = moduleAvailability(item.moduleKey, modules, modulesSoon);
    if (state !== "hidden") out.push({ item, state });
  }
  return out;
}
