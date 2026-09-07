"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  FilmSlate,
  ImageSquare,
  Images,
  VideoCamera,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MAX_ADJUNTOS_POR_ENVIO,
  clasificarMime,
  validarAdjunto,
} from "@/lib/messaging/adjuntos";
import { COPY_COMPOSER } from "./copy-composer";

/**
 * ELEGIR FOTOS Y VIDEOS — con las dos pestañas que pidió el cliente.
 *
 * ─── QUÉ SIGNIFICAN "RECIENTES" Y "ÁLBUMES" EN UN NAVEGADOR ─────────────────
 * La lámina viene de una app nativa, donde la galería del teléfono se puede
 * LEER y mostrar en una cuadrícula propia. En la web eso no existe y no es una
 * limitación que se pueda rodear: ninguna API deja enumerar el carrete, por
 * diseño — sería leer las fotos de alguien sin que elija ninguna.
 *
 * Así que las dos pestañas se traducen a lo que sí se puede hacer, sin
 * pretender que es otra cosa:
 *
 *   · RECIENTES → lo que se eligió EN ESTA CHARLA desde que se abrió. Es la
 *     mitad útil de verdad de una galería: mandar de nuevo la foto que se acaba
 *     de mandar, o agregar una que se descartó, sin volver a buscarla.
 *   · ÁLBUMES → atajos que abren el selector del teléfono, que sí muestra los
 *     álbumes reales. Filtrados (sólo fotos, sólo videos, cámara) para llegar
 *     en un toque a lo que se busca.
 *
 * Decirlo así es mejor que dibujar una cuadrícula vacía con el nombre "Álbumes"
 * que al tocarla abre el selector del sistema igual.
 */

/**
 * Lo elegido en cada chat, mientras la pestaña siga abierta. A nivel de módulo
 * y no en estado: la hoja se desmonta al cerrarse y la gracia de "recientes" es
 * justamente sobrevivir a eso. Se pierde al recargar, que es lo esperable.
 */
const recientesPorChat = new Map<string, File[]>();

/** Tope de memoria: 24 archivos por chat, los más nuevos primero. */
const MAX_RECIENTES = 24;

function recordar(chatId: string, archivos: File[]): void {
  const previos = recientesPorChat.get(chatId) ?? [];
  const clave = (archivo: File) => `${archivo.name}·${archivo.size}·${archivo.lastModified}`;
  const vistos = new Set(archivos.map(clave));
  const juntos = [...archivos, ...previos.filter((a) => !vistos.has(clave(a)))];
  recientesPorChat.set(chatId, juntos.slice(0, MAX_RECIENTES));
}

export interface PhotoPickerProps {
  open: boolean;
  onClose: () => void;
  /** Identifica el chat: los recientes son por conversación, no globales. */
  chatId: string;
  /** Abre directamente la cámara del teléfono al montar (opción "Cámara"). */
  modoCamara?: boolean;
  onEnviar: (archivos: File[], pie: string) => void;
}

interface Elegido {
  archivo: File;
  url: string;
  /** `null` si el tipo o el peso no pasan. Se muestra tachado, no se envía. */
  problema: "tipo" | "peso" | "vacio" | null;
}

export function PhotoPicker({
  open,
  onClose,
  chatId,
  modoCamara = false,
  onEnviar,
}: PhotoPickerProps) {
  const [pestana, setPestana] = useState<"recientes" | "albumes">("recientes");
  const [elegidos, setElegidos] = useState<Elegido[]>([]);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [pie, setPie] = useState("");
  const entradaRef = useRef<HTMLInputElement>(null);
  const camaraRef = useRef<HTMLInputElement>(null);
  const abiertoAntesRef = useRef(false);

  // Los object URL se crean al abrir y se sueltan al cerrar. El `Map` guarda
  // los `File`, no las URL: una URL viva por cada foto que alguien miró alguna
  // vez es una fuga que sólo se nota después de una hora de chat.
  useEffect(() => {
    if (!open) {
      setElegidos((previos) => {
        previos.forEach((item) => URL.revokeObjectURL(item.url));
        return [];
      });
      setSeleccion([]);
      setPie("");
      abiertoAntesRef.current = false;
      return;
    }
    const guardados = recientesPorChat.get(chatId) ?? [];
    setElegidos(
      guardados.map((archivo) => ({
        archivo,
        url: URL.createObjectURL(archivo),
        problema: revisar(archivo),
      })),
    );
    setPestana(guardados.length > 0 ? "recientes" : "albumes");
  }, [open, chatId]);

  // La cámara se abre desde el gesto que abrió la hoja, no desde un botón más:
  // quien tocó "Cámara" en el menú ya expresó qué quiere.
  useEffect(() => {
    if (open && modoCamara && !abiertoAntesRef.current) {
      abiertoAntesRef.current = true;
      camaraRef.current?.click();
    }
  }, [open, modoCamara]);

  const seleccionados = useMemo(
    () => elegidos.filter((item) => seleccion.includes(item.url)),
    [elegidos, seleccion],
  );
  const soloFotos = seleccionados.every(
    (item) => clasificarMime(item.archivo.type) === "imagen",
  );

  function sumar(lista: FileList | null) {
    if (!lista || lista.length === 0) return;
    const nuevos = Array.from(lista).map((archivo) => ({
      archivo,
      url: URL.createObjectURL(archivo),
      problema: revisar(archivo),
    }));
    recordar(
      chatId,
      nuevos.filter((item) => item.problema === null).map((item) => item.archivo),
    );
    setElegidos((previos) => [...nuevos, ...previos]);
    setSeleccion((previa) => {
      const sanos = nuevos.filter((item) => item.problema === null).map((item) => item.url);
      return [...previa, ...sanos].slice(0, MAX_ADJUNTOS_POR_ENVIO);
    });
    setPestana("recientes");
  }

  function alternar(item: Elegido) {
    if (item.problema !== null) return;
    setSeleccion((previa) => {
      if (previa.includes(item.url)) return previa.filter((url) => url !== item.url);
      if (previa.length >= MAX_ADJUNTOS_POR_ENVIO) return previa;
      return [...previa, item.url];
    });
  }

  function enviar() {
    if (seleccionados.length === 0) return;
    onEnviar(
      seleccionados.map((item) => item.archivo),
      pie.trim(),
    );
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={COPY_COMPOSER.galeria.titulo}
      size="tall"
      keyboardAware
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
    >
      <input
        ref={entradaRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
        multiple
        hidden
        onChange={(event) => {
          sumar(event.target.files);
          event.target.value = "";
        }}
      />
      {/* `capture` delega en la app de cámara del sistema. NO usa getUserMedia,
          así que no depende de `Permissions-Policy: camera` ni monta una vista
          previa nuestra: en un teléfono es además la cámara que la persona ya
          sabe usar. */}
      <input
        ref={camaraRef}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        hidden
        onChange={(event) => {
          sumar(event.target.files);
          event.target.value = "";
        }}
      />

      <Tabs
        value={pestana}
        onValueChange={(valor) => setPestana(valor as "recientes" | "albumes")}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList aria-label={COPY_COMPOSER.galeria.titulo} className="px-4">
          <TabsTrigger value="recientes">{COPY_COMPOSER.galeria.tabRecientes}</TabsTrigger>
          <TabsTrigger value="albumes">{COPY_COMPOSER.galeria.tabAlbumes}</TabsTrigger>
        </TabsList>

        <TabsContent
          value="recientes"
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-3"
        >
          {elegidos.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Images size={32} className="text-foreground-muted" aria-hidden="true" />
              <p className="text-sm text-foreground-muted">
                {COPY_COMPOSER.galeria.vacioRecientes}
              </p>
              <button
                type="button"
                onClick={() => entradaRef.current?.click()}
                className="min-h-11 rounded-full bg-brand px-5 text-sm font-semibold text-brand-foreground transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring) hover:bg-brand-hover active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring motion-reduce:transition-none motion-reduce:active:scale-100"
              >
                {COPY_COMPOSER.galeria.elegirDelTelefono}
              </button>
            </div>
          ) : (
            <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {elegidos.map((item) => {
                const indice = seleccion.indexOf(item.url);
                const esVideo = clasificarMime(item.archivo.type) === "video";
                return (
                  <li key={item.url}>
                    <button
                      type="button"
                      onClick={() => alternar(item)}
                      disabled={item.problema !== null}
                      aria-pressed={indice >= 0}
                      aria-label={item.archivo.name}
                      className={cn(
                        "group relative block aspect-square w-full overflow-hidden rounded-lg",
                        "bg-surface-subtle",
                        "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
                        "active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100",
                        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                        item.problema !== null && "cursor-not-allowed opacity-40",
                      )}
                    >
                      {esVideo ? (
                        <video
                          src={item.url}
                          muted
                          playsInline
                          preload="metadata"
                          className="size-full object-cover"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.url}
                          alt=""
                          className="size-full object-cover"
                        />
                      )}

                      {esVideo && (
                        <FilmSlate
                          size={14}
                          weight="fill"
                          aria-hidden="true"
                          className="absolute bottom-1.5 left-1.5 text-on-media drop-shadow"
                        />
                      )}

                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full text-[0.6875rem] font-bold",
                          "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
                          "motion-reduce:transition-none",
                          indice >= 0
                            ? "scale-100 bg-brand text-brand-foreground"
                            : "scale-90 bg-media-scrim text-on-media ring-1 ring-inset ring-on-media/50",
                        )}
                      >
                        {indice >= 0 ? indice + 1 : <Check size={12} weight="bold" />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent
          value="albumes"
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-3"
        >
          <ul className="flex flex-col gap-1.5">
            <AtajoDeAlbum
              icono={Images}
              etiqueta={COPY_COMPOSER.galeria.elegirDelTelefono}
              onClick={() => entradaRef.current?.click()}
            />
            <AtajoDeAlbum
              icono={ImageSquare}
              etiqueta={COPY_COMPOSER.galeria.soloFotos}
              accept="image/jpeg,image/png,image/webp,image/gif"
              onArchivos={sumar}
            />
            <AtajoDeAlbum
              icono={VideoCamera}
              etiqueta={COPY_COMPOSER.galeria.soloVideos}
              accept="video/mp4,video/webm,video/quicktime"
              onArchivos={sumar}
            />
            <AtajoDeAlbum
              icono={Camera}
              etiqueta={COPY_COMPOSER.galeria.sacarFoto}
              onClick={() => camaraRef.current?.click()}
            />
            <p className="px-1 pt-2 text-xs text-foreground-muted">
              {COPY_COMPOSER.galeria.ayudaAlbumes}
            </p>
          </ul>
        </TabsContent>
      </Tabs>

      {seleccionados.length > 0 && (
        <div className="shrink-0 border-t border-border-subtle bg-surface-raised px-4 pb-1 pt-3">
          <label htmlFor="picker-pie" className="sr-only">
            {COPY_COMPOSER.galeria.pie}
          </label>
          <input
            id="picker-pie"
            type="text"
            value={pie}
            maxLength={2000}
            placeholder={COPY_COMPOSER.galeria.pie}
            onChange={(event) => setPie(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground placeholder:text-placeholder focus:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p aria-live="polite" className="text-xs font-medium text-foreground-secondary">
              {soloFotos
                ? COPY_COMPOSER.galeria.seleccionFotos(seleccionados.length)
                : COPY_COMPOSER.galeria.seleccion(seleccionados.length)}
            </p>
            <button
              type="button"
              onClick={enviar}
              className="min-h-11 shrink-0 rounded-full bg-brand px-6 text-sm font-semibold text-brand-foreground shadow-xs transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring) hover:bg-brand-hover active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring motion-reduce:transition-none motion-reduce:active:scale-100"
            >
              {COPY_COMPOSER.galeria.enviar}
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

function revisar(archivo: File): "tipo" | "peso" | "vacio" | null {
  const validacion = validarAdjunto({ mime: archivo.type, bytes: archivo.size });
  return validacion.ok ? null : validacion.motivo;
}

function AtajoDeAlbum({
  icono: Icono,
  etiqueta,
  accept,
  onClick,
  onArchivos,
}: {
  icono: typeof Images;
  etiqueta: string;
  accept?: string;
  onClick?: () => void;
  onArchivos?: (lista: FileList | null) => void;
}) {
  const propio = useRef<HTMLInputElement>(null);
  return (
    <li>
      {accept && (
        <input
          ref={propio}
          type="file"
          accept={accept}
          multiple
          hidden
          onChange={(event) => {
            onArchivos?.(event.target.files);
            event.target.value = "";
          }}
        />
      )}
      <button
        type="button"
        onClick={onClick ?? (() => propio.current?.click())}
        className={cn(
          "flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-foreground",
          "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
          "hover:bg-surface-hover active:scale-[0.985]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          "motion-reduce:transition-none motion-reduce:active:scale-100",
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-surface-subtle text-foreground-secondary ring-1 ring-inset ring-border-subtle"
        >
          <Icono size={19} weight="duotone" />
        </span>
        {etiqueta}
      </button>
    </li>
  );
}
