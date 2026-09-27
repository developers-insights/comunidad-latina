import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const { validarVideoDeAviso } = await import("./listing-video-server");

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTRO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const pesa = (bytes: number | null) => async () => bytes;

describe("validarVideoDeAviso", () => {
  it("sin video no hay columnas que escribir", async () => {
    const r = await validarVideoDeAviso(
      { input: null, tenantId: TENANT, userId: USER, tier: "free" },
      { medirObjeto: pesa(1) },
    );
    expect(r).toEqual({ ok: true, columns: null });
  });

  it("devuelve las tres columnas de un video corto propio", async () => {
    const r = await validarVideoDeAviso(
      {
        input: {
          path: `${TENANT}/${USER}/video-1.mp4`,
          posterPath: `${TENANT}/${USER}/poster-1.jpg`,
          durationSeconds: 42.3,
        },
        tenantId: TENANT,
        userId: USER,
        tier: "free",
      },
      { medirObjeto: pesa(10_000_000) },
    );
    expect(r).toEqual({
      ok: true,
      columns: {
        video_path: `${TENANT}/${USER}/video-1.mp4`,
        video_poster_path: `${TENANT}/${USER}/poster-1.jpg`,
        video_duration_seconds: 43,
      },
    });
  });

  it("rechaza el video de otra persona", async () => {
    const r = await validarVideoDeAviso(
      {
        input: { path: `${TENANT}/${OTRO}/video-1.mp4`, posterPath: null, durationSeconds: 20 },
        tenantId: TENANT,
        userId: USER,
        tier: "free",
      },
      { medirObjeto: pesa(1) },
    );
    expect(r.ok).toBe(false);
  });

  it("un video de 2 minutos en un aviso gratis pide premium", async () => {
    const r = await validarVideoDeAviso(
      {
        input: { path: `${TENANT}/${USER}/video-1.mp4`, posterPath: null, durationSeconds: 120 },
        tenantId: TENANT,
        userId: USER,
        tier: "free",
      },
      { medirObjeto: pesa(1) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("premium");
  });

  it("rechaza un archivo que no está en el bucket", async () => {
    const r = await validarVideoDeAviso(
      {
        input: { path: `${TENANT}/${USER}/video-1.mp4`, posterPath: null, durationSeconds: 20 },
        tenantId: TENANT,
        userId: USER,
        tier: "free",
      },
      { medirObjeto: pesa(null) },
    );
    expect(r.ok).toBe(false);
  });

  it("rechaza un archivo que pasa el peso máximo", async () => {
    const r = await validarVideoDeAviso(
      {
        input: { path: `${TENANT}/${USER}/video-1.mp4`, posterPath: null, durationSeconds: 20 },
        tenantId: TENANT,
        userId: USER,
        tier: "premium",
      },
      { medirObjeto: pesa(500 * 1024 * 1024) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("MB");
  });
});
