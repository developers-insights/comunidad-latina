import { z } from "zod";
import {
  PLACE_TYPES,
  REGISTRATION_AREA_MAX,
  REGISTRATION_AREA_MIN,
  REGISTRATION_BODY_MAX,
  REGISTRATION_BODY_MIN,
  REGISTRATION_CHIPS_MAX,
  REGISTRATION_DETAIL_MAX,
  REGISTRATION_EMAIL_MAX,
  REGISTRATION_KINDS,
  REGISTRATION_NAME_MAX,
  REGISTRATION_NAME_MIN,
  REGISTRATION_OPEN_STATUSES,
  REGISTRATION_PHONE_MAX,
  REGISTRATION_PHONE_MIN,
  REGISTRATION_RULES_VERSION,
  REGISTRATION_STATUSES,
  REQUESTER_TYPES,
  SPACE_ACTIVITIES,
  VOLUNTEER_AVAILABILITY,
  VOLUNTEER_SKILLS,
  type RegistrationKind,
  type RegistrationRow,
  type RegistrationStatus,
  type RegistrationView,
} from "./types";

/**
 * =============================================================================
 * LÓGICA PURA DE LOS REGISTROS PRIVADOS (0131)
 * =============================================================================
 *
 * Los cuatro formularios que no publican nada: me anoto de voluntario, necesito
 * voluntarios, registro mi lugar, presto mi espacio.
 *
 * Acá vive todo lo que se puede decidir SIN tocar la base: la forma de cada
 * formulario (zod), qué transiciones de estado son legales, cómo se lee una
 * fila en la ficha del panel y cómo se convierte un lugar aprobado en una ficha
 * del directorio. Sin I/O: lo importan por igual el formulario del cliente, la
 * server action y los tests.
 *
 * ── POR QUÉ EL ZOD ESTÁ ACÁ Y NO EN LA ACTION ───────────────────────────────
 * En el resto del módulo los esquemas viven pegados a su `"use server"`. Estos
 * no, por dos razones concretas:
 *
 *   · el formulario del cliente valida con la MISMA regla antes de mandar (que
 *     alguien vea «poné al menos un teléfono» con el campo a la vista, no
 *     después de un viaje al servidor), y un archivo `"use server"` no se puede
 *     importar desde un componente de cliente;
 *   · se testean solos, sin levantar la action ni mockear Supabase.
 *
 * La regla la sigue haciendo cumplir el servidor. Esto es cortesía, aquello es
 * el control — y abajo de los dos está el trigger de la 0131.
 *
 * ── LA REGLA QUE ESTE ARCHIVO HACE CUMPLIR ──────────────────────────────────
 * Un registro sin forma de contestarle no entra. Ni teléfono ni correo = no hay
 * registro, porque el único propósito de esta tabla es que Comunidad Latina
 * pueda llamar. Guardar el resto sin eso sería juntar datos personales sin uso
 * posible, que es exactamente lo que §5.4 prohíbe.
 */

// ---------------------------------------------------------------------------
// Guardas
// ---------------------------------------------------------------------------

export function isRegistrationKind(value: unknown): value is RegistrationKind {
  return typeof value === "string" && (REGISTRATION_KINDS as readonly string[]).includes(value);
}

export function isRegistrationStatus(value: unknown): value is RegistrationStatus {
  return typeof value === "string" && (REGISTRATION_STATUSES as readonly string[]).includes(value);
}

/** ¿El registro sigue esperando algo del equipo? Es lo que ocupa cupo. */
export function esRegistroAbierto(status: RegistrationStatus): boolean {
  return (REGISTRATION_OPEN_STATUSES as readonly string[]).includes(status);
}

// ---------------------------------------------------------------------------
// Transiciones
// ---------------------------------------------------------------------------

/**
 * Qué puede hacer el equipo con un registro.
 *
 * UNA sola regla, y es la del trigger: se puede ir a cualquier estado menos a
 * `new`. «Nuevo» significa «nadie del equipo lo miró todavía», y en cuanto
 * alguien lo miró eso deja de ser cierto — un botón «volver a nuevo» estaría
 * mintiéndole al próximo que abra la cola.
 *
 * Todo lo demás tiene vuelta a propósito: descartar por error se corrige, y un
 * lugar aprobado que resultó no existir se descarta después.
 */
export function puedeTransicionarRegistro(
  desde: RegistrationStatus,
  hasta: RegistrationStatus,
): boolean {
  if (desde === hasta) return false;
  return hasta !== "new";
}

export function transicionesPosiblesDeRegistro(
  desde: RegistrationStatus,
): RegistrationStatus[] {
  return REGISTRATION_STATUSES.filter((estado) => puedeTransicionarRegistro(desde, estado));
}

/**
 * ¿Esta persona ya tiene un registro abierto de este formulario?
 *
 * Espeja el índice único parcial de la 0131. Se calcula acá para poder mostrar
 * «ya te registramos, te vamos a llamar» en vez de dibujar un formulario que el
 * servidor va a rechazar.
 */
export function tieneRegistroAbierto(
  registros: readonly { kind: string; status: string }[],
  kind: RegistrationKind,
): boolean {
  return registros.some(
    (registro) =>
      registro.kind === kind &&
      isRegistrationStatus(registro.status) &&
      esRegistroAbierto(registro.status),
  );
}

// ---------------------------------------------------------------------------
// Esquemas
// ---------------------------------------------------------------------------

const textoCorto = z.string().trim().max(REGISTRATION_DETAIL_MAX);

/**
 * Los campos que tienen los cuatro formularios.
 *
 * `contactPhone` y `contactEmail` son opcionales POR SEPARADO y obligatorios EN
 * CONJUNTO (el refine de abajo). Es a propósito: mucha gente de la comunidad no
 * usa correo, y mucha otra no quiere dar el teléfono. Exigir los dos dejaría
 * afuera a una mitad; no exigir ninguno dejaría un registro al que no se puede
 * contestar.
 */
const baseSchema = z.object({
  name: z.string().trim().min(REGISTRATION_NAME_MIN).max(REGISTRATION_NAME_MAX),
  contactPhone: z
    .string()
    .trim()
    .min(REGISTRATION_PHONE_MIN)
    .max(REGISTRATION_PHONE_MAX)
    .optional(),
  contactEmail: z.email().max(REGISTRATION_EMAIL_MAX).optional(),
  areaLabel: z.string().trim().min(REGISTRATION_AREA_MIN).max(REGISTRATION_AREA_MAX),
  body: z.string().trim().min(REGISTRATION_BODY_MIN).max(REGISTRATION_BODY_MAX),
});

/** El "al menos uno" de los dos contactos, escrito una sola vez. */
function exigirContacto<T extends { contactPhone?: string; contactEmail?: string }>(
  valores: T,
  ctx: z.RefinementCtx,
): void {
  if (!valores.contactPhone && !valores.contactEmail) {
    ctx.addIssue({
      code: "custom",
      path: ["contactPhone"],
      message: "Dejá un teléfono o un correo para que te podamos contestar.",
    });
  }
}

const chips = <T extends readonly [string, ...string[]]>(catalogo: T) =>
  z.array(z.enum(catalogo)).max(REGISTRATION_CHIPS_MAX);

/**
 * 1 · ME ANOTO DE VOLUNTARIO
 *
 * `aceptaReglas` es `literal(true)` y no `boolean`: un `false` tiene que ser un
 * error de validación, no un registro guardado con la casilla en falso. La
 * regla corta existe «para que no haya compromiso con Comunidad Latina»
 * (cliente, 45:40), y una aceptación que se puede saltear no es una aceptación.
 *
 * Al menos UN chip de disponibilidad y UNO de en-qué-podés-ayudar: sin eso la
 * lista no sirve para lo único que el cliente pidió que hiciera, que es avisar
 * a la gente correcta de la zona correcta.
 */
export const registroVoluntarioSchema = baseSchema
  .extend({
    skills: chips(VOLUNTEER_SKILLS).min(1),
    availability: chips(VOLUNTEER_AVAILABILITY).min(1),
    aceptaReglas: z.literal(true),
  })
  .superRefine(exigirContacto);
export type RegistroVoluntarioInput = z.input<typeof registroVoluntarioSchema>;

/**
 * 2 · NECESITO VOLUNTARIOS
 *
 * `peopleNeeded` es un entero chico y no un texto: es el número que le dice al
 * equipo si esto es «dos personas para acomodar sillas» o «treinta para un
 * evento», y con eso decide a quién avisarle. El techo de 200 no es una regla
 * de negocio, es un tope de sanidad.
 *
 * `orgName` es opcional a propósito: el cliente fue explícito en que quien pide
 * puede ser «un grupo chico, no hace falta ser empresa».
 */
export const pedidoDeVoluntariosSchema = baseSchema
  .extend({
    requesterType: z.enum(REQUESTER_TYPES),
    orgName: textoCorto.min(2).optional(),
    whenLabel: textoCorto.min(2),
    peopleNeeded: z.coerce.number().int().min(1).max(200),
  })
  .superRefine(exigirContacto);
export type PedidoDeVoluntariosInput = z.input<typeof pedidoDeVoluntariosSchema>;

/**
 * 3 · REGISTRO MI LUGAR (centro de acopio · banco de comida o comedor)
 *
 * La dirección es obligatoria y el horario también: son los dos datos sin los
 * cuales la ficha del directorio no se puede publicar después. Pedirlos ahora
 * evita el ida y vuelta de «te aprobamos pero decinos dónde queda».
 */
export const registroDeLugarSchema = baseSchema
  .extend({
    placeType: z.enum(PLACE_TYPES),
    address: textoCorto.min(5),
    hoursLabel: textoCorto.min(2),
  })
  .superRefine(exigirContacto);
export type RegistroDeLugarInput = z.input<typeof registroDeLugarSchema>;

/**
 * 4 · PRESTO MI ESPACIO
 *
 * `capacity` es aproximada y se pregunta como número porque es lo que decide si
 * ahí entra una clase de diez chicos o una charla de ochenta personas.
 */
export const ofrecimientoDeEspacioSchema = baseSchema
  .extend({
    address: textoCorto.min(5),
    capacity: z.coerce.number().int().min(1).max(2000),
    daysLabel: textoCorto.min(2),
    activities: chips(SPACE_ACTIVITIES).min(1),
  })
  .superRefine(exigirContacto);
export type OfrecimientoDeEspacioInput = z.input<typeof ofrecimientoDeEspacioSchema>;

// ---------------------------------------------------------------------------
// Entrada validada → fila
// ---------------------------------------------------------------------------

/** Lo que se manda a `insert`, sin tenant ni autor (eso lo pone el servidor). */
export interface RegistroParaInsertar {
  kind: RegistrationKind;
  name: string;
  contact_phone: string | null;
  contact_email: string | null;
  area_label: string;
  body: string;
  details: Record<string, string | number | string[]>;
}

/**
 * Entrada YA validada → las columnas de la 0131.
 *
 * Existe como función pura para que el test pueda verificar lo que de verdad
 * importa: que cada formulario deje su detalle propio en `details` con las
 * claves que la ficha del panel sabe leer, y que no se cuele en columna nada
 * que no le corresponda.
 */
export function filaDeVoluntario(
  input: z.output<typeof registroVoluntarioSchema>,
): RegistroParaInsertar {
  return {
    kind: "volunteer",
    ...comunes(input),
    details: {
      skills: [...input.skills],
      availability: [...input.availability],
      rules_version: REGISTRATION_RULES_VERSION,
    },
  };
}

export function filaDePedidoDeVoluntarios(
  input: z.output<typeof pedidoDeVoluntariosSchema>,
): RegistroParaInsertar {
  return {
    kind: "volunteer_request",
    ...comunes(input),
    details: {
      requester_type: input.requesterType,
      when_label: input.whenLabel,
      people_needed: input.peopleNeeded,
      ...(input.orgName ? { org_name: input.orgName } : {}),
    },
  };
}

export function filaDeLugar(
  input: z.output<typeof registroDeLugarSchema>,
): RegistroParaInsertar {
  return {
    kind: "place",
    ...comunes(input),
    details: {
      place_type: input.placeType,
      address: input.address,
      hours_label: input.hoursLabel,
    },
  };
}

export function filaDeEspacio(
  input: z.output<typeof ofrecimientoDeEspacioSchema>,
): RegistroParaInsertar {
  return {
    kind: "space",
    ...comunes(input),
    details: {
      address: input.address,
      capacity: input.capacity,
      days_label: input.daysLabel,
      activities: [...input.activities],
    },
  };
}

function comunes(input: z.output<typeof baseSchema>) {
  return {
    name: input.name,
    contact_phone: input.contactPhone ?? null,
    contact_email: input.contactEmail ?? null,
    area_label: input.areaLabel,
    body: input.body,
  };
}

// ---------------------------------------------------------------------------
// Fila → ficha del panel
// ---------------------------------------------------------------------------

function textoDe(details: Record<string, unknown> | null, clave: string): string | null {
  const valor = details?.[clave];
  if (typeof valor === "string" && valor.trim()) return valor.trim();
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return null;
}

function listaDe(details: Record<string, unknown> | null, clave: string): string[] {
  const valor = details?.[clave];
  if (!Array.isArray(valor)) return [];
  return valor.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/**
 * `details` → pares etiqueta/valor listos para la ficha.
 *
 * Las etiquetas se resuelven con los diccionarios que le pasa la pantalla
 * (viven en `copy.ts`, como todo el texto del módulo). Un valor que la app no
 * conoce se muestra CRUDO en vez de descartarse: si mañana alguien inserta un
 * chip que no está en el catálogo, quien modera tiene que verlo, no quedarse
 * con la ficha incompleta y sin enterarse.
 */
export interface DiccionariosDeRegistro {
  skill: Readonly<Record<string, string>>;
  availability: Readonly<Record<string, string>>;
  activity: Readonly<Record<string, string>>;
  placeType: Readonly<Record<string, string>>;
  requesterType: Readonly<Record<string, string>>;
  /** Etiqueta de cada campo del detalle ("Dirección", "Cuándo", "Cuántas personas"). */
  campo: Readonly<Record<string, string>>;
}

export function detallesDeRegistro(
  kind: RegistrationKind,
  details: Record<string, unknown> | null,
  dic: DiccionariosDeRegistro,
): { label: string; value: string }[] {
  const traducir = (tabla: Readonly<Record<string, string>>, valor: string) =>
    tabla[valor] ?? valor;
  const par = (clave: string, value: string | null) =>
    value ? [{ label: dic.campo[clave] ?? clave, value }] : [];

  if (kind === "volunteer") {
    const skills = listaDe(details, "skills").map((item) => traducir(dic.skill, item));
    const disponibilidad = listaDe(details, "availability").map((item) =>
      traducir(dic.availability, item),
    );
    return [
      ...par("skills", skills.join(" · ") || null),
      ...par("availability", disponibilidad.join(" · ") || null),
    ];
  }

  if (kind === "volunteer_request") {
    const tipo = textoDe(details, "requester_type");
    return [
      ...par("requester_type", tipo ? traducir(dic.requesterType, tipo) : null),
      ...par("org_name", textoDe(details, "org_name")),
      ...par("when_label", textoDe(details, "when_label")),
      ...par("people_needed", textoDe(details, "people_needed")),
    ];
  }

  if (kind === "place") {
    const tipo = textoDe(details, "place_type");
    return [
      ...par("place_type", tipo ? traducir(dic.placeType, tipo) : null),
      ...par("address", textoDe(details, "address")),
      ...par("hours_label", textoDe(details, "hours_label")),
    ];
  }

  const actividades = listaDe(details, "activities").map((item) => traducir(dic.activity, item));
  return [
    ...par("address", textoDe(details, "address")),
    ...par("capacity", textoDe(details, "capacity")),
    ...par("days_label", textoDe(details, "days_label")),
    ...par("activities", actividades.join(" · ") || null),
  ];
}

export function diasDesde(iso: string, ahora: Date): number {
  const desde = new Date(iso).getTime();
  if (Number.isNaN(desde)) return 0;
  return Math.max(0, Math.floor((ahora.getTime() - desde) / 86_400_000));
}

/**
 * Fila cruda → ficha del panel, o `null` si la fila no se puede mostrar con
 * honestidad (un `kind` o un `status` que la app no conoce). Mismo criterio que
 * `toHelpNotice`: antes que dibujar una ficha a medias sobre la que alguien
 * tiene que decidir, no se dibuja.
 */
export function toRegistrationView(
  row: RegistrationRow,
  ctx: {
    nombrePorPerfil: ReadonlyMap<string, string | null>;
    dic: DiccionariosDeRegistro;
    now?: Date;
  },
): RegistrationView | null {
  if (!isRegistrationKind(row.kind) || !isRegistrationStatus(row.status)) return null;

  const ahora = ctx.now ?? new Date();
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    name: row.name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    areaLabel: row.area_label,
    body: row.body,
    detalles: detallesDeRegistro(row.kind, row.details, ctx.dic),
    authorId: row.created_by,
    authorName: ctx.nombrePorPerfil.get(row.created_by) ?? "Cuenta sin perfil legible",
    createdAt: row.created_at,
    agedDays: diasDesde(row.created_at, ahora),
    reviewedAt: row.reviewed_at,
    reviewerName: row.reviewed_by
      ? (ctx.nombrePorPerfil.get(row.reviewed_by) ?? "Alguien del equipo")
      : null,
    adminNotes: row.admin_notes,
    resourceId: row.resource_id,
  };
}

// ---------------------------------------------------------------------------
// Lugar aprobado → ficha del directorio
// ---------------------------------------------------------------------------

/**
 * La fuente que el equipo confirmó ANTES de publicar la ficha.
 *
 * No sale del registro y no puede salir del registro. El directorio (0096)
 * exige procedencia verificable en tres capas —el NOT NULL de la migración, el
 * filtro de `toCommunityResource` y la card— porque una ficha sin fuente se lee
 * como si el consejo lo diera la plataforma. Fabricar acá un
 * `source_name: "lo dijo el propio lugar"` con una URL inventada sería saltear
 * esa regla desde adentro; lo que corresponde es que alguien del equipo abra
 * algo (la página del negocio, el listado de la alcaldía) y escriba qué abrió.
 */
export interface FuenteConfirmada {
  name: string;
  url: string;
  /** `YYYY-MM-DD`: el día en que alguien del equipo miró esa URL. */
  checkedAt: string;
}

export const fuenteConfirmadaSchema = z.object({
  name: z.string().trim().min(2).max(160),
  url: z.url().refine((valor) => /^https?:\/\//i.test(valor), {
    message: "La fuente tiene que ser un enlace http o https.",
  }),
  checkedAt: z.iso.date(),
});

/**
 * Registro `place` aprobado + fuente confirmada → el `insert` de
 * `community_resources`.
 *
 * Pura para poder testear lo único que importa acá: que el tema salga del
 * `place_type` (un banco de comida NO puede terminar en «Centro de acopio»:
 * son las dos tarjetas que el cliente pidió separadas porque en una recibís y
 * en la otra dejás), que la ficha nazca `published` —el equipo ya decidió al
 * aprobar; un segundo paso de publicación sería la misma decisión dos veces— y
 * que el contacto del registro viaje a la ficha.
 *
 * Devuelve `null` si el registro no es un lugar o le falta la dirección: sin
 * dirección ni teléfono la ficha no pasaría el `need_contact` de la 0096.
 */
export function recursoDesdeRegistro(
  registro: Pick<RegistrationRow, "kind" | "name" | "contact_phone" | "area_label" | "body" | "details">,
  fuente: FuenteConfirmada,
): {
  topic: "comida" | "acopio";
  name: string;
  description: string;
  phone: string | null;
  address: string | null;
  area_label: string;
  hours_note: string | null;
  source_name: string;
  source_url: string;
  source_checked_at: string;
  status: "published";
} | null {
  if (registro.kind !== "place") return null;

  const placeType = textoDe(registro.details, "place_type");
  if (placeType !== "comida" && placeType !== "acopio") return null;

  const address = textoDe(registro.details, "address");
  if (!address && !registro.contact_phone) return null;

  return {
    topic: placeType,
    name: registro.name,
    description: registro.body,
    phone: registro.contact_phone,
    address,
    area_label: registro.area_label,
    hours_note: textoDe(registro.details, "hours_label"),
    source_name: fuente.name,
    source_url: fuente.url,
    source_checked_at: fuente.checkedAt,
    status: "published",
  };
}
