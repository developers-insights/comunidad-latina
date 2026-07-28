import { describe, expect, it } from "vitest";
import {
  ALWAYS_ON_MODULE_KEYS,
  moduleAvailability,
  visibleModules,
  type GatedModule,
} from "./module-access";
import { MODULE_KEYS, moduleStateOf } from "@/app/admin/dominio/modules";
import { DEFAULT_TENANTS, DEFAULT_TENANT_SLUG } from "@/lib/tenant/resolve";

/**
 * Esta es la pieza que decide qué ve el usuario final: si se equivoca, o el
 * cliente lanza con una sección abierta que quería cerrada, o la comunidad ve
 * una app a la que le faltan pedazos. Se testea el contrato entero, incluidos
 * los bordes feos (clave ausente, jsonb vacío, basura en la columna, tenant en
 * fallback).
 */
describe("moduleAvailability — los tres estados", () => {
  it("modules[k] === true → activo", () => {
    expect(moduleAvailability("marketplace", { marketplace: true }, {})).toBe("active");
  });

  it("apagado + modules_soon[k] === true → muy pronto", () => {
    expect(
      moduleAvailability("marketplace", { marketplace: false }, { marketplace: true }),
    ).toBe("soon");
  });

  it("apagado en las dos columnas → oculto", () => {
    expect(
      moduleAvailability("marketplace", { marketplace: false }, { marketplace: false }),
    ).toBe("hidden");
  });

  it("`modules` gana sobre `modules_soon`: prendido nunca es 'muy pronto'", () => {
    // El panel garantiza que la combinación no se escribe (toModuleColumns), pero
    // la app no puede depender de eso: la fila se puede editar por SQL a mano.
    expect(
      moduleAvailability("marketplace", { marketplace: true }, { marketplace: true }),
    ).toBe("active");
  });
});

/**
 * El default de la clave ausente. Es LA decisión de este archivo, y la que
 * durante meses estuvo contestada dos veces y al revés: acá "oculto", en el
 * panel "activo". Una comunidad recién sembrada se quedaba sin ninguna sección
 * mientras su administrador veía todo en "Activo" y no tenía cómo enterarse.
 */
describe("moduleAvailability — la clave ausente (el default)", () => {
  it("clave ausente de las DOS columnas → ACTIVO: nadie decidió apagarla", () => {
    expect(moduleAvailability("marketplace", { feed: true }, { feed: false })).toBe("active");
  });

  it("jsonb vacío en las dos columnas → todo activo", () => {
    // El caso de una comunidad recién creada: sin una sola decisión guardada, la
    // app tiene que verse ENTERA. Apagar es un acto, no el estado inicial.
    expect(moduleAvailability("marketplace", {}, {})).toBe("active");
  });

  it("columnas nulas → todo activo (la app nunca se queda sin secciones por un null)", () => {
    expect(moduleAvailability("marketplace", null, null)).toBe("active");
    expect(moduleAvailability("marketplace", undefined, undefined)).toBe("active");
  });

  it("una sección NUEVA nace visible, no invisible", () => {
    // Lo que hace este default tan importante: el día que se suma una clave a
    // MODULE_KEYS, ninguna fila de `tenants` la tiene todavía. Con el default
    // contrario la sección se lanzaría OCULTA en todas las comunidades a la vez,
    // hasta que alguien entrara al panel de cada una a prenderla a mano.
    const guardadoAntesDeLaSeccionNueva = { propiedades: true, negocios: false };
    expect(
      moduleAvailability("seccion_nueva", guardadoAntesDeLaSeccionNueva, {}),
    ).toBe("active");
  });

  it("un apagado EXPLÍCITO se respeta igual — el default no pisa decisiones", () => {
    expect(moduleAvailability("marketplace", { marketplace: false }, {})).toBe("hidden");
    expect(moduleAvailability("marketplace", { marketplace: false }, undefined)).toBe("hidden");
  });

  it("solo un booleano de verdad cuenta como decisión", () => {
    // Un jsonb con "true" (string), 1 o null no es ni un sí ni un no: es una fila
    // sin decisión válida, y cae al default como si la clave faltara. Lo que sí
    // sigue siendo estricto es `modules_soon`, que exige `=== true`: basura ahí
    // no puede FABRICAR el estado intermedio.
    const basura = { marketplace: "true" } as unknown as Record<string, boolean>;
    expect(moduleAvailability("marketplace", basura, {})).toBe("active");
    expect(moduleAvailability("marketplace", { marketplace: 1 as unknown as boolean }, {})).toBe(
      "active",
    );
    expect(moduleAvailability("marketplace", {}, basura)).toBe("active");
    // Y basura en `modules` no puede pisar un "muy pronto" bien escrito.
    expect(moduleAvailability("marketplace", basura, { marketplace: true })).toBe("soon");
  });

  it("un módulo SIN clave está siempre activo: el panel todavía no lo ofrece", () => {
    expect(moduleAvailability(undefined, {}, {})).toBe("active");
    expect(moduleAvailability(undefined, { feed: false }, { feed: false })).toBe("active");
  });
});

/**
 * El panel y la app NO pueden discrepar: si /admin/dominio dice "Activo", el
 * usuario tiene que ver la sección; si dice "Oculto", no tiene que estar. Es la
 * invariante que se rompió, y la única forma de que no se rompa otra vez es que
 * las dos lecturas salgan de la misma función.
 */
describe("panel ↔ app (lo que muestra /admin/dominio es lo que ve la comunidad)", () => {
  const VALORES = [undefined, true, false, null, "true", 1] as unknown[];
  const ESPERADO: Record<string, string> = { active: "on", soon: "soon", hidden: "off" };

  it("coinciden en TODA combinación de las dos columnas, incluidas las feas", () => {
    for (const enModules of VALORES) {
      for (const enSoon of VALORES) {
        const modules = { marketplace: enModules } as Record<string, boolean>;
        const modulesSoon = { marketplace: enSoon } as Record<string, boolean>;
        const app = moduleAvailability("marketplace", modules, modulesSoon);
        expect(
          moduleStateOf("marketplace", modules, modulesSoon),
          `app dice "${app}" con modules=${String(enModules)} / soon=${String(enSoon)}`,
        ).toBe(ESPERADO[app]);
      }
    }
  });

  it("coinciden también con las columnas vacías o nulas", () => {
    for (const key of MODULE_KEYS) {
      for (const [modules, soon] of [
        [{}, {}],
        [null, null],
        [undefined, undefined],
      ] as [Record<string, boolean> | null | undefined, Record<string, boolean> | null | undefined][]) {
        const app = moduleAvailability(key, modules, soon);
        expect(moduleStateOf(key, modules, soon), `${key} desincronizado`).toBe(ESPERADO[app]);
      }
    }
  });

  it("el panel tampoco ofrece apagar lo que la app fuerza a activo", () => {
    // `feed` y `mensajes` con un `false` viejo en la base: la app los muestra
    // igual, así que el panel tiene que decir "Activo" y no "Oculto".
    for (const key of ALWAYS_ON_MODULE_KEYS) {
      expect(moduleStateOf(key, { [key]: false }, { [key]: true })).toBe("on");
    }
  });
});

describe("moduleAvailability — bordes", () => {
  it("`modules_soon` sin `modules` sigue mandando: es una decisión, no un hueco", () => {
    // Alguien marcó "Muy pronto" y el on/off todavía no llegó a la fila (o se
    // editó por SQL). Hay decisión: se anuncia, no se abre.
    expect(moduleAvailability("marketplace", {}, { marketplace: true })).toBe("soon");
    expect(moduleAvailability("marketplace", null, { marketplace: true })).toBe("soon");
  });

  it("columnas nulas o ausentes → el on/off explícito sigue mandando", () => {
    expect(moduleAvailability("marketplace", { marketplace: true }, undefined)).toBe("active");
    expect(moduleAvailability("marketplace", { marketplace: true }, null)).toBe("active");
  });

  it("feed y mensajes no se apagan: son pestañas fijas del bottom nav", () => {
    expect(ALWAYS_ON_MODULE_KEYS.has("feed")).toBe(true);
    expect(ALWAYS_ON_MODULE_KEYS.has("mensajes")).toBe(true);
    expect(moduleAvailability("feed", { feed: false }, { feed: false })).toBe("active");
    expect(moduleAvailability("mensajes", { mensajes: false }, { mensajes: true })).toBe("active");
    // Ninguno de los que el cliente sí quiere poder apagar está en la lista.
    for (const key of ["marketplace", "creadores", "eventos", "negocios", "propiedades"]) {
      expect(ALWAYS_ON_MODULE_KEYS.has(key), `${key} no debería ser intocable`).toBe(false);
    }
  });
});

describe("moduleAvailability — tenant en fallback (DB caída / sin sembrar)", () => {
  const fallback = DEFAULT_TENANTS[DEFAULT_TENANT_SLUG];

  it("el fallback existe y está marcado como tal", () => {
    expect(fallback.isFallback).toBe(true);
    expect(fallback.modulesSoon).toEqual({});
  });

  it("un tenant en fallback muestra la plataforma COMPLETA, no una app vacía", () => {
    // Degradación elegante: una DB que no contesta no puede parecerse a un
    // lanzamiento por etapas. Se recorren TODAS las claves canónicas, no las que
    // el fallback liste: antes este test iteraba `Object.keys(fallback.modules)`
    // y por eso no vio que a esa lista escrita a mano le faltaban `empleos` y
    // `videos` — un tenant en fallback mostraba la app con dos secciones menos y
    // ningún test se quejaba.
    for (const key of MODULE_KEYS) {
      expect(
        moduleAvailability(key, fallback.modules, fallback.modulesSoon),
        `${key} escondido en fallback`,
      ).toBe("active");
    }
  });

  it("y el panel de ese tenant muestra exactamente lo mismo", () => {
    for (const key of MODULE_KEYS) {
      expect(moduleStateOf(key, fallback.modules, fallback.modulesSoon)).toBe("on");
    }
  });
});

describe("visibleModules", () => {
  const items: (GatedModule & { href: string })[] = [
    { href: "/feed", moduleKey: "feed" },
    { href: "/videos" }, // sin clave: el panel no lo gobierna
    { href: "/propiedades", moduleKey: "propiedades" },
    { href: "/marketplace", moduleKey: "marketplace" },
    { href: "/creadores", moduleKey: "creadores" },
  ];

  it("saca los ocultos y anota el estado de los que quedan", () => {
    const out = visibleModules(
      items,
      { feed: true, propiedades: true, marketplace: false, creadores: false },
      { marketplace: true, creadores: false },
    );
    expect(out.map(({ item, state }) => [item.href, state])).toEqual([
      ["/feed", "active"],
      ["/videos", "active"],
      ["/propiedades", "active"],
      ["/marketplace", "soon"],
    ]);
  });

  it("conserva el orden del catálogo: el 'muy pronto' ocupa el casillero que va a ocupar al abrir", () => {
    // Propiedades queda en "muy pronto" y sigue TERCERO, en su lugar de siempre.
    // Si los pendientes se agruparan al final, el día que abra la grilla se
    // reordenaría bajo el dedo de la gente.
    const out = visibleModules(items, { propiedades: false }, { propiedades: true });
    expect(out.map(({ item }) => item.href)).toEqual([
      "/feed",
      "/videos",
      "/propiedades",
      "/marketplace",
      "/creadores",
    ]);
    expect(out[2].state).toBe("soon");
  });

  it("una comunidad sin nada guardado ve el catálogo COMPLETO", () => {
    // El caso de una base recién sembrada: ninguna decisión en las dos columnas
    // no puede leerse como "escondelo todo".
    const out = visibleModules(items, {}, {});
    expect(out.map(({ item }) => item.href)).toEqual(items.map((item) => item.href));
    expect(out.every(({ state }) => state === "active")).toBe(true);
  });

  it("con todo apagado EXPLÍCITAMENTE deja solo lo que la app no apaga", () => {
    const out = visibleModules(
      items,
      { feed: false, propiedades: false, marketplace: false, creadores: false },
      {},
    );
    // Feed sobrevive por ALWAYS_ON y Videos por no tener clave: nunca una lista
    // vacía por accidente.
    expect(out.map(({ item }) => item.href)).toEqual(["/feed", "/videos"]);
  });

  it("una lista vacía devuelve una lista vacía", () => {
    expect(visibleModules([], { feed: true }, {})).toEqual([]);
  });
});
