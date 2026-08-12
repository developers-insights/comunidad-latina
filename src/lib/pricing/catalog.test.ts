import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRICE_INTERVALS,
  PRICE_PRODUCTS,
  PRICE_SLOTS,
  PRODUCT_COPY,
  PRODUCT_ORDER,
  findPrice,
  resolvePrices,
  slotKey,
  type TenantPriceRow,
} from "./catalog";
import { FALLBACK_PRICES, slotsWithoutFallback } from "./defaults";

/**
 * El catálogo de precios vive en TRES lugares que tienen que decir lo mismo:
 * los CHECK de la migración 0072, el `insert` de la 0073 y este módulo. Estos
 * tests son lo que impide que se separen — y que se separen significa, en el
 * mejor caso, un 400 en una pantalla de precios y, en el peor, un tenant
 * cobrando un número que nadie decidió.
 */

const MIGRATIONS = path.resolve(process.cwd(), "supabase", "migrations");
const SQL_0072 = readFileSync(path.join(MIGRATIONS, "0072_precios_por_dominio.sql"), "utf8");
const SQL_0073 = readFileSync(path.join(MIGRATIONS, "0073_semilla_de_precios.sql"), "utf8");
/**
 * La 0092 (alcance geográfico del impulso) REEMPLAZA los CHECK de `product` y
 * `variant` de la 0072 y agrega tres casillas a la semilla. Los tests leen las
 * dos migraciones porque el estado final del esquema es el de la última que
 * tocó cada constraint — mirar sólo la 0072 daría por bueno un catálogo que la
 * base ya no acepta, que es exactamente el error que estos tests existen para
 * atrapar.
 */
const SQL_0092 = readFileSync(
  path.join(MIGRATIONS, "0092_alcance_geografico_del_boost.sql"),
  "utf8",
);

describe("el catálogo espeja las migraciones 0072 + 0092", () => {
  it("los productos del código son exactamente los del CHECK vigente", () => {
    // El CHECK vigente es el que instala la 0092; el de la 0072 quedó atrás y
    // se comprueba igual, para que quede a la vista que uno es subconjunto del
    // otro y que la 0092 no le sacó ningún producto a nadie.
    const vigente = /add constraint tenant_prices_product_check check \(product in \(([\s\S]*?)\n  \)\)/.exec(
      SQL_0092,
    );
    expect(vigente, "no encontré el CHECK de product en la 0092").not.toBeNull();
    const enSql = [...vigente![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(enSql)).toEqual(new Set(PRICE_PRODUCTS));

    const original = /product\s+text not null check \(product in \(([\s\S]*?)\)\)/.exec(SQL_0072);
    expect(original, "no encontré el CHECK de product en 0072").not.toBeNull();
    const enSql0072 = [...original![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const producto of enSql0072) {
      expect(enSql, `la 0092 dejó afuera el producto '${producto}'`).toContain(producto);
    }
  });

  it("los intervalos del código son exactamente los del CHECK", () => {
    const check = /billing_interval text not null check \(billing_interval in \(([\s\S]*?)\)\)/.exec(
      SQL_0072,
    );
    expect(check, "no encontré el CHECK de billing_interval en 0072").not.toBeNull();
    const enSql = [...check![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(new Set(enSql)).toEqual(new Set(PRICE_INTERVALS));
  });

  it("toda variante usada por el catálogo está permitida por el CHECK vigente", () => {
    const check = /add constraint tenant_prices_variant_check check \(variant in \(([\s\S]*?)\n  \)\)/.exec(
      SQL_0092,
    );
    expect(check, "no encontré el CHECK de variant en la 0092").not.toBeNull();
    const permitidas = new Set([...check![1].matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]));
    for (const slot of PRICE_SLOTS) {
      expect(permitidas.has(slot.variant), `variante '${slot.variant}' fuera del CHECK`).toBe(true);
    }
  });
});

describe("la semilla es la constante del código", () => {
  /**
   * Las tuplas del `values (...)` de las DOS semillas: la 0073 sembró las 14
   * casillas originales y la 0092 las tres del alcance. Se leen juntas porque
   * juntas son "lo que hay sembrado", y la comparación de abajo exige que eso
   * sea exactamente el catálogo.
   */
  const TUPLA = /\(\s*'([a-z_]+)',\s*'([a-z0-9]+)',\s*'([a-z]+)',\s*(\d+)\)/g;
  const parsear = (sql: string) =>
    [...sql.matchAll(TUPLA)].map((m) => ({
      product: m[1],
      variant: m[2],
      interval: m[3],
      cents: Number(m[4]),
    }));
  const semilla = [...parsear(SQL_0073), ...parsear(SQL_0092)];

  it("siembra exactamente las casillas del catálogo, ni una más ni una menos", () => {
    expect(semilla.length).toBe(PRICE_SLOTS.length);
    expect(new Set(semilla.map(slotKey))).toEqual(new Set(PRICE_SLOTS.map(slotKey)));
  });

  it("cada monto sembrado coincide centavo a centavo con el respaldo del código", () => {
    for (const fila of semilla) {
      const fallback = FALLBACK_PRICES.get(slotKey(fila));
      expect(fallback, `sin respaldo para ${slotKey(fila)}`).toBeDefined();
      expect(fila.cents, `desajuste en ${slotKey(fila)}`).toBe(fallback!.amountCents);
    }
  });
});

describe("respaldos", () => {
  it("ninguna casilla del catálogo se quedó sin precio de respaldo", () => {
    expect(slotsWithoutFallback()).toEqual([]);
  });

  it("todos los respaldos son centavos enteros y no negativos", () => {
    for (const [key, price] of FALLBACK_PRICES) {
      expect(Number.isSafeInteger(price.amountCents), `${key} no es entero`).toBe(true);
      expect(price.amountCents).toBeGreaterThanOrEqual(0);
      expect(price.currency).toMatch(/^[A-Z]{3}$/);
    }
  });

  it("cada producto tiene copy y está en el orden de render", () => {
    for (const product of PRICE_PRODUCTS) {
      expect(PRODUCT_COPY[product].label.length).toBeGreaterThan(0);
      expect(PRODUCT_COPY[product].blurb.length).toBeGreaterThan(10);
      expect(PRODUCT_ORDER).toContain(product);
    }
    expect(PRODUCT_ORDER.length).toBe(PRICE_PRODUCTS.length);
  });
});

describe("resolvePrices: la fila manda, la constante respalda", () => {
  const fila = (over: Partial<TenantPriceRow> = {}): TenantPriceRow => ({
    id: "11111111-1111-1111-1111-111111111111",
    product: "presencia",
    variant: "basico",
    billing_interval: "mensual",
    amount_cents: 12_345,
    currency: "USD",
    active: true,
    updated_at: "2026-08-08T00:00:00.000Z",
    ...over,
  });

  it("sin filas, las catorce casillas salen del código", () => {
    const resueltos = resolvePrices([], FALLBACK_PRICES);
    expect(resueltos.length).toBe(PRICE_SLOTS.length);
    expect(resueltos.every((price) => price.source === "fallback")).toBe(true);
    expect(findPrice(resueltos, "presencia", "basico", "mensual")?.amountCents).toBe(1900);
  });

  it("una fila activa pisa la constante y se lee de vuelta exacta", () => {
    const resueltos = resolvePrices([fila()], FALLBACK_PRICES);
    const precio = findPrice(resueltos, "presencia", "basico", "mensual");
    expect(precio?.amountCents).toBe(12_345);
    expect(precio?.source).toBe("tenant");
    expect(precio?.id).toBe("11111111-1111-1111-1111-111111111111");
    // Las otras trece no se movieron.
    expect(findPrice(resueltos, "presencia", "pro", "anual")?.source).toBe("fallback");
  });

  it("una fila apagada NO pisa nada — vuelve a regir la constante", () => {
    const resueltos = resolvePrices([fila({ active: false })], FALLBACK_PRICES);
    const precio = findPrice(resueltos, "presencia", "basico", "mensual");
    expect(precio?.amountCents).toBe(1900);
    expect(precio?.source).toBe("fallback");
  });

  it("una fila con datos rotos se descarta en vez de arrastrarse", () => {
    const rotas: TenantPriceRow[] = [
      fila({ amount_cents: -1 }),
      fila({ variant: "destacado", amount_cents: 19.5 }),
      fila({ variant: "pro", currency: "dolares" }),
    ];
    const resueltos = resolvePrices(rotas, FALLBACK_PRICES);
    expect(resueltos.every((price) => price.source === "fallback")).toBe(true);
  });

  it("una fila de un producto que el catálogo no conoce se ignora", () => {
    const resueltos = resolvePrices([fila({ product: "inventado" })], FALLBACK_PRICES);
    expect(resueltos.length).toBe(PRICE_SLOTS.length);
    expect(resueltos.every((price) => price.source === "fallback")).toBe(true);
  });

  it("gratis es un precio válido y NO cae al respaldo", () => {
    const resueltos = resolvePrices([fila({ amount_cents: 0 })], FALLBACK_PRICES);
    const precio = findPrice(resueltos, "presencia", "basico", "mensual");
    expect(precio?.amountCents).toBe(0);
    expect(precio?.source).toBe("tenant");
  });
});
