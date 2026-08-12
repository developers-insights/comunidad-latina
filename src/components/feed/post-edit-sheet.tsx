"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagesSquare } from "@phosphor-icons/react/dist/ssr";
import { editPostAction } from "@/app/(app)/feed/post-edit-actions";
import { BottomSheet, Button, Textarea, useToast } from "@/components/ui";
import {
  POST_BODY_MAX,
  POST_EDIT_COPY,
  bodyIsPublishable,
} from "@/lib/social/post-editing";

export interface PostEditSheetProps {
  open: boolean;
  onClose: () => void;
  postId: string;
  /** Texto actual de la publicación — el punto de partida del campo. */
  initialBody: string;
  /** ¿La publicación tiene foto o video? Cambia si el texto puede quedar vacío. */
  hasMedia: boolean;
}

/**
 * Hoja para editar el TEXTO de una publicación propia.
 *
 * Lo que esta hoja NO tiene, a propósito: ningún control para cambiar las fotos
 * o el video. No es un olvido y por eso se dice en pantalla (`mediaLocked`) en
 * vez de dejar que alguien lo busque: cada archivo tiene su huella registrada
 * con la fecha en que se subió por primera vez, y esa fila es la evidencia que
 * defiende a quien publicó primero. El razonamiento completo está en
 * `lib/social/post-editing.ts`.
 *
 * La otra decisión visible: se avisa ANTES de guardar que la publicación va a
 * quedar marcada como editada. Enterarse después es enterarse tarde.
 */
export function PostEditSheet({
  open,
  onClose,
  postId,
  initialBody,
  hasMedia,
}: PostEditSheetProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={POST_EDIT_COPY.edit.sheetTitle}
      keyboardAware
    >
      {/* El BottomSheet desmonta a sus hijos al cerrar: el cuerpo monta fresco
          en cada apertura y nunca arrastra el borrador de la vez anterior. El
          key cubre el caso borde de cambiar de post con la hoja abierta. */}
      <PostEditSheetBody
        key={postId}
        onClose={onClose}
        postId={postId}
        initialBody={initialBody}
        hasMedia={hasMedia}
      />
    </BottomSheet>
  );
}

function PostEditSheetBody({
  onClose,
  postId,
  initialBody,
  hasMedia,
}: Omit<PostEditSheetProps, "open">) {
  const router = useRouter();
  const { toast } = useToast();
  const [body, setBody] = useState(initialBody);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();

  const trimmed = body.trim();
  const changed = trimmed !== initialBody.trim();
  const publishable = bodyIsPublishable(trimmed, hasMedia);
  // El botón se apaga cuando no hay nada que guardar. El motivo se dice al lado
  // (no se deja un control muerto sin explicación — §8 formularios).
  const canSave = changed && publishable;

  function submit() {
    if (isPending || !canSave) return;
    setErrorMessage(null);

    startTransition(async () => {
      const result = await editPostAction({ postId, body: trimmed });
      if (!result.ok) {
        setErrorMessage(result.message);
        return;
      }
      // Se avisa distinto según lo que HAYA PASADO: "quedó actualizada" sería
      // mentira si la moderación mandó el texto nuevo a revisión y la
      // publicación ya no se ve en el feed.
      toast(
        result.status === "pending_review"
          ? {
              title: POST_EDIT_COPY.edit.reviewTitle,
              description: POST_EDIT_COPY.edit.reviewBody,
              variant: "info",
            }
          : {
              title: POST_EDIT_COPY.edit.successTitle,
              description: POST_EDIT_COPY.edit.successBody,
              variant: "success",
            },
      );
      router.refresh();
      onClose();
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4 pb-2"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-sm font-medium text-foreground-secondary">
          {POST_EDIT_COPY.edit.bodyLabel}
        </label>
        <Textarea
          id={fieldId}
          rows={5}
          maxLength={POST_BODY_MAX}
          placeholder={POST_EDIT_COPY.edit.bodyPlaceholder}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          aria-describedby={[hintId, errorMessage ? errorId : null]
            .filter(Boolean)
            .join(" ")}
          aria-invalid={errorMessage ? true : undefined}
          autoFocus
        />
        {/* Contador con cifras tabulares: sin eso el número "baila" al tipear. */}
        <p id={hintId} className="numeric self-end text-xs text-foreground-muted">
          {POST_EDIT_COPY.edit.counter(trimmed.length)}
        </p>
      </div>

      {hasMedia && (
        <p className="flex items-start gap-2 rounded-md bg-surface-subtle px-3 py-2.5 text-xs text-foreground-secondary">
          <ImagesSquare size={16} aria-hidden="true" className="mt-px shrink-0" />
          {POST_EDIT_COPY.edit.mediaLocked}
        </p>
      )}

      <p className="text-xs text-foreground-muted">
        {POST_EDIT_COPY.edit.visibleNotice}
      </p>

      {errorMessage && (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {errorMessage}
        </p>
      )}

      {/* Sin cambios y sin error: se dice por qué Guardar está apagado. */}
      {!changed && !errorMessage && (
        <p className="text-xs text-foreground-muted">{POST_EDIT_COPY.edit.noChanges}</p>
      )}
      {changed && !publishable && !errorMessage && (
        <p className="text-xs text-foreground-muted">{POST_EDIT_COPY.edit.emptyBody}</p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={isPending}
          className="sm:min-w-28"
        >
          {POST_EDIT_COPY.edit.cancel}
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={isPending}
          disabled={!canSave}
          className="sm:min-w-40"
        >
          {isPending ? POST_EDIT_COPY.edit.saving : POST_EDIT_COPY.edit.save}
        </Button>
      </div>
    </form>
  );
}
