import { mediaKindOf, postMediaUrl } from "@/components/feed/helpers";

/**
 * Modelo PURO de un tile del grid de publicaciones del perfil (§ red social).
 *
 * Sin imports de servidor a propósito: se importa desde la query server-only
 * (posts.ts) y desde su test en entorno node. `@/components/feed/helpers` es
 * puro (solo `import type` en runtime), así que este módulo no arrastra ningún
 * componente cliente del feed — el test corre sin jsdom.
 */

export type PostTileKind = "image" | "video" | "text";

export interface PostTile {
  id: string;
  /** image = foto; video = primer medio de video; text = post sin medios. */
  tileKind: PostTileKind;
  /** URL pública del thumbnail (foto o video). null en tiles de texto. */
  mediaUrl: string | null;
  /** Cuerpo del post — se muestra en los tiles de texto y alimenta el aria-label. */
  text: string;
  /** kind='question': se rotula distinto ("Pregunta a la comunidad"). */
  isQuestion: boolean;
}

/** Fila mínima de `posts` que necesita el grid (sin like/comment counts). */
export interface PostTileInput {
  id: string;
  body: string;
  kind: string;
  /** Array `posts.media` (0025): fotos y videos conviven, el kind se infiere por extensión. */
  media: string[] | null;
}

/**
 * Fila de post → tile del grid. Decide el thumbnail con la MISMA regla que el
 * feed (primer medio del array; kind por extensión). Un post sin medios (posts
 * viejos pre-0023 o preguntas) cae a un tile de texto en vez de romper la grilla.
 */
export function toPostTile(input: PostTileInput): PostTile {
  const media = (input.media ?? []).filter(
    (path) => typeof path === "string" && path.trim().length > 0,
  );
  const first = media[0];
  const isQuestion = input.kind === "question";
  const text = input.body ?? "";

  if (first) {
    return {
      id: input.id,
      tileKind: mediaKindOf(first), // "image" | "video"
      mediaUrl: postMediaUrl(first),
      text,
      isQuestion,
    };
  }

  return {
    id: input.id,
    tileKind: "text",
    mediaUrl: null,
    text,
    isQuestion,
  };
}
