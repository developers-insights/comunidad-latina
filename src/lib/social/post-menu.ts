import {
  canEditPost,
  type PostActionCheck,
  type PostOwnershipView,
  type PostViewer,
} from "./post-editing";

/**
 * =============================================================================
 * MENÚ ⋯ DE UNA PUBLICACIÓN — reglas puras (migración 0097)
 * =============================================================================
 *
 * Fijar, ocultar del timeline, desactivar comentarios y quitar una foto. Este
 * módulo NO toca la base ni la sesión: decide con datos ya leídos y traduce los
 * códigos que devuelven las dos funciones de la 0097. Lo importan las server
 * actions (`feed/post-menu-actions.ts`, `feed/post-edit-actions.ts`) y la UI,
 * que sólo lo usa para no ofrecer un botón que el servidor va a rechazar.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ LAS TRES ACCIONES COMPARTEN UNA SOLA REGLA
 * -----------------------------------------------------------------------------
 * Fijar, ocultar y cerrar comentarios son lo mismo desde el punto de vista de
 * quién puede hacerlas: hay que ser el autor, estar en la misma comunidad, y la
 * publicación tiene que estar `published`. Es EXACTAMENTE el predicado de
 * `canEditPost`, así que se delega en él en vez de copiarlo. Tres copias de una
 * regla de autorización son tres oportunidades de que una se quede vieja.
 *
 * Lo que sí cambia por acción es el COPY del rechazo ("vas a poder editarla
 * cuando…" no sirve para fijar), y eso vive en `components/feed/copy.ts`.
 *
 * Una publicación OCULTA sigue siendo `published`: por eso pasa este chequeo, y
 * tiene que pasarlo — si no, ocultarla sería un viaje de ida.
 *
 * -----------------------------------------------------------------------------
 * LA UI NO ES LA FRONTERA
 * -----------------------------------------------------------------------------
 * Nada de lo que hay acá es seguridad. La autorización real la deciden, en este
 * orden: la server action (que relee el post del servidor y compara autor y
 * comunidad contra el JWT), las funciones `public.fijar_publicacion` y
 * `public.quitar_foto_de_publicacion` (que repiten el filtro en su WHERE) y la
 * RLS de `posts_update`. Este módulo sólo evita ofrecer algo que va a rebotar.
 */

/** Motivos por los que una acción del menú no está disponible. */
export type PostMenuDenial =
  /** No es su publicación, o llegó desde otra comunidad. */
  | "no-disponible"
  /** Está en revisión o la retiró la moderación. */
  | "no-publicada"
  /** Se quiso fijar algo que está oculto: son órdenes contrarias. */
  | "esta-oculta"
  /** Se quiso quitar una foto que ya no está en la publicación. */
  | "no-esta"
  /** Se quiso quitar un video. Sólo se quitan fotos (ver 0097). */
  | "es-video"
  /** Era el único medio: una publicación no puede quedar vacía. */
  | "es-la-unica";

export type PostMenuCheck = { ok: true } | { ok: false; reason: PostMenuDenial };

/**
 * ¿Puede esta persona GESTIONAR esta publicación (fijar, ocultar, cerrar
 * comentarios, quitarle una foto)?
 *
 * Delega en `canEditPost` a propósito —es literalmente la misma regla— y sólo
 * reagrupa sus motivos: para el menú, "no es tuya" y "es de otra comunidad" son
 * el mismo callejón sin salida y merecen el mismo mensaje; "en revisión" y
 * "retirada" también, porque en ambos casos lo que corresponde es esperar.
 */
export function canManagePost(
  post: PostOwnershipView,
  viewer: PostViewer,
): PostMenuCheck {
  const allowed: PostActionCheck = canEditPost(post, viewer);
  if (allowed.ok) return { ok: true };
  return {
    ok: false,
    reason:
      allowed.reason === "not-author" || allowed.reason === "other-community"
        ? "no-disponible"
        : "no-publicada",
  };
}

/**
 * ¿Se le puede quitar ESTE archivo a la publicación?
 *
 * Espeja las tres reglas que la función `public.quitar_foto_de_publicacion`
 * aplica en su WHERE. Acá existen para poder decir CUÁL falló antes de gastar un
 * viaje al servidor y para apagar el botón con un motivo escrito al lado; el
 * cumplimiento no depende de esto.
 *
 * `isVideo` lo decide quien llama con `mediaKindOf()` (la extensión del
 * archivo), que es la misma señal que usa `app.media_has_video()` en la base.
 */
export function canRemovePostMedia(input: {
  /** Todos los medios que tiene hoy la publicación. */
  media: readonly string[];
  /** El que se quiere sacar. */
  path: string;
  isVideo: boolean;
}): PostMenuCheck {
  if (!input.media.includes(input.path)) return { ok: false, reason: "no-esta" };
  if (input.isVideo) return { ok: false, reason: "es-video" };
  if (input.media.length <= 1) return { ok: false, reason: "es-la-unica" };
  return { ok: true };
}

/**
 * Códigos que devuelven las funciones de la 0097, tal cual salen de Postgres.
 * Se listan enteros para que un código nuevo en la base no pase silencioso: si
 * aparece uno que no está acá, `postMenuDenialOf` lo trata como fallo genérico.
 */
const RPC_DENIALS: Record<string, PostMenuDenial> = {
  no_disponible: "no-disponible",
  esta_oculta: "esta-oculta",
  no_esta: "no-esta",
  es_video: "es-video",
  es_la_unica: "es-la-unica",
};

export type RpcOutcome =
  | { ok: true }
  | { ok: false; kind: "denial"; reason: PostMenuDenial }
  /** `sin_sesion`, un código desconocido, o la RPC no devolvió nada. */
  | { ok: false; kind: "unauthenticated" }
  | { ok: false; kind: "error" };

/**
 * Traduce lo que devolvió la función de Postgres.
 *
 * `sin_sesion` se separa del resto porque la salida para la persona es distinta
 * —hay que entrar a la cuenta, no esperar—, y cualquier cosa que no reconozcamos
 * cae en `error` en vez de asumir éxito: ante un código nuevo, no se le dice a
 * nadie que algo pasó cuando no sabemos si pasó.
 */
export function postMenuDenialOf(code: string | null | undefined): RpcOutcome {
  if (code === "ok") return { ok: true };
  if (code === "sin_sesion") return { ok: false, kind: "unauthenticated" };
  const reason = code ? RPC_DENIALS[code] : undefined;
  if (reason) return { ok: false, kind: "denial", reason };
  return { ok: false, kind: "error" };
}
