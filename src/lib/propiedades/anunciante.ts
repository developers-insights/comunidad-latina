/**
 * =============================================================================
 * ANUNCIANTE — quién publica el alquiler: propietario, agente, administradora
 * =============================================================================
 *
 * Requisito del cliente: el módulo Propiedades necesita una segunda pestaña,
 * "Agentes y propietarios" — un DIRECTORIO DE PERSONAS (no de avisos) que
 * muestra quién publica los alquileres de la comunidad: propietarios directos,
 * agentes inmobiliarios, administradoras y representantes autorizados. Hasta
 * hoy `listings.attrs` no distinguía nada de esto: un aviso de un dueño y uno
 * de una inmobiliaria se veían exactamente igual.
 *
 * DÓNDE VIVE: `listings.attrs.advertiser_role` (JSONB libre), al lado de
 * `property_type`/`operation` (tipos.ts) y de `deposit_amount`/`furnished`
 * (alquiler.ts). Mismo criterio y misma razón: no hace falta migración, y
 * JUSTAMENTE por eso hace falta este módulo — un JSONB libre no valida nada
 * solo, así que la única garantía de que lo que se escribe y lo que se lee
 * coinciden es que los dos lados pasen por acá.
 *
 * NO INVENTAMOS VALORES. Una clave ausente significa "no lo declaró", nunca un
 * default: quien no eligió un rol al publicar NO es "Propietario/a" por
 * omisión — el directorio lo muestra SIN etiqueta de rol, jamás con una
 * inventada. Mismo criterio que `alquiler.ts` con el amueblado o el depósito.
 *
 * Módulo PURO: sin I/O, sin `server-only`. Lo comparten la server action de
 * publicar (escritura, `/publicar/actions.ts`), el formulario (client,
 * `publish-form.tsx`) y el directorio "Agentes y propietarios" (lectura +
 * agregación, `propiedades/advertiser-directory.tsx`).
 */

// ---------------------------------------------------------------------------
// Catálogo de roles
// ---------------------------------------------------------------------------

/** Clave dentro de `listings.attrs`. Constante exportada para que la action y el filtro nunca se desincronicen por un typo. */
export const ADVERTISER_ROLE_ATTR = "advertiser_role";

/**
 * Cuatro roles y no más: son los que de verdad se ven en los avisos de esta
 * comunidad (spec cliente). "Propietario/a" primero porque es el caso más
 * común — publicar en nombre propio no debería sentirse la opción rara al
 * final de una lista.
 */
export const ADVERTISER_ROLES = ["owner", "agent", "company", "representative"] as const;

export type AdvertiserRole = (typeof ADVERTISER_ROLES)[number];

export const ADVERTISER_ROLE_LABEL: Record<AdvertiserRole, string> = {
  owner: "Propietario/a",
  agent: "Agente inmobiliario/a",
  company: "Administradora",
  representative: "Representante autorizado/a",
};

/** Una línea que aclara qué significa cada rol al momento de elegirlo — mismo criterio que `FURNISHED_HELP` en alquiler.ts. */
export const ADVERTISER_ROLE_HELP: Record<AdvertiserRole, string> = {
  owner: "El alquiler es tuyo",
  agent: "Publicás en nombre de un dueño",
  company: "Administrás propiedades de terceros",
  representative: "Publicás en nombre de otra persona",
};

export interface AdvertiserRoleOption {
  value: AdvertiserRole;
  label: string;
  hint: string;
}

export const ADVERTISER_ROLE_OPTIONS: readonly AdvertiserRoleOption[] = ADVERTISER_ROLES.map(
  (value) => ({ value, label: ADVERTISER_ROLE_LABEL[value], hint: ADVERTISER_ROLE_HELP[value] }),
);

const ADVERTISER_ROLE_SET = new Set<string>(ADVERTISER_ROLES);

export function isAdvertiserRole(value: unknown): value is AdvertiserRole {
  return typeof value === "string" && ADVERTISER_ROLE_SET.has(value);
}

/**
 * Cualquier entrada → `AdvertiserRole`, o `null` ("no lo declaró"). NUNCA
 * lanza: esta action es pública y `attrs` es JSONB libre, así que puede llegar
 * cualquier cosa. Sin alias de sinónimos a propósito (a diferencia de
 * `normalizeFurnished`): es una clave NUEVA, sin avisos viejos en texto libre
 * detrás — sólo sale de un `<select>` con estos cuatro valores.
 */
export function parseAdvertiserRole(value: unknown): AdvertiserRole | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return ADVERTISER_ROLE_SET.has(trimmed) ? (trimmed as AdvertiserRole) : null;
}

/** Etiqueta humana, o `null` si el valor no se reconoce. */
export function advertiserRoleLabel(value: unknown): string | null {
  const role = parseAdvertiserRole(value);
  return role === null ? null : ADVERTISER_ROLE_LABEL[role];
}

// ---------------------------------------------------------------------------
// Agregación del directorio "Agentes y propietarios"
// ---------------------------------------------------------------------------

/** Lo mínimo que la agregación necesita de cada listing — subconjunto de la fila real de `listings`. */
export interface AdvertiserListingRow {
  createdBy: string;
  createdAt: string;
  areaLabel: string | null;
  attrs: unknown;
}

/** Un anunciante agregado: quién es y qué dice su aviso de vivienda MÁS RECIENTE. */
export interface AdvertiserSummary {
  profileId: string;
  /** Rol declarado en su aviso más reciente. `null` si ESE aviso no lo declaró — no se busca en avisos más viejos (ver `aggregateAdvertisers`). */
  role: AdvertiserRole | null;
  /** Zona de su aviso más reciente. */
  areaLabel: string | null;
  /** Cantidad de avisos de vivienda `published` que aparecen en `rows` — el caller controla qué ventana de avisos entra ahí (ver el docblock de quien llama). */
  activeListingCount: number;
}

/**
 * Agrupa avisos de vivienda por publicador y arma UN resumen por persona.
 *
 * PURA a propósito: es la única forma de probar la regla "el rol y la zona son
 * los del aviso más reciente" sin levantar Supabase.
 *
 * SUPUESTO DE ORDEN: `rows` tiene que venir ordenado por fecha descendente
 * (`created_at desc, id desc` — el mismo orden que ya usa toda query paginada
 * de este repo). Con ese orden, la PRIMERA fila que se ve de cada `createdBy`
 * es, por construcción, su aviso más reciente — así que esta función no
 * compara fechas: sólo se queda con la primera aparición de cada persona y
 * cuenta el resto. Si `rows` llegara desordenado, "el rol del aviso más
 * reciente" dejaría de ser cierto.
 *
 * El orden de aparición del resultado —qué persona sale primero— es el mismo
 * que el de sus avisos más recientes: quien haya publicado más recientemente
 * encabeza la lista.
 */
export function aggregateAdvertisers(
  rows: readonly AdvertiserListingRow[],
): AdvertiserSummary[] {
  const byAdvertiser = new Map<string, AdvertiserSummary>();

  for (const row of rows) {
    const existing = byAdvertiser.get(row.createdBy);
    if (existing) {
      existing.activeListingCount += 1;
      continue;
    }
    const attrs =
      row.attrs !== null && typeof row.attrs === "object" && !Array.isArray(row.attrs)
        ? (row.attrs as Record<string, unknown>)
        : {};
    byAdvertiser.set(row.createdBy, {
      profileId: row.createdBy,
      role: parseAdvertiserRole(attrs[ADVERTISER_ROLE_ATTR]),
      areaLabel: row.areaLabel,
      activeListingCount: 1,
    });
  }

  return [...byAdvertiser.values()];
}
