import { describe, expect, it } from "vitest";
import { extractSponsored } from "./page";
import type { EventCardModel } from "@/components/directory";

/**
 * Lógica pura de la franja "Patrocinados" en /eventos (tarea 2026-08-05, ver
 * el comentario de decisión de orden junto a `extractSponsored` en page.tsx).
 * Entorno node: sin jsdom, sin Supabase — mismo criterio que
 * impulsar/impulsar-items.test.ts. No se testea la RSC completa (no hay mock
 * de Supabase en el repo para páginas async) — se testea el helper puro que
 * decide qué queda patrocinado y qué queda cronológico, que es donde vive
 * toda la decisión de producto.
 */

function card(id: string, title = id): EventCardModel {
  return {
    id,
    title,
    venueArea: null,
    date: null,
    free: true,
    photoUrl: null,
    publisherTrust: null,
    publisherName: null,
  };
}

describe("extractSponsored", () => {
  it("sin boosts activos: no hay franja patrocinada y los grupos quedan intactos", () => {
    const upcoming = [card("a"), card("b")];
    const past = [card("c")];

    const { sponsored, rest } = extractSponsored([upcoming, past], new Set(), 4);

    expect(sponsored).toEqual([]);
    expect(rest).toEqual([upcoming, past]);
  });

  it("saca los boosteados de `upcoming` sin tocar el orden cronológico del resto", () => {
    // "b" está boosteado pero NO salta al principio de upcoming (eso rompería
    // el cronológico) — se saca de la lista y aparece solo en `sponsored`.
    const upcoming = [card("a"), card("b"), card("c")];
    const past: EventCardModel[] = [];

    const { sponsored, rest } = extractSponsored([upcoming, past], new Set(["b"]), 4);

    expect(sponsored.map((c) => c.id)).toEqual(["b"]);
    expect(rest[0].map((c) => c.id)).toEqual(["a", "c"]);
    expect(rest[1]).toEqual([]);
  });

  it("un evento pago de dentro de meses NO salta arriba de los de esta semana en `rest`", () => {
    // Caso literal del comentario de decisión: "evento-lejano" está boosteado
    // pero upcoming ya viene ordenado cronológicamente por la página — acá
    // solo verificamos que extraerlo no reordena lo que queda.
    const upcoming = [card("evento-esta-semana"), card("evento-lejano"), card("otro-cercano")];

    const { rest } = extractSponsored([upcoming, []], new Set(["evento-lejano"]), 4);

    expect(rest[0].map((c) => c.id)).toEqual(["evento-esta-semana", "otro-cercano"]);
  });

  it("respeta el filtro `cuando=pasados`: un boosteado que solo vive en `past` sale de ahí", () => {
    const upcoming: EventCardModel[] = [];
    const past = [card("x"), card("y")];

    const { sponsored, rest } = extractSponsored([upcoming, past], new Set(["y"]), 4);

    expect(sponsored.map((c) => c.id)).toEqual(["y"]);
    expect(rest[1].map((c) => c.id)).toEqual(["x"]);
  });

  it("un id boosteado que no aparece en ningún grupo (filtrado por q/ciudad/entrada) no genera nada", () => {
    const upcoming = [card("a")];
    const { sponsored, rest } = extractSponsored([upcoming, []], new Set(["no-esta-en-la-lista"]), 4);

    expect(sponsored).toEqual([]);
    expect(rest[0].map((c) => c.id)).toEqual(["a"]);
  });

  it("topea la franja en `max`: los boosteados de más se quedan en su lista original", () => {
    const upcoming = [card("a"), card("b"), card("c")];
    const boosted = new Set(["a", "b", "c"]);

    const { sponsored, rest } = extractSponsored([upcoming, []], boosted, 2);

    expect(sponsored.map((c) => c.id)).toEqual(["a", "b"]);
    // "c" no entró en el tope: sigue en su lugar cronológico, no desaparece.
    expect(rest[0].map((c) => c.id)).toEqual(["c"]);
  });

  it("no duplica un id que por error apareciera en dos grupos a la vez", () => {
    const upcoming = [card("dup")];
    const past = [card("dup")];

    const { sponsored, rest } = extractSponsored([upcoming, past], new Set(["dup"]), 4);

    expect(sponsored.map((c) => c.id)).toEqual(["dup"]);
    expect(rest[0]).toEqual([]);
    expect(rest[1]).toEqual([]);
  });
});
