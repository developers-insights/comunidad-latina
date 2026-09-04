import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * =============================================================================
 * CONTRATO — NINGUNA PANTALLA DE LA APP ES UN CALLEJÓN
 * =============================================================================
 *
 * En la app instalada (PWA) no hay barra de direcciones ni gesto de volver
 * confiable: si la pantalla no ofrece la salida, no hay salida. El cliente lo
 * dijo dos veces (feedback 2026-09-03, punto 3): "siempre que se quiera salir
 * de cualquier cosa, como una vivienda o eventos, no puedo volver para atrás,
 * tengo que ir al buscador".
 *
 * Ese día faltaba el control en ~70 pantallas y nadie lo había visto, porque
 * una pantalla sin salida se ve perfecta: tiene su título, sus datos y su botón
 * principal. Lo que falta no se nota mirando; se nota estando adentro.
 *
 * Por eso el inventario es un test y no una revisión: la próxima pantalla que
 * alguien agregue nace con salida o rompe el árbol.
 *
 * ── QUÉ CUENTA COMO SALIDA ────────────────────────────────────────────────
 * `<SectionTopBar>` (el control compartido), o cualquiera de los dos que ya se
 * construyen sobre él: `<DetailTopBar>` (los detalles de aviso) y
 * `<ThreadHeader>` (el hilo de mensajes). Vale que lo monte la página o
 * cualquier `layout.tsx` que la envuelva — montarlo en el layout es incluso
 * preferible, porque cubre también las ramas que la página devuelve antes de su
 * contenido (sin sesión, sin permiso, no encontrado) y el `not-found`.
 *
 * ── SI ESTE TEST SE PONE ROJO ─────────────────────────────────────────────
 * Montá `<SectionTopBar fallbackHref="…" />`, casi siempre en un `layout.tsx`
 * al lado de la página nueva. El `fallbackHref` es a dónde ir cuando NO hay
 * historial de la app detrás (link compartido, PWA recién abierta): un wizard
 * vuelve a su sección, una subpantalla de perfil a /perfil, una portada de
 * sección a /buscar. Ver `src/components/shell/section-top-bar.tsx`.
 *
 * Agregar una excepción es legítimo, pero se escribe ACÁ abajo con su motivo:
 * una excepción sin motivo es un olvido con permiso.
 */

const APP = fileURLToPath(new URL("../app/(app)", import.meta.url));

/**
 * Las pantallas que NO llevan "Volver", con el porqué de cada una. La clave es
 * la carpeta relativa a `src/app/(app)` tal cual está en el disco (los grupos
 * `(entre paréntesis)` incluidos).
 */
const EXCEPCIONES: Record<string, string> = {
  // ── Raíces de las pestañas de la barra de abajo ──────────────────────────
  // Volver desde una raíz no significa nada: son los destinos que la barra de
  // abajo ofrece siempre, desde cualquier lugar de la app.
  "feed/(lista)": "raíz de la pestaña Inicio (bottom nav)",
  buscar:
    "raíz de la pestaña Buscar — es el DESTINO del fallback, no una pantalla de la que se vuelve",
  ajustes: "raíz de la pestaña Ajustes (bottom nav)",
  "videos/(reels)":
    "raíz de la pestaña Videos (bottom nav) y reproductor a pantalla completa: una barra pegajosa taparía el video",

  // ── Raíces a las que se llega desde el header, no desde otra pantalla ────
  "mensajes/(lista)":
    "bandeja de Mensajes: se abre desde el ícono del header, disponible en toda la app",
  "perfil/(lista)":
    "tu perfil: se abre desde el avatar del header, disponible en toda la app",

  // ── El post abierto del feed ─────────────────────────────────────────────
  "feed/[id]":
    "vive dentro del feed, que resuelve su propia navegación; además es territorio de otra rama",

  // ── Páginas que no dibujan nada: sólo redirigen ──────────────────────────
  "comunidad/ayuda-mutua": "redirect 308 a /comunidad/pedir-ayuda: no renderiza pantalla",
  "comunidad/ayuda-mutua/mios": "redirect 308: no renderiza pantalla",
  "comunidad/ayuda-mutua/publicar": "redirect 308: no renderiza pantalla",
  "creadores/contratos": "redirect 308 a /creadores/colaboraciones: no renderiza pantalla",
  "creadores/contratos/[id]": "redirect 308: no renderiza pantalla",

};

/** Los tres controles que hoy resuelven "volver" (los tres son la misma barra). */
const CONTROLES = ["<SectionTopBar", "<DetailTopBar", "<ThreadHeader"];

function paginas(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...paginas(full));
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

function monta(archivo: string): boolean {
  if (!existsSync(archivo)) return false;
  const src = readFileSync(archivo, "utf8");
  return CONTROLES.some((control) => src.includes(control));
}

/** Los `layout.tsx` que envuelven a esta página, de adentro hacia afuera. */
function layoutsQueLaEnvuelven(pagina: string): string[] {
  const out: string[] = [];
  let dir = join(pagina, "..");
  while (dir.startsWith(APP)) {
    const layout = join(dir, "layout.tsx");
    if (existsSync(layout)) out.push(layout);
    if (dir === APP) break;
    dir = join(dir, "..");
  }
  return out;
}

const RUTAS = paginas(APP).map((pagina) => {
  const ruta = relative(APP, join(pagina, "..")).split(sep).join("/");
  // El layout raíz de `(app)` no cuenta: es el shell (header + barra de abajo),
  // no la salida de una pantalla.
  const envolturas = layoutsQueLaEnvuelven(pagina).filter((l) => l !== join(APP, "layout.tsx"));
  return {
    ruta,
    enLaPagina: monta(pagina),
    enUnLayout: envolturas.some(monta),
  };
});

describe("toda pantalla de la app tiene cómo volver", () => {
  it("el inventario encuentra pantallas (si no, el test se volvió decorativo)", () => {
    expect(RUTAS.length).toBeGreaterThan(80);
  });

  it("ninguna pantalla queda sin salida", () => {
    const sinSalida = RUTAS.filter(
      (r) => !r.enLaPagina && !r.enUnLayout && !(r.ruta in EXCEPCIONES),
    ).map((r) => r.ruta);

    expect(
      sinSalida,
      "en la PWA instalada no hay barra del navegador: sin este control, estas pantallas no tienen cómo salir",
    ).toEqual([]);
  });

  it("nadie monta DOS volver (la página y su layout a la vez)", () => {
    const duplicadas = RUTAS.filter((r) => r.enLaPagina && r.enUnLayout).map((r) => r.ruta);

    expect(
      duplicadas,
      "dos controles de volver en la misma pantalla obligan a elegir entre ellos antes de tocar cualquiera",
    ).toEqual([]);
  });

  it("las excepciones existen de verdad (ninguna quedó apuntando a una ruta borrada)", () => {
    const rutas = new Set(RUTAS.map((r) => r.ruta));
    const fantasmas = Object.keys(EXCEPCIONES).filter((ruta) => !rutas.has(ruta));

    expect(
      fantasmas,
      "una excepción que ya no corresponde a ninguna pantalla es permiso guardado para un olvido futuro",
    ).toEqual([]);
  });

  it("ninguna excepción se quedó sin motivo escrito", () => {
    const mudas = Object.entries(EXCEPCIONES)
      .filter(([, motivo]) => motivo.trim().length < 15)
      .map(([ruta]) => ruta);

    expect(mudas).toEqual([]);
  });
});
