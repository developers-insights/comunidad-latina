"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DotsThree,
  Megaphone,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, useToast } from "@/components/ui";
import { ReportScamButton, ReportSheet } from "@/components/trust";
import { POST_EDIT_COPY } from "@/lib/social/post-editing";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
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
  /** Se nombran en la confirmación de borrado: es lo que se pierde. */
  commentCount?: number;
  likeCount?: number;
  /**
   * Adónde ir después de eliminar. En el detalle hay que salir —la página deja
   * de existir—; en el feed alcanza con refrescar.
   */
  redirectAfterDelete?: string;
}

/**
 * Menú ⋯ de una publicación. Reúne lo que se puede hacer CON ella:
 *
 *  · Sólo el autor: Promocionar, Editar y Eliminar.
 *  · Cualquiera con cuenta: Reportar (abre el ReportSheet unificado, 2 taps —
 *    el reporte viaja contra el PERFIL del autor, vía la RPC report_scam).
 *
 * Que un ítem no se muestre NO es la seguridad: la autorización real la
 * deciden `editPostAction` / `deletePostAction` en el servidor, comparando
 * autor y comunidad contra el JWT. Acá sólo se evita ofrecer algo que va a
 * rebotar.
 *
 * Eliminar va último y separado por una línea (acción destructiva: no puede
 * quedar pegada a las demás, donde se toca por inercia) y en color danger.
 */
export function PostMenu({
  postId,
  authorId,
  viewerId,
  postBody,
  postStatus = "published",
  hasMedia = false,
  commentCount = 0,
  likeCount = 0,
  redirectAfterDelete,
}: PostMenuProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Sólo el dueño del post ve "Promocionar" — el resto ni sabe que existe.
  const isOwnPost = Boolean(viewerId && authorId && viewerId === authorId);

  /**
   * "Editar" aparece sólo sobre una publicación PUBLICADA. Una en revisión o
   * retirada no se edita —editar no puede ser la puerta de atrás de la cola de
   * moderación— y ofrecerlo para después rechazarlo sería peor que no
   * ofrecerlo: el detalle ya muestra el banner que explica el estado.
   */
  const canEdit = isOwnPost && postBody !== undefined && postStatus === "published";

  function openReport() {
    setMenuOpen(false);
    if (!viewerId) {
      toast({ title: COPY.report.needsAuth, variant: "info" });
      router.push(`/entrar?next=${encodeURIComponent(`/feed/${postId}`)}`);
      return;
    }
    // Autor eliminado: no hay perfil contra el cual reportar (caso borde).
    if (!authorId) return;
    setReportOpen(true);
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

          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setEditOpen(true);
              }}
              className={cn(MENU_ROW, "text-foreground")}
            >
              <PencilSimple size={18} aria-hidden="true" className="shrink-0" />
              {POST_EDIT_COPY.menu.edit}
            </button>
          )}

          <ReportScamButton variant="menu-item" onReport={openReport} />

          {isOwnPost && (
            <button
              type="button"
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
