"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, PaperPlaneRight, Question, X } from "@phosphor-icons/react/dist/ssr";
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
 * Composer de post (§4.b): textarea con autosize, foto opcional (1) y toggle
 * "Pregunta". El server action modera el texto — si queda flagged, el post
 * entra en revisión y se avisa con calidez, nunca con un error crudo.
 */
export function PostComposer({ viewerName, viewerAvatarUrl }: PostComposerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [isQuestion, setIsQuestion] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
  }

  function clearPhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhoto(null);
    setPhotoPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length < 2 || isPending) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.set("body", trimmed);
      formData.set("kind", isQuestion ? "question" : "post");
      if (photo) formData.set("photo", photo);

      const result = await createPostAction(formData);

      if (result.ok) {
        setBody("");
        setIsQuestion(false);
        clearPhoto();
        if (textareaRef.current) textareaRef.current.style.height = "auto";
        try {
          navigator.vibrate?.(10);
        } catch {
          // sin soporte háptico
        }
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

  const canPublish = body.trim().length >= 2 && !isPending;

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

          {photoPreview && (
            <div className="relative mt-2 overflow-hidden rounded-md">
              {/* eslint-disable-next-line @next/next/no-img-element -- preview local (blob:) del archivo elegido */}
              <img src={photoPreview} alt="" className="max-h-56 w-full object-cover" />
              <button
                type="button"
                onClick={clearPhoto}
                aria-label={COPY.composer.removePhoto}
                className={cn(
                  // Flota sobre la preview de la foto → tokens de media, constantes
                  // en ambos temas: el velo no se aclara con el tema light.
                  "absolute right-2 top-2 flex size-9 items-center justify-center rounded-full bg-media-scrim text-on-media",
                  "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.92]",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-on-media/60",
                )}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1.5 border-t border-border-subtle pt-2.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          id="post-composer-photo"
          onChange={(event) => pickPhoto(event.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={isPending}
          aria-label={COPY.composer.addPhoto}
          className={cn(
            "flex size-11 items-center justify-center rounded-md text-foreground-secondary",
            "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
            "hover:bg-surface-subtle active:scale-[0.94]",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            "disabled:pointer-events-none disabled:opacity-45",
          )}
        >
          <Camera size={20} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => setIsQuestion((current) => !current)}
          disabled={isPending}
          aria-pressed={isQuestion}
          title={COPY.composer.questionHint}
          className={cn(
            "flex min-h-11 select-none items-center gap-1.5 rounded-md px-3 text-sm font-medium",
            "transition-[transform,background-color,color] duration-(--duration-fast) ease-(--ease-spring)",
            "active:scale-[0.96]",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            "disabled:pointer-events-none disabled:opacity-45",
            isQuestion
              ? "bg-info-bg text-info"
              : "text-foreground-secondary hover:bg-surface-subtle",
          )}
        >
          <Question size={18} weight={isQuestion ? "fill" : "regular"} aria-hidden="true" />
          {COPY.composer.questionToggle}
        </button>

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
