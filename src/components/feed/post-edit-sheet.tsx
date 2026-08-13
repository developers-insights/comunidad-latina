"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagesSquare, Trash } from "@phosphor-icons/react/dist/ssr";
import {
  editPostAction,
  removePostPhotoAction,
} from "@/app/(app)/feed/post-edit-actions";
import { BottomSheet, Button, Dialog, Textarea, useToast } from "@/components/ui";
import {
  POST_BODY_MAX,
  POST_EDIT_COPY,
  bodyIsPublishable,
} from "@/lib/social/post-editing";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { mediaKindOf, postMediaUrl } from "./helpers";

export interface PostEditSheetProps {
  open: boolean;
  onClose: () => void;
  postId: string;
  /** Texto actual de la publicación — el punto de partida del campo. */
  initialBody: string;
  /** ¿La publicación tiene foto o video? Cambia si el texto puede quedar vacío. */
  hasMedia: boolean;
  /**
   * Las rutas de `posts.media`, tal cual están guardadas. Se mandan CRUDAS y no
   * como URLs porque es la ruta lo que viaja de vuelta al servidor para quitar
   * una foto: si acá se mandara la URL pública habría que deshacerla del otro
   * lado, y ese ida y vuelta es donde se cuelan los bugs de rutas con acentos o
   * con query string. Ausente → la hoja no ofrece quitar nada.
   */
  media?: readonly string[];
}

/**
 * Hoja para editar una publicación propia: el texto, y —desde la 0097— quitar
 * alguna de sus fotos.
 *
 * LO QUE ESTA HOJA SIGUE SIN TENER, a propósito: no se puede CAMBIAR una foto
 * por otra ni sumar archivos nuevos. La diferencia con quitar no es de grado:
 * un archivo nuevo necesita el pipeline completo de integridad (subida, huella,
 * escaneo de similitud, declaración de licencia, moderación de imagen), que es
 * exactamente lo que hace publicar de nuevo. Quitar no trae nada nuevo, así que
 * no hay pipeline que rehacer y la fila de procedencia del archivo que sale
 * sigue siendo verdadera — sólo se le anota cuándo dejó de mostrarse.
 *
 * Tampoco se puede quitar el VIDEO ni la ÚNICA foto: en el primer caso quedarían
 * colgadas las columnas que lo describen (y la publicación seguiría existiendo
 * para el scroll de Videos Cortos, sin video); en el segundo, la publicación
 * quedaría vacía. Las dos cosas se DICEN en pantalla en vez de esconder el
 * botón sin explicación.
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
  media,
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
        media={media}
      />
    </BottomSheet>
  );
}

function PostEditSheetBody({
  onClose,
  postId,
  initialBody,
  hasMedia,
  media,
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
        <MediaStrip postId={postId} media={media ?? []} disabled={isPending} />
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

// ---------------------------------------------------------------------------
// Tira de medios: mirar lo que hay y, si corresponde, quitar una foto (0097)
// ---------------------------------------------------------------------------

/**
 * Los archivos de la publicación, a la vista, con un botón para quitar cada
 * FOTO que se pueda quitar.
 *
 * POR QUÉ SE MUESTRAN TAMBIÉN LOS QUE NO SE PUEDEN QUITAR (el video, o la única
 * foto): porque la pregunta que trae a alguien acá es "¿puedo sacar esa foto?", y
 * una tira que muestre sólo las quitables no responde esa pregunta — deja a la
 * persona buscando la foto que no aparece. Se muestran todas y se dice, en una
 * línea, por qué esa no tiene botón.
 *
 * `media` puede llegar vacío (la superficie que montó la hoja todavía no manda
 * las rutas): en ese caso no se inventa una tira, se muestra el aviso de siempre
 * de que los archivos quedan como están.
 */
function MediaStrip({
  postId,
  media,
  disabled,
}: {
  postId: string;
  media: readonly string[];
  disabled: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  /** Lo que quedó, ya sin las fotos que esta hoja quitó en esta sesión. */
  const [items, setItems] = useState<readonly string[]>(media);
  /** La foto que el diálogo está por quitar. null = diálogo cerrado. */
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRemoving, startRemoving] = useTransition();

  if (items.length === 0) {
    return (
      <p className="flex items-start gap-2 rounded-md bg-surface-subtle px-3 py-2.5 text-xs text-foreground-secondary">
        <ImagesSquare size={16} aria-hidden="true" className="mt-px shrink-0" />
        {POST_EDIT_COPY.edit.mediaLocked}
      </p>
    );
  }

  /** Con un solo archivo no queda nada si se lo saca: no hay botón que ofrecer. */
  const canRemoveAny = items.length > 1;

  function confirmRemove() {
    const path = pendingPath;
    if (!path || isRemoving) return;
    setErrorMessage(null);

    startRemoving(async () => {
      // `confirmed: true` viaja explícito: la action rechaza cualquier llamada
      // que no lo traiga, así un handler mal cableado no puede quitar una foto
      // sin que este diálogo se haya abierto.
      const result = await removePostPhotoAction({ postId, path, confirmed: true });
      if (!result.ok) {
        setErrorMessage(result.message);
        return;
      }
      setItems((prev) => prev.filter((item) => item !== path));
      setPendingPath(null);
      toast({
        title: COPY.removePhoto.successTitle,
        description: COPY.removePhoto.successBody,
        variant: "success",
      });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground-secondary">
        {COPY.removePhoto.sectionLabel}
      </p>

      {/* Tira horizontal: con 10 fotos permitidas, una grilla empujaría el
          botón de guardar fuera de la hoja en un teléfono. */}
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {items.map((path, index) => {
          const isVideo = mediaKindOf(path) === "video";
          const removable = canRemoveAny && !isVideo;
          return (
            <li key={path} className="relative shrink-0">
              <div className="size-20 overflow-hidden rounded-md bg-surface-subtle ring-1 ring-inset ring-border-subtle">
                {isVideo ? (
                  // Sin <video>: acá sólo hace falta reconocer cuál es, y bajar
                  // el archivo entero para una miniatura de 80px es regalar los
                  // datos móviles de la persona.
                  <div className="flex size-full items-center justify-center text-foreground-muted">
                    <ImagesSquare size={22} aria-hidden="true" />
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- miniatura de 80px de un bucket público, sin layout shift ni necesidad de optimización
                  <img
                    src={postMediaUrl(path)}
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                  />
                )}
              </div>
              {removable && (
                <button
                  type="button"
                  disabled={disabled || isRemoving}
                  onClick={() => {
                    setErrorMessage(null);
                    setPendingPath(path);
                  }}
                  aria-label={COPY.removePhoto.triggerFor(index + 1, items.length)}
                  className={cn(
                    "absolute -right-1 -top-1 flex size-7 items-center justify-center rounded-full",
                    "bg-danger text-on-danger shadow-sm",
                    "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-90",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                    "disabled:pointer-events-none disabled:opacity-50",
                  )}
                >
                  <Trash size={14} weight="bold" aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* El motivo, siempre escrito. Un botón que no está sin explicación se lee
          como una falla de la app, no como una regla. */}
      <p className="text-xs text-foreground-muted">
        {!canRemoveAny
          ? COPY.removePhoto.onlyOneHint
          : items.some((path) => mediaKindOf(path) === "video")
          ? COPY.postMenu.denial["es-video"]
          : POST_EDIT_COPY.edit.mediaLocked}
      </p>

      <Dialog
        open={pendingPath !== null}
        onClose={isRemoving ? () => {} : () => setPendingPath(null)}
        highRisk
        title={COPY.removePhoto.dialogTitle}
        description={COPY.removePhoto.dialogBody}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPendingPath(null)}
              disabled={isRemoving}
              className="sm:min-w-32"
            >
              {COPY.removePhoto.cancel}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={confirmRemove}
              loading={isRemoving}
              className="sm:min-w-36"
            >
              {isRemoving ? COPY.removePhoto.confirming : COPY.removePhoto.confirm}
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
    </div>
  );
}
