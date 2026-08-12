"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { Avatar, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { TENANT_GUARD_COPY } from "@/lib/tenant/match";
import { CreateMenu, type QuickPostKind } from "@/components/shell/create-menu";
import { readVideoDurationSeconds } from "@/lib/media/measure-video";
import { encodeAudioPcm16, sampleAudioPcm } from "@/lib/media/audio-samples";
import { sampleVideoLumaFrames } from "@/lib/media/video-frames";
import {
  DEFAULT_VIDEO_CATEGORY,
  checkVideoDuration,
  type VideoCategory,
} from "@/lib/media/video-policy";
import {
  EMPTY_DECLARATION_VALUE,
  type DeclarationValue,
} from "@/components/integrity/originality-fields";
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
  /**
   * Duración MEDIDA del video, en segundos enteros (sólo en `kind: "video"`).
   * Es el número que se declara al publicar: la base no abre el archivo, así
   * que este valor es el contrato entre lo que se subió y lo que se dice.
   */
  durationSeconds?: number;
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
  /** Categoría de Videos Cortos (0046). Opcional: arranca en el default. */
  const [videoCategory, setVideoCategory] = useState<VideoCategory>(
    DEFAULT_VIDEO_CATEGORY,
  );
  /**
   * Declaración de originalidad y licencia (0061). Arranca vacía y vacía NO
   * significa "es propio" — significa "no dijo nada", que es lo que el pipeline
   * de Content Integrity va a leer si la persona no abre el bloque.
   */
  const [declaration, setDeclaration] = useState<DeclarationValue>(
    EMPTY_DECLARATION_VALUE,
  );
  /** Midiendo la duración del archivo recién elegido (antes de subir nada). */
  const [measuringVideo, setMeasuringVideo] = useState(false);
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

  /**
   * Mismo patrón síncrono para el video (1 por publicación) y, además, EL TOPE
   * DE 90 s (spec nº4).
   *
   * El archivo se MIDE acá, con la metadata del `<video>`, antes de subir un
   * solo byte: el video va directo del navegador al bucket, así que enterarse
   * después sería gastarle los datos a la persona para terminar diciéndole que
   * no. Un video que no se puede medir tampoco entra — sin duración la base
   * rechaza el INSERT (`posts_video_declaration`), y un error de Postgres no es
   * un mensaje para nadie.
   */
  async function selectVideo(input: HTMLInputElement) {
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

    setMeasuringVideo(true);
    const measured = await readVideoDurationSeconds(file);
    setMeasuringVideo(false);

    // MISMA función que corre el servidor. No hay dos reglas.
    const duration = checkVideoDuration("short_video", measured);
    if (!duration.ok) {
      toast(
        duration.reason === "too-long"
          ? {
              title: COPY.composer.videoTooLongTitle,
              description: COPY.composer.videoTooLongBody,
              variant: "warning",
              duration: 9000,
            }
          : {
              title: COPY.composer.videoUnknownDurationTitle,
              description: COPY.composer.videoUnknownDurationBody,
              variant: "warning",
              duration: 8000,
            },
      );
      return;
    }

    setMedia((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        kind: "video",
        file,
        preview: URL.createObjectURL(file),
        durationSeconds: duration.seconds,
      },
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
    setVideoCategory(DEFAULT_VIDEO_CATEGORY);
    // La declaración es de ESTA publicación: arrastrarla a la siguiente pondría
    // una afirmación en boca de alguien que no la hizo sobre otras fotos.
    setDeclaration(EMPTY_DECLARATION_VALUE);
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
    const isQuestion = composeMode === "question";
    const isText = composeMode === "text";
    /**
     * MISMA regla que enciende el botón en ComposerSheet, y la misma que valida
     * el servidor: con foto o video el pie es OPCIONAL (feedback cliente
     * 2026-08-05), y sólo pregunta y texto siguen exigiendo cuerpo — ahí el
     * cuerpo ES la publicación. Este chequeo no es decorativo: sin él, publicar
     * una foto sin pie salía por acá en silencio y el botón no hacía nada.
     */
    const needsBody = isQuestion || isText;
    const bodyOk = trimmed.length === 0 ? !needsBody : trimmed.length >= 2;
    if (!bodyOk || isPending) return;

    // Regla "todo post lleva imagen" (trigger MEDIA_REQUIRED 0023, exenta para
    // pregunta y texto): acá no hace falta reaccionar — ComposerSheet ya
    // mantiene su botón de Publicar apagado en modo `media` sin medio elegido,
    // así que esta función nunca se llama en ese estado.

    startTransition(async () => {
      // ---- 1) Video primero: subida directa al bucket con progreso ---------
      let videoPath: string | null = null;
      /**
       * Fotogramas para la huella perceptual del video (Content Integrity).
       *
       * Se muestrean ACÁ y no en el servidor porque el video se sube DIRECTO al
       * bucket: el servidor nunca lo tiene abierto, y sacarle fotogramas allá
       * pediría ffmpeg (~70 MB de binario nativo) en una función serverless. El
       * navegador ya tiene el decodificador y le sale gratis.
       *
       * Son 4 matrices de 32×32 en gris: ~4 KB en el FormData, nada al lado del
       * video. Si el muestreo falla (códec raro, archivo corrupto) vuelve vacío
       * y el pipeline lo lee como "no se pudo analizar" → revisión humana. Nunca
       * frena la publicación.
       */
      let videoFrames: number[][] = [];
      /** PCM mono en base64 de la pista de audio del video. null = no se pudo. */
      let videoAudioPcm: string | null = null;
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
        // El muestreo va en paralelo con la subida: son dos trabajos
        // independientes sobre el mismo archivo y encadenarlos le sumaría un
        // par de segundos a la espera por nada.
        const [uploaded, frames, audioPcm] = await Promise.all([
          uploadVideoWithProgress(video.file, videoPath, setUploadPct),
          sampleVideoLumaFrames(video.file),
          // La pista de audio es una huella independiente de la imagen: quien
          // recorta el video pero deja el sonido intacto matchea por acá. Va en
          // el mismo Promise.all porque también es trabajo sobre el archivo que
          // ya está en memoria, y degrada a null sin romper nada.
          sampleAudioPcm(video.file),
        ]);
        videoFrames = frames;
        videoAudioPcm = audioPcm ? encodeAudioPcm16(audioPcm) : null;
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
      if (videoPath) {
        formData.set("videoPaths", JSON.stringify([videoPath]));
        // DECLARACIÓN OBLIGATORIA (0046): sin estos dos campos el INSERT rebota
        // contra `posts_video_declaration`. La duración es la MEDIDA al elegir
        // el archivo, y el servidor la vuelve a pasar por la misma política.
        formData.set("videoType", "short_video");
        if (video?.durationSeconds) {
          formData.set("durationSeconds", String(video.durationSeconds));
        }
        formData.set("videoCategory", videoCategory);
        // Sólo si hay algo que mandar: un array vacío y la ausencia del campo
        // significan lo mismo para el servidor ("no se pudo analizar"), y así
        // no viaja un `"[]"` que aparenta ser un análisis hecho.
        if (videoFrames.length > 0) {
          formData.set("videoFrames", JSON.stringify(videoFrames));
        }
        // Mismo criterio que los fotogramas: si no se pudo extraer, el campo no
        // viaja. Un string vacío parecería un análisis hecho que dio nada.
        if (videoAudioPcm) {
          formData.set("videoAudioPcm", videoAudioPcm);
        }
      }
      formData.set(
        "mediaOrder",
        JSON.stringify(media.map((item) => (item.kind === "photo" ? "photo" : "video"))),
      );

      /**
       * DECLARACIÓN DE ORIGINALIDAD Y LICENCIA (0061) — sólo si hay archivo.
       *
       * `content_assets` existe por archivo, así que en una pregunta o un texto
       * no hay nada que declarar y mandar los campos igual sería adjuntar una
       * afirmación sobre un activo inexistente. Cuando sí hay, viajan los cuatro
       * incluso vacíos: la ausencia total y "no aclaró" se leen igual en el
       * servidor (`normalizeDeclaration`), pero mandarlos deja el registro
       * explícito de que se preguntó.
       */
      if (media.length > 0) {
        formData.set("originalityDeclared", String(declaration.originalityDeclared));
        formData.set("licenseKind", declaration.licenseKind);
        formData.set("licenseStatement", declaration.licenseStatement);
        formData.set("licenseUrl", declaration.licenseUrl);
      }

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
      if (result.code === "video") {
        // El servidor rebotó la declaración de video. El mensaje es el MISMO
        // que muestra el navegador al elegir el archivo — sale del módulo de
        // política, no de dos copys parecidos.
        toast(
          result.reason === "too-long"
            ? {
                title: COPY.composer.videoTooLongTitle,
                description: COPY.composer.videoTooLongBody,
                variant: "warning",
                duration: 9000,
              }
            : {
                title: COPY.composer.videoUnknownDurationTitle,
                description: COPY.composer.videoUnknownDurationBody,
                variant: "warning",
                duration: 8000,
              },
        );
        return;
      }
      if (result.code === "invalid") {
        toast({ title: COPY.composer.tooShort, variant: "warning" });
        return;
      }
      if (result.code === "rate-limited") {
        // `warning` y no `danger`: no se rompió nada, hay que esperar.
        toast({
          title: COPY.composer.rateLimitedTitle,
          description: COPY.composer.rateLimitedBody,
          variant: "warning",
          duration: 8000,
        });
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

      {/*
       * Inputs reales, ocultos: los FileList se leen SINCRÓNICAMENTE (gotcha).
       *
       * `tabIndex={-1}` + `aria-hidden`: `sr-only` recorta por clip, así que el
       * control SIGUE siendo focusable y visible para el lector de pantalla. Sin
       * esto, al tabular por el compositor aparecían dos paradas anunciadas como
       * "Examinar…" sin etiqueta y sin contexto. A estos inputs se los dispara
       * por código (`photoInputRef.current?.click()`); el control real, con su
       * nombre, es el botón de arriba.
       */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        id="post-composer-photos"
        onChange={(event) => selectPhotos(event.currentTarget)}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        id="post-composer-video"
        // `void`: la medición del archivo es asíncrona, pero el FileList se lee
        // SINCRÓNICAMENTE dentro (antes del primer await) — ver el gotcha de
        // arriba. Nada que esperar acá.
        onChange={(event) => void selectVideo(event.currentTarget)}
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
        canAddVideo={!video && !measuringVideo}
        onAddPhotos={() => photoInputRef.current?.click()}
        onAddVideo={() => videoInputRef.current?.click()}
        onRemoveMedia={removeMedia}
        pollEnabled={pollEnabled}
        onPollChange={setPollEnabled}
        videoCategory={videoCategory}
        onVideoCategoryChange={setVideoCategory}
        declaration={declaration}
        onDeclarationChange={setDeclaration}
        previewId={previewId}
        uploadPct={uploadPct}
        measuringVideo={measuringVideo}
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
