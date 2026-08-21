"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { CaretUp } from "@phosphor-icons/react/dist/ssr";
import { Spinner, buttonVariants } from "@/components/ui";
import { CommentItem } from "@/components/feed/comment-item";
import { CommentMenu } from "@/components/feed/comment-menu";
import {
  COMMENT_THREAD_PAGING_COPY,
  captureReadingPosition,
} from "@/components/feed/comment-thread";
import { COMMENT_THREAD_COPY } from "@/components/feed/helpers";
import { COPY } from "@/components/feed/copy";
import { cn } from "@/lib/utils";
import {
  fetchOlderCommentsAction,
  type OlderCommentItem,
} from "./older-comments";

/**
 * PAGINADOR DEL HILO del detalle: "ver comentarios anteriores" carga EN EL
 * LUGAR, sin recargar la página y sin mover el punto de lectura.
 *
 * Cliente 2026-08-20: "ahí nomás dentro de pantalla se tiene que fluir; si no es
 * como que te corta el mambo. Mientras menos pasos mejor". Hasta hoy cada tanda
 * costaba una navegación (`?antes=<cursor>`) que repintaba la ruta entera y te
 * devolvía arriba de todo — justo cuando venías siguiendo una conversación.
 *
 * ES UNA ISLA, NO UNA PANTALLA CLIENTE. La primera tanda la sigue renderizando
 * el server component y entra por `children` como los `<li>` ya armados: llega
 * en el HTML, el deep link y el SEO no cambian, y no se serializan 200
 * comentarios a props para volver a pintarlos en el browser. Este componente
 * sólo agrega las tandas SIGUIENTES arriba de esos hijos, dentro de la MISMA
 * `<ul>` (dos listas hermanas se le anuncian a un lector de pantalla como dos
 * listas distintas, y el hilo es uno solo).
 *
 * Lo que hace que esto funcione y no sea sólo "sin recarga" está en
 * `captureReadingPosition`: se mide la distancia al fondo ANTES de insertar y se
 * restaura DESPUÉS. Sin eso, meter 200 comentarios arriba te teletransporta
 * igual que la recarga — otro salto, el mismo mambo cortado.
 *
 * Nada de esto anima. Es deliberado: lo que entra queda ARRIBA del viewport
 * (por definición: son los anteriores) y animar altura u opacidad ahí sólo
 * puede pelearse con el ancla de scroll y producir el salto que venimos a
 * evitar. La única señal de que llegó algo es la que sirve — el botón que
 * cambia de estado y el aviso para lectores de pantalla.
 */

/**
 * `useLayoutEffect` avisa por consola si corre en el server, y esta isla se
 * renderiza en el server (esa es la gracia). Mismo patrón ya usado en
 * `app/global-error.tsx` y `components/theme/theme-color-sync.tsx`.
 *
 * Acá tiene que ser layout y no un `useEffect` a secas: `useEffect` corre
 * DESPUÉS del paint, así que el hilo se vería un frame corrido hacia abajo antes
 * de volver a su lugar.
 */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface ThreadPagerProps {
  postId: string;
  /** Quién está mirando. `null` = anónimo (nunca ofrece borrar). */
  viewerId: string | null;
  /** Quien publicó: puede borrar cualquier comentario de SU hilo (0097). */
  postAuthorId: string | null;
  /**
   * Cursor de la tanda anterior que dejó el servidor, o `null` si el hilo ya se
   * ve entero. Es lo mismo que decide si se ofrece el botón: nunca se muestra un
   * "ver anteriores" que no vaya a traer nada.
   */
  initialOlderCursor: string | null;
  /** ¿La primera tanda trajo algo? Decide si hay `<ul>` que abrir. */
  hasInitialComments: boolean;
  /**
   * El vacío honesto del hilo, si corresponde mostrarlo (lo decide el servidor:
   * una tanda vieja vacía no significa "nadie comentó todavía"). Entra acá y no
   * se queda en la página porque tiene que poder IRSE: si la primera tanda vino
   * entera de gente bloqueada, el hilo se ve vacío pero hay comentarios más
   * atrás — y al traerlos, "Sé la primera persona en responder" arriba de 200
   * respuestas sería la app contradiciéndose sola.
   */
  emptyState?: ReactNode;
  /** Los `<li>` de la primera tanda, renderizados en el SERVIDOR. */
  children: ReactNode;
}

export function ThreadPager({
  postId,
  viewerId,
  postAuthorId,
  initialOlderCursor,
  hasInitialComments,
  emptyState,
  children,
}: ThreadPagerProps) {
  const [olderItems, setOlderItems] = useState<OlderCommentItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialOlderCursor);
  const [hadError, setHadError] = useState(false);
  /** Ya se paginó al menos una vez: distingue "no hay más" de "todavía no probé". */
  const [pagedOnce, setPagedOnce] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [isPending, startTransition] = useTransition();

  /** Cómo devolver el hilo a su lugar después de insertar (ver docblock). */
  const restoreReadingPositionRef = useRef<(() => void) | null>(null);
  /** El botón se va a ir del DOM y el foco estaba puesto ahí: hay que recogerlo. */
  const focusThreadStartRef = useRef(false);
  const threadStartRef = useRef<HTMLParagraphElement>(null);

  const loadOlder = useCallback(() => {
    if (isPending || !cursor) return;
    startTransition(async () => {
      try {
        const result = await fetchOlderCommentsAction({ postId, cursor });
        if (!result.ok) {
          // La tanda no llegó: el hilo que YA está en pantalla no se toca —
          // sería castigar a quien sólo quiso leer más atrás. El botón vuelve a
          // quedar disponible dentro del bloque de error.
          setHadError(true);
          return;
        }

        // El keyset no repite ids entre tandas, pero esto es la red de
        // seguridad de la UI (mismo criterio que `mergeFeedItems` del feed): un
        // reintento a destiempo no puede pintar dos veces el mismo comentario.
        const known = new Set(olderItems.map((item) => item.id));
        const fresh = result.items.filter((item) => !known.has(item.id));

        if (fresh.length > 0) {
          // Se mide ACÁ, con la respuesta ya en la mano y el DOM todavía sin
          // tocar: si se midiera antes del pedido, cualquier scroll durante la
          // espera terminaría en un salto al restaurar. Y sólo cuando de verdad
          // vamos a insertar: una medición guardada que no se consume quedaría
          // esperando a la tanda siguiente, ya vencida.
          restoreReadingPositionRef.current = captureReadingPosition(null);
          setOlderItems((prev) => [...fresh, ...prev]);
        }
        setCursor(result.olderCursor);
        setPagedOnce(true);
        setHadError(false);
        setAnnouncement(
          fresh.length > 0
            ? COMMENT_THREAD_PAGING_COPY.addedAnnouncement(fresh.length)
            : COMMENT_THREAD_PAGING_COPY.noneAdded,
        );
      } catch {
        // "Failed to find Server Action" tras un deploy, conexión floja, o los
        // bloqueos del viewer que no se pudieron leer (fail-closed, lanza a
        // propósito). Nunca un error duro: se ofrece reintentar.
        setHadError(true);
      }
    });
  }, [isPending, cursor, postId, olderItems]);

  const onLoadOlderClick = useCallback(() => {
    // Si esta tanda resulta ser la última, el botón desaparece y con él el foco.
    focusThreadStartRef.current = true;
    loadOlder();
  }, [loadOlder]);

  useIsomorphicLayoutEffect(() => {
    const restore = restoreReadingPositionRef.current;
    if (!restore) return;
    restoreReadingPositionRef.current = null;
    restore();
  }, [olderItems]);

  /** Se terminó el hacia atrás. No es un vacío ni un error: es el principio. */
  const reachedStart = pagedOnce && !hadError && cursor === null;

  useEffect(() => {
    if (!reachedStart || !focusThreadStartRef.current) return;
    focusThreadStartRef.current = false;
    // `preventScroll` es la mitad del arreglo: mover el foco sin él haría que el
    // browser scrollee hasta acá, que es EXACTAMENTE el teletransporte que
    // `captureReadingPosition` acaba de evitar. El foco no se pierde (no cae al
    // <body>), pero tampoco arrastra la vista.
    threadStartRef.current?.focus({ preventScroll: true });
  }, [reachedStart]);

  const hasList = hasInitialComments || olderItems.length > 0;

  return (
    <>
      {/* Región viva SIEMPRE montada: si naciera junto con el texto, el lector
          de pantalla no llegaría a anunciarlo. Lo que entra queda arriba y fuera
          de la vista, así que sin esto no hay ninguna señal de que llegó. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {hadError ? (
        <div
          role="alert"
          className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-border-subtle bg-surface p-4 text-center"
        >
          <p className="text-sm font-semibold text-foreground">
            {COMMENT_THREAD_PAGING_COPY.errorTitle}
          </p>
          <p className="text-sm text-foreground-secondary">
            {COMMENT_THREAD_PAGING_COPY.errorBody}
          </p>
          <button
            type="button"
            onClick={onLoadOlderClick}
            disabled={isPending}
            aria-busy={isPending}
            className={cn(
              buttonVariants({ variant: "secondary", size: "sm" }),
              "min-h-11",
            )}
          >
            {isPending && <Spinner size={16} />}
            {COPY.comments.retry}
          </button>
        </div>
      ) : cursor ? (
        /* Tanda ANTERIOR. Va arriba del hilo porque hacia arriba es hacia el
           pasado: el orden de lectura es ascendente. */
        <div className="mt-4">
          <button
            type="button"
            onClick={onLoadOlderClick}
            disabled={isPending}
            aria-busy={isPending}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "min-h-11 w-full",
            )}
          >
            {isPending ? (
              <Spinner size={16} />
            ) : (
              <CaretUp size={16} aria-hidden="true" />
            )}
            {isPending
              ? COMMENT_THREAD_PAGING_COPY.loadingOlder
              : COMMENT_THREAD_COPY.older}
          </button>
        </div>
      ) : reachedStart ? (
        <p
          ref={threadStartRef}
          tabIndex={-1}
          className="mt-4 text-center text-sm text-foreground-muted focus:outline-none focus-visible:rounded-md focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          {COMMENT_THREAD_PAGING_COPY.threadStart}
        </p>
      ) : null}

      {!hasList && emptyState}

      {hasList && (
        <ul className="mt-4 flex flex-col gap-4">
          {olderItems.map((item) => {
            // Acá sólo se decide qué OFRECER: el permiso lo tiene la policy
            // `comments_delete` y la action del borrado lee cuántas filas
            // volvieron.
            const isOwnComment = Boolean(viewerId && item.authorId === viewerId);
            const canDelete =
              Boolean(viewerId) && (isOwnComment || postAuthorId === viewerId);
            return (
              <CommentItem
                key={item.id}
                author={item.author}
                body={item.body}
                timeAgoLabel={item.timeAgoLabel}
                menu={
                  canDelete ? (
                    <CommentMenu
                      commentId={item.id}
                      authorName={item.author.displayName}
                      isOwnComment={isOwnComment}
                      // Sale de la lista en memoria y el hilo se queda donde
                      // estaba. Recargar devolvería a la persona al final del
                      // hilo, que es justo lo que vinimos a evitar.
                      onDeleted={() =>
                        setOlderItems((prev) =>
                          prev.filter((other) => other.id !== item.id),
                        )
                      }
                    />
                  ) : undefined
                }
              />
            );
          })}
          {children}
        </ul>
      )}
    </>
  );
}
