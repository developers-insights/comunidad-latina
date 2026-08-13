import { describe, expect, it } from "vitest";
import {
  canManagePost,
  canRemovePostMedia,
  postMenuDenialOf,
} from "./post-menu";

/**
 * Reglas puras del menú ⋯ de una publicación (0097). Sin base, sin sesión: se
 * decide con datos ya leídos.
 *
 * Estas reglas NO son la seguridad —eso lo deciden la server action, las
 * funciones de la 0097 y la RLS—, pero sí son lo que evita ofrecer un botón que
 * va a rebotar. Si divergen de la base, la app miente en pantalla.
 */

const TENANT = "tenant-1";
const OTHER_TENANT = "tenant-2";
const ME = "yo";
const OTHER = "otra-persona";

const viewer = { id: ME, tenantId: TENANT };

describe("canManagePost", () => {
  it("mi publicación publicada, en mi comunidad: sí", () => {
    expect(
      canManagePost({ authorId: ME, tenantId: TENANT, status: "published" }, viewer),
    ).toEqual({ ok: true });
  });

  it("publicación de otra persona: no disponible", () => {
    expect(
      canManagePost({ authorId: OTHER, tenantId: TENANT, status: "published" }, viewer),
    ).toEqual({ ok: false, reason: "no-disponible" });
  });

  it("autor eliminado (author_id null): no disponible", () => {
    expect(
      canManagePost({ authorId: null, tenantId: TENANT, status: "published" }, viewer),
    ).toEqual({ ok: false, reason: "no-disponible" });
  });

  it("mi publicación pero de otra comunidad: no disponible", () => {
    expect(
      canManagePost({ authorId: ME, tenantId: OTHER_TENANT, status: "published" }, viewer),
    ).toEqual({ ok: false, reason: "no-disponible" });
  });

  it("en revisión: no publicada", () => {
    expect(
      canManagePost({ authorId: ME, tenantId: TENANT, status: "pending_review" }, viewer),
    ).toEqual({ ok: false, reason: "no-publicada" });
  });

  it("retirada por moderación: no publicada", () => {
    expect(
      canManagePost({ authorId: ME, tenantId: TENANT, status: "removed" }, viewer),
    ).toEqual({ ok: false, reason: "no-publicada" });
  });

  it("la pertenencia se chequea ANTES que el estado: un post ajeno en revisión no filtra en qué estado está", () => {
    expect(
      canManagePost(
        { authorId: OTHER, tenantId: TENANT, status: "pending_review" },
        viewer,
      ),
    ).toEqual({ ok: false, reason: "no-disponible" });
  });

  it("una publicación OCULTA sigue siendo administrable (si no, ocultar sería de ida)", () => {
    // Ocultar no cambia el `status`: la publicación sigue `published`.
    expect(
      canManagePost({ authorId: ME, tenantId: TENANT, status: "published" }, viewer),
    ).toEqual({ ok: true });
  });
});

describe("canRemovePostMedia", () => {
  const dos = ["a.jpg", "b.jpg"];

  it("una foto de un carrusel: sí", () => {
    expect(canRemovePostMedia({ media: dos, path: "a.jpg", isVideo: false })).toEqual({
      ok: true,
    });
  });

  it("una foto que ya no está en la publicación", () => {
    expect(canRemovePostMedia({ media: dos, path: "c.jpg", isVideo: false })).toEqual({
      ok: false,
      reason: "no-esta",
    });
  });

  it("un video no se quita (dejaría colgadas las columnas que lo describen)", () => {
    expect(
      canRemovePostMedia({ media: ["a.jpg", "clip.mp4"], path: "clip.mp4", isVideo: true }),
    ).toEqual({ ok: false, reason: "es-video" });
  });

  it("la única foto no se quita: la publicación quedaría vacía", () => {
    expect(canRemovePostMedia({ media: ["a.jpg"], path: "a.jpg", isVideo: false })).toEqual({
      ok: false,
      reason: "es-la-unica",
    });
  });

  it("no estar en la publicación gana sobre ser la única: el motivo es el que la persona puede entender", () => {
    expect(
      canRemovePostMedia({ media: ["a.jpg"], path: "otra.jpg", isVideo: false }),
    ).toEqual({ ok: false, reason: "no-esta" });
  });
});

describe("postMenuDenialOf", () => {
  it("ok", () => {
    expect(postMenuDenialOf("ok")).toEqual({ ok: true });
  });

  it("sin_sesion tiene su propia salida (entrar, no esperar)", () => {
    expect(postMenuDenialOf("sin_sesion")).toEqual({
      ok: false,
      kind: "unauthenticated",
    });
  });

  it.each([
    ["no_disponible", "no-disponible"],
    ["esta_oculta", "esta-oculta"],
    ["no_esta", "no-esta"],
    ["es_video", "es-video"],
    ["es_la_unica", "es-la-unica"],
  ])("traduce %s", (code, reason) => {
    expect(postMenuDenialOf(code)).toEqual({ ok: false, kind: "denial", reason });
  });

  it("un código que no conocemos NO se lee como éxito", () => {
    expect(postMenuDenialOf("motivo_del_futuro")).toEqual({ ok: false, kind: "error" });
  });

  it("sin respuesta de la base tampoco", () => {
    expect(postMenuDenialOf(null)).toEqual({ ok: false, kind: "error" });
    expect(postMenuDenialOf(undefined)).toEqual({ ok: false, kind: "error" });
  });
});
