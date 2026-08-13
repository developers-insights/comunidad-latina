"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  Camera,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Trash,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, Button, Dialog, ProgressBar, Spinner } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { bakePhoto } from "@/lib/media/bake-photo";
import {
  clampOffset,
  coverScale,
  outputDrawRect,
  type CropOffset,
} from "@/lib/media/avatar-crop";
import { prepareAvatarUploadAction } from "@/app/(app)/perfil/actions";

/**
 * Foto de perfil (avatar). Mismo patrón que la portada
 * (`cover-upload-field.tsx`): sube DIRECTO al bucket `avatars` desde el
 * navegador —el prefijo lo entrega el servidor, la policy `avatars_insert`
 * (0012) lo vuelve a validar contra el JWT— y sólo se guarda en `profiles`
 * cuando la persona toca «Guardar cambios». `uploadWithProgress` está
 * duplicada acá a propósito: es el mismo criterio que ya dejó escrito
 * `cover-upload-field.tsx` ("un solo patrón de subida directa, copiado donde
 * hace falta") y no un archivo compartido nuevo.
 *
 * ── LO QUE SÍ ES DISTINTO DE LA PORTADA: EL ENCUADRE ─────────────────────────
 * La portada es un banner apaisado — lo que suba la persona, entra. El avatar
 * se muestra SIEMPRE circular (`Avatar`, en todos lados: cabecera, posts,
 * comentarios), y una foto apaisada sin recorte queda mal — corta cara por los
 * costados o dos franjas vacías arriba/abajo. Por eso, antes de subir nada, se
 * abre un `Dialog` con un stage circular donde la persona arrastra y hace zoom
 * para elegir QUÉ parte de la foto queda dentro del círculo. La geometría vive
 * en `@/lib/media/avatar-crop` (pura, testeada aparte); acá sólo maneja
 * puntero/teclado y hornea el resultado en un canvas del mismo tamaño que se
 * sube.
 *
 * `bakePhoto` (ya existe, se usa tal cual — no se reescribe la corrección de
 * orientación EXIF ni el recorte de tamaño) normaliza el archivo ORIGINAL
 * antes de mostrarlo en el stage: así lo que la persona ve ya viene derecho
 * (EXIF) y liviano, y el canvas final dibuja sobre esa misma imagen — nunca
 * hay una segunda fuente que pueda desalinearse de lo que se vio en pantalla.
 */

const COPY = {
  label: "Foto de perfil",
  optional: "Opcional",
  help: "Se ve en tu perfil, tus publicaciones y tus comentarios. JPG, PNG o WebP, hasta 5 MB.",
  choose: "Elegir una foto",
  replace: "Cambiar la foto",
  remove: "Quitar la foto",
  preparing: "Preparando…",
  uploaded: "Foto de perfil lista. Se guarda cuando toques «Guardar cambios».",
  errorType: "Esa no parece una foto. Probá con un JPG, PNG o WebP.",
  errorSize: "La foto pesa más de 5 MB. Probá con una más liviana.",
  errorUpload: "No pudimos subir la foto. Revisá tu conexión y probá de nuevo.",
  errorSession: "Tu sesión se cerró — entrá de nuevo para continuar.",
  errorImage: "No pudimos abrir esa foto. Probá con otro archivo.",
  cropTitle: "Encuadrá tu foto",
  cropDescription: "Arrastrá para moverla y usá el control para acercar o alejar.",
  cropConfirm: "Usar esta foto",
  cropUploading: "Subiendo…",
  cropCancel: "Cancelar",
  uploadingLive: (pct: number) => `Subiendo tu foto de perfil, ${pct} por ciento`,
  zoomLabel: "Acercar o alejar la foto",
  stageLabel:
    "Encuadre de tu foto de perfil. Arrastrá con el mouse o el dedo para moverla; con el teclado, usá las flechas.",
} as const;

const BUCKET = "avatars";
const MAX_BYTES = 5 * 1024 * 1024;
/** Los tipos que el navegador declara y que Storage va a registrar. */
const ACCEPTED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const ACCEPT_ATTR = Object.keys(ACCEPTED).join(",");

/** Lado del círculo en pantalla, en px. */
const STAGE_SIZE = 256;
/** Lado del cuadrado final que se sube — de sobra para el `size="xl"` (80px) más grande de `Avatar`. */
const OUTPUT_SIZE = 480;
const OUTPUT_QUALITY = 0.92;
const MAX_ZOOM = 3;
/** Paso del nudge por teclado, en px de pantalla. Con Shift, el triple. */
const KEYBOARD_STEP = 8;

export interface AvatarUploadFieldProps {
  /**
   * `undefined` = no se tocó · `""` = se quitó · ruta = se subió una nueva.
   * Igual contrato que `CoverUploadField`.
   */
  value: string | undefined;
  onChange: (path: string) => void;
  /** URL pública actual — para previsualizar lo que ya está guardado. */
  currentUrl?: string | null;
  /** Alimenta las iniciales de fallback de `Avatar` cuando no hay foto. */
  displayName: string;
  disabled?: boolean;
}

interface StagedImage {
  /** object URL del archivo YA normalizado por `bakePhoto` (EXIF + tamaño). */
  url: string;
}

export function AvatarUploadField({
  value,
  onChange,
  currentUrl,
  displayName,
  disabled = false,
}: AvatarUploadFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const stageImgRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef<{ x: number; y: number; offset: CropOffset } | null>(null);

  const [selecting, setSelecting] = useState(false);
  const [staged, setStaged] = useState<StagedImage | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<CropOffset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const [progress, setProgress] = useState<number | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const uploading = progress !== null;
  const shown = preview ?? (value === "" ? null : currentUrl) ?? null;
  const baseScale = natural ? coverScale(natural, STAGE_SIZE) : 1;
  const appliedScale = baseScale * zoom;

  async function handleFile(file: File) {
    setError(null);

    if (!ACCEPTED[file.type]) {
      setError(COPY.errorType);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(COPY.errorSize);
      return;
    }

    setSelecting(true);
    // Corrige orientación EXIF y limita el tamaño ANTES de mostrarla en el
    // stage — nunca lanza; en el peor caso devuelve el archivo original.
    const normalized = await bakePhoto(file, { maxLongSide: 1024, quality: 0.92 });
    setSelecting(false);

    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setNatural(null);
    setDialogError(null);
    setStaged({ url: URL.createObjectURL(normalized) });
  }

  function closeCropDialog() {
    if (staged) URL.revokeObjectURL(staged.url);
    setStaged(null);
    setNatural(null);
    setDialogError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onStageImageLoad(event: React.SyntheticEvent<HTMLImageElement>) {
    const img = event.currentTarget;
    setNatural({ width: img.naturalWidth, height: img.naturalHeight });
  }

  function onZoomChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextZoom = Number(event.target.value);
    setZoom(nextZoom);
    if (natural) {
      setOffset((prev) => clampOffset(prev, natural, baseScale * nextZoom, STAGE_SIZE));
    }
  }

  function onStagePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!natural) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    dragStart.current = { x: event.clientX, y: event.clientY, offset };
  }

  function onStagePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging || !dragStart.current || !natural) return;
    const next = {
      x: dragStart.current.offset.x + (event.clientX - dragStart.current.x),
      y: dragStart.current.offset.y + (event.clientY - dragStart.current.y),
    };
    setOffset(clampOffset(next, natural, appliedScale, STAGE_SIZE));
  }

  function endDrag() {
    setDragging(false);
    dragStart.current = null;
  }

  function onStageKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!natural) return;
    const step = event.shiftKey ? KEYBOARD_STEP * 3 : KEYBOARD_STEP;
    let next = offset;
    if (event.key === "ArrowLeft") next = { ...offset, x: offset.x - step };
    else if (event.key === "ArrowRight") next = { ...offset, x: offset.x + step };
    else if (event.key === "ArrowUp") next = { ...offset, y: offset.y - step };
    else if (event.key === "ArrowDown") next = { ...offset, y: offset.y + step };
    else return;
    event.preventDefault();
    setOffset(clampOffset(next, natural, appliedScale, STAGE_SIZE));
  }

  async function confirmCrop() {
    if (!natural || !stageImgRef.current) return;
    setDialogError(null);

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setDialogError(COPY.errorUpload);
      return;
    }

    const rect = outputDrawRect({
      natural,
      scale: appliedScale,
      offset,
      stageSize: STAGE_SIZE,
      outputSize: OUTPUT_SIZE,
    });
    ctx.drawImage(stageImgRef.current, rect.dx, rect.dy, rect.dw, rect.dh);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", OUTPUT_QUALITY),
    );
    if (!blob) {
      setDialogError(COPY.errorUpload);
      return;
    }
    const baked = new File([blob], "avatar.jpg", { type: "image/jpeg" });

    setProgress(0);
    const prepared = await prepareAvatarUploadAction();
    if (!prepared.ok) {
      setProgress(null);
      setDialogError(prepared.code === "unauthenticated" ? COPY.errorSession : COPY.errorUpload);
      return;
    }

    // Nombre con marca temporal, igual que la portada: el bucket es público y
    // su CDN cachea por URL — con un nombre fijo la foto nueva quedaría
    // escondida detrás de la vieja hasta que expire el caché.
    const path = `${prepared.tenantId}/${prepared.userId}/avatar-${Date.now()}.jpg`;
    const uploaded = await uploadWithProgress(baked, path, "image/jpeg", setProgress);
    setProgress(null);

    if (!uploaded) {
      setDialogError(COPY.errorUpload);
      return;
    }

    setPreview(URL.createObjectURL(baked));
    onChange(path);
    closeCropDialog();
  }

  function removeAvatar() {
    setPreview(null);
    setError(null);
    onChange("");
    if (inputRef.current) inputRef.current.value = "";
  }

  const errorId = `${inputId}-error`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span id={`${inputId}-label`} className="text-sm font-medium text-foreground">
          {COPY.label}
        </span>
        <span className="text-xs text-foreground-muted">{COPY.optional}</span>
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPT_ATTR}
        className="sr-only"
        disabled={disabled || selecting}
        aria-labelledby={`${inputId}-label`}
        aria-describedby={error ? errorId : `${inputId}-help`}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {/* Marco Double-Bezel compacto: el avatar es chico y redondo, no un
          banner — misma superficie que la portada, otra proporción. */}
      <div className="flex items-center gap-4 rounded-2xl bg-surface-subtle p-3 ring-1 ring-border-subtle">
        <span className="shrink-0 rounded-full bg-surface p-1 ring-1 ring-border-subtle">
          <Avatar size="xl" src={shown} name={displayName || "?"} />
        </span>
        <div className="flex flex-1 flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="md"
            loading={selecting}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <Camera size={18} aria-hidden="true" />
            {selecting ? COPY.preparing : shown ? COPY.replace : COPY.choose}
          </Button>
          {shown && (
            <Button
              type="button"
              variant="ghost"
              size="md"
              disabled={disabled || selecting}
              onClick={removeAvatar}
            >
              <Trash size={18} aria-hidden="true" />
              {COPY.remove}
            </Button>
          )}
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {preview ? COPY.uploaded : ""}
      </p>

      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : (
        <p id={`${inputId}-help`} className="text-sm text-foreground-muted">
          {COPY.help}
        </p>
      )}

      <Dialog
        open={Boolean(staged)}
        onClose={() => {
          if (!uploading) closeCropDialog();
        }}
        title={COPY.cropTitle}
        description={COPY.cropDescription}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={uploading}
              onClick={closeCropDialog}
            >
              {COPY.cropCancel}
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={uploading}
              disabled={!natural}
              onClick={() => void confirmCrop()}
            >
              {uploading ? COPY.cropUploading : COPY.cropConfirm}
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-4">
          <div
            role="group"
            tabIndex={0}
            aria-label={COPY.stageLabel}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onStageKeyDown}
            className="relative size-64 shrink-0 touch-none overflow-hidden rounded-full bg-surface ring-1 ring-border-subtle focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
            style={{ cursor: dragging ? "grabbing" : "grab" }}
          >
            {staged && (
              // `<img>` y no `next/image`: la fuente es un `blob:` local (el
              // resultado de `bakePhoto`) que `next/image` no puede optimizar,
              // y el elemento se manipula a mano con `transform` para el
              // arrastre/zoom — un editor efímero, no una imagen final. Mismo
              // criterio que `cover-upload-field.tsx`.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={stageImgRef}
                src={staged.url}
                alt=""
                draggable={false}
                onLoad={onStageImageLoad}
                onError={() => setDialogError(COPY.errorImage)}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                style={
                  natural
                    ? {
                        width: natural.width * appliedScale,
                        height: natural.height * appliedScale,
                        transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                      }
                    : { opacity: 0 }
                }
              />
            )}
            {!natural && !dialogError && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Spinner size={24} />
              </span>
            )}
          </div>

          <div className="flex w-full items-center gap-3">
            <MagnifyingGlassMinus
              size={18}
              aria-hidden="true"
              className="shrink-0 text-foreground-muted"
            />
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              disabled={!natural || uploading}
              onChange={onZoomChange}
              aria-label={COPY.zoomLabel}
              className="h-2 w-full flex-1 cursor-pointer accent-brand disabled:cursor-not-allowed"
            />
            <MagnifyingGlassPlus
              size={18}
              aria-hidden="true"
              className="shrink-0 text-foreground-muted"
            />
          </div>

          {uploading && (
            <ProgressBar
              value={progress ?? 0}
              label={COPY.uploadingLive(Math.round(progress ?? 0))}
              className="w-full"
            />
          )}

          {dialogError && (
            <p role="alert" className="text-sm font-medium text-danger">
              {dialogError}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}

/**
 * Subida con progreso — copiada a propósito de `cover-upload-field.tsx` (ver
 * su comentario: "un solo patrón de subida directa en el repo", repetido
 * donde hace falta en vez de compartido). `supabase-js` no expone
 * `onprogress` (usa fetch); esto hace el MISMO request que haría el SDK, con
 * XHR y el token de la sesión, para poder mostrar el porcentaje.
 */
async function uploadWithProgress(
  file: File,
  path: string,
  contentType: string,
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
    xhr.open("POST", `${baseUrl}/storage/v1/object/${BUCKET}/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Content-Type", contentType);
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
