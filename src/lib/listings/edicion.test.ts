import { describe, expect, it } from "vitest";

import {
  EDICION_LIMITES,
  camposEditables,
  editaEnPaginaPropia,
  fotosNuevas,
  fotosQuitadas,
  hayCambios,
  parsearPrecio,
  pausadoPorReportes,
  puedeEditarse,
  puedePausarse,
  puedeReactivarse,
  statusDespuesDeEditar,
  type ValoresDeAviso,
} from "./edicion";

/**
 * La regla que decide qué ofrece el menú es LA MISMA que valida la server
 * action. Estos tests fijan esa regla en un solo lugar: si alguien la afloja
 * para que aparezca un botón, acá se entera antes que en producción.
 */

describe("qué se puede editar y desde dónde", () => {
  it("se edita lo publicado, lo pausado por el dueño y lo que ya está en revisión", () => {
    expect(puedeEditarse("published")).toBe(true);
    expect(puedeEditarse("paused")).toBe(true);
    expect(puedeEditarse("pending_review")).toBe(true);
  });

  it("no se edita lo que bajó moderación, lo cerrado, lo vencido ni un borrador", () => {
    expect(puedeEditarse("removed")).toBe(false);
    expect(puedeEditarse("closed")).toBe(false);
    expect(puedeEditarse("expired")).toBe(false);
    expect(puedeEditarse("draft")).toBe(false);
  });

  it("una pausa por denuncias no se destraba editando", () => {
    expect(puedeEditarse("paused", true)).toBe(false);
    expect(puedeReactivarse("paused", true)).toBe(false);
  });

  it("pausar es sólo para lo que está a la vista; reactivar, sólo para lo pausado", () => {
    expect(puedePausarse("published")).toBe(true);
    expect(puedePausarse("paused")).toBe(false);
    expect(puedePausarse("pending_review")).toBe(false);
    expect(puedeReactivarse("paused")).toBe(true);
    expect(puedeReactivarse("published")).toBe(false);
  });

  it("lee el motivo de la pausa de attrs sin romperse con un jsonb raro", () => {
    expect(pausadoPorReportes("paused", { paused_reason: "reports" })).toBe(true);
    expect(pausadoPorReportes("paused", { paused_reason: "owner" })).toBe(false);
    expect(pausadoPorReportes("paused", null)).toBe(false);
    expect(pausadoPorReportes("paused", ["reports"])).toBe(false);
    expect(pausadoPorReportes("published", { paused_reason: "reports" })).toBe(false);
  });
});

describe("a qué estado queda después de guardar", () => {
  it("lo publicado vuelve a revisión — el WITH CHECK de listings_update no admite 'published'", () => {
    expect(statusDespuesDeEditar("published")).toBe("pending_review");
  });

  it("lo pausado sigue pausado: no se ve, así que no ocupa lugar en la cola", () => {
    expect(statusDespuesDeEditar("paused")).toBe("paused");
  });

  it("lo que ya estaba en revisión sigue en revisión", () => {
    expect(statusDespuesDeEditar("pending_review")).toBe("pending_review");
  });

  it("nunca devuelve 'published': eso rebotaría con 42501 contra la RLS del dueño", () => {
    for (const status of ["published", "paused", "pending_review", "draft", "expired"]) {
      expect(statusDespuesDeEditar(status)).not.toBe("published");
    }
  });
});

describe("campos por vertical", () => {
  it("un profesional no publica tarifa; un producto sí", () => {
    expect(camposEditables("professional").precio).toBe(false);
    expect(camposEditables("product").precio).toBe(true);
    expect(camposEditables("property").precioEtiqueta).toBe("Precio del alquiler");
  });

  it("un kind desconocido cae en algo usable en vez de romperse", () => {
    const campos = camposEditables("inventado");
    expect(campos.descripcionEtiqueta).toBe("Descripción");
    expect(campos.precio).toBe(false);
  });

  it("negocios se manda a su propia página, no a la hoja", () => {
    expect(editaEnPaginaPropia("business")).toBe("editar-negocio");
    expect(editaEnPaginaPropia("product")).toBeNull();
  });
});

describe("hayCambios", () => {
  const base: ValoresDeAviso = {
    title: "Bicicleta rodado 29",
    description: "Con luces y candado.",
    priceAmount: 250,
    photos: ["t/l/a.webp", "t/l/b.webp"],
  };

  it("no ve cambios cuando sólo sobran espacios", () => {
    expect(hayCambios(base, { ...base, title: "  Bicicleta rodado 29  " })).toBe(false);
  });

  it("ve el cambio de precio, incluso a null", () => {
    expect(hayCambios(base, { ...base, priceAmount: 260 })).toBe(true);
    expect(hayCambios(base, { ...base, priceAmount: null })).toBe(true);
  });

  it("ve el cambio de fotos por cantidad y por orden", () => {
    expect(hayCambios(base, { ...base, photos: ["t/l/a.webp"] })).toBe(true);
    expect(hayCambios(base, { ...base, photos: ["t/l/b.webp", "t/l/a.webp"] })).toBe(true);
    expect(hayCambios(base, { ...base, photos: ["t/l/a.webp", "t/l/b.webp"] })).toBe(false);
  });
});

describe("fotos nuevas y quitadas", () => {
  it("separa las que entran de las que salen", () => {
    const antes = ["a.webp", "b.webp"];
    const ahora = ["b.webp", "c.webp"];
    expect(fotosNuevas(antes, ahora)).toEqual(["c.webp"]);
    expect(fotosQuitadas(antes, ahora)).toEqual(["a.webp"]);
  });

  it("sin cambios no hay nada que moderar de nuevo", () => {
    expect(fotosNuevas(["a.webp"], ["a.webp"])).toEqual([]);
    expect(fotosQuitadas(["a.webp"], ["a.webp"])).toEqual([]);
  });
});

describe("parsearPrecio", () => {
  it("el campo vacío significa 'sin precio', no cero", () => {
    expect(parsearPrecio("")).toBeNull();
    expect(parsearPrecio("   ")).toBeNull();
  });

  it("entiende las dos formas de escribir mil doscientos", () => {
    expect(parsearPrecio("1.200")).toBe(1200);
    expect(parsearPrecio("1,200")).toBe(1200);
    expect(parsearPrecio("1200")).toBe(1200);
  });

  it("entiende los centavos con coma y con punto", () => {
    expect(parsearPrecio("1.200,50")).toBe(1200.5);
    expect(parsearPrecio("1,200.50")).toBe(1200.5);
    expect(parsearPrecio("99,90")).toBe(99.9);
  });

  it("ignora el signo de pesos y los espacios", () => {
    expect(parsearPrecio("$ 450")).toBe(450);
    expect(parsearPrecio("USD 450")).toBe(450);
  });

  it("devuelve undefined cuando no hay un número, para poder decirlo", () => {
    expect(parsearPrecio("a convenir")).toBeUndefined();
    expect(parsearPrecio("$$$")).toBeUndefined();
  });

  it("el tope de forma es el mismo que el del alta", () => {
    expect(EDICION_LIMITES.precioMax).toBe(1_000_000);
    expect(EDICION_LIMITES.tituloMax).toBe(120);
  });
});
