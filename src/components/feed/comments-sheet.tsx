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
import { useReducedMotion } from "motion/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BottomSheet, Button, Skeleton } from "@/components/ui";
import { buildTrustSignals, toTrustLevel } from "@/components/listings";
import { fetchListingCommentsAction } from "@/app/(app)/marketplace/comments-actions";
import { AUTH_REASON, useRequireAuth } from "@/components/auth/auth-sheet";
import { createClient } from "@/lib/supabase/client";
import { useCloseOnBack } from "@/lib/design/use-overlay";
import type { Database } from "@/lib/types/database.types";
import { cn, timeAgo } from "@/lib/utils";
import { CommentComposer, type CommentOptimisticHandlers } from "./comment-composer";
import { CommentItem } from "./comment-item";
import { CommentMenu } from "./comment-menu";
import { COPY } from "./copy";
import { COMMENT_THREAD_COPY, type AuthorView } from "./helpers";

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

  /**
   * El "atrás" del teléfono cierra el hilo y devuelve la publicación, no la
   * pantalla (revisión de código 2026-08-20). Es la misma promesa que el resto
   * de la rama —"sin sacarte del feed"— aplicada al gesto más usado de Android:
   * sin esto, leer los comentarios y tocar atrás te sacaba de donde estabas. Y
   * apilado (publicación → comentarios → entrar) cierra de a UNA, la de arriba,
   * porque `useCloseOnBack` lleva una pila compartida de capas.
   */
  useCloseOnBack(open, closeSheet);

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

/**
 * Cuántos comentarios trae CADA tanda del hilo. Es un tamaño de PÁGINA, no un
 * techo: antes eran 200 sin cursor, o sea que el comentario 201 no existía para
 * nadie —ni para quien lo escribió—, y como el orden era ascendente lo que se
 * perdía era lo más NUEVO: justo la conversación viva. Una publicación viral
 * alcanzaba ese techo el primer día.
 */
const COMMENTS_PAGE_SIZE = 50;

/**
 * Botón sobre el VIDRIO: contorneado en tinta de media (AA de sobra sobre el
 * velo al 72%). Sobre el vidrio, el botón claro de siempre sería justo el
 * bloque blanco que el cliente pidió sacar.
 *
 * Está declarado UNA vez y no repetido en cada botón porque es el mismo
 * tratamiento — y porque `src/test/print-contract.test.ts` inventaría cuántas
 * tintas `on-*` escribe cada archivo: repetir el literal es sumar una tinta más
 * que justificar sin que haya una decisión nueva detrás.
 */
const ON_MEDIA_BUTTON =
  "border border-on-media/45 bg-transparent text-on-media hover:bg-on-media/10";

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
 * Fila del hilo → comentario pintable. Una sola función para la tanda de
 * apertura y para las de "ver anteriores": si cada una resolviera el autor por
 * su cuenta, los comentarios viejos podrían aparecer con otro nombre que los
 * nuevos del mismo autor.
 */
function toLoadedComment(
  row: ThreadRow,
  authors: Map<string, AuthorView>,
  now: Date,
): LoadedComment {
  return {
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
  };
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

/**
 * Lo que el hilo necesita saber del SUJETO además de sus comentarios (0097):
 * quién lo publicó —el autor de la publicación puede borrar comentarios de su
 * hilo— y si los comentarios están cerrados.
 */
interface SubjectState {
  authorId: string | null;
  commentsLocked: boolean;
}

/** Posición del hilo para pedir la tanda ANTERIOR (keyset, nunca OFFSET). */
interface ThreadCursor {
  createdAt: string;
  id: string;
}

/** Una tanda del hilo, ya en orden de lectura (la más vieja primero). */
interface ThreadPage {
  rows: ThreadRow[];
  /** Hay comentarios MÁS VIEJOS que los de esta tanda. */
  hasOlder: boolean;
  /**
   * Desde dónde seguir hacia atrás: la fila más vieja LEÍDA (no la más vieja
   * VISIBLE). El filtro de bloqueados corre después, y si se comiera justo esa
   * fila, un cursor tomado de lo visible saltearía comentarios.
   */
  olderCursor: ThreadCursor | null;
}

type ThreadResult =
  | {
      ok: true;
      page: ThreadPage;
      subject: SubjectState;
      /** Comunidad del post: la necesita el keyset de las tandas siguientes. */
      tenantId: string | null;
    }
  | { ok: false };

/** Sin datos del sujeto: el caso del aviso, que no tiene ninguna de las dos cosas. */
const NO_SUBJECT_STATE: SubjectState = { authorId: null, commentsLocked: false };

/**
 * UNA tanda de comentarios de un post, de la más nueva hacia atrás.
 *
 * Se LEE descendente y se ENTREGA ascendente: la lectura del hilo sigue siendo
 * la de siempre (el más viejo arriba), pero la tanda garantizada pasa a ser la
 * de la conversación viva en vez de la de los primeros 200 comentarios de la
 * historia.
 *
 * `tenant_id` va en el WHERE aunque `post_id` ya acote el hilo: es la columna
 * LÍDER de `comments_post_thread_idx (tenant_id, post_id, created_at, id)`, y
 * la policy no lo aporta como qual (lo tiene dentro de un OR, y un OR no se
 * convierte en condición de índice). Sin él el plan cae a `comments_post_fk_idx`
 * + Sort en memoria — leer y ordenar los 5.000 comentarios de un hilo para
 * devolver 50, cada vez que alguien abre la hoja. Verificado con EXPLAIN: con
 * `tenant_id` es "Index Scan Backward using comments_post_thread_idx", sin Sort.
 *
 * Va como parámetro opcional porque en el cliente el tenant no se conoce de
 * antemano (no hay provider ni env pública): sale de la fila del post. Si esa
 * lectura falla, la tanda se pide igual SIN el filtro — es una optimización de
 * plan, no una frontera de seguridad (esa la ponen la RLS y el `post_id`).
 */
async function fetchPostComments(
  supabase: Supabase,
  postId: string,
  tenantId: string | null,
  olderThan: ThreadCursor | null,
): Promise<{ ok: true; page: ThreadPage } | { ok: false }> {
  let query = supabase
    .from("comments")
    .select("id, body, created_at, author_id, status")
    .eq("post_id", postId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    // +1 para saber si hay tanda anterior sin pagar una segunda consulta.
    .limit(COMMENTS_PAGE_SIZE + 1);

  if (tenantId) query = query.eq("tenant_id", tenantId);
  if (olderThan) {
    query = query.or(
      `created_at.lt."${olderThan.createdAt}",and(created_at.eq."${olderThan.createdAt}",id.lt."${olderThan.id}")`,
    );
  }

  const { data, error } = await query;
  if (error) return { ok: false };

  const fetched = data ?? [];
  const pageRows = fetched.slice(0, COMMENTS_PAGE_SIZE);
  const oldest = pageRows[pageRows.length - 1];
  return {
    ok: true,
    page: {
      hasOlder: fetched.length > COMMENTS_PAGE_SIZE,
      olderCursor: oldest ? { createdAt: oldest.created_at, id: oldest.id } : null,
      rows: pageRows
        .map((row) => ({
          id: row.id,
          body: row.body,
          createdAt: row.created_at,
          authorId: row.author_id,
        }))
        .reverse(),
    },
  };
}

/** Hilo de un POST: lectura directa con RLS (camino histórico, ahora paginado). */
async function loadPostThread(supabase: Supabase, postId: string): Promise<ThreadResult> {
  // El estado del post va PRIMERO y solo, no ya en paralelo con el hilo: de acá
  // sale el `tenant_id` que la tanda necesita para entrar por el índice del
  // hilo. Es una fila por su clave primaria — un salto barato a cambio de dejar
  // de ordenar el hilo entero en memoria en cada apertura.
  //
  // `comments_locked_at` llega con la 0097 y todavía no está en
  // database.types.ts → cliente de schema abierto, igual que `saves`.
  const postResult = await (supabase as unknown as SupabaseClient)
    .from("posts")
    .select("tenant_id, author_id, comments_locked_at")
    .eq("id", postId)
    .maybeSingle();

  // Que no se pueda leer el estado del post NO tira abajo el hilo: se cae al
  // caso conservador (sin menú de borrar, con el campo de escribir abierto) y
  // la policy `comments_insert` sigue siendo la que decide de verdad.
  const postRow = postResult.data as
    | { tenant_id: string | null; author_id: string | null; comments_locked_at: string | null }
    | null;
  if (postResult.error) {
    console.warn("[feed] estado del post para el hilo no disponible", {
      code: postResult.error.code,
    });
  }

  const tenantId = postRow?.tenant_id ?? null;
  const comments = await fetchPostComments(supabase, postId, tenantId, null);
  if (!comments.ok) return { ok: false };

  return {
    ok: true,
    page: comments.page,
    tenantId,
    subject: {
      authorId: postRow?.author_id ?? null,
      commentsLocked: Boolean(postRow?.comments_locked_at),
    },
  };
}

/** Hilo de un AVISO: server action del marketplace (dueña de esa tabla). */
async function loadListingThread(listingId: string): Promise<ThreadResult> {
  const result = await fetchListingCommentsAction({ listingId });
  if (!result.ok) return { ok: false };
  return {
    ok: true,
    // El aviso trae su hilo entero desde la action (otra tabla, otro dueño): no
    // hay tanda anterior que pedir desde acá. Si `listing_comments` crece hasta
    // necesitarlo, el cursor tiene que nacer en esa action, no en esta hoja.
    tenantId: null,
    page: {
      hasOlder: false,
      olderCursor: null,
      rows: result.items.map((item) => ({
        id: item.id,
        body: item.body,
        createdAt: item.createdAt,
        authorId: item.authorId,
        fallbackName: item.authorName,
        fallbackAvatarUrl: item.avatarUrl,
      })),
    },
    // Los avisos no tienen ninguna de las dos cosas de la 0097: el borrado de
    // `listing_comments` y su cierre son otra tabla y otra decisión.
    subject: NO_SUBJECT_STATE,
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
  const reduceMotion = useReducedMotion();
  const headingId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Sobre video/foto/banner todo se pinta con la tinta de media (claro sobre
  // el vidrio oscuro); sobre el feed, con los tokens de tema de siempre.
  const onMedia = isGlassSurface(surface);

  const requireAuth = useRequireAuth();
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [comments, setComments] = useState<LoadedComment[]>([]);
  const [optimistic, setOptimistic] = useState<OptimisticComment[]>([]);
  /**
   * Quién publicó y si el hilo está cerrado (0097). Se llama `subjectState` y
   * no `subject` porque ese nombre ya lo ocupa el prop que dice SOBRE QUÉ se
   * abrió la hoja; son dos cosas distintas y confundirlas sería fácil.
   */
  const [subjectState, setSubjectState] = useState<SubjectState>(NO_SUBJECT_STATE);
  /**
   * Desde dónde pedir la tanda ANTERIOR. `null` = no hay más hacia atrás (o el
   * hilo todavía no cargó), y por eso es lo mismo que decide si se ofrece el
   * botón: nunca se muestra un "ver anteriores" que no vaya a traer nada.
   */
  const [olderCursor, setOlderCursor] = useState<ThreadCursor | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** Comunidad del post — la necesita el keyset de las tandas siguientes. */
  const [tenantId, setTenantId] = useState<string | null>(null);
  /**
   * Bloqueos del viewer, guardados para poder filtrar TAMBIÉN las tandas que
   * lleguen después. Sin esto, "ver anteriores" era la puerta de atrás por la
   * que reaparecía la persona bloqueada.
   */
  const blockedRef = useRef<ReadonlySet<string>>(new Set());
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
    blockedRef.current = blocked;
    // Mismo filtro que el detalle: fuera los comentarios de gente que el viewer
    // bloqueó (barato, en memoria).
    const rows = thread.page.rows.filter(
      (row) => !row.authorId || !blocked.has(row.authorId),
    );

    const viewerId = userResult.data.user?.id ?? null;
    const authorIds = [...rows.map((row) => row.authorId), viewerId].filter(
      (id): id is string => Boolean(id),
    );
    const authors = await fetchAuthorViewsClient(supabase, authorIds);

    setComments(rows.map((row) => toLoadedComment(row, authors, now)));
    setTenantId(thread.tenantId);
    setOlderCursor(thread.page.hasOlder ? thread.page.olderCursor : null);
    setSubjectState(thread.subject);
    setViewer(
      viewerId ? { id: viewerId, author: authorViewOf(authors, viewerId) } : null,
    );
    setStatus("ready");
  }, [subject]);

  /**
   * Trae la tanda ANTERIOR y la pega ARRIBA de lo que ya se está leyendo.
   *
   * Conserva la posición de lectura: se mide la distancia al fondo antes de
   * insertar y se restaura después. Sin eso, meter 50 comentarios encima
   * teletransporta a quien estaba leyendo — que es exactamente lo que esta hoja
   * nació para evitar ("después de comentar no debería salirme del feed").
   */
  const loadOlder = useCallback(async () => {
    if (subject.kind !== "post" || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    const supabase = createClient();
    const now = new Date();
    const result = await fetchPostComments(supabase, subject.id, tenantId, olderCursor);
    if (!result.ok) {
      // La tanda anterior no se pudo traer: el hilo que ya está en pantalla NO
      // se toca (sería castigar al que sólo quiso leer más atrás). El botón
      // vuelve a quedar disponible para reintentar.
      setLoadingOlder(false);
      return;
    }

    const rows = result.page.rows.filter(
      (row) => !row.authorId || !blockedRef.current.has(row.authorId),
    );
    const authors = await fetchAuthorViewsClient(
      supabase,
      rows.map((row) => row.authorId).filter((id): id is string => Boolean(id)),
    );

    const node = scrollRef.current;
    const anchor = node ? node.scrollHeight - node.scrollTop : null;

    setComments((prev) => [
      ...rows.map((row) => toLoadedComment(row, authors, now)),
      ...prev,
    ]);
    setOlderCursor(result.page.hasOlder ? result.page.olderCursor : null);
    setLoadingOlder(false);

    if (node && anchor !== null && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        node.scrollTop = node.scrollHeight - anchor;
      });
    }
  }, [subject, olderCursor, loadingOlder, tenantId]);

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
              className={cn(onMedia && ON_MEDIA_BUTTON)}
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

        {/* Tanda ANTERIOR. Va arriba del hilo porque hacia arriba es hacia el
            pasado: el orden de lectura es ascendente. Sólo aparece cuando hay
            algo real que traer (olderCursor). */}
        {status === "ready" && olderCursor && (
          <div className="flex justify-center pt-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={loadingOlder}
              className={cn(onMedia && ON_MEDIA_BUTTON)}
              onClick={() => void loadOlder()}
            >
              {COMMENT_THREAD_COPY.older}
            </Button>
          </div>
        )}

        {status === "ready" && visibleCount > 0 && (
          <ul className="flex flex-col gap-4 py-2">
            {comments.map((comment) => {
              // Borran su autor y quien publicó (0097). Acá sólo se decide qué
              // OFRECER: el permiso lo tiene la policy `comments_delete`.
              const isOwnComment = Boolean(
                viewer && comment.author.profileId === viewer.id,
              );
              const canDelete =
                subject.kind === "post" &&
                Boolean(viewer) &&
                (isOwnComment || subjectState.authorId === viewer?.id);
              return (
                <CommentItem
                  key={comment.id}
                  author={comment.author}
                  body={comment.body}
                  timeAgoLabel={comment.timeAgoLabel}
                  tone={onMedia ? "media" : "surface"}
                  menu={
                    canDelete ? (
                      <CommentMenu
                        commentId={comment.id}
                        authorName={comment.author.displayName}
                        isOwnComment={isOwnComment}
                        tone={onMedia ? "media" : "surface"}
                        // La hoja NO se cierra ni se recarga: el comentario sale
                        // de la lista en memoria y el hilo se queda donde
                        // estaba. Recargarlo devolvería a la persona al
                        // principio del hilo, que es justo lo que el cliente
                        // pidió evitar cuando se creó esta hoja.
                        onDeleted={() =>
                          setComments((prev) =>
                            prev.filter((item) => item.id !== comment.id),
                          )
                        }
                      />
                    ) : undefined
                  }
                />
              );
            })}
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
        {subjectState.commentsLocked ? (
          // Comentarios cerrados por quien publicó (0097). Se dice en el lugar
          // del campo de escribir: dejarlo vacío se lee como que la hoja se
          // rompió. El candado real lo pone la policy `comments_insert`.
          <p
            className={cn(
              "px-1 py-2 text-center text-sm",
              onMedia ? "text-on-media" : "text-foreground-secondary",
            )}
          >
            {COPY.postMenu.commentsClosedNotice}
          </p>
        ) : viewer === null ? (
          // Anónimo: la sesión se pide EN LA MISMA PANTALLA (cliente 2026-08-20).
          //
          // Acá vivía un `<Link href="/entrar?next=…">`, y de todas las salidas
          // del feed era la más cruel: alguien toca "comentar", la hoja se abre
          // con la promesa de que se responde ahí, y lo único que hay adentro
          // es un botón que lo saca de la app. Vuelve —si vuelve— a otra
          // pantalla, con el hilo cerrado y el scroll perdido. Es textualmente
          // lo que reportó el cliente: "cuando querés comentar una publicación
          // no te tiene que mover a otra publicación; ahí nomás dentro de
          // pantalla se tiene que fluir sin sacarte del feed".
          //
          // Ahora abre la hoja de autenticación POR ENCIMA de ésta (el
          // AuthSheetProvider se monta más afuera que todo el resto de los
          // overlays justamente para eso, ver `app/(app)/layout.tsx`) y, al
          // volver con sesión, sólo se recarga el hilo: esta hoja nunca se
          // cerró, así que quien acaba de entrar sigue mirando la publicación
          // que quería responder, con el campo ya listo.
          <Button
            variant="outline"
            size="md"
            className={cn("w-full", onMedia && ON_MEDIA_BUTTON)}
            onClick={() =>
              requireAuth({
                reason: AUTH_REASON.comment,
                onAuthenticated: () => {
                  setStatus("loading");
                  void load();
                },
              })
            }
          >
            {COPY.comments.signInPrompt}
          </Button>
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
