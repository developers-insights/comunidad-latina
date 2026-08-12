"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletePostAction } from "@/app/(app)/feed/post-edit-actions";
import { Button, Dialog, useToast } from "@/components/ui";
import { POST_EDIT_COPY } from "@/lib/social/post-editing";

export interface PostDeleteDialogProps {
  open: boolean;
  onClose: () => void;
  postId: string;
  /** Comentarios que tiene la publicación — se nombran antes de borrarlos. */
  commentCount?: number;
  /** Me gusta que tiene la publicación. */
  likeCount?: number;
  /**
   * Adónde ir después de borrar. En el detalle de la publicación hay que
   * salir (la página que se está mirando deja de existir); en el feed no,
   * alcanza con refrescar la lista.
   */
  redirectTo?: string;
}

/**
 * Confirmación de borrado. Es un `alertdialog` (`highRisk`) con foco atrapado y
 * Escape, y entra más lento a propósito — la lentitud comunica "esto es
 * importante" (§5.3 del sistema de diseño).
 *
 * El cuerpo NO dice "¿estás seguro?". Enumera lo que se pierde, empezando por
 * lo que es de otras personas: los comentarios que le dejaron. Alguien que
 * borra una publicación con veinte respuestas casi nunca sabe que se las lleva
 * puestas, y "¿estás seguro?" no se lo cuenta.
 *
 * La acción destructiva va a la derecha y en `danger`; la salida ("No, dejarla")
 * queda separada y es la que recibe el foco por costumbre del componente.
 */
export function PostDeleteDialog({
  open,
  onClose,
  postId,
  commentCount = 0,
  likeCount = 0,
  redirectTo,
}: PostDeleteDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const errorId = useId();

  function confirm() {
    if (isPending) return;
    setErrorMessage(null);

    startTransition(async () => {
      // `confirmed: true` viaja explícito: la action rechaza cualquier llamada
      // que no lo traiga, así un handler mal cableado no puede borrar sin que
      // este diálogo se haya abierto.
      const result = await deletePostAction({ postId, confirmed: true });
      if (!result.ok) {
        setErrorMessage(result.message);
        return;
      }
      toast({
        title: POST_EDIT_COPY.delete.successTitle,
        description: POST_EDIT_COPY.delete.successBody,
        variant: "success",
      });
      onClose();
      if (redirectTo) {
        router.replace(redirectTo);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <Dialog
      open={open}
      onClose={isPending ? () => {} : onClose}
      highRisk
      title={POST_EDIT_COPY.delete.dialogTitle}
      description={POST_EDIT_COPY.delete.dialogBody({
        comments: commentCount,
        likes: likeCount,
      })}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
            className="sm:min-w-32"
          >
            {POST_EDIT_COPY.delete.cancel}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={confirm}
            loading={isPending}
            aria-describedby={errorMessage ? errorId : undefined}
            className="sm:min-w-36"
          >
            {isPending ? POST_EDIT_COPY.delete.confirming : POST_EDIT_COPY.delete.confirm}
          </Button>
        </>
      }
    >
      {errorMessage && (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {errorMessage}
        </p>
      )}
    </Dialog>
  );
}
