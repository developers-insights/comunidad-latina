import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * =============================================================================
 * GRUPOS DE CHAT — catálogo, tipos y el escape de tipado
 * =============================================================================
 *
 * `src/lib/types/database.types.ts` se regenera a mano cada tanto y todavía no
 * conoce las tablas de la 0133. Mismo patrón que ya usan Comunidad
 * (`supabaseSinTiparComunidad`), Reseñas y Verificación: un solo lugar donde
 * el cliente pierde el tipado, con nombre propio, para que se vea en el diff
 * quién lo está usando y por qué.
 */
export function supabaseSinTiparGrupos(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

/**
 * Los NUEVE temas del CHECK de `chat_groups.category` (0133), en el orden en
 * que se muestran. La lista es cerrada a propósito: con texto libre, "bici",
 * "bicicleta" y "ciclismo" serían tres grupos que no se encuentran entre sí.
 *
 * `grupos.test.ts` compara este array contra el SQL de la migración: si la
 * base y la app se separan, el INSERT falla en producción y acá se ve antes.
 */
export const CATEGORIAS_DE_GRUPO = [
  "deportes",
  "emprendedores",
  "real_estate",
  "padres",
  "fe",
  "musica",
  "comida",
  "barrio",
  "otro",
] as const;

export type CategoriaDeGrupo = (typeof CATEGORIAS_DE_GRUPO)[number];

export function esCategoriaDeGrupo(value: unknown): value is CategoriaDeGrupo {
  return (
    typeof value === "string" &&
    (CATEGORIAS_DE_GRUPO as readonly string[]).includes(value)
  );
}

/**
 * Etiqueta visible de cada tema. Se escriben como los diría alguien de la
 * comunidad, no como los nombraría la base: `real_estate` en pantalla dice
 * "Bienes raíces", que es lo que el cliente usó en la call.
 */
export const ETIQUETA_DE_CATEGORIA: Record<CategoriaDeGrupo, string> = {
  deportes: "Deportes",
  emprendedores: "Emprendedores",
  real_estate: "Bienes raíces",
  padres: "Familias",
  fe: "Fe",
  musica: "Música",
  comida: "Comida",
  barrio: "Mi barrio",
  otro: "Otros",
};

export const VISIBILIDADES = ["public", "private"] as const;
export type VisibilidadDeGrupo = (typeof VISIBILIDADES)[number];

export const ROLES = ["owner", "admin", "member"] as const;
export type RolEnGrupo = (typeof ROLES)[number];

/** Puede editar la ficha, invitar, expulsar y cerrar. */
export function administra(rol: RolEnGrupo | null): boolean {
  return rol === "owner" || rol === "admin";
}

/** Límites del esquema (0133), en un solo lugar para el form y las actions. */
export const LIMITES = {
  nombreMin: 3,
  nombreMax: 60,
  descripcionMax: 300,
  mensajeMax: 2000,
} as const;

/** Fila de `chat_groups` tal como la piden las pantallas. */
export type GrupoRow = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  visibility: string;
  avatar_url: string | null;
  status: string;
  member_count: number;
  created_by: string;
  created_at: string;
};

/** Una sola definición de columnas para la query y para el tipo. */
export const GRUPO_COLUMNS =
  "id, name, description, category, visibility, avatar_url, status, member_count, created_by, created_at";

export type MensajeDeGrupoRow = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export const MENSAJE_DE_GRUPO_COLUMNS = "id, sender_id, body, created_at";

/**
 * Cuántos miembros, dicho como se dice. "1 miembro" y no "1 miembros": el
 * plural mal hecho es la marca más barata de software sin terminar.
 */
export function miembrosLabel(count: number): string {
  return count === 1 ? "1 miembro" : `${count} miembros`;
}
