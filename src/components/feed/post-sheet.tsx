"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  fetchPostForSheetAction,
  type PostSheetPayload,
} from "@/app/(app)/feed/post-sheet-actions";
import { Banner, BottomSheet, Button, Skeleton } from "@/components/ui";
import { useCloseOnBack } from "@/lib/design/use-overlay";
import { useAuthSessionNonce } from "@/components/auth/auth-sheet";
import { COPY } from "./copy";
import { PostCard } from "./post-card";

/**
 * HOJA DE PUBLICACIÓN — abrir un post SIN irse de donde estás.
 *
 * Feedback cliente 2026-08-20: "cuando querés comentar una publicación no te
 * tiene que mover a otra publicación; ahí nomás dentro de pantalla se tiene que
 * fluir sin sacarte del feed. Mientras menos pasos mejor. Fijate dónde podés
 * aplicar esa mejora".
 *
 * Es la MISMA idea que ya resolvió la hoja de comentarios (2026-07-21: "doy un
 * comentario y me manda a otra página"), un escalón más arriba: en el feed la
 * tarjeta ya está a la vista, pero desde un PERFIL, desde GUARDADOS, desde un
 * NEGOCIO o desde las novedades de un EVENTO, ver una publicación costaba una
 * navegación entera a `/feed/[id]` más un "atrás" que devolvía la grilla
 * recargada y perdía el scroll. Cuatro miniaturas, el mismo peaje.
 *
 * CÓMO SE COMENTA DESDE ACÁ, Y POR QUÉ ES EL CAMINO MÁS CORTO. La hoja no
 * inventa su propio hilo: monta la tarjeta REAL (`PostCard`), y esa tarjeta trae
 * su fila de acciones de siempre, donde el botón de comentar YA abre
 * `useCommentsSheet()` — con la forma que corresponda (vidrio sobre foto o
 * video, sólida sobre texto), porque la elige el carrusel de la propia tarjeta.
 * O sea: dentro de la hoja, comentar cuesta EXACTAMENTE lo mismo que en el feed,
 * ni un toque más, y no hay una segunda implementación del hilo que pueda
 * desincronizarse de la que ya existe. El total desde una miniatura pasa de
 * "toque + navegación + toque + atrás" a "toque + toque", sin navegar nunca.
 *
 * ORDEN DE MONTAJE (importa): `PostSheetProvider` tiene que quedar DENTRO de
 * `CommentsSheetProvider`. La tarjeta de esta hoja busca la hoja de comentarios
 * por contexto hacia arriba; al revés, comentar desde acá no haría nada.
 *
 * QUÉ NO ES. No reemplaza a `/feed/[id]`: esa ruta sigue siendo el destino de
 * compartir, del deep link y del "abrir en otra pestaña" (el disparador conserva
 * su `href` real, ver `PostSheetTrigger`), y sigue siendo donde se ADMINISTRA
 * una publicación —el menú ⋯ no viaja a la hoja porque su borrado sólo sabe
 * redirigir o refrescar, y adentro de un panel eso dejaría una tarjeta fantasma
 * en pantalla—. La hoja es para leer y conversar; la página, para todo lo demás.
 */

const SHEET_COPY = {
  title: "Publicación",
  /** Ya no está (borrada, o nunca fue visible para quien mira). */
  goneTitle: "Esta publicación ya no está",
  goneMessage:
    "Puede que quien la publicó la haya borrado. Probá con otra: hay comunidad de sobra.",
  /** No pudimos traerla (conexión). Otra cosa muy distinta a la de arriba. */
  errorTitle: "No pudimos abrir la publicación",
  errorMessage: "Puede ser la conexión. Volvé a intentar en un momento.",
  retry: "Reintentar",
  /** Salida al detalle completo: ahí vive el menú ⋯ (editar, reportar, eliminar). */
  openFull: "Ver la publicación completa",
} as const;

export interface OpenPostSheetArgs {
  postId: string;
}

interface PostSheetContextValue {
  open: (args: OpenPostSheetArgs) => void;
}

const PostSheetContext = createContext<PostSheetContextValue | null>(null);

/**
 * Hook de los disparadores. Devuelve `null` fuera del provider —igual que
 * `useCardLike()`— y no un no-op: quien lo llama NECESITA distinguir los dos
 * casos, porque sin hoja el camino correcto no es "no pasa nada" sino navegar
 * al detalle de siempre.
 */
export function usePostSheet(): PostSheetContextValue | null {
  return useContext(PostSheetContext);
}

export function PostSheetProvider({ children }: { children: ReactNode }) {
  const [postId, setPostId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const openSheet = useCallback((args: OpenPostSheetArgs) => {
    setPostId(args.postId);
    setOpen(true);
  }, []);

  const closeSheet = useCallback(() => setOpen(false), []);

  /**
   * EL "ATRÁS" DEL TELÉFONO CIERRA LA HOJA, NO LA PANTALLA.
   *
   * Para esta hoja es una REGRESIÓN que arreglar, no una mejora que agregar
   * (revisión de código 2026-08-20): hasta que la miniatura dejó de navegar, en
   * Android el "atrás" devolvía la grilla del perfil. Con la hoja y sin esto,
   * el mismo gesto sacaba del perfil entero — justo lo que esta rama vino a
   * eliminar. `useCloseOnBack` es el mismo par pushState/popstate que el visor
   * de medios ya usaba desde julio, ahora compartido: con la hoja de
   * comentarios encima, un "atrás" cierra sólo la de arriba.
   */
  useCloseOnBack(open, closeSheet);

  // La publicación se suelta RECIÉN tras la animación de salida: limpiarla junto
  // con `open=false` vaciaría el panel a mitad del slide-down. Mismo tiempo y
  // mismo motivo que en la hoja de comentarios.
  useEffect(() => {
    if (open || !postId) return;
    const timer = window.setTimeout(() => setPostId(null), 320);
    return () => window.clearTimeout(timer);
  }, [open, postId]);

  const value = useMemo(() => ({ open: openSheet }), [openSheet]);

  return (
    <PostSheetContext.Provider value={value}>
      {children}
      <BottomSheet
        open={open}
        onClose={closeSheet}
        title={SHEET_COPY.title}
        // "auto", no "tall": la hoja crece con lo que hay adentro. Una pregunta
        // de dos renglones no tiene por qué ocupar 88dvh de vacío, y una foto
        // 4:5 llega igual al tope de 85dvh.
        size="auto"
        // La tarjeta trae su propio borde y su foto a sangre: el margen ancho
        // del panel la dejaría flotando en una isla. Menos aire a los costados,
        // el mismo radio y los mismos tokens que el resto de las hojas.
        bodyClassName="overflow-y-auto px-3 pb-4 pt-2"
      >
        {/* key por publicación: cambiar de post remonta fresco y nunca arrastra
            la tarjeta anterior mientras carga la nueva. */}
        {postId && <PostSheetBody key={postId} postId={postId} />}
      </BottomSheet>
    </PostSheetContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Disparador: la miniatura que abre la hoja SIN dejar de ser un link
// ---------------------------------------------------------------------------

export interface PostSheetTriggerProps {
  postId: string;
  children: ReactNode;
  className?: string;
  /** Descripción para lectores de pantalla (el contenido suele ser una foto). */
  ariaLabel?: string;
}

/**
 * Envoltorio de una miniatura de publicación. Sigue siendo un `<a href>` de
 * verdad —no un `<button>`— y eso no es un detalle:
 *
 *  · compartir, "copiar dirección del enlace" y "abrir en otra pestaña" siguen
 *    dando `/feed/[id]`, que es la URL canónica de una publicación;
 *  · con ctrl/cmd/shift/alt o botón del medio, el navegador hace lo suyo y la
 *    hoja no se mete: abrir en otra pestaña tiene que seguir abriendo la página;
 *  · sin JS —o fuera del provider— el toque navega al detalle de siempre. La
 *    hoja MEJORA el camino; no es el único que hay.
 *
 * Sólo el toque simple, con provider montado, se queda acá adentro.
 */
export function PostSheetTrigger({
  postId,
  children,
  className,
  ariaLabel,
}: PostSheetTriggerProps) {
  const sheet = usePostSheet();

  return (
    <Link
      href={`/feed/${postId}`}
      aria-label={ariaLabel}
      className={className}
      onClick={(event) => {
        if (!sheet) return;
        // Modificadores y botón del medio: es un pedido explícito de "abrilo
        // como link". No se toca.
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return;
        }
        event.preventDefault();
        sheet.open({ postId });
      }}
    >
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Cuerpo: trae la publicación al abrir y la pinta con la tarjeta de siempre
// ---------------------------------------------------------------------------

type LoadStatus = "loading" | "ready" | "gone" | "error";

function PostSheetBody({ postId }: { postId: string }) {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [payload, setPayload] = useState<PostSheetPayload | null>(null);
  /**
   * Si alguien ENTRA sin cerrar esta hoja (toca "me gusta" siendo anónimo, la
   * hoja de autenticación se abre encima, se autentica y vuelve acá), este
   * número cambia y la publicación se vuelve a traer con la identidad nueva.
   *
   * Hace falta explícitamente: el `router.refresh()` que dispara la hoja de
   * autenticación refresca el árbol del SERVIDOR, y este payload es estado de
   * cliente — no lo toca. Sin esto, `payload.viewerId` seguiría diciendo `null`
   * después de entrar: la tarjeta le volvería a pedir sesión a quien ya la
   * tiene, en bucle, y el "guardado"/"me gusta" que se ven serían los de antes
   * de entrar. En un teléfono compartido eso es mostrar el estado privado de
   * otra cuenta. (Hallazgo de la auditoría de seguridad, 2026-08-20.)
   */
  const sessionNonce = useAuthSessionNonce();

  // Sin setState SÍNCRONO acá adentro: "loading" ya es el estado inicial (el
  // cuerpo se remonta por publicación vía key) y el reset del reintento vive en
  // el handler del botón, donde el setState síncrono es legal. Mismo patrón que
  // la hoja de comentarios, por la misma regla (react-hooks/set-state-in-effect).
  const load = useCallback(async () => {
    try {
      const result = await fetchPostForSheetAction({ postId });
      if (!result.ok) {
        setStatus(result.reason === "not-found" ? "gone" : "error");
        return;
      }
      setPayload(result.data);
      setStatus("ready");
    } catch {
      // La action puede caerse por red antes de devolver nada. Es el MISMO caso
      // que un error del servidor para quien mira: la hoja lo dice y ofrece
      // reintentar, nunca se queda en silencio cargando para siempre.
      setStatus("error");
    }
    // `sessionNonce` no se usa adentro a propósito: está en las dependencias
    // para que entrar desde la hoja vuelva a pedir la publicación. Ver arriba.
    //
    // La regla lo marca como dependencia "innecesaria" porque no aparece en el
    // cuerpo, y acá se equivoca: ése es justamente el mecanismo. Sacarla haría
    // que después de iniciar sesión la hoja siguiera mostrando lo que se ve sin
    // sesión hasta que la persona la cierre y la vuelva a abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, sessionNonce]);

  useEffect(() => {
    // Diferido a un frame: la regla set-state-in-effect considera todo el camino
    // de load() parte del efecto, aun con awaits de por medio.
    const raf = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(raf);
  }, [load]);

  if (status === "loading") return <PostSheetSkeleton />;

  if (status === "gone") {
    return (
      <SheetNotice
        title={SHEET_COPY.goneTitle}
        message={SHEET_COPY.goneMessage}
      />
    );
  }

  if (status === "error" || !payload) {
    return (
      <SheetNotice
        title={SHEET_COPY.errorTitle}
        message={SHEET_COPY.errorMessage}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setStatus("loading");
              void load();
            }}
          >
            {SHEET_COPY.retry}
          </Button>
        }
      />
    );
  }

  const postStatus = payload.post.postMenu.status;

  return (
    <div className="flex flex-col gap-3">
      {/* Los mismos avisos que el detalle: una publicación en revisión o
          retirada mostrada sin su cartel se leería como publicada. */}
      {postStatus === "pending_review" && (
        <Banner variant="warning" className="rounded-lg">
          {COPY.post.inReviewBanner}
        </Banner>
      )}
      {postStatus === "removed" && (
        <Banner variant="info" className="rounded-lg">
          {COPY.post.removedBanner}
        </Banner>
      )}

      {/*
        SIN `isDetail`. Es la decisión de fondo de esta hoja: con `isDetail` la
        fila de acciones da el conteo de comentarios como dato informativo —
        tiene sentido en `/feed/[id]`, donde el hilo ya está abajo en la página—
        y acá dejaría a la persona sin la forma de comentar, que es justo lo que
        vino a hacer. Sin él, la tarjeta se comporta como en el feed: el botón
        abre la hoja de comentarios encima. El cuerpo largo se despliega con un
        toque, ahí mismo.

        `videoScope="sin-reel"`: acá se está mirando UNA publicación, a la que se
        llegó desde un perfil, un negocio o un evento. Tocar el video la abre a
        pantalla completa, no larga el scroll infinito de videos ajenos (mismo
        criterio y mismo valor que `/feed/[id]`, feedback cliente 2026-07-27).
      */}
      {/* `key` por viewer: las islas de la tarjeta (guardado, me gusta, voto)
          siembran su estado con `useState(prop)` y no se re-siembran cuando la
          prop cambia. Al pasar de anónimo a con sesión hay que REMONTARLAS, o
          la tarjeta sigue mostrando lo que valía para el anónimo aunque el
          payload ya diga otra cosa. */}
      <PostCard
        key={payload.viewerId ?? "anon"}
        post={payload.post}
        tenantId={payload.tenantId}
        viewerId={payload.viewerId}
        videoScope="sin-reel"
      />

      {/* Salida al detalle completo. Es lo que devuelve el menú ⋯ (editar,
          reportar, eliminar) a quien lo necesite, sin meter dentro del panel un
          borrado que no sabe cerrarlo. */}
      <Link
        href={`/feed/${payload.post.id}`}
        className="self-center rounded-md px-2 py-1 text-sm font-semibold text-brand-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        {SHEET_COPY.openFull}
      </Link>
    </div>
  );
}

/** Aviso centrado de la hoja: vacío y error comparten forma, no texto. */
function SheetNotice({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p className="text-sm text-foreground-secondary">{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * Silueta de la tarjeta mientras viaja (§5.2: nunca un spinner suelto).
 *
 * NO reserva el 4:5 de la foto, a diferencia de `PostCardSkeleton`: como el
 * panel es "auto", una silueta alta que después se achica es un salto HACIA
 * ABAJO —el más molesto de los dos— y encima le mentiría a un post de texto,
 * que es la mitad de lo que se abre desde un perfil. Creciendo, en cambio, la
 * hoja acompaña.
 */
function PostSheetSkeleton() {
  return (
    <div
      aria-busy="true"
      className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-xs"
    >
      <div className="flex items-center gap-2.5 p-4 pb-0">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-1.5 h-3 w-16" />
        </div>
      </div>
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/5" />
        <div className="mt-2 flex gap-4">
          <Skeleton className="h-6 w-12" />
          <Skeleton className="h-6 w-12" />
        </div>
      </div>
    </div>
  );
}
