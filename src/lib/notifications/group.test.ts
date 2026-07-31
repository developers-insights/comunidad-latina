import { describe, expect, it } from "vitest";
import { buildGroupKey, summarizeActors } from "./group";

describe("buildGroupKey", () => {
  it("arma la clave con el contrato de la base '<kind>:<sujeto>:<id>'", () => {
    expect(buildGroupKey("reaction", "post", "019f39cf-0000-4000-8000-000000000000")).toBe(
      "reaction:post:019f39cf-0000-4000-8000-000000000000",
    );
  });

  it("devuelve null si falta una parte, en vez de armar una clave rota", () => {
    expect(buildGroupKey("", "post", "abc")).toBeNull();
    expect(buildGroupKey("reaction", "   ", "abc")).toBeNull();
    expect(buildGroupKey("reaction", "post", "")).toBeNull();
  });

  it("devuelve null si se pasa del CHECK de 200 caracteres", () => {
    expect(buildGroupKey("reaction", "post", "x".repeat(300))).toBeNull();
  });

  it("recorta espacios de los bordes", () => {
    expect(buildGroupKey(" follow ", " profile ", " abc ")).toBe("follow:profile:abc");
  });
});

describe("summarizeActors", () => {
  it("una sola persona: su nombre y nada más", () => {
    expect(summarizeActors(["María"], { total: 1 })).toBe("María");
  });

  it("dos personas: se unen con 'y', sin coma", () => {
    expect(summarizeActors(["María", "José"], { total: 2 })).toBe("María y José");
  });

  it("el caso de la spec: dos nombres y el resto contado", () => {
    expect(summarizeActors(["María", "José"], { total: 20 })).toBe(
      "María, José y 18 personas más",
    );
  });

  it("una sola persona más va en SINGULAR ('1 persona más', no '1 personas más')", () => {
    expect(summarizeActors(["María", "José"], { total: 3 })).toBe(
      "María, José y 1 persona más",
    );
  });

  it("si el total viene desfasado hacia abajo, mandan los nombres", () => {
    // El contador real puede quedar corto por una carrera; nunca decimos
    // "y -1 personas más".
    expect(summarizeActors(["María", "José"], { total: 1 })).toBe("María y José");
  });

  it("sin nombres devuelve vacío y el emisor decide no notificar", () => {
    expect(summarizeActors([], { total: 5 })).toBe("");
    expect(summarizeActors(["  "], { total: 5 })).toBe("");
  });

  it("respeta cuántos nombres se muestran", () => {
    expect(summarizeActors(["Ana", "Beto", "Caro"], { total: 10, maxNames: 3 })).toBe(
      "Ana, Beto, Caro y 7 personas más",
    );
  });
});
