"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BookmarkSimple,
  ChatCircle,
  Heart,
  ShareNetwork,
} from "@phosphor-icons/react/dist/ssr";
import { useToast } from "@/components/ui";
import { LikeBurst } from "@/components/motion";
import { cn } from "@/lib/utils";
import { toggleSaveAction } from "@/app/(app)/feed/engagement-actions";
import { COPY } from "./copy";
import { useCardLike, useOptimisticLike } from "./card-like-context";
import { useCardMedia } from "./card-media-context";
import { useCommentsSheet } from "./comments-sheet";

export interface PostActionsProps {
  postId: string;
  tenantId: string;
  /** id del usuario logueado, o null si es anónimo. */
  viewerId: string | null;
  likeCount: number;
  likedByViewer: boolean;
  commentCount: number;
  /**
   * Estado inicial de "Guardar" (PostCardModel.savedByViewer). Opcional para no
   * obligar a los callers a actualizarse de golpe: ausente = no guardado.
   */
  savedByViewer?: boolean;
  /** true en el detalle: el botón de comentarios no navega, solo informa. */
  isDetail?: boolean;
  className?: string;
}

/** Botones grandes y táctiles (§4): íconos 22px, 44px de área, feedback al toque. */
const ICON = 22;

const actionClass = cn(
  "flex min-h-11 min-w-11 select-none items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-foreground-secondary",
  "transition-[transform,color,background-color] duration-(--duration-fast) ease-(--ease-spring)",
  "hover:bg-surface-subtle active:scale-[0.94]",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

/**
 * Acciones sociales de un post (§4.b): me gusta optimista, comentarios,
 * compartir y guardar. Island chiquita — el resto de la card es server component.
 *
 * El estado de me gusta se COMPARTE con el doble-tap de la foto vía
 * useCardLike() (Instagram: tocar la foto y tocar el corazón mueven el mismo
 * contador). Si la card se usara fuera de un CardLikeProvider, cae a un estado
 * propio (useOptimisticLike) para no romper.
 *
 * El botón de comentarios YA NO navega a /feed/[id] (feedback cliente 2026-07-21:
 * "que abran desde abajo, tipo Instagram"): abre el sheet vía useCommentsSheet().
 * En el detalle sigue siendo informativo (los comentarios ya están en la página).
 *
 * "Guardar" tiene su propio estado optimista (la tabla `saves` no tiene contador
 * que compartir con nadie) con la MISMA tolerancia a errores que el me gusta: se
 * pinta al instante y se revierte si el server dice que no.
 *
 * LA FORMA DE LA HOJA la decide el MEDIO QUE SE ESTÁ VIENDO, no el primero del
 * post: en un carrusel mezclado ("un video, dos fotos y al final el video") el
 * dedo ya se movió, y quien toca "comentar" está mirando la diapositiva actual.
 * Sobre un VIDEO se pide la media hoja de vidrio, que lo deja corriendo y visible
 * detrás (feedback cliente 2026-07-27, dicho dos veces en la misma call: "le
 * bloqueó todo el video", "los comentarios tienen que ser transparente el
 * fondo"). Sobre una FOTO estática el vidrio no aporta nada y arriesga contraste,
 * así que ahí se mantiene la hoja de siempre. El dato NO viaja como prop —lo
 * publica el carrusel en el contexto de medios de la card— justamente para que
 * no pueda quedar congelado ni desincronizarse del riel.
 */
export function PostActions({
  postId,
  tenantId,
  viewerId,
  likeCount,
  likedByViewer,
  commentCount,
  savedByViewer = false,
  isDetail = false,
  className,
}: PostActionsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const commentsSheet = useCommentsSheet();
  // Sin contexto (acciones montadas fuera de una card con medios) no hay video
  // que tapar: la hoja de siempre es el default correcto.
  const media = useCardMedia();
  const overVideo = media?.activeKind === "video";

  // Estado compartido si hay provider; si no, propio (ambos hooks se llaman
  // siempre para respetar las reglas de hooks — el no usado es inofensivo).
  const shared = useCardLike();
  const own = useOptimisticLike({
    postId,
    tenantId,
    viewerId,
    initialLiked: likedByViewer,
    initialCount: likeCount,
  });
  const like = shared ?? own;

  const [saved, setSaved] = useState(savedByViewer);
  const [, startSaveTransition] = useTransition();

  function goToLogin() {
    router.push(`/entrar?next=${encodeURIComponent(pathname || "/feed")}`);
  }

  function toggleSave(next: boolean) {
    if (!viewerId) {
      goToLogin();
      return;
    }
    if (next === saved) return; // ya está en ese estado: nada que hacer
    setSaved(next);
    try {
      navigator.vibrate?.(10);
    } catch {
      // sin soporte háptico: nada que hacer
    }

    startSaveTransition(async () => {
      const result = await toggleSaveAction({
        subjectKind: "post",
        subjectId: postId,
        save: next,
      });
      if (result.ok) {
        // El server manda: si el guardado ya existía (doble toque veloz), su
        // respuesta es la verdad y el optimismo se alinea sin parpadeo.
        setSaved(result.saved);
        return;
      }
      setSaved(!next); // revertimos: la UI no puede mentir sobre lo guardado
      if (result.code === "unauthenticated") {
        goToLogin();
        return;
      }
      toast({
        title: COPY.post.saveErrorTitle,
        description: COPY.post.saveErrorBody,
        variant: "danger",
      });
    });
  }

  async function share() {
    const url = `${window.location.origin}/feed/${postId}`;
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({
        title: COPY.post.shareCopiedTitle,
        description: COPY.post.shareCopiedBody,
        variant: "success",
      });
    } catch {
      // El usuario canceló el share nativo — no es un error.
    }
  }

  const commentsContent = (
    <>
      <ChatCircle size={ICON} aria-hidden="true" />
      <span className="numeric">{commentCount}</span>
    </>
  );

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <span className={cn("flex items-center", like.liked && "text-danger")}>
        <LikeBurst
          active={like.liked}
          onToggle={like.toggle}
          label={like.liked ? COPY.post.unlike : COPY.post.like}
          particleColor="var(--color-danger)"
          className={cn(actionClass, "pr-1.5", like.liked && "text-danger")}
        >
          <Heart
            size={ICON}
            weight={like.liked ? "fill" : "regular"}
            aria-hidden="true"
          />
          <span className="numeric">{like.count}</span>
        </LikeBurst>
      </span>

      {isDetail ? (
        <span
          className={cn(actionClass, "hover:bg-transparent active:scale-100")}
          aria-label={COPY.post.comments}
        >
          {commentsContent}
        </span>
      ) : (
        <button
          type="button"
          onClick={() =>
            commentsSheet.open({
              postId,
              commentCount,
              // Sobre video: media hoja de vidrio, el video sigue a la vista.
              ...(overVideo ? { surface: "video" as const } : {}),
            })
          }
          aria-label={`${COPY.post.comments} (${commentCount})`}
          className={actionClass}
        >
          {commentsContent}
        </button>
      )}

      <button
        type="button"
        onClick={share}
        aria-label={COPY.post.share}
        className={cn(actionClass, "ml-auto")}
      >
        <ShareNetwork size={ICON} aria-hidden="true" />
        <span className="hidden sm:inline">{COPY.post.share}</span>
      </button>

      {/* Guardar al final, como el marcador de Instagram. Misma micro-celebración
          que el me gusta (LikeBurst) para que las dos reacciones se sientan de la
          misma familia — acá con el acento de marca en vez del rojo. */}
      <span className={cn("flex items-center", saved && "text-brand")}>
        <LikeBurst
          active={saved}
          onToggle={toggleSave}
          label={saved ? COPY.post.unsave : COPY.post.save}
          particleColor="var(--color-brand)"
          className={cn(actionClass, saved && "text-brand")}
        >
          <BookmarkSimple
            size={ICON}
            weight={saved ? "fill" : "regular"}
            aria-hidden="true"
          />
        </LikeBurst>
      </span>
    </div>
  );
}
