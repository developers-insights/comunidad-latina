"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilmSlate, SealCheck, VideoCamera } from "@phosphor-icons/react/dist/ssr";
import { Banner, BezelCard, Button, Field, ProgressBar, Select, useToast } from "@/components/ui";
import { VIDEO_CATEGORY_LABELS } from "@/app/(app)/videos/copy";
import { createClient } from "@/lib/supabase/client";
import { prepareMediaUploadAction } from "@/app/(app)/feed/actions";
import { readVideoIntro } from "@/lib/media/measure-video";
import { encodeAudioPcm16, sampleAudioPcm } from "@/lib/media/audio-samples";
import { sampleVideoLumaFrames } from "@/lib/media/video-frames";
import { uploadVideoWithProgress } from "@/lib/media/upload-video";
import {
  VIDEO_ACCEPT_ATTR,
  VIDEO_POSTER_CONTENT_TYPE,
  VIDEO_POSTER_EXTENSION,
  checkVideoFile,
  formatVideoTooBigMessage,
  videoWrongTypeMessageFor,
} from "@/lib/media/video-upload-limits";
import {
  VIDEO_CATEGORIES,
  checkVideoDuration,
  formatDuration,
  type VideoCategory,
} from "@/lib/media/video-policy";
import { COPY_VIDEO_PUBLICITARIO as COPY } from "./copy-video";
import { adjuntarVideoPublicitario } from "./video-publicitario";

/**
 * =============================================================================
 * SUBIR EL VIDEO LARGO DE UNA CAMPAÑA ACTIVA
 * =============================================================================
 *
 * Aparece SÓLO cuando la campaña está activa y vigente — la página lo decide, y
 * la server action lo vuelve a comprobar (`video-publicitario.ts`). Acá se
 * repite la validación de duración por la misma razón que en el composer: para
 * que la persona se entere ANTES de subir doscientos megas, no después.
 *
 * EL ORDEN DE LOS PASOS ES EL MISMO QUE EL DEL COMPOSER, y por lo mismo:
 *
 *   1. ¿Es un video, y entra por peso?  → local, instantáneo.
 *   2. ¿Cuánto dura, y cómo se ve el primer cuadro?  → local, una apertura.
 *   3. ¿Se pasa del tope del tipo publicitario?  → se rechaza ACÁ.
 *   4. Recién ahora se sube el archivo, y recién después se toca la base.
 *
 * Nada viaja hasta que la respuesta a las tres primeras es sí. Un video que no
 * se va a poder guardar no gasta los datos de nadie.
 *
 * NO HAY BARRA DE PROGRESO PARA EL POSTER: son decenas de kilobytes al lado de
 * cientos de megas, y un segundo indicador para algo que tarda menos que un
 * parpadeo se lee como un problema.
 */

interface VideoActual {
  /** Duración declarada de la fila, para poder decir "ya tenés uno de 4:12". */
  durationSeconds: number | null;
  /** ¿Ya es un video publicitario? Si no, el panel invita a subir el primero. */
  esPublicitario: boolean;
}

type Fase = "idle" | "midiendo" | "subiendo" | "guardando";

export function VideoDeCampana({
  postId,
  actual,
}: {
  postId: string;
  actual: VideoActual;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [fase, setFase] = useState<Fase>("idle");
  const [pct, setPct] = useState(0);
  const [elegido, setElegido] = useState<{
    file: File;
    seconds: number;
    poster: Blob | null;
    extension: string;
    contentType: string;
  } | null>(null);
  const [categoria, setCategoria] = useState<VideoCategory>("otros");
  const [listo, setListo] = useState(false);

  const trabajando = fase !== "idle";

  async function elegirArchivo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // El input se limpia SIEMPRE: sin esto, elegir el mismo archivo dos veces
    // seguidas (después de un rechazo) no vuelve a disparar `change`.
    event.target.value = "";
    if (!file || trabajando) return;

    // PASO 1 — formato y peso. La ruta es "bucket": el video publicitario no
    // pasa por Mux (ver el rechazo `errorYaTieneMux` de la action).
    const archivo = checkVideoFile(file, "bucket");
    if (!archivo.ok) {
      toast({
        title:
          archivo.reason === "type"
            ? videoWrongTypeMessageFor("bucket")
            : formatVideoTooBigMessage(file.size, "bucket"),
        variant: "warning",
        duration: 8000,
      });
      return;
    }

    // PASO 2 — duración y primer cuadro, en una sola apertura del archivo.
    setFase("midiendo");
    const intro = await readVideoIntro(file);
    setFase("idle");

    // PASO 3 — el tope del TIPO que se va a guardar. `advertising_video` es el
    // único que la base deja pasar de 90 s, y su número sale de video-policy.
    const duracion = checkVideoDuration("advertising_video", intro.durationSeconds);
    if (!duracion.ok) {
      toast({
        title:
          duracion.reason === "too-long" ? COPY.errorMuyLargo : COPY.errorDuracion,
        variant: "warning",
        duration: 9000,
      });
      return;
    }

    setElegido({
      file,
      seconds: duracion.seconds,
      // Puede ser null (un códec que el navegador no sabe dibujar): el video se
      // publica igual y la superficie cae a su respaldo.
      poster: intro.poster,
      extension: archivo.extension,
      contentType: archivo.mimeType,
    });
    setListo(false);
  }

  async function guardar() {
    if (!elegido || trabajando) return;

    /**
     * EL PREFIJO {tenant}/{user} LO ENTREGA EL SERVIDOR, no el navegador.
     *
     * Es la misma action que usa el composer, y por el mismo motivo: la policy
     * `post_media_insert` (0025) valida ese prefijo contra el JWT, así que
     * armarlo con datos leídos del cliente sería adivinar lo que el servidor ya
     * sabe — y adivinar mal significa una subida rechazada sin explicación.
     */
    const prepared = await prepareMediaUploadAction();
    if (!prepared.ok) {
      if (prepared.code === "unauthenticated") {
        router.push(`/entrar?next=/impulsar-post/${postId}`);
        return;
      }
      toast({
        title: prepared.code === "tenant-mismatch" ? prepared.message : COPY.errorGenerico,
        variant: "danger",
        duration: 9000,
      });
      return;
    }

    setFase("subiendo");
    setPct(0);
    const videoPath = `${prepared.tenantId}/${prepared.userId}/video-${crypto.randomUUID()}.${elegido.extension}`;

    // El muestreo de Content Integrity va EN PARALELO con la subida: son dos
    // trabajos independientes sobre el mismo archivo, y encadenarlos le sumaría
    // segundos a la espera por nada. Mismo reparto que el composer.
    const [subido, frames, audio] = await Promise.all([
      uploadVideoWithProgress(elegido.file, videoPath, setPct, elegido.contentType),
      sampleVideoLumaFrames(elegido.file),
      sampleAudioPcm(elegido.file),
    ]);

    if (!subido) {
      setFase("idle");
      toast({
        title: COPY.errorSubidaTitulo,
        description: COPY.errorSubidaCuerpo,
        variant: "danger",
        duration: 9000,
      });
      return;
    }

    // El poster va DESPUÉS del video: si el video no llegó, subir su portada
    // sería dejar un archivo que no ilustra nada. Y nunca frena: perder el
    // poster es perder una mejora de carga, no la publicación.
    let posterPath: string | null = null;
    if (elegido.poster) {
      const ruta = `${prepared.tenantId}/${prepared.userId}/poster-${crypto.randomUUID()}.${VIDEO_POSTER_EXTENSION}`;
      const { error } = await createClient()
        .storage.from("post-media")
        .upload(ruta, elegido.poster, {
          contentType: VIDEO_POSTER_CONTENT_TYPE,
          upsert: false,
        });
      if (error) {
        console.warn("[video-campana] no se pudo subir el poster", {
          message: error.message,
        });
      } else {
        posterPath = ruta;
      }
    }

    setFase("guardando");
    const resultado = await adjuntarVideoPublicitario({
      postId,
      videoPath,
      posterPath,
      durationSeconds: elegido.seconds,
      videoCategory: categoria,
      // `sampleVideoLumaFrames` devuelve [] cuando el navegador no pudo
      // decodificar el video, y `[]` es truthy: sin el `.length` se mandaría un
      // "[]" que la huella leería como "muestreado y vacío" en vez de "no se
      // pudo muestrear". Mismo chequeo que hace el composer.
      videoFrames: frames.length > 0 ? JSON.stringify(frames) : null,
      audioPcm: audio ? encodeAudioPcm16(audio) : null,
    });
    setFase("idle");

    if (resultado.status === "sin_sesion") {
      router.push(`/entrar?next=/impulsar-post/${postId}`);
      return;
    }
    if (resultado.status === "sin_campana") {
      toast({ title: COPY.errorSinCampana, variant: "warning", duration: 9000 });
      router.refresh();
      return;
    }
    if (resultado.status === "error") {
      toast({ title: resultado.message, variant: "danger", duration: 9000 });
      return;
    }

    setElegido(null);
    setListo(true);
    router.refresh();
  }

  const duracionElegida = elegido ? formatDuration(elegido.seconds) : null;

  return (
    <BezelCard coreClassName="flex flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        <FilmSlate size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-foreground">
            {COPY.titulo}
          </h2>
          <p className="mt-1 text-sm text-foreground-secondary">{COPY.bajada}</p>
          <p className="mt-1 text-sm text-foreground-secondary">{COPY.comoSeVe}</p>
        </div>
      </div>

      {listo && (
        <Banner
          variant="info"
          className="rounded-lg"
          icon={<SealCheck size={20} className="text-success" />}
        >
          <span className="font-medium">{COPY.listoTitulo}</span> {COPY.listoCuerpo}{" "}
          <Link href="/videos/largos" className="underline underline-offset-2">
            {COPY.verLargos}
          </Link>
        </Banner>
      )}

      {actual.esPublicitario && !elegido && !listo && (
        <p className="text-sm text-foreground-secondary">
          {COPY.yaTiene(actual.durationSeconds)}
        </p>
      )}

      {elegido ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-foreground">
            <span className="font-medium">{elegido.file.name}</span>
            {duracionElegida ? ` · ${duracionElegida}` : null}
          </p>

          <Field label="¿De qué se trata?" htmlFor="video-campana-categoria">
            <Select
              id="video-campana-categoria"
              value={categoria}
              disabled={trabajando}
              onChange={(event) => setCategoria(event.target.value as VideoCategory)}
            >
              {VIDEO_CATEGORIES.map((id) => (
                <option key={id} value={id}>
                  {VIDEO_CATEGORY_LABELS[id]}
                </option>
              ))}
            </Select>
          </Field>

          {fase === "subiendo" && (
            <div className="flex flex-col gap-1.5">
              <ProgressBar value={pct} label={COPY.subiendo} />
              <p className="text-xs text-foreground-muted">
                {COPY.subiendo} {pct}%
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={guardar} disabled={trabajando}>
              {fase === "guardando" ? COPY.guardando : COPY.guardar}
            </Button>
            <Button
              variant="ghost"
              disabled={trabajando}
              onClick={() => {
                setElegido(null);
                inputRef.current?.click();
              }}
            >
              {COPY.quitar}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            disabled={trabajando}
            onClick={() => inputRef.current?.click()}
          >
            <VideoCamera size={18} weight="bold" aria-hidden="true" />
            {fase === "midiendo"
              ? COPY.midiendo
              : actual.esPublicitario
                ? COPY.cambiar
                : COPY.elegir}
          </Button>
          <p className="text-xs leading-relaxed text-foreground-muted">
            {COPY.ayudaArchivo}
          </p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={VIDEO_ACCEPT_ATTR}
        className="hidden"
        onChange={elegirArchivo}
      />
    </BezelCard>
  );
}
