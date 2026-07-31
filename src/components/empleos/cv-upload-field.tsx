"use client";

import { useId, useRef, useState } from "react";
import { FileArrowUp, FilePdf, Trash } from "@phosphor-icons/react/dist/ssr";
import { Button, ProgressBar } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  CV_ACCEPT,
  CV_BUCKET,
  CV_EXTENSION_MIME,
  buildCvPath,
  validateCvFile,
} from "@/lib/empleos/cv";
import { prepareCvUploadAction } from "@/app/(app)/empleos/actions";
import { COPY } from "./copy";

const C = COPY.apply.cv;

export type AttachedCv = {
  /** Ruta dentro del bucket privado. NUNCA se muestra en pantalla. */
  path: string;
  /** Nombre original, solo para que la persona reconozca lo que adjuntó. */
  fileName: string;
  sizeKb: number;
};

export interface CvUploadFieldProps {
  value: AttachedCv | null;
  onChange: (value: AttachedCv | null) => void;
  /** Sube y borra quedan bloqueados mientras la postulación se está enviando. */
  disabled?: boolean;
  onUnauthenticated: () => void;
}

/**
 * Adjuntar el currículum: el navegador lo sube DIRECTO al bucket privado
 * `job-cvs`, con progreso real.
 *
 * ── POR QUÉ DIRECTO Y NO POR LA SERVER ACTION ──────────────────────────────
 * Es el mismo patrón que el video del composer (`prepareMediaUploadAction`):
 * un archivo de 5 MB que viaja como FormData a una server action se serializa
 * entero en memoria del server y no da progreso, que es justo lo que necesita
 * alguien subiendo desde datos móviles. El prefijo {tenant}/{usuario} lo
 * entrega el SERVIDOR y la policy `job_cvs_insert` (0047) lo vuelve a validar
 * contra el JWT: el navegador no puede escribir en la carpeta de otra persona
 * aunque arme el path a mano.
 *
 * El archivo se sube ANTES de enviar la postulación. Si al final no se envía,
 * queda un objeto huérfano en la carpeta propia de la persona (que nadie más
 * puede leer) y la server action lo borra cuando el envío falla por su culpa.
 */
export function CvUploadField({
  value,
  onChange,
  disabled = false,
  onUnauthenticated,
}: CvUploadFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uploading = progress !== null;

  async function handleFile(file: File) {
    setError(null);

    // Puerta amable: si el archivo no sirve, no se gastan 5 MB de datos para
    // enterarse al final. La puerta REAL la pone el servidor leyendo los
    // metadatos que registró Storage.
    const check = validateCvFile({ type: file.type, size: file.size, name: file.name });
    if (!check.ok) {
      setError(
        check.code === "size" ? C.errorSize : check.code === "empty" ? C.errorEmpty : C.errorType,
      );
      return;
    }

    const prepared = await prepareCvUploadAction();
    if (!prepared.ok) {
      if (prepared.code === "unauthenticated") {
        onUnauthenticated();
        return;
      }
      setError(prepared.message ?? C.errorUpload);
      return;
    }

    const path = buildCvPath({
      tenantId: prepared.tenantId,
      userId: prepared.userId,
      extension: check.extension,
    });

    setProgress(0);
    const uploaded = await uploadWithProgress(
      file,
      path,
      // El MIME sale de la EXTENSIÓN que validamos, no del `File.type` crudo:
      // así lo que Storage registra coincide con lo que el archivo dice ser.
      CV_EXTENSION_MIME[check.extension] ?? "application/pdf",
      setProgress,
    );
    setProgress(null);

    if (!uploaded) {
      setError(C.errorUpload);
      return;
    }

    // Reemplazo: el archivo anterior deja de servir para nada, lo sacamos del
    // bucket en vez de dejarlo acumulando.
    if (value) void removeObject(value.path);

    onChange({ path, fileName: file.name, sizeKb: file.size / 1024 });
  }

  function clear() {
    if (value) void removeObject(value.path);
    onChange(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const errorId = `${inputId}-error`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span id={`${inputId}-label`} className="text-sm font-semibold text-foreground">
          {C.label}
        </span>
        <span className="text-xs text-foreground-muted">Opcional</span>
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={CV_ACCEPT}
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

      {value ? (
        <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-[var(--accent-empleos)]"
          >
            <FilePdf size={22} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{value.fileName}</p>
            <p className="text-xs text-foreground-muted">{C.size(value.sizeKb)}</p>
          </div>
          <button
            type="button"
            onClick={clear}
            disabled={disabled || uploading}
            aria-label={C.remove}
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-muted",
              "transition-colors duration-(--duration-fast) hover:bg-surface hover:text-danger",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              "disabled:opacity-50",
            )}
          >
            <Trash size={18} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="md"
          className="w-full"
          loading={uploading}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <FileArrowUp size={18} aria-hidden="true" />
          {uploading ? C.uploading : C.choose}
        </Button>
      )}

      {uploading && (
        <ProgressBar value={progress ?? 0} label={C.uploadingLive(Math.round(progress ?? 0))} />
      )}
      {/* El progreso se ANUNCIA, no solo se dibuja: quien usa lector de
          pantalla también tiene que saber que el archivo está viajando. */}
      <p aria-live="polite" className="sr-only">
        {uploading ? C.uploadingLive(Math.round(progress ?? 0)) : value ? C.uploaded : ""}
      </p>

      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : (
        <p id={`${inputId}-help`} className="text-sm text-foreground-muted">
          {C.help}
        </p>
      )}

      {value && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
          className={cn(
            "min-h-11 self-start text-sm font-semibold text-brand underline underline-offset-2",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            "disabled:opacity-50",
          )}
        >
          {C.replace}
        </button>
      )}
    </div>
  );
}

/** Best-effort: si falla, el objeto queda en la carpeta propia y no lo ve nadie. */
async function removeObject(path: string): Promise<void> {
  try {
    await createClient().storage.from(CV_BUCKET).remove([path]);
  } catch {
    // sin drama
  }
}

// ---------------------------------------------------------------------------
// Subida con progreso. supabase-js no expone onprogress (usa fetch): hacemos el
// MISMO request que haría el SDK (POST /storage/v1/object/...) con XHR y el
// token de la sesión — la policy job_cvs_insert (0047) valida el prefijo
// {tenant}/{usuario} contra el JWT igual que siempre. Copiado del composer del
// feed a propósito: un solo patrón de subida directa en todo el repo.
// ---------------------------------------------------------------------------
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
    xhr.open("POST", `${baseUrl}/storage/v1/object/${CV_BUCKET}/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("x-upsert", "false");
    // El Content-Type es lo que Storage guarda como content_type del objeto, y
    // es lo que el servidor vuelve a validar antes de persistir la postulación.
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
