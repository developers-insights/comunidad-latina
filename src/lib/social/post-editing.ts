import { z } from "zod";

/**
 * =============================================================================
 * EDITAR Y ELIMINAR UNA PUBLICACIÓN PROPIA — reglas puras
 * =============================================================================
 *
 * Este módulo NO toca la base ni la sesión: decide, con datos ya leídos, si una
 * persona puede editar o eliminar una publicación y qué texto es válido. Lo
 * importan tres lugares: la server action (`feed/post-edit-actions.ts`), que es
 * la única frontera que vale, y las dos piezas de UI, que sólo lo usan para no
 * ofrecer un botón que el servidor va a rechazar.
 *
 * -----------------------------------------------------------------------------
 * LAS CUATRO DECISIONES DE DISEÑO (y por qué)
 * -----------------------------------------------------------------------------
 *
 * 1 · SE EDITA EL TEXTO, NO LOS ARCHIVOS.
 *    Cada foto y cada video tiene su fila en `content_assets` (0061) con el
 *    SHA-256, la huella perceptual y —lo que importa— `first_uploaded_at`: la
 *    fecha en que ese archivo entró por primera vez. Esa fila es EVIDENCIA, y
 *    0069 la deja explícitamente fuera de toda purga porque es lo único que
 *    defiende a quien subió primero cuando alguien reclama el material como
 *    suyo. Dejar cambiar los archivos de una publicación ya publicada rompe esa
 *    cadena por los dos lados: la fila vieja queda apuntando a un post cuyo
 *    contenido ya no es (una disputa se resolvería contra el archivo
 *    equivocado), y la nueva necesitaría rehacer el pipeline completo —subida
 *    al bucket, huella, escaneo de similitud, declaración de licencia,
 *    moderación de imagen— que es exactamente lo que hace publicar de nuevo.
 *    Quien quiere otras fotos publica otra vez; el costo es un toque y la
 *    ganancia es que el libro de procedencia no miente.
 *
 * 2 · UNA EDICIÓN SE TIENE QUE VER.
 *    Editar en silencio es una trampa para quien ya comentó: la conversación
 *    queda debajo de un texto que nunca leyó. `posts.updated_at` (0007) sirve
 *    como señal —su trigger sólo dispara cuando cambia body/media/kind/status,
 *    así que un me gusta no "edita" nada— y `wasPostEdited()` la traduce.
 *    ⚠️ Limitación honesta: ese trigger también corre cuando la moderación
 *    cambia el `status`, así que un post que pasó por revisión y fue aprobado
 *    se marca como editado sin que su autor haya tocado una letra. La solución
 *    correcta es una columna `edited_at` propia; agregarla es una migración y
 *    no es de este módulo. Mientras tanto se prefiere el falso positivo raro
 *    antes que la edición invisible.
 *
 * 3 · BORRAR ES BORRAR (duro), como en el resto del repo.
 *    `posts_delete` (0007) es un DELETE real y todo el módulo social está
 *    construido alrededor de eso: los comentarios se van por `on delete
 *    cascade`, los me gusta por `app.cleanup_reactions()`, los guardados por
 *    `app.cleanup_saves()`, las vistas y los votos de la encuesta por sus
 *    propias cascadas. No se inventa un borrado blando acá: `status='removed'`
 *    ya significa otra cosa —"lo retiró la moderación"— y usarlo para "lo
 *    borré yo" haría que el banner del detalle le dijera a la persona que la
 *    sancionaron. Lo que NO se va, y es deliberado: las filas de
 *    `content_assets` (no tienen FK al post; son el libro de procedencia) y lo
 *    que ya esté en `moderation_queue` / `content_integrity_alerts`. Borrar la
 *    publicación no borra el expediente.
 *
 * 4 · EN REVISIÓN O RETIRADA NO SE EDITA.
 *    Si un post en `pending_review` se pudiera editar, editar sería la forma de
 *    esquivar la cola: se manda algo limpio y el humano revisa otra cosa. Y un
 *    `removed` no se auto-resucita (la RLS ya lo impide con `status <>
 *    'removed'` en el USING del autor; acá se dice antes y con copy). Sólo se
 *    edita lo que está `published`. La contracara: el texto editado vuelve a
 *    pasar por moderación en la action, así que tampoco se puede publicar algo
 *    inocuo y después cambiarlo por otra cosa.
 */

/** Techo del cuerpo, el MISMO que `postSchema` de `feed/actions.ts`. */
export const POST_BODY_MAX = 2000;

/** Piso cuando el cuerpo es lo único que hay (sin foto ni video). */
export const POST_BODY_MIN = 2;

/**
 * ¿ESTE CUERPO SE PUEDE PUBLICAR? Espejo exacto de `bodyIsPublishable()` de
 * `feed/actions.ts` (2026-08-05: con medio, el texto es opcional; sin medio,
 * mínimo dos caracteres).
 *
 * Está duplicado y no importado porque el original vive en un archivo
 * `"use server"`, donde Next sólo admite exports async —un helper exportado de
 * ahí sería un endpoint— y además no está exportado. El lugar correcto es este
 * módulo: cuando alguien pueda tocar `actions.ts`, que lo importe de acá y
 * borre el suyo. Hasta entonces, editar y publicar comparten la regla por
 * copia, con este test cuidándola.
 */
export function bodyIsPublishable(body: string, hasMedia: boolean): boolean {
  if (body.length === 0) return hasMedia;
  return body.length >= POST_BODY_MIN;
}

/**
 * Normalización del texto: la misma que al publicar (trim + techo de 2000).
 * Devuelve el cuerpo ya limpio o `null` si no pasa — el caller decide el copy.
 */
export const postBodySchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().max(POST_BODY_MAX));

/** Vista mínima del post que necesitan las reglas. Nada de PII, nada de más. */
export interface PostOwnershipView {
  /** `null` si la cuenta del autor ya no existe. */
  authorId: string | null;
  tenantId: string;
  /** `published` | `pending_review` | `removed` (texto libre por robustez). */
  status: string;
}

/** Quién pregunta. Ambos campos salen del servidor, nunca del cliente. */
export interface PostViewer {
  id: string;
  tenantId: string;
}

export type PostActionDenial =
  /** No es su publicación. */
  | "not-author"
  /** Es suya, pero el request llegó desde otra comunidad. */
  | "other-community"
  /** Está esperando que la mire un humano. */
  | "in-review"
  /** La retiró la moderación. */
  | "removed"
  /** Tiene una promoción paga corriendo. */
  | "promoted";

export type PostActionCheck = { ok: true } | { ok: false; reason: PostActionDenial };

/**
 * ¿Puede esta persona EDITAR esta publicación?
 *
 * El orden de los chequeos no es casual: la pertenencia va primero para no
 * filtrarle a un tercero en qué estado de moderación está un post ajeno.
 */
export function canEditPost(post: PostOwnershipView, viewer: PostViewer): PostActionCheck {
  if (!post.authorId || post.authorId !== viewer.id) {
    return { ok: false, reason: "not-author" };
  }
  if (post.tenantId !== viewer.tenantId) {
    return { ok: false, reason: "other-community" };
  }
  if (post.status === "removed") return { ok: false, reason: "removed" };
  if (post.status !== "published") return { ok: false, reason: "in-review" };
  return { ok: true };
}

/**
 * ¿Puede esta persona ELIMINAR esta publicación?
 *
 * A diferencia de editar, el estado NO importa: una publicación en revisión o
 * retirada sigue siendo suya y bajarla es su derecho — y no esquiva nada,
 * porque el expediente de moderación y las huellas de los archivos quedan.
 *
 * Lo único que frena el borrado es una PROMOCIÓN PAGA ACTIVA. `campaigns` y
 * `post_promotions` cuelgan del post con `on delete cascade` (0048 / 0023): si
 * se borra el post, la campaña que alguien pagó desaparece con él y se lleva
 * puesto el registro del pago. Esperar a que termine es reversible; borrar el
 * comprobante no.
 */
export function canDeletePost(
  post: PostOwnershipView,
  viewer: PostViewer,
  context: { hasActivePromotion: boolean },
): PostActionCheck {
  if (!post.authorId || post.authorId !== viewer.id) {
    return { ok: false, reason: "not-author" };
  }
  if (post.tenantId !== viewer.tenantId) {
    return { ok: false, reason: "other-community" };
  }
  if (context.hasActivePromotion) return { ok: false, reason: "promoted" };
  return { ok: true };
}

/**
 * Tolerancia entre `created_at` y `updated_at` para considerar que hubo una
 * edición de verdad. Ambas columnas nacen del mismo `now()` de la transacción
 * del INSERT, así que en teoría alcanzaría con `>`; el segundo de margen cubre
 * relojes y serializaciones distintas sin dejar pasar una edición real (que
 * siempre ocurre en otra transacción, después).
 */
const EDIT_TOLERANCE_MS = 1_000;

/**
 * ¿Esta publicación se muestra como editada? Ver la limitación en la cabecera
 * (decisión 2): un cambio de `status` hecho por la moderación también levanta
 * `updated_at`. Con fechas ilegibles devuelve `false`: ante la duda, no se
 * acusa de editar a quien no editó.
 */
export function wasPostEdited(input: {
  createdAt: string | Date | null | undefined;
  updatedAt: string | Date | null | undefined;
}): boolean {
  const created = toTime(input.createdAt);
  const updated = toTime(input.updatedAt);
  if (created === null || updated === null) return false;
  return updated - created > EDIT_TOLERANCE_MS;
}

function toTime(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * Copy del flujo, en español rioplatense neutro. Vive acá y no en
 * `components/feed/copy.ts` para no pisar a quien esté editando ese archivo
 * (mismo motivo que la constante `PROMOTE_LABEL` de `post-menu.tsx`); mover
 * todo junto cuando el módulo quede quieto.
 *
 * La vara de tono es `lib/integrity/declarations.ts`: se dice lo que pasa, se
 * dice lo que se pierde, y no se suaviza lo que no se puede suavizar.
 */
export const POST_EDIT_COPY = {
  /** Marca visible de una publicación editada. */
  editedLabel: "Editado",

  menu: {
    edit: "Editar publicación",
    delete: "Eliminar publicación",
  },

  edit: {
    sheetTitle: "Editar tu publicación",
    bodyLabel: "Tu texto",
    bodyPlaceholder: "Contá de qué se trata",
    /** Por qué las fotos no están acá. Se dice antes de que lo busquen. */
    mediaLocked:
      "Las fotos y el video quedan como los publicaste. Si querés mostrar otra cosa, publicá de nuevo.",
    /** Que la edición se ve. Se avisa ANTES de guardar, no después. */
    visibleNotice: "Tu publicación va a quedar marcada como editada.",
    save: "Guardar cambios",
    saving: "Guardando…",
    cancel: "Cancelar",
    counter: (used: number) => `${used} de ${POST_BODY_MAX}`,
    successTitle: "Listo, quedó actualizada",
    successBody: "Tu comunidad ya ve el texto nuevo.",
    /** El texto editado no pasó la moderación: se guardó, pero no se ve. */
    reviewTitle: "Tu cambio quedó en revisión",
    reviewBody:
      "Guardamos el texto, pero el equipo lo va a mirar antes de que vuelva al feed.",
    emptyBody: "Contanos un poquito más — al menos un par de palabras.",
    noChanges: "No cambiaste nada todavía.",
  },

  delete: {
    trigger: "Eliminar publicación",
    dialogTitle: "¿Eliminar esta publicación?",
    /**
     * Nada de "¿estás seguro?": se enumera lo que se pierde, en el orden en que
     * duele. Los comentarios primero porque son de OTRAS personas.
     */
    dialogBody: (counts: { comments: number; likes: number }) => {
      const parts: string[] = [];
      if (counts.comments > 0) {
        parts.push(
          counts.comments === 1
            ? "el comentario que le dejaron"
            : `los ${counts.comments} comentarios que le dejaron`,
        );
      }
      if (counts.likes > 0) {
        parts.push(counts.likes === 1 ? "su me gusta" : `sus ${counts.likes} me gusta`);
      }
      const losses =
        parts.length > 0
          ? `Se van con ella ${joinNatural(parts)} y los guardados de quienes la guardaron. `
          : "También se van los guardados de quienes la guardaron. ";
      return `${losses}No se puede deshacer.`;
    },
    confirm: "Sí, eliminarla",
    confirming: "Eliminando…",
    cancel: "No, dejarla",
    successTitle: "Publicación eliminada",
    successBody: "Ya no aparece en el feed de tu comunidad.",
  },

  /** Un mensaje por cada motivo de rechazo. Ninguno culpa a la persona. */
  denial: {
    "not-author": "Solo quien publicó puede editar o eliminar esta publicación.",
    "other-community":
      "Estás entrando desde otra comunidad. Volvé a la tuya para editar tus publicaciones.",
    "in-review":
      "Tu publicación está en revisión. Vas a poder editarla apenas el equipo la mire.",
    removed:
      "Esta publicación fue retirada por el equipo de moderación, así que ya no se puede editar.",
    promoted:
      "Tiene una promoción paga andando. Cuando termine vas a poder eliminarla.",
  } satisfies Record<PostActionDenial, string>,

  error: {
    notFound: "No encontramos esa publicación. Puede que ya no exista.",
    generic: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
    unauthenticated: "Entrá a tu cuenta para editar o eliminar tus publicaciones.",
    rateLimited: "Hiciste muchos cambios seguidos. Esperá un ratito — tu cuenta está bien.",
  },
} as const;

/** "a, b y c" — para enumerar lo que se pierde sin sonar a lista de sistema. */
function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}
