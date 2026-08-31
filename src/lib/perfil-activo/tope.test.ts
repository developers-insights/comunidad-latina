import { describe, expect, it } from "vitest";
import {
  TOPE_DE_NEGOCIOS,
  contarNegociosPropios,
  esErrorDeTope,
  lugaresDeNegocio,
} from "./tope";

/**
 * =============================================================================
 * EL TOPE DE DIEZ — la parte que decide qué se le muestra a la persona
 * =============================================================================
 *
 * Quien APLICA el tope es la base (`app.business_accounts_enforce_cap`, 0121).
 * Lo que se prueba acá es lo otro: que el cartel que ve la persona diga la
 * verdad, y sobre todo que se equivoque siempre para el mismo lado — ofrecer un
 * lugar de más se corrige con un mensaje; decirle a alguien que llegó al tope
 * cuando le quedan cinco es una función que desaparece sin explicación.
 */

describe("lugaresDeNegocio", () => {
  it("sin ningún negocio, están los diez", () => {
    expect(lugaresDeNegocio(0)).toEqual({
      usados: 0,
      tope: 10,
      restantes: 10,
      puedeCrear: true,
    });
  });

  it("con nueve queda uno, y todavía se puede crear", () => {
    const lugares = lugaresDeNegocio(9);
    expect(lugares.restantes).toBe(1);
    expect(lugares.puedeCrear).toBe(true);
  });

  it("con diez no queda ninguno", () => {
    const lugares = lugaresDeNegocio(10);
    expect(lugares.restantes).toBe(0);
    expect(lugares.puedeCrear).toBe(false);
  });

  it("con MÁS de diez no devuelve negativos: el cartel diría un disparate", () => {
    // Puede pasar de verdad: la 0121 no aplica el tope hacia atrás, así que si
    // alguien quedó con doce, la app tiene que decir "no podés crear más" y no
    // "te quedan -2".
    const lugares = lugaresDeNegocio(12);
    expect(lugares.restantes).toBe(0);
    expect(lugares.puedeCrear).toBe(false);
    expect(lugares.usados).toBe(12);
  });

  it("basura numérica cae al default en vez de propagar NaN a la pantalla", () => {
    expect(lugaresDeNegocio(Number.NaN).restantes).toBe(TOPE_DE_NEGOCIOS);
    expect(lugaresDeNegocio(-3).usados).toBe(0);
    expect(lugaresDeNegocio(2, 0).tope).toBe(TOPE_DE_NEGOCIOS);
    expect(lugaresDeNegocio(2, Number.NaN).tope).toBe(TOPE_DE_NEGOCIOS);
  });

  it("acepta un tope distinto: el número manda desde la base, no desde acá", () => {
    expect(lugaresDeNegocio(3, 5)).toEqual({
      usados: 3,
      tope: 5,
      restantes: 2,
      puedeCrear: true,
    });
  });
});

describe("contarNegociosPropios", () => {
  it("administrar negocios AJENOS no consume lugares", () => {
    // La regla de la 0103, que la 0121 no cambió: el tope es sobre owner_id.
    const negocios = [
      { esPropietario: true },
      { esPropietario: false },
      { esPropietario: false },
    ];
    expect(contarNegociosPropios(negocios)).toBe(1);
    expect(lugaresDeNegocio(contarNegociosPropios(negocios)).restantes).toBe(9);
  });

  it("sin el dato NO cuenta: ante la duda se ofrece el lugar y decide la base", () => {
    // Los consumidores del cambiador mapean campo por campo y pueden no mandar
    // `esPropietario`. Contarlos como propios haría que alguien con diez
    // negocios ajenos viera "llegaste al tope" sin tener ninguno propio.
    expect(contarNegociosPropios([{}, {}, {}])).toBe(0);
  });

  it("lista vacía es cero, no NaN", () => {
    expect(contarNegociosPropios([])).toBe(0);
  });
});

describe("esErrorDeTope", () => {
  it("reconoce el error del trigger por su prefijo", () => {
    expect(
      esErrorDeTope({
        code: "P0001",
        message:
          "TOPE_DE_NEGOCIOS: ya hay 10 cuentas de negocio para este dueño en esta comunidad (tope 10)",
      }),
    ).toBe(true);
  });

  it("NO confunde otros P0001 de la base con el tope", () => {
    // `P0001` es el código de cualquier `raise exception`: lo usan también la
    // guarda de billing (0008) y la de columnas de reseñas (0093). Mirar sólo
    // el código mostraría "llegaste al tope" ante un error que no lo es.
    expect(
      esErrorDeTope({
        code: "P0001",
        message: "PROTECTED_COLUMNS: plan/billing de business_accounts solo se modifican…",
      }),
    ).toBe(false);
  });

  it("un 23505 cualquiera no es el tope", () => {
    expect(esErrorDeTope({ code: "23505", message: "duplicate key value" })).toBe(false);
  });

  it("null y un error sin mensaje no rompen nada", () => {
    expect(esErrorDeTope(null)).toBe(false);
    expect(esErrorDeTope({ code: "P0001" })).toBe(false);
  });
});
