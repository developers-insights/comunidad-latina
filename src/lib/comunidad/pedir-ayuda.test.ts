import { describe, expect, it } from "vitest";
import {
  HELP_OPEN_STATUSES,
  detectarDatoDeContacto,
  esPedidoAbierto,
  isHelpDirection,
  isHelpReplyStatus,
  isHelpStatus,
  isHelpTopic,
  primerDatoDeContacto,
  puedeEditarContenido,
  puedeTransicionar,
  puedeTransicionarRespuesta,
  sanitizeSearchFilter,
  toHelpNotice,
  toHelpReply,
  transicionesPosibles,
} from "./pedir-ayuda";
import {
  HELP_REPLY_STATUSES,
  HELP_STATUSES,
  HELP_TOPICS,
  type HelpNoticeRow,
  type HelpReplyRow,
} from "./types";

function fila(overrides: Partial<HelpNoticeRow> = {}): HelpNoticeRow {
  return {
    id: "0192f0aa-0000-7000-8000-000000000001",
    tenant_id: "11111111-1111-1111-1111-111111111111",
    created_by: "22222222-2222-2222-2222-222222222222",
    direction: "need",
    topic: "tramites",
    resource_id: null,
    title: "¿Alguien sacó turno en el consulado este mes?",
    body: "Necesito renovar el pasaporte de mi hijo y no consigo turno por la página. Cualquier dato me sirve.",
    area_label: "Corona, Queens",
    availability: null,
    org_name: null,
    languages: ["Español"],
    status: "approved",
    reviewed_at: null,
    review_note: null,
    reply_count: 3,
    created_at: "2026-09-03T14:00:00.000Z",
    ...overrides,
  };
}

function respuesta(overrides: Partial<HelpReplyRow> = {}): HelpReplyRow {
  return {
    id: "0192f0bb-0000-7000-8000-000000000001",
    tenant_id: "11111111-1111-1111-1111-111111111111",
    notice_id: "0192f0aa-0000-7000-8000-000000000001",
    created_by: "55555555-5555-5555-5555-555555555555",
    body: "Probá llamando temprano al 212-555-0100, ahí liberan turnos a las 8.",
    status: "visible",
    created_at: "2026-09-03T15:00:00.000Z",
    ...overrides,
  };
}

const CTX = {
  viewerId: null as string | null,
  nombrePorAutor: new Map<string, string | null>([
    ["22222222-2222-2222-2222-222222222222", "Marta"],
    ["55555555-5555-5555-5555-555555555555", "Rafa"],
  ]),
  nombrePorFicha: new Map<string, string>([
    ["33333333-3333-3333-3333-333333333333", "Comedor La Esperanza"],
  ]),
  now: new Date("2026-09-03T16:00:00.000Z"),
};

describe("guardas de valores cerrados", () => {
  it("acepta los diez temas del tablón de pedidos", () => {
    for (const topic of HELP_TOPICS) expect(isHelpTopic(topic)).toBe(true);
    expect(HELP_TOPICS.length).toBe(10);
  });

  /**
   * Los cuatro que la 0130 abre. Estaban excluidos por la 0120 y el argumento
   * de aquella exclusión era sobre OFRECER: "te presto un cuarto" es el
   * escenario de trata, textual. Pedir un dato no es eso.
   */
  it("abre los cuatro temas de pedido que la 0120 no aceptaba", () => {
    for (const topic of ["tramites", "salud", "vivienda", "otro"]) {
      expect(isHelpTopic(topic)).toBe(true);
    }
  });

  /**
   * LA prueba del §11: un tema rotulado "Migración" o "Legal" invita a que un
   * desconocido conteste qué hacer con un caso, y eso es ejercicio ilegal de la
   * profesión con la marca de la plataforma abajo. Si alguien los suma sin
   * discutirlo, este test se pone rojo.
   */
  it("deja afuera migracion y legal incluso como pedido", () => {
    expect(isHelpTopic("migracion")).toBe(false);
    expect(isHelpTopic("legal")).toBe(false);
  });

  it("deja afuera emergencias y consulados: eso es directorio, no tablón", () => {
    for (const topic of ["emergencias", "consulados"]) {
      expect(isHelpTopic(topic)).toBe(false);
    }
  });

  it("rechaza basura y variantes de caja", () => {
    expect(isHelpTopic("TRAMITES")).toBe(false);
    expect(isHelpTopic("")).toBe(false);
    expect(isHelpTopic(null)).toBe(false);
    expect(isHelpDirection("need")).toBe(true);
    expect(isHelpDirection("pedir")).toBe(false);
    expect(isHelpStatus("approved")).toBe(true);
    expect(isHelpStatus("publicado")).toBe(false);
    expect(isHelpReplyStatus("visible")).toBe(true);
    expect(isHelpReplyStatus("borrada")).toBe(false);
  });
});

describe("máquina de estados del pedido", () => {
  it("el autor sólo cierra lo suyo: nunca publica ni oculta", () => {
    expect(puedeTransicionar("approved", "archived", "autor")).toBe(true);
    expect(puedeTransicionar("approved", "rejected", "autor")).toBe(false);
    expect(puedeTransicionar("rejected", "approved", "autor")).toBe(false);
    expect(puedeTransicionar("archived", "approved", "autor")).toBe(false);
  });

  it("el staff oculta, restaura y baja del tablón", () => {
    expect(puedeTransicionar("approved", "rejected", "staff")).toBe(true);
    expect(puedeTransicionar("rejected", "approved", "staff")).toBe(true);
    expect(puedeTransicionar("approved", "archived", "staff")).toBe(true);
  });

  it("nadie revive lo archivado", () => {
    expect(puedeTransicionar("archived", "approved", "staff")).toBe(false);
    expect(puedeTransicionar("archived", "draft", "autor")).toBe(false);
  });

  /** Las filas que quedaron en la cola previa de la 0120 se tienen que poder cerrar. */
  it("los estados legados (draft, pending) siguen siendo resolubles", () => {
    expect(puedeTransicionar("pending", "approved", "staff")).toBe(true);
    expect(puedeTransicionar("pending", "rejected", "staff")).toBe(true);
    expect(puedeTransicionar("pending", "archived", "autor")).toBe(true);
    expect(puedeTransicionar("draft", "archived", "autor")).toBe(true);
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

  /**
   * El cambio que hace que el cupo siga significando algo: como el pedido nace
   * publicado, contar sólo borradores y pendientes lo volvía decorativo.
   */
  it("lo publicado ocupa cupo", () => {
    expect(HELP_OPEN_STATUSES).toEqual(["draft", "pending", "approved"]);
    expect(esPedidoAbierto("approved")).toBe(true);
    expect(esPedidoAbierto("archived")).toBe(false);
    expect(esPedidoAbierto("rejected")).toBe(false);
  });

  it("un pedido publicado no se edita (anti bait-and-switch)", () => {
    expect(puedeEditarContenido("draft")).toBe(true);
    for (const status of ["pending", "approved", "rejected", "archived"] as const) {
      expect(puedeEditarContenido(status)).toBe(false);
    }
  });
});

describe("máquina de estados de la respuesta", () => {
  it("el autor sólo borra la suya", () => {
    expect(puedeTransicionarRespuesta("visible", "deleted", "autor")).toBe(true);
    expect(puedeTransicionarRespuesta("visible", "hidden", "autor")).toBe(false);
    expect(puedeTransicionarRespuesta("hidden", "deleted", "autor")).toBe(false);
  });

  it("el staff oculta y restaura, pero no resucita lo que su autor borró", () => {
    expect(puedeTransicionarRespuesta("visible", "hidden", "staff")).toBe(true);
    expect(puedeTransicionarRespuesta("hidden", "visible", "staff")).toBe(true);
    expect(puedeTransicionarRespuesta("deleted", "visible", "staff")).toBe(false);
  });

  it("nadie transiciona a donde ya está", () => {
    for (const status of HELP_REPLY_STATUSES) {
      expect(puedeTransicionarRespuesta(status, status, "autor")).toBe(false);
      expect(puedeTransicionarRespuesta(status, status, "staff")).toBe(false);
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
    expect(detectarDatoDeContacto("wa.me/17185550142")).toBe("telefono");
    expect(detectarDatoDeContacto("mirá www.ejemplo.org")).toBe("enlace");
  });

  it("un correo se reporta como correo y no como enlace, aunque tenga dominio adentro", () => {
    expect(detectarDatoDeContacto("marta@ejemplo.com")).toBe("email");
  });

  /**
   * La mitad que más importa: un falso positivo manda a reescribir a alguien
   * que estaba haciendo las cosas bien. Estas frases son las que de verdad se
   * escriben en un pedido.
   */
  it("NO se confunde con horarios, cantidades ni fechas", () => {
    expect(detectarDatoDeContacto("Puedo ir cualquier día de 10 a 18")).toBeNull();
    expect(detectarDatoDeContacto("Somos 4 en casa y necesitamos 2 camas")).toBeNull();
    expect(detectarDatoDeContacto("El turno es el 7/9/2026 a las 9")).toBeNull();
    expect(detectarDatoDeContacto("La clase arranca el 2026-09-07")).toBeNull();
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

describe("sanitizeSearchFilter", () => {
  it("deja pasar una búsqueda normal", () => {
    expect(sanitizeSearchFilter("silla de ruedas")).toBe("silla de ruedas");
  });

  /**
   * La razón por la que esta función existe: PostgREST separa las condiciones
   * de un `.or(...)` con COMAS y las agrupa con paréntesis. Una coma en el
   * texto parte la expresión y el filtro pasa a decir cualquier cosa.
   */
  it("saca lo que rompe la gramática del .or() de PostgREST", () => {
    expect(sanitizeSearchFilter("silla, ruedas")).toBe("silla ruedas");
    expect(sanitizeSearchFilter("a(b)c")).toBe("a b c");
    expect(sanitizeSearchFilter('di "hola"')).toBe("di hola");
    expect(sanitizeSearchFilter("uno\\dos")).toBe("uno dos");
  });

  it("escapa los comodines de LIKE en vez de dejar que traigan todo", () => {
    expect(sanitizeSearchFilter("100%")).toBe("100\\%");
    expect(sanitizeSearchFilter("uno_dos")).toBe("uno\\_dos");
  });

  it("devuelve vacío cuando no queda nada con lo que buscar", () => {
    expect(sanitizeSearchFilter("")).toBe("");
    expect(sanitizeSearchFilter("  ")).toBe("");
    expect(sanitizeSearchFilter("a")).toBe("");
    expect(sanitizeSearchFilter(",,,")).toBe("");
    expect(sanitizeSearchFilter(null)).toBe("");
  });

  it("corta lo larguísimo antes de mandarlo a la base", () => {
    expect(sanitizeSearchFilter("x".repeat(500)).length).toBe(60);
  });
});

describe("toHelpNotice", () => {
  it("mapea una fila sana", () => {
    const pedido = toHelpNotice(fila(), CTX);
    expect(pedido).not.toBeNull();
    expect(pedido?.title).toBe("¿Alguien sacó turno en el consulado este mes?");
    expect(pedido?.publisherName).toBe("Marta");
    expect(pedido?.replyCount).toBe(3);
    expect(pedido?.isOwner).toBe(false);
    expect(pedido?.publishedAtLabel.length).toBeGreaterThan(0);
  });

  it("descarta lo que no se puede dibujar con honestidad", () => {
    expect(toHelpNotice(fila({ topic: "legal" }), CTX)).toBeNull();
    expect(toHelpNotice(fila({ topic: "" }), CTX)).toBeNull();
    expect(toHelpNotice(fila({ direction: "pedir" }), CTX)).toBeNull();
    expect(toHelpNotice(fila({ status: "publicado" }), CTX)).toBeNull();
    expect(toHelpNotice(fila({ title: "   " }), CTX)).toBeNull();
    expect(toHelpNotice(fila({ area_label: "  " }), CTX)).toBeNull();
  });

  it("un contador ausente o negativo se lee como cero", () => {
    expect(toHelpNotice(fila({ reply_count: null }), CTX)?.replyCount).toBe(0);
    expect(toHelpNotice(fila({ reply_count: -4 }), CTX)?.replyCount).toBe(0);
  });

  it("el motivo de la moderación sólo viaja hacia su autor", () => {
    const row = fila({ status: "rejected", review_note: "Tenía un teléfono en el texto." });

    const moderador = toHelpNotice(row, {
      ...CTX,
      viewerId: "99999999-9999-9999-9999-999999999999",
    });
    expect(moderador?.reviewNote).toBeNull();
    expect(moderador?.isOwner).toBe(false);

    const autor = toHelpNotice(row, { ...CTX, viewerId: row.created_by });
    expect(autor?.reviewNote).toBe("Tenía un teléfono en el texto.");
    expect(autor?.isOwner).toBe(true);
  });

  it("un autor sin nombre legible no rompe la tarjeta", () => {
    const pedido = toHelpNotice(fila(), { ...CTX, nombrePorAutor: new Map() });
    expect(pedido?.publisherName).toBe("Alguien de la comunidad");
  });

  it("las filas legadas de ofrecimiento se siguen pudiendo dibujar en Mis pedidos", () => {
    const legado = toHelpNotice(
      fila({ direction: "offer", topic: "voluntariado", status: "archived" }),
      CTX,
    );
    expect(legado?.direction).toBe("offer");
    expect(legado?.status).toBe("archived");
  });
});

describe("toHelpReply", () => {
  it("mapea una respuesta visible, teléfono de oficina incluido", () => {
    const item = toHelpReply(respuesta(), CTX);
    expect(item).not.toBeNull();
    expect(item?.body).toContain("212-555-0100");
    expect(item?.authorName).toBe("Rafa");
    expect(item?.isOwner).toBe(false);
  });

  it("lo oculto y lo borrado no se le muestran a un tercero", () => {
    expect(toHelpReply(respuesta({ status: "hidden" }), CTX)).toBeNull();
    expect(toHelpReply(respuesta({ status: "deleted" }), CTX)).toBeNull();
  });

  /** Ver la propia respuesta borrada es lo que hace que "borrar" se entienda. */
  it("su autor sí ve la propia, en cualquier estado", () => {
    const ctxAutor = { ...CTX, viewerId: "55555555-5555-5555-5555-555555555555" };
    expect(toHelpReply(respuesta({ status: "deleted" }), ctxAutor)?.status).toBe("deleted");
    expect(toHelpReply(respuesta({ status: "hidden" }), ctxAutor)?.isOwner).toBe(true);
  });

  it("descarta lo que no se puede dibujar", () => {
    expect(toHelpReply(respuesta({ status: "raro" }), CTX)).toBeNull();
    expect(toHelpReply(respuesta({ body: "   " }), CTX)).toBeNull();
  });
});
