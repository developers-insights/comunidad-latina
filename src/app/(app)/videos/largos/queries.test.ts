import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SHORT_VIDEO_MAX_SECONDS } from "@/lib/media/video-policy";
import {
  LONG_VIDEO_FILTER,
  canPlayAsLongVideo,
  fetchLongVideoById,
  fetchLongVideosPage,
} from "./queries";

/**
 * LO QUE SOSTIENE LA SECCIÓN DE VIDEOS LARGOS.
 *
 * La promesa de `/videos/largos` es de una sola línea —"acá los videos duran"—
 * y hay dos formas de romperla, las dos silenciosas:
 *
 *  1. que se cuele un CORTO en la lista, y la sección se vuelva otro feed;
 *  2. que `/videos/largos/<id-de-un-corto>` abra igual, y el botón "Ver video
 *     completo" empiece a llevar a pantallas que no cumplen lo que prometen.
 *
 * Estos tests fijan las dos, más el filtro de la base que las hace baratas.
 */

interface RecordedCall {
  method: string;
  args: unknown[];
}

/**
 * Cliente falso: un builder por tabla que anota cómo se armó cada query.
 * Adaptado del stub de `videos/queries.test.ts`, con una diferencia: acá
 * `maybeSingle()` devuelve UNA fila (la que usa `fetchLongVideoById`) y no el
 * mismo array que consumen las lecturas de lista.
 */
function createStub(options: {
  rows?: unknown[];
  single?: unknown;
} = {}) {
  const calls: Record<string, RecordedCall[]> = {};
  const builderFor = (table: string) => {
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        (calls[table] ??= []).push({ method, args });
        return builder;
      };
    const result = { data: table === "posts" ? (options.rows ?? []) : [], error: null };
    const builder = {
      select: record("select"),
      eq: record("eq"),
      gt: record("gt"),
      in: record("in"),
      or: record("or"),
      order: record("order"),
      limit: record("limit"),
      maybeSingle: async () => ({ data: options.single ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return builder;
  };
  const from = vi.fn((table: string) => builderFor(table));
  return {
    client: { from } as unknown as SupabaseClient<never>,
    from,
    argsOf: (table: string, method: string) =>
      (calls[table] ?? []).filter((c) => c.method === method).map((c) => c.args),
  };
}

/** Fila mínima de post con video, para variarle sólo lo que se está probando. */
function postRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    body: "Recorrida por la casa",
    kind: "post",
    media: ["tenant/post/clip.mp4"],
    status: "published",
    like_count: 0,
    comment_count: 0,
    view_count: 0,
    created_at: "2026-09-01T10:00:00.000Z",
    author_id: "22222222-2222-4222-8222-222222222222",
    entity_listing_id: null,
    video_type: "advertising_video",
    duration_seconds: 300,
    is_paid_ad: true,
    eligible_for_short_feed: false,
    video_category: "propiedades",
    video_poster_path: null,
    pinned_at: null,
    hidden_at: null,
    comments_locked_at: null,
    mux_status: null,
    mux_playback_id: null,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function fetchPage(stub: ReturnType<typeof createStub>) {
  return fetchLongVideosPage({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: stub.client as any,
    tenantId: "tenant-1",
    viewerId: null,
    cursor: null,
  });
}

describe("fetchLongVideosPage — la lista es sólo de videos largos", () => {
  it("le pide a la base los largos: publicitarios o de más de 90 s", async () => {
    const stub = createStub();

    await fetchPage(stub);

    expect(stub.argsOf("posts", "or").map(([filtro]) => filtro)).toContainEqual(
      LONG_VIDEO_FILTER,
    );
    // El número sale de la política, no está escrito a mano en la consulta.
    expect(LONG_VIDEO_FILTER).toContain(`duration_seconds.gt.${SHORT_VIDEO_MAX_SECONDS}`);
    expect(LONG_VIDEO_FILTER).toContain("video_type.eq.advertising_video");
  });

  it("acota al tenant y a lo publicado, y saca lo que su autor ocultó", async () => {
    const stub = createStub();

    await fetchPage(stub);

    const eqArgs = stub.argsOf("posts", "eq");
    expect(eqArgs).toContainEqual(["tenant_id", "tenant-1"]);
    expect(eqArgs).toContainEqual(["status", "published"]);
    expect(stub.argsOf("posts", "or").map(([filtro]) => filtro)).toContainEqual(
      "hidden_at.is.null",
    );
  });

  it("no trae videos que todavía no se pueden reproducir (Mux en curso o fallado)", async () => {
    const stub = createStub();

    await fetchPage(stub);

    expect(stub.argsOf("posts", "or").map(([filtro]) => filtro)).toContainEqual(
      "mux_status.is.null,mux_status.eq.ready",
    );
  });

  it("un corto que igual llegara desde la base NO entra a la lista", async () => {
    // Segunda llave: la consulta ya filtra, pero una fila que llegue por otro
    // camino no puede convertir la sección en un feed de cortos.
    const stub = createStub({
      rows: [
        postRow({
          id: "33333333-3333-4333-8333-333333333333",
          video_type: "short_video",
          duration_seconds: 45,
          is_paid_ad: false,
          eligible_for_short_feed: true,
        }),
        postRow(),
      ],
    });

    const page = await fetchPage(stub);

    expect(page.items.map((item) => item.id)).toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("el video que se está mirando no se repite en 'Más videos largos'", async () => {
    const stub = createStub({ rows: [postRow()] });

    const page = await fetchLongVideosPage({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: stub.client as any,
      tenantId: "tenant-1",
      viewerId: null,
      cursor: null,
      excludeId: "11111111-1111-4111-8111-111111111111",
    });

    expect(page.items).toEqual([]);
  });
});

describe("fetchLongVideoById — 404 para lo que no es un video largo", () => {
  it("devuelve el video cuando de verdad es largo", async () => {
    const stub = createStub({ single: postRow() });

    const post = await fetchLongVideoById({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: stub.client as any,
      tenantId: "tenant-1",
      viewerId: null,
      postId: "11111111-1111-4111-8111-111111111111",
    });

    expect(post?.id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("null para un CORTO — la sección de los 5 minutos no lo abre", async () => {
    const stub = createStub({
      single: postRow({
        video_type: "short_video",
        duration_seconds: 45,
        is_paid_ad: false,
        eligible_for_short_feed: true,
      }),
    });

    const post = await fetchLongVideoById({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: stub.client as any,
      tenantId: "tenant-1",
      viewerId: null,
      postId: "11111111-1111-4111-8111-111111111111",
    });

    expect(post).toBeNull();
  });

  it("null cuando la publicación no existe (o la RLS no la deja ver)", async () => {
    const stub = createStub({ single: null });

    const post = await fetchLongVideoById({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: stub.client as any,
      tenantId: "tenant-1",
      viewerId: null,
      postId: "11111111-1111-4111-8111-111111111111",
    });

    expect(post).toBeNull();
  });
});

describe("canPlayAsLongVideo", () => {
  it("exige que HOY haya algo reproducible, no sólo que la fila diga ser larga", () => {
    // Un video de Mux todavía procesándose: la fila ya es larga, pero abrir el
    // reproductor para decir "esperá un rato" no cumple lo que promete el botón.
    expect(
      canPlayAsLongVideo(postRow({ media: [], mux_status: "processing" })),
    ).toBe(false);
    expect(canPlayAsLongVideo(postRow({ media: [], mux_status: "ready" }))).toBe(true);
  });

  it("no abre lo despublicado ni lo que su autor ocultó", () => {
    expect(canPlayAsLongVideo(postRow({ status: "pending" }))).toBe(false);
    expect(
      canPlayAsLongVideo(postRow({ hidden_at: "2026-09-02T10:00:00.000Z" })),
    ).toBe(false);
  });
});
