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
  MAX_PICKED_PHOTO_BYTES,
  checkPhotoPayload,
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
import { ComposerSheet, type ComposerMode } from "./composer-sheet";
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
}

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
 * body de las server actions), con progreso real vía XHR. El prefijo
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
  const video = media.find((item) => item.kind === "video") ?? null;

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

    if (video) {
      toast({ title: COPY.composer.videoLimit, variant: "warning" });
      return;
    }

    /**
     * ---- EL ORDEN DE ESTA FUNCIÓN NO ES CASUAL ---------------------------
     *
     * Cada paso está donde está para que nada se gaste al pedo: ni los datos de
     * la persona, ni un viaje al servidor, ni una fila de borrador en la base.
     *
     *   1. ¿Es un video, y entra por peso?   → local, instantáneo.
     *   2. ¿Cuánto dura?                     → local, un segundo.
     *   3. ¿Se pasa de los 90 s?             → se rechaza ACÁ.
     *   4. Recién ahora, el permiso de Mux   → que CREA un borrador en la base.
     *
     * Si el permiso se pidiera primero (que es lo natural de escribir), cada
     * video largo que alguien elige por error dejaría un borrador huérfano
     * detrás. Con este orden, el borrador se crea sólo para videos que de
     * verdad se van a subir.
     */

    /**
     * PASO 1 — ¿es un video, y entra por peso?
     *
     * Con Mux prendido la pregunta es la permisiva ("¿esto es un video?", techo
     * de 5 GB); sin Mux es la de siempre (mp4/mov/webm, `MAX_VIDEO_BYTES`) y este chequeo ya
     * es el definitivo. Es la MISMA función en los dos casos — la que también
     * corre el servidor cuando el archivo va al bucket (`isOwnVideoPath` en
     * `feed/actions.ts` valida contra el mismo catálogo de extensiones).
     */
    const rutaProbable: VideoUploadRoute = muxEnabled ? "mux" : "bucket";
    const chequeoInicial = checkVideoFile(file, rutaProbable);
    if (!chequeoInicial.ok) {
      toast({
        title:
          chequeoInicial.reason === "type"
            ? videoWrongTypeMessageFor(rutaProbable)
            : formatVideoTooBigMessage(file.size, rutaProbable),
        variant: "warning",
        duration: 8000,
      });
      return;
    }

    /**
     * PASO 2 — cuánto dura Y cómo se ve el primer cuadro. Local: el navegador
     * abre la cabecera del archivo.
     *
     * Las dos preguntas van en UNA sola apertura (`readVideoIntro`, 0132): abrir
     * el archivo es lo caro, y el poster es exactamente lo que hace que el video
     * no salga en blanco mientras carga en el reel.
     *
     * El fotograma se captura SIEMPRE, incluso con Mux prendido, y es a
     * propósito: la ruta definitiva recién se sabe en el paso 4, y si Mux
     * contesta 503 el archivo termina en el bucket — que es justamente el caso
     * que necesita poster. Cuesta un seek sobre un decodificador ya abierto;
     * descubrir tarde que hacía falta costaría abrirlo de nuevo.
     */
    setMeasuringVideo(true);
    const intro = await readVideoIntro(file);
    setMeasuringVideo(false);
    const measured = intro.durationSeconds;
    const duration = checkVideoDuration("short_video", measured);

    /**
     * PASO 3 — LOS 90 s SIGUEN VALIENDO IGUAL, y se aplican antes de tocar el
     * servidor. Es una regla de PRODUCTO, no una limitación técnica: nadie
     * quiere un video de 40 minutos en el feed. Mux no la afloja.
     */
    if (!duration.ok && duration.reason === "too-long") {
      toast({
        title: COPY.composer.videoTooLongTitle,
        description: COPY.composer.videoTooLongBody,
        variant: "warning",
        duration: 9000,
      });
      return;
    }

    /**
     * PASO 4 — ¿POR DÓNDE VIAJA? Con `muxEnabled` en false ni se pregunta: es el
     * camino de siempre. Con Mux prendido se pide el permiso de subida, y un
     * 503 —Mux a medias, una clave rotada— devuelve la ruta vieja sin que la
     * persona se entere de nada.
     */
    let ticket: MuxUploadTicket | null = null;
    if (muxEnabled) {
      setMeasuringVideo(true);
      const pedido = await requestMuxUpload();
      setMeasuringVideo(false);
      if (pedido.ok) ticket = pedido.ticket;
    }
    const route: VideoUploadRoute = ticket ? "mux" : "bucket";

    /**
     * El chequeo DEFINITIVO, ahora que se sabe la ruta. Sólo puede cambiar algo
     * cuando `muxEnabled` prometía Mux y el servidor contestó 503: ahí el
     * archivo vuelve a medirse contra la vara del bucket, que es la que de
     * verdad lo va a recibir. Un .mkv que iba a andar perfecto por Mux se
     * rechaza acá, con el mensaje del bucket — que es la verdad de ese momento.
     */
    const fileCheck = route === rutaProbable ? chequeoInicial : checkVideoFile(file, route);
    if (!fileCheck.ok) {
      toast({
        title:
          fileCheck.reason === "type"
            ? videoWrongTypeMessageFor(route)
            : formatVideoTooBigMessage(file.size, route),
        variant: "warning",
        duration: 8000,
      });
      return;
    }

    /**
     * LA DURACIÓN DESCONOCIDA, que es lo único que la ruta cambia.
     *
     * El navegador lee la duración abriendo el archivo con un `<video>`, y por
     * la ruta de Mux ahora entran formatos que ningún navegador sabe abrir (un
     * .mkv, un .avi). Rechazarlos por "no pudimos leer la duración" sería
     * prometer cualquier formato y después rebotarlos a todos por la puerta de
     * atrás.
     *
     * Así que por Mux una duración desconocida NO frena: se sube, y quien mide
     * de verdad es Mux (`mux_duration_seconds` vuelve por el webhook, y es un
     * dato mejor que el nuestro porque sale del archivo ya decodificado). Por el
     * bucket sigue frenando, porque ahí el `<video>` del feed va a tener que
     * abrir el mismo archivo que el composer no pudo.
     */
    if (!duration.ok && route === "bucket") {
      toast({
        title: COPY.composer.videoUnknownDurationTitle,
        description: COPY.composer.videoUnknownDurationBody,
        variant: "warning",
        duration: 8000,
      });
      return;
    }

    setMedia((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        kind: "video",
        file,
        preview: URL.createObjectURL(file),
        durationSeconds: duration.ok ? duration.seconds : undefined,
        videoExtension: fileCheck.extension,
        videoContentType: fileCheck.mimeType,
        // Puede ser null (códec que el navegador no abre): el video se publica
        // igual, sin poster, y la superficie cae a su respaldo.
        posterBlob: intro.poster,
        // Igual que la foto: el borrador arranca en "sin filtro" apenas se
        // elige el archivo, así el editor y el envío siempre tienen algo que
        // leer, se haya abierto el editor o no.
        edit: { ...DEFAULT_PHOTO_EDIT },
      },
    ]);
    openCompose("media");

    /**
     * ---- LA SUBIDA ARRANCA ACÁ, NO AL PUBLICAR ---------------------------
     *
     * Por la ruta del bucket el video se sube dentro de `submit()`, y con un
     * archivo chico eso son un par de segundos. Con Mux pueden ser cientos de megas en 4G:
     * dejarlo para el final significaría que la persona escribe el pie, toca
     * Publicar, y RECIÉN AHÍ empieza a esperar tres minutos mirando una barra.
     *
     * Arrancando acá, la subida corre mientras escribe. Cuando termina de armar
     * la publicación, lo más probable es que el archivo ya esté arriba y
     * publicar sea instantáneo. Es el mismo trabajo, movido al único rato en que
     * la persona no lo está esperando.
     */
    if (ticket) {
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
            // No se quita el video del borrador: lo que escribió sigue ahí y
            // puede volver a intentar quitándolo y eligiéndolo de nuevo. Se le
            // dice eso, no un código.
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
    setMedia((current) => {
      const found = current.find((item) => item.id === id);
      if (found) URL.revokeObjectURL(found.preview);
      // Quitar el video del borrador CORTA su subida. Sin esto, el archivo
      // seguiría viajando a Mux en segundo plano —gastando los datos de la
      // persona— por un video que acaba de decidir que no va a publicar.
      if (found?.kind === "video") cancelMuxUpload();
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
    // Si quedaba una subida a Mux en vuelo (se cerró el composer, se descartó el
    // borrador), se corta acá: nada de archivos viajando para una publicación
    // que ya no existe.
    cancelMuxUpload();
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
      // ---- 1) Video primero: subida directa al bucket con progreso ---------
      let videoPath: string | null = null;
      /**
       * Ruta del POSTER ya subido (0132), o null si no hubo fotograma o su
       * subida falló. Se declara al lado del video porque comparten destino,
       * prefijo y limpieza: si la publicación se cae más abajo, los dos se
       * borran juntos — un poster huérfano en el bucket no lo referencia nadie.
       */
      let videoPosterPath: string | null = null;
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
      /**
       * CON MUX NO HAY NADA QUE SUBIR ACÁ. El archivo ya viajó (o está viajando)
       * desde que se eligió, así que este tramo se saltea entero: no se pide
       * prefijo al bucket, no se arma path, no se sube. Lo único que sí se hace
       * igual es el muestreo para Content Integrity, unas líneas más abajo —
       * ese trabajo es sobre el archivo que está en memoria y no depende de por
       * dónde viajó.
       *
       * Si la subida todavía no terminó, no se publica: el botón ya está apagado
       * (`publishBlocked`), y esto es la misma regla del lado de quien envía.
       */
      if (video && muxTicket && !muxSubido) return;

      if (video && !muxTicket) {
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

        // `videoExtension` ya salió de `checkVideoFile` en `selectVideo` — no
        // se vuelve a leer `video.file.type` acá (puede venir vacío en
        // algunos navegadores para formatos poco comunes; ver
        // `video-upload-limits.ts`). Todo video en `media` pasó ese chequeo,
        // así que el campo siempre está.
        const extension = video.videoExtension ?? "mp4";
        videoPath = `${prepared.tenantId}/${prepared.userId}/video-${crypto.randomUUID()}.${extension}`;
        const totalBytes = video.file.size;
        setVideoUpload({ pct: 0, uploadedBytes: 0, totalBytes, offline: false });
        // El muestreo va en paralelo con la subida: son dos trabajos
        // independientes sobre el mismo archivo y encadenarlos le sumaría un
        // par de segundos a la espera por nada.
        const [uploaded, frames, audioPcm] = await Promise.all([
          uploadVideoWithProgress(
            video.file,
            videoPath,
            (pct) =>
              setVideoUpload({
                pct,
                uploadedBytes: Math.round((totalBytes * pct) / 100),
                totalBytes,
                // El XHR al bucket es un único request: o va o no va. No hay un
                // estado "sin conexión" que mostrar porque no hay nada que
                // retomar — eso es exclusivo de la ruta de Mux.
                offline: false,
              }),
            video.videoContentType ?? video.file.type,
          ),
          sampleVideoLumaFrames(video.file),
          // La pista de audio es una huella independiente de la imagen: quien
          // recorta el video pero deja el sonido intacto matchea por acá. Va en
          // el mismo Promise.all porque también es trabajo sobre el archivo que
          // ya está en memoria, y degrada a null sin romper nada.
          sampleAudioPcm(video.file),
        ]);
        videoFrames = frames;
        videoAudioPcm = audioPcm ? encodeAudioPcm16(audioPcm) : null;
        setVideoUpload(null);

        /**
         * EL POSTER, DESPUÉS DEL VIDEO Y SIN BARRA PROPIA (0132).
         *
         * Después: si el video no llegó a subir, subir su poster sería dejar un
         * archivo que no ilustra nada. Y sin barra porque son decenas de
         * kilobytes al lado de cientos de megas — un segundo indicador de
         * progreso para algo que tarda menos que el parpadeo sería ruido.
         *
         * NUNCA FRENA LA PUBLICACIÓN. Un poster que no se pudo subir devuelve
         * `videoPosterPath` en null y el video se pinta como se pintaba antes de
         * esta feature: con el respaldo de la superficie. Perder el poster es
         * perder una mejora de carga; abortar la publicación por eso sería
         * perder la publicación.
         */
        if (uploaded && video.posterBlob) {
          const posterPath = `${prepared.tenantId}/${prepared.userId}/poster-${crypto.randomUUID()}.${VIDEO_POSTER_EXTENSION}`;
          const { error: posterError } = await createClient()
            .storage.from("post-media")
            .upload(posterPath, video.posterBlob, {
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

        if (!uploaded) {
          toast({
            title: COPY.composer.videoUploadErrorTitle,
            description: COPY.composer.videoUploadErrorBody,
            variant: "danger",
          });
          return;
        }
      } else if (video && muxTicket) {
        /**
         * CONTENT INTEGRITY TAMBIÉN CON MUX. La huella perceptual se saca del
         * archivo que está en memoria, no del que quedó en el bucket, así que
         * este trabajo es idéntico por las dos rutas — y tiene que hacerse, o
         * los videos que pasen por Mux entrarían al feed sin pasar por el
         * pipeline que sí revisa a los demás.
         *
         * LO QUE CAMBIA: por Mux ahora entran formatos que el navegador no sabe
         * decodificar (.mkv, .avi). Para esos, el muestreo vuelve vacío y el
         * pipeline lo lee como "no se pudo analizar" → revisión humana. Es
         * exactamente el comportamiento que ya tenía para un códec raro; lo
         * único nuevo es que ahora va a pasar más seguido. Nunca frena la
         * publicación, que es la regla de siempre.
         */
        const [frames, audioPcm] = await Promise.all([
          sampleVideoLumaFrames(video.file),
          sampleAudioPcm(video.file),
        ]);
        videoFrames = frames;
        videoAudioPcm = audioPcm ? encodeAudioPcm16(audioPcm) : null;
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
        // El video ya subido queda huérfano si lo había: se limpia igual que en
        // cualquier otro corte (best-effort, la policy delete lo permite). El
        // POSTER va en la misma barrida: solo existe para ese video, así que
        // dejarlo sería basura que no ilustra nada.
        if (videoPath) {
          try {
            await createClient()
              .storage.from("post-media")
              .remove(videoPosterPath ? [videoPath, videoPosterPath] : [videoPath]);
          } catch {
            // sin drama: el archivo queda en el prefijo propio, no es visible
          }
        }
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
        formData.set("muxUploadId", muxTicket.uploadId);
        formData.set("muxPostDraftId", muxTicket.postDraftId);
        /**
         * FILTRO DEL VIDEO (0104) por la ruta de Mux: un objeto suelto y no un
         * arreglo paralelo, porque acá no hay `videoPaths` con los que emparejar
         * — hay un solo video y su borrador ya tiene id. Mismo criterio de
         * seguridad que la otra rama: sólo `id` e `intensity`, NUNCA el CSS. El
         * string de `filter` lo arma el servidor desde el catálogo; mandarlo
         * desde acá sería dejar que el navegador escriba en el `style` de todo
         * el que abra la publicación.
         */
        const videoEditMux = video?.edit;
        if (videoEditMux && videoEditMux.filterId !== DEFAULT_PHOTO_FILTER_ID) {
          formData.set(
            "muxVideoFilter",
            JSON.stringify({
              id: videoEditMux.filterId,
              intensity: videoEditMux.filterIntensity ?? DEFAULT_PHOTO_FILTER_INTENSITY,
            }),
          );
        }
        formData.set("videoType", "short_video");
        // La duración medida por el navegador, SI se pudo medir. Con un .mkv no
        // se puede, y no pasa nada: `mux_duration_seconds` va a llegar por el
        // webhook con el número real, que además es mejor que este.
        if (video?.durationSeconds) {
          formData.set("durationSeconds", String(video.durationSeconds));
        }
        formData.set("videoCategory", videoCategory);
        if (videoFrames.length > 0) {
          formData.set("videoFrames", JSON.stringify(videoFrames));
        }
        if (videoAudioPcm) {
          formData.set("videoAudioPcm", videoAudioPcm);
        }
      } else if (videoPath) {
        formData.set("videoPaths", JSON.stringify([videoPath]));
        /**
         * El poster (0132) viaja SÓLO cuando existe. Ausente significa "este
         * video no tiene fotograma capturado", que es exactamente lo que la
         * columna guarda en NULL — y lo que ya pasa con los 36 videos que
         * estaban en el bucket antes de esta feature.
         *
         * La ruta la valida el servidor con la misma forma que la del video
         * (`isOwnPosterPath` en feed/actions.ts): tenant y usuario propios, tres
         * segmentos, sin traversal. Nunca se confía en que este campo diga la
         * verdad sólo porque lo escribió el composer.
         */
        if (videoPosterPath) {
          formData.set("videoPosterPath", videoPosterPath);
        }
        /**
         * FILTRO DEL VIDEO (0104) — arreglo PARALELO a `videoPaths`, no un
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
        const videoEdit = video?.edit;
        formData.set(
          "videoFilters",
          JSON.stringify([
            videoEdit && videoEdit.filterId !== DEFAULT_PHOTO_FILTER_ID
              ? {
                  id: videoEdit.filterId,
                  intensity: videoEdit.filterIntensity ?? DEFAULT_PHOTO_FILTER_INTENSITY,
                }
              : null,
          ]),
        );
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

      // El post no salió: el video ya subido quedaría huérfano en el prefijo
      // del usuario — lo limpiamos best-effort (la policy delete lo permite).
      if (videoPath) {
        try {
          await createClient()
            .storage.from("post-media")
            .remove(videoPosterPath ? [videoPath, videoPosterPath] : [videoPath]);
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
        maxPhotos={MAX_PHOTOS}
        onSavePhotoEdit={savePhotoEdit}
        pollEnabled={pollEnabled}
        onPollChange={setPollEnabled}
        videoCategory={videoCategory}
        onVideoCategoryChange={setVideoCategory}
        declaration={declaration}
        onDeclarationChange={setDeclaration}
        previewId={previewId}
        videoUpload={videoUpload}
        /**
         * Cancelar sólo existe cuando hay algo que cancelar de verdad: la subida
         * a Mux corre en segundo plano mientras la persona escribe y se puede
         * cortar en cualquier momento. La del bucket pasa DENTRO de publicar, en
         * un único request que no se interrumpe — ahí no se pinta el botón, en
         * vez de pintar uno que no haría nada.
         */
        onCancelVideoUpload={muxTicket ? cancelMuxUpload : undefined}
        measuringVideo={measuringVideo}
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
