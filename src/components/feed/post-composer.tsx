"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, PaperPlaneRight, X } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Button, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { TENANT_GUARD_COPY } from "@/lib/tenant/match";
import { createPostAction } from "@/app/(app)/feed/actions";
import { COPY } from "./copy";

const MAX_LENGTH = 2000;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export interface PostComposerProps {
  viewerName: string;
  viewerAvatarUrl: string | null;
}

/**
 * Composer de post (§4.b): textarea con autosize y FOTO OBLIGATORIA (feedback
 * cliente 2026-07-19: feed visual tipo Instagram, no periódico). El usuario
 * publica SIEMPRE como sí mismo — sin selector de identidad. Si intenta publicar
 * sin foto, un aviso cálido lo lleva al recuadro en vez de dejar el botón muerto
 * y sin explicación. El server action modera el texto; foto flagged/pendiente se
 * resuelve a posteriori sin frenar el feed.
 */
export function PostComposer({ viewerName, viewerAvatarUrl }: PostComposerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  // Realce momentáneo del recuadro de foto cuando intentan publicar sin ella.
  const [photoHint, setPhotoHint] = useState(false);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoButtonRef = useRef<HTMLButtonElement>(null);

  // El realce es un empujón, no un estado fijo: se apaga solo a los segundos.
  useEffect(() => {
    if (!photoHint) return;
    const timer = setTimeout(() => setPhotoHint(false), 2600);
    return () => clearTimeout(timer);
  }, [photoHint]);

  function autosize(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }

  function pickPhoto(file: File | null) {
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      toast({ title: COPY.composer.photoWrongType, variant: "warning" });
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast({ title: COPY.composer.photoTooBig, variant: "warning" });
      return;
    }
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoHint(false);
  }

  function clearPhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhoto(null);
    setPhotoPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function resetForm() {
    setBody("");
    setPhotoHint(false);
    clearPhoto();
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  // El botón se habilita con solo texto: la foto se valida al enviar, así el
  // usuario puede apretar Publicar y recibir el aviso en vez de un botón muerto.
  const canPublish = body.trim().length >= 2 && !isPending;

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length < 2 || isPending) return;

    // Foto obligatoria (feed visual): avisamos con calidez y llevamos el ojo al
    // recuadro en vez de bloquear el botón en silencio.
    if (!photo) {
      setPhotoHint(true);
      toast({
        title: COPY.composer.photoMissingTitle,
        description: COPY.composer.photoMissingBody,
        variant: "warning",
      });
      photoButtonRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      photoButtonRef.current?.focus({ preventScroll: true });
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set("body", trimmed);
      formData.set("kind", "post");
      formData.set("photo", photo);

      const result = await createPostAction(formData);

      if (result.ok) {
        try {
          navigator.vibrate?.(10);
        } catch {
          // sin soporte háptico
        }
        resetForm();
        if (result.status === "published") {
          toast({
            title: COPY.composer.successTitle,
            description: COPY.composer.successBody,
            variant: "success",
          });
        } else {
          toast({
            title: COPY.composer.reviewTitle,
            description: COPY.composer.reviewBody,
            variant: "info",
            duration: 7000,
          });
        }
        router.refresh();
        return;
      }

      if (result.code === "unauthenticated") {
        router.push("/entrar?next=/feed");
        return;
      }
      if (result.code === "tenant-mismatch") {
        toast({
          title: TENANT_GUARD_COPY.mismatchTitle,
          description: result.message,
          variant: "warning",
          duration: 8000,
        });
        return;
      }
      if (result.code === "photo") {
        toast({
          title: COPY.composer.photoErrorTitle,
          description: COPY.composer.photoErrorBody,
          variant: "warning",
        });
        return;
      }
      if (result.code === "invalid") {
        toast({ title: COPY.composer.tooShort, variant: "warning" });
        return;
      }
      toast({
        title: COPY.composer.errorTitle,
        description: COPY.composer.errorBody,
        variant: "danger",
      });
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      aria-label={COPY.composer.placeholder}
      className="rounded-lg border border-border-subtle bg-surface p-4 shadow-xs"
    >
      <div className="flex items-start gap-2.5">
        <Avatar size="sm" name={viewerName} src={viewerAvatarUrl} />
        <div className="min-w-0 flex-1">
          <label htmlFor="post-composer-body" className="sr-only">
            {COPY.composer.placeholder}
          </label>
          <textarea
            id="post-composer-body"
            ref={textareaRef}
            rows={2}
            maxLength={MAX_LENGTH}
            value={body}
            placeholder={COPY.composer.placeholder}
            disabled={isPending}
            onChange={(event) => {
              setBody(event.target.value);
              autosize(event.target);
            }}
            className={cn(
              "max-h-50 min-h-16 w-full resize-none bg-transparent py-1.5 text-base text-foreground",
              "placeholder:text-foreground-muted focus:outline-none",
              "disabled:opacity-60",
            )}
          />
        </div>
      </div>

      {/* Foto: prominente y obligatoria. Preview grande. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        id="post-composer-photo"
        onChange={(event) => pickPhoto(event.target.files?.[0] ?? null)}
      />

      {photoPreview ? (
        <div className="relative mt-3 overflow-hidden rounded-md">
          {/* eslint-disable-next-line @next/next/no-img-element -- preview local (blob:) del archivo elegido */}
          <img src={photoPreview} alt="" className="max-h-72 w-full object-cover" />
          <button
            type="button"
            onClick={clearPhoto}
            disabled={isPending}
            aria-label={COPY.composer.removePhoto}
            className={cn(
              "absolute right-2 top-2 flex size-9 items-center justify-center rounded-full bg-media-scrim text-on-media",
              "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.92]",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-on-media/60",
            )}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          ref={photoButtonRef}
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={isPending}
          className={cn(
            "mt-3 flex min-h-24 w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed",
            "transition-[transform,background-color,border-color,color] duration-(--duration-fast) ease-(--ease-spring)",
            "hover:border-brand hover:bg-surface-subtle active:scale-[0.99]",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            "disabled:pointer-events-none disabled:opacity-45",
            photoHint
              ? "border-warning bg-warning-bg text-warning-ink ring-2 ring-warning"
              : "border-border text-foreground-secondary",
          )}
        >
          <Camera size={24} aria-hidden="true" />
          <span className="text-sm font-medium">{COPY.composer.addPhoto}</span>
        </button>
      )}

      <div className="mt-2.5 flex items-center border-t border-border-subtle pt-2.5">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          className="ml-auto"
          disabled={!canPublish}
          loading={isPending}
        >
          {!isPending && <PaperPlaneRight size={16} aria-hidden="true" />}
          {isPending ? COPY.composer.publishing : COPY.composer.publish}
        </Button>
      </div>
    </form>
  );
}
