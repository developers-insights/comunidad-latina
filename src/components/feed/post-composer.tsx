"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  CalendarBlank,
  Camera,
  House,
  Megaphone,
  PaperPlaneRight,
  Question,
  Storefront,
  User,
  UserGear,
  X,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { Avatar, Button, Select, buttonVariants, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { TENANT_GUARD_COPY } from "@/lib/tenant/match";
import { createPostAction } from "@/app/(app)/feed/actions";
import { COPY } from "./copy";
import { entityKindLabel } from "./helpers";
import type { ComposerEntity } from "./helpers";

const MAX_LENGTH = 2000;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

const ENTITY_ICON: Record<string, Icon> = {
  property: House,
  business: Storefront,
  professional: UserGear,
  event: CalendarBlank,
  job: Briefcase,
};

export interface PostComposerProps {
  viewerName: string;
  viewerAvatarUrl: string | null;
  /** Entidades propias published del usuario → selector "Publicar como". */
  entities: ComposerEntity[];
}

/**
 * Composer de post (§4.b): textarea con autosize, FOTO OBLIGATORIA (feedback
 * cliente 2026-07-19: feed visual tipo Instagram, no periódico) y toggle
 * "Pregunta" (las preguntas no exigen foto). Un selector "Publicar como" permite
 * publicar personalmente o COMO una entidad propia; en ese caso el post llega
 * solo a sus seguidores, y al publicar se ofrece promocionarlo para llegar a
 * todos. El server action modera el texto; foto flagged/pendiente se resuelve a
 * posteriori sin frenar el feed.
 */
export function PostComposer({ viewerName, viewerAvatarUrl, entities }: PostComposerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [isQuestion, setIsQuestion] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [entityId, setEntityId] = useState("");
  const [promotePostId, setPromotePostId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedEntity = entities.find((entity) => entity.id === entityId) ?? null;
  const SelectedIcon = selectedEntity ? (ENTITY_ICON[selectedEntity.kind] ?? Storefront) : User;

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

  function resetForm() {
    setBody("");
    setIsQuestion(false);
    setEntityId("");
    clearPhoto();
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  // Foto obligatoria salvo en preguntas (texto por naturaleza).
  const needsPhoto = !isQuestion && !photo;
  const canPublish = body.trim().length >= 2 && !needsPhoto && !isPending;

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length < 2 || needsPhoto || isPending) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.set("body", trimmed);
      formData.set("kind", isQuestion ? "question" : "post");
      if (entityId) formData.set("entityId", entityId);
      if (photo) formData.set("photo", photo);

      const result = await createPostAction(formData);

      if (result.ok) {
        try {
          navigator.vibrate?.(10);
        } catch {
          // sin soporte háptico
        }
        // Post de entidad publicado → ofrecer promoción (llega a todos).
        if (result.status === "published" && result.entity) {
          setPromotePostId(result.postId);
          resetForm();
          router.refresh();
          return;
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
    <div className="flex flex-col gap-3">
      {/* Post de entidad recién publicado → invitación a promocionar (§4). */}
      {promotePostId && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-lg border border-brand-subtle bg-brand-tint p-4"
        >
          <div className="flex items-start gap-2.5">
            <Megaphone size={22} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
            <div>
              <p className="font-display text-sm font-bold text-brand-ink">
                {COPY.composer.entitySuccessTitle}
              </p>
              <p className="mt-0.5 text-sm text-brand-ink">
                {COPY.composer.entitySuccessBody}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/impulsar-post/${promotePostId}`}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              <Megaphone size={16} weight="fill" aria-hidden="true" />
              {COPY.composer.promoteCta}
            </Link>
            <button
              type="button"
              onClick={() => setPromotePostId(null)}
              className="min-h-11 rounded-md px-3 text-sm font-medium text-brand-ink hover:underline"
            >
              {COPY.composer.promoteDismiss}
            </button>
          </div>
        </div>
      )}

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

        {/* Selector "Publicar como" — solo si el usuario tiene entidades propias. */}
        {entities.length > 0 && (
          <div className="mt-1">
            <label
              htmlFor="post-composer-as"
              className="mb-1 block text-xs font-medium text-foreground-secondary"
            >
              {COPY.composer.publishAsLabel}
            </label>
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-subtle text-foreground-secondary"
              >
                <SelectedIcon size={18} weight="fill" />
              </span>
              <Select
                id="post-composer-as"
                className="flex-1"
                value={entityId}
                disabled={isPending}
                onChange={(event) => setEntityId(event.target.value)}
              >
                <option value="">{COPY.composer.publishAsYou}</option>
                {entities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.title} · {entityKindLabel(entity.kind)}
                  </option>
                ))}
              </Select>
            </div>
            {selectedEntity && (
              <p className="mt-1.5 text-xs leading-relaxed text-foreground-muted">
                {COPY.composer.entityFollowersNote}
              </p>
            )}
          </div>
        )}

        {/* Foto: prominente y obligatoria (salvo preguntas). Preview grande. */}
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
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={isPending}
            className={cn(
              "mt-3 flex min-h-24 w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed",
              "border-border text-foreground-secondary",
              "transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
              "hover:border-brand hover:bg-surface-subtle active:scale-[0.99]",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              "disabled:pointer-events-none disabled:opacity-45",
            )}
          >
            <Camera size={24} aria-hidden="true" />
            <span className="text-sm font-medium">{COPY.composer.addPhoto}</span>
          </button>
        )}

        {needsPhoto && (
          <p className="mt-1.5 text-xs leading-relaxed text-foreground-muted">
            {COPY.composer.photoRequiredHint}
          </p>
        )}

        <div className="mt-2.5 flex items-center gap-1.5 border-t border-border-subtle pt-2.5">
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
    </div>
  );
}
