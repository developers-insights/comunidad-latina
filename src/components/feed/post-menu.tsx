"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowSquareOut,
  ChatCircle,
  ChatCircleSlash,
  DotsThree,
  Eye,
  EyeSlash,
  Megaphone,
  PencilSimple,
  PushPin,
  PushPinSlash,
  Trash,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import {
  toggleCommentsLockedAction,
  toggleHidePostAction,
  togglePinPostAction,
  type PostMenuResult,
} from "@/app/(app)/feed/post-menu-actions";
import { AUTH_REASON, useRequireAuth } from "@/components/auth/auth-sheet";
import { BottomSheet, useToast } from "@/components/ui";
import { ReportScamButton, ReportSheet } from "@/components/trust";
import { POST_EDIT_COPY } from "@/lib/social/post-editing";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import type { PostMusicView } from "./helpers";
import { PostDeleteDialog } from "./post-delete-dialog";
import { PostEditSheet } from "./post-edit-sheet";

/**
 * Copy local de "Promocionar" (feedback cliente Geovanny, 2026-08-05).
 * TODO(integración): mover a feed/copy.ts — ese archivo lo está editando
 * otro agente en simultáneo, se declara acá para no pisarle el merge.
 */
const PROMOTE_LABEL = "Promocionar";

/** Fila del menú. Un solo lugar que define alto tocable, foco y ritmo. */
const MENU_ROW = [
  "flex min-h-11 w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-medium",
  "transition-colors duration-(--duration-fast) hover:bg-surface-subtle",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
  // Mientras una acción viaja, TODAS las filas se apagan: dos toggles a la vez
  // sobre la misma publicación es la forma más fácil de terminar con la pantalla
  // diciendo una cosa y la base otra.
  "disabled:pointer-events-none disabled:opacity-50",
];

export interface PostMenuProps {
  postId: string;
  /** null si la cuenta del autor ya no existe — no hay a quién reportar. */
  authorId: string | null;
  /** null si el viewer es anónimo — reportar pide cuenta. */
  viewerId: string | null;
  /**
   * Texto actual de la publicación. SIN ESTO NO SE OFRECE "Editar": la hoja
   * necesita el punto de partida del campo, y abrirla con el texto vacío
   * borraría el pie de la publicación de quien sólo quería mirarla.
   */
  postBody?: string;
  /** `published` | `pending_review` | `removed`. Sólo se edita lo publicado. */
  postStatus?: string;
  /** ¿Tiene foto o video? Decide si el texto puede quedar vacío al editar. */
  hasMedia?: boolean;
  /**
   * Las rutas de `posts.media` tal cual están guardadas. Sin esto la hoja de
   * edición no ofrece quitar fotos: no puede nombrar lo que no conoce.
   */
  media?: readonly string[];
  /**
   * La pista que tiene la publicación (`post_music`, 0090), o null si no tiene.
   * Sin esto la hoja de edición NO ofrece música: no se puede ofrecer cambiar
   * algo cuyo valor actual se desconoce. `null` sí se ofrece — significa
   * "sabemos que no tiene".
   */
  music?: PostMusicView | null;
  /** Se nombran en la confirmación de borrado: es lo que se pierde. */
  commentCount?: number;
  likeCount?: number;
  /** Marcas de la 0097. `null` (o ausente) = la acción está apagada. */
  pinnedAt?: string | null;
  hiddenAt?: string | null;
  commentsLockedAt?: string | null;
  /**
   * Adónde ir después de eliminar. En el detalle hay que salir —la página deja
   * de existir—; en el feed alcanza con refrescar.
   */
  redirectAfterDelete?: string;
}

/**
 * Menú ⋯ de una publicación. Reúne lo que se puede hacer CON ella:
 *
 *  · Sólo el autor: Promocionar, Fijar, Editar, Ocultar del feed, Desactivar
 *    comentarios y Eliminar.
 *  · Cualquiera: Abrir en otra pestaña y Reportar (abre el ReportSheet
 *    unificado, 2 taps — el reporte viaja contra el PERFIL del autor, vía la
 *    RPC report_scam).
 *
 * "Guardar" NO está acá y es a propósito: ya vive como marcador en la fila de
 * acciones de la tarjeta (`post-actions.tsx`), con su propio estado optimista.
 * Espejarlo en el menú daría dos controles con el mismo nombre y dos estados que
 * se pueden desincronizar — el cliente ya lo dio por hecho y funciona.
 *
 * Que un ítem no se muestre NO es la seguridad: la autorización real la deciden
 * las server actions en el servidor (relectura del post + comparación de autor y
 * comunidad contra el JWT), las funciones de la 0097 y la RLS. Acá sólo se evita
 * ofrecer algo que va a rebotar.
 *
 * ORDEN DE LAS FILAS: primero lo que cambia la publicación (promocionar, fijar,
 * editar), después lo que cambia su alcance (ocultar, comentarios), después lo
 * neutro (abrir en otra pestaña, reportar) y al final, separada por una línea y
 * en color danger, la única irreversible. Eliminar no puede quedar pegada a las
 * demás, donde se toca por inercia.
 *
 * SIN DIÁLOGO DE CONFIRMACIÓN salvo para eliminar. Fijar, ocultar y cerrar
 * comentarios se deshacen con el mismo toque que las hizo, así que un "¿estás
 * seguro?" sería fricción sobre algo que no lastima. Lo que sí hacen es AVISAR
 * qué pasó y qué NO pasó ("sigue siendo tuya", "los comentarios que ya están
 * siguen a la vista"): el miedo real acá es haber borrado algo sin querer.
 */
export function PostMenu({
  postId,
  authorId,
  viewerId,
  postBody,
  postStatus = "published",
  hasMedia = false,
  media,
  music,
  commentCount = 0,
  likeCount = 0,
  pinnedAt = null,
  hiddenAt = null,
  commentsLockedAt = null,
  redirectAfterDelete,
}: PostMenuProps) {
  const router = useRouter();
  const requireAuth = useRequireAuth();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  /**
   * Estado local de los tres toggles, sembrado de los props. Existe para que el
   * rótulo cambie EN EL ACTO ("Fijar" → "Dejar de fijar") sin esperar a que el
   * server component se vuelva a renderizar: sin esto, tocar "Fijar" deja la
   * fila diciendo "Fijar" un segundo largo y la gente la toca de nuevo.
   *
   * Se escribe SÓLO después de que el servidor confirmó — no es optimismo, es
   * eco. Y sólo su autor puede cambiar estas marcas, así que no hay un tercero
   * que pueda dejarlo viejo.
   */
  const [pinned, setPinned] = useState(Boolean(pinnedAt));
  const [hidden, setHidden] = useState(Boolean(hiddenAt));
  const [commentsLocked, setCommentsLocked] = useState(Boolean(commentsLockedAt));

  // Sólo el dueño del post ve las acciones de autor — el resto ni sabe que existen.
  const isOwnPost = Boolean(viewerId && authorId && viewerId === authorId);

  /**
   * "Editar" aparece sólo sobre una publicación PUBLICADA. Una en revisión o
   * retirada no se edita —editar no puede ser la puerta de atrás de la cola de
   * moderación— y ofrecerlo para después rechazarlo sería peor que no
   * ofrecerlo: el detalle ya muestra el banner que explica el estado.
   */
  const canEdit = isOwnPost && postBody !== undefined && postStatus === "published";
  /** Las tres marcas de la 0097 comparten exactamente la misma condición. */
  const canManage = isOwnPost && postStatus === "published";

  function openReport() {
    setMenuOpen(false);
    /**
     * Cinturón. La fila "Reportar" ya no se dibuja sin `authorId` (ver más
     * abajo), así que esto no debería alcanzarse; queda por si alguien vuelve a
     * montar el control sin la condición. Lo que NO puede volver a pasar es lo
     * de antes: un `return` mudo DESPUÉS del formulario de entrada, o sea
     * hacerle a alguien pagar un login entero para que la pantalla no se mueva
     * (revisión 2026-08-20).
     */
    if (!authorId) return;
    if (!viewerId) {
      // Antes: un toast y un `push` a /entrar con `next=/feed/[postId]`, o sea
      // salir del feed para aterrizar en el detalle. Ahora la puerta se abre
      // acá mismo y al entrar se abre la hoja de reporte que la persona pidió
      // (feedback cliente 2026-08-20). El toast sobra: el título de la hoja ya
      // dice para qué hay que entrar, y decirlo dos veces es un paso más.
      requireAuth({
        reason: AUTH_REASON.report,
        // Parada en `/feed/[id]` la persona abrió un enlace compartido: el
        // destino de respaldo es esa misma URL. Ver `resumeDestination`.
        foldPostDetail: false,
        onAuthenticated: () => {
          // Sin `viewerId` a propósito: en el closure de antes de entrar sigue
          // siendo null y volvería a abrir la hoja en bucle. La sesión ya está.
          setReportOpen(true);
        },
      });
      return;
    }
    setReportOpen(true);
  }

  /**
   * Corre una acción del menú y cuenta qué pasó. Un solo camino para las tres:
   * cierra la hoja, espera al servidor, y recién con el `ok` mueve el estado
   * local y avisa. Si falla, el mensaje que se muestra es EL DEL SERVIDOR (ya
   * viene resuelto y en español) y nada cambia en pantalla.
   */
  function run(
    action: () => Promise<PostMenuResult>,
    onDone: () => void,
    success: { title: string; description: string },
  ) {
    if (isPending) return;
    setMenuOpen(false);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast({
          title: COPY.postMenu.errorTitle,
          description: result.message,
          variant: "danger",
        });
        return;
      }
      onDone();
      toast({ ...success, variant: "success" });
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label={COPY.post.menuLabel}
        aria-haspopup="dialog"
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-md text-foreground-secondary",
          "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
          "hover:bg-surface-subtle active:scale-[0.94]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <DotsThree size={22} weight="bold" aria-hidden="true" />
      </button>

      <BottomSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        ariaLabel={COPY.post.menuLabel}
      >
        <div className="flex flex-col pb-4">
          {isOwnPost && (
            <Link
              href={`/impulsar-post/${postId}`}
              onClick={() => setMenuOpen(false)}
              className={cn(MENU_ROW, "text-sponsored-ink")}
            >
              <Megaphone size={18} weight="fill" aria-hidden="true" className="shrink-0" />
              {PROMOTE_LABEL}
            </Link>
          )}

          {canManage && (
            <MenuButton
              icon={pinned ? PushPinSlash : PushPin}
              label={pinned ? COPY.postMenu.unpin : COPY.postMenu.pin}
              disabled={isPending}
              onClick={() =>
                run(
                  () => togglePinPostAction({ postId, pin: !pinned }),
                  () => setPinned(!pinned),
                  pinned
                    ? {
                        title: COPY.postMenu.unpinnedTitle,
                        description: COPY.postMenu.unpinnedBody,
                      }
                    : {
                        title: COPY.postMenu.pinnedTitle,
                        description: COPY.postMenu.pinnedBody,
                      },
                )
              }
            />
          )}

          {canEdit && (
            <MenuButton
              icon={PencilSimple}
              label={POST_EDIT_COPY.menu.edit}
              disabled={isPending}
              onClick={() => {
                setMenuOpen(false);
                setEditOpen(true);
              }}
            />
          )}

          {canManage && (
            <MenuButton
              icon={hidden ? Eye : EyeSlash}
              label={hidden ? COPY.postMenu.unhide : COPY.postMenu.hide}
              disabled={isPending}
              onClick={() =>
                run(
                  () => toggleHidePostAction({ postId, hide: !hidden }),
                  () => {
                    setHidden(!hidden);
                    // Ocultar desfija en la MISMA sentencia del servidor: el
                    // rótulo de arriba tiene que enterarse o va a ofrecer
                    // "Dejar de fijar" sobre algo que ya no está fijado.
                    if (!hidden) setPinned(false);
                  },
                  hidden
                    ? {
                        title: COPY.postMenu.shownTitle,
                        description: COPY.postMenu.shownBody,
                      }
                    : {
                        title: COPY.postMenu.hiddenTitle,
                        description: COPY.postMenu.hiddenBody,
                      },
                )
              }
            />
          )}

          {canManage && (
            <MenuButton
              icon={commentsLocked ? ChatCircle : ChatCircleSlash}
              label={
                commentsLocked
                  ? COPY.postMenu.unlockComments
                  : COPY.postMenu.lockComments
              }
              disabled={isPending}
              onClick={() =>
                run(
                  () =>
                    toggleCommentsLockedAction({ postId, lock: !commentsLocked }),
                  () => setCommentsLocked(!commentsLocked),
                  commentsLocked
                    ? {
                        title: COPY.postMenu.commentsUnlockedTitle,
                        description: COPY.postMenu.commentsUnlockedBody,
                      }
                    : {
                        title: COPY.postMenu.commentsLockedTitle,
                        description: COPY.postMenu.commentsLockedBody,
                      },
                )
              }
            />
          )}

          {/*
            Abrir en otra pestaña. Es un ancla de verdad y no un window.open():
            así funciona el clic del medio, el "abrir en una ventana nueva" del
            menú contextual y el copiar-enlace, y sobre todo NO lo come el
            bloqueador de pop-ups (window.open fuera de un gesto directo del
            usuario es exactamente lo que esos bloqueadores frenan).
            `rel="noopener noreferrer"` va aunque el destino sea propio: es el
            default sano y no cuesta nada.
          */}
          <a
            href={`/feed/${postId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuOpen(false)}
            className={cn(MENU_ROW, "text-foreground")}
          >
            <ArrowSquareOut size={18} aria-hidden="true" className="shrink-0" />
            {COPY.postMenu.openInNewTab}
          </a>

          {/* SIN AUTOR NO SE OFRECE REPORTAR (revisión 2026-08-20). El reporte
              viaja contra el PERFIL del autor; si la cuenta ya no existe no hay
              a quién reportar. Antes la fila estaba igual y el camino terminaba
              en un `return` mudo — para quien no tenía sesión, después de haber
              pasado por el formulario de entrada COMPLETO. Un toast avisando
              sería un paso más y un callejón igual: mejor no abrir la puerta que
              disculparse al final del pasillo. */}
          {authorId && <ReportScamButton variant="menu-item" onReport={openReport} />}

          {isOwnPost && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setMenuOpen(false);
                setDeleteOpen(true);
              }}
              className={cn(MENU_ROW, "mt-1 border-t border-border pt-4 text-danger")}
            >
              <Trash size={18} aria-hidden="true" className="shrink-0" />
              {POST_EDIT_COPY.menu.delete}
            </button>
          )}
        </div>
      </BottomSheet>

      {canEdit && postBody !== undefined && (
        <PostEditSheet
          open={editOpen}
          onClose={() => setEditOpen(false)}
          postId={postId}
          initialBody={postBody}
          hasMedia={hasMedia}
          media={media}
          music={music}
        />
      )}

      {isOwnPost && (
        <PostDeleteDialog
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          postId={postId}
          commentCount={commentCount}
          likeCount={likeCount}
          redirectTo={redirectAfterDelete}
        />
      )}

      {authorId && (
        <ReportSheet
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          targetKind="profile"
          targetId={authorId}
          contextLabel={`Publicación /feed/${postId}`}
        />
      )}
    </>
  );
}

/** Fila-botón del menú. Existe para que ícono, alto y foco no se repitan seis veces. */
function MenuButton({
  icon: MenuIcon,
  label,
  onClick,
  disabled,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(MENU_ROW, "text-foreground")}
    >
      <MenuIcon size={18} aria-hidden="true" className="shrink-0" />
      {label}
    </button>
  );
}
