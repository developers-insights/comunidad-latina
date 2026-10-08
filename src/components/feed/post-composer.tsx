"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { uploadVideoWithProgress } from "@/lib/media/upload-video";
import { createStallWatchdog, createUploadLimiter } from "@/lib/media/upload-queue";
import { TENANT_GUARD_COPY } from "@/lib/tenant/match";
import { CreateMenu, type QuickPostKind } from "@/components/shell/create-menu";
import { ComposerMenuProvider } from "./composer-context";
import { readVideoIntro } from "@/lib/media/measure-video";
import { encodeAudioPcm16, sampleAudioPcm } from "@/lib/media/audio-samples";
import { sampleVideoLumaFrames } from "@/lib/media/video-frames";
import {
  DEFAULT_VIDEO_CATEGORY,
  checkVideoDuration,
  type VideoCategory,
} from "@/lib/media/video-policy";
import {
  VIDEO_POSTER_CONTENT_TYPE,
  VIDEO_POSTER_EXTENSION,
  checkVideoFile,
  formatVideoTooBigMessage,
  videoAcceptFor,
  videoWrongTypeMessageFor,
  type VideoUploadRoute,
} from "@/lib/media/video-upload-limits";
import { requestMuxUpload, type MuxUploadTicket } from "@/lib/media/mux-video";
import { startMuxUpload, type MuxUploadHandle } from "@/components/video/mux-upload";
// Sólo el TIPO: quien pinta el panel es `ComposerSheet` (recibe el objeto por
// prop). Este archivo es el dueño del estado, no de su presentación.
import type { VideoUploadProgress } from "@/components/video/upload-progress";
import { VIDEO_COPY } from "@/components/video/copy";
import {
  EMPTY_DECLARATION_VALUE,
  type DeclarationValue,
} from "@/components/integrity/originality-fields";
import { creditoDesdeDeclaracion } from "@/lib/feed/creditos-de-foto";
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
  MAX_AUDIO_PCM_CHARS,
  MAX_PHOTOS,
  MAX_PICKED_PHOTO_BYTES,
  MAX_TOTAL_AUDIO_PCM_CHARS,
  checkPhotoPayload,
  fitAudioTracks,
  maxVideosPerPost,
  predictedAudioPcmChars,
} from "@/lib/media/post-media-limits";
/**
 * FORMATOS DE FOTO: importados, nunca escritos acá — mismo criterio que el
 * cupo. Este archivo tenía su propia lista de tres MIME (jpeg/png/webp) y por
 * eso HEIC —el default de cualquier iPhone— rebotaba antes de llegar a nada.
 * El porqué del camino elegido está en el docblock de `photo-input.ts`.
 */
import {
  PHOTO_FILE_ACCEPT,
  checkPickedPhoto,
  probePhotoDecodable,
  type PhotoInputRejection,
} from "@/lib/media/photo-input";
import type { TextBackgroundId } from "@/lib/feed/text-backgrounds";
import {
  ComposerSheet,
  type ComposerMode,
  type ComposerVideoUpload,
} from "./composer-sheet";
import {
  DEFAULT_PHOTO_FILTER_ID,
  DEFAULT_PHOTO_FILTER_INTENSITY,
} from "@/lib/media/photo-filters";
import { DEFAULT_PHOTO_EDIT, photoEditFilterCss, type PhotoEdit } from "./photo-editor";
import { COPY } from "./copy";
/**
 * DETECCIÓN AUTOMÁTICA DEL TIPO DE PUBLICACIÓN (frente E, pedido del cliente:
 * "el sistema debe identificar automáticamente el tipo de publicación y
 * enviarla al módulo correspondiente"). Módulo PURO — sin React, sin red — ver
 * su docblock para el criterio completo. Acá sólo se consume.
 */
import {
  detectarTipoDePublicacion,
  type SugerenciaComposer,
} from "@/lib/composer/deteccion";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { ArrowRight, X } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

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
   * PRIMER CUADRO DEL VIDEO como JPEG (0132), capturado en `selectVideo` en la
   * MISMA apertura del archivo que midió la duración. `null` = el navegador no
   * pudo decodificarlo, y no pasa nada: la publicación sigue igual y el video se
   * pinta con el respaldo de siempre.
   *
   * Se guarda acá y no se recalcula al publicar porque abrir el archivo es lo
   * caro: son hasta 200 MB decodificándose en un teléfono, y hacerlo dos veces
   * para preguntarle dos cosas al mismo archivo sería pagar ese precio al pepe.
   */
  posterBlob?: Blob | null;
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
  /** Subida anticipada al bucket (videos que no van por Mux). */
  upload?: ComposerVideoUpload;
}

interface BucketUpload {
  path: string;
  controller: AbortController;
  /**
   * Resultado crudo del XHR. Puede ser `true` aunque después se haya abortado
   * (terminó justo antes): es el que decide si hay un archivo que borrar.
   */
  uploaded: Promise<boolean>;
  /** `false` si falló o se abortó: es el que espera publicar. */
  done: Promise<boolean>;
}

interface VideoFingerprints {
  frames: number[][][];
  audio: (string | null)[];
}

type PrepareMediaUpload = Awaited<ReturnType<typeof prepareMediaUploadAction>>;

/** Subidas simultáneas al bucket; las demás esperan turno sin ocupar red. */
const MAX_CONCURRENT_VIDEO_UPLOADS = 3;
/** Sin un evento de progreso en este plazo la subida se da por trabada. */
const VIDEO_UPLOAD_STALL_MS = 90_000;

export interface PostComposerHostProps {
  /** `tenants.modules` / `modules_soon`: filtran los tiles del menú de crear. */
  modules: Record<string, boolean>;
  modulesSoon: Record<string, boolean>;
  /**
   * ¿ESTE ENTORNO TIENE MUX? Lo decide el SERVIDOR y llega como prop desde
   * `(app)/layout.tsx`: `muxEnabled={isMuxConfigured}`, el mismo patrón con el
   * que ya degrada Stripe en este repo.
   *
   * POR QUÉ NO SE AVERIGUA ACÁ: `isMuxConfigured` es `Boolean(process.env
   * .MUX_TOKEN_ID)`, una variable de servidor que el navegador no ve. Y por qué
   * hace falta ANTES de abrir el selector de archivos: el atributo `accept` del
   * input se decide en ese instante, y es justamente lo que el cliente reportó
   * roto ("no te deja subir cualquier tipo de video" — los .mov en gris). Con
   * Mux, `accept` es `video/*` y no hay nada gris; sin Mux, sigue siendo la
   * lista de tres formatos que el bucket y el navegador aguantan.
   *
   * DEFAULT `false` A PROPÓSITO. Mientras nadie pase la prop, el composer se
   * comporta EXACTAMENTE como el día anterior a esta feature: mismo `accept`,
   * mismo tope del bucket (`MAX_VIDEO_BYTES`), misma subida al bucket. La bandera no es la única
   * defensa igual — aunque llegue en `true`, si `/api/mux/subida` contesta 503
   * la subida cae al bucket en silencio (ver `selectVideo`).
   */
  muxEnabled?: boolean;
  children: ReactNode;
}

/**
 * COPY DEL CHIP DE SUGERENCIA — sólo lo que es IGUAL sin importar el tipo
 * detectado. La etiqueta de cada tipo ("¿Tenés una vacante?", etc.) no vive
 * acá: es parte de la propia `SugerenciaComposer` que devuelve
 * `detectarTipoDePublicacion` (`@/lib/composer/deteccion.ts`). Este objeto NO
 * vive en `./copy.ts` — ese archivo es de otro frente en este reparto de
 * trabajo y esta tarea tiene prohibido tocarlo; dos strings no ameritan pedir
 * ese cambio para después.
 */
const COMPOSER_SUGGESTION_TEXT = {
  cerrar: "Cerrar la sugerencia",
  /**
   * Sólo se muestra con más de 80 caracteres YA escritos (ver `avisoLargo` en
   * `PostComposerHost`) — recién ahí hay algo real que perder. Es un aviso en
   * texto, no una segunda confirmación: lo que se pierde es un borrador de
   * texto en un composer, no una publicación ni un cobro, y esta misma
   * sugerencia existe para mandar a la persona a ESE formulario — pedirle un
   * toque extra para hacer lo que ya eligió sería fricción sin ninguna
   * protección real detrás (decisión de criterio UX de este frente).
   */
  avisoTextoPerdido: "Vas a empezar el formulario vacío — este texto no se copia.",
} as const;

/**
 * CHIP DE SUGERENCIA DEL COMPOSER GENÉRICO (frente E). Vive en ESTE archivo y
 * no en `composer-sheet.tsx` a propósito: ese archivo pertenece a otro frente
 * del mismo reparto de trabajo y esta tarea tiene prohibido tocarlo. La única
 * forma de ubicar este chip pegado al textarea SIN editarlo es una ranura que
 * ya existe para eso — `musicSlot`/`tagSlot` de `ComposerSheetProps`, pensadas
 * explícitamente como "ranuras para otros frentes" — así que este chip viaja
 * DENTRO de `musicSlot` en el JSX de más abajo, junto a (o en lugar de)
 * `MusicPicker`: es la ranura que la hoja pinta última, inmediatamente arriba
 * del campo de texto, en los TRES modos (media/pregunta/texto) — incluso sin
 * medio elegido, que es el caso más común para este chip (alguien tipeando
 * "se alquila…" como texto plano, sin foto). Es un préstamo de UBICACIÓN, no
 * de dueño: si `composer-sheet.tsx` suma alguna vez una ranura propia para
 * sugerencias, este chip se muda ahí sin cambiar su lógica.
 *
 * Nunca bloquea Publicar (no toca `canPublish`) y nunca navega ni cierra nada
 * por su cuenta — cada botón es una decisión de la persona, no del sistema.
 */
function ComposerSuggestionChip({
  sugerencia,
  avisoLargo,
  onNavigate,
  onDismiss,
}: {
  sugerencia: SugerenciaComposer;
  /** El pie YA escrito supera ~80 caracteres: hay algo real que se perdería. */
  avisoLargo: boolean;
  onNavigate: () => void;
  onDismiss: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <m.div
      // `key` en el tipo detectado (lo arma quien llama, ver `musicSlot` más
      // abajo): si la sugerencia CAMBIA de tipo mientras la persona sigue
      // escribiendo, motion la trata como salida+entrada en vez de un cambio
      // de texto a mitad de animación — se lee como "otra sugerencia", no
      // como un parpadeo de la misma.
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, height: "auto" }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
      className="overflow-hidden"
    >
      <div className="mt-0.5 flex items-start gap-1 rounded-xl border border-brand-subtle bg-brand-tint py-1 pl-3 pr-1">
        <button
          type="button"
          onClick={onNavigate}
          className={cn(
            "flex min-h-10 flex-1 items-center gap-1.5 rounded-lg py-1 text-left",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-brand-ink">{sugerencia.etiqueta}</span>
            {avisoLargo && (
              <span className="mt-0.5 block text-xs font-normal text-brand-ink/75">
                {COMPOSER_SUGGESTION_TEXT.avisoTextoPerdido}
              </span>
            )}
          </span>
          <ArrowRight size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-ink" />
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={COMPOSER_SUGGESTION_TEXT.cerrar}
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full text-brand-ink/70",
            "transition-colors duration-(--duration-fast) hover:bg-brand/15 hover:text-brand-ink",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          <X size={14} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </m.div>
  );
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
 * body de las server actions), con progreso real vía XHR, arrancando apenas se
 * elige cada video (no al publicar). El prefijo
 * {tenant}/{user} del path lo entrega el SERVER (prepareMediaUploadAction) —
 * nunca se confía en el cliente — y la policy 0025 lo re-valida al subir.
 *
 * GOTCHA Next 16/React 19 (memoria del proyecto, fix 21ce281): un FileList
 * leído dentro de un updater/callback diferido llega VACÍO. `selectPhotos` /
 * `selectVideo` copian `input.files` SINCRÓNICAMENTE en el handler, antes de
 * cualquier setState.
 */
export function PostComposerHost({
  modules,
  modulesSoon,
  muxEnabled = false,
  children,
}: PostComposerHostProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<PickedMedia[]>([]);
  /**
   * Progreso de subida del video (null = sin subida en curso). Es el MISMO
   * estado para los dos caminos —el XHR al bucket y UpChunk contra Mux— porque
   * lo que la persona ve tiene que ser lo mismo: una barra que avanza de verdad.
   * Lo que cambia entre los dos es qué se puede hacer con esa espera: la de Mux
   * se puede cancelar y sobrevive a un corte de red; la del bucket, no.
   */
  const [videoUpload, setVideoUpload] = useState<VideoUploadProgress | null>(null);
  /**
   * ---- LA SESIÓN DE MUX --------------------------------------------------
   *
   * `muxTicket` es lo que devolvió `POST /api/mux/subida`: el permiso de subida
   * y el borrador de publicación que el backend ya creó. Su presencia ES la
   * señal de que este video va por Mux; `null` significa "camino de siempre".
   *
   * `muxSubido` se enciende cuando UpChunk terminó de mandar el archivo entero.
   * Publicar espera a que esté en `true` — no porque falte transcodificar (eso
   * pasa DESPUÉS y no bloquea nada), sino porque el archivo tiene que haber
   * llegado. Es la única espera inevitable de todo el flujo.
   *
   * `muxHandleRef` guarda el control de la subida en curso para poder cortarla:
   * lo usan el botón de cancelar, quitar el video, y cerrar el composer.
   */
  const [muxTicket, setMuxTicket] = useState<MuxUploadTicket | null>(null);
  const [muxSubido, setMuxSubido] = useState(false);
  const muxHandleRef = useRef<MuxUploadHandle | null>(null);
  /**
   * Subidas al bucket, por id del medio. Arrancan al ELEGIR el video (no al
   * publicar) para que corran mientras la persona escribe.
   */
  const bucketUploadsRef = useRef(new Map<string, BucketUpload>());
  /** Medios ya quitados: una subida que llega tarde no debe arrancar para ellos. */
  const discardedMediaIdsRef = useRef(new Set<string>());
  /**
   * Selecciones cuyo `prepareMediaUploadAction` todavía no volvió. Publicar las
   * espera: si no, no encuentra la subida en el Map, arranca otra para el mismo
   * video y la primera queda huérfana.
   */
  const pendingSelectionsRef = useRef(new Set<Promise<void>>());
  const uploadLimiterRef = useRef(createUploadLimiter(MAX_CONCURRENT_VIDEO_UPLOADS));
  /** Qué se espera de los videos al publicar, o null. */
  const [videoStatusLabel, setVideoStatusLabel] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Hoja de texto abierta y en qué modo (null = cerrada). */
  const [composeMode, setComposeMode] = useState<ComposerMode | null>(null);
  /** Encuesta Sí/No de la pregunta (contrato 0041). */
  const [pollEnabled, setPollEnabled] = useState(false);
  /**
   * Fondo elegido de una publicación de TEXTO (0128). `null` = Automático, que
   * es como arranca y como se publicaba todo hasta ahora: el banner sortea uno
   * por el id del post.
   */
  const [textBackground, setTextBackground] = useState<TextBackgroundId | null>(null);
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
   * Si el host se desmonta con un borrador a medio armar (salir del shell de la
   * app), sus videos ya no se pueden publicar: se abortan y se borran.
   * `pagehide` NO se usa a propósito: con bfcache la pestaña puede volver con
   * el borrador intacto apuntando a archivos ya borrados, y un DELETE de
   * supabase-js no viaja con `keepalive`, así que al cerrar la pestaña se
   * cortaría igual. Esos quedan huérfanos en el prefijo propio.
   */
  useEffect(() => {
    const uploads = bucketUploadsRef.current;
    return () => {
      for (const entry of uploads.values()) {
        entry.controller.abort();
        void entry.uploaded.then((ok) => {
          if (ok) void removeFromPostMedia([entry.path]);
        });
      }
      uploads.clear();
    };
  }, []);

  /**
   * ---- SUGERENCIA DE TIPO DE PUBLICACIÓN (frente E) ------------------------
   *
   * `bodyDebounced` sigue a `body` con ~500 ms de atraso: `body` cambia en
   * cada tecla y correr la heurística en cada una es trabajo de sobra por
   * nada que se vea distinto (nadie lee un chip que titila letra a letra).
   *
   * `sugerenciaCerrada` es el "una vez cerrado no vuelve a aparecer EN ESTA
   * SESIÓN del composer" del pedido. Se resetea en el efecto de más abajo,
   * que mira la transición `composeMode: null → algo` — o sea, se re-arma
   * cuando la hoja pasa de CERRADA a ABIERTA, nunca en cada re-render con la
   * hoja ya abierta. Esto último importa: `openCompose("media")` se vuelve a
   * llamar cada vez que se agrega una foto o un video con la hoja YA abierta
   * (ver `selectPhotos`/`selectVideo`), y `composeMode` pasando de "media" a
   * "media" no dispara el efecto (React compara por valor) — así que agregar
   * una segunda foto no resucita un chip que la persona ya cerró.
   */
  const [bodyDebounced, setBodyDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setBodyDebounced(body), 500);
    return () => clearTimeout(id);
  }, [body]);
  const [sugerenciaCerrada, setSugerenciaCerrada] = useState(false);
  useEffect(() => {
    // `setState` síncrono dentro de un efecto encadena renders
    // (react-hooks/set-state-in-effect) — se difiere a un frame, mismo
    // patrón que `useKeyboardInset` en `@/components/ui/bottom-sheet.tsx`.
    if (composeMode === null) return;
    const raf = requestAnimationFrame(() => setSugerenciaCerrada(false));
    return () => cancelAnimationFrame(raf);
  }, [composeMode]);
  const sugerenciaComposer = useMemo<SugerenciaComposer | null>(
    () => (sugerenciaCerrada ? null : detectarTipoDePublicacion(bodyDebounced)),
    [bodyDebounced, sugerenciaCerrada],
  );

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

  /**
   * ESPERANDO QUE EL ARCHIVO TERMINE DE LLEGAR A MUX. Es la única espera que
   * queda en todo el flujo, y es inevitable: no se puede publicar un video que
   * todavía no subió.
   *
   * Ojo con lo que NO es: NO es esperar a que Mux termine de transcodificar.
   * Eso pasa después, tarda mucho más, y la publicación no lo espera — sale
   * igual y la tarjeta muestra "preparando" hasta que esté (ver
   * `video-status-card.tsx`). Confundir las dos esperas sería volver a dejar a
   * la persona mirando una pantalla durante minutos.
   *
   * El botón no queda mudo: el panel de progreso está a la vista, con el
   * porcentaje, los megabytes y su botón de cancelar.
   */
  const esperandoSubidaMux = muxTicket !== null && !muxSubido;

  /** Las dos razones por las que Publicar puede estar apagado sin faltar texto. */
  const publicarBloqueado = autoriaBloquea || esperandoSubidaMux;

  const photos = media.filter((item) => item.kind === "photo");
  const videos = media.filter((item) => item.kind === "video");
  const maxVideos = maxVideosPerPost(muxEnabled);

  /**
   * Lee el FileList VIVO del input de fotos de forma SÍNCRONA (gotcha de
   * arriba) y agrega hasta completar el cupo de {@link MAX_PHOTOS}, validando
   * tipo, peso y —desde el 2026-08-26— que el navegador PUEDA ABRIR el archivo.
   * Elegido al menos un archivo, se abre la hoja de texto: la foto y su pie
   * pasan a ser un solo paso.
   *
   * ES ASÍNCRONA POR LA TERCERA PRUEBA, y el orden importa: tipo y peso son
   * instantáneos y no gastan memoria, así que van primero; decodificar es lo
   * caro y sólo se hace sobre lo que ya pasó las otras dos. El FileList se lee
   * en la PRIMERA línea, antes de cualquier `await`: `input.value = ""` lo
   * vacía, y leerlo después de un await devolvería una lista vacía (mismo
   * gotcha que documenta `selectVideo`).
   *
   * POR QUÉ SE DECODIFICA ACÁ Y NO AL PUBLICAR: un HEIC que este navegador no
   * sabe abrir (Chrome en Android, con una foto que llegó de un iPhone) pasaba
   * la puerta del tipo, moría adentro de `bakePhoto` —que devuelve el original
   * cuando no puede hornear— y terminaba rechazado por el servidor con un
   * código genérico, después de escribir el pie y tocar Publicar. Enterarse en
   * el momento de elegir, y con el motivo real, es la diferencia entre "probá
   * con otra" y "no se pudo publicar" sobre una foto que se ve perfecta en la
   * galería.
   */
  async function selectPhotos(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) return;

    const accepted: PickedMedia[] = [];
    let photoCount = photos.length;
    let rejectedLimit = false;
    /** El PRIMER motivo de rechazo. Un solo aviso, el más útil: una ráfaga de
     *  cuatro toasts al elegir cinco fotos no la lee nadie. */
    let rejection: PhotoInputRejection | null = null;
    const note = (reason: PhotoInputRejection) => {
      if (!rejection) rejection = reason;
    };

    for (const file of files) {
      if (photoCount >= MAX_PHOTOS) {
        rejectedLimit = true;
        break;
      }
      const basics = checkPickedPhoto(file, MAX_PICKED_PHOTO_BYTES);
      if (!basics.ok) {
        note(basics.reason);
        continue;
      }
      const decodable = await probePhotoDecodable(file);
      if (!decodable.ok) {
        note(decodable.reason);
        continue;
      }
      accepted.push({
        id: crypto.randomUUID(),
        kind: "photo",
        file,
        preview: URL.createObjectURL(file),
        // Sin recorte, sin filtro, sin texto — pero YA presente: el horneado de
        // abajo lee este objeto para CADA foto al publicar, la haya editado o no.
        edit: { ...DEFAULT_PHOTO_EDIT },
      });
      photoCount += 1;
    }

    if (accepted.length > 0) {
      setMedia((current) => [...current, ...accepted]);
      openCompose("media");
    }

    if (rejectedLimit) {
      toast({ title: COPY.composer.photoLimit, variant: "warning" });
      return;
    }
    if (!rejection) return;
    // Cada motivo dice qué HACER, no qué salió mal. El de HEIC además evita
    // decir que la foto está rota: no lo está, y quien la ve bien en su galería
    // no le creería a un mensaje que le diga lo contrario.
    const aviso: Record<PhotoInputRejection, Parameters<typeof toast>[0]> = {
      type: { title: COPY.composer.photoWrongType, variant: "warning" },
      size: { title: COPY.composer.photoTooBig, variant: "warning" },
      heic: {
        title: COPY.composer.photoHeicTitle,
        description: COPY.composer.photoHeicBody,
        variant: "warning",
        duration: 9000,
      },
      decode: {
        title: COPY.composer.photoUnreadableTitle,
        description: COPY.composer.photoUnreadableBody,
        variant: "warning",
        duration: 9000,
      },
    };
    toast(aviso[rejection]);
  }

  /**
   * Mismo patrón síncrono que las fotos (el FileList se lee antes del primer
   * await) y EL TOPE DE 90 s por video (spec nº4), medido acá antes de subir un
   * byte. Acepta varios archivos hasta `maxVideosPerPost(muxEnabled)`: 10 por el
   * bucket, 1 con Mux (`posts` guarda un solo video de Mux).
   *
   * El orden por archivo evita gastar datos, un viaje al servidor o un borrador
   * de Mux en un video que se va a rechazar: tipo y peso → duración → recién ahí
   * el permiso de Mux, que CREA un borrador en la base.
   */
  async function selectVideo(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) return;

    const limitMessage =
      maxVideos > 1 ? COPY.composer.videoLimit : COPY.composer.videoLimitSingle;
    let slots = maxVideos - videos.length;
    if (slots <= 0) {
      toast({ title: limitMessage, variant: "warning" });
      return;
    }

    const rutaProbable: VideoUploadRoute = muxEnabled ? "mux" : "bucket";
    const accepted: PickedMedia[] = [];
    let ticket: MuxUploadTicket | null = null;
    let rejectedLimit = false;
    /** Un solo aviso, el del primer archivo rechazado. */
    let rejection: Parameters<typeof toast>[0] | null = null;
    const fileRejection = (reason: string, file: File, route: VideoUploadRoute) => ({
      title:
        reason === "type"
          ? videoWrongTypeMessageFor(route)
          : formatVideoTooBigMessage(file.size, route),
      variant: "warning" as const,
      duration: 8000,
    });

    setMeasuringVideo(true);
    try {
      for (const file of files) {
        if (slots <= 0) {
          rejectedLimit = true;
          break;
        }
        const chequeoInicial = checkVideoFile(file, rutaProbable);
        if (!chequeoInicial.ok) {
          rejection ??= fileRejection(chequeoInicial.reason, file, rutaProbable);
          continue;
        }

        // Duración y primer cuadro en UNA apertura del archivo. El poster se
        // captura incluso con Mux: si Mux contesta 503 el archivo cae al bucket,
        // que es justo el caso que lo necesita.
        const intro = await readVideoIntro(file);
        const duration = checkVideoDuration("short_video", intro.durationSeconds);
        if (!duration.ok && duration.reason === "too-long") {
          rejection ??= {
            title: COPY.composer.videoTooLongTitle,
            description: COPY.composer.videoTooLongBody,
            variant: "warning",
            duration: 9000,
          };
          continue;
        }

        // Un 503 de Mux (a medias, clave rotada) devuelve la ruta del bucket sin
        // que la persona se entere.
        let route: VideoUploadRoute = "bucket";
        if (muxEnabled) {
          const pedido = await requestMuxUpload();
          if (pedido.ok) {
            ticket = pedido.ticket;
            route = "mux";
          }
        }
        const fileCheck = route === rutaProbable ? chequeoInicial : checkVideoFile(file, route);
        if (!fileCheck.ok) {
          rejection ??= fileRejection(fileCheck.reason, file, route);
          continue;
        }
        // Por Mux una duración desconocida no frena: la mide Mux y vuelve por el
        // webhook. Por el bucket sí, porque el `<video>` del feed tampoco va a
        // poder abrir el archivo que el composer no pudo.
        if (!duration.ok && route === "bucket") {
          rejection ??= {
            title: COPY.composer.videoUnknownDurationTitle,
            description: COPY.composer.videoUnknownDurationBody,
            variant: "warning",
            duration: 8000,
          };
          continue;
        }

        accepted.push({
          id: crypto.randomUUID(),
          kind: "video",
          file,
          preview: URL.createObjectURL(file),
          durationSeconds: duration.ok ? duration.seconds : undefined,
          videoExtension: fileCheck.extension,
          videoContentType: fileCheck.mimeType,
          posterBlob: intro.poster,
          edit: { ...DEFAULT_PHOTO_EDIT },
        });
        slots -= 1;
      }
    } finally {
      setMeasuringVideo(false);
    }

    if (accepted.length > 0) {
      setMedia((current) => [...current, ...accepted]);
      openCompose("media");
    }

    if (ticket && accepted[0]) {
      startMuxVideoUpload(ticket, accepted[0].file);
    } else if (accepted.length > 0) {
      void startBucketUploads(accepted);
    }

    if (rejectedLimit) {
      toast({ title: limitMessage, variant: "warning" });
    } else if (rejection) {
      toast(rejection);
    }
  }

  /**
   * La subida a Mux arranca al elegir, no al publicar: pueden ser cientos de
   * megas en 4G y así corren mientras la persona escribe.
   */
  function startMuxVideoUpload(ticket: MuxUploadTicket, file: File) {
    setMuxTicket(ticket);
    setMuxSubido(false);
    setVideoUpload({ pct: 0, uploadedBytes: 0, totalBytes: file.size, offline: false });
    muxHandleRef.current = startMuxUpload(
      { uploadUrl: ticket.uploadUrl, file },
      {
        onProgress: (pct, uploadedBytes) =>
          setVideoUpload((actual) =>
            actual ? { ...actual, pct, uploadedBytes, offline: false } : actual,
          ),
        onOffline: () =>
          setVideoUpload((actual) => (actual ? { ...actual, offline: true } : actual)),
        onOnline: () =>
          setVideoUpload((actual) => (actual ? { ...actual, offline: false } : actual)),
        onSuccess: () => {
          muxHandleRef.current = null;
          setMuxSubido(true);
          setVideoUpload(null);
        },
        onError: () => {
          muxHandleRef.current = null;
          setVideoUpload(null);
          toast({
            title: VIDEO_COPY.subida.falloTitulo,
            description: VIDEO_COPY.subida.falloCuerpo,
            variant: "danger",
            duration: 9000,
          });
        },
      },
    );
  }

  function patchVideoUpload(id: string, upload: ComposerVideoUpload) {
    setMedia((current) =>
      current.map((item) => (item.id === id ? { ...item, upload } : item)),
    );
  }

  function startBucketUpload(
    item: PickedMedia,
    owner: { tenantId: string; userId: string },
    notifyOnError: boolean,
  ): Promise<boolean> {
    const extension = item.videoExtension ?? "mp4";
    const path = `${owner.tenantId}/${owner.userId}/video-${crypto.randomUUID()}.${extension}`;
    const controller = new AbortController();
    let lastPct = -1;
    patchVideoUpload(item.id, { status: "uploading", pct: 0 });
    const limiter = uploadLimiterRef.current;
    const uploaded = (async () => {
      if (!(await limiter.acquire(controller.signal))) return false;
      // Un AbortController propio por intento: el watchdog corta el XHR sin
      // marcar el video como quitado, así queda en error y publicar lo reintenta.
      const attempt = new AbortController();
      const forwardAbort = () => attempt.abort();
      controller.signal.addEventListener("abort", forwardAbort, { once: true });
      const watchdog = createStallWatchdog(VIDEO_UPLOAD_STALL_MS, () => attempt.abort());
      watchdog.poke();
      try {
        return await uploadVideoWithProgress(
          item.file,
          path,
          (pct) => {
            watchdog.poke();
            if (pct === lastPct || controller.signal.aborted) return;
            lastPct = pct;
            patchVideoUpload(item.id, { status: "uploading", pct });
          },
          item.videoContentType ?? item.file.type,
          attempt.signal,
        );
      } finally {
        watchdog.stop();
        controller.signal.removeEventListener("abort", forwardAbort);
        limiter.release();
      }
    })();
    const done = uploaded.then((ok) => {
      if (controller.signal.aborted) return false;
      patchVideoUpload(item.id, ok ? { status: "done", pct: 100 } : { status: "error", pct: 0 });
      if (!ok && notifyOnError) {
        toast({
          title: COPY.composer.videoUploadRetryTitle,
          description: COPY.composer.videoUploadRetryBody,
          variant: "warning",
          duration: 9000,
        });
      }
      return ok;
    });
    bucketUploadsRef.current.set(item.id, { path, controller, uploaded, done });
    return done;
  }

  /**
   * Un solo `prepareMediaUploadAction` por selección: el prefijo
   * {tenant}/{user} lo dicta el servidor. Si falla, los videos quedan marcados
   * y publicar lo reintenta — ahí sí con el motivo a la vista.
   */
  function startBucketUploads(items: PickedMedia[]): Promise<void> {
    const selection = (async () => {
      let prepared: PrepareMediaUpload | null = null;
      try {
        prepared = await prepareMediaUploadAction();
      } catch {
        prepared = null;
      }
      for (const item of items) {
        if (discardedMediaIdsRef.current.has(item.id)) continue;
        // Publicar pudo haberla arrancado mientras este prepare viajaba.
        if (bucketUploadsRef.current.has(item.id)) continue;
        if (prepared?.ok) startBucketUpload(item, prepared, true);
        else patchVideoUpload(item.id, { status: "error", pct: 0 });
      }
    })();
    pendingSelectionsRef.current.add(selection);
    void selection.finally(() => pendingSelectionsRef.current.delete(selection));
    return selection;
  }

  /** Aborta la subida y, si el archivo llegó a quedar arriba, lo borra. */
  function discardBucketUpload(id: string) {
    discardedMediaIdsRef.current.add(id);
    const entry = bucketUploadsRef.current.get(id);
    if (!entry) return;
    bucketUploadsRef.current.delete(id);
    entry.controller.abort();
    void entry.uploaded.then((ok) => {
      if (ok) void removeFromPostMedia([entry.path]);
    });
  }

  /**
   * Al publicar: espera las subidas en vuelo y reintenta UNA vez las que
   * fallaron. Devuelve las rutas en el orden de `items`.
   */
  async function ensureBucketUploads(
    items: PickedMedia[],
  ): Promise<{ ok: true; paths: string[] } | { ok: false; handled: boolean }> {
    const total = items.length;
    const waitAll = async (promises: Promise<boolean>[]) => {
      let done = total - promises.length;
      setVideoStatusLabel(COPY.composer.videosFinishingUpload(done, total));
      return Promise.all(
        promises.map((promise) =>
          promise.then((ok) => {
            if (ok) done += 1;
            setVideoStatusLabel(
              done === total
                ? COPY.composer.videosPreparing(total)
                : COPY.composer.videosFinishingUpload(done, total),
            );
            return ok;
          }),
        ),
      );
    };

    await Promise.all([...pendingSelectionsRef.current]);
    const firstPass = await waitAll(
      items.map((item) => bucketUploadsRef.current.get(item.id)?.done ?? Promise.resolve(false)),
    );
    const failed = items.filter((_, index) => !firstPass[index]);

    if (failed.length > 0) {
      let prepared: PrepareMediaUpload | null = null;
      try {
        prepared = await prepareMediaUploadAction();
      } catch {
        prepared = null;
      }
      if (!prepared?.ok) {
        if (prepared?.code === "unauthenticated") {
          router.push("/entrar?next=/feed");
          return { ok: false, handled: true };
        }
        if (prepared?.code === "tenant-mismatch") {
          toast({
            title: TENANT_GUARD_COPY.mismatchTitle,
            description: prepared.message,
            variant: "warning",
            duration: 8000,
          });
          return { ok: false, handled: true };
        }
        return { ok: false, handled: false };
      }
      const owner = prepared;
      const retry = await waitAll(failed.map((item) => startBucketUpload(item, owner, false)));
      if (retry.some((ok) => !ok)) return { ok: false, handled: false };
    }

    const paths = items.map((item) => bucketUploadsRef.current.get(item.id)?.path);
    if (paths.some((path) => !path)) return { ok: false, handled: false };
    return { ok: true, paths: paths as string[] };
  }

  /**
   * Corta la subida a Mux que esté en vuelo y limpia su rastro. Lo llaman el
   * botón de cancelar, quitar el video del borrador y cerrar el composer: los
   * tres significan lo mismo para el archivo que está viajando.
   */
  function cancelMuxUpload() {
    muxHandleRef.current?.cancel();
    muxHandleRef.current = null;
    setVideoUpload(null);
    setMuxTicket(null);
    setMuxSubido(false);
  }

  function removeMedia(id: string) {
    const found = media.find((item) => item.id === id);
    if (!found) return;
    URL.revokeObjectURL(found.preview);
    // Quitar un video CORTA su subida: si no, el archivo seguiría viajando
    // —gastando los datos de la persona— por algo que ya no se va a publicar.
    if (found.kind === "video") {
      if (muxTicket) cancelMuxUpload();
      else discardBucketUpload(id);
    }
    setMedia((current) => current.filter((item) => item.id !== id));
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

  /**
   * `keepUploads`: al publicar bien, los videos ya subidos son de la
   * publicación. En cualquier otro cierre del borrador se abortan y se borran.
   */
  function resetForm({ keepUploads = false }: { keepUploads?: boolean } = {}) {
    setBody("");
    setComposeMode(null);
    setPollEnabled(false);
    // El fondo es de ESTA publicación: arrastrarlo a la siguiente pintaría de
    // Fiesta un texto que nadie eligió pintar así.
    setTextBackground(null);
    setVideoCategory(DEFAULT_VIDEO_CATEGORY);
    // Si quedaba una subida a Mux en vuelo (se cerró el composer, se descartó el
    // borrador), se corta acá: nada de archivos viajando para una publicación
    // que ya no existe.
    cancelMuxUpload();
    if (keepUploads) {
      bucketUploadsRef.current.clear();
    } else {
      // También los que todavía esperan su prepare: no están en el Map y sin
      // esta marca su subida arrancaría igual.
      for (const item of media) if (item.kind === "video") discardBucketUpload(item.id);
      for (const id of [...bucketUploadsRef.current.keys()]) discardBucketUpload(id);
    }
    setVideoStatusLabel(null);
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

  /** Se cierra el chip a mano — no vuelve a aparecer en esta sesión del composer. */
  function cerrarSugerenciaComposer() {
    setSugerenciaCerrada(true);
  }

  /**
   * Se tocó el chip: la persona ELIGIÓ ir al formulario correcto. Los
   * formularios destino (`/publicar`, `/empleos/publicar`,
   * `/marketplace/publicar`) no aceptan prefill hoy — no hay forma de
   * pasarles este texto — así que lo honesto es tratar esto como abandonar EL
   * borrador actual, no dejarlo a medio camino: `resetForm()` cierra la hoja,
   * corta cualquier subida a Mux en vuelo (si había un video adjunto) y
   * limpia texto/medios, y RECIÉN AHÍ se navega. Sin este orden, la hoja
   * quedaría abierta y flotando ARRIBA de la pantalla nueva (este composer
   * vive en el shell, por encima de toda la app) y un video seguiría
   * subiendo en segundo plano para una publicación que la persona ya
   * decidió no hacer.
   */
  function irASugerenciaComposer() {
    if (!sugerenciaComposer) return;
    const href = sugerenciaComposer.href;
    resetForm();
    router.push(href);
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
    if (publicarBloqueado) return;

    // Regla "todo post lleva imagen" (trigger MEDIA_REQUIRED 0023, exenta para
    // pregunta y texto): acá no hace falta reaccionar — ComposerSheet ya
    // mantiene su botón de Publicar apagado en modo `media` sin medio elegido,
    // así que esta función nunca se llama en ese estado.

    startTransition(async () => {
      // ---- 1) Videos: esperar las subidas y sacar las huellas -------------
      //
      // Las huellas perceptuales (Content Integrity) se muestrean acá y no en
      // el servidor porque el servidor nunca abre el video: sacarle fotogramas
      // pediría ffmpeg en una función serverless. De a un video por vez —son
      // decodificaciones sobre el hilo principal— y en paralelo a la espera de
      // las subidas. Si una falla vuelve vacía y el pipeline la lee como "no se
      // pudo analizar" → revisión humana; nunca frena la publicación.
      const videoItems = media.filter((item) => item.kind === "video");
      const muxVideo = muxTicket ? (videoItems[0] ?? null) : null;
      if (muxVideo && !muxSubido) return;

      const videoPaths: string[] = [];
      let videoPosterPath: string | null = null;
      let fingerprints: VideoFingerprints = { frames: [], audio: [] };

      if (videoItems.length > 0 && !muxTicket) {
        const [uploads, sampled] = await Promise.all([
          ensureBucketUploads(videoItems),
          sampleVideoFingerprints(videoItems),
        ]);
        setVideoStatusLabel(null);
        if (!uploads.ok) {
          if (!uploads.handled) {
            toast({
              title: COPY.composer.videoUploadErrorTitle,
              description: COPY.composer.videoUploadErrorBody,
              variant: "danger",
            });
          }
          return;
        }
        videoPaths.push(...uploads.paths);
        fingerprints = sampled;
      } else if (muxVideo) {
        setVideoStatusLabel(COPY.composer.videosPreparing(1));
        fingerprints = await sampleVideoFingerprints([muxVideo]);
        setVideoStatusLabel(null);
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
      /**
       * Cuántas fotos salieron con la tipografía de respaldo. Se cuenta aparte
       * del fallback general porque NO es lo mismo: la foto se horneó bien y
       * con todo lo demás: lo único distinto es la letra. Sin este contador el
       * cambio sería invisible sobre un archivo que ya no se puede deshacer
       * (ver `onFontFallback` en bake-photo.ts).
       */
      let fontFallbackCount = 0;
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
                // Color y tipografía viajan con el texto: si se quedaran acá,
                // el canvas dibujaría con el default y la frase publicada
                // saldría blanca cuando se eligió amarilla.
                color: edit.captionColor,
                font: edit.captionFont,
              }
            : null;

          let fellBack = false;
          let baked = await bakePhoto(item.file, {
            filterCss,
            // El recorte va PRIMERO en el horneado y define el recuadro contra
            // el que se colocan el texto y los emojis (ver bake-photo.ts).
            crop: edit.crop,
            caption,
            stickers: edit.stickers,
            onFallback: () => {
              fellBack = true;
            },
            onFontFallback: () => {
              fontFallbackCount += 1;
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
              crop: edit.crop,
              caption,
              stickers: edit.stickers,
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
        // Los videos ya subidos se quedan: el borrador sigue en pantalla y se
        // vuelven a usar cuando la persona saque una foto y publique de nuevo.
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
      } else if (fontFallbackCount > 0) {
        // `else if` y no un segundo toast: si la foto ya salió sin editar, la
        // tipografía es lo de menos y dos avisos apilados sobre lo mismo se
        // leen como dos problemas distintos.
        toast({
          title: COPY.composer.fontFallbackTitle,
          description: COPY.composer.fontFallbackBody,
          variant: "info",
        });
      }

      /**
       * EL POSTER (0132) — sólo del PRIMER video: `posts.video_poster_path` es
       * una columna por publicación. Se sube recién acá, pasada la guarda de
       * peso, para no dejar uno huérfano por un corte anterior. Sin barra propia
       * (son decenas de KB) y NUNCA frena la publicación: sin poster el video se
       * pinta con el respaldo de siempre.
       */
      const firstVideo = videoItems[0];
      if (videoPaths.length > 0 && firstVideo?.posterBlob) {
        const owner = videoPaths[0].split("/").slice(0, 2).join("/");
        const posterPath = `${owner}/poster-${crypto.randomUUID()}.${VIDEO_POSTER_EXTENSION}`;
        const { error: posterError } = await createClient()
          .storage.from("post-media")
          .upload(posterPath, firstVideo.posterBlob, {
            contentType: VIDEO_POSTER_CONTENT_TYPE,
            upsert: false,
          });
        if (posterError) {
          console.warn("[feed] no se pudo subir el poster del video", {
            message: posterError.message,
          });
        } else {
          videoPosterPath = posterPath;
        }
      }

      // ---- 3) Fotos (ya horneadas) + paths por la server action ------------
      const formData = new FormData();
      formData.set("body", trimmed);
      formData.set("kind", isQuestion ? "question" : isText ? "text" : "post");
      // Solo una pregunta puede llevar encuesta; el server lo re-valida igual.
      if (isQuestion && pollEnabled) formData.set("pollKind", "yes_no");
      /**
       * EL FONDO ELEGIDO (0128) — sólo el ID del catálogo, nunca el CSS: el
       * degradado lo arma `text-backgrounds.ts` al pintar. Ausente = Automático
       * (la columna queda NULL y el banner sortea por id). El servidor lo
       * re-valida contra el mismo catálogo y lo ignora si el kind no es texto.
       */
      if (isText && textBackground) formData.set("textBackground", textBackground);
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
      /**
       * ---- EL VIDEO, POR CUALQUIERA DE LAS DOS RUTAS -----------------------
       *
       * Todo lo que sigue (declaración de duración, categoría, huellas de
       * Content Integrity) es IGUAL por las dos rutas: describe el video, no
       * dónde quedó guardado. Lo único que cambia es cómo se lo nombra —una
       * ruta del bucket, o el par de identificadores de Mux— y eso son las dos
       * ramas de abajo.
       *
       * ⚠️ CONTRATO CON EL BACKEND. Por la ruta de Mux viajan `muxUploadId` y
       * `muxPostDraftId`, que son exactamente los dos identificadores que
       * devolvió `POST /api/mux/subida`. `createPostAction` es quien tiene que
       * atarlos a la publicación (y quien tiene que aceptar que una publicación
       * con video de Mux SÍ tiene medio, aunque `posts.media` venga vacío: el
       * archivo no está en el bucket). El cliente no inventa ningún otro campo.
       */
      if (muxTicket) {
        // ⚠️ CONTRATO CON EL BACKEND: `muxUploadId` y `muxPostDraftId` son los
        // dos identificadores que devolvió `POST /api/mux/subida`, y
        // `createPostAction` los ata a la publicación (con `posts.media` vacío:
        // el archivo no está en el bucket). El filtro va suelto y no como
        // arreglo porque hay un solo video; sólo `id` e `intensity`, nunca CSS.
        formData.set("muxUploadId", muxTicket.uploadId);
        formData.set("muxPostDraftId", muxTicket.postDraftId);
        const muxFilter = videoFilterRef(muxVideo?.edit);
        if (muxFilter) formData.set("muxVideoFilter", JSON.stringify(muxFilter));
        formData.set("videoType", "short_video");
        // Con un .mkv no se puede medir, y no pasa nada: `mux_duration_seconds`
        // llega por el webhook con el número real.
        if (muxVideo?.durationSeconds) {
          formData.set("durationSeconds", String(muxVideo.durationSeconds));
        }
        formData.set("videoCategory", videoCategory);
        const muxFrames = fingerprints.frames[0];
        if (muxFrames && muxFrames.length > 0) {
          formData.set("videoFrames", JSON.stringify(muxFrames));
        }
        const muxAudio = fingerprints.audio[0];
        if (muxAudio) formData.set("videoAudioPcm", muxAudio);
      } else if (videoPaths.length > 0) {
        // Todo lo que describe a los videos viaja en arreglos PARALELOS a
        // `videoPaths`: las claves (rutas) las escribe el servidor con los paths
        // que él mismo validó como propios, y un largo que no coincide se
        // descarta en vez de adivinar a qué archivo pertenece cada entrada.
        formData.set("videoPaths", JSON.stringify(videoPaths));
        if (videoPosterPath) formData.set("videoPosterPath", videoPosterPath);
        formData.set(
          "videoFilters",
          JSON.stringify(videoItems.map((item) => videoFilterRef(item.edit))),
        );
        // DECLARACIÓN OBLIGATORIA (0046): una duración MEDIDA por video; el
        // servidor pasa cada una por la política de 90 s.
        formData.set("videoType", "short_video");
        formData.set(
          "videoDurations",
          JSON.stringify(videoItems.map((item) => item.durationSeconds ?? null)),
        );
        formData.set("videoCategory", videoCategory);
        // Sólo si hay algo: un arreglo de vacíos aparentaría un análisis hecho.
        if (fingerprints.frames.some((frames) => frames.length > 0)) {
          formData.set("videoFrames", JSON.stringify(fingerprints.frames));
        }
        if (fingerprints.audio.some((track) => track !== null)) {
          formData.set("videoAudioPcm", JSON.stringify(fingerprints.audio));
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

        /**
         * DERECHOS Y FUENTE DE LA FOTO (0146) — la MISMA respuesta de arriba,
         * traducida al vocabulario que se lee debajo de la publicación.
         *
         * No hay un segundo formulario a propósito: preguntar dos veces lo
         * mismo deja dos declaraciones sobre una foto que pueden contradecirse,
         * y "¿cuál gana?" no tiene respuesta buena. El porqué completo, y por
         * qué la traducción va sólo del vocabulario grande al chico, están en
         * el encabezado de `creditos-de-foto.ts`.
         *
         * Los campos NO viajan cuando no hay nada que declarar. Es la
         * diferencia entre los cuatro de arriba y estos dos: aquéllos van
         * incluso vacíos porque su destino es el registro de moderación, y
         * dejar constancia de que se preguntó vale. Éstos se PINTAN, así que
         * mandarlos vacíos sería escribir una línea de crédito que nadie firmó.
         *
         * SÓLO CON FOTO, y no con cualquier medio. El pliego pide los derechos
         * de LA FOTO y la línea de la tarjeta está escrita así ("Foto propia"):
         * en un post sólo de video diría la palabra equivocada debajo de algo
         * que no es una foto. La declaración del video no se pierde — sigue
         * viajando a `content_assets` por las cuatro líneas de arriba, que es
         * donde estaba antes de la 0146 y donde el pliego la deja.
         */
        const credito = photoItems.length > 0 ? creditoDesdeDeclaracion(declaration) : null;
        if (credito) {
          formData.set("photoRights", credito.rights);
          if (credito.credit) formData.set("photoCredit", credito.credit);
        }
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

        resetForm({ keepUploads: true });
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

      // El post no salió. Los videos siguen en el borrador para reintentar; el
      // poster se vuelve a subir en cada intento, así que éste se borra.
      if (videoPosterPath) await removeFromPostMedia([videoPosterPath]);

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
        /**
         * La lista sale de `photo-input.ts` e incluye HEIC/HEIF y las
         * extensiones sueltas: varios pickers de Android entregan un HEIC con
         * `file.type` vacío, y un `accept` sólo de MIME se lo mostraba EN GRIS
         * —exactamente el mismo síntoma que el cliente reportó con los .mov.
         */
        accept={PHOTO_FILE_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        id="post-composer-photos"
        // `void`: la prueba de decodificación es asíncrona, pero el FileList
        // se lee SINCRÓNICAMENTE dentro (antes del primer await) — mismo
        // patrón que el input de video de acá abajo.
        onChange={(event) => void selectPhotos(event.currentTarget)}
      />
      <input
        ref={videoInputRef}
        type="file"
        /**
         * `video/*` con Mux, la lista de tres formatos sin Mux. Es el atributo
         * que el cliente reportó roto —los .mov de iPhone aparecían EN GRIS en
         * el selector de macOS— y con Mux prendido deja de haber nada gris:
         * cualquier video que el teléfono tenga se puede elegir.
         */
        accept={videoAcceptFor(muxEnabled ? "mux" : "bucket")}
        multiple={!muxEnabled}
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
        canAddVideo={videos.length < maxVideos && !measuringVideo}
        onAddPhotos={() => photoInputRef.current?.click()}
        onAddVideo={() => videoInputRef.current?.click()}
        onRemoveMedia={removeMedia}
        maxPhotos={MAX_PHOTOS}
        maxVideos={maxVideos}
        onSavePhotoEdit={savePhotoEdit}
        pollEnabled={pollEnabled}
        onPollChange={setPollEnabled}
        textBackground={textBackground}
        onTextBackgroundChange={setTextBackground}
        videoCategory={videoCategory}
        onVideoCategoryChange={setVideoCategory}
        declaration={declaration}
        onDeclarationChange={setDeclaration}
        previewId={previewId}
        videoUpload={videoUpload}
        /**
         * El panel con Cancelar es sólo de Mux. Las subidas al bucket muestran su
         * progreso en cada miniatura y se cancelan quitando el video.
         */
        onCancelVideoUpload={muxTicket ? cancelMuxUpload : undefined}
        measuringVideo={measuringVideo}
        videoStatusLabel={videoStatusLabel}
        bakingProgress={bakingProgress}
        finishingLabel={finishingLabel}
        isPending={isPending}
        publishBlocked={publicarBloqueado}
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
         *
         * EL CHIP DE SUGERENCIA (frente E) viaja EN ESTA MISMA ranura, no en
         * `tagSlot`: `musicSlot` es la que la hoja pinta ÚLTIMA, pegada al
         * textarea (ver el docblock de `ComposerSuggestionChip` más arriba)
         * — con o sin `MusicPicker` al lado, según haya medio o no.
         * `AnimatePresence` envuelve la condición (no vive DENTRO del chip)
         * a propósito: es la forma correcta de que motion anime también la
         * SALIDA cuando la sugerencia desaparece, en vez de que React la
         * desmonte de un tirón.
         */
        musicSlot={
          <>
            {media.length > 0 && (
              <MusicPicker value={track} onChange={setTrack} disabled={isPending} />
            )}
            <AnimatePresence>
              {sugerenciaComposer && (
                <ComposerSuggestionChip
                  key={sugerenciaComposer.tipo}
                  sugerencia={sugerenciaComposer}
                  avisoLargo={body.trim().length > 80}
                  onNavigate={irASugerenciaComposer}
                  onDismiss={cerrarSugerenciaComposer}
                />
              )}
            </AnimatePresence>
          </>
        }
      />
    </ComposerMenuProvider>
  );
}

/** Filtro de un video como metadato (0104): sólo `id` e `intensity`, o null. */
function videoFilterRef(edit: PhotoEdit | undefined) {
  return edit && edit.filterId !== DEFAULT_PHOTO_FILTER_ID
    ? { id: edit.filterId, intensity: edit.filterIntensity ?? DEFAULT_PHOTO_FILTER_INTENSITY }
    : null;
}

/** Best-effort: el archivo vive en el prefijo propio y la policy de delete lo permite. */
async function removeFromPostMedia(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await createClient().storage.from("post-media").remove(paths);
  } catch {
    // Si falla queda en el prefijo de quien lo subió, invisible para el resto.
  }
}

/**
 * Fotogramas y pista de audio de cada video, en orden. El audio respeta el
 * presupuesto del body (`MAX_TOTAL_AUDIO_PCM_CHARS`): si por la duración ya se
 * sabe que una pista no entra, ni se decodifica. `fitAudioTracks` es la MISMA
 * función que aplica el servidor al recibir.
 */
async function sampleVideoFingerprints(items: PickedMedia[]): Promise<VideoFingerprints> {
  const frames: number[][][] = [];
  const audio: (string | null)[] = [];
  let budget = MAX_TOTAL_AUDIO_PCM_CHARS;
  for (const item of items) {
    frames.push(await sampleVideoLumaFrames(item.file));
    const predicted = item.durationSeconds
      ? predictedAudioPcmChars(item.durationSeconds)
      : MAX_AUDIO_PCM_CHARS;
    if (predicted > budget) {
      audio.push(null);
      continue;
    }
    const samples = await sampleAudioPcm(item.file);
    const encoded = samples ? encodeAudioPcm16(samples) : null;
    audio.push(encoded);
    if (encoded && encoded.length <= budget) budget -= encoded.length;
  }
  return { frames, audio: fitAudioTracks(audio) };
}
