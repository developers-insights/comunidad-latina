"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DotsThree, Trash } from "@phosphor-icons/react/dist/ssr";
import { deleteCommentAction } from "@/app/(app)/feed/post-menu-actions";
import { BottomSheet, Button, Dialog, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

export interface CommentMenuProps {
  commentId: string;
  /** Quién lo escribió — se nombra en la confirmación cuando no es tuyo. */
  authorName: string;
  /** ¿Lo escribió el viewer? Cambia el texto del diálogo, no el permiso. */
  isOwnComment: boolean;
  /**
   * Qué hacer cuando el comentario ya no está. La hoja del feed lo saca de su
   * lista en memoria; el detalle SSR no pasa nada y se refresca la ruta.
   */
  onDeleted?: () => void;
  /** Sobre vidrio (hoja de comentarios encima de un video/foto) la tinta cambia. */
  tone?: "surface" | "media";
}

/**
 * Menú de un comentario. Hoy tiene una sola opción —eliminar— y aun así es un
 * menú y no una cruz suelta al lado del texto: una acción irreversible a un
 * toque de distancia de un hilo que se scrollea con el pulgar se dispara sola.
 *
 * QUIÉN LO VE lo decide quien lo monta, y son dos personas: quien escribió el
 * comentario y quien publicó la publicación. La segunda no es un exceso — hasta
 * la 0097, su única salida frente a un comentario que no quería en su
 * publicación era eliminar la publicación entera, llevándose puestos los
 * comentarios de todas las demás personas.
 *
 * Y NO ES ACÁ DONDE SE DECIDE: la policy `comments_delete` (0007 + 0097) es la
 * que autoriza, y la server action lee cuántas filas volvieron. Si este menú se
 * mostrara de más, el servidor devuelve el rechazo y se muestra tal cual.
 */
export function CommentMenu({
  commentId,
  authorName,
  isOwnComment,
  onDeleted,
  tone = "surface",
}: CommentMenuProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const onMedia = tone === "media";

  function confirmDelete() {
    if (isPending) return;
    setErrorMessage(null);

    startTransition(async () => {
      // `confirmed: true` explícito: la action rechaza cualquier llamada que no
      // lo traiga, así un handler mal cableado no puede borrar sin diálogo.
      const result = await deleteCommentAction({ commentId, confirmed: true });
      if (!result.ok) {
        setErrorMessage(result.message);
        return;
      }
      setConfirmOpen(false);
      toast({
        title: COPY.commentMenu.successTitle,
        description: COPY.commentMenu.successBody,
        variant: "success",
      });
      // La hoja del feed saca la fila en memoria; el detalle SSR necesita que la
      // ruta se vuelva a pintar. Se hacen las dos: la que no aplica es un no-op.
      onDeleted?.();
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label={COPY.commentMenu.menuLabel}
        aria-haspopup="dialog"
        className={cn(
          // 44px de área tocable con 24px de caja visual: el botón no puede
          // empujar la burbuja del comentario, pero tampoco puede ser un blanco
          // de 24px (WCAG 2.5.8).
          "-my-2.5 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-md",
          "transition-colors duration-(--duration-fast)",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          onMedia
            ? "text-on-media/80 hover:bg-on-media/10"
            : "text-foreground-muted hover:bg-surface-subtle",
        )}
      >
        <DotsThree size={18} weight="bold" aria-hidden="true" />
      </button>

      <BottomSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        ariaLabel={COPY.commentMenu.menuLabel}
      >
        <div className="flex flex-col pb-4">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setErrorMessage(null);
              setConfirmOpen(true);
            }}
            className={cn(
              "flex min-h-11 w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-medium",
              "text-danger transition-colors duration-(--duration-fast) hover:bg-surface-subtle",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
            )}
          >
            <Trash size={18} aria-hidden="true" className="shrink-0" />
            {COPY.commentMenu.delete}
          </button>
        </div>
      </BottomSheet>

      <Dialog
        open={confirmOpen}
        onClose={isPending ? () => {} : () => setConfirmOpen(false)}
        highRisk
        title={COPY.commentMenu.dialogTitle}
        description={
          isOwnComment
            ? COPY.commentMenu.dialogBodyOwn
            : COPY.commentMenu.dialogBodyOther(authorName)
        }
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={isPending}
              className="sm:min-w-32"
            >
              {COPY.commentMenu.cancel}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={confirmDelete}
              loading={isPending}
              className="sm:min-w-36"
            >
              {isPending ? COPY.commentMenu.confirming : COPY.commentMenu.confirm}
            </Button>
          </>
        }
      >
        {errorMessage && (
          <p role="alert" className="text-sm font-medium text-danger">
            {errorMessage}
          </p>
        )}
      </Dialog>
    </>
  );
}
