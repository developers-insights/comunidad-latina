"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PostMediaKind, PostMediaView } from "./helpers";

/**
 * QUÉ MEDIO SE ESTÁ VIENDO en la card — fuente ÚNICA para todas sus islas.
 *
 * Un post puede traer fotos y videos mezclados ("a veces un video, dos fotos y
 * al final el video", feedback cliente 2026-07-27). Dos islas necesitan saber
 * cuál de esas diapositivas está a la vista AHORA MISMO, y no pueden
 * preguntárselo entre ellas porque son hermanas:
 *
 *  · MediaCarousel/CardPostMedia, que además es quien MUEVE ese índice (el riel
 *    con scroll-snap) y quien abre el visor en la diapositiva correcta;
 *  · PostActions, que con eso elige la FORMA de la hoja de comentarios: sobre un
 *    video, la media hoja de vidrio que lo deja corriendo detrás; sobre una foto
 *    estática, la hoja de siempre (ahí el vidrio no aporta y arriesga contraste).
 *
 * POR QUÉ UN CONTEXTO Y NO ESTADO EN LA CARD: `PostCard` se monta en DOS
 * entornos —desde `feed-list.tsx`, que es "use client", y desde
 * `/feed/[id]/page.tsx`, que es un Server Component— así que no puede tener
 * hooks. Subirle el índice obligaría a marcarla "use client" y a hidratar
 * cabecera, cuerpo, chips de entidad y Trust Score de CADA card del feed, que es
 * justo lo que su diseño evita. El estado vive entonces en el punto más bajo que
 * domina a las dos islas: un provider que la card monta y que sólo hidrata a
 * quien lo consume.
 *
 * POR QUÉ SEPARADO DE `CardLikeProvider`: aquel es estado de ENGAGEMENT (se
 * escribe en la base, se revierte si el server dice que no) y lo consume también
 * CardVideo. Éste es estado de VISTA, efímero y local. Mezclarlos metería el
 * índice del carrusel en el camino del me gusta —el contrato que comparten el
 * doble toque y el botón— sin ninguna necesidad. Dos providers chicos, cada uno
 * con una responsabilidad.
 *
 * El índice es el ÚNICO estado: `activeKind` se deriva de él, así que no puede
 * desincronizarse de lo que muestra el riel.
 */

export interface CardMediaState {
  /** Diapositivas del post, ya normalizadas (ver `postMediaItems`). */
  items: PostMediaView[];
  /** Índice visible. Siempre dentro de rango. */
  index: number;
  /** Lo llama el riel al terminar un swipe (o las flechas / el teclado). */
  setIndex: (index: number) => void;
  /** Tipo del medio a la vista; null si el post no trae medios. */
  activeKind: PostMediaKind | null;
}

const CardMediaContext = createContext<CardMediaState | null>(null);

export function CardMediaProvider({
  items,
  children,
}: {
  items: PostMediaView[];
  children: ReactNode;
}) {
  const [index, setIndex] = useState(0);

  const value = useMemo<CardMediaState>(() => {
    // Si el post se recarga con menos medios (el feed refresca y la publicación
    // ya no trae el video), un índice viejo apuntaría al vacío: la hoja se
    // abriría "sin medio" y los puntitos no marcarían ninguno. Volver al primero
    // es la lectura honesta — es lo que el riel muestra tras el remonte.
    const safeIndex = index >= 0 && index < items.length ? index : 0;
    return {
      items,
      index: safeIndex,
      setIndex,
      activeKind: items[safeIndex]?.kind ?? null,
    };
  }, [items, index]);

  return (
    <CardMediaContext.Provider value={value}>{children}</CardMediaContext.Provider>
  );
}

/**
 * Medio visible de la card, o null si la isla se montó fuera del provider.
 * Null significa "esta card no declaró medios": las acciones abren la hoja de
 * siempre, que es el default correcto.
 */
export function useCardMedia(): CardMediaState | null {
  return useContext(CardMediaContext);
}
