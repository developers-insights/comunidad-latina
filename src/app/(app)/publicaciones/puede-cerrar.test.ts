import { describe, expect, it } from "vitest";
import { puedeCerrarPublicacion } from "./puede-cerrar";

/**
 * `puedeCerrarPublicacion` es la puerta que decide si "Mis publicaciones"
 * ofrece el botón "Cerrar / Marcar como…" (0117) sobre una fila. El caso que
 * importa de verdad es el de la auditoría: un aviso `paused` por denuncias
 * (0118) NO puede cerrarse desde acá — el trigger `app.listings_guard_cierre()`
 * lo rechaza con excepción del lado de la base, así que mostrar el botón ahí
 * sería ofrecer algo que siempre falla.
 */
describe("puedeCerrarPublicacion", () => {
  it("published, paused (manual) y expired ofrecen el botón — mismo subconjunto que CERRABLES", () => {
    expect(puedeCerrarPublicacion("published", false)).toBe(true);
    expect(puedeCerrarPublicacion("paused", false)).toBe(true);
    expect(puedeCerrarPublicacion("expired", false)).toBe(true);
  });

  it("paused por reportes NO ofrece el botón, aunque 'paused' esté en CERRABLES", () => {
    expect(puedeCerrarPublicacion("paused", true)).toBe(false);
  });

  it("draft, pending_review, removed y closed nunca ofrecen el botón", () => {
    expect(puedeCerrarPublicacion("draft", false)).toBe(false);
    expect(puedeCerrarPublicacion("pending_review", false)).toBe(false);
    expect(puedeCerrarPublicacion("removed", false)).toBe(false);
    expect(puedeCerrarPublicacion("closed", false)).toBe(false);
  });

  it("un estado no cerrable con pausadaPorReportes en true sigue devolviendo false, no un true accidental", () => {
    // No pasa en el call site real (`pausadaPorReportes` sólo es true cuando
    // `status === 'paused'`), pero la función no depende de esa invariante
    // para ser segura: `pausadaPorReportes` en true siempre gana.
    expect(puedeCerrarPublicacion("published", true)).toBe(false);
  });
});
