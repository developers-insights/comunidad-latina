"use client";

import { useCallback, useState } from "react";
import type { CompartidoKind } from "./enlace-interno";

export interface ContenidoCompartible {
  kind: CompartidoKind;
  id: string;
  titulo: string;
  imagenUrl?: string | null;
  detalle?: string | null;
  /**
   * URL absoluta. Opcional: si no viene, se arma con el origin del navegador y
   * la ruta canónica del tipo — que es lo que hacían las cinco copias sueltas y
   * lo correcto en casi todos los casos. Se pasa explícita cuando la pantalla ya
   * conoce la URL exacta (un detalle con query que importa).
   */
  url?: string;
}

/**
 * El estado de "hay un panel de compartir abierto" separado del panel.
 *
 * Existe porque los cinco lugares que comparten (feed, detalle de aviso,
 * eventos, video largo, reels) tienen barras de acciones muy distintas y ninguna
 * quiere heredar un botón; lo único que comparten es el momento en que se abre
 * la hoja. Así cada pantalla sigue pintando SU botón y sólo llama a `abrir()`.
 */
export function useCompartir() {
  const [contenido, setContenido] = useState<ContenidoCompartible | null>(null);

  const abrir = useCallback((siguiente: ContenidoCompartible) => {
    setContenido(siguiente);
  }, []);

  const cerrar = useCallback(() => setContenido(null), []);

  return { contenido, abrir, cerrar, abierto: contenido !== null };
}

/**
 * La URL que se comparte hacia afuera.
 *
 * `window.location.origin` y no `NEXT_PUBLIC_SITE_URL`: el sitio se sirve
 * también bajo el dominio propio de cada comunidad, y un enlace copiado desde
 * ahí tiene que seguir siendo de ese dominio — mandar a alguien al canónico lo
 * saca de la casa donde estaba.
 */
export function urlAbsoluta(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}
