import { describe, expect, it } from "vitest";
import {
  groupResourcesByTopic,
  isSafeHttpUrl,
  mapsHref,
  telHref,
  toCommunityResource,
  toResourceGroups,
} from "./recursos";
import { RESOURCE_TOPICS, type ResourceRow } from "./types";

function fila(overrides: Partial<ResourceRow> = {}): ResourceRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenant_id: null,
    topic: "salud",
    name: "Clínica comunitaria del barrio",
    description: "Atiende sin seguro médico.",
    phone: "(718) 555-0100",
    website: "https://ejemplo.org/clinica",
    address: "37-15 Junction Blvd, Queens",
    area_label: "Corona, Queens",
    hours_note: "Lunes a viernes de 9 a 17",
    languages: ["Español", "Inglés"],
    cost_note: "Escala según ingresos",
    requirements_note: "No piden seguro",
    source_name: "NYC Health + Hospitals",
    source_url: "https://ejemplo.gov/clinicas",
    source_checked_at: "2026-08-01",
    status: "published",
    ...overrides,
  };
}

describe("isSafeHttpUrl", () => {
  it("acepta http y https", () => {
    expect(isSafeHttpUrl("https://ejemplo.gov/a")).toBe(true);
    expect(isSafeHttpUrl("http://ejemplo.gov")).toBe(true);
  });

  it("rechaza cualquier otro esquema y la basura", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>")).toBe(false);
    expect(isSafeHttpUrl("ejemplo.gov")).toBe(false);
    expect(isSafeHttpUrl("")).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
  });
});

describe("toCommunityResource — la ficha sin procedencia NO se muestra", () => {
  it("una fila completa se convierte entera", () => {
    const recurso = toCommunityResource(fila());
    expect(recurso?.name).toBe("Clínica comunitaria del barrio");
    expect(recurso?.source).toEqual({
      name: "NYC Health + Hospitals",
      url: "https://ejemplo.gov/clinicas",
      checkedAt: "2026-08-01",
    });
  });

  it.each([
    ["sin quién lo dice", { source_name: "   " }],
    ["sin enlace a la fuente", { source_url: "" }],
    ["sin fecha de revisión", { source_checked_at: "" }],
    ["con una url que no es http(s)", { source_url: "javascript:alert(1)" }],
  ])("se descarta %s", (_caso, overrides) => {
    expect(toCommunityResource(fila(overrides as Partial<ResourceRow>))).toBeNull();
  });

  it("se descarta si no hay ningún canal de contacto", () => {
    expect(
      toCommunityResource(fila({ phone: null, website: null, address: null })),
    ).toBeNull();
  });

  it("alcanza con UN canal de contacto", () => {
    expect(
      toCommunityResource(fila({ phone: "(718) 555-0100", website: null, address: null })),
    ).not.toBeNull();
  });

  it("se descarta si el tema no es uno de los conocidos", () => {
    expect(toCommunityResource(fila({ topic: "cualquiera" }))).toBeNull();
  });

  it("una web con esquema raro se cae, pero la ficha sobrevive por el teléfono", () => {
    const recurso = toCommunityResource(fila({ website: "javascript:alert(1)" }));
    expect(recurso).not.toBeNull();
    expect(recurso?.website).toBeNull();
  });

  it("normaliza vacíos a null y limpia el arreglo de idiomas", () => {
    const recurso = toCommunityResource(
      fila({ description: "   ", languages: [" Español ", ""] }),
    );
    expect(recurso?.description).toBeNull();
    expect(recurso?.languages).toEqual(["Español"]);
  });
});

describe("telHref", () => {
  it("saca lo que rompe el marcador y conserva el +", () => {
    expect(telHref("(718) 555-0100")).toBe("tel:7185550100");
    expect(telHref("+1 718 555 0100")).toBe("tel:+17185550100");
  });

  it("devuelve null cuando no era un teléfono", () => {
    expect(telHref("consultar")).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});

describe("mapsHref", () => {
  it("codifica la dirección", () => {
    expect(mapsHref("37-15 Junction Blvd, Queens")).toBe(
      "https://www.google.com/maps/search/?api=1&query=37-15%20Junction%20Blvd%2C%20Queens",
    );
  });

  it("no arma un enlace con una dirección que no lo es", () => {
    expect(mapsHref("s/d")).toBeNull();
    expect(mapsHref(null)).toBeNull();
  });
});

describe("groupResourcesByTopic", () => {
  const recursos = [
    toCommunityResource(fila({ id: "1", topic: "comida", name: "Zapata comedor" }))!,
    toCommunityResource(fila({ id: "2", topic: "salud", name: "Clínica" }))!,
    toCommunityResource(fila({ id: "3", topic: "comida", name: "Almacén solidario" }))!,
  ];

  it("respeta el orden de RESOURCE_TOPICS, no el alfabético", () => {
    const temas = groupResourcesByTopic(recursos).map((grupo) => grupo.topic);
    expect(temas).toEqual(["salud", "comida"]);
    expect(RESOURCE_TOPICS.indexOf("salud")).toBeLessThan(RESOURCE_TOPICS.indexOf("comida"));
  });

  it("ordena alfabéticamente dentro del tema", () => {
    const comida = groupResourcesByTopic(recursos).find((grupo) => grupo.topic === "comida");
    expect(comida?.resources.map((recurso) => recurso.name)).toEqual([
      "Almacén solidario",
      "Zapata comedor",
    ]);
  });

  it("un tema sin recursos no genera encabezado vacío", () => {
    expect(groupResourcesByTopic([]).length).toBe(0);
  });
});

describe("toResourceGroups", () => {
  it("descarta por el camino lo que no se puede mostrar con honestidad", () => {
    const grupos = toResourceGroups([
      fila({ id: "1" }),
      fila({ id: "2", source_url: "" }),
      fila({ id: "3", topic: "comida", name: "Comedor" }),
    ]);
    expect(grupos.map((grupo) => grupo.topic)).toEqual(["salud", "comida"]);
    expect(grupos.flatMap((grupo) => grupo.resources).map((recurso) => recurso.id)).toEqual([
      "1",
      "3",
    ]);
  });
});
