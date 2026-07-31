import { describe, expect, it } from "vitest";
import {
  blockContactInfo,
  blockContactInfoIn,
  contactBlockMessage,
  findContactMatches,
} from "./contact-block";

/**
 * El valor de este archivo NO son los casos que bloquean — esos son fáciles.
 * Son los que NO deben bloquear: un falso positivo le rechaza el mensaje a
 * alguien que no hizo nada, con un cartel que insinúa lo contrario. Cada frase
 * de "deja pasar" está sacada del copy real del módulo (presupuestos,
 * entregables, placeholders del formulario de propuesta).
 */

describe("findContactMatches — lo que SÍ es un dato de contacto", () => {
  it("detecta un teléfono con y sin formato", () => {
    expect(findContactMatches("llamame al +1 917 555 0134")[0]?.kind).toBe("phone");
    expect(findContactMatches("mi numero 9175550134")[0]?.kind).toBe("phone");
    expect(findContactMatches("(917) 555-0134")[0]?.kind).toBe("phone");
  });

  it("detecta un correo, también ofuscado con 'arroba' y 'punto'", () => {
    expect(findContactMatches("escribime a juan@gmail.com")[0]?.kind).toBe("email");
    expect(findContactMatches("juan arroba gmail punto com")[0]?.kind).toBe("email");
  });

  it("detecta enlaces con y sin esquema", () => {
    expect(findContactMatches("mira https://mitienda.com/catalogo")[0]?.kind).toBe("link");
    expect(findContactMatches("entra a www.mitienda.com")[0]?.kind).toBe("link");
    expect(findContactMatches("mitienda.com")[0]?.kind).toBe("link");
  });

  it("detecta un usuario de redes", () => {
    expect(findContactMatches("soy @mimarca_ok")[0]?.kind).toBe("handle");
  });

  it("detecta la invitación a irse a otro canal", () => {
    expect(findContactMatches("hablemos por whatsapp")[0]?.kind).toBe("messaging");
    expect(findContactMatches("escribime por IG")[0]?.kind).toBe("messaging");
    expect(findContactMatches("mandame un mensaje al telegram")[0]?.kind).toBe("messaging");
  });

  it("detecta un teléfono deletreado en palabras", () => {
    expect(findContactMatches("nueve uno siete cinco cinco cinco cero uno")[0]?.kind).toBe(
      "phone",
    );
  });

  it("ve a través de homoglifos de ancho completo", () => {
    expect(findContactMatches("９１７５５５０１３４")[0]?.kind).toBe("phone");
    expect(findContactMatches("juan＠gmail．com")[0]?.kind).toBe("email");
  });

  it("devuelve el fragmento tal como lo escribió la persona, con su índice", () => {
    const texto = "Mi correo es Juan.Perez@Gmail.com, gracias";
    const [match] = findContactMatches(texto);
    expect(match?.text).toBe("Juan.Perez@Gmail.com");
    expect(texto.slice(match!.index, match!.index + match!.text.length)).toBe(
      "Juan.Perez@Gmail.com",
    );
  });

  it("no devuelve el mismo fragmento dos veces con reglas distintas", () => {
    // "juan@gmail.com" matchea email Y (por el dominio) link: gana el más específico.
    const matches = findContactMatches("juan@gmail.com");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.kind).toBe("email");
  });

  it("no arrastra lastIndex entre llamadas (regex `g` compartida)", () => {
    const texto = "llamame al 917 555 0134";
    expect(findContactMatches(texto)).toHaveLength(1);
    expect(findContactMatches(texto)).toHaveLength(1);
    expect(findContactMatches(texto)).toHaveLength(1);
  });
});

describe("findContactMatches — lo que NO puede bloquear (falsos positivos caros)", () => {
  it("deja pasar precios y presupuestos", () => {
    expect(findContactMatches("Mi presupuesto es $800 por 3 reels")).toEqual([]);
    expect(findContactMatches("Cobro 1.500 por el pack completo")).toEqual([]);
    expect(findContactMatches("El total sería 2500 USD")).toEqual([]);
    expect(findContactMatches("1.500.000 pesos por la campaña")).toEqual([]);
  });

  it("deja pasar entregables y medidas", () => {
    expect(findContactMatches("3 videos verticales de 30s + 5 fotos editadas")).toEqual([]);
    expect(findContactMatches("Entrego en 7 días, resolución 1920x1080")).toEqual([]);
    expect(findContactMatches("Trabajo con archivos de hasta 500 mb")).toEqual([]);
  });

  it("deja pasar nombrar una red como oficio, sin invitar a salir", () => {
    expect(findContactMatches("Hago reels para Instagram hace 3 años")).toEqual([]);
    expect(findContactMatches("Edito contenido para TikTok y para Facebook")).toEqual([]);
    expect(findContactMatches("Manejo redes sociales de restaurantes")).toEqual([]);
  });

  it("deja pasar texto normal de una propuesta", () => {
    const propuesta =
      "Hola! Soy fotógrafa gastronómica. Te puedo entregar 3 videos verticales " +
      "listos para publicar, con música y subtítulos. Trabajé con 12 restaurantes " +
      "de la zona. Mi presupuesto es 800 dólares y entrego en 5 días.";
    expect(findContactMatches(propuesta)).toEqual([]);
  });

  it("deja pasar un texto vacío o nulo sin romper", () => {
    expect(findContactMatches("")).toEqual([]);
    expect(findContactMatches(null)).toEqual([]);
    expect(findContactMatches(undefined)).toEqual([]);
    expect(findContactMatches("   ")).toEqual([]);
  });

  it("no toma un '@' suelto ni un usuario de 1-2 letras por un handle", () => {
    expect(findContactMatches("cobro @ 800 el reel")).toEqual([]);
    expect(findContactMatches("@ok")).toEqual([]);
  });
});

describe("blockContactInfo", () => {
  it("deja pasar un mensaje limpio", () => {
    expect(blockContactInfo("Te entrego 3 reels en 5 días por 800 dólares")).toEqual({
      ok: true,
    });
  });

  it("bloquea y explica QUÉ encontró y QUÉ hacer", () => {
    const result = blockContactInfo("escribime al 917 555 0134");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kinds).toContain("phone");
    expect(result.message).toContain("un teléfono");
    // El mensaje tiene que decir el porqué y la salida, no solo "no se puede".
    expect(result.message).toContain("contrato");
    expect(result.message).toContain("Sacá ese dato");
  });

  it("lista varios tipos en una sola frase legible", () => {
    expect(contactBlockMessage(["phone", "email", "link"])).toContain(
      "un teléfono, un correo y un enlace",
    );
  });

  it("no repite un tipo que apareció dos veces", () => {
    const result = blockContactInfo("917 555 0134 o si no 917 555 0199");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kinds).toEqual(["phone"]);
  });
});

describe("blockContactInfoIn", () => {
  it("pasa si todos los campos están limpios", () => {
    expect(blockContactInfoIn(["3 reels para el restaurante", "Entrega en 7 días"])).toEqual({
      ok: true,
    });
  });

  it("frena en el primer campo con contacto", () => {
    const result = blockContactInfoIn(["Título normal", "escribime a hola@correo.com"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kinds).toEqual(["email"]);
  });

  it("ignora campos nulos", () => {
    expect(blockContactInfoIn([null, undefined, "todo bien"])).toEqual({ ok: true });
  });
});
