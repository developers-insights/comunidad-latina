import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  limit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({ DAY_MS: 86_400_000, limit: mocks.limit }));

import { eliminarAvisoAction } from "./eliminar-action";
import { ELIMINAR_COPY } from "./eliminar-copy";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";

type Resultado = { data: unknown; error: unknown };

function stub(tablas: Record<string, { select?: Resultado; delete?: Resultado }>) {
  const borrados: string[] = [];
  const from = vi.fn((tabla: string) => {
    let op: "select" | "delete" = "select";
    const resultado = () => tablas[tabla]?.[op] ?? { data: [], error: null };
    const builder: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "limit", "in"]) {
      builder[metodo] = vi.fn(() => builder);
    }
    builder.delete = vi.fn(() => {
      op = "delete";
      borrados.push(tabla);
      return builder;
    });
    builder.maybeSingle = vi.fn(async () => resultado());
    builder.then = (ok: (v: Resultado) => unknown, mal: (e: unknown) => unknown) =>
      Promise.resolve(resultado()).then(ok, mal);
    return builder;
  });
  return { supabase: { from }, borrados };
}

function conSesion(supabase: unknown) {
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos" },
    user: { id: USER_ID },
    supabase,
  });
}

const FILA = { data: { id: LISTING_ID, kind: "product", status: "published" }, error: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true });
});

describe("eliminarAvisoAction", () => {
  it("sin la marca de confirmación no toca nada", async () => {
    const r = await eliminarAvisoAction({ listingId: LISTING_ID, confirmed: false as never });
    expect(r.ok).toBe(false);
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("borra un aviso propio sin pagos asociados", async () => {
    const { supabase, borrados } = stub({
      listings: { select: FILA, delete: { data: [{ id: LISTING_ID }], error: null } },
    });
    conSesion(supabase);
    const r = await eliminarAvisoAction({ listingId: LISTING_ID, confirmed: true });
    expect(r).toEqual({ ok: true });
    expect(borrados).toEqual(["listings"]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/publicaciones");
  });

  it("no borra un aviso ajeno o inexistente", async () => {
    const { supabase, borrados } = stub({ listings: { select: { data: null, error: null } } });
    conSesion(supabase);
    const r = await eliminarAvisoAction({ listingId: LISTING_ID, confirmed: true });
    expect(r.ok).toBe(false);
    expect(borrados).toEqual([]);
  });

  it("un aviso que tuvo publicidad paga no se borra: se pausa o se cierra", async () => {
    const { supabase, borrados } = stub({
      listings: { select: FILA },
      boosts: { select: { data: [{ id: "b1" }], error: null } },
    });
    conSesion(supabase);
    const r = await eliminarAvisoAction({ listingId: LISTING_ID, confirmed: true });
    expect(r).toEqual({ ok: false, error: ELIMINAR_COPY.tuvoPagos });
    expect(borrados).toEqual([]);
  });

  it("una suscripción premium también bloquea el borrado", async () => {
    const { supabase, borrados } = stub({
      listings: { select: FILA },
      listing_premiums: { select: { data: [{ id: "p1" }], error: null } },
    });
    conSesion(supabase);
    const r = await eliminarAvisoAction({ listingId: LISTING_ID, confirmed: true });
    expect(r.ok).toBe(false);
    expect(borrados).toEqual([]);
  });

  it("un negocio no se borra desde acá", async () => {
    const { supabase, borrados } = stub({
      listings: { select: { data: { ...FILA.data, kind: "business" }, error: null } },
    });
    conSesion(supabase);
    const r = await eliminarAvisoAction({ listingId: LISTING_ID, confirmed: true });
    expect(r.ok).toBe(false);
    expect(borrados).toEqual([]);
  });

  it("si no se pudo verificar los pagos, no borra", async () => {
    const { supabase, borrados } = stub({
      listings: { select: FILA },
      campaigns: { select: { data: null, error: { code: "42501" } } },
    });
    conSesion(supabase);
    const r = await eliminarAvisoAction({ listingId: LISTING_ID, confirmed: true });
    expect(r.ok).toBe(false);
    expect(borrados).toEqual([]);
  });
});
