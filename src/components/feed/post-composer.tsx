"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { TENANT_GUARD_COPY } from "@/lib/tenant/match";
import { CreateMenu, type QuickPostKind } from "@/components/shell/create-menu";
import { ComposerMenuProvider } from "./composer-context";
import { readVideoDurationSeconds } from "@/lib/media/measure-video";
import { encodeAudioPcm16, sampleAudioPcm } from "@/lib/media/audio-samples";
import { sampleVideoLumaFrames } from "@/lib/media/video-frames";
import {
  DEFAULT_VIDEO_CATEGORY,
  checkVideoDuration,
  type VideoCategory,
} from "@/lib/media/video-policy";
import {
  VIDEO_ACCEPT_ATTR,
  VIDEO_WRONG_TYPE_MESSAGE,
  checkVideoFile,
  formatVideoTooBigMessage,
} from "@/lib/media/video-upload-limits";
import {
  EMPTY_DECLARATION_VALUE,
  type DeclarationValue,
} from "@/components/integrity/originality-fields";
import {
  createPostAction,
  prepareMediaUploadAction,
} from "@/app/(app)/feed/actions";
import { getAutoriasAction } from "@/app/(app)/feed/autoria-actions";
/**
 * SÓLO EL TIPO, y no es un detalle de estilo: `@/lib/feed/autoria` abre con
 * `server-only`, y cualquier camino de imports que lo alcance desde un archivo
 * `"use client"` tira abajo el build de producción (lo vigila
 * `src/test/server-only-boundary.test.ts`). Una importación de tipos se borra
 * al compilar y no entra al grafo del bundler; el único puente REAL con ese
 * módulo es la server action de la línea de arriba.
 */
import type { AutoriasDelComposer } from "@/lib/feed/autoria";
import { bakePhoto } from "@/lib/media/bake-photo";
import { saveTagsAction } from "@/app/(app)/feed/tag-actions";
import { attachPostMusicAction } from "@/app/(app)/feed/music-actions";
import type { TaggedProfile } from "@/lib/social/post-tags";
import type { PickedTrack } from "@/lib/media/audio-track";
import {
  AutoriaCargando,
  AutoriaNoDisponible,
  AutoriaSelector,
} from "./autoria-selector";
import { PeopleTagger } from "./people-tagger";
import { MusicPicker } from "./music-picker";
import { TAGGER_COPY } from "./people-tagger-copy";
import { MUSIC_COPY } from "./music-copy";
/**
 * CUPO Y PESO DE LAS FOTOS: importados, nunca escritos acá. Este archivo tenía
 * su propio `MAX_PHOTOS = 10` mientras la server action seguía en 4 — publicar
 * con fotos estaba roto y ningún test lo veía, porque cada lado se probaba
 * contra su propio número.
 */
import {
  MAX_PHOTOS,
  MAX_TOTAL_AUDIO_PCM_CHARS,
  MAX_VIDEOS,
  MAX_PICKED_PHOTO_BYTES,
  checkPhotoPayload,
} from "@/lib/media/post-media-limits";
import { ComposerSheet, type ComposerMode } from "./composer-sheet";
import {
  DEFAULT_PHOTO_FILTER_ID,
  DEFAULT_PHOTO_FILTER_INTENSITY,
} from "@/lib/media/photo-filters";
import { DEFAULT_PHOTO_EDIT, photoEditFilterCss, type PhotoEdit } from "./photo-editor";
import { COPY } from "./copy";

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
/**
 * FORMATO Y PESO DE VIDEO: importados de `@/lib/media/video-upload-limits`,
 * nunca escritos acá. Antes este archivo declaraba su propio mapa MIME→
 * extensión con sólo mp4/webm, y el `accept` del input reflejaba ese mismo
 * mapa recortado — un iPhone graba .mov (`video/quicktime`) y el selector de
 * archivos lo mostraba EN GRIS, sin explicación (feedback cliente). Que el
 * composer y la server action (`isOwnVideoPath` en `feed/actions.ts`) lean
 * del mismo módulo es lo que evita que el input acepte un formato que el
 * servidor después rechaza en silencio.
 */

/**
 * El menú "crear publicación" (§b, feedback cliente 2026-07-24) vive en
 * `@/components/shell/create-menu`: el "+" del bottom nav abre EL MISMO menú
 * desde cualquier pantalla (2026-07-29).
 *
 * Lo que sí sigue siendo de acá: qué pasa cuando elegís foto, video o pregunta.
 * Este composer las resuelve sin navegar (selector + hoja de texto).
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
  /**
   * Extensión y Content-Type CANÓNICOS del video (sólo en `kind: "video"`),
   * resueltos UNA vez en `selectVideo` con `checkVideoFile`. Se guardan acá en
   * vez de recalcularlos al publicar para que el nombre del archivo en el
   * bucket y el header `Content-Type` de la subida sean SIEMPRE el mismo
   * resultado que ya aprobó la validación — nunca una segunda lectura de
   * `file.type`, que en algunos navegadores viene vacío para formatos poco
   * comunes (ver `video-upload-limits.ts`).
   */
  videoExtension?: string;
  videoContentType?: string;
  /**
   * Filtro (+ texto, sólo en foto) elegidos en el editor. Arranca en
   * `DEFAULT_PHOTO_EDIT` (sin filtro, sin texto) apenas se elige el archivo —
   * así el horneado al publicar siempre tiene algo que leer, se haya abierto el
   * editor o no.
   *
   * QUÉ SE HACE CON ÉL, según el medio:
   *  · FOTO  → se HORNEA en los píxeles al publicar (`bake-photo.ts`).
   *  · VIDEO → viaja como METADATO (`videoFilters` → `posts.media_filters`,
   *    0104) y el reproductor lo aplica al pintar. Hornearlo pediría
   *    re-codificar en tiempo real, rompería la subida directa al bucket y le
   *    cambiaría la huella perceptual a Content Integrity.
   */
  edit?: PhotoEdit;
}

export interface PostComposerHostProps {
  /** `tenants.modules` / `modules_soon`: filtran los tiles del menú de crear. */
  modules: Record<string, boolean>;
  modulesSoon: Record<string, boolean>;
  children: ReactNode;
}

/**
 * Dueño de TODO el estado de "publicar" — texto, medios elegidos, subida,
 * horneado — montado UNA vez en el shell (`(app)/layout.tsx`), no por página.
 *
 * Nació adentro del feed (rediseño 2026-07-29, pedido de Manuel) y subió acá
 * el 2026-08-13: el "+" del bottom nav abría este mismo menú desde CUALQUIER
 * pantalla navegando primero a `/feed?crear=…`, y el intento de abrir el
 * selector de archivos apenas montaba de nuevo (un `useEffect`, sin gesto de
 * usuario) fallaba silenciosamente en varios navegadores (Safari, sobre todo)
 * — la persona tocaba "Foto" desde /buscar y no pasaba nada. Con el estado acá
 * arriba, elegir "Foto" desde CUALQUIER pantalla dispara `input.click()` en el
 * MISMO gesto de tacto que abrió el menú, exactamente como ya funcionaba
 * dentro del feed: un solo camino, nunca dos comportamientos.
 *
 * Expone `openMenu()` por `ComposerMenuProvider` (`./composer-context`): la
 * tarjeta "¿Qué querés publicar?" del feed (`ComposerTrigger`) y el "+" del
 * bottom nav son los dos consumidores, y ninguno de los dos sabe ni le importa
 * dónde vive el estado.
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
export function PostComposerHost({ modules, modulesSoon, children }: PostComposerHostProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<PickedMedia[]>([]);
  /**
   * Progreso de subida de video (null = sin subida en curso). Los videos suben
   * DE A UNO, así que además del porcentaje viaja cuál de cuántos: con varios,
   * una barra que vuelve a cero sin decirlo se lee como un error.
   */
  const [videoUpload, setVideoUpload] = useState<
    { pct: number; current: number; total: number } | null
  >(null);
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
  /**
   * PERSONAS ETIQUETADAS (0089) y PISTA ELEGIDA (0090). Viven acá, no dentro de
   * cada selector, porque los dos se guardan DESPUÉS de publicar y con el
   * `postId` recién creado: quien publica es este componente, así que es el
   * único que puede encadenar los dos pasos. Los selectores son controlados y
   * no saben que existe una base de datos.
   */
  const [taggedPeople, setTaggedPeople] = useState<TaggedProfile[]>([]);
  const [track, setTrack] = useState<PickedTrack | null>(null);
  /** Qué se está guardando después de publicar (etiquetas / música), o null. */
  const [finishingLabel, setFinishingLabel] = useState<string | null>(null);
  /** Midiendo la duración del archivo recién elegido (antes de subir nada). */
  const [measuringVideo, setMeasuringVideo] = useState(false);
  /** Horneado de fotos en curso al publicar (null = no hay ninguno corriendo). */
  const [bakingProgress, setBakingProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  /**
   * ---- A NOMBRE DE QUIÉN SALE ESTA PUBLICACIÓN (0023) ---------------------
   *
   * `autorias` es lo que contestó el SERVIDOR: con qué fichas propias y
   * publicadas se puede firmar, y cuál viene elegida según la identidad activa
   * (`active_identities`, 0103). `null` = todavía no se preguntó nunca.
   *
   * `entityId` es la elección de ESTA publicación — `null` = perfil personal.
   * No es un segundo "perfil activo": no se persiste, no toca el header y
   * muere con la publicación. Ver el encabezado de `@/lib/feed/autoria`.
   */
  const [autorias, setAutorias] = useState<AutoriasDelComposer | null>(null);
  const [cargandoAutorias, setCargandoAutorias] = useState(false);
  const [autoriasFallaron, setAutoriasFallaron] = useState(false);
  const [entityId, setEntityId] = useState<string | null>(null);
  /**
   * ¿La persona eligió la firma A MANO en esta sesión del composer? Si sí, un
   * refresco que llega después NO puede pisarle la elección — sería cambiarle
   * a nombre de quién publica mientras escribe. Se resetea al abrir el menú.
   */
  const autoriaTocada = useRef(false);
  /**
   * Espejo de `autorias` para leerlo DENTRO del callback del fetch sin meterlo
   * en las dependencias de `cargarAutorias`: con `autorias` en el arreglo de
   * deps, `openMenu` cambia de identidad cada vez que llega una respuesta y con
   * él el valor del `ComposerMenuProvider` — o sea que la tarjeta del feed y el
   * "+" del bottom nav se vuelven a renderizar por una consulta que no les
   * cambió nada.
   */
  const autoriasRef = useRef<AutoriasDelComposer | null>(null);
  const [isPending, startTransition] = useTransition();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  /** Id estable de esta sesión: fija la variante de la vista previa del banner. */
  const previewId = useId();

  /**
   * Pregunta al servidor con qué firmas se puede publicar. UNA vez por apertura
   * del composer — nunca por render, y nunca desde las pantallas que no
   * publican nada (ver el docblock de `feed/autoria-actions.ts`).
   *
   * Se vuelve a preguntar en CADA apertura a propósito: si alguien cambió de
   * identidad en el header hace diez segundos, la respuesta de hace diez
   * segundos ya miente. Mientras la primera respuesta no llegue, Publicar queda
   * apagado (`autoriaBloquea`): una publicación que sale antes de saber la
   * respuesta sale a nombre de quien nadie eligió.
   *
   * Una falla NO deja el composer inservible: si nunca hubo respuesta se avisa
   * y se publica como uno mismo (el comportamiento de siempre); si ya había una
   * lista, se queda con la que tenía en vez de borrarla por un corte de red.
   */
  const cargarAutorias = useCallback(() => {
    autoriaTocada.current = false;
    setCargandoAutorias(true);
    void getAutoriasAction()
      .then((resultado) => {
        autoriasRef.current = resultado;
        setAutorias(resultado);
        setAutoriasFallaron(false);
        // El default lo decide el servidor. Si la persona ya eligió a mano en
        // esta sesión, manda su elección.
        if (!autoriaTocada.current) setEntityId(resultado.porDefecto);
      })
      .catch(() => {
        // Con una lista previa no se borra nada: un corte de red no puede
        // hacerle perder la firma con la que venía publicando.
        if (autoriasRef.current !== null) return;
        setAutoriasFallaron(true);
        if (!autoriaTocada.current) setEntityId(null);
      })
      .finally(() => setCargandoAutorias(false));
  }, []);

  const openMenu = useCallback(() => {
    setMenuOpen(true);
    cargarAutorias();
  }, [cargarAutorias]);

  /**
   * ¿Hay que esperar antes de dejar publicar? Sólo cuando la respuesta importa:
   *  · no llegó ninguna todavía → nadie sabe con qué nombre saldría;
   *  · la anterior traía fichas → esta persona SÍ elige, y elegir con datos
   *    viejos es publicar con el nombre equivocado.
   * Para quien sólo tiene su perfil personal —la enorme mayoría— esto es
   * siempre `false`: publicar sigue siendo exactamente lo que era.
   */
  const autoriaBloquea =
    cargandoAutorias && (autorias === null || autorias.entidades.length > 0);

  const photos = media.filter((item) => item.kind === "photo");
  const videos = media.filter((item) => item.kind === "video");

  /**
   * Lee el FileList VIVO del input de fotos de forma SÍNCRONA (gotcha de
   * arriba) y agrega hasta completar el cupo de {@link MAX_PHOTOS}, validando tipo y peso.
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
      if (file.size > MAX_PICKED_PHOTO_BYTES) {
        rejectedSize = true;
        continue;
      }
      accepted.push({
        id: crypto.randomUUID(),
        kind: "photo",
        file,
        preview: URL.createObjectURL(file),
        // Sin filtro, sin texto — pero YA presente: el horneado de abajo lee
        // este objeto para CADA foto al publicar, la haya editado o no.
        edit: { ...DEFAULT_PHOTO_EDIT },
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
   * Mismo patrón síncrono que las fotos —el FileList se lee ANTES del primer
   * await (gotcha de arriba)— y, además, EL TOPE DE 90 s por video (spec nº4).
   *
   * VARIOS VIDEOS POR PUBLICACIÓN (pedido de Manuel, 2026-08-25). El selector
   * acepta multiselección y este handler se puede volver a llamar: los videos
   * se acumulan hasta {@link MAX_VIDEOS}, igual que las fotos. El carrusel de
   * la card ya sabía mostrarlos mezclados y en orden desde el 2026-07-27; lo
   * único que faltaba era dejar elegirlos.
   *
   * Cada archivo se MIDE acá, con la metadata del `<video>`, antes de subir un
   * solo byte: el video va directo del navegador al bucket, así que enterarse
   * después sería gastarle los datos a la persona para terminar diciéndole que
   * no. Un video que no se puede medir tampoco entra — sin duración la base
   * rechaza el INSERT (`posts_video_declaration`), y un error de Postgres no es
   * un mensaje para nadie.
   *
   * La medición es de a uno y no en paralelo a propósito: son N decodificaciones
   * de cabecera sobre el hilo principal, y diez juntas trababan la hoja.
   */
  async function selectVideo(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) return;

    let slots = MAX_VIDEOS - videos.length;
    if (slots <= 0) {
      toast({ title: COPY.composer.videoLimit, variant: "warning" });
      return;
    }

    const accepted: PickedMedia[] = [];
    let rejectedLimit = false;
    let rejectedType = false;
    /**
     * Peso del archivo pesado que se rechazó (el más grande, si hubo varios).
     * Se guarda el NÚMERO y no un booleano porque el mensaje nombra el peso
     * real —"pesa 82 MB y el máximo son 60"—, y ese dato es justo el que le
     * dice a la persona cuánto tiene que bajar.
     */
    let rejectedSizeBytes: number | null = null;
    let rejectedTooLong = false;
    let rejectedUnknown = false;

    setMeasuringVideo(true);
    for (const file of files) {
      if (slots <= 0) {
        rejectedLimit = true;
        break;
      }

      // MISMA función que corre el servidor (`isOwnVideoPath` en
      // `feed/actions.ts` valida contra el mismo catálogo de extensiones): un
      // formato o un peso que el picker deja elegir pero la validación rechaza
      // le gastaría los datos a la persona para terminar diciéndole que no.
      const fileCheck = checkVideoFile(file);
      if (!fileCheck.ok) {
        if (fileCheck.reason === "type") rejectedType = true;
        else rejectedSizeBytes = Math.max(rejectedSizeBytes ?? 0, file.size);
        continue;
      }

      const measured = await readVideoDurationSeconds(file);
      // MISMA función que corre el servidor. No hay dos reglas.
      const duration = checkVideoDuration("short_video", measured);
      if (!duration.ok) {
        if (duration.reason === "too-long") rejectedTooLong = true;
        else rejectedUnknown = true;
        continue;
      }

      accepted.push({
        id: crypto.randomUUID(),
        kind: "video",
        file,
        preview: URL.createObjectURL(file),
        durationSeconds: duration.seconds,
        videoExtension: fileCheck.extension,
        videoContentType: fileCheck.mimeType,
        // Igual que la foto: el borrador arranca en "sin filtro" apenas se
        // elige el archivo, así el editor y el envío siempre tienen algo que
        // leer, se haya abierto el editor o no.
        edit: { ...DEFAULT_PHOTO_EDIT },
      });
      slots -= 1;
    }
    setMeasuringVideo(false);

    if (accepted.length > 0) {
      setMedia((current) => [...current, ...accepted]);
      openCompose("media");
    }

    // Un solo aviso, el más accionable (no una ráfaga de toasts). El orden va
    // de "qué sacar" a "qué archivo no sirve": el cupo primero porque es lo
    // único que explica por qué se ignoraron archivos que sí eran válidos.
    if (rejectedLimit) {
      toast({ title: COPY.composer.videoLimit, variant: "warning" });
    } else if (rejectedTooLong) {
      toast({
        title: COPY.composer.videoTooLongTitle,
        description: COPY.composer.videoTooLongBody,
        variant: "warning",
        duration: 9000,
      });
    } else if (rejectedType) {
      toast({ title: VIDEO_WRONG_TYPE_MESSAGE, variant: "warning", duration: 8000 });
    } else if (rejectedSizeBytes !== null) {
      toast({
        title: formatVideoTooBigMessage(rejectedSizeBytes),
        variant: "warning",
        duration: 8000,
      });
    } else if (rejectedUnknown) {
      toast({
        title: COPY.composer.videoUnknownDurationTitle,
        description: COPY.composer.videoUnknownDurationBody,
        variant: "warning",
        duration: 8000,
      });
    }
  }

  function removeMedia(id: string) {
    setMedia((current) => {
      const found = current.find((item) => item.id === id);
      if (found) URL.revokeObjectURL(found.preview);
      return current.filter((item) => item.id !== id);
    });
  }

  /** "Listo" en el editor de foto (`PhotoEditor`): guarda filtro + texto elegidos. */
  function savePhotoEdit(id: string, edit: PhotoEdit) {
    setMedia((current) =>
      current.map((item) => (item.id === id ? { ...item, edit } : item)),
    );
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
    setBakingProgress(null);
    // Etiquetas y música son de ESTA publicación: arrastrarlas a la siguiente
    // etiquetaría gente que nadie volvió a elegir.
    setTaggedPeople([]);
    setTrack(null);
    setFinishingLabel(null);
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
    /**
     * Todavía no sabemos con qué firmas se puede publicar (ver
     * `autoriaBloquea`). El botón ya está apagado en ComposerSheet; esto es la
     * misma regla del lado de quien publica, para que ningún otro camino —un
     * atajo de teclado, un test, un futuro disparador— mande una publicación
     * sin decidir a nombre de quién sale.
     */
    if (autoriaBloquea) return;

    // Regla "todo post lleva imagen" (trigger MEDIA_REQUIRED 0023, exenta para
    // pregunta y texto): acá no hace falta reaccionar — ComposerSheet ya
    // mantiene su botón de Publicar apagado en modo `media` sin medio elegido,
    // así que esta función nunca se llama en ese estado.

    startTransition(async () => {
      // ---- 1) Videos primero: subida directa al bucket con progreso -------
      /** Rutas ya subidas, en el orden de `videos`. */
      const videoPaths: string[] = [];
      /**
       * Fotogramas para la huella perceptual de CADA video (Content Integrity),
       * arreglo PARALELO a `videoPaths`.
       *
       * Se muestrean ACÁ y no en el servidor porque el video se sube DIRECTO al
       * bucket: el servidor nunca lo tiene abierto, y sacarle fotogramas allá
       * pediría ffmpeg (~70 MB de binario nativo) en una función serverless. El
       * navegador ya tiene el decodificador y le sale gratis.
       *
       * Son 4 matrices de 32×32 en gris por video: ~4 KB en el FormData, nada
       * al lado del archivo. Si el muestreo falla (códec raro, archivo
       * corrupto) vuelve vacío y el pipeline lo lee como "no se pudo analizar"
       * → revisión humana. Nunca frena la publicación.
       */
      const videoFrames: number[][][] = [];
      /** PCM mono en base64 por video (null = no se pudo, o no entró en el presupuesto). */
      const videoAudioPcm: (string | null)[] = [];
      if (videos.length > 0) {
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

        /**
         * PRESUPUESTO DE AUDIO. La pista viaja por el body de la server action
         * (~21 KB por segundo ya en base64, o sea ~1,9 MB por un corto de 90 s)
         * y ese body tiene techo — `serverActions.bodySizeLimit`, compartido con
         * las fotos. Diez pistas enteras no entran, y pasarse no devuelve un
         * error nuestro: Next corta el request y la publicación se pierde.
         *
         * Así que el audio se manda MIENTRAS ENTRE, de a un video y en orden.
         * Lo que queda afuera no queda sin huella: los fotogramas —4 KB, siempre
         * viajan— ya alcanzan para que Content Integrity lo dé por analizado.
         * Se pierde el match por sonido de ESE video, no la publicación.
         */
        let audioBudgetChars = MAX_TOTAL_AUDIO_PCM_CHARS;

        for (const [index, item] of videos.entries()) {
          // `videoExtension` ya salió de `checkVideoFile` en `selectVideo` — no
          // se vuelve a leer `item.file.type` acá (puede venir vacío en
          // algunos navegadores para formatos poco comunes; ver
          // `video-upload-limits.ts`). Todo video en `media` pasó ese chequeo,
          // así que el campo siempre está.
          const extension = item.videoExtension ?? "mp4";
          const path = `${prepared.tenantId}/${prepared.userId}/video-${crypto.randomUUID()}.${extension}`;
          const progress = { current: index + 1, total: videos.length };
          setVideoUpload({ pct: 0, ...progress });
          // El muestreo va en paralelo con la subida: son trabajos
          // independientes sobre el mismo archivo y encadenarlos le sumaría un
          // par de segundos a la espera por nada.
          const [uploaded, frames, audioSamples] = await Promise.all([
            uploadVideoWithProgress(
              item.file,
              path,
              (pct) => setVideoUpload({ pct, ...progress }),
              item.videoContentType ?? item.file.type,
            ),
            sampleVideoLumaFrames(item.file),
            // La pista de audio es una huella independiente de la imagen: quien
            // recorta el video pero deja el sonido intacto matchea por acá. Va
            // en el mismo Promise.all porque también es trabajo sobre el archivo
            // que ya está en memoria, y degrada a null sin romper nada. Si el
            // presupuesto ya se agotó ni se decodifica: sería tirar el trabajo.
            audioBudgetChars > 0 ? sampleAudioPcm(item.file) : Promise.resolve(null),
          ]);

          if (!uploaded) {
            setVideoUpload(null);
            // Los que ya subieron quedarían huérfanos en el prefijo propio:
            // se limpian best-effort (la policy delete lo permite).
            await removeUploadedVideos(videoPaths);
            toast({
              title: COPY.composer.videoUploadErrorTitle,
              description: COPY.composer.videoUploadErrorBody,
              variant: "danger",
            });
            return;
          }

          const encodedAudio = audioSamples ? encodeAudioPcm16(audioSamples) : null;
          const audioFits = encodedAudio !== null && encodedAudio.length <= audioBudgetChars;
          if (audioFits) audioBudgetChars -= encodedAudio.length;
          // Una pista que no entra CIERRA el presupuesto: las siguientes son de
          // duración parecida, y seguir intentando sólo gastaría decodificaciones.
          else if (encodedAudio !== null) audioBudgetChars = 0;

          videoPaths.push(path);
          videoFrames.push(frames);
          videoAudioPcm.push(audioFits ? encodedAudio : null);
        }
        setVideoUpload(null);
      }

      // ---- 2) Hornear cada foto: filtro + texto quemados, SIEMPRE recomprimida
      // -----------------------------------------------------------------------
      // `bakePhoto` corre para TODAS las fotos, no sólo las que pasaron por el
      // editor: es la única forma de garantizar que una publicación de 10 nunca
      // pese 10 × 5 MB (ver el docblock de bake-photo.ts). Secuencial y no en
      // paralelo a propósito — así `bakingProgress` avanza foto a foto de verdad
      // y no le exigimos al hilo principal dibujar 10 canvases a la vez.
      const photoItems = media.filter(
        (item): item is PickedMedia & { kind: "photo" } => item.kind === "photo",
      );
      let bakeFallbackCount = 0;
      const bakedByPhotoId = new Map<string, File>();
      if (photoItems.length > 0) {
        setBakingProgress({ done: 0, total: photoItems.length });
        for (const [index, item] of photoItems.entries()) {
          const edit = item.edit ?? DEFAULT_PHOTO_EDIT;
          // Preset + intensidad, resueltos por la MISMA función que pinta la
          // vista previa y la miniatura: lo que se vio es lo que se quema.
          const filterCss = photoEditFilterCss(edit);
          const captionText = edit.captionText.trim();
          const caption = captionText
            ? {
                text: captionText,
                position: edit.captionPosition,
                background: edit.captionBackground,
              }
            : null;

          let fellBack = false;
          let baked = await bakePhoto(item.file, {
            filterCss,
            caption,
            onFallback: () => {
              fellBack = true;
            },
          });

          // SEGUNDO INTENTO, SIN FILTRO. El fallback de `bakePhoto` devuelve el
          // archivo ORIGINAL — que puede pesar los 5 MB enteros y hacer morir
          // el envío. La causa más común es un navegador sin `ctx.filter`, y
          // ahí lo único imposible es el EFECTO: recomprimir se puede igual.
          // Perder el filtro es aceptable; mandar crudo, no. Si tampoco esto
          // sale (no se pudo decodificar la imagen), queda el original y la
          // guarda de peso de abajo lo dice con todas las letras.
          if (fellBack && filterCss) {
            baked = await bakePhoto(item.file, {
              filterCss: "",
              caption,
              onFallback: () => {},
            });
          }
          if (fellBack) bakeFallbackCount += 1;

          bakedByPhotoId.set(item.id, baked);
          setBakingProgress({ done: index + 1, total: photoItems.length });
        }
        setBakingProgress(null);
      }

      // ---- GUARDA DE PESO, ANTES de llamar a la action ---------------------
      // El body de una server action tiene techo (`serverActions.bodySizeLimit`
      // en next.config.ts). Pasarse no devuelve un error nuestro: Next corta el
      // request y la persona se queda mirando un botón que no hizo nada. Acá se
      // mide lo que REALMENTE se va a mandar —las fotos ya horneadas— con la
      // MISMA función que corre el servidor. Esto es cortesía para que el aviso
      // sea legible; la frontera sigue siendo `createPostAction`.
      const payload = checkPhotoPayload(
        photoItems.map((item) => (bakedByPhotoId.get(item.id) ?? item.file).size),
      );
      if (!payload.ok) {
        setBakingProgress(null);
        toast(
          payload.reason === "photo"
            ? {
                title: COPY.composer.photoCantShrinkTitle,
                description: COPY.composer.photoCantShrinkBody,
                variant: "warning",
                duration: 9000,
              }
            : payload.reason === "count"
              ? { title: COPY.composer.photoLimit, variant: "warning" }
              : {
                  title: COPY.composer.photosTooHeavyTitle,
                  description: COPY.composer.photosTooHeavyBody,
                  variant: "warning",
                  duration: 9000,
                },
        );
        // Los videos ya subidos quedan huérfanos si los había: se limpian igual
        // que en cualquier otro corte (best-effort, la policy delete lo permite).
        await removeUploadedVideos(videoPaths);
        return;
      }

      if (bakeFallbackCount > 0) {
        // Decorativo, nunca bloqueante: la publicación sigue con la foto tal
        // cual se eligió — se avisa, no se frena nada.
        toast({
          title: COPY.composer.bakeFallbackTitle,
          description: COPY.composer.bakeFallbackBody,
          variant: "info",
        });
      }

      // ---- 3) Fotos (ya horneadas) + paths por la server action ------------
      const formData = new FormData();
      formData.set("body", trimmed);
      formData.set("kind", isQuestion ? "question" : isText ? "text" : "post");
      // Solo una pregunta puede llevar encuesta; el server lo re-valida igual.
      if (isQuestion && pollEnabled) formData.set("pollKind", "yes_no");
      /**
       * LA FIRMA (`posts.entity_listing_id`, 0023). Sólo viaja cuando hay una
       * ficha elegida: su ausencia ES "publico como yo", igual que el `null` de
       * la columna. El servidor NO confía en este campo — vuelve a comprobar
       * contra la base que la ficha sea propia y esté publicada
       * (`puedeFirmarComo`), y detrás sigue estando la policy `posts_insert`.
       */
      if (entityId) formData.set("entityId", entityId);
      for (const item of media) {
        if (item.kind === "photo") {
          formData.append("photos", bakedByPhotoId.get(item.id) ?? item.file);
        }
      }
      if (videoPaths.length > 0) {
        formData.set("videoPaths", JSON.stringify(videoPaths));
        /**
         * FILTRO DE CADA VIDEO (0104) — arreglo PARALELO a `videoPaths`, no un
         * objeto ya indexado por ruta: la clave la escribe el servidor con los
         * paths que él mismo validó como propios. Si la mandara el cliente,
         * podría poner de clave el video de otra persona.
         *
         * Viaja SIEMPRE que hay video, incluso en `null` (sin filtro): así el
         * servidor puede exigir que el largo coincida con los videos recibidos
         * en vez de adivinar a qué archivo pertenece cada entrada.
         *
         * Sólo `id` e `intensity`. NUNCA el CSS: el string de `filter` lo arma
         * el servidor desde el catálogo — mandarlo desde acá sería dejar que el
         * navegador escriba en el `style` de todo el que abra la publicación.
         */
        formData.set(
          "videoFilters",
          JSON.stringify(
            videos.map((item) => {
              const edit = item.edit;
              return edit && edit.filterId !== DEFAULT_PHOTO_FILTER_ID
                ? {
                    id: edit.filterId,
                    intensity: edit.filterIntensity ?? DEFAULT_PHOTO_FILTER_INTENSITY,
                  }
                : null;
            }),
          ),
        );
        // DECLARACIÓN OBLIGATORIA (0046): sin estos dos campos el INSERT rebota
        // contra `posts_video_declaration`. Las duraciones son las MEDIDAS al
        // elegir los archivos, y el servidor las vuelve a pasar por la misma
        // política.
        //
        // POR QUÉ LA MÁS LARGA Y NO LA SUMA. `posts.duration_seconds` es UNA
        // columna y la regla que cuelga de ella —90 s -- es por CLIP, no por
        // publicación: es lo que dura lo que se mira de un tirón. Declarar la
        // suma haría que tres cortos de 40 s se leyeran como un video de 2
        // minutos y el CHECK rebotara una publicación perfectamente válida.
        // La más larga es la única lectura que sigue siendo verdad sobre un
        // archivo real: si esa entra en el tope, todas entran.
        formData.set("videoType", "short_video");
        const longest = videos.reduce(
          (max, item) => Math.max(max, item.durationSeconds ?? 0),
          0,
        );
        if (longest > 0) formData.set("durationSeconds", String(longest));
        formData.set("videoCategory", videoCategory);
        // Sólo si hay algo que mandar: un array vacío y la ausencia del campo
        // significan lo mismo para el servidor ("no se pudo analizar"), y así
        // no viaja un `"[]"` que aparenta ser un análisis hecho.
        if (videoFrames.some((frames) => frames.length > 0)) {
          formData.set("videoFrames", JSON.stringify(videoFrames));
        }
        // Mismo criterio que los fotogramas: si de ningún video se pudo extraer
        // audio (o ninguno entró en el presupuesto), el campo no viaja.
        if (videoAudioPcm.some((pcm) => pcm !== null)) {
          formData.set("videoAudioPcm", JSON.stringify(videoAudioPcm));
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

        /**
         * ---- 4) LO QUE NECESITABA EL `postId` -----------------------------
         *
         * Etiquetas (0089) y música (0090) se guardan ACÁ y no dentro de
         * `createPostAction`: las dos referencian el post, que recién existe
         * ahora. Next despacha las server actions de un mismo cliente de a una,
         * así que no hay nada que coordinar más que el orden.
         *
         * NINGUNA DE LAS DOS PUEDE VOLTEAR LA PUBLICACIÓN. Ya está publicada y
         * es lo que la persona vino a hacer; si un paso falla se avisa QUÉ
         * quedó afuera y se sigue. El aviso es un toast aparte del de éxito
         * —nunca en lugar de él— porque las dos cosas son verdad a la vez.
         *
         * El refresco del feed va DESPUÉS de los dos: refrescar antes traería
         * la publicación sin sus etiquetas ni su música.
         */
        const postId = result.postId;
        let extraWarning: { title: string; description?: string } | null = null;

        if (taggedPeople.length > 0) {
          setFinishingLabel(COPY.composer.savingTags);
          const saved = await saveTagsAction({
            postId,
            profileIds: taggedPeople.map((person) => person.id),
          });
          if (!saved.ok) {
            extraWarning = {
              title:
                saved.code === "rate-limited"
                  ? TAGGER_COPY.save.rateLimited
                  : TAGGER_COPY.save.partial,
              description: TAGGER_COPY.save.partialGiveUp,
            };
          } else if (saved.rejected.length > 0) {
            // Se guardó la mayoría: no es un fallo, es un dato que la persona
            // merece tener antes de preguntarse por qué falta alguien.
            extraWarning = { title: TAGGER_COPY.save.someRejected(saved.rejected.length) };
          }
        }

        if (track) {
          setFinishingLabel(COPY.composer.savingMusic);
          const attached = await attachPostMusicAction({
            postId,
            trackId: track.id,
            startSeconds: track.startSeconds,
          });
          if (!attached.ok) {
            extraWarning = {
              title:
                attached.code === "track-unavailable"
                  ? MUSIC_COPY.trackUnavailable
                  : attached.code === "post-unavailable"
                    ? MUSIC_COPY.postUnavailable
                    : MUSIC_COPY.attachFailed,
            };
          }
        }
        setFinishingLabel(null);

        resetForm();
        if (result.status === "published") {
          // `result.entity` lo devuelve `createPostAction` justamente para esto:
          // una publicación firmada por una ficha NO llega a toda la comunidad
          // (`feedPostVisibilityFilter`), así que no puede recibir el mismo
          // "ya está visible para la comunidad" que una personal. Hasta hoy el
          // campo volvía y nadie lo leía — el negocio publicaba al vacío el día
          // uno y la app le decía que había llegado a todos.
          toast({
            title: COPY.composer.successTitle,
            description: result.entity
              ? COPY.composer.successEntityBody
              : COPY.composer.successBody,
            variant: "success",
            // Dice algo accionable (Boost), no sólo "listo": necesita leerse.
            ...(result.entity ? { duration: 7000 } : {}),
          });
        } else {
          toast({
            title: COPY.composer.reviewTitle,
            description: COPY.composer.reviewBody,
            variant: "info",
            duration: 7000,
          });
        }
        // Segundo aviso, DESPUÉS del de éxito y nunca en su lugar: la
        // publicación salió (eso es lo primero que hay que saber) y además
        // algo quedó afuera (eso es lo que hay que hacer).
        if (extraWarning) {
          toast({
            title: extraWarning.title,
            description: extraWarning.description,
            variant: "warning",
            duration: 9000,
          });
        }
        // El estado ya no vive en la página del feed (§docblock de arriba): si
        // se publicó desde otra pantalla (el "+" del bottom nav en /buscar,
        // por ejemplo) `refresh()` refrescaría ESA pantalla, que nunca muestra
        // la publicación nueva. Sólo cuando ya se está en /feed alcanza con
        // refrescar sin navegar — es el mismo camino de siempre.
        if (pathname?.startsWith("/feed")) {
          router.refresh();
        } else {
          router.push("/feed");
        }
        return;
      }

      // El post no salió: los videos ya subidos quedarían huérfanos en el
      // prefijo del usuario — se limpian best-effort (la policy delete lo permite).
      await removeUploadedVideos(videoPaths);

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
      if (result.code === "entity") {
        // La ficha dejó de servir entre que se abrió el composer y se tocó
        // Publicar (la despublicaron, la pausaron), o alguien mandó una ajena.
        // Se vuelve a preguntar: la lista de arriba tiene que dejar de ofrecer
        // lo que la base acaba de rechazar.
        cargarAutorias();
        toast({
          title: COPY.composer.autoria.rejectedTitle,
          description: COPY.composer.autoria.rejectedBody,
          variant: "warning",
          duration: 9000,
        });
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
    <ComposerMenuProvider value={{ open: menuOpen, openMenu }}>
      {children}

      {/*
       * Inputs reales, ocultos: los FileList se leen SINCRÓNICAMENTE (gotcha).
       *
       * `tabIndex={-1}` + `aria-hidden`: `sr-only` recorta por clip, así que el
       * control SIGUE siendo focusable y visible para el lector de pantalla. Sin
       * esto, al tabular por cualquier disparador aparecían dos paradas
       * anunciadas como "Examinar…" sin etiqueta y sin contexto. A estos inputs
       * se los dispara por código (`photoInputRef.current?.click()`); el control
       * real, con su nombre, es la tarjeta del feed o el "+" del bottom nav.
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
        accept={VIDEO_ACCEPT_ATTR}
        // Varios de una (2026-08-25): el cupo lo pone `MAX_VIDEOS`, no el picker.
        multiple
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
        canAddVideo={videos.length < MAX_VIDEOS && !measuringVideo}
        onAddPhotos={() => photoInputRef.current?.click()}
        onAddVideo={() => videoInputRef.current?.click()}
        onRemoveMedia={removeMedia}
        maxPhotos={MAX_PHOTOS}
        maxVideos={MAX_VIDEOS}
        onSavePhotoEdit={savePhotoEdit}
        pollEnabled={pollEnabled}
        onPollChange={setPollEnabled}
        videoCategory={videoCategory}
        onVideoCategoryChange={setVideoCategory}
        declaration={declaration}
        onDeclarationChange={setDeclaration}
        previewId={previewId}
        videoUpload={videoUpload}
        measuringVideo={measuringVideo}
        bakingProgress={bakingProgress}
        finishingLabel={finishingLabel}
        isPending={isPending}
        publishBlocked={autoriaBloquea}
        onPublish={submit}
        /**
         * CON QUÉ NOMBRE VA A SALIR (0023). Lo primero de la hoja. Las cuatro
         * situaciones, en orden:
         *  · todavía sin respuesta que importe → una línea que explica por qué
         *    Publicar está apagado;
         *  · no se pudo preguntar → se avisa que sale con el nombre propio;
         *  · sin ninguna ficha propia publicada → NADA (ni el espacio): un
         *    selector de una sola opción estorba, y para esta persona publicar
         *    tiene que seguir siendo exactamente lo que era;
         *  · con fichas → el selector, con la firma activa a la vista.
         */
        autoriaSlot={
          autoriaBloquea ? (
            <AutoriaCargando />
          ) : autoriasFallaron ? (
            <AutoriaNoDisponible />
          ) : autorias && autorias.entidades.length > 0 ? (
            <AutoriaSelector
              personal={autorias.personal}
              entidades={autorias.entidades}
              value={entityId}
              onChange={(listingId) => {
                autoriaTocada.current = true;
                setEntityId(listingId);
              }}
              disabled={isPending}
            />
          ) : undefined
        }
        /**
         * ETIQUETAR PERSONAS (0089) — en los TRES modos. Una pregunta o un
         * texto también pueden hablar de alguien, y `post_tags` no pide medio
         * para existir.
         */
        tagSlot={
          <PeopleTagger
            value={taggedPeople}
            onChange={setTaggedPeople}
            disabled={isPending}
          />
        }
        /**
         * MÚSICA (0090) — SÓLO con foto o video. La insignia de la pista y el
         * sonido viven sobre el medio de la publicación (`card-post-media`):
         * en un texto o una pregunta la canción no tendría ni dónde anunciarse
         * ni sobre qué sonar, y ofrecerla sería prometer algo que no pasa.
         */
        musicSlot={
          media.length > 0 ? (
            <MusicPicker value={track} onChange={setTrack} disabled={isPending} />
          ) : undefined
        }
      />
    </ComposerMenuProvider>
  );
}

// ---------------------------------------------------------------------------
// Subida directa con progreso. supabase-js no expone onprogress (usa fetch):
// hacemos el MISMO request que haría el SDK (POST /storage/v1/object/...)
// con XHR y el token de la sesión — la policy post_media_insert (0025) valida
// el prefijo {tenant}/{user} contra el JWT igual que siempre.
// ---------------------------------------------------------------------------

/**
 * Borra del bucket los videos que YA se subieron cuando la publicación no
 * llega a existir (falló otro video, la guarda de peso, el propio insert).
 *
 * Best-effort a propósito: la policy de delete lo permite y el archivo vive en
 * el prefijo {tenant}/{user} de quien lo subió, así que si esto falla no queda
 * nada visible para nadie — no vale la pena romperle el flujo a la persona por
 * un archivo que ya nadie referencia.
 */
async function removeUploadedVideos(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await createClient().storage.from("post-media").remove([...paths]);
  } catch {
    // sin drama: el archivo queda en el prefijo propio, no es visible
  }
}

async function uploadVideoWithProgress(
  file: File,
  path: string,
  onProgress: (pct: number) => void,
  /**
   * Content-Type CANÓNICO del contenedor (ver `checkVideoFile` en
   * `video-upload-limits.ts`), no `file.type` crudo: algunos navegadores
   * reportan vacío para formatos poco comunes (.3gp, .mkv en ciertos
   * Android), y mandar ese vacío mentiría sobre qué es el archivo en Storage.
   */
  contentType: string,
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
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");
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
