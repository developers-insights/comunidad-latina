import { describe, expect, it } from "vitest";
import {
  encodeZonaCookie,
  readZonaCookie,
  sanitizeZona,
  ZONA_MAX_LEN,
  ZONA_TODAS,
} from "./cookie";

/**
 * El valor de `cl-zona` lo escribe el navegador, así que es ENTRADA DEL CLIENTE
 * y termina adentro de un `.in("area_label", …)` de PostgREST. Estos casos son
 * el contrato de qué se acepta y qué no.
 */
describe("sanitizeZona — la etiqueta se respeta, la basura no pasa", () => {
  it("deja intacta una zona normal, con acentos, comas y mayúsculas", () => {
    expect(sanitizeZona("Corona, Queens")).toBe("Corona, Queens");
    expect(sanitizeZona("Bogotá")).toBe("Bogotá");
    expect(sanitizeZona("Washington Heights")).toBe("Washington Heights");
  });

  it("recorta espacios de sobra sin cambiar el nombre", () => {
    expect(sanitizeZona("  Corona,   Queens  ")).toBe("Corona, Queens");
    expect(sanitizeZona("Jackson\tHeights")).toBe("Jackson Heights");
  });

  it("barre los caracteres de control en vez de dejarlos entrar a la query", () => {
    expect(sanitizeZona("Coro\u0000na")).toBe("Coro na");
    expect(sanitizeZona("Corona\n\r")).toBe("Corona");
  });

  it("rechaza lo que no puede ser una zona", () => {
    expect(sanitizeZona("")).toBeNull();
    expect(sanitizeZona("   ")).toBeNull();
    expect(sanitizeZona(null)).toBeNull();
    expect(sanitizeZona(undefined)).toBeNull();
    expect(sanitizeZona(42)).toBeNull();
    expect(sanitizeZona({ zona: "Corona" })).toBeNull();
  });

  it("rechaza una zona de un solo carácter útil: emparejaría con medio catálogo", () => {
    // El match es laxo por contención: "a" está adentro de casi cualquier
    // barrio, así que filtrar por "a" no filtra nada y parece que sí.
    expect(sanitizeZona("a")).toBeNull();
    expect(sanitizeZona("  ó ")).toBeNull();
    expect(sanitizeZona("!!!")).toBeNull();
    expect(sanitizeZona("Co")).toBe("Co");
  });

  it("nadie puede secuestrar el centinela de «toda la comunidad»", () => {
    expect(sanitizeZona(ZONA_TODAS)).toBeNull();
    expect(sanitizeZona("  __todas ")).toBeNull();
  });

  it("recorta al techo de largo sin dejar un espacio colgando", () => {
    const largo = `${"Corona ".repeat(30)}Queens`;
    const salida = sanitizeZona(largo);
    expect(salida).not.toBeNull();
    expect(salida!.length).toBeLessThanOrEqual(ZONA_MAX_LEN);
    expect(salida!).toBe(salida!.trim());
  });
});

describe("encodeZonaCookie / readZonaCookie — ida y vuelta", () => {
  it("una zona con coma y acento sobrevive el viaje", () => {
    const crudo = encodeZonaCookie("Corona, Queens");
    // Ni comas ni espacios crudos: en un Set-Cookie la coma es un separador.
    expect(crudo).not.toContain(",");
    expect(crudo).not.toContain(" ");
    expect(readZonaCookie(crudo)).toEqual({ modo: "zona", label: "Corona, Queens" });
    expect(readZonaCookie(encodeZonaCookie("Bogotá"))).toEqual({
      modo: "zona",
      label: "Bogotá",
    });
  });

  it("«toda la comunidad» se guarda como una elección, no como ausencia", () => {
    expect(encodeZonaCookie(null)).toBe(ZONA_TODAS);
    expect(readZonaCookie(ZONA_TODAS)).toEqual({ modo: "todas" });
  });

  it("una cookie ilegible no dice nada — nunca «no filtres»", () => {
    expect(readZonaCookie(null)).toBeNull();
    expect(readZonaCookie(undefined)).toBeNull();
    expect(readZonaCookie("")).toBeNull();
    // Percent-encoding roto: decodeURIComponent lanza y no puede tumbar nada.
    expect(readZonaCookie("%E0%A4%A")).toBeNull();
    expect(readZonaCookie("a")).toBeNull();
  });

  it("una cookie escrita a mano igual pasa por el saneo", () => {
    expect(readZonaCookie("Corona%00%00")).toEqual({ modo: "zona", label: "Corona" });
  });
});
