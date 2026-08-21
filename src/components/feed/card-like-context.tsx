"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { AUTH_REASON, useRequireAuth } from "@/components/auth/auth-sheet";
import { createClient } from "@/lib/supabase/client";
import { notifyPostReactionAction } from "@/app/(app)/feed/actions";

/**
 * Motor de "me gusta" optimista de UN post + contexto para COMPARTIR ese estado
 * entre el doble-tap de la foto (card-post-media) y el botón de me gusta
 * (post-actions), como en Instagram: tocar dos veces la foto y tocar el corazón
 * mueven el MISMO contador. Sin esto, cada isla tendría su estado y se
 * desincronizarían.
 *
 * La lógica optimista (insert/delete en `reactions`; 23505 = ya existía) es la
 * misma que vivía en PostActions — se centralizó acá para reusarla en las dos
 * islas y no duplicar el manejo de reversión.
 */

export interface PostLikeState {
  liked: boolean;
  count: number;
  /** Alterna el me gusta (botón). Si el viewer es anónimo, abre la hoja de entrada. */
  toggle: (next: boolean) => void;
  /** Me gusta IDEMPOTENTE (doble-tap): nunca quita; si ya está, no hace nada. */
  likeOnce: () => void;
  /** true si hay sesión (puede reaccionar sin ser redirigido a entrar). */
  canReact: boolean;
}

export interface UseOptimisticLikeArgs {
  postId: string;
  tenantId: string;
  viewerId: string | null;
  initialLiked: boolean;
  initialCount: number;
}

/**
 * Estado de me gusta optimista para un post. La UI responde <100ms; si la DB
 * rechaza, se revierte. Se usa directamente como fallback en PostActions cuando
 * la card se renderiza fuera de un CardLikeProvider (robustez), y adentro del
 * provider para alimentar el contexto compartido.
 */
export function useOptimisticLike({
  postId,
  tenantId,
  viewerId,
  initialLiked,
  initialCount,
}: UseOptimisticLikeArgs): PostLikeState {
  const requireAuth = useRequireAuth();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [, startTransition] = useTransition();

  /**
   * El me gusta que quedó pendiente mientras la persona entraba.
   *
   * Éste es el único caso del feed que NO puede reintentarse en el acto: el
   * insert en `reactions` escribe `profile_id` con el `viewerId` que baja del
   * servidor, y en el momento de reanudar ese prop todavía dice `null` (el
   * closure es el de antes de entrar). Así que el deseo se guarda acá y se
   * ejecuta recién cuando el `router.refresh()` de la hoja trae el viewer
   * verdadero — el efecto que hay debajo de `applyToggle` lo está esperando.
   *
   * Lo alternativo sería preguntarle a Supabase quién es desde el cliente, o
   * sea un segundo camino de sesión conviviendo con el que ya existe.
   */
  const pendingLike = useRef<boolean | null>(null);

  /**
   * Abre la hoja de entrada dejando el me gusta armado para después.
   *
   * El deseo se arma DENTRO de `onAuthenticated`, no antes de abrir la hoja
   * (revisión de código 2026-08-20). Armarlo antes dejaba un me gusta fantasma:
   * quien tocaba el corazón siendo anónimo y CERRABA la hoja sin entrar se
   * quedaba con el ref cargado, porque el `dismiss()` del provider limpia su
   * propia acción pendiente pero no puede alcanzar este ref. Y el efecto que lo
   * consume espera un cambio de `viewerId`, o sea CUALQUIER login posterior:
   * entrar más tarde por otro motivo —guardar otra publicación, votar— le
   * aplicaba el me gusta abandonado a la publicación de antes y le mandaba la
   * notificación a su autor. Con dos corazones abandonados, se aplicaban los
   * dos.
   *
   * Puesto acá, el ref sólo se carga si la sesión efectivamente se creó, y el
   * efecto de abajo lo levanta igual cuando el `router.refresh()` trae el
   * viewer verdadero.
   */
  function requireLike(nextLiked: boolean) {
    requireAuth({
      reason: AUTH_REASON.like,
      // Esta card se pinta igual en el feed que en `/feed/[id]`, y ahí sólo se
      // llega abriendo un enlace compartido o una notificación: si el camino se
      // va del navegador (Google, enlace mágico), plegar al feed le come justo
      // la publicación que la persona fue a ver. Ver `resumeDestination`.
      foldPostDetail: false,
      onAuthenticated: () => {
        pendingLike.current = nextLiked;
      },
    });
  }

  function persist(nextLiked: boolean) {
    // Sólo se llama con sesión (toggle/likeOnce ya cortan a los anónimos); el
    // guard además narrowea viewerId a string para las escrituras de abajo.
    if (!viewerId) return;
    startTransition(async () => {
      const supabase = createClient();
      if (nextLiked) {
        const { error } = await supabase.from("reactions").insert({
          tenant_id: tenantId,
          subject_kind: "post",
          subject_id: postId,
          profile_id: viewerId,
          kind: "like",
        });
        // 23505 = la reacción ya existía (doble tap veloz): el estado ya es correcto.
        if (error && error.code !== "23505") {
          setLiked(false);
          setCount((current) => Math.max(0, current - 1));
        } else {
          // Aviso al autor (0068). Va DESPUÉS de que la reacción quedó guardada
          // y no bloquea nada: la action re-verifica que la reacción exista, no
          // se auto-notifica y agrupa, así que veinte me gusta son una sola fila.
          void notifyPostReactionAction({ postId }).catch(() => {
            // Un aviso que no salió no puede desarmar un me gusta que sí.
          });
        }
      } else {
        const { error } = await supabase
          .from("reactions")
          .delete()
          .eq("subject_kind", "post")
          .eq("subject_id", postId)
          .eq("profile_id", viewerId);
        if (error) {
          setLiked(true);
          setCount((current) => current + 1);
        }
      }
    });
  }

  function toggle(nextLiked: boolean) {
    if (!viewerId) {
      requireLike(nextLiked);
      return;
    }
    applyToggle(nextLiked);
  }

  /** El camino con sesión: optimista + persistencia. */
  function applyToggle(nextLiked: boolean) {
    if (nextLiked === liked) return; // ya está en ese estado: nada que hacer
    setLiked(nextLiked);
    setCount((current) => Math.max(0, current + (nextLiked ? 1 : -1)));
    try {
      navigator.vibrate?.(10);
    } catch {
      // sin soporte háptico: nada que hacer
    }
    persist(nextLiked);
  }

  useEffect(() => {
    if (!viewerId || pendingLike.current === null) return;
    const wanted = pendingLike.current;
    pendingLike.current = null;
    // El efecto vive DEBAJO de `applyToggle` a propósito: leer desde un efecto
    // una función declarada más abajo congela la versión vieja y el compilador
    // de React lo rechaza (react-hooks/immutability).
    //
    // Diferido a un frame: el efecto corre dentro del commit del refresh y un
    // setState sincrónico acá encadena renders (react-hooks/set-state-in-effect).
    const raf = requestAnimationFrame(() => applyToggle(wanted));
    return () => cancelAnimationFrame(raf);
    // `applyToggle` se redefine en cada render; el disparador real es viewerId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId]);

  function likeOnce() {
    if (!viewerId) {
      requireLike(true);
      return;
    }
    if (liked) return; // doble-tap sobre algo ya likeado: no se toca el estado
    toggle(true);
  }

  return { liked, count, toggle, likeOnce, canReact: Boolean(viewerId) };
}

const PostLikeContext = createContext<PostLikeState | null>(null);

/**
 * Provee el estado de me gusta de un post a sus islas (foto + acciones). Lo monta
 * PostCard envolviendo la cabecera/cuerpo (server, pasan como children y siguen
 * siendo server), la foto y la fila de acciones.
 */
export function CardLikeProvider({
  postId,
  tenantId,
  viewerId,
  initialLiked,
  initialCount,
  children,
}: UseOptimisticLikeArgs & { children: ReactNode }) {
  const like = useOptimisticLike({
    postId,
    tenantId,
    viewerId,
    initialLiked,
    initialCount,
  });
  return (
    <PostLikeContext.Provider value={like}>{children}</PostLikeContext.Provider>
  );
}

/** Estado compartido del post, o null si la isla se usa fuera del provider. */
export function useCardLike(): PostLikeState | null {
  return useContext(PostLikeContext);
}
