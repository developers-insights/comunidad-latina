import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * AVISOS DE ME GUSTA Y COMENTARIOS
 * =============================================================================
 *
 * Desde la 0070, las cuatro reglas anti-ruido viven SÓLO en
 * `public.emit_social_notification` y la app no las reimplementa. Igual que con
 * el escaneo de integridad, eso parte la prueba en dos:
 *
 *   1. LA DELEGACIÓN (mocks) — que el aviso llegue a la función con los
 *      argumentos correctos, que el texto se arme bien, y que nada de esto
 *      pueda romper el me gusta o el comentario que ya quedaron guardados.
 *   2. EL CONTRATO CON LA BASE (leyendo la 0068) — que las cuatro reglas sigan
 *      escritas donde ahora viven. La que más importa: NO TE NOTIFICÁS A VOS
 *      MISMO. Un producto que te avisa que te gustó tu propia foto se lee como
 *      un bug incluso para quien no sabe que lo es.
 *
 * El auto-chequeo se prueba en los DOS lados a propósito: la app corta antes de
 * tocar la red (tres viajes ahorrados) y la base lo garantiza igual.
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { notifyPostComment, notifyPostReaction } from "./social-notifications";

const TENANT = "11111111-1111-4111-8111-111111111111";
const AUTHOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const POST = "33333333-3333-4333-8333-333333333333";

/** Stub del admin client con lo justo que tocan estos avisos. */
function createAdminStub(
  options: { actorName?: string | null; rpcError?: unknown } = {},
) {
  const { actorName = "María", rpcError = null } = options;

  const from = vi.fn((table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      maybeSingle: async () => {
        if (table === "profiles") return { data: { display_name: actorName }, error: null };
        if (table === "posts") {
          return { data: { like_count: 4, comment_count: 2 }, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    for (const method of ["select", "eq", "in", "limit", "order"]) {
      builder[method] = vi.fn(() => builder);
    }
    return builder;
  });

  // La función decide sola si emite: devolver `null` es su forma de decir
  // "no correspondía" (bloqueo, preferencia apagada). No es un error.
  const rpc = vi.fn(async () => ({ data: null, error: rpcError }));

  return { client: { from, rpc }, from, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/* ========================================================================== */
/* 1. DELEGACIÓN                                                              */
/* ========================================================================== */

describe("UN ME GUSTA PROPIO NO GENERA NOTIFICACIÓN", () => {
  it("corta antes de tocar la red: ni admin client ni RPC", async () => {
    await notifyPostReaction({
      tenantId: TENANT,
      postId: POST,
      authorId: AUTHOR,
      // La misma persona: se dio me gusta a su propia publicación.
      actorId: AUTHOR,
    });

    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("lo mismo para un comentario en la propia publicación", async () => {
    await notifyPostComment({
      tenantId: TENANT,
      postId: POST,
      authorId: AUTHOR,
      actorId: AUTHOR,
      body: "me respondo solo",
    });

    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("me gusta de otra persona", () => {
  it("llama a emit_social_notification con los nueve parámetros del contrato", async () => {
    const stub = createAdminStub();
    mocks.createAdminClient.mockReturnValue(stub.client);

    await notifyPostReaction({
      tenantId: TENANT,
      postId: POST,
      authorId: AUTHOR,
      actorId: ACTOR,
    });

    expect(stub.rpc).toHaveBeenCalledTimes(1);
    expect(stub.rpc).toHaveBeenCalledWith("emit_social_notification", {
      p_tenant: TENANT,
      p_recipient: AUTHOR,
      p_actor: ACTOR,
      p_kind: "reaction",
      p_subject_kind: "post",
      p_subject_id: POST,
      // El "y N personas más" sale del contador real del post (like_count = 4).
      p_title: "A María y 3 personas más les gustó tu publicación",
      p_body: null,
      p_href: `/feed/${POST}`,
    });
  });

  it("la app NO reimplementa bloqueos ni preferencias: no consulta esas tablas", async () => {
    const stub = createAdminStub();
    mocks.createAdminClient.mockReturnValue(stub.client);

    await notifyPostReaction({
      tenantId: TENANT,
      postId: POST,
      authorId: AUTHOR,
      actorId: ACTOR,
    });

    const tables = stub.from.mock.calls.map(([table]) => table);
    expect(tables).not.toContain("user_blocks");
    expect(tables).not.toContain("notification_prefs");
    expect(tables).not.toContain("notifications");
    // Sólo lo que la base no puede armar sola: el nombre y el contador.
    expect(new Set(tables)).toEqual(new Set(["profiles", "posts"]));
  });

  it("sin nombre para mostrar no inventa un 'Alguien': no avisa", async () => {
    const stub = createAdminStub({ actorName: null });
    mocks.createAdminClient.mockReturnValue(stub.client);

    await notifyPostReaction({
      tenantId: TENANT,
      postId: POST,
      authorId: AUTHOR,
      actorId: ACTOR,
    });

    expect(stub.rpc).not.toHaveBeenCalled();
  });
});

describe("comentario de otra persona", () => {
  it("lleva el arranque del comentario como cuerpo", async () => {
    const stub = createAdminStub();
    mocks.createAdminClient.mockReturnValue(stub.client);

    await notifyPostComment({
      tenantId: TENANT,
      postId: POST,
      authorId: AUTHOR,
      actorId: ACTOR,
      body: "  Qué bueno esto, ¿dónde queda?  ",
    });

    expect(stub.rpc).toHaveBeenCalledWith(
      "emit_social_notification",
      expect.objectContaining({
        p_kind: "comment",
        p_subject_kind: "post",
        p_subject_id: POST,
        p_body: "Qué bueno esto, ¿dónde queda?",
      }),
    );
  });
});

describe("best-effort absoluto", () => {
  it("si el admin client no está configurado, no lanza", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("service role ausente");
    });

    await expect(
      notifyPostReaction({ tenantId: TENANT, postId: POST, authorId: AUTHOR, actorId: ACTOR }),
    ).resolves.toBeUndefined();
  });

  it("si la RPC devuelve error, tampoco lanza: el me gusta ya quedó guardado", async () => {
    const stub = createAdminStub({ rpcError: { code: "42883", message: "sin función" } });
    mocks.createAdminClient.mockReturnValue(stub.client);

    await expect(
      notifyPostReaction({ tenantId: TENANT, postId: POST, authorId: AUTHOR, actorId: ACTOR }),
    ).resolves.toBeUndefined();
  });
});

/* ========================================================================== */
/* 2. CONTRATO CON LA BASE                                                    */
/* ========================================================================== */

const MIGRATION_0068 = readFileSync(
  fileURLToPath(
    new URL("../../../../supabase/migrations/0068_notificaciones_sociales.sql", import.meta.url),
  ),
  "utf8",
);

const MIGRATION_0070 = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../supabase/migrations/0070_envoltorios_public_para_la_app.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("contrato con la base — las cuatro reglas anti-ruido", () => {
  it("1. no te notificás a vos mismo", () => {
    expect(MIGRATION_0068).toContain("if p_recipient is null or p_recipient = p_actor then");
  });

  it("2. nada entre personas que se bloquearon, en las dos direcciones", () => {
    expect(MIGRATION_0068).toContain("app.pair_blocked(p_recipient, p_actor)");
  });

  it("3. se respetan las preferencias, y la AUSENCIA de fila es 'todo prendido'", () => {
    expect(MIGRATION_0068).toContain("where profile_id = p_recipient and category = 'social'");
    // El corte sólo ocurre si HAY fila y dice que no: `if found and (...)`.
    expect(MIGRATION_0068).toContain("if found and (v_pref.in_app = false");
  });

  it("4. se agrupa por group_key actualizando la fila viva, sin ON CONFLICT", () => {
    expect(MIGRATION_0068).toContain(
      "v_group := p_kind || ':' || p_subject_kind || ':' || p_subject_id::text;",
    );
    expect(MIGRATION_0068).toContain("update public.notifications");
    expect(MIGRATION_0068).toContain("and read_at      is null");
    expect(MIGRATION_0068).not.toContain("on conflict");
  });
});

describe("contrato con la base — nadie puede fabricar avisos ajenos", () => {
  it("EXECUTE de emit_social_notification es sólo para service_role", () => {
    expect(MIGRATION_0070).toContain(
      "to service_role;",
    );
    expect(MIGRATION_0070).toMatch(
      /revoke all on function public\.emit_social_notification[\s\S]*?from authenticated;/,
    );
    expect(MIGRATION_0070).toMatch(
      /revoke all on function public\.emit_social_notification[\s\S]*?from anon;/,
    );
  });
});
