"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AlignBottom,
  AlignCenterVertical,
  AlignTop,
  ArrowsOutCardinal,
  Check,
  Crop,
  Smiley,
  Sparkle,
  TextT,
  Trash,
} from "@phosphor-icons/react/dist/ssr";
import { Button, Input } from "@/components/ui";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PHOTO_FILTER_ID,
  DEFAULT_PHOTO_FILTER_INTENSITY,
  resolvePhotoFilterCss,
  type PhotoFilterId,
} from "@/lib/media/photo-filters";
import {
  CAPTION_MAX_LENGTH,
  type CaptionBackground,
  type CaptionPosition,
} from "@/lib/media/bake-photo";
import {
  CROP_ASPECTS,
  DEFAULT_CROP_ASPECT,
  FULL_CROP,
  MAX_CROP_ZOOM,
  aspectRatioOf,
  clampCropOffset,
  clampCropScale,
  coverScaleFor,
  cropRectFrom,
  cropStageStateFrom,
  initialCropState,
  isFullCrop,
  type CropAspectId,
  type CropOffset,
  type CropRect,
  type Size,
} from "@/lib/media/photo-crop";
import {
  CAPTION_COLOR_LIST,
  CAPTION_FONT_LIST,
  DEFAULT_CAPTION_COLOR,
  DEFAULT_CAPTION_FONT,
  DEFAULT_STICKER_SIZE,
  MAX_STICKERS,
  MAX_STICKER_SIZE,
  MIN_STICKER_SIZE,
  STICKER_FONT_FAMILY,
  STICKER_GROUPS,
  captionBarFill,
  captionFontCss,
  captionHaloColor,
  clampStickerSize,
  normalizeStickers,
  resolveCaptionColor,
  stickerBox,
  type CaptionColorId,
  type CaptionFontId,
  type PhotoSticker,
} from "@/lib/media/photo-overlay";
import { NEUTRAL_THUMB, capturePosterFrame } from "@/lib/media/video-poster";
import { EMOJI_COPY, EmojiPicker } from "@/components/emojis";
import { useCommunityEmojis } from "@/lib/emojis/use-community-emojis";
import { FilterCarousel } from "./filter-carousel";
import { COPY, VIDEO_EDITOR_COPY } from "./copy";

/**
 * EDICIÓN DE UNA FOTO — recorte, filtros, texto y emojis.
 *
 * Se abre DENTRO de la hoja ya abierta de `ComposerSheet` (no es un
 * `BottomSheet` propio, es un panel que reemplaza su contenido). Sigue siendo
 * la forma correcta aunque ya no sea la única posible: desde 2026-08-20
 * `useFocusTrap`/`useBodyScrollLock` (`src/lib/design/use-overlay.ts`) sí
 * reparten Escape/scroll entre hojas apiladas por una pila LIFO de módulo, así
 * que dos `BottomSheet` distintos ya se cerrarían de a uno. Pero acá conviene
 * igual: `ComposerSheet` decide cuándo mostrar este panel dentro de SU MISMO
 * `BottomSheet`, y así Escape/scrim/arrastre son un solo gesto que siempre
 * hace lo mismo —salir de a un paso—, sin depender de qué hoja quedó arriba.
 *
 * ─── POR QUÉ PESTAÑAS (2026-08-26) ──────────────────────────────────────────
 * Con filtros y texto entraba todo apilado en una columna. Con recorte y
 * emojis, no: el recorte necesita la foto GRANDE y el dedo encima, y cuatro
 * paneles abiertos en una pantalla de 375 px dejan la foto del tamaño de una
 * estampilla. Son pestañas y no un acordeón porque el trabajo es "estoy
 * recortando" o "estoy escribiendo", nunca las dos cosas a la vez — y la foto
 * queda arriba, fija, mientras la herramienta cambia debajo.
 *
 * ─── WYSIWYG, QUE ACÁ NO ES UN LUJO ─────────────────────────────────────────
 * Lo que se ve en esta pantalla es lo que `bake-photo.ts` va a QUEMAR en los
 * píxeles: el archivo que se sube ya trae el recorte, el filtro, el texto y los
 * emojis adentro, y eso no se puede deshacer después de publicar. Por eso
 * ninguna cuenta de posición vive acá: el recorte lo resuelve `photo-crop.ts`,
 * los colores/tipografías/emojis `photo-overlay.ts`, y el horneado importa
 * EXACTAMENTE las mismas funciones. Una fórmula copiada entre la vista previa y
 * el canvas es cómo se llega a un emoji que en pantalla estaba en el hombro y
 * en la foto publicada quedó en la oreja.
 *
 * "Cancelar" descarta el borrador; sólo "Listo" confirma. Por eso el estado
 * vive LOCAL (`draft`) y no escribe en `PostComposer` hasta `onSave`.
 */

export interface PhotoEdit {
  filterId: PhotoFilterId;
  /**
   * Cuánto del preset se aplica (0–1). Es un multiplicador sobre el MISMO
   * string de `filter`, no otro preset: ver `scaleFilterCss`. Vive acá y no en
   * el catálogo porque es una decisión POR FOTO — la misma "Vintage" al 40% en
   * una y al 100% en otra.
   */
  filterIntensity: number;
  captionText: string;
  captionPosition: CaptionPosition;
  captionBackground: CaptionBackground;
  /** Tinta del texto (photo-overlay.ts). */
  captionColor: CaptionColorId;
  /** Familia del texto. Sólo las que la app YA carga o las del sistema. */
  captionFont: CaptionFontId;
  /** Qué relación se eligió. Sólo para pintar el chip activo al reabrir. */
  cropAspect: CropAspectId;
  /** El recorte, en fracciones de la foto original. `FULL_CROP` = sin recortar. */
  crop: CropRect;
  /**
   * FORMA del recuadro publicado (ancho/alto). Es dato DERIVADO —sale del
   * recorte y del tamaño natural— y se guarda igual porque quien pinta una
   * miniatura no conoce el tamaño natural de la foto: sin esto, la tira del
   * composer no podría mostrar el recorte sin volver a cargar la imagen para
   * medirla. Se calcula una sola vez, acá, donde el dato está.
   */
  cropRatio: number;
  /** Emojis pegados, en fracciones del recuadro PUBLICADO (post-recorte). */
  stickers: PhotoSticker[];
}

export const DEFAULT_PHOTO_EDIT: PhotoEdit = {
  filterId: DEFAULT_PHOTO_FILTER_ID,
  filterIntensity: DEFAULT_PHOTO_FILTER_INTENSITY,
  captionText: "",
  captionPosition: "bottom",
  captionBackground: "solid",
  captionColor: DEFAULT_CAPTION_COLOR,
  captionFont: DEFAULT_CAPTION_FONT,
  cropAspect: DEFAULT_CROP_ASPECT,
  crop: FULL_CROP,
  cropRatio: 0,
  stickers: [],
};

/**
 * El `filter` de una edición, resuelto. Lo llaman la vista previa grande, la
 * miniatura de la grilla (`composer-sheet.tsx`) y el horneado
 * (`post-composer.tsx`): un solo lugar donde el preset y su intensidad se
 * combinan, para que los tres no puedan discrepar.
 *
 * Tolera `undefined` (foto que nunca pasó por el editor) y ediciones viejas sin
 * `filterIntensity`, que se leen como el preset entero.
 */
export function photoEditFilterCss(edit: PhotoEdit | undefined | null): string {
  if (!edit) return "";
  return resolvePhotoFilterCss(
    edit.filterId,
    edit.filterIntensity ?? DEFAULT_PHOTO_FILTER_INTENSITY,
  );
}

/** Recorte de una edición, tolerando ediciones anteriores al recorte. */
export function photoEditCrop(edit: PhotoEdit | undefined | null): CropRect {
  return edit?.crop ?? FULL_CROP;
}

export interface PhotoEditorProps {
  /** Vista previa (blob:) del medio que se está editando. */
  preview: string;
  /** Edición ya guardada — el borrador arranca SIEMPRE desde acá. */
  edit: PhotoEdit;
  /**
   * QUÉ SE ESTÁ EDITANDO. El mismo panel sirve para los dos medios —mismo
   * catálogo de 16, mismo carrusel, mismo deslizador de intensidad— pero no
   * ofrecen lo mismo, y la diferencia no es cosmética:
   *
   *  · FOTO: el recorte, el filtro, el texto y los emojis se QUEMAN en los
   *    píxeles al publicar (`bake-photo.ts`). El archivo que se sube ya es la
   *    foto editada.
   *  · VIDEO: nada se quema. El filtro se guarda como metadato (0104) y se
   *    aplica al reproducir. Por eso acá NO hay recorte, ni texto, ni emojis:
   *    las tres cosas pedirían hornear el video —re-codificar en tiempo real,
   *    romper la subida directa al bucket y cambiarle la huella a Content
   *    Integrity—, que es exactamente lo que esta decisión evita. Ofrecer un
   *    control que no podemos cumplir sería peor que no ofrecerlo.
   */
  kind?: "photo" | "video";
  onCancel: () => void;
  onSave: (edit: PhotoEdit) => void;
}

type EditorTab = "crop" | "filters" | "text" | "stickers";

const TABS: Array<{ id: EditorTab; label: string; icon: React.ReactNode }> = [
  { id: "crop", label: COPY.composer.photoEditor.tabCrop, icon: <Crop size={16} aria-hidden="true" /> },
  { id: "filters", label: COPY.composer.photoEditor.tabFilters, icon: <Sparkle size={16} aria-hidden="true" /> },
  { id: "text", label: COPY.composer.photoEditor.tabText, icon: <TextT size={16} aria-hidden="true" /> },
  { id: "stickers", label: COPY.composer.photoEditor.tabStickers, icon: <Smiley size={16} aria-hidden="true" /> },
];

const POSITION_OPTIONS: Array<{
  value: CaptionPosition;
  label: string;
  icon: React.ReactNode;
}> = [
  { value: "top", label: COPY.composer.photoEditor.positionTop, icon: <AlignTop size={16} aria-hidden="true" /> },
  {
    value: "center",
    label: COPY.composer.photoEditor.positionCenter,
    icon: <AlignCenterVertical size={16} aria-hidden="true" />,
  },
  {
    value: "bottom",
    label: COPY.composer.photoEditor.positionBottom,
    icon: <AlignBottom size={16} aria-hidden="true" />,
  },
];

const BACKGROUND_OPTIONS: Array<[CaptionBackground, string]> = [
  ["solid", COPY.composer.photoEditor.backgroundSolid],
  ["none", COPY.composer.photoEditor.backgroundNone],
];

const ASPECT_LABELS: Record<CropAspectId, string> = {
  original: COPY.composer.photoEditor.cropOriginal,
  "4:5": COPY.composer.photoEditor.cropPortrait,
  "1:1": COPY.composer.photoEditor.cropSquare,
  "16:9": COPY.composer.photoEditor.cropWide,
};

/** Cuánto mueve una flecha del teclado, en px de stage / fracción del recuadro. */
const KEYBOARD_STEP_PX = 12;
const KEYBOARD_STEP_FRACTION = 0.02;
/** Movimiento mínimo antes de empezar a arrastrar (regla `drag-threshold`). */
const DRAG_THRESHOLD_PX = 4;

/** Estilo de botón-pastilla seleccionable, compartido por posición y fondo. */
const optionButtonClass = (active: boolean) =>
  cn(
    "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm font-medium",
    // Una sola línea SIEMPRE: un rótulo partido en dos renglones desalinea toda
    // la fila y hace que un chip mida distinto que su vecino.
    "whitespace-nowrap",
    "transition-colors duration-(--duration-fast)",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
    active
      ? "border-brand bg-brand-tint font-semibold text-brand-ink"
      : "border-border bg-surface text-foreground-secondary hover:bg-surface-hover",
  );

/** Deslizador con la MISMA forma que el de intensidad y el de recorte de música. */
const sliderClass = cn(
  "h-11 w-full cursor-pointer appearance-none bg-transparent",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
  "disabled:cursor-not-allowed disabled:opacity-45",
  "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-surface-subtle",
  "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-surface-subtle",
  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:size-5",
  "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand [&::-webkit-slider-thumb]:shadow-xs",
  "[&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-brand",
);

export function PhotoEditor({
  preview,
  edit,
  kind = "photo",
  onCancel,
  onSave,
}: PhotoEditorProps) {
  const isVideo = kind === "video";
  const reduce = usePrefersReducedMotion();
  const [draft, setDraft] = useState<PhotoEdit>({ ...DEFAULT_PHOTO_EDIT, ...edit });
  /**
   * ABRE EN FILTROS, aunque "Recortar" sea la primera pestaña.
   *
   * Las pestañas están en el orden del horneado (recorte → filtro → texto →
   * emojis) porque ése es el orden en que las cosas se apilan sobre la foto, y
   * "Recortar" tiene que ser lo primero que se ve para que se encuentre. Pero
   * ABRIR ahí sería meter a todo el mundo en una superficie de arrastre que no
   * pidió: hasta hoy este panel era filtros y texto, y la enorme mayoría de las
   * veces se entra a elegir un filtro. La pestaña queda a un toque; el gesto no
   * se impone.
   *
   * En un video es la única pestaña que existe (ver `kind` en los props).
   */
  const [tab, setTab] = useState<EditorTab>("filters");
  const [selectedSticker, setSelectedSticker] = useState<string | null>(null);
  const [stickerNotice, setStickerNotice] = useState(false);

  /**
   * El catálogo propio (0125). Se pide al TOCAR la pestaña "Emojis", no al
   * abrir el editor: quien entra a elegir un filtro —la enorme mayoría de las
   * veces, ver el default de `tab`— no paga esa consulta. La caché de
   * `useCommunityEmojis` hace que el picker del comentario y éste compartan
   * una sola lectura por pestaña del navegador.
   */
  const communityEmojis = useCommunityEmojis();

  /** Cambiar de pestaña, y de paso pedir lo que esa pestaña necesita. */
  function openTab(next: EditorTab) {
    setTab(next);
    if (next === "stickers") communityEmojis.load();
  }

  /** Tamaño real de la foto. Sin esto no hay recorte posible: todas las cuentas
   *  de `photo-crop.ts` se apoyan en él. */
  const [natural, setNatural] = useState<Size | null>(null);
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement | null>(null);

  /**
   * Un fotograma del video como imagen, para que las 16 miniaturas del carrusel
   * muestren MATERIAL PROPIO en vez de cuadritos genéricos. Pintar el video 16
   * veces no es una opción: serían 16 decodificadores para chips de 72 px.
   */
  const [videoThumb, setVideoThumb] = useState(NEUTRAL_THUMB);

  useEffect(() => {
    if (!isVideo) return;
    let cancelled = false;
    void capturePosterFrame(preview).then((frame) => {
      if (!cancelled && frame) setVideoThumb(frame);
    });
    return () => {
      cancelled = true;
    };
  }, [isVideo, preview]);

  /**
   * El stage se MIDE, no se fija en un número. El recorte del avatar puede
   * permitirse `STAGE_SIZE = 256` porque es un círculo chico; acá la foto ocupa
   * el ancho de la hoja, que en un teléfono angosto y en una tablet no es el
   * mismo. Y las cuentas de `photo-crop.ts` piden el tamaño del stage: con un
   * número inventado, el encuadre que se ve no sería el que se guarda.
   */
  useLayoutEffect(() => {
    const node = stageRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setStage({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const ratio = natural ? aspectRatioOf(draft.cropAspect, natural) : 4 / 5;

  /**
   * ─── EL ENCUADRE SE DERIVA, NO SE GUARDA EN UN EFECTO ────────────────────
   *
   * `stageState` (scale + offset) depende de tres cosas que llegan en momentos
   * distintos: el tamaño natural de la foto (al cargar la imagen), el tamaño
   * medido del stage (tras el layout) y la relación elegida. La versión obvia
   * —un `useState` sembrado desde un `useEffect`— es un render de más en cada
   * una de esas tres llegadas, y encima deja el estado y su fuente pudiendo
   * discrepar mientras el efecto no corrió todavía.
   *
   * Acá el único ESTADO es lo que la persona arrastró (`manual`). Todo lo demás
   * se calcula al renderizar:
   *  · `manual` no nulo  → manda el gesto;
   *  · edición ya recortada y sin cambiar de relación → el encuadre guardado,
   *    para poder retocar en vez de empezar de cero;
   *  · en cualquier otro caso → la foto centrada al zoom que cubre el stage.
   *
   * Y el rect normalizado se calcula UNA sola vez, al tocar "Listo"
   * (`handleSave`), que es cuando de verdad hace falta.
   */
  const [manual, setManual] = useState<{ scale: number; offset: CropOffset } | null>(null);
  /** El recorte con el que se ABRIÓ. Nunca cambia mientras el panel está abierto. */
  const [initialCrop] = useState<CropRect>(() => edit.crop ?? FULL_CROP);
  /** ¿Ya se cambió de relación? Ahí el encuadre guardado deja de tener sentido. */
  const [aspectTouched, setAspectTouched] = useState(false);

  const stageState = (() => {
    if (!natural || stage.width === 0 || stage.height === 0) return null;
    if (manual) return manual;
    if (!aspectTouched && !isFullCrop(initialCrop)) {
      return cropStageStateFrom(initialCrop, natural, stage);
    }
    return initialCropState(natural, stage);
  })();

  /** Lo que un gesto acaba de encuadrar. */
  const commitStage = useCallback((next: { scale: number; offset: CropOffset }) => {
    setManual(next);
  }, []);

  /**
   * Cambiar de relación vuelve a centrar y a cubrir: el zoom anterior puede
   * dejar un hueco vacío en el eje que se agrandó, y arrastrar el encuadre de
   * un 16:9 a un 1:1 no significa nada.
   */
  function changeAspect(aspect: CropAspectId) {
    setDraft((current) => ({ ...current, cropAspect: aspect }));
    setAspectTouched(true);
    setManual(null);
  }

  /* ------------------------------ Gestos ------------------------------- */

  /**
   * Punteros vivos sobre el stage. Un `Map` y no dos refs sueltas porque el
   * pellizco necesita saber DÓNDE están los dos dedos a la vez, y el segundo
   * dedo puede levantarse antes que el primero sin que el arrastre termine.
   */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragStart = useRef<{ x: number; y: number; offset: CropOffset } | null>(null);
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const cropping = tab === "crop" && !isVideo;

  function pinchDistance(): number {
    const [a, b] = Array.from(pointers.current.values());
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!cropping || !natural || !stageState) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      // Empieza un pellizco: el arrastre en curso se abandona para que la foto
      // no salga disparada cuando el segundo dedo toca la pantalla.
      dragStart.current = null;
      pinchStart.current = { distance: pinchDistance(), scale: stageState.scale };
      return;
    }
    dragStart.current = { x: event.clientX, y: event.clientY, offset: stageState.offset };
  }

  function onStagePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!cropping || !natural || !stageState) return;
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size >= 2 && pinchStart.current) {
      const distance = pinchDistance();
      if (distance <= 0 || pinchStart.current.distance <= 0) return;
      const scale = clampCropScale(
        (pinchStart.current.scale * distance) / pinchStart.current.distance,
        natural,
        stage,
      );
      commitStage({
        scale,
        // Al alejar, el offset puede quedar fuera de rango y dejar un hueco:
        // se recorta con la escala NUEVA, no con la anterior.
        offset: clampCropOffset(stageState.offset, natural, scale, stage),
      });
      setDragging(true);
      return;
    }

    if (!dragStart.current) return;
    const dx = event.clientX - dragStart.current.x;
    const dy = event.clientY - dragStart.current.y;
    // Umbral: un toque con temblor no puede mover el encuadre.
    if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    setDragging(true);
    commitStage({
      scale: stageState.scale,
      offset: clampCropOffset(
        { x: dragStart.current.offset.x + dx, y: dragStart.current.offset.y + dy },
        natural,
        stageState.scale,
        stage,
      ),
    });
  }

  function onStagePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) {
      dragStart.current = null;
      setDragging(false);
    }
  }

  function onStageKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!cropping || !natural || !stageState) return;
    const step = event.shiftKey ? KEYBOARD_STEP_PX * 3 : KEYBOARD_STEP_PX;
    const { offset } = stageState;
    let next = offset;
    if (event.key === "ArrowLeft") next = { ...offset, x: offset.x + step };
    else if (event.key === "ArrowRight") next = { ...offset, x: offset.x - step };
    else if (event.key === "ArrowUp") next = { ...offset, y: offset.y + step };
    else if (event.key === "ArrowDown") next = { ...offset, y: offset.y - step };
    else return;
    event.preventDefault();
    commitStage({
      scale: stageState.scale,
      offset: clampCropOffset(next, natural, stageState.scale, stage),
    });
  }

  /* ------------------------------ Emojis ------------------------------- */

  /**
   * Pega un emoji sobre la foto. Uno solo para los dos tipos —el glifo del
   * teclado y el dibujo propio de la comunidad (0125)— porque todo lo que
   * sigue (posición, tamaño, arrastre, cupo, horneado) es idéntico: lo único
   * que cambia es con qué se pinta la última capa.
   */
  function addSticker(parte: Pick<PhotoSticker, "emoji"> & Partial<PhotoSticker>) {
    if (draft.stickers.length >= MAX_STICKERS) {
      setStickerNotice(true);
      return;
    }
    const sticker: PhotoSticker = {
      id: crypto.randomUUID(),
      // Al centro: es el único lugar que se ve siempre, cualquiera sea el
      // recorte. Después se arrastra a donde vaya.
      x: 0.5,
      y: 0.5,
      size: DEFAULT_STICKER_SIZE,
      ...parte,
    };
    setStickerNotice(false);
    setSelectedSticker(sticker.id);
    setDraft((current) => ({ ...current, stickers: [...current.stickers, sticker] }));
  }

  function updateSticker(id: string, patch: Partial<PhotoSticker>) {
    setDraft((current) => ({
      ...current,
      stickers: current.stickers.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  }

  function removeSticker(id: string) {
    setDraft((current) => ({
      ...current,
      stickers: current.stickers.filter((item) => item.id !== id),
    }));
    setSelectedSticker((current) => (current === id ? null : current));
    setStickerNotice(false);
  }

  /* ------------------------------ Guardar ------------------------------ */

  function handleSave() {
    // Un video nunca lleva recorte, texto ni emojis quemados (ver `kind`): se
    // guardan vacíos explícitamente para que un borrador arrastrado no los cuele.
    if (isVideo) {
      onSave({
        ...draft,
        captionText: "",
        crop: FULL_CROP,
        cropAspect: DEFAULT_CROP_ASPECT,
        cropRatio: 0,
        stickers: [],
      });
      return;
    }

    /**
     * EL RECT SE CALCULA ACÁ, en el único momento en que importa. Mientras se
     * edita, el encuadre vive como scale/offset del stage —que es lo que el
     * dedo mueve—; convertirlo a fracciones de la foto en cada frame del
     * arrastre sería la misma cuenta cientos de veces para un valor que sólo se
     * lee al publicar.
     *
     * Sin stage medido (la imagen nunca cargó) se conserva lo que ya estaba: no
     * se puede inventar un encuadre sobre una foto que no se pudo mirar.
     */
    const crop =
      natural && stageState && stage.width > 0
        ? cropRectFrom({ natural, stage, scale: stageState.scale, offset: stageState.offset })
        : draft.crop;
    onSave({
      ...draft,
      captionText: draft.captionText.trim(),
      crop,
      // La FORMA del recuadro publicado, para que la miniatura del composer
      // pueda pintar el recorte sin volver a cargar la foto para medirla.
      cropRatio: isFullCrop(crop) || stage.height === 0 ? 0 : stage.width / stage.height,
      stickers: normalizeStickers(draft.stickers),
    });
  }

  const filterCss = photoEditFilterCss(draft);
  const captionLength = draft.captionText.length;
  const zoomPercent =
    natural && stageState && stage.width > 0
      ? Math.round((stageState.scale / coverScaleFor(natural, stage)) * 100)
      : 100;
  const active = draft.stickers.find((item) => item.id === selectedSticker) ?? null;
  const tabs = isVideo ? TABS.filter((item) => item.id === "filters") : TABS;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* ── LA FOTO, ARRIBA Y FIJA ──────────────────────────────────────────
          Nunca scrollea: es la referencia contra la que se toma cada decisión
          de abajo, y perderla de vista mientras se elige un filtro convierte
          "elegir" en "probar y volver a subir". El alto está topado en vh para
          que en un teléfono chico las pestañas y el pie sigan alcanzándose con
          el pulgar. */}
      <div className="shrink-0 px-5 pt-3">
        {/* ANCHO POR `min()`, no alto por `max-height`. Con el ancho al 100% y
            un `aspect-ratio`, un `max-h` recorta el alto y DEFORMA la caja: la
            relación deja de cumplirse justo en la pantalla más chica, que es
            donde el encuadre importa. Con el ancho atado a los tres topes a la
            vez —el contenedor, la medida de lectura y el alto disponible— la
            relación se cumple siempre y la foto nunca se come la pantalla. */}
        <div
          className="relative mx-auto overflow-hidden rounded-xl bg-surface-subtle"
          style={{
            aspectRatio: isVideo ? "4 / 5" : `${ratio}`,
            width: `min(100%, 24rem, calc(42vh * ${isVideo ? 0.8 : ratio}))`,
          }}
        >
          <div
            ref={stageRef}
            role={cropping ? "group" : undefined}
            aria-label={cropping ? COPY.composer.photoEditor.cropStageLabel : undefined}
            tabIndex={cropping ? 0 : -1}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            onPointerCancel={onStagePointerUp}
            onKeyDown={onStageKeyDown}
            className={cn(
              "absolute inset-0 overflow-hidden",
              cropping && "cursor-grab touch-none focus-visible:outline-none",
              cropping && "focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
              dragging && "cursor-grabbing",
            )}
          >
            {isVideo ? (
              /* El video REPRODUCIÉNDOSE con el filtro encima: es literalmente
                 lo que va a ver la comunidad, porque en el feed el filtro
                 también se aplica al pintar y no está quemado en el archivo.
                 Mudo y en bucle —esto es una vista previa— y sin controles para
                 que nada compita con los chips de abajo. */
              <video
                src={preview}
                style={{ filter: filterCss || undefined }}
                className="absolute inset-0 size-full object-contain"
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element -- preview local (blob:) */
              <img
                src={preview}
                alt=""
                draggable={false}
                onLoad={(event) =>
                  setNatural({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                style={
                  natural && stageState
                    ? {
                        filter: filterCss || undefined,
                        width: natural.width * stageState.scale,
                        height: natural.height * stageState.scale,
                        // El mismo modelo del recorte del avatar: la foto
                        // centrada y corrida por `offset`. Sólo `transform`,
                        // que no dispara layout durante el arrastre.
                        transform: `translate(-50%, -50%) translate(${stageState.offset.x}px, ${stageState.offset.y}px)`,
                      }
                    : { filter: filterCss || undefined }
                }
                className={cn(
                  "absolute left-1/2 top-1/2 max-w-none select-none",
                  !natural || !stageState ? "size-full -translate-x-1/2 -translate-y-1/2 object-cover" : "",
                )}
              />
            )}

            {/* Guías del encuadre: SÓLO mientras se recorta. Fuera de esa
                pestaña la foto tiene que verse limpia — una grilla permanente
                sobre la vista previa se lee como parte de la foto. */}
            {cropping && (
              <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                <div className="absolute inset-0 ring-1 ring-inset ring-on-media/30" />
                <div className="absolute inset-y-0 left-1/3 w-px bg-on-media/20" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-on-media/20" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-on-media/20" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-on-media/20" />
              </div>
            )}
          </div>

          {/* Texto y emojis van FUERA del stage que se arrastra: se posicionan
              contra el recuadro publicado, no contra la foto cruda. Es la misma
              regla que aplica `bake-photo.ts` al hornear. */}
          {!isVideo && !cropping && draft.captionText.trim() && (
            <PhotoCaptionOverlay
              text={draft.captionText}
              position={draft.captionPosition}
              background={draft.captionBackground}
              color={draft.captionColor}
              font={draft.captionFont}
              textClassName="text-lg"
            />
          )}
          {!isVideo && !cropping && (
            <StickerLayer
              stickers={draft.stickers}
              box={stage}
              selectedId={tab === "stickers" ? selectedSticker : null}
              interactive={tab === "stickers"}
              reduce={reduce}
              onSelect={setSelectedSticker}
              onMove={(id, x, y) => updateSticker(id, { x, y })}
            />
          )}
        </div>
      </div>

      {/* ── PESTAÑAS ─────────────────────────────────────────────────────── */}
      {!isVideo && (
        <div
          role="tablist"
          aria-label={COPY.composer.photoEditor.tabsLabel}
          className="mt-3 flex shrink-0 gap-1 border-b border-border-subtle px-5"
        >
          {tabs.map((item) => {
            const on = item.id === tab;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => openTab(item.id)}
                className={cn(
                  "relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-t-lg px-1 pb-2 pt-1",
                  "text-[11px] font-medium transition-colors duration-(--duration-fast)",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
                  on ? "text-brand-ink" : "text-foreground-muted hover:text-foreground-secondary",
                )}
              >
                {item.icon}
                {item.label}
                {/* Subrayado de la pestaña activa: `scale-x` y no `width`, que
                    dispararía layout en cada cambio. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-x-1 bottom-0 h-0.5 origin-center rounded-full bg-brand",
                    "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
                    on ? "scale-x-100" : "scale-x-0",
                  )}
                />
              </button>
            );
          })}
        </div>
      )}

      {/* ── PANEL DE LA HERRAMIENTA ──────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4 pt-3">
        {tab === "crop" && !isVideo && (
          <div className="flex flex-col gap-3">
            <fieldset>
              <legend className="text-xs font-medium uppercase tracking-wider text-foreground-muted">
                {COPY.composer.photoEditor.cropAspectLabel}
              </legend>
              {/* 2×2 en un teléfono angosto y una sola fila cuando entra:
                  "Panorámica" al lado de otras tres en 375 px parte la palabra
                  en dos renglones dentro del botón. */}
              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CROP_ASPECTS.map((aspect) => (
                  <button
                    key={aspect}
                    type="button"
                    onClick={() => changeAspect(aspect)}
                    aria-pressed={aspect === draft.cropAspect}
                    className={optionButtonClass(aspect === draft.cropAspect)}
                  >
                    {ASPECT_LABELS[aspect]}
                  </button>
                ))}
              </div>
            </fieldset>

            <div>
              <label
                htmlFor="photo-editor-zoom"
                className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-foreground-muted"
              >
                {COPY.composer.photoEditor.cropZoomLabel}
                <span className="tabular-nums normal-case tracking-normal">{zoomPercent}%</span>
              </label>
              {/* El deslizador NO es un extra del pellizco: es el camino que
                  funciona con teclado, con lector de pantalla y con un solo
                  dedo. Un zoom que sólo existe como gesto no existe para todos. */}
              <input
                id="photo-editor-zoom"
                type="range"
                min={100}
                max={MAX_CROP_ZOOM * 100}
                step={1}
                value={Math.min(Math.max(zoomPercent, 100), MAX_CROP_ZOOM * 100)}
                disabled={!natural || !stageState}
                aria-valuetext={COPY.composer.photoEditor.cropZoomValue(zoomPercent)}
                onChange={(event) => {
                  if (!natural || !stageState) return;
                  const scale = clampCropScale(
                    coverScaleFor(natural, stage) * (Number(event.target.value) / 100),
                    natural,
                    stage,
                  );
                  commitStage({
                    scale,
                    offset: clampCropOffset(stageState.offset, natural, scale, stage),
                  });
                }}
                className={cn("mt-1", sliderClass)}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-foreground-muted">
                <ArrowsOutCardinal size={14} className="mt-px shrink-0" aria-hidden="true" />
                {COPY.composer.photoEditor.cropHint}
              </p>
              {manual !== null && (
                <button
                  type="button"
                  onClick={() => setManual(null)}
                  className="min-h-11 shrink-0 text-xs font-medium text-brand-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                >
                  {COPY.composer.photoEditor.cropReset}
                </button>
              )}
            </div>
          </div>
        )}

        {tab === "filters" && (
          <>
            {/* Filtros: miniaturas REALES de este medio, no swatches genéricos.
                En un video son un fotograma suyo (ver `videoThumb`); el
                catálogo, el carrusel y el deslizador son EXACTAMENTE los mismos
                que en una foto — un segundo selector "para video" sería otro
                catálogo que mantener y otra forma de que los dos digan cosas
                distintas. */}
            <FilterCarousel
              preview={isVideo ? videoThumb : preview}
              filterId={draft.filterId}
              intensity={draft.filterIntensity}
              /**
               * Elegir un preset devuelve la intensidad al 100%: si alguien dejó
               * "Vintage" en 30% y salta a "Carbón", lo que quiere ver es Carbón,
               * no un Carbón apagado por una decisión que tomó sobre otro filtro.
               */
              onFilterChange={(id) =>
                setDraft((current) => ({
                  ...current,
                  filterId: id,
                  filterIntensity: DEFAULT_PHOTO_FILTER_INTENSITY,
                }))
              }
              onIntensityChange={(value) =>
                setDraft((current) => ({ ...current, filterIntensity: value }))
              }
            />
            {isVideo && (
              /* Por qué esto es instantáneo y por qué el video no se arruina. Es
                 la única pregunta que aparece sola al ver un filtro sobre un
                 video ("¿me lo va a recomprimir?"), y se contesta antes de que
                 se haga. */
              <p className="mt-3 shrink-0 text-xs leading-relaxed text-foreground-muted">
                {VIDEO_EDITOR_COPY.hint}
              </p>
            )}
          </>
        )}

        {tab === "text" && !isVideo && (
          <div className="flex flex-col gap-3">
            <div>
              <label htmlFor="photo-editor-caption" className="sr-only">
                {COPY.composer.photoEditor.textareaLabel}
              </label>
              <Input
                id="photo-editor-caption"
                value={draft.captionText}
                maxLength={CAPTION_MAX_LENGTH}
                placeholder={COPY.composer.photoEditor.textareaPlaceholder}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, captionText: event.target.value }))
                }
              />
              <p className="mt-1 text-right text-xs text-foreground-muted">
                {captionLength}/{CAPTION_MAX_LENGTH}
              </p>
            </div>

            {/* Los controles de estilo aparecen cuando HAY texto: elegir el
                color de una frase que todavía no existe no significa nada, y
                cinco controles vacíos al abrir la pestaña son ruido. */}
            {draft.captionText.trim() && (
              <>
                <fieldset>
                  <legend className="text-xs font-medium uppercase tracking-wider text-foreground-muted">
                    {COPY.composer.photoEditor.colorLabel}
                  </legend>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {CAPTION_COLOR_LIST.map((color) => {
                      const on = color.id === draft.captionColor;
                      return (
                        <button
                          key={color.id}
                          type="button"
                          onClick={() =>
                            setDraft((current) => ({ ...current, captionColor: color.id }))
                          }
                          aria-pressed={on}
                          // El color NUNCA es el único indicador de qué está
                          // elegido (regla `color-not-only`): el nombre viaja en
                          // el rótulo y el activo suma un aro y una escala.
                          aria-label={color.label}
                          title={color.label}
                          className={cn(
                            "grid min-h-11 min-w-11 place-items-center rounded-full",
                            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                          )}
                        >
                          <span
                            aria-hidden="true"
                            style={{ backgroundColor: color.fill }}
                            className={cn(
                              "block size-7 rounded-full ring-1 ring-inset ring-border",
                              "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
                              on && "scale-110 ring-[3px] ring-brand",
                            )}
                          />
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="text-xs font-medium uppercase tracking-wider text-foreground-muted">
                    {COPY.composer.photoEditor.fontLabel}
                  </legend>
                  {/* Misma grilla que las formas del recorte, y por el mismo
                      motivo: cuatro nombres de tipografía no entran en una fila
                      de 375 px sin partirse. */}
                  <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {CAPTION_FONT_LIST.map((font) => (
                      <button
                        key={font.id}
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({ ...current, captionFont: font.id }))
                        }
                        aria-pressed={font.id === draft.captionFont}
                        // Cada opción se escribe CON su propia tipografía: es la
                        // diferencia entre elegir y adivinar, igual que las
                        // miniaturas del carrusel de filtros.
                        style={{ fontFamily: captionFontCss(font.id) }}
                        className={optionButtonClass(font.id === draft.captionFont)}
                      >
                        {font.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="text-xs font-medium uppercase tracking-wider text-foreground-muted">
                    {COPY.composer.photoEditor.positionLabel}
                  </legend>
                  <div className="mt-1.5 flex gap-2">
                    {POSITION_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({ ...current, captionPosition: option.value }))
                        }
                        aria-pressed={option.value === draft.captionPosition}
                        className={optionButtonClass(option.value === draft.captionPosition)}
                      >
                        {option.icon}
                        {option.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="text-xs font-medium uppercase tracking-wider text-foreground-muted">
                    {COPY.composer.photoEditor.backgroundLabel}
                  </legend>
                  <div className="mt-1.5 flex gap-2">
                    {BACKGROUND_OPTIONS.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({ ...current, captionBackground: value }))
                        }
                        aria-pressed={value === draft.captionBackground}
                        className={optionButtonClass(value === draft.captionBackground)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <button
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, captionText: "" }))}
                  className="min-h-11 self-start text-xs font-medium text-danger-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                >
                  {COPY.composer.photoEditor.removeText}
                </button>
              </>
            )}
          </div>
        )}

        {tab === "stickers" && !isVideo && (
          <div className="flex flex-col gap-3">
            {/* El emoji seleccionado manda: su tamaño y su botón de quitar van
                ARRIBA del catálogo, no escondidos al final — quien acaba de
                poner uno está mirando la foto, no la grilla. */}
            {active && (
              <div className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-surface-subtle p-3">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="photo-editor-sticker-size"
                    className="text-xs font-medium uppercase tracking-wider text-foreground-muted"
                  >
                    {COPY.composer.photoEditor.stickerSizeLabel}
                  </label>
                  <button
                    type="button"
                    onClick={() => removeSticker(active.id)}
                    className="flex min-h-11 items-center gap-1 text-xs font-medium text-danger-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                  >
                    <Trash size={14} aria-hidden="true" />
                    {COPY.composer.photoEditor.removeSticker}
                  </button>
                </div>
                <input
                  id="photo-editor-sticker-size"
                  type="range"
                  min={Math.round(MIN_STICKER_SIZE * 100)}
                  max={Math.round(MAX_STICKER_SIZE * 100)}
                  step={1}
                  value={Math.round(active.size * 100)}
                  onChange={(event) =>
                    updateSticker(active.id, {
                      size: clampStickerSize(Number(event.target.value) / 100),
                    })
                  }
                  className={sliderClass}
                />
              </div>
            )}

            <p className="text-xs leading-relaxed text-foreground-muted">
              {COPY.composer.photoEditor.stickersHint}
            </p>

            {/* Un aviso, no un toast: el cupo se toca DENTRO de esta grilla y la
                respuesta tiene que estar donde se tocó. */}
            {stickerNotice && (
              <p role="status" className="text-xs font-medium text-warning-ink">
                {COPY.composer.photoEditor.stickerFull}
              </p>
            )}

            {/* EL MISMO PICKER QUE EL COMENTARIO (components/emojis).
                Antes acá vivía una grilla propia con `STICKER_GROUPS`; desde la
                0125 hay emojis PROPIOS de la comunidad y tienen que aparecer en
                las tres superficies. Dos grillas distintas —una acá y otra en el
                comentario— serían dos lugares donde arreglar el mismo problema
                de accesibilidad, de carga diferida y de estados vacíos. Los
                clásicos siguen estando: son la pestaña "Clásicos" del picker. */}
            <EmojiPicker
              community={communityEmojis.state}
              onRetry={communityEmojis.retry}
              onPickCommunity={(emoji) =>
                addSticker({
                  // Sin glifo: lo que se pinta es la imagen. `photo-overlay.ts`
                  // descarta un sticker que no tenga ni una cosa ni la otra.
                  emoji: "",
                  image: { slug: emoji.slug, url: emoji.url, alt: emoji.alt },
                })
              }
              unicodeGroups={STICKER_GROUPS}
              onPickUnicode={(emoji) => addSticker({ emoji })}
              // Acá el emoji no "se agrega": se PONE sobre la foto y después se
              // arrastra. El nombre accesible tiene que decir eso, y tiene que
              // decir lo mismo para un glifo y para un dibujo de la comunidad —
              // son dos botones vecinos que hacen exactamente lo mismo.
              labelForUnicode={COPY.composer.photoEditor.addSticker}
              labelForCommunity={EMOJI_COPY.addToPhoto}
            />

            {draft.stickers.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setDraft((current) => ({ ...current, stickers: [] }));
                  setSelectedSticker(null);
                  setStickerNotice(false);
                }}
                className="min-h-11 self-start text-xs font-medium text-danger-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
              >
                {COPY.composer.photoEditor.removeAllStickers}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-5 pt-3">
        <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={onCancel}>
          {COPY.composer.photoEditor.cancel}
        </Button>
        <Button type="button" variant="primary" size="md" className="ml-auto" onClick={handleSave}>
          <Check size={16} aria-hidden="true" />
          {COPY.composer.photoEditor.done}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// La foto YA EDITADA, en chiquito — para la tira del composer
// ---------------------------------------------------------------------------

/**
 * Lo que va a salir publicado, dentro de la caja que le den. La usa la tira de
 * miniaturas de `composer-sheet.tsx`.
 *
 * Existe por una razón concreta: desde que el editor recorta, una miniatura con
 * `object-cover` MIENTE. Muestra la foto entera encuadrada por el navegador, no
 * el recorte que la persona eligió — y como el recorte se quema al publicar,
 * esa mentira sólo se descubre viendo la publicación.
 *
 * CÓMO SE PINTA EL RECORTE SIN VOLVER A CARGAR LA IMAGEN. La caja interior toma
 * la FORMA del recuadro publicado (`edit.cropRatio`, guardado por el editor
 * justamente para esto) y la foto se estira dentro de un rectángulo virtual del
 * tamaño de la foto entera, corrido para que la porción elegida quede
 * exactamente sobre la caja. Como la caja y el recorte tienen la misma
 * proporción, `object-fill` no deforma nada: es la misma cuenta que hace el
 * canvas al hornear, escrita en porcentajes.
 *
 * Sin recorte (`cropRatio` en 0, o el recorte completo) se pinta como siempre,
 * con `object-cover`: el camino que ya funcionaba no cambia.
 */
export function PhotoEditPreview({
  preview,
  edit,
  textClassName,
  className,
}: {
  preview: string;
  edit: PhotoEdit | undefined | null;
  textClassName?: string;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  // Los emojis se colocan en píxeles del recuadro (misma cuenta que el
  // horneado): hay que saber cuánto mide esta caja, y en la tira mide distinto
  // que en el editor.
  useLayoutEffect(() => {
    const node = boxRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setBox({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const crop = photoEditCrop(edit);
  const cropped = !isFullCrop(crop) && (edit?.cropRatio ?? 0) > 0;
  const filter = photoEditFilterCss(edit) || undefined;

  const photo = cropped ? (
    /* eslint-disable-next-line @next/next/no-img-element -- preview local (blob:) */
    <img
      src={preview}
      alt=""
      style={{
        filter,
        width: `${100 / crop.width}%`,
        height: `${100 / crop.height}%`,
        left: `${(-crop.x * 100) / crop.width}%`,
        top: `${(-crop.y * 100) / crop.height}%`,
        objectFit: "fill",
      }}
      className="absolute max-w-none"
    />
  ) : (
    /* eslint-disable-next-line @next/next/no-img-element -- preview local (blob:) */
    <img src={preview} alt="" style={{ filter }} className="absolute inset-0 size-full object-cover" />
  );

  return (
    <div
      ref={boxRef}
      style={cropped ? { aspectRatio: `${edit?.cropRatio}` } : undefined}
      className={cn(
        "relative overflow-hidden",
        // Con recorte, la caja toma la forma elegida y se centra dentro del
        // tile: la franja que queda a los costados es honesta —muestra que la
        // foto publicada NO ocupa ese rectángulo—, no un error de encuadre.
        cropped ? "mx-auto my-auto max-h-full max-w-full" : "size-full",
        className,
      )}
    >
      {photo}
      {edit?.captionText.trim() && (
        <PhotoCaptionOverlay
          text={edit.captionText}
          position={edit.captionPosition}
          background={edit.captionBackground}
          color={edit.captionColor}
          font={edit.captionFont}
          className="py-1"
          textClassName={textClassName}
        />
      )}
      <StickerLayer stickers={edit?.stickers ?? []} box={box} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Emojis sobre la foto — la capa que se arrastra
// ---------------------------------------------------------------------------

/**
 * Los emojis puestos, en su lugar. La cuenta de dónde y de qué tamaño NO vive
 * acá: la hace `stickerBox` (photo-overlay.ts), la MISMA que corre el horneado.
 * Ésa es toda la garantía de que el emoji que se ve en el hombro no aparezca
 * en la oreja al publicar.
 *
 * `interactive` en false lo deja como pura pintura: así la misma pieza sirve
 * para la miniatura de la tira del composer, donde nada se arrastra.
 */
export function StickerLayer({
  stickers,
  box,
  selectedId = null,
  interactive = false,
  reduce = false,
  onSelect,
  onMove,
}: {
  stickers: readonly PhotoSticker[];
  /** Tamaño del recuadro en px. Con 0 todavía no se midió: no se pinta nada. */
  box: { width: number; height: number };
  selectedId?: string | null;
  interactive?: boolean;
  reduce?: boolean;
  onSelect?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
}) {
  const drag = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(
    null,
  );

  if (stickers.length === 0 || box.width === 0 || box.height === 0) return null;

  function move(event: ReactPointerEvent<HTMLElement>) {
    const state = drag.current;
    if (!state || !onMove) return;
    // Píxeles arrastrados → fracción del recuadro: es lo que se guarda, y por
    // eso el emoji queda donde se lo soltó aunque la próxima pantalla mida otra
    // cosa.
    const x = state.x + (event.clientX - state.startX) / box.width;
    const y = state.y + (event.clientY - state.startY) / box.height;
    onMove(state.id, Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
  }

  return (
    <div
      className={cn("absolute inset-0", interactive ? "" : "pointer-events-none")}
      aria-hidden={interactive ? undefined : "true"}
    >
      {stickers.map((sticker, index) => {
        const { centerX, centerY, fontSize } = stickerBox(sticker, box);
        const on = sticker.id === selectedId;
        const style: React.CSSProperties = {
          left: centerX,
          top: centerY,
          // Un emoji de la comunidad (0125) es una IMAGEN: se mide en píxeles,
          // no en cuerpo de fuente. `fontSize` sigue siendo el ALTO en los dos
          // casos —la cuenta de `stickerBox` no cambia—, así que el deslizador
          // de tamaño significa lo mismo para un glifo y para un dibujo.
          ...(sticker.image
            ? { width: fontSize, height: fontSize }
            : { fontSize, lineHeight: 1, fontFamily: STICKER_FONT_FAMILY }),
          // Halo suave, igual que el horneado: un emoji oscuro sobre una foto
          // oscura desaparece y no tiene barra donde apoyarse.
          filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.35))",
        };

        if (!interactive) {
          return (
            <span
              key={sticker.id}
              style={style}
              className="absolute -translate-x-1/2 -translate-y-1/2 select-none"
            >
              <StickerFace sticker={sticker} />
            </span>
          );
        }

        return (
          <button
            key={sticker.id}
            type="button"
            style={style}
            // Para un emoji de la comunidad el nombre sale de `alt`, que la
            // base exige (0125). Sin eso, un dibujo pegado sobre la foto se
            // anunciaría como un botón sin nombre y no habría forma de saber
            // cuál de los ocho se está por mover.
            aria-label={COPY.composer.photoEditor.stickerOnPhoto(
              sticker.image?.alt ?? sticker.emoji,
              index + 1,
              stickers.length,
            )}
            aria-pressed={on}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = {
                id: sticker.id,
                startX: event.clientX,
                startY: event.clientY,
                x: sticker.x,
                y: sticker.y,
              };
              onSelect?.(sticker.id);
            }}
            onPointerMove={move}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            // Teclado: mover con flechas es el camino equivalente al arrastre.
            // Sin esto el emoji sólo se podría colocar con el dedo, que es la
            // definición de una función que no existe para todo el mundo.
            onKeyDown={(event) => {
              if (!onMove) return;
              let { x, y } = sticker;
              const step = event.shiftKey ? KEYBOARD_STEP_FRACTION * 3 : KEYBOARD_STEP_FRACTION;
              if (event.key === "ArrowLeft") x -= step;
              else if (event.key === "ArrowRight") x += step;
              else if (event.key === "ArrowUp") y -= step;
              else if (event.key === "ArrowDown") y += step;
              else return;
              event.preventDefault();
              onMove(sticker.id, Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
            }}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2 select-none touch-none",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              // El aro del seleccionado es un `outline` y no un `ring` con
              // offset: sobre un emoji sin caja rectangular, el offset queda
              // flotando lejos del glifo.
              on && "rounded-lg outline outline-2 outline-offset-2 outline-brand",
              !reduce && "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-110",
            )}
          >
            <StickerFace sticker={sticker} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * LO QUE SE VE del sticker: un glifo o el dibujo de la comunidad.
 *
 * Siempre `aria-hidden`: el nombre accesible lo pone quien envuelve (el botón
 * que se arrastra, o nada en la miniatura, que es pura pintura). Un `alt` acá
 * adentro haría que un lector de pantalla leyera la descripción dos veces.
 *
 * Es un `<img>` pelado y no `next/image` por lo mismo que en el picker: el
 * archivo ya viene optimizado del bucket, y tiene que ser la MISMA URL que
 * después pide el horneado para que salga de la caché del navegador.
 */
function StickerFace({ sticker }: { sticker: PhotoSticker }) {
  if (sticker.image) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element -- ver el docblock */
      <img
        src={sticker.image.url}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none block size-full select-none object-contain"
      />
    );
  }
  return <span aria-hidden="true">{sticker.emoji}</span>;
}

// ---------------------------------------------------------------------------
// Overlay del texto — la MISMA pieza para la miniatura de la grilla y la
// vista previa grande de acá. `bake-photo.ts` no la importa (dibuja en canvas
// con su propia lógica de ajuste de línea) pero lee los MISMOS valores de
// color y tipografía desde `photo-overlay.ts`, así que lo que se ve en la UI
// es lo que sale publicado.
// ---------------------------------------------------------------------------

export function PhotoCaptionOverlay({
  text,
  position,
  background,
  color = DEFAULT_CAPTION_COLOR,
  font = DEFAULT_CAPTION_FONT,
  className,
  textClassName,
}: {
  text: string;
  position: CaptionPosition;
  background: CaptionBackground;
  color?: CaptionColorId;
  font?: CaptionFontId;
  className?: string;
  textClassName?: string;
}) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const tint = resolveCaptionColor(color);
  return (
    <div
      aria-hidden="true"
      // La barra y el halo salen de `photo-overlay.ts`, no de clases de
      // Tailwind: son los MISMOS valores que quema el canvas, y un token del
      // tema acá haría que la vista previa cambiara con el modo oscuro mientras
      // el JPEG publicado se queda como está.
      style={background === "solid" ? { backgroundColor: captionBarFill(tint) } : undefined}
      className={cn(
        "pointer-events-none absolute inset-x-0 flex justify-center px-3 py-2",
        position === "top" && "top-0",
        position === "center" && "top-1/2 -translate-y-1/2",
        position === "bottom" && "bottom-0",
        className,
      )}
    >
      <span
        style={{
          color: tint.fill,
          fontFamily: captionFontCss(font),
          textShadow:
            background === "none"
              ? `0 1px 6px ${captionHaloColor(tint)}, 0 0 2px ${captionHaloColor(tint)}`
              : undefined,
        }}
        className={cn(
          "line-clamp-4 max-w-full break-words text-center font-bold",
          textClassName ?? "text-sm",
        )}
      >
        {trimmed}
      </span>
    </div>
  );
}
