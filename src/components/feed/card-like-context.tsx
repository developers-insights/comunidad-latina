"use client";

import {
  createContext,
  useContext,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
  /** Alterna el me gusta (botón). Si el viewer es anónimo, va a /entrar. */
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
  const router = useRouter();
  const pathname = usePathname();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [, startTransition] = useTransition();

  function goToLogin() {
    router.push(`/entrar?next=${encodeURIComponent(pathname || "/feed")}`);
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
      goToLogin();
      return;
    }
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

  function likeOnce() {
    if (!viewerId) {
      goToLogin();
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
