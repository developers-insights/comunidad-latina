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

/**
 * =============================================================================
 * LA FOTO DEL GRUPO TIENE QUE SER UNA FOTO DE ESTA COMUNIDAD (0135)
 * =============================================================================
 *
 * `chat_groups.avatar_url` guarda una URL pública y no una ruta de Storage (§1
 * de la 0133): es lo que consume `<Avatar src>` en toda la app. El costado
 * incómodo de esa decisión es que la base no puede validarla —una URL no tiene
 * prefijo de tenant que una policy pueda comparar— así que el único lugar donde
 * se puede exigir que apunte a donde decimos es la server action.
 *
 * Sin esto, `z.url()` aceptaba CUALQUIER http(s). Consecuencias reales, ninguna
 * hipotética:
 *
 *   · Un `<img src>` a un servidor de terceros dentro de una tarjeta que ve
 *     toda la comunidad en Descubrir. Cada persona que abre la lista le deja su
 *     IP y su user-agent a ese servidor, sin haber elegido nada.
 *   · La foto puede cambiar DESPUÉS de la moderación: se aprueba un grupo con
 *     una imagen inocente y se sirve otra cosa al día siguiente, sin tocar la
 *     base.
 *   · La URL de una foto de OTRA comunidad del mismo proyecto: contenido
 *     cruzado de tenants entrando por una columna de texto.
 *
 * Se valida contra la ruta canónica que arma `group-form.tsx` al subir, que es
 * la MISMA que la policy `avatars_insert` (0012) verifica contra el JWT:
 * `{NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/{tenant}/{uid}/…`
 *
 * Módulo PURO: sin Supabase y sin DOM, para que el test lo pueda correr solo.
 */
const AVATARS_PUBLIC_PREFIX = "/storage/v1/object/public/avatars/";

/**
 * ¿La URL sale del Storage público de ESTE proyecto, bucket `avatars`?
 *
 * Se compara el HOST, no el string entero: `new URL()` normaliza el puerto por
 * defecto, el `//` de más y el `%2e` — comparar con `startsWith` sobre el texto
 * crudo se esquiva con cualquiera de las tres.
 */
export function esUrlDeAvatarsPublico(url: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  try {
    const candidata = new URL(url);
    const propia = new URL(base);
    return (
      candidata.protocol === propia.protocol &&
      candidata.host === propia.host &&
      candidata.pathname.startsWith(AVATARS_PUBLIC_PREFIX)
    );
  } catch {
    return false;
  }
}

/**
 * Lo anterior MÁS que el archivo viva bajo el prefijo de la comunidad. El
 * tenant sale del guard del servidor, nunca del cliente.
 */
export function esFotoDeGrupoValida(url: string, tenantId: string): boolean {
  if (!esUrlDeAvatarsPublico(url)) return false;
  try {
    return new URL(url).pathname.startsWith(`${AVATARS_PUBLIC_PREFIX}${tenantId}/`);
  } catch {
    return false;
  }
}

/**
 * COPY DE LOS VETOS (0135).
 *
 * Estas tres frases son de pantalla y su lugar natural es
 * `src/components/messaging/copy.ts`, con el resto de `COPY.groups`. Viven acá
 * porque la tanda que las estrena no tiene ese archivo entre los suyos, y
 * porque `removeConfirmBody` no es una frase nueva sino una que quedó MINTIENDO
 * ("puede volver a entrar" dejó de ser cierto cuando expulsar empezó a vetar).
 * Dejar la vieja hasta poder tocar el archivo compartido habría sido peor.
 * Cuando ese archivo se toque de nuevo, las tres se mudan.
 */
export const COPY_VETO = {
  /** Alguien vetado toca "Unirme". No lo culpa y no lo manda a reintentar. */
  joinBanned: "Quien administra este grupo te sacó, así que no podés volver a entrar solo.",
  /** Reemplaza a COPY.groups.removeConfirmBody, que prometía lo contrario. */
  removeConfirmBody:
    "No va a poder leer ni escribir más, ni volver a entrar por su cuenta. Si más adelante querés, podés invitarlo de nuevo.",
} as const;
