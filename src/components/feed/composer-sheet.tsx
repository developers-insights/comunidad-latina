"use client";

import { useState } from "react";
import { CaretDown, Check, Plus, SealCheck, VideoCamera, X } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { formatDuration, type VideoCategory } from "@/lib/media/video-policy";
import {
  VIDEO_CATEGORY_LABELS,
  VIDEO_CATEGORY_ORDER,
} from "@/app/(app)/videos/copy";
import { OriginalityFields, type DeclarationValue } from "@/components/integrity/originality-fields";
import { licenseLabel } from "@/lib/integrity/declarations";
import { COPY, VIDEO_EDITOR_COPY } from "./copy";
import { QuestionBanner } from "./question-banner";
import { TextBanner } from "./text-banner";
import {
  DEFAULT_PHOTO_EDIT,
  PhotoCaptionOverlay,
  PhotoEditor,
  photoEditFilterCss,
  type PhotoEdit,
} from "./photo-editor";

/**
 * PASO DE TEXTO del composer rápido (feedback cliente 2026-07-27).
 *
 * Antes el composer era una caja de texto Y, aparte, dos recuadros para adjuntar
 * — "no está el escrito aparte y aparte la foto". Ahora primero se elige QUÉ se
 * publica y recién entonces se abre esta hoja, con el medio a la vista y el
 * texto debajo: el modelo de Instagram (subir → siguiente → escribir el pie).
 *
 * Una sola hoja para los TRES caminos rápidos, porque comparten todo lo que
 * importa (texto, publicar, progreso, errores) y solo cambia la pieza de arriba:
 *  · `media`    → el medio elegido, grande, y el pie debajo.
 *  · `question` → la pregunta se ve COMO VA A SALIR (el banner de marca real) y
 *                 abajo el interruptor de la encuesta Sí/No.
 *  · `text`     → mismo principio que `question` (el cuerpo ES la pieza
 *                 gráfica, vista previa real vía TextBanner) pero SIN encuesta
 *                 — `kind='text'` nunca lleva poll_kind (0041/0043).
 *
 * Es presentacional a propósito: el estado (texto, archivos, subida) vive en
 * PostComposer, que es quien publica. Así no hay dos fuentes de verdad ni un
 * FileList viajando entre componentes. ÚNICA excepción: QUÉ FOTO se está
 * editando ahora mismo (`editingMediaId`) — es puramente de esta hoja (nunca
 * viaja a ningún lado), así que vive acá.
 */

const MAX_LENGTH = 2000;

export type ComposerMode = "media" | "question" | "text";

export interface ComposerMediaItem {
  id: string;
  kind: "photo" | "video";
  /** URL local (blob:) de la vista previa. */
  preview: string;
  /** Duración medida del video, en segundos (sólo en `kind: "video"`). */
  durationSeconds?: number;
  /**
   * Filtro (+ texto, sólo en foto) elegidos en el editor. Sin tocar el editor
   * queda `undefined` (= sin filtro, sin texto).
   *
   * LO COMPARTEN LOS DOS MEDIOS y el catálogo es el mismo; lo que cambia es
   * cuándo se aplica: en la foto se QUEMA en los píxeles al publicar
   * (`bake-photo.ts`) y en el video viaja como metadato (0104) para aplicarse al
   * reproducir. `captionText` sólo tiene sentido en foto — el editor lo fuerza a
   * vacío cuando se está editando un video.
   */
  edit?: PhotoEdit;
}

export interface ComposerSheetProps {
  open: boolean;
  onClose: () => void;
  mode: ComposerMode;
  body: string;
  onBodyChange: (value: string) => void;
  media: ComposerMediaItem[];
  canAddPhoto: boolean;
  canAddVideo: boolean;
  onAddPhotos: () => void;
  onAddVideo: () => void;
  onRemoveMedia: (id: string) => void;
  /** Cupo máximo de fotos (hoy 10) — sólo para el contador "3 de 10". */
  maxPhotos: number;
  /** Tope de videos por publicación — el contador lo muestra tal cual. */
  maxVideos: number;
  /** Se llama cuando se confirma la edición de una foto ("Listo" en el editor). */
  onSavePhotoEdit: (id: string, edit: PhotoEdit) => void;
  pollEnabled: boolean;
  onPollChange: (next: boolean) => void;
  /** Categoría de Videos Cortos elegida (0046). Sólo se usa si hay video. */
  videoCategory: VideoCategory;
  onVideoCategoryChange: (next: VideoCategory) => void;
  /** Declaración de originalidad y licencia (0061). Sólo aplica si hay medio. */
  declaration: DeclarationValue;
  onDeclarationChange: (next: DeclarationValue) => void;
  /** Id estable de la sesión: fija la variante de color de la vista previa. */
  previewId: string;
  /**
   * Progreso real de la subida de video, o null si no hay ninguna en curso.
   * `current`/`total` existen porque los videos suben DE A UNO: con varios, un
   * porcentaje que vuelve a 0% sin decir "2 de 3" se lee como un error.
   */
  videoUpload: { pct: number; current: number; total: number } | null;
  /** Leyendo la duración del archivo recién elegido (antes de subir nada). */
  measuringVideo?: boolean;
  /**
   * Horneado de fotos en curso al publicar (recompresión + filtro/texto,
   * SIEMPRE que hay al menos una foto — ver `bake-photo.ts`). `null` = no hay
   * horneado corriendo; con valor, `done` sube foto a foto, nunca es un
   * número mudo.
   */
  bakingProgress?: { done: number; total: number } | null;
  /**
   * Qué se está guardando DESPUÉS de que la publicación ya salió (etiquetas,
   * música). Son pasos propios porque necesitan el id del post recién creado, y
   * mientras corren el botón sigue diciendo "Publicando…" — sin esta línea, esa
   * espera parecería el post colgado en vez de dos guardados cortos.
   * `null` = no hay ninguno en curso.
   */
  finishingLabel?: string | null;
  isPending: boolean;
  /**
   * Apaga Publicar por un motivo que NO es "falta contenido": hoy, que el
   * servidor todavía no dijo con qué firmas se puede publicar (0023). No es lo
   * mismo que `isPending` —no hay nada en vuelo que mostrar— así que el botón
   * se apaga sin spinner, y quien lo apaga es responsable de decir por qué en
   * la hoja (lo hace `autoriaSlot`). Un botón apagado y mudo es un botón roto.
   */
  publishBlocked?: boolean;
  onPublish: () => void;
  /**
   * RANURAS PARA OTROS DOS FRENTES (contrato, no un extra). "Etiquetar
   * personas" y "Agregar música" son features de OTROS equipos que se enchufan
   * acá sin tocar este archivo: el frente de etiquetado monta `tagSlot`, el de
   * música monta `musicSlot`. Se renderizan como filas de acción entre el área
   * de medios y el campo de pie, con el mismo lenguaje visual que el resto de
   * las filas de la hoja. Si vienen `undefined` (el frente todavía no existe)
   * no se renderiza NI EL SEPARADOR — el composer padre es quien decide cuándo
   * y con qué llenarlas.
   */
  tagSlot?: React.ReactNode;
  musicSlot?: React.ReactNode;
  /**
   * A NOMBRE DE QUIÉN SALE ESTA PUBLICACIÓN (`posts.entity_listing_id`, 0023).
   *
   * Va PRIMERO, arriba de todo, y no es una preferencia de maquetación: quien
   * tiene un negocio o una ficha profesional necesita ver con qué nombre va a
   * salir ANTES de escribir, no después de publicar. Debajo del pie sería
   * exactamente igual de cierto y llegaría igual de tarde.
   *
   * `undefined` = no hay nada que decir (la persona sólo tiene su perfil) y no
   * se pinta ni el espacio — mismo contrato que `tagSlot` y `musicSlot`. Lo
   * llena `PostComposerHost`, que es quien sabe con qué firmas se puede
   * publicar; esta hoja sigue sin conocer la base de datos.
   */
  autoriaSlot?: React.ReactNode;
}

/**
 * Cómo se va a ver la encuesta, sin ser la encuesta. Decorativa y `aria-hidden`:
 * un control real acá pediría un post que todavía no existe, y votar en una
 * vista previa no significa nada.
 */
function PollPreview() {
  return (
    <div aria-hidden="true" className="w-full">
      <div className="flex flex-col gap-2">
        {[COPY.post.poll.yes, COPY.post.poll.no].map((label) => (
          <span
            key={label}
            className="flex min-h-11 w-full items-center rounded-full border border-on-media/25 bg-on-media/12 px-4 font-semibold text-on-media"
          >
            {label}
          </span>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-on-media/75">
        {COPY.post.poll.noVotesYet}
      </p>
    </div>
  );
}

/**
 * MARCO DE LA VISTA PREVIA — "así se va a ver" tiene que verse ENTERO.
 *
 * El bug (feedback cliente 2026-08-05: "el fondo cortado"): el banner fija su
 * alto con el espaciador `pt-[125%]` de TextBanner/QuestionBanner, o sea 125%
 * de SU ANCHO. A ancho completo de la hoja eso son ~416px en un teléfono de
 * 375 — y el área que scrollea de la hoja, con el teclado abierto (que es el
 * estado normal MIENTRAS se escribe, justo cuando aparece la vista previa),
 * mide ~374px menos la etiqueta y el campo de texto: ~215px. Medido en el
 * navegador: 78px de degradado quedaban fuera del viewport, siempre por abajo.
 * No era que el degradado no se pintara —el 4:5 sale exacto— sino que la pieza
 * pedía más alto del que la hoja tenía para mostrarla.
 *
 * El arreglo invierte la dependencia: en vez de que el ALTO salga del ancho
 * disponible, el ANCHO sale del alto disponible. La región es un contenedor de
 * tamaño (`container-type: size`) que toma el espacio que sobra en la columna,
 * y el marco mide `min(100%, 80cqh)` — 80% del alto de la región es
 * exactamente el ancho cuyo 4:5 entra justo. Con lugar de sobra gana el 100% y
 * la vista previa queda del tamaño real de la card; con el teclado arriba se
 * achica en proporción, pero entera. `max-h-full` cierra el caso raro (texto
 * que ni al 4:5 entra en ese ancho): lo que se recorta es el sobrante de
 * texto, nunca el fondo — el degradado llena el marco siempre.
 *
 * `min-h-40` es el piso: en un teléfono chico con el teclado abierto no hay
 * lugar para nada decente, así que la vista previa deja de encogerse y la hoja
 * scrollea, que es un problema que la persona puede resolver.
 */
function PreviewFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-40 flex-1 items-center justify-center [container-type:size]">
      <div className="max-h-full w-[min(100%,80cqh)] overflow-hidden rounded-xl border border-border-subtle">
        {children}
      </div>
    </div>
  );
}

/** Vista previa antes de escribir: no hay pieza todavía, solo la invitación. */
function PreviewPlaceholder({ label }: { label: string }) {
  return (
    <p className="shrink-0 rounded-xl border border-border-subtle bg-surface-subtle px-5 py-10 text-center text-sm text-foreground-muted">
      {label}
    </p>
  );
}

/**
 * =============================================================================
 * DECLARACIÓN DE ORIGINALIDAD Y LICENCIAS — plegada, y sólo cuando hay archivo
 * =============================================================================
 *
 * El pliego pide la declaración en todo lo que se sube. Ya está en /publicar y
 * en /marketplace/publicar, que son formularios largos y deliberados: ahí el
 * bloque va desplegado y no molesta a nadie. Acá el contexto es el opuesto y por
 * eso la decisión es otra.
 *
 * ── POR QUÉ PLEGADA ──────────────────────────────────────────────────────────
 * Este composer es el camino más caliente de la app y su promesa es la
 * velocidad: elegir foto → escribir (o ni eso) → Publicar. El bloque completo
 * son cuatro controles —casilla, selector, textarea y URL—: metidos abiertos en
 * una hoja que con el teclado arriba mide ~215px de alto útil (ver PreviewFrame),
 * empujan "Publicar" fuera de la pantalla y convierten tres toques en un scroll.
 * Plegada es UN renglón, y el renglón dice lo que hay que saber para decidir si
 * vale la pena abrirlo.
 *
 * Plegada NO es escondida: el resumen está siempre visible, es un `<summary>`
 * real (foco, Enter/Espacio y estado "expandido" anunciado sin que lo
 * implementemos), llega a 44px y muestra el estado actual. Quien no la abre no
 * declaró nada — que es exactamente lo que el pipeline va a leer, sin fingir lo
 * contrario.
 *
 * ── POR QUÉ SÓLO CON FOTO O VIDEO ────────────────────────────────────────────
 * La declaración habla de un ARCHIVO. `createPostAction` registra
 * `content_assets` únicamente para fotos y videos: en `question` y en `text` no
 * hay ningún activo del que declarar nada, y mostrar el bloque igual sería pedir
 * una afirmación sobre algo que no existe. Un control que aparece donde no
 * significa nada enseña a ignorarlo también donde sí.
 *
 * ── POR QUÉ ACÁ Y NO EN OTRA HOJA ────────────────────────────────────────────
 * Una segunda hoja encima de esta son dos trampas de foco peleándose, que es el
 * mismo motivo por el que el aviso de "todo post lleva imagen" tampoco tiene
 * hoja propia (ver PostComposer). Y un modal de "aceptá" se cierra sin leer:
 * mismo argumento que ya está escrito en `lib/integrity/declarations.ts`.
 *
 * ⚠️ El descargo ("esto es lo que nos contás vos: no lo verificamos y no
 * equivale a un certificado de propiedad") lo pinta `OriginalityFields` y NO se
 * toca. La huella perceptual que calcula Content Integrity es una herramienta
 * interna de moderación, no una prueba de propiedad intelectual, y ninguna línea
 * de este bloque puede sugerir lo contrario.
 */
function DeclarationDisclosure({
  photos,
  hasVideo,
  value,
  onChange,
  disabled,
}: {
  photos: number;
  hasVideo: boolean;
  value: DeclarationValue;
  onChange: (next: DeclarationValue) => void;
  disabled: boolean;
}) {
  const C = COPY.composer.compose.declaration;
  // "Declaró algo" es haber tocado el tilde O haber elegido una licencia
  // distinta del default. `desconocido` sin tilde es "todavía no dijo nada".
  const declared = value.originalityDeclared || value.licenseKind !== "desconocido";

  return (
    <details className="group mt-3 shrink-0 rounded-lg border border-border-subtle bg-surface-subtle">
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-start gap-3 p-4",
          "[&::-webkit-details-marker]:hidden",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          "rounded-lg",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            {C.title(photos, hasVideo)}
          </span>
          {/* El estado se lee por ÍCONO Y TEXTO, nunca sólo por color. */}
          <span
            className={cn(
              "mt-0.5 flex items-start gap-1.5 text-xs leading-relaxed",
              declared ? "text-foreground-secondary" : "text-foreground-muted",
            )}
          >
            {declared && (
              <SealCheck
                size={14}
                weight="fill"
                aria-hidden="true"
                className="mt-px shrink-0 text-success"
              />
            )}
            {declared ? licenseLabel(value.licenseKind) : C.hint}
          </span>
        </span>
        <CaretDown
          size={16}
          aria-hidden="true"
          className={cn(
            "mt-1 shrink-0 text-foreground-muted",
            "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
            "group-open:rotate-180",
          )}
        />
      </summary>

      {/* `fieldset[disabled]` apaga los cuatro controles de una: mientras se
          publica no se puede cambiar lo que ya se está mandando. */}
      <fieldset disabled={disabled} className="m-0 border-0 p-0">
        <OriginalityFields
          idPrefix="composer-declaracion"
          value={value}
          onChange={onChange}
          title={null}
          intro={C.intro}
          className="rounded-none border-0 bg-transparent px-4 pb-4 pt-0"
        />
      </fieldset>
    </details>
  );
}

/** Interruptor accesible de verdad: `role="switch"` + `aria-checked`, 44px. */
function PollSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border p-3 text-left",
        "transition-[background-color,border-color] duration-(--duration-fast)",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        "disabled:pointer-events-none disabled:opacity-45",
        checked ? "border-brand bg-brand/8" : "border-border bg-surface",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {COPY.composer.compose.pollLabel}
        </span>
        <span className="mt-0.5 block text-xs text-foreground-secondary">
          {COPY.composer.compose.pollHint}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "flex h-7 w-12 shrink-0 items-center rounded-full p-0.5",
          "transition-colors duration-(--duration-fast) ease-(--ease-spring)",
          checked ? "bg-brand" : "bg-border",
        )}
      >
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full bg-surface shadow-xs",
            "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        >
          {checked && <Check size={13} weight="bold" className="text-brand" />}
        </span>
      </span>
    </button>
  );
}

/** Botón-pastilla con borde punteado — mismo lenguaje visual en toda la hoja. */
const dashedTileClass = cn(
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-dashed border-border",
  "px-4 text-sm font-medium text-foreground-secondary",
  "transition-colors duration-(--duration-fast) hover:border-brand hover:bg-surface-subtle",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
  "disabled:pointer-events-none disabled:opacity-45",
);

export function ComposerSheet({
  open,
  onClose,
  mode,
  body,
  onBodyChange,
  media,
  canAddPhoto,
  canAddVideo,
  onAddPhotos,
  onAddVideo,
  onRemoveMedia,
  maxPhotos,
  maxVideos,
  onSavePhotoEdit,
  pollEnabled,
  onPollChange,
  videoCategory,
  onVideoCategoryChange,
  declaration,
  onDeclarationChange,
  previewId,
  videoUpload,
  measuringVideo = false,
  bakingProgress = null,
  finishingLabel = null,
  isPending,
  publishBlocked = false,
  onPublish,
  tagSlot,
  musicSlot,
  autoriaSlot,
}: ComposerSheetProps) {
  const isQuestion = mode === "question";
  const isText = mode === "text";
  // Ambos exentos del trigger MEDIA_REQUIRED (0023/0043): question y text.
  const exemptFromMedia = isQuestion || isText;
  const photos = media.filter((item) => item.kind === "photo");
  const videos = media.filter((item) => item.kind === "video");
  const hasVideo = videos.length > 0;
  const hasMedia = media.length > 0;
  const trimmed = body.trim();

  /**
   * Qué MEDIO se está editando ahora (id) — puramente de esta hoja, ver docblock.
   *
   * Antes era "qué foto": el editor sólo abría sobre imágenes. Desde la 0104 el
   * video también tiene filtros (se guardan como metadato en vez de hornearse),
   * así que se busca en `media` entera y el panel decide qué ofrecer según el
   * `kind` — un solo estado, un solo editor, un solo catálogo.
   */
  const [editingMediaId, setEditingMediaId] = useState<string | null>(null);
  const editingItem = media.find((item) => item.id === editingMediaId) ?? null;

  /**
   * Escape / click en el velo / arrastre hacia abajo del `BottomSheet`
   * comparten este único `onClose`: con el editor de foto abierto, el primer
   * paso hacia atrás es salir del editor, NUNCA cerrar toda la composición
   * (perder el pie ya escrito y el resto de las fotos por una foto que se
   * estaba mirando de más).
   */
  function handleSheetClose() {
    if (editingItem) {
      setEditingMediaId(null);
      return;
    }
    onClose();
  }

  /**
   * QUÉ HABILITA PUBLICAR (feedback cliente 2026-08-05: "acá si no pongo algo
   * no me deja publicar. Que se pueda publicar así de una").
   *
   * La regla real es "que haya ALGO que publicar", no "que haya texto":
   *  · con foto o video, el pie es OPCIONAL — una foto ya es la publicación,
   *    igual que en Instagram;
   *  · en pregunta y texto el cuerpo ES la publicación: sin él no hay nada que
   *    mandar, así que sigue siendo obligatorio;
   *  · un post kind='post' SIN medio no pasa el trigger MEDIA_REQUIRED, y acá
   *    el botón se apaga —el medio está a un toque, en la misma pantalla— en
   *    vez de abrir otra hoja encima de esta y pelearse dos focus traps.
   *
   * El mínimo de 2 caracteres se mantiene SOLO para lo que sí se escribió: un
   * pie de un carácter es casi siempre un roce sin querer, y además es la misma
   * regla que valida el servidor (postSchema) — si el botón dejara pasar algo
   * que la action rechaza, la persona vería un error sin entender por qué.
   */
  const bodyOk = trimmed.length === 0 ? !exemptFromMedia : trimmed.length >= 2;
  const canPublish =
    bodyOk && !isPending && !publishBlocked && (exemptFromMedia || hasMedia);
  const bodyPlaceholder = isQuestion
    ? COPY.composer.compose.questionPlaceholder
    : isText
      ? COPY.composer.compose.textPlaceholder
      : COPY.composer.compose.mediaPlaceholder(photos.length, hasVideo);

  return (
    <BottomSheet
      open={open}
      onClose={handleSheetClose}
      size="tall"
      keyboardAware
      title={
        editingItem
          ? editingItem.kind === "video"
            ? VIDEO_EDITOR_COPY.title
            : COPY.composer.photoEditor.title
          : isQuestion
            ? COPY.composer.compose.questionTitle
            : isText
              ? COPY.composer.compose.textTitle
              : COPY.composer.compose.mediaTitle
      }
      // EN PAPEL NO EXISTE: es la hoja donde se COMPONE una publicación, un
      // overlay modal sobre toda la página. Además escribe tinta `on-media`
      // (chip de duración del video, botón "Quitar", la encuesta de la vista
      // previa), que es clara por definición — 1.00:1 sobre papel blanco si su
      // relleno no se imprime (ver src/test/print-contract.test.ts). Mismo
      // criterio que el visor de medios y la hoja de comentarios: el panel
      // entero se esconde. Sin efecto en pantalla (la regla es @media print).
      className="cl-print-hide"
      // `flex-1 min-h-0`: el cuerpo tiene que ESTIRARSE hasta el alto de la hoja
      // para que el pie quede anclado abajo; sin eso se encoge al contenido y el
      // botón de publicar queda flotando a media pantalla.
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
    >
      {editingItem ? (
        <PhotoEditor
          key={editingItem.id}
          preview={editingItem.preview}
          edit={editingItem.edit ?? DEFAULT_PHOTO_EDIT}
          // El panel es el mismo; lo que cambia es qué ofrece (ver PhotoEditor).
          kind={editingItem.kind === "video" ? "video" : "photo"}
          onCancel={() => setEditingMediaId(null)}
          onSave={(edit) => {
            onSavePhotoEdit(editingItem.id, edit);
            setEditingMediaId(null);
          }}
        />
      ) : (
        <>
          {/* `flex flex-col`: la vista previa tiene que poder CEDER alto (ver
              PreviewFrame). Todo lo demás va `shrink-0` — el campo de texto y el
              pie no se achican para hacerle lugar a una maqueta. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4 pt-3">
            {/* CON QUÉ NOMBRE VA A SALIR — lo primero de la hoja, arriba del
                medio y del pie. Ver el docblock de `autoriaSlot`. */}
            {autoriaSlot && <div className="mb-3 shrink-0">{autoriaSlot}</div>}

            {isQuestion ? (
              <>
                {/* La pregunta ya se ve como va a salir: mismo componente que el
                    feed, en modo vista previa (sin toque, sin navegación). */}
                <p className="mb-2 shrink-0 text-xs font-medium uppercase tracking-wider text-foreground-muted">
                  {COPY.composer.compose.previewLabel}
                </p>
                {trimmed.length > 0 ? (
                  <PreviewFrame>
                    <QuestionBanner
                      preview
                      postId={previewId}
                      question={body}
                      footer={pollEnabled ? <PollPreview /> : undefined}
                    />
                  </PreviewFrame>
                ) : (
                  <PreviewPlaceholder label={COPY.composer.compose.questionPlaceholder} />
                )}
              </>
            ) : isText ? (
              <>
                {/* Mismo principio que la pregunta: el texto ya se ve como va a
                    salir, sin encuesta debajo (kind='text' nunca la lleva). */}
                <p className="mb-2 shrink-0 text-xs font-medium uppercase tracking-wider text-foreground-muted">
                  {COPY.composer.compose.previewLabel}
                </p>
                {trimmed.length > 0 ? (
                  <PreviewFrame>
                    <TextBanner preview postId={previewId} text={body} />
                  </PreviewFrame>
                ) : (
                  <PreviewPlaceholder label={COPY.composer.compose.textPlaceholder} />
                )}
              </>
            ) : (
              <div className="shrink-0">
                {/* El medio elegido, protagonista: primero el que abre la
                    publicación, el resto en una tira debajo, y el tile "+" al
                    final — es lo que la gente busca para sumar otra foto
                    (antes sólo existía el botón textual de abajo). */}
                {(media.length > 0 || canAddPhoto) && (
                  <ul className="flex items-start gap-2 overflow-x-auto scrollbar-none pb-1">
                    {media.map((item, index) => (
                      <li
                        key={item.id}
                        className={cn(
                          "relative shrink-0 overflow-hidden rounded-xl bg-surface-subtle",
                          index === 0 ? "aspect-[4/5] w-40" : "aspect-square w-20",
                        )}
                      >
                        {item.kind === "photo" ? (
                          // Toda la miniatura es el disparador del editor —el
                          // botón de "Quitar" va ENCIMA, aparte, para que un
                          // toque en la esquina no abra el editor de una foto
                          // que se acaba de borrar.
                          <button
                            type="button"
                            onClick={() => setEditingMediaId(item.id)}
                            disabled={isPending}
                            aria-label={`${COPY.composer.editPhoto} ${index + 1}`}
                            className={cn(
                              "absolute inset-0 size-full",
                              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
                              "disabled:pointer-events-none",
                            )}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- preview local (blob:) */}
                            <img
                              src={item.preview}
                              alt=""
                              // MISMA función que la vista previa grande y que
                              // el horneado: preset + intensidad resueltos en
                              // un solo lugar (ver photo-editor.tsx).
                              style={{ filter: photoEditFilterCss(item.edit) || undefined }}
                              className="absolute inset-0 size-full object-cover"
                            />
                            {item.edit?.captionText.trim() && (
                              <PhotoCaptionOverlay
                                text={item.edit.captionText}
                                position={item.edit.captionPosition}
                                background={item.edit.captionBackground}
                                className="py-1"
                                textClassName={index === 0 ? "text-xs" : "text-[9px] leading-tight"}
                              />
                            )}
                          </button>
                        ) : (
                          <>
                            {/* El video también se toca para elegirle filtro
                                (0104), con el MISMO gesto que una foto: la
                                miniatura entera es el disparador y el botón de
                                "Quitar" queda encima, aparte. Que uno se pueda
                                editar y el otro no era la única diferencia
                                entre los dos medios, y no había ningún motivo
                                para que existiera. */}
                            <video
                              src={item.preview}
                              muted
                              playsInline
                              preload="metadata"
                              // El filtro elegido, ya visible en la tira: es
                              // exactamente como se va a ver publicado, porque
                              // en el feed también se aplica al pintar.
                              style={{ filter: photoEditFilterCss(item.edit) || undefined }}
                              className="absolute inset-0 size-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => setEditingMediaId(item.id)}
                              disabled={isPending}
                              aria-label={VIDEO_EDITOR_COPY.openLabel}
                              className={cn(
                                "absolute inset-0 size-full",
                                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
                                "disabled:pointer-events-none",
                              )}
                            />
                            {/* La DURACIÓN medida, no la palabra "Video": es el
                                dato que importa cuando el tope son 90 s, y ya lo
                                tenemos —se midió antes de aceptar el archivo. */}
                            <span className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-media-scrim px-2 py-0.5 text-xs font-semibold text-on-media">
                              <VideoCamera size={12} weight="fill" aria-hidden="true" />
                              {formatDuration(item.durationSeconds) ?? COPY.composer.videoChip}
                            </span>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemoveMedia(item.id)}
                          disabled={isPending}
                          aria-label={
                            item.kind === "photo"
                              ? `${COPY.composer.removePhoto} ${index + 1}`
                              : COPY.composer.removeVideo
                          }
                          // Área táctil de 44px con el círculo visible de 36: en una
                          // miniatura de 80px un botón de 44 se come media foto, pero
                          // el dedo necesita los 44 igual. Se separan las dos cosas.
                          className={cn(
                            "absolute right-0 top-0 flex size-11 items-center justify-center rounded-full",
                            "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.92]",
                            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-on-media/60",
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className="flex size-9 items-center justify-center rounded-full bg-media-scrim text-on-media"
                          >
                            <X size={15} />
                          </span>
                        </button>
                      </li>
                    ))}

                    {canAddPhoto && (
                      <li className="shrink-0">
                        <button
                          type="button"
                          onClick={onAddPhotos}
                          disabled={isPending}
                          aria-label={COPY.composer.addPhotoTile}
                          className={cn(
                            "flex aspect-square w-20 items-center justify-center rounded-xl border border-dashed border-border",
                            "text-foreground-secondary transition-colors duration-(--duration-fast)",
                            "hover:border-brand hover:bg-surface-subtle",
                            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                            "disabled:pointer-events-none disabled:opacity-45",
                          )}
                        >
                          <Plus size={22} aria-hidden="true" />
                        </button>
                      </li>
                    )}
                  </ul>
                )}

                {canAddVideo && (
                  <div className="mt-2 flex items-center gap-2">
                    <button type="button" onClick={onAddVideo} disabled={isPending} className={dashedTileClass}>
                      <VideoCamera size={15} aria-hidden="true" />
                      {COPY.composer.addVideo}
                    </button>
                  </div>
                )}

                {/* Cupo discreto — "3 de 10 fotos"; se suma "1 video" si hay. */}
                {media.length > 0 && (
                  <p className="mt-2 text-xs text-foreground-muted">
                    {COPY.composer.compose.mediaCount(
                      photos.length,
                      videos.length,
                      maxPhotos,
                      maxVideos,
                    )}
                  </p>
                )}

                {/* Midiendo el archivo recién elegido: es una espera corta pero
                    REAL (el navegador baja la cabecera del contenedor), y sin aviso
                    parecería que el botón no hizo nada. */}
                {measuringVideo && (
                  <p role="status" className="mt-2 text-xs font-medium text-foreground-secondary">
                    {COPY.composer.videoMeasuring}
                  </p>
                )}

                {/* Horneado al publicar: recomprimir 10 fotos tarda un ratito
                    real — esto es lo que evita que el botón se sienta colgado. */}
                {bakingProgress && (
                  <p role="status" className="mt-2 text-xs font-medium text-foreground-secondary">
                    {COPY.composer.bakingPhotos(bakingProgress.done, bakingProgress.total)}
                  </p>
                )}

                {/* CATEGORÍA DE VIDEOS CORTOS (0046). Sólo aparece cuando hay un
                    video: en una publicación de fotos no significa nada, y la base
                    la rechaza sin video. Radios reales (no botones con aria): dentro
                    de una hoja con trampa de foco, las flechas del teclado tienen
                    que moverse entre opciones sin que lo implementemos a mano. */}
                {hasVideo && (
                  <fieldset className="mt-4" disabled={isPending}>
                    <legend className="text-sm font-semibold text-foreground">
                      {COPY.composer.compose.videoCategoryLabel}
                    </legend>
                    <p className="mt-0.5 text-xs text-foreground-secondary">
                      {COPY.composer.compose.videoCategoryHint}
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {VIDEO_CATEGORY_ORDER.map((category) => (
                        <label key={category} className="cursor-pointer">
                          <input
                            type="radio"
                            name="composer-video-category"
                            value={category}
                            checked={videoCategory === category}
                            onChange={() => onVideoCategoryChange(category)}
                            className="peer sr-only"
                          />
                          <span
                            className={cn(
                              "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium",
                              "border-border bg-surface text-foreground-secondary",
                              "transition-colors duration-(--duration-fast)",
                              "hover:bg-surface-hover",
                              // El estado seleccionado se lee por relleno Y por
                              // peso, no sólo por color.
                              "peer-checked:border-brand peer-checked:bg-brand-tint",
                              "peer-checked:font-semibold peer-checked:text-brand-ink",
                              "peer-focus-visible:outline-none peer-focus-visible:ring-[3px] peer-focus-visible:ring-focus-ring",
                              "peer-disabled:opacity-45",
                            )}
                          >
                            {VIDEO_CATEGORY_LABELS[category]}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
              </div>
            )}

            {/* RANURAS de "Etiquetar personas" y "Agregar música" — ver el
                docblock de ComposerSheetProps. Ni el separador se pinta si
                los dos vienen `undefined`. */}
            {(tagSlot || musicSlot) && (
              <div className="mt-3 flex shrink-0 flex-col gap-2 border-t border-border-subtle pt-3">
                {tagSlot}
                {musicSlot}
              </div>
            )}

            <label htmlFor="composer-sheet-body" className="sr-only">
              {bodyPlaceholder}
            </label>
            <textarea
              id="composer-sheet-body"
              rows={3}
              maxLength={MAX_LENGTH}
              value={body}
              disabled={isPending}
              onChange={(event) => onBodyChange(event.target.value)}
              placeholder={bodyPlaceholder}
              className={cn(
                "mt-3 min-h-24 w-full shrink-0 resize-none rounded-lg border border-border bg-surface p-3",
                "text-base text-foreground placeholder:text-foreground-muted",
                "focus:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                "disabled:opacity-60",
              )}
            />

            {isQuestion && (
              <div className="mt-3 shrink-0">
                <PollSwitch
                  checked={pollEnabled}
                  onChange={onPollChange}
                  disabled={isPending}
                />
              </div>
            )}

            {/* Va DESPUÉS del pie y no junto a las miniaturas: el pie es el trabajo
                principal y meterle un bloque legal en el medio lo parte al mango.
                Acá queda como lo último antes de Publicar —que es donde la persona
                ya se está preguntando "¿me falta algo?"— y el propio encabezado
                ("Sobre esta foto") lo ata al archivo sin necesidad de estar pegado a
                él. Ver el comentario largo de DeclarationDisclosure. */}
            {hasMedia && (
              <DeclarationDisclosure
                photos={photos.length}
                hasVideo={hasVideo}
                value={declaration}
                onChange={onDeclarationChange}
                disabled={isPending}
              />
            )}

            {/* Ya se publicó; falta guardar lo que necesitaba el id del post
                (etiquetas, música). Va acá y no arriba porque es el último
                tramo de la espera, a un renglón del botón que la disparó. */}
            {finishingLabel && (
              <p role="status" className="mt-3 shrink-0 text-xs font-medium text-foreground-secondary">
                {finishingLabel}
              </p>
            )}

            {/* Progreso REAL de la subida del video (XHR), no una barra decorativa. */}
            {videoUpload !== null && (
              <div className="mt-3 shrink-0" role="status">
                <p className="text-xs font-medium text-foreground-secondary">
                  {COPY.composer.videoUploading(
                    videoUpload.pct,
                    videoUpload.current,
                    videoUpload.total,
                  )}
                </p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-subtle">
                  <div
                    className="h-full rounded-full bg-brand transition-[width] duration-(--duration-fast)"
                    style={{ width: `${videoUpload.pct}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Publicar SIEMPRE a la vista: el pie no scrollea con el contenido. */}
          <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-5 pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              onClick={onClose}
              disabled={isPending}
            >
              {COPY.composer.compose.close}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              className="ml-auto"
              onClick={onPublish}
              disabled={!canPublish}
              loading={isPending}
            >
              {isPending
                ? COPY.composer.publishing
                : isQuestion
                  ? COPY.composer.compose.publishQuestion
                  : COPY.composer.publish}
            </Button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
