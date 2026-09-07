import { describe, expect, it } from "vitest";
import {
  OPCIONES_PARA_PROMOCIONAR,
  opcionesDisponibles,
} from "./opciones-para-promocionar";

/**
 * Catálogo de /impulsar/crear. Entorno node: el módulo es datos puros más
 * `moduleAvailability` (que también es puro) — sin React, sin Supabase.
 *
 * Lo que estos tests protegen no es el copy sino los DESTINOS: Boost manda a
 * los mismos creadores que el "+" del bottom nav, y si uno de los dos cambia
 * de ruta sin el otro, desde acá se publica en un lugar y desde el "+" en otro.
 */

/** Espejo de `CREATE_MENU_TILES` (components/shell/create-menu.tsx). */
const DESTINOS_DEL_MENU_MAS: Record<string, { href: string; moduleKey?: string }> = {
  property: { href: "/publicar?kind=property", moduleKey: "propiedades" },
  business: { href: "/publicar?kind=business", moduleKey: "negocios" },
  professional: { href: "/publicar?kind=professional", moduleKey: "profesionales" },
  event: { href: "/publicar?kind=event", moduleKey: "eventos" },
  job: { href: "/empleos/publicar", moduleKey: "empleos" },
  product: { href: "/marketplace/publicar", moduleKey: "marketplace" },
  creatorGig: { href: "/creadores/publicar", moduleKey: "creadores" },
};

const TODO_PRENDIDO: Record<string, boolean> = {
  propiedades: true,
  negocios: true,
  profesionales: true,
  eventos: true,
  empleos: true,
  marketplace: true,
  creadores: true,
};

describe("OPCIONES_PARA_PROMOCIONAR", () => {
  it("manda a los MISMOS creadores que el menú del '+'", () => {
    for (const [id, esperado] of Object.entries(DESTINOS_DEL_MENU_MAS)) {
      const opcion = OPCIONES_PARA_PROMOCIONAR.find((o) => o.id === id);
      expect(opcion, `falta la opción ${id}`).toBeDefined();
      expect(opcion?.href).toBe(esperado.href);
      expect(opcion?.moduleKey).toBe(esperado.moduleKey);
    }
  });

  it("no tiene ids repetidos", () => {
    const ids = OPCIONES_PARA_PROMOCIONAR.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("todos los acentos son variables del tema, nunca un color crudo", () => {
    for (const opcion of OPCIONES_PARA_PROMOCIONAR) {
      expect(opcion.accentVar).toMatch(/^var\(--accent-[a-z-]+\)$/);
    }
  });

  it("cada opción arranca con '/' — son rutas internas", () => {
    for (const opcion of OPCIONES_PARA_PROMOCIONAR) {
      expect(opcion.href.startsWith("/")).toBe(true);
    }
  });
});

describe("opcionesDisponibles", () => {
  it("con todo prendido ofrece el catálogo entero", () => {
    expect(opcionesDisponibles(TODO_PRENDIDO, {})).toHaveLength(
      OPCIONES_PARA_PROMOCIONAR.length,
    );
  });

  it("un módulo apagado saca su opción", () => {
    const ids = opcionesDisponibles({ ...TODO_PRENDIDO, marketplace: false }, {}).map(
      (o) => o.id,
    );
    expect(ids).not.toContain("product");
    expect(ids).toContain("business");
  });

  it("'muy pronto' tampoco se ofrece: la pantalla todavía no recibe avisos", () => {
    const ids = opcionesDisponibles(
      { ...TODO_PRENDIDO, creadores: false },
      { creadores: true },
    ).map((o) => o.id);
    expect(ids).not.toContain("creatorGig");
  });

  it("con TODAS las verticales apagadas queda sólo el feed, que no cuelga de un módulo", () => {
    const todoApagado = Object.fromEntries(
      Object.keys(TODO_PRENDIDO).map((clave) => [clave, false]),
    );
    expect(opcionesDisponibles(todoApagado, {}).map((o) => o.id)).toEqual(["post"]);
  });

  it("una clave ausente NO apaga nada (default de module-access: nadie decidió)", () => {
    expect(opcionesDisponibles({}, {})).toHaveLength(OPCIONES_PARA_PROMOCIONAR.length);
  });
});
