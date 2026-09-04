import { describe, expect, it } from "vitest";
import { REGISTRATION_DICCIONARIOS } from "./copy";
import {
  detallesDeRegistro,
  esRegistroAbierto,
  filaDeEspacio,
  filaDeLugar,
  filaDePedidoDeVoluntarios,
  filaDeVoluntario,
  fuenteConfirmadaSchema,
  isRegistrationKind,
  isRegistrationStatus,
  ofrecimientoDeEspacioSchema,
  pedidoDeVoluntariosSchema,
  puedeTransicionarRegistro,
  recursoDesdeRegistro,
  registroDeLugarSchema,
  registroVoluntarioSchema,
  tieneRegistroAbierto,
  toRegistrationView,
} from "./registros";
import {
  REGISTRATION_BODY_MAX,
  REGISTRATION_NAME_MAX,
  REGISTRATION_RULES_VERSION,
  REGISTRATION_STATUSES,
  type RegistrationRow,
} from "./types";

/**
 * Tests de los cuatro formularios privados (0131).
 *
 * Lo que se cubre es lo que duele si se rompe:
 *  · un registro sin forma de contestarle NO entra (es la razón de ser de la
 *    tabla: si nadie puede llamar, se juntaron datos personales para nada);
 *  · el voluntario no queda anotado sin aceptar las reglas (el cliente pidió
 *    esa aceptación textualmente, «para que no haya compromiso con Comunidad
 *    Latina»);
 *  · el cupo de uno abierto por formulario, que es lo que evita que el equipo
 *    abra la cola y encuentre cien copias del mismo pedido;
 *  · las transiciones del panel, incluida la única prohibida;
 *  · y que un lugar aprobado se convierta en la ficha CORRECTA: un banco de
 *    comida no puede terminar en "Centro de acopio" — son las dos tarjetas que
 *    el cliente pidió separadas porque en una recibís y en la otra dejás.
 */

const CONTACTO_OK = { contactPhone: "(917) 555-0134" };
const BASE_OK = {
  name: "Rosa Jiménez",
  areaLabel: "Corona, Queens",
  body: "Puedo ayudar los sábados a la mañana con lo que haga falta.",
  ...CONTACTO_OK,
};

// ===========================================================================
// Guardas y estados
// ===========================================================================

describe("guardas", () => {
  it("reconoce los cuatro formularios y rechaza cualquier otro", () => {
    expect(isRegistrationKind("volunteer")).toBe(true);
    expect(isRegistrationKind("space")).toBe(true);
    expect(isRegistrationKind("voluntario")).toBe(false);
    expect(isRegistrationKind(null)).toBe(false);
  });

  it("sólo `new` y `contacted` ocupan cupo", () => {
    expect(esRegistroAbierto("new")).toBe(true);
    expect(esRegistroAbierto("contacted")).toBe(true);
    expect(esRegistroAbierto("approved")).toBe(false);
    expect(esRegistroAbierto("discarded")).toBe(false);
  });
});

describe("transiciones del panel", () => {
  it("nunca se vuelve a `new`: una vez que alguien lo miró, deja de estar sin mirar", () => {
    for (const desde of REGISTRATION_STATUSES) {
      expect(puedeTransicionarRegistro(desde, "new")).toBe(false);
    }
  });

  it("no hay transición a sí mismo", () => {
    for (const estado of REGISTRATION_STATUSES) {
      expect(puedeTransicionarRegistro(estado, estado)).toBe(false);
    }
  });

  it("descartar por error tiene vuelta, y aprobar tarde también", () => {
    expect(puedeTransicionarRegistro("discarded", "approved")).toBe(true);
    expect(puedeTransicionarRegistro("approved", "discarded")).toBe(true);
    expect(puedeTransicionarRegistro("new", "contacted")).toBe(true);
  });
});

describe("cupo por formulario", () => {
  const abiertos = [
    { kind: "volunteer", status: "contacted" },
    { kind: "place", status: "approved" },
    { kind: "space", status: "discarded" },
  ];

  it("un registro abierto del MISMO formulario bloquea otro", () => {
    expect(tieneRegistroAbierto(abiertos, "volunteer")).toBe(true);
  });

  it("uno ya resuelto NO bloquea: cerrada la vuelta, la persona se puede volver a anotar", () => {
    expect(tieneRegistroAbierto(abiertos, "place")).toBe(false);
    expect(tieneRegistroAbierto(abiertos, "space")).toBe(false);
  });

  it("el cupo es por formulario y no global", () => {
    expect(tieneRegistroAbierto(abiertos, "volunteer_request")).toBe(false);
  });

  it("una fila con un estado que la app no conoce no cuenta como abierta", () => {
    expect(tieneRegistroAbierto([{ kind: "volunteer", status: "loquesea" }], "volunteer")).toBe(
      false,
    );
  });
});

// ===========================================================================
// 1 · Me anoto de voluntario
// ===========================================================================

describe("registroVoluntarioSchema", () => {
  const VOLUNTARIO_OK = {
    ...BASE_OK,
    skills: ["comida"],
    availability: ["finde"],
    aceptaReglas: true as const,
  };

  it("acepta un registro completo", () => {
    expect(registroVoluntarioSchema.safeParse(VOLUNTARIO_OK).success).toBe(true);
  });

  it("rechaza si no aceptó las reglas — una aceptación que se puede saltear no es una aceptación", () => {
    const sinReglas = { ...VOLUNTARIO_OK, aceptaReglas: false };
    expect(registroVoluntarioSchema.safeParse(sinReglas).success).toBe(false);
  });

  it("rechaza sin ningún dato de contacto", () => {
    const { contactPhone: _omitido, ...sinContacto } = VOLUNTARIO_OK;
    const resultado = registroVoluntarioSchema.safeParse(sinContacto);
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues.some((issue) => issue.path[0] === "contactPhone")).toBe(true);
  });

  it("acepta con SÓLO correo: mucha gente no quiere dar el teléfono", () => {
    const { contactPhone: _omitido, ...soloMail } = VOLUNTARIO_OK;
    expect(
      registroVoluntarioSchema.safeParse({ ...soloMail, contactEmail: "rosa@correo.com" }).success,
    ).toBe(true);
  });

  it("rechaza un correo que no es un correo", () => {
    expect(
      registroVoluntarioSchema.safeParse({ ...VOLUNTARIO_OK, contactEmail: "rosa arroba correo" })
        .success,
    ).toBe(false);
  });

  it("rechaza sin elegir en qué puede ayudar ni cuándo", () => {
    expect(registroVoluntarioSchema.safeParse({ ...VOLUNTARIO_OK, skills: [] }).success).toBe(false);
    expect(registroVoluntarioSchema.safeParse({ ...VOLUNTARIO_OK, availability: [] }).success).toBe(
      false,
    );
  });

  it("rechaza un chip que no está en el catálogo", () => {
    expect(
      registroVoluntarioSchema.safeParse({ ...VOLUNTARIO_OK, skills: ["hacer_magia"] }).success,
    ).toBe(false);
  });

  it("rechaza los textos demasiado largos", () => {
    expect(
      registroVoluntarioSchema.safeParse({ ...VOLUNTARIO_OK, name: "a".repeat(REGISTRATION_NAME_MAX + 1) })
        .success,
    ).toBe(false);
    expect(
      registroVoluntarioSchema.safeParse({ ...VOLUNTARIO_OK, body: "a".repeat(REGISTRATION_BODY_MAX + 1) })
        .success,
    ).toBe(false);
  });

  it("guarda la versión de las reglas que aceptó, para saber cuál era el texto", () => {
    const parsed = registroVoluntarioSchema.parse(VOLUNTARIO_OK);
    const fila = filaDeVoluntario(parsed);
    expect(fila.kind).toBe("volunteer");
    expect(fila.details.rules_version).toBe(REGISTRATION_RULES_VERSION);
    expect(fila.details.skills).toEqual(["comida"]);
    expect(fila.contact_phone).toBe("(917) 555-0134");
    expect(fila.contact_email).toBeNull();
  });
});

// ===========================================================================
// 2 · Necesito voluntarios
// ===========================================================================

describe("pedidoDeVoluntariosSchema", () => {
  const PEDIDO_OK = {
    ...BASE_OK,
    body: "Armamos bolsones de comida para las familias del barrio y necesitamos manos.",
    requesterType: "organizacion" as const,
    orgName: "Parroquia San Juan",
    whenLabel: "El sábado 12, de 9 a 12",
    peopleNeeded: 6,
  };

  it("acepta un pedido completo", () => {
    expect(pedidoDeVoluntariosSchema.safeParse(PEDIDO_OK).success).toBe(true);
  });

  it("acepta sin organización: el cliente dijo que no hace falta ser empresa", () => {
    const { orgName: _omitido, ...sinOrg } = PEDIDO_OK;
    const resultado = pedidoDeVoluntariosSchema.safeParse({ ...sinOrg, requesterType: "persona" });
    expect(resultado.success).toBe(true);
    expect(filaDePedidoDeVoluntarios(resultado.data!).details.org_name).toBeUndefined();
  });

  it("rechaza sin contacto", () => {
    const { contactPhone: _omitido, ...sinContacto } = PEDIDO_OK;
    expect(pedidoDeVoluntariosSchema.safeParse(sinContacto).success).toBe(false);
  });

  it("rechaza cero personas y números absurdos", () => {
    expect(pedidoDeVoluntariosSchema.safeParse({ ...PEDIDO_OK, peopleNeeded: 0 }).success).toBe(false);
    expect(pedidoDeVoluntariosSchema.safeParse({ ...PEDIDO_OK, peopleNeeded: 5000 }).success).toBe(
      false,
    );
  });

  it("acepta el número que llega como texto desde el formulario", () => {
    const resultado = pedidoDeVoluntariosSchema.safeParse({ ...PEDIDO_OK, peopleNeeded: "6" });
    expect(resultado.success).toBe(true);
    expect(filaDePedidoDeVoluntarios(resultado.data!).details.people_needed).toBe(6);
  });
});

// ===========================================================================
// 3 · Registrar mi lugar
// ===========================================================================

describe("registroDeLugarSchema", () => {
  const LUGAR_OK = {
    ...BASE_OK,
    name: "Despensa Comunitaria San Rafael",
    body: "Entregamos bolsones de comida seca. No hace falta traer papeles.",
    placeType: "comida" as const,
    address: "103-25 Roosevelt Ave, Corona, NY 11368",
    hoursLabel: "Martes y jueves de 10 a 14",
  };

  it("acepta un lugar completo", () => {
    expect(registroDeLugarSchema.safeParse(LUGAR_OK).success).toBe(true);
  });

  it("rechaza sin dirección: sin ella la ficha del directorio no se puede publicar", () => {
    expect(registroDeLugarSchema.safeParse({ ...LUGAR_OK, address: "s/n" }).success).toBe(false);
  });

  it("rechaza un tipo de lugar inventado", () => {
    expect(registroDeLugarSchema.safeParse({ ...LUGAR_OK, placeType: "farmacia" }).success).toBe(
      false,
    );
  });

  it("deja el tipo, la dirección y el horario en el detalle", () => {
    const fila = filaDeLugar(registroDeLugarSchema.parse(LUGAR_OK));
    expect(fila.kind).toBe("place");
    expect(fila.details).toEqual({
      place_type: "comida",
      address: "103-25 Roosevelt Ave, Corona, NY 11368",
      hours_label: "Martes y jueves de 10 a 14",
    });
  });
});

// ===========================================================================
// 4 · Espacio comunitario
// ===========================================================================

describe("ofrecimientoDeEspacioSchema", () => {
  const ESPACIO_OK = {
    ...BASE_OK,
    name: "Panadería La Esperanza",
    body: "El salón del fondo, con diez mesas largas y baño propio.",
    address: "82-14 Northern Blvd, Jackson Heights, NY",
    capacity: 30,
    daysLabel: "Sábados de 9 a 13",
    activities: ["clases_chicos", "idiomas"],
  };

  it("acepta un espacio completo", () => {
    expect(ofrecimientoDeEspacioSchema.safeParse(ESPACIO_OK).success).toBe(true);
  });

  it("rechaza sin decir para qué lo prestaría", () => {
    expect(ofrecimientoDeEspacioSchema.safeParse({ ...ESPACIO_OK, activities: [] }).success).toBe(
      false,
    );
  });

  it("rechaza sin contacto", () => {
    const { contactPhone: _omitido, ...sinContacto } = ESPACIO_OK;
    expect(ofrecimientoDeEspacioSchema.safeParse(sinContacto).success).toBe(false);
  });

  it("arma el detalle del espacio", () => {
    const fila = filaDeEspacio(ofrecimientoDeEspacioSchema.parse(ESPACIO_OK));
    expect(fila.kind).toBe("space");
    expect(fila.details.capacity).toBe(30);
    expect(fila.details.activities).toEqual(["clases_chicos", "idiomas"]);
  });
});

// ===========================================================================
// Fila → ficha del panel
// ===========================================================================

function fila(overrides: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    id: "0192f0aa-0000-7000-8000-000000000001",
    tenant_id: "11111111-1111-1111-1111-111111111111",
    created_by: "22222222-2222-2222-2222-222222222222",
    kind: "volunteer",
    name: "Rosa Jiménez",
    contact_phone: "(917) 555-0134",
    contact_email: null,
    area_label: "Corona, Queens",
    body: "Puedo ayudar los sábados.",
    details: { skills: ["comida", "traducir"], availability: ["finde"], rules_version: "2026-09" },
    status: "new",
    reviewed_by: null,
    reviewed_at: null,
    admin_notes: null,
    resource_id: null,
    created_at: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("toRegistrationView", () => {
  const ctx = {
    nombrePorPerfil: new Map([["22222222-2222-2222-2222-222222222222", "Rosa J."]]),
    dic: REGISTRATION_DICCIONARIOS,
    now: new Date("2026-09-04T12:00:00.000Z"),
  };

  it("traduce los chips a las etiquetas que eligió la persona", () => {
    const vista = toRegistrationView(fila(), ctx);
    expect(vista?.detalles).toEqual([
      { label: "Puede ayudar con", value: "Repartir comida · Traducir o interpretar" },
      { label: "Disponible", value: "Fines de semana" },
    ]);
    expect(vista?.agedDays).toBe(3);
    expect(vista?.authorName).toBe("Rosa J.");
  });

  it("descarta la fila si el kind o el estado no son de los conocidos", () => {
    expect(toRegistrationView(fila({ kind: "otra_cosa" }), ctx)).toBeNull();
    expect(toRegistrationView(fila({ status: "pending" }), ctx)).toBeNull();
  });

  it("muestra un valor desconocido CRUDO en vez de esconderlo", () => {
    const vista = toRegistrationView(fila({ details: { skills: ["tejer"], availability: [] } }), ctx);
    expect(vista?.detalles).toEqual([{ label: "Puede ayudar con", value: "tejer" }]);
  });

  it("no inventa nombre de quien revisó cuando nadie revisó", () => {
    expect(toRegistrationView(fila(), ctx)?.reviewerName).toBeNull();
  });
});

describe("detallesDeRegistro", () => {
  it("no dibuja campos vacíos", () => {
    expect(detallesDeRegistro("space", {}, REGISTRATION_DICCIONARIOS)).toEqual([]);
  });

  it("respeta el orden en que se preguntó cada cosa", () => {
    const detalles = detallesDeRegistro(
      "volunteer_request",
      {
        requester_type: "persona",
        org_name: "Club de madres",
        when_label: "El sábado",
        people_needed: 6,
      },
      REGISTRATION_DICCIONARIOS,
    );
    expect(detalles.map((item) => item.label)).toEqual([
      "Quién pide",
      "Organización",
      "Cuándo",
      "Cuántas personas",
    ]);
  });
});

// ===========================================================================
// Lugar aprobado → ficha del directorio
// ===========================================================================

describe("recursoDesdeRegistro", () => {
  const FUENTE = {
    name: "NYC Food Help",
    url: "https://www.nyc.gov/site/hra/help/food-assistance.page",
    checkedAt: "2026-09-04",
  };
  const LUGAR = fila({
    kind: "place",
    name: "Despensa San Rafael",
    body: "Entregamos bolsones de comida seca.",
    details: {
      place_type: "comida",
      address: "103-25 Roosevelt Ave",
      hours_label: "Martes y jueves de 10 a 14",
    },
  });

  it("un banco de comida NO puede terminar en Centro de acopio", () => {
    const acopio = recursoDesdeRegistro(
      { ...LUGAR, details: { ...LUGAR.details, place_type: "acopio" } },
      FUENTE,
    );
    expect(recursoDesdeRegistro(LUGAR, FUENTE)?.topic).toBe("comida");
    expect(acopio?.topic).toBe("acopio");
  });

  it("la ficha nace publicada, con la fuente que confirmó el equipo", () => {
    const recurso = recursoDesdeRegistro(LUGAR, FUENTE);
    expect(recurso?.status).toBe("published");
    expect(recurso?.source_name).toBe("NYC Food Help");
    expect(recurso?.source_checked_at).toBe("2026-09-04");
    expect(recurso?.hours_note).toBe("Martes y jueves de 10 a 14");
    expect(recurso?.phone).toBe("(917) 555-0134");
  });

  it("no publica nada que no sea un lugar", () => {
    expect(recursoDesdeRegistro(fila({ kind: "volunteer" }), FUENTE)).toBeNull();
    expect(recursoDesdeRegistro(fila({ kind: "space" }), FUENTE)).toBeNull();
  });

  it("no publica un lugar sin dirección ni teléfono: la 0096 no lo aceptaría", () => {
    const sinContacto = {
      ...LUGAR,
      contact_phone: null,
      details: { place_type: "comida", hours_label: "Martes" },
    };
    expect(recursoDesdeRegistro(sinContacto, FUENTE)).toBeNull();
  });

  it("la fuente tiene que ser un enlace de verdad", () => {
    expect(fuenteConfirmadaSchema.safeParse(FUENTE).success).toBe(true);
    expect(fuenteConfirmadaSchema.safeParse({ ...FUENTE, url: "el sitio del negocio" }).success).toBe(
      false,
    );
    expect(
      fuenteConfirmadaSchema.safeParse({ ...FUENTE, url: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(fuenteConfirmadaSchema.safeParse({ ...FUENTE, checkedAt: "ayer" }).success).toBe(false);
  });
});

describe("isRegistrationStatus", () => {
  it("acepta los cuatro y rechaza los de otras tablas", () => {
    for (const estado of REGISTRATION_STATUSES) {
      expect(isRegistrationStatus(estado)).toBe(true);
    }
    expect(isRegistrationStatus("approved ")).toBe(false);
    expect(isRegistrationStatus("rejected")).toBe(false);
  });
});
