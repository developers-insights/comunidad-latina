"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  CaretRight,
  IdentificationCard,
  ImagesSquare,
  LinkSimple,
  MapPin,
  Paperclip,
  Warning,
  X,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { bakePhoto } from "@/lib/media/bake-photo";
import {
  MAX_ADJUNTOS_POR_ENVIO,
  clasificarMime,
  mimeBase,
  subirAdjuntoConProgreso,
  validarAdjunto,
} from "@/lib/messaging/adjuntos";
import {
  enviarAdjuntoAction,
  prepararAdjuntosAction,
  type DestinoDeAdjunto,
} from "@/app/(app)/mensajes/adjuntos-actions";
import { COPY_COMPOSER } from "./copy-composer";
import type { GrabacionLista } from "./voice-recorder";

/**
 * EL BOTÓN + Y TODO LO QUE PASA DETRÁS.
 *
 * Dos cosas viven acá:
 *   · `<AttachMenu>` — la hoja con las seis opciones.
 *   · `useAdjuntos` + `<ColaDeAdjuntos>` — el orquestador de subidas y la cola
 *     optimista, compartidos por el chat 1-a-1 y el de grupo.
 *
 * Lo segundo NO se separó en su propio archivo para que los dos composers
 * tengan UNA sola copia. Que se copien entre sí es una decisión tomada (ver el
 * docblock de `group-composer.tsx`) y vale para cuarenta líneas de textarea; no
 * para esto, donde dos copias serían dos lugares donde acordarse de arreglar el
 * mismo archivo huérfano.
 *
 * ─── POR QUÉ ES UNA LISTA Y NO UNA CUADRÍCULA ───────────────────────────────
 * El cliente comparó las dos y eligió ésta (lámina "Compartir desde el chat").
 * Sus motivos, textuales en la decisión y no reinterpretados acá: la cuadrícula
 * grande al centro tapa la conversación, obliga a leer más para ver todas las
 * opciones y cuesta acertar; la lista se recorre de una pasada, se llega con el
 * pulgar de la misma mano que sostiene el teléfono, y crece hacia abajo el día
 * que aparezca una opción más. Si alguien vuelve a proponer la cuadrícula, esto
 * es lo que hay que discutir primero.
 *
 * ─── EL AUDIO NO ESTÁ ACÁ, Y ES A PROPÓSITO ─────────────────────────────────
 * El cliente lo marcó dos veces y subrayado: el micrófono vive en la barra de
 * mensaje, al lado del campo de texto. Meterlo en esta hoja sería agregarle dos
 * toques a la acción más frecuente del chat.
 *
 * ─── SIN ENTRADA ESCALONADA DE LAS FILAS ────────────────────────────────────
 * La hoja ya entra deslizándose. Animar además cada fila es dos entradas
 * compitiendo por el mismo momento: cuando el panel llega, su contenido tiene
 * que estar ahí. La personalidad va en la física del toque, no en un desfile.
 */

export type OpcionDeAdjunto =
  | "camara"
  | "galeria"
  | "archivo"
  | "enlace"
  | "ubicacion"
  | "perfil";

interface Fila {
  opcion: OpcionDeAdjunto;
  icono: Icon;
  etiqueta: string;
  detalle: string;
  /** Fondo + tinta del azulejo. Pares del sistema, ya validados en contraste. */
  tono: string;
}

const O = COPY_COMPOSER.adjuntar.opciones;

/** El ORDEN es el que pidió el cliente. No se reordena por estética. */
const FILAS: readonly Fila[] = [
  {
    opcion: "camara",
    icono: Camera,
    etiqueta: O.camara.etiqueta,
    detalle: O.camara.detalle,
    tono: "bg-brand-tint text-brand-ink",
  },
  {
    opcion: "galeria",
    icono: ImagesSquare,
    etiqueta: O.galeria.etiqueta,
    detalle: O.galeria.detalle,
    tono: "bg-info-bg text-info-ink",
  },
  {
    opcion: "archivo",
    icono: Paperclip,
    etiqueta: O.archivo.etiqueta,
    detalle: O.archivo.detalle,
    tono: "bg-surface-subtle text-foreground-secondary",
  },
  {
    opcion: "enlace",
    icono: LinkSimple,
    etiqueta: O.enlace.etiqueta,
    detalle: O.enlace.detalle,
    tono: "bg-warning-bg text-warning-ink",
  },
  {
    opcion: "ubicacion",
    icono: MapPin,
    etiqueta: O.ubicacion.etiqueta,
    detalle: O.ubicacion.detalle,
    tono: "bg-success-bg text-success-ink",
  },
  {
    opcion: "perfil",
    icono: IdentificationCard,
    etiqueta: O.perfil.etiqueta,
    detalle: O.perfil.detalle,
    tono: "bg-gold/20 text-gold-ink",
  },
];

export interface AttachMenuProps {
  open: boolean;
  onClose: () => void;
  /** La hoja no sabe qué hace cada opción: sólo avisa cuál se tocó. */
  onElegir: (opcion: OpcionDeAdjunto) => void;
}

export function AttachMenu({ open, onClose, onElegir }: AttachMenuProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={COPY_COMPOSER.adjuntar.titulo}
      bodyClassName="overflow-y-auto px-3 pb-2 pt-3"
    >
      <ul className="flex flex-col">
        {FILAS.map((fila, indice) => {
          const Icono = fila.icono;
          return (
            <li key={fila.opcion}>
              <button
                type="button"
                onClick={() => {
                  onElegir(fila.opcion);
                  onClose();
                }}
                className={cn(
                  "group flex min-h-14 w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left",
                  "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
                  "hover:bg-surface-hover active:scale-[0.985] active:bg-surface-hover",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  "motion-reduce:transition-none motion-reduce:active:scale-100",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-11 shrink-0 items-center justify-center rounded-[14px]",
                    // Aro interior con TOKEN y no con `dark:`: el token ya
                    // voltea solo (misma razón que documenta `ui/bubble.tsx` —
                    // una regla `dark:` acá quedaría desincronizada del tema).
                    "ring-1 ring-inset ring-border-subtle",
                    "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
                    "group-active:scale-90 motion-reduce:transition-none motion-reduce:group-active:scale-100",
                    fila.tono,
                  )}
                >
                  <Icono size={21} weight="duotone" />
                </span>

                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {fila.etiqueta}
                  </span>
                  <span className="truncate text-xs text-foreground-muted">
                    {fila.detalle}
                  </span>
                </span>

                <CaretRight
                  size={16}
                  aria-hidden="true"
                  className={cn(
                    "shrink-0 text-foreground-muted/60",
                    "transition-transform duration-(--duration-fast) ease-(--ease-out-premium)",
                    "group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0",
                  )}
                />
              </button>
              {indice < FILAS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="ml-[4.375rem] block h-px bg-border-subtle"
                />
              )}
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}

/* ==========================================================================
 * LO QUE PASA DESPUÉS DE ELEGIR — cola optimista, subida y vuelta atrás
 *
 * ─── LA PERSONA NO ESPERA A LA RED ──────────────────────────────────────────
 * La tarjeta del adjunto aparece en el MISMO frame del gesto, con su miniatura
 * local (`URL.createObjectURL`, cero red) y su barra de progreso real. Recién
 * después arranca la subida. Si algo falla, la tarjeta se queda ahí en rojo con
 * "Reintentar": el error se ve DONDE ESTABA EL ARCHIVO, no en un cartel que
 * tapa la pantalla y se va solo llevándose la única copia de lo que se iba a
 * mandar.
 * ========================================================================== */

export interface PendienteDeEnvio {
  id: string;
  etiqueta: string;
  /** Miniatura local mientras sube. `null` para audio y archivos sin imagen. */
  preview: string | null;
  pct: number;
  fallo: boolean;
}

interface Trabajo {
  archivo: Blob;
  mime: string;
  nombre?: string;
  pie: string;
  duracionMs?: number;
  onda?: number[];
}

export function useAdjuntos(destino: DestinoDeAdjunto) {
  const router = useRouter();
  const { toast } = useToast();
  const [cola, setCola] = useState<PendienteDeEnvio[]>([]);
  const trabajosRef = useRef(new Map<string, Trabajo>());

  const avisar = useCallback(
    (mensaje: string, variante: "warning" | "danger" = "warning") => {
      toast({
        title: COPY_COMPOSER.rechazo.genericoTitulo,
        description: mensaje,
        variant: variante,
      });
    },
    [toast],
  );

  const traducir = useCallback((code: string, message?: string): string => {
    if (code === "peso") return COPY_COMPOSER.rechazo.peso;
    if (code === "tipo") return COPY_COMPOSER.rechazo.tipo;
    if (code === "tenant-mismatch" && message) return message;
    return COPY_COMPOSER.rechazo.genericoCuerpo;
  }, []);

  /** Sube UN trabajo y manda el mensaje que lo referencia. */
  const correr = useCallback(
    async (id: string, trabajo: Trabajo): Promise<boolean> => {
      const preparado = await prepararAdjuntosAction({ mimes: [trabajo.mime] });
      if (!preparado.ok) {
        avisar(traducir(preparado.code, preparado.message));
        return false;
      }
      const path = preparado.rutas[0]?.path;
      if (!path) return false;

      const subido = await subirAdjuntoConProgreso(
        trabajo.archivo,
        path,
        trabajo.mime,
        (pct) =>
          setCola((previa) =>
            previa.map((item) => (item.id === id ? { ...item, pct } : item)),
          ),
      );
      if (!subido) return false;

      const resultado = await enviarAdjuntoAction({
        destino,
        contenido: {
          tipo: "archivo",
          path,
          mime: trabajo.mime,
          bytes: trabajo.archivo.size,
          ...(trabajo.nombre ? { nombre: trabajo.nombre } : {}),
          ...(trabajo.duracionMs !== undefined ? { duracion_ms: trabajo.duracionMs } : {}),
          ...(trabajo.onda ? { onda: trabajo.onda } : {}),
          ...(trabajo.pie ? { pie: trabajo.pie } : {}),
        },
      });
      if (!resultado.ok) {
        avisar(traducir(resultado.code, resultado.message), "danger");
        return false;
      }
      return true;
    },
    [avisar, destino, traducir],
  );

  const procesar = useCallback(
    async (id: string) => {
      const trabajo = trabajosRef.current.get(id);
      if (!trabajo) return;
      setCola((previa) =>
        previa.map((item) => (item.id === id ? { ...item, fallo: false, pct: 0 } : item)),
      );
      const ok = await correr(id, trabajo);
      if (!ok) {
        setCola((previa) =>
          previa.map((item) => (item.id === id ? { ...item, fallo: true } : item)),
        );
        return;
      }
      trabajosRef.current.delete(id);
      setCola((previa) => {
        const item = previa.find((p) => p.id === id);
        if (item?.preview) URL.revokeObjectURL(item.preview);
        return previa.filter((p) => p.id !== id);
      });
      router.refresh();
    },
    [correr, router],
  );

  const descartar = useCallback((id: string) => {
    trabajosRef.current.delete(id);
    setCola((previa) => {
      const item = previa.find((p) => p.id === id);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return previa.filter((p) => p.id !== id);
    });
  }, []);

  /**
   * Fotos, videos y archivos.
   *
   * Las imágenes pasan por `bakePhoto` ANTES de pedir la ruta: el horneado
   * devuelve un JPEG, así que pedirla antes dejaría la extensión del path
   * apuntando a un formato distinto del que se sube.
   *
   * El GIF NO se hornea: `ctx.drawImage` se queda con el primer fotograma, y en
   * un chat el GIF se muestra tal cual — es exactamente el motivo por el que la
   * 0140 lo dejó entrar al bucket cuando la 0125 lo había dejado afuera.
   */
  const enviarArchivos = useCallback(
    async (archivos: File[], pie: string) => {
      const aceptados = archivos.slice(0, MAX_ADJUNTOS_POR_ENVIO);
      if (archivos.length > MAX_ADJUNTOS_POR_ENVIO) {
        avisar(COPY_COMPOSER.rechazo.demasiados(MAX_ADJUNTOS_POR_ENVIO));
      }

      for (const [indice, original] of aceptados.entries()) {
        const esImagen = clasificarMime(original.type) === "imagen";
        const horneable = esImagen && mimeBase(original.type) !== "image/gif";
        const archivo = horneable ? await bakePhoto(original) : original;

        const validacion = validarAdjunto({ mime: archivo.type, bytes: archivo.size });
        if (!validacion.ok) {
          avisar(
            validacion.motivo === "peso"
              ? COPY_COMPOSER.rechazo.peso
              : validacion.motivo === "tipo"
                ? COPY_COMPOSER.rechazo.tipo
                : COPY_COMPOSER.rechazo.vacio,
          );
          continue;
        }

        const id = crypto.randomUUID();
        trabajosRef.current.set(id, {
          archivo,
          mime: validacion.mime,
          nombre: original.name,
          // El pie va SÓLO con el primero: repetirlo en las diez fotos sería
          // diez veces el mismo texto en el hilo.
          pie: indice === 0 ? pie : "",
        });
        setCola((previa) => [
          ...previa,
          {
            id,
            etiqueta: original.name,
            preview: esImagen ? URL.createObjectURL(archivo) : null,
            pct: 0,
            fallo: false,
          },
        ]);
        // Secuencial: las server actions se despachan de a una por cliente
        // (Next 16), y así el primer fallo no deja una ráfaga de archivos
        // subidos sin mensaje que los referencie.
        await procesar(id);
      }
    },
    [avisar, procesar],
  );

  const enviarAudio = useCallback(
    async (grabacion: GrabacionLista) => {
      const id = crypto.randomUUID();
      trabajosRef.current.set(id, {
        archivo: grabacion.blob,
        mime: grabacion.mime,
        pie: "",
        duracionMs: grabacion.duracionMs,
        onda: grabacion.onda,
      });
      setCola((previa) => [
        ...previa,
        { id, etiqueta: COPY_COMPOSER.voz.grabar, preview: null, pct: 0, fallo: false },
      ]);
      await procesar(id);
    },
    [procesar],
  );

  /** Ubicación y perfil no suben nada: es un insert y ya. */
  const enviarSinArchivo = useCallback(
    async (
      contenido:
        | { tipo: "ubicacion"; lat: number; lng: number; etiqueta?: string }
        | { tipo: "perfil" },
    ) => {
      const resultado = await enviarAdjuntoAction({ destino, contenido });
      if (!resultado.ok) {
        avisar(traducir(resultado.code, resultado.message), "danger");
        return;
      }
      router.refresh();
    },
    [avisar, destino, router, traducir],
  );

  return { cola, enviarArchivos, enviarAudio, enviarSinArchivo, procesar, descartar };
}

/**
 * COMPARTIR UN ENLACE.
 *
 * No crea un `kind` nuevo: la dirección se escribe en la barra de mensaje y se
 * manda como texto por el camino de siempre. Es a propósito — un enlace ES
 * texto, la moderación y el aviso ya funcionan para eso, y así se puede
 * agregarle una línea antes de enviarlo ("mirá esto") en vez de mandar una
 * dirección pelada.
 */
export function EnlaceSheet({
  open,
  onClose,
  onListo,
}: {
  open: boolean;
  onClose: () => void;
  onListo: (url: string) => void;
}) {
  const [valor, setValor] = useState("");
  const [invalido, setInvalido] = useState(false);

  function confirmar() {
    const normalizada = normalizarUrl(valor);
    if (!normalizada) {
      setInvalido(true);
      return;
    }
    onListo(normalizada);
    setValor("");
    setInvalido(false);
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={COPY_COMPOSER.enlace.titulo}
      keyboardAware
    >
      <p className="text-sm text-foreground-muted">{COPY_COMPOSER.enlace.ayuda}</p>
      <label htmlFor="enlace-url" className="mt-4 block text-sm font-medium text-foreground">
        {COPY_COMPOSER.enlace.campo}
      </label>
      <input
        id="enlace-url"
        type="url"
        inputMode="url"
        autoComplete="off"
        value={valor}
        placeholder={COPY_COMPOSER.enlace.placeholder}
        aria-invalid={invalido}
        aria-describedby={invalido ? "enlace-error" : undefined}
        onChange={(event) => {
          setValor(event.target.value);
          setInvalido(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            confirmar();
          }
        }}
        className={cn(
          "mt-1.5 min-h-11 w-full rounded-xl border bg-surface px-3 text-sm text-foreground",
          "placeholder:text-placeholder focus:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          invalido ? "border-danger" : "border-border",
        )}
      />
      {invalido && (
        <p id="enlace-error" role="alert" className="mt-1.5 text-xs text-danger-ink">
          {COPY_COMPOSER.enlace.invalido}
        </p>
      )}
      <button
        type="button"
        onClick={confirmar}
        className="mt-4 min-h-11 w-full rounded-full bg-brand px-6 text-sm font-semibold text-brand-foreground shadow-xs transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring) hover:bg-brand-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        {COPY_COMPOSER.enlace.enviar}
      </button>
    </BottomSheet>
  );
}

/**
 * `"ejemplo.com/x"` → `"https://ejemplo.com/x"`, o `null` si no es una
 * dirección. Sólo `http` y `https`: sin ese filtro entraría `javascript:` — que
 * como texto no ejecuta nada, pero deja un enlace armado esperando a la
 * primera pantalla que decida hacerlo clickeable.
 */
export function normalizarUrl(entrada: string): string | null {
  const limpia = entrada.trim();
  if (limpia.length === 0 || limpia.length > 2000) return null;
  const conEsquema = /^[a-z][a-z0-9+.-]*:/i.test(limpia) ? limpia : `https://${limpia}`;
  try {
    const url = new URL(conEsquema);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Las tarjetas de lo que está en camino, arriba de la barra de mensaje. */
export function ColaDeAdjuntos({
  cola,
  onReintentar,
  onDescartar,
}: {
  cola: readonly PendienteDeEnvio[];
  onReintentar: (id: string) => void;
  onDescartar: (id: string) => void;
}) {
  if (cola.length === 0) return null;
  return (
    <ul className="mb-1.5 flex gap-2 overflow-x-auto pb-1" aria-live="polite">
      {cola.map((item) => (
        <li
          key={item.id}
          className={cn(
            "relative flex size-16 shrink-0 items-end overflow-hidden rounded-xl",
            "bg-surface-subtle ring-1 ring-inset",
            item.fallo ? "ring-danger" : "ring-border-subtle",
          )}
        >
          {item.preview ? (
            // Miniatura local: `next/image` no sirve acá (es un blob: del
            // navegador) y tampoco haría falta — el archivo ya está en memoria.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.preview} alt="" className="absolute inset-0 size-full object-cover" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center px-1 text-center text-[0.625rem] font-medium text-foreground-muted">
              {item.etiqueta.slice(0, 16)}
            </span>
          )}

          {item.fallo ? (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-danger-bg/90">
              <Warning size={16} weight="fill" className="text-danger" aria-hidden="true" />
              <button
                type="button"
                onClick={() => onReintentar(item.id)}
                className="rounded-full px-1.5 text-[0.625rem] font-bold text-danger-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {COPY_COMPOSER.envio.reintentar}
              </button>
            </span>
          ) : (
            // Progreso por `transform`: animar el ancho relayoutearía la tarjeta
            // sesenta veces por segundo, y son varias a la vez.
            <span
              aria-hidden="true"
              className="relative z-10 h-1 w-full origin-left bg-brand transition-transform duration-(--duration-base) ease-(--ease-out-premium) motion-reduce:transition-none"
              style={{ transform: `scaleX(${Math.max(0.04, item.pct / 100)})` }}
            />
          )}

          <button
            type="button"
            onClick={() => onDescartar(item.id)}
            aria-label={`${COPY_COMPOSER.envio.descartar}: ${item.etiqueta}`}
            className="absolute right-0.5 top-0.5 z-20 flex size-5 items-center justify-center rounded-full bg-media-scrim text-on-media focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <X size={11} weight="bold" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
