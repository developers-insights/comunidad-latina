import { describe, expect, it } from "vitest";
import {
  HELP_OPEN_STATUSES,
  detectarDatoDeContacto,
  esAvisoAbierto,
  isHelpDirection,
  isHelpStatus,
  isHelpTopic,
  primerDatoDeContacto,
  puedeEditarContenido,
  puedeTransicionar,
  sortNeedsFirst,
  toHelpNotice,
  transicionesPosibles,
} from "./ayuda-mutua";
import { HELP_STATUSES, HELP_TOPICS, RESOURCE_TOPICS, type HelpNoticeRow } from "./types";

function fila(overrides: Partial<HelpNoticeRow> = {}): HelpNoticeRow {
  return {
    id: "0192f0aa-0000-7000-8000-000000000001",
    tenant_id: "11111111-1111-1111-1111-111111111111",
    created_by: "22222222-2222-2222-2222-222222222222",
    direction: "offer",
    topic: "comida",
    resource_id: null,
    title: "Puedo ayudar a servir los sábados",
    body: "Trabajo de lunes a viernes, pero los sábados tengo la mañana libre y puedo dar una mano.",
    area_label: "Corona, Queens",
    availability: "Sábados de 9 a 13",
    org_name: null,
    languages: ["Español", "Inglés"],
    status: "approved",
    reviewed_at: "2026-08-20T15:00:00.000Z",
    review_note: null,
    created_at: "2026-08-20T14:00:00.000Z",
    ...overrides,
  };
}

const CTX = {
  viewerId: null as string | null,
  nombrePorAutor: new Map<string, string | null>([
    ["22222222-2222-2222-2222-222222222222", "Marta"],
  ]),
  nombrePorFicha: new Map<string, string>([["33333333-3333-3333-3333-333333333333", "Comedor La Esperanza"]]),
  now: new Date("2026-08-20T16:00:00.000Z"),
};

describe("guardas de valores cerrados", () => {
  it("acepta los seis temas del tablón y ninguno más", () => {
    for (const topic of HELP_TOPICS) expect(isHelpTopic(topic)).toBe(true);
  });

  /**
   * Es LA prueba de §5 de la 0120: los temas donde el ofrecimiento sería
   * criterio profesional (o alojamiento) no pueden entrar al tablón. Si alguien
   * suma uno a HELP_TOPICS sin discutirlo, este test se pone rojo.
   */
  it("deja afuera los temas donde ofrecerse sería ejercer una profesión", () => {
    for (const topic of ["migracion", "legal", "salud", "medicinas", "adicciones"]) {
      expect(isHelpTopic(topic)).toBe(false);
    }
  });

  it("deja afuera vivienda, emergencias y consulados", () => {
    for (const topic of ["vivienda", "emergencias", "consulados"]) {
      expect(isHelpTopic(topic)).toBe(false);
    }
  });

  it("todos los temas del tablón existen también en el directorio", () => {
    for (const topic of HELP_TOPICS) {
      expect((RESOURCE_TOPICS as readonly string[]).includes(topic)).toBe(true);
    }
  });

  it("rechaza basura y variantes de caja", () => {
    expect(isHelpTopic("COMIDA")).toBe(false);
    expect(isHelpTopic("")).toBe(false);
    expect(isHelpTopic(null)).toBe(false);
    expect(isHelpDirection("offer")).toBe(true);
    expect(isHelpDirection("need")).toBe(true);
    expect(isHelpDirection("ofrecer")).toBe(false);
    expect(isHelpStatus("approved")).toBe(true);
    expect(isHelpStatus("publicado")).toBe(false);
  });
});

describe("máquina de estados", () => {
  it("el autor manda a revisión y puede retirar lo que mandó", () => {
    expect(puedeTransicionar("draft", "pending", "autor")).toBe(true);
    expect(puedeTransicionar("pending", "draft", "autor")).toBe(true);
  });

  it("el autor NUNCA puede aprobar ni rechazar su propio aviso", () => {
    expect(puedeTransicionar("draft", "approved", "autor")).toBe(false);
    expect(puedeTransicionar("pending", "approved", "autor")).toBe(false);
    expect(puedeTransicionar("rejected", "approved", "autor")).toBe(false);
    expect(puedeTransicionar("pending", "rejected", "autor")).toBe(false);
  });

  it("un rechazo vuelve a borrador para corregirlo", () => {
    expect(puedeTransicionar("rejected", "draft", "autor")).toBe(true);
  });

  it("el autor da de baja lo publicado, pero no lo resucita", () => {
    expect(puedeTransicionar("approved", "archived", "autor")).toBe(true);
    expect(puedeTransicionar("archived", "approved", "autor")).toBe(false);
    expect(puedeTransicionar("archived", "draft", "autor")).toBe(false);
  });

  it("el staff resuelve lo pendiente y puede corregirse a sí mismo", () => {
    expect(puedeTransicionar("pending", "approved", "staff")).toBe(true);
    expect(puedeTransicionar("pending", "rejected", "staff")).toBe(true);
    expect(puedeTransicionar("rejected", "approved", "staff")).toBe(true);
    expect(puedeTransicionar("approved", "rejected", "staff")).toBe(true);
  });

  it("el staff no escribe borradores ajenos ni revive lo archivado", () => {
    expect(puedeTransicionar("draft", "pending", "staff")).toBe(false);
    expect(puedeTransicionar("draft", "approved", "staff")).toBe(false);
    expect(puedeTransicionar("archived", "approved", "staff")).toBe(false);
  });

  it("nadie transiciona a donde ya está", () => {
    for (const status of HELP_STATUSES) {
      expect(puedeTransicionar(status, status, "autor")).toBe(false);
      expect(puedeTransicionar(status, status, "staff")).toBe(false);
    }
  });

  it("transicionesPosibles y puedeTransicionar cuentan la misma historia", () => {
    for (const desde of HELP_STATUSES) {
      for (const actor of ["autor", "staff"] as const) {
        const posibles = transicionesPosibles(desde, actor);
        for (const hasta of HELP_STATUSES) {
          expect(posibles.includes(hasta)).toBe(puedeTransicionar(desde, hasta, actor));
        }
      }
    }
  });

  it("abierto es lo que todavía no se resolvió — el borrador también ocupa cupo", () => {
    expect(HELP_OPEN_STATUSES).toEqual(["draft", "pending"]);
    expect(esAvisoAbierto("draft")).toBe(true);
    expect(esAvisoAbierto("pending")).toBe(true);
    expect(esAvisoAbierto("approved")).toBe(false);
    expect(esAvisoAbierto("rejected")).toBe(false);
    expect(esAvisoAbierto("archived")).toBe(false);
  });

  it("el contenido sólo se edita en borrador (anti bait-and-switch)", () => {
    expect(puedeEditarContenido("draft")).toBe(true);
    for (const status of ["pending", "approved", "rejected", "archived"] as const) {
      expect(puedeEditarContenido(status)).toBe(false);
    }
  });
});

describe("detectarDatoDeContacto", () => {
  it("agarra un teléfono escrito como lo escribe cualquiera", () => {
    expect(detectarDatoDeContacto("Llamame al (718) 555-0142")).toBe("telefono");
    expect(detectarDatoDeContacto("mi cel es 7185550142")).toBe("telefono");
    expect(detectarDatoDeContacto("+1 718 555 0142")).toBe("telefono");
    expect(detectarDatoDeContacto("718.555.0142")).toBe("telefono");
  });

  it("agarra el teléfono espaciado dígito por dígito, que es el primer intento de esquivarlo", () => {
    expect(detectarDatoDeContacto("7 1 8 5 5 5 0 1 4 2")).toBe("telefono");
  });

  it("agarra correos y enlaces, incluidos los acortadores de mensajería", () => {
    expect(detectarDatoDeContacto("escribime a marta@ejemplo.org")).toBe("email");
    expect(detectarDatoDeContacto("sumate en https://ejemplo.org/grupo")).toBe("enlace");
    expect(detectarDatoDeContacto("el grupo es wa.me/grupo-corona")).toBe("enlace");
    // El link de WhatsApp con el número adentro cae por el detector de
    // teléfono antes que por el de enlace, y está bien: el dato que se está
    // filtrando ahí es el número, no el link.
    expect(detectarDatoDeContacto("wa.me/17185550142")).toBe("telefono");
    expect(detectarDatoDeContacto("mirá www.ejemplo.org")).toBe("enlace");
  });

  it("un correo se reporta como correo y no como enlace, aunque tenga dominio adentro", () => {
    expect(detectarDatoDeContacto("marta@ejemplo.com")).toBe("email");
  });

  /**
   * La mitad que más importa: un falso positivo manda a reescribir a alguien
   * que estaba haciendo las cosas bien. Estas frases son las que de verdad se
   * escriben en un aviso de ayuda.
   */
  it("NO se confunde con horarios, cantidades ni fechas", () => {
    expect(detectarDatoDeContacto("Puedo los sábados de 10 a 18")).toBeNull();
    expect(detectarDatoDeContacto("Necesitamos 4 personas para armar 250 bolsones")).toBeNull();
    expect(detectarDatoDeContacto("Arrancamos el 7/9/2026 a las 9")).toBeNull();
    expect(detectarDatoDeContacto("La colecta cierra el 2026-09-07")).toBeNull();
    expect(detectarDatoDeContacto("Somos 12 voluntarios y nos faltan 3")).toBeNull();
    expect(detectarDatoDeContacto("Cocino para 100 personas sin problema")).toBeNull();
  });

  it("no se enoja con un texto vacío ni con nada", () => {
    expect(detectarDatoDeContacto("")).toBeNull();
    expect(detectarDatoDeContacto("   ")).toBeNull();
    expect(detectarDatoDeContacto(null)).toBeNull();
    expect(detectarDatoDeContacto(undefined)).toBeNull();
  });

  it("primerDatoDeContacto devuelve el primer problema de todos los campos", () => {
    expect(primerDatoDeContacto("Título limpio", "cuerpo limpio", null)).toBeNull();
    expect(primerDatoDeContacto("Título limpio", "llamame al 7185550142")).toBe("telefono");
    expect(primerDatoDeContacto("marta@ejemplo.org", "llamame al 7185550142")).toBe("email");
  });
});

describe("toHelpNotice", () => {
  it("mapea una fila sana", () => {
    const aviso = toHelpNotice(fila(), CTX);
    expect(aviso).not.toBeNull();
    expect(aviso?.title).toBe("Puedo ayudar a servir los sábados");
    expect(aviso?.publisherName).toBe("Marta");
    expect(aviso?.languages).toEqual(["Español", "Inglés"]);
    expect(aviso?.isOwner).toBe(false);
    expect(aviso?.publishedAtLabel.length).toBeGreaterThan(0);
  });

  it("descarta lo que no se puede dibujar con honestidad", () => {
    expect(toHelpNotice(fila({ topic: "legal" }), CTX)).toBeNull();
    expect(toHelpNotice(fila({ topic: "" }), CTX)).toBeNull();
    expect(toHelpNotice(fila({ direction: "ofrecer" }), CTX)).toBeNull();
    expect(toHelpNotice(fila({ status: "publicado" }), CTX)).toBeNull();
    expect(toHelpNotice(fila({ title: "   " }), CTX)).toBeNull();
    expect(toHelpNotice(fila({ area_label: "  " }), CTX)).toBeNull();
  });

  it("un nombre de organización sólo sobrevive del lado que PIDE manos", () => {
    const pide = toHelpNotice(fila({ direction: "need", org_name: "Comedor del barrio" }), CTX);
    expect(pide?.orgName).toBe("Comedor del barrio");

    // Si una fila vieja o forjada trajera org_name en un ofrecimiento, la
    // pantalla no puede mostrarlo: sería un aval que la plataforma no dio.
    const ofrece = toHelpNotice(fila({ direction: "offer", org_name: "Comedor del barrio" }), CTX);
    expect(ofrece?.orgName).toBeNull();
  });

  it("el motivo del rechazo sólo viaja hacia su autor", () => {
    const row = fila({ status: "rejected", review_note: "Falta decir qué días podés." });

    const moderador = toHelpNotice(row, { ...CTX, viewerId: "99999999-9999-9999-9999-999999999999" });
    expect(moderador?.reviewNote).toBeNull();
    expect(moderador?.isOwner).toBe(false);

    const autor = toHelpNotice(row, { ...CTX, viewerId: row.created_by });
    expect(autor?.reviewNote).toBe("Falta decir qué días podés.");
    expect(autor?.isOwner).toBe(true);
  });

  it("la ficha apuntada sólo aparece si se pudo resolver su nombre", () => {
    const conFicha = toHelpNotice(
      fila({ resource_id: "33333333-3333-3333-3333-333333333333" }),
      CTX,
    );
    expect(conFicha?.resource).toEqual({
      id: "33333333-3333-3333-3333-333333333333",
      name: "Comedor La Esperanza",
    });

    const fichaBorrada = toHelpNotice(
      fila({ resource_id: "44444444-4444-4444-4444-444444444444" }),
      CTX,
    );
    expect(fichaBorrada?.resource).toBeNull();
  });

  it("un autor sin nombre legible no rompe la tarjeta", () => {
    const aviso = toHelpNotice(fila(), { ...CTX, nombrePorAutor: new Map() });
    expect(aviso?.publisherName).toBe("Alguien de la comunidad");
  });

  it("limpia los idiomas vacíos que pudiera traer la base", () => {
    const aviso = toHelpNotice(fila({ languages: ["Español", "  ", ""] }), CTX);
    expect(aviso?.languages).toEqual(["Español"]);
  });
});

describe("sortNeedsFirst", () => {
  it("pone arriba lo perecedero y conserva el orden dentro de cada grupo", () => {
    const avisos = [
      { id: "a", direction: "offer" as const },
      { id: "b", direction: "need" as const },
      { id: "c", direction: "offer" as const },
      { id: "d", direction: "need" as const },
    ];
    expect(sortNeedsFirst(avisos).map((item) => item.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("no muta el arreglo original", () => {
    const avisos = [
      { id: "a", direction: "offer" as const },
      { id: "b", direction: "need" as const },
    ];
    sortNeedsFirst(avisos);
    expect(avisos.map((item) => item.id)).toEqual(["a", "b"]);
  });
});
