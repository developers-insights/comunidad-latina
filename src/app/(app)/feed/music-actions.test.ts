import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de las actions de MÚSICA EN PUBLICACIONES (0090).
 *
 * Mismo patrón que engagement-actions.test.ts: `vi.hoisted` + `vi.mock` + un
 * query builder falso, encadenable y thenable. Nunca se toca Supabase real.
 *
 * Garantías cubiertas:
 *  - Zod PRIMERO: un payload roto no llega ni a pedir el guard.
 *  - Sin sesión / tenant divergente → cero escrituras.
 *  - La pista APAGADA no se puede asociar, aunque exista.
 *  - Una publicación ajena, de otra comunidad o moderada no se puede musicalizar
 *    (el servidor lo corta antes de la RLS, para poder explicar el motivo).
 *  - El offset se guarda CORREGIDO contra la duración real: un recorte que se
 *    cae del final se acomoda en vez de rebotar.
 *  - Asociar es un UPSERT sobre `post_id`: cambiar de canción no deja dos.
 *  - El catálogo filtra `is_active` en el select, no sólo en la policy.
 *  - Sacar la música NO filtra por autor: la moderación tiene que poder retirar
 *    una pista cuya licencia se cayó.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { MUSIC_CLIP_SECONDS } from "@/lib/media/audio-track";
import {
  attachPostMusicAction,
  detachPostMusicAction,
  listMusicTracksAction,
} from "./music-actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_USER_ID = "88888888-8888-4888-8888-888888888888";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const TRACK_ID = "44444444-4444-4444-8444-444444444444";

type OpResult = { data?: unknown; error?: unknown };
type TableOps = Partial<
  Record<"insert" | "delete" | "select" | "upsert", OpResult | OpResult[]>
>;

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

function createSupabaseStub(config: Record<string, TableOps> = {}) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    const tableConfig: TableOps = config[table] ?? {};
    let op: keyof TableOps | null = null;
    const result = (): OpResult => {
      if (!op) return { error: null };
      const configured = tableConfig[op];
      if (Array.isArray(configured)) return configured.shift() ?? { error: null };
      return configured ?? { error: null };
    };

    const record = (method: keyof TableOps) =>
      vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        op = method;
        return builder;
      });

    const passthrough = (method: string) =>
      vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      insert: record("insert"),
      delete: record("delete"),
      select: record("select"),
      upsert: record("upsert"),
      eq: passthrough("eq"),
      order: passthrough("order"),
      limit: passthrough("limit"),
      maybeSingle: vi.fn(() => Promise.resolve(result())),
      then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  });

  return { client: { from }, from, calls };
}

function useGuardOk(config: Record<string, TableOps> = {}) {
  const stub = createSupabaseStub(config);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos" },
    supabase: stub.client,
    user: { id: USER_ID },
  });
  return stub;
}

function useGuardFail(reason: "unauthenticated" | "tenant-mismatch") {
  const stub = createSupabaseStub();
  mocks.requireTenantMatch.mockResolvedValue({
    ok: false,
    reason,
    message: "copy del guard",
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos" },
    supabase: stub.client,
    user: reason === "unauthenticated" ? null : { id: USER_ID },
  });
  return stub;
}

/** Pista activa de 180 s, visible para el usuario del guard. */
const ACTIVE_TRACK = { data: { id: TRACK_ID, duration_seconds: 180, is_active: true } };
/** Publicación propia, de esta comunidad y publicada. */
const OWN_POST = {
  data: { id: POST_ID, author_id: USER_ID, tenant_id: TENANT_ID, status: "published" },
};

function writes(stub: ReturnType<typeof createSupabaseStub>) {
  return stub.calls.filter((call) =>
    ["insert", "upsert", "delete"].includes(call.method),
  );
}

function upsertedRow(stub: ReturnType<typeof createSupabaseStub>) {
  return stub.calls.find((call) => call.method === "upsert")?.args[0] as
    | Record<string, unknown>
    | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/* ---------------------------- listMusicTracksAction ------------------------ */

describe("listMusicTracksAction", () => {
  it("mapea el catálogo a la vista del picker", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proyecto.supabase.co";
    const stub = useGuardOk({
      music_tracks: {
        select: {
          data: [
            {
              id: TRACK_ID,
              title: "Cumbia del barrio",
              artist: "Los del Sur",
              duration_seconds: 180,
              storage_path: "global/cumbia.mp3",
              license_kind: "cc_by",
              attribution_required: true,
              attribution_text: "«Cumbia del barrio» de Los del Sur (CC BY 4.0)",
              category: "tropical",
            },
          ],
        },
      },
    });

    return listMusicTracksAction().then((result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.tracks).toHaveLength(1);
      expect(result.tracks[0]).toMatchObject({
        id: TRACK_ID,
        title: "Cumbia del barrio",
        artist: "Los del Sur",
        durationSeconds: 180,
        licenseKind: "cc_by",
        attributionRequired: true,
      });
      expect(result.tracks[0].previewUrl).toContain(
        "/storage/v1/object/public/music-tracks/global/cumbia.mp3",
      );
      // El select dice `is_active` además de la policy: no se delega la regla.
      expect(stub.calls).toContainEqual(
        expect.objectContaining({ table: "music_tracks", method: "eq", args: ["is_active", true] }),
      );
    });
  });

  it("catálogo vacío es éxito, no error (la feature todavía no tiene licencias)", async () => {
    useGuardOk({ music_tracks: { select: { data: [] } } });
    const result = await listMusicTracksAction();
    expect(result).toEqual({ ok: true, tracks: [] });
  });

  it("una licencia desconocida se degrada a la más restrictiva", async () => {
    useGuardOk({
      music_tracks: {
        select: {
          data: [
            {
              id: TRACK_ID,
              title: "X",
              artist: "Y",
              duration_seconds: 60,
              storage_path: "global/x.mp3",
              license_kind: "vaya-uno-a-saber",
              attribution_required: true,
              attribution_text: "Y",
              category: "inventada",
            },
          ],
        },
      },
    });
    const result = await listMusicTracksAction();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tracks[0].licenseKind).toBe("licensed");
    expect(result.tracks[0].category).toBe("general");
  });

  it("sin sesión no lee nada", async () => {
    const stub = useGuardFail("unauthenticated");
    const result = await listMusicTracksAction();
    expect(result).toEqual({ ok: false, code: "unauthenticated" });
    expect(stub.from).not.toHaveBeenCalled();
  });
});

/* ---------------------------- attachPostMusicAction ------------------------ */

describe("attachPostMusicAction", () => {
  it("asocia la pista con el tenant del guard y el offset elegido", async () => {
    const stub = useGuardOk({
      music_tracks: { select: ACTIVE_TRACK },
      posts: { select: OWN_POST },
    });

    const result = await attachPostMusicAction({
      postId: POST_ID,
      trackId: TRACK_ID,
      startSeconds: 42,
    });

    expect(result).toEqual({ ok: true, startSeconds: 42 });
    expect(upsertedRow(stub)).toEqual({
      post_id: POST_ID,
      tenant_id: TENANT_ID,
      track_id: TRACK_ID,
      start_seconds: 42,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/feed");
  });

  it("es un UPSERT sobre post_id: cambiar de canción no deja dos pistas", async () => {
    const stub = useGuardOk({
      music_tracks: { select: ACTIVE_TRACK },
      posts: { select: OWN_POST },
    });

    await attachPostMusicAction({ postId: POST_ID, trackId: TRACK_ID });

    const upsert = stub.calls.find((call) => call.method === "upsert");
    expect(upsert?.table).toBe("post_music");
    expect(upsert?.args[1]).toEqual({ onConflict: "post_id" });
    expect(stub.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("un offset que se cae del final se acomoda en vez de rebotar", async () => {
    const stub = useGuardOk({
      music_tracks: { select: ACTIVE_TRACK },
      posts: { select: OWN_POST },
    });

    const result = await attachPostMusicAction({
      postId: POST_ID,
      trackId: TRACK_ID,
      startSeconds: 900,
    });

    // 180 s de pista − 30 s de recorte = último arranque posible.
    expect(result).toEqual({ ok: true, startSeconds: 180 - MUSIC_CLIP_SECONDS });
    expect(upsertedRow(stub)?.start_seconds).toBe(180 - MUSIC_CLIP_SECONDS);
  });

  it("sin offset arranca en 0", async () => {
    const stub = useGuardOk({
      music_tracks: { select: ACTIVE_TRACK },
      posts: { select: OWN_POST },
    });
    await attachPostMusicAction({ postId: POST_ID, trackId: TRACK_ID });
    expect(upsertedRow(stub)?.start_seconds).toBe(0);
  });

  it("un payload roto no llega ni a pedir el guard", async () => {
    const result = await attachPostMusicAction({ postId: "no-es-uuid", trackId: TRACK_ID });
    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("un offset negativo se rechaza en zod", async () => {
    const result = await attachPostMusicAction({
      postId: POST_ID,
      trackId: TRACK_ID,
      startSeconds: -1,
    });
    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("sin sesión no escribe nada", async () => {
    const stub = useGuardFail("unauthenticated");
    const result = await attachPostMusicAction({ postId: POST_ID, trackId: TRACK_ID });
    expect(result).toEqual({ ok: false, code: "unauthenticated" });
    expect(writes(stub)).toHaveLength(0);
  });

  it("tenant divergente devuelve el copy del guard y no escribe", async () => {
    const stub = useGuardFail("tenant-mismatch");
    const result = await attachPostMusicAction({ postId: POST_ID, trackId: TRACK_ID });
    expect(result).toEqual({
      ok: false,
      code: "tenant-mismatch",
      message: "copy del guard",
    });
    expect(writes(stub)).toHaveLength(0);
  });

  it("una pista APAGADA no se puede asociar", async () => {
    const stub = useGuardOk({
      music_tracks: {
        select: { data: { id: TRACK_ID, duration_seconds: 180, is_active: false } },
      },
      posts: { select: OWN_POST },
    });

    const result = await attachPostMusicAction({ postId: POST_ID, trackId: TRACK_ID });
    expect(result).toEqual({ ok: false, code: "track-unavailable" });
    expect(writes(stub)).toHaveLength(0);
  });

  it("una pista invisible para esta comunidad tampoco (la RLS no la devuelve)", async () => {
    const stub = useGuardOk({
      music_tracks: { select: { data: null } },
      posts: { select: OWN_POST },
    });

    const result = await attachPostMusicAction({ postId: POST_ID, trackId: TRACK_ID });
    expect(result).toEqual({ ok: false, code: "track-unavailable" });
    expect(writes(stub)).toHaveLength(0);
  });

  it("no se le puede poner música a la publicación de otra persona", async () => {
    const stub = useGuardOk({
      music_tracks: { select: ACTIVE_TRACK },
      posts: {
        select: {
          data: { id: POST_ID, author_id: OTHER_USER_ID, tenant_id: TENANT_ID, status: "published" },
        },
      },
    });

    const result = await attachPostMusicAction({ postId: POST_ID, trackId: TRACK_ID });
    expect(result).toEqual({ ok: false, code: "post-unavailable" });
    expect(writes(stub)).toHaveLength(0);
  });

  it("no se le puede poner música a una publicación de otra comunidad", async () => {
    const stub = useGuardOk({
      music_tracks: { select: ACTIVE_TRACK },
      posts: {
        select: {
          data: {
            id: POST_ID,
            author_id: USER_ID,
            tenant_id: OTHER_TENANT_ID,
            status: "published",
          },
        },
      },
    });

    const result = await attachPostMusicAction({ postId: POST_ID, trackId: TRACK_ID });
    expect(result).toEqual({ ok: false, code: "post-unavailable" });
    expect(writes(stub)).toHaveLength(0);
  });

  it("una publicación moderada (removed) no se musicaliza", async () => {
    const stub = useGuardOk({
      music_tracks: { select: ACTIVE_TRACK },
      posts: {
        select: {
          data: { id: POST_ID, author_id: USER_ID, tenant_id: TENANT_ID, status: "removed" },
        },
      },
    });

    const result = await attachPostMusicAction({ postId: POST_ID, trackId: TRACK_ID });
    expect(result).toEqual({ ok: false, code: "post-unavailable" });
    expect(writes(stub)).toHaveLength(0);
  });

  it("si la RLS rechaza el upsert, el error se ve (no se traga)", async () => {
    useGuardOk({
      music_tracks: { select: ACTIVE_TRACK },
      posts: { select: OWN_POST },
      post_music: { upsert: { error: { code: "42501" } } },
    });

    const result = await attachPostMusicAction({ postId: POST_ID, trackId: TRACK_ID });
    expect(result).toEqual({ ok: false, code: "error" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

/* ---------------------------- detachPostMusicAction ------------------------ */

describe("detachPostMusicAction", () => {
  it("borra la fila acotada por publicación", async () => {
    const stub = useGuardOk();
    const result = await detachPostMusicAction({ postId: POST_ID });

    expect(result).toEqual({ ok: true });
    expect(stub.calls).toContainEqual(
      expect.objectContaining({ table: "post_music", method: "delete" }),
    );
    expect(stub.calls).toContainEqual(
      expect.objectContaining({ table: "post_music", method: "eq", args: ["post_id", POST_ID] }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/feed");
  });

  it("no filtra por autor: la moderación tiene que poder retirar una pista", async () => {
    const stub = useGuardOk();
    await detachPostMusicAction({ postId: POST_ID });

    const filters = stub.calls.filter((call) => call.method === "eq");
    expect(filters).toHaveLength(1);
    expect(filters[0].args).toEqual(["post_id", POST_ID]);
  });

  it("un id inválido no llega al guard", async () => {
    const result = await detachPostMusicAction({ postId: "nope" });
    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("sin sesión no borra nada", async () => {
    const stub = useGuardFail("unauthenticated");
    const result = await detachPostMusicAction({ postId: POST_ID });
    expect(result).toEqual({ ok: false, code: "unauthenticated" });
    expect(writes(stub)).toHaveLength(0);
  });

  it("el error de borrado se ve", async () => {
    useGuardOk({ post_music: { delete: { error: { code: "42501" } } } });
    const result = await detachPostMusicAction({ postId: POST_ID });
    expect(result).toEqual({ ok: false, code: "error" });
  });
});
