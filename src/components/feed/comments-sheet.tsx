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
 * campos opcionales.
 */

export interface OpenCommentsArgs {
  postId: string;
  /** Conteo conocido al abrir (pinta el título al instante, antes del fetch). */
  commentCount?: number;
}

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
  postId: string;
  initialCount: number;
}

export function CommentsSheetProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);

  const openSheet = useCallback((args: OpenCommentsArgs) => {
    setSession({ postId: args.postId, initialCount: args.commentCount ?? 0 });
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

  return (
    <CommentsSheetContext.Provider value={value}>
      {children}
      <BottomSheet
        open={open}
        onClose={closeSheet}
        ariaLabel={COPY.comments.title}
        size="tall"
        keyboardAware
        // El body toma el control del layout: header fijo + lista scrolleable +
        // composer anclado abajo. Sin esto el BottomSheet scrollea todo junto.
        bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
      >
        {session && (
          // key por post: al cambiar de publicación remonta fresco (nunca arrastra
          // el hilo anterior), igual que el patrón del ReportSheet.
          <CommentsSheetBody
            key={session.postId}
            postId={session.postId}
            initialCount={session.initialCount}
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
): AuthorView {
  return (authorId && authors.get(authorId)) || FALLBACK_AUTHOR;
}

function CommentsSheetBody({
  postId,
  initialCount,
}: {
  postId: string;
  initialCount: number;
}) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const headingId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);

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

    const [userResult, commentsResult, blocksResult] = await Promise.all([
      supabase.auth.getUser(),
      supabase
        .from("comments")
        .select("id, body, created_at, author_id, status")
        .eq("post_id", postId)
        .eq("status", "published")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(COMMENTS_LIMIT),
      // RLS de user_blocks ya limita a blocker_id = auth.uid(): traemos SOLO los
      // bloqueos del viewer sin pasar su id (anónimo → set vacío).
      supabase.from("user_blocks").select("blocked_id"),
    ]);

    if (commentsResult.error) {
      setStatus("error");
      return;
    }

    const blocked = new Set(
      (blocksResult.data ?? []).map((row) => row.blocked_id),
    );
    // Mismo filtro que el detalle: fuera los comentarios de gente que el viewer
    // bloqueó (barato, en memoria).
    const rows = (commentsResult.data ?? []).filter(
      (row) => !row.author_id || !blocked.has(row.author_id),
    );

    const viewerId = userResult.data.user?.id ?? null;
    const authorIds = [...rows.map((row) => row.author_id), viewerId].filter(
      (id): id is string => Boolean(id),
    );
    const authors = await fetchAuthorViewsClient(supabase, authorIds);

    setComments(
      rows.map((row) => ({
        id: row.id,
        body: row.body,
        timeAgoLabel: timeAgo(row.created_at, now),
        author: authorViewOf(authors, row.author_id),
      })),
    );
    setViewer(
      viewerId ? { id: viewerId, author: authorViewOf(authors, viewerId) } : null,
    );
    setStatus("ready");
  }, [postId]);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Encabezado fijo */}
      <div className="shrink-0 px-6 pb-3 pt-1">
        <h2 id={headingId} className="font-display text-xl font-bold text-foreground">
          {COPY.comments.title}{" "}
          <span className="numeric font-semibold text-foreground-muted">
            ({shownCount})
          </span>
        </h2>
      </div>

      {/* Región scrolleable del hilo */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6">
        {status === "loading" && <CommentsSkeleton />}

        {status === "error" && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-base font-semibold text-foreground">
              {COPY.comments.loadErrorTitle}
            </p>
            <p className="text-sm text-foreground-secondary">
              {COPY.comments.loadErrorBody}
            </p>
            <Button
              variant="secondary"
              size="sm"
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
            <p className="text-base font-semibold text-foreground">
              {COPY.comments.emptyTitle}
            </p>
            <p className="text-sm text-foreground-secondary">
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
              />
            ))}
            {optimistic.map((item) => (
              <CommentItem
                key={item.tempId}
                author={item.author}
                body={item.body}
                timeAgoLabel={item.timeAgoLabel}
                pending={item.pending}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Composer / CTA anclado abajo (keyboard-aware via BottomSheet) */}
      <div className="shrink-0 border-t border-border px-4 pb-1 pt-3">
        {viewer === null ? (
          // Anónimo: entrar y volver acá mismo (no perdemos el lugar).
          <Link
            href={`/entrar?next=${encodeURIComponent(pathname || "/feed")}`}
            className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
          >
            {COPY.comments.signInPrompt}
          </Link>
        ) : (
          <CommentComposer
            postId={postId}
            disabled={status !== "ready"}
            optimistic={optimisticHandlers}
          />
        )}
      </div>
    </div>
  );
}

/** Silueta del hilo mientras carga (§5.2: nunca un spinner suelto). */
function CommentsSkeleton() {
  return (
    <ul className="flex flex-col gap-4 py-2" aria-hidden="true">
      {[0, 1, 2, 3].map((row) => (
        <li key={row} className="flex items-start gap-2.5">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 rounded-lg bg-surface-subtle px-3.5 py-2.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-1.5 h-3 w-2/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}
