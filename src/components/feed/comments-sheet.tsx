"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useReducedMotion } from "motion/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BottomSheet, Button, Skeleton, buttonVariants } from "@/components/ui";
import { buildTrustSignals, toTrustLevel } from "@/components/listings";
import { fetchListingCommentsAction } from "@/app/(app)/marketplace/comments-actions";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database.types";
import { cn, timeAgo } from "@/lib/utils";
import { CommentComposer, type CommentOptimisticHandlers } from "./comment-composer";
import { CommentItem } from "./comment-item";
import { COPY } from "./copy";
import type { AuthorView } from "./helpers";

/**
 * HOJA DE COMENTARIOS estilo Instagram (feedback cliente 2026-07-21: "doy un
 * comentario y me manda a otra página… debería abrirse aquí mismo; después de
 * comentar no debería salirme del feed, me mata la emoción").
 *
 * Las cards llaman `useCommentsSheet().open({ postId, commentCount })`; este
 * provider —montado en el layout de la app— abre un BottomSheet casi-fullscreen
 * con el hilo (traído en el CLIENTE al abrir) + composer inline optimista. El
 * detalle /feed/[id] conserva su hilo SSR para deep links; la hoja es el camino
 * del feed, sin navegación.
 *
 * La FIRMA de open() es el contrato estable con las cards: extenderla solo con
 * campos opcionales o con variantes NUEVAS del sujeto.
 *
 * Desde el sprint de engagement la hoja es POLIMÓRFICA: el mismo panel sirve el
 * hilo de un POST del feed o el de un AVISO del marketplace
 * (`open({ listingId })`). Cambia de dónde salen los comentarios; el hilo, el
 * composer optimista y el ciclo de moderación son exactamente los mismos.
 */

/**
 * SOBRE QUÉ se abre la hoja. Cambia la forma, no el contenido:
 *  · "default" — la hoja alta de siempre, opaca, sobre el feed.
 *  · "video" | "photo" | "banner" — media hoja de VIDRIO sobre contenido
 *    visual INMERSIVO que sigue a la vista detrás: un video que sigue
 *    corriendo, una foto, o el campo degradado de un banner de
 *    pregunta/texto. Nace del feedback sobre video (2026-07-27: "le bloqueó
 *    todo el video… ¿puede salir como un poquito más abajo? porque a veces
 *    la gente sigue viendo el video y está leyendo los comentarios"; "los
 *    comentarios tienen que ser transparente el fondo, no tiene que ser
 *    blanco") y se generaliza a foto y pregunta con el mismo feedback
 *    repetido (2026-08-05: "acá [foto] sale en blanco y te tapa toda la
 *    imagen… y en las preguntas también sale así. No sale con modo vidrio
 *    como lo habías hecho anteriormente").
 *
 *    LOS TRES usan el MISMO tratamiento de vidrio — bg-media-shade/72 +
 *    blur, tinta on-media — porque el riesgo de contraste (un video o una
 *    foto claros debajo) es igual de real en los tres, y el pedido del
 *    cliente es justamente que se vean CONSISTENTES entre sí.
 *
 *    SOLO "video" además: el hilo se desplaza solo, despacio, hasta que la
 *    persona toca algo (ver `useAutoScrollThread`) — una foto o una pregunta
 *    ya se leyeron enteras al tocar "comentar"; no hay nada "siguiendo
 *    corriendo" que acompañar mientras se lee.
 */
export type CommentsSurface = "default" | "video" | "photo" | "banner";

/** Superficies con vidrio (glass) — todo menos la hoja alta y opaca de siempre. */
const GLASS_SURFACES: ReadonlySet<CommentsSurface> = new Set([
  "video",
  "photo",
  "banner",
]);

function isGlassSurface(surface: CommentsSurface): boolean {
  return GLASS_SURFACES.has(surface);
}

interface OpenCommentsBase {
  /** Conteo conocido al abrir (pinta el título al instante, antes del fetch). */
  commentCount?: number;
  /** Superficie sobre la que se abre. Default "default". */
  surface?: CommentsSurface;
}

export type OpenCommentsArgs = OpenCommentsBase &
  (
    | { postId: string; listingId?: undefined }
    | { listingId: string; postId?: undefined }
  );

/** Sujeto del hilo, ya normalizado por el provider. */
export type CommentsSubject =
  | { kind: "post"; id: string }
  | { kind: "listing"; id: string };

interface CommentsSheetContextValue {
  open: (args: OpenCommentsArgs) => void;
}

const CommentsSheetContext = createContext<CommentsSheetContextValue | null>(null);

/** Hook de las cards. Fuera del provider devuelve un no-op (nunca rompe). */
export function useCommentsSheet(): CommentsSheetContextValue {
  const fallback = useMemo<CommentsSheetContextValue>(
    () => ({ open: () => undefined }),
    [],
  );
  return useContext(CommentsSheetContext) ?? fallback;
}

interface Session {
  subject: CommentsSubject;
  initialCount: number;
  surface: CommentsSurface;
}

/**
 * ¿Está arriba el teclado virtual? Mide cuánto del layout viewport tapa, vía
 * `visualViewport` (la única señal fiable en móvil). Sólo lo usa la hoja de
 * VIDRIO (video, foto o banner): cuando el teclado sube, la hoja se achica
 * todavía más para que el contenido de atrás NO desaparezca de pantalla
 * mientras se escribe el comentario.
 */
function useKeyboardOpen(active: boolean): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // Las mediciones se difieren a un frame: un setState síncrono dentro del
    // efecto encadena renders (react-hooks/set-state-in-effect).
    if (!active) {
      const raf = requestAnimationFrame(() => setOpen(false));
      return () => cancelAnimationFrame(raf);
    }
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const overlap = window.innerHeight - (vv.height + vv.offsetTop);
      // 120px: por debajo de eso es la barra del navegador, no un teclado.
      setOpen(overlap > 120);
    };
    const raf = requestAnimationFrame(update);
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);
  return open;
}

export function CommentsSheetProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);

  const openSheet = useCallback((args: OpenCommentsArgs) => {
    const subject: CommentsSubject = args.listingId
      ? { kind: "listing", id: args.listingId }
      : { kind: "post", id: args.postId ?? "" };
    setSession({
      subject,
      initialCount: args.commentCount ?? 0,
      surface: args.surface ?? "default",
    });
    setOpen(true);
  }, []);

  const closeSheet = useCallback(() => setOpen(false), []);

  // Soltar la sesión RECIÉN tras la animación de salida: si la limpiáramos junto
  // con `open=false`, el panel saldría vacío (los children se desmontarían antes
  // de que termine el slide-down del BottomSheet).
  useEffect(() => {
    if (open || !session) return;
    const timer = window.setTimeout(() => setSession(null), 320);
    return () => window.clearTimeout(timer);
  }, [open, session]);

  const value = useMemo(() => ({ open: openSheet }), [openSheet]);

  const overMedia = session ? isGlassSurface(session.surface) : false;
  const keyboardOpen = useKeyboardOpen(open && overMedia);

  return (
    <CommentsSheetContext.Provider value={value}>
      {children}
      <BottomSheet
        open={open}
        onClose={closeSheet}
        ariaLabel={COPY.comments.title}
        size="tall"
        keyboardAware
        className={cn(
          // EN PAPEL NO EXISTE. La hoja es un overlay modal sobre toda la
          // página, y sobre video escribe TODO en tinta `on-media` — clara por
          // definición, o sea 1.00:1 sobre papel blanco (ver
          // src/test/print-contract.test.ts). Mismo criterio que el visor de
          // medios: el panel entero lleva `cl-print-hide`. Va explícito aunque
          // el BottomSheet ya se anuncie como role="dialog": la declaración
          // tiene que vivir donde vive la tinta, no depender de un atributo de
          // otro componente. Sin efecto en pantalla (la regla es @media print).
          "cl-print-hide",
          overMedia &&
            cn(
              // MEDIA hoja: arriba sigue viéndose el video/foto/pregunta —
              // abrir los comentarios no lo tapa. Con el teclado arriba se
              // achica todavía más para que el contenido no desaparezca.
              keyboardOpen ? "h-[34dvh]" : "h-[46dvh]",
              // VIDRIO, no panel blanco: velo de media-shade + desenfoque. Con
              // 72% de tinta el texto on-media queda ≥7:1 hasta sobre un video
              // o una foto blancos, y el contenido se sigue viendo detrás —
              // MISMO tratamiento en los tres casos (video/foto/banner), no
              // hay token nuevo que inventar.
              "bg-media-shade/72 shadow-none backdrop-blur-2xl backdrop-saturate-150",
              "border-t border-on-media/15",
              // El handle de arrastre del BottomSheet usa bg-border, invisible
              // sobre el vidrio oscuro: acá se pinta con la tinta de media.
              "[&>[aria-hidden]]:bg-on-media/40",
            ),
        )}
        // El velo del fondo baja a un tinte: sobre contenido visual inmersivo,
        // lo de atrás no es ruido a tapar — es justo lo que la persona está
        // mirando (video, foto o la pieza gráfica de una pregunta/texto).
        scrimClassName={overMedia ? "bg-media-shade/25" : undefined}
        // El body toma el control del layout: header fijo + lista scrolleable +
        // composer anclado abajo. Sin esto el BottomSheet scrollea todo junto.
        bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
      >
        {session && (
          // key por sujeto: al cambiar de publicación (o de aviso) remonta fresco
          // y nunca arrastra el hilo anterior — patrón del ReportSheet.
          <CommentsSheetBody
            key={`${session.subject.kind}:${session.subject.id}`}
            subject={session.subject}
            initialCount={session.initialCount}
            surface={session.surface}
          />
        )}
      </BottomSheet>
    </CommentsSheetContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Cuerpo de la hoja: fetch client-side + lista + composer optimista
// ---------------------------------------------------------------------------

type Supabase = SupabaseClient<Database>;

const COMMENTS_LIMIT = 200;

/** Autor faltante → miembro anónimo cálido (espejo de FALLBACK_AUTHOR en queries.ts). */
const FALLBACK_AUTHOR: AuthorView = {
  profileId: null,
  displayName: COPY.post.communityMember,
  avatarUrl: null,
  score: 0,
  level: "nuevo",
  signals: [],
};

interface LoadedComment {
  id: string;
  body: string;
  timeAgoLabel: string;
  author: AuthorView;
}

interface OptimisticComment {
  tempId: string;
  body: string;
  author: AuthorView;
  timeAgoLabel: string;
  /** En vuelo hacia el servidor (aún no confirmado). */
  pending: boolean;
}

type LoadStatus = "loading" | "ready" | "error";

/**
 * Espejo CLIENT-SIDE de fetchAuthorViews (queries.ts es server-only, no se
 * importa acá): perfil + Trust Score en batch. Nunca lanza — autor sin fila
 * queda como anónimo.
 */
async function fetchAuthorViewsClient(
  supabase: Supabase,
  profileIds: string[],
): Promise<Map<string, AuthorView>> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  const byId = new Map<string, AuthorView>();
  if (ids.length === 0) return byId;

  const [profilesResult, trustResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, avatar_url, identity_verified")
      .in("id", ids),
    supabase
      .from("trust_scores")
      .select("profile_id, score, level, signals")
      .in("profile_id", ids),
  ]);

  const trustById = new Map(
    (trustResult.data ?? []).map((row) => [row.profile_id, row]),
  );

  for (const profile of profilesResult.data ?? []) {
    const trust = trustById.get(profile.id);
    byId.set(profile.id, {
      profileId: profile.id,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      score: trust?.score ?? 0,
      level: toTrustLevel(trust?.level),
      signals: buildTrustSignals(trust?.signals ?? {}, profile.identity_verified),
    });
  }
  return byId;
}

function authorViewOf(
  authors: Map<string, AuthorView>,
  authorId: string | null,
  fallback: AuthorView = FALLBACK_AUTHOR,
): AuthorView {
  return (authorId && authors.get(authorId)) || fallback;
}

/**
 * Fila del hilo ya normalizada: los comentarios de un post vienen de Supabase y
 * los de un aviso de una server action, pero de acá para abajo se tratan igual.
 */
interface ThreadRow {
  id: string;
  body: string;
  createdAt: string;
  authorId: string | null;
  /** Nombre/foto que trajo la action del aviso si el perfil no resuelve. */
  fallbackName?: string;
  fallbackAvatarUrl?: string | null;
}

type ThreadResult = { ok: true; rows: ThreadRow[] } | { ok: false };

/** Hilo de un POST: lectura directa con RLS (camino histórico, sin cambios). */
async function loadPostThread(supabase: Supabase, postId: string): Promise<ThreadResult> {
  const { data, error } = await supabase
    .from("comments")
    .select("id, body, created_at, author_id, status")
    .eq("post_id", postId)
    .eq("status", "published")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(COMMENTS_LIMIT);
  if (error) return { ok: false };
  return {
    ok: true,
    rows: (data ?? []).map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      authorId: row.author_id,
    })),
  };
}

/** Hilo de un AVISO: server action del marketplace (dueña de esa tabla). */
async function loadListingThread(listingId: string): Promise<ThreadResult> {
  const result = await fetchListingCommentsAction({ listingId });
  if (!result.ok) return { ok: false };
  return {
    ok: true,
    rows: result.items.map((item) => ({
      id: item.id,
      body: item.body,
      createdAt: item.createdAt,
      authorId: item.authorId,
      fallbackName: item.authorName,
      fallbackAvatarUrl: item.avatarUrl,
    })),
  };
}

/** Velocidad del desplazamiento automático del hilo, en píxeles por segundo. */
const AUTO_SCROLL_PX_PER_SECOND = 16;
/** Respiro antes de arrancar: primero se leen los primeros comentarios quietos. */
const AUTO_SCROLL_DELAY_MS = 1400;

/**
 * El hilo se desplaza SOLO, despacio, mientras la persona mira el video
 * (feedback cliente 2026-07-27: "si quieren leer los comentarios, los
 * comentarios se van moviendo solo como si fuera un scrolling").
 *
 * Reglas duras, para que ayude en vez de estorbar:
 *  · SOLO sobre VIDEO — no sobre foto ni banner, aunque las tres compartan el
 *    vidrio. La razón de ser de esto es "seguir mirando mientras se lee": una
 *    foto o la pieza de una pregunta ya se vieron/leyeron enteras al abrir la
 *    hoja, no hay nada corriendo que acompañar; y en el feed las manos ya
 *    están scrolleando;
 *  · con prefers-reduced-motion NO arranca nunca;
 *  · cualquier señal de que la persona tomó el control (rueda, dedo, tecla, o el
 *    foco entrando al campo de escribir) lo apaga DEFINITIVAMENTE mientras dure
 *    esta hoja: volver a arrancar solo sería pisarle el scroll a alguien que
 *    está leyendo;
 *  · al llegar al final se apaga. No vuelve arriba: un loop infinito marea.
 */
function useAutoScrollThread(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  rootRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    const node = scrollRef.current;
    const root = rootRef.current;
    if (!node || !root || typeof requestAnimationFrame !== "function") return;

    let frame = 0;
    let timer = 0;
    let lastTime = 0;
    // Posición propia en decimales: a 16px/s casi ningún frame llega a 1px, y
    // leer scrollTop de vuelta (redondeado) haría que nunca avance.
    let position = node.scrollTop;

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
      frame = 0;
      timer = 0;
    };

    const step = (now: number) => {
      if (lastTime === 0) lastTime = now;
      const elapsed = now - lastTime;
      lastTime = now;
      const max = node.scrollHeight - node.clientHeight;
      if (max > 0) {
        position = Math.min(
          position + (AUTO_SCROLL_PX_PER_SECOND * elapsed) / 1000,
          max,
        );
        node.scrollTop = position;
        if (position >= max) {
          stop();
          return;
        }
      }
      frame = requestAnimationFrame(step);
    };

    timer = window.setTimeout(() => {
      timer = 0;
      frame = requestAnimationFrame(step);
    }, AUTO_SCROLL_DELAY_MS);

    // Todo el panel, no sólo la lista: tocar el composer también es tomar el
    // control (y el foco en el input llega como focusin desde ahí).
    const events = ["pointerdown", "touchstart", "wheel", "keydown", "focusin"];
    for (const name of events) {
      root.addEventListener(name, stop, { passive: true });
    }
    return () => {
      stop();
      for (const name of events) root.removeEventListener(name, stop);
    };
  }, [enabled, rootRef, scrollRef]);
}

function CommentsSheetBody({
  subject,
  initialCount,
  surface,
}: {
  subject: CommentsSubject;
  initialCount: number;
  surface: CommentsSurface;
}) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const headingId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Sobre video/foto/banner todo se pinta con la tinta de media (claro sobre
  // el vidrio oscuro); sobre el feed, con los tokens de tema de siempre.
  const onMedia = isGlassSurface(surface);

  const [status, setStatus] = useState<LoadStatus>("loading");
  const [comments, setComments] = useState<LoadedComment[]>([]);
  const [optimistic, setOptimistic] = useState<OptimisticComment[]>([]);
  // undefined = auth sin resolver todavía; null = anónimo; objeto = logueado.
  const [viewer, setViewer] = useState<
    { id: string; author: AuthorView } | null | undefined
  >(undefined);

  // Sin setState SÍNCRONO acá adentro: el efecto de mount llama load() y la
  // regla react-hooks/set-state-in-effect analiza el camino completo. "loading"
  // ya es el estado inicial (el body se remonta por post vía key); el reset al
  // reintentar vive en el handler del botón, donde el setState síncrono es legal.
  const load = useCallback(async () => {
    const supabase = createClient();
    const now = new Date();

    const [userResult, blocksResult, thread] = await Promise.all([
      supabase.auth.getUser(),
      // RLS de user_blocks ya limita a blocker_id = auth.uid(): traemos SOLO los
      // bloqueos del viewer sin pasar su id (anónimo → set vacío).
      supabase.from("user_blocks").select("blocked_id"),
      subject.kind === "post"
        ? loadPostThread(supabase, subject.id)
        : loadListingThread(subject.id),
    ]);

    if (!thread.ok) {
      setStatus("error");
      return;
    }

    const blocked = new Set(
      (blocksResult.data ?? []).map((row) => row.blocked_id),
    );
    // Mismo filtro que el detalle: fuera los comentarios de gente que el viewer
    // bloqueó (barato, en memoria).
    const rows = thread.rows.filter(
      (row) => !row.authorId || !blocked.has(row.authorId),
    );

    const viewerId = userResult.data.user?.id ?? null;
    const authorIds = [...rows.map((row) => row.authorId), viewerId].filter(
      (id): id is string => Boolean(id),
    );
    const authors = await fetchAuthorViewsClient(supabase, authorIds);

    setComments(
      rows.map((row) => ({
        id: row.id,
        body: row.body,
        timeAgoLabel: timeAgo(row.createdAt, now),
        // Si el perfil no resuelve pero la action trajo nombre/foto, se usan sin
        // profileId: mostramos a la persona, pero NO afirmamos confianza que no
        // tenemos (sin profileId, CommentItem no pinta el badge de Trust).
        author: authorViewOf(
          authors,
          row.authorId,
          row.fallbackName
            ? {
                ...FALLBACK_AUTHOR,
                displayName: row.fallbackName,
                avatarUrl: row.fallbackAvatarUrl ?? null,
              }
            : FALLBACK_AUTHOR,
        ),
      })),
    );
    setViewer(
      viewerId ? { id: viewerId, author: authorViewOf(authors, viewerId) } : null,
    );
    setStatus("ready");
  }, [subject]);

  useEffect(() => {
    // Diferido a un frame (patrón splash-screen): la regla set-state-in-effect
    // considera TODO el camino de load() parte del efecto, aun con awaits.
    const raf = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(raf);
  }, [load]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const node = scrollRef.current;
      // jsdom no implementa scrollTo: guardamos para no romper en tests.
      if (!node || typeof node.scrollTo !== "function") return;
      node.scrollTo({
        top: node.scrollHeight,
        behavior: reduceMotion ? "auto" : "smooth",
      });
    });
  }, [reduceMotion]);

  // Ciclo optimista: el comentario se ve al instante y la lista baja hasta él;
  // el resultado de moderación lo confirma o lo retira (con el composer devolviendo
  // el texto para reintentar).
  const optimisticHandlers = useMemo<CommentOptimisticHandlers>(
    () => ({
      onStart: ({ tempId, body }) => {
        setOptimistic((prev) => [
          ...prev,
          {
            tempId,
            body,
            author: viewer?.author ?? FALLBACK_AUTHOR,
            timeAgoLabel: COPY.comments.sending,
            pending: true,
          },
        ]);
        scrollToBottom();
      },
      onPublished: (tempId) => {
        setOptimistic((prev) =>
          prev.map((item) =>
            item.tempId === tempId
              ? { ...item, pending: false, timeAgoLabel: timeAgo(new Date()) }
              : item,
          ),
        );
      },
      onRejected: (tempId) => {
        setOptimistic((prev) => prev.filter((item) => item.tempId !== tempId));
      },
    }),
    [viewer, scrollToBottom],
  );

  const visibleCount = comments.length + optimistic.length;
  // Antes de resolver mostramos el conteo que trajo la card (instantáneo); ya
  // cargado, el conteo real de lo que se ve (tras filtrar bloqueados).
  const shownCount = status === "ready" ? visibleCount : initialCount;
  const isEmpty = status === "ready" && visibleCount === 0;

  useAutoScrollThread(
    scrollRef,
    rootRef,
    // SOLO video (ver docblock de useAutoScrollThread): foto y banner
    // comparten el vidrio pero no el auto-scroll.
    surface === "video" && !reduceMotion && status === "ready" && visibleCount > 0,
  );

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      {/* Encabezado fijo */}
      <div className="shrink-0 px-6 pb-3 pt-1">
        <h2
          id={headingId}
          className={cn(
            "font-display text-xl font-bold",
            onMedia ? "text-on-media" : "text-foreground",
          )}
        >
          {COPY.comments.title}{" "}
          <span
            className={cn(
              "numeric font-semibold",
              onMedia ? "text-on-media" : "text-foreground-muted",
            )}
          >
            ({shownCount})
          </span>
        </h2>
      </div>

      {/* Región scrolleable del hilo */}
      <div
        ref={scrollRef}
        data-comments-thread=""
        className="min-h-0 flex-1 overflow-y-auto px-6"
      >
        {status === "loading" && <CommentsSkeleton onMedia={onMedia} />}

        {status === "error" && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p
              className={cn(
                "text-base font-semibold",
                onMedia ? "text-on-media" : "text-foreground",
              )}
            >
              {COPY.comments.loadErrorTitle}
            </p>
            <p
              className={cn(
                "text-sm",
                // Sin alpha: este texto se apoya en el vidrio pelado (0.72), y
                // ahí un 80% de tinta cae por debajo de AA sobre un video claro.
                // La jerarquía la hace el tamaño, no la transparencia.
                onMedia ? "text-on-media" : "text-foreground-secondary",
              )}
            >
              {COPY.comments.loadErrorBody}
            </p>
            <Button
              variant="secondary"
              size="sm"
              // Sobre el vidrio, el botón claro de siempre sería justo el bloque
              // blanco que el cliente pidió sacar: acá va contorneado en tinta
              // de media (AA de sobra sobre el velo al 72%).
              className={cn(
                onMedia &&
                  "border border-on-media/45 bg-transparent text-on-media hover:bg-on-media/10",
              )}
              onClick={() => {
                setStatus("loading");
                void load();
              }}
            >
              {COPY.comments.retry}
            </Button>
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-col items-center gap-1.5 py-10 text-center">
            <p
              className={cn(
                "text-base font-semibold",
                onMedia ? "text-on-media" : "text-foreground",
              )}
            >
              {COPY.comments.emptyTitle}
            </p>
            <p
              className={cn(
                "text-sm",
                // Sin alpha: este texto se apoya en el vidrio pelado (0.72), y
                // ahí un 80% de tinta cae por debajo de AA sobre un video claro.
                // La jerarquía la hace el tamaño, no la transparencia.
                onMedia ? "text-on-media" : "text-foreground-secondary",
              )}
            >
              {COPY.comments.emptyMessage}
            </p>
          </div>
        )}

        {status === "ready" && visibleCount > 0 && (
          <ul className="flex flex-col gap-4 py-2">
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                author={comment.author}
                body={comment.body}
                timeAgoLabel={comment.timeAgoLabel}
                tone={onMedia ? "media" : "surface"}
              />
            ))}
            {optimistic.map((item) => (
              <CommentItem
                key={item.tempId}
                author={item.author}
                body={item.body}
                timeAgoLabel={item.timeAgoLabel}
                pending={item.pending}
                tone={onMedia ? "media" : "surface"}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Composer / CTA anclado abajo (keyboard-aware via BottomSheet) */}
      <div
        className={cn(
          "shrink-0 border-t px-4 pb-1 pt-3",
          onMedia ? "border-on-media/15" : "border-border",
        )}
      >
        {viewer === null ? (
          // Anónimo: entrar y volver acá mismo (no perdemos el lugar).
          <Link
            href={`/entrar?next=${encodeURIComponent(pathname || "/feed")}`}
            className={cn(
              buttonVariants({ variant: "outline", size: "md" }),
              "w-full",
              onMedia && "border-on-media/45 bg-transparent text-on-media hover:bg-on-media/10",
            )}
          >
            {COPY.comments.signInPrompt}
          </Link>
        ) : subject.kind === "post" ? (
          <CommentComposer
            postId={subject.id}
            disabled={status !== "ready"}
            optimistic={optimisticHandlers}
            tone={onMedia ? "media" : "surface"}
          />
        ) : (
          <CommentComposer
            listingId={subject.id}
            disabled={status !== "ready"}
            optimistic={optimisticHandlers}
            tone={onMedia ? "media" : "surface"}
          />
        )}
      </div>
    </div>
  );
}

/** Silueta del hilo mientras carga (§5.2: nunca un spinner suelto). */
function CommentsSkeleton({ onMedia = false }: { onMedia?: boolean }) {
  return (
    <ul className="flex flex-col gap-4 py-2" aria-hidden="true">
      {[0, 1, 2, 3].map((row) => (
        <li key={row} className="flex items-start gap-2.5">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div
            className={cn(
              "min-w-0 flex-1 rounded-lg px-3.5 py-2.5",
              onMedia ? "bg-media-shade/35" : "bg-surface-subtle",
            )}
          >
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-1.5 h-3 w-2/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}
