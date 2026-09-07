"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FileArrowDown, LinkSimple, Play } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { ItemDeGaleria, SolapaDeGaleria } from "@/lib/messaging/galeria";
import { cargarMasDeLaGaleriaAction } from "@/app/(app)/mensajes/grupos/[id]/multimedia/actions";
import { COPY } from "./copy";
import { anclaDeMensaje } from "./helpers-de-mensaje";

/**
 * LO QUE SE COMPARTIÓ EN EL GRUPO — la lista.
 *
 * La primera tanda llega YA PINTADA desde el servidor y se guarda en estado
 * para que "Ver más" pueda apilar encima. No hay ningún efecto que salga a
 * buscar datos al montar: la pantalla nunca aparece vacía esperando la red.
 *
 * ─── TOCAR UN ÍTEM LLEVA AL MENSAJE, NO AL ARCHIVO ──────────────────────────
 * Pedido del cliente, y además es lo correcto: una foto suelta no dice quién la
 * mandó ni por qué, y la conversación alrededor es la mitad del valor. El
 * destino es el ancla que ya pinta cada burbuja (`anclaDeMensaje`), así que el
 * navegador la ubica solo — sin JavaScript de por medio y sobreviviendo a
 * compartir el enlace.
 *
 * ⚠️ `<img>` Y `<video>` PELADOS, NUNCA `next/image` — por lo mismo que
 * `message-attachment.tsx`: `chat-media` es privado y se sirve firmado bajo
 * `/storage/v1/object/sign/`, que no está en `images.remotePatterns`, y aunque
 * estuviera el optimizador dejaría contenido de un chat privado cacheado en el
 * CDN sin la firma que lo autorizaba.
 */

const G = COPY.galeria;

export interface GaleriaListaProps {
  grupoId: string;
  solapa: SolapaDeGaleria;
  itemsIniciales: ItemDeGaleria[];
  /** Cursor de la tanda siguiente; `null` cuando ya no queda nada más viejo. */
  cursorInicial: string | null;
}

export function GaleriaLista({
  grupoId,
  solapa,
  itemsIniciales,
  cursorInicial,
}: GaleriaListaProps) {
  const { toast } = useToast();
  const [items, setItems] = useState(itemsIniciales);
  const [cursor, setCursor] = useState(cursorInicial);
  const [cargando, startTransition] = useTransition();

  function verMas() {
    if (!cursor || cargando) return;
    startTransition(async () => {
      const resultado = await cargarMasDeLaGaleriaAction({ groupId: grupoId, solapa, cursor });
      if (!resultado.ok) {
        toast({ title: G.errorMas, variant: "danger" });
        return;
      }
      // Deduplicado por id: dos toques rápidos con el mismo cursor traerían la
      // misma tanda, y React no perdona dos hijos con la misma key.
      setItems((previos) => {
        const vistos = new Set(previos.map((item) => item.mensajeId));
        return [...previos, ...resultado.items.filter((item) => !vistos.has(item.mensajeId))];
      });
      setCursor(resultado.siguiente);
    });
  }

  const href = (mensajeId: string) =>
    `/mensajes/grupos/${grupoId}#${anclaDeMensaje(mensajeId)}`;

  return (
    <div className="flex flex-col gap-4">
      {solapa === "multimedia" ? (
        <ul className="grid grid-cols-3 gap-1.5">
          {items.map((item) =>
            item.clase === "media" ? (
              <li key={item.mensajeId}>
                <Tile item={item} href={href(item.mensajeId)} />
              </li>
            ) : null,
          )}
        </ul>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.mensajeId}>
              <Fila item={item} href={href(item.mensajeId)} />
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <Button
          variant="secondary"
          size="md"
          className="w-full"
          loading={cargando}
          onClick={verMas}
        >
          {cargando ? G.cargando : G.verMas}
        </Button>
      )}
    </div>
  );
}

/** Clases compartidas: el feedback lo da el movimiento, nunca un halo de color. */
const TOCABLE = cn(
  "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
  "active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

function Tile({
  item,
  href,
}: {
  item: Extract<ItemDeGaleria, { clase: "media" }>;
  href: string;
}) {
  const rotulo = G.abrirEnConversacion(item.quien, item.cuando);

  return (
    <Link
      href={href}
      aria-label={rotulo}
      className={cn("block", TOCABLE)}
    >
      <span className="relative block aspect-square overflow-hidden rounded-xl border border-border-subtle bg-surface-subtle shadow-xs">
      {item.src === null ? (
        <span className="flex size-full items-center justify-center px-2 text-center text-[11px] text-foreground-muted">
          {G.noDisponible}
        </span>
      ) : item.tipo === "video" ? (
        <>
          <video
            src={item.src}
            preload="metadata"
            muted
            playsInline
            aria-hidden="true"
            className="pointer-events-none size-full object-cover"
          />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex size-8 items-center justify-center rounded-full bg-canvas/80 text-foreground shadow-sm">
              <Play size={14} weight="fill" aria-hidden="true" />
            </span>
          </span>
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- bucket privado firmado: ver la cabecera
        <img
          src={item.src}
          alt=""
          width={item.ancho ?? undefined}
          height={item.alto ?? undefined}
          loading="lazy"
          decoding="async"
          className="pointer-events-none size-full object-cover"
        />
      )}
      </span>

      {/* Quién y cuándo, debajo de la miniatura y no encima: un rótulo flotando
          sobre la foto tapa justo la parte que hace reconocerla, y sobre una
          foto clara no se lee. `aria-hidden` porque el enlace ya lo dice
          entero — leerlo dos veces convierte una grilla de 24 en 48 anuncios. */}
      <span aria-hidden="true" className="mt-1 block px-0.5">
        <span className="block truncate text-[11px] font-medium text-foreground-secondary">
          {item.quien}
        </span>
        <span className="block truncate text-[11px] text-foreground-muted">{item.cuando}</span>
      </span>
    </Link>
  );
}

function Fila({ item, href }: { item: ItemDeGaleria; href: string }) {
  if (item.clase === "media") return null;

  const esArchivo = item.clase === "archivo";
  const titulo = esArchivo ? item.nombre : item.titulo;
  const segunda = esArchivo ? `${item.tipo} · ${item.peso}` : item.detalle;

  return (
    <Link
      href={href}
      aria-label={G.abrirEnConversacion(item.quien, item.cuando)}
      className={cn(
        "flex items-center gap-3 rounded-xl border border-border-subtle bg-surface px-3 py-3 shadow-xs",
        "hover:bg-surface-subtle",
        TOCABLE,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-brand-ink"
      >
        {esArchivo ? <FileArrowDown size={20} /> : <LinkSimple size={20} />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{titulo}</span>
        {segunda && (
          <span className="block truncate text-xs text-foreground-secondary">{segunda}</span>
        )}
        <span className="mt-0.5 block truncate text-xs text-foreground-muted">
          {item.quien} · {item.cuando}
        </span>
      </span>
    </Link>
  );
}
