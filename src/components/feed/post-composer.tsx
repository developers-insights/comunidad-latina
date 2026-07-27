"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Briefcase,
  Calendar,
  CaretRight,
  Camera,
  House,
  PaperPlaneRight,
  Plus,
  Question,
  ShoppingBagOpen,
  Sparkle,
  Storefront,
  VideoCamera,
  Wrench,
  X,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { Avatar, BottomSheet, Button, Chip, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { firstNameOf } from "@/components/listings";
import { useMounted } from "@/lib/design/use-overlay";
import { cn } from "@/lib/utils";
import { TENANT_GUARD_COPY } from "@/lib/tenant/match";
import {
  createPostAction,
  prepareMediaUploadAction,
} from "@/app/(app)/feed/actions";
import { entityAccentVar } from "./helpers";
import { COPY } from "./copy";

const MAX_LENGTH = 2000;
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

// ---------------------------------------------------------------------------
// Menú "crear publicación" (§b, feedback cliente 2026-07-24): la fila-disparador
// abre un BottomSheet con TODOS los tipos que se pueden crear desde acá — el
// post rápido (foto/video/pregunta, en ESTE composer) y un acceso directo a
// cada módulo de la comunidad. El acento de cada tile es el de SU módulo
// (entityAccentVar reutiliza el mismo mapeo que ya pinta las cards del feed).
// ---------------------------------------------------------------------------

type CreateMenuAction =
  | { kind: "photo" }
  | { kind: "video" }
  | { kind: "question" }
  | { kind: "link"; href: string };

interface CreateMenuTile {
  key: string;
  title: string;
  description: string;
  accent: string;
  Icon: Icon;
  action: CreateMenuAction;
}

const CREATE_MENU_TILES: CreateMenuTile[] = [
  {
    key: "photo",
    ...COPY.composer.createMenu.tiles.photo,
    accent: "var(--accent-feed)",
    Icon: Camera,
    action: { kind: "photo" },
  },
  {
    key: "video",
    ...COPY.composer.createMenu.tiles.video,
    accent: "var(--accent-feed)",
    Icon: VideoCamera,
    action: { kind: "video" },
  },
  {
    key: "question",
    ...COPY.composer.createMenu.tiles.question,
    accent: "var(--accent-feed)",
    Icon: Question,
    action: { kind: "question" },
  },
  {
    key: "property",
    ...COPY.composer.createMenu.tiles.property,
    accent: entityAccentVar("property"),
    Icon: House,
    action: { kind: "link", href: "/publicar?kind=property" },
  },
  {
    key: "business",
    ...COPY.composer.createMenu.tiles.business,
    accent: entityAccentVar("business"),
    Icon: Storefront,
    action: { kind: "link", href: "/publicar?kind=business" },
  },
  {
    key: "professional",
    ...COPY.composer.createMenu.tiles.professional,
    accent: entityAccentVar("professional"),
    Icon: Briefcase,
    action: { kind: "link", href: "/publicar?kind=professional" },
  },
  {
    key: "event",
    ...COPY.composer.createMenu.tiles.event,
    accent: entityAccentVar("event"),
    Icon: Calendar,
    action: { kind: "link", href: "/publicar?kind=event" },
  },
  {
    key: "job",
    ...COPY.composer.createMenu.tiles.job,
    accent: entityAccentVar("job"),
    Icon: Wrench,
    action: { kind: "link", href: "/empleos/publicar" },
  },
  {
    key: "product",
    ...COPY.composer.createMenu.tiles.product,
    accent: "var(--accent-marketplace)",
    Icon: ShoppingBagOpen,
    action: { kind: "link", href: "/marketplace/publicar" },
  },
  {
    key: "creatorService",
    ...COPY.composer.createMenu.tiles.creatorService,
    accent: "var(--accent-creadores)",
    Icon: Sparkle,
    action: { kind: "link", href: "/creadores/publicar" },
  },
];

/** Chip de ícono tintado (14% del acento) — mismo lenguaje visual que AccentLink. */
function TileIconChip({
  accent,
  Icon: TileIcon,
  size = 44,
}: {
  accent: string;
  Icon: Icon;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        backgroundColor: `color-mix(in oklab, ${accent} 14%, transparent)`,
        color: accent,
      }}
      className="flex shrink-0 items-center justify-center rounded-full"
    >
      <TileIcon size={Math.round(size * 0.5)} weight="bold" />
    </span>
  );
}

/** Un medio elegido, en el ORDEN de selección (posts.media respeta ese orden). */
interface PickedMedia {
  id: string;
  kind: "photo" | "video";
  file: File;
  preview: string;
}

export interface PostComposerProps {
  viewerName: string;
  viewerAvatarUrl: string | null;
}

/**
 * Composer de post (§4.b): textarea con autosize + hasta 4 FOTOS y 1 VIDEO
 * (sprint reels 2026-07-21). Algún medio sigue siendo obligatorio (feed
 * visual, no periódico). El usuario publica SIEMPRE como sí mismo.
 *
 * SUBIDA DEL VIDEO: directa navegador → bucket post-media (evita el límite de
 * body de las server actions), con progreso real vía XHR. El prefijo
 * {tenant}/{user} del path lo entrega el SERVER (prepareMediaUploadAction) —
 * nunca se confía en el cliente — y la policy 0025 lo re-valida al subir.
 *
 * GOTCHA Next 16/React 19 (memoria del proyecto, fix 21ce281): un FileList
 * leído dentro de un updater/callback diferido llega VACÍO. `selectPhotos` /
 * `selectVideo` copian `input.files` SINCRÓNICAMENTE en el handler.
 */
export function PostComposer({ viewerName, viewerAvatarUrl }: PostComposerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<PickedMedia[]>([]);
  // Realce momentáneo de los recuadros cuando intentan publicar sin medios.
  const [mediaHint, setMediaHint] = useState(false);
  /** Progreso de subida del video (null = sin subida en curso). */
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  // Modo pregunta (menú crear-post, §b): manda kind='question' y exime del
  // requisito de media (trigger 0023 / createPostAction ya lo contemplan).
  const [questionMode, setQuestionMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Solo para el tamaño del textarea (§a): compacto en reposo, cómodo con foco.
  const [focused, setFocused] = useState(false);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const mediaBoxRef = useRef<HTMLDivElement>(null);

  // Saludo VISIBLE por franja horaria + nombre de pila (§c, rediseño
  // 2026-07-26): la hora es del USUARIO, no del server — antes de montar no
  // se muestra nada (useMounted es hydration-safe, sin mismatch); el
  // placeholder del textarea ya no depende de la hora (queda neutro y fijo).
  const mounted = useMounted();
  const greeting = mounted
    ? COPY.composer.greetingByHour(new Date().getHours(), firstNameOf(viewerName || ""))
    : null;

  // El realce es un empujón, no un estado fijo: se apaga solo a los segundos.
  useEffect(() => {
    if (!mediaHint) return;
    const timer = setTimeout(() => setMediaHint(false), 2600);
    return () => clearTimeout(timer);
  }, [mediaHint]);

  const photos = media.filter((item) => item.kind === "photo");
  const video = media.find((item) => item.kind === "video") ?? null;

  function autosize(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }

  /**
   * Lee el FileList VIVO del input de fotos de forma síncrona (gotcha de
   * arriba) y agrega hasta completar el cupo de 4, validando tipo y peso.
   */
  function selectPhotos(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) return;

    setMedia((current) => {
      let photoCount = current.filter((item) => item.kind === "photo").length;
      const next = [...current];
      let rejectedType = false;
      let rejectedSize = false;
      let rejectedLimit = false;

      for (const file of files) {
        if (photoCount >= MAX_PHOTOS) {
          rejectedLimit = true;
          break;
        }
        if (!PHOTO_TYPES.includes(file.type)) {
          rejectedType = true;
          continue;
        }
        if (file.size > MAX_PHOTO_BYTES) {
          rejectedSize = true;
          continue;
        }
        next.push({
          id: crypto.randomUUID(),
          kind: "photo",
          file,
          preview: URL.createObjectURL(file),
        });
        photoCount += 1;
      }

      // Un solo aviso, el más útil (no una ráfaga de toasts).
      if (rejectedLimit) toast({ title: COPY.composer.photoLimit, variant: "warning" });
      else if (rejectedType) toast({ title: COPY.composer.photoWrongType, variant: "warning" });
      else if (rejectedSize) toast({ title: COPY.composer.photoTooBig, variant: "warning" });

      return next;
    });
    setMediaHint(false);
  }

  /** Mismo patrón síncrono para el video (1 por publicación). */
  function selectVideo(input: HTMLInputElement) {
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return;

    if (!VIDEO_TYPES[file.type]) {
      toast({ title: COPY.composer.videoWrongType, variant: "warning" });
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      toast({ title: COPY.composer.videoTooBig, variant: "warning" });
      return;
    }

    setMedia((current) => {
      if (current.some((item) => item.kind === "video")) {
        toast({ title: COPY.composer.videoLimit, variant: "warning" });
        return current;
      }
      return [
        ...current,
        { id: crypto.randomUUID(), kind: "video", file, preview: URL.createObjectURL(file) },
      ];
    });
    setMediaHint(false);
  }

  function removeMedia(id: string) {
    setMedia((current) => {
      const found = current.find((item) => item.id === id);
      if (found) URL.revokeObjectURL(found.preview);
      return current.filter((item) => item.id !== id);
    });
  }

  function resetForm() {
    setBody("");
    setMediaHint(false);
    setQuestionMode(false);
    setMedia((current) => {
      for (const item of current) URL.revokeObjectURL(item.preview);
      return [];
    });
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  /** Tile del menú crear-post (§b): dispara el attach, activa "Pregunta" o navega. */
  function handleMenuTile(tile: CreateMenuTile) {
    setMenuOpen(false);
    if (tile.action.kind === "photo") {
      photoInputRef.current?.click();
    } else if (tile.action.kind === "video") {
      videoInputRef.current?.click();
    } else if (tile.action.kind === "question") {
      setQuestionMode(true);
      textareaRef.current?.focus();
    }
  }

  // El botón se habilita con solo texto: los medios se validan al enviar, así
  // el usuario recibe el aviso en vez de un botón muerto sin explicación.
  const canPublish = body.trim().length >= 2 && !isPending;

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length < 2 || isPending) return;

    // Algún medio obligatorio (feed visual): aviso cálido + ojo al recuadro.
    // La PREGUNTA queda exenta (trigger MEDIA_REQUIRED 0023 / createPostAction
    // ya lo contemplan para kind='question') — se puede publicar solo texto.
    if (!questionMode && media.length === 0) {
      setMediaHint(true);
      toast({
        title: COPY.composer.mediaMissingTitle,
        description: COPY.composer.mediaMissingBody,
        variant: "warning",
      });
      mediaBoxRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    startTransition(async () => {
      // ---- 1) Video primero: subida directa al bucket con progreso ---------
      let videoPath: string | null = null;
      if (video) {
        const prepared = await prepareMediaUploadAction();
        if (!prepared.ok) {
          if (prepared.code === "unauthenticated") {
            router.push("/entrar?next=/feed");
            return;
          }
          if (prepared.code === "tenant-mismatch") {
            toast({
              title: TENANT_GUARD_COPY.mismatchTitle,
              description: prepared.message,
              variant: "warning",
              duration: 8000,
            });
            return;
          }
          toast({
            title: COPY.composer.videoUploadErrorTitle,
            description: COPY.composer.videoUploadErrorBody,
            variant: "danger",
          });
          return;
        }

        const extension = VIDEO_TYPES[video.file.type];
        videoPath = `${prepared.tenantId}/${prepared.userId}/video-${crypto.randomUUID()}.${extension}`;
        setUploadPct(0);
        const uploaded = await uploadVideoWithProgress(video.file, videoPath, setUploadPct);
        setUploadPct(null);
        if (!uploaded) {
          toast({
            title: COPY.composer.videoUploadErrorTitle,
            description: COPY.composer.videoUploadErrorBody,
            variant: "danger",
          });
          return;
        }
      }

      // ---- 2) Fotos + paths por la server action ---------------------------
      const formData = new FormData();
      formData.set("body", trimmed);
      formData.set("kind", questionMode ? "question" : "post");
      for (const item of media) {
        if (item.kind === "photo") formData.append("photos", item.file);
      }
      if (videoPath) formData.set("videoPaths", JSON.stringify([videoPath]));
      formData.set(
        "mediaOrder",
        JSON.stringify(media.map((item) => (item.kind === "photo" ? "photo" : "video"))),
      );

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

      // El post no salió: el video ya subido quedaría huérfano en el prefijo
      // del usuario — lo limpiamos best-effort (la policy delete lo permite).
      if (videoPath) {
        try {
          await createClient().storage.from("post-media").remove([videoPath]);
        } catch {
          // sin drama: el archivo queda en el prefijo propio, no es visible
        }
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

  const pickerButtonClass = cn(
    "flex min-h-24 flex-1 flex-col items-center justify-center gap-1.5 rounded-md border border-dashed",
    "transition-[transform,background-color,border-color,color] duration-(--duration-fast) ease-(--ease-spring)",
    "hover:border-brand hover:bg-surface-subtle active:scale-[0.99]",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
    "disabled:pointer-events-none disabled:opacity-45",
    mediaHint
      ? "border-warning bg-warning-bg text-warning-ink ring-2 ring-warning"
      : "border-border text-foreground-secondary",
  );

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
            rows={1}
            maxLength={MAX_LENGTH}
            value={body}
            placeholder={COPY.composer.placeholder}
            disabled={isPending}
            onFocus={(event) => {
              setFocused(true);
              autosize(event.target);
            }}
            onBlur={() => setFocused(false)}
            onChange={(event) => {
              setBody(event.target.value);
              autosize(event.target);
            }}
            className={cn(
              "max-h-50 w-full resize-none bg-transparent py-1.5 text-base text-foreground",
              "placeholder:text-foreground-muted focus:outline-none",
              "transition-[min-height] duration-(--duration-fast) ease-(--ease-spring)",
              // Compacto en reposo (§a); crece con foco o con texto ya escrito.
              focused || body.length > 0 ? "min-h-16" : "min-h-11",
              "disabled:opacity-60",
            )}
          />
          {questionMode && (
            <div className="mt-1.5">
              <Chip variant="brand" size="md" icon={<Question weight="bold" />}>
                {COPY.composer.questionModeChip}
                <button
                  type="button"
                  onClick={() => setQuestionMode(false)}
                  aria-label={COPY.composer.questionModeRemove}
                  className={cn(
                    "ml-1 flex size-5 shrink-0 items-center justify-center rounded-full",
                    "transition-colors duration-(--duration-fast) hover:bg-brand-ink/10",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  )}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </Chip>
            </div>
          )}
          {greeting && (
            <p className="mt-1.5 text-sm text-foreground-secondary">{greeting}</p>
          )}
        </div>
      </div>

      {/* Inputs reales, ocultos: los FileList se leen SINCRÓNICAMENTE (gotcha) */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        id="post-composer-photos"
        onChange={(event) => selectPhotos(event.currentTarget)}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm"
        className="sr-only"
        id="post-composer-video"
        onChange={(event) => selectVideo(event.currentTarget)}
      />

      {/* Menú "crear publicación" (§b): fila-disparador + BottomSheet con TODOS
          los tipos (post rápido acá mismo, o un módulo entero aparte). */}
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        className={cn(
          "mt-3 flex w-full items-center gap-2.5 rounded-md border border-dashed border-border px-3 py-2.5",
          "text-left transition-colors duration-(--duration-fast) hover:border-brand hover:bg-surface-subtle",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
          {[Camera, VideoCamera, Question].map((PreviewIcon, index) => (
            <TileIconChip key={index} accent="var(--accent-feed)" Icon={PreviewIcon} size={24} />
          ))}
        </span>
        <span className="flex-1 truncate text-sm font-medium text-foreground-secondary">
          {COPY.composer.createMenu.rowLabel}
        </span>
        <CaretRight size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
      </button>

      <BottomSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={COPY.composer.createMenu.sheetTitle}
      >
        <ul className="flex flex-col gap-0.5 pb-2">
          {CREATE_MENU_TILES.map((tile) => {
            const rowClass = cn(
              "flex w-full items-center gap-3 rounded-lg p-2.5 text-left",
              "transition-colors duration-(--duration-fast) ease-(--ease-spring)",
              "hover:bg-surface-subtle active:scale-[0.99]",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            );
            const rowContent = (
              <>
                <TileIconChip accent={tile.accent} Icon={tile.Icon} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">
                    {tile.title}
                  </span>
                  <span className="block text-xs text-foreground-secondary">
                    {tile.description}
                  </span>
                </span>
                {tile.action.kind === "link" && (
                  <CaretRight
                    size={16}
                    aria-hidden="true"
                    className="shrink-0 text-foreground-muted"
                  />
                )}
              </>
            );
            return (
              <li key={tile.key}>
                {tile.action.kind === "link" ? (
                  <Link
                    href={tile.action.href}
                    onClick={() => setMenuOpen(false)}
                    className={rowClass}
                  >
                    {rowContent}
                  </Link>
                ) : (
                  <button type="button" onClick={() => handleMenuTile(tile)} className={rowClass}>
                    {rowContent}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </BottomSheet>

      <div ref={mediaBoxRef} className="mt-3">
        {media.length > 0 ? (
          <>
            {/* Miniaturas en el ORDEN elegido (así se publica) */}
            <ul className="grid grid-cols-2 gap-2">
              {media.map((item, index) => (
                <li
                  key={item.id}
                  className="relative aspect-square overflow-hidden rounded-md bg-surface-subtle"
                >
                  {item.kind === "photo" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- preview local (blob:) del archivo elegido
                    <img
                      src={item.preview}
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                    />
                  ) : (
                    <>
                      <video
                        src={item.preview}
                        muted
                        playsInline
                        preload="metadata"
                        className="absolute inset-0 size-full object-cover"
                      />
                      <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-media-scrim px-2 py-0.5 text-xs font-semibold text-on-media">
                        <VideoCamera size={13} weight="fill" aria-hidden="true" />
                        {COPY.composer.videoChip}
                      </span>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => removeMedia(item.id)}
                    disabled={isPending}
                    aria-label={
                      item.kind === "photo"
                        ? `${COPY.composer.removePhoto} ${index + 1}`
                        : COPY.composer.removeVideo
                    }
                    className={cn(
                      "absolute right-2 top-2 flex size-9 items-center justify-center rounded-full bg-media-scrim text-on-media",
                      "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.92]",
                      "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-on-media/60",
                    )}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>

            {/* Sumar más medios sin vaciar lo elegido */}
            <div className="mt-2 flex gap-2">
              {photos.length < MAX_PHOTOS && (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={isPending}
                  className={cn(
                    "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-sm font-medium text-foreground-secondary",
                    "transition-colors duration-(--duration-fast) hover:border-brand hover:bg-surface-subtle",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                    "disabled:pointer-events-none disabled:opacity-45",
                  )}
                >
                  <Plus size={16} aria-hidden="true" />
                  {COPY.composer.addPhotos}
                </button>
              )}
              {!video && (
                <button
                  type="button"
                  onClick={() => videoInputRef.current?.click()}
                  disabled={isPending}
                  className={cn(
                    "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-sm font-medium text-foreground-secondary",
                    "transition-colors duration-(--duration-fast) hover:border-brand hover:bg-surface-subtle",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                    "disabled:pointer-events-none disabled:opacity-45",
                  )}
                >
                  <VideoCamera size={16} aria-hidden="true" />
                  {COPY.composer.addVideo}
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={isPending}
              className={pickerButtonClass}
            >
              <Camera size={24} aria-hidden="true" />
              <span className="text-sm font-medium">{COPY.composer.addPhotos}</span>
            </button>
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              disabled={isPending}
              className={pickerButtonClass}
            >
              <VideoCamera size={24} aria-hidden="true" />
              <span className="text-sm font-medium">{COPY.composer.addVideo}</span>
            </button>
          </div>
        )}
      </div>

      {/* Progreso REAL de la subida del video (XHR) */}
      {uploadPct !== null && (
        <div className="mt-3" role="status">
          <p className="text-xs font-medium text-foreground-secondary">
            {COPY.composer.videoUploading(uploadPct)}
          </p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-subtle">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-(--duration-fast)"
              style={{ width: `${uploadPct}%` }}
            />
          </div>
        </div>
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

// ---------------------------------------------------------------------------
// Subida directa con progreso. supabase-js no expone onprogress (usa fetch):
// hacemos el MISMO request que haría el SDK (POST /storage/v1/object/...)
// con XHR y el token de la sesión — la policy post_media_insert (0025) valida
// el prefijo {tenant}/{user} contra el JWT igual que siempre.
// ---------------------------------------------------------------------------

async function uploadVideoWithProgress(
  file: File,
  path: string,
  onProgress: (pct: number) => void,
): Promise<boolean> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!accessToken || !baseUrl || !anonKey) return false;

  return new Promise<boolean>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${baseUrl}/storage/v1/object/post-media/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => {
      onProgress(100);
      resolve(xhr.status >= 200 && xhr.status < 300);
    };
    xhr.onerror = () => resolve(false);
    xhr.onabort = () => resolve(false);
    xhr.send(file);
  });
}
