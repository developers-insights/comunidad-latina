"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { FilmSlate, Play, VideoCamera, X } from "@phosphor-icons/react/dist/ssr";
import { prepareMediaUploadAction } from "@/app/(app)/feed/actions";
import { ProgressBar } from "@/components/ui";
import { readVideoIntro } from "@/lib/media/measure-video";
import {
  LISTING_VIDEO_COPY as C,
  evaluarVideoDeAviso,
  mensajeDeVideoDeAviso,
} from "@/lib/media/listing-video-policy";
import { POST_MEDIA_BUCKET, uploadVideoWithProgress } from "@/lib/media/upload-video";
import {
  VIDEO_ACCEPT_ATTR,
  VIDEO_POSTER_CONTENT_TYPE,
  VIDEO_POSTER_EXTENSION,
  checkVideoFile,
  formatVideoTooBigMessage,
  videoWrongTypeMessageFor,
} from "@/lib/media/video-upload-limits";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type VideoDelAviso =
  | {
      tipo: "nuevo";
      file: File;
      seconds: number;
      poster: Blob | null;
      extension: string;
      contentType: string;
    }
  | {
      tipo: "guardado";
      path: string;
      posterPath: string | null;
      url: string;
      posterUrl: string | null;
      seconds: number;
    };

export interface ListingVideoInputPayload {
  path: string;
  posterPath: string | null;
  durationSeconds: number;
}

export type SubirVideoResult =
  | { ok: true; input: ListingVideoInputPayload | null }
  | { ok: false; error: string; needsAuth?: boolean };

export async function subirVideoDeAviso(
  valor: VideoDelAviso | null,
  onProgress: (pct: number) => void,
): Promise<SubirVideoResult> {
  if (!valor) return { ok: true, input: null };
  if (valor.tipo === "guardado") {
    return {
      ok: true,
      input: { path: valor.path, posterPath: valor.posterPath, durationSeconds: valor.seconds },
    };
  }

  const prepared = await prepareMediaUploadAction();
  if (!prepared.ok) {
    return {
      ok: false,
      needsAuth: prepared.code === "unauthenticated",
      error: prepared.code === "tenant-mismatch" ? prepared.message : C.errorSubida,
    };
  }

  const carpeta = `${prepared.tenantId}/${prepared.userId}`;
  const path = `${carpeta}/aviso-video-${crypto.randomUUID()}.${valor.extension}`;
  const subido = await uploadVideoWithProgress(valor.file, path, onProgress, valor.contentType);
  if (!subido) return { ok: false, error: C.errorSubida };

  let posterPath: string | null = null;
  if (valor.poster) {
    const ruta = `${carpeta}/aviso-poster-${crypto.randomUUID()}.${VIDEO_POSTER_EXTENSION}`;
    const { error } = await createClient()
      .storage.from(POST_MEDIA_BUCKET)
      .upload(ruta, valor.poster, { contentType: VIDEO_POSTER_CONTENT_TYPE, upsert: false });
    if (!error) posterPath = ruta;
  }

  return { ok: true, input: { path, posterPath, durationSeconds: valor.seconds } };
}

/**
 * Estado del video de un formulario de aviso. Al subir, el video queda
 * "guardado" con su ruta: un reintento después de un error del servidor no lo
 * vuelve a subir.
 */
export function useVideoDeAviso() {
  const [video, setVideo] = useState<VideoDelAviso | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  async function subir(): Promise<SubirVideoResult> {
    if (video?.tipo === "nuevo") setProgress(0);
    const result = await subirVideoDeAviso(video, setProgress);
    setProgress(null);
    if (result.ok && result.input && video?.tipo === "nuevo") {
      setVideo({
        tipo: "guardado",
        path: result.input.path,
        posterPath: result.input.posterPath,
        url: "",
        posterUrl: null,
        seconds: result.input.durationSeconds,
      });
    }
    return result;
  }

  function reset() {
    setVideo(null);
    setProgress(null);
  }

  return { video, setVideo, progress, subir, reset };
}

type Aviso = { texto: string; conPremium: boolean };

export function ListingVideoField({
  value,
  onChange,
  tier,
  premiumHref,
  disabled = false,
  progress = null,
  className,
}: {
  value: VideoDelAviso | null;
  onChange: (value: VideoDelAviso | null) => void;
  tier: unknown;
  premiumHref?: string | null;
  disabled?: boolean;
  progress?: number | null;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const ayudaId = useId();
  const [midiendo, setMidiendo] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [posterLocal, setPosterLocal] = useState<string | null>(null);

  const posterBlob = value?.tipo === "nuevo" ? value.poster : null;
  useEffect(() => {
    if (!posterBlob) {
      setPosterLocal(null);
      return;
    }
    const url = URL.createObjectURL(posterBlob);
    setPosterLocal(url);
    return () => URL.revokeObjectURL(url);
  }, [posterBlob]);

  async function elegir(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || disabled || midiendo) return;
    setAviso(null);

    const archivo = checkVideoFile(file, "bucket");
    if (!archivo.ok) {
      setAviso({
        texto:
          archivo.reason === "type"
            ? videoWrongTypeMessageFor("bucket")
            : formatVideoTooBigMessage(file.size, "bucket"),
        conPremium: false,
      });
      return;
    }

    setMidiendo(true);
    const intro = await readVideoIntro(file);
    setMidiendo(false);

    const veredicto = evaluarVideoDeAviso(intro.durationSeconds, tier);
    if (!veredicto.ok) {
      setAviso({
        texto: mensajeDeVideoDeAviso(veredicto),
        conPremium: veredicto.motivo === "necesita-premium",
      });
      return;
    }

    onChange({
      tipo: "nuevo",
      file,
      seconds: veredicto.seconds,
      poster: intro.poster,
      extension: archivo.extension,
      contentType: archivo.mimeType,
    });
  }

  const poster = value?.tipo === "guardado" ? value.posterUrl : posterLocal;
  const bloqueado = disabled || midiendo;
  const subiendo = typeof progress === "number";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-sm font-medium text-foreground-secondary">{C.campo}</p>

      {value ? (
        <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-2.5">
          <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-media-shade">
            {poster ? (
              // eslint-disable-next-line @next/next/no-img-element -- miniatura local (blob) o del bucket público
              <img src={poster} alt="" className="size-full object-cover" />
            ) : (
              <FilmSlate
                size={22}
                aria-hidden="true"
                className="absolute inset-0 m-auto text-on-media/70"
              />
            )}
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid size-7 place-items-center rounded-full bg-media-scrim text-on-media backdrop-blur-sm">
                <Play size={12} weight="fill" aria-hidden="true" />
              </span>
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <p className="numeric text-sm font-semibold text-foreground">
              {C.duracion(value.seconds)}
            </p>
            {value.seconds > 90 && (
              <p className="mt-0.5 text-xs leading-snug text-foreground-muted">{C.largoPremium}</p>
            )}
            {subiendo && (
              <div className="mt-2 flex flex-col gap-1">
                <ProgressBar value={progress} label={C.subiendo(progress)} />
                <p className="text-xs text-foreground-muted">{C.subiendo(progress)}</p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={bloqueado || subiendo}
            aria-label={C.quitar}
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-secondary",
              "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
              "hover:bg-surface active:scale-[0.94]",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={bloqueado}
          aria-describedby={ayudaId}
          className={cn(
            "flex min-h-14 w-full items-center justify-center gap-2 rounded-lg px-4",
            "border border-dashed border-border text-sm font-semibold text-foreground-secondary",
            "transition-[transform,border-color,color] duration-(--duration-fast) ease-(--ease-spring)",
            "hover:border-brand hover:text-brand-ink active:scale-[0.99]",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            "disabled:pointer-events-none disabled:opacity-60",
          )}
        >
          <VideoCamera size={20} aria-hidden="true" />
          {midiendo ? C.midiendo : C.elegir}
        </button>
      )}

      <p id={ayudaId} className="text-xs text-foreground-muted">
        {C.campoAyuda}
      </p>

      {aviso && (
        <div role="alert" className="rounded-md bg-warning-bg px-3 py-2.5 text-sm text-foreground">
          <p>{aviso.texto}</p>
          {aviso.conPremium && premiumHref && (
            <Link
              href={premiumHref}
              className="mt-1.5 inline-flex min-h-11 items-center font-semibold text-brand-ink underline underline-offset-2"
            >
              {C.verPremium}
            </Link>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={VIDEO_ACCEPT_ATTR}
        className="sr-only"
        tabIndex={-1}
        aria-label={C.elegir}
        onChange={elegir}
      />
    </div>
  );
}
