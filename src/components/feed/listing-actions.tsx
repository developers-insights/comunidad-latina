"use client";

import { useState, useTransition } from "react";
import { BookmarkSimple, ChatCircle, Heart, ShareNetwork } from "@phosphor-icons/react/dist/ssr";
import { AUTH_REASON, useRequireAuth } from "@/components/auth/auth-sheet";
import { useToast } from "@/components/ui";
import {
  recordListingShareAction,
  toggleSaveAction,
} from "@/app/(app)/feed/engagement-actions";
import { ACTION_ICON, ActionButton, ActionRow, ActionToggle } from "./action-bar";
import type { PostLikeState } from "./card-like-context";
import { useCommentsSheet } from "./comments-sheet";

/**
 * =============================================================================
 * LA BARRA DE ACCIONES DE UNA FICHA
 * =============================================================================
 *
 * Pedido del cliente (2026-08-31): circuló en verde, sobre una tarjeta de ficha
 * («Compañía de construcción · Negocio»), la barra entera —me gusta, comentar,
 * compartir, guardar— arriba de "Ver detalles". Hasta hoy la tarjeta de ficha
 * tenía SÓLO el CTA: un aviso se podía mirar, no se podía guardar ni comentar,
 * aunque las dos cosas ya existían en la base desde la 0038.
 *
 * ── LO QUE NO SE INVENTÓ ───────────────────────────────────────────────────
 * Ninguna de las tres acciones que se montan acá es nueva. Se resuelven todas
 * con el id que la tarjeta ya tiene:
 *
 *   · GUARDAR   → `toggleSaveAction({ subjectKind: "listing" })`. `saves` es
 *                 polimórfica desde la 0038 y el detalle de propiedad y el de
 *                 profesional ya la usaban así.
 *   · COMENTAR  → `useCommentsSheet().open({ listingId })`. La hoja es la MISMA
 *                 del feed y ya es polimórfica: la reusa Marketplace desde
 *                 `listing-comments-row.tsx`. Acá no se toca, sólo se la llama.
 *   · COMPARTIR → Web Share / portapapeles, y después
 *                 `recordListingShareAction` (RPC de la 0050), que ya existía y
 *                 no la llamaba nadie desde el feed.
 *
 * ── ME GUSTA NO ESTÁ, Y ES A PROPÓSITO ─────────────────────────────────────
 * `reactions` acepta `subject_kind = 'listing'` desde la 0007 —tabla, unique y
 * policy de INSERT incluidas— pero NO existe `listings.like_count` ni el
 * trigger que lo mantenga: `app.reactions_bump_counters()` sólo toca `posts`.
 *
 * O sea que hoy se puede ESCRIBIR el me gusta y no se puede LEER cuántos hay.
 * Un corazón que suma en pantalla y vuelve a cero al recargar no es media
 * función: es una función que miente, y este repo ya decidió que la UI no
 * miente (ver la reversión del guardado, más abajo). Así que el botón se dibuja
 * SÓLO cuando quien monta la barra puede pasarle un estado de verdad — hoy,
 * nadie. Lo que falta está escrito y sin aplicar en
 * `supabase/migrations/0124_me_gusta_en_avisos.sql`.
 *
 * El prop es un `PostLikeState` ya resuelto (lo mismo que devuelve
 * `useOptimisticLike`, que desde este cambio acepta `subjectKind: "listing"`) y
 * no los ingredientes sueltos: así esta barra no tiene que saber de sesiones,
 * de firma activa ni de Supabase — sabe dibujar un corazón.
 *
 * ── EL TOQUE NO SACA DEL FEED ──────────────────────────────────────────────
 * Ninguna de las cuatro navega: comentar abre una hoja, guardar y me gusta son
 * optimistas en el lugar, y compartir usa el diálogo del sistema. Es la misma
 * regla que ya cumplían `PostActions` y el disparador de la ficha
 * (`ListingSheetTrigger`), y la razón por la que esta barra es aditiva: no le
 * saca ningún gesto a la tarjeta.
 */

/**
 * Rótulos de la barra de la ficha.
 *
 * Viven acá y no en `copy.ts` por la MISMA razón que `SHEET_COPY` y
 * `CONTACT_COPY` en `feed-listing-card.tsx`: ese archivo lo está tocando otro
 * frente en esta tanda. MOVER a `COPY.listing` cuando se pueda editar.
 *
 * No son los de `COPY.post` aunque las palabras se parezcan: los cuerpos de
 * `COPY.post` dicen "la publicación" ("Pegalo donde quieras para compartir la
 * publicación"), y un aviso de trabajo no es una publicación. Quien lee el
 * toast tiene que reconocer lo que acaba de compartir.
 */
const COPY = {
  like: "Me gusta",
  unlike: "Quitar me gusta",
  comments: "Comentarios",
  share: "Compartir",
  shareCopiedTitle: "Link copiado",
  shareCopiedBody: "Pegalo donde quieras para compartir este aviso.",
  save: "Guardar",
  unsave: "Quitar de guardados",
  saveErrorTitle: "No pudimos guardarlo",
  saveErrorBody: "Puede ser un ratito de conexión floja — no es tu culpa. Probá de nuevo.",
} as const;

/**
 * Lo que la barra necesita saber del aviso y que la tarjeta hoy NO tiene.
 *
 * Los tres son opcionales y por el mismo motivo: `FeedListingModel` todavía no
 * los trae (`LISTING_COLUMNS` no selecciona `comment_count`, y no hay lectura
 * de guardados ni de reacciones para la tanda del feed). Ausente significa
 * "todavía no lo sé", NO "es cero":
 *
 *   · sin `commentCount` el botón se dibuja sin número —abrir la hoja igual
 *     trae el hilo real— en vez de anunciar un 0 que puede ser falso;
 *   · sin `savedByViewer` la barra arranca en "no guardado", que es el mismo
 *     default documentado de `PostActions`. Guardar de verdad funciona: lo que
 *     falta es pintar lo que ya estaba guardado de antes;
 *   · sin `like` no hay corazón (ver el encabezado).
 */
export interface ListingEngagement {
  /** `listings.comment_count` (0038). Ausente → el botón va sin número. */
  commentCount?: number;
  /** Fila en `saves` para este viewer. Ausente → arranca sin marcar. */
  savedByViewer?: boolean;
  /** Me gusta ya resuelto. Ausente → el corazón no se dibuja (0124 sin aplicar). */
  like?: Pick<PostLikeState, "liked" | "count" | "toggle">;
}

export interface ListingActionsProps extends ListingEngagement {
  listingId: string;
  /** Título del aviso: entra en los nombres accesibles de los cuatro botones. */
  title: string;
  /**
   * URL CANÓNICA del aviso (`DETAIL_ROUTE`), la que se comparte. `null` para un
   * kind que todavía no tiene página: ahí no hay nada que compartir y el botón
   * no se dibuja, en vez de copiar un link roto.
   */
  detailHref: string | null;
  className?: string;
}

export function ListingActions({
  listingId,
  title,
  detailHref,
  commentCount,
  savedByViewer = false,
  like,
  className,
}: ListingActionsProps) {
  const requireAuth = useRequireAuth();
  const { toast } = useToast();
  const commentsSheet = useCommentsSheet();

  const [saved, setSaved] = useState(savedByViewer);
  const [, startSaveTransition] = useTransition();

  /**
   * Pide sesión SIN sacar a la persona del feed y con el guardado ya cargado.
   * Copia deliberada de `PostActions.requireSave`, incluido el detalle que allá
   * costó un bug: reanuda con `applySave` y no con `toggleSave`, porque éste
   * vuelve a mirar la sesión del closure viejo y reabriría la hoja en bucle.
   */
  function requireSave(next: boolean) {
    requireAuth({
      reason: AUTH_REASON.save,
      foldPostDetail: false,
      onAuthenticated: () => applySave(next),
    });
  }

  /**
   * A diferencia de `PostActions`, acá NO se corta a los anónimos antes de
   * intentar: la tarjeta de ficha no recibe `viewerId` y hacerlo bajar sólo
   * para esto lo agregaría a `FeedListingModel`, a `toFeedListingModel` y a los
   * tres lugares que montan la tarjeta. El costo real de no tenerlo es un viaje
   * al server que vuelve con `unauthenticated` — y ese camino ya existe, lo usa
   * la sesión vencida, y termina en la misma hoja de entrada con el guardado
   * cargado para reintentarlo. Mismo final, sin plomería nueva.
   */
  function toggleSave(next: boolean) {
    applySave(next);
  }

  /**
   * Optimista CON reversión visible: se pinta al instante y, si el server dice
   * que no, vuelve atrás y lo dice. Nunca un `catch` mudo — la barra no puede
   * afirmar que algo quedó guardado cuando no quedó.
   */
  function applySave(next: boolean) {
    if (next === saved) return;
    setSaved(next);
    try {
      navigator.vibrate?.(10);
    } catch {
      // sin soporte háptico: nada que hacer
    }

    startSaveTransition(async () => {
      const result = await toggleSaveAction({
        subjectKind: "listing",
        subjectId: listingId,
        save: next,
      });
      if (result.ok) {
        // El server manda: si ya existía (doble toque veloz), su respuesta es la
        // verdad y el optimismo se alinea sin parpadeo.
        setSaved(result.saved);
        return;
      }
      setSaved(!next);
      if (result.code === "unauthenticated") {
        requireSave(next);
        return;
      }
      toast({
        title: COPY.saveErrorTitle,
        description: COPY.saveErrorBody,
        variant: "danger",
      });
    });
  }

  /**
   * Compartir. La métrica se registra DESPUÉS de que el share resolvió bien y
   * nunca antes: contar la intención convertiría cada cancelación del diálogo
   * del sistema en una compartida que no ocurrió (es la regla que ya escribió
   * `recordListingShareAction`, acá se la respeta).
   */
  async function share() {
    if (!detailHref) return;
    const url = `${window.location.origin}${detailHref}`;
    try {
      if (navigator.share) {
        await navigator.share({ url, title });
      } else {
        await navigator.clipboard.writeText(url);
        toast({
          title: COPY.shareCopiedTitle,
          description: COPY.shareCopiedBody,
          variant: "success",
        });
      }
    } catch {
      // El usuario canceló el share nativo — no es un error, y no se cuenta.
      return;
    }
    // Fire-and-forget: la action se traga sus propios errores. Compartir tiene
    // que funcionar aunque la métrica no.
    void recordListingShareAction({ listingId });
  }

  return (
    <ActionRow className={className}>
      {like && (
        <ActionToggle
          tone="like"
          active={like.liked}
          onToggle={like.toggle}
          label={`${like.liked ? COPY.unlike : COPY.like} · ${title}`}
          className="pr-1.5"
        >
          <Heart size={ACTION_ICON} weight={like.liked ? "fill" : "regular"} aria-hidden="true" />
          <span className="numeric">{like.count}</span>
        </ActionToggle>
      )}

      <ActionButton
        tone="comment"
        label={
          commentCount === undefined
            ? `${COPY.comments} · ${title}`
            : `${COPY.comments} (${commentCount}) · ${title}`
        }
        onClick={() =>
          commentsSheet.open({
            listingId,
            ...(commentCount === undefined ? {} : { commentCount }),
          })
        }
      >
        <ChatCircle size={ACTION_ICON} aria-hidden="true" />
        {commentCount !== undefined && <span className="numeric">{commentCount}</span>}
      </ActionButton>

      {detailHref && (
        <ActionButton
          tone="share"
          label={`${COPY.share} · ${title}`}
          onClick={share}
          className="ml-auto"
        >
          <ShareNetwork size={ACTION_ICON} aria-hidden="true" />
          <span className="hidden sm:inline">{COPY.share}</span>
        </ActionButton>
      )}

      <ActionToggle
        tone="save"
        active={saved}
        onToggle={toggleSave}
        label={`${saved ? COPY.unsave : COPY.save} · ${title}`}
        className={detailHref ? undefined : "ml-auto"}
      >
        <BookmarkSimple size={ACTION_ICON} weight={saved ? "fill" : "regular"} aria-hidden="true" />
      </ActionToggle>
    </ActionRow>
  );
}
