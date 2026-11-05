import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ETIQUETAS_DE_EJEMPLO,
  TERMINACIONES_NO_PUBLICAS,
  linkDeCompraValido,
} from "./purchase-link";

/**
 * Los dos links que encontró el QA (F03/F04) son el caso literal: botones reales
 * de "Comprar" y "Sacar boletos" que llevaban a `example.com`. `safeExternalHref`
 * los deja pasar y está bien que lo haga: responde "¿es seguro abrirlo?", no
 * "¿alguien puede comprar ahí?".
 */
describe("linkDeCompraValido", () => {
  it.each([
    "https://boleteria.com/fiesta",
    "https://www.ticketmaster.com/evento/123?ref=cl",
    "https://tiendadeana.com",
    "https://panaderia.com.do/pedidos",
    "HTTPS://Tienda.com/pedido",
  ])("acepta un link real: %s", (url) => {
    expect(linkDeCompraValido(url)).not.toBeNull();
  });

  it("devuelve la URL normalizada, sin espacios alrededor", () => {
    expect(linkDeCompraValido("  https://Boleteria.com/fiesta  ")).toBe(
      "https://boleteria.com/fiesta",
    );
  });

  it.each([
    ["https://example.com/entradas", "el del festival (F03)"],
    ["https://example.com/comprar", "el del bizcocho (F04)"],
    ["https://example.net/x", "example.net"],
    ["https://example.org/x", "example.org"],
    ["https://example.edu/x", "example.edu"],
    ["https://www.example.com/x", "subdominio"],
    ["https://EXAMPLE.com/x", "mayúsculas"],
    ["https://example.com./x", "punto final en el host"],
    ["https://ejemplo.com/x", "en español"],
    ["https://test.com/x", "test.com"],
    ["https://prueba.com/x", "prueba.com"],
    ["https://tienda.test/x", "TLD .test"],
    ["https://tienda.example/x", "TLD .example"],
    ["https://tienda.invalid/x", "TLD .invalid"],
    ["https://tienda.local/x", "TLD .local"],
    ["https://tienda.localhost/x", "TLD .localhost"],
  ])("rechaza un destino de ejemplo o de prueba: %s (%s)", (url) => {
    expect(linkDeCompraValido(url)).toBeNull();
  });

  it.each([
    ["https://localhost/x", "localhost"],
    ["https://localhost:3000/x", "localhost con puerto"],
    ["https://127.0.0.1/x", "IPv4"],
    ["https://192.168.0.10/x", "IPv4 privada"],
    ["https://2130706433/x", "IPv4 escrita como un número"],
    ["https://0x7f.0.0.1/x", "IPv4 en hexadecimal"],
    ["https://[::1]/x", "IPv6"],
    ["https://intranet/x", "host sin dominio"],
  ])("rechaza lo que no es un sitio público: %s (%s)", (url) => {
    expect(linkDeCompraValido(url)).toBeNull();
  });

  it.each([
    ["http://boleteria.com/fiesta", "sin https"],
    ["ftp://boleteria.com/fiesta", "otro protocolo"],
    ["javascript:alert(1)", "javascript:"],
    ["data:text/html,<b>x", "data:"],
    ["//boleteria.com/fiesta", "sin protocolo"],
    ["/marketplace", "ruta interna"],
    ["boleteria.com", "sin https://"],
    ["no soy un link", "texto"],
  ])("rechaza lo que no es https: %s (%s)", (url) => {
    expect(linkDeCompraValido(url)).toBeNull();
  });

  it.each([
    ["https://\\example.com", "barra invertida antes del host"],
    ["https://127.0.0.1\\.shop/", "barra invertida que esconde una IP"],
    ["https://ex%61mple.com/", "host con escape %"],
    ["https://ｅxample.com/", "letra de ancho completo"],
    ["https://mi_tienda.com/", "guion bajo: la base no lo acepta"],
  ])("rechaza un host que el navegador lee distinto: %s (%s)", (url) => {
    expect(linkDeCompraValido(url)).toBeNull();
  });

  it("un dominio con ñ se acepta en punycode: es lo que se guarda y lo que pasa el CHECK", () => {
    expect(linkDeCompraValido("https://tienda-ñandú.com/x")).toBe(
      "https://xn--tienda-and-z9a5i.com/x",
    );
  });

  it("rechaza un link con usuario y clave: hace pasar un sitio por otro", () => {
    expect(linkDeCompraValido("https://boleteria.com@sitio-falso.com/x")).toBeNull();
  });

  it("rechaza un link más largo que el tope de las columnas cta_*", () => {
    expect(linkDeCompraValido(`https://boleteria.com/${"x".repeat(500)}`)).toBeNull();
  });

  it.each([[null], [undefined], [""], ["   "], [42], [{}]])(
    "vacío o de otro tipo → null, sin lanzar: %j",
    (value) => {
      expect(linkDeCompraValido(value)).toBeNull();
    },
  );

  it("no confunde un dominio real que apenas contiene la palabra", () => {
    expect(linkDeCompraValido("https://testimonios.com/x")).not.toBeNull();
    expect(linkDeCompraValido("https://myexample.com/x")).not.toBeNull();
  });
});

describe("el espejo en SQL dice lo mismo", () => {
  const lista = (valores: ReadonlySet<string>) =>
    `array[${[...valores].map((v) => `'${v}'`).join(", ")}]`;

  it.each([
    ["supabase/migrations/0183_links_de_compra_reales.sql"],
    ["docs/decisiones/limpieza-links-compra.sql"],
  ])("%s usa las mismas listas", (ruta) => {
    const sql = readFileSync(join(process.cwd(), ruta), "utf8");
    expect(sql).toContain(lista(ETIQUETAS_DE_EJEMPLO));
    expect(sql).toContain(lista(TERMINACIONES_NO_PUBLICAS));
    expect(sql).toContain("v_autoridad !~ '^[a-z0-9.-]+(:[0-9]+)?$'");
  });

  it("la copia de la limpieza tiene el mismo cuerpo que la función de la migración", () => {
    const cuerpo = (ruta: string) => {
      const sql = readFileSync(join(process.cwd(), ruta), "utf8");
      const desde = sql.indexOf("v_url text := btrim(p_url);");
      return sql.slice(desde, sql.indexOf("$$;", desde));
    };
    expect(cuerpo("docs/decisiones/limpieza-links-compra.sql")).toBe(
      cuerpo("supabase/migrations/0183_links_de_compra_reales.sql"),
    );
  });
});
