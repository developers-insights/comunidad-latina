"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Briefcase,
  Calendar,
  CaretRight,
  Camera,
  House,
  PaperPlaneRight,
  Question,
  ShoppingBagOpen,
  Sparkle,
  Storefront,
  VideoCamera,
  Wrench,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { Avatar, BottomSheet, Button, useToast } from "@/components/ui";
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
import { ComposerSheet, type ComposerMode } from "./composer-sheet";
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
//
// Rediseño 2026-07-27 (call con el cliente): esta fila es AHORA EL ÚNICO
// disparador. Los dos recuadros grandes de "Agregar foto" / "Agregar video" se
// fueron —"tiene mucho espacio blanco esta parte tan grande de aquí"— y cada
// opción resuelve su medio ADENTRO de su propio flujo: foto y video abren el
// selector y siguen en la hoja de texto (ComposerSheet), y los módulos abren su
// formulario completo.
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
 * Composer del feed (§4.b) — rediseño 2026-07-27.
 *
 * Lo que se ve en reposo son DOS cosas y nada más: el campo de escritura rápida
 * (con su Publicar, tipo Twitter) y la fila "¿Qué querés publicar?". Todo lo
 * demás —elegir foto o video, escribir el pie, activar la encuesta— pasa dentro
 * del flujo que abre cada opción.
 *
 * REGLA "TODO POST LLEVA IMAGEN". El trigger MEDIA_REQUIRED (0023) exige medio
 * en `kind='post'` y exime a `kind='question'`. El campo rápido no la puede
 * romper, así que tampoco la esconde: si alguien escribe y toca Publicar sin
 * medio, en vez de un error aparece una hoja con los dos caminos posibles —
 * sumar foto/video, o publicarlo como pregunta (que sale sobre el banner de
 * marca, sin espacio muerto) — y el texto ya escrito viaja con la persona.
 *
 * SUBIDA DEL VIDEO: directa navegador → bucket post-media (evita el límite de
 * body de las server actions), con progreso real vía XHR. El prefijo
 * {tenant}/{user} del path lo entrega el SERVER (prepareMediaUploadAction) —
 * nunca se confía en el cliente — y la policy 0025 lo re-valida al subir.
 *
 * GOTCHA Next 16/React 19 (memoria del proyecto, fix 21ce281): un FileList
 * leído dentro de un updater/callback diferido llega VACÍO. `selectPhotos` /
 * `selectVideo` copian `input.files` SINCRÓNICAMENTE en el handler, antes de
 * cualquier setState.
 */
export function PostComposer({ viewerName, viewerAvatarUrl }: PostComposerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<PickedMedia[]>([]);
  /** Progreso de subida del video (null = sin subida en curso). */
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Hoja de texto abierta y en qué modo (null = cerrada). */
  const [composeMode, setComposeMode] = useState<ComposerMode | null>(null);
  /** Hoja que explica la regla de la imagen cuando el texto va solo. */
  const [needsMediaOpen, setNeedsMediaOpen] = useState(false);
  /** Encuesta Sí/No de la pregunta (contrato 0041). */
  const [pollEnabled, setPollEnabled] = useState(false);
  // Solo para el tamaño del textarea (§a): compacto en reposo, cómodo con foco.
  const [focused, setFocused] = useState(false);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  /** Id estable de esta sesión: fija la variante de la vista previa del banner. */
  const previewId = useId();

  // Saludo VISIBLE por franja horaria + nombre de pila (§c, rediseño
  // 2026-07-26): la hora es del USUARIO, no del server — antes de montar no
  // se muestra nada (useMounted es hydration-safe, sin mismatch); el
  // placeholder del textarea ya no depende de la hora (queda neutro y fijo).
  const mounted = useMounted();
  const greeting = mounted
    ? COPY.composer.greetingByHour(new Date().getHours(), firstNameOf(viewerName || ""))
    : null;

  const photos = media.filter((item) => item.kind === "photo");
  const video = media.find((item) => item.kind === "video") ?? null;

  function autosize(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }

  /**
   * Lee el FileList VIVO del input de fotos de forma SÍNCRONA (gotcha de
   * arriba) y agrega hasta completar el cupo de 4, validando tipo y peso.
   * Elegido al menos un archivo, se abre la hoja de texto: la foto y su pie
   * pasan a ser un solo paso.
   */
  function selectPhotos(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) return;

    const accepted: PickedMedia[] = [];
    let photoCount = photos.length;
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
      accepted.push({
        id: crypto.randomUUID(),
        kind: "photo",
        file,
        preview: URL.createObjectURL(file),
      });
      photoCount += 1;
    }

    if (accepted.length > 0) {
      setMedia((current) => [...current, ...accepted]);
      openCompose("media");
    }

    // Un solo aviso, el más útil (no una ráfaga de toasts).
    if (rejectedLimit) toast({ title: COPY.composer.photoLimit, variant: "warning" });
    else if (rejectedType) toast({ title: COPY.composer.photoWrongType, variant: "warning" });
    else if (rejectedSize) toast({ title: COPY.composer.photoTooBig, variant: "warning" });
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
    if (video) {
      toast({ title: COPY.composer.videoLimit, variant: "warning" });
      return;
    }

    setMedia((current) => [
      ...current,
      { id: crypto.randomUUID(), kind: "video", file, preview: URL.createObjectURL(file) },
    ]);
    openCompose("media");
  }

  function removeMedia(id: string) {
    setMedia((current) => {
      const found = current.find((item) => item.id === id);
      if (found) URL.revokeObjectURL(found.preview);
      return current.filter((item) => item.id !== id);
    });
  }

  /** Abre la hoja de texto cerrando cualquier otra que estuviera arriba. */
  function openCompose(mode: ComposerMode) {
    setMenuOpen(false);
    setNeedsMediaOpen(false);
    setComposeMode(mode);
  }

  function resetForm() {
    setBody("");
    setComposeMode(null);
    setNeedsMediaOpen(false);
    setPollEnabled(false);
    setMedia((current) => {
      for (const item of current) URL.revokeObjectURL(item.preview);
      return [];
    });
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  /** Tile del menú crear-post: dispara el selector, abre la pregunta o navega. */
  function handleMenuTile(tile: CreateMenuTile) {
    setMenuOpen(false);
    if (tile.action.kind === "photo") {
      photoInputRef.current?.click();
    } else if (tile.action.kind === "video") {
      videoInputRef.current?.click();
    } else if (tile.action.kind === "question") {
      openCompose("question");
    }
  }

  // El botón se habilita con solo texto: la regla de la imagen se explica al
  // enviar, con los dos caminos a mano, en vez de un botón muerto sin motivo.
  const canPublish = body.trim().length >= 2 && !isPending;

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length < 2 || isPending) return;

    const isQuestion = composeMode === "question";
    // Regla "todo post lleva imagen" (trigger MEDIA_REQUIRED 0023, exento para
    // las preguntas): en vez de un error, la hoja con los dos caminos.
    if (!isQuestion && media.length === 0) {
      setNeedsMediaOpen(true);
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
      formData.set("kind", isQuestion ? "question" : "post");
      // Solo una pregunta puede llevar encuesta; el server lo re-valida igual.
      if (isQuestion && pollEnabled) formData.set("pollKind", "yes_no");
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

  const choiceRowClass = cn(
    "flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left",
    "transition-[background-color,border-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
    "hover:border-brand hover:bg-surface-subtle active:scale-[0.99]",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
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

      {/* ÚNICO disparador del composer: abre el menú con TODOS los tipos. */}
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        className={cn(
          "mt-3 flex w-full items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2.5",
          "text-left transition-[background-color,border-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
          "hover:border-brand hover:bg-surface-subtle active:scale-[0.995]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
          {[Camera, VideoCamera, Question].map((PreviewIcon, index) => (
            <TileIconChip key={index} accent="var(--accent-feed)" Icon={PreviewIcon} size={26} />
          ))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">
            {COPY.composer.createMenu.rowLabel}
          </span>
          <span className="block truncate text-xs text-foreground-secondary">
            {COPY.composer.createMenu.rowHint}
          </span>
        </span>
        <CaretRight size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
      </button>

      <div className="mt-2.5 flex items-center border-t border-border-subtle pt-2.5">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          // `min-h-11`: el alto de `sm` es 40px y el objetivo táctil mínimo del
          // proyecto son 44 — el ancho lo da el contenido, el alto lo forzamos.
          className="ml-auto min-h-11"
          disabled={!canPublish}
          loading={isPending && composeMode === null}
        >
          {!isPending && <PaperPlaneRight size={16} aria-hidden="true" />}
          {isPending && composeMode === null
            ? COPY.composer.publishing
            : COPY.composer.publish}
        </Button>
      </div>

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

      {/* Regla de la imagen, contada en humano y con salida por los dos lados. */}
      <BottomSheet
        open={needsMediaOpen}
        onClose={() => setNeedsMediaOpen(false)}
        title={COPY.composer.needsMedia.sheetTitle}
      >
        <p className="text-sm text-foreground-secondary">
          {COPY.composer.needsMedia.body}
        </p>
        <div className="mt-4 flex flex-col gap-2 pb-2">
          <button
            type="button"
            onClick={() => {
              setNeedsMediaOpen(false);
              photoInputRef.current?.click();
            }}
            className={choiceRowClass}
          >
            <TileIconChip accent="var(--accent-feed)" Icon={Camera} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">
                {COPY.composer.needsMedia.withMediaTitle}
              </span>
              <span className="block text-xs text-foreground-secondary">
                {COPY.composer.needsMedia.withMediaBody}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => openCompose("question")}
            className={choiceRowClass}
          >
            <TileIconChip accent="var(--accent-feed)" Icon={Question} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">
                {COPY.composer.needsMedia.asQuestionTitle}
              </span>
              <span className="block text-xs text-foreground-secondary">
                {COPY.composer.needsMedia.asQuestionBody}
              </span>
            </span>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-center"
            onClick={() => setNeedsMediaOpen(false)}
          >
            {COPY.composer.needsMedia.keepWriting}
          </Button>
        </div>
      </BottomSheet>

      {/* Paso de texto: el medio (o la pregunta) a la vista y el texto debajo. */}
      <ComposerSheet
        open={composeMode !== null}
        onClose={() => setComposeMode(null)}
        mode={composeMode ?? "media"}
        body={body}
        onBodyChange={setBody}
        media={media}
        canAddPhoto={photos.length < MAX_PHOTOS}
        canAddVideo={!video}
        onAddPhotos={() => photoInputRef.current?.click()}
        onAddVideo={() => videoInputRef.current?.click()}
        onRemoveMedia={removeMedia}
        pollEnabled={pollEnabled}
        onPollChange={setPollEnabled}
        previewId={previewId}
        uploadPct={uploadPct}
        isPending={isPending}
        onPublish={submit}
      />
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
