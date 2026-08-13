import { describe, expect, it } from "vitest";
import { BOOST_MODULE, BROWSE_MODULES, MODULES, isBrowseRoute, isModuleActive } from "./modules";
import { ALWAYS_ON_MODULE_KEYS } from "./module-access";
import { MODULE_KEYS } from "@/app/admin/dominio/modules";

describe("isModuleActive", () => {
  it("matchea la ruta exacta", () => {
    expect(isModuleActive("/eventos", "/eventos")).toBe(true);
  });

  it("matchea sub-rutas del módulo", () => {
    expect(isModuleActive("/eventos/123", "/eventos")).toBe(true);
    expect(isModuleActive("/propiedades/abc/editar", "/propiedades")).toBe(true);
  });

  it("no matchea otra ruta que solo comparte el prefijo de texto", () => {
    // "/eventos2" NO es un hijo de "/eventos" — el guard exige el "/" completo.
    expect(isModuleActive("/eventos2", "/eventos")).toBe(false);
    expect(isModuleActive("/eventosarchivados", "/eventos")).toBe(false);
  });

  it("no matchea un módulo distinto", () => {
    expect(isModuleActive("/negocios", "/eventos")).toBe(false);
    expect(isModuleActive("/", "/eventos")).toBe(false);
  });
});

describe("MODULES", () => {
  // 10 = 7 visibles + Videos (reels, sprint 2026-07-21) + Empleos (feedback
  // 2026-07-24) + Comunidad (pedido del cliente 2026-08-12: perdido y
  // encontrado, clínicas, bancos de comida, consulados). Escudo sigue oculto
  // por pedido del cliente (2026-07-20).
  it("son los módulos visibles de la plataforma, sin href repetido", () => {
    expect(MODULES).toHaveLength(10);
    expect(new Set(MODULES.map((m) => m.href)).size).toBe(10);
  });

  it("Empleos figura en el menú con su acento propio", () => {
    const empleos = MODULES.find((m) => m.href === "/empleos");
    expect(empleos).toBeDefined();
    expect(empleos?.palette.icon).toBe("var(--accent-empleos)");
  });

  it("ningún módulo repite el ícono de otro", () => {
    // El ícono es la mitad de la pista visual del menú: dos módulos con el
    // mismo dibujo se leen como el mismo destino (le pasó a Empleos y
    // Profesionales, los dos con el maletín).
    expect(new Set(MODULES.map((m) => m.icon)).size).toBe(MODULES.length);
  });

  it("Videos figura en el menú (reels del sprint 2026-07-21)", () => {
    const videos = MODULES.find((m) => m.href === "/videos");
    expect(videos).toBeDefined();
    expect(videos?.label.trim().length).toBeGreaterThan(0);
  });

  it("Escudo NO figura mientras la feature esté oculta", () => {
    expect(MODULES.some((m) => m.href.startsWith("/escudo"))).toBe(false);
  });

  it("cada módulo trae etiqueta e ícono — nunca un ítem solo-ícono", () => {
    for (const item of MODULES) {
      expect(item.label.trim().length, `${item.href} sin etiqueta`).toBeGreaterThan(0);
      expect(item.icon, `${item.href} sin ícono`).toBeTruthy();
    }
  });

  it("cada módulo usa un acento propio de globals.css", () => {
    for (const item of MODULES) {
      expect(item.palette.icon).toMatch(/^var\(--accent-[a-z]+\)$/);
    }
  });

  it("una ruta activa exactamente un módulo (sin solapamiento de prefijos)", () => {
    for (const item of MODULES) {
      const activos = MODULES.filter((other) => isModuleActive(item.href, other.href));
      expect(activos.map((a) => a.href)).toEqual([item.href]);
    }
  });
});

/**
 * El puente entre el interruptor del panel y la cápsula que ve el usuario es
 * `ModuleItem.moduleKey`. Si se desincroniza, el panel guarda y la app ignora —
 * exactamente el bug que este trabajo vino a cerrar. Estos tests son la alarma.
 */
describe("MODULES ↔ MODULE_KEYS (el panel y la app hablan del mismo módulo)", () => {
  it("toda clave declarada existe en el panel", () => {
    for (const item of MODULES) {
      if (!item.moduleKey) continue;
      expect(MODULE_KEYS as readonly string[], `${item.href} apunta a una clave fantasma`).toContain(
        item.moduleKey,
      );
    }
  });

  it("ningún módulo se queda sin cablear cuando su clave entra al panel", () => {
    // Regla: si el panel gobierna una clave con el nombre de la ruta, el ítem
    // TIENE que declararla. Los diez módulos de hoy —incluidos /videos y
    // /empleos, que entraron a MODULE_KEYS el 27/7— ya la declaran; este test es
    // la alarma para el próximo que se sume al panel sin cablearse en el menú.
    for (const item of MODULES) {
      const slug = item.href.slice(1);
      if (!(MODULE_KEYS as readonly string[]).includes(slug)) continue;
      expect(item.moduleKey, `${item.href} está en el panel pero no declara su clave`).toBe(slug);
    }
  });

  it("los módulos que el cliente quiere poder apagar son gobernables de verdad", () => {
    // Los dos que nombró en la call del 27/7 («no vamos a abrir el Creator
    // Marketplace ahora… cuando ya hay unos mil usuarios, prendemos el
    // Marketplace»), más el resto de las secciones de catálogo.
    for (const href of [
      "/marketplace",
      "/creadores",
      "/propiedades",
      "/eventos",
      "/negocios",
      "/profesionales",
    ]) {
      const item = MODULES.find((candidate) => candidate.href === href);
      expect(item?.moduleKey, `${href} no se puede apagar desde el panel`).toBeTruthy();
      expect(ALWAYS_ON_MODULE_KEYS.has(item?.moduleKey ?? ""), `${href} es intocable`).toBe(false);
    }
  });
});

describe("BROWSE_MODULES (categorías de /buscar)", () => {
  it("son los módulos que NO tienen pestaña propia en el bottom nav, más Boost", () => {
    // Inicio y Videos están a un toque desde cualquier pantalla: repetirlos en
    // Buscar enseñaría dos caminos para lo mismo. Boost se suma aparte (no
    // sale de MODULES — ver el comentario de BOOST_MODULE en ./modules.ts),
    // así que la cuenta es MODULES menos esos dos, más uno.
    expect(BROWSE_MODULES.map((m) => m.href)).not.toContain("/feed");
    expect(BROWSE_MODULES.map((m) => m.href)).not.toContain("/videos");
    expect(BROWSE_MODULES).toHaveLength(MODULES.length - 2 + 1);
  });

  it("son exactamente las nueve secciones: las ocho de listado más Boost", () => {
    // Las mismas siete que llevan la burbuja "Publicá tu…", más Boost — si
    // alguien agrega un módulo nuevo, tiene que decidir a conciencia si va a
    // los dos lados (MODULES y/o BROWSE_MODULES).
    expect(BROWSE_MODULES.map((m) => m.href).sort()).toEqual([
      "/comunidad",
      "/creadores",
      "/empleos",
      "/eventos",
      "/impulsar",
      "/marketplace",
      "/negocios",
      "/profesionales",
      "/propiedades",
    ]);
  });

  it("Boost es la OCTAVA y última entrada — cierra la grilla, no se mezcla", () => {
    expect(BROWSE_MODULES.at(-1)).toBe(BOOST_MODULE);
  });

  it("Boost no lleva moduleKey — no es una vertical que un tenant pueda apagar", () => {
    expect(BOOST_MODULE.moduleKey).toBeUndefined();
  });

  it("Boost usa el dorado de patrocinado, no un acento de vertical", () => {
    expect(BOOST_MODULE.palette.icon).toBe("var(--color-sponsored)");
  });

  it("cada categoría de listado llega con su ícono 3D — la grilla es visual antes que textual", () => {
    // Dos excepciones a propósito, mismo motivo: sin ícono 3D todavía, caen al
    // fallback Phosphor (ModuleBubble/ModuleCircles ya lo resuelven solos).
    //  · Boost: ver comentario en BOOST_MODULE.
    //  · Comunidad: el cliente confirmó (13/8/2026) que el ícono Phosphor
    //    (mano + corazón) está bien así — no hace falta el .webp 3D. Si algún
    //    día se suma, alcanza con volver a poner `image` en modules.ts y sacar
    //    la excepción de acá.
    for (const item of BROWSE_MODULES) {
      if (item === BOOST_MODULE || item.href === "/comunidad") continue;
      expect(item.image, `${item.href} sin ícono 3D`).toMatch(/^\/icons\/menu\/.+\.webp$/);
    }
  });
});

describe("isBrowseRoute", () => {
  it("reconoce una categoría y sus subrutas", () => {
    expect(isBrowseRoute("/negocios")).toBe(true);
    expect(isBrowseRoute("/propiedades/abc-123")).toBe(true);
    expect(isBrowseRoute("/marketplace/publicar")).toBe(true);
  });

  it("reconoce Boost — es la octava sección de Buscar, mismo trato que las otras siete", () => {
    expect(isBrowseRoute("/impulsar")).toBe(true);
    expect(isBrowseRoute("/impulsar/listing-123")).toBe(true);
  });

  it("no reclama las pestañas ajenas ni /buscar", () => {
    // /buscar es la página exacta de la pestaña: la marca `isModuleActive`,
    // no esta función (si no, el estado se calcularía dos veces).
    expect(isBrowseRoute("/buscar")).toBe(false);
    expect(isBrowseRoute("/feed")).toBe(false);
    expect(isBrowseRoute("/videos")).toBe(false);
    expect(isBrowseRoute("/mensajes")).toBe(false);
    expect(isBrowseRoute("/perfil")).toBe(false);
  });

  it("no se deja engañar por un prefijo de texto", () => {
    expect(isBrowseRoute("/negocios-viejos")).toBe(false);
  });
});
