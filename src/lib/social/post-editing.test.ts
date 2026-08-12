import { describe, expect, it } from "vitest";

import {
  POST_BODY_MAX,
  POST_EDIT_COPY,
  bodyIsPublishable,
  canDeletePost,
  canEditPost,
  postBodySchema,
  wasPostEdited,
  type PostOwnershipView,
  type PostViewer,
} from "./post-editing";

/**
 * Tests de las REGLAS de editar/eliminar una publicación propia. Nada de
 * render: lo que se protege acá es quién puede tocar qué, y esa respuesta
 * tiene que ser la misma en el servidor y en la UI.
 */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "99999999-9999-4999-8999-999999999999";
const STRANGER_ID = "88888888-8888-4888-8888-888888888888";

const viewer: PostViewer = { id: AUTHOR_ID, tenantId: TENANT_ID };

function post(overrides: Partial<PostOwnershipView> = {}): PostOwnershipView {
  return {
    authorId: AUTHOR_ID,
    tenantId: TENANT_ID,
    status: "published",
    ...overrides,
  };
}

/* --------------------------------- canEditPost ---------------------------- */

describe("canEditPost", () => {
  it("el autor edita su publicación publicada", () => {
    expect(canEditPost(post(), viewer)).toEqual({ ok: true });
  });

  it("una publicación ajena no se edita", () => {
    expect(canEditPost(post({ authorId: STRANGER_ID }), viewer)).toEqual({
      ok: false,
      reason: "not-author",
    });
  });

  it("sin autor (cuenta borrada) tampoco hay quién edite", () => {
    expect(canEditPost(post({ authorId: null }), viewer)).toEqual({
      ok: false,
      reason: "not-author",
    });
  });

  it("un post propio de OTRA comunidad no se edita desde acá", () => {
    expect(canEditPost(post({ tenantId: OTHER_TENANT }), viewer)).toEqual({
      ok: false,
      reason: "other-community",
    });
  });

  it("en revisión NO se edita — editar no puede ser la puerta de atrás de la cola", () => {
    expect(canEditPost(post({ status: "pending_review" }), viewer)).toEqual({
      ok: false,
      reason: "in-review",
    });
  });

  it("retirada por moderación NO se edita (ni se auto-resucita)", () => {
    expect(canEditPost(post({ status: "removed" }), viewer)).toEqual({
      ok: false,
      reason: "removed",
    });
  });

  it("un estado desconocido se trata como 'todavía no publicada', no como editable", () => {
    // Fail-closed: si mañana aparece otro status en la base, el default es NO.
    expect(canEditPost(post({ status: "shadow_banned" }), viewer)).toEqual({
      ok: false,
      reason: "in-review",
    });
  });

  it("la pertenencia se chequea ANTES que el estado (no se filtra moderación ajena)", () => {
    // Un tercero preguntando por un post en revisión recibe "no es tuyo", no
    // "está en revisión": el estado de moderación de otro no es asunto suyo.
    expect(
      canEditPost(post({ authorId: STRANGER_ID, status: "pending_review" }), viewer),
    ).toEqual({ ok: false, reason: "not-author" });
  });
});

/* -------------------------------- canDeletePost --------------------------- */

describe("canDeletePost", () => {
  const clean = { hasActivePromotion: false };

  it("el autor elimina lo suyo", () => {
    expect(canDeletePost(post(), viewer, clean)).toEqual({ ok: true });
  });

  it("una publicación ajena no se elimina", () => {
    expect(canDeletePost(post({ authorId: STRANGER_ID }), viewer, clean)).toEqual({
      ok: false,
      reason: "not-author",
    });
  });

  it("desde otra comunidad tampoco", () => {
    expect(canDeletePost(post({ tenantId: OTHER_TENANT }), viewer, clean)).toEqual({
      ok: false,
      reason: "other-community",
    });
  });

  it("en revisión o retirada SÍ se elimina: sigue siendo suya", () => {
    // Bajar lo propio no esquiva nada — el expediente de moderación y las
    // huellas de `content_assets` no se van con el post.
    expect(canDeletePost(post({ status: "pending_review" }), viewer, clean)).toEqual({
      ok: true,
    });
    expect(canDeletePost(post({ status: "removed" }), viewer, clean)).toEqual({ ok: true });
  });

  it("con promoción paga activa NO se elimina (la campaña cae por cascade)", () => {
    expect(canDeletePost(post(), viewer, { hasActivePromotion: true })).toEqual({
      ok: false,
      reason: "promoted",
    });
  });

  it("la promoción de un post AJENO no cambia que siga siendo ajeno", () => {
    expect(
      canDeletePost(post({ authorId: STRANGER_ID }), viewer, { hasActivePromotion: true }),
    ).toEqual({ ok: false, reason: "not-author" });
  });
});

/* ------------------------------ texto: mismas reglas ---------------------- */

describe("validación del texto (la misma que al publicar)", () => {
  it("recorta los bordes antes de medir", () => {
    expect(postBodySchema.parse("   hola vecinos   ")).toBe("hola vecinos");
  });

  it("acepta exactamente el techo de 2000 y rechaza 2001", () => {
    expect(postBodySchema.safeParse("a".repeat(POST_BODY_MAX)).success).toBe(true);
    expect(postBodySchema.safeParse("a".repeat(POST_BODY_MAX + 1)).success).toBe(false);
  });

  it("el techo se mide DESPUÉS del trim (2000 con espacios alrededor pasa)", () => {
    expect(postBodySchema.safeParse(`  ${"a".repeat(POST_BODY_MAX)}  `).success).toBe(true);
  });

  it("sin medio, el cuerpo vacío o de un carácter no se publica", () => {
    expect(bodyIsPublishable("", false)).toBe(false);
    expect(bodyIsPublishable("a", false)).toBe(false);
    expect(bodyIsPublishable("ok", false)).toBe(true);
  });

  it("con medio, el cuerpo vacío SÍ (la foto es la publicación) pero uno solo no", () => {
    expect(bodyIsPublishable("", true)).toBe(true);
    expect(bodyIsPublishable("a", true)).toBe(false);
    expect(bodyIsPublishable("ok", true)).toBe(true);
  });
});

/* -------------------------------- wasPostEdited --------------------------- */

describe("wasPostEdited", () => {
  it("recién publicada (mismo instante) no está editada", () => {
    const now = "2026-08-12T10:00:00.000Z";
    expect(wasPostEdited({ createdAt: now, updatedAt: now })).toBe(false);
  });

  it("unos milisegundos de diferencia todavía no son una edición", () => {
    expect(
      wasPostEdited({
        createdAt: "2026-08-12T10:00:00.000Z",
        updatedAt: "2026-08-12T10:00:00.400Z",
      }),
    ).toBe(false);
  });

  it("un cambio posterior sí se marca", () => {
    expect(
      wasPostEdited({
        createdAt: "2026-08-12T10:00:00.000Z",
        updatedAt: "2026-08-12T10:03:00.000Z",
      }),
    ).toBe(true);
  });

  it("acepta Date además de ISO", () => {
    expect(
      wasPostEdited({
        createdAt: new Date("2026-08-12T10:00:00.000Z"),
        updatedAt: new Date("2026-08-12T11:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("con fechas ausentes o ilegibles no acusa a nadie de editar", () => {
    expect(wasPostEdited({ createdAt: null, updatedAt: "2026-08-12T10:00:00.000Z" })).toBe(
      false,
    );
    expect(wasPostEdited({ createdAt: "ayer", updatedAt: "hoy" })).toBe(false);
    expect(wasPostEdited({ createdAt: undefined, updatedAt: undefined })).toBe(false);
  });
});

/* ----------------------------------- copy --------------------------------- */

describe("copy de eliminación", () => {
  it("enumera lo que se pierde en vez de preguntar '¿estás seguro?'", () => {
    const body = POST_EDIT_COPY.delete.dialogBody({ comments: 3, likes: 12 });
    expect(body).toContain("los 3 comentarios");
    expect(body).toContain("12 me gusta");
    expect(body).toContain("guardados");
    expect(body).toContain("No se puede deshacer");
  });

  it("usa singular cuando hay uno solo", () => {
    const body = POST_EDIT_COPY.delete.dialogBody({ comments: 1, likes: 1 });
    expect(body).toContain("el comentario que le dejaron");
    expect(body).toContain("su me gusta");
  });

  it("sin comentarios ni me gusta sigue diciendo qué se pierde y que es para siempre", () => {
    const body = POST_EDIT_COPY.delete.dialogBody({ comments: 0, likes: 0 });
    expect(body).toContain("guardados");
    expect(body).toContain("No se puede deshacer");
  });

  it("hay un mensaje legible para CADA motivo de rechazo", () => {
    for (const message of Object.values(POST_EDIT_COPY.denial)) {
      expect(message.length).toBeGreaterThan(10);
    }
  });
});
