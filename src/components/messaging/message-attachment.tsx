import { FileArrowDown, MapPin } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import type { Adjunto } from "@/lib/messaging/adjuntos";
import { firmarAdjuntosAction } from "@/app/(app)/mensajes/adjuntos-actions";
import { COPY } from "./copy";
import { VoicePlayer } from "./voice-player";

/**
 * =============================================================================
 * LO QUE MANDÓ ALGUIEN CUANDO NO ES TEXTO
 * =============================================================================
 *
 * Se pinta ADENTRO de la burbuja, por el prop `media`, y arriba del pie: primero
 * lo que se mandó, después lo que la persona escribió sobre eso. Adentro y no al
 * costado porque el menú, las reacciones y la cita son los de ESTE mensaje —
 * pintada afuera, una foto sola se quedaba sin las tres. El aire lateral de la
 * burbuja se recupera con un margen negativo del lado de quien la monta.
 *
 * ⚠️ `<img>` Y `<video>` PELADOS, NUNCA `next/image` — dos motivos, y los dos
 * bastan solos:
 *   · `chat-media` es privado y se sirve firmado bajo `/storage/v1/object/sign/`,
 *     que NO está en `images.remotePatterns` (next.config.ts sólo abre
 *     `/object/public/**`). El optimizador devolvería 400 y la foto no se vería.
 *   · Aunque estuviera, el optimizador deja la imagen cacheada en el CDN de
 *     Vercel: contenido de un chat privado, servido después sin la firma que lo
 *     autorizaba.
 *
 * Este componente es de SERVIDOR. `VoicePlayer` es la única isla que monta.
 */

const A = COPY.thread.adjunto;

/** Cuántos paths acepta `firmarAdjuntosAction` por llamada (su zod, `max(60)`). */
const FIRMAS_POR_TANDA = 60;

/**
 * LAS URLS FIRMADAS DE TODO EL HILO, EN UN VIAJE (o en el mínimo posible).
 *
 * `chat-media` es privado: sin firma no se ve nada. Se piden TODAS juntas y no
 * una por burbuja — un hilo con veinte fotos serían veinte viajes al servidor,
 * el N+1 que el resto del módulo evita. Cuando hay más de sesenta, las tandas
 * salen en paralelo, nunca encadenadas.
 *
 * Nunca lanza: un adjunto sin firma se pinta como "ya no está disponible" y el
 * resto del hilo se lee igual.
 */
export async function firmarAdjuntosDelHilo(
  paths: readonly string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unicos = [...new Set(paths)];
  if (unicos.length === 0) return urls;

  const tandas: string[][] = [];
  for (let i = 0; i < unicos.length; i += FIRMAS_POR_TANDA) {
    tandas.push(unicos.slice(i, i + FIRMAS_POR_TANDA));
  }

  const resultados = await Promise.all(
    tandas.map((tanda) => firmarAdjuntosAction({ paths: tanda })),
  );
  for (const resultado of resultados) {
    if (!resultado.ok) continue;
    for (const [path, url] of Object.entries(resultado.urls)) urls.set(path, url);
  }
  return urls;
}

export interface MessageAttachmentProps {
  /** `messages.kind` — decide qué se pinta. */
  kind: string;
  adjunto: Adjunto | null;
  ubicacion: { lat: number; lng: number; etiqueta?: string } | null;
  /** URL firmada (1 h). `null` cuando la firma no se pudo emitir. */
  src: string | null;
  isOwn: boolean;
  /** Para el `alt` de una foto ajena. */
  autorNombre: string;
  className?: string;
}

export function MessageAttachment({
  kind,
  adjunto,
  ubicacion,
  src,
  isOwn,
  autorNombre,
  className,
}: MessageAttachmentProps) {
  if (kind === "ubicacion") {
    if (!ubicacion) return null;
    return <Ubicacion ubicacion={ubicacion} isOwn={isOwn} className={className} />;
  }

  if (!adjunto) return null;

  if (kind === "audio") {
    return (
      <VoicePlayer
        src={src}
        duracionMs={adjunto.duracion_ms}
        onda={adjunto.onda}
        propio={isOwn}
        className={className}
      />
    );
  }

  if (!src) return <NoDisponible className={className} />;

  if (kind === "imagen") {
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        // Sin `aria-label`: el nombre accesible del enlace es el `alt` de la
        // foto, que dice de quién es. Un rótulo acá lo taparía.
        className={cn(
          "block overflow-hidden rounded-2xl border border-border-subtle",
          "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
          "active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- bucket privado firmado: ver la cabecera */}
        <img
          src={src}
          alt={isOwn ? A.fotoPropia : A.fotoDe(autorNombre)}
          width={adjunto.ancho}
          height={adjunto.alto}
          loading="lazy"
          decoding="async"
          // `aspect-ratio` desde el alto y ancho guardados: la foto reserva su
          // lugar antes de bajarse y el hilo no salta cuando llega (CLS).
          style={
            adjunto.ancho && adjunto.alto
              ? { aspectRatio: `${adjunto.ancho} / ${adjunto.alto}` }
              : undefined
          }
          className="max-h-80 w-full bg-surface-subtle object-cover"
        />
      </a>
    );
  }

  if (kind === "video") {
    return (
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        aria-label={A.video}
        className={cn(
          "max-h-80 w-full rounded-2xl border border-border-subtle bg-surface-subtle",
          className,
        )}
      />
    );
  }

  return <Archivo adjunto={adjunto} src={src} isOwn={isOwn} className={className} />;
}

function NoDisponible({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-foreground-muted",
        className,
      )}
    >
      {A.noDisponible}
    </p>
  );
}

/** `2621440` → `"2,5"`. Coma decimal: el público de esta app no escribe 2.5. */
function megas(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(".", ",");
}

function Archivo({
  adjunto,
  src,
  isOwn,
  className,
}: {
  adjunto: Adjunto;
  src: string;
  isOwn: boolean;
  className?: string;
}) {
  const nombre = adjunto.nombre?.trim() || A.archivoSinNombre;
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-3 rounded-xl border border-border-subtle px-3 py-2.5",
        "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
        "hover:bg-surface-hover active:scale-[0.985]",
        "motion-reduce:transition-none motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        isOwn ? "bg-canvas/45" : "bg-surface-subtle",
        className,
      )}
    >
      <FileArrowDown size={22} aria-hidden="true" className="shrink-0 text-brand-ink" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{nombre}</span>
        <span className="block text-xs text-foreground-secondary">
          {A.peso(megas(adjunto.bytes))} · {A.abrirArchivo}
        </span>
      </span>
    </a>
  );
}

function Ubicacion({
  ubicacion,
  isOwn,
  className,
}: {
  ubicacion: { lat: number; lng: number; etiqueta?: string };
  isOwn: boolean;
  className?: string;
}) {
  // El mismo constructor que `lib/monetization/href.ts` y `lib/comunidad/
  // recursos.ts`: un solo destino de mapa en toda la app.
  const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${ubicacion.lat},${ubicacion.lng}`,
  )}`;
  const etiqueta = ubicacion.etiqueta?.trim();

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-3 rounded-xl border border-border-subtle px-3 py-2.5",
        "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
        "hover:bg-surface-hover active:scale-[0.985]",
        "motion-reduce:transition-none motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        isOwn ? "bg-canvas/45" : "bg-surface-subtle",
        className,
      )}
    >
      <MapPin size={22} weight="fill" aria-hidden="true" className="shrink-0 text-brand-ink" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {etiqueta || A.ubicacionTitulo}
        </span>
        <span className="block text-xs text-foreground-secondary">{A.ubicacionAbrir}</span>
      </span>
    </a>
  );
}
