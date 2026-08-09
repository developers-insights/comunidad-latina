"use client";

import { useId, useRef, useState } from "react";
import { ImageSquare, Trash, UploadSimple } from "@phosphor-icons/react/dist/ssr";
import { Button, ProgressBar } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { prepareCoverUploadAction } from "@/app/(app)/perfil/actions";

/**
 * Foto de portada del perfil (el banner).
 *
 * ── DIRECTO AL BUCKET, NO POR LA SERVER ACTION ───────────────────────────────
 * Mismo patrón que el currículum (`cv-upload-field.tsx`) y el video del
 * composer: una foto de 3 MB que viaja como FormData a una server action se
 * serializa entera en memoria del server y no da progreso — que es justo lo que
 * necesita alguien subiendo desde datos móviles. El prefijo `{tenant}/{usuario}`
 * lo entrega el SERVIDOR y la policy `avatars_insert` (0012) lo vuelve a validar
 * contra el JWT: el navegador no puede escribir en la carpeta de otra persona
 * aunque arme el path a mano.
 *
 * ── LA PORTADA SE GUARDA CON EL FORMULARIO, NO AL SUBIR ──────────────────────
 * El archivo sube en el momento, pero la fila de `profiles` recién se toca
 * cuando la persona guarda. Así "subí una foto y me arrepentí" no deja el perfil
 * cambiado, y el peor caso es un objeto huérfano en la carpeta PROPIA de la
 * persona — que nadie más puede escribir y que la baja de cuenta limpia.
 */

const COPY = {
  label: "Foto de portada",
  optional: "Opcional",
  help: "Se ve arriba de tu perfil. JPG o PNG, hasta 5 MB.",
  choose: "Elegir una foto",
  replace: "Cambiar la foto",
  remove: "Quitar la portada",
  uploading: "Subiendo…",
  uploadingLive: (pct: number) => `Subiendo la portada, ${pct} por ciento`,
  uploaded: "Portada lista. Se guarda cuando toques «Guardar cambios».",
  emptyHint: "Todavía no tenés portada.",
  errorType: "Esa no parece una foto. Probá con un JPG, PNG o WebP.",
  errorSize: "La foto pesa más de 5 MB. Probá con una más liviana.",
  errorUpload: "No pudimos subir la foto. Revisá tu conexión y probá de nuevo.",
  errorSession: "Tu sesión se cerró — entrá de nuevo para continuar.",
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

export interface CoverUploadFieldProps {
  /**
   * `undefined` = no se tocó · `""` = se quitó · ruta = se subió una nueva.
   * Los tres estados son distintos: "no se tocó" tiene que dejar la portada
   * guardada como está, y "se quitó" tiene que borrarla.
   */
  value: string | undefined;
  onChange: (path: string) => void;
  /** URL pública actual — para previsualizar lo que ya está guardado. */
  currentUrl?: string | null;
  disabled?: boolean;
}

export function CoverUploadField({
  value,
  onChange,
  currentUrl,
  disabled = false,
}: CoverUploadFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const uploading = progress !== null;
  // La previsualización local gana sobre la guardada: es lo que la persona
  // acaba de elegir, y mostrarle la anterior haría dudar de si funcionó.
  const shown = preview ?? (value === "" ? null : currentUrl) ?? null;

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

    const prepared = await prepareCoverUploadAction();
    if (!prepared.ok) {
      setError(prepared.code === "unauthenticated" ? COPY.errorSession : COPY.errorUpload);
      return;
    }

    // Nombre con marca temporal: el bucket es PÚBLICO y su CDN cachea por URL.
    // Con un nombre fijo (`cover.webp`) la foto nueva quedaría escondida detrás
    // de la vieja hasta que expire el caché — el clásico "subí la foto y no
    // cambió nada".
    const path = `${prepared.tenantId}/${prepared.userId}/cover-${Date.now()}.${ACCEPTED[file.type]}`;

    setProgress(0);
    const uploaded = await uploadWithProgress(file, path, file.type, setProgress);
    setProgress(null);

    if (!uploaded) {
      setError(COPY.errorUpload);
      return;
    }

    setPreview(URL.createObjectURL(file));
    onChange(path);
  }

  function clear() {
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
        disabled={disabled || uploading}
        aria-labelledby={`${inputId}-label`}
        aria-describedby={error ? errorId : `${inputId}-help`}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {/* Marco Double-Bezel: la portada es una superficie, no una imagen suelta
          pegada al fondo. El core lleva el 3:1 del banner reservado desde el
          vacío para que la foto no empuje el formulario al cargar (CLS). */}
      <div className="rounded-2xl bg-surface-subtle p-1.5 ring-1 ring-border-subtle">
        <div className="relative aspect-[3/1] w-full overflow-hidden rounded-[calc(1rem-0.375rem)] bg-surface">
          {/*
            `<img>` y no `next/image`: las dos fuentes posibles son un `blob:`
            local de previsualización —que `next/image` no puede optimizar ni
            servir— y la URL pública del bucket de Supabase, cuyo host cambia por
            tenant y habría que declarar uno por uno en la config. El CDN de
            Storage ya sirve la imagen; el `aspect-[3/1]` de arriba reserva el
            alto, que es lo que de verdad importa para el CLS.
          */}
          {shown ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={shown} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-1.5 text-foreground-muted">
              <ImageSquare size={26} aria-hidden="true" />
              <span className="text-xs">{COPY.emptyHint}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="md"
          loading={uploading}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <UploadSimple size={18} aria-hidden="true" />
          {uploading ? COPY.uploading : shown ? COPY.replace : COPY.choose}
        </Button>
        {shown && (
          <Button
            type="button"
            variant="ghost"
            size="md"
            disabled={disabled || uploading}
            onClick={clear}
          >
            <Trash size={18} aria-hidden="true" />
            {COPY.remove}
          </Button>
        )}
      </div>

      {uploading && (
        <ProgressBar value={progress ?? 0} label={COPY.uploadingLive(Math.round(progress ?? 0))} />
      )}
      {/* El progreso se ANUNCIA, no sólo se dibuja. */}
      <p aria-live="polite" className="sr-only">
        {uploading ? COPY.uploadingLive(Math.round(progress ?? 0)) : preview ? COPY.uploaded : ""}
      </p>

      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : (
        <p id={`${inputId}-help`} className={cn("text-sm text-foreground-muted")}>
          {COPY.help}
        </p>
      )}
    </div>
  );
}

/**
 * Subida con progreso. `supabase-js` no expone `onprogress` (usa fetch): se hace
 * el MISMO request que haría el SDK con XHR y el token de la sesión. Copiado del
 * composer y del CV a propósito — un solo patrón de subida directa en el repo.
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
