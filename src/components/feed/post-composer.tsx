"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { Avatar, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { TENANT_GUARD_COPY } from "@/lib/tenant/match";
import { CreateMenu, type QuickPostKind } from "@/components/shell/create-menu";
import {
  createPostAction,
  prepareMediaUploadAction,
} from "@/app/(app)/feed/actions";
import { ComposerSheet, type ComposerMode } from "./composer-sheet";
import { COPY } from "./copy";

const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/**
 * El menú "crear publicación" (§b, feedback cliente 2026-07-24) vive ahora en
 * `@/components/shell/create-menu`: el "+" del bottom nav abre EL MISMO menú
 * desde cualquier pantalla (2026-07-29), así que las diez opciones no pueden
 * seguir siendo una lista privada de este archivo.
 *
 * Lo que sí sigue siendo de acá: qué pasa cuando elegís foto, video o pregunta.
 * Este composer las resuelve sin navegar (selector + hoja de texto). Cuando el
 * menú se abre desde otra pantalla, esas tres viajan como /feed?crear=… y las
 * levanta el efecto de abajo.
 */

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
  /** `tenants.modules` / `modules_soon`: filtran los tiles del menú de crear. */
  modules: Record<string, boolean>;
  modulesSoon: Record<string, boolean>;
}

/**
 * Composer del feed (§4.b) — rediseño 2026-07-29 (pedido de Manuel: "no quiero
 * que tenga un input para escribir… quiero que el principal y único sea el de
 * '¿Qué querés publicar?'").
 *
 * En reposo hay UNA sola cosa: la tarjeta "¿Qué querés publicar?", con nada
 * más que la abra o la reemplace — sin campo de texto ni botón Publicar
 * afuera. Tocarla abre el menú (CreateMenu, compartido con el "+" del bottom
 * nav) y ahí se elige QUÉ se publica; escribir el cuerpo pasa a vivir siempre
 * DENTRO de ese flujo (ComposerSheet), nunca en esta tarjeta.
 *
 * REGLA "TODO POST LLEVA IMAGEN". El trigger MEDIA_REQUIRED (0023/0043) exige
 * medio en `kind='post'` y exime a `question` y a `text`. Como ya no hay forma
 * de escribir y publicar SIN pasar por un tile del menú, no hace falta una
 * hoja aparte que explique la regla: el modo `media` de ComposerSheet
 * simplemente mantiene su Publicar apagado hasta que haya al menos una foto o
 * un video.
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
export function PostComposer({
  viewerName,
  viewerAvatarUrl,
  modules,
  modulesSoon,
}: PostComposerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<PickedMedia[]>([]);
  /** Progreso de subida del video (null = sin subida en curso). */
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Hoja de texto abierta y en qué modo (null = cerrada). */
  const [composeMode, setComposeMode] = useState<ComposerMode | null>(null);
  /** Encuesta Sí/No de la pregunta (contrato 0041). */
  const [pollEnabled, setPollEnabled] = useState(false);
  const [isPending, startTransition] = useTransition();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  /** Id estable de esta sesión: fija la variante de la vista previa del banner. */
  const previewId = useId();

  const photos = media.filter((item) => item.kind === "photo");
  const video = media.find((item) => item.kind === "video") ?? null;

  /**
   * Arranque por URL: `/feed?crear=photo|video|text|question`. Es el camino
   * del "+" del bottom nav cuando el menú se abrió desde otra pantalla y este
   * composer todavía no existía.
   *
   * Se lee de `window.location` y no con `useSearchParams` a propósito: es un
   * efecto de una sola vez y no vale arrastrar un Suspense boundary a toda la
   * página del feed por él.
   */
  const consumedUrlIntent = useRef(false);
  useEffect(() => {
    if (consumedUrlIntent.current) return;
    consumedUrlIntent.current = true;

    const params = new URLSearchParams(window.location.search);
    const quick = params.get("crear");
    if (quick !== "photo" && quick !== "video" && quick !== "text" && quick !== "question") return;

    // El parámetro se CONSUME: recargar o volver atrás no puede reabrir la hoja.
    params.delete("crear");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );

    if (quick === "question" || quick === "text") {
      openCompose(quick);
      return;
    }

    // La hoja se abre SIEMPRE (adentro tiene "Agregar foto"/"Agregar video") y
    // además se intenta abrir el selector del sistema. El intento puede no
    // prosperar —varios browsers piden gesto del usuario y acá venimos de una
    // navegación—, así que la garantía del camino es la hoja, no el click.
    openCompose("media");
    const input = quick === "photo" ? photoInputRef.current : videoInputRef.current;
    input?.click();
  }, []);

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
    setComposeMode(mode);
  }

  function resetForm() {
    setBody("");
    setComposeMode(null);
    setPollEnabled(false);
    setMedia((current) => {
      for (const item of current) URL.revokeObjectURL(item.preview);
      return [];
    });
  }

  /** Opción rápida del menú: dispara el selector de archivos o abre texto/pregunta. */
  function handleQuickPost(quick: QuickPostKind) {
    if (quick === "photo") {
      photoInputRef.current?.click();
    } else if (quick === "video") {
      videoInputRef.current?.click();
    } else {
      openCompose(quick);
    }
  }

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length < 2 || isPending) return;

    const isQuestion = composeMode === "question";
    const isText = composeMode === "text";
    // Regla "todo post lleva imagen" (trigger MEDIA_REQUIRED 0023, exenta para
    // pregunta y texto): acá no hace falta reaccionar — ComposerSheet ya
    // mantiene su botón de Publicar apagado en modo `media` sin medio elegido,
    // así que esta función nunca se llama en ese estado.

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
      formData.set("kind", isQuestion ? "question" : isText ? "text" : "post");
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

  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4 shadow-xs">
      {/* ÚNICO elemento en reposo (pedido de Manuel, 2026-07-29): nada de campo
          de texto ni de botón Publicar acá — toda la tarjeta es el disparador,
          y presionarla es lo que despliega las opciones (CreateMenu). Escribir
          pasa a vivir siempre DENTRO del paso que abre cada opción
          (ComposerSheet), nunca acá afuera. */}
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        className={cn(
          "flex w-full items-center gap-3 rounded-md text-left",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <Avatar size="sm" name={viewerName} src={viewerAvatarUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-base font-semibold text-foreground">
            {COPY.composer.createMenu.rowLabel}
          </span>
          <span className="block truncate text-sm text-foreground-secondary">
            {COPY.composer.createMenu.rowHint}
          </span>
        </span>
        <CaretRight size={18} aria-hidden="true" className="shrink-0 text-foreground-muted" />
      </button>

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

      <CreateMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        modules={modules}
        modulesSoon={modulesSoon}
        onQuickPost={handleQuickPost}
      />

      {/* Paso de texto: el medio (o la pregunta/texto) a la vista y el cuerpo debajo. */}
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
    </div>
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
