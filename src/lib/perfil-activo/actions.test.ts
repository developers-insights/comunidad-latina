import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * CAMBIAR DE PERFIL — la autorización, del lado del servidor
 * =============================================================================
 *
 * Lo que se prueba: que pedir "quiero actuar como este negocio" con un id que
 * no está entre las membresías vigentes NO ESCRIBE NADA. La policy de la 0103
 * lo rechazaría igual —el WITH CHECK exige `app.business_role(...)`—, pero la
 * action tiene que cortar antes para devolver una frase en español, y sobre
 * todo para no depender de que la policy siga ahí mañana.
 *
 * Y que el `tenant_id` que se escribe sale del guard (JWT + host), nunca de un
 * dato del cliente.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  listarIdentidadesDeNegocio: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("./identidad", () => ({
  listarIdentidadesDeNegocio: mocks.listarIdentidadesDeNegocio,
}));

import { cambiarIdentidad } from "./actions";

const USUARIO = "019fa477-58e6-7ab9-ae4f-cc41716f6420";
const PANADERIA = "019fa477-58e6-7ab9-ae4f-cc41716f6421";
const NEGOCIO_AJENO = "019fa477-58e6-7ab9-ae4f-cc41716f64ff";
const TENANT = "019fa477-58e6-7ab9-ae4f-cc41716f6400";

function supabaseFalso() {
  const upsert = vi.fn(async () => ({ error: null }));
  const eq = vi.fn(async () => ({ error: null }));
  const del = vi.fn(() => ({ eq }));
  return {
    upsert,
    eq,
    delete: del,
    from: vi.fn(() => ({ upsert, delete: del })),
  };
}

function montar(options: { miembroDe?: string[]; autenticado?: boolean } = {}) {
  const supabase = supabaseFalso();

  if (options.autenticado === false) {
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      message: "Entrá a tu cuenta.",
      supabase,
      user: null,
      tenant: { id: TENANT, slug: "comunidadlatina" },
    });
  } else {
    mocks.requireTenantMatch.mockResolvedValue({
      ok: true,
      supabase,
      user: { id: USUARIO },
      tenant: { id: TENANT, slug: "comunidadlatina" },
    });
  }

  mocks.listarIdentidadesDeNegocio.mockResolvedValue(
    (options.miembroDe ?? []).map((businessId) => ({
      businessId,
      nombre: "Panadería La Esperanza",
      categoria: null,
      listingId: null,
      rol: "propietario",
      esPropietario: true,
    })),
  );

  return supabase;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("cambiarIdentidad", () => {
  it("NO se puede actuar como un negocio del que no sos miembro: no escribe nada", async () => {
    const supabase = montar({ miembroDe: [PANADERIA] });

    const resultado = await cambiarIdentidad({ businessId: NEGOCIO_AJENO });

    expect(resultado.ok).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.upsert).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("sin ninguna membresía, ningún id funciona", async () => {
    const supabase = montar({ miembroDe: [] });

    const resultado = await cambiarIdentidad({ businessId: PANADERIA });

    expect(resultado.ok).toBe(false);
    expect(supabase.upsert).not.toHaveBeenCalled();
  });

  it("con membresía vigente escribe la identidad, con el tenant del guard", async () => {
    const supabase = montar({ miembroDe: [PANADERIA] });

    const resultado = await cambiarIdentidad({ businessId: PANADERIA });

    expect(resultado).toMatchObject({ ok: true, tipo: "negocio" });
    expect(supabase.from).toHaveBeenCalledWith("active_identities");
    expect(supabase.upsert).toHaveBeenCalledWith(
      { profile_id: USUARIO, tenant_id: TENANT, business_id: PANADERIA },
      { onConflict: "profile_id" },
    );
    // El header vive en el layout: revalidar sólo la pantalla actual dejaría el
    // avatar de arriba mostrando la identidad vieja.
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("volver al perfil personal BORRA la fila (no existe business_id null)", async () => {
    const supabase = montar({ miembroDe: [PANADERIA] });

    const resultado = await cambiarIdentidad({ businessId: null });

    expect(resultado).toMatchObject({ ok: true, tipo: "personal" });
    expect(supabase.delete).toHaveBeenCalled();
    expect(supabase.eq).toHaveBeenCalledWith("profile_id", USUARIO);
    expect(supabase.upsert).not.toHaveBeenCalled();
  });

  it("un id que no es un uuid se rechaza antes de tocar la base", async () => {
    const supabase = montar({ miembroDe: [PANADERIA] });

    const resultado = await cambiarIdentidad({ businessId: "'; drop table posts;--" });

    expect(resultado.ok).toBe(false);
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("sin sesión no se cambia nada", async () => {
    const supabase = montar({ autenticado: false, miembroDe: [PANADERIA] });

    const resultado = await cambiarIdentidad({ businessId: PANADERIA });

    expect(resultado.ok).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
