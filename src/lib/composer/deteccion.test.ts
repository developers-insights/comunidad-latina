import { describe, expect, it } from "vitest";
import { detectarTipoDePublicacion } from "./deteccion";

/**
 * Lo que se prueba acá: que el umbral conservador ("mejor no sugerir que
 * sugerir mal", ver el docblock de `deteccion.ts`) se cumple en los dos
 * sentidos — sugiere cuando corresponde, y sobre todo se CALLA cuando el
 * texto es ambiguo, corto, o es alguien BUSCANDO en vez de OFRECIENDO.
 */

describe("detectarTipoDePublicacion — empleo", () => {
  it("una señal fuerte alcanza sola", () => {
    expect(
      detectarTipoDePublicacion(
        "Se busca personal para atención al cliente en el local del centro.",
      ),
    ).toEqual({
      tipo: "empleo",
      etiqueta: "¿Tenés una vacante?",
      href: "/empleos/publicar",
    });
  });

  it("dos señales débiles alcanzan juntas", () => {
    const sugerencia = detectarTipoDePublicacion(
      "Buscamos alguien para tiempo completo, aplicar por mensaje privado.",
    );
    expect(sugerencia?.tipo).toBe("empleo");
  });

  it("una sola señal débil NO alcanza", () => {
    // Sólo "vacante" — ninguna otra señal de empleo en el resto del texto.
    expect(
      detectarTipoDePublicacion("Qué lindo el vacante ese departamento que visitamos ayer, che."),
    ).toBeNull();
  });

  it('"busco trabajo" es una persona buscando, NO una vacante', () => {
    expect(
      detectarTipoDePublicacion(
        "Busco trabajo de medio tiempo, tengo experiencia en atención al cliente.",
      ),
    ).toBeNull();
  });

  it('la exclusión también cubre "buscando" (gerundio), no sólo "busco"', () => {
    expect(
      detectarTipoDePublicacion(
        "Ando buscando trabajo de medio tiempo, tiempo completo también me sirve.",
      ),
    ).toBeNull();
  });

  it('"necesito empleo" tampoco es una vacante', () => {
    expect(
      detectarTipoDePublicacion(
        "Necesito empleo urgente, tengo experiencia en tiempo completo y medio tiempo.",
      ),
    ).toBeNull();
  });

  // Regresión (code review 2026-08-26): las exclusiones eran frases pegadas y
  // estas cinco variantes reales se colaban como sugerencia. La fórmula
  // "se busca empleo" es el clasificado clásico de quien se OFRECE.
  it('"se busca empleo de cocinero" es alguien ofreciéndose, no una vacante', () => {
    expect(
      detectarTipoDePublicacion("Se busca empleo de cocinero, tengo experiencia"),
    ).toBeNull();
  });

  it("la pregunta por terceros no es una vacante", () => {
    expect(
      detectarTipoDePublicacion("Alguien conoce trabajo de medio tiempo cerca?"),
    ).toBeNull();
  });

  it('"se busca personal para trabajo de limpieza" SÍ es una vacante (el gap no la come)', () => {
    expect(
      detectarTipoDePublicacion("Se busca personal para trabajo de limpieza en Queens"),
    ).not.toBeNull();
  });
});

describe("detectarTipoDePublicacion — quien pide techo no alquila (regresión)", () => {
  it('"se busca cuarto" no es un aviso de alquiler', () => {
    expect(
      detectarTipoDePublicacion("Se busca cuarto o habitacion para una persona sola"),
    ).toBeNull();
  });

  it("el artículo en el medio no rompe la exclusión", () => {
    expect(
      detectarTipoDePublicacion("Ando buscando un cuarto, si saben de un apartamento avisen"),
    ).toBeNull();
  });

  it('"en busca de un cuarto" tampoco', () => {
    expect(
      detectarTipoDePublicacion("Estoy en busca de un cuarto o habitacion economica"),
    ).toBeNull();
  });
});

describe("detectarTipoDePublicacion — propiedad", () => {
  it('"se alquila" alcanza sola', () => {
    expect(
      detectarTipoDePublicacion("Se alquila cuarto amplio cerca del centro, incluye agua y luz."),
    ).toEqual({
      tipo: "propiedad",
      etiqueta: "¿Alquilás un cuarto o apartamento?",
      href: "/publicar?kind=property",
    });
  });

  it("dos señales débiles alcanzan juntas", () => {
    const sugerencia = detectarTipoDePublicacion(
      "Tengo un apartamento disponible, viene amoblado y con depósito bajo.",
    );
    expect(sugerencia?.tipo).toBe("propiedad");
  });

  it('"busco apartamento" es alguien buscando, no ofreciendo', () => {
    expect(
      detectarTipoDePublicacion(
        "Busco apartamento barato cerca del trabajo, con un cuarto separado estaría bien.",
      ),
    ).toBeNull();
  });

  it('la negación explícita ("no se alquila") apaga la sugerencia', () => {
    expect(
      detectarTipoDePublicacion(
        "No se alquila el cuarto de arriba, ya lo agarró alguien de la familia.",
      ),
    ).toBeNull();
  });
});

describe("detectarTipoDePublicacion — evento", () => {
  it('la frase "boletos disponibles" alcanza sola', () => {
    const sugerencia = detectarTipoDePublicacion(
      "Tenemos boletos disponibles para el show de este fin de semana en el salón.",
    );
    expect(sugerencia).toEqual({
      tipo: "evento",
      etiqueta: "¿Estás organizando un evento?",
      href: "/publicar?kind=event",
    });
  });

  it("el patrón día + hora alcanza solo, sin ninguna otra señal de evento", () => {
    const sugerencia = detectarTipoDePublicacion(
      "Nos vemos el sábado a las 8pm en la casa comunal, va a estar buenísimo.",
    );
    expect(sugerencia?.tipo).toBe("evento");
  });

  it("dos señales débiles alcanzan juntas", () => {
    const sugerencia = detectarTipoDePublicacion(
      "Este viernes hay evento en el salón, los esperamos a todos por la tarde.",
    );
    expect(sugerencia?.tipo).toBe("evento");
  });

  it('mencionar "evento" UNA sola vez, en una pregunta a la comunidad, no alcanza', () => {
    expect(
      detectarTipoDePublicacion(
        "¿Cuál fue el mejor evento al que fuiste este año? Yo todavía no decido cuál.",
      ),
    ).toBeNull();
  });
});

describe("detectarTipoDePublicacion — oferta", () => {
  it('"2x1" alcanza sola', () => {
    const sugerencia = detectarTipoDePublicacion(
      "Tenemos 2x1 en cortes de cabello todo este mes, vengan a aprovechar.",
    );
    expect(sugerencia).toEqual({
      tipo: "oferta",
      etiqueta: "¿Es una promo de tu negocio?",
      href: "/publicar?kind=business",
    });
  });

  it("el patrón de porcentaje de descuento alcanza solo", () => {
    const sugerencia = detectarTipoDePublicacion(
      "Todo con 20% de descuento esta semana en la tienda, pasen a ver.",
    );
    expect(sugerencia?.tipo).toBe("oferta");
  });

  it("dos señales débiles alcanzan juntas", () => {
    const sugerencia = detectarTipoDePublicacion(
      "Tenemos una promoción solo por hoy en el local, no se la pierdan.",
    );
    expect(sugerencia?.tipo).toBe("oferta");
  });

  it('la negación explícita ("no hay descuento") apaga la sugerencia', () => {
    expect(
      detectarTipoDePublicacion(
        "No hay descuento en nada estas navidades, todo está a precio normal, che.",
      ),
    ).toBeNull();
  });
});

describe("detectarTipoDePublicacion — articulo", () => {
  it('"se vende" alcanza sola', () => {
    const sugerencia = detectarTipoDePublicacion(
      "Se vende bicicleta de montaña en buen estado, precio a conversar.",
    );
    expect(sugerencia).toEqual({
      tipo: "articulo",
      etiqueta: "¿Estás vendiendo algo?",
      href: "/marketplace/publicar",
    });
  });

  it("dos señales débiles alcanzan juntas", () => {
    const sugerencia = detectarTipoDePublicacion(
      "Vendo un sofá usado en buen estado, precio negociable, mensaje si interesa.",
    );
    expect(sugerencia?.tipo).toBe("articulo");
  });

  it('la negación explícita ("no vendo") apaga la sugerencia', () => {
    expect(
      detectarTipoDePublicacion(
        "No vendo mis herramientas, son un regalo de mi papá y las quiero conservar.",
      ),
    ).toBeNull();
  });
});

describe("detectarTipoDePublicacion — acentos y mayúsculas", () => {
  it("detecta igual en mayúsculas y con tildes", () => {
    const sugerencia = detectarTipoDePublicacion(
      "SE ALQUILA UN CUARTO AMPLIO, LLAMAR AL NÚMERO DE ABAJO POR FAVOR.",
    );
    expect(sugerencia?.tipo).toBe("propiedad");
  });

  it("detecta con acentos propios de la frase señal (mañana, día)", () => {
    const sugerencia = detectarTipoDePublicacion(
      "SE BUSCA PERSONAL para el turno de la mañana, día completo, buen pago.",
    );
    expect(sugerencia?.tipo).toBe("empleo");
  });
});

describe("detectarTipoDePublicacion — negativos (charla normal)", () => {
  it("un texto de charla sin ninguna señal no sugiere nada", () => {
    expect(
      detectarTipoDePublicacion("Hoy hice un asado con la familia, estuvo buenísimo, todos contentos."),
    ).toBeNull();
  });

  it("una pregunta genuina a la comunidad no sugiere nada", () => {
    expect(
      detectarTipoDePublicacion(
        "¿Alguien sabe de un buen electricista en la zona? Se me quemó un enchufe.",
      ),
    ).toBeNull();
  });

  it("un saludo o mensaje corto no sugiere nada", () => {
    expect(
      detectarTipoDePublicacion("Feliz cumpleaños a mi hermana, la quiero muchísimo hoy."),
    ).toBeNull();
  });
});

describe("detectarTipoDePublicacion — largo mínimo (15 caracteres)", () => {
  it("un texto de menos de 15 caracteres nunca sugiere, aunque tenga una señal fuerte", () => {
    // "se alquila" son 10 caracteres — señal fuerte real, pero corta.
    expect(detectarTipoDePublicacion("se alquila")).toBeNull();
  });

  it("14 caracteres (justo debajo del mínimo) no sugiere", () => {
    const texto = "se alquila ya."; // 14 caracteres
    expect(texto.length).toBe(14);
    expect(detectarTipoDePublicacion(texto)).toBeNull();
  });

  it("15 caracteres o más, con la misma señal, sí sugiere", () => {
    const texto = "se alquila ya!!"; // 15 caracteres
    expect(texto.length).toBe(15);
    expect(detectarTipoDePublicacion(texto)?.tipo).toBe("propiedad");
  });

  it("los espacios de los bordes no cuentan para el mínimo", () => {
    expect(detectarTipoDePublicacion("   hola a todos   ")).toBeNull();
  });

  it("una cadena vacía o sólo espacios no rompe nada", () => {
    expect(detectarTipoDePublicacion("")).toBeNull();
    expect(detectarTipoDePublicacion("     ")).toBeNull();
  });
});

describe("detectarTipoDePublicacion — pureza", () => {
  it("el mismo texto siempre da el mismo resultado (sin estado interno)", () => {
    const texto = "Se busca personal para el turno de la tarde, medio tiempo.";
    const primera = detectarTipoDePublicacion(texto);
    const segunda = detectarTipoDePublicacion(texto);
    expect(primera).toEqual(segunda);
  });
});
